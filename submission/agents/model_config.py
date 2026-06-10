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

# Reliability net: a high-quota deployment to retry on when a role's primary
# model is rate-limited (HTTP 429) or errors mid-demo. Set this to a deployment
# that exists on your endpoint AND has quota headroom. Default gpt-5.5 (large
# capacity on our endpoint); override via env. Leave blank to disable fallback.
FOUNDRY_FALLBACK_MODEL = os.getenv("FOUNDRY_FALLBACK_MODEL", "gpt-5.5").strip()


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


# A designed digital worker carries a `deployment_hint` (reasoning | fast |
# creative). Map that hint onto one of the configured Foundry deployments so the
# worker the Org Designer created runs on a model class that fits its job.
_HINT_TO_ROLE = {
    "reasoning": "strategist",
    "creative": "designer",
    "fast": "npc",
}


def model_for_hint(hint: str) -> Optional[str]:
    """Deployment for a worker's deployment_hint, or None if not configured."""
    role = _HINT_TO_ROLE.get((hint or "").strip().lower())
    if not role:
        return None
    return model_for(role) or model_for("narrator")


def create_chat_completion(deployment, messages, *, max_completion_tokens=8000,
                           response_format=None, temperature=None):
    """Run a chat completion with automatic resilience, returning the response.

    Two safety behaviors, both transparent to callers:
      1. Cross-deployment fallback - if `deployment` errors (e.g. a 429 rate
         limit because an open-source model is at 100% of its regional quota),
         retry once on FOUNDRY_FALLBACK_MODEL, which is chosen to have quota
         headroom. This is what keeps a live demo from breaking on quota.
      2. Temperature retry - gpt-5.x deployments reject a non-default
         temperature; on that specific error we drop it and retry the same
         deployment.

    Raises the last exception if every candidate fails, so existing callers keep
    their own try/except (mock fallback, failed-invocation) as the final net.
    """
    client = get_foundry_client()
    if client is None or not deployment:
        raise RuntimeError("No Foundry client or deployment configured.")

    candidates = [deployment]
    if FOUNDRY_FALLBACK_MODEL and FOUNDRY_FALLBACK_MODEL != deployment:
        candidates.append(FOUNDRY_FALLBACK_MODEL)

    last_exc: Optional[Exception] = None
    for dep in candidates:
        kwargs = {"model": dep, "messages": messages,
                  "max_completion_tokens": max_completion_tokens}
        if response_format is not None:
            kwargs["response_format"] = response_format
        if temperature is not None:
            kwargs["temperature"] = temperature
        try:
            return client.chat.completions.create(**kwargs)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).lower()
            # gpt-5.x rejects non-default temperature: drop it, retry same dep.
            if "temperature" in msg and "temperature" in kwargs:
                try:
                    kwargs.pop("temperature")
                    return client.chat.completions.create(**kwargs)
                except Exception as exc2:  # noqa: BLE001
                    last_exc = exc2
                    continue
            last_exc = exc
            continue
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("create_chat_completion: no candidates attempted.")


def reasoning_from_response(resp, preview_chars: int = 280) -> Dict[str, Any]:
    """Extract visible 'thinking' signal from a chat completion response.

    Returns {reasoning_tokens, reasoning_preview}. Two kinds of models expose
    reasoning: some report a hidden reasoning-token *count* in usage (gpt-5.x,
    grok reasoning), others return the actual chain-of-thought *text* in
    message.reasoning_content / reasoning (e.g. Kimi). We surface a short, safe
    preview of the text so the UI can show "the agent is thinking" honestly,
    without dumping a huge payload. No secrets are involved - this is the model's
    own reasoning about the user's public business brief.
    """
    reasoning_tokens = 0
    preview = ""
    try:
        usage = getattr(resp, "usage", None)
        details = getattr(usage, "completion_tokens_details", None) if usage else None
        reasoning_tokens = int(getattr(details, "reasoning_tokens", 0) or 0) if details else 0
    except Exception:
        reasoning_tokens = 0
    try:
        msg = resp.choices[0].message
        text = getattr(msg, "reasoning_content", None) or getattr(msg, "reasoning", None) or ""
        if text:
            preview = " ".join(str(text).split())[:preview_chars]
    except Exception:
        preview = ""
    return {"reasoning_tokens": reasoning_tokens, "reasoning_preview": preview}

