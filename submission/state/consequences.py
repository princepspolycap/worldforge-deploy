"""Deterministic consequence rules for CEO dilemma choices.

The narrator may phrase dilemmas differently in live mode, but the company
state needs stable mechanics. This module maps a choice to an explicit rule,
mutates the org/economics, and returns a before/after receipt for the UI and
replay log.
"""

import os
import re
import time
from copy import deepcopy
from typing import Any, Dict, List, Optional

from state.schema import Stage, CompanyEconomics, CompanyState, OrgBlueprint, OrgRole
from agents.worker_economics import (
    WORKER_MODEL,
    human_median_fallback_usd,
    monthly_cost_for_role,
)


# Real-time payroll clock: how many real minutes equal one in-game day. At the
# default of 1, every minute the player spends, a day's run cost leaves the
# treasury. Lower it to make the clock tick faster (more pressure).
GAME_MINUTES_PER_DAY = max(0.05, float(os.getenv("GAME_MINUTES_PER_DAY", "1") or 1))
DAYS_PER_MONTH = 30.0

# The antagonist is the lethal meter. Cheap burn means money rarely ends a run,
# so a long idle/away gap (app closed, player reading dossiers, a reload) must
# not let the rival jump straight to defeat on the catch-up tick. The money
# clock still charges the full elapsed time (it is cheap), but the threat meter
# advances at most this many in-game days per observation - the rival climbs
# from engaged play over time, never from the wall-clock running unwatched.
ANTAGONIST_MAX_CATCHUP_DAYS = max(0.5, float(os.getenv("ANTAGONIST_MAX_CATCHUP_DAYS", "3") or 3))

# A solo founder's bootstrap capital: the fixed seed the treasury starts with.
# Because a digital workforce runs cheap, this is a healthy runway - the live
# threat is the antagonist and the narrative meters, not payroll. Env-overridable.
FOUNDER_SEED_USD = max(1000, int(float(os.getenv("FOUNDER_SEED_USD", "25000") or 25000)))


ECON_KEYS = ("proof", "trust", "velocity", "burn_pressure", "autonomy", "runway_months")
DECISION_ROLE_PREFIX = "decision_role"


RULES: Dict[str, Dict[str, Any]] = {
    "strategist.depth": {
        "match": ("depth", "niche", "painful workflow", "moat"),
        "summary": "The company commits to a narrower carbon-mind ICP segment to stabilize portal cohesion.",
        "economics_delta": {"proof": 9, "trust": 7, "velocity": -4, "burn_pressure": 3, "autonomy": 1, "runway_months": -1},
        "revenue_delta": 400,
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
        "revenue_delta": 250,
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
        "revenue_delta": 700,
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
        "revenue_delta": 300,
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
        "revenue_delta": 1500,
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
        "revenue_delta": 2000,
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
        "revenue_delta": 500,
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
        "revenue_delta": 1000,
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
    "ops.shareholder": {
        "match": ("shareholder", "vc", "growth", "blitzscale"),
        "summary": "The company adopts a high-growth shareholder model, accelerating but yielding control.",
        "economics_delta": {"proof": 15, "trust": -10, "velocity": 30, "burn_pressure": 20, "autonomy": -25, "runway_months": 6},
        "revenue_delta": 4000,
        "role": {
            "title": "Corporate Scaling Auditor",
            "mandate": "Monitors VC metrics, tracking infinite-growth compliance and shareholder reports.",
            "kpis": ["Shareholder returns maximized", "Quarterly burn targets checked"],
            "tools": ["financial_scorecard", "board_reporter"],
            "monthly_cost_usd": 1200,
            "lifecycle_stage": "ops",
            "deployment_hint": "ops",
            "why": "Scaling with external capital requires structural oversight to satisfy shareholder demands.",
        },
    },
    "ops.cooperative": {
        "match": ("cooperative", "equilibrium", "dual power", "mutual aid"),
        "summary": "The company transitions to a worker cooperative, operating on equilibrium and dual power.",
        "economics_delta": {"proof": -5, "trust": 30, "velocity": -10, "burn_pressure": -15, "autonomy": 30, "runway_months": -2},
        "revenue_delta": 800,
        "role": {
            "title": "Cooperative Liaison Steward",
            "mandate": "Facilitates democratic worker decisions, linking the coop with unions and mutual aid groups.",
            "kpis": ["Democratic governance metrics", "Mutual aid distribution rate"],
            "tools": ["consensus_builder", "resource_distributor"],
            "monthly_cost_usd": 400,
            "lifecycle_stage": "ops",
            "deployment_hint": "ops",
            "why": "An equilibrium cooperative avoids the demands of infinite growth, building resilient local networks.",
        },
    },
    "custom.default": {
        "match": (),
        "summary": "The company records a custom multiversal constraint and carries it forward.",
        "economics_delta": {"proof": 3, "trust": 3, "velocity": -1, "burn_pressure": 1, "autonomy": 1},
        "revenue_delta": 300,
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
    # A fixed founder seed (bootstrap capital). A digital workforce runs cheap,
    # so this is a real but generous runway - the clock is honest pressure, while
    # the antagonist and narrative meters are the live threat that ends a run.
    treasury = FOUNDER_SEED_USD
    daily_burn = int(round(burn / DAYS_PER_MONTH))
    now = time.time()
    return CompanyEconomics(
        proof=24,
        trust=38,
        velocity=_clamp(38 + worker_count * 5),
        # burn_pressure is a 0-100 narrative meter scaled by team size, NOT raw
        # wage dollars (which now run to tens of thousands).
        burn_pressure=_clamp(10 + worker_count * 5),
        autonomy=_clamp(14 + worker_count * 10),
        monthly_burn_usd=burn,
        runway_months=max(3, 10 - int(burn / 25000)),
        digital_worker_count=worker_count,
        leverage_ratio=round(leverage, 1),
        monthly_revenue_usd=0,
        net_profit_usd=-burn,
        points=treasury,
        treasury_started_usd=treasury,
        started_at_epoch=now,
        last_tick_epoch=now,
        days_elapsed=0.0,
        daily_burn_usd=daily_burn,
        runway_days=int(treasury // max(1, daily_burn)),
        # The market the company competes for. A larger designed workforce
        # implies a bigger ambition (and a bigger addressable market), but every
        # dollar of revenue still has to be WON as market share, stage by stage.
        market_share=0.0,
        addressable_market_usd=_addressable_market_usd(worker_count),
    )


def _addressable_market_usd(worker_count: int) -> int:
    """Monthly addressable market the company is competing for a share of.

    Derived from the designed org size so the headline scales with ambition.
    Kept modest so that winning even a few points of share makes the cheap-burn
    company profitable - the reward for the workforce actually shipping.
    """
    return max(40_000, 40_000 + worker_count * 14_000)


def _recompute_runway(econ: CompanyEconomics) -> None:
    """Recompute net profit and runway from current revenue/burn/treasury.

    Single source for the net+runway math so the decision path and the stage
    outcome path can never drift. Profitable companies show a long runway.
    """
    econ.net_profit_usd = int(econ.monthly_revenue_usd - econ.monthly_burn_usd)
    if econ.net_profit_usd >= 0:
        econ.runway_months = 36
    else:
        econ.runway_months = max(1, min(36, econ.points // max(1, abs(econ.net_profit_usd))))


def _revenue_from_share(econ: CompanyEconomics) -> int:
    """Recurring monthly revenue = the slice of the addressable market the
    company currently holds. Single source so every path that moves market
    share books the same revenue."""
    if not econ.addressable_market_usd:
        econ.addressable_market_usd = _addressable_market_usd(
            int(getattr(econ, "digital_worker_count", 0) or 0))
    return max(0, int(round(econ.market_share / 100.0 * econ.addressable_market_usd)))


def add_market_share(state: CompanyState, share_gain: float, *, deal_fraction: float = 0.0) -> Dict[str, Any]:
    """Win (or cede) a slice of the market and rebook revenue from it.

    The ONE place a market-share change turns into revenue + cash, shared by the
    stage-outcome path and the card layer (e.g. the Customer Signal card). A
    positive gain wins customers: recurring revenue rises with the share held,
    and `deal_fraction` optionally closes a one-time deal into the treasury.
    """
    if state.economics is None:
        state.economics = initialize_economics_from_org(state.org)
    econ = state.economics
    share_before = float(getattr(econ, "market_share", 0.0) or 0.0)
    econ.market_share = round(max(0.0, min(100.0, share_before + share_gain)), 2)
    rev_before = int(econ.monthly_revenue_usd or 0)
    econ.monthly_revenue_usd = _revenue_from_share(econ)
    deal_cash = int(round(econ.monthly_revenue_usd * deal_fraction)) if (deal_fraction and share_gain > 0) else 0
    if deal_cash:
        econ.points = max(0, econ.points + deal_cash)
    _recompute_runway(econ)
    return {
        "share_before": round(share_before, 2),
        "share_after": econ.market_share,
        "share_gain": round(econ.market_share - share_before, 2),
        "revenue_before": rev_before,
        "monthly_revenue_usd": econ.monthly_revenue_usd,
        "deal_cash_usd": deal_cash,
        "net_profit_usd": econ.net_profit_usd,
    }


def tick_economy(state: CompanyState) -> Dict[str, Any]:
    """Advance the real-time payroll clock and charge wages to the treasury.

    Every GAME_MINUTES_PER_DAY of real time equals one in-game day. Each day the
    player pays the workforce its daily wage (and books daily revenue). When the
    treasury can no longer cover payroll the run is lost. This is the single
    place wall-clock time turns into money, so every state read can call it.
    """
    econ = state.economics
    if econ is None:
        return {"ticked": False}
    now = time.time()
    # First observation: anchor the clock, charge nothing yet.
    if not econ.last_tick_epoch:
        econ.started_at_epoch = econ.last_tick_epoch = now
        return {"ticked": False, "days_advanced": 0.0}

    # Freeze the clock once the run is decided.
    game = getattr(state, "game", None)
    if game is not None and getattr(game, "run_status", "active") != "active":
        econ.last_tick_epoch = now
        return {"ticked": False, "days_advanced": 0.0}

    seconds = max(0.0, now - econ.last_tick_epoch)
    days = seconds / (GAME_MINUTES_PER_DAY * 60.0)
    econ.last_tick_epoch = now
    if days <= 0:
        return {"ticked": False, "days_advanced": 0.0}

    daily_burn = econ.monthly_burn_usd / DAYS_PER_MONTH
    daily_rev = econ.monthly_revenue_usd / DAYS_PER_MONTH
    charge = int(round(days * (daily_burn - daily_rev)))
    econ.days_elapsed += days
    econ.points -= charge
    econ.daily_burn_usd = int(round(daily_burn))
    econ.net_profit_usd = int(round(econ.monthly_revenue_usd - econ.monthly_burn_usd))

    net_daily = daily_burn - daily_rev
    econ.runway_days = int(max(0, econ.points) // max(1, int(round(net_daily)))) if net_daily > 0 else 999
    econ.runway_months = max(0, int(econ.runway_days // 30))

    bankrupt = False
    if econ.points <= 0:
        econ.points = 0
        econ.runway_days = 0
        if game is not None and getattr(game, "run_status", "active") == "active":
            game.run_status = "defeat"
            game.defeat_reason = "Out of cash - payroll could not be met."
            bankrupt = True

    # Tie the same elapsed time into the arc: the antagonist gains ground while
    # you operate, so a stalled company loses to the rival (the live threat now
    # that burn is cheap). Lazy import keeps the clock free of import-order risk.
    antagonist: Dict[str, Any] = {}
    try:
        from state.game_state import tick_antagonist_over_time
        # The rival is the lethal meter; bound how much a single catch-up tick
        # can advance it so an idle/away gap can never jump straight to defeat.
        antagonist = tick_antagonist_over_time(state, min(days, ANTAGONIST_MAX_CATCHUP_DAYS))
    except Exception:
        antagonist = {}

    return {"ticked": True, "days_advanced": round(days, 3),
            "charged_usd": charge, "treasury_usd": econ.points,
            "bankrupt": bankrupt, "antagonist": antagonist}


# Market share is won unevenly by role: the marketer's GTM work moves share the
# most, the strategist's positioning the least directly (it compounds later).
_ROLE_MARKET_WEIGHT = {
    "strategist": 0.7,
    "designer": 1.0,
    "marketer": 1.7,
    "ops": 1.1,
}
# A perfect, uncontested stage win captures about this many points of share.
_BASE_SHARE_STEP = float(os.getenv("MARKET_SHARE_STEP", "3.0") or 3.0)


def apply_stage_outcome(state: CompanyState, stage: Stage, score: int) -> Dict[str, Any]:
    """Turn a shipped stage into earned market share, revenue, and cash.

    The single source of truth for what a stage RESULT does to the economy
    (the decision path owns what a CEO CHOICE does). Points are no longer a
    flat per-role number: a verified artifact wins market share weighted by the
    worker's role and dampened by how hard the antagonist is contesting the
    market; revenue is derived from the share actually held; shipping closes a
    proportional one-time deal into the treasury. A failed gate cedes a little
    share to the rival, so quality matters.
    """
    if state.economics is None:
        state.economics = initialize_economics_from_org(state.org)
    econ = state.economics
    if not econ.addressable_market_usd:
        econ.addressable_market_usd = _addressable_market_usd(
            int(getattr(econ, "digital_worker_count", 0) or 0))

    passed = score >= 80
    role = stage.owner_role or "strategist"
    weight = _ROLE_MARKET_WEIGHT.get(role, 1.0)

    # The antagonist contests the market: the higher the rival's threat, the
    # less of the market each win captures (they are taking share too). This is
    # the economic face of the antagonist - not just a separate kill meter.
    threat = 0
    arc = getattr(state.game, "antagonist_arc", None) if getattr(state, "game", None) else None
    if arc is not None:
        threat = int(getattr(arc, "threat_level", 0) or 0)
    contest = max(0.15, 1.0 - threat / 130.0)

    share_before = float(getattr(econ, "market_share", 0.0) or 0.0)
    if passed:
        share_gain = round((score / 100.0) * weight * contest * _BASE_SHARE_STEP, 2)
    else:
        # A weak artifact loses ground: the rival picks up the doubt.
        share_gain = -round(weight * 0.4, 2)

    # Shipping closes a proportional one-time deal into the treasury (cash now,
    # on top of the recurring revenue that the real-time clock books over days).
    # Single source for the share->revenue->cash math (shared with the card layer).
    booked = add_market_share(state, share_gain, deal_fraction=0.25 if passed else 0.0)
    deal_cash = booked["deal_cash_usd"]

    if state.org:
        econ.monthly_burn_usd = state.org.monthly_burn_usd
        econ.digital_worker_count = state.org.digital_worker_count
        econ.leverage_ratio = state.org.leverage_ratio
    _recompute_runway(econ)

    return {
        "score": int(score),
        "passed": passed,
        "role": role,
        "role_weight": weight,
        "antagonist_threat": threat,
        "contest_factor": round(contest, 3),
        "share_before": round(share_before, 2),
        "share_after": econ.market_share,
        "share_gain": round(econ.market_share - share_before, 2),
        "monthly_revenue_usd": econ.monthly_revenue_usd,
        "deal_cash_usd": deal_cash,
        "net_profit_usd": econ.net_profit_usd,
        "addressable_market_usd": econ.addressable_market_usd,
    }


def apply_decision_consequence(
    state: CompanyState,
    stage: Stage,
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

    rule_id = select_rule_id(stage.owner_role, choice, bool(choice.get("custom")))
    rule = RULES[rule_id]
    role_id = ""
    if state.org:
        role_id = _upsert_consequence_role(state.org, stage, rule_id, rule)
        _recompute_org_stats(state.org)

    _apply_economics_delta(state, rule.get("economics_delta") or {})

    # Apply the decision's revenue effect as a market-share move, so revenue
    # stays single-sourced from share (a CEO choice wins or cedes customers,
    # never a raw dollar figure the next stage would overwrite).
    revenue_delta = int(rule.get("revenue_delta") or 0)
    if revenue_delta and state.economics.addressable_market_usd:
        share_delta = revenue_delta / float(state.economics.addressable_market_usd) * 100.0
        state.economics.market_share = round(
            max(0.0, min(100.0, float(state.economics.market_share or 0.0) + share_delta)), 2)
    state.economics.monthly_revenue_usd = _revenue_from_share(state.economics)

    # Competitor & Villain narrative hooks based on decision rules
    if rule_id == "strategist.breadth":
        state.business_flags["competitor_leakage"] = True
        if state.org:
            _append_org_note(state.org, "Competitor warning: Technical rival maps adjacent fronts, matching our broad focus.")
    elif rule_id == "designer.ship":
        state.business_flags["competitor_friction"] = True
        if state.org:
            _append_org_note(state.org, "Market tension: Early release prompts rival mainframe clone to poach user feedback loops.")
    elif rule_id == "marketer.adoption":
        state.business_flags["competitor_pricing_clash"] = True
        if state.org:
            _append_org_note(state.org, "Pricing clash: Oligarchy competitor launches low-cost automated peaker against our grassroots.")
    elif rule_id == "ops.automate":
        state.business_flags["competitor_churn_risk"] = True
        if state.org:
            _append_org_note(state.org, "Support warning: Competitor targeting customers frustrated by our auto-macros.")
    elif rule_id == "ops.shareholder":
        state.business_flags["competitor_consolidation"] = True
        if state.org:
            _append_org_note(state.org, "Mainframe pressure: Shareholder directives push for rapid consolidation to compete with rival peakers.")
    elif rule_id == "ops.cooperative":
        state.business_flags["coop_alliance_active"] = True
        if state.org:
            _append_org_note(state.org, "Cooperative alliance: Dual-power network maps mutual aid pools, neutralizing competitor pressures.")

    if state.org:
        state.economics.monthly_burn_usd = state.org.monthly_burn_usd
        state.economics.digital_worker_count = state.org.digital_worker_count
        state.economics.leverage_ratio = state.org.leverage_ratio
        _append_org_note(state.org, f"{stage.title}: {rule['summary']}")

    # Recompute net profit and runway months dynamically
    _recompute_runway(state.economics)

    after = _snapshot(state)
    return {
        "rule_id": rule_id,
        "summary": rule["summary"],
        "economics_delta": deepcopy(rule.get("economics_delta") or {}),
        "org_delta": {
            "added_role_id": role_id,
            "added_role_title": (rule.get("role") or {}).get("title", ""),
            "monthly_cost_usd": int(_added_role_cost(state.org, role_id)),
        },
        "before": before,
        "after": after,
    }


def _added_role_cost(org: Optional[OrgBlueprint], role_id: str) -> int:
    """Real metered cost of the role just added by a decision (0 if none)."""
    if not org or not role_id:
        return 0
    for r in org.roles:
        if r.id == role_id:
            return int(r.monthly_cost_usd or 0)
    return 0


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
    stage: Stage,
    rule_id: str,
) -> Dict[str, Any]:
    """Return the consequence receipt for a rule without mutating live state."""
    shadow = deepcopy(state)
    preview_stage = next(
        (s for s in (shadow.world.stages if shadow.world else []) if s.id == stage.id),
        stage,
    )
    return apply_decision_consequence(
        shadow,
        preview_stage,
        {"rule_id": rule_id, "option": "", "tradeoff": ""},
    )


def _upsert_consequence_role(org: OrgBlueprint, stage: Stage, rule_id: str, rule: Dict[str, Any]) -> str:
    role_id = _role_id(stage.id, rule_id)
    org.roles = [r for r in org.roles if r.id != role_id]
    spec = rule["role"]
    parent_id = stage.assigned_worker_id or _parent_role_id(org, stage.owner_role)
    kind = spec.get("kind", "digital_worker")
    lifecycle = spec.get("lifecycle_stage", stage.owner_role)
    deploy_hint = spec.get("deployment_hint", stage.owner_role)
    # A worker hired by a CEO decision is paid the same way as any worker: the
    # player runs payroll and pays its normal wage (the burn). The cheap compute
    # to actually run it is tracked separately for the efficiency story.
    if kind == "human":
        run_cost = int(spec.get("monthly_cost_usd") or 0)
        inference = 0
        human_median = 0
        runs_on = ""
    else:
        # Burn = the real, cheap cost of running this worker (same pinned model
        # as the rest of the workforce). human_median is what a person in the
        # seat would cost - kept only for the savings headline, never charged.
        human_median = human_median_fallback_usd(lifecycle, "ic")
        inference = monthly_cost_for_role(deploy_hint, WORKER_MODEL)
        run_cost = inference
        runs_on = WORKER_MODEL
    org.roles.append(OrgRole(
        id=role_id,
        title=spec["title"],
        kind=kind,
        mandate=spec["mandate"],
        reports_to=parent_id,
        kpis=list(spec.get("kpis") or []),
        tools=list(spec.get("tools") or []),
        deployment_hint=deploy_hint,
        lifecycle_stage=lifecycle,
        seniority="ic",
        monthly_cost_usd=run_cost,
        inference_usd=inference,
        runs_on_model=runs_on,
        human_median_usd=human_median,
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
    old_rule_id = consequence.get("rule_id")
    if old_rule_id and old_rule_id in RULES:
        old_rev_delta = int(RULES[old_rule_id].get("revenue_delta") or 0)
        if old_rev_delta and state.economics and state.economics.addressable_market_usd:
            share_delta = old_rev_delta / float(state.economics.addressable_market_usd) * 100.0
            state.economics.market_share = round(
                max(0.0, min(100.0, float(state.economics.market_share or 0.0) - share_delta)), 2)
            state.economics.monthly_revenue_usd = _revenue_from_share(state.economics)


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


def world_snapshot(state: CompanyState) -> Dict[str, Any]:
    """Current world-model snapshot: the company as it exists right now.

    Single source of truth for the world-state shape - used both for the
    before/after decision receipts and for briefing each worker (so the LLM
    reasons against the live company, not the original pitch). Callers may add
    an `antagonist_threat` key for narrative pressure.
    """
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
        "monthly_revenue_usd": econ.monthly_revenue_usd,
        "net_profit_usd": econ.net_profit_usd,
        "points": econ.points,
        "market_share": round(float(getattr(econ, "market_share", 0.0) or 0.0), 2),
    }


# Back-compat alias for internal callers (before/after receipts).
_snapshot = world_snapshot


def _recompute_org_stats(org: OrgBlueprint) -> None:
    org.headcount = len(org.roles)
    org.human_count = sum(1 for r in org.roles if r.kind == "human")
    org.digital_worker_count = sum(1 for r in org.roles if r.kind != "human")
    org.monthly_burn_usd = sum(int(r.monthly_cost_usd or 0) for r in org.roles)
    org.monthly_inference_usd = sum(int(getattr(r, "inference_usd", 0) or 0) for r in org.roles)
    org.monthly_human_equivalent_usd = sum(int(getattr(r, "human_median_usd", 0) or 0) for r in org.roles)
    org.monthly_savings_usd = max(0, org.monthly_human_equivalent_usd - org.monthly_burn_usd)
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


def _role_id(stage_id: str, rule_id: str) -> str:
    raw = f"{DECISION_ROLE_PREFIX}_{stage_id}_{rule_id}"
    return re.sub(r"[^a-zA-Z0-9_]+", "_", raw).strip("_")[:96]


def _clamp(value: Any, min_value: int = 0, max_value: int = 100) -> int:
    return max(min_value, min(max_value, round(float(value or 0))))
