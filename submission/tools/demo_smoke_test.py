"""End-to-end demo smoke test: exercise every live demo path over HTTP.

This drives the same API the browser UI calls, so a green run proves the
on-stage flows actually work - not just that the models respond. It covers the
three entry points a presenter can hit:

  1. Quest manual:  /api/init -> (execute -> approve) x3
  2. World autoplay: /api/world/autoplay (design + run all stages)

For each path it asserts the demo-critical invariants:
  - every step/stage ends 'completed'
  - every artifact is non-empty
  - every validation score is a real number (never None)
  - the run reaches its terminal stage (validated / launched)

Usage (server must already be running on the given base URL):
    ../.venv/bin/python tools/demo_smoke_test.py --base http://127.0.0.1:8050

Exit code 0 = all paths green. Non-zero = a demo path is broken; the failing
assertion is printed. Works against both live and simulation servers - in
simulation it proves the forkable fallback path; in live it proves Foundry.
Add --live against a DEMO_MODE=live server to additionally certify the
live-only evidence: real token counts, a named inference client, and
non-simulation deployments on every invocation.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request


class SmokeError(Exception):
    """Raised when a demo invariant fails."""


def _post(base: str, path: str, body: dict | None = None, timeout: int = 240) -> dict:
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(
        base + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _get(base: str, path: str, timeout: int = 30) -> dict:
    with urllib.request.urlopen(base + path, timeout=timeout) as resp:
        return json.loads(resp.read())


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeError(message)


def check_campaign_step_by_step_path(base: str, pitch: str) -> None:
    """Run the step-by-step Campaign path: analyze, design, run stages, dilemma, decision, standup."""
    print("\n[1/2] CAMPAIGN STEP-BY-STEP PATH")
    _post(base, "/api/reset")
    
    # 1. Analyze profile / pitch
    analyze_res = _post(base, "/api/founder/analyze", {"pitch": pitch, "company_name": "SmokeCo"})
    org = analyze_res.get("org") or {}
    _require(org.get("headcount", 0) > 0, "failed to design workforce org blueprint")
    antagonist = analyze_res.get("antagonist") or {}
    _require(bool(antagonist.get("name")), "analyze did not forge an antagonist (villain)")
    print(f"  workforce designed -> {org.get('headcount')} seat(s) created")
    print(f"  antagonist forged -> {antagonist.get('name')} ({antagonist.get('archetype')})")

    # 2. Design Campaign Graph
    design_res = _post(base, "/api/world/design", {"pitch": pitch, "company_name": "SmokeCo"})
    world = design_res.get("state", {}).get("world") or {}
    stages = world.get("stages") or []
    _require(len(stages) == 8, f"expected 8 campaign stages, got {len(stages)}")
    carried = (design_res.get("state") or {}).get("antagonist") or {}
    _require(bool(carried.get("name")), "antagonist was lost when carrying analyze -> world/design")
    print(f"  campaign graph constructed -> {len(stages)} Story Circle stages")

    # 3. Step through stages sequentially
    for idx, ch in enumerate(stages, start=1):
        ch_id = ch["id"]
        role = ch["owner_role"]
        
        # A. Execute Stage
        run_res = _post(base, "/api/world/run-next", timeout=900)
        run_ch = run_res.get("stage") or {}
        artifact = run_ch.get("artifact") or {}
        score = run_ch.get("validation_score")
        _require(bool(artifact), f"stage {idx} ({ch_id}) produced an empty artifact")
        _require(isinstance(score, (int, float)), f"stage {idx} ({ch_id}) score is {score!r}, not a number")
        print(f"  stage {idx}/8 {role:<11} score={score} keys={list(artifact)[:2]}")

        # B. Get dilemma
        dil_res = _post(base, "/api/dilemma", {"stage_id": ch_id})
        options = dil_res.get("options") or []
        _require(len(options) == 2, f"expected 2 options for dilemma, got {len(options)}")

        # C. Commit decision (auto-select option 1)
        selected_opt = options[0]
        dec_res = _post(base, "/api/decision", {
            "stage_id": ch_id,
            "option": selected_opt["option"],
            "tradeoff": selected_opt.get("tradeoff", ""),
            "prompt": dil_res.get("prompt", ""),
            "custom": False,
            "rule_id": selected_opt["rule_id"],
            "option_id": selected_opt["id"],
            "scene_id": dil_res.get("scene_id", "")
        })
        conseq = dec_res.get("consequence") or {}
        _require(bool(conseq.get("summary")), f"stage {idx} ({ch_id}) choice consequence summary is empty")

        # D. Get standup reaction
        standup_res = _post(base, "/api/world/standup", {"stage_id": ch_id}, timeout=600)
        turns = standup_res.get("turns") or []
        _require(len(turns) > 0, f"expected active standup turns for stage {idx}")

    # 4. Verify terminal state
    state = _get(base, "/api/state")["state"]
    _require(state["stage"] == "launched", f"campaign did not reach 'launched' (stage={state['stage']})")
    _require((state.get("world") or {}).get("status") == "completed", "world status not 'completed'")
    print(f"  OK -> stage=launched xp={state['xp']} level={state['level']}")


def check_world_path(base: str, pitch: str) -> None:
    """Run the full World autoplay (design + execute all stages)."""
    print("\n[2/2] WORLD AUTOPLAY PATH")
    _post(base, "/api/reset")
    t = time.time()
    # Live autoplay runs every stage in one request (5 x 35-120s of model
    # time). If the HTTP client gives up first, the server keeps executing -
    # fall back to polling /api/state until the world lands (or 25 min).
    try:
        out = _post(base, "/api/world/autoplay", {"pitch": pitch, "company_name": "SmokeWorld"}, timeout=900)
        state = out["state"]
    except Exception as exc:  # noqa: BLE001 - timeout/disconnect; server continues
        print(f"  autoplay request dropped ({exc}); polling state until the world completes...")
        deadline = time.time() + 1500
        state = {}
        while time.time() < deadline:
            time.sleep(15)
            state = _get(base, "/api/state")["state"]
            world = state.get("world") or {}
            stages = world.get("stages", [])
            done = sum(1 for c in stages if c.get("status") == "completed")
            print(f"  ... {done}/{len(stages) or '?'} stages completed")
            if stages and world.get("status") == "completed":
                break
        _require((state.get("world") or {}).get("status") == "completed",
                 "world did not complete before the polling deadline")
    dt = time.time() - t
    world = state.get("world") or {}
    stages = world.get("stages", [])
    _require(len(stages) >= 3, f"expected >=3 stages, got {len(stages)}")
    _require(bool((state.get("antagonist") or {}).get("name")), "autoplay did not forge an antagonist (villain)")

    for ch in stages:
        artifact = ch.get("artifact") or {}
        score = ch.get("validation_score")
        worker = ch.get("assigned_worker_title")
        _require(ch["status"] == "completed", f"stage {ch['id']} status={ch['status']} (not completed)")
        _require(bool(artifact), f"stage {ch['id']} produced an empty artifact")
        _require(isinstance(score, (int, float)), f"stage {ch['id']} score is {score!r}, not a number")
        _require(bool(worker), f"stage {ch['id']} has no assigned digital worker (org binding missing)")
        print(f"  {ch['id']:<18} {ch['owner_role']:<11} -> {worker:<22} score={score} keys={list(artifact)[:2]}")

    _require(world.get("status") == "completed", f"world status={world.get('status')} (not completed)")
    _require(state["stage"] == "launched", f"world did not reach 'launched' (stage={state['stage']})")
    print(f"  OK -> stage=launched xp={state['xp']} level={state['level']} ({dt:.1f}s)")


def check_evidence_path(base: str) -> None:
    """Assert the four proof points + the agent-memory learning loop.

    Runs after the world path so the replay log holds STAGE_EXECUTED events.
    Every invocation must show iq_hits, memory_injected, tools evidence and
    inference_usage - the rubric's 'agents actually working' story - and the
    memory layer must have learned from the session (/api/memory).
    """
    print("\n[3/3] EVIDENCE PATH (proof points + agent memory)")
    state = _get(base, "/api/state")["state"]
    executed = [e for e in state.get("replay_log", []) if e.get("event_type") == "STAGE_EXECUTED"]
    _require(len(executed) >= 3, f"expected >=3 STAGE_EXECUTED events, got {len(executed)}")
    for e in executed:
        p = e.get("payload") or {}
        cid = p.get("stage_id", "?")
        _require(bool(p.get("iq_hits")), f"{cid}: iq_hits empty - IQ recall not evidenced")
        _require(bool(p.get("memory_injected")), f"{cid}: memory_injected empty")
        _require("tools_called" in p, f"{cid}: tools_called missing")
        usage = p.get("inference_usage") or {}
        _require(bool(usage.get("client")), f"{cid}: inference_usage.client missing")
        kinds = sorted({m.get("kind", "") for m in p["memory_injected"]})
        print(f"  {cid:<18} iq={len(p['iq_hits'])} mem_kinds={kinds} client={usage.get('client')}")
    mem = _get(base, "/api/memory")
    counts = mem.get("counts") or {}
    _require(counts.get("chat_summary", 0) >= 1, "no chat_summary memories written after stages shipped")
    _require(counts.get("user_profile", 0) >= 1, "no user_profile memory written at venture start")
    written = [e for e in state.get("replay_log", []) if e.get("event_type") == "MEMORY_WRITTEN"]
    print(f"  OK -> memory store={mem.get('store')} counts={counts} MEMORY_WRITTEN events={len(written)}")


def check_live_evidence(base: str) -> None:
    """Certify the live server: real inference receipts, not simulation.

    Reads STAGE_EXECUTED payloads from the replay log (the receipts survive
    there even if a later session replaces the world). Asserts the live-only
    fields on every executed stage: a non-simulation deployment, a named
    inference client (FoundryChatClient / OpenAIChatClient via MAF, or
    openai-direct), real token counts, and a tool_trace whose receipts all
    carry latency. Failed invocations must still carry their error + partial
    trace. A simulation server legitimately fails this check - that is the
    point.
    """
    print("\n[live] LIVE EVIDENCE (real inference receipts)")
    mode = _get(base, "/api/mode")
    _require(bool(mode.get("live")), f"server reports mode={mode.get('mode')!r} - start it with DEMO_MODE=live")
    state = _get(base, "/api/state")["state"]
    executed = [e for e in state.get("replay_log", []) if e.get("event_type") == "STAGE_EXECUTED"]
    _require(len(executed) >= 3, f"expected >=3 STAGE_EXECUTED events, got {len(executed)}")

    for e in executed:
        p = e.get("payload") or {}
        cid = p.get("stage_id", "?")
        trace = p.get("tool_trace") or []
        usage = p.get("inference_usage") or {}
        _require(any(t.get("tool") == "recall" for t in trace), f"{cid}: no recall receipt in tool_trace")
        _require(all(isinstance(t.get("ms"), (int, float)) for t in trace),
                 f"{cid}: a tool_trace receipt is missing latency (ms)")
        if p.get("status") == "failed":
            # Failed runs still owe their receipts: error string + partial trace.
            _require(bool(p.get("error")), f"{cid}: failed invocation has no error recorded")
            print(f"  {cid:<18} FAILED (receipts intact): {str(p.get('error'))[:60]}")
            continue
        _require(p.get("deployment", "") != "simulation", f"{cid}: deployment is 'simulation' on a live server")
        client = usage.get("client") or ""
        _require(bool(client), f"{cid}: no inference client name recorded")
        tokens_out = int(usage.get("tokens_out") or 0)
        _require(tokens_out > 0, f"{cid}: tokens_out={tokens_out} - no real token usage recorded")
        _require(any(str(t.get("tool", "")).startswith("validate_") for t in trace),
                 f"{cid}: no validator receipt in tool_trace")
        midrun = [t for t in trace if t.get("source") == "maf-midrun"]
        print(f"  {cid:<18} client={client:<18} tokens={usage.get('tokens_in', 0)}/{tokens_out} "
              f"reasoning={usage.get('reasoning_tokens', 0)} trace={len(trace)} midrun={len(midrun)}")
        if usage.get("fallback_reason"):
            print(f"  {'':<18} fallback documented: {str(usage['fallback_reason'])[:90]}")
    print("  OK -> live inference receipts certified")


def main() -> int:
    parser = argparse.ArgumentParser(description="End-to-end demo smoke test.")
    parser.add_argument("--base", default="http://127.0.0.1:8000", help="Server base URL")
    parser.add_argument("--pitch", default="A budgeting app that turns bank transactions into weekly money coaching tips")
    parser.add_argument("--skip-world", action="store_true", help="Skip the slower World autoplay path")
    parser.add_argument("--live", action="store_true",
                        help="Also certify live-only evidence (tokens > 0, client name); requires a DEMO_MODE=live server")
    args = parser.parse_args()

    print(f"Demo smoke test against {args.base}")
    try:
        _get(args.base, "/api/state")
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL: server not reachable at {args.base} ({exc})")
        return 2

    try:
        check_campaign_step_by_step_path(args.base, args.pitch)
        if not args.skip_world:
            check_world_path(args.base, args.pitch)
            check_evidence_path(args.base)
            if args.live:
                check_live_evidence(args.base)
        elif args.live:
            print("\n[live] skipped: --live needs the world path (drop --skip-world)")
    except SmokeError as exc:
        print(f"\nFAIL: {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"\nFAIL (unexpected): {exc}")
        return 1

    print("\nALL DEMO PATHS GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
