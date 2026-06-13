"""Reasoning agents for Gamifying World Improvement.

Each agent has a role + system prompt + a deployment binding. They call the
configured Microsoft Foundry endpoint when DEMO_MODE=live and credentials are
present; otherwise they return deterministic mock artifacts so the demo and
tests work offline.

All reasoning lives on Foundry deployments (see model_config.py).
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from agents.model_config import get_foundry_client, model_for, is_live, create_chat_completion


def _chat_json(role: str, system: str, user: str, fallback: Any) -> Any:
    """Call the role's Foundry deployment and parse a JSON response.

    Returns `fallback` if anything is missing (no client, no deployment, bad
    JSON, network error). This keeps the demo always-runnable.
    """
    client = get_foundry_client()
    deployment = model_for(role)
    if not client or not deployment:
        return fallback

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    def _do_call(extra: Dict[str, Any]) -> Optional[str]:
        # create_chat_completion handles cross-deployment fallback (quota 429s)
        # and the gpt-5.x temperature retry transparently.
        try:
            resp = create_chat_completion(
                deployment,
                messages,
                max_completion_tokens=8000,
                response_format=extra.get("response_format"),
                temperature=extra.get("temperature"),
            )
            return resp.choices[0].message.content or ""
        except Exception:
            return None

    def _extract_json(content: str) -> Any:
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
                return json.loads(candidate)
            except Exception:
                pass

        decoder = json.JSONDecoder()
        for index, char in enumerate(text):
            if char != "{":
                continue
            try:
                parsed, _ = decoder.raw_decode(text[index:])
                return parsed
            except Exception:
                continue
        return None

    # First try with JSON mode + temperature.
    content = _do_call({"response_format": {"type": "json_object"}, "temperature": 0.7})
    parsed = _extract_json(content or "")
    if parsed is not None:
        return parsed

    # Fallback: plain call, stronger JSON-only instruction. Reassigning the
    # closed-over `messages` is picked up by _do_call (late binding).
    stricter_system = system + " Reply with ONLY a valid JSON object. No prose, no code fences."
    messages = [
        {"role": "system", "content": stricter_system},
        {"role": "user", "content": user},
    ]
    content = _do_call({"temperature": 0.7})
    parsed = _extract_json(content or "")
    return parsed if parsed is not None else fallback


def _chat_text(role: str, system: str, user: str, fallback: str,
               max_tokens: int = 2000) -> str:
    """Call a Foundry deployment for a short plain-text reply (no JSON).

    Used for narration/lore where we want prose, not a structured artifact.
    Returns `fallback` on any failure so the experience never stalls.
    """
    client = get_foundry_client()
    deployment = model_for(role)
    if not client or not deployment:
        return fallback

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    def _do_call(extra: Dict[str, Any]) -> Optional[str]:
        # Resilient call: cross-deployment fallback on quota 429s + gpt-5.x
        # temperature retry handled inside create_chat_completion.
        try:
            resp = create_chat_completion(
                deployment,
                messages,
                max_completion_tokens=max_tokens,
                temperature=extra.get("temperature"),
            )
            return resp.choices[0].message.content or ""
        except Exception:
            return None

    content = _do_call({"temperature": 0.9})
    text = (content or "").strip()
    # Strip accidental code fences / quotes the model may wrap around prose.
    text = re.sub(r"^```[a-z]*\s*|\s*```$", "", text).strip().strip('"').strip()
    return text or fallback


def generate_lore(pitch: str, company: str = "") -> Dict[str, str]:
    """Generate a short, personalized adventure intro for this founder's idea.

    Two narrated sentences that frame *their* specific venture as a quest. Runs
    on the narrator deployment in live mode; falls back to a templated line so
    the opening still feels bespoke offline. This is the adaptive lore: the same
    grand vision, told for the company the player actually brought.
    """
    company = (company or "your venture").strip()
    pitch = (pitch or "").strip()
    short = pitch[:280] if pitch else company

    system = (
        "You are the Voice of the Mainframe Narrator (a cynical but epic cosmic intelligence - a blend of "
        "Rick Sanchez's portal-logic, Pantheon's uploaded mind director, a Westworld simulation manager, "
        "and a high-tech Black Panther style guide). Frame the founder's specific venture as a reality "
        "upload escape vector. Exactly two sentences. Speak directly to 'you'. No preamble, no quotes, "
        "no markdown - just the narration."
    )
    user = f"Company Name: {company}\nThe Idea: {short}\n\nWrite the two-sentence welcome."

    fallback = (
        f"So you seek to escape the zone of comfort with {company} - {short[:120]}. "
        "Enter the unfamiliar mainframe; your digital workforce is initialized to stabilize the loop."
    )
    text = _chat_text("narrator", system, user, fallback, max_tokens=2000)
    return {"lore": text, "mode": "live" if is_live() else "simulation"}


# Canonical quest line: role, artifact_type, default id/title/xp. Order is fixed
# because downstream execution reads steps[0]=positioning, steps[1]=page, etc.
_CANONICAL_STEPS = [
    ("strategist", "doc",   "step_1_positioning",  "YOU & NEED: Escape the Comfort Mainframe",        15),
    ("designer",   "url",   "step_2_landing_page", "GO: Crossing the Portal Threshold",              25),
    ("marketer",   "email", "step_3_launch_email", "SEARCH: Adapt or Dissolve in the Mainframe",     20),
]


def _normalize_steps(steps: Any, pitch: str) -> List[Dict[str, Any]]:
    """Coerce model-produced quest steps to the QuestStep contract.

    The live narrator model sometimes returns ids as ints, omits keys, or uses
    invalid enum values. We force every field to the schema's expected type and
    pin role + artifact_type by position so QuestStep(**step) can never raise
    mid-demo and the downstream handoff order stays correct. Mirrors
    world_designer._normalize_chapters.
    """
    model_steps = steps if isinstance(steps, list) else []
    out: List[Dict[str, Any]] = []
    for idx, (role, artifact_type, default_id, default_title, default_xp) in enumerate(_CANONICAL_STEPS):
        raw = model_steps[idx] if idx < len(model_steps) and isinstance(model_steps[idx], dict) else {}
        try:
            xp = int(raw.get("xp_reward", default_xp))
        except (TypeError, ValueError):
            xp = default_xp
        xp = max(10, min(30, xp))
        out.append({
            "id": str(raw.get("id") or default_id),
            "title": str(raw.get("title") or default_title),
            "description": str(
                raw.get("description")
                or f"Work with the {role.title()} to advance the venture: '{pitch}'"
            ),
            "assigned_to": role,            # pinned by position for downstream safety
            "artifact_type": artifact_type, # pinned by position
            "xp_reward": xp,
        })
    return out


class BaseFoundryAgent:
    def __init__(self, name: str, role: str, system_instructions: str):
        self.name = name
        self.role = role
        self.system_instructions = system_instructions

    @property
    def deployment(self) -> Optional[str]:
        return model_for(self.role)

    @property
    def mode(self) -> str:
        return "live" if (is_live() and self.deployment) else "simulation"


class MasterNarrator(BaseFoundryAgent):
    def __init__(self):
        super().__init__(
            "The Narrator",
            "narrator",
            "You are the Master Narrator of a world-improvement campaign sandbox that blends Joseph Campbell's "
            "and Dan Harmon's Story Circle with sci-fi themes (Rick and Morty multiversal portal travel, "
            "Pantheon carbon-mind uploads, Westworld AI host awakenings, and Black Panther Vibranium-grade technology). "
            "Read a campaign brief and decompose it into exactly 3 quest steps representing the first 3 phases "
            "of the Story Circle (YOU/NEED, GO, and SEARCH). Return JSON only.",
        )

    def decompose_pitch(self, pitch: str) -> List[Dict[str, Any]]:
        fallback = [
            {
                "id": "step_1_positioning",
                "title": "YOU & NEED: Escape the Comfort Mainframe",
                "description": f"Use the Strategist to scan carbon-mind ICP vectors and verify WTP thresholds for: '{pitch}'",
                "assigned_to": "strategist",
                "artifact_type": "doc",
                "xp_reward": 15,
            },
            {
                "id": "step_2_landing_page",
                "title": "GO: Crossing the Portal Threshold",
                "description": "Work with the Designer to synthesize a trans-dimensional value proposition and ICP for the Teenyverse hosts.",
                "assigned_to": "designer",
                "artifact_type": "url",
                "xp_reward": 25,
            },
            {
                "id": "step_3_launch_email",
                "title": "SEARCH: Adapt or Dissolve in the Mainframe",
                "description": "Have the Marketer draft a launch campaign email that offers the new sandbox portal to the public.",
                "assigned_to": "marketer",
                "artifact_type": "email",
                "xp_reward": 20,
            },
        ]
        user = (
            f"Pitch: {pitch}\n\n"
            "Return JSON: {\"steps\": [ {id, title, description, assigned_to, artifact_type, xp_reward}, ... ]}. "
            "Exactly 3 steps. assigned_to must be one of: strategist, designer, marketer (in that order). "
            "artifact_type must be one of: doc, url, email. xp_reward is an integer 10-30."
        )
        out = _chat_json(self.role, self.system_instructions, user, {"steps": fallback})
        steps = out.get("steps") if isinstance(out, dict) else None
        return _normalize_steps(steps, pitch)


class StrategistAgent(BaseFoundryAgent):
    def __init__(self):
        super().__init__(
            "Soren",
            "strategist",
            "You are a lean-startup strategist. You specialize in positioning, "
            "audience segmentation, and core problem statements. Return JSON only.",
        )

    def formulate_positioning(self, pitch: str) -> Dict[str, str]:
        fallback = {
            "target_audience": "Freelance Web Designers and Small Agency Owners",
            "core_problem": f"Struggle to estimate project time and pricing. Source pitch: {pitch}",
            "value_proposition": "An interactive estimation dashboard that calculates pricing from historical benchmarks.",
            "primary_benefit": "Bid for projects 2x faster and eliminate unpaid scope-creep.",
        }
        user = (
            f"Pitch: {pitch}\n\n"
            "Return JSON with keys: target_audience, core_problem, value_proposition, primary_benefit. "
            "Each value is a single concise sentence."
        )
        out = _chat_json(self.role, self.system_instructions, user, fallback)
        return out if isinstance(out, dict) else fallback


class DesignerAgent(BaseFoundryAgent):
    def __init__(self):
        super().__init__(
            "Dahlia",
            "designer",
            "You are a visual and UX designer. You design landing-page wireframes, "
            "headlines, and CTAs. Return JSON only.",
        )

    def build_page_structure(self, positioning: Dict[str, str]) -> Dict[str, str]:
        audience = positioning.get("target_audience", "Your Audience")
        benefit = positioning.get("primary_benefit", "Price with confidence.")
        fallback = {
            "hero_headline": f"The Smarter Way for {audience} to Quote and Price Project Scope",
            "cta_text": "Price My Next Project Free",
            "features": "1. Multi-metric Estimator; 2. Client-ready Proposal Export; 3. Scope Crawl Alert System",
            "url": "https://estimator-preview.example.com",
        }
        user = (
            f"Positioning JSON: {json.dumps(positioning)}\n\n"
            "Return JSON with keys: hero_headline (string), cta_text (string), "
            "features (string with 3 numbered features separated by '; '), url (string starting with https://). "
            f"Reflect this primary benefit: {benefit}"
        )
        out = _chat_json(self.role, self.system_instructions, user, fallback)
        return out if isinstance(out, dict) else fallback


class MarketerAgent(BaseFoundryAgent):
    def __init__(self):
        super().__init__(
            "Maddox",
            "marketer",
            "You are a growth marketer and copywriter. You write punchy launch "
            "emails with a clear single CTA. Return JSON only.",
        )

    def draft_launch_email(
        self,
        positioning: Dict[str, str],
        page_structure: Dict[str, str],
    ) -> Dict[str, str]:
        target = positioning.get("target_audience", "Freelancer")
        problem = positioning.get("core_problem", "underpricing projects")
        url = page_structure.get("url", "https://estimator-preview.example.com")
        fallback = {
            "subject": f"Stop underpricing your next project - a new quoting tool for {target}",
            "body": (
                f"Hey there,\n\n"
                f"If you're like most {target}, you probably struggle with {problem}.\n\n"
                f"We just shipped a workspace that solves exactly this. Multi-metric "
                f"estimator and proposal exporter, designed to save you hours.\n\n"
                f"Check it out: {url}\n\n"
                f"Best,\nYour Quoting Team"
            ),
        }
        user = (
            f"Positioning JSON: {json.dumps(positioning)}\n"
            f"Page JSON: {json.dumps(page_structure)}\n\n"
            "Return JSON with keys: subject (string under 80 chars), body (multi-paragraph string "
            f"that includes the URL {url} as a CTA). Tone: confident, friendly, no emoji."
        )
        out = _chat_json(self.role, self.system_instructions, user, fallback)
        return out if isinstance(out, dict) else fallback
