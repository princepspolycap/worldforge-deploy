"""Worker Factory: schedules and executes workers against the WorldGraph.

Walks chapters in dependency order, picks the right Foundry deployment per
owner_role, produces artifacts, runs validators, and records invocations.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from agents.model_config import get_foundry_client, is_live, model_for, model_for_hint, create_chat_completion, reasoning_from_response
from agents.maf_runtime import maf_available, run_maf_agent
from agents.memory import recall_memories, remember
from agents.retrieval import retrieve
from state.schema import Chapter, OrgBlueprint, OrgRole, WorkerInvocation, WorldGraph
from tools.toolbox import tools_call, tools_for_role
from tools.code_interpreter_wrappers import (
    validate_financial_plan,
    validate_landing_page,
    validate_marketing_email,
    validate_org_chart,
    validate_positioning,
)


# ---------------------------------------------------------------------------
# Role -> prompt template mapping. Each role has a system + user template.
# ---------------------------------------------------------------------------

ROLE_PROMPTS: Dict[str, Dict[str, str]] = {
    "strategist": {
        "system": (
            "You are a lean-startup strategist. Produce a structured JSON artifact "
            "matching the chapter goal. Include: target_audience, core_problem, "
            "value_proposition, primary_benefit, org_chart, okrs_q1 (list of "
            "objectives with key_results). Return ONLY valid JSON."
        ),
        "user": "Company brief: {brief}\n\nChapter goal: {goal}\nSuccess metric: {metric}\n\nProduce JSON.",
    },
    "designer": {
        "system": (
            "You are a product/UX designer. Produce a structured JSON artifact for "
            "the chapter goal. Include landing_page, hero_headline, cta_text, "
            "features, url, integrations, wireframe_notes. The top-level JSON object "
            "must include hero_headline, cta_text, features, and url. Do not wrap "
            "the artifact in chapter_goal or another container key. "
            "Return ONLY valid JSON."
        ),
        "user": "Company brief: {brief}\n\nChapter goal: {goal}\nSuccess metric: {metric}\n\nProduce JSON.",
    },
    "marketer": {
        "system": (
            "You are a growth marketer. Produce a structured JSON artifact for the "
            "chapter goal. Include gtm_channels with expected_cac_usd and "
            "weekly_hours, financial_plan, subject, body. Return ONLY valid JSON."
        ),
        "user": "Company brief: {brief}\n\nChapter goal: {goal}\nSuccess metric: {metric}\n\nProduce JSON.",
    },
    "ops": {
        "system": (
            "You are a startup ops/retention specialist. Produce a structured JSON "
            "artifact for the chapter goal. Include retention loops, churn drivers, "
            "NPS plan, support workflow, and financial_plan with target_mrr_usd_m1_to_m6, "
            "burn_usd_per_month, breakeven_month, and churn_target_pct. Return ONLY valid JSON."
        ),
        "user": "Company brief: {brief}\n\nChapter goal: {goal}\nSuccess metric: {metric}\n\nProduce JSON.",
    },
}

# Human-readable fallback titles when no designed worker is bound to a chapter.
ROLE_TITLES: Dict[str, str] = {
    "strategist": "Strategist",
    "designer": "Designer",
    "marketer": "Marketer",
    "ops": "Operations",
}


# ---------------------------------------------------------------------------
# Org binding: resolve each chapter's owner to one of the dynamically designed
# digital workers (CompanyState.org). This closes the seam between the org the
# LLM designs and the agents that actually do the chapter work.
# ---------------------------------------------------------------------------

# Lifecycle stages in venture order. A chapter is matched to the org role whose
# `lifecycle_stage` fits; archetype owner_role is the fallback signal.
_STAGE_ORDER = ["discovery", "positioning", "mvp", "gtm", "retention", "ops"]

# Archetype owner_role -> the lifecycle stage it most naturally covers.
_ROLE_STAGE = {
    "strategist": "positioning",
    "designer": "mvp",
    "marketer": "gtm",
    "ops": "retention",
}


def stage_for_chapter(chapter: Chapter) -> str:
    """Infer a chapter's lifecycle stage from its id/title/goal, then its role."""
    hay = f"{chapter.id} {chapter.title} {chapter.goal}".lower()
    if "go-to-market" in hay or "go to market" in hay:
        return "gtm"
    for stage in _STAGE_ORDER:
        if stage in hay:
            return stage
    return _ROLE_STAGE.get(chapter.owner_role, "ops")


def _worker_by_id(org: Optional[OrgBlueprint], worker_id: Optional[str]) -> Optional[OrgRole]:
    if not org or not worker_id:
        return None
    for role in org.roles:
        if role.id == worker_id:
            return role
    return None


def resolve_worker_for_chapter(chapter: Chapter, org: Optional[OrgBlueprint]) -> Optional[OrgRole]:
    """Pick the designed digital worker that should own this chapter.

    Prefers an exact lifecycle_stage match among non-human workers; falls back
    to the closest stage by venture order. Returns None when there is no org to
    bind against (callers then use the fixed archetype cast).
    """
    if not org or not getattr(org, "roles", None):
        return None
    workers = [r for r in org.roles if r.kind != "human"]
    if not workers:
        return None

    stage = stage_for_chapter(chapter)
    exact = [r for r in workers if (r.lifecycle_stage or "").lower() == stage]
    if exact:
        return exact[0]

    # No exact stage: choose the worker whose stage is closest in venture order.
    target = _STAGE_ORDER.index(stage) if stage in _STAGE_ORDER else len(_STAGE_ORDER)
    scored = []
    for r in workers:
        rs = (r.lifecycle_stage or "").lower()
        pos = _STAGE_ORDER.index(rs) if rs in _STAGE_ORDER else len(_STAGE_ORDER) + 1
        scored.append((abs(pos - target), r))
    scored.sort(key=lambda item: item[0])
    return scored[0][1] if scored else None


def bind_world_to_org(world: WorldGraph, org: Optional[OrgBlueprint]) -> Dict[str, str]:
    """Stamp each chapter with its owning digital worker. Returns id->title map.

    Idempotent (re-running rebinds) and a safe no-op when there is no org.
    """
    bindings: Dict[str, str] = {}
    if not org:
        return bindings
    for chapter in world.chapters:
        worker = resolve_worker_for_chapter(chapter, org)
        if worker:
            chapter.assigned_worker_id = worker.id
            chapter.assigned_worker_title = worker.title
            bindings[chapter.id] = worker.title
    return bindings


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


def _simple_score(artifact: Dict) -> int:
    """Heuristic validator: score 0-100 based on artifact richness."""
    if not artifact:
        return 0
    keys = len(artifact)
    total_len = len(json.dumps(artifact))
    if keys >= 5 and total_len >= 300:
        return 95
    if keys >= 3 and total_len >= 150:
        return 80
    if keys >= 2:
        return 65
    return 40


def _find_landing_page(value: Any) -> Dict[str, Any]:
    """Find a nested landing_page object in flexible designer outputs."""
    if not isinstance(value, dict):
        return {}
    page = value.get("landing_page")
    if isinstance(page, dict):
        return page
    for nested in value.values():
        if isinstance(nested, dict):
            found = _find_landing_page(nested)
            if found:
                return found
        elif isinstance(nested, list):
            for item in nested:
                found = _find_landing_page(item)
                if found:
                    return found
    return {}


def _landing_payload(artifact: Dict[str, Any]) -> Dict[str, Any]:
    """Adapt nested designer artifacts to the existing landing-page validator."""
    if "hero_headline" in artifact or "cta_text" in artifact:
        return artifact

    page = _find_landing_page(artifact)
    hero = page.get("hero", {}) if isinstance(page.get("hero"), dict) else {}
    raw_cta = page.get("cta") or hero.get("cta") or {}
    cta = raw_cta if isinstance(raw_cta, dict) else {}
    sections = page.get("sections", []) if isinstance(page.get("sections"), list) else []
    candidate_url = artifact.get("url") or page.get("url") or page.get("url_suggestion") or page.get("publish_url") or page.get("hosted_url") or cta.get("link") or ""
    validator_url = candidate_url if isinstance(candidate_url, str) and candidate_url.startswith("http") else "https://example.com/preview"
    features = artifact.get("features") or page.get("features") or sections[:3]
    page_hero = page.get("hero") if isinstance(page.get("hero"), str) else ""
    cta_text = raw_cta if isinstance(raw_cta, str) else ""

    return {
        "hero_headline": page.get("hero_headline") or page.get("headline") or hero.get("headline") or page_hero or artifact.get("headline") or "",
        "cta_text": page.get("cta_text") or cta.get("text") or cta_text or artifact.get("cta_text") or artifact.get("cta") or "",
        "features": features if isinstance(features, str) else json.dumps(features),
        "url": validator_url,
    }


def _score_artifact(role: str, artifact: Optional[Dict[str, Any]]) -> int:
    if not artifact:
        return 0
    validators = []
    if role == "strategist":
        validators = [validate_org_chart, validate_positioning]
    elif role == "designer":
        validators = [lambda data: validate_landing_page(_landing_payload(data))]
    elif role == "marketer":
        validators = [validate_financial_plan, validate_marketing_email]
    elif role == "ops":
        validators = [validate_financial_plan]

    scores = []
    for validator in validators:
        try:
            _, result = validator(artifact)
            scores.append(int(result.get("score", 0)))
        except Exception:
            continue
    scores.append(_simple_score(artifact))
    return max(scores)


# ---------------------------------------------------------------------------
# Rubric evaluation at the gate. The gate score is no longer a single
# hand-rolled number: a rubric (weighted dimensions, judged per artifact)
# produces the breakdown the UI renders, and the deterministic validators
# remain the floor the final score can never fall below.
#   live      -> the narrator deployment judges the artifact against the rubric
#   simulation/error -> a deterministic rubric derived from the validator floor
# ---------------------------------------------------------------------------

RUBRIC_DIMENSIONS = [
    ("Relevance to goal", 30),
    ("Completeness", 25),
    ("Actionability", 25),
    ("Clarity & structure", 20),
]


def _weighted_total(dimensions: List[Dict[str, Any]]) -> int:
    total_w = sum(int(d.get("weight", 0)) for d in dimensions) or 1
    raw = sum(int(d.get("score", 0)) * int(d.get("weight", 0)) for d in dimensions)
    return max(0, min(100, round(raw / total_w)))


def _rubric_from_floor(floor: int) -> Dict[str, Any]:
    """Deterministic rubric breakdown derived from the validator floor.

    Keeps the gate diegetic offline: the same four weighted dimensions render
    after a fresh clone with zero keys, traceably tied to validator results.
    """
    spread = [5, 0, -5, 0]  # mild, deterministic variation around the floor
    dimensions = [
        {"name": name, "weight": weight, "score": max(0, min(100, floor + spread[i])),
         "note": "derived from deterministic validators"}
        for i, (name, weight) in enumerate(RUBRIC_DIMENSIONS)
    ]
    return {
        "dimensions": dimensions,
        "weighted_total": _weighted_total(dimensions),
        "floor": floor,
        "source": "validators",
        "verdict": "Scored by deterministic validators (simulation rubric).",
    }


def rubric_evaluate(chapter: Chapter, brief: str, artifact: Optional[Dict[str, Any]],
                    floor: int) -> Dict[str, Any]:
    """Score an artifact against the gate rubric.

    Returns {dimensions, weighted_total, floor, final, source, verdict}. The
    final gate score is max(floor, weighted_total): the rubric judges quality,
    the validators guarantee the deterministic floor.
    """
    rubric: Dict[str, Any]
    client = get_foundry_client()
    deployment = model_for("narrator")
    if artifact and client and deployment:
        dims_spec = ", ".join(f"{n} (weight {w})" for n, w in RUBRIC_DIMENSIONS)
        try:
            resp = create_chat_completion(
                deployment,
                [
                    {"role": "system", "content": (
                        "You are a strict rubric evaluator for business artifacts. "
                        "Score the artifact 0-100 on each dimension: " + dims_spec + ". "
                        "Return ONLY JSON: {\"dimensions\": [{\"name\", \"weight\", \"score\", "
                        "\"note\" (<=12 words)}], \"verdict\": one sentence}."
                    )},
                    {"role": "user", "content": (
                        f"Venture brief: {brief[:600]}\n"
                        f"Chapter goal: {chapter.goal}\n"
                        f"Success metric: {chapter.success_metric}\n\n"
                        f"Artifact JSON:\n{json.dumps(artifact)[:4000]}"
                    )},
                ],
                max_completion_tokens=2500,
            )
            parsed = _extract_json(resp.choices[0].message.content or "") or {}
            dims = parsed.get("dimensions") or []
            # Re-anchor to our spec: trusted names/weights, model-provided scores.
            by_name = {str(d.get("name", "")).strip().lower(): d for d in dims if isinstance(d, dict)}
            dimensions = []
            for name, weight in RUBRIC_DIMENSIONS:
                d = by_name.get(name.lower(), {})
                dimensions.append({
                    "name": name, "weight": weight,
                    "score": max(0, min(100, int(d.get("score", floor)))),
                    "note": str(d.get("note", ""))[:120],
                })
            rubric = {
                "dimensions": dimensions,
                "weighted_total": _weighted_total(dimensions),
                "floor": floor,
                "source": "foundry",
                "verdict": str(parsed.get("verdict", ""))[:240],
            }
        except Exception:
            rubric = _rubric_from_floor(floor)
    else:
        rubric = _rubric_from_floor(floor)

    rubric["final"] = max(floor, rubric["weighted_total"])
    return rubric


# Validators each archetype can draw as REAL Agent Framework FunctionTools -
# the model calls these mid-run (visible function-calling, not post-hoc checks).
_ROLE_VALIDATORS: Dict[str, Dict[str, Any]] = {
    "strategist": {"validate_positioning": validate_positioning, "validate_org_chart": validate_org_chart},
    "designer": {"validate_landing_page": validate_landing_page},
    "marketer": {"validate_marketing_email": validate_marketing_email, "validate_financial_plan": validate_financial_plan},
    "ops": {"validate_financial_plan": validate_financial_plan},
}


def _maf_tool_fns(role: str) -> Dict[str, Any]:
    """Wrap a role's validators as plain callables for the MAF runtime."""
    def adapt(fn):
        def run(artifact: Dict[str, Any]) -> Dict[str, Any]:
            ok, results = fn(artifact or {})
            return {"success": ok, "results": results}
        return run
    return {name: adapt(fn) for name, fn in _ROLE_VALIDATORS.get(role, {}).items()}


def _short_brief(brief: str, words: int = 6) -> str:
    """Compact a brief into a short product label for mock diagrams."""
    cleaned = re.sub(r"[^A-Za-z0-9 ]", " ", brief or "Venture").strip()
    parts = [w for w in cleaned.split() if w]
    return " ".join(parts[:words]) if parts else "Venture"


def _mock_artifact(role: str, chapter: Chapter, brief: str) -> Dict[str, Any]:
    """Deterministic, diagram-ready artifacts for simulation (no Foundry).

    These mirror the shape of live worker output so the story renderer can
    draw org charts, integration maps, OKR trees and financial plans after a
    fresh `git clone` with zero Azure credentials.
    """
    label = _short_brief(brief)
    if role == "strategist":
        return {
            "target_audience": f"Founders and small teams shipping {label}",
            "core_problem": "Manual, fragmented workflows slow the path to first revenue.",
            "value_proposition": f"Turn {label} into traction with an opinionated, guided workflow.",
            "primary_benefit": "Go from idea to validated launch in days, not months.",
            "org_chart": {
                "Founder / CEO": ["Head of Product", "Head of Growth"],
                "Head of Product": ["Product Designer", "Founding Engineer"],
                "Head of Growth": ["Content Marketer", "Partnerships Lead"],
            },
            "okrs_q1": [
                {
                    "objective": "Validate the wedge with real users",
                    "key_results": [
                        "25 customer interviews completed",
                        "10+ users express clear willingness to pay",
                        "1 sharp ICP documented",
                    ],
                },
                {
                    "objective": "Stand up a working MVP",
                    "key_results": [
                        "Core flow shipped to 5 pilot users",
                        "Activation rate above 40%",
                    ],
                },
            ],
        }
    if role == "designer":
        return {
            "hero_headline": f"Ship {label} without the busywork",
            "cta_text": "Start free",
            "features": ["Guided setup", "One-click publish", "Built-in analytics"],
            "url": "https://example.com/preview",
            "landing_page": {
                "hero": {"headline": f"Ship {label} without the busywork", "cta": {"text": "Start free", "link": "https://example.com/start"}},
                "sections": ["Problem", "Solution", "Social proof", "Pricing"],
            },
            "integrations": {
                "Product App": ["Auth", "Billing", "Analytics"],
                "Billing": ["Stripe"],
                "Analytics": ["PostHog", "Data Warehouse"],
                "Auth": ["Email", "Google OAuth"],
            },
            "wireframe_notes": "Single-column hero, three feature cards, pricing table, footer CTA.",
        }
    if role == "marketer":
        return {
            "subject": f"Launch day: {label} is live",
            "body": "Hey there - we just opened the doors. Here's what you can do in the first five minutes...",
            "gtm_channels": [
                {"channel": "Content / SEO", "expected_cac_usd": 18, "weekly_hours": 8},
                {"channel": "Community (Reddit, Slack)", "expected_cac_usd": 9, "weekly_hours": 6},
                {"channel": "Founder-led outbound", "expected_cac_usd": 25, "weekly_hours": 5},
            ],
            "financial_plan": {
                "target_mrr_usd_m1_to_m6": [500, 1400, 3200, 5800, 9100, 13500],
                "burn_usd_per_month": 6000,
                "breakeven_month": 6,
                "churn_target_pct": 4.5,
            },
        }
    # ops / default
    return {
        "retention_loops": ["Onboarding checklist", "Weekly value email", "In-app milestones"],
        "churn_drivers": ["Unclear first value", "No habit trigger", "Billing surprise"],
        "nps_plan": "Survey at day 14 and day 45; route detractors to founder.",
        "support_workflow": ["Shared inbox", "24h SLA", "Weekly bug triage"],
        "financial_plan": {
            "target_mrr_usd_m1_to_m6": [500, 1400, 3200, 5800, 9100, 13500],
            "burn_usd_per_month": 6000,
            "breakeven_month": 6,
            "churn_target_pct": 4.5,
        },
    }


def _apply_decision_context_to_artifact(artifact: Dict[str, Any], decisions: Optional[List[Dict]]) -> None:
    """Make simulation artifacts reflect the changed company state.

    Live workers receive the same material in their prompt/context provider.
    Offline runs need the visible artifact to move too, so the story stays
    faithful after a fresh clone with no Foundry credentials.
    """
    if not artifact or not decisions:
        return
    latest = decisions[-1]
    consequence = latest.get("consequence") or {}
    after = consequence.get("after") or {}
    summary = latest.get("consequence_summary") or consequence.get("summary") or ""
    artifact["decision_context"] = {
        "latest_ceo_choice": latest.get("option", ""),
        "company_consequence": summary,
        "current_economics": after,
    }
    fin = artifact.get("financial_plan")
    if isinstance(fin, dict) and after.get("monthly_burn_usd"):
        fin["burn_usd_per_month"] = int(after["monthly_burn_usd"])
        fin["runway_months"] = int(after.get("runway_months") or 0)
        fin["assumption_from_ceo_choice"] = summary
    if "okrs_q1" in artifact and summary:
        artifact["okrs_q1"].append({
            "objective": "Execute the CEO consequence deliberately",
            "key_results": [
                summary,
                f"Operate with {after.get('digital_worker_count', '?')} digital workers at ${after.get('monthly_burn_usd', '?')}/mo burn",
            ],
        })


def execute_chapter(
    chapter: Chapter,
    brief: str,
    previous_artifacts: Optional[List[Dict]] = None,
    org: Optional[OrgBlueprint] = None,
    decisions: Optional[List[Dict]] = None,
) -> Tuple[WorkerInvocation, Optional[Dict], int]:
    """Execute a single chapter's worker and return (invocation, artifact, score).

    When an `org` is supplied, the chapter is executed by the dynamically designed
    digital worker that owns it: the worker drives identity, deployment (via its
    `deployment_hint`) and reasoning grounding, while the archetype `role` still
    drives the prompt contract + deterministic validators. `decisions` is the
    CEO's gate-decision ledger (WorldGraph.decisions); when present it is
    injected as binding direction so choices visibly chain across chapters.
    Returns a deterministic mock if live mode is off.
    """
    role = chapter.owner_role if chapter.owner_role in ROLE_PROMPTS else "strategist"

    # Resolve the designed digital worker that owns this chapter (pre-bound id
    # first, else match on lifecycle stage). None == no org -> fixed archetype.
    worker = _worker_by_id(org, chapter.assigned_worker_id) or resolve_worker_for_chapter(chapter, org)
    hint = (worker.deployment_hint if worker else "") or ""
    worker_id = worker.id if worker else ""
    worker_title = worker.title if worker else ROLE_TITLES.get(role, role.title())

    deployment = (model_for_hint(hint) if hint and hint != "n/a" else None) or model_for(role) or model_for("narrator") or ""
    client = get_foundry_client()
    live = bool(client and deployment and is_live())
    if live:
        deployment_label = f"foundry-{hint}" if (worker and hint and hint != "n/a") else f"foundry-{role}"
    else:
        deployment_label = "simulation"

    invocation = WorkerInvocation(
        id=f"inv_{chapter.id}_{int(time.time())}",
        chapter_id=chapter.id,
        role=role,
        worker_id=worker_id,
        worker_title=worker_title,
        deployment=deployment_label,
        started_at=time.time(),
        # The worker draws its tools from the Toolbox by name, up front - the
        # rail renders these before the artifact lands (ludonarrative rule).
        tools_drawn=tools_for_role(role),
    )

    prompts = ROLE_PROMPTS[role]
    system = prompts["system"]
    if worker:
        system += (
            f"\n\nYou are operating as the company's '{worker.title}', a "
            f"{hint or 'reasoning'} digital worker the Org Designer created for this "
            f"venture. Your mandate: {worker.mandate or 'deliver this chapter.'} "
            "Stay true to this role."
        )
    user = prompts["user"].format(
        brief=brief,
        goal=chapter.goal,
        metric=chapter.success_metric,
    )

    # Append context from previous chapters if available.
    if previous_artifacts:
        context_block = "\n\nPrior chapter artifacts (for reference):\n"
        for i, art in enumerate(previous_artifacts[-3:], 1):
            context_block += f"  Chapter {i}: {json.dumps(art)[:500]}\n"
        user += context_block

    retrieval_query = f"{brief} {chapter.goal} {chapter.success_metric}"
    _t_recall = time.perf_counter()
    _recall_res = tools_call("recall", {"query": retrieval_query, "top_k": 2})
    _recall_ms = round((time.perf_counter() - _t_recall) * 1000, 1)
    retrieval_hits = (_recall_res.get("result") or {}).get("hits") or []
    # tools/call receipt: the real recall call, with args and what came back.
    invocation.tool_trace.append({
        "tool": "recall",
        "source": _recall_res.get("source", "local"),
        "args": {"query": retrieval_query[:80], "top_k": 2},
        "result": f"{len(retrieval_hits)} hits: " + (", ".join(str(h.get('source', '')) for h in retrieval_hits[:3]) or "none"),
        "ms": _recall_ms,
    })
    # Proof point: the IQ recall that grounded this run (cited sources when
    # the real Foundry IQ knowledge base answered, local playbooks otherwise).
    invocation.iq_sources = [str(h.get("source", "")) for h in retrieval_hits if h.get("source")]

    # Agent memory (NOT IQ): what the workers have learned from this CEO -
    # gate-decision patterns, founder profile, prior artifact summaries.
    # Foundry Agent Service memory store when configured, local ledger always.
    memories = recall_memories(f"{brief} {chapter.goal}", limit=3)

    # Proof point baseline: memory_injected must be visible on EVERY path
    # (simulation and direct included), not only when MAF carries the run.
    # The MAF path overwrites this with what its ContextProvider actually did.
    injected: List[Dict[str, str]] = []
    for d in (decisions or [])[-3:]:
        text = str(d.get("option", ""))
        if d.get("consequence_summary"):
            text += f" -> {d.get('consequence_summary')}"
        injected.append({"kind": "ceo_decision", "text": text[:120]})
    for h in retrieval_hits[:2]:
        injected.append({"kind": "iq_recall", "text": str(h.get("source", ""))[:120]})
    for m in memories[:3]:
        injected.append({"kind": "agent_memory", "text": str(m.get("text", ""))[:120]})
    invocation.maf_memory = injected

    # Direct-path prompt: decisions + IQ snippets pasted in. The MAF path
    # injects the same context through a ContextProvider instead (framework
    # memory), so it gets the base prompt without these blocks.
    user_direct = user
    if decisions:
        user_direct += "\n\nCEO decisions made at earlier gates (binding direction):\n"
        for d in decisions[-3:]:
            user_direct += (f"- After '{d.get('chapter_title', d.get('chapter_id', ''))}': "
                            f"chose \"{d.get('option', '')}\""
                            + (f" (tradeoff accepted: {d.get('tradeoff', '')})" if d.get('tradeoff') else "")
                            + (f". Consequence now in company state: {d.get('consequence_summary', '')}" if d.get("consequence_summary") else "")
                            + "\n")
        latest = decisions[-1].get("consequence") or {}
        after = latest.get("after") or {}
        if after:
            user_direct += (
                "Current company economics after those choices: "
                f"burn ${after.get('monthly_burn_usd', 0)}/mo, "
                f"{after.get('digital_worker_count', 0)} digital workers, "
                f"proof {after.get('proof', 0)}, trust {after.get('trust', 0)}, "
                f"velocity {after.get('velocity', 0)}, autonomy {after.get('autonomy', 0)}.\n")
        user_direct += ("Your artifact MUST visibly follow the most recent decision and the changed "
                        "company state - reference it where relevant.\n")
    if retrieval_hits:
        user_direct += "\n\nFoundry IQ context snippets:\n"
        for hit in retrieval_hits:
            user_direct += f"- Source: {hit['source']} | {hit['content'][:500]}\n"
    if memories:
        user_direct += "\n\nAgent memory - what you have learned about this CEO (apply it):\n"
        for m in memories:
            user_direct += f"- ({m.get('kind', 'procedural')}) {str(m.get('text', ''))[:300]}\n"

    if not client or not deployment:
        # Simulation fallback: rich, diagram-ready artifacts so the story
        # renders org charts / integration maps / financials offline.
        artifact = _mock_artifact(role, chapter, brief)
        _apply_decision_context_to_artifact(artifact, decisions)
        invocation.status = "completed"
        invocation.completed_at = time.time()
        invocation.latency_s = 0.1
        floor = _score_artifact(role, artifact)
        _trace_validators(invocation, role, artifact)
        rubric = rubric_evaluate(chapter, brief, artifact, floor)
        chapter.rubric = rubric
        _remember_chapter(chapter, worker_title, rubric["final"])
        return invocation, artifact, rubric["final"]

    t0 = time.perf_counter()

    # Preferred live runtime: Microsoft Agent Framework. The worker becomes a
    # real `agent_framework.Agent` - decisions + IQ recall injected through a
    # ContextProvider (framework memory), validators offered as FunctionTools
    # the model can call mid-run. Any failure falls back to the direct path.
    if maf_available():
        try:
            validator_fns = _maf_tool_fns(role)
            maf_system = system + (
                "\n\nYou may call each validation tool AT MOST ONCE on your draft, "
                "then output the final artifact as pure JSON - no commentary."
            )
            content, maf_meta = run_maf_agent(
                deployment=deployment,
                api_key=getattr(client, "api_key", "") or "",
                base_url=str(getattr(client, "base_url", "")) or "",
                name=worker_title or role,
                instructions=maf_system,
                prompt=user,
                decisions=decisions,
                retrieval_hits=retrieval_hits,
                memories=memories,
                tool_fns=validator_fns,
            )
            artifact = _extract_json(content)
            floor = _score_artifact(role, artifact)
            # Quality guard: a weak/unparseable MAF artifact falls through to
            # the direct path rather than reaching the gate half-formed.
            if not artifact or floor < 40:
                raise ValueError(f"MAF artifact too weak (floor={floor})")
            invocation.latency_s = round(time.perf_counter() - t0, 2)
            invocation.completed_at = time.time()
            invocation.status = "completed"
            invocation.framework = "microsoft-agent-framework"
            invocation.maf_client = str(maf_meta.get("maf_client") or "")
            invocation.maf_fallback_reason = str(maf_meta.get("maf_fallback_reason") or "")
            invocation.maf_memory = maf_meta.get("maf_memory") or injected
            invocation.maf_tools_called = sorted(set(maf_meta.get("maf_tools_called") or []))
            invocation.tokens_in = int(maf_meta.get("tokens_in") or 0)
            invocation.tokens_out = int(maf_meta.get("tokens_out") or 0)
            invocation.reasoning_tokens = int(maf_meta.get("reasoning_tokens") or 0)
            # Mid-run FunctionTool receipts (the model calling validators on
            # its own draft) join the same tools/call ledger as recall and the
            # post-hoc sweep - chronological: recall -> mid-run -> sweep.
            invocation.tool_trace.extend(maf_meta.get("maf_tool_trace") or [])
            _trace_validators(invocation, role, artifact)
            rubric = rubric_evaluate(chapter, brief, artifact, floor)
            chapter.rubric = rubric
            _remember_chapter(chapter, worker_title, rubric["final"])
            return invocation, artifact, rubric["final"]
        except Exception:
            # Framework path failed - degrade silently to the direct call.
            t0 = time.perf_counter()

    try:
        resp = create_chat_completion(
            deployment,
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user_direct},
            ],
            max_completion_tokens=8000,
        )
        content = resp.choices[0].message.content or ""
        usage = getattr(resp, "usage", None)
        invocation.tokens_in = getattr(usage, "prompt_tokens", 0) or 0
        invocation.tokens_out = getattr(usage, "completion_tokens", 0) or 0
        # Capture the visible "thinking" signal (reasoning token count and, when
        # the model exposes it, a short chain-of-thought preview) for the trace.
        _r = reasoning_from_response(resp)
        invocation.reasoning_tokens = _r["reasoning_tokens"]
        invocation.reasoning_preview = _r["reasoning_preview"]
    except Exception as e:
        invocation.status = "failed"
        invocation.error = f"{type(e).__name__}: {e}"
        invocation.completed_at = time.time()
        invocation.latency_s = round(time.perf_counter() - t0, 2)
        return invocation, None, 0

    invocation.latency_s = round(time.perf_counter() - t0, 2)
    invocation.completed_at = time.time()
    invocation.status = "completed"

    artifact = _extract_json(content)
    floor = _score_artifact(role, artifact)
    _trace_validators(invocation, role, artifact)
    rubric = rubric_evaluate(chapter, brief, artifact, floor)
    chapter.rubric = rubric
    _remember_chapter(chapter, worker_title, rubric["final"])
    return invocation, artifact, rubric["final"]


def _trace_validators(invocation: WorkerInvocation, role: str, artifact: Optional[Dict[str, Any]]) -> None:
    """Run the role's validators through the toolbox and record each call.

    This is the not-mocked receipt: every entry is a real tools/call with
    arguments, the deterministic result, and wall-clock latency. Runs on all
    paths (simulation included - the validators are real code either way).
    """
    if not artifact:
        return
    for name in tools_for_role(role):
        if name == "recall":
            continue
        payload = _landing_payload(artifact) if name == "validate_landing_page" else artifact
        t0 = time.perf_counter()
        res = tools_call(name, {"artifact": payload})
        ms = round((time.perf_counter() - t0) * 1000, 1)
        r = res.get("result") or {}
        score = r.get("score")
        checks = r.get("checks") or {}
        passed = sum(1 for v in checks.values() if v)
        result_line = (f"score={score} checks {passed}/{len(checks)}" if score is not None
                       else (res.get("error") or str(r)[:80]))
        invocation.tool_trace.append({
            "tool": name,
            "source": res.get("source", "local"),
            "args": {"artifact_keys": list(payload)[:5]},
            "result": result_line,
            "ms": ms,
        })


def _remember_chapter(chapter: Chapter, worker_title: str, score: int) -> None:
    """Write a chat-summary memory after a chapter ships (agent memory loop).

    Best-effort: memory must never break the game loop.
    """
    try:
        remember("chat_summary",
                 f"Chapter '{chapter.title}' shipped by {worker_title} (score {score}/100). "
                 f"Goal: {chapter.goal[:120]}",
                 {"chapter_id": chapter.id, "score": score})
    except Exception:
        pass


def run_world(world: WorldGraph, brief: str, auto_approve_threshold: int = 80,
              org: Optional[OrgBlueprint] = None):
    """Execute all chapters in sequence. Yields (chapter, invocation, artifact, score).

    When `org` is provided, each chapter is executed by its designed digital
    worker (see `execute_chapter`).
    """
    previous_artifacts: List[Dict] = []
    for i, chapter in enumerate(world.chapters):
        # Skip already-completed chapters.
        if chapter.status == "completed":
            if chapter.artifact:
                previous_artifacts.append(chapter.artifact)
            continue

        chapter.status = "in-progress"
        world.current_chapter_index = i

        invocation, artifact, score = execute_chapter(
            chapter, brief, previous_artifacts, org=org, decisions=world.decisions)
        world.invocations.append(invocation)

        if artifact:
            chapter.artifact = artifact
            chapter.validation_score = score
            previous_artifacts.append(artifact)

        if score >= auto_approve_threshold:
            chapter.status = "completed"
        else:
            chapter.status = "needs-review"

        yield chapter, invocation, artifact, score

    # Mark world complete if all chapters done.
    if all(ch.status == "completed" for ch in world.chapters):
        world.status = "completed"
