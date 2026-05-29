import json
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field


class CharacterState(BaseModel):
    name: str
    role: str
    personality: str
    status: str = "idle"  # idle, working, completed, failed
    skills: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# World graph: the richer structure produced by WorldDesigner.
# ---------------------------------------------------------------------------

class Chapter(BaseModel):
    """A chapter in the venture world graph."""
    id: str
    title: str
    goal: str
    owner_role: str  # strategist | designer | marketer | ops
    success_metric: str = ""
    depends_on: List[str] = Field(default_factory=list)  # chapter IDs
    suggested_tools: List[str] = Field(default_factory=list)
    status: str = "not-started"  # not-started, in-progress, completed, failed
    artifact: Optional[Dict[str, Any]] = None
    validation_score: Optional[int] = None


class WorkerInvocation(BaseModel):
    """Record of a worker being spawned by the factory."""
    id: str
    chapter_id: str
    role: str
    deployment: str = ""
    started_at: float = 0.0
    completed_at: float = 0.0
    status: str = "pending"  # pending, running, completed, failed
    tokens_in: int = 0
    tokens_out: int = 0
    latency_s: float = 0.0
    error: Optional[str] = None


class WorldGraph(BaseModel):
    """Full venture world produced by the WorldDesigner."""
    brief: str = ""
    chapters: List[Chapter] = Field(default_factory=list)
    invocations: List[WorkerInvocation] = Field(default_factory=list)
    current_chapter_index: int = 0
    status: str = "not-started"  # not-started, active, completed

class QuestStep(BaseModel):
    id: str
    title: str
    description: str
    assigned_to: str  # Agent role
    status: str = "not-started"  # not-started, in-progress, completed, failed
    artifact_type: str  # doc, url, email, etc.
    artifact_data: Optional[Dict[str, Any]] = None
    validation_results: Optional[Dict[str, Any]] = None
    xp_reward: int = 10

class QuestState(BaseModel):
    id: str
    title: str
    description: str
    status: str = "not-started"  # not-started, active, completed
    steps: List[QuestStep] = Field(default_factory=list)
    current_step_index: int = 0

class CompanyState(BaseModel):
    name: str
    description: str
    pitch: str
    stage: str = "idea"  # idea, validated, launched
    xp: int = 0
    level: int = 1
    active_quest: Optional[QuestState] = None
    world: Optional[WorldGraph] = None
    agents: Dict[str, CharacterState] = Field(default_factory=dict)
    business_flags: Dict[str, bool] = Field(default_factory=dict)
    streak: int = 0
    replay_log: List[Dict[str, Any]] = Field(default_factory=list)

class StateStore:
    def __init__(self, filepath: Optional[str] = None):
        self.filepath = filepath
        self.state: Optional[CompanyState] = None

    def initialize_new_company(self, name: str, pitch: str, description: str = "") -> CompanyState:
        self.state = CompanyState(
            name=name,
            description=description,
            pitch=pitch,
            agents={
                "strategist": CharacterState(
                    name="Soren",
                    role="Strategist",
                    personality="Analytical, structured, lean startup advocate",
                    skills=["positioning", "icp", "market_sizing"]
                ),
                "designer": CharacterState(
                    name="Dahlia",
                    role="Designer",
                    personality="Visual, user-obsessed, detail-oriented",
                    skills=["landing_page", "ux_flows"]
                ),
                "marketer": CharacterState(
                    name="Maddox",
                    role="Marketer",
                    personality="Persuasive, conversion-driven, copywriter",
                    skills=["email_campaign", "copywriting"]
                )
            }
        )
        self.save()
        return self.state

    def load(self) -> Optional[CompanyState]:
        if not self.filepath:
            return self.state
        try:
            with open(self.filepath, 'r') as f:
                data = json.load(f)
                self.state = CompanyState(**data)
                return self.state
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def save(self) -> None:
        if self.filepath and self.state:
            with open(self.filepath, 'w') as f:
                json.dump(self.state.model_dump(), f, indent=2)

    def log_event(self, event_type: str, actor: str, message: str, payload: Optional[Dict[str, Any]] = None) -> None:
        if self.state:
            self.state.replay_log.append({
                "event_type": event_type,
                "actor": actor,
                "message": message,
                "payload": payload or {}
            })
            self.save()
