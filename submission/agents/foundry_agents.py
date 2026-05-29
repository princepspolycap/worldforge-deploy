"""Reasoning agents for Your Company Is the Dungeon.

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

from agents.model_config import get_foundry_client, model_for, is_live


def _chat_json(role: str, system: str, user: str, fallback: Any) -> Any:
    """Call the role's Foundry deployment and parse a JSON response.

    Returns `fallback` if anything is missing (no client, no deployment, bad
    JSON, network error). This keeps the demo always-runnable.
    """
    client = get_foundry_client()
    deployment = model_for(role)
    if not client or not deployment:
        return fallback

    base_kwargs = dict(
        model=deployment,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_completion_tokens=8000,
    )

    def _do_call(extra: Dict[str, Any]) -> Optional[str]:
        try:
            resp = client.chat.completions.create(**base_kwargs, **extra)
            return resp.choices[0].message.content or ""
        except Exception as e:
            # Retry without temperature for models that reject it (gpt-5.x).
            if "temperature" in str(e).lower() and "temperature" in extra:
                trimmed = {k: v for k, v in extra.items() if k != "temperature"}
                return _do_call(trimmed)
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

    # Fallback: plain call, stronger JSON-only instruction.
    stricter_system = system + " Reply with ONLY a valid JSON object. No prose, no code fences."
    base_kwargs["messages"] = [
        {"role": "system", "content": stricter_system},
        {"role": "user", "content": user},
    ]
    content = _do_call({"temperature": 0.7})
    parsed = _extract_json(content or "")
    return parsed if parsed is not None else fallback


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
            "You are the Master Narrator of a startup-building RPG. Read a business "
            "pitch and decompose it into exactly 3 quest steps for a Strategist, "
            "Designer, and Marketer. Return JSON only.",
        )

    def decompose_pitch(self, pitch: str) -> List[Dict[str, Any]]:
        fallback = [
            {
                "id": "step_1_positioning",
                "title": "Define Your Target Audience and Positioning",
                "description": f"Use the Strategist to scope target clients and shape the positioning of: '{pitch}'",
                "assigned_to": "strategist",
                "artifact_type": "doc",
                "xp_reward": 15,
            },
            {
                "id": "step_2_landing_page",
                "title": "Draft and Validate Your Landing Page Structure",
                "description": "Work with the Designer to write a compelling hero headline, copy, and set up a deployment check.",
                "assigned_to": "designer",
                "artifact_type": "url",
                "xp_reward": 25,
            },
            {
                "id": "step_3_launch_email",
                "title": "Draft Your Landing Page Launch Campaign",
                "description": "Have the Marketer create a launch outreach email featuring a CTA to drive signups.",
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
        return steps if isinstance(steps, list) and len(steps) == 3 else fallback


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
