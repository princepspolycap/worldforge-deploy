"""Foundry IQ retrieval client.

Preferred path: real Foundry IQ - permission-aware, cited retrieval over the
project knowledge base (set FOUNDRY_PROJECT_ENDPOINT + FOUNDRY_IQ_KNOWLEDGE_BASE).
Fallback: a local keyword scan over submission/knowledge/, so a keyless clone
still recalls the same playbooks. Hits carry an `origin` field (`foundry-iq`
vs `local-knowledge`) so the UI and replay log can show which path answered.
"""
from __future__ import annotations

import html
import ipaddress
import os
import re
import socket
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse, urlencode, parse_qs, unquote


KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge"

# Cached availability of the real IQ path: None = untried, False = failed once
# (missing role, no knowledge base provisioned) - skip for the process life.
_IQ_AVAILABLE: Optional[bool] = None


def _iq_retrieve(query: str, top_k: int) -> Optional[List[dict]]:
    """Query the Foundry IQ knowledge base on the project endpoint.

    Returns cited hits, or None when IQ is not configured/reachable so the
    caller falls back to the local knowledge scan.
    """
    global _IQ_AVAILABLE
    if _IQ_AVAILABLE is False:
        return None
    endpoint = os.getenv("FOUNDRY_PROJECT_ENDPOINT", "").strip().rstrip("/")
    kb = os.getenv("FOUNDRY_IQ_KNOWLEDGE_BASE", "").strip()
    if not endpoint or not kb:
        return None
    try:
        import httpx
        from azure.identity import DefaultAzureCredential
        token = DefaultAzureCredential(exclude_interactive_browser_credential=False) \
            .get_token("https://ai.azure.com/.default").token
        resp = httpx.post(
            f"{endpoint}/knowledgebases/{kb}/retrieve",
            params={"api-version": "2025-11-15-preview"},
            headers={"Authorization": f"Bearer {token}"},
            json={"query": query, "top": top_k},
            timeout=12.0,
        )
        resp.raise_for_status()
        data = resp.json()
        hits: List[dict] = []
        for item in (data.get("results") or data.get("references") or [])[:top_k]:
            hits.append({
                "content": str(item.get("content") or item.get("text") or "")[:800],
                "source": str(item.get("source") or item.get("title") or kb),
                "score": float(item.get("score") or item.get("relevance") or 0.0),
                "origin": "foundry-iq",
                "citation": str(item.get("url") or item.get("id") or ""),
            })
        if hits:
            _IQ_AVAILABLE = True
            return hits
        return None  # empty answer: let local knowledge try
    except Exception:
        _IQ_AVAILABLE = False
        return None


def retrieve(query: str, top_k: int = 3, source_filter: Optional[str] = None) -> List[dict]:
    """Retrieve relevant chunks for a query.

    Returns a list of dicts: [{content, source, score, origin, ...}, ...].
    Tries the real Foundry IQ knowledge base first (cited), then the local
    knowledge/ keyword scan (forkable fallback).
    """
    if not source_filter:
        iq_hits = _iq_retrieve(query, top_k)
        if iq_hits:
            return iq_hits

    results = []
    if not KNOWLEDGE_DIR.exists():
        return results

    query_lower = query.lower()
    keywords = set(query_lower.split())

    for fpath in sorted(KNOWLEDGE_DIR.glob("**/*.md")) + sorted(KNOWLEDGE_DIR.glob("**/*.txt")):
        if source_filter and source_filter.lower() not in fpath.name.lower():
            continue
        try:
            text = fpath.read_text(errors="ignore")
        except Exception:
            continue
        # Naive relevance: count keyword overlaps in the first 2000 chars.
        snippet = text[:2000]
        snippet_lower = snippet.lower()
        hits = sum(1 for kw in keywords if kw in snippet_lower)
        if hits > 0:
            results.append({
                "content": snippet[:800],
                "source": str(fpath.relative_to(KNOWLEDGE_DIR)),
                "score": hits / max(len(keywords), 1),
                "origin": "local-knowledge",
            })

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:top_k]


def _fetch_html(url: str, max_bytes: int = 400_000, timeout: float = 6.0) -> Optional[str]:
    """Fetch a public URL and return decoded HTML, or None on any failure.

    Dependency-free (stdlib only) so the repo stays forkable. SSRF-guarded:
    only http/https, public hosts only (no localhost, private ranges,
    link-local, or the cloud metadata endpoint).
    """
    if not _is_public_http_url(url):
        return None

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; CampaignOrgDesigner/1.0)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    try:
        # nosec B310 - scheme + host validated by _is_public_http_url above.
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if "html" not in ctype and "text" not in ctype:
                return None
            raw = resp.read(max_bytes)
    except (urllib.error.URLError, socket.timeout, ValueError, OSError):
        return None

    try:
        return raw.decode("utf-8", errors="ignore")
    except Exception:
        return None


def ingest_url(url: str, max_bytes: int = 400_000, timeout: float = 6.0) -> Optional[str]:
    """Fetch a public company URL and return readable plain text.

    Used to seed the OrgDesigner from any company's homepage. Returns None on
    any failure so callers fall back to a brief seeded from the URL itself.
    """
    html_doc = _fetch_html(url, max_bytes=max_bytes, timeout=timeout)
    if not html_doc:
        return None
    return _html_to_text(html_doc) or None


def web_search(query: str, top_k: int = 5, timeout: float = 8.0) -> List[dict]:
    """Live web search, keyless by default. Returns [{title, url, snippet}].

    Two paths, same degradation law as the rest of the repo:
      1. Poly platform - when ENABLE_POLY_BACKEND=true and POLY_BACKEND_URL is
         set, POST the query to Poly's search endpoint (origin "poly").
      2. Keyless fallback - DuckDuckGo's HTML endpoint, parsed with stdlib only
         (origin "duckduckgo"). No API key, no signup, forkable after clone.
    Any failure returns [] so callers degrade gracefully.
    """
    query = (query or "").strip()
    if not query:
        return []
    poly = _poly_web_search(query, top_k, timeout)
    if poly is not None:
        return poly[:top_k]
    hits = _duckduckgo_search(query, top_k, timeout)
    if hits:
        return hits[:top_k]
    # HTML endpoint can throttle on bursts - fall back to the keyless JSON
    # Instant Answer API (different host). It is an entity API, so strip search
    # operators (quotes, OR/AND) to a plain query before asking.
    return _ddg_instant_answer(_plainify_query(query), top_k, timeout)[:top_k]


def _plainify_query(query: str) -> str:
    """Reduce a SERP-style query to a plain entity string for the IA endpoint."""
    plain = query.replace('"', " ")
    plain = re.sub(r"\b(?:OR|AND)\b", " ", plain)
    plain = re.sub(r"[-+]", " ", plain)
    return re.sub(r"\s+", " ", plain).strip()


def _poly_web_search(query: str, top_k: int, timeout: float) -> Optional[List[dict]]:
    """POST to the Poly platform's web-search endpoint, or None when disabled.

    Poly is an external tool (not on the Foundry reasoning path), so it is fully
    optional. None here means "not configured" - the caller uses the keyless
    DuckDuckGo path instead.
    """
    if os.getenv("ENABLE_POLY_BACKEND", "").strip().lower() not in ("1", "true", "yes"):
        return None
    base = os.getenv("POLY_BACKEND_URL", "").strip().rstrip("/")
    if not base:
        return None
    import json
    body = json.dumps({"query": query, "top_k": top_k}).encode()
    req = urllib.request.Request(f"{base}/web/search", data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    key = os.getenv("POLY_BACKEND_KEY", "").strip()
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
    except Exception:
        return None
    out: List[dict] = []
    for item in (data.get("results") or data.get("items") or [])[:top_k]:
        out.append({
            "title": str(item.get("title") or "")[:200],
            "url": str(item.get("url") or item.get("link") or ""),
            "snippet": str(item.get("snippet") or item.get("description") or "")[:400],
            "origin": "poly",
        })
    return out


def _duckduckgo_search(query: str, top_k: int, timeout: float) -> List[dict]:
    """Keyless web search via DuckDuckGo's HTML endpoint. stdlib-only parsing.

    The endpoint expects a POST form submission and a browser User-Agent; a GET
    returns an interstitial with no results.
    """
    endpoint = "https://html.duckduckgo.com/html/"
    if not _is_public_http_url(endpoint):
        return []
    data = urlencode({"q": query, "kl": "us-en"}).encode()
    req = urllib.request.Request(
        endpoint, data=data, method="POST",
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
            "Accept": "text/html,application/xhtml+xml",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        # nosec B310 - fixed public host validated above.
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            doc = resp.read(600_000).decode("utf-8", errors="ignore")
    except (urllib.error.URLError, socket.timeout, ValueError, OSError):
        return []
    results: List[dict] = []
    # Each organic result is an <a class="result__a" href="...">Title</a> plus an
    # optional <a class="result__snippet">. Older responses wrap the real URL in
    # a /l/?uddg= redirect, which _unwrap_ddg_url resolves.
    for m in re.finditer(r'(?is)<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', doc):
        href, title_html = m.group(1), m.group(2)
        real = _unwrap_ddg_url(href)
        if not real:
            continue
        # Snippet: the next result__snippet block after this anchor, if present.
        tail = doc[m.end(): m.end() + 1500]
        sm = re.search(r'(?is)<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', tail)
        snippet = _html_to_text(sm.group(1)) if sm else ""
        results.append({
            "title": _html_to_text(title_html)[:200],
            "url": real,
            "snippet": snippet[:400],
            "origin": "duckduckgo",
        })
        if len(results) >= top_k:
            break
    return results


def _unwrap_ddg_url(href: str) -> str:
    """Resolve a DuckDuckGo redirect (//duckduckgo.com/l/?uddg=...) to its target."""
    if not href:
        return ""
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if "duckduckgo.com" in (parsed.hostname or "") and parsed.path.startswith("/l/"):
        target = parse_qs(parsed.query).get("uddg", [""])[0]
        return unquote(target) if target else ""
    return href if parsed.scheme in ("http", "https") else ""


def _ddg_instant_answer(query: str, top_k: int, timeout: float) -> List[dict]:
    """Keyless fallback: DuckDuckGo Instant Answer JSON API (api.duckduckgo.com).

    Returns the entity abstract plus related-topic links. Less rich than the
    HTML results but on a different host that does not throttle on bursts, so it
    keeps web_search useful when the HTML endpoint is rate-limited.
    """
    endpoint = "https://api.duckduckgo.com/?" + urlencode(
        {"q": query, "format": "json", "no_html": "1", "no_redirect": "1", "t": "campaignforge"})
    if not _is_public_http_url(endpoint):
        return []
    req = urllib.request.Request(endpoint, headers={"User-Agent": "CampaignForge/1.0", "Accept": "application/json"})
    try:
        # nosec B310 - fixed public host validated above.
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            import json
            data = json.loads(resp.read(400_000).decode("utf-8", errors="ignore"))
    except (urllib.error.URLError, socket.timeout, ValueError, OSError):
        return []
    results: List[dict] = []
    abstract = (data.get("AbstractText") or "").strip()
    if abstract:
        results.append({
            "title": (data.get("Heading") or query)[:200],
            "url": data.get("AbstractURL") or "",
            "snippet": abstract[:400],
            "origin": "duckduckgo-ia",
        })

    def _walk(topics):
        for t in topics:
            if len(results) >= top_k:
                return
            if isinstance(t, dict) and t.get("Topics"):
                _walk(t["Topics"])
            elif isinstance(t, dict) and t.get("FirstURL"):
                text = (t.get("Text") or "").strip()
                results.append({
                    "title": text[:80] or t["FirstURL"],
                    "url": t["FirstURL"],
                    "snippet": text[:400],
                    "origin": "duckduckgo-ia",
                })

    _walk(data.get("RelatedTopics") or [])
    return results[:top_k]




def scrape_company(url: str, max_bytes: int = 400_000, timeout: float = 6.0) -> Optional[dict]:
    """Scrape a public company homepage into structured signal.

    Returns a dict with the strongest signals a reasoning agent can use to
    understand the business - title, meta/OpenGraph description, the on-page
    headings (what the company chooses to say first), call-to-action labels,
    and a trimmed body. Returns None on any fetch failure so callers can fall
    back to a domain-only brief. SSRF-guarded via `_fetch_html`.

    Parser law (same degradation rule as every subsystem): BeautifulSoup when
    installed - a real DOM walk that survives messy real-world HTML - and the
    dependency-free regex path otherwise. The result carries `parser` so the
    UI/replay can show which path read the page.
    """
    html_doc = _fetch_html(url, max_bytes=max_bytes, timeout=timeout)
    if not html_doc:
        return None

    soup_signals = _soup_company_signals(html_doc)
    if soup_signals is not None:
        host = urlparse(url).netloc or url
        soup_signals.update({"host": host, "url": url})
        return soup_signals

    # Drop non-content blocks before extracting structure.
    cleaned = re.sub(r"(?is)<(script|style|noscript|template|svg)\b.*?</\1>", " ", html_doc)
    host = urlparse(url).netloc or url

    title = _extract_title(cleaned)
    description = _extract_meta(cleaned, ("description", "og:description", "twitter:description"))
    site_name = _extract_meta(cleaned, ("og:site_name", "application-name"))
    headings = _extract_headings(cleaned)
    ctas = _extract_ctas(cleaned)
    body = _html_to_text(cleaned)

    # Require *some* readable signal, else treat as a failed scrape.
    if not any([title, description, headings, body]):
        return None

    return {
        "host": host,
        "url": url,
        "title": title,
        "site_name": site_name,
        "description": description,
        "headings": headings,
        "ctas": ctas,
        "text": body,
        "chars": len(body),
        "parser": "regex",
    }


def _soup_company_signals(html_doc: str) -> Optional[dict]:
    """Extract company signals with BeautifulSoup when installed.

    A DOM walk beats regex on real-world pages (nested tags, unquoted attrs,
    broken markup). Returns None when bs4 is missing or parsing fails, so
    `scrape_company` falls through to the dependency-free regex path.
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return None
    try:
        soup = BeautifulSoup(html_doc, "html.parser")
        for tag in soup(["script", "style", "noscript", "template", "svg"]):
            tag.decompose()

        title = soup.title.get_text(" ", strip=True) if soup.title else ""

        def meta(*names: str) -> str:
            for n in names:
                el = soup.find("meta", attrs={"name": n}) or soup.find("meta", attrs={"property": n})
                if el and el.get("content"):
                    return str(el["content"]).strip()
            return ""

        description = meta("description", "og:description", "twitter:description")
        site_name = meta("og:site_name", "application-name")
        headings = [h.get_text(" ", strip=True) for h in soup.find_all(["h1", "h2", "h3"], limit=24)]
        headings = [h for h in headings if 2 < len(h) < 140][:12]
        ctas = []
        for el in soup.find_all(["a", "button"], limit=200):
            label = el.get_text(" ", strip=True)
            if 2 < len(label) < 40 and label not in ctas:
                ctas.append(label)
            if len(ctas) >= 10:
                break
        body = " ".join(soup.get_text(" ", strip=True).split())[:4000]

        if not any([title, description, headings, body]):
            return None
        return {
            "title": title,
            "site_name": site_name,
            "description": description,
            "headings": headings,
            "ctas": ctas,
            "text": body,
            "chars": len(body),
            "parser": "bs4",
        }
    except Exception:
        return None


def brief_from_url(url: str) -> str:
    """Turn a company URL into a short brief seed for the OrgDesigner.

    Falls back to a generic brief built from the domain when the page can't be
    fetched (offline, blocked, or non-HTML), so the demo never hard-fails.
    """
    scraped = scrape_company(url)
    host = urlparse(url).netloc or url
    if scraped:
        lead = scraped.get("description") or scraped.get("title") or ""
        headings = " | ".join(scraped.get("headings", [])[:6])
        parts = [f"Company homepage ({host})."]
        if lead:
            parts.append(lead.strip())
        if headings:
            parts.append(f"On-page sections: {headings}.")
        body = (scraped.get("text") or "")[:800].strip()
        if body:
            parts.append(body)
        return " ".join(parts)[:1400]
    return (
        f"A company operating at {host}. The homepage could not be read, so design "
        f"a sensible default org for a small digital-first business at this domain."
    )


# ---------------------------------------------------------------------------
# Internal helpers (SSRF guard + HTML stripping)
# ---------------------------------------------------------------------------

_BLOCK_HOST_SUFFIXES = (".internal", ".local", ".localhost")


def _is_public_http_url(url: str) -> bool:
    """Allow only http/https URLs that resolve to public IP addresses."""
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = parsed.hostname
    if not host:
        return False
    host_lower = host.lower()
    if host_lower == "localhost" or host_lower.endswith(_BLOCK_HOST_SUFFIXES):
        return False

    # Resolve every address the host maps to; reject if ANY is non-public.
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError, OSError):
        return False
    if not infos:
        return False
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return False
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified):
            return False
    return True


def _html_to_text(html_doc: str) -> str:
    """Strip scripts/styles/tags and collapse whitespace - no extra deps."""
    # Drop non-content blocks entirely.
    cleaned = re.sub(r"(?is)<(script|style|noscript|template|svg)\b.*?</\1>", " ", html_doc)
    # Prefer the <title> + meta description as a strong signal up front.
    title_match = re.search(r"(?is)<title\b[^>]*>(.*?)</title>", cleaned)
    desc_match = re.search(
        r'(?is)<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']',
        cleaned,
    )
    lead = " ".join(
        html.unescape(m.group(1)).strip()
        for m in (title_match, desc_match)
        if m and m.group(1).strip()
    )
    body = re.sub(r"(?is)<[^>]+>", " ", cleaned)
    body = html.unescape(body)
    body = re.sub(r"\s+", " ", body).strip()
    combined = f"{lead}. {body}" if lead else body
    return combined[:8000]


def _clean_inline(value: str) -> str:
    """Strip tags + collapse whitespace inside a single extracted fragment."""
    text = re.sub(r"(?is)<[^>]+>", " ", value or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _extract_title(html_doc: str) -> str:
    match = re.search(r"(?is)<title\b[^>]*>(.*?)</title>", html_doc)
    if match:
        return _clean_inline(match.group(1))[:200]
    # Fall back to OpenGraph title, then the first H1.
    og = _extract_meta(html_doc, ("og:title",))
    if og:
        return og[:200]
    h1 = re.search(r"(?is)<h1\b[^>]*>(.*?)</h1>", html_doc)
    return _clean_inline(h1.group(1))[:200] if h1 else ""


def _extract_meta(html_doc: str, names: tuple) -> str:
    """Return the first non-empty <meta> content for any of `names`.

    Matches both name="..." and property="..." (OpenGraph) with the content
    attribute in either order.
    """
    for name in names:
        esc = re.escape(name)
        patterns = (
            rf'(?is)<meta[^>]+(?:name|property)=["\']{esc}["\'][^>]+content=["\'](.*?)["\']',
            rf'(?is)<meta[^>]+content=["\'](.*?)["\'][^>]+(?:name|property)=["\']{esc}["\']',
        )
        for pat in patterns:
            m = re.search(pat, html_doc)
            if m and m.group(1).strip():
                return _clean_inline(m.group(1))[:400]
    return ""


def _extract_headings(html_doc: str, limit: int = 12) -> List[str]:
    """Pull H1/H2/H3 text - what the company chooses to say first."""
    out: List[str] = []
    seen = set()
    for m in re.finditer(r"(?is)<h[1-3]\b[^>]*>(.*?)</h[1-3]>", html_doc):
        text = _clean_inline(m.group(1))
        if not text or len(text) < 3 or len(text) > 140:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
        if len(out) >= limit:
            break
    return out


_CTA_HINT = re.compile(
    r"(?i)\b(sign\s?up|get\s?started|start\s|try\s|book\s|buy\s|subscribe|"
    r"pricing|contact|demo|join|download|free\s?trial|learn\s?more)\b"
)


def _extract_ctas(html_doc: str, limit: int = 8) -> List[str]:
    """Collect call-to-action labels from links/buttons (intent signal)."""
    out: List[str] = []
    seen = set()
    for m in re.finditer(r"(?is)<(?:a|button)\b[^>]*>(.*?)</(?:a|button)>", html_doc):
        text = _clean_inline(m.group(1))
        if not text or len(text) > 40 or not _CTA_HINT.search(text):
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
        if len(out) >= limit:
            break
    return out


