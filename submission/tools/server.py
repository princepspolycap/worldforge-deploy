import os
import sys
import json
import time
import yaml
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, Tuple, Iterator
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response
from pydantic import BaseModel

# Ensure submission path is in Python path for local modular references
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from state.schema import StateStore, QuestState, QuestStep, CompanyState, WorldGraph, Chapter, OrgBlueprint
from agents.foundry_agents import MasterNarrator, StrategistAgent, DesignerAgent, MarketerAgent, generate_lore
from agents.model_config import model_for, is_live
from agents.world_designer import design_world
from agents.worker_factory import run_world, execute_chapter, bind_world_to_org
from agents.org_designer import design_org
from agents.retrieval import retrieve, brief_from_url
from agents.company_analyst import analyze_company as analyze_company_url
from tools.code_interpreter_wrappers import validate_positioning, validate_landing_page, validate_marketing_email

app = FastAPI(
    title="Your Company Is the Dungeon - Server",
    description="Backend API for local and visual reasoning runs."
)

# Enable CORS for local cross-origin development if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Persistent file-based store
STATE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state", "state.json")
store = StateStore(filepath=STATE_FILE)

class PitchRequest(BaseModel):
    pitch: str
    company_name: Optional[str] = "Acolyte's Venture"

@app.get("/api/state")
def get_state():
    """Gets the current company state from disk."""
    state = store.load()
    if not state:
        # Return a clean empty-like structure or indicator
        return {"initialized": False, "state": None}
    return {"initialized": True, "state": state.model_dump()}


@app.get("/api/mode")
def get_mode():
    """Report whether the reasoning path is hitting live Foundry or simulation."""
    return {"live": is_live(), "mode": "live" if is_live() else "simulation"}


class LoreRequest(BaseModel):
    pitch: Optional[str] = ""
    company_name: Optional[str] = ""


@app.post("/api/lore")
def lore(payload: LoreRequest):
    """Generate a short, personalized adventure intro for the player's idea.

    Adaptive lore: the narrator deployment frames *this* founder's specific
    venture as their quest. Spoken aloud by the UI while the org designs, so the
    opening is bespoke to whatever pitch / URL / voice input the player gave.
    """
    out = generate_lore(payload.pitch or "", payload.company_name or "")
    return out


# ---------------------------------------------------------------------------
# Narration: real Microsoft Azure neural TTS with a model-upgrade chain.
# Newer audio models (gpt-audio-1.5 family) speak through the chat-completions
# audio API; older speech models (gpt-4o-mini-tts) use /audio/speech. We try
# each configured deployment in order, auto-detecting the right API shape, so
# upgrading the voice is just an env change. The browser still has its own
# speechSynthesis fallback, so if every deployment is unconfigured or errors,
# narration degrades gracefully to local TTS.
# ---------------------------------------------------------------------------

TTS_ENDPOINT = os.getenv("TTS_ENDPOINT", "").strip().rstrip("/")
# Comma-separated upgrade chain, newest voice model first. Falls back to the
# single TTS_DEPLOYMENT for older .env files.
_tts_deployments_raw = os.getenv("TTS_DEPLOYMENTS", "").strip()
TTS_DEPLOYMENTS = [d.strip() for d in _tts_deployments_raw.split(",") if d.strip()] or \
    [os.getenv("TTS_DEPLOYMENT", "gpt-4o-mini-tts").strip()]
TTS_API_KEY = os.getenv("TTS_API_KEY", "").strip()
TTS_VOICE = os.getenv("TTS_VOICE", "onyx").strip()
TTS_API_VERSION = os.getenv("TTS_API_VERSION", "2025-03-01-preview").strip()


def tts_available() -> bool:
    return bool(TTS_ENDPOINT and TTS_API_KEY and TTS_DEPLOYMENTS)


def _tts_uses_chat_audio(deployment: str) -> bool:
    """Newer audio models (gpt-audio*, MAI-Voice*) speak via chat completions."""
    name = deployment.lower()
    return "gpt-audio" in name or "mai-voice" in name


def _synthesize_speech_api(deployment: str, text: str, voice: str) -> bytes:
    """Legacy speech models (gpt-4o-mini-tts, tts-1): POST /audio/speech."""
    url = (f"{TTS_ENDPOINT}/openai/deployments/{deployment}"
           f"/audio/speech?api-version={TTS_API_VERSION}")
    body = json.dumps({"model": deployment, "input": text, "voice": voice}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"api-key": TTS_API_KEY, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read()


def _synthesize_chat_audio_api(deployment: str, text: str, voice: str) -> bytes:
    """Newer audio models: chat completions with audio modality, mp3 out."""
    url = (f"{TTS_ENDPOINT}/openai/deployments/{deployment}"
           f"/chat/completions?api-version={TTS_API_VERSION}")
    body = json.dumps({
        "model": deployment,
        "modalities": ["text", "audio"],
        "audio": {"voice": voice, "format": "mp3"},
        "messages": [
            {"role": "system",
             "content": "Read the user's text aloud verbatim, with natural epic-narrator delivery. Do not add or change words."},
            {"role": "user", "content": text},
        ],
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"api-key": TTS_API_KEY, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    b64 = (((payload.get("choices") or [{}])[0].get("message") or {}).get("audio") or {}).get("data", "")
    if not b64:
        raise ValueError("chat-audio response contained no audio data")
    import base64
    return base64.b64decode(b64)


def synthesize_narration(text: str, voice: str) -> bytes:
    """Try each configured voice deployment newest-first; raise if all fail."""
    last_exc: Exception = RuntimeError("No TTS deployments configured.")
    for deployment in TTS_DEPLOYMENTS:
        try:
            if _tts_uses_chat_audio(deployment):
                return _synthesize_chat_audio_api(deployment, text, voice)
            return _synthesize_speech_api(deployment, text, voice)
        except Exception as exc:  # noqa: BLE001 - try the next deployment
            last_exc = exc
            continue
    raise last_exc


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None


@app.get("/api/tts/status")
def tts_status():
    """Tell the UI whether server-side Azure neural narration is available."""
    return {
        "available": tts_available(),
        "voice": TTS_VOICE,
        "deployment": TTS_DEPLOYMENTS[0] if tts_available() else None,
        "deployments": TTS_DEPLOYMENTS if tts_available() else [],
    }


@app.post("/api/tts")
def tts(payload: TTSRequest):
    """Synthesize narration through the voice-model upgrade chain.

    Returns audio/mpeg bytes. On any failure returns 503 so the browser falls
    back to local speechSynthesis - narration never hard-fails the demo.
    """
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text to speak.")
    if not tts_available():
        raise HTTPException(status_code=503, detail="Server TTS not configured.")

    # Keep latency sane: cap very long inputs (beats are short anyway).
    text = text[:1200]
    try:
        audio = synthesize_narration(text, payload.voice or TTS_VOICE)
    except Exception as exc:  # noqa: BLE001 - degrade to browser TTS
        raise HTTPException(status_code=503, detail=f"TTS upstream error: {exc}")

    return Response(content=audio, media_type="audio/mpeg",
                    headers={"Cache-Control": "no-store"})

@app.post("/api/init")
def initialize_game(payload: PitchRequest):
    """Initializes the game session with a custom pitch and decomposes it."""
    pitch = payload.pitch
    company_name = payload.company_name or "My Spawned Venture"
    
    # 1. Initialize State Store
    state = store.initialize_new_company(
        name=company_name,
        pitch=pitch,
        description="A startup forged in QuestForge."
    )
    store.log_event("SESSION_START", "system", f"Initialized fresh startup session for company: {company_name}")
    
    # 2. Master Narrator Decomposes the Pitch into 3 Quests
    narrator = MasterNarrator()
    try:
        steps_data = narrator.decompose_pitch(pitch)
        quest_steps = [QuestStep(**s) for s in steps_data]
    except Exception as e:
        # Fallback to offline mock steps if decomposition or validation fails.
        store.log_event("DECOMPOSE_FALLBACK", "system",
                        f"Narrator decomposition unusable, using safe defaults: {e}")
        steps_data = [
            {
                "id": "step_1_positioning",
                "title": "Define Your Target Audience and Positioning",
                "description": f"Use the Strategist to scope target clients and shape the positioning of: '{pitch}'",
                "assigned_to": "strategist",
                "artifact_type": "doc",
                "xp_reward": 15
            },
            {
                "id": "step_2_landing_page",
                "title": "Draft and Validate Your Landing Page Structure",
                "description": "Work with the Designer to write a compelling hero headline, copy, and set up a deployment check.",
                "assigned_to": "designer",
                "artifact_type": "url",
                "xp_reward": 25
            },
            {
                "id": "step_3_launch_email",
                "title": "Draft Your Landing Page Launch Campaign",
                "description": "Have the Marketer create a launch outreach or newsletter email, featuring a CTA to drive landing page signups.",
                "assigned_to": "marketer",
                "artifact_type": "email",
                "xp_reward": 20
            }
        ]
        quest_steps = [QuestStep(**s) for s in steps_data]

    quest_state = QuestState(
        id="first_landing_page",
        title="Forge Your First Landing Page",
        description="Fulfill positioning, draft a page, and set up campaign outreach.",
        steps=quest_steps
    )
    state.active_quest = quest_state
    store.save()
    
    store.log_event("QUEST_START", narrator.name, "Decomposed pitch into active quest-steps.", {"steps": steps_data})
    return {"initialized": True, "state": state.model_dump()}


# ---------------------------------------------------------------------------
# Shared agent-execution + reasoning-trace helpers (used by the plain POST
# endpoint and the SSE streaming endpoint, so both run identical logic).
# ---------------------------------------------------------------------------

def _run_step_agent(quest: QuestState, step: QuestStep) -> Tuple[Dict[str, Any], bool, Dict[str, Any], Dict[str, Any]]:
    """Run the right character agent for a quest step and validate its artifact.

    Returns (artifact_data, success, validation_results, reasoning). `reasoning`
    is {reasoning_tokens, reasoning_preview} captured from the live Foundry
    response (empty in simulation). Pure compute - no state mutation or
    persistence, so callers control how results are stored.
    """
    pitch = (store.state.pitch if store.state else "") or ""
    role = step.assigned_to

    if role == "strategist":
        agent = StrategistAgent()
        artifact = agent.formulate_positioning(pitch)
        success, results = validate_positioning(artifact)
    elif role == "designer":
        positioning = quest.steps[0].artifact_data or {}
        agent = DesignerAgent()
        artifact = agent.build_page_structure(positioning)
        success, results = validate_landing_page(artifact)
    elif role == "marketer":
        positioning = quest.steps[0].artifact_data or {}
        page_structure = quest.steps[1].artifact_data or {}
        agent = MarketerAgent()
        artifact = agent.draft_launch_email(positioning, page_structure)
        success, results = validate_marketing_email(artifact)
    else:
        raise ValueError(f"Unknown agent role: {role}")

    return artifact, success, results, dict(agent.last_reasoning or {})


# Friendly per-role labels for the reasoning trace.
_ROLE_PERSONA = {
    "strategist": ("Soren", "Strategist"),
    "designer": ("Dahlia", "Designer"),
    "marketer": ("Maddox", "Marketer"),
}


def _sse(event: str, data: Dict[str, Any]) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _stream_step_reasoning(state: CompanyState, quest: QuestState, step: QuestStep) -> Iterator[str]:
    """Generator that performs the agent turn while emitting live trace events.

    Each yielded frame corresponds to a real phase boundary: routing, the live
    Foundry deployment call, then each deterministic validator check. This is
    the genuine multi-step reasoning made visible during the turn (not after).
    """
    persona_name, persona_role = _ROLE_PERSONA.get(step.assigned_to, (step.assigned_to, step.assigned_to))
    deployment = model_for(step.assigned_to) or ""
    mode = "live" if (is_live() and deployment) else "simulation"
    deployment_label = f"foundry-{step.assigned_to}" if mode == "live" else "simulation"

    # Mark the step in-progress up front so a refresh mid-turn is consistent.
    step.status = "in-progress"
    store.log_event("STEP_START", step.assigned_to, f"Agent begins work on: {step.title}", {"step_id": step.id})
    store.save()

    # Phase 1: the Narrator routes the step to the right specialist.
    yield _sse("phase", {
        "kind": "route",
        "actor": "The Narrator",
        "message": f"Routing '{step.title}' to {persona_name} the {persona_role}.",
        "deployment": deployment_label,
        "mode": mode,
    })

    # Phase 2: invoke the Foundry deployment (the real reasoning happens here).
    yield _sse("phase", {
        "kind": "invoke_start",
        "actor": persona_name,
        "message": f"Invoking {deployment_label} deployment to reason over the pitch...",
        "role": step.assigned_to,
    })

    t0 = time.time()
    try:
        artifact_data, success, val_results, reasoning = _run_step_agent(quest, step)
    except Exception as exc:  # noqa: BLE001
        step.status = "failed"
        store.log_event("STEP_EXECUTION_ERROR", "system", f"Failed executing step reasoning: {exc}")
        store.save()
        yield _sse("failure", {"message": f"Agent execution failure: {exc}"})
        return
    latency = round(time.time() - t0, 2)

    artifact_keys = list(artifact_data.keys())
    reasoning_tokens = int(reasoning.get("reasoning_tokens", 0) or 0)
    reasoning_preview = reasoning.get("reasoning_preview", "") or ""
    done_msg = f"Artifact returned ({len(artifact_keys)} fields) in {latency}s."
    if reasoning_tokens:
        done_msg = (f"Artifact returned ({len(artifact_keys)} fields) in {latency}s "
                    f"after {reasoning_tokens} thinking tokens.")
    yield _sse("phase", {
        "kind": "invoke_done",
        "actor": persona_name,
        "message": done_msg,
        "latency_s": latency,
        "artifact_keys": artifact_keys,
        "reasoning_tokens": reasoning_tokens,
        "reasoning_preview": reasoning_preview,
    })

    # Phase 3: deterministic code-interpreter validators, streamed per check.
    yield _sse("phase", {
        "kind": "validate_start",
        "actor": "Code Interpreter",
        "message": "Scoring the artifact with deterministic validators...",
    })
    checks = (val_results or {}).get("checks", {}) or {}
    for name, passed in checks.items():
        time.sleep(0.18)  # paced so the audience can read each check land
        yield _sse("phase", {
            "kind": "check",
            "actor": "Code Interpreter",
            "name": name,
            "passed": bool(passed),
            "message": f"check {name}: {'PASS' if passed else 'FAIL'}",
        })

    score = int((val_results or {}).get("score", 0))
    yield _sse("phase", {
        "kind": "score",
        "actor": "Code Interpreter",
        "score": score,
        "passed": bool(success),
        "message": f"Validation score: {score}/100",
    })

    # Persist results identically to the POST path so the verification gate works.
    step.artifact_data = artifact_data
    step.validation_results = val_results
    store.log_event("STEP_COMPLETED_REASONING", step.assigned_to,
                    "Artifact created. Verification gate waiting for review.",
                    {"artifact": artifact_data, "validation_results": val_results,
                     "reasoning_tokens": reasoning_tokens,
                     "reasoning_preview": reasoning_preview})
    store.save()

    yield _sse("done", {
        "state": state.model_dump(),
        "current_step": step.model_dump(),
    })


@app.get("/api/step/execute/stream")
def execute_current_step_stream():
    """SSE variant of execute: streams reasoning phases live during the turn.

    The browser consumes this with EventSource and appends each phase to the
    reasoning trace in real time. Falls back to POST /api/step/execute if the
    client cannot stream. Persists identical state, so approval works after.
    """
    state = store.load()
    if not state or not state.active_quest:
        raise HTTPException(status_code=400, detail="Game session not initialized. Post to /api/init first.")
    quest = state.active_quest
    if quest.current_step_index >= len(quest.steps):
        raise HTTPException(status_code=400, detail="All quest-steps completed!")
    step = quest.steps[quest.current_step_index]

    return StreamingResponse(
        _stream_step_reasoning(state, quest, step),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/step/execute")
def execute_current_step():
    """Runs outstanding agent calculations and validation on the currently active step."""
    state = store.load()
    if not state or not state.active_quest:
        raise HTTPException(status_code=400, detail="Game session not initialized. Post to /api/init first.")
        
    quest = state.active_quest
    if quest.current_step_index >= len(quest.steps):
        raise HTTPException(status_code=400, detail="All quest-steps completed!")
        
    step = quest.steps[quest.current_step_index]
    
    # Work begins
    step.status = "in-progress"
    store.log_event("STEP_START", step.assigned_to, f"Agent begins work on: {step.title}", {"step_id": step.id})
    store.save()
    
    try:
        artifact_data, success, val_results, reasoning = _run_step_agent(quest, step)
        step.artifact_data = artifact_data
        step.validation_results = val_results
        
        store.log_event("STEP_COMPLETED_REASONING", step.assigned_to, f"Artifact created. Verification gate waiting for review.", {
            "artifact": artifact_data,
            "validation_results": val_results,
            "reasoning_tokens": int(reasoning.get("reasoning_tokens", 0) or 0),
            "reasoning_preview": reasoning.get("reasoning_preview", "") or ""
        })
        store.save()
        
    except Exception as e:
        step.status = "failed"
        store.log_event("STEP_EXECUTION_ERROR", "system", f"Failed executing step reasoning: {str(e)}")
        store.save()
        raise HTTPException(status_code=500, detail=f"Agent Execution Failure: {str(e)}")
        
    return {"state": state.model_dump(), "current_step": step.model_dump()}

def _compute_artifact_tier(score: int) -> Dict[str, Any]:
    """Score -> quality tier with XP multiplier. Bronze does not extend streaks."""
    if score >= 95:
        return {"tier": "gold", "label": "GOLD", "multiplier": 2.0, "extends_streak": True}
    if score >= 80:
        return {"tier": "silver", "label": "SILVER", "multiplier": 1.5, "extends_streak": True}
    return {"tier": "bronze", "label": "BRONZE", "multiplier": 1.0, "extends_streak": False}


@app.post("/api/step/approve")
def approve_current_step():
    """Approves the currently active step, awards XP, and advances step index."""
    state = store.load()
    if not state or not state.active_quest:
        raise HTTPException(status_code=400, detail="Game session not initialized.")
        
    quest = state.active_quest
    idx = quest.current_step_index
    if idx >= len(quest.steps):
        raise HTTPException(status_code=400, detail="All steps already finalized.")
        
    step = quest.steps[idx]
    
    # Award reward and advance.
    step.status = "completed"
    score = int((step.validation_results or {}).get("score", 0))
    tier_info = _compute_artifact_tier(score)
    base_xp = int(step.xp_reward * tier_info["multiplier"])

    # Streak: gold/silver extend, bronze resets.
    if tier_info["extends_streak"]:
        state.streak += 1
    else:
        state.streak = 0

    # Streak bonus kicks in at 3.
    streak_bonus = 5 * max(0, state.streak - 2)
    total_xp = base_xp + streak_bonus
    state.xp += total_xp

    # Stamp the verdict onto the step so the UI can render tier + earnings.
    step.validation_results = {
        **(step.validation_results or {}),
        "tier": tier_info["tier"],
        "tier_label": tier_info["label"],
        "xp_base": base_xp,
        "xp_streak_bonus": streak_bonus,
        "xp_earned": total_xp,
    }

    store.log_event("STEP_APPROVED", "human_verifier", f"Approved step {step.id}. {tier_info['label']} tier (+{total_xp} XP).", {
        "xp_added": total_xp,
        "xp_base": base_xp,
        "xp_streak_bonus": streak_bonus,
        "tier": tier_info["tier"],
        "streak": state.streak,
        "total_xp": state.xp,
    })
    
    # Check leveling up
    if state.xp >= 50 and state.level == 1:
        state.level += 1
        store.log_event("LEVEL_UP", "system", f"StartUp Level Up! Advanced to level {state.level}", {"xp": state.xp})
    elif state.xp >= 100 and state.level == 2:
        state.level += 1
        store.log_event("LEVEL_UP", "system", f"StartUp Level Up! Advanced to level {state.level}", {"xp": state.xp})
        
    # Move index forward
    quest.current_step_index += 1
    
    if quest.current_step_index >= len(quest.steps):
        quest.status = "completed"
        state.stage = "validated"
        store.log_event("QUEST_LINE_COMPLETED", "system", "First Landing Page questline has been fully accomplished! Stage upgraded to 'validated'.")
        
    store.save()
    return {"state": state.model_dump()}

@app.post("/api/step/reject")
def reject_current_step(feedback: Optional[str] = Body(default=None, embed=True)):
    """Rejects the current step, moving it back to not-started for refactoring."""
    state = store.load()
    if not state or not state.active_quest:
        raise HTTPException(status_code=400, detail="Game session not initialized.")
        
    quest = state.active_quest
    idx = quest.current_step_index
    if idx >= len(quest.steps):
        raise HTTPException(status_code=400, detail="All steps already finalized.")
        
    step = quest.steps[idx]
    step.status = "not-started"
    state.streak = 0
    
    store.log_event("STEP_REJECTED", "human_verifier", f"Rejected artifact for {step.id}. Strategic feedback recorded.", {
        "human_feedback": feedback or "No comments detailed."
    })
    
    store.save()
    return {"state": state.model_dump()}


# ---------------------------------------------------------------------------
# World Designer + Worker Factory autoplay
# ---------------------------------------------------------------------------

class AutoplayRequest(BaseModel):
    pitch: str
    company_name: Optional[str] = "QuestForge Ltd."
    auto_approve_threshold: int = 80  # score >= this auto-approves


# ---------------------------------------------------------------------------
# Org Designer: dynamic digital workforce for a company (pitch OR url)
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    pitch: Optional[str] = None
    url: Optional[str] = None
    company_name: Optional[str] = "QuestForge Ltd."


@app.post("/api/company/analyze")
def analyze_company(payload: AnalyzeRequest):
    """Design the dynamic org an LLM thinks this company needs.

    Accepts a pitch OR a company URL. When a URL is given, the homepage is
    fetched (SSRF-guarded, stdlib only) and turned into a brief, so you can
    point this at any company. The result is a team of digital workers - the
    execution layer behind a single human operator - with an educational `why`
    per role. Also awards a one-time "Org chartered" XP (simple game mechanic).
    """
    url = (payload.url or "").strip()
    pitch = (payload.pitch or "").strip()
    if not url and not pitch:
        raise HTTPException(status_code=400, detail="Provide a pitch or a company url.")

    company_name = payload.company_name or "QuestForge Ltd."
    # Analyze starts a fresh venture session - designing the org is the first
    # reasoning step, before any chapters exist.
    state = store.initialize_new_company(
        name=company_name, pitch=pitch or url, description="A venture forged in QuestForge."
    )
    store.log_event("SESSION_START", "system", f"New analyze session for: {company_name}")

    # On the URL path, run a two-hop reasoning chain that is visible in the
    # replay log: (1) scrape the homepage into structured signal, (2) a Company
    # Analyst agent reasons about what the business is. The clean profile then
    # seeds the Org Designer - so a URL becomes a coherent org, not raw text.
    profile = None
    summary_hint = ""
    if url:
        profile = analyze_company_url(url)
        brief = profile["brief"]
        summary_hint = profile.get("company_summary", "")
        source, source_ref = "url", url
        if profile.get("scraped"):
            scrape_msg = f"Scraped {profile['host']} (read {profile.get('scraped_chars', 0)} chars)."
        else:
            scrape_msg = f"Scraped {profile['host']} (homepage unreachable, using domain default)."
        store.log_event(
            "URL_SCRAPED", "scraper", scrape_msg,
            {"host": profile["host"], "scraped": profile.get("scraped", False),
             "signals": profile.get("signals", [])},
        )
        store.log_event(
            "COMPANY_PROFILED", "company_analyst",
            f"Reasoned the business: {profile['company_summary']}",
            {"what_they_sell": profile.get("what_they_sell"),
             "target_customer": profile.get("target_customer"),
             "business_model": profile.get("business_model"),
             "mode": profile.get("mode")},
        )
    else:
        brief, source, source_ref = pitch, "pitch", pitch

    blueprint = design_org(brief, source=source, source_ref=source_ref, summary_hint=summary_hint)
    state.org = OrgBlueprint(**blueprint)

    # Simple game mechanic: chartering the org rewards XP scaled by how much
    # leverage the digital workforce gives the single human operator.
    charter_xp = 15 + 2 * state.org.digital_worker_count
    state.xp += charter_xp
    state.business_flags["org_chartered"] = True
    if state.xp >= 50 and state.level < 2:
        state.level = 2
    store.log_event(
        "ORG_CHARTERED", "org_designer",
        f"Chartered a {state.org.headcount}-seat org: 1 operator + "
        f"{state.org.digital_worker_count} digital workers (+{charter_xp} XP).",
        {
            "source": source,
            "headcount": state.org.headcount,
            "digital_worker_count": state.org.digital_worker_count,
            "monthly_burn_usd": state.org.monthly_burn_usd,
            "leverage_ratio": state.org.leverage_ratio,
            "xp_earned": charter_xp,
        },
    )

    store.save()
    return {
        "state": state.model_dump(),
        "org": state.org.model_dump(),
        "profile": profile,
        "source": source,
        "brief": brief[:600],
        "mode": "live" if is_live() else "simulation",
    }


@app.post("/api/world/design")
def design_world_endpoint(payload: AutoplayRequest):
    """Uses the WorldDesigner to produce a full venture graph.

    Preserves an org chartered by /api/company/analyze in the same session, so
    the dynamic workforce, earned XP, and flags carry through into the build.
    """
    brief = payload.pitch
    company_name = payload.company_name or "QuestForge Ltd."

    prev = store.load()
    state = store.initialize_new_company(
        name=company_name, pitch=brief, description="A venture forged in QuestForge."
    )
    # Carry forward a prior analyze session (org + earned XP + flags).
    if prev and prev.org:
        state.org = prev.org
        state.xp = prev.xp
        state.level = prev.level
        state.business_flags = prev.business_flags
        store.log_event("WORLD_SESSION", "system", f"Attached venture graph to chartered org for: {company_name}")
    else:
        store.log_event("SESSION_START", "system", f"New world session for: {company_name}")

    chapters_data = design_world(brief)
    world = WorldGraph(
        brief=brief,
        chapters=[Chapter(**ch) if isinstance(ch, dict) else ch for ch in chapters_data],
        status="active",
    )
    # Close the seam: each chapter is owned by one of the digital workers the
    # Org Designer created for this company (not a fixed cast).
    bindings = bind_world_to_org(world, state.org) if state.org else {}
    state.world = world
    store.log_event("WORLD_DESIGNED", "world_designer", f"Produced {len(world.chapters)} chapters.", {
        "chapters": [
            {"id": ch.id, "title": ch.title, "owner_role": ch.owner_role,
             "assigned_worker_title": ch.assigned_worker_title}
            for ch in world.chapters
        ]
    })
    if bindings:
        store.log_event(
            "ORG_BOUND", "org_designer",
            f"Bound {len(bindings)} chapters to dynamically designed digital workers.",
            {"bindings": bindings},
        )
    store.save()
    return {"state": state.model_dump()}


@app.post("/api/world/run-next")
def run_next_chapter():
    """Execute the next pending chapter via the Worker Factory."""
    state = store.load()
    if not state or not state.world:
        raise HTTPException(status_code=400, detail="No world graph. Call /api/world/design first.")

    world = state.world
    pending = [ch for ch in world.chapters if ch.status not in ("completed", "needs-review")]
    if not pending:
        raise HTTPException(status_code=400, detail="All chapters completed or awaiting review.")

    chapter = pending[0]
    idx = world.chapters.index(chapter)
    world.current_chapter_index = idx

    # Foundry IQ memory recalled for this chapter (surfaced to the story view).
    memory = retrieve(f"{world.brief} {chapter.goal} {chapter.success_metric}", top_k=2)

    previous_artifacts = [ch.artifact for ch in world.chapters[:idx] if ch.artifact]
    invocation, artifact, score = execute_chapter(chapter, world.brief, previous_artifacts, org=state.org)
    world.invocations.append(invocation)

    if artifact:
        chapter.artifact = artifact
        chapter.validation_score = score
    chapter.status = "completed" if score >= 80 else "needs-review"

    xp_earned = 10 + (score // 10)
    state.xp += xp_earned
    if state.xp >= 50 and state.level < 2:
        state.level = 2
    elif state.xp >= 100 and state.level < 3:
        state.level = 3

    store.log_event("CHAPTER_EXECUTED", invocation.role,
        f"Chapter '{chapter.title}' -> score {score}, +{xp_earned} XP ({invocation.deployment}, {invocation.latency_s}s)",
        {"chapter_id": chapter.id, "score": score, "xp_earned": xp_earned, "latency_s": invocation.latency_s,
         "reasoning_tokens": invocation.reasoning_tokens,
         "reasoning_preview": invocation.reasoning_preview}
    )

    if all(ch.status == "completed" for ch in world.chapters):
        world.status = "completed"
        state.stage = "launched"
        store.log_event("WORLD_COMPLETED", "system", "All chapters completed! Venture stage: launched.")

    store.save()
    return {
        "state": state.model_dump(),
        "chapter": chapter.model_dump(),
        "invocation": invocation.model_dump(),
        "memory": memory,
    }


@app.post("/api/world/autoplay")
def autoplay_world(payload: AutoplayRequest):
    """Full autoplay: design world + execute all chapters sequentially."""
    brief = payload.pitch
    company_name = payload.company_name or "QuestForge Ltd."
    threshold = payload.auto_approve_threshold

    state = store.initialize_new_company(
        name=company_name, pitch=brief, description="A venture forged in QuestForge."
    )
    store.log_event("SESSION_START", "system", f"Autoplay session for: {company_name}")

    # Design the dynamic org first so chapters are owned by designed digital
    # workers - the same org->execution chain the Story flow shows. Cheap, and
    # runs in simulation too.
    org_blueprint = design_org(brief, source="pitch", source_ref=brief)
    state.org = OrgBlueprint(**org_blueprint)
    store.log_event(
        "ORG_CHARTERED", "org_designer",
        f"Chartered a {state.org.headcount}-seat org: 1 operator + "
        f"{state.org.digital_worker_count} digital workers.",
        {"digital_worker_count": state.org.digital_worker_count,
         "leverage_ratio": state.org.leverage_ratio},
    )

    chapters_data = design_world(brief)
    world = WorldGraph(
        brief=brief,
        chapters=[Chapter(**ch) if isinstance(ch, dict) else ch for ch in chapters_data],
        status="active",
    )
    bindings = bind_world_to_org(world, state.org)
    state.world = world
    store.log_event("WORLD_DESIGNED", "world_designer", f"Produced {len(world.chapters)} chapters.")
    if bindings:
        store.log_event(
            "ORG_BOUND", "org_designer",
            f"Bound {len(bindings)} chapters to dynamically designed digital workers.",
            {"bindings": bindings},
        )

    results = []
    for chapter, invocation, artifact, score in run_world(world, brief, auto_approve_threshold=threshold, org=state.org):
        xp_earned = 10 + (score // 10)
        state.xp += xp_earned
        if state.xp >= 50 and state.level < 2:
            state.level = 2
        elif state.xp >= 100 and state.level < 3:
            state.level = 3

        store.log_event("CHAPTER_EXECUTED", invocation.role,
            f"Chapter '{chapter.title}' -> score {score}, +{xp_earned} XP",
            {"chapter_id": chapter.id, "score": score, "latency_s": invocation.latency_s}
        )
        results.append({"chapter_id": chapter.id, "title": chapter.title, "score": score, "status": chapter.status})

    if world.status == "completed":
        state.stage = "launched"
        store.log_event("WORLD_COMPLETED", "system", "Autoplay complete! All chapters done.")

    store.save()
    return {"state": state.model_dump(), "results": results}


@app.post("/api/reset")
def reset_game():
    """Resets the state file."""
    if os.path.exists(STATE_FILE):
        try:
            os.remove(STATE_FILE)
        except Exception:
            pass
    store.state = None
    return {"success": True, "message": "State reset successfully."}

# Mount static folder for UI
UI_DIRECTORY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui")
os.makedirs(UI_DIRECTORY, exist_ok=True)

# Mount the static UI under /game; '/' serves the story view.
app.mount("/game", StaticFiles(directory=UI_DIRECTORY, html=True), name="ui")

@app.get("/")
def read_root():
    """Serve the 3Blue1Brown-style story view as the default experience."""
    return FileResponse(os.path.join(UI_DIRECTORY, "story.html"))


@app.get("/story")
def read_story():
    """Serve the animated, narrated story view."""
    return FileResponse(os.path.join(UI_DIRECTORY, "story.html"))

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)
