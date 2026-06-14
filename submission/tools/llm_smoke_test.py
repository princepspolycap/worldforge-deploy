"""Stress-test the configured Foundry deployments on startup-bootstrap tasks.

Each model gets a substantive prompt that mirrors what the Worker Factory will
eventually ask of it: explore a company, produce a structured artifact. We
capture latency, token usage (when available), and the raw JSON output so we
can pick which deployment fits which Worker role.

Run from the submission/ directory:
    ../.venv/bin/python tools/llm_smoke_test.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.model_config import get_foundry_client, model_for, is_live  # noqa: E402


COMPANY_BRIEF = (
    "Indie SaaS: a pixel-art landing-page generator for solo coffee-shop owners. "
    "Founder is a one-person operator. Region: North America. Budget: bootstrap, "
    "$0 marketing spend. Goal: $5k MRR in 6 months."
)

TASKS = {
    "narrator": {
        "system": (
            "You are the Master Narrator for a startup-building game. Decompose "
            "a company brief into a quest line for specialist agents."
        ),
        "user": (
            f"Brief: {COMPANY_BRIEF}\n\n"
            "Return JSON: {\"stages\": [ {title, goal, owner_role, success_metric, "
            "depends_on:[...]}, ... ]} with 8 stages covering Dan Harmon's beats: "
            "YOU, NEED, GO, SEARCH, FIND, TAKE, RETURN, CHANGE. "
            "owner_role in {strategist, designer, marketer, ops}."
        ),
    },
    "strategist": {
        "system": (
            "You are a lean-startup strategist. Produce a structured org chart "
            "and OKRs for a one-person SaaS in JSON."
        ),
        "user": (
            f"Brief: {COMPANY_BRIEF}\n\n"
            "Return JSON: {\"org_chart\": [{role, headcount, when_to_hire, owns:[...]}, ...], "
            "\"okrs_q1\": [{objective, key_results:[...]}, ...]}. "
            "Bootstrap reality: founder wears every hat for the first 90 days."
        ),
    },
    "designer": {
        "system": (
            "You are a product/UX designer. Produce a landing-page spec AND a "
            "first-product integration map in JSON."
        ),
        "user": (
            f"Brief: {COMPANY_BRIEF}\n\n"
            "Return JSON: {\"landing_page\": {hero, subhead, cta, sections:[...]}, "
            "\"integrations\": [{name, purpose, free_tier_ok:bool}, ...]}. "
            "Pick integrations a solo founder can wire in a weekend."
        ),
    },
    "marketer": {
        "system": (
            "You are a growth marketer. Build a GTM plan with financial guardrails."
        ),
        "user": (
            f"Brief: {COMPANY_BRIEF}\n\n"
            "Return JSON: {\"gtm_channels\": [{channel, weekly_hours, expected_cac_usd, "
            "leverage_note}, ...], \"financial_plan\": {target_mrr_usd_m1..m6:[..6 nums..], "
            "burn_usd_per_month, breakeven_month}}."
        ),
    },
}


def call(role: str, system: str, user: str):
    client = get_foundry_client()
    deployment = model_for(role)
    base_kwargs = dict(
        model=deployment,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_completion_tokens=8000,
    )
    t0 = time.perf_counter()
    try:
        resp = client.chat.completions.create(temperature=0.7, **base_kwargs)
    except Exception as e:
        # GPT-5 family rejects non-default temperature. Retry without it.
        if "temperature" in str(e).lower():
            try:
                resp = client.chat.completions.create(**base_kwargs)
            except Exception as e2:
                return {"role": role, "deployment": deployment, "error": f"{type(e2).__name__}: {e2}"}
        else:
            return {"role": role, "deployment": deployment, "error": f"{type(e).__name__}: {e}"}
    dt = time.perf_counter() - t0
    msg = resp.choices[0].message.content or ""
    usage = getattr(resp, "usage", None)
    parsed = None
    err = None
    try:
        import re
        # Strip ```json ... ``` fences if present.
        fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", msg, re.DOTALL)
        if fence:
            parsed = json.loads(fence.group(1))
        else:
            m = re.search(r"\{.*\}", msg, re.DOTALL)
            parsed = json.loads(m.group(0)) if m else None
    except Exception as e:
        err = f"json_parse: {type(e).__name__}: {e}"
    return {
        "role": role,
        "deployment": deployment,
        "latency_s": round(dt, 2),
        "tokens_in": getattr(usage, "prompt_tokens", None),
        "tokens_out": getattr(usage, "completion_tokens", None),
        "raw_len": len(msg),
        "raw_preview": msg[:400],
        "parsed_ok": parsed is not None,
        "parse_error": err,
        "parsed": parsed,
    }


def main():
    if not is_live():
        print("DEMO_MODE != live or FOUNDRY_BASE_URL missing - aborting.")
        sys.exit(1)
    results = {}
    for role, prompt in TASKS.items():
        print(f"\n=== {role} -> {model_for(role)} ===")
        r = call(role, prompt["system"], prompt["user"])
        if "error" in r:
            print(f"  ERROR: {r['error']}")
        else:
            print(f"  latency: {r['latency_s']}s | tokens: in={r['tokens_in']} out={r['tokens_out']} | parsed_ok={r['parsed_ok']}")
            print(f"  preview: {r['raw_preview'][:200]}...")
        results[role] = r

    out_path = Path(__file__).resolve().parent.parent / "docs" / "llm_smoke_test_results.json"
    out_path.write_text(json.dumps(results, indent=2, default=str))
    print(f"\nSaved full results -> {out_path}")


if __name__ == "__main__":
    main()
