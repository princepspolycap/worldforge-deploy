"""URL-keyed profile cache: reuse an analyzed profile instead of re-scraping.

Players don't log in, so there is no account to key reuse on - but the public
profile/mission URL they paste IS a stable natural key. Scraping a page, running
public-web OSINT, and reasoning about the profile is the most expensive hop in
the whole run (live HTTP + a web_search + a Foundry call). Doing it again for a
URL we already analyzed is pure waste of latency and tokens.

This is a small, local-first cache: a JSON ledger at submission/state/
profile_cache.json (gitignored by `submission/state/*.json`), keyed by a
normalized URL, with a TTL so a profile eventually refreshes. Same degradation
law as the rest of the repo - no external service, works after a fresh clone.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse

# Local ledger path. CAMPAIGN_PROFILE_CACHE_FILE isolates a second server's
# session (simulation test bench) from the live demo's cache - same reasoning
# as CAMPAIGN_MEMORY_FILE / CAMPAIGN_STATE_FILE elsewhere in the repo.
CACHE_FILE = Path(os.environ.get("CAMPAIGN_PROFILE_CACHE_FILE")
                  or os.environ.get("DUNGEON_PROFILE_CACHE_FILE")
                  or Path(__file__).resolve().parent / "profile_cache.json")

# A profile older than this is treated as a miss and re-analyzed. Public
# profiles change slowly, so a generous default keeps the demo cheap.
TTL_SECONDS = int(float(os.environ.get("PROFILE_CACHE_TTL_DAYS", "30")) * 86400)

_LOCK = threading.Lock()


def _cache_key(url: str) -> str:
    """Normalize a URL to a stable key.

    Folds scheme, case, trailing slashes, query and fragment so that
    `linkedin.com/in/foo`, `https://www.linkedin.com/in/foo/` and
    `.../foo?utm=x` all resolve to one cached profile.
    """
    raw = (url or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = "https://" + raw
    parsed = urlparse(raw)
    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    path = (parsed.path or "").rstrip("/").lower()
    return f"{host}{path}" if host else path


def _load() -> Dict[str, Any]:
    try:
        return json.loads(CACHE_FILE.read_text())
    except Exception:
        return {}


def get(url: str) -> Optional[Dict[str, Any]]:
    """Return a fresh cached profile for `url`, or None on miss/stale.

    The returned profile is flagged `cached=True` so callers (and the replay
    log) can show that the analysis was reused rather than recomputed.
    """
    key = _cache_key(url)
    if not key:
        return None
    with _LOCK:
        entry = _load().get(key)
    if not isinstance(entry, dict):
        return None
    if time.time() - float(entry.get("ts", 0)) > TTL_SECONDS:
        return None
    profile = entry.get("profile")
    if not isinstance(profile, dict):
        return None
    out = dict(profile)
    out["cached"] = True
    return out


def put(url: str, profile: Dict[str, Any]) -> None:
    """Store the analyzed `profile` under the normalized `url` key."""
    key = _cache_key(url)
    if not key or not isinstance(profile, dict):
        return
    record = dict(profile)
    record.pop("cached", None)
    with _LOCK:
        data = _load()
        data[key] = {"ts": time.time(), "profile": record}
        try:
            CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            CACHE_FILE.write_text(json.dumps(data, indent=2))
        except Exception:
            pass
