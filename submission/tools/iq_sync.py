"""Foundry IQ knowledge sync: structure submission/knowledge/ into the Azure AI
Search index that backs the Foundry IQ knowledge base.

Why this exists
---------------
Foundry IQ knowledge bases are backed by Azure AI Search: a knowledge base
orchestrates agentic retrieval over a knowledge SOURCE (a Search index, blob,
SharePoint, ...). You do not POST documents to the KB directly - you populate
the Search index it reads. This tool is the single source of truth for "what
curated knowledge Foundry serves": it chunks the markdown playbooks into stable,
structured records and (optionally) pushes them to that index.

Degradation law (same as retrieval.py / memory.py):
    AZURE_SEARCH_ENDPOINT + index configured + --push  -> upload to Azure AI Search
    otherwise (default)                                -> dry run: write a local
        manifest at submission/knowledge/_index/manifest.json so the exact
        structure is inspectable, diffable, and testable without any Azure.

The retrieval side (agents/retrieval.py) already reads the live IQ KB first and
falls back to scanning submission/knowledge/ locally - so a keyless clone keeps
working whether or not this sync has run.

Usage
-----
    # Dry run (default): structure the corpus, write the local manifest.
    python3 submission/tools/iq_sync.py

    # Create/refresh the Search index schema, then upload (needs Azure config).
    python3 submission/tools/iq_sync.py --push --create-index

Env (only needed for --push):
    AZURE_SEARCH_ENDPOINT   https://<service>.search.windows.net
    AZURE_SEARCH_INDEX      index name the IQ knowledge source points at
    AZURE_SEARCH_API_KEY    optional; admin key. Blank -> AAD (DefaultAzureCredential)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

SUBMISSION_DIR = Path(__file__).resolve().parent.parent
if str(SUBMISSION_DIR) not in sys.path:
    sys.path.append(str(SUBMISSION_DIR))

from state.schema import CompanyState, SearchDocument

KNOWLEDGE_DIR = SUBMISSION_DIR / "knowledge"
MANIFEST_PATH = KNOWLEDGE_DIR / "_index" / "manifest.json"
DEFAULT_STATE_FILE = SUBMISSION_DIR / "state" / "state.json"
SEARCH_API_VERSION = "2025-11-01-preview"

# Stage IDs the World Designer uses; tagging chunks that mention them lets
# per-stage retrieval (brief + stage.goal) bias toward the right beat.
STAGE_IDS = (
    "stage_1_you", "stage_2_need", "stage_3_go", "stage_4_search",
    "stage_5_find", "stage_6_take", "stage_7_return", "stage_8_change",
)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "doc"


def _chunk_markdown(text: str) -> List[Dict[str, str]]:
    """Split a doc into chunks at H2 (## ) boundaries. The intro before the
    first H2 becomes its own chunk so the lede is retrievable."""
    lines = text.splitlines()
    chunks: List[Dict[str, str]] = []
    title = ""
    buf: List[str] = []

    def flush(heading: str) -> None:
        body = "\n".join(buf).strip()
        if body:
            chunks.append({"heading": heading, "body": body})

    for line in lines:
        if line.startswith("# ") and not title:
            title = line[2:].strip()
        if line.startswith("## "):
            flush(title if not chunks else (chunks[-1]["heading"]))
            buf = [line]
        else:
            buf.append(line)
    flush(title)
    # Normalize: first chunk heading is the doc title; later ones their H2.
    for c in chunks:
        m = re.match(r"^##\s+(.*)$", c["body"].splitlines()[0]) if c["body"] else None
        if m:
            c["heading"] = m.group(1).strip()
    return chunks or [{"heading": title, "body": text.strip()}]


def build_records() -> List[Dict[str, Any]]:
    """Structure every knowledge markdown file into stable Search documents."""
    records: List[SearchDocument] = []
    if not KNOWLEDGE_DIR.exists():
        return []
    for fpath in sorted(KNOWLEDGE_DIR.glob("**/*.md")):
        if "_index" in fpath.parts:
            continue
        rel = str(fpath.relative_to(KNOWLEDGE_DIR))
        text = fpath.read_text(errors="ignore")
        for i, chunk in enumerate(_chunk_markdown(text)):
            content = chunk["body"].strip()
            if not content:
                continue
            # Stable id: same file+chunk always maps to the same doc id, so a
            # re-sync is mergeOrUpload (idempotent), never a duplicate.
            raw_id = f"{rel}#{i}"
            doc_id = _slug(fpath.stem) + "-" + hashlib.sha1(raw_id.encode()).hexdigest()[:10]
            tags = sorted({w for w in re.split(r"[^a-z0-9]+", fpath.stem.lower()) if len(w) > 2})
            tags += [s for s in STAGE_IDS if s in content]
            records.append(SearchDocument(
                id=doc_id,
                title=(chunk["heading"] or fpath.stem).strip(),
                content=content[:8000],
                source=rel,
                kind="playbook",
                tags=sorted(set(tags)),
                metadata={"file": rel, "chunk": i},
            ))
    return [r.model_dump() for r in records]


def build_state_records(state_file: Path) -> List[Dict[str, Any]]:
    """Load generated run knowledge already stored by the game server.

    These records are optional because they are session-specific. They are what
    turns a scraped founder profile, designed workers, stages, and CEO choices
    into the same Search-document shape as static playbooks.
    """
    if not state_file.exists():
        return []
    try:
        state = CompanyState(**json.loads(state_file.read_text()))
    except Exception as exc:
        print(f"Skipping state records from {state_file}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return []
    return [doc.model_dump() for doc in state.knowledge_records]


def write_manifest(records: List[Dict[str, Any]]) -> Path:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(
        {"api_version": SEARCH_API_VERSION, "count": len(records), "records": records},
        indent=2, ensure_ascii=False) + "\n")
    return MANIFEST_PATH


# ---- Azure AI Search push (the real Foundry IQ backing store) --------------

def _search_config() -> Dict[str, str]:
    return {
        "endpoint": os.getenv("AZURE_SEARCH_ENDPOINT", "").strip().rstrip("/"),
        "index": os.getenv("AZURE_SEARCH_INDEX", "").strip(),
        "key": os.getenv("AZURE_SEARCH_API_KEY", "").strip(),
    }


def _search_headers(cfg: Dict[str, str]) -> Dict[str, str]:
    if cfg["key"]:
        return {"api-key": cfg["key"], "Content-Type": "application/json"}
    from azure.identity import DefaultAzureCredential
    token = DefaultAzureCredential(exclude_interactive_browser_credential=False) \
        .get_token("https://search.azure.com/.default").token
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _index_schema(name: str) -> Dict[str, Any]:
    """Minimal schema a Foundry IQ knowledge source can read: a key, the
    searchable content/title, and filterable source/kind/tags facets."""
    return {
        "name": name,
        "fields": [
            {"name": "id", "type": "Edm.String", "key": True, "filterable": True},
            {"name": "title", "type": "Edm.String", "searchable": True},
            {"name": "content", "type": "Edm.String", "searchable": True},
            {"name": "source", "type": "Edm.String", "filterable": True, "facetable": True},
            {"name": "kind", "type": "Edm.String", "filterable": True, "facetable": True},
            {"name": "tags", "type": "Collection(Edm.String)", "filterable": True, "facetable": True},
        ],
    }


def create_index(cfg: Dict[str, str]) -> None:
    import httpx
    url = f"{cfg['endpoint']}/indexes/{cfg['index']}"
    resp = httpx.put(url, params={"api-version": SEARCH_API_VERSION},
                     headers=_search_headers(cfg), json=_index_schema(cfg["index"]),
                     timeout=20.0)
    resp.raise_for_status()


def push_records(cfg: Dict[str, str], records: List[Dict[str, Any]]) -> int:
    """Upload records to the Search index in mergeOrUpload batches of 100."""
    import httpx
    url = f"{cfg['endpoint']}/indexes/{cfg['index']}/docs/index"
    headers = _search_headers(cfg)
    upload_fields = {"id", "title", "content", "source", "kind", "tags"}
    pushed = 0
    for start in range(0, len(records), 100):
        batch = records[start:start + 100]
        body = {"value": [
            {"@search.action": "mergeOrUpload", **{k: v for k, v in r.items() if k in upload_fields}}
            for r in batch
        ]}
        resp = httpx.post(url, params={"api-version": SEARCH_API_VERSION},
                          headers=headers, json=body, timeout=30.0)
        resp.raise_for_status()
        pushed += len(batch)
    return pushed


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync submission/knowledge/ to the Foundry IQ Search index.")
    parser.add_argument("--push", action="store_true", help="Upload to Azure AI Search (needs AZURE_SEARCH_* env).")
    parser.add_argument("--create-index", action="store_true", help="Create/refresh the index schema before upload.")
    parser.add_argument("--include-state", action="store_true",
                        help="Also include generated Search documents from submission/state/state.json.")
    parser.add_argument("--state-file", default=str(DEFAULT_STATE_FILE),
                        help="State file to read when --include-state is set.")
    args = parser.parse_args()

    records = build_records()
    if args.include_state:
        state_records = build_state_records(Path(args.state_file))
        existing = {r["id"] for r in records}
        records.extend(r for r in state_records if r["id"] not in existing)
    manifest = write_manifest(records)
    sources = sorted({r["source"] for r in records})
    print(f"Structured {len(records)} chunk(s) from {len(sources)} file(s):")
    for s in sources:
        n = sum(1 for r in records if r["source"] == s)
        print(f"  - {s} ({n} chunk{'s' if n != 1 else ''})")
    print(f"Manifest: {manifest.relative_to(KNOWLEDGE_DIR.parent)}")

    if not args.push:
        print("\nDry run (default). Re-run with --push and AZURE_SEARCH_* set to upload to Foundry IQ.")
        return 0

    cfg = _search_config()
    if not cfg["endpoint"] or not cfg["index"]:
        print("\n--push needs AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_INDEX. Not set; stayed in dry run.",
              file=sys.stderr)
        return 2
    try:
        if args.create_index:
            create_index(cfg)
            print(f"Index '{cfg['index']}' schema created/refreshed.")
        pushed = push_records(cfg, records)
        print(f"Pushed {pushed} document(s) to {cfg['endpoint']}/indexes/{cfg['index']}.")
        print("Foundry IQ will serve these once the knowledge source points at this index.")
    except Exception as e:  # network / auth / schema mismatch
        print(f"\nPush failed: {type(e).__name__}: {e}", file=sys.stderr)
        print("The local manifest is still written; retrieval falls back to the local scan.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
