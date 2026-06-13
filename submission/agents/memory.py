"""Agent memory: what the workers learn from the player across a venture.

Memory is NOT Foundry IQ. IQ answers from stable, curated source knowledge
(the playbooks in submission/knowledge/). Memory holds what the agents learn
from the CEO during play: gate decisions and the operating patterns behind
them, the founder/company profile, and short summaries of shipped artifacts.
This mirrors the three memory kinds in Foundry Agent Service's memory preview:

  user_profile  - durable facts about the founder/company (pitch, name, stage)
  procedural    - operating patterns learned from CEO gate choices
                  ("prefers organic growth over paid", "accepts scope cuts")
  chat_summary  - compact summaries of completed chapters/artifacts

Preferred path: the Foundry Agent Service memory store on the project
endpoint (set FOUNDRY_PROJECT_ENDPOINT + FOUNDRY_MEMORY_STORE). Fallback: a
local JSON ledger at submission/state/memory.json, so a keyless clone keeps
the same learning loop. Entries carry an `origin` field (`foundry-memory` vs
`local-memory`) so the UI and replay log can show which store answered -
the same degradation law as every other subsystem in this repo.
"""
from __future__ import annotations

import json
import os
import time
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

# Local ledger path. CAMPAIGN_MEMORY_FILE isolates a second server's session
# (simulation test bench) from the live demo's ledger - same reasoning as
# CAMPAIGN_STATE_FILE in tools/server.py.
MEMORY_FILE = Path(os.environ.get("CAMPAIGN_MEMORY_FILE")
                   or os.environ.get("DUNGEON_MEMORY_FILE")
                   or Path(__file__).resolve().parent.parent / "state" / "memory.json")

_KINDS = ("user_profile", "procedural", "chat_summary")

# Cached availability of the Foundry memory store: None = untried,
# False = failed once (not provisioned / missing role) - skip for process life.
_FOUNDRY_MEM_AVAILABLE: Optional[bool] = None


def _store_config() -> Optional[Dict[str, str]]:
    endpoint = os.getenv("FOUNDRY_PROJECT_ENDPOINT", "").strip().rstrip("/")
    store = os.getenv("FOUNDRY_MEMORY_STORE", "").strip()
    if not endpoint or not store:
        return None
    return {"endpoint": endpoint, "store": store}


def _foundry_headers() -> Dict[str, str]:
    from azure.identity import DefaultAzureCredential
    token = DefaultAzureCredential(exclude_interactive_browser_credential=False) \
        .get_token("https://ai.azure.com/.default").token
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _foundry_add(kind: str, text: str, payload: Optional[Dict[str, Any]]) -> bool:
    """Write one memory item to the Foundry Agent Service memory store."""
    global _FOUNDRY_MEM_AVAILABLE
    if _FOUNDRY_MEM_AVAILABLE is False:
        return False
    cfg = _store_config()
    if not cfg:
        return False
    try:
        import httpx
        resp = httpx.post(
            f"{cfg['endpoint']}/memoryStores/{cfg['store']}/memories",
            params={"api-version": "2025-11-15-preview"},
            headers=_foundry_headers(),
            json={"kind": kind, "content": text, "metadata": payload or {}},
            timeout=8.0,
        )
        resp.raise_for_status()
        _FOUNDRY_MEM_AVAILABLE = True
        return True
    except Exception:
        _FOUNDRY_MEM_AVAILABLE = False
        return False


def _foundry_search(query: str, limit: int) -> Optional[List[Dict[str, Any]]]:
    """Search the Foundry memory store. None on any failure -> local fallback."""
    global _FOUNDRY_MEM_AVAILABLE
    if _FOUNDRY_MEM_AVAILABLE is False:
        return None
    cfg = _store_config()
    if not cfg:
        return None
    try:
        import httpx
        resp = httpx.post(
            f"{cfg['endpoint']}/memoryStores/{cfg['store']}/memories:search",
            params={"api-version": "2025-11-15-preview"},
            headers=_foundry_headers(),
            json={"query": query, "top": limit},
            timeout=8.0,
        )
        resp.raise_for_status()
        data = resp.json()
        items: List[Dict[str, Any]] = []
        for item in (data.get("memories") or data.get("results") or [])[:limit]:
            items.append({
                "kind": str(item.get("kind") or "procedural"),
                "text": str(item.get("content") or item.get("text") or "")[:400],
                "payload": item.get("metadata") or {},
                "ts": float(item.get("createdAt") or 0) if isinstance(item.get("createdAt"), (int, float)) else 0.0,
                "origin": "foundry-memory",
            })
        if items:
            _FOUNDRY_MEM_AVAILABLE = True
            return items
        return None
    except Exception:
        _FOUNDRY_MEM_AVAILABLE = False
        return None


# ---------------------------------------------------------------------------
# Local ledger (always written, even when Foundry accepts the item, so the
# replay/UI can read memory without a network hop).
# ---------------------------------------------------------------------------

_lock = threading.RLock()


def _load_local() -> List[Dict[str, Any]]:
    with _lock:
        if not MEMORY_FILE.exists():
            return []
        try:
            data = json.loads(MEMORY_FILE.read_text())
            return data if isinstance(data, list) else []
        except Exception:
            return []


def _save_local(items: List[Dict[str, Any]]) -> None:
    with _lock:
        try:
            MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
            MEMORY_FILE.write_text(json.dumps(items[-200:], indent=1))
        except Exception:
            pass  # memory must never break the game loop


def remember(kind: str, text: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Store one memory item. Returns the stored entry (with origin).

    Dedupes on (kind, text) so replays/idempotent endpoints don't pile up.
    """
    if kind not in _KINDS:
        kind = "procedural"
    text = (text or "").strip()[:400]
    if not text:
        return {}
    sent = _foundry_add(kind, text, payload)
    entry = {
        "kind": kind,
        "text": text,
        "payload": payload or {},
        "ts": time.time(),
        "origin": "foundry-memory" if sent else "local-memory",
    }
    with _lock:
        items = [m for m in _load_local() if not (m.get("kind") == kind and m.get("text") == text)]
        items.append(entry)
        _save_local(items)
    return entry


def recall_memories(query: str = "", limit: int = 4) -> List[Dict[str, Any]]:
    """Recall the most relevant memory items for a worker brief.

    Foundry memory store first (semantic), local ledger fallback (recency +
    naive keyword overlap). Always includes the latest procedural memory if
    one exists - the CEO's operating pattern is binding direction.
    """
    foundry = _foundry_search(query, limit) if query else None
    if foundry:
        return foundry

    with _lock:
        items = _load_local()
        if not items:
            return []

        kws = set((query or "").lower().split())

        def score(m: Dict[str, Any]) -> float:
            overlap = sum(1 for k in kws if k in str(m.get("text", "")).lower()) if kws else 0
            return overlap * 10 + float(m.get("ts") or 0) / 1e10

        ranked = sorted(items, key=score, reverse=True)[:limit]
        # Binding rule: the newest procedural memory always rides along.
        procedural = [m for m in items if m.get("kind") == "procedural"]
        if procedural and procedural[-1] not in ranked:
            ranked = [procedural[-1]] + ranked[: max(limit - 1, 1)]
        return ranked


def memory_snapshot() -> Dict[str, Any]:
    """Everything the agents currently remember, grouped by kind (for the UI)."""
    with _lock:
        items = _load_local()
        grouped: Dict[str, List[Dict[str, Any]]] = {k: [] for k in _KINDS}
        for m in items:
            grouped.setdefault(m.get("kind", "procedural"), []).append(
                {"text": m.get("text", ""), "ts": m.get("ts", 0), "origin": m.get("origin", "local-memory")})
        cfg = _store_config()
        return {
            "store": "foundry-memory" if (cfg and _FOUNDRY_MEM_AVAILABLE) else "local-memory",
            "configured": bool(cfg),
            "counts": {k: len(v) for k, v in grouped.items()},
            "memories": grouped,
        }


def forget_all() -> None:
    """Reset the local ledger (new venture = new memory)."""
    with _lock:
        _save_local([])
