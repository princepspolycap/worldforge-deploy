import os
import sys
import json
import time
import yaml
import random
import urllib.request
import urllib.error
from html import escape as html_escape
from typing import Dict, Any, List, Optional, Tuple, Iterator
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response
from pydantic import BaseModel

# Ensure submission path is in Python path for local modular references
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from state.schema import (
    StateStore,
    QuestState,
    QuestStep,
    CompanyState,
    WorldGraph,
    Stage,
    OrgBlueprint,
    FounderState,
    AntagonistState,
    CharacterRuntimeState,
    ChoiceRecord,
)
from state.consequences import (
    apply_decision_consequence,
    initialize_economics_from_org,
    preview_decision_consequence,
    rule_ids_for_role,
    select_rule_id,
)
from state.api_contract import state_response, step_response, stage_response, reset_response
from state.game_state import (
    choose_next_room,
    claim_reward_card,
    end_player_turn,
    initialize_game_run,
    play_card,
    record_choice_game_state,
    record_stage_encounter,
    start_player_turn,
)
from state.knowledge_records import profile_from_payload, record_world_day, refresh_session_knowledge
from agents.foundry_agents import MasterNarrator, StrategistAgent, DesignerAgent, MarketerAgent, generate_lore
from agents.model_config import model_for, is_live, runtime_mode, get_foundry_client, create_chat_completion
from agents.world_designer import design_world
from agents.worker_factory import run_world, execute_stage, bind_world_to_org
from agents.org_designer import design_org
from agents.retrieval import retrieve, brief_from_url
from agents.memory import remember, recall_memories, memory_snapshot
from agents.founder_analyst import analyze_founder_profile
from agents.antagonist_generator import generate_antagonist, analyze_archetype_gap
from tools.code_interpreter_wrappers import validate_positioning, validate_landing_page, validate_marketing_email
from tools.toolbox import tools_list, tools_call, tools_for_role
from tools.export_org_blueprint import org_to_workforce_bundle
from tools.dilemma_generator import generate_dilemma as generate_story_dilemma, suggest_dilemma_for_stage

app = FastAPI(
    title="World Improvement Agent Game - Server",
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

# Persistent file-based store. DUNGEON_STATE_FILE lets a second server (e.g.
# a simulation test bench on another port) run an isolated session instead of
# clobbering the live demo's state file - two uvicorns on one default path
# overwrite each other mid-playthrough.
STATE_FILE = os.environ.get("CAMPAIGN_STATE_FILE") or os.environ.get("DUNGEON_STATE_FILE") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state", "state.json")
store = StateStore(filepath=STATE_FILE)

class PitchRequest(BaseModel):
    pitch: str
    company_name: Optional[str] = "Acolyte's Venture"
    founder_name: Optional[str] = None
    founder_archetype: Optional[str] = None
    founder_skill: Optional[str] = None
    founder_locale: Optional[str] = None
    founder_voice_stack: Optional[str] = None
    founder_voice: Optional[str] = None
    founder_avatar: Optional[str] = None

def parse_founder(payload: Any) -> Optional[FounderState]:
    if not getattr(payload, "founder_name", None):
        return None
    return FounderState(
        name=payload.founder_name or "Acolyte",
        archetype=payload.founder_archetype or "Builder",
        skill=payload.founder_skill or "building product",
        locale=getattr(payload, "founder_locale", None) or "en-US",
        voice_stack=getattr(payload, "founder_voice_stack", None) or "core_openai",
        voice=payload.founder_voice or "onyx",
        avatar=payload.founder_avatar or "/game/assets/generated/narrator.png"
    )


def forge_antagonist(state: CompanyState, *, mission_brief: str = "", target_customer: str = "") -> None:
    """Forge the competitive foil (villain) from the founder's archetype.

    Single source of truth used by every path that runs stage dilemmas
    (analyze, world/design, autoplay) so the story always has a worthy
    opponent with concrete market tension. Logged for replay visibility.
    """
    founder = state.founder or FounderState()
    antagonist = generate_antagonist(
        founder_archetype=founder.archetype,
        founder_skill=founder.skill,
        mission_brief=mission_brief or state.pitch or "",
        target_customer=target_customer,
    )
    state.antagonist = AntagonistState(**antagonist.model_dump())
    archetype_gap = analyze_archetype_gap(founder.archetype)
    store.log_event(
        "ANTAGONIST_FORGED", "narrator",
        f"Forged antagonist '{state.antagonist.name}' ({state.antagonist.archetype}) "
        f"against founder archetype '{founder.archetype}'.",
        {
            "founder_archetype": founder.archetype,
            "founder_skill": founder.skill,
            "antagonist": state.antagonist.model_dump(),
            "archetype_gap": archetype_gap,
        },
    )

@app.get("/api/state")
def get_state():
    """Gets the current company state from disk."""
    state = store.load()
    return state_response(state)


@app.get("/api/toolbox")
def get_toolbox(role: Optional[str] = None):
    """The toolbox catalog (MCP tools/list shape).

    Passes through to a real Foundry Toolbox when TOOLBOX_URL is configured;
    otherwise lists the local registry. The story UI renders this as the
    workers' shared toolbox. Pass ?role= to also get the tools that archetype
    draws for a stage (powers the reasoning theater).
    """
    catalog = tools_list()
    if role:
        catalog["role_tools"] = tools_for_role(role)
    return catalog


class ToolCallRequest(BaseModel):
    name: str
    arguments: Dict[str, Any] = {}


@app.post("/api/toolbox/call")
def post_toolbox_call(payload: ToolCallRequest):
    """Execute one toolbox tool (MCP tools/call shape)."""
    return tools_call(payload.name, payload.arguments)


@app.get("/api/game")
def get_game_state():
    """Return the authoritative card-building roguelike state."""
    state = store.load()
    if not state:
        raise HTTPException(status_code=404, detail="No active game session.")
    return {
        "game": state.game.model_dump(),
        "economics": state.economics.model_dump(),
        "org": state.org.model_dump() if state.org else None,
        "antagonist": state.antagonist.model_dump() if state.antagonist else None,
    }


class StartTurnRequest(BaseModel):
    stage_id: Optional[str] = ""


@app.post("/api/game/turn/start")
def start_game_turn(payload: StartTurnRequest):
    """Start a card turn: refill energy and draw from deck/discard."""
    state = store.load()
    if not state:
        raise HTTPException(status_code=400, detail="No active game session.")
    try:
        move = start_player_turn(state, stage_id=payload.stage_id or "")
        refresh_session_knowledge(state)
        store.log_event("PLAYER_MOVE", "founder", move.summary, move.model_dump())
        store.save()
        return {"move": move.model_dump(), "state": state.model_dump()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class PlayCardRequest(BaseModel):
    card_id: str
    target_id: Optional[str] = ""
    stage_id: Optional[str] = ""


@app.post("/api/game/card/play")
def play_game_card(payload: PlayCardRequest):
    """Play one card from hand and apply its deterministic game effects."""
    state = store.load()
    if not state:
        raise HTTPException(status_code=400, detail="No active game session.")
    try:
        move = play_card(
            state,
            payload.card_id,
            target_id=payload.target_id or "",
            stage_id=payload.stage_id or "",
        )
        refresh_session_knowledge(state)
        store.log_event("PLAYER_MOVE", "founder", move.summary, move.model_dump())
        store.save()
        return {"move": move.model_dump(), "state": state.model_dump()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class ClaimRewardRequest(BaseModel):
    card_id: str


@app.post("/api/game/reward/claim")
def claim_game_reward(payload: ClaimRewardRequest):
    """Draft one pending reward card into the run deck."""
    state = store.load()
    if not state:
        raise HTTPException(status_code=400, detail="No active game session.")
    try:
        move = claim_reward_card(state, payload.card_id)
        refresh_session_knowledge(state)
        store.log_event("PLAYER_MOVE", "founder", move.summary, move.model_dump())
        store.save()
        return {"move": move.model_dump(), "state": state.model_dump()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/game/turn/end")
def end_game_turn(payload: StartTurnRequest):
    """End a card turn, discard hand, and draw the next turn."""
    state = store.load()
    if not state:
        raise HTTPException(status_code=400, detail="No active game session.")
    try:
        move = end_player_turn(state, stage_id=payload.stage_id or "")
        refresh_session_knowledge(state)
        store.log_event("PLAYER_MOVE", "founder", move.summary, move.model_dump())
        store.save()
        return {"move": move.model_dump(), "state": state.model_dump()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class ChooseRoomRequest(BaseModel):
    room_id: str


@app.post("/api/game/room/choose")
def choose_game_room(payload: ChooseRoomRequest):
    """Choose one of the currently available route rooms."""
    state = store.load()
    if not state:
        raise HTTPException(status_code=400, detail="No active game session.")
    try:
        move = choose_next_room(state, payload.room_id)
        refresh_session_knowledge(state)
        store.log_event("PLAYER_MOVE", "founder", move.summary, move.model_dump())
        store.save()
        return {"move": move.model_dump(), "state": state.model_dump()}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/memory")
def get_memory():
    """Agent memory snapshot: what the workers have learned from this CEO.

    Separate from Foundry IQ (stable source knowledge): this is the learning
    layer - founder profile, procedural patterns from gate decisions, and
    stage summaries. Backed by the Foundry Agent Service memory store when
    FOUNDRY_MEMORY_STORE is configured, local ledger otherwise.
    """
    return memory_snapshot()


@app.get("/api/mode")
def get_mode():
    """Report whether the reasoning path is local, cloud, hybrid, or simulation."""
    mode = runtime_mode()
    return {"live": is_live(), "mode": mode, "local": mode in {"local", "hybrid"}}


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
# Narration: real Microsoft Azure neural TTS (gpt-4o-mini-tts).
# The browser still has its own speechSynthesis fallback, so if this endpoint
# is unconfigured or errors, narration degrades gracefully to local TTS.
# ---------------------------------------------------------------------------

TTS_ENDPOINT = os.getenv("TTS_ENDPOINT", "").strip().rstrip("/")
TTS_DEPLOYMENT = os.getenv("TTS_DEPLOYMENT", "gpt-4o-mini-tts").strip()
TTS_DEPLOYMENTS = [
    dep.strip()
    for dep in os.getenv("TTS_DEPLOYMENTS", "").split(",")
    if dep.strip()
]
if TTS_DEPLOYMENT and TTS_DEPLOYMENT not in TTS_DEPLOYMENTS:
    TTS_DEPLOYMENTS.append(TTS_DEPLOYMENT)
TTS_API_KEY = os.getenv("TTS_API_KEY", "").strip()
TTS_VOICE = os.getenv("TTS_VOICE", "onyx").strip()
TTS_API_VERSION = os.getenv("TTS_API_VERSION", "2025-03-01-preview").strip()

CORE_VOICE_PROFILES = [
    {"id": "onyx", "label": "Onyx", "locale": "en-US", "tone": "deep, warm narrator", "stack": "core_openai"},
    {"id": "alloy", "label": "Alloy", "locale": "en-US", "tone": "crisp professional", "stack": "core_openai"},
    {"id": "echo", "label": "Echo", "locale": "en-US", "tone": "soft, reflective", "stack": "core_openai"},
    {"id": "fable", "label": "Fable", "locale": "en-US", "tone": "expressive storyteller", "stack": "core_openai"},
    {"id": "nova", "label": "Nova", "locale": "en-US", "tone": "bright, clean", "stack": "core_openai"},
    {"id": "shimmer", "label": "Shimmer", "locale": "en-US", "tone": "clear, detailed", "stack": "core_openai"},
]

PLANNED_AZURE_SPEECH_PROFILES = [
    {"id": "es-CO-curated", "label": "Spanish - Colombia", "locale": "es-CO", "tone": "bilingual founder", "stack": "azure_speech"},
    {"id": "es-MX-curated", "label": "Spanish - Mexico", "locale": "es-MX", "tone": "bilingual founder", "stack": "azure_speech"},
    {"id": "en-NG-curated", "label": "English - Nigeria", "locale": "en-NG", "tone": "global English founder", "stack": "azure_speech"},
    {"id": "en-IN-curated", "label": "English - India", "locale": "en-IN", "tone": "global English founder", "stack": "azure_speech"},
    {"id": "en-GB-curated", "label": "English - United Kingdom", "locale": "en-GB", "tone": "global English founder", "stack": "azure_speech"},
]


def tts_available() -> bool:
    return bool(TTS_ENDPOINT and TTS_API_KEY and TTS_DEPLOYMENTS)


def azure_speech_available() -> bool:
    key = os.getenv("AZURE_SPEECH_KEY", "").strip() or os.getenv("SPEECH_KEY", "").strip()
    region = os.getenv("AZURE_SPEECH_REGION", "").strip() or os.getenv("SPEECH_REGION", "").strip()
    return bool(key and region)


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    instructions: Optional[str] = None


@app.get("/api/tts/status")
def tts_status():
    """Tell the UI whether server-side Azure neural narration is available."""
    return {
        "available": tts_available(),
        "voice": TTS_VOICE,
        "deployment": TTS_DEPLOYMENTS[0] if tts_available() else None,
        "deployments": TTS_DEPLOYMENTS if tts_available() else [],
    }


@app.get("/api/voices")
def voice_catalog():
    """Voice catalog for character creation and future Azure Speech casting.

    The demo keeps speaking through /api/tts today. This endpoint separates the
    product voice model from the playback adapter so we can add the large Azure
    Speech catalog without exposing hundreds of raw voices on the first screen.
    """
    speech_ready = azure_speech_available()
    return {
        "default_stack": "core_openai",
        "core_openai": CORE_VOICE_PROFILES,
        "azure_speech": {
            "configured": speech_ready,
            "available": False,
            "adapter": "planned",
            "summary": "Azure Speech supports a much larger multilingual voice catalog; curated profiles are listed when the adapter is configured.",
            "planned_profiles": PLANNED_AZURE_SPEECH_PROFILES,
            "voices": [],
        },
        "fallback": {
            "stack": "browser",
            "label": "Browser SpeechSynthesis",
            "available": True,
        },
    }


@app.post("/api/tts")
def tts(payload: TTSRequest):
    """Synthesize narration with the Azure gpt-4o-mini-tts deployment.

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
    last_error = ""
    for deployment in TTS_DEPLOYMENTS:
        url = (f"{TTS_ENDPOINT}/openai/deployments/{deployment}"
               f"/audio/speech?api-version={TTS_API_VERSION}")
        body_data = {
            "model": deployment,
            "input": text,
            "voice": (payload.voice or TTS_VOICE),
        }
        # Delivery direction (tone, pacing) - supported by current Azure
        # OpenAI-style TTS deployments and ignored by incompatible fallbacks.
        if payload.instructions:
            body_data["instructions"] = payload.instructions.strip()[:600]
        body = json.dumps(body_data).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"api-key": TTS_API_KEY, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                audio = resp.read()
            return Response(
                content=audio,
                media_type="audio/mpeg",
                headers={
                    "Cache-Control": "no-store",
                    "X-TTS-Deployment": deployment,
                },
            )
        except Exception as exc:  # noqa: BLE001 - try next voice deployment
            last_error = f"{deployment}: {exc}"

    raise HTTPException(status_code=503, detail=f"TTS upstream error: {last_error}")

@app.post("/api/init")
def initialize_game(payload: PitchRequest):
    """Initializes the game session with a custom pitch and decomposes it."""
    pitch = payload.pitch
    company_name = payload.company_name or "My Spawned Venture"
    founder = parse_founder(payload)

    # 1. Initialize State Store
    state = store.initialize_new_company(
        name=company_name,
        pitch=pitch,
        description="A startup forged in QuestForge.",
        founder=founder
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
                "title": "YOU & NEED: Escape the Comfort Mainframe",
                "description": f"Use the Strategist to scan carbon-mind ICP vectors and verify WTP thresholds for: '{pitch}'",
                "assigned_to": "strategist",
                "artifact_type": "doc",
                "xp_reward": 15
            },
            {
                "id": "step_2_landing_page",
                "title": "GO: Crossing the Portal Threshold",
                "description": "Work with the Designer to synthesize a trans-dimensional value proposition and ICP for the Teenyverse hosts.",
                "assigned_to": "designer",
                "artifact_type": "url",
                "xp_reward": 25
            },
            {
                "id": "step_3_launch_email",
                "title": "SEARCH: Adapt or Dissolve in the Mainframe",
                "description": "Have the Marketer draft a launch campaign email that offers the new sandbox portal to the public.",
                "assigned_to": "marketer",
                "artifact_type": "email",
                "xp_reward": 20
            }
        ]
        quest_steps = [QuestStep(**s) for s in steps_data]

    quest_state = QuestState(
        id="first_landing_page",
        title="Open the First Portal",
        description="Fulfill the YOU/NEED, GO, and SEARCH loop with positioning, page structure, and launch outreach.",
        steps=quest_steps
    )
    state.active_quest = quest_state
    store.save()

    store.log_event("QUEST_START", narrator.name, "Decomposed pitch into active quest-steps.", {"steps": steps_data})
    return state_response(state, surface="legacy_quest")


# ---------------------------------------------------------------------------
# Founder Character Customization & Avatar Generation
# ---------------------------------------------------------------------------

class GenerateAvatarRequest(BaseModel):
    founder_name: str
    founder_archetype: str


@app.post("/api/founder/generate-avatar")
def generate_founder_avatar_endpoint(payload: GenerateAvatarRequest):
    """Generate a custom founder portrait via Azure DALL-E or fallback SVG."""
    import base64
    name = payload.founder_name
    arch = payload.founder_archetype

    # 1. Determine Prompt matching style rules
    prompt = (
        f"minimal flat geometric portrait of a {arch} CEO named {name}, "
        "dark navy background filling the entire canvas edge to edge, "
        "teal and gold accents, clean vector style game avatar, centered bust, "
        "no text, no border, no frame, no letterboxing"
    )

    # Check if image API is configured
    image_endpoint = os.getenv("IMAGE_ENDPOINT", "").strip().rstrip("/")
    image_deployment = os.getenv("IMAGE_DEPLOYMENT", "MAI-Image-2e").strip()
    image_api_key = os.getenv("IMAGE_API_KEY", "").strip()

    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui", "assets", "generated")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "founder.png")

    if image_endpoint and image_api_key:
        try:
            body = json.dumps({
                "model": image_deployment,
                "prompt": prompt,
                "width": 1024,
                "height": 1024,
            }).encode("utf-8")
            url = f"{image_endpoint}/mai/v1/images/generations"
            req = urllib.request.Request(
                url, data=body, method="POST",
                headers={"api-key": image_api_key, "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()

            ctype = (resp.headers.get("Content-Type") or "").lower()
            png_bytes = None
            if "image/" in ctype:
                png_bytes = raw
            else:
                payload_data = json.loads(raw.decode("utf-8"))
                data = (payload_data.get("data") or [{}])[0]
                b64 = data.get("b64_json") or data.get("b64") or ""
                if b64:
                    png_bytes = base64.b64decode(b64)
                else:
                    img_url = data.get("url") or ""
                    if img_url:
                        with urllib.request.urlopen(img_url, timeout=30) as r2:
                            png_bytes = r2.read()

            if png_bytes:
                with open(out_path, "wb") as f:
                    f.write(png_bytes)
                return {"url": "/game/assets/generated/founder.png", "source": "azure"}
        except Exception as e:
            store.log_event("AVATAR_GEN_ERROR", "system", f"Azure avatar generation failed: {e}")

    # Fallback to offline SVG generation
    svg_filename = "founder.svg"
    svg_path = os.path.join(out_dir, svg_filename)
    safe_name = html_escape(str(name or "ACOLYTE").upper()[:24], quote=False)

    colors = {
        "Builder": {"accent": "#2dd4bf", "shape": '<rect x="30" y="30" width="40" height="40" rx="4" fill="none" stroke="#2dd4bf" stroke-width="3"/><line x1="30" y1="50" x2="70" y2="50" stroke="#f5c87a" stroke-width="2"/>'},
        "Seller": {"accent": "#f5c87a", "shape": '<circle cx="50" cy="50" r="18" fill="none" stroke="#f5c87a" stroke-width="3"/><line x1="50" y1="20" x2="50" y2="80" stroke="#2dd4bf" stroke-width="2"/>'},
        "Designer": {"accent": "#8eb3ff", "shape": '<circle cx="50" cy="50" r="20" fill="none" stroke="#8eb3ff" stroke-width="3"/><path d="M 40,40 Q 50,65 60,40" fill="none" stroke="#f5c87a" stroke-width="2"/>'},
        "Operator": {"accent": "#a78bfa", "shape": '<polygon points="50,30 70,60 30,60" fill="none" stroke="#a78bfa" stroke-width="3"/><circle cx="50" cy="50" r="8" fill="#f5c87a"/>'},
    }
    prof = colors.get(arch, colors["Builder"])

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <rect width="100" height="100" fill="#070a14"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="#1d2740" stroke-width="2"/>
        <circle cx="50" cy="45" r="18" fill="{prof["accent"]}" opacity="0.15"/>
        <circle cx="50" cy="45" r="14" fill="{prof["accent"]}" opacity="0.3"/>
        {prof["shape"]}
        <text x="50" y="88" font-family="monospace" font-size="7" fill="#8eb3ff" text-anchor="middle">{safe_name}</text>
    </svg>"""

    with open(svg_path, "w") as f:
        f.write(svg_content)

    return {"url": "/game/assets/generated/founder.svg", "source": "offline-svg"}


# ---------------------------------------------------------------------------
# Shared agent-execution + reasoning-trace helpers (used by the plain POST
# endpoint and the SSE streaming endpoint, so both run identical logic).
# ---------------------------------------------------------------------------

def _run_step_agent(quest: QuestState, step: QuestStep) -> Tuple[Dict[str, Any], bool, Dict[str, Any]]:
    """Run the right character agent for a quest step and validate its artifact.

    Returns (artifact_data, success, validation_results). Pure compute - no
    state mutation or persistence, so callers control how results are stored.
    """
    pitch = (store.state.pitch if store.state else "") or ""
    role = step.assigned_to

    if role == "strategist":
        artifact = StrategistAgent().formulate_positioning(pitch)
        success, results = validate_positioning(artifact)
    elif role == "designer":
        positioning = quest.steps[0].artifact_data or {}
        artifact = DesignerAgent().build_page_structure(positioning)
        success, results = validate_landing_page(artifact)
    elif role == "marketer":
        positioning = quest.steps[0].artifact_data or {}
        page_structure = quest.steps[1].artifact_data or {}
        artifact = MarketerAgent().draft_launch_email(positioning, page_structure)
        success, results = validate_marketing_email(artifact)
    else:
        raise ValueError(f"Unknown agent role: {role}")

    return artifact, success, results


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
    mode = runtime_mode() if (is_live() and deployment) else "simulation"
    deployment_label = f"{mode}-{step.assigned_to}" if mode != "simulation" else "simulation"

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
        artifact_data, success, val_results = _run_step_agent(quest, step)
    except Exception as exc:  # noqa: BLE001
        step.status = "failed"
        store.log_event("STEP_EXECUTION_ERROR", "system", f"Failed executing step reasoning: {exc}")
        store.save()
        yield _sse("failure", {"message": f"Agent execution failure: {exc}"})
        return
    latency = round(time.time() - t0, 2)

    artifact_keys = list(artifact_data.keys())
    yield _sse("phase", {
        "kind": "invoke_done",
        "actor": persona_name,
        "message": f"Artifact returned ({len(artifact_keys)} fields) in {latency}s.",
        "latency_s": latency,
        "artifact_keys": artifact_keys,
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
                    {"artifact": artifact_data, "validation_results": val_results})
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
        artifact_data, success, val_results = _run_step_agent(quest, step)
        step.artifact_data = artifact_data
        step.validation_results = val_results

        store.log_event("STEP_COMPLETED_REASONING", step.assigned_to, f"Artifact created. Verification gate waiting for review.", {
            "artifact": artifact_data,
            "validation_results": val_results
        })
        store.save()

    except Exception as e:
        step.status = "failed"
        store.log_event("STEP_EXECUTION_ERROR", "system", f"Failed executing step reasoning: {str(e)}")
        store.save()
        raise HTTPException(status_code=500, detail=f"Agent Execution Failure: {str(e)}")

    return step_response(state, step)

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
    return state_response(state, surface="legacy_quest")

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
    return state_response(state, surface="legacy_quest")


# ---------------------------------------------------------------------------
# World Designer + Worker Factory autoplay
# ---------------------------------------------------------------------------

class AutoplayRequest(BaseModel):
    pitch: str
    company_name: Optional[str] = "QuestForge Ltd."
    auto_approve_threshold: int = 80  # score >= this auto-approves
    founder_name: Optional[str] = None
    founder_archetype: Optional[str] = None
    founder_skill: Optional[str] = None
    founder_locale: Optional[str] = None
    founder_voice_stack: Optional[str] = None
    founder_voice: Optional[str] = None
    founder_avatar: Optional[str] = None


# ---------------------------------------------------------------------------
# Org Designer: dynamic digital workforce for a company (pitch OR url)
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    pitch: Optional[str] = None
    url: Optional[str] = None
    company_name: Optional[str] = "QuestForge Ltd."
    founder_name: Optional[str] = None
    founder_archetype: Optional[str] = None
    founder_skill: Optional[str] = None
    founder_locale: Optional[str] = None
    founder_voice_stack: Optional[str] = None
    founder_voice: Optional[str] = None
    founder_avatar: Optional[str] = None


@app.post("/api/founder/analyze")
def analyze_founder(payload: AnalyzeRequest):
    """Analyze the founder's profile and forge their starting character.

    Accepts a public profile/mission URL (primary) OR a mission pitch. When a
    URL is given, the page is fetched (SSRF-guarded, stdlib only) and reasoned
    into a founder profile - and when the page is restricted, the open web is
    cross-referenced instead. From that profile we design the org (one human
    operator + a digital workforce, each with an educational `why`) and forge
    the antagonist the run plays against.
    """
    url = (payload.url or "").strip()
    pitch = (payload.pitch or "").strip()
    if not url and not pitch:
        raise HTTPException(status_code=400, detail="Provide a profile URL or mission pitch.")

    company_name = payload.company_name or "QuestForge Ltd."
    prev = store.load()
    founder = parse_founder(payload)
    if not founder and prev and prev.founder:
        founder = prev.founder

    # Analyze starts a fresh venture session - designing the org is the first
    # reasoning step, before any stages exist.
    state = store.initialize_new_company(
        name=company_name, pitch=pitch or url, description="A venture forged in QuestForge.", founder=founder
    )
    store.log_event("SESSION_START", "system", f"New analyze session for: {company_name}")

    # On the URL path, run a two-hop reasoning chain that is visible in the
    # replay log: (1) scrape the public page into structured signal, (2) a
    # Profile Analyst agent reasons about the founder/mission. The clean profile
    # then seeds the Org Designer - so a URL becomes a coherent org, not raw text.
    profile = None
    summary_hint = ""
    if url:
        profile = analyze_founder_profile(url)
        brief = profile["brief"]
        summary_hint = profile.get("company_summary", "")
        source, source_ref = "url", url
        state.founder_profile = profile_from_payload(
            profile, source=source, source_ref=source_ref, mode=runtime_mode())
        if profile.get("cached"):
            store.log_event(
                "PROFILE_CACHE_HIT", "scraper",
                f"Reused a previously analyzed profile for {profile.get('host', url)} "
                f"(skipped scrape + OSINT + reasoning).",
                {"host": profile.get("host", ""), "source": "url_cache"},
            )
        if state.founder and not payload.founder_archetype and profile.get("founder_archetype"):
            state.founder.archetype = str(profile.get("founder_archetype") or state.founder.archetype)
            state.founder.skill = str(profile.get("founder_skill") or state.founder.skill)
        if profile.get("scraped"):
            scrape_msg = (f"Scraped {profile['host']} via {profile.get('parser', 'regex')} "
                          f"(read {profile.get('scraped_chars', 0)} chars).")
        elif profile.get("osint_hits"):
            scrape_msg = (f"{profile['host']} was restricted - reasoned the profile from "
                          f"{profile['osint_hits']} open-web finding(s) instead.")
        else:
            scrape_msg = f"Scraped {profile['host']} (homepage unreachable, using domain default)."
        store.log_event(
            "URL_SCRAPED", "scraper", scrape_msg,
            {"host": profile["host"], "scraped": profile.get("scraped", False),
             "parser": profile.get("parser", ""),
             "signals": profile.get("signals", [])},
        )
        if profile.get("osint_hits"):
            store.log_event(
                "WEB_SEARCHED", "scraper",
                f"Public-web OSINT on the profile returned {profile['osint_hits']} result(s) "
                f"via the keyless web_search tool.",
                {"host": profile["host"], "osint_hits": profile.get("osint_hits", 0)},
            )
        store.log_event(
            "PROFILE_ANALYZED", "profile_analyst",
            f"Reasoned the profile/mission: {profile['company_summary']}",
            {"what_they_sell": profile.get("what_they_sell"),
             "target_customer": profile.get("target_customer"),
             "business_model": profile.get("business_model"),
             "source_kind": profile.get("source_kind"),
             "founder_archetype": profile.get("founder_archetype"),
             "founder_skill": profile.get("founder_skill"),
             "mode": profile.get("mode")},
        )
        # Agent memory: what the workforce now knows about the founder/mission it
        # serves - the mapped profile persists into every later worker brief.
        mem_entry = remember(
            "user_profile",
            f"Profile mapped from {profile['host']}: {profile['company_summary']} "
            f"Capability: {profile.get('what_they_sell', '')[:120]}. "
            f"Beneficiary: {profile.get('target_customer', '')[:80]}. "
            f"Inferred archetype: {profile.get('founder_archetype', '')}.",
            {"host": profile["host"], "source": "url_scrape"})
        if mem_entry:
            store.log_event("MEMORY_WRITTEN", "memory",
                f"Founder/mission profile stored ({mem_entry.get('origin', 'local-memory')}): {profile['host']}",
                {"kind": "user_profile", "origin": mem_entry.get("origin", "")})
    else:
        brief, source, source_ref = pitch, "pitch", pitch
        state.founder_profile = profile_from_payload(
            None, source=source, source_ref=source_ref, pitch=brief, mode=runtime_mode())

    blueprint = design_org(brief, source=source, source_ref=source_ref, summary_hint=summary_hint)
    state.org = OrgBlueprint(**blueprint)
    state.economics = initialize_economics_from_org(state.org)

    # Forge the competitive foil (villain) from the founder's archetype so
    # later stage dilemmas can present concrete market tension.
    forge_antagonist(
        state,
        mission_brief=str(profile.get("company_summary") or brief) if profile else brief,
        target_customer=str(profile.get("target_customer") or "") if profile else "",
    )

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

    initialize_game_run(state, mode=runtime_mode())
    refresh_session_knowledge(state)
    store.log_event(
        "KNOWLEDGE_STRUCTURED", "iq_sync",
        f"Structured {len(state.knowledge_records)} generated Search document(s) from the analyzed run.",
        {"kinds": sorted({doc.kind for doc in state.knowledge_records})},
    )
    store.save()
    return {
        "state": state.model_dump(),
        "org": state.org.model_dump(),
        "profile": profile,
        "antagonist": state.antagonist.model_dump() if state.antagonist else None,
        "source": source,
        "brief": brief[:600],
        "mode": runtime_mode(),
    }


@app.get("/api/org/export")
def export_org():
    """Export the chartered org as a platform-neutral Workforce Bundle.

    The bundle (workers with generated briefs, team composition, KPI wishes,
    Mermaid org chart) is the bridge out of the game: any digital-worker
    platform can ingest it and provision the org for real - behind its own
    human approval gate. No platform-specific code lives in this repo.
    """
    state = store.load()
    if not state.org or not state.org.roles:
        raise HTTPException(status_code=404, detail="No chartered org to export. Charter an org first.")
    bundle = org_to_workforce_bundle(state.org.model_dump())
    store.log_event(
        "ORG_EXPORTED", "org_designer",
        f"Exported workforce bundle: {len(bundle['workers'])} digital workers + "
        f"{len(bundle['humans'])} human seat(s), pending human approval downstream.",
        {"format": bundle["format"], "version": bundle["version"],
         "workers": len(bundle["workers"]), "humans": len(bundle["humans"])},
    )
    store.save()
    return JSONResponse(
        content=bundle,
        headers={"Content-Disposition": 'attachment; filename="workforce_bundle.json"'},
    )


@app.post("/api/world/design")
def design_world_endpoint(payload: AutoplayRequest):
    """Uses the WorldDesigner to produce a full venture graph.

    Preserves an org chartered by /api/founder/analyze in the same session, so
    the dynamic workforce, earned XP, and flags carry through into the build.
    """
    brief = payload.pitch
    company_name = payload.company_name or "QuestForge Ltd."

    prev = store.load()
    founder = parse_founder(payload)
    if not founder and prev and prev.founder:
        founder = prev.founder

    state = store.initialize_new_company(
        name=company_name, pitch=brief, description="A venture forged in QuestForge.", founder=founder
    )
    # Agent memory (user profile): durable facts about this founder/company.
    mem_entry = remember("user_profile", f"Founder is building: {company_name} - {brief[:280]}",
             {"company": company_name})
    if mem_entry:
        store.log_event("MEMORY_WRITTEN", "memory",
            f"User-profile memory stored ({mem_entry.get('origin', 'local-memory')}): {company_name}",
            {"kind": "user_profile", "origin": mem_entry.get("origin", "")})
    # Carry forward a prior analyze session (org + earned XP + flags + villain).
    if prev and prev.org:
        state.org = prev.org
        state.economics = prev.economics or initialize_economics_from_org(state.org)
        state.founder_profile = prev.founder_profile
        state.choices = prev.choices
        state.days = prev.days
        state.xp = prev.xp
        state.level = prev.level
        state.business_flags = prev.business_flags
        store.log_event("WORLD_SESSION", "system", f"Attached venture graph to chartered org for: {company_name}")
    else:
        state.founder_profile = profile_from_payload(
            None, source="pitch", source_ref=brief, pitch=brief, mode=runtime_mode())
        store.log_event("SESSION_START", "system", f"New world session for: {company_name}")

    # Ground the World Designer in the FOUNDER PROFILE, not the thin pitch/URL.
    # /api/founder/analyze already scraped + ran OSINT + reasoned a structured
    # brief (capability, beneficiary, archetype, evidence signals). That rich
    # brief - not the raw URL or one-line summary - is what the world must be
    # built from. It also becomes world.brief, so every per-stage worker
    # (execute_stage reads world.brief) and the antagonist inherit the same
    # grounded context. Falls back to the pitch for a cold-start design call.
    design_brief = (state.founder_profile.brief if state.founder_profile else "").strip() or brief
    if state.founder_profile and design_brief != brief:
        store.log_event(
            "WORLD_GROUNDED", "world_designer",
            f"World design grounded in the analyzed founder profile "
            f"({len(design_brief)} chars) instead of the raw pitch.",
            {"source_kind": state.founder_profile.source_kind,
             "summary": state.founder_profile.company_summary[:160]},
        )

    # The antagonist drives every stage dilemma, so it must survive the
    # re-init: reuse the one forged during analyze, or forge it now for a
    # cold-start world/design call (pitch-only, no prior analyze).
    if prev and prev.antagonist:
        state.antagonist = prev.antagonist
    else:
        forge_antagonist(state, mission_brief=design_brief)

    stages_data = design_world(design_brief)
    world = WorldGraph(
        brief=design_brief,
        stages=[Stage(**s) if isinstance(s, dict) else s for s in stages_data],
        status="active",
    )
    # Close the seam: each stage is owned by one of the digital workers the
    # Org Designer created for this company (not a fixed cast).
    bindings = bind_world_to_org(world, state.org) if state.org else {}
    state.world = world
    store.log_event("WORLD_DESIGNED", "world_designer", f"Produced {len(world.stages)} stages.", {
        "stages": [
            {"id": s.id, "title": s.title, "owner_role": s.owner_role,
             "assigned_worker_title": s.assigned_worker_title}
            for s in world.stages
        ]
    })
    if bindings:
        store.log_event(
            "ORG_BOUND", "org_designer",
            f"Bound {len(bindings)} stages to dynamically designed digital workers.",
            {"bindings": bindings},
        )
    initialize_game_run(state, mode=runtime_mode())
    refresh_session_knowledge(state)
    store.log_event(
        "KNOWLEDGE_STRUCTURED", "iq_sync",
        f"Structured {len(state.knowledge_records)} generated Search document(s) after world design.",
        {"kinds": sorted({doc.kind for doc in state.knowledge_records})},
    )
    store.save()
    return state_response(state, surface="world_graph")


# Canned dilemmas per archetype role - the deterministic, demo-safe floor
# (game_design.md section 5). The live path asks the narrator model instead.
_CANNED_DILEMMAS = {
    "strategist": {
        "prompt": "Our escape portal path is bifurcating. Which vector do you prioritize?",
        "options": [
            {"id": "depth", "rule_id": "strategist.depth", "option": "ICP Scan: secure one consciousness segment end to end", "tradeoff": "stabilized loop, slower reach"},
            {"id": "breadth", "rule_id": "strategist.breadth", "option": "Teenyverse: map adjacent mini-verse beachfronts quickly", "tradeoff": "wider escape nodes, shallower proof"},
        ],
    },
    "designer": {
        "prompt": "The mainframe prototype is at 70%. Deploy now or polish the containment field?",
        "options": [
            {"id": "ship", "rule_id": "designer.ship", "option": "Deploy the 70% loop and collect live host friction", "tradeoff": "host instability, faster learning"},
            {"id": "polish", "rule_id": "designer.polish", "option": "Secure Vibranium-grade containment checking (3 weeks)", "tradeoff": "stabilized loop, higher burn"},
        ],
    },
    "marketer": {
        "prompt": "Upload pricing models are diverging. How do we charge?",
        "options": [
            {"id": "adoption", "rule_id": "marketer.adoption", "option": "Self-Activation: free grassroots access to boot loops", "tradeoff": "thin energy margins, support load"},
            {"id": "runway", "rule_id": "marketer.runway", "option": "Mainframe Elite: target high-value corporate nodes", "tradeoff": "longer deal pipeline, secure runway"},
        ],
    },
    "ops": {
        "prompt": "Consciousness support queries are scaling. Automate via script?",
        "options": [
            {"id": "automate", "rule_id": "ops.automate", "option": "Auto-macro: automate helpdesk paths to protect margins", "tradeoff": "risk to host trust at edges"},
            {"id": "human_loop", "rule_id": "ops.human_loop", "option": "Steward: keep human review on sensitive sanity cases", "tradeoff": "burn pressure, ethical alignment"},
        ],
    },
    "final": {
        "prompt": "The infinite-growth machine is offering the clean exit. What becomes the new normal?",
        "options": [
            {"id": "shareholder", "rule_id": "ops.shareholder", "option": "Take shareholder capital and scale the grid fast", "tradeoff": "speed gained, autonomy sold"},
            {"id": "cooperative", "rule_id": "ops.cooperative", "option": "Form the worker-cooperative energy alliance", "tradeoff": "slower growth, durable trust"},
        ],
    },
}


def _canned_dilemma_for_stage(stage: Stage) -> Dict[str, Any]:
    if stage.id == "stage_8_change" or "change" in stage.id.lower():
        return _CANNED_DILEMMAS["final"]
    return _CANNED_DILEMMAS.get(stage.owner_role) or _CANNED_DILEMMAS["strategist"]


def _scene_speaker_for_stage(stage: Stage) -> Dict[str, str]:
    cast = {
        "strategist": {"display_name": "Soren", "role": "Strategist", "voice_id": "verse"},
        "designer": {"display_name": "Dahlia", "role": "Designer", "voice_id": "alloy"},
        "marketer": {"display_name": "Maddox", "role": "Marketer", "voice_id": "echo"},
        "ops": {"display_name": "Orla", "role": "Operator", "voice_id": "sage"},
    }
    base = cast.get(stage.owner_role, cast["strategist"])
    return {
        "worker_id": stage.assigned_worker_id or stage.owner_role,
        "display_name": stage.assigned_worker_title or base["display_name"],
        "role": base["role"],
        "voice_id": base["voice_id"],
        "locale": "en-US",
        "avatar_mode": "portrait",
    }


def _option_id(rule_id: str, fallback_index: int) -> str:
    return (rule_id.split(".", 1)[-1] or f"option_{fallback_index + 1}").replace("_", "-")


def _effect_line(preview: Dict[str, Any]) -> str:
    before = preview.get("before") or {}
    after = preview.get("after") or {}
    org = preview.get("org_delta") or {}
    parts: List[str] = []
    for label, key in (("Proof", "proof"), ("Trust", "trust"), ("Velocity", "velocity"), ("Autonomy", "autonomy")):
        delta = int((after.get(key) or 0) - (before.get(key) or 0))
        if delta:
            parts.append(f"{label} {delta:+d}")
    burn_delta = int((after.get("monthly_burn_usd") or 0) - (before.get("monthly_burn_usd") or 0))
    if burn_delta:
        parts.append(f"burn {burn_delta:+,}/mo")
    runway_delta = int((after.get("runway_months") or 0) - (before.get("runway_months") or 0))
    if runway_delta:
        parts.append(f"runway {runway_delta:+d}mo")
    if org.get("added_role_title"):
        parts.append(f"adds {org['added_role_title']}")
    return ", ".join(parts) or "keeps the company steady"


def _enrich_dilemma_options(
    state: CompanyState,
    stage: Stage,
    options: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    allowed = rule_ids_for_role(stage.owner_role)
    enriched: List[Dict[str, Any]] = []
    used = set()
    for i, option in enumerate(options[:2]):
        candidate = {
            "option": str(option.get("option", ""))[:160],
            "tradeoff": str(option.get("tradeoff", ""))[:120],
            "rule_id": option.get("rule_id") or "",
        }
        rule_id = select_rule_id(stage.owner_role, candidate)
        if rule_id in used and i < len(allowed):
            rule_id = allowed[i]
        used.add(rule_id)
        preview = preview_decision_consequence(state, stage, rule_id)
        enriched.append({
            "id": option.get("id") or _option_id(rule_id, i),
            "option": candidate["option"],
            "tradeoff": candidate["tradeoff"],
            "rule_id": rule_id,
            "spoken_summary": preview.get("summary", ""),
            "effect_line": _effect_line(preview),
            "effect_preview": preview,
            "tool_checks": [
                {"tool": "calculate_consequence", "status": "previewed"},
                {"tool": "render_org_graph", "status": "ready"},
            ],
        })
    return enriched


class DilemmaRequest(BaseModel):
    stage_id: str


@app.post("/api/dilemma")
def generate_dilemma(payload: DilemmaRequest):
    """Generate the CEO dilemma for the stage just sealed.

    Live: the narrator deployment writes a venture-specific tradeoff (2
    options) grounded in the stage's artifact. Offline/error: a canned
    dilemma per archetype. The pick is recorded via /api/decision and
    becomes binding direction for the next stage's worker.
    """
    state = store.load()
    if not state or not state.world:
        raise HTTPException(status_code=400, detail="No world graph.")
    world = state.world
    stage = next((s for s in world.stages if s.id == payload.stage_id), None)
    if not stage:
        raise HTTPException(status_code=404, detail=f"Unknown stage: {payload.stage_id}")

    idx = world.stages.index(stage)
    next_stage = world.stages[idx + 1] if idx + 1 < len(world.stages) else None

    dilemma = None
    client = get_foundry_client()
    deployment = model_for("narrator")
    if client and deployment and is_live():
        try:
            antagonist_line = ""
            if state.antagonist:
                antagonist_line = (
                    f"Antagonist: {state.antagonist.name} ({state.antagonist.archetype}) "
                    f"using tactic: {state.antagonist.signature_tactic}.\n"
                )
            resp = create_chat_completion(
                deployment,
                [
                    {"role": "system", "content": (
                        "You are the Narrator of a cosmic start-up sandbox (a blend of Rick and Morty, Westworld, "
                        "Pantheon, and Black Panther). The player is the CEO of an uploaded consciousness startup. "
                        "Pose ONE sharp strategic dilemma arising from the work completed (e.g. portal stability vs carbon mind autonomy, "
                        "Vibranium containment vs Teenyverse speed), with exactly 2 options. Both options must be defensible; "
                        "each has a real tradeoff. Keep each option under 14 words, each "
                        "tradeoff under 8 words. Return ONLY JSON: {\"prompt\": str, "
                        "\"options\": [{\"option\": str, \"tradeoff\": str}, ...]}"
                    )},
                    {"role": "user", "content": (
                        f"Venture: {world.brief[:400]}\n"
                        f"Stage just completed: {stage.title} - {stage.goal}\n"
                        f"Artifact summary: {json.dumps(stage.artifact or {})[:1200]}\n"
                        + antagonist_line
                        + (f"Next stage: {next_stage.title} - {next_stage.goal}\n" if next_stage else "")
                        + "The dilemma should steer how the next stage is executed."
                    )},
                ],
                max_completion_tokens=1500,
            )
            content = resp.choices[0].message.content or ""
            parsed = json.loads(content[content.index("{"):content.rindex("}") + 1])
            opts = [o for o in (parsed.get("options") or []) if isinstance(o, dict) and o.get("option")][:2]
            if parsed.get("prompt") and len(opts) == 2:
                dilemma = {"prompt": str(parsed["prompt"])[:240],
                           "options": [{"option": str(o["option"])[:160],
                                        "tradeoff": str(o.get("tradeoff", ""))[:120]} for o in opts],
                           "source": "foundry"}
        except Exception:
            dilemma = None
    if not dilemma:
        generated = None
        try:
            founder = state.founder
            suggested = suggest_dilemma_for_stage(
                stage.id,
                (founder.archetype if founder else "Builder"),
            )
            gd = generate_story_dilemma(
                stage_id=stage.id,
                stage_title=stage.title,
                founder=founder,
                antagonist=state.antagonist,
                economics=state.economics,
                suggested_template=suggested,
            )
            generated = {
                "prompt": gd.context,
                "options": [
                    {"id": "a", "option": gd.option_a.get("label", "Option A"), "tradeoff": gd.option_a.get("description", "")},
                    {"id": "b", "option": gd.option_b.get("label", "Option B"), "tradeoff": gd.option_b.get("description", "")},
                ],
                "source": "generated",
            }
        except Exception:
            generated = None

        if generated:
            dilemma = generated
        else:
            canned = _canned_dilemma_for_stage(stage)
            dilemma = {**canned, "source": "canned"}
    dilemma["options"] = _enrich_dilemma_options(state, stage, dilemma.get("options") or [])
    dilemma["scene_id"] = f"{stage.id}:dilemma"
    dilemma["speaker"] = _scene_speaker_for_stage(stage)
    # Surface the antagonist (villain) so the gate UI can show whose pressure
    # forced this choice - the story foil that makes the tradeoff feel real.
    if state.antagonist:
        dilemma["antagonist"] = {
            "name": state.antagonist.name,
            "archetype": state.antagonist.archetype,
            "threat_type": state.antagonist.threat_type,
            "signature_tactic": state.antagonist.signature_tactic,
        }
    dilemma["caption_seed"] = dilemma["prompt"]
    dilemma["image_prompt"] = (
        f"A cinematic cosmic-mainframe dilemma scene for {state.name}: "
        f"{stage.title}. The founder must choose how the company changes its loop next."
    )
    dilemma["tool_plan"] = [
        {"tool": "calculate_consequence", "reason": "Preview org and economics before the CEO commits."},
        {"tool": "render_org_graph", "reason": "Redraw the workforce after the decision."},
        {"tool": "write_memory", "reason": "Carry the CEO operating pattern into later worker briefs."},
    ]

    store.log_event("DILEMMA_POSED", "narrator",
        f"Dilemma after '{stage.title}': {dilemma['prompt']}",
        {
            "stage_id": stage.id,
            "scene_id": dilemma["scene_id"],
            "source": dilemma["source"],
            "speaker": dilemma["speaker"],
            "options": [
                {k: o.get(k) for k in ("id", "option", "tradeoff", "rule_id", "effect_line")}
                for o in dilemma["options"]
            ],
        })
    store.save()
    return {"stage_id": stage.id, **dilemma}


class DecisionRequest(BaseModel):
    stage_id: str
    option: str
    tradeoff: Optional[str] = ""
    prompt: Optional[str] = ""
    custom: Optional[bool] = False
    rule_id: Optional[str] = None
    option_id: Optional[str] = None
    scene_id: Optional[str] = None


@app.post("/api/decision")
def record_decision(payload: DecisionRequest):
    """Record the CEO's dilemma-gate decision into session memory.

    Writes Stage.dilemma_choice and appends to WorldGraph.decisions, the
    ledger every later worker brief recalls from (game_design.md section 5:
    memory is what makes a choice feel real). Idempotent per stage: a new
    decision for the same stage replaces the old one.
    """
    state = store.load()
    if not state or not state.world:
        raise HTTPException(status_code=400, detail="No world graph.")
    world = state.world
    stage = next((s for s in world.stages if s.id == payload.stage_id), None)
    if not stage:
        raise HTTPException(status_code=404, detail=f"Unknown stage: {payload.stage_id}")

    old_entry = next((d for d in world.decisions if d.get("stage_id") == stage.id), None)
    choice = {
        "prompt": (payload.prompt or "")[:300],
        "option": payload.option[:200],
        "tradeoff": (payload.tradeoff or "")[:200],
        "custom": bool(payload.custom),
        "rule_id": (payload.rule_id or "")[:80],
        "option_id": (payload.option_id or "")[:80],
        "scene_id": (payload.scene_id or "")[:120],
    }
    consequence = apply_decision_consequence(state, stage, choice, old_entry=old_entry)
    choice["rule_id"] = consequence["rule_id"]
    choice["consequence"] = consequence
    choice["consequence_summary"] = consequence["summary"]
    stage.dilemma_choice = choice
    entry = {"stage_id": stage.id, "stage_title": stage.title, **choice}
    world.decisions = [d for d in world.decisions if d.get("stage_id") != stage.id]
    world.decisions.append(entry)

    day_index = world.stages.index(stage) + 1 if stage in world.stages else len(state.choices) + 1
    choice_record = ChoiceRecord(
        id=f"choice_{stage.id}",
        day_index=day_index,
        stage_id=stage.id,
        stage_title=stage.title,
        prompt=choice["prompt"],
        option_id=choice["option_id"],
        option=choice["option"],
        tradeoff=choice["tradeoff"],
        rule_id=choice["rule_id"],
        scene_id=choice["scene_id"],
        custom=choice["custom"],
        consequence_summary=choice["consequence_summary"],
        consequence=choice["consequence"],
    )
    state.choices = [c for c in state.choices if c.stage_id != stage.id]
    state.choices.append(choice_record)
    record_world_day(state, stage, choice_record)
    antagonist_move = record_choice_game_state(state, stage, choice_record)

    # Agent memory (procedural): the workers learn the CEO's operating pattern
    # from every gate decision - recalled in all later worker briefs.
    mem_entry = remember("procedural",
             f"CEO chose '{choice['option']}' at the '{stage.title}' gate"
             + (f" accepting tradeoff: {choice['tradeoff']}" if choice["tradeoff"] else "")
             + f". Consequence: {choice['consequence_summary']}",
             {"stage_id": stage.id})
    if mem_entry:
        store.log_event("MEMORY_WRITTEN", "memory",
            f"Procedural memory stored ({mem_entry.get('origin', 'local-memory')}): {mem_entry.get('text', '')[:120]}",
            {"kind": "procedural", "origin": mem_entry.get("origin", "")})

    store.log_event("CEO_DECISION", "founder",
        f"Gate decision after '{stage.title}': {choice['option']}",
        {"stage_id": stage.id, "option": choice["option"],
         "tradeoff": choice["tradeoff"], "custom": choice["custom"]})
    store.log_event("CONSEQUENCE_APPLIED", "system",
        f"{consequence['rule_id']} changed the company: {consequence['summary']}",
        {"stage_id": stage.id, **consequence})
    if antagonist_move:
        store.log_event("ANTAGONIST_MOVE", "antagonist",
            f"{antagonist_move.title}: {antagonist_move.counterplay}",
            antagonist_move.model_dump())
    refresh_session_knowledge(state)
    store.log_event("KNOWLEDGE_STRUCTURED", "iq_sync",
        f"Structured {len(state.knowledge_records)} generated Search document(s) after CEO choice.",
        {"choice_id": choice_record.id, "day_index": choice_record.day_index})
    store.save()
    return {
        "recorded": entry,
        "decisions": world.decisions,
        "choice": choice_record.model_dump(),
        "days": [d.model_dump() for d in state.days],
        "consequence": consequence,
        "state": state.model_dump(),
    }


class StandupRequest(BaseModel):
    stage_id: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = None
    selection_mode: Optional[str] = "round_robin"


_ROLE_DISPLAY = {
    "strategist": "Strategist",
    "designer": "Designer",
    "marketer": "Marketer",
    "ops": "Operations",
    "narrator": "World Designer",
    "orgdesigner": "Org Designer",
}

_ROLE_PORTRAIT = {
    "strategist": "strategist",
    "designer": "designer",
    "marketer": "marketer",
    "ops": "ops",
    "narrator": "narrator",
    "orgdesigner": "orgdesigner",
    "founder": "founder",
}

_ROLE_TEXT_STYLE = {
    "strategist": "market posture",
    "designer": "product and experience posture",
    "marketer": "growth posture",
    "ops": "operating posture",
    "narrator": "world-state posture",
    "orgdesigner": "org-design posture",
    "founder": "CEO direction",
}

_ROLE_VOICE = {
    "strategist": "ballad",
    "designer": "coral",
    "marketer": "verse",
    "ops": "alloy",
    "narrator": "onyx",
    "orgdesigner": "sage",
    "founder": "onyx",
}


def _worker_title_for_stage(stage: Optional[Stage]) -> str:
    if not stage:
        return "the next worker"
    return stage.assigned_worker_title or _ROLE_DISPLAY.get(stage.owner_role, stage.owner_role)


def _speaker_profile(speaker: str, role: str, worker_id: str = "") -> Dict[str, Any]:
    normalized_role = role or "narrator"
    portrait = _ROLE_PORTRAIT.get(normalized_role, _ROLE_PORTRAIT["narrator"])
    return {
        "display_name": speaker or _ROLE_DISPLAY.get(normalized_role, normalized_role),
        "role": normalized_role,
        "role_label": _ROLE_DISPLAY.get(normalized_role, normalized_role.title()),
        "worker_id": worker_id or normalized_role,
        "portrait": portrait,
        "portrait_url": f"/game/assets/generated/{portrait}.png",
        "text_style": _ROLE_TEXT_STYLE.get(normalized_role, "standup posture"),
        "voice_stack": "core_openai",
        "voice_id": _ROLE_VOICE.get(normalized_role, "onyx"),
        "locale": "en-US",
    }


def _character_state_for_turn(turn: Dict[str, Any], turn_index: int = 0, round_index: int = 0) -> Dict[str, Any]:
    role = turn.get("role") or "narrator"
    speaker = turn.get("speaker") or _ROLE_DISPLAY.get(role, role)
    worker_id = turn.get("worker_id") or role
    profile = turn.get("speaker_profile") or _speaker_profile(speaker, role, worker_id)
    tool_call = turn.get("tool_call") or {"tool": "agent_turn", "status": "completed"}
    message = str(turn.get("message") or "")
    return CharacterRuntimeState(
        worker_id=worker_id,
        display_name=profile.get("display_name") or speaker,
        role=role,
        role_label=profile.get("role_label") or _ROLE_DISPLAY.get(role, role.title()),
        portrait_url=profile.get("portrait_url", ""),
        voice_stack=profile.get("voice_stack", "core_openai"),
        voice_id=profile.get("voice_id") or _ROLE_VOICE.get(role, "onyx"),
        locale=profile.get("locale", "en-US"),
        text_style=profile.get("text_style", ""),
        status="spoke" if message else "idle",
        thought_state=(
            "live MAF response" if turn.get("source") == "maf"
            else "deterministic fallback response"
        ),
        current_message=message,
        transcript=[{
            "speaker": speaker,
            "role": role,
            "message": message,
            "source": turn.get("source", "simulation"),
        }] if message else [],
        tool_calls=[tool_call] if tool_call else [],
        handoff_to=turn.get("handoff_to", ""),
        turn_index=turn_index,
        round_index=round_index,
        source=turn.get("source", "simulation"),
        framework=turn.get("framework", ""),
        maf_client=turn.get("maf_client", ""),
    ).model_dump()


def _standup_turn(
    speaker: str,
    role: str,
    worker_id: str,
    tool: str,
    message: str,
    handoff_to: str = "",
) -> Dict[str, Any]:
    turn = {
        "speaker": speaker,
        "role": role,
        "worker_id": worker_id or role,
        "tool_call": {"tool": tool, "status": "completed"},
        "message": message,
        "handoff_to": handoff_to,
        "speaker_profile": _speaker_profile(speaker, role, worker_id or role),
    }
    turn["character_state"] = _character_state_for_turn(turn)
    return turn


def _attach_speaker_profiles(turns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    enriched: List[Dict[str, Any]] = []
    for index, turn in enumerate(turns, start=1):
        role = turn.get("role") or "narrator"
        speaker = turn.get("speaker") or _ROLE_DISPLAY.get(role, role)
        worker_id = turn.get("worker_id") or role
        if not turn.get("speaker_profile"):
            turn["speaker_profile"] = _speaker_profile(speaker, role, worker_id)
        turn["turn_index"] = index
        turn["character_state"] = _character_state_for_turn(turn, turn_index=index)
        enriched.append(turn)
    return enriched


def _standup_selection_mode(value: Optional[str]) -> str:
    mode = str(value or "round_robin").strip().lower().replace("-", "_")
    return mode if mode in {"round_robin", "random"} else "round_robin"


def _order_standup_turns(
    turns: List[Dict[str, Any]],
    mode: str,
    stage_id: str,
    history: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Choose which character speaks next without changing the turn contract."""
    ordered = list(turns)
    if len(ordered) <= 1:
        return ordered
    if mode == "random":
        random.shuffle(ordered)
        return ordered

    # Round-robin: rotate the first speaker each follow-up round so the same
    # worker does not always answer first after the CEO responds.
    founder_turns = sum(
        1 for turn in (history or [])
        if turn.get("role") == "founder" or turn.get("worker_id") == "founder"
    )
    offset = founder_turns % len(ordered)
    return ordered[offset:] + ordered[:offset]


def _build_standup_turns(
    state: CompanyState,
    stage: Stage,
    decision: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    world = state.world
    all_stages = world.stages if world else []
    idx = all_stages.index(stage) if stage in all_stages else -1
    next_stage = all_stages[idx + 1] if idx >= 0 and idx + 1 < len(all_stages) else None
    consequence = decision.get("consequence") or {}
    economics = consequence.get("after") or {}
    org_delta = consequence.get("org_delta") or {}
    rule_id = consequence.get("rule_id") or decision.get("rule_id") or "decision.custom"
    summary = consequence.get("summary") or "The CEO choice is now binding direction."
    option = decision.get("option") or "the chosen option"
    owner_title = _worker_title_for_stage(stage)
    next_title = _worker_title_for_stage(next_stage)
    next_role = next_stage.owner_role if next_stage else "narrator"

    turns: List[Dict[str, Any]] = [
        _standup_turn(
            speaker=owner_title,
            role=stage.owner_role,
            worker_id=stage.assigned_worker_id or stage.owner_role,
            tool="calculate_consequence",
            message=(
                f"I read the CEO call as '{option}': {summary} "
                f"{next_title if next_stage else 'CEO'}, which constraint are you carrying instead of resetting?"
            ),
            handoff_to=next_title if next_stage else "",
        )
    ]

    added_title = org_delta.get("added_role_title")
    if added_title:
        turns.append(_standup_turn(
            speaker=added_title,
            role=stage.owner_role,
            worker_id=str(org_delta.get("added_role_id") or added_title).lower().replace(" ", "_"),
            tool="render_org_graph",
            message=(
                f"I am now on the org graph, and I disagree with treating '{option}' as flavor. "
                f"{owner_title}, give me the evidence gap the old party could not close."
            ),
            handoff_to=next_title if next_stage else "",
        ))

    turns.append(_standup_turn(
        speaker=next_title,
        role=next_role,
        worker_id=(next_stage.assigned_worker_id if next_stage else "narrator") or next_role,
            tool="read_memory",
            message=(
                f"My next brief starts from {rule_id}, current proof {economics.get('proof', state.economics.proof)}, "
                f"velocity {economics.get('velocity', state.economics.velocity)}, and burn pressure "
                f"{economics.get('burn_pressure', state.economics.burn_pressure)}. Runway Steward, tell me what cost cannot move."
            ),
            handoff_to="founder",
        ))

    if state.economics:
        turns.append(_standup_turn(
            speaker="Runway Steward",
            role="ops",
            worker_id="runway_steward",
            tool="watch_burn",
            message=(
                f"Operating numbers changed: {state.economics.digital_worker_count} digital workers, "
                f"${state.economics.monthly_burn_usd:,}/mo burn, {state.economics.runway_months} months runway. "
                f"{owner_title}, I will back the plan only if your next artifact lowers ambiguity faster than it raises burn."
            ),
            handoff_to=next_title if next_stage else "",
        ))

    context = {
        "stage_id": stage.id,
        "next_stage_id": next_stage.id if next_stage else "",
        "next_worker_title": next_title if next_stage else "",
        "rule_id": rule_id,
        "summary": summary,
    }
    return turns[:4], context


def _build_standup_turns_for_history(
    state: CompanyState,
    stage: Stage,
    decision: Dict[str, Any],
    history: List[Dict[str, Any]],
    next_stage: Optional[Stage]
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    # Find last user comment
    last_user_turn = None
    for turn in reversed(history):
        if turn.get("role") == "founder" or turn.get("worker_id") == "founder":
            last_user_turn = turn
            break

    user_msg = last_user_turn.get("message", "") if last_user_turn else "Let's optimize our next steps."
    user_name = last_user_turn.get("speaker", "CEO") if last_user_turn else "CEO"

    owner_title = _worker_title_for_stage(stage)
    next_title = _worker_title_for_stage(next_stage)
    next_role = next_stage.owner_role if next_stage else "narrator"

    # Offline simulated turns reacting to history:
    turns = [
        _standup_turn(
            speaker=owner_title,
            role=stage.owner_role,
            worker_id=stage.assigned_worker_id or stage.owner_role,
            tool="read_memory",
            message=(
                f"{next_title}, the CEO said '{user_msg}'. I challenge you to preserve that direction "
                "without widening scope."
            ),
            handoff_to=next_title if next_stage else "",
        ),
        _standup_turn(
            speaker=next_title,
            role=next_role,
            worker_id=(next_stage.assigned_worker_id if next_stage else "narrator") or next_role,
            tool="read_memory",
            message=(
                f"{owner_title}, I accept the constraint, but I need one proof artifact from you before "
                f"I take it into my room, {user_name}."
            ),
            handoff_to="runway_steward",
        ),
    ]

    consequence = decision.get("consequence") or {}
    summary = consequence.get("summary") or "The CEO choice is now binding direction."
    context = {
        "stage_id": stage.id,
        "next_stage_id": next_stage.id if next_stage else "",
        "next_worker_title": next_title if next_stage else "",
        "rule_id": consequence.get("rule_id") or decision.get("rule_id") or "decision.custom",
        "summary": f"Looping feedback: '{user_msg[:60]}'. " + summary,
    }
    return turns, context


@app.post("/api/world/standup")
def world_standup(payload: StandupRequest):
    """Return a short manager-directed agent stand-up after a CEO decision.

    This is the simulation-safe surface for the AutoGen-style group-chat beat.
    The response shape can later be backed by Microsoft Agent Framework Group
    Chat without changing the Story Mode renderer.
    """
    state = store.load()
    if not state or not state.world:
        raise HTTPException(status_code=400, detail="No world graph.")
    world = state.world
    if not world.decisions:
        raise HTTPException(status_code=400, detail="No CEO decision to react to.")
    decision = None
    if payload.stage_id:
        decision = next((d for d in reversed(world.decisions) if d.get("stage_id") == payload.stage_id), None)
    decision = decision or world.decisions[-1]
    stage_id_val = decision.get("stage_id")
    stage = next((s for s in world.stages if s.id == stage_id_val), None)
    if not stage:
        raise HTTPException(status_code=404, detail=f"Unknown stage: {stage_id_val}")

    # Determine next stage for handoff mapping
    all_stages = world.stages
    idx = all_stages.index(stage) if stage in all_stages else -1
    next_stage = all_stages[idx + 1] if idx >= 0 and idx + 1 < len(all_stages) else None

    selection_mode = _standup_selection_mode(payload.selection_mode)

    # Load initial or history-based turns
    if payload.history:
        turns, context = _build_standup_turns_for_history(state, stage, decision, payload.history, next_stage)
    else:
        turns, context = _build_standup_turns(state, stage, decision)
    turns = _order_standup_turns(turns, selection_mode, stage.id, payload.history)

    source_label = "simulation"

    if is_live():
        from agents.maf_runtime import maf_available, run_maf_group_chat
        if maf_available():
            try:
                from agents.model_config import FOUNDRY_API_KEY, FOUNDRY_BASE_URL
                turns = run_maf_group_chat(
                    api_key=FOUNDRY_API_KEY,
                    base_url=FOUNDRY_BASE_URL,
                    company_name=state.name or "QuestForge Ltd.",
                    pitch=state.pitch or "",
                    stage_title=stage.title,
                    option=decision.get("option", ""),
                    consequence_summary=context["summary"],
                    participants=turns,
                    history=payload.history,
                )
                source_label = "foundry" if any(t.get("source") == "maf" for t in turns) else "simulation"
            except Exception as e:
                store.log_event("STANDUP_ERROR", "system", f"Standup group chat failed: {e}")

    turns = _attach_speaker_profiles(turns)

    packet = {
        "stage_id": stage.id,
        "source": source_label,
        "orchestration": {
            "pattern": "sequential_group_chat",
            "framework_target": "Microsoft Agent Framework Agent loop",
            "manager": "standup_orchestrator",
            "selection": selection_mode,
            "turn_policy": (
                "Each character receives the prior transcript and speaks once in order."
                if selection_mode == "round_robin"
                else "Characters are shuffled before the model loop; each selected character speaks once."
            ),
        },
        "trigger": {
            "option": decision.get("option", ""),
            "tradeoff": decision.get("tradeoff", ""),
            "rule_id": context["rule_id"],
            "summary": context["summary"],
        },
        "tool_plan": [
            {"tool": "calculate_consequence", "owner": _worker_title_for_stage(stage)},
            {"tool": "read_memory", "owner": context.get("next_worker_title") or "next worker"},
            {"tool": "watch_burn", "owner": "Runway Steward"},
        ],
        "characters": [turn.get("character_state") for turn in turns if turn.get("character_state")],
        "turns": turns,
        "next_brief_delta": (
            f"{context['rule_id']} is binding in the next brief. "
            f"{context['summary']}"
        ),
    }
    store.log_event(
        "AGENT_STANDUP",
        "standup_orchestrator",
        f"Agents reacted to {context['rule_id']} after '{stage.title}' ({source_label}).",
        {
            "stage_id": stage.id,
            "orchestration": packet["orchestration"],
            "trigger": packet["trigger"],
            "turns": turns,
        },
    )
    store.save()
    return packet


class StandupResponseRequest(BaseModel):
    text: str


@app.post("/api/world/standup/respond")
def respond_to_standup(payload: StandupResponseRequest):
    """Save the CEO's response to the stand-up chat into procedural agent memory.

    This ensures the workforce hears and acts on the CEO's feedback in the next room brief.
    """
    state = store.load()
    if not state:
        raise HTTPException(status_code=400, detail="No active session.")
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Response cannot be empty.")
    mem_entry = remember("procedural", f"CEO responded to standup: '{text}'", {"source": "standup_response"})
    store.log_event("CEO_STANDUP_RESPONSE", "founder", f"CEO responded to standup: {text}", {
        "text": text,
        "memory_injected": mem_entry,
    })
    store.save()
    return {"status": "success", "message": "Memory updated with response."}


@app.post("/api/world/run-next")
def run_next_stage():
    """Execute the next pending stage via the Worker Factory."""
    state = store.load()
    if not state or not state.world:
        raise HTTPException(status_code=400, detail="No world graph. Call /api/world/design first.")

    world = state.world
    pending = [s for s in world.stages if s.status not in ("completed", "needs-review")]
    if not pending:
        raise HTTPException(status_code=400, detail="All stages completed or awaiting review.")

    stage = pending[0]
    idx = world.stages.index(stage)
    world.current_stage_index = idx
    start_player_turn(state, stage_id=stage.id)

    # Foundry IQ memory recalled for this stage (surfaced to the story view).
    memory = retrieve(f"{world.brief} {stage.goal} {stage.success_metric}", top_k=2)

    previous_artifacts = [s.artifact for s in world.stages[:idx] if s.artifact]
    invocation, artifact, score = execute_stage(
        stage, world.brief, previous_artifacts, org=state.org, decisions=world.decisions)
    world.invocations.append(invocation)

    if artifact:
        stage.artifact = artifact
        stage.validation_score = score
    stage.status = "completed" if score >= 80 else "needs-review"
    record_stage_encounter(state, stage)

    xp_earned = 10 + (score // 10)
    state.xp += xp_earned
    if state.xp >= 50 and state.level < 2:
        state.level = 2
    elif state.xp >= 100 and state.level < 3:
        state.level = 3

    store.log_event("STAGE_EXECUTED", invocation.role,
        f"Stage '{stage.title}' -> score {score}, +{xp_earned} XP ({invocation.deployment}, {invocation.latency_s}s)",
        {"stage_id": stage.id, "score": score, "xp_earned": xp_earned, "latency_s": invocation.latency_s,
         # Invocation outcome receipt: failed runs keep their partial
         # tool_trace and carry the error string into the replay log.
         "status": invocation.status,
         "error": invocation.error,
         "deployment": invocation.deployment,
         "reasoning_tokens": invocation.reasoning_tokens,
         "reasoning_preview": invocation.reasoning_preview,
         # The four proof points every invocation must show (replay evidence
         # that the agent stack actually worked, not just a model call):
         "iq_hits": invocation.iq_sources,
         "memory_injected": invocation.maf_memory,
         "tools_called": invocation.maf_tools_called,
         "tool_trace": invocation.tool_trace,
         "inference_usage": {"client": invocation.maf_client or "openai-direct",
                             "fallback_reason": invocation.maf_fallback_reason,
                             "tokens_in": invocation.tokens_in,
                             "tokens_out": invocation.tokens_out,
                             "reasoning_tokens": invocation.reasoning_tokens},
         "rubric": stage.rubric}
    )

    if all(s.status == "completed" for s in world.stages):
        world.status = "completed"
        state.stage = "launched"
        store.log_event("WORLD_COMPLETED", "system", "All stages completed! Venture stage: launched.")

    refresh_session_knowledge(state)
    store.save()
    return stage_response(
        state,
        stage,
        invocation,
        memory=memory,
        # The most recent CEO decision the worker was briefed with - the UI
        # name-checks it so the player hears their own words come back.
        recalled_decision=world.decisions[-1] if world.decisions else None,
    )


@app.post("/api/world/autoplay")
def autoplay_world(payload: AutoplayRequest):
    """Full autoplay: design world + execute all stages sequentially."""
    brief = payload.pitch
    company_name = payload.company_name or "QuestForge Ltd."
    threshold = payload.auto_approve_threshold

    founder = parse_founder(payload)
    state = store.initialize_new_company(
        name=company_name, pitch=brief, description="A venture forged in QuestForge.", founder=founder
    )
    state.founder_profile = profile_from_payload(
        None, source="pitch", source_ref=brief, pitch=brief, mode=runtime_mode())
    mem_entry = remember("user_profile", f"Founder is building: {company_name} - {brief[:280]}",
             {"company": company_name})
    if mem_entry:
        store.log_event("MEMORY_WRITTEN", "memory",
            f"User-profile memory stored ({mem_entry.get('origin', 'local-memory')}): {company_name}",
            {"kind": "user_profile", "origin": mem_entry.get("origin", "")})
    store.log_event("SESSION_START", "system", f"Autoplay session for: {company_name}")

    # Design the dynamic org first so stages are owned by designed digital
    # workers - the same org->execution chain the Story flow shows. Cheap, and
    # runs in simulation too.
    org_blueprint = design_org(brief, source="pitch", source_ref=brief)
    state.org = OrgBlueprint(**org_blueprint)
    state.economics = initialize_economics_from_org(state.org)
    store.log_event(
        "ORG_CHARTERED", "org_designer",
        f"Chartered a {state.org.headcount}-seat org: 1 operator + "
        f"{state.org.digital_worker_count} digital workers.",
        {"digital_worker_count": state.org.digital_worker_count,
         "leverage_ratio": state.org.leverage_ratio},
    )

    # Autoplay runs stage dilemmas too, so it needs the same villain.
    forge_antagonist(state, mission_brief=brief)

    stages_data = design_world(brief)
    world = WorldGraph(
        brief=brief,
        stages=[Stage(**s) if isinstance(s, dict) else s for s in stages_data],
        status="active",
    )
    bindings = bind_world_to_org(world, state.org)
    state.world = world
    store.log_event("WORLD_DESIGNED", "world_designer", f"Produced {len(world.stages)} stages.")
    if bindings:
        store.log_event(
            "ORG_BOUND", "org_designer",
            f"Bound {len(bindings)} stages to dynamically designed digital workers.",
            {"bindings": bindings},
        )
    initialize_game_run(state, mode=runtime_mode())
    refresh_session_knowledge(state)

    results = []
    for stage, invocation, artifact, score in run_world(world, brief, auto_approve_threshold=threshold, org=state.org):
        record_stage_encounter(state, stage)
        xp_earned = 10 + (score // 10)
        state.xp += xp_earned
        if state.xp >= 50 and state.level < 2:
            state.level = 2
        elif state.xp >= 100 and state.level < 3:
            state.level = 3

        store.log_event("STAGE_EXECUTED", invocation.role,
            f"Stage '{stage.title}' -> score {score}, +{xp_earned} XP",
            {"stage_id": stage.id, "score": score, "latency_s": invocation.latency_s,
             # Invocation outcome receipt (same contract as /api/world/run-next).
             "status": invocation.status,
             "error": invocation.error,
             "deployment": invocation.deployment,
             "reasoning_tokens": invocation.reasoning_tokens,
             # The four proof points every invocation must show (same evidence
             # contract as /api/world/run-next - autoplay is not exempt):
             "iq_hits": invocation.iq_sources,
             "memory_injected": invocation.maf_memory,
             "tools_called": invocation.maf_tools_called,
             "tool_trace": invocation.tool_trace,
             "inference_usage": {"client": invocation.maf_client or "openai-direct",
                                 "fallback_reason": invocation.maf_fallback_reason,
                                 "tokens_in": invocation.tokens_in,
                                 "tokens_out": invocation.tokens_out,
                                 "reasoning_tokens": invocation.reasoning_tokens}}
        )
        results.append({"stage_id": stage.id, "title": stage.title, "score": score, "status": stage.status})

    if world.status == "completed":
        state.stage = "launched"
        store.log_event("WORLD_COMPLETED", "system", "Autoplay complete! All stages done.")

    refresh_session_knowledge(state)
    store.log_event(
        "KNOWLEDGE_STRUCTURED", "iq_sync",
        f"Structured {len(state.knowledge_records)} generated Search document(s) after autoplay.",
        {"kinds": sorted({doc.kind for doc in state.knowledge_records})},
    )
    store.save()
    return state_response(state, surface="world_graph", results=results)


@app.post("/api/reset")
def reset_game():
    """Resets the state file and the agent-memory ledger (new venture = clean slate)."""
    if os.path.exists(STATE_FILE):
        try:
            os.remove(STATE_FILE)
        except Exception:
            pass
    store.state = None
    try:
        from agents.memory import forget_all
        forget_all()
    except Exception:
        pass
    return reset_response()

# Mount static folder for UI
UI_DIRECTORY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui")
os.makedirs(UI_DIRECTORY, exist_ok=True)

# Mount the release UI and static files.
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
