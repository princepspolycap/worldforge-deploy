"""Foundry IQ retrieval client (stub).

Production: calls Azure AI Search via the Foundry IQ surface to retrieve
relevant chunks from the knowledge base (competitor URLs, bootstrap playbooks).

Current state: returns mock context from local knowledge/ directory. Swap in
the real Azure AI Search SDK when the index is provisioned.
"""
from __future__ import annotations

import html
import ipaddress
import re
import socket
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse


KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge"


def retrieve(query: str, top_k: int = 3, source_filter: Optional[str] = None) -> List[dict]:
    """Retrieve relevant chunks for a query.

    Returns a list of dicts: [{content, source, score}, ...]
    """
    # In live mode, this would call:
    #   from azure.search.documents import SearchClient
    #   results = search_client.search(query, top=top_k, ...)
    #
    # For now, scan local knowledge/ files and do a naive keyword match.
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
            "User-Agent": "Mozilla/5.0 (compatible; DungeonOrgDesigner/1.0)",
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


def scrape_company(url: str, max_bytes: int = 400_000, timeout: float = 6.0) -> Optional[dict]:
    """Scrape a public company homepage into structured signal.

    Returns a dict with the strongest signals a reasoning agent can use to
    understand the business - title, meta/OpenGraph description, the on-page
    headings (what the company chooses to say first), call-to-action labels,
    and a trimmed body. Returns None on any fetch failure so callers can fall
    back to a domain-only brief. SSRF-guarded via `_fetch_html`.
    """
    html_doc = _fetch_html(url, max_bytes=max_bytes, timeout=timeout)
    if not html_doc:
        return None

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
    }


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


