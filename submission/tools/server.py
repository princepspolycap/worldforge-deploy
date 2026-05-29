import os
import sys
import yaml
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# Ensure submission path is in Python path for local modular references
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from state.schema import StateStore, QuestState, QuestStep, CompanyState, WorldGraph, Chapter
from agents.foundry_agents import MasterNarrator, StrategistAgent, DesignerAgent, MarketerAgent
from agents.world_designer import design_world
from agents.worker_factory import run_world, execute_chapter
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
    except Exception as e:
        # Fallback to offline mock steps if any SDK issue occurs
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
        
    quest_state = QuestState(
        id="first_landing_page",
        title="Forge Your First Landing Page",
        description="Fulfill positioning, draft a page, and set up campaign outreach.",
        steps=[QuestStep(**s) for s in steps_data]
    )
    state.active_quest = quest_state
    store.save()
    
    store.log_event("QUEST_START", narrator.name, "Decomposed pitch into active quest-steps.", {"steps": steps_data})
    return {"initialized": True, "state": state.model_dump()}

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
    
    artifact_data: Dict[str, Any] = {}
    success = False
    val_results: Dict[str, Any] = {}
    
    pitch = state.pitch
    
    try:
        if step.assigned_to == "strategist":
            agent = StrategistAgent()
            artifact_data = agent.formulate_positioning(pitch)
            success, val_results = validate_positioning(artifact_data)
            
        elif step.assigned_to == "designer":
            agent = DesignerAgent()
            positioning = quest.steps[0].artifact_data or {}
            artifact_data = agent.build_page_structure(positioning)
            success, val_results = validate_landing_page(artifact_data)
            
        elif step.assigned_to == "marketer":
            agent = MarketerAgent()
            positioning = quest.steps[0].artifact_data or {}
            page_structure = quest.steps[1].artifact_data or {}
            artifact_data = agent.draft_launch_email(positioning, page_structure)
            success, val_results = validate_marketing_email(artifact_data)
            
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


@app.post("/api/world/design")
def design_world_endpoint(payload: AutoplayRequest):
    """Uses the WorldDesigner to produce a full venture graph."""
    brief = payload.pitch
    company_name = payload.company_name or "QuestForge Ltd."

    state = store.initialize_new_company(
        name=company_name, pitch=brief, description="A venture forged in QuestForge."
    )
    store.log_event("SESSION_START", "system", f"New world session for: {company_name}")

    chapters_data = design_world(brief)
    world = WorldGraph(
        brief=brief,
        chapters=[Chapter(**ch) if isinstance(ch, dict) else ch for ch in chapters_data],
        status="active",
    )
    state.world = world
    store.log_event("WORLD_DESIGNED", "world_designer", f"Produced {len(world.chapters)} chapters.", {
        "chapters": [{"id": ch.id, "title": ch.title, "owner_role": ch.owner_role} for ch in world.chapters]
    })
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

    previous_artifacts = [ch.artifact for ch in world.chapters[:idx] if ch.artifact]
    invocation, artifact, score = execute_chapter(chapter, world.brief, previous_artifacts)
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
        {"chapter_id": chapter.id, "score": score, "xp_earned": xp_earned, "latency_s": invocation.latency_s}
    )

    if all(ch.status == "completed" for ch in world.chapters):
        world.status = "completed"
        state.stage = "launched"
        store.log_event("WORLD_COMPLETED", "system", "All chapters completed! Venture stage: launched.")

    store.save()
    return {"state": state.model_dump(), "chapter": chapter.model_dump(), "invocation": invocation.model_dump()}


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

    chapters_data = design_world(brief)
    world = WorldGraph(
        brief=brief,
        chapters=[Chapter(**ch) if isinstance(ch, dict) else ch for ch in chapters_data],
        status="active",
    )
    state.world = world
    store.log_event("WORLD_DESIGNED", "world_designer", f"Produced {len(world.chapters)} chapters.")

    results = []
    for chapter, invocation, artifact, score in run_world(world, brief, auto_approve_threshold=threshold):
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

# Mount '/' to return index.html, static files, etc.
app.mount("/game", StaticFiles(directory=UI_DIRECTORY, html=True), name="ui")

@app.get("/")
def read_root():
    """Redirects to the UI page."""
    return FileResponse(os.path.join(UI_DIRECTORY, "index.html"))

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)
