"""Toolbox: one catalog, every tool - the MCP shape, locally.

Toolboxes in Foundry (public preview) give an agent a single managed endpoint
that lists tools (`tools/list`) and executes them (`tools/call`), with auth,
lifecycle and governance handled by the platform. This module implements that
exact shape over the tools already in this repo, so:

  1. The game is diegetic TODAY: workers visibly *draw a tool from the
     toolbox* (recorded per invocation, rendered in the rail) instead of
     calling Python functions invisibly.
  2. When a real Foundry Toolbox URL is configured (TOOLBOX_URL in .env),
     `tools_list`/`tools_call` pass through to it over MCP, and the local
     registry becomes the fallback - same degradation law as every other
     subsystem in this repo.

Catalog entries mirror MCP tool descriptors: name, description, inputSchema.
"""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Any, Callable, Dict, List, Optional

from tools.code_interpreter_wrappers import (
    validate_financial_plan,
    validate_landing_page,
    validate_marketing_email,
    validate_org_chart,
    validate_positioning,
)

TOOLBOX_URL = os.getenv("TOOLBOX_URL", "").strip()
TOOLBOX_API_KEY = os.getenv("TOOLBOX_API_KEY", "").strip()


# ---------------------------------------------------------------------------
# Local registry - every tool the workers can draw. The `runner` is the local
# implementation; descriptors are MCP-shaped so the same catalog can register
# against a real Foundry Toolbox unchanged.
# ---------------------------------------------------------------------------

def _validator_runner(fn: Callable) -> Callable[[Dict[str, Any]], Dict[str, Any]]:
    def run(arguments: Dict[str, Any]) -> Dict[str, Any]:
        success, results = fn(arguments.get("artifact") or {})
        return {"success": success, **results}
    return run


def _recall_runner(arguments: Dict[str, Any]) -> Dict[str, Any]:
    from agents.retrieval import retrieve
    hits = retrieve(arguments.get("query", ""), top_k=int(arguments.get("top_k", 2)))
    return {"hits": hits}


def _map_company_runner(arguments: Dict[str, Any]) -> Dict[str, Any]:
    from agents.retrieval import scrape_company
    profile = scrape_company(arguments.get("url", ""))
    return {"profile": profile or {}}


def _web_search_runner(arguments: Dict[str, Any]) -> Dict[str, Any]:
    from agents.retrieval import web_search
    results = web_search(arguments.get("query", ""), top_k=int(arguments.get("top_k", 5)))
    return {"results": results}


_REGISTRY: Dict[str, Dict[str, Any]] = {
    "validate_positioning": {
        "description": "Deterministically score a positioning/ICP artifact (code interpreter).",
        "inputSchema": {"type": "object", "properties": {"artifact": {"type": "object"}}, "required": ["artifact"]},
        "runner": _validator_runner(validate_positioning),
        "kind": "code_interpreter",
    },
    "validate_landing_page": {
        "description": "Deterministically score a landing-page artifact (code interpreter).",
        "inputSchema": {"type": "object", "properties": {"artifact": {"type": "object"}}, "required": ["artifact"]},
        "runner": _validator_runner(validate_landing_page),
        "kind": "code_interpreter",
    },
    "validate_marketing_email": {
        "description": "Deterministically score a marketing-email artifact (code interpreter).",
        "inputSchema": {"type": "object", "properties": {"artifact": {"type": "object"}}, "required": ["artifact"]},
        "runner": _validator_runner(validate_marketing_email),
        "kind": "code_interpreter",
    },
    "validate_org_chart": {
        "description": "Deterministically score an org-chart artifact (code interpreter).",
        "inputSchema": {"type": "object", "properties": {"artifact": {"type": "object"}}, "required": ["artifact"]},
        "runner": _validator_runner(validate_org_chart),
        "kind": "code_interpreter",
    },
    "validate_financial_plan": {
        "description": "Deterministically score a financial-plan artifact (code interpreter).",
        "inputSchema": {"type": "object", "properties": {"artifact": {"type": "object"}}, "required": ["artifact"]},
        "runner": _validator_runner(validate_financial_plan),
        "kind": "code_interpreter",
    },
    "recall": {
        "description": "Foundry IQ retrieval over the venture knowledge base; returns cited snippets.",
        "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "top_k": {"type": "integer"}}, "required": ["query"]},
        "runner": _recall_runner,
        "kind": "foundry_iq",
    },
    "map_company": {
        "description": "Crawl a public company URL and extract a venture profile (title, headings, CTAs).",
        "inputSchema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]},
        "runner": _map_company_runner,
        "kind": "web",
    },
    "web_search": {
        "description": "Live keyless web search (DuckDuckGo; Poly platform when configured). Returns titled results with snippets.",
        "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "top_k": {"type": "integer"}}, "required": ["query"]},
        "runner": _web_search_runner,
        "kind": "web",
    },
}

# Which tools each worker archetype draws for its stage. This is what makes
# the toolbox diegetic: the rail can show the worker reaching for exactly
# these, by name, before the artifact appears.
ROLE_TOOLS: Dict[str, List[str]] = {
    "strategist": ["recall", "web_search", "validate_org_chart", "validate_positioning"],
    "designer": ["recall", "validate_landing_page"],
    "marketer": ["recall", "web_search", "validate_financial_plan", "validate_marketing_email"],
    "ops": ["recall", "validate_financial_plan"],
}


def _remote_rpc(method: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Minimal MCP JSON-RPC call to a configured Foundry Toolbox. None on any failure."""
    if not TOOLBOX_URL:
        return None
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(TOOLBOX_URL, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if TOOLBOX_API_KEY:
        req.add_header("Authorization", f"Bearer {TOOLBOX_API_KEY}")
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode())
        return payload.get("result")
    except Exception:
        return None


def tools_list() -> Dict[str, Any]:
    """MCP tools/list: remote Foundry Toolbox first, local registry fallback."""
    remote = _remote_rpc("tools/list", {})
    if remote and remote.get("tools"):
        return {"source": "foundry_toolbox", "tools": remote["tools"]}
    return {
        "source": "local",
        "tools": [
            {"name": name, "description": entry["description"],
             "inputSchema": entry["inputSchema"], "kind": entry["kind"]}
            for name, entry in _REGISTRY.items()
        ],
    }


def tools_call(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """MCP tools/call: remote Foundry Toolbox first, local runner fallback."""
    remote = _remote_rpc("tools/call", {"name": name, "arguments": arguments})
    if remote is not None:
        return {"source": "foundry_toolbox", "result": remote}
    entry = _REGISTRY.get(name)
    if not entry:
        return {"source": "local", "error": f"unknown tool: {name}"}
    try:
        return {"source": "local", "result": entry["runner"](arguments)}
    except Exception as exc:  # noqa: BLE001
        return {"source": "local", "error": f"{type(exc).__name__}: {exc}"}


def tools_for_role(role: str) -> List[str]:
    """Tool names a worker archetype draws from the toolbox for its stage."""
    return ROLE_TOOLS.get(role, ["recall"])
