import os
import sys
import json
import time
import uuid
import yaml
import random
import hashlib
import threading
import urllib.request
import re
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
    PlayerMove,
    WorldCouncilDeliberation,
)
from state.consequences import (
    apply_decision_consequence,
    apply_stage_outcome,
    fire_worker,
    hire_worker,
    hireable_options,
    initialize_economics_from_org,
    preview_decision_consequence,
    principle_for_rule,
    rule_ids_for_role,
    select_rule_id,
    tick_economy,
    world_snapshot,
)
from state.api_contract import refresh_venture_model, state_response, step_response, stage_response, reset_response
from state.game_state import (
    claim_reward_card,
    end_player_turn,
    ensure_active_run,
    initialize_game_run,
    play_card,
    reconcile_run_status,
    record_choice_game_state,
    record_stage_encounter,
    start_player_turn,
    sync_party_from_org,
    _invocation_for_stage as latest_invocation_for_stage,
)
from state.knowledge_records import profile_from_payload, record_world_day, refresh_session_knowledge
from agents.foundry_agents import MasterNarrator, StrategistAgent, DesignerAgent, MarketerAgent, generate_lore
from agents.model_config import model_for, is_live, runtime_mode, runtime_status, get_foundry_client, create_chat_completion
from agents.world_designer import design_world, design_world_named, adapt_remaining_stages, derive_run_name, worker_report_clause, PLACEHOLDER_RUN_NAMES
from agents.world_council import convene_world_council
from agents.worker_factory import run_world, execute_stage, bind_world_to_org
from agents.org_designer import design_org
from agents.retrieval import retrieve, brief_from_url
from agents.memory import remember, recall_memories, memory_snapshot
from agents.founder_analyst import analyze_founder_profile, founder_name_from_url
from agents.antagonist_generator import generate_antagonist, analyze_archetype_gap, clean_person_name
from tools.code_interpreter_wrappers import validate_positioning, validate_landing_page, validate_marketing_email
from tools.toolbox import tools_list, tools_call, tools_for_role
from tools.export_org_blueprint import org_to_workforce_bundle
from tools.dilemma_generator import build_stage_dilemma

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


def _state_dump(state: CompanyState) -> dict:
    """Return state JSON with derived display contracts refreshed."""
    refresh_venture_model(state)
    return state.model_dump()


def _client_trace_id(value: Optional[str]) -> str:
    """Normalize a browser-generated correlation id for replay/search payloads."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    return re.sub(r"[^A-Za-z0-9_.:-]+", "-", raw)[:96]


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

# Placeholder founder names we treat as "no real name yet" - so a name read
# from the player's LinkedIn can adopt the founder seat without overwriting a
# name the player actually typed.
DEFAULT_FOUNDER_NAMES = {"", "acolyte", "acolyte's venture", "founder"}


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


def ensure_run_id(state: CompanyState) -> str:
    """Assign a stable run_id once a run becomes real, so it persists as a slot.

    Derived from the company name plus a short random suffix for a readable,
    collision-safe slot filename. Idempotent: an existing run_id is never
    reused or overwritten.
    """
    existing = (getattr(state, "run_id", "") or "").strip()
    if existing:
        if state.game and state.game.run_id != existing:
            state.game.run_id = existing
        return existing
    base = "".join(c.lower() if c.isalnum() else "-" for c in (state.name or "run")).strip("-")
    base = "-".join(p for p in base.split("-") if p)[:32] or "run"
    state.run_id = f"{base}-{uuid.uuid4().hex[:6]}"
    if state.game and (not state.game.run_id or state.game.run_id == "run_default" or state.game.run_id.startswith("run_")):
        state.game.run_id = state.run_id
    return state.run_id


def remember_for_run(state: CompanyState, kind: str, text: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Write agent memory scoped to the active save slot."""
    scoped_payload = dict(payload or {})
    run_id = ensure_run_id(state)
    if run_id and "run_id" not in scoped_payload:
        scoped_payload["run_id"] = run_id
    # Link memories to the founder via the non-PII profile_key (a hash of the
    # profile URL). The raw URL stays local-only; this key lets a founder's
    # memories + Foundry IQ doc link to the same person across runs.
    profile = getattr(state, "founder_profile", None)
    link_key = getattr(profile, "profile_key", "") if profile else ""
    if link_key and "profile_key" not in scoped_payload:
        scoped_payload["profile_key"] = link_key
    return remember(kind, text, scoped_payload)


def forge_antagonist(state: CompanyState, *, mission_brief: str = "", target_customer: str = "") -> None:
    """Forge the competitive foil (villain) from the founder's archetype.

    Single source of truth used by every path that runs stage dilemmas
    (analyze, world/design, autoplay) so the story always has a worthy
    opponent with concrete market tension. Logged for replay visibility.
    """
    founder = state.founder or FounderState()
    # The player's real name (e.g. from their LinkedIn) makes the rival's threat
    # personal AND is barred from the rival's own name so the villain is never
    # accidentally named after the player. Cleaned of handle/id artifacts so the
    # villain never targets "Jordan Rivera 9f8e".
    founder_name = clean_person_name(founder.name or "")
    if founder_name.lower() in DEFAULT_FOUNDER_NAMES:
        founder_name = ""
    antagonist = generate_antagonist(
        founder_archetype=founder.archetype,
        founder_skill=founder.skill,
        mission_brief=mission_brief or state.pitch or "",
        target_customer=target_customer,
        founder_name=founder_name,
    )
    client = get_foundry_client()
    deployment = model_for("antagonist")
    if client and deployment and is_live():
        # The founder's blind spot / fear - the rival is built to attack exactly
        # this, because it is the founder's own shadow ("you if you took the money").
        gap = analyze_archetype_gap(founder.archetype)
        try:
            resp = create_chat_completion(
                deployment,
                [
                    {"role": "system", "content": (
                        "You are the Antagonist Director for a business-building strategy game. "
                        "INVENT the founder's antagonist as their SHADOW - 'you if you'd taken the "
                        "money'. The rival is the OPPOSITE archetype weaponized by capital: it is "
                        "strong exactly where the founder is weak, and it attacks the founder's "
                        "blind spot. Make it feel like a real company/system with a concrete "
                        "business model, not a cartoon villain. "
                        "NAMING (this is the showcase - generate, don't template): invent a fresh, "
                        "evocative rival NAME of 2-4 words that embodies this opposite force and "
                        "fits the founder's actual market. It must be a coherent organization name, "
                        "never a random word glued to a noun. NEVER name the rival after the founder "
                        "or their company, and never reuse the founder's name or brand tokens - the "
                        "antithesis cannot wear the hero's name. "
                        "Address the founder by name in `active_operation` and `organization_model` "
                        "so the threat feels personal. Use ONLY the founder's clean human name as given "
                        "(never append handle/id fragments, trailing digits, or URL slugs). "
                        "Keep every field plain in-world business language: NEVER reference internal "
                        "filenames, playbooks, .md/.json/.yaml files, tool names, or system internals, "
                        "and avoid political/extremist labels (no 'fascist' etc.) - describe tactics "
                        "in concrete market terms instead. "
                        "Return ONLY JSON with keys: name, threat_type, "
                        "threat_description, signature_tactic, strengths (array), strategy, motivation, "
                        "organization_name, organization_model, organization_roles (array), active_operation."
                    )},
                    {"role": "user", "content": (
                        f"Founder name: {founder_name or 'unknown'}\n"
                        f"Founder archetype: {founder.archetype} (superpower: {founder.skill})\n"
                        f"Founder blind spot: {gap.get('weakness', 'unknown')}\n"
                        f"Founder's fear / what attacks them: {gap.get('danger', 'unknown')}\n"
                        f"Rival is the opposite archetype: {antagonist.archetype}\n"
                        f"Mission brief: {(mission_brief or state.pitch or '')[:1200]}\n"
                        f"Target customer: {target_customer or 'unknown'}\n"
                        f"Deterministic fallback rival (replace its name with a fresh invented one): "
                        f"{antagonist.model_dump()}"
                    )},
                ],
                max_completion_tokens=1800,
                response_format={"type": "json_object"},
            )
            content = resp.choices[0].message.content or ""
            parsed = json.loads(content[content.index("{"):content.rindex("}") + 1])
            patch = {k: v for k, v in parsed.items() if k in {
                "name", "threat_type", "threat_description", "signature_tactic",
                "strengths", "strategy", "motivation", "organization_name",
                "organization_model", "organization_roles", "active_operation"
            }}
            # Guard the antithesis property: if the model named the rival after
            # the player (their name/brand tokens), drop just the generated name
            # and keep the clean deterministic one. Everything else still applies.
            bad_tokens = {t for t in re.split(r"[^a-z0-9]+", (founder_name or "").lower()) if len(t) >= 3}
            gen_name = str(patch.get("name") or "")
            if bad_tokens and any(t in gen_name.lower() for t in bad_tokens):
                patch.pop("name", None)
                patch.pop("organization_name", None)
            if patch.get("signature_tactic") and (patch.get("name") or antagonist.name):
                base = antagonist.model_dump()
                base.update(patch)
                antagonist = AntagonistState(**base)
        except Exception as exc:
            store.log_event(
                "ANTAGONIST_LIVE_ERROR", "antagonist",
                f"Live antagonist generation failed; deterministic rival retained: {type(exc).__name__}",
                {"deployment": deployment},
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

def _advance_clock(state) -> dict:
    """Tick the real-time clock once and log any rival escalation / run-end.

    Single source for the read endpoints: both /api/state and /api/game call
    this so the treasury drain, the antagonist's escalating moves, and the
    bankruptcy/defeat outcomes are logged to the replay trace and persisted
    consistently, not duplicated per route.
    """
    result = tick_economy(state)
    if not result.get("ticked"):
        return result
    arc_info = result.get("antagonist") or {}
    if arc_info.get("escalated_to"):
        store.log_event(
            "ANTAGONIST_ESCALATED",
            arc_info.get("rival") or "antagonist",
            arc_info.get("pressure") or "The rival escalates.",
            {
                "escalation_stage": arc_info.get("escalated_to"),
                "threat_level": (state.game.antagonist_arc.threat_level if state.game else None),
                "days_elapsed": round(float(getattr(state.economics, "days_elapsed", 0) or 0), 2),
            },
        )
    # Forced contraction: the clock laid off a worker because the company can't
    # sustain its burn. Persist it as a replay event AND a procedural memory so
    # the workforce "learns" the pressure (the Foundry memory/IQ layer), and the
    # next worker brief carries it - tying money pressure into the reasoning loop.
    contraction = result.get("contraction") or {}
    if contraction.get("laid_off_title"):
        sync_party_from_org(state)
        store.log_event(
            "WORKFORCE_CONTRACTED", "system",
            f"Laid off {contraction['laid_off_title']} - unprofitable. "
            f"Burn ${contraction['burn_before_usd']:,}/mo -> ${contraction['burn_after_usd']:,}/mo, "
            f"{contraction['worker_count_after']} workers, {contraction['runway_days']}d runway.",
            contraction,
        )
        mem_entry = remember_for_run(
            state,
            "procedural",
            f"Had to lay off {contraction['laid_off_title']} on day {contraction['day']} "
            f"because the company was unprofitable (burn exceeded revenue). Burn fell to "
            f"${contraction['burn_after_usd']:,}/mo. The workforce must win revenue faster than it spends.",
            {"event": "workforce_contraction", "laid_off": contraction["laid_off_id"]},
        )
        if mem_entry:
            store.log_event(
                "MEMORY_WRITTEN", "memory",
                f"Procedural memory stored ({mem_entry.get('origin', 'local-memory')}): workforce contraction",
                {"kind": "procedural", "origin": mem_entry.get("origin", "")},
            )
    store.save()
    return result


def _reconcile_loaded_game(state) -> bool:
    """Repair lifecycle drift in older saved runs before returning state."""
    if not state or not state.game:
        return False
    before = (
        state.stage,
        state.game.run_status,
        state.game.victory_reason,
        state.world.status if state.world else "",
    )
    reconcile_run_status(state)
    after = (
        state.stage,
        state.game.run_status,
        state.game.victory_reason,
        state.world.status if state.world else "",
    )
    if before != after:
        store.save()
        return True
    return False


@app.get("/api/state")
def get_state():
    """Gets the current company state from disk."""
    state = store.load()
    _reconcile_loaded_game(state)
    if state and state.economics and state.org:
        _advance_clock(state)
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
    _reconcile_loaded_game(state)
    if state.economics and state.org:
        _advance_clock(state)
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
    _reconcile_loaded_game(state)
    try:
        move = start_player_turn(state, stage_id=payload.stage_id or "")
        refresh_session_knowledge(state)
        store.log_event("PLAYER_MOVE", "founder", move.summary, move.model_dump())
        store.save()
        return {"move": move.model_dump(), "state": _state_dump(state)}
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
    _reconcile_loaded_game(state)
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
        return {"move": move.model_dump(), "state": _state_dump(state)}
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
    _reconcile_loaded_game(state)
    try:
        move = claim_reward_card(state, payload.card_id)
        refresh_session_knowledge(state)
        store.log_event("PLAYER_MOVE", "founder", move.summary, move.model_dump())
        store.save()
        return {"move": move.model_dump(), "state": _state_dump(state)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/game/turn/end")
def end_game_turn(payload: StartTurnRequest):
    """End a card turn, discard hand, and draw the next turn."""
    state = store.load()
    if not state:
        raise HTTPException(status_code=400, detail="No active game session.")
    _reconcile_loaded_game(state)
    try:
        move = end_player_turn(state, stage_id=payload.stage_id or "")
        refresh_session_knowledge(state)
        store.log_event("PLAYER_MOVE", "founder", move.summary, move.model_dump())
        store.save()
        return {"move": move.model_dump(), "state": _state_dump(state)}
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
    state = store.load()
    run_id = (getattr(state, "run_id", "") or "") if state else ""
    return memory_snapshot(run_id=run_id or None)


@app.get("/api/mode")
def get_mode():
    """Report whether the reasoning path is local, cloud, hybrid, or simulation."""
    return runtime_status()


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
TTS_CACHE_SECONDS = max(0, int(float(os.getenv("TTS_CACHE_SECONDS", "3600") or 3600)))
_TTS_CACHE: Dict[str, Tuple[float, bytes, str]] = {}
_TTS_CACHE_LOCK = threading.RLock()

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


def _tts_cache_key(text: str, voice: str, instructions: str) -> str:
    raw = json.dumps({"text": text, "voice": voice, "instructions": instructions}, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _tts_cache_get(key: str) -> Optional[Tuple[bytes, str]]:
    if not TTS_CACHE_SECONDS:
        return None
    with _TTS_CACHE_LOCK:
        item = _TTS_CACHE.get(key)
        if not item:
            return None
        expires, audio, deployment = item
        if expires < time.time():
            _TTS_CACHE.pop(key, None)
            return None
        return audio, deployment


def _tts_cache_put(key: str, audio: bytes, deployment: str) -> None:
    if not TTS_CACHE_SECONDS:
        return
    with _TTS_CACHE_LOCK:
        if len(_TTS_CACHE) > 64:
            oldest = min(_TTS_CACHE, key=lambda k: _TTS_CACHE[k][0])
            _TTS_CACHE.pop(oldest, None)
        _TTS_CACHE[key] = (time.time() + TTS_CACHE_SECONDS, audio, deployment)


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
    voice = payload.voice or TTS_VOICE
    instructions = (payload.instructions or "").strip()[:600]
    cache_key = _tts_cache_key(text, voice, instructions)
    cached = _tts_cache_get(cache_key)
    if cached:
        audio, deployment = cached
        return Response(
            content=audio,
            media_type="audio/mpeg",
            headers={
                "Cache-Control": f"private, max-age={TTS_CACHE_SECONDS}",
                "X-TTS-Deployment": deployment,
                "X-TTS-Cache": "hit",
            },
        )
    last_error = ""
    for deployment in TTS_DEPLOYMENTS:
        url = (f"{TTS_ENDPOINT}/openai/deployments/{deployment}"
               f"/audio/speech?api-version={TTS_API_VERSION}")
        body_data = {
            "model": deployment,
            "input": text,
            "voice": voice,
        }
        # Delivery direction (tone, pacing) - supported by current Azure
        # OpenAI-style TTS deployments and ignored by incompatible fallbacks.
        if instructions:
            body_data["instructions"] = instructions
        body = json.dumps(body_data).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"api-key": TTS_API_KEY, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                audio = resp.read()
            _tts_cache_put(cache_key, audio, deployment)
            return Response(
                content=audio,
                media_type="audio/mpeg",
                headers={
                    "Cache-Control": f"private, max-age={TTS_CACHE_SECONDS}" if TTS_CACHE_SECONDS else "no-store",
                    "X-TTS-Deployment": deployment,
                    "X-TTS-Cache": "miss",
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


@app.post("/api/world/villain-portrait")
def generate_villain_portrait_endpoint():
    """Game-master-generated portrait of the forged antagonist.

    Mirrors the founder avatar path: try the configured image deployment, then
    fall back to a deterministic menacing SVG so the villain always has a face
    even with no credentials. The villain is an active, shown player - not a HUD
    number - so it gets a real portrait surfaced in the standup and threat arc.
    """
    import base64
    state = store.load()
    ant = state.antagonist if state else None
    if not ant:
        raise HTTPException(status_code=400, detail="No antagonist forged yet.")
    name = ant.name or "The Rival"
    threat_type = ant.threat_type or "market"
    archetype = ant.archetype or "Operator"

    prompt = (
        f"minimal flat geometric portrait of a menacing rival business antagonist "
        f"named {name}, a {archetype} posing a {threat_type} threat, "
        "dark crimson and charcoal background filling the entire canvas edge to edge, "
        "sharp red and steel accents, cold ominous lighting, clean vector style game "
        "villain avatar, centered bust, no text, no border, no frame, no letterboxing"
    )

    image_endpoint = os.getenv("IMAGE_ENDPOINT", "").strip().rstrip("/")
    image_deployment = os.getenv("IMAGE_DEPLOYMENT", "MAI-Image-2e").strip()
    image_api_key = os.getenv("IMAGE_API_KEY", "").strip()

    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui", "assets", "generated")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "villain.png")

    if image_endpoint and image_api_key:
        try:
            body = json.dumps({
                "model": image_deployment, "prompt": prompt,
                "width": 1024, "height": 1024,
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
                elif data.get("url"):
                    with urllib.request.urlopen(data["url"], timeout=30) as r2:
                        png_bytes = r2.read()
            if png_bytes:
                with open(out_path, "wb") as f:
                    f.write(png_bytes)
                store.log_event("VILLAIN_PORTRAIT", "narrator",
                                f"Game master rendered a portrait of {name}.", {"source": "azure"})
                return {"url": "/game/assets/generated/villain.png", "source": "azure"}
        except Exception as e:
            store.log_event("VILLAIN_PORTRAIT_ERROR", "system", f"Villain image generation failed: {e}")

    # Offline fallback: a deterministic menacing crest keyed to the threat type.
    threat_glyph = {
        "market": '<path d="M30,68 L50,30 L70,68 Z" fill="none" stroke="#fb7185" stroke-width="3"/><circle cx="50" cy="56" r="6" fill="#fb7185"/>',
        "technical": '<rect x="32" y="34" width="36" height="36" rx="3" fill="none" stroke="#fb7185" stroke-width="3"/><line x1="32" y1="52" x2="68" y2="52" stroke="#f59e0b" stroke-width="2"/><line x1="50" y1="34" x2="50" y2="70" stroke="#f59e0b" stroke-width="2"/>',
        "internal": '<circle cx="50" cy="50" r="20" fill="none" stroke="#fb7185" stroke-width="3"/><path d="M40,42 L60,58 M60,42 L40,58" stroke="#f59e0b" stroke-width="2"/>',
        "cultural": '<polygon points="50,28 68,44 60,70 40,70 32,44" fill="none" stroke="#fb7185" stroke-width="3"/><circle cx="50" cy="52" r="5" fill="#f59e0b"/>',
    }.get(threat_type, '<path d="M30,68 L50,30 L70,68 Z" fill="none" stroke="#fb7185" stroke-width="3"/>')
    safe_name = html_escape(str(name).upper()[:24], quote=False)
    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <rect width="100" height="100" fill="#0b0507"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="#3a1419" stroke-width="2"/>
        <circle cx="50" cy="47" r="20" fill="#fb7185" opacity="0.10"/>
        <circle cx="50" cy="47" r="14" fill="#fb7185" opacity="0.20"/>
        {threat_glyph}
        <text x="50" y="90" font-family="monospace" font-size="6.5" fill="#fb7185" text-anchor="middle">{safe_name}</text>
    </svg>"""
    svg_path = os.path.join(out_dir, "villain.svg")
    with open(svg_path, "w") as f:
        f.write(svg_content)
    store.log_event("VILLAIN_PORTRAIT", "narrator",
                    f"Game master sketched {name} (offline crest).", {"source": "offline-svg"})
    return {"url": "/game/assets/generated/villain.svg", "source": "offline-svg"}


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
        "state": _state_dump(state),
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
    # Name the run from the pitch when the founder never typed a real company
    # name (the onboarding asks for a URL, not a name). Pitch-only: never derive
    # from a bare URL. Falls back to the placeholder for anything ambiguous.
    if pitch and company_name.strip().lower() in PLACEHOLDER_RUN_NAMES:
        company_name = derive_run_name(pitch, fallback=company_name)
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
        mem_entry = remember_for_run(
            state,
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

    # Adopt the player's real name from their LinkedIn profile so the run
    # addresses them directly (and the rival can target them by name). The URL
    # is the identity signal in this game, so the profile name wins UNLESS the
    # player explicitly typed a founder_name in the payload. Never derived from
    # a company/mission URL (founder_name_from_url only reads personal profiles).
    person_name = founder_name_from_url(url) if url else ""
    if person_name:
        if state.founder is None:
            state.founder = FounderState()
        explicit_name = bool(getattr(payload, "founder_name", None))
        current = (state.founder.name or "").strip().lower()
        if not explicit_name or current in DEFAULT_FOUNDER_NAMES:
            state.founder.name = person_name
        if state.founder_profile:
            state.founder_profile.person_name = person_name

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

    ensure_run_id(state)
    initialize_game_run(state, mode=runtime_mode())
    refresh_session_knowledge(state)
    store.log_event(
        "KNOWLEDGE_STRUCTURED", "iq_sync",
        f"Structured {len(state.knowledge_records)} generated Search document(s) from the analyzed run.",
        {"kinds": sorted({doc.kind for doc in state.knowledge_records})},
    )
    store.save()
    return {
        "state": _state_dump(state),
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


@app.get("/api/org/options")
def org_hire_options():
    """The hire menu: the seats the CEO can add mid-run and their monthly cost.

    Cost math lives in consequences.hireable_options (single source), so the UI
    renders the menu without re-deriving any price.
    """
    return {"options": hireable_options()}


class HireRequest(BaseModel):
    role_key: str


@app.post("/api/org/hire")
def org_hire(payload: HireRequest):
    """CEO hires a digital worker: burn rises now, capacity (and for GTM seats,
    market share) grows. Persists the org change, logs it, and writes a
    procedural memory so later worker briefs reason against the new workforce.
    """
    state = store.load()
    if not state:
        raise HTTPException(status_code=400, detail="No active session.")
    try:
        receipt = hire_worker(state, payload.role_key)
        sync_party_from_org(state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    store.log_event(
        "WORKFORCE_HIRED", "founder",
        f"Hired {receipt['hired_title']} - burn ${receipt['burn_before_usd']:,}/mo -> "
        f"${receipt['burn_after_usd']:,}/mo, {receipt['worker_count_after']} workers, "
        f"{receipt['runway_days']}d runway.",
        receipt,
    )
    mem_entry = remember_for_run(
        state,
        "procedural",
        f"Founder hired a {receipt['hired_title']} to grow the company. Burn rose to "
        f"${receipt['burn_after_usd']:,}/mo for new capacity - this seat must earn it back "
        f"by winning and keeping customers.",
        {"event": "workforce_hire", "hired": receipt["hired_id"]},
    )
    if mem_entry:
        store.log_event(
            "MEMORY_WRITTEN", "memory",
            f"Procedural memory stored ({mem_entry.get('origin', 'local-memory')}): workforce hire",
            {"kind": "procedural", "origin": mem_entry.get("origin", "")},
        )
    refresh_session_knowledge(state)
    store.save()
    return {"receipt": receipt, "state": _state_dump(state)}


class FireRequest(BaseModel):
    role_id: str


@app.post("/api/org/fire")
def org_fire(payload: FireRequest):
    """CEO lays off a digital worker by choice: burn falls, runway extends, and
    the worker's pending stages reassign. Persists, logs, and remembers it.
    """
    state = store.load()
    if not state:
        raise HTTPException(status_code=400, detail="No active session.")
    try:
        receipt = fire_worker(state, payload.role_id)
        sync_party_from_org(state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    store.log_event(
        "WORKFORCE_CONTRACTED", "founder",
        f"Founder laid off {receipt['laid_off_title']} - burn ${receipt['burn_before_usd']:,}/mo -> "
        f"${receipt['burn_after_usd']:,}/mo, {receipt['worker_count_after']} workers, "
        f"{receipt['runway_days']}d runway.",
        receipt,
    )
    mem_entry = remember_for_run(
        state,
        "procedural",
        f"Founder chose to lay off {receipt['laid_off_title']} to extend runway. Burn fell to "
        f"${receipt['burn_after_usd']:,}/mo. The leaner workforce must still ship the remaining stages.",
        {"event": "workforce_fire", "laid_off": receipt["laid_off_id"]},
    )
    if mem_entry:
        store.log_event(
            "MEMORY_WRITTEN", "memory",
            f"Procedural memory stored ({mem_entry.get('origin', 'local-memory')}): founder layoff",
            {"kind": "procedural", "origin": mem_entry.get("origin", "")},
        )
    refresh_session_knowledge(state)
    store.save()
    return {"receipt": receipt, "state": _state_dump(state)}


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
    # Carry a personalized name forward from a prior analyze session, else name
    # the run from the pitch (pitch-only, never a bare URL). Placeholder stays
    # only when nothing better is available.
    if company_name.strip().lower() in PLACEHOLDER_RUN_NAMES:
        if prev and prev.name and prev.name.strip().lower() not in PLACEHOLDER_RUN_NAMES:
            company_name = prev.name
        elif brief:
            company_name = derive_run_name(brief, fallback=company_name)

    state = store.initialize_new_company(
        name=company_name, pitch=brief, description="A venture forged in QuestForge.", founder=founder
    )
    # Continue the SAME run the analyze step started: carry its run_id forward
    # BEFORE any memory write (remember_for_run assigns an id when missing), so
    # the onboarding profile memory stays in scope and the save slot is the same
    # file - not a second, orphaned slot with a fresh random suffix.
    if prev and getattr(prev, "run_id", ""):
        state.run_id = prev.run_id
        state.game.run_id = prev.run_id
    # Agent memory (user profile): durable facts about this founder/company.
    mem_entry = remember_for_run(state, "user_profile", f"Founder is building: {company_name} - {brief[:280]}",
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
        # Cold start (world design called without a prior analyze session): there
        # is no chartered org yet. Build one now from the pitch so the workforce,
        # economics, and the hire/fire endpoints all have a real org to operate
        # on - otherwise /api/org/hire fails with "No org to hire into yet."
        cold_brief = (state.founder_profile.brief if state.founder_profile else "").strip() or brief
        state.org = OrgBlueprint(**design_org(cold_brief, source="pitch", source_ref=brief))
        state.economics = initialize_economics_from_org(state.org)
        state.business_flags["org_chartered"] = True
        store.log_event(
            "ORG_CHARTERED", "org_designer",
            f"Cold-start chartered a {state.org.headcount}-seat org: 1 operator + "
            f"{state.org.digital_worker_count} digital workers.",
            {"source": "pitch", "headcount": state.org.headcount,
             "digital_worker_count": state.org.digital_worker_count,
             "monthly_burn_usd": state.org.monthly_burn_usd},
        )
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

    run_name, stages_data = design_world_named(design_brief)
    # Name a URL-only run from the World Designer's own venture name when the
    # company is still a placeholder and the deterministic pitch path could not
    # name it (the live model sees the full analyzed profile, not just a URL).
    if run_name and company_name.strip().lower() in PLACEHOLDER_RUN_NAMES:
        company_name = run_name
        state.name = run_name
        store.log_event("WORLD_NAMED", "world_designer",
                        f"World Designer named the run '{run_name}' from the analyzed profile.",
                        {"run_name": run_name})
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
    # The run is now real (world designed) - give it a stable id so it persists
    # as its own save slot and can be resumed alongside other companies.
    ensure_run_id(state)
    initialize_game_run(state, mode=runtime_mode())
    refresh_session_knowledge(state)
    store.log_event(
        "KNOWLEDGE_STRUCTURED", "iq_sync",
        f"Structured {len(state.knowledge_records)} generated Search document(s) after world design.",
        {"kinds": sorted({doc.kind for doc in state.knowledge_records})},
    )
    store.save()
    return state_response(state, surface="world_graph")


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


def _worker_for_rule(state: CompanyState, rule_id: str, owner_role: str) -> Dict[str, Any]:
    """Identify the digital worker who would champion a dilemma option.

    The rule_id's prefix is the artifact role (strategist|designer|marketer|ops).
    We resolve that to an actual seat in the designed org when one matches, so a
    choice is attributed to a named worker the player can see - the bridge from
    the multi-agent workforce to the CEO decision gate.
    """
    role = (rule_id.split(".", 1)[0] or owner_role or "strategist").strip().lower()
    if role not in _ROLE_PORTRAIT:
        role = (owner_role or "strategist").lower()
    title = ""
    worker_id = ""
    org = getattr(state, "org", None)
    if org:
        for r in org.roles:
            if r.kind == "human":
                continue
            hay = f"{r.deployment_hint} {r.lifecycle_stage} {r.id} {r.title}".lower()
            if role and role in hay:
                title = r.title
                worker_id = r.id
                break
    profile = _speaker_profile(title, role, worker_id or role)
    return {
        "worker_id": profile["worker_id"],
        "title": profile["display_name"],
        "role": role,
        "role_label": profile["role_label"],
        "portrait_url": profile["portrait_url"],
        "voice_id": profile["voice_id"],
    }


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
            # The digital worker who would own this path - so the choice reads as
            # "your workforce proposes, you decide" instead of a popup from
            # nowhere. The rule's role determines the consequence; this names the
            # worker accountable for it.
            "proposed_by": _worker_for_rule(state, rule_id, stage.owner_role),
            # The real business principle this path tests - names the concept the
            # CEO is actually deciding (beachhead, blitzscale, build-measure-learn),
            # so the gate teaches as it plays. Same source feeds the receipt.
            "principle": principle_for_rule(rule_id),
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
        except Exception as e:
            store.log_event(
                "DILEMMA_LIVE_ERROR", "narrator",
                f"Foundry dilemma generation failed for stage {stage.id}; falling back: {e}",
            )
            dilemma = None
    if not dilemma:
        # One deterministic, venture-aware fallback - the single dilemma source
        # of truth in tools/dilemma_generator (replaces the old generator +
        # _CANNED_DILEMMAS). Pure dict-building over known templates, so it never
        # raises and is a safe last-resort floor.
        dilemma = build_stage_dilemma(state, stage, next_stage)
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
    # The worker comes back to the CEO with information: the live signal it
    # researched and the knowledge it grounded in. Surfaced on the gate so the
    # CEO decides FROM what the workforce actually found, not a blank prompt.
    report = _worker_field_report(state, stage)
    dilemma["field_report"] = {
        "worker": _worker_title_for_stage(stage),
        "role": stage.owner_role,
        "headline": report["headline"],
        "signal": report["signal"],
        "source": report["source"],
        "events": report["events"],
        "tools_called": report["tools_called"],
    }
    # The tool plan leads with the REAL tools the worker just used (recall /
    # web_search / validators), then the forward consequence-preview tools.
    real_tool_reasons = {
        "recall": "Grounded this stage in the venture knowledge base (Foundry IQ).",
        "web_search": "Pulled live current events from the web into the reasoning.",
        "map_company": "Mapped a public company URL into a venture profile.",
    }
    dilemma["tool_plan"] = [
        {"tool": t, "reason": real_tool_reasons.get(t, "Validated the artifact before it reached the gate.")}
        for t in report["tools_called"][:2]
    ] + [
        {"tool": "calculate_consequence", "reason": "Preview org and economics before the CEO commits."},
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
    # The workforce's real field report, computed once (single source): both Game
    # Masters answer what the digital workers brought back - the antagonist
    # contests the wedge they found, and the World Designer bends pending stages.
    worker_report = _worker_field_report(state, stage)
    antagonist_move = record_choice_game_state(state, stage, choice_record, worker_report=worker_report)

    # Agent memory (procedural): the workers learn the CEO's operating pattern
    # from every gate decision - recalled in all later worker briefs.
    mem_entry = remember_for_run(state, "procedural",
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

    # Living world graph: bend the not-yet-played stages to the company that now
    # exists after this decision, so the quest line visibly tracks the pivot. The
    # World Designer reacts to the SAME field report the antagonist just answered
    # (computed once above), closing the worker -> Game Master loop on both sides.
    adapted_ids = adapt_remaining_stages(
        world, stage.id, _live_world_state(state),
        decisions=world.decisions, brief=world.brief, worker_report=worker_report)
    adapted_reason = worker_report_clause(worker_report)
    if adapted_ids:
        store.log_event("WORLD_ADAPTED", "world_designer",
            f"World Designer bent {len(adapted_ids)} pending stage(s) to the CEO choice"
            + (f" and the workforce's finding: {adapted_reason}" if adapted_reason else "")
            + ".",
            {"stage_ids": adapted_ids, "after": stage.id, "worker_finding": adapted_reason})

    # Game Master Council: the world-engine agents (World Designer, Antagonist
    # Director, Org Designer) convene to RATIFY this move and lock the forward
    # motion. It turns the world changes just made - the antagonist move and the
    # stage adaptation, both computed once above - into a visible, persisted,
    # multi-agent deliberation. The deterministic council runs on every move so
    # the roguelike world keeps evolving across reloads; /api/world/council
    # upgrades it to the live MAF group chat on demand. The council narrates and
    # persists these moves; it never re-mutates the world.
    council = convene_world_council(
        state, stage=stage, decision=entry, antagonist_move=antagonist_move,
        adapted_stage_ids=adapted_ids, worker_report=worker_report, live=False)
    _record_world_council(state, council)
    store.log_event("WORLD_COUNCIL", "world_council",
        f"Game Masters ratified forward motion after '{stage.title}': {council.forward_motion[:120]}",
        {"stage_id": stage.id, "trigger": council.trigger, "source": council.source,
         "adapted_stage_ids": council.adapted_stage_ids,
         "antagonist_move_id": council.antagonist_move_id,
         "threat_before": council.threat_before, "threat_after": council.threat_after,
         "turns": [t.model_dump() for t in council.turns]})

    refresh_session_knowledge(state)
    store.log_event("KNOWLEDGE_STRUCTURED", "iq_sync",
        f"Structured {len(state.knowledge_records)} generated Search document(s) after CEO choice.",
        {"choice_id": choice_record.id, "day_index": choice_record.day_index})

    # The next-brief target closes the decision receipt: name the stage (and the
    # worker who owns it) that now inherits this choice as binding direction, so
    # the UI can show decision -> consequence -> memory -> next brief as one chain.
    next_brief = None
    if stage in world.stages:
        nidx = world.stages.index(stage) + 1
        if nidx < len(world.stages):
            ns = world.stages[nidx]
            next_brief = {
                "stage_id": ns.id,
                "title": ns.title,
                "goal": ns.goal,
                "owner_role": ns.owner_role,
                "assigned_worker_title": ns.assigned_worker_title,
                "adapted": ns.id in (adapted_ids or []),
                "adapted_reason": adapted_reason if ns.id in (adapted_ids or []) else "",
            }

    store.save()
    return {
        "recorded": entry,
        "decisions": world.decisions,
        "memory": mem_entry,
        "next_brief": next_brief,
        "antagonist_move": antagonist_move.model_dump() if antagonist_move else None,
        "choice": choice_record.model_dump(),
        "days": [d.model_dump() for d in state.days],
        "consequence": consequence,
        # The business principle this choice tested - so the commit-time receipt
        # can name the lesson (same source as the option button showed).
        "principle": principle_for_rule(consequence["rule_id"]),
        # The Game Master council that ratified this move - the engine-tier group
        # chat (World Designer + Antagonist Director + Org Designer) that locked
        # the forward motion. Rendered with the same turn shape as the standup.
        "world_council": _council_packet(state, council),
        "state": _state_dump(state),
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
    "antagonist": "The Rival",
}

_ROLE_PORTRAIT = {
    "strategist": "strategist",
    "designer": "designer",
    "marketer": "marketer",
    "ops": "ops",
    "narrator": "narrator",
    "orgdesigner": "orgdesigner",
    "founder": "founder",
    "antagonist": "villain",
}

_ROLE_TEXT_STYLE = {
    "strategist": "market posture",
    "designer": "product and experience posture",
    "marketer": "growth posture",
    "ops": "operating posture",
    "narrator": "world-state posture",
    "orgdesigner": "org-design posture",
    "founder": "CEO direction",
    "antagonist": "adversarial posture",
}

_ROLE_VOICE = {
    "strategist": "ballad",
    "designer": "coral",
    "marketer": "verse",
    "ops": "alloy",
    "narrator": "onyx",
    "orgdesigner": "sage",
    "founder": "onyx",
    "antagonist": "ash",
}

# Dan Harmon Story Circle beats, indexed by stage position (0-7). The villain is
# tied to this arc: it tests the founder hardest at TAKE (beat 6), where "the win
# has a cost and rivalry arrives," so the antagonist's voice references the beat.
_STORY_BEATS = [
    ("YOU", "your comfort zone"),
    ("NEED", "the thing you lack"),
    ("GO", "your crossing into the market"),
    ("SEARCH", "your road of trials"),
    ("FIND", "the traction you just found"),
    ("TAKE", "the price of your win"),
    ("RETURN", "your road back"),
    ("CHANGE", "the founder you have become"),
]


def _story_beat_for_state(state: CompanyState) -> Tuple[str, str]:
    """Return the (BEAT, gloss) the run is currently on, from the world index."""
    stages = (state.world.stages if state.world else [])
    idx = 0
    for i, s in enumerate(stages):
        if str(getattr(s, "status", "")).lower() != "completed":
            idx = i
            break
    else:
        idx = max(0, len(stages) - 1)
    return _STORY_BEATS[min(idx, len(_STORY_BEATS) - 1)]


def _worker_title_for_stage(stage: Optional[Stage]) -> str:
    if not stage:
        return "the next worker"
    return stage.assigned_worker_title or _ROLE_DISPLAY.get(stage.owner_role, stage.owner_role)


def _worker_field_report(state: CompanyState, stage: Optional[Stage]) -> Dict[str, Any]:
    """What the stage's worker brought back to the CEO.

    Reads the worker's REAL run record (the same invocation the card-back
    receipts render) and distills the information it actually gathered: the live
    market signal it researched (web_search), the knowledge it grounded in
    (Foundry IQ recall), and the genuine tools it called. This is the single
    source for the worker's report-back turn in the standup and the field-report
    strip on the CEO dilemma, so "the worker comes back with information" is the
    same real data everywhere - never invented.
    """
    inv = latest_invocation_for_stage(state, stage) if (state and stage) else None
    events = list(getattr(inv, "current_events", None) or []) if inv else []
    iq = list(getattr(inv, "iq_sources", None) or []) if inv else []
    tools_called = []
    seen = set()
    for entry in (getattr(inv, "tool_trace", None) or []) if inv else []:
        name = str(entry.get("tool") or "").strip()
        if name and name not in seen:
            seen.add(name)
            tools_called.append(name)
    signal = str(events[0].get("title", "")).strip() if events else ""
    source = str(iq[0]).strip() if iq else ""
    if signal:
        tool, headline = "web_search", f"live market signal - {signal[:90]}"
    elif source:
        tool, headline = "recall", f"grounded in {source[:60]}"
    else:
        tool, headline = "", ""
    return {
        "tool": tool,
        "headline": headline,
        "signal": signal,
        "source": source,
        "events": events[:3],
        "iq_sources": iq[:3],
        "tools_called": tools_called[:5],
    }


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
        "source": "simulation",
        "framework": "deterministic-standup",
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


def _record_world_council(state: CompanyState, deliberation: WorldCouncilDeliberation) -> None:
    """Persist one council deliberation into the run log (idempotent per stage).

    The latest deliberation for a stage replaces any earlier one (a live upgrade
    supersedes the deterministic pass), so the roguelike council history stays
    one-entry-per-move and bounded while remaining cumulative across the run.
    """
    if not state.game:
        return
    log = [d for d in (state.game.council_log or []) if d.stage_id != deliberation.stage_id]
    log.append(deliberation)
    state.game.council_log = log[-16:]


def _council_packet(state: CompanyState, deliberation: WorldCouncilDeliberation) -> Dict[str, Any]:
    """Render a persisted GM council deliberation in the standup turn shape.

    Reuses the standup renderer's contract (speaker profiles + character_state)
    so the Game Master group chat shows through the existing components - one
    renderer, two tiers (worker standup vs. engine council), never a fork.
    """
    turns = [{
        "speaker": t.speaker,
        "role": t.role,
        "worker_id": t.worker_id,
        "tool_call": {"tool": t.tool or "agent_turn", "status": "completed"},
        "message": t.message,
        "handoff_to": t.handoff_to,
        "source": t.source,
        "framework": t.framework,
    } for t in deliberation.turns]
    turns = _attach_speaker_profiles(turns)
    return {
        "stage_id": deliberation.stage_id,
        "tier": "game_master",
        "source": deliberation.source,
        "orchestration": {
            "pattern": "sequential_group_chat",
            "framework_target": "Microsoft Agent Framework Agent loop",
            "manager": "world_council",
            "council": ["world_designer", "antagonist", "org_designer"],
        },
        "trigger": {"label": deliberation.trigger, "summary": deliberation.summary},
        "threat": {"before": deliberation.threat_before, "after": deliberation.threat_after},
        "adapted_stage_ids": deliberation.adapted_stage_ids,
        "antagonist_move_id": deliberation.antagonist_move_id,
        "forward_motion": deliberation.forward_motion,
        "characters": [t.get("character_state") for t in turns if t.get("character_state")],
        "turns": turns,
    }


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

    # The owning worker reports back to the CEO with what it actually found in
    # the field (real research receipts), referencing the real tool it used.
    report = _worker_field_report(state, stage)
    owner_tool = report["tool"] or "calculate_consequence"
    if report["signal"]:
        brought = f"a live signal from the field - {report['signal'][:80]}"
    elif report["source"]:
        brought = f"work grounded in {report['source'][:60]}"
    else:
        brought = ""
    if brought:
        owner_message = (
            f"Field report: I brought {brought}. "
            f"Reading the CEO call as '{option}': {summary} "
            f"{next_title if next_stage else 'CEO'}, name the constraint you will carry instead of resetting."
        )
    else:
        owner_message = (
            f"I read the CEO call as '{option}': {summary} "
            f"{next_title if next_stage else 'CEO'}, which constraint are you carrying instead of resetting?"
        )

    turns: List[Dict[str, Any]] = [
        _standup_turn(
            speaker=owner_title,
            role=stage.owner_role,
            worker_id=stage.assigned_worker_id or stage.owner_role,
            tool=owner_tool,
            message=owner_message,
            handoff_to=next_title if next_stage else "",
        )
    ]

    next_goal = (getattr(next_stage, "goal", "") or "the next stage brief") if next_stage else "the continuation loop"
    next_metric = (getattr(next_stage, "success_metric", "") or "the next success metric") if next_stage else "the next operating metric"
    world_update = {
        "owner": "World Designer",
        "tool": "adapt_remaining_stages",
        "message": (
            f"Pending stages were adapted from that choice. Next beat: {next_title}. "
            f"Its brief now starts from: {next_goal[:150]} Success now means: {next_metric[:150]}"
        ),
    }

    added_title = org_delta.get("added_role_title")
    removed_title = org_delta.get("removed_role_title")
    org_update: Dict[str, Any] = {"owner": "Org Designer", "tool": "render_org_graph", "message": ""}
    if added_title or removed_title:
        org_line = []
        if added_title:
            org_line.append(f"added {added_title} as a capability, not another copy of the same speaker")
        if removed_title:
            org_line.append(f"retired {removed_title} so the org stays focused")
        org_update["message"] = (
            f"Workforce changed: {'; '.join(org_line)}. "
            f"The next worker still owns execution, but the org now remembers what capacity changed and why."
        )

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
        share = float(getattr(state.economics, "market_share", 0.0) or 0.0)
        customers = int(getattr(state.economics, "paying_customers", 0) or 0)
        rev = int(getattr(state.economics, "monthly_revenue_usd", 0) or 0)
        if customers > 0:
            money_line = f"{customers} paying customers at {share:.1f}% share = ${rev:,}/mo revenue, "
        else:
            money_line = "zero paying customers yet - no revenue until we win share, "
        turns.append(_standup_turn(
            speaker="Runway Steward",
            role="ops",
            worker_id="runway_steward",
            tool="watch_burn",
            message=(
                f"Numbers moved: {money_line}{state.economics.digital_worker_count} workers, "
                f"${state.economics.monthly_burn_usd:,}/mo burn, {state.economics.runway_months} months runway. "
                f"{owner_title}, I back the plan only if the next artifact wins customers faster than it burns."
            ),
            handoff_to=next_title if next_stage else "",
        ))

    # Rival pressure is tracked separately from the worker stand-up. The rival
    # is not in the team's meeting and does not hear private CEO strategy; the
    # workers may discuss how to counter it, but antagonist speech belongs to
    # rival announcements or the Game Master council tier.
    arc = state.game.antagonist_arc if state.game else None

    context = {
        "stage_id": stage.id,
        "next_stage_id": next_stage.id if next_stage else "",
        "next_worker_title": next_title if next_stage else "",
        "rule_id": rule_id,
        "summary": summary,
        "antagonist_threat": (arc.threat_level if arc else 0),
        "antagonist_stage": (arc.escalation_stage if arc else "watching"),
        "story_beat": _story_beat_for_state(state)[0],
        "world_update": world_update,
        "org_update": org_update if org_update.get("message") else {},
    }
    return turns[:5], context


def _rival_pressure_context(state: CompanyState) -> Dict[str, Any]:
    """Public rival pressure snapshot for stand-up receipts, not a speaker turn."""
    arc = state.game.antagonist_arc if state.game else None
    if not arc:
        return {"present": False}
    latest = (arc.moves or [])[-1] if arc.moves else None
    return {
        "present": bool(arc.current_pressure or arc.antagonist_name),
        "name": arc.antagonist_name or "The rival",
        "threat_level": arc.threat_level,
        "escalation_stage": arc.escalation_stage or "watching",
        "current_pressure": arc.current_pressure,
        "latest_move_id": getattr(latest, "id", "") if latest else "",
        "latest_move_title": getattr(latest, "title", "") if latest else "",
        "counterplay": (arc.open_counterplays[-1] if arc.open_counterplays else ""),
        "visibility": "tracked as market pressure outside the workforce stand-up",
    }


# CEO directive intents - lets the offline standup actually REACT to what the
# CEO said (its meaning), not echo a fixed template. Defined just above its
# only callers in the history-based standup builder.
_DIRECTIVE_INTENTS: List[Tuple[str, Tuple[str, ...]]] = [
    ("dominance", ("dominate", "competit", "rival", "beat", "crush", "outpace", "overtake", "market leader", "win the market")),
    ("hiring", ("hire", "headcount", "recruit", "staff", "talent", "bring on", "new worker", "add a worker", "add a seat")),
    ("runway", ("cost", "runway", "burn", "save", "cheap", "efficien", "budget", "lean", "cash", "spend")),
    ("retention", ("loyal", "retain", "retention", "churn", "keep", "stick", "renew", "nps", "relationship")),
    ("proof", ("proof", "quality", "validate", "evidence", "credib", "trust", "reliab", "rigor")),
    ("speed", ("fast", "speed", "quick", "ship", "velocity", "accelerat", "urgent", "rapid", "move fast")),
    ("focus", ("focus", "narrow", "simplify", "cut scope", "prioriti")),
    # Acquisition last: its keys ("customer", "grow", "user") are generic and
    # appear inside other directives ("build loyalty with our customers"), so the
    # specific intents above win first.
    ("acquisition", ("customer", "acqui", "grow", "growth", "sales", "lead", "user", "signup", "sign up", "demand", "pipeline", "traction", "market share")),
]


def _classify_ceo_directive(text: str) -> str:
    """Classify the CEO's free-text standup directive into an intent key so the
    offline workers can react to its MEANING, not echo it verbatim."""
    t = (text or "").lower()
    for intent, keys in _DIRECTIVE_INTENTS:
        if any(k in t for k in keys):
            return intent
    return "general"


def _standup_directive_reaction(
    intent: str, round_index: int, *, owner_title: str, next_title: str,
    user_name: str, user_msg: str, econ: Any, rival_name: str,
) -> Tuple[str, str]:
    """Two intent-aware standup lines (owner worker, then the next worker).

    Distinct per intent and rotated by round so repeated directives never read
    identically; grounded in live economics so the numbers move with the run.
    """
    ceo = (user_msg or "").strip()[:46]
    share = round(float(getattr(econ, "market_share", 0.0) or 0.0), 1) if econ else 0.0
    burn = int(getattr(econ, "monthly_burn_usd", 0) or 0) if econ else 0
    runway = int(getattr(econ, "runway_months", 0) or 0) if econ else 0
    share_txt = f"{share}%" if share else "an early"

    owner_by_intent = {
        "acquisition": [
            f"On '{ceo}' - I'm pointing the wedge at demand, {next_title}. We hold {share_txt} share; the next artifact has to open ONE repeatable acquisition channel, not a broader story.",
            f"'{ceo}' lands, {next_title}. Keep the ICP narrow and make every new customer a referenceable proof - growth without scope creep.",
        ],
        "retention": [
            f"'{ceo}' - good. {next_title}, retention compounds: I'd rather deepen the {share_txt} we hold than thin it chasing new logos.",
            f"On loyalty, {next_title}: build the habit loop into the next artifact so churn drops before we scale spend.",
        ],
        "dominance": [
            f"'{ceo}' - aggressive, I like it. {next_title}, but we beat {rival_name} on a sharper wedge, not a wider front. {share_txt} now; let's take their flank.",
            f"To outpace {rival_name}, {next_title}: concentrate force on the one segment we can win outright before widening.",
        ],
        "speed": [
            f"'{ceo}' - speed it is. {next_title}, I'll cut the next artifact to its core so we ship this week, not scope it for a month.",
            f"Moving fast, {next_title}: take the quickest line and accept some fatigue - velocity is our edge at {share_txt} share.",
        ],
        "runway": [
            f"'{ceo}' - discipline. {next_title}, every move from here defends runway; we're at ${burn:,}/mo burn, {runway} months left.",
            f"Protecting cash, {next_title}: no new headcount until the next artifact proves it pays for itself.",
        ],
        "proof": [
            f"'{ceo}' - right call. {next_title}, the next artifact has to clear the gate clean; trust is how we hold {share_txt} under pressure.",
            f"On quality, {next_title}: one verified proof beats three unproven swings.",
        ],
        "hiring": [
            f"'{ceo}' - we can add a worker, {next_title}, but it lifts burn above ${burn:,}/mo. It only pays if it wins share faster than it costs.",
            f"On hiring, {next_title}: name the missing function - sales, retention, ops - and we add exactly that seat, not a generalist.",
        ],
        "focus": [
            f"'{ceo}' - narrowing. {next_title}, I'll cut everything that isn't the wedge and hand you one sharp artifact.",
            f"Focus accepted, {next_title}: one segment, one proof, no scope creep.",
        ],
        "general": [
            f"'{ceo}' - noted, {next_title}. I'll fold that into the next brief without widening scope, holding {share_txt} share.",
            f"{next_title}, the CEO said '{ceo}'. Let's translate it into one concrete artifact, not a theme.",
        ],
    }
    responder_by_intent = {
        "acquisition": [
            f"{owner_title}, I'll take acquisition - but I need one proof artifact to convert against first, {user_name}.",
            f"Understood, {owner_title}. I close faster on trust than on reach; give me the social proof and I'll turn '{ceo}' into booked customers.",
        ],
        "retention": [
            f"{owner_title}, I'll protect the base - but loyalty needs a proof of value, {user_name}. Tell me the retention metric I'm defending.",
            f"Agreed, {owner_title}. I'll wire an onboarding-to-renewal loop; it keeps burn flat while it lifts NPS.",
        ],
        "dominance": [
            f"{owner_title}, I'll push hard - give me one undeniable proof artifact and I'll take share from {rival_name}, {user_name}.",
            f"On it, {owner_title}. Domination is a counter-position, not a feature race - I need the differentiator locked first.",
        ],
        "speed": [
            f"{owner_title}, I'll move - but fast still needs a proof gate or we ship noise, {user_name}.",
            f"Got it, {owner_title}. I'll trade polish for tempo and let the gate catch what matters.",
        ],
        "runway": [
            f"{owner_title}, lean works for me - but I need proof the cheap path still wins share, {user_name}.",
            f"Understood, {owner_title}. I'll optimize the loop the workforce already runs before we spend a dollar more.",
        ],
        "proof": [
            f"{owner_title}, I'll raise the bar - tell me the metric the gate scores and I'll hit it, {user_name}.",
            f"Agreed, {owner_title}. A proof artifact is exactly what converts AND what answers {rival_name}.",
        ],
        "hiring": [
            f"{owner_title}, a new hire needs a mandate and a proof target on day one, or it's pure burn, {user_name}.",
            f"Understood, {owner_title}. I'll scope the role to the gap the current party can't close - and watch the runway.",
        ],
        "focus": [
            f"{owner_title}, narrow is good - name the one metric we're optimizing and I'll defend it, {user_name}.",
            f"On it, {owner_title}. Less surface, more depth - that's how we hold share.",
        ],
        "general": [
            f"{owner_title}, I accept the direction - but I need one proof artifact before I take it into my room, {user_name}.",
            f"Understood, {owner_title}. I'll turn '{ceo}' into something the gate can score.",
        ],
    }
    owners = owner_by_intent.get(intent, owner_by_intent["general"])
    responders = responder_by_intent.get(intent, responder_by_intent["general"])
    return owners[round_index % len(owners)], responders[round_index % len(responders)]


# The rival's standup voice is sourced from the EVOLVING arc - its current
# escalation stage, the latest move's target metric, the open counterplay, and
# the live threat - NOT a fixed signature tactic (which made every taunt read
# identically, round after round). Rotating the skeleton by round means even an
# unchanged threat reads fresh. One helper, used by BOTH standup builders:
# single source for the villain's voice (no duplicated taunt code).
_RIVAL_STAGE_ACTION = {
    "watching": "circling your market for the opening",
    "probing": "probing where your proof is thinnest",
    "contesting": "contesting every account you touch",
    "crisis": "in open war - undercutting price and poaching while you stall",
    "endgame": "at the gates; one unanswered move and the market is mine",
}
_RIVAL_METRIC_JAB = {
    "proof": "your proof is thin and I can see it",
    "trust": "your customers do not trust you yet",
    "velocity": "you are too slow to hold this",
    "burn_pressure": "your costs are the crack I widen",
    "autonomy": "lose control and the market is mine",
}
# How the CEO's chosen lever looks from the rival's side (follow-up rounds only).
_RIVAL_INTENT_JAB = {
    "acquisition": "chasing customers while I lock them in",
    "dominance": "trying to dominate me - I move first",
    "retention": "loyalty will not hold them once I move",
    "speed": "rushing into the mistakes I exploit",
    "runway": "pinching pennies just slows you",
    "proof": "polishing proof while I take the market",
    "hiring": "growing your burn, not your moat",
    "focus": "narrowing - leaving the rest of the board to me",
}


def _rival_standup_line(
    state: CompanyState, *, round_index: int = 0, ceo_line: str = "", intent: str = "",
) -> Optional[str]:
    """The villain's standup line, built from LIVE arc state. None = stay silent.

    Cites the rival's current escalation stage, what its latest move is
    attacking, the live threat, and the counterplay to use - all of which evolve
    as the run progresses - so the taunt advances the story instead of repeating
    a fixed tactic. The skeleton rotates by round so repeats never read the same.
    """
    arc = state.game.antagonist_arc if state.game else None
    if not arc or arc.threat_level < 20 or not (arc.current_pressure or arc.antagonist_name):
        return None
    beat, beat_gloss = _story_beat_for_state(state)
    stage_name = arc.escalation_stage or "probing"
    action = _RIVAL_STAGE_ACTION.get(stage_name, "pressing my advantage")
    moves = [m for m in (arc.moves or []) if not getattr(m, "resolved", False)]
    latest = moves[-1] if moves else ((arc.moves or [])[-1] if arc.moves else None)
    metric = getattr(latest, "target_metric", "") if latest else ""
    rival_role = getattr(latest, "rival_role_title", "") if latest else ""
    rival_lane = getattr(latest, "rival_pressure_lane", "") if latest else ""
    role_clause = f"{rival_role} on {rival_lane}: " if rival_role and rival_lane else (f"{rival_role}: " if rival_role else "")
    jab = _RIVAL_INTENT_JAB.get(intent) or _RIVAL_METRIC_JAB.get(metric) \
        or "the market does not wait for your standup"
    counter = (arc.open_counterplays[-1] if arc.open_counterplays
               else "answer me before your next gate").rstrip(".").lower()
    jab_cap = jab[:1].upper() + jab[1:]  # capitalize first letter only (keep 'I')
    n = arc.threat_level
    ceo = (ceo_line or "").strip()[:46]
    ceo_clause = f"'{ceo}' - " if ceo else ""
    skeletons = [
        f"[{beat}] {role_clause}{ceo_clause}I am {action}. Threat {n}/100, {stage_name}. {jab_cap}.",
        f"[{beat}] {role_clause}While you weigh {beat_gloss}, I am {action}. {n}/100 and {stage_name} - counter me ({counter}) or cede it.",
        f"[{beat}] {role_clause}{jab_cap}. I am {action}. Threat {n}/100, {stage_name}.",
        f"[{beat}] {role_clause}I am {action} while you talk. {n}/100, {stage_name}. {ceo_clause}it will not hold.",
    ]
    return skeletons[round_index % len(skeletons)]


# Which archetype seat actually OWNS each business lever. This is the answer
# to "who brings in the money": the growth/marketer seat owns customers and
# revenue, ops owns runway and retention, designer owns build/speed. When the
# CEO pushes a lever, that worker - not whoever happens to own the current
# stage - speaks first and names the money.
_LEVER_OWNER_ROLE = {
    "acquisition": "marketer",
    "dominance": "marketer",
    "retention": "ops",
    "runway": "ops",
    "hiring": "ops",
    "speed": "designer",
    "proof": "designer",
}


def _worker_for_role(state: CompanyState, role: str) -> Tuple[str, str, str]:
    """Return (title, role, worker_id) for the worker who owns an archetype role.

    Reuses the title already bound to a stage of that archetype so the standup
    names the same worker the org graph shows; falls back to the display name."""
    world = getattr(state, "world", None)
    for s in (world.stages if world else []):
        if (s.owner_role or "") == role:
            return (s.assigned_worker_title or _ROLE_DISPLAY.get(role, role),
                    role, s.assigned_worker_id or role)
    return (_ROLE_DISPLAY.get(role, role.title()), role, role)


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

    next_title = _worker_title_for_stage(next_stage)
    next_role = next_stage.owner_role if next_stage else "narrator"

    # React to WHAT the CEO actually said, not a fixed template. The directive
    # is classified into an intent; each worker answers in a distinct, role- and
    # economics-aware voice, and the line rotates by round so repeated rounds
    # never read identically. This is the seam that makes the standup adapt.
    intent = _classify_ceo_directive(user_msg)
    round_index = sum(
        1 for t in history
        if t.get("role") == "founder" or t.get("worker_id") == "founder"
    )
    econ = state.economics

    # Route the directive to the worker who actually OWNS that lever, so the
    # revenue/customer owner self-identifies instead of whoever holds the
    # current stage. This makes "who makes the money" visible on screen.
    lever_role = _LEVER_OWNER_ROLE.get(intent)
    if lever_role:
        owner_title, first_role, first_wid = _worker_for_role(state, lever_role)
    else:
        owner_title = _worker_title_for_stage(stage)
        first_role = stage.owner_role
        first_wid = stage.assigned_worker_id or stage.owner_role

    rival_name = (state.game.antagonist_arc.antagonist_name
                  if state.game and state.game.antagonist_arc else None) \
        or (state.antagonist.name if state.antagonist else "the rival")
    owner_msg, responder_msg = _standup_directive_reaction(
        intent, round_index,
        owner_title=owner_title, next_title=next_title,
        user_name=user_name, user_msg=user_msg, econ=econ, rival_name=rival_name,
    )

    # For customer/revenue levers, prepend an explicit ownership clause naming
    # the share->revenue this seat is accountable for - the on-screen answer to
    # "how am I making money and who is responsible for it".
    if intent in ("acquisition", "dominance", "retention"):
        share = round(float(getattr(econ, "market_share", 0.0) or 0.0), 1) if econ else 0.0
        rev = int(getattr(econ, "monthly_revenue_usd", 0) or 0) if econ else 0
        held = (f"we hold {share}% share = ${rev:,}/mo recurring"
                if share > 0 else "we hold no market yet, so this is where revenue starts")
        owner_msg = (f"I'm the seat that turns work into paying customers - {held}. "
                     + owner_msg)

    # Offline simulated turns reacting to history:
    turns = [
        _standup_turn(
            speaker=owner_title,
            role=first_role,
            worker_id=first_wid,
            tool="read_memory",
            message=owner_msg,
            handoff_to=next_title if next_stage else "",
        ),
        _standup_turn(
            speaker=next_title,
            role=next_role,
            worker_id=(next_stage.assigned_worker_id if next_stage else "narrator") or next_role,
            tool="read_memory",
            message=responder_msg,
            handoff_to="runway_steward",
        ),
    ]

    consequence = decision.get("consequence") or {}
    summary = consequence.get("summary") or "The CEO choice is now binding direction."
    # Keep the rival OUT of the workforce room. Follow-up rounds are the team
    # translating CEO direction into work; rival pressure remains separate
    # state/metadata and counterplay, not a participant hearing private plans.
    arc = state.game.antagonist_arc if state.game else None
    context = {
        "stage_id": stage.id,
        "next_stage_id": next_stage.id if next_stage else "",
        "next_worker_title": next_title if next_stage else "",
        "rule_id": consequence.get("rule_id") or decision.get("rule_id") or "decision.custom",
        "summary": f"Looping feedback: '{user_msg[:60]}'. " + summary,
        "antagonist_threat": (arc.threat_level if arc else 0),
        "story_beat": _story_beat_for_state(state)[0],
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
            {"tool": "adapt_remaining_stages", "owner": "World Designer"},
            {"tool": "render_org_graph", "owner": "Org Designer"},
            {"tool": "read_memory", "owner": context.get("next_worker_title") or "next worker"},
            {"tool": "watch_burn", "owner": "Runway Steward"},
        ],
        "world_update": context.get("world_update") or {},
        "org_update": context.get("org_update") or {},
        "rival_pressure": _rival_pressure_context(state),
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
            "world_update": packet["world_update"],
            "org_update": packet["org_update"],
            "rival_pressure": packet["rival_pressure"],
            "turns": turns,
        },
    )
    store.save()
    return packet


class WorldCouncilRequest(BaseModel):
    stage_id: Optional[str] = None


@app.post("/api/world/council")
def world_council(payload: WorldCouncilRequest):
    """Convene the Game Master council and (in live mode) upgrade it to MAF.

    The engine-tier counterpart to /api/world/standup. The deterministic council
    already ran inside /api/decision and persisted to state.game.council_log;
    this endpoint re-runs the same deliberation over the facts that move already
    produced - the antagonist move (resolved from the arc, never recomputed) and
    the stage ids the World Designer bent - and in live mode rephrases the GM
    turns through the Microsoft Agent Framework group chat. Returns the
    standup-shaped packet so the existing renderer shows it. Never re-mutates
    the world.
    """
    state = store.load()
    if not state or not state.world:
        raise HTTPException(status_code=400, detail="No world graph.")
    world = state.world
    if not world.decisions:
        raise HTTPException(status_code=400, detail="No move to ratify yet.")
    decision = None
    if payload.stage_id:
        decision = next((d for d in reversed(world.decisions) if d.get("stage_id") == payload.stage_id), None)
    decision = decision or world.decisions[-1]
    stage = next((s for s in world.stages if s.id == decision.get("stage_id")), None)
    if not stage:
        raise HTTPException(status_code=404, detail=f"Unknown stage: {decision.get('stage_id')}")

    arc = state.game.antagonist_arc if state.game else None
    prior = next((d for d in (state.game.council_log or []) if d.stage_id == stage.id), None) if state.game else None
    adapted_ids = list(prior.adapted_stage_ids) if prior else []
    threat_before = prior.threat_before if prior else None
    move = None
    if prior and arc and prior.antagonist_move_id:
        move = next((m for m in (arc.moves or []) if m.id == prior.antagonist_move_id), None)
    if move is None and arc:
        stage_moves = [m for m in (arc.moves or []) if m.stage_id == stage.id]
        move = stage_moves[-1] if stage_moves else None
    worker_report = _worker_field_report(state, stage)

    council = convene_world_council(
        state, stage=stage, decision=decision, antagonist_move=move,
        adapted_stage_ids=adapted_ids, worker_report=worker_report,
        threat_before=threat_before, live=is_live())
    _record_world_council(state, council)
    store.log_event("WORLD_COUNCIL", "world_council",
        f"Game Master council convened for '{stage.title}' ({council.source}).",
        {"stage_id": stage.id, "source": council.source,
         "forward_motion": council.forward_motion,
         "turns": [t.model_dump() for t in council.turns]})
    store.save()
    return _council_packet(state, council)


class StandupResponseRequest(BaseModel):
    text: str
    stage_id: Optional[str] = None
    form_data: Optional[Dict[str, Any]] = None
    source: Optional[str] = None
    client_trace_id: Optional[str] = None


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
    form_data = payload.form_data or {}
    trace_id = _client_trace_id(payload.client_trace_id)
    stage = None
    if state.world:
        if payload.stage_id:
            stage = next((s for s in state.world.stages if s.id == payload.stage_id), None)
        if not stage and state.world.decisions:
            last_stage_id = state.world.decisions[-1].get("stage_id")
            stage = next((s for s in state.world.stages if s.id == last_stage_id), None)

    mem_entry = remember_for_run(state, "procedural", f"CEO responded to standup: '{text}'", {
        "source": payload.source or "standup_response",
        "stage_id": getattr(stage, "id", "") or "",
        "form_data": form_data,
        "client_trace_id": trace_id,
    })
    adapted_ids: List[str] = []
    adapted_preview: Optional[Dict[str, Any]] = None
    if state.world and stage:
        synthetic_decisions = list(state.world.decisions or []) + [{
            "stage_id": stage.id,
            "option": text,
            "tradeoff": "live standup response",
            "consequence_summary": "CEO standup direction captured for the World Designer.",
            "custom": bool(form_data),
            "payload": form_data,
        }]
        worker_report = _worker_field_report(state, stage)
        adapted_ids = adapt_remaining_stages(
            state.world,
            stage.id,
            _live_world_state(state),
            decisions=synthetic_decisions,
            brief=state.world.brief,
            worker_report=worker_report,
        )
        if adapted_ids:
            next_stage = next((s for s in state.world.stages if s.id == adapted_ids[0]), None)
            if next_stage:
                adapted_preview = {
                    "stage_id": next_stage.id,
                    "title": next_stage.title,
                    "goal": next_stage.goal,
                    "success_metric": next_stage.success_metric,
                    "assigned_worker_title": next_stage.assigned_worker_title,
                }
    store.log_event("CEO_STANDUP_RESPONSE", "founder", f"CEO responded to standup: {text}", {
        "client_trace_id": trace_id,
        "text": text,
        "form_data": form_data,
        "memory_injected": mem_entry,
        "memory_origin": mem_entry.get("origin", "") if mem_entry else "",
        "stage_id": getattr(stage, "id", "") or "",
        "adapted_stage_ids": adapted_ids,
    })
    player_move = None
    if state.game:
        player_move = PlayerMove(
            id=f"move_ceo_{int(time.time() * 1000)}_{len(state.game.move_log) + 1}",
            turn_index=state.game.turn_index,
            day_index=state.game.day_index,
            stage_id=getattr(stage, "id", "") or "",
            move_type="ceo_command",
            summary=f"CEO briefed the workforce: {text[:140]}",
            effects_applied={
                "client_trace_id": trace_id,
                "text": text,
                "form_data": form_data,
                "adapted_stage_ids": adapted_ids,
                "source": payload.source or "standup_response",
                "memory_origin": mem_entry.get("origin", "") if mem_entry else "",
            },
        )
        state.game.move_log.append(player_move)
        player_move_payload = player_move.model_dump()
        player_move_payload["client_trace_id"] = trace_id
        player_move_payload["memory_origin"] = mem_entry.get("origin", "") if mem_entry else ""
        store.log_event("PLAYER_MOVE", "founder", player_move.summary, player_move_payload)
    if adapted_ids:
        store.log_event("WORLD_ADAPTED", "world_designer",
            f"World Designer bent {len(adapted_ids)} pending stage(s) to the live CEO standup response.",
            {"client_trace_id": trace_id, "stage_ids": adapted_ids, "after": getattr(stage, "id", "") or "", "standup_response": text[:160], "form_data": form_data})
    if state.game:
        refresh_session_knowledge(state)
        store.log_event(
            "KNOWLEDGE_STRUCTURED", "iq_sync",
            f"Structured {len(state.knowledge_records)} generated Search document(s) after CEO command.",
            {
                "client_trace_id": trace_id,
                "move_id": player_move.id if player_move else "",
                "move_type": "ceo_command",
                "sync_target": "generated SearchDocument cache for Foundry IQ / Azure AI Search sync",
                "kinds": sorted({doc.kind for doc in state.knowledge_records}),
            },
        )
    store.save()
    return {
        "status": "success",
        "message": "Memory updated with response.",
        "client_trace_id": trace_id,
        "player_move": player_move.model_dump() if player_move else None,
        "adapted_stage_ids": adapted_ids,
        "adapted_next_stage": adapted_preview,
        "state": _state_dump(state),
    }


def _live_world_state(state) -> Dict[str, Any]:
    """The current world model fed to each worker brief.

    Reuses the same snapshot shape as the decision receipts (single source of
    truth) and adds the antagonist's live threat level so the worker reasons
    against the whole evolving situation, not just the original pitch.
    """
    ws = world_snapshot(state)
    run_id = getattr(state, "run_id", "") or getattr(getattr(state, "game", None), "run_id", "")
    if run_id:
        ws["run_id"] = run_id
    arc = getattr(state.game, "antagonist_arc", None) if state.game else None
    if arc is not None:
        ws["antagonist_threat"] = int(getattr(arc, "threat_level", 0) or 0)
    return ws


class RunNextRequest(BaseModel):
    client_trace_id: Optional[str] = None
    command_text: Optional[str] = None


@app.post("/api/world/run-next")
def run_next_stage(payload: Optional[RunNextRequest] = Body(default=None)):
    """Execute the next pending stage via the Worker Factory."""
    state = store.load()
    if not state or not state.world:
        raise HTTPException(status_code=400, detail="No world graph. Call /api/world/design first.")
    _reconcile_loaded_game(state)
    try:
        ensure_active_run(state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    world = state.world
    pending = [s for s in world.stages if s.status not in ("completed", "needs-review")]
    if not pending:
        raise HTTPException(status_code=400, detail="All stages completed or awaiting review.")

    stage = pending[0]
    idx = world.stages.index(stage)
    world.current_stage_index = idx
    trace_id = _client_trace_id(payload.client_trace_id if payload else "")
    command_text = str(payload.command_text or "").strip() if payload else ""
    if state.game:
        for move in reversed(state.game.move_log):
            if move.move_type != "ceo_command":
                continue
            move_trace = str((move.effects_applied or {}).get("client_trace_id") or "")
            if trace_id and move_trace != trace_id:
                continue
            command_text = command_text or str((move.effects_applied or {}).get("text") or move.summary or "")
            trace_id = trace_id or move_trace
            break
    try:
        start_player_turn(state, stage_id=stage.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Foundry IQ memory recalled for this stage (surfaced to the story view).
    memory = retrieve(f"{world.brief} {stage.goal} {stage.success_metric}", top_k=2)

    previous_artifacts = [s.artifact for s in world.stages[:idx] if s.artifact]
    invocation, artifact, score = execute_stage(
        stage, world.brief, previous_artifacts, org=state.org,
        decisions=world.decisions, world_state=_live_world_state(state))
    world.invocations.append(invocation)

    if artifact:
        stage.artifact = artifact
        stage.validation_score = score
    stage.status = "completed" if score >= 80 else "needs-review"
    world.stages[idx] = stage
    state.world = world
    levelups = record_stage_encounter(state, stage)
    for ev in levelups:
        store.log_event(
            "WORKER_LEVEL_UP", ev.get("worker_id", "worker"),
            f"{ev.get('title', 'A worker')} reached level {ev.get('level')}"
            + (f" and unlocked {ev.get('unlocked_tool')}" if ev.get("unlocked_tool") else "")
            + ".",
            ev,
        )

    if state.economics is None:
        state.economics = initialize_economics_from_org(state.org)

    # Single source of truth for what a shipped stage does to the economy:
    # earned market share (weighted by role, contested by the antagonist) ->
    # revenue -> one-time deal cash + recomputed runway. See consequences.py.
    outcome = apply_stage_outcome(state, stage, score)

    xp_earned = 10 + (score // 10)
    state.xp += xp_earned
    if state.xp >= 50 and state.level < 2:
        state.level = 2
    elif state.xp >= 100 and state.level < 3:
        state.level = 3

    # Keep the store's authoritative pointer on the fully mutated object before
    # replay logging, because log_event saves immediately.
    world.stages[idx] = stage
    state.world = world
    store.state = state

    store.log_event("STAGE_EXECUTED", invocation.role,
        f"Stage '{stage.title}' -> score {score}, +{xp_earned} XP ({invocation.deployment}, {invocation.latency_s}s)",
        {"client_trace_id": trace_id,
         "briefed_command": command_text[:220],
         "stage_id": stage.id, "score": score, "xp_earned": xp_earned, "latency_s": invocation.latency_s,
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
        reconcile_run_status(state)
        store.log_event("WORLD_COMPLETED", "system", "All stages completed! Venture stage: launched.")

    refresh_session_knowledge(state)
    store.log_event(
        "KNOWLEDGE_STRUCTURED", "iq_sync",
        f"Structured {len(state.knowledge_records)} generated Search document(s) after stage execution.",
        {
            "client_trace_id": trace_id,
            "stage_id": stage.id,
            "sync_target": "generated SearchDocument cache for Foundry IQ / Azure AI Search sync",
            "kinds": sorted({doc.kind for doc in state.knowledge_records}),
        },
    )
    store.save()
    return stage_response(
        state,
        stage,
        invocation,
        memory=memory,
        # What shipping this stage did to the market and the books (single
        # source: apply_stage_outcome) - the UI shows share won, not a flat XP.
        stage_outcome=outcome,
        # The most recent CEO decision the worker was briefed with - the UI
        # name-checks it so the player hears their own words come back.
        recalled_decision=world.decisions[-1] if world.decisions else None,
        command_trace={
            "client_trace_id": trace_id,
            "text": command_text[:220],
            "stage_id": stage.id,
        },
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
    mem_entry = remember_for_run(state, "user_profile", f"Founder is building: {company_name} - {brief[:280]}",
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
    for stage, invocation, artifact, score in run_world(
        world, brief, auto_approve_threshold=threshold, org=state.org,
        world_state=_live_world_state(state),
    ):
        levelups = record_stage_encounter(state, stage)
        for ev in levelups:
            store.log_event(
                "WORKER_LEVEL_UP", ev.get("worker_id", "worker"),
                f"{ev.get('title', 'A worker')} reached level {ev.get('level')}"
                + (f" and unlocked {ev.get('unlocked_tool')}" if ev.get("unlocked_tool") else "")
                + ".",
                ev,
            )

        if state.economics is None:
            state.economics = initialize_economics_from_org(state.org)

        # Same single-source stage economics as /api/world/run-next.
        apply_stage_outcome(state, stage, score)

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


@app.get("/api/slots")
def list_save_slots():
    """List every saved run the player can resume, newest activity first.

    Each run persists as its own slot (mirrored on every save), so the picker
    is a library of companies/products - not a single overwritten autosave.
    """
    active = store.load()
    active_run_id = (getattr(active, "run_id", "") or "") if active else ""
    return {"slots": store.list_slots(), "active_run_id": active_run_id}


class SlotRequest(BaseModel):
    run_id: str


@app.post("/api/slots/save")
def save_save_slot():
    """Snapshot the active run into its slot now (assigns a run_id if missing).

    Auto-save already mirrors every save into the slot; this is the explicit
    hook for legacy runs created before slots existed, or a manual checkpoint.
    """
    state = store.load()
    if not state or not state.world:
        raise HTTPException(status_code=400, detail="No active run to save.")
    ensure_run_id(state)
    store.save()
    return {"saved": True, "run_id": state.run_id, "slots": store.list_slots()}


@app.post("/api/slots/load")
def load_save_slot(payload: SlotRequest):
    """Make a saved slot the active run and return its full state to the UI."""
    state = store.load_slot(payload.run_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Unknown save slot: {payload.run_id}")
    _reconcile_loaded_game(state)
    if state.economics and state.org:
        _advance_clock(state)
    store.log_event("RUN_RESUMED", "founder",
                    f"Loaded saved run '{state.name}' ({state.run_id}).",
                    {"run_id": state.run_id})
    return state_response(state)


@app.post("/api/slots/delete")
def delete_save_slot(payload: SlotRequest):
    """Permanently remove a saved run from the library."""
    removed = store.delete_slot(payload.run_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Unknown save slot: {payload.run_id}")
    return {"deleted": True, "run_id": payload.run_id, "slots": store.list_slots()}


@app.post("/api/reset")
def reset_game():
    """Reset the active working run while preserving saved slots and memory.

    Multi-run aware: the active run was already mirrored into its save slot, so
    clearing the live file starts a fresh company WITHOUT losing the prior one -
    the player can resume it later from the slot picker. The memory ledger is
    preserved because saved runs use it when resumed.
    """
    if os.path.exists(STATE_FILE):
        try:
            os.remove(STATE_FILE)
        except Exception:
            pass
    store.state = None
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
