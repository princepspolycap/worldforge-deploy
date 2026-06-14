"""WorldDesigner agent: produces a full venture WorldGraph from a brief.

Deployment: NARRATOR_MODEL from the local Foundry configuration.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from agents.model_config import get_foundry_client, model_for, create_chat_completion


SYSTEM = (
    "You are the World Designer for an interactive startup-RPG built on Dan Harmon's "
    "Story Circle (the Hero's Journey). The game's theme is a post-capitalist grassroots "
    "movement: automating a one-person business, distributing dividends, building worker "
    "cooperatives, creating dual power with unions/mutual aid, and weathering the collapse "
    "of infinite growth against systemic villains (The Automation Cartel, The Shareholder "
    "Syndicate, The Dopamine Cartel, and The Process Oligarchy). "
    "Given a company brief, produce a structured JSON quest graph with exactly 8 stages, "
    "one for each beat of Dan Harmon's Story Circle:\n"
    "1. YOU (stage_1_you): Ordinary zone of comfort; the founder's current skill loop.\n"
    "2. NEED (stage_2_need): Something is wrong; the founder needs independence and leverage.\n"
    "3. GO (stage_3_go): Crossing the threshold into the market with a clear promise.\n"
    "4. SEARCH (stage_4_search): Road of trials; building the AI workforce and MVP loop.\n"
    "5. FIND (stage_5_find): Traction appears; the founder discovers the thing that works.\n"
    "6. TAKE (stage_6_take): The win has a cost; overhead, rivalry, and moral pressure arrive.\n"
    "7. RETURN (stage_7_return): Bring the hard-won system back to the community and operating model.\n"
    "8. CHANGE (stage_8_change): The founder chooses cooperative equilibrium over infinite-growth capture.\n\n"
    "Each stage must have a title, goal, and success metric using this grassroots cooperative automation theme, "
    "while keeping the standard stage IDs in order "
    "(stage_1_you, stage_2_need, stage_3_go, stage_4_search, stage_5_find, stage_6_take, stage_7_return, stage_8_change) "
    "and owner roles. Also emit a short `run_name`: a 1-3 word venture name drawn from the brief's core "
    "offering (e.g. 'Solar microgrids for rural clinics' -> 'Solar Microgrids'), not a generic phrase. "
    "Return ONLY a valid JSON object."
)

USER_TEMPLATE = """\
Brief: {brief}

Return JSON:
{{
  "run_name": "[1-3 word venture name from the brief's core offering, e.g., Solar Microgrids]",
  "stages": [
    {{
      "id": "stage_1_you",
      "title": "YOU: [Title matching beat 1, e.g., The Skill Loop You Already Live In]",
      "goal": "[Goal, e.g., Surface the founder's lived skill, constraints, and current comfort zone]",
      "owner_role": "strategist",
      "success_metric": "[Metric, e.g., Document 3 founder assets and 3 constraints with evidence]",
      "depends_on": [],
      "suggested_tools": ["foundry_iq", "web_search"]
    }},
    {{
      "id": "stage_2_need",
      "title": "NEED: [Title matching beat 2, e.g., The Need the Machine Cannot Meet]",
      "goal": "[Goal, e.g., Identify the unmet need and the villain pressure that forces action]",
      "owner_role": "strategist",
      "success_metric": "[Metric, e.g., Validate 10 urgent needs and name the core tradeoff]",
      "depends_on": ["stage_1_you"],
      "suggested_tools": ["foundry_iq", "code_interpreter"]
    }},
    {{
      "id": "stage_3_go",
      "title": "GO: [Title matching beat 3, e.g., Crossing into the Service Commons]",
      "goal": "[Goal, e.g., Position the venture promise against the villain's default market logic]",
      "owner_role": "strategist",
      "success_metric": "[Metric, e.g., Produce one sharp positioning artifact and ICP wedge]",
      "depends_on": ["stage_2_need"],
      "suggested_tools": ["code_interpreter"]
    }},
    {{
      "id": "stage_4_search",
      "title": "SEARCH: [Title matching beat 4, e.g., Forging the Automata Workforce]",
      "goal": "[Goal, e.g., Design a low-overhead MVP dashboard and digital worker templates]",
      "owner_role": "designer",
      "success_metric": "[Metric, e.g., Ship a prototype loop with first passive income signals]",
      "depends_on": ["stage_3_go"],
      "suggested_tools": ["code_interpreter", "deploy_page"]
    }},
    {{
      "id": "stage_5_find",
      "title": "FIND: [Title matching beat 5, e.g., The Traction Signal]",
      "goal": "[Goal, e.g., Find the adoption channel and customer proof the villain cannot fake]",
      "owner_role": "marketer",
      "success_metric": "[Metric, e.g., Identify 3 reachable channels and one proof-backed launch motion]",
      "depends_on": ["stage_4_search"],
      "suggested_tools": ["email_sender", "web_search"]
    }},
    {{
      "id": "stage_6_take",
      "title": "TAKE: [Title matching beat 6, e.g., The Operational Toll]",
      "goal": "[Goal, e.g., Account for burn, support, rivalry, and the cost of sustaining traction]",
      "owner_role": "ops",
      "success_metric": "[Metric, e.g., Produce a runway and support plan that keeps trust above 80%]",
      "depends_on": ["stage_5_find"],
      "suggested_tools": ["code_interpreter", "foundry_iq"]
    }},
    {{
      "id": "stage_7_return",
      "title": "RETURN: [Title matching beat 7, e.g., Bring the Loop Home]",
      "goal": "[Goal, e.g., Return the working system to the community, workforce, and governance model]",
      "owner_role": "ops",
      "success_metric": "[Metric, e.g., Define a worker-owned operating cadence and stakeholder ledger]",
      "depends_on": ["stage_6_take"],
      "suggested_tools": ["code_interpreter", "foundry_iq"]
    }},
    {{
      "id": "stage_8_change",
      "title": "CHANGE: [Title matching beat 8, e.g., Cooperative Equilibrium]",
      "goal": "[Goal, e.g., Lock the final choice between shareholder growth and cooperative equilibrium]",
      "owner_role": "ops",
      "success_metric": "[Metric, e.g., Transition governance to democratic consensus, maintaining 90%+ community trust]",
      "depends_on": ["stage_7_return"],
      "suggested_tools": ["code_interpreter", "foundry_iq"]
    }}
  ]
}}

Exactly 8 stages with these exact IDs and owner_roles.
"""

FALLBACK_STAGES = [
    {
        "id": "stage_1_you",
        "title": "YOU: The Skill Loop You Already Live In",
        "goal": "Surface the founder's lived skill, constraints, and current comfort zone before the system notices",
        "owner_role": "strategist",
        "success_metric": "Document 3 founder assets and 3 constraints with evidence",
        "depends_on": [],
        "suggested_tools": ["foundry_iq", "web_search"],
    },
    {
        "id": "stage_2_need",
        "title": "NEED: The Need the Machine Cannot Meet",
        "goal": "Identify the unmet need and the villain pressure that forces the founder out of comfort",
        "owner_role": "strategist",
        "success_metric": "Validate 10 urgent needs and name the core tradeoff",
        "depends_on": ["stage_1_you"],
        "suggested_tools": ["foundry_iq", "code_interpreter"],
    },
    {
        "id": "stage_3_go",
        "title": "GO: Crossing into the Service Commons",
        "goal": "Position the venture promise against the villain's default market logic",
        "owner_role": "strategist",
        "success_metric": "Produce one sharp positioning artifact and ICP wedge",
        "depends_on": ["stage_2_need"],
        "suggested_tools": ["code_interpreter"],
    },
    {
        "id": "stage_4_search",
        "title": "SEARCH: Forging the Automata Workforce",
        "goal": "Design a low-overhead MVP service landing spec and digital worker templates",
        "owner_role": "designer",
        "success_metric": "Ship a prototype loop with first passive income signals to fund basic needs",
        "depends_on": ["stage_3_go"],
        "suggested_tools": ["code_interpreter", "deploy_page"],
    },
    {
        "id": "stage_5_find",
        "title": "FIND: The Traction Signal",
        "goal": "Find the adoption channel and customer proof the villain cannot fake",
        "owner_role": "marketer",
        "success_metric": "Identify 3 reachable channels and one proof-backed launch motion",
        "depends_on": ["stage_4_search"],
        "suggested_tools": ["email_sender", "web_search"],
    },
    {
        "id": "stage_6_take",
        "title": "TAKE: The Operational Toll",
        "goal": "Account for burn, support, rivalry, and the cost of sustaining traction",
        "owner_role": "ops",
        "success_metric": "Produce a runway and support plan that keeps trust above 80%",
        "depends_on": ["stage_5_find"],
        "suggested_tools": ["code_interpreter", "foundry_iq"],
    },
    {
        "id": "stage_7_return",
        "title": "RETURN: Bring the Loop Home",
        "goal": "Return the working system to the community, workforce, and governance model",
        "owner_role": "ops",
        "success_metric": "Define a worker-owned operating cadence and stakeholder ledger",
        "depends_on": ["stage_6_take"],
        "suggested_tools": ["code_interpreter", "foundry_iq"],
    },
    {
        "id": "stage_8_change",
        "title": "CHANGE: Cooperative Equilibrium",
        "goal": "Lock the final choice between shareholder growth and cooperative equilibrium",
        "owner_role": "ops",
        "success_metric": "Transition governance to democratic consensus, maintaining 90%+ community trust",
        "depends_on": ["stage_7_return"],
        "suggested_tools": ["code_interpreter", "foundry_iq"],
    },
]


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
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "stage"


def _normalize_stages(stages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Make model-produced stages safe for Pydantic + scheduling."""
    allowed_roles = {"strategist", "designer", "marketer", "ops"}
    normalized: List[Dict[str, Any]] = []
    seen_ids = set()

    source_stages = stages if isinstance(stages, list) and len(stages) >= 8 else FALLBACK_STAGES

    for idx, raw in enumerate(source_stages[:8], 1):
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or f"Stage {idx}")
        stage_id = str(raw.get("id") or f"stage_{idx}_{_slugify(title)[:32]}")
        if stage_id in seen_ids:
            stage_id = f"{stage_id}_{idx}"
        seen_ids.add(stage_id)

        owner_role = str(raw.get("owner_role") or "strategist").lower()
        if owner_role not in allowed_roles:
            owner_role = "strategist"

        depends_on = raw.get("depends_on") or []
        if not isinstance(depends_on, list):
            depends_on = [str(depends_on)]

        suggested_tools = raw.get("suggested_tools") or ["code_interpreter"]
        if not isinstance(suggested_tools, list):
            suggested_tools = [str(suggested_tools)]

        normalized.append({
            "id": stage_id,
            "title": title,
            "goal": str(raw.get("goal") or "Produce a useful startup artifact."),
            "owner_role": owner_role,
            "success_metric": str(raw.get("success_metric") or "Human reviewer approves the artifact."),
            "depends_on": [str(item) for item in depends_on],
            "suggested_tools": [str(item) for item in suggested_tools],
        })

    return normalized if len(normalized) == 8 else FALLBACK_STAGES


def design_world_named(brief: str) -> tuple[str, List[Dict[str, Any]]]:
    """Call the configured narrator deployment for the 8-stage world + a run name.

    Returns (run_name, stages). The run_name is the model's own venture name when
    the live path answers and it survives `derive_run_name`'s guards (so a generic
    phrase is rejected); empty string otherwise. Simulation/cold-start returns the
    fallback stages with no name, leaving naming to the deterministic pitch path.
    """
    client = get_foundry_client()
    deployment = model_for("narrator")
    if not client or not deployment:
        return "", FALLBACK_STAGES

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
        if parsed and isinstance(parsed.get("stages"), list) and len(parsed["stages"]) >= 8:
            # Validate the model's name through the same guards as the pitch path
            # so a generic/garbled name is dropped rather than shown.
            run_name = derive_run_name(str(parsed.get("run_name") or ""), fallback="")
            return run_name, _normalize_stages(parsed["stages"])
    except Exception:
        pass
    return "", _normalize_stages(FALLBACK_STAGES)


def design_world(brief: str) -> List[Dict[str, Any]]:
    """Back-compat wrapper: the 8-stage world graph (stages only)."""
    return design_world_named(brief)[1]


# Generic run names the UI/server seed when the founder never typed a company
# name (the LinkedIn-first onboarding asks for a URL, not a name). When the run
# still carries one of these, we name it from the pitch instead so saved data
# reads as THIS founder's run, not a placeholder.
PLACEHOLDER_RUN_NAMES = {
    "world improvement mission", "questforge ltd.", "my spawned venture",
    "acolyte's venture", "a venture", "", "untitled",
}

# Leading identity/selling words to peel off the front of a pitch, one at a time,
# until a noun phrase is exposed. Deterministic, no model needed.
_NAME_LEAD_WORDS = {
    "solo", "founder", "founders", "i", "im", "i'm", "am", "a", "an", "the",
    "we", "we're", "were", "are", "is", "my", "our", "this", "startup", "company",
    "platform", "app", "application", "service", "tool", "business", "product",
    "selling", "building", "build", "making", "make", "creating", "create",
    "launching", "launch", "offering", "offer", "providing", "provide",
    "developing", "develop", "running", "operating",
}
# Where the head noun phrase ends - the first preposition/conjunction/clause word.
_NAME_STOP_WORDS = {
    "for", "to", "that", "which", "with", "across", "using", "so", "serving",
    "helping", "connecting", "and", "of", "in", "on", "at", "by", "via", "from",
    "where", "while", "aimed", "targeting", "built", "powered",
}
# First word must not be one of these (a name that opens on a verb reads wrong).
_NAME_BAD_HEAD = {
    "selling", "building", "making", "creating", "helping", "connecting",
    "providing", "offering", "launching", "developing", "running", "that",
    "which", "is", "are", "the", "a", "an",
}
# Tokens that should keep their existing casing (acronyms) when title-casing.
_ACRONYMS = {"AI", "B2B", "B2C", "API", "ML", "AR", "VR", "NFT", "DAO", "EV",
             "HR", "CRM", "SEO", "DTC", "P2P"}
_ACRONYM_MIXED = {"SAAS": "SaaS", "IOT": "IoT", "3D": "3D"}


def _smart_title(text: str) -> str:
    out = []
    for tok in text.split():
        bare = tok.strip(".,").upper()
        if bare in _ACRONYMS:
            out.append(bare)
        elif bare in _ACRONYM_MIXED:
            out.append(_ACRONYM_MIXED[bare])
        else:
            # Title-case each hyphen part so "AI-built" -> "AI-Built".
            parts = tok.split("-")
            fixed = []
            for p in parts:
                pu = p.upper()
                fixed.append(pu if pu in _ACRONYMS else (p[:1].upper() + p[1:]))
            out.append("-".join(fixed))
    return " ".join(out)


def derive_run_name(pitch: str, fallback: str = "") -> str:
    """Deterministically name the run from the founder's pitch.

    Peels selling/identity lead-ins off the front and cuts at the first
    preposition to surface the core offering ('Solar microgrids for rural
    clinics' -> 'Solar Microgrids'). Deliberately conservative: returns
    `fallback` unless the result is a clean 1-3 word noun phrase that does not
    open on a verb - a placeholder beats a mangled name.
    """
    raw = (pitch or "").strip()
    if not raw:
        return fallback
    # Tokenize on whitespace, normalize punctuation we don't want in a name.
    tokens = re.sub(r"[\"'`]+", "", raw).replace(",", " ").split()
    # Peel leading identity/selling words.
    i = 0
    while i < len(tokens) and tokens[i].lower().strip(".,") in _NAME_LEAD_WORDS:
        i += 1
    # Collect the head noun phrase up to the first stop word.
    head: List[str] = []
    for tok in tokens[i:]:
        if tok.lower().strip(".,") in _NAME_STOP_WORDS:
            break
        head.append(tok.strip(".,"))
        if len(head) >= 3:  # keep names tight
            break
    if not head:
        return fallback
    if head[0].lower() in _NAME_BAD_HEAD:
        return fallback
    name = _smart_title(" ".join(head))
    letters = sum(c.isalpha() for c in name)
    if not (1 <= len(head) <= 3 and 3 <= len(name) <= 40 and letters >= 3):
        return fallback
    return name


# ---------------------------------------------------------------------------
# Living world graph: after a CEO decision, the not-yet-played stages bend to
# reflect the company as it now exists (world_state) and the choice just made.
# The Story Circle skeleton is preserved - ids, owner_roles, depends_on, and
# stage count never change; only title/goal/success_metric adapt. Adaptation
# always recomposes from each stage's captured base text, so it is idempotent.
# ---------------------------------------------------------------------------

ADAPT_SYSTEM = (
    "You are the World Designer of a startup-RPG, mid-run. The 8-stage Story Circle "
    "is fixed, but the company has changed: stages already played, a CEO decision just "
    "landed, and the live metrics moved. Rewrite ONLY the still-pending stages so the "
    "quest line visibly bends to the company that now exists. Keep each stage's beat "
    "(the 'BEAT:' title prefix), its owner_role, and its intent; sharpen the title, goal, "
    "and success_metric to fit the current proof/trust/velocity/burn/runway/threat and "
    "the latest CEO choice. Return ONLY JSON: "
    "{\"stages\": [{\"id\": str, \"title\": str, \"goal\": str, \"success_metric\": str}, ...]}."
)


def _pressure_lens(ws: Dict[str, Any]) -> str:
    """Single most-pressing constraint from the live world-state -> directive."""
    def _n(key: str) -> int:
        try:
            return int(ws.get(key, 0) or 0)
        except (TypeError, ValueError):
            return 0
    runway, burn = _n("runway_months"), _n("burn_pressure")
    trust, threat, proof = _n("trust"), _n("antagonist_threat"), _n("proof")
    if runway <= 3 or burn >= 70:
        return "With runway tight, prioritize moves that pay for themselves quickly"
    if trust <= 30:
        return "With trust fragile, lead with proof the customer can verify"
    if threat >= 60:
        return "With the rival pressing, defend the wedge before expanding"
    if proof >= 70:
        return "With proof established, convert it into repeatable scale"
    return "Hold the current advantage and compound it"


def _adapt_deterministic(downstream: List[Any], ws: Dict[str, Any], latest: Dict[str, Any]) -> List[str]:
    """Offline-safe adaptation: recompose each pending stage from its base text."""
    clause = _pressure_lens(ws)
    option = str(latest.get("option") or "").strip()
    changed: List[str] = []
    for stage in downstream:
        base_goal = stage.base_goal or stage.goal
        stage.goal = f"{clause}: {base_goal}"
        base_metric = stage.base_success_metric or stage.success_metric
        if option:
            stage.success_metric = f"{base_metric} Honor the CEO call: '{option[:60]}'."
        else:
            stage.success_metric = base_metric
        changed.append(stage.id)
    return changed


def _adapt_via_llm(deployment: str, brief: str, played: List[Any], downstream: List[Any],
                   ws: Dict[str, Any], latest: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    """Narrator rewrites pending stages from their base intent + live state."""
    played_lines = "\n".join(f"- {s.title} ({s.status})" for s in played) or "- (none yet)"
    pending_payload = [{
        "id": s.id,
        "owner_role": s.owner_role,
        "title": s.title,
        "base_goal": s.base_goal or s.goal,
        "base_success_metric": s.base_success_metric or s.success_metric,
    } for s in downstream]
    user = (
        f"Brief: {brief[:400]}\n\n"
        f"Stages already played:\n{played_lines}\n\n"
        f"Live company world-state: {json.dumps(ws)}\n"
        f"Latest CEO decision: {json.dumps({k: latest.get(k) for k in ('option', 'tradeoff', 'consequence_summary')})}\n\n"
        f"Still-pending stages to rewrite (keep id + beat prefix + intent):\n{json.dumps(pending_payload)}"
    )
    resp = create_chat_completion(
        deployment,
        [{"role": "system", "content": ADAPT_SYSTEM}, {"role": "user", "content": user}],
        max_completion_tokens=4000,
    )
    content = resp.choices[0].message.content or ""
    parsed = _extract_json(content)
    out: Dict[str, Dict[str, str]] = {}
    if parsed and isinstance(parsed.get("stages"), list):
        for raw in parsed["stages"]:
            if isinstance(raw, dict) and raw.get("id"):
                out[str(raw["id"])] = {
                    "title": str(raw.get("title") or ""),
                    "goal": str(raw.get("goal") or ""),
                    "success_metric": str(raw.get("success_metric") or ""),
                }
    return out


def adapt_remaining_stages(world: Any, current_stage_id: str, world_state: Dict[str, Any],
                           decisions: Optional[List[Dict[str, Any]]] = None,
                           brief: str = "") -> List[str]:
    """Bend the not-yet-played stages to the company that now exists.

    Operates on `world.stages` (WorldGraph) in place. Only stages after
    `current_stage_id` that are still `not-started` are adapted; ids, owner
    roles, dependencies, and the 8-stage count are preserved. Live narrator
    rewrite when Foundry is configured, deterministic recomposition otherwise.
    Returns the ids that changed.
    """
    stages = list(getattr(world, "stages", []) or [])
    ids = [s.id for s in stages]
    start = (ids.index(current_stage_id) + 1) if current_stage_id in ids \
        else int(getattr(world, "current_stage_index", 0) or 0) + 1
    played = stages[:start]
    downstream = [s for s in stages[start:] if s.status == "not-started"]
    if not downstream:
        return []

    # Capture each pending stage's authored base text once, so re-adaptation
    # always starts from original intent (idempotent, never compounding).
    for stage in downstream:
        if stage.base_goal is None:
            stage.base_goal = stage.goal
        if stage.base_success_metric is None:
            stage.base_success_metric = stage.success_metric

    latest = (decisions or [])[-1] if decisions else {}
    client = get_foundry_client()
    deployment = model_for("narrator")
    if client and deployment:
        try:
            adapted = _adapt_via_llm(deployment, brief or getattr(world, "brief", ""),
                                     played, downstream, world_state, latest)
            changed: List[str] = []
            for stage in downstream:
                a = adapted.get(stage.id)
                if not a:
                    continue
                if a.get("title"):
                    stage.title = a["title"][:120]
                if a.get("goal"):
                    stage.goal = a["goal"][:400]
                if a.get("success_metric"):
                    stage.success_metric = a["success_metric"][:300]
                changed.append(stage.id)
            if changed:
                return changed
        except Exception:
            pass
    return _adapt_deterministic(downstream, world_state, latest)
