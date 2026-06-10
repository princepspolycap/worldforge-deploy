"""CompanyAnalyst agent: scrape a company URL, then reason about the business.

This is the first reasoning hop on the URL path. It scrapes a homepage into
structured signal (title, description, headings, CTAs), then a Foundry reasoning
agent distills that into a clean company profile - what the company sells, to
whom, and how. The profile feeds the Org Designer, so the chain reads:

    URL -> scrape -> reason about the company -> design the org -> build it.

Deployment preference: STRATEGIST_MODEL (company analysis is strategy work);
falls back to NARRATOR_MODEL, then to a deterministic distillation of the
scraped signal so the whole path runs after a fresh `git clone` with zero Azure.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from agents.model_config import get_foundry_client, is_live, model_for, create_chat_completion
from agents.retrieval import scrape_company


SYSTEM = (
    "You are a company analyst. Given structured signal scraped from a company's "
    "homepage (title, description, headings, calls to action), infer what the "
    "business actually does. Be concrete and avoid marketing fluff. Return ONLY a "
    "valid JSON object."
)

USER_TEMPLATE = """\
Scraped signal from {host}:
- Title: {title}
- Description: {description}
- Headings: {headings}
- Calls to action: {ctas}
- Body excerpt: {excerpt}

Infer the business and return JSON:
{{
  "company_summary": "one plain sentence: what this company does and for whom",
  "what_they_sell": "the core product or service",
  "target_customer": "who pays for it",
  "business_model": "how it makes money (e.g. SaaS subscription, agency/service, marketplace)",
  "signals": ["3-5 short evidence phrases pulled from the page"]
}}
"""

_STOPWORDS = {
    "the", "and", "for", "with", "your", "our", "you", "we", "are", "that", "this",
    "from", "into", "home", "homepage", "welcome", "inc", "llc", "ltd", "co", "com",
}


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

    return {
        "company_summary": summary,
        "what_they_sell": what[:200],
        "target_customer": audience[:120],
        "business_model": model,
        "signals": signals[:5],
    }


def _domain_only_profile(url: str) -> Dict[str, Any]:
    host = urlparse(url).netloc or url
    return {
        "company_summary": f"A small digital-first business operating at {host}.",
        "what_they_sell": "an online product or service (homepage could not be read)",
        "target_customer": "small teams and operators",
        "business_model": "Digital-first product or service",
        "signals": [f"Domain: {host}", "Homepage was unreachable; using a sensible default."],
    }


def _compose_brief(profile: Dict[str, Any], scraped: Optional[Dict[str, Any]], url: str) -> str:
    host = (scraped or {}).get("host") or urlparse(url).netloc or url
    lines = [
        f"Company: {host}",
        f"What they do: {profile.get('company_summary', '')}",
        f"Offering: {profile.get('what_they_sell', '')}",
        f"Target customer: {profile.get('target_customer', '')}",
        f"Business model: {profile.get('business_model', '')}",
    ]
    if scraped and scraped.get("headings"):
        lines.append("Homepage sections: " + " | ".join(scraped["headings"][:6]))
    return "\n".join(line for line in lines if line.strip())[:1400]


def analyze_company(url: str) -> Dict[str, Any]:
    """Scrape `url`, reason about the business, and return a company profile.

    Returns a dict: {company_summary, what_they_sell, target_customer,
    business_model, signals, brief, host, source, scraped, mode}. `brief` is the
    clean, structured seed handed to the Org Designer. Never raises - degrades to
    a domain-only profile so the demo cannot hard-fail on a bad URL.
    """
    host = urlparse(url).netloc or url
    scraped = scrape_company(url)

    if not scraped:
        profile = _domain_only_profile(url)
        profile.update({
            "brief": _compose_brief(profile, None, url),
            "host": host,
            "source": url,
            "scraped": False,
            "mode": "live" if is_live() else "simulation",
        })
        return profile

    client = get_foundry_client()
    deployment = model_for("strategist") or model_for("narrator")

    profile: Optional[Dict[str, Any]] = None
    if client and deployment and is_live():
        user = USER_TEMPLATE.format(
            host=host,
            title=scraped.get("title", ""),
            description=scraped.get("description", ""),
            headings=" | ".join(scraped.get("headings", [])[:8]) or "(none)",
            ctas=", ".join(scraped.get("ctas", [])[:6]) or "(none)",
            excerpt=(scraped.get("text", "") or "")[:1200],
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

    # Normalize shape + attach the brief and provenance.
    signals = profile.get("signals")
    if not isinstance(signals, list):
        signals = [str(signals)] if signals else []
    profile["signals"] = [str(s) for s in signals][:5]
    profile.setdefault("what_they_sell", "")
    profile.setdefault("target_customer", "")
    profile.setdefault("business_model", "")
    profile["company_summary"] = str(profile.get("company_summary") or "").strip() or _domain_only_profile(url)["company_summary"]
    profile["brief"] = _compose_brief(profile, scraped, url)
    profile["host"] = host
    profile["source"] = url
    profile["scraped"] = True
    profile["scraped_chars"] = scraped.get("chars", 0)
    profile["mode"] = "live" if (client and deployment and is_live()) else "simulation"
    return profile
