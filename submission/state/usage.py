"""Lightweight, privacy-respecting usage analytics for the game server.

The app ships with no third-party analytics, so this is the single, forkable
seam that answers "how many people used the game, and what did they do?" It
counts a small set of *meaningful product actions* (a page open, a run started,
a world generated, a stage executed, a decision made) and an approximate count
of distinct visitors - while polling noise (e.g. the econ-clock `/api/state`
loop) and static-asset hits are deliberately ignored so the numbers stay honest.

Privacy: behind a reverse proxy the real client IP arrives in the
`X-Forwarded-For` header. We never store it - we keep only a salted SHA-256
*hash* so the same browser can be de-duplicated into a visitor count without
retaining any PII. The salt defaults to a fixed constant (obfuscation, not
security) and can be overridden with `CAMPAIGN_USAGE_SALT`.

Durability: like the rest of the app's state, the default ledger lives on
ephemeral container storage and resets on restart/redeploy. Point
`CAMPAIGN_USAGE_FILE` at a mounted volume for counts that survive restarts.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

# Single source of truth: map (METHOD, PATH) -> a human-meaningful action label.
# Only these routes count as "usage"; everything else (polling, static assets,
# status probes) is ignored so the totals describe real player behavior.
ACTION_BY_ROUTE: Dict[Tuple[str, str], str] = {
    ("GET", "/"): "page_open",
    ("GET", "/story"): "page_open",
    ("POST", "/api/founder/analyze"): "run_started",
    ("POST", "/api/company/analyze"): "run_started",
    ("POST", "/api/init"): "run_started",
    ("POST", "/api/world/design"): "world_generated",
    ("POST", "/api/world/autoplay"): "autoplay_run",
    ("POST", "/api/world/run-next"): "stage_executed",
    ("POST", "/api/dilemma"): "dilemma_resolved",
    ("POST", "/api/decision"): "decision_made",
    ("POST", "/api/game/reward/claim"): "reward_claimed",
    ("POST", "/api/world/standup/respond"): "standup_reply",
}

# Keep daily visitor sets bounded so the ledger can't grow without limit.
_MAX_DAILY_BUCKETS = 60
_MAX_VISITOR_HASHES = 50000


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def visitor_hash(client_ip: str, user_agent: str = "", salt: Optional[str] = None) -> str:
    """Return a salted, truncated hash of a client identity (never the raw IP).

    Empty input yields an empty string so anonymous/unidentifiable requests are
    simply not counted toward distinct visitors.
    """
    ip = (client_ip or "").strip()
    if not ip:
        return ""
    salt = salt if salt is not None else os.environ.get("CAMPAIGN_USAGE_SALT", "worldforge-usage-v1")
    digest = hashlib.sha256(f"{salt}|{ip}|{(user_agent or '').strip()}".encode("utf-8")).hexdigest()
    return digest[:16]


def client_ip_from_headers(forwarded_for: str, fallback: str = "") -> str:
    """Extract the originating client IP from an X-Forwarded-For chain.

    Container Apps / most proxies prepend the real client IP as the first entry.
    Falls back to the direct peer when no forwarded header is present.
    """
    xff = (forwarded_for or "").strip()
    if xff:
        return xff.split(",")[0].strip()
    return (fallback or "").strip()


class UsageStore:
    """Thread-safe, file-backed counter of meaningful product actions + visitors.

    The in-memory model is intentionally tiny:
      - totals:        {action_label: count} over all time
      - daily:         {date: {action_label: count}}
      - visitors:      all-time set of visitor hashes (distinct-people estimate)
      - daily_visitors:{date: set(visitor_hash)} for a daily-active estimate

    Writes are debounced: the ledger is only persisted when something actually
    changed (a tracked action, or a newly-seen visitor), so the high-frequency
    `/api/state` poll from an already-seen browser costs nothing on disk.
    """

    def __init__(self, filepath: str):
        self.filepath = filepath
        self._lock = threading.RLock()
        self.totals: Dict[str, int] = {}
        self.daily: Dict[str, Dict[str, int]] = {}
        self.visitors: set[str] = set()
        self.daily_visitors: Dict[str, set[str]] = {}
        self.first_seen: Optional[str] = None
        self.last_seen: Optional[str] = None
        self._load()

    # --- persistence --------------------------------------------------------
    def _load(self) -> None:
        if not self.filepath or not os.path.exists(self.filepath):
            return
        try:
            with open(self.filepath, "r") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return
        self.totals = {str(k): int(v) for k, v in (data.get("totals") or {}).items()}
        self.daily = {
            str(day): {str(k): int(v) for k, v in (counts or {}).items()}
            for day, counts in (data.get("daily") or {}).items()
        }
        self.visitors = set(data.get("visitors") or [])
        self.daily_visitors = {
            str(day): set(hashes or []) for day, hashes in (data.get("daily_visitors") or {}).items()
        }
        self.first_seen = data.get("first_seen")
        self.last_seen = data.get("last_seen")

    def _atomic_write(self, payload: Dict[str, Any]) -> None:
        dirpath = os.path.dirname(os.path.abspath(self.filepath))
        os.makedirs(dirpath, exist_ok=True)
        fd, temp_path = tempfile.mkstemp(dir=dirpath, prefix="usage_", suffix=".json.tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(payload, f, indent=2)
            os.replace(temp_path, self.filepath)
        except Exception:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
            raise

    def _save(self) -> None:
        if not self.filepath:
            return
        payload = {
            "totals": self.totals,
            "daily": self.daily,
            "visitors": sorted(self.visitors),
            "daily_visitors": {day: sorted(h) for day, h in self.daily_visitors.items()},
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
        }
        self._atomic_write(payload)

    # --- recording ----------------------------------------------------------
    def _prune(self) -> None:
        """Bound memory: keep only the most recent daily buckets and cap the
        all-time visitor set (drops oldest-insertion-order entries first)."""
        if len(self.daily) > _MAX_DAILY_BUCKETS:
            for day in sorted(self.daily)[:-_MAX_DAILY_BUCKETS]:
                self.daily.pop(day, None)
        if len(self.daily_visitors) > _MAX_DAILY_BUCKETS:
            for day in sorted(self.daily_visitors)[:-_MAX_DAILY_BUCKETS]:
                self.daily_visitors.pop(day, None)
        if len(self.visitors) > _MAX_VISITOR_HASHES:
            # Sets are unordered; trim deterministically by sorted order.
            keep = set(sorted(self.visitors)[-_MAX_VISITOR_HASHES:])
            self.visitors = keep

    def record(self, method: str, path: str, client_hash: str = "") -> bool:
        """Record one request. Returns True when the ledger changed (and was
        persisted). Untracked paths with an already-seen visitor are a no-op."""
        action = ACTION_BY_ROUTE.get((method.upper(), path))
        if not action and not client_hash:
            return False
        with self._lock:
            changed = False
            now = datetime.now(timezone.utc).isoformat()
            day = _today()

            if client_hash:
                if client_hash not in self.visitors:
                    self.visitors.add(client_hash)
                    changed = True
                seen_today = self.daily_visitors.setdefault(day, set())
                if client_hash not in seen_today:
                    seen_today.add(client_hash)
                    changed = True

            if action:
                self.totals[action] = self.totals.get(action, 0) + 1
                self.daily.setdefault(day, {})
                self.daily[day][action] = self.daily[day].get(action, 0) + 1
                changed = True

            if changed:
                self.first_seen = self.first_seen or now
                self.last_seen = now
                self._prune()
                try:
                    self._save()
                except OSError:
                    pass  # analytics must never break a request
            return changed

    # --- reporting ----------------------------------------------------------
    def snapshot(self) -> Dict[str, Any]:
        """Aggregated, JSON-serializable view for the /api/usage endpoint."""
        with self._lock:
            daily_actions = {
                day: dict(counts) for day, counts in sorted(self.daily.items())
            }
            daily_active = {
                day: len(hashes) for day, hashes in sorted(self.daily_visitors.items())
            }
            return {
                "distinct_visitors": len(self.visitors),
                "totals": dict(sorted(self.totals.items())),
                "page_opens": self.totals.get("page_open", 0),
                "runs_started": self.totals.get("run_started", 0),
                "worlds_generated": self.totals.get("world_generated", 0),
                "daily_actions": daily_actions,
                "daily_active_visitors": daily_active,
                "first_seen": self.first_seen,
                "last_seen": self.last_seen,
                "note": (
                    "Distinct visitors are approximate (salted-hash of client IP; "
                    "no raw IP stored). Counts reset on container restart unless "
                    "CAMPAIGN_USAGE_FILE points at durable storage."
                ),
            }
