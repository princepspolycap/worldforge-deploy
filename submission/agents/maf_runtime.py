"""Microsoft Agent Framework runtime for the digital workers.

The workers run as real `agent_framework.Agent` instances (Microsoft Agent
Framework) on our Foundry deployments. This module uses the framework's own
primitives - the same ones we teach on stage:

  * Agent            - model + instructions + tools, MAF's core abstraction
  * @tool            - our toolbox validators become real FunctionTools the
                       model calls mid-run (visible function-calling)
  * ContextProvider  - CampaignMemory injects the CEO's gate decisions and
                       Foundry IQ snippets before every invocation; this is
                       MAF's canonical memory surface (before_run/after_run)
  * AgentSession     - managed per run by the framework

Degradation law (same as every subsystem in this repo):
    MAF importable + live -> workers run through Agent Framework
    MAF missing / errors  -> worker_factory falls back to the direct
                             OpenAI-against-Foundry path, unchanged
A fresh `git clone` without agent-framework installed still plays.

Synchronous facade: worker_factory is sync; MAF is async. Each call runs on
a dedicated event loop (cheap at our scale: one call per chapter, 35-60s of
model time dwarfs loop setup).
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import warnings
from typing import Any, Callable, Dict, List, Optional, Tuple

# MAF's observability contextvar teardown breaks ad-hoc loops on Python 3.14
# unless OTel is disabled. We lose nothing: the replay log is the demo's
# telemetry surface.
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

_AVAILABLE: Optional[bool] = None
_IMPORT_ERROR = ""

# Cached result of the FoundryChatClient path (project Responses endpoint).
# None = untried, True = works, False = failed once (RBAC/region) - skip it
# for the rest of the process so live runs never re-pay a doomed attempt.
_FOUNDRY_PATH_OK: Optional[bool] = None
_FOUNDRY_FALLBACK_REASON = ""  # why the Foundry path is off, for the receipts
_AAD_CREDENTIAL = None  # cached DefaultAzureCredential (token cache inside)


def foundry_project_endpoint() -> str:
    """The Foundry project endpoint (.../api/projects/<name>), or ''."""
    return os.getenv("FOUNDRY_PROJECT_ENDPOINT", "").strip()


def _aad_credential():
    global _AAD_CREDENTIAL
    if _AAD_CREDENTIAL is None:
        from azure.identity import DefaultAzureCredential
        _AAD_CREDENTIAL = DefaultAzureCredential(exclude_interactive_browser_credential=False)
    return _AAD_CREDENTIAL


def maf_available() -> bool:
    """True when agent-framework is importable. Cached after first check."""
    global _AVAILABLE, _IMPORT_ERROR
    if _AVAILABLE is None:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                from agent_framework import Agent  # noqa: F401
                from agent_framework.openai import OpenAIChatClient  # noqa: F401
            _AVAILABLE = True
        except Exception as e:  # ImportError or partial install
            _AVAILABLE = False
            _IMPORT_ERROR = f"{type(e).__name__}: {e}"
    return _AVAILABLE


def run_maf_agent(
    deployment: str,
    api_key: str,
    base_url: str,
    name: str,
    instructions: str,
    prompt: str,
    decisions: Optional[List[Dict[str, Any]]] = None,
    retrieval_hits: Optional[List[Dict[str, Any]]] = None,
    memories: Optional[List[Dict[str, Any]]] = None,
    tool_fns: Optional[Dict[str, Callable[..., Any]]] = None,
) -> Tuple[str, Dict[str, Any]]:
    """Run one Microsoft Agent Framework agent to completion, synchronously.

    `decisions`, `retrieval_hits` and `memories` (agent memory: what the
    workers have learned from this CEO - see agents/memory.py) flow in through
    a ContextProvider (MAF memory), NOT string-concatenated into the prompt -
    the framework injects them before the model is invoked. `tool_fns`
    ({name: callable}) become real FunctionTools the model may call mid-run.

    Returns (text, meta). meta records what the framework did - memory
    injected, tools offered/called - so the UI can teach it. Raises on any
    failure; callers fall back to the direct path.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from agent_framework import Agent, ContextProvider, tool
        from agent_framework.openai import OpenAIChatClient

    meta: Dict[str, Any] = {
        "framework": "microsoft-agent-framework",
        "agent_name": name,
        "maf_client": "",
        "maf_memory": [],
        "maf_tools_offered": sorted(tool_fns.keys()) if tool_fns else [],
        "maf_tools_called": [],
        # Full tools/call receipts for mid-run FunctionTool calls - same shape
        # as WorkerInvocation.tool_trace ({tool, source, args, result, ms});
        # worker_factory merges these into the invocation's trace ledger.
        "maf_tool_trace": [],
    }

    class CampaignMemory(ContextProvider):
        """Session memory, the MAF way: the CEO's decision ledger and Foundry
        IQ recall ride in via before_run instead of prompt-pasting."""

        def __init__(self) -> None:
            super().__init__(source_id="campaign-memory")

        async def before_run(self, *, agent, session, context, state) -> None:  # noqa: ANN001
            lines: List[str] = []
            for d in (decisions or [])[-3:]:
                after = ((d.get("consequence") or {}).get("after") or {})
                econ = ""
                if after:
                    econ = (
                        f" Current state: burn ${after.get('monthly_burn_usd', 0)}/mo, "
                        f"{after.get('digital_worker_count', 0)} digital workers, "
                        f"proof {after.get('proof', 0)}, trust {after.get('trust', 0)}, "
                        f"velocity {after.get('velocity', 0)}."
                    )
                lines.append(
                    f"CEO decision after '{d.get('chapter_title', d.get('chapter_id', ''))}': "
                    f"chose \"{d.get('option', '')}\""
                    + (f" (tradeoff accepted: {d.get('tradeoff', '')})" if d.get("tradeoff") else "")
                    + (f". Company consequence: {d.get('consequence_summary', '')}" if d.get("consequence_summary") else "")
                    + econ
                )
                meta["maf_memory"].append({
                    "kind": "ceo_decision",
                    "text": (str(d.get("option", "")) + " -> " + str(d.get("consequence_summary", "")))[:120],
                })
            for h in (retrieval_hits or [])[:2]:
                lines.append(f"Knowledge base ({h.get('source', 'kb')}): {str(h.get('content', ''))[:400]}")
                meta["maf_memory"].append({"kind": "iq_recall", "text": str(h.get("source", ""))[:120]})
            for m in (memories or [])[:3]:
                lines.append(f"Agent memory ({m.get('kind', 'procedural')}): {str(m.get('text', ''))[:300]}")
                meta["maf_memory"].append({"kind": "agent_memory", "text": str(m.get("text", ""))[:120]})
            if lines:
                context.extend_instructions(
                    "campaign-memory",
                    "Session memory (binding direction - the artifact must visibly follow "
                    "the most recent CEO decision):\n- " + "\n- ".join(lines),
                )

    def _wrap(tool_name: str, fn: Callable[..., Any]):
        @tool(name=tool_name,
              description=f"Run the deterministic '{tool_name}' check on a draft artifact (pass the artifact as a JSON string). Call at most once.",
              max_invocations=2)
        def _t(artifact_json: str) -> str:
            # Receipt for the model's own mid-run call: args, result, latency.
            meta["maf_tools_called"].append(tool_name)
            receipt: Dict[str, Any] = {"tool": tool_name, "source": "maf-midrun",
                                       "args": {}, "result": "", "ms": 0.0}
            meta["maf_tool_trace"].append(receipt)
            t0 = time.perf_counter()

            def _done(out: str) -> str:
                receipt["ms"] = round((time.perf_counter() - t0) * 1000, 1)
                return out

            try:
                payload = json.loads(artifact_json) if isinstance(artifact_json, str) else artifact_json
            except json.JSONDecodeError:
                receipt["result"] = "error: artifact_json must be valid JSON"
                return _done(json.dumps({"error": "artifact_json must be valid JSON"}))
            receipt["args"] = ({"artifact_keys": list(payload)[:5]} if isinstance(payload, dict)
                               else {"artifact": str(payload)[:60]})
            try:
                result = fn(payload)
                r = result.get("results") if isinstance(result, dict) else None
                r = r if isinstance(r, dict) else {}
                score = r.get("score")
                checks = r.get("checks") or {}
                passed = sum(1 for v in checks.values() if v)
                receipt["result"] = (f"score={score} checks {passed}/{len(checks)}"
                                     if score is not None else str(result)[:80])
                return _done(json.dumps(result)[:2000])
            except Exception as e:
                receipt["result"] = f"error: {type(e).__name__}: {e}"
                return _done(json.dumps({"error": f"{type(e).__name__}: {e}"}))
        return _t

    async def _run(use_foundry: bool) -> str:
        if use_foundry:
            # Preferred: agent-framework-foundry's FoundryChatClient - inference
            # through the Foundry project Responses endpoint with AAD auth.
            from agent_framework.foundry import FoundryChatClient
            client = FoundryChatClient(
                project_endpoint=foundry_project_endpoint(),
                model=deployment,
                credential=_aad_credential(),
            )
            meta["maf_client"] = "FoundryChatClient"
        else:
            # Compatibility fallback: the resource /openai/v1 endpoint.
            client = OpenAIChatClient(model=deployment, api_key=api_key, base_url=base_url)
            meta["maf_client"] = "OpenAIChatClient"
        agent = Agent(
            client=client,
            name=name,
            instructions=instructions,
            tools=[_wrap(n, f) for n, f in (tool_fns or {}).items()] or None,
            context_providers=[CampaignMemory()],
        )
        resp = await agent.run(prompt)
        # UsageDetails is an open TypedDict in current MAF builds (attribute
        # access always misses) - read mapping-style first, attributes second.
        usage = getattr(resp, "usage_details", None) or getattr(resp, "usage", None)

        def _u(key: str) -> Any:
            if isinstance(usage, dict):
                return usage.get(key)
            return getattr(usage, key, None)

        for src, dst in (("input_token_count", "tokens_in"), ("output_token_count", "tokens_out"),
                         ("prompt_tokens", "tokens_in"), ("completion_tokens", "tokens_out")):
            v = _u(src)
            if isinstance(v, int):
                meta[dst] = v
        # Reasoning ("thinking") tokens when the service exposes them - vendor
        # extras ride as additional int keys on the open TypedDict.
        extras = (usage if isinstance(usage, dict)
                  else getattr(usage, "additional_counts", None) or {})
        if isinstance(extras, dict):
            for k, v in extras.items():
                if "reasoning" in str(k).lower() and isinstance(v, int):
                    meta["reasoning_tokens"] = meta.get("reasoning_tokens", 0) + v
        return str(resp)

    global _FOUNDRY_PATH_OK, _FOUNDRY_FALLBACK_REASON
    try_foundry = bool(foundry_project_endpoint()) and _FOUNDRY_PATH_OK is not False
    if not try_foundry and not meta.get("maf_fallback_reason"):
        # Document why this run never attempts the Foundry path: either the
        # endpoint is unconfigured or a prior run already hit the wall.
        meta["maf_fallback_reason"] = (_FOUNDRY_FALLBACK_REASON
                                       or ("FOUNDRY_PROJECT_ENDPOINT not set"
                                           if not foundry_project_endpoint() else ""))
    loop = asyncio.new_event_loop()
    try:
        if try_foundry:
            try:
                text = loop.run_until_complete(_run(True))
                _FOUNDRY_PATH_OK = True
                return text, meta
            except Exception as e:
                # RBAC (Azure AI User role missing), region gaps, or preview
                # flux - remember and degrade to the compatibility client.
                # The reason is a receipt: it rides the invocation into the
                # replay log so "why it fell back" is never a mystery.
                _FOUNDRY_PATH_OK = False
                _FOUNDRY_FALLBACK_REASON = (
                    f"FoundryChatClient {type(e).__name__}: {str(e)[:200]}")
                meta["maf_fallback_reason"] = _FOUNDRY_FALLBACK_REASON
                meta["maf_memory"].clear()
                meta["maf_tools_called"].clear()
                meta["maf_tool_trace"].clear()
        text = loop.run_until_complete(_run(False))
        return text, meta
    finally:
        loop.close()


def run_maf_group_chat(
    api_key: str,
    base_url: str,
    company_name: str,
    pitch: str,
    chapter_title: str,
    option: str,
    consequence_summary: str,
    participants: List[Dict[str, Any]],
    simulation: bool = False,
    history: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Runs a live agent group chat standup using Microsoft Agent Framework.

    The implementation intentionally uses core MAF `Agent` instances instead of
    GroupChatBuilder so a fresh fork only needs the base framework package. In
    live mode each participant receives the prior transcript and contributes one
    brief turn. In simulation mode the same shape is returned without importing
    MAF, which keeps smoke tests offline-safe.
    """
    role_labels = {
        "strategist": "Strategist",
        "designer": "Designer",
        "marketer": "Marketer",
        "ops": "Operations",
        "narrator": "World Designer",
        "orgdesigner": "Org Designer",
        "founder": "Human Operator",
    }
    role_portrait = {
        "strategist": "strategist",
        "designer": "designer",
        "marketer": "marketer",
        "ops": "ops",
        "narrator": "narrator",
        "orgdesigner": "orgdesigner",
        "founder": "founder",
    }
    role_text_style = {
        "strategist": "market posture",
        "designer": "product and experience posture",
        "marketer": "growth posture",
        "ops": "operating posture",
        "narrator": "world-state posture",
        "orgdesigner": "org-design posture",
        "founder": "CEO direction",
    }
    role_debate_frame = {
        "strategist": (
            "Protect market truth. Challenge fuzzy ICPs, name the adoption bet, "
            "and ask design or growth for the evidence you need."
        ),
        "designer": (
            "Protect product clarity. Challenge bloated scope, translate the "
            "decision into one user-facing loop, and ask strategy or ops what "
            "constraint is non-negotiable."
        ),
        "marketer": (
            "Protect momentum. Challenge timid launches, name the channel risk, "
            "and ask strategy or product for the proof that will convert."
        ),
        "ops": (
            "Protect runway and execution. Challenge hidden cost, name the "
            "operational bottleneck, and ask the next owner what must be automated."
        ),
        "narrator": (
            "Protect the story loop. Name what changed in the simulation and "
            "force the next speaker to carry that change forward."
        ),
        "orgdesigner": (
            "Protect role fit. Challenge unclear ownership and name the worker "
            "or handoff the company now needs."
        ),
    }

    def default_speaker_profile(name: str, role: str, worker_id: str) -> Dict[str, Any]:
        portrait = role_portrait.get(role, role_portrait["narrator"])
        return {
            "display_name": name,
            "role": role,
            "role_label": role_labels.get(role, role.title()),
            "worker_id": worker_id or role,
            "portrait": portrait,
            "portrait_url": f"/game/assets/generated/{portrait}.png",
            "text_style": role_text_style.get(role, "standup posture"),
        }

    def fallback_message(p: Dict[str, Any]) -> str:
        return (
            p.get("message")
            or f"I am absorbing the CEO choice '{option}' and carrying it into my next handoff."
        )

    def build_turn(p: Dict[str, Any], msg: str, source: str, client_name: str = "") -> Dict[str, Any]:
        role = p.get("role") or "strategist"
        name = p.get("speaker") or p.get("display_name") or role
        worker_id = p.get("worker_id") or role
        tool = (p.get("tool_call") or {}).get("tool") or p.get("tool") or "read_memory"
        tool_call = {"tool": tool, "status": "completed"}
        speaker_profile = p.get("speaker_profile") or default_speaker_profile(name, role, worker_id)
        return {
            "speaker": name,
            "role": role,
            "worker_id": worker_id,
            "tool_call": tool_call,
            "message": msg,
            "handoff_to": p.get("handoff_to") or "",
            "speaker_profile": speaker_profile,
            "source": source,
            "framework": "microsoft-agent-framework" if source == "maf" else "simulation",
            "maf_client": client_name,
            "character_state": {
                "worker_id": worker_id,
                "display_name": speaker_profile.get("display_name") or name,
                "role": role,
                "role_label": speaker_profile.get("role_label") or role_labels.get(role, role.title()),
                "portrait_url": speaker_profile.get("portrait_url", ""),
                "voice_id": speaker_profile.get("voice_id", ""),
                "status": "spoke",
                "thought_state": "responded",
                "current_message": msg,
                "tool_calls": [tool_call],
                "handoff_to": p.get("handoff_to") or "",
                "source": source,
                "framework": "microsoft-agent-framework" if source == "maf" else "simulation",
                "maf_client": client_name,
            },
        }

    if simulation:
        return [build_turn(p, fallback_message(p), "simulation") for p in participants]

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        from agent_framework import Agent
        from agent_framework.openai import OpenAIChatClient
        from agents.model_config import model_for

    def clean_message(text: str) -> str:
        return " ".join(
            str(text or "")
            .replace('"', "")
            .replace("“", "")
            .replace("”", "")
            .split()
        )[:420]

    async def run_turn(agent: Any, prompt: str) -> str:
        return clean_message(str(await agent.run(prompt)))

    turns: List[Dict[str, Any]] = []
    conversation_history: List[str] = []

    if history:
        for turn in history:
            history_role_label = turn.get("role") or turn.get("worker_id") or "agent"
            conversation_history.append(f"{turn['speaker']} ({history_role_label}): {turn['message']}")

    loop = asyncio.new_event_loop()

    try:
        for p in participants:
            role = p.get("role") or "strategist"
            name = p.get("speaker") or p.get("display_name") or role

            deployment = model_for(role) or model_for("narrator") or ""
            if not deployment:
                msg = fallback_message(p)
                turns.append(build_turn(p, msg, "simulation"))
                conversation_history.append(f"{name} ({role}): {msg}")
                continue

            history_text = "\n".join(conversation_history)
            history_block = f"\n\nStandup Conversation History:\n{history_text}" if conversation_history else ""
            participant_names = ", ".join(
                str(x.get("speaker") or x.get("display_name") or x.get("role") or "agent")
                for x in participants
            )
            system_instructions = (
                f"You are {name}, the {role} for the company '{company_name}' (pitch: '{pitch[:500]}').\n"
                f"The CEO just made a decision at the gate of the chapter '{chapter_title}':\n"
                f"  Choice: \"{option}\"\n"
                f"  Consequence: {consequence_summary}\n\n"
                f"Round table: {participant_names}.\n"
                f"Your stance: {role_debate_frame.get(role, 'Protect the next useful decision. Challenge weak assumptions and name the next handoff.')}\n\n"
                "You are participating in a brief startup standup, not filing a status report.\n"
                "Your spoken turn must do exactly one of these: answer a prior point, challenge a named teammate, or ask a named teammate one pointed question.\n"
                "Name the teammate when you respond to them. If there is no prior teammate, address the CEO.\n"
                "Mention the tool/state you are using in plain speech only if it changes the decision.\n"
                "Keep it speakable: 1 sentence, maximum 32 words.\n"
                "Do not output markdown code blocks or JSON. Output only your spoken response."
            )
            prompt = (
                f"It is your turn to speak.{history_block}\n\n"
                "Give one crisp standup line that advances the debate:"
            )

            client = None
            client_name = ""
            use_foundry = bool(foundry_project_endpoint()) and _FOUNDRY_PATH_OK is not False
            if use_foundry:
                try:
                    from agent_framework.foundry import FoundryChatClient
                    client = FoundryChatClient(
                        project_endpoint=foundry_project_endpoint(),
                        model=deployment,
                        credential=_aad_credential(),
                    )
                    client_name = "FoundryChatClient"
                except Exception:
                    client = None

            if client is None:
                client = OpenAIChatClient(model=deployment, api_key=api_key, base_url=base_url)
                client_name = "OpenAIChatClient"

            agent = Agent(client=client, name=name, instructions=system_instructions)
            try:
                msg = loop.run_until_complete(run_turn(agent, prompt))
                if not msg:
                    raise ValueError("empty MAF standup turn")
                source = "maf"
            except Exception:
                msg = fallback_message(p)
                source = "simulation"
                client_name = ""

            conversation_history.append(f"{name} ({role}): {msg}")
            turns.append(build_turn(p, msg, source, client_name))
    finally:
        loop.close()

    return turns
