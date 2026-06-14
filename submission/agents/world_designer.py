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
    "and owner roles. Return ONLY a valid JSON object."
)

USER_TEMPLATE = """\
Brief: {brief}

Return JSON:
{{
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


def design_world(brief: str) -> List[Dict[str, Any]]:
    """Call the configured narrator deployment. Falls back to fallback stages."""
    client = get_foundry_client()
    deployment = model_for("narrator")
    if not client or not deployment:
        return FALLBACK_STAGES

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
            return _normalize_stages(parsed["stages"])
    except Exception:
        pass
    return _normalize_stages(FALLBACK_STAGES)
