"""Smoke test for the Microsoft Agent Framework standup loop.

Default mode is offline-safe: it exercises `run_maf_group_chat(...,
simulation=True)` so a fresh clone without Azure credentials or MAF installed
still proves the response contract used by `/api/world/standup`.

Use `--live` from a configured environment to require real MAF turns.
"""
from __future__ import annotations

import argparse
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
        "speaker": "Strategist",
        "role": "strategist",
        "worker_id": "strategist",
        "tool_call": {"tool": "calculate_consequence", "status": "completed"},
        "message": "I will turn the CEO call into a sharper market constraint for the next room.",
        "handoff_to": "Designer",
    },
    {
        "speaker": "Designer",
        "role": "designer",
        "worker_id": "designer",
        "tool_call": {"tool": "read_memory", "status": "completed"},
        "message": "I will make the tradeoff visible in the next artifact instead of hiding it in copy.",
        "handoff_to": "Marketer",
    },
    {
        "speaker": "Runway Steward",
        "role": "ops",
        "worker_id": "runway_steward",
        "tool_call": {"tool": "watch_burn", "status": "completed"},
        "message": "I am tracking whether the added autonomy earns back its burn.",
        "handoff_to": "founder",
    },
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def check_turns(turns: list[dict], *, require_live: bool) -> None:
    require(len(turns) == len(PARTICIPANTS), f"expected {len(PARTICIPANTS)} turns, got {len(turns)}")
    for i, turn in enumerate(turns, start=1):
        require(turn.get("speaker"), f"turn {i} missing speaker")
        require(turn.get("role"), f"turn {i} missing role")
        require(turn.get("message"), f"turn {i} missing message")
        profile = turn.get("speaker_profile") or {}
        require(profile.get("display_name"), f"turn {i} missing speaker profile display name")
        require(profile.get("role_label"), f"turn {i} missing speaker profile role label")
        require(profile.get("portrait_url"), f"turn {i} missing speaker profile portrait")
        char_state = turn.get("character_state") or {}
        require(char_state.get("worker_id"), f"turn {i} missing character_state worker_id")
        require(char_state.get("display_name"), f"turn {i} missing character_state display name")
        require(char_state.get("status"), f"turn {i} missing character_state status")
        require(isinstance(char_state.get("tool_calls"), list), f"turn {i} missing character_state tool calls")
        require((turn.get("tool_call") or {}).get("status") == "completed", f"turn {i} tool not completed")
        if require_live:
            require(turn.get("source") == "maf", f"turn {i} did not run through MAF: {turn}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test MAF standup turns.")
    parser.add_argument("--live", action="store_true", help="Require live MAF/Foundry turns instead of simulation.")
    args = parser.parse_args()

    if args.live:
        live_ready, api_key, base_url = live_settings()
        require(live_ready, "DEMO_MODE=live and FOUNDRY_BASE_URL are required for --live")
        require(maf_available(), "agent-framework is not importable")
        turns = run_maf_group_chat(
            api_key=api_key,
            base_url=base_url,
            company_name="SmokeWorld",
            pitch="A budgeting app that turns bank transactions into weekly money coaching tips",
            stage_title="Choose the first proof point",
            option="Optimize for trust before speed",
            consequence_summary="Proof rises, velocity slows, and burn pressure increases slightly.",
            participants=PARTICIPANTS,
        )
        check_turns(turns, require_live=True)
        print("LIVE MAF STANDUP GREEN")
        return 0

    turns = run_maf_group_chat(
        api_key=os.getenv("FOUNDRY_API_KEY", ""),
        base_url=os.getenv("FOUNDRY_BASE_URL", ""),
        company_name="SmokeWorld",
        pitch="A budgeting app that turns bank transactions into weekly money coaching tips",
        stage_title="Choose the first proof point",
        option="Optimize for trust before speed",
        consequence_summary="Proof rises, velocity slows, and burn pressure increases slightly.",
        participants=PARTICIPANTS,
        simulation=True,
    )
    check_turns(turns, require_live=False)
    second_round = run_maf_group_chat(
        api_key=os.getenv("FOUNDRY_API_KEY", ""),
        base_url=os.getenv("FOUNDRY_BASE_URL", ""),
        company_name="SmokeWorld",
        pitch="A budgeting app that turns bank transactions into weekly money coaching tips",
        stage_title="Choose the first proof point",
        option="CEO asks the team to debate trust versus speed",
        consequence_summary="The next round must react to history instead of restarting.",
        participants=PARTICIPANTS,
        history=[
            {"speaker": turn["speaker"], "role": turn["role"], "message": turn["message"]}
            for turn in turns
        ] + [{"speaker": "CEO", "role": "founder", "message": "Push back on each other before we decide."}],
        simulation=True,
    )
    check_turns(second_round, require_live=False)
    print("SIMULATION MAF STANDUP CONTRACT GREEN")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL: {exc}")
        raise SystemExit(1)
