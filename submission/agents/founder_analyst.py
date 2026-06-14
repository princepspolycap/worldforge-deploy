"""FounderAnalyst (ProfileAnalyst) agent: scrape a public URL, then reason.

This is the first reasoning hop on the URL path. It scrapes a public page into
structured signal (title, description, headings, CTAs), then a Foundry reasoning
agent distills that into a clean founder profile. For LinkedIn/public profile
pages, that means what the founder appears strong at and which starting
archetype fits; for mission pages, what the mission does. When the page is
restricted, the open web is cross-referenced instead so real signal still lands.

    URL -> scrape -> reason about the founder/mission -> design the org -> build it.

Deployment preference: STRATEGIST_MODEL (profile analysis is strategy work);
falls back to NARRATOR_MODEL, then to a deterministic distillation of the
scraped signal so the whole path runs after a fresh `git clone` with zero Azure.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from agents.model_config import get_foundry_client, is_live, model_for, runtime_mode, create_chat_completion
from agents.retrieval import scrape_company, web_search
from state import profile_cache


SYSTEM = (
    "You are a profile and mission analyst. Given structured signal scraped from "
    "a public URL (LinkedIn profile, personal site, company page, or mission "
    "page), infer the useful operating signal for a world-improvement founder. "
    "Be concrete and avoid marketing fluff. Return ONLY a valid JSON object."
)

USER_TEMPLATE = """\
Scraped signal from {host} ({source_kind}):
- Title: {title}
- Description: {description}
- Headings: {headings}
- Calls to action: {ctas}
- Body excerpt: {excerpt}
- Public web findings (live web_search): {web_findings}

Infer the public profile or mission and return JSON:
{{
  "company_summary": "one plain sentence: what this founder/mission is about",
  "what_they_sell": "the core skill, product, service, or mission capability",
  "target_customer": "who benefits from this work",
  "business_model": "how this work creates value",
  "founder_archetype": "Builder, Seller, Designer, or Operator",
  "founder_skill": "short skill phrase that should become the human seat",
  "signals": ["3-5 short evidence phrases pulled from the page"]
}}
"""

_STOPWORDS = {
    "the", "and", "for", "with", "your", "our", "you", "we", "are", "that", "this",
    "from", "into", "home", "homepage", "welcome", "inc", "llc", "ltd", "co", "com",
}

# Auth-wall / nav / boilerplate phrases that restricted pages (LinkedIn most of
# all) leak into the scraped title/headings/CTAs. They carry zero operating
# signal about the founder, so they must be dropped before reaching `signals`
# and the org brief. Matched case-insensitively as substrings.
_JUNK_SIGNAL_PATTERNS = re.compile(
    r"(?i)("
    r"sign\s?in|sign\s?up|log\s?in|join\s?(now|to view|linkedin)|"
    r"agree\s?(&|and)\s?join|new to linkedin|create (an )?account|forgot password|"
    r"welcome back|email or phone|continue with|by clicking continue|user agreement|"
    r"privacy policy|cookie (policy|preferences)|terms of (service|use)|"
    r"see who you know|people (also viewed|you may know)|"
    r"full profile|this button displays|skip to|click here"
    r")"
)


def _clean_signals(signals: Any, limit: int = 5) -> List[str]:
    """Drop auth-wall/nav/boilerplate phrases and dedup, preserving order.

    Single source of truth for signal hygiene: every profile path routes its
    final `signals` through here so junk from a restricted page never reaches
    the org brief or the story UI. Always returns a list (never raises)."""
    if not isinstance(signals, list):
        signals = [signals] if signals else []
    out: List[str] = []
    for raw in signals:
        text = str(raw).strip()
        if not text or _JUNK_SIGNAL_PATTERNS.search(text):
            continue
        if text not in out:
            out.append(text)
    return out[:limit]


def _extract_json(content: str) -> Optional[Dict]:
    if not content:
        return None
    text = content.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    decoder = json.JSONDecoder()
    first = text.find("{")
    if first != -1:
        try:
            parsed, _ = decoder.raw_decode(text[first:])
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None
    return None


def _first_sentence(value: str, limit: int = 180) -> str:
    if not value:
        return ""
    clean = re.sub(r"\s+", " ", value).strip()
    parts = re.split(r"(?<=[.!?])\s+", clean)
    out = parts[0] if parts else clean
    return out[:limit].strip()


def _detect_audience(blob: str) -> str:
    """Pull a 'for <audience>' phrase from the page text if present."""
    m = re.search(r"(?i)\bfor ([a-z][a-z &/-]{3,40}?)(?:[.,;:]|\band\b|$)", blob)
    if m:
        audience = m.group(1).strip()
        if audience and audience.lower() not in _STOPWORDS:
            return audience
    return ""


def _source_kind(url: str) -> str:
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    path = (parsed.path or "").lower()
    if "linkedin.com" in host and "/in/" in path:
        return "linkedin_profile"
    if "linkedin.com" in host:
        return "linkedin_public_page"
    if any(token in host for token in ("about.me", "bio.site", "linktr.ee", "medium.com", "github.com")):
        return "public_profile"
    return "mission_or_company_url"


def _linkedin_handle(url: str) -> str:
    parsed = urlparse(url)
    parts = [p for p in (parsed.path or "").split("/") if p]
    if "in" in parts:
        idx = parts.index("in")
        if idx + 1 < len(parts):
            return parts[idx + 1].replace("-", " ").replace("_", " ").strip()
    return ""


# Profile URLs where the page is often unreadable (LinkedIn) or thin - exactly
# where public-web OSINT adds the most signal. Company/mission URLs skip OSINT
# so company analysis stays a single cheap fetch.
_PROFILE_SOURCE_KINDS = {"linkedin_profile", "linkedin_public_page", "public_profile"}


def _osint_query(url: str) -> str:
    """Build a public-web search query from a profile URL/handle.

    For a person the bare name is the strongest signal for both the HTML SERP
    and the entity (Instant Answer) endpoint, so we keep it simple.
    """
    handle = _linkedin_handle(url)
    if handle:
        return handle
    host = (urlparse(url).netloc or "").strip()
    return f"{host} founder about" if host else ""


def osint_enrich(url: str, top_k: int = 4) -> Dict[str, Any]:
    """Public-web OSINT on a founder URL via the keyless web_search tool.

    Returns {signals, blob, hits}: real titles/snippets found about the person,
    used to ground the Profile Analyst when a page (e.g. a restricted LinkedIn
    profile) cannot be read directly. Never raises - empty on any failure so the
    analyzer degrades cleanly. Only meaningful for profile URLs (see callers).
    """
    query = _osint_query(url)
    if not query:
        return {"signals": [], "blob": "", "hits": []}
    try:
        hits = web_search(query, top_k=top_k)
    except Exception:
        hits = []
    signals: List[str] = []
    blobs: List[str] = []
    for h in hits:
        title = (h.get("title") or "").strip()
        snippet = (h.get("snippet") or "").strip()
        if title:
            signals.append(f"Web: {title[:90]}")
        blobs.append(f"{title}. {snippet}")
    return {"signals": signals[:4], "blob": " ".join(blobs)[:1500], "hits": hits}


def _infer_founder_archetype(blob: str, url: str = "") -> Dict[str, str]:
    """Infer the founder's starting class from public profile text.

    This is deliberately heuristic and transparent. It makes LinkedIn/profile
    input useful without making private LinkedIn API access required. Live mode
    can override through the LLM JSON fields; this remains the deterministic
    fallback for blocked or thin public pages.
    """
    text = f"{blob or ''} {_linkedin_handle(url)}".lower()
    buckets = {
        "Builder": {
            "words": (
                "engineer", "software", "developer", "code", "ai", "machine learning",
                "technical", "product", "prototype", "build", "systems", "automation",
                "data", "architecture", "founder"
            ),
            "skill": "building product: shipping software, prototypes, systems",
        },
        "Seller": {
            "words": (
                "sales", "growth", "marketing", "revenue", "partnership", "customers",
                "go-to-market", "community", "business development", "fundraising",
                "creator", "audience"
            ),
            "skill": "selling: closing deals, partnerships, growth conversations",
        },
        "Designer": {
            "words": (
                "design", "brand", "story", "storytelling", "ux", "creative",
                "visual", "content", "experience", "product design", "artist",
                "narrative"
            ),
            "skill": "design: brand, product experience, storytelling",
        },
        "Operator": {
            "words": (
                "operations", "operator", "process", "strategy", "systems", "finance",
                "execution", "program", "management", "logistics", "scale", "chief",
                "ceo"
            ),
            "skill": "operations: process, logistics, keeping the machine running",
        },
    }
    scores: Dict[str, int] = {}
    for name, spec in buckets.items():
        score = 0
        for word in spec["words"]:
            if word in text:
                score += 2 if " " in word else 1
        scores[name] = score

    archetype = max(scores, key=scores.get)
    if scores.get(archetype, 0) <= 0:
        archetype = "Builder"
    return {
        "founder_archetype": archetype,
        "founder_skill": buckets[archetype]["skill"],
    }


def _fallback_profile(scraped: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic distillation of scraped signal (no Foundry required)."""
    host = scraped.get("host") or ""
    title = (scraped.get("title") or "").strip()
    description = (scraped.get("description") or "").strip()
    headings = [h for h in scraped.get("headings", []) if h][:6]
    ctas = [c for c in scraped.get("ctas", []) if c][:5]
    body = scraped.get("text") or ""

    lead = description or _first_sentence(body) or title
    summary = _first_sentence(lead) or (title and f"{title}.") or f"A digital-first business at {host}."

    what = description and _first_sentence(description) or (headings[0] if headings else title) or "an online product or service"
    audience = _detect_audience(f"{description} {' '.join(headings)} {body[:600]}") or "small teams and operators"

    # CTAs hint at the model: buy/subscribe -> product; book/contact/demo -> service.
    cta_blob = " ".join(ctas).lower()
    if any(k in cta_blob for k in ("subscribe", "pricing", "free trial", "sign up", "get started")):
        model = "Self-serve product (likely subscription/SaaS)"
    elif any(k in cta_blob for k in ("book", "contact", "demo", "quote")):
        model = "Service / agency engagement (sales-assisted)"
    else:
        model = "Digital-first product or service"

    signals: List[str] = []
    if title:
        signals.append(f"Title: {title}")
    if description:
        signals.append(f"Tagline: {_first_sentence(description, 120)}")
    for h in headings[:3]:
        signals.append(h)
    if ctas:
        signals.append("CTAs: " + ", ".join(ctas[:3]))

    source_kind = _source_kind(scraped.get("url") or "")
    inferred = _infer_founder_archetype(f"{title} {description} {' '.join(headings)} {body[:1200]}", scraped.get("url") or "")
    return {
        "company_summary": summary,
        "what_they_sell": what[:200],
        "target_customer": audience[:120],
        "business_model": model,
        "source_kind": source_kind,
        **inferred,
        "signals": signals[:5],
    }


def _domain_only_profile(url: str) -> Dict[str, Any]:
    host = urlparse(url).netloc or url
    source_kind = _source_kind(url)
    handle = _linkedin_handle(url)
    inferred = _infer_founder_archetype(handle or host, url)
    if source_kind == "linkedin_profile":
        summary = f"A public LinkedIn profile signal for {handle or host}; detailed content was not readable without authentication."
        what = "founder profile signal from a public LinkedIn URL"
        audience = "the founder's future mission and collaborators"
        model = "Profile-first mission design"
    else:
        summary = f"A small digital-first mission operating at {host}."
        what = "an online product, service, or public mission (page could not be read)"
        audience = "small teams, operators, or mission collaborators"
        model = "Digital-first product, service, or mission"
    return {
        "company_summary": summary,
        "what_they_sell": what,
        "target_customer": audience,
        "business_model": model,
        "source_kind": source_kind,
        **inferred,
        "signals": [f"Domain: {host}", "Public page was unreachable or restricted; using profile fallback."],
    }


def _humanize_handle(handle: str) -> str:
    """Turn a profile slug into a display name: 'princeps-polycap' -> 'Princeps
    Polycap'. Drops trailing hex id segments LinkedIn sometimes appends."""
    if not handle:
        return ""
    cleaned = re.sub(r"[-_]+", " ", handle).strip()
    parts = [p for p in cleaned.split() if not re.fullmatch(r"[0-9a-f]{6,}", p)]
    return " ".join(w.capitalize() for w in (parts or cleaned.split()))[:60]


def _osint_role_phrase(titles: List[str]) -> str:
    """Pull the role/affiliation half out of an OSINT title, e.g.
    'Princeps Polycap - Founder @ Poly186' -> 'Founder @ Poly186'. Skips bare
    platform tails (YouTube, LinkedIn) that carry no operating signal."""
    skip = {"youtube", "linkedin", "x", "twitter", "instagram", "facebook", "medium", "github"}
    for title in titles:
        for sep in (" - ", " \u2013 ", " \u2014 ", " | ", ": "):
            if sep in title:
                tail = title.split(sep, 1)[1].strip()
                if tail and tail.lower() not in skip:
                    return tail[:120]
    return ""


def _osint_fallback_profile(url: str, osint: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic profile pieced together from public-web OSINT when the page
    itself is restricted. Turns real findings ('... - Founder @ Poly186') into a
    usable summary instead of a bare 'not readable' note - so the detected signal
    actually reaches the game even on a keyless clone (no Foundry)."""
    host = urlparse(url).netloc or url
    handle = _linkedin_handle(url)
    name = _humanize_handle(handle) or host
    titles = [str(h.get("title") or "").strip() for h in osint.get("hits", []) if h.get("title")]
    role = _osint_role_phrase(titles)
    inferred = _infer_founder_archetype(f'{osint.get("blob", "")} {handle}', url)
    if role:
        summary = f"{name}: {role}. Public profile pieced together from open-web findings."
        what = role
    else:
        summary = f"{name} - a public profile signal cross-referenced from the open web."
        what = "founder profile signal assembled from public-web findings"
    return {
        "company_summary": summary[:240],
        "what_they_sell": what[:200],
        "target_customer": "the people this founder's work serves",
        "business_model": "Profile-first mission design",
        "source_kind": _source_kind(url),
        **inferred,
        "signals": (osint.get("signals") or [])[:5] or [f"Domain: {host}"],
    }


def _osint_profile(url: str, osint: Dict[str, Any]) -> Dict[str, Any]:
    """Reason a real profile from public-web OSINT when the page is restricted.
    Live mode runs the Profile Analyst over the findings; otherwise a
    deterministic distillation. Either way the open-web signal reaches the game
    instead of degrading to a 'page not readable' default."""
    host = urlparse(url).netloc or url
    handle = _linkedin_handle(url)
    blob = osint.get("blob") or ""
    client = get_foundry_client()
    deployment = model_for("strategist") or model_for("narrator")
    if client and deployment and is_live() and blob:
        user = USER_TEMPLATE.format(
            host=host,
            source_kind=_source_kind(url),
            title=_humanize_handle(handle) or host,
            description="(the page itself was restricted - reason from the open-web findings)",
            headings="(none)",
            ctas="(none)",
            excerpt="(page not readable without authentication)",
            web_findings=blob[:1200],
        )
        try:
            resp = create_chat_completion(
                deployment,
                [{"role": "system", "content": SYSTEM},
                 {"role": "user", "content": user}],
                max_completion_tokens=1200,
            )
            parsed = _extract_json(resp.choices[0].message.content or "")
            if parsed and parsed.get("company_summary"):
                return parsed
        except Exception:
            pass
    return _osint_fallback_profile(url, osint)


def _compose_brief(profile: Dict[str, Any], scraped: Optional[Dict[str, Any]], url: str) -> str:
    host = (scraped or {}).get("host") or urlparse(url).netloc or url
    lines = [
        f"Source: {host}",
        f"Source kind: {profile.get('source_kind', _source_kind(url))}",
        f"Profile/mission summary: {profile.get('company_summary', '')}",
        f"Capability or offering: {profile.get('what_they_sell', '')}",
        f"Beneficiary or customer: {profile.get('target_customer', '')}",
        f"Value model: {profile.get('business_model', '')}",
        f"Inferred founder archetype: {profile.get('founder_archetype', '')}",
        f"Founder human-seat skill: {profile.get('founder_skill', '')}",
    ]
    if scraped and scraped.get("headings"):
        lines.append("Homepage sections: " + " | ".join(scraped["headings"][:6]))
    return "\n".join(line for line in lines if line.strip())[:1400]


def analyze_founder_profile(url: str) -> Dict[str, Any]:
    """Scrape `url`, reason about the founder/mission, and return a profile.

    Returns a dict: {company_summary, what_they_sell, target_customer,
    business_model, signals, brief, host, source, scraped, mode}. `brief` is the
    clean, structured seed handed to the Org Designer. Never raises - degrades to
    a domain-only profile so the demo cannot hard-fail on a bad URL.

    URL-keyed cache: players don't log in, but the profile URL is a stable key,
    so a previously analyzed URL is reused instead of re-scraping/re-reasoning.
    """
    cached = profile_cache.get(url)
    if cached is not None:
        return cached
    profile = _analyze_founder_profile_uncached(url)
    profile_cache.put(url, profile)
    return profile


def _analyze_founder_profile_uncached(url: str) -> Dict[str, Any]:
    """The expensive path: live scrape + OSINT + Foundry reasoning. See
    analyze_founder_profile for the cached public entry point."""
    host = urlparse(url).netloc or url
    scraped = scrape_company(url)
    # Public-web OSINT once per analyze, only for person/profile URLs - this is
    # where a page is often unreadable (LinkedIn) and external signal matters.
    osint = osint_enrich(url) if _source_kind(url) in _PROFILE_SOURCE_KINDS else {"signals": [], "blob": "", "hits": []}

    if not scraped:
        if osint.get("blob"):
            # The page was restricted, but the open web knows this person - reason
            # a real profile from the OSINT instead of a bare domain default, so
            # the detected signal actually reaches the game.
            profile = _osint_profile(url, osint)
        else:
            profile = _domain_only_profile(url)
        # Merge OSINT signals (dedup) and seat the archetype from them if the
        # chosen profile path left it open.
        if osint["signals"]:
            merged = list(profile.get("signals") or [])
            for sig in osint["signals"]:
                if sig not in merged:
                    merged.append(sig)
            profile["signals"] = merged[:6]
            inferred = _infer_founder_archetype(f'{osint["blob"]} {_linkedin_handle(url)}', url)
            profile.setdefault("founder_archetype", inferred["founder_archetype"])
            profile.setdefault("founder_skill", inferred["founder_skill"])
        profile["signals"] = _clean_signals(profile.get("signals"), limit=6)
        profile.update({
            "brief": _compose_brief(profile, None, url),
            "host": host,
            "source": url,
            "scraped": False,
            "osint_hits": len(osint["hits"]),
            "mode": runtime_mode(),
        })
        return profile

    client = get_foundry_client()
    deployment = model_for("strategist") or model_for("narrator")

    profile: Optional[Dict[str, Any]] = None
    if client and deployment and is_live():
        user = USER_TEMPLATE.format(
            host=host,
            source_kind=_source_kind(url),
            title=scraped.get("title", ""),
            description=scraped.get("description", ""),
            headings=" | ".join(scraped.get("headings", [])[:8]) or "(none)",
            ctas=", ".join(scraped.get("ctas", [])[:6]) or "(none)",
            excerpt=(scraped.get("text", "") or "")[:1200],
            web_findings=(osint["blob"][:800] or "(none)"),
        )
        try:
            resp = create_chat_completion(
                deployment,
                [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": user},
                ],
                max_completion_tokens=1200,
            )
            parsed = _extract_json(resp.choices[0].message.content or "")
            if parsed and parsed.get("company_summary"):
                profile = parsed
        except Exception:
            profile = None

    if not profile:
        profile = _fallback_profile(scraped)

    # Public-web OSINT signals corroborate the page read; appended before the
    # final archetype re-inference so they feed it (without overriding a concrete
    # LLM archetype, which the `or` below preserves).
    if osint["signals"]:
        profile["signals"] = (list(profile.get("signals") or []) + osint["signals"])[:6]

    # Normalize shape + attach the brief and provenance.
    signals = profile.get("signals")
    if not isinstance(signals, list):
        signals = [str(signals)] if signals else []
    profile["signals"] = _clean_signals(signals, limit=5)
    profile.setdefault("what_they_sell", "")
    profile.setdefault("target_customer", "")
    profile.setdefault("business_model", "")
    profile.setdefault("source_kind", _source_kind(url))
    inferred = _infer_founder_archetype(
        " ".join([
            str(profile.get("company_summary", "")),
            str(profile.get("what_they_sell", "")),
            str(profile.get("target_customer", "")),
            " ".join(profile["signals"]),
            (scraped.get("text", "") or "")[:1200],
        ]),
        url,
    )
    profile["founder_archetype"] = str(profile.get("founder_archetype") or inferred["founder_archetype"])
    profile["founder_skill"] = str(profile.get("founder_skill") or inferred["founder_skill"])
    summary = str(profile.get("company_summary") or "").strip()
    # A restricted page can leak an auth-wall line into the summary too; fall
    # back to the domain default rather than seed the brief with boilerplate.
    if not summary or _JUNK_SIGNAL_PATTERNS.search(summary):
        summary = _domain_only_profile(url)["company_summary"]
    profile["company_summary"] = summary
    profile["brief"] = _compose_brief(profile, scraped, url)
    profile["host"] = host
    profile["source"] = url
    profile["scraped"] = True
    profile["scraped_chars"] = scraped.get("chars", 0)
    # Parser provenance: which path read the page (bs4 DOM walk vs stdlib
    # regex fallback) - surfaced in the replay log and the story UI.
    profile["parser"] = scraped.get("parser", "regex")
    profile["osint_hits"] = len(osint["hits"])
    profile["mode"] = runtime_mode() if (client and deployment and is_live()) else "simulation"
    return profile
