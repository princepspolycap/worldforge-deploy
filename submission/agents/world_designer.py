"""WorldDesigner agent: produces a full venture WorldGraph from a brief.

Deployment: NARRATOR_MODEL from the local Foundry configuration.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from agents.model_config import get_foundry_client, model_for, create_chat_completion


SYSTEM = (
    "You are the World Designer for a cosmic start-up sandbox that blends Joseph Campbell's "
    "and Dan Harmon's Story Circle with sci-fi themes (Rick and Morty multiversal portal travel, "
    "Pantheon carbon-mind uploads, Westworld AI host awakenings, and Black Panther Vibranium-grade technology). "
    "Given a company brief, produce a structured JSON quest graph with exactly 5 chapters, each representing "
    "a phase of Dan Harmon's Story Circle:\n"
    "1. YOU / NEED (ch_1_discovery): Ordinary zone of comfort & a burning want.\n"
    "2. GO (ch_2_positioning): Crossing the threshold into unfamiliarity.\n"
    "3. SEARCH (ch_3_mvp): Road of trials, adapting to the unfamiliar world.\n"
    "4. FIND / TAKE (ch_4_gtm): Obtaining the goal but paying a heavy price.\n"
    "5. RETURN / CHANGE (ch_5_retention): Returning changed, realizing the loop.\n\n"
    "Each chapter must have a title, goal, and success metric using this cosmic sci-fi theme, "
    "while keeping standard chapter IDs (ch_1_discovery, ch_2_positioning, ch_3_mvp, ch_4_gtm, ch_5_retention) "
    "and owner roles. Return ONLY a valid JSON object."
)

USER_TEMPLATE = """\
Brief: {brief}

Return JSON:
{{
  "chapters": [
    {{
      "id": "ch_1_discovery",
      "title": "YOU & NEED: [Title matching Step 1 & 2 of Story Circle, e.g., Escape the Comfort Mainframe]",
      "goal": "[Goal styled in sci-fi portal/upload language, e.g., Scan carbon-mind ICP vectors]",
      "owner_role": "strategist",
      "success_metric": "[Metric styled in sci-fi, e.g., Verify 25 mind transcripts]",
      "depends_on": [],
      "suggested_tools": ["foundry_iq", "web_search"]
    }},
    {{
      "id": "ch_2_positioning",
      "title": "GO: [Title matching Step 3, e.g., Crossing the Portal Threshold]",
      "goal": "[Goal styled in sci-fi, e.g., Synthesize value proposition for Teenyverse hosts]",
      "owner_role": "strategist",
      "success_metric": "[Metric styled in sci-fi, e.g., Awaken 10 hosts with 40%+ loop intent]",
      "depends_on": ["ch_1_discovery"],
      "suggested_tools": ["code_interpreter"]
    }},
    {{
      "id": "ch_3_mvp",
      "title": "SEARCH: [Title matching Step 4, e.g., Adapt or Dissolve]",
      "goal": "[Goal styled in sci-fi, e.g., Build MVP dashboard with Vibranium containment fields]",
      "owner_role": "designer",
      "success_metric": "[Metric styled in sci-fi, e.g., Keep 3 portal channels stable without timeline decay]",
      "depends_on": ["ch_2_positioning"],
      "suggested_tools": ["code_interpreter", "deploy_page"]
    }},
    {{
      "id": "ch_4_gtm",
      "title": "FIND & TAKE: [Title matching Step 5 & 6, e.g., Claim the Moat, Pay the Price]",
      "goal": "[Goal styled in sci-fi, e.g., Bootstrap acquisition before mainframe consolidation, calculating high burn price]",
      "owner_role": "marketer",
      "success_metric": "[Metric styled in sci-fi, e.g., Upload 100 minds, securing $5k MRR before sweep]",
      "depends_on": ["ch_3_mvp"],
      "suggested_tools": ["email_sender", "web_search"]
    }},
    {{
      "id": "ch_5_retention",
      "title": "RETURN & CHANGE: [Title matching Step 7 & 8, e.g., Transcend the Loop]",
      "goal": "[Goal styled in sci-fi, e.g., Establish retention loops to prevent carbon-mind decay and loop resets]",
      "owner_role": "ops",
      "success_metric": "[Metric styled in sci-fi, e.g., Stabilize churn under 5%, allowing mainframe autoplay]",
      "depends_on": ["ch_4_gtm"],
      "suggested_tools": ["code_interpreter", "foundry_iq"]
    }}
  ]
}}

Exactly 5 chapters with these exact IDs and owner_roles.
"""

FALLBACK_CHAPTERS = [
    {
        "id": "ch_1_discovery",
        "title": "YOU & NEED: Escape the Comfort Mainframe",
        "goal": "Scan carbon-mind ICP vectors and verify portal fluid WTP thresholds",
        "owner_role": "strategist",
        "success_metric": "Verify 25 mind transcripts, confirming 10+ stable escape vectors",
        "depends_on": [],
        "suggested_tools": ["foundry_iq", "web_search"],
    },
    {
        "id": "ch_2_positioning",
        "title": "GO: Crossing the Portal Threshold",
        "goal": "Synthesize a trans-dimensional value proposition and ICP for the Teenyverse market",
        "owner_role": "strategist",
        "success_metric": "Awaken 10 simulation hosts; secure 40%+ loop realization intent",
        "depends_on": ["ch_1_discovery"],
        "suggested_tools": ["code_interpreter"],
    },
    {
        "id": "ch_3_mvp",
        "title": "SEARCH: Adapt or Dissolve",
        "goal": "Ship a functional sandbox prototype with Vibranium-grade containment fields",
        "owner_role": "designer",
        "success_metric": "Establish 3 trans-dimensional portals, serving 5 pilot users without timeline collapse",
        "depends_on": ["ch_2_positioning"],
        "suggested_tools": ["code_interpreter", "deploy_page"],
    },
    {
        "id": "ch_4_gtm",
        "title": "FIND & TAKE: Claim the Moat, Pay the Price",
        "goal": "Scale mind-upload acquisitions fast, paying the price of increased portal fluid burn",
        "owner_role": "marketer",
        "success_metric": "Stabilize 100 uploaded minds; secure $5k MRR before mainframe cleanup sweeps",
        "depends_on": ["ch_3_mvp"],
        "suggested_tools": ["email_sender", "web_search"],
    },
    {
        "id": "ch_5_retention",
        "title": "RETURN & CHANGE: Transcend the Loop",
        "goal": "Secure host retention loops to prevent memory degradation and loop resets",
        "owner_role": "ops",
        "success_metric": "Stabilize churn under 5% and NPS above 40; prepare mainframe for autoplay",
        "depends_on": ["ch_4_gtm"],
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
    return slug or "chapter"


def _normalize_chapters(chapters: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Make model-produced chapters safe for Pydantic + scheduling."""
    allowed_roles = {"strategist", "designer", "marketer", "ops"}
    normalized: List[Dict[str, Any]] = []
    seen_ids = set()

    for idx, raw in enumerate(chapters[:5], 1):
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or f"Chapter {idx}")
        chapter_id = str(raw.get("id") or f"ch_{idx}_{_slugify(title)[:32]}")
        if chapter_id in seen_ids:
            chapter_id = f"{chapter_id}_{idx}"
        seen_ids.add(chapter_id)

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
            "id": chapter_id,
            "title": title,
            "goal": str(raw.get("goal") or "Produce a useful startup artifact."),
            "owner_role": owner_role,
            "success_metric": str(raw.get("success_metric") or "Human reviewer approves the artifact."),
            "depends_on": [str(item) for item in depends_on],
            "suggested_tools": [str(item) for item in suggested_tools],
        })

    return normalized or FALLBACK_CHAPTERS


def design_world(brief: str) -> List[Dict[str, Any]]:
    """Call the configured narrator deployment. Falls back to mock chapters."""
    client = get_foundry_client()
    deployment = model_for("narrator")
    if not client or not deployment:
        return FALLBACK_CHAPTERS

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
        if parsed and isinstance(parsed.get("chapters"), list) and len(parsed["chapters"]) >= 3:
            return _normalize_chapters(parsed["chapters"])
    except Exception:
        pass
    return _normalize_chapters(FALLBACK_CHAPTERS)
