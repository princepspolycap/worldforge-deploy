"""Agent runtime client + model config.

Single source of truth for: which deployment each agent uses, how the local or
cloud OpenAI-compatible client is constructed, and how we degrade gracefully when
nothing is wired up.

Auth priority:
  1. Local OpenAI-compatible runtime when configured (normal gameplay).
  2. Azure AD via DefaultAzureCredential (recommended; `az login` locally,
     Managed Identity in prod).
  3. FOUNDRY_API_KEY for quick cloud dev.
  4. Mock mode - returns deterministic offline outputs.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - local clone can still run simulation without dotenv.
    def load_dotenv(*_args, **_kwargs):
        return False

# Load submission/.env when present. Safe no-op in CI.
_ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
if os.path.exists(_ENV_PATH):
    load_dotenv(_ENV_PATH)


@dataclass(frozen=True)
class AgentModel:
    role: str          # narrator | strategist | designer | marketer | ops | npc
    deployment: str    # Model/deployment name from local env


_CLOUD_AGENT_MODELS = {
    "narrator":   AgentModel("narrator",   os.getenv("NARRATOR_MODEL",   "")),
    "strategist": AgentModel("strategist", os.getenv("STRATEGIST_MODEL", "")),
    "designer":   AgentModel("designer",   os.getenv("DESIGNER_MODEL",   "")),
    "marketer":   AgentModel("marketer",   os.getenv("MARKETER_MODEL",   "")),
    "ops":        AgentModel("ops",        os.getenv("OPS_MODEL", os.getenv("MARKETER_MODEL", ""))),
    "npc":        AgentModel("npc",        os.getenv("NPC_FAST_MODEL",   "")),
}

LOCAL_AGENT_BASE_URL = os.getenv("LOCAL_AGENT_BASE_URL", "").strip()
LOCAL_AGENT_API_KEY = os.getenv("LOCAL_AGENT_API_KEY", "local").strip() or "local"
LOCAL_AGENT_MODEL = os.getenv("LOCAL_AGENT_MODEL", "").strip()
LOCAL_AGENT_ENABLED = os.getenv("LOCAL_AGENT_ENABLED", "true").strip().lower() not in {
    "0", "false", "no", "off"
}
AGENT_ROUTING = os.getenv("AGENT_ROUTING", "local_first").strip().lower()

_LOCAL_AGENT_MODELS = {
    "narrator": AgentModel("narrator", os.getenv("LOCAL_NARRATOR_MODEL", LOCAL_AGENT_MODEL).strip()),
    "strategist": AgentModel("strategist", os.getenv("LOCAL_STRATEGIST_MODEL", LOCAL_AGENT_MODEL).strip()),
    "designer": AgentModel("designer", os.getenv("LOCAL_DESIGNER_MODEL", LOCAL_AGENT_MODEL).strip()),
    "marketer": AgentModel("marketer", os.getenv("LOCAL_MARKETER_MODEL", LOCAL_AGENT_MODEL).strip()),
    "ops": AgentModel("ops", os.getenv("LOCAL_OPS_MODEL", LOCAL_AGENT_MODEL).strip()),
    "npc": AgentModel("npc", os.getenv("LOCAL_NPC_FAST_MODEL", LOCAL_AGENT_MODEL).strip()),
}

DEMO_MODE = os.getenv("DEMO_MODE", "simulation").strip().lower()
FOUNDRY_BASE_URL = os.getenv("FOUNDRY_BASE_URL", "").strip()
FOUNDRY_API_KEY = os.getenv("FOUNDRY_API_KEY", "").strip()

# Reliability net: a deployment to retry on when a role's primary model is
# rate-limited (HTTP 429) or errors mid-demo. Set this to a deployment that
# exists on your endpoint and has quota headroom. Blank disables fallback.
FOUNDRY_FALLBACK_MODEL = os.getenv("FOUNDRY_FALLBACK_MODEL", "").strip()


def _cloud_runtime_enabled() -> bool:
    return DEMO_MODE == "live" and bool(FOUNDRY_BASE_URL)


def _local_runtime_enabled() -> bool:
    if DEMO_MODE not in {"local", "live"}:
        return False
    if AGENT_ROUTING == "cloud_only":
        return False
    return bool(LOCAL_AGENT_ENABLED and LOCAL_AGENT_BASE_URL and LOCAL_AGENT_MODEL)


def is_live() -> bool:
    """Whether a non-simulation agent runtime is available."""
    return runtime_mode() != "simulation"


def runtime_mode() -> str:
    """Return the active runtime label: local, live, hybrid, or simulation."""
    local_ready = _local_runtime_enabled()
    cloud_ready = _cloud_runtime_enabled()
    if local_ready and cloud_ready and AGENT_ROUTING != "local_only":
        return "hybrid"
    if local_ready:
        return "local"
    if cloud_ready:
        return "live"
    return "simulation"


_local_client = None  # cached OpenAI client for local runtime
_cloud_client = None  # cached OpenAI client for cloud Foundry


def _build_openai_client(base_url: str, api_key: str):
    try:
        from openai import OpenAI
    except ImportError:
        return None
    return OpenAI(base_url=base_url, api_key=api_key)


def get_local_agent_client():
    """Return an OpenAI-compatible local client, or None when unavailable."""
    global _local_client
    if _local_client is not None:
        return _local_client
    if not _local_runtime_enabled():
        return None
    _local_client = _build_openai_client(LOCAL_AGENT_BASE_URL, LOCAL_AGENT_API_KEY)
    return _local_client


def get_cloud_foundry_client():
    """Return an `openai.OpenAI` client pointed at the Foundry v1 endpoint.

    Tries AAD bearer token first via DefaultAzureCredential; falls back to
    API key. Returns None if neither path is available.
    """
    global _cloud_client
    if _cloud_client is not None:
        return _cloud_client

    if not _cloud_runtime_enabled():
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

    _cloud_client = _build_openai_client(FOUNDRY_BASE_URL, api_key)
    return _cloud_client


def get_foundry_client():
    """Return the preferred configured client.

    The legacy name is kept because all agents already call this function. In
    local-first routing it returns the local OpenAI-compatible client; otherwise
    it returns the cloud Foundry client.
    """
    if AGENT_ROUTING != "cloud_first":
        local_client = get_local_agent_client()
        if local_client is not None:
            return local_client
    return get_cloud_foundry_client()


def _cloud_model_for(role: str) -> Optional[str]:
    m = _CLOUD_AGENT_MODELS.get(role)
    return m.deployment if m and m.deployment else None


def _local_model_for(role: str) -> Optional[str]:
    m = _LOCAL_AGENT_MODELS.get(role)
    return m.deployment if m and m.deployment else None


def _role_for_deployment(deployment: str) -> Optional[str]:
    if not deployment:
        return None
    for role, model in _CLOUD_AGENT_MODELS.items():
        if model.deployment and model.deployment == deployment:
            return role
    for role, model in _LOCAL_AGENT_MODELS.items():
        if model.deployment and model.deployment == deployment:
            return role
    return None


def model_for(role: str) -> Optional[str]:
    """Preferred model/deployment name for an agent role, or None."""
    local_model = _local_model_for(role)
    cloud_model = _cloud_model_for(role)
    if AGENT_ROUTING == "local_only":
        return local_model
    if AGENT_ROUTING == "cloud_first":
        return cloud_model or local_model
    if _local_runtime_enabled():
        return local_model or cloud_model
    return cloud_model or local_model


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

    Safety behaviors, transparent to callers:
      1. Local-first routing - try the configured local model before cloud.
      2. Cloud fallback - if local errors, retry on the role's cloud deployment,
         then FOUNDRY_FALLBACK_MODEL when configured.
      3. Temperature retry - gpt-5.x deployments reject a non-default
         temperature; on that specific error we drop it and retry the same
         deployment.
      4. JSON-mode retry - some local runtimes do not support response_format;
         on that specific error we drop response_format and retry.

    Raises the last exception if every candidate fails, so existing callers keep
    their own try/except (mock fallback, failed-invocation) as the final net.
    """
    role = _role_for_deployment(str(deployment or ""))
    candidates: List[Tuple[str, Any, str]] = []

    local_client = get_local_agent_client()
    cloud_client = get_cloud_foundry_client()

    if AGENT_ROUTING != "cloud_only" and local_client is not None:
        local_model = _local_model_for(role or "") or LOCAL_AGENT_MODEL
        if local_model:
            candidates.append(("local", local_client, local_model))

    cloud_deployment = (_cloud_model_for(role or "") if role else None) or str(deployment or "")
    if AGENT_ROUTING != "local_only" and cloud_client is not None and cloud_deployment:
        candidates.append(("cloud", cloud_client, cloud_deployment))
        if FOUNDRY_FALLBACK_MODEL and FOUNDRY_FALLBACK_MODEL != cloud_deployment:
            candidates.append(("cloud", cloud_client, FOUNDRY_FALLBACK_MODEL))

    if AGENT_ROUTING == "cloud_first":
        candidates.sort(key=lambda item: 0 if item[0] == "cloud" else 1)

    deduped: List[Tuple[str, Any, str]] = []
    seen = set()
    for provider, client, dep in candidates:
        key = (provider, dep)
        if key in seen:
            continue
        seen.add(key)
        deduped.append((provider, client, dep))

    if not deduped:
        raise RuntimeError("No local or cloud agent runtime configured.")

    last_exc: Optional[Exception] = None
    for provider, client, dep in deduped:
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
            if provider == "local" and "response_format" in kwargs:
                try:
                    kwargs.pop("response_format")
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
