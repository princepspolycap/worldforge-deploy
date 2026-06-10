"""OrgDesigner agent: designs the dynamic digital workforce a company needs.

This is the "what org structure + agents does this company need" reasoning
step. Given a brief (from a pitch *or* a fetched company URL), it proposes a
team of roles - mostly digital workers - that act as the execution layer behind
a single human operator. Each role carries an educational `why` so the player
understands *why* the org looks the way it does.

Deployment preference: STRATEGIST_MODEL (org design is deep strategy work);
falls back to NARRATOR_MODEL, then to a rich, brief-adaptive simulation so the
whole thing runs after a fresh `git clone` with zero Azure credentials.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from agents.model_config import get_foundry_client, is_live, model_for, create_chat_completion


SYSTEM = (
    "You are an Org Designer for solo operators and small teams turning a skill "
    "or a vibe-coded prototype into a real business. Given a company brief, design "
    "the smallest org that can actually deliver the service - modeled as ONE human "
    "operator plus a set of DIGITAL WORKERS (AI agents) that form the execution "
    "layer. For each role, explain WHY it must exist in plain language a first-time "
    "founder understands. Prefer digital_worker over human unless judgment, "
    "relationships, or accountability genuinely require a person. Return ONLY a "
    "valid JSON object."
)

USER_TEMPLATE = """\
Company brief:
{brief}

Design the org as JSON:
{{
  "company_summary": "one sentence on what this company sells and to whom",
  "operating_model": "one sentence on how the human operator and the digital workers split the work",
  "roles": [
    {{
      "id": "operator",
      "title": "Founder / Operator",
      "kind": "human",
      "mandate": "what this seat is accountable for",
      "reports_to": null,
      "kpis": ["..."],
      "tools": ["..."],
      "deployment_hint": "n/a",
      "lifecycle_stage": "ops",
      "seniority": "lead",
      "monthly_cost_usd": 0,
      "why": "plain-language reason this role exists"
    }}
  ]
}}

Rules:
- Exactly ONE role with kind "human" (the operator) at the top, reports_to null.
- 4 to 7 roles total. Every other role is kind "digital_worker" or "hybrid".
- reports_to must reference another role id (the operator or a lead).
- lifecycle_stage is one of: discovery, positioning, mvp, gtm, retention, ops.
- deployment_hint is one of: reasoning, fast, creative, n/a.
- monthly_cost_usd is a realistic monthly run cost (humans cost more; digital workers are cheap).
- Keep `why` concrete and educational.
"""

# Stage -> default monthly cost for a digital worker (compute + tooling).
_STAGE_COST = {
    "discovery": 120,
    "positioning": 140,
    "mvp": 220,
    "gtm": 180,
    "retention": 160,
    "ops": 150,
}


def _short_label(brief: str, words: int = 6) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 ]", " ", brief or "your venture").strip()
    parts = [w for w in cleaned.split() if w]
    return " ".join(parts[:words]) if parts else "your venture"


def _extract_json(content: str) -> Optional[Dict]:
    if not content:
        return None
    text = content.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()

    candidates = [text]
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last > first:
        candidates.append(text[first:last + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            pass

    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(text[index:])
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            continue
    return None


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")
    return slug or "role"


def _fallback_blueprint(brief: str) -> Dict[str, Any]:
    """Brief-adaptive simulation org: one operator + a digital workforce.

    Deterministic and rich enough to render a real org chart offline, while
    still keying its labels off the brief so different pitches look different.
    """
    label = _short_label(brief)
    roles = [
        {
            "id": "operator",
            "title": "Founder / Operator",
            "kind": "human",
            "mandate": f"Owns the vision for {label}, sets priorities, and approves every artifact at the gate.",
            "reports_to": None,
            "kpis": ["Weekly revenue", "Customer promises kept"],
            "tools": ["verification_gate", "roadmap"],
            "deployment_hint": "n/a",
            "lifecycle_stage": "ops",
            "seniority": "lead",
            "monthly_cost_usd": 0,
            "why": "You are the judgment and the accountability. The digital workers execute; you decide what ships.",
        },
        {
            "id": "discovery_analyst",
            "title": "Discovery Analyst",
            "kind": "digital_worker",
            "mandate": f"Interviews the market for {label}, finds the sharpest pain, and proves willingness to pay.",
            "reports_to": "operator",
            "kpis": ["Interviews / week", "Clear WTP signals"],
            "tools": ["foundry_iq", "web_search"],
            "deployment_hint": "reasoning",
            "lifecycle_stage": "discovery",
            "seniority": "ic",
            "monthly_cost_usd": _STAGE_COST["discovery"],
            "why": "Most vibe-coded apps die from building before validating. This worker keeps you honest about demand.",
        },
        {
            "id": "strategy_lead",
            "title": "Strategy & Positioning Lead",
            "kind": "digital_worker",
            "mandate": "Turns discovery into a sharp ICP, wedge, and the org's OKRs.",
            "reports_to": "operator",
            "kpis": ["Positioning tested with 10 users", "OKRs set for the quarter"],
            "tools": ["foundry_iq", "code_interpreter"],
            "deployment_hint": "reasoning",
            "lifecycle_stage": "positioning",
            "seniority": "lead",
            "monthly_cost_usd": _STAGE_COST["positioning"],
            "why": "Without a sharp niche, marketing has nothing to amplify. This is the spine the rest of the org hangs off.",
        },
        {
            "id": "product_builder",
            "title": "Product Builder",
            "kind": "digital_worker",
            "mandate": "Ships the smallest usable product and the systems it runs on.",
            "reports_to": "strategy_lead",
            "kpis": ["MVP live", "Activation > 40%"],
            "tools": ["code_interpreter", "deploy_page"],
            "deployment_hint": "creative",
            "lifecycle_stage": "mvp",
            "seniority": "ic",
            "monthly_cost_usd": _STAGE_COST["mvp"],
            "why": "Your skill becomes leverage only when it is productized. This worker turns it into something repeatable.",
        },
        {
            "id": "growth_marketer",
            "title": "Growth Marketer",
            "kind": "digital_worker",
            "mandate": "Picks $0 channels, writes the launch copy, and owns the financial plan.",
            "reports_to": "strategy_lead",
            "kpis": ["First 100 customers", "CAC under target"],
            "tools": ["email_sender", "web_search"],
            "deployment_hint": "creative",
            "lifecycle_stage": "gtm",
            "seniority": "ic",
            "monthly_cost_usd": _STAGE_COST["gtm"],
            "why": "A product nobody hears about is a hobby. This worker is the distribution your business runs on.",
        },
        {
            "id": "retention_ops",
            "title": "Retention & Ops Worker",
            "kind": "digital_worker",
            "mandate": "Builds onboarding, support, and the loops that keep customers paying.",
            "reports_to": "operator",
            "kpis": ["Monthly churn < 5%", "NPS > 40"],
            "tools": ["code_interpreter", "foundry_iq"],
            "deployment_hint": "fast",
            "lifecycle_stage": "retention",
            "seniority": "ic",
            "monthly_cost_usd": _STAGE_COST["retention"],
            "why": "Selling once is marketing; selling again is a business. This worker protects the revenue you already won.",
        },
    ]
    return {
        "company_summary": "A solo-operated venture run as a repeatable, paid service - one human operator, a workforce of digital workers.",
        "operating_model": "One human operator sets direction and approves; a team of digital workers does the execution.",
        "roles": roles,
        "notes": [
            "Org generated in simulation mode (no Foundry credentials required).",
            "Every digital worker is the execution layer behind your single human seat.",
        ],
    }


def _normalize_role(raw: Dict[str, Any], idx: int) -> Dict[str, Any]:
    allowed_kind = {"human", "digital_worker", "hybrid"}
    allowed_stage = {"discovery", "positioning", "mvp", "gtm", "retention", "ops"}
    allowed_hint = {"reasoning", "fast", "creative", "n/a"}

    title = str(raw.get("title") or f"Role {idx}")
    role_id = _slugify(str(raw.get("id") or title))
    kind = str(raw.get("kind") or "digital_worker").lower()
    if kind not in allowed_kind:
        kind = "digital_worker"
    stage = str(raw.get("lifecycle_stage") or "ops").lower()
    if stage not in allowed_stage:
        stage = "ops"
    hint = str(raw.get("deployment_hint") or ("n/a" if kind == "human" else "reasoning")).lower()
    if hint not in allowed_hint:
        hint = "reasoning"

    kpis = raw.get("kpis") or []
    if not isinstance(kpis, list):
        kpis = [str(kpis)]
    tools = raw.get("tools") or []
    if not isinstance(tools, list):
        tools = [str(tools)]

    cost = raw.get("monthly_cost_usd")
    try:
        cost = int(cost)
    except Exception:
        cost = 0 if kind == "human" else _STAGE_COST.get(stage, 150)

    reports_to = raw.get("reports_to")
    reports_to = _slugify(str(reports_to)) if reports_to else None

    return {
        "id": role_id,
        "title": title,
        "kind": kind,
        "mandate": str(raw.get("mandate") or ""),
        "reports_to": reports_to,
        "kpis": [str(k) for k in kpis][:4],
        "tools": [str(t) for t in tools][:5],
        "deployment_hint": hint,
        "lifecycle_stage": stage,
        "seniority": str(raw.get("seniority") or "ic").lower(),
        "monthly_cost_usd": max(0, cost),
        "why": str(raw.get("why") or ""),
    }


def _finalize(blueprint: Dict[str, Any], brief: str, source: str, source_ref: str,
              summary_hint: str = "") -> Dict[str, Any]:
    """Normalize roles, repair the reporting tree, and compute mechanic stats."""
    raw_roles = blueprint.get("roles") or []
    if not isinstance(raw_roles, list) or len(raw_roles) < 2:
        blueprint = _fallback_blueprint(brief)
        raw_roles = blueprint["roles"]

    roles = [_normalize_role(r, i + 1) for i, r in enumerate(raw_roles) if isinstance(r, dict)]

    # De-duplicate ids.
    seen: set[str] = set()
    for r in roles:
        if r["id"] in seen:
            r["id"] = f"{r['id']}_{len(seen)}"
        seen.add(r["id"])
    ids = {r["id"] for r in roles}

    # Guarantee exactly one top operator.
    humans = [r for r in roles if r["kind"] == "human"]
    if not humans:
        roles[0]["kind"] = "human"
        roles[0]["reports_to"] = None
        roles[0]["monthly_cost_usd"] = 0
        operator_id = roles[0]["id"]
    else:
        operator_id = humans[0]["id"]
        humans[0]["reports_to"] = None
        # Any extra "humans" become hybrids reporting to the operator.
        for extra in humans[1:]:
            extra["kind"] = "hybrid"

    # Repair dangling / self / missing reporting lines.
    for r in roles:
        if r["id"] == operator_id:
            r["reports_to"] = None
            continue
        parent = r.get("reports_to")
        if not parent or parent == r["id"] or parent not in ids:
            r["reports_to"] = operator_id

    digital = [r for r in roles if r["kind"] != "human"]
    human_count = len(roles) - len(digital)
    burn = sum(r["monthly_cost_usd"] for r in roles)
    leverage = round(len(digital) / max(1, human_count), 1)

    return {
        "company_summary": summary_hint.strip() or str(blueprint.get("company_summary") or f"A venture built around {_short_label(brief)}."),
        "operating_model": str(blueprint.get("operating_model")
                               or "One human operator sets direction and approves; digital workers do the execution."),
        "roles": roles,
        "headcount": len(roles),
        "digital_worker_count": len(digital),
        "human_count": human_count,
        "monthly_burn_usd": burn,
        "leverage_ratio": leverage,
        "source": source,
        "source_ref": (source_ref or "")[:500],
        "notes": [str(n) for n in (blueprint.get("notes") or [])][:4],
    }


def design_org(brief: str, source: str = "pitch", source_ref: str = "",
               summary_hint: str = "") -> Dict[str, Any]:
    """Design the dynamic org for a company brief.

    Returns a finalized OrgBlueprint dict (normalized + stats computed). Calls
    the configured Foundry deployment in live mode; otherwise returns a rich,
    brief-adaptive simulation blueprint. `summary_hint`, when provided (e.g. the
    company profile from the URL analyst), is used as the company summary so the
    org reads coherently on the URL path even in simulation.
    """
    client = get_foundry_client()
    # Org design is the first on-screen reveal, so prefer the narrator
    # deployment (frontier reasoning, fast, clean JSON) over the deep strategist
    # model, which is verbose and slow enough to hurt a live demo. Strategist is
    # the fallback if the narrator deployment is not configured.
    deployment = model_for("narrator") or model_for("strategist")

    if not (client and deployment and is_live()):
        return _finalize(_fallback_blueprint(brief), brief, source, source_ref, summary_hint)

    user = USER_TEMPLATE.format(brief=brief)
    try:
        resp = create_chat_completion(
            deployment,
            [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": user},
            ],
            max_completion_tokens=8000,
        )
        content = resp.choices[0].message.content or ""
        parsed = _extract_json(content)
        if parsed and isinstance(parsed.get("roles"), list) and len(parsed["roles"]) >= 2:
            return _finalize(parsed, brief, source, source_ref, summary_hint)
    except Exception:
        pass
    return _finalize(_fallback_blueprint(brief), brief, source, source_ref, summary_hint)
