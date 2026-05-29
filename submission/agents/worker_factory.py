"""Worker Factory: schedules and executes workers against the WorldGraph.

Walks chapters in dependency order, picks the right Foundry deployment per
owner_role, produces artifacts, runs validators, and records invocations.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Optional, Tuple

from agents.model_config import get_foundry_client, is_live, model_for
from agents.retrieval import retrieve
from state.schema import Chapter, WorkerInvocation, WorldGraph
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


def execute_chapter(
    chapter: Chapter,
    brief: str,
    previous_artifacts: Optional[List[Dict]] = None,
) -> Tuple[WorkerInvocation, Optional[Dict], int]:
    """Execute a single chapter's worker and return (invocation, artifact, score).

    Returns a deterministic mock if live mode is off.
    """
    role = chapter.owner_role if chapter.owner_role in ROLE_PROMPTS else "strategist"
    deployment = model_for(role) or model_for("narrator") or ""
    client = get_foundry_client()
    deployment_label = f"foundry-{role}" if client and deployment and is_live() else "simulation"
    invocation = WorkerInvocation(
        id=f"inv_{chapter.id}_{int(time.time())}",
        chapter_id=chapter.id,
        role=role,
        deployment=deployment_label,
        started_at=time.time(),
    )

    prompts = ROLE_PROMPTS[role]
    system = prompts["system"]
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

    retrieval_hits = retrieve(f"{brief} {chapter.goal} {chapter.success_metric}", top_k=2)
    if retrieval_hits:
        user += "\n\nFoundry IQ context snippets:\n"
        for hit in retrieval_hits:
            user += f"- Source: {hit['source']} | {hit['content'][:500]}\n"

    if not client or not deployment:
        # Simulation fallback
        artifact = {"note": f"Mock artifact for {chapter.title}", "status": "simulated"}
        invocation.status = "completed"
        invocation.completed_at = time.time()
        invocation.latency_s = 0.1
        return invocation, artifact, 80

    t0 = time.perf_counter()
    try:
        resp = client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_completion_tokens=8000,
        )
        content = resp.choices[0].message.content or ""
        usage = getattr(resp, "usage", None)
        invocation.tokens_in = getattr(usage, "prompt_tokens", 0) or 0
        invocation.tokens_out = getattr(usage, "completion_tokens", 0) or 0
    except Exception as e:
        # Temperature retry for gpt-5.x
        if "temperature" in str(e).lower():
            try:
                resp = client.chat.completions.create(
                    model=deployment,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    max_completion_tokens=8000,
                )
                content = resp.choices[0].message.content or ""
                usage = getattr(resp, "usage", None)
                invocation.tokens_in = getattr(usage, "prompt_tokens", 0) or 0
                invocation.tokens_out = getattr(usage, "completion_tokens", 0) or 0
            except Exception as e2:
                invocation.status = "failed"
                invocation.error = f"{type(e2).__name__}: {e2}"
                invocation.completed_at = time.time()
                invocation.latency_s = round(time.perf_counter() - t0, 2)
                return invocation, None, 0
        else:
            invocation.status = "failed"
            invocation.error = f"{type(e).__name__}: {e}"
            invocation.completed_at = time.time()
            invocation.latency_s = round(time.perf_counter() - t0, 2)
            return invocation, None, 0

    invocation.latency_s = round(time.perf_counter() - t0, 2)
    invocation.completed_at = time.time()
    invocation.status = "completed"

    artifact = _extract_json(content)
    score = _score_artifact(role, artifact)
    return invocation, artifact, score


def run_world(world: WorldGraph, brief: str, auto_approve_threshold: int = 80):
    """Execute all chapters in sequence. Yields (chapter, invocation, artifact, score)."""
    previous_artifacts: List[Dict] = []
    for i, chapter in enumerate(world.chapters):
        # Skip already-completed chapters.
        if chapter.status == "completed":
            if chapter.artifact:
                previous_artifacts.append(chapter.artifact)
            continue

        chapter.status = "in-progress"
        world.current_chapter_index = i

        invocation, artifact, score = execute_chapter(chapter, brief, previous_artifacts)
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
