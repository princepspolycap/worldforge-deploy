"""Foundry IQ retrieval client (stub).

Production: calls Azure AI Search via the Foundry IQ surface to retrieve
relevant chunks from the knowledge base (competitor URLs, bootstrap playbooks).

Current state: returns mock context from local knowledge/ directory. Swap in
the real Azure AI Search SDK when the index is provisioned.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional


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


def ingest_url(url: str) -> Optional[str]:
    """Fetch and chunk a public URL for context injection.

    Stub: returns None. In production, uses httpx + readability + chunking,
    then optionally indexes into Azure AI Search.
    """
    # TODO: implement with httpx + readability or Foundry IQ indexing pipeline.
    return None
