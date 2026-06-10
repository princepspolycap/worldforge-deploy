"""WorldDesigner agent: produces a full venture WorldGraph from a brief.

Deployment: NARRATOR_MODEL from the local Foundry configuration.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from agents.model_config import get_foundry_client, model_for, create_chat_completion


SYSTEM = (
    "You are the World Designer for a startup-building RPG. Given a company brief, "
    "produce a structured JSON quest graph with 5 chapters covering: discovery, "
    "positioning, mvp, gtm, retention. Each chapter has a clear goal, owner role, "
    "success metric, and dependency list. Return ONLY a valid JSON object."
)

USER_TEMPLATE = """\
Brief: {brief}

Return JSON:
{{
  "chapters": [
    {{
      "id": "ch_1_discovery",
      "title": "...",
      "goal": "...",
      "owner_role": "strategist|designer|marketer|ops",
      "success_metric": "...",
      "depends_on": [],
      "suggested_tools": ["code_interpreter", "foundry_iq", ...]
    }},
    ...
  ]
}}

Exactly 5 chapters. owner_role must be one of: strategist, designer, marketer, ops.
suggested_tools can include: code_interpreter, foundry_iq, web_search, email_sender, deploy_page.
"""

FALLBACK_CHAPTERS = [
    {
        "id": "ch_1_discovery",
        "title": "Discovery: Map Customer Pain",
        "goal": "Validate target audience willingness to pay",
        "owner_role": "strategist",
        "success_metric": "25 owner interviews, 10+ express clear WTP",
        "depends_on": [],
        "suggested_tools": ["foundry_iq", "web_search"],
    },
    {
        "id": "ch_2_positioning",
        "title": "Positioning: Sharp Niche Message",
        "goal": "Define value proposition and ICP",
        "owner_role": "strategist",
        "success_metric": "Tested with 10 users, 40%+ positive intent",
        "depends_on": ["ch_1_discovery"],
        "suggested_tools": ["code_interpreter"],
    },
    {
        "id": "ch_3_mvp",
        "title": "MVP: Build the Core Product",
        "goal": "Ship a usable first version",
        "owner_role": "designer",
        "success_metric": "3 templates live, 5 pilot users publishing",
        "depends_on": ["ch_2_positioning"],
        "suggested_tools": ["code_interpreter", "deploy_page"],
    },
    {
        "id": "ch_4_gtm",
        "title": "GTM: Bootstrap First 100 Customers",
        "goal": "Acquire customers through $0 channels",
        "owner_role": "marketer",
        "success_metric": "100 paying customers, $5k MRR",
        "depends_on": ["ch_3_mvp"],
        "suggested_tools": ["email_sender", "web_search"],
    },
    {
        "id": "ch_5_retention",
        "title": "Retention: Reduce Churn to <5%",
        "goal": "Build engagement loops and support",
        "owner_role": "ops",
        "success_metric": "Monthly churn < 5%, NPS > 40",
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
