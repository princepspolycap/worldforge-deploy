"""Foundry hosted agent: the Campaign Narrator behind the `invocations` protocol.

Wraps the same MasterNarrator + lore reasoning the local game server uses, so
the narrator can be deployed to Microsoft Foundry's hosted-agent surface and
invoked by other agents or apps (agent-to-agent style interop). Foundry injects
identity + telemetry into the container; the agent itself stays stateless per
request apart from the SDK-managed session id.

Run locally:
    python submission/hosted_agent/main.py
    curl -X POST "http://localhost:8088/invocations?agent_session_id=s1" \
        -H "Content-Type: application/json" \
        -d '{"pitch": "A pixel-art landing page generator for coffee shops"}'

Offline-safe: with no Foundry credentials it returns the deterministic
simulation quest line, so a fresh `git clone` can still exercise the protocol.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse

from azure.ai.agentserver.invocations import InvocationAgentServerHost

# Make submission/ imports (agents/, state/) resolvable when run from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.foundry_agents import MasterNarrator, generate_lore  # noqa: E402
from agents.model_config import is_live  # noqa: E402

app = InvocationAgentServerHost()


@app.invoke_handler
async def handle_invoke(request: Request):
    """Decompose a business pitch into the quest line, with lore + reasoning."""
    try:
        body = await request.body()
        if not body:
            raise ValueError("empty body")
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {"pitch": body.decode("utf-8", errors="replace").strip()}
        if not isinstance(data, dict):
            raise ValueError("body is not a JSON object")
        pitch = (data.get("pitch") or data.get("message") or data.get("input") or "").strip()
        if not pitch:
            raise ValueError("missing pitch text")
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={
                "error": "invalid_request",
                "message": (
                    'Request body must be a JSON object with a non-empty "pitch" '
                    '(or "message") string, e.g. {"pitch": "An AI copilot for roasters"}'
                ),
            },
        )

    company = (data.get("company_name") or "").strip()

    narrator = MasterNarrator()
    steps = narrator.decompose_pitch(pitch)
    lore = generate_lore(pitch, company)
    reasoning = narrator.last_reasoning or {}

    return JSONResponse({
        "session_id": request.state.session_id,
        "invocation_id": request.state.invocation_id,
        "lore": lore.get("lore", ""),
        "steps": steps,
        "mode": "live" if is_live() else "simulation",
        "reasoning_tokens": int(reasoning.get("reasoning_tokens", 0) or 0),
        "reasoning_preview": reasoning.get("reasoning_preview", "") or "",
    })


if __name__ == "__main__":
    # Foundry sets PORT in hosted containers; default matches the local docs.
    os.environ.setdefault("PORT", "8088")
    app.run()
