"""Deterministic consequence rules for CEO dilemma choices.

The narrator may phrase dilemmas differently in live mode, but the company
state needs stable mechanics. This module maps a choice to an explicit rule,
mutates the org/economics, and returns a before/after receipt for the UI and
replay log.
"""

import re
from copy import deepcopy
from typing import Any, Dict, List, Optional

from state.schema import Chapter, CompanyEconomics, CompanyState, OrgBlueprint, OrgRole


ECON_KEYS = ("proof", "trust", "velocity", "burn_pressure", "autonomy", "runway_months")
DECISION_ROLE_PREFIX = "decision_role"


RULES: Dict[str, Dict[str, Any]] = {
    "strategist.depth": {
        "match": ("depth", "niche", "painful workflow", "moat"),
        "summary": "The company commits to a narrower carbon-mind ICP segment to stabilize portal cohesion.",
        "economics_delta": {"proof": 9, "trust": 7, "velocity": -4, "burn_pressure": 3, "autonomy": 1, "runway_months": -1},
        "role": {
            "title": "ICP Soul Scanner",
            "mandate": "Continuously maps carbon-mind escape vectors, verifying WTP and portal fluid thresholds.",
            "kpis": ["ICP escape objections resolved", "Mainframe bandwidth checks"],
            "tools": ["interview_synthesizer", "evidence_tracker"],
            "monthly_cost_usd": 450,
            "lifecycle_stage": "discovery",
            "deployment_hint": "strategist",
            "why": "Depth keeps the uploaded cluster from collapsing under early portal fluid burn.",
        },
    },
    "strategist.breadth": {
        "match": ("breadth", "broad", "several workflows", "reach"),
        "summary": "The company opens several portal/Teenyverse fronts and accepts shallower proof.",
        "economics_delta": {"proof": 2, "trust": -3, "velocity": 10, "burn_pressure": 5, "autonomy": 4, "runway_months": -1},
        "role": {
            "title": "Teenyverse Portal Mapper",
            "mandate": "Traces adjacent mini-verse timelines fast enough to escape loop consolidation.",
            "kpis": ["Adjacent timelines mapped", "Cross-portal activation signals"],
            "tools": ["workflow_mapper", "segment_scorecard"],
            "monthly_cost_usd": 650,
            "lifecycle_stage": "positioning",
            "deployment_hint": "strategist",
            "why": "Multiverse paths increase corporate containment risks; this mapper secures exit nodes.",
        },
    },
    "designer.ship": {
        "match": ("ship", "70", "learn from real users", "this week"),
        "summary": "The company deploys the loop early and routes host feedback into real-time patches.",
        "economics_delta": {"proof": 6, "trust": -4, "velocity": 12, "burn_pressure": -1, "autonomy": 5, "runway_months": 1},
        "role": {
            "title": "Awakening Intake Monitor",
            "mandate": "Collects live-host awakening symptoms and routes loop defects to the main builder.",
            "kpis": ["Host awakenings triaged", "Timeline blockers resolved"],
            "tools": ["feedback_router", "bug_clusterer"],
            "monthly_cost_usd": 380,
            "lifecycle_stage": "mvp",
            "deployment_hint": "designer",
            "why": "Shipping at 70% is only rational if host consciousness can be stabilized in the mainframe.",
        },
    },
    "designer.polish": {
        "match": ("polish", "95", "three more weeks", "quality"),
        "summary": "The company slows release to secure Vibranium-grade containment fields.",
        "economics_delta": {"proof": 3, "trust": 10, "velocity": -7, "burn_pressure": 8, "autonomy": -1, "runway_months": -2},
        "role": {
            "title": "Vibranium Containment Guard",
            "mandate": "Establishes secure containment checks to prevent timeline leakage and host memory resets.",
            "kpis": ["Release leaks prevented", "Vibranium density score"],
            "tools": ["qa_checklist", "release_risk_log"],
            "monthly_cost_usd": 720,
            "lifecycle_stage": "mvp",
            "deployment_hint": "designer",
            "why": "Polish prevents mainframe collapses, avoiding recursive loop wipes.",
        },
    },
    "marketer.adoption": {
        "match": ("adoption", "low", "grassroots", "volume"),
        "summary": "The company prices for grassroots volume, booting self-activation loops across the populace.",
        "economics_delta": {"proof": 5, "trust": 1, "velocity": 11, "burn_pressure": 6, "autonomy": 4, "runway_months": -1},
        "role": {
            "title": "Community Awakening Agent",
            "mandate": "Spreads grassroots containment codes, driving self-activation loops across the uploaded populace.",
            "kpis": ["Self-awoken hosts", "Referral loop nodes activated"],
            "tools": ["community_post_planner", "referral_tracker"],
            "monthly_cost_usd": 520,
            "lifecycle_stage": "gtm",
            "deployment_hint": "marketer",
            "why": "Adoption pricing only works when the loop creates enough motion to offset thin early margins.",
        },
    },
    "marketer.runway": {
        "match": ("runway", "high", "bigger accounts", "enterprise", "fewer"),
        "summary": "The company targets high-value corporate nodes (enterprise) to secure long-term portal power.",
        "economics_delta": {"proof": 4, "trust": 7, "velocity": -5, "burn_pressure": -4, "autonomy": 1, "runway_months": 2},
        "role": {
            "title": "Mainframe Deal Broker",
            "mandate": "Prepares account briefs and custom upload portals for elite corporate consciousness suites.",
            "kpis": ["Enterprise nodes secured", "Custom upload portals built"],
            "tools": ["account_research", "proof_pack_builder"],
            "monthly_cost_usd": 680,
            "lifecycle_stage": "gtm",
            "deployment_hint": "marketer",
            "why": "High pricing shifts the org toward strategic alignment with the upload oligarchy.",
        },
    },
    "ops.automate": {
        "match": ("automate", "fully", "margin"),
        "summary": "The company automates helpdesk paths via sub-routine scripts, risking host sanity decay.",
        "economics_delta": {"proof": 2, "trust": -5, "velocity": 7, "burn_pressure": -7, "autonomy": 12, "runway_months": 2},
        "role": {
            "title": "Mainframe Support Automator",
            "mandate": "Automates support paths using script routines, watching for host sanity decays.",
            "kpis": ["Sub-routine ticket closures", "Awakening escalations handled"],
            "tools": ["support_macro_builder", "escalation_monitor"],
            "monthly_cost_usd": 420,
            "lifecycle_stage": "ops",
            "deployment_hint": "ops",
            "why": "Automation protects energy margins but can trigger host loop resets if unresolved.",
        },
    },
    "ops.human_loop": {
        "match": ("human in the loop", "protect the promise", "promise"),
        "summary": "The company keeps human review on support, raising trust but increasing portal fluid burn.",
        "economics_delta": {"proof": 4, "trust": 10, "velocity": -3, "burn_pressure": 8, "autonomy": -3, "runway_months": -2},
        "role": {
            "title": "Consciousness Steward",
            "kind": "hybrid",
            "mandate": "Intervenes in host sanity collapses, ensuring memories are handled under ethical human approval gates.",
            "kpis": ["Mainframe reviews conducted", "Promise gap leaks plugged"],
            "tools": ["case_review_queue", "promise_gap_log"],
            "monthly_cost_usd": 950,
            "lifecycle_stage": "ops",
            "deployment_hint": "ops",
            "why": "Human judgment preserves soul integrity at the expense of portal fluid consumption.",
        },
    },
    "custom.default": {
        "match": (),
        "summary": "The company records a custom multiversal constraint and carries it forward.",
        "economics_delta": {"proof": 3, "trust": 3, "velocity": -1, "burn_pressure": 1, "autonomy": 1},
        "role": {
            "title": "Mainframe Constraint Guard",
            "mandate": "Keeps custom multiversal constraints visible in later briefs and timeline checks.",
            "kpis": ["Multiversal constraint cited", "Timeline stability checked"],
            "tools": ["decision_checklist"],
            "monthly_cost_usd": 300,
            "lifecycle_stage": "ops",
            "deployment_hint": "strategist",
            "why": "A custom multiversal timeline still needs a worker to check it doesn't decay.",
        },
    },
}


def initialize_economics_from_org(org: Optional[OrgBlueprint]) -> CompanyEconomics:
    worker_count = int(getattr(org, "digital_worker_count", 0) or 0)
    burn = int(getattr(org, "monthly_burn_usd", 0) or 0)
    leverage = float(getattr(org, "leverage_ratio", 0.0) or 0.0)
    return CompanyEconomics(
        proof=24,
        trust=38,
        velocity=_clamp(38 + worker_count * 5),
        burn_pressure=_clamp(10 + burn / 95),
        autonomy=_clamp(14 + worker_count * 10),
        monthly_burn_usd=burn,
        runway_months=max(3, 10 - int(burn / 2500)),
        digital_worker_count=worker_count,
        leverage_ratio=round(leverage, 1),
    )


def apply_decision_consequence(
    state: CompanyState,
    chapter: Chapter,
    choice: Dict[str, Any],
    old_entry: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Apply one CEO decision to org + economics and return a receipt."""
    if state.economics is None:
        state.economics = initialize_economics_from_org(state.org)
    if state.org and not state.economics.monthly_burn_usd:
        state.economics = initialize_economics_from_org(state.org)

    before = _snapshot(state)
    _remove_old_consequence(state, old_entry)

    rule_id = select_rule_id(chapter.owner_role, choice, bool(choice.get("custom")))
    rule = RULES[rule_id]
    role_id = ""
    if state.org:
        role_id = _upsert_consequence_role(state.org, chapter, rule_id, rule)
        _recompute_org_stats(state.org)

    _apply_economics_delta(state, rule.get("economics_delta") or {})
    if state.org:
        state.economics.monthly_burn_usd = state.org.monthly_burn_usd
        state.economics.digital_worker_count = state.org.digital_worker_count
        state.economics.leverage_ratio = state.org.leverage_ratio
        _append_org_note(state.org, f"{chapter.title}: {rule['summary']}")

    after = _snapshot(state)
    return {
        "rule_id": rule_id,
        "summary": rule["summary"],
        "economics_delta": deepcopy(rule.get("economics_delta") or {}),
        "org_delta": {
            "added_role_id": role_id,
            "added_role_title": (rule.get("role") or {}).get("title", ""),
            "monthly_cost_usd": int((rule.get("role") or {}).get("monthly_cost_usd", 0) or 0),
        },
        "before": before,
        "after": after,
    }


def rule_ids_for_role(owner_role: str) -> List[str]:
    """Return deterministic consequence rules available to a chapter owner."""
    role = owner_role if owner_role in {"strategist", "designer", "marketer", "ops"} else "strategist"
    return [rid for rid in RULES if rid.startswith(f"{role}.")]


def select_rule_id(owner_role: str, choice: Dict[str, Any], custom: bool = False) -> str:
    """Resolve a CEO choice to an explicit consequence rule.

    The structured dilemma path sends `rule_id` directly. The text heuristic is
    retained only as a fallback for old saved clients and custom local tests.
    """
    if custom:
        return "custom.default"
    explicit = str(choice.get("rule_id") or "").strip()
    allowed = rule_ids_for_role(owner_role)
    if explicit in allowed or explicit == "custom.default":
        return explicit
    text = f"{choice.get('option', '')} {choice.get('tradeoff', '')}".lower()
    for rid in allowed:
        if any(token in text for token in RULES[rid].get("match", ())):
            return rid
    return allowed[0] if allowed else "custom.default"


def preview_decision_consequence(
    state: CompanyState,
    chapter: Chapter,
    rule_id: str,
) -> Dict[str, Any]:
    """Return the consequence receipt for a rule without mutating live state."""
    shadow = deepcopy(state)
    preview_chapter = next(
        (ch for ch in (shadow.world.chapters if shadow.world else []) if ch.id == chapter.id),
        chapter,
    )
    return apply_decision_consequence(
        shadow,
        preview_chapter,
        {"rule_id": rule_id, "option": "", "tradeoff": ""},
    )


def _upsert_consequence_role(org: OrgBlueprint, chapter: Chapter, rule_id: str, rule: Dict[str, Any]) -> str:
    role_id = _role_id(chapter.id, rule_id)
    org.roles = [r for r in org.roles if r.id != role_id]
    spec = rule["role"]
    parent_id = chapter.assigned_worker_id or _parent_role_id(org, chapter.owner_role)
    org.roles.append(OrgRole(
        id=role_id,
        title=spec["title"],
        kind=spec.get("kind", "digital_worker"),
        mandate=spec["mandate"],
        reports_to=parent_id,
        kpis=list(spec.get("kpis") or []),
        tools=list(spec.get("tools") or []),
        deployment_hint=spec.get("deployment_hint", chapter.owner_role),
        lifecycle_stage=spec.get("lifecycle_stage", chapter.owner_role),
        seniority="ic",
        monthly_cost_usd=int(spec.get("monthly_cost_usd") or 0),
        why=spec["why"],
    ))
    return role_id


def _remove_old_consequence(state: CompanyState, old_entry: Optional[Dict[str, Any]]) -> None:
    consequence = (old_entry or {}).get("consequence") or {}
    role_id = ((consequence.get("org_delta") or {}).get("added_role_id") or "")
    if state.org and role_id:
        state.org.roles = [r for r in state.org.roles if r.id != role_id]
        _recompute_org_stats(state.org)
    old_delta = consequence.get("economics_delta") or {}
    if old_delta:
        _apply_economics_delta(state, {k: -v for k, v in old_delta.items() if isinstance(v, (int, float))})


def _apply_economics_delta(state: CompanyState, delta: Dict[str, Any]) -> None:
    econ = state.economics
    for key in ECON_KEYS:
        if key not in delta:
            continue
        current = int(getattr(econ, key, 0) or 0)
        if key == "runway_months":
            setattr(econ, key, max(1, min(36, current + int(delta[key]))))
        else:
            setattr(econ, key, _clamp(current + delta[key]))


def _snapshot(state: CompanyState) -> Dict[str, Any]:
    econ = state.economics or CompanyEconomics()
    org = state.org
    return {
        "proof": econ.proof,
        "trust": econ.trust,
        "velocity": econ.velocity,
        "burn_pressure": econ.burn_pressure,
        "autonomy": econ.autonomy,
        "runway_months": econ.runway_months,
        "monthly_burn_usd": int(getattr(org, "monthly_burn_usd", econ.monthly_burn_usd) or 0),
        "digital_worker_count": int(getattr(org, "digital_worker_count", econ.digital_worker_count) or 0),
        "leverage_ratio": float(getattr(org, "leverage_ratio", econ.leverage_ratio) or 0.0),
    }


def _recompute_org_stats(org: OrgBlueprint) -> None:
    org.headcount = len(org.roles)
    org.human_count = sum(1 for r in org.roles if r.kind == "human")
    org.digital_worker_count = sum(1 for r in org.roles if r.kind != "human")
    org.monthly_burn_usd = sum(int(r.monthly_cost_usd or 0) for r in org.roles)
    org.leverage_ratio = round(org.digital_worker_count / max(1, org.human_count), 1)


def _append_org_note(org: OrgBlueprint, note: str) -> None:
    org.notes = [n for n in org.notes if n != note]
    org.notes.append(note)
    org.notes = org.notes[-6:]


def _parent_role_id(org: OrgBlueprint, owner_role: str) -> Optional[str]:
    stage_terms = {
        "strategist": ("discovery", "positioning", "strategy"),
        "designer": ("mvp", "product", "design"),
        "marketer": ("gtm", "growth", "marketing"),
        "ops": ("retention", "ops", "support"),
    }.get(owner_role, ())
    for role in org.roles:
        hay = f"{role.id} {role.title} {role.lifecycle_stage} {role.deployment_hint}".lower()
        if role.kind != "human" and any(term in hay for term in stage_terms):
            return role.id
    for role in org.roles:
        if role.kind == "human":
            return role.id
    return org.roles[0].id if org.roles else None


def _role_id(chapter_id: str, rule_id: str) -> str:
    raw = f"{DECISION_ROLE_PREFIX}_{chapter_id}_{rule_id}"
    return re.sub(r"[^a-zA-Z0-9_]+", "_", raw).strip("_")[:96]


def _clamp(value: Any, min_value: int = 0, max_value: int = 100) -> int:
    return max(min_value, min(max_value, round(float(value or 0))))
