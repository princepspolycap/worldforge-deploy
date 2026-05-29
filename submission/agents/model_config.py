"""Foundry client + agent->model config.

Single source of truth for: which deployment each agent uses, how the OpenAI
client is constructed, and how we degrade gracefully when nothing is wired up.

Auth priority:
  1. Azure AD via DefaultAzureCredential (recommended; `az login` locally,
     Managed Identity in prod).
  2. FOUNDRY_API_KEY for quick local dev.
  3. Mock mode - returns deterministic offline outputs.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from dotenv import load_dotenv

# Load submission/.env when present. Safe no-op in CI.
_ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
if os.path.exists(_ENV_PATH):
    load_dotenv(_ENV_PATH)


@dataclass(frozen=True)
class AgentModel:
    role: str          # narrator | strategist | designer | marketer | ops | npc
    deployment: str    # Foundry deployment name from local env


AGENT_MODELS = {
    "narrator":   AgentModel("narrator",   os.getenv("NARRATOR_MODEL",   "")),
    "strategist": AgentModel("strategist", os.getenv("STRATEGIST_MODEL", "")),
    "designer":   AgentModel("designer",   os.getenv("DESIGNER_MODEL",   "")),
    "marketer":   AgentModel("marketer",   os.getenv("MARKETER_MODEL",   "")),
    "ops":        AgentModel("ops",        os.getenv("OPS_MODEL", os.getenv("MARKETER_MODEL", ""))),
    "npc":        AgentModel("npc",        os.getenv("NPC_FAST_MODEL",   "")),
}

DEMO_MODE = os.getenv("DEMO_MODE", "simulation").strip().lower()
FOUNDRY_BASE_URL = os.getenv("FOUNDRY_BASE_URL", "").strip()
FOUNDRY_API_KEY = os.getenv("FOUNDRY_API_KEY", "").strip()


def is_live() -> bool:
    """Live mode requires explicit opt-in AND a configured endpoint."""
    return DEMO_MODE == "live" and bool(FOUNDRY_BASE_URL)


_client = None  # cached OpenAI client


def get_foundry_client():
    """Return an `openai.OpenAI` client pointed at the Foundry v1 endpoint.

    Tries AAD bearer token first via DefaultAzureCredential; falls back to
    API key. Returns None if neither path is available.
    """
    global _client
    if _client is not None:
        return _client

    if not is_live():
        return None

    try:
        from openai import OpenAI
    except ImportError:
        return None

    api_key = FOUNDRY_API_KEY

    # AAD path: mint a Cognitive Services token and pass it as the bearer.
    if not api_key:
        try:
            from azure.identity import DefaultAzureCredential
            cred = DefaultAzureCredential(exclude_interactive_browser_credential=False)
            token = cred.get_token("https://cognitiveservices.azure.com/.default")
            api_key = token.token
        except Exception:
            return None

    if not api_key:
        return None

    _client = OpenAI(base_url=FOUNDRY_BASE_URL, api_key=api_key)
    return _client


def model_for(role: str) -> Optional[str]:
    """Deployment name for an agent role, or None if not configured."""
    m = AGENT_MODELS.get(role)
    return m.deployment if m and m.deployment else None
