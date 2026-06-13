"""Export the chartered OrgBlueprint as a platform-neutral Workforce Bundle.

The game designs an org on Foundry (agents/org_designer.py). This module turns
that OrgBlueprint into a portable JSON bundle that any digital-worker platform
can ingest and provision for real: one document with per-worker briefs
(generated system messages, KPIs, tool wishes, model class), team composition,
and a Mermaid org chart.

Deliberately dependency-free and offline: no Poly imports, no network, runs in
simulation mode after a fresh `git clone`. The bundle is the handoff artifact -
the receiving platform (any platform) owns provisioning, behind its own human
approval gate.

CLI:
    python3 submission/tools/export_org_blueprint.py                 # from saved state
    python3 submission/tools/export_org_blueprint.py --pitch "..."   # design fresh (simulation-safe)
    python3 submission/tools/export_org_blueprint.py --out bundle.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any, Dict, List

BUNDLE_FORMAT = "campaign.workforce_bundle"
BUNDLE_VERSION = 1

# deployment_hint -> platform-neutral model class the receiver maps to its own fleet.
_MODEL_CLASS = {"reasoning": "reasoning", "fast": "fast", "creative": "creative"}


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")
    return slug or "role"


def org_to_mermaid(org: Dict[str, Any]) -> str:
    """Render the org as a Mermaid `graph TD` org chart (humans vs digital)."""
    roles = org.get("roles") or []
    if not roles:
        return 'graph TD\n  X["No org designed"]'
    lines = ["graph TD"]
    lines.append("  classDef human fill:#f6d55c,stroke:#5b8cff,stroke-width:3px")
    lines.append("  classDef digital fill:#3caea3,stroke:#2dd4bf")
    lines.append("  classDef hybrid fill:#c084fc,stroke:#c084fc")
    for role in roles:
        nid = "n_" + _slug(role.get("id", ""))
        title = re.sub(r'["\[\]<>]', "", role.get("title", "Role"))
        kind = role.get("kind", "digital_worker")
        cls = "human" if kind == "human" else ("hybrid" if kind == "hybrid" else "digital")
        lines.append(f'  {nid}["{title}"]:::{cls}')
    for role in roles:
        parent = role.get("reports_to")
        if parent:
            lines.append(f"  n_{_slug(parent)} --> n_{_slug(role.get('id', ''))}")
    return "\n".join(lines)


def _system_message(role: Dict[str, Any], org: Dict[str, Any]) -> str:
    """Generate a starter system message for one digital worker seat.

    Same shape for every worker so a receiving platform (or its own org
    architect agent) can parse, refine, and version it.
    """
    kpis = "; ".join(role.get("kpis") or []) or "agreed with the operator"
    tools = ", ".join(role.get("tools") or []) or "to be granted by the platform"
    reports_to = role.get("reports_to") or "the operator"
    return (
        f"<worker_identity>\n"
        f"  <role>{role.get('title', 'Digital Worker')}</role>\n"
        f"  <mission>{role.get('mandate', '')}</mission>\n"
        f"  <company>{org.get('company_summary', '')}</company>\n"
        f"  <operating_model>{org.get('operating_model', '')}</operating_model>\n"
        f"  <reports_to>{reports_to}</reports_to>\n"
        f"  <kpis>{kpis}</kpis>\n"
        f"  <tools_expected>{tools}</tools_expected>\n"
        f"  <why_this_seat_exists>{role.get('why', '')}</why_this_seat_exists>\n"
        f"  <guardrails>\n"
        f"    - Work only within this mandate; escalate judgment calls to {reports_to}.\n"
        f"    - No legal or financial commitments without explicit human approval.\n"
        f"    - Report progress against the KPIs above; flag blockers early.\n"
        f"  </guardrails>\n"
        f"</worker_identity>"
    )


def org_to_workforce_bundle(org: Dict[str, Any]) -> Dict[str, Any]:
    """Turn an OrgBlueprint dict into the portable Workforce Bundle."""
    roles: List[Dict[str, Any]] = org.get("roles") or []
    humans = [r for r in roles if r.get("kind") == "human"]
    workers = [r for r in roles if r.get("kind") != "human"]

    worker_specs = []
    for role in workers:
        worker_specs.append({
            "worker_key": _slug(role.get("id") or role.get("title", "")),
            "name": role.get("title", "Digital Worker"),
            "role": _slug(role.get("title", "")),
            "kind": role.get("kind", "digital_worker"),
            "description": role.get("mandate", ""),
            "system_message": _system_message(role, org),
            "model_class": _MODEL_CLASS.get(role.get("deployment_hint", ""), "fast"),
            "tools": role.get("tools") or [],
            "kpis": role.get("kpis") or [],
            "reports_to": _slug(role.get("reports_to") or ""),
            "lifecycle_stage": role.get("lifecycle_stage", ""),
            "seniority": role.get("seniority", "ic"),
            "monthly_cost_usd": role.get("monthly_cost_usd", 0),
            "why": role.get("why", ""),
        })

    human_specs = [{
        "id": _slug(role.get("id") or role.get("title", "")),
        "title": role.get("title", "Operator"),
        "mandate": role.get("mandate", ""),
        "kpis": role.get("kpis") or [],
        "why": role.get("why", ""),
    } for role in humans]

    team_name = (org.get("company_summary") or "Chartered Org").split(".")[0][:60].strip() or "Chartered Org"
    return {
        "format": BUNDLE_FORMAT,
        "version": BUNDLE_VERSION,
        "generated_by": "gamifying-world-improvement",
        "company": {
            "summary": org.get("company_summary", ""),
            "operating_model": org.get("operating_model", ""),
            "source": org.get("source", "pitch"),
            "source_ref": org.get("source_ref", ""),
        },
        "economics": {
            "headcount": org.get("headcount", len(roles)),
            "digital_worker_count": org.get("digital_worker_count", len(worker_specs)),
            "human_count": org.get("human_count", len(human_specs)),
            "monthly_burn_usd": org.get("monthly_burn_usd", 0),
            "leverage_ratio": org.get("leverage_ratio", 0.0),
        },
        "team": {
            "name": f"{team_name} - Execution Team",
            "purpose": org.get("operating_model", ""),
            "members": [w["worker_key"] for w in worker_specs],
            "owner": human_specs[0]["id"] if human_specs else "operator",
        },
        "humans": human_specs,
        "workers": worker_specs,
        "org_chart_mermaid": org_to_mermaid(org),
        "provisioning": {
            "status": "pending_human_approval",
            "note": ("Nothing in this bundle is provisioned. The receiving platform "
                     "must present it for explicit human approval before creating "
                     "any worker, team, KPI, or workflow."),
        },
    }


def _main() -> int:
    parser = argparse.ArgumentParser(description="Export the chartered org as a Workforce Bundle.")
    parser.add_argument("--state", default=None, help="Path to state.json (default: submission/state/state.json)")
    parser.add_argument("--pitch", default=None, help="Design a fresh org from this pitch instead (simulation-safe)")
    parser.add_argument("--out", default=None, help="Write bundle JSON to this file (default: stdout)")
    args = parser.parse_args()

    submission_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if submission_root not in sys.path:
        sys.path.append(submission_root)

    if args.pitch:
        from agents.org_designer import design_org
        org = design_org(args.pitch, source="pitch", source_ref=args.pitch)
    else:
        state_path = args.state or os.path.join(submission_root, "state", "state.json")
        if not os.path.exists(state_path):
            print(f"No state file at {state_path}. Run the game first or pass --pitch.", file=sys.stderr)
            return 1
        with open(state_path, "r", encoding="utf-8") as handle:
            state = json.load(handle)
        org = state.get("org") or {}
        if not org.get("roles"):
            print("No chartered org in state. Run the game first or pass --pitch.", file=sys.stderr)
            return 1

    bundle = org_to_workforce_bundle(org)
    payload = json.dumps(bundle, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(payload + "\n")
        print(f"Wrote {args.out} ({len(bundle['workers'])} workers, "
              f"{len(bundle['humans'])} humans).")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
