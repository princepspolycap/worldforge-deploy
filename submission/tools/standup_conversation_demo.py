"""Print a short agent standup conversation with character-state receipts.

This is a terminal-first demo for the interaction model: each turn shows the
speaker, role, tool call, handoff, and the normalized `character_state` shape
that the UI can render as an active card. It runs offline in simulation mode by
default and can use live Microsoft Agent Framework turns with `--live`.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

SUBMISSION_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(SUBMISSION_DIR))

from agents.maf_runtime import maf_available, run_maf_group_chat  # noqa: E402


def live_settings() -> tuple[bool, str, str]:
    try:
        from agents.model_config import FOUNDRY_API_KEY, FOUNDRY_BASE_URL, is_live  # noqa: PLC0415
    except Exception:
        return False, "", ""
    return is_live(), FOUNDRY_API_KEY, FOUNDRY_BASE_URL


PARTICIPANTS = [
    {
        "speaker": "World Designer",
        "role": "narrator",
        "worker_id": "world_designer",
        "tool_call": {"tool": "render_world_canvas", "status": "completed"},
        "message": "CEO, the company is no longer a dashboard; it is a shared world where every decision changes the room.",
        "handoff_to": "Org Designer",
    },
    {
        "speaker": "Org Designer",
        "role": "orgdesigner",
        "worker_id": "org_designer",
        "tool_call": {"tool": "render_org_graph", "status": "completed"},
        "message": "World Designer, I need each worker card to own the meters it changes, or the world state stays abstract.",
        "handoff_to": "Strategist",
    },
    {
        "speaker": "Strategist",
        "role": "strategist",
        "worker_id": "strategist",
        "tool_call": {"tool": "read_memory", "status": "completed"},
        "message": "Org Designer, I challenge the team to make trust and proof visible before we chase speed.",
        "handoff_to": "Designer",
    },
    {
        "speaker": "Designer",
        "role": "designer",
        "worker_id": "designer",
        "tool_call": {"tool": "draw_card_dossier", "status": "completed"},
        "message": "Strategist, I can make the center stage an invisible canvas and let cards flip into receipts when the CEO inspects them.",
        "handoff_to": "Runway Steward",
    },
    {
        "speaker": "Runway Steward",
        "role": "ops",
        "worker_id": "runway_steward",
        "tool_call": {"tool": "watch_burn", "status": "completed"},
        "message": "Designer, I will back the magic only if burn and autonomy stay attached to the worker that caused them.",
        "handoff_to": "CEO",
    },
]


def print_turns(turns: list[dict], show_json: bool) -> None:
    for index, turn in enumerate(turns, start=1):
        tool = turn.get("tool_call") or {}
        state = turn.get("character_state") or {}
        print(f"\n[{index}] {turn.get('speaker')} ({turn.get('role')})")
        print(f"    state: {state.get('status', 'spoke')} -> {state.get('thought_state', '')}")
        print(f"    tool:  {tool.get('tool', 'agent_turn')} [{tool.get('status', 'completed')}]")
        print(f"    says:  {turn.get('message')}")
        if turn.get("handoff_to"):
            print(f"    handoff: {turn['handoff_to']}")
        if show_json:
            print("    character_state:")
            print("    " + json.dumps(state, indent=2).replace("\n", "\n    "))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a world-building agent standup demo.")
    parser.add_argument("--live", action="store_true", help="Use live MAF/Foundry turns when configured.")
    parser.add_argument("--json", action="store_true", help="Print the full character_state object for every turn.")
    args = parser.parse_args()

    live = args.live
    live_ready, api_key, base_url = live_settings() if live else (False, "", "")
    if live and (not live_ready or not maf_available()):
        print("Live MAF is not configured/importable; falling back to simulation.")
        live = False

    turns = run_maf_group_chat(
        api_key=api_key if live else os.getenv("FOUNDRY_API_KEY", ""),
        base_url=base_url if live else os.getenv("FOUNDRY_BASE_URL", ""),
        company_name="Microsoft Planetary Computer",
        pitch=(
            "A world-building management RPG where Foundry agents transform a mission into "
            "a greening campaign: diagrams, images, memory, tool calls, and CEO decisions all change state."
        ),
        chapter_title="Repurpose the middle scene as a world canvas",
        option="Make the agent cards own world state and flip into dossiers",
        consequence_summary=(
            "The scene becomes a game surface; worker cards carry state, tools, memory, and handoffs."
        ),
        participants=PARTICIPANTS,
        simulation=not live,
        history=[{"speaker": "CEO", "role": "founder", "message": "Debate the world canvas and card dossier model."}],
    )
    print("AGENT WORLD-BUILDING STANDUP")
    print(f"mode: {'live-maf' if live else 'simulation'}")
    print_turns(turns, args.json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())