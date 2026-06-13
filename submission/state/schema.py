import json
import os
import tempfile
import threading
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field


class CharacterState(BaseModel):
    name: str
    role: str
    personality: str
    status: str = "idle"  # idle, working, completed, failed
    skills: List[str] = Field(default_factory=list)


class FounderState(BaseModel):
    name: str = "Acolyte"
    archetype: str = "Builder"  # Builder | Seller | Designer | Operator
    skill: str = "building product"
    locale: str = "en-US"
    voice_stack: str = "core_openai"  # core_openai | azure_speech | browser
    voice: str = "onyx"  # Alloy, Echo, Fable, Onyx, Nova, Shimmer
    avatar: str = "/game/assets/generated/narrator.png"


class AntagonistState(BaseModel):
    """The competitive antagonist or villain — the antithesis of the founder's archetype.

    In the story, the antagonist represents market competition, technical challenges,
    or the skills the founder must learn to grow their business.
    """
    name: str = "Shadow Market"
    archetype: str = "Operator"  # The complementary opposite of founder's archetype
    threat_type: str = "market"  # market | technical | internal | cultural
    threat_description: str = ""
    strengths: List[str] = Field(default_factory=list)
    strategy: str = ""  # What the antagonist is doing that poses a challenge
    signature_tactic: str = ""  # The key move the antagonist uses (narrative tension point)
    target_customer_overlap: str = ""  # Where their ICP overlaps with founder's target
    motivation: str = ""  # Why this antagonist exists/competes (story depth)


class CharacterRuntimeState(BaseModel):
    """UI contract for one speaking character in a live/debate turn."""
    worker_id: str
    display_name: str
    role: str
    role_label: str = ""
    portrait_url: str = ""
    voice_stack: str = "core_openai"
    voice_id: str = ""
    locale: str = "en-US"
    text_style: str = ""
    status: str = "idle"          # idle | thinking | tool_calling | speaking | spoke | failed
    thought_state: str = ""       # visible state label, never raw hidden CoT
    current_message: str = ""
    transcript: List[Dict[str, Any]] = Field(default_factory=list)
    tool_calls: List[Dict[str, Any]] = Field(default_factory=list)
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)
    images: List[Dict[str, Any]] = Field(default_factory=list)
    diagrams: List[Dict[str, Any]] = Field(default_factory=list)
    handoff_to: str = ""
    turn_index: int = 0
    round_index: int = 0
    source: str = "simulation"
    framework: str = ""
    maf_client: str = ""


# ---------------------------------------------------------------------------
# Org blueprint: the dynamic digital workforce the OrgDesigner proposes for a
# specific company. This is the "what org structure + agents does this company
# need" reasoning step. Roles are the execution layer behind a human operator.
# ---------------------------------------------------------------------------

class OrgRole(BaseModel):
    """One seat in the company's dynamic org - usually a digital worker."""
    id: str
    title: str
    kind: str = "digital_worker"  # human | digital_worker | hybrid
    mandate: str = ""             # what this role is accountable for
    reports_to: Optional[str] = None  # parent role id (None == top of org)
    kpis: List[str] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=list)
    deployment_hint: str = ""     # which Foundry model class fits this worker
    lifecycle_stage: str = ""     # discovery|positioning|mvp|gtm|retention|ops
    seniority: str = "ic"         # lead | ic
    monthly_cost_usd: int = 0     # simple budget mechanic input
    why: str = ""                 # educational: why this role must exist


class OrgBlueprint(BaseModel):
    """The dynamic org an LLM designs for a company (from a pitch or a URL)."""
    company_summary: str = ""
    operating_model: str = ""     # how the human + digital workers split work
    roles: List[OrgRole] = Field(default_factory=list)
    # Derived stats (filled by the designer; power the simple game mechanic).
    headcount: int = 0
    digital_worker_count: int = 0
    human_count: int = 0
    monthly_burn_usd: int = 0
    leverage_ratio: float = 0.0   # digital workers per human operator
    source: str = "pitch"         # pitch | url
    source_ref: str = ""          # the originating url or pitch text
    notes: List[str] = Field(default_factory=list)


class CompanyEconomics(BaseModel):
    """Durable operating metrics that CEO decisions can move.

    The UI renders the 0-100 pressure meters, while the actual org burn stays
    as dollars on OrgBlueprint. Keeping both in state lets later worker briefs
    cite the company that now exists, not only the original pitch.
    """
    proof: int = 24
    trust: int = 38
    velocity: int = 42
    burn_pressure: int = 12
    autonomy: int = 8
    monthly_burn_usd: int = 0
    runway_months: int = 9
    digital_worker_count: int = 0
    leverage_ratio: float = 0.0


# ---------------------------------------------------------------------------
# World graph: the richer structure produced by WorldDesigner.
# ---------------------------------------------------------------------------

class Chapter(BaseModel):
    """A chapter in the venture world graph."""
    id: str
    title: str
    goal: str
    owner_role: str  # strategist | designer | marketer | ops (artifact archetype)
    success_metric: str = ""
    depends_on: List[str] = Field(default_factory=list)  # chapter IDs
    suggested_tools: List[str] = Field(default_factory=list)
    status: str = "not-started"  # not-started, in-progress, completed, failed
    artifact: Optional[Dict[str, Any]] = None
    validation_score: Optional[int] = None
    # Rubric evaluation at the gate: weighted dimension breakdown produced by
    # the Foundry rubric evaluator (live) or derived deterministically from the
    # validators (simulation). The UI fills the gate bar from these dimensions.
    rubric: Optional[Dict[str, Any]] = None
    # Binding to the dynamically designed digital worker (OrgBlueprint role) that
    # owns this chapter. Set by the Worker Factory's scheduler; closes the seam
    # between the org the LLM designs and the agents that do the work.
    assigned_worker_id: Optional[str] = None
    assigned_worker_title: Optional[str] = None
    # The CEO decision made at this chapter's dilemma gate (game_design.md
    # section 5): {prompt, option (label picked), tradeoff, custom (bool)}.
    # Written by the dilemma endpoint; recalled in later chapter briefs so
    # choices visibly chain (memory is what makes a choice feel real).
    dilemma_choice: Optional[Dict[str, Any]] = None


class WorkerInvocation(BaseModel):
    """Record of a worker being spawned by the factory."""
    id: str
    chapter_id: str
    role: str                 # archetype that drives prompt + validators
    worker_id: str = ""       # designed OrgRole id this invocation embodies
    worker_title: str = ""    # designed OrgRole title (shown in the story)
    deployment: str = ""
    started_at: float = 0.0
    completed_at: float = 0.0
    status: str = "pending"  # pending, running, completed, failed
    tokens_in: int = 0
    tokens_out: int = 0
    reasoning_tokens: int = 0          # hidden "thinking" tokens the model spent
    reasoning_preview: str = ""        # short excerpt of chain-of-thought, if exposed
    # Tools the worker drew from the Toolbox for this chapter (diegetic: the
    # rail names them before the artifact appears).
    tools_drawn: List[str] = Field(default_factory=list)
    # The actual tools/call ledger for this run - one entry per real call
    # through the toolbox (MCP shape): {tool, source, args, result, ms}.
    # This is the not-mocked receipt the UI renders as a terminal trace.
    tool_trace: List[Dict[str, Any]] = Field(default_factory=list)
    # Microsoft Agent Framework runtime evidence (empty on the direct path):
    # which framework ran the agent, which MAF chat client carried inference
    # (FoundryChatClient on the project Responses endpoint vs OpenAIChatClient
    # on the resource /openai/v1 path), what its ContextProvider injected as
    # session memory, and which FunctionTools the model actually called.
    framework: str = ""
    maf_client: str = ""
    # Why the preferred FoundryChatClient path degraded (e.g. 403 RBAC on the
    # project Responses endpoint) - empty when it carried the run or never ran.
    maf_fallback_reason: str = ""
    maf_memory: List[Dict[str, Any]] = Field(default_factory=list)
    maf_tools_called: List[str] = Field(default_factory=list)
    # Foundry IQ recall that grounded this run (source names; cited when the
    # real IQ knowledge base answered, local playbook files otherwise).
    iq_sources: List[str] = Field(default_factory=list)
    latency_s: float = 0.0
    error: Optional[str] = None


class WorldGraph(BaseModel):
    """Full venture world produced by the WorldDesigner."""
    brief: str = ""
    chapters: List[Chapter] = Field(default_factory=list)
    invocations: List[WorkerInvocation] = Field(default_factory=list)
    current_chapter_index: int = 0
    status: str = "not-started"  # not-started, active, completed
    # Session memory: every gate decision in order - {chapter_id, chapter_title,
    # option, tradeoff}. Worker briefs and narration recall from this ledger.
    decisions: List[Dict[str, Any]] = Field(default_factory=list)

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


class Dilemma(BaseModel):
    """A situational choice at a chapter gate that moves the story forward.
    
    Based on the founder archetype, antagonist, and market dynamics, the dilemma
    presents a tradeoff: hiring a specialist (spend money, gain capability) vs
    upskilling the founder (save money, slow progress), etc.
    """
    id: str
    chapter_id: str
    title: str  # e.g., "Hire or Train?"
    context: str  # Narrative framing that explains why this choice matters now
    antagonist_move: str  # What the antagonist did that created this dilemma
    option_a: Dict[str, Any]  # {label, description, economics_impact, story_impact}
    option_b: Dict[str, Any]  # {label, description, economics_impact, story_impact}
    tradeoff_axis: str  # e.g., "speed_vs_burn", "quality_vs_reach", "specialization_vs_flexibility"
    selected_option: Optional[str] = None  # "a" or "b" after player chooses


class CompanyState(BaseModel):
    name: str
    description: str
    pitch: str
    stage: str = "idea"  # idea, validated, launched
    xp: int = 0
    level: int = 1
    founder: Optional[FounderState] = None
    antagonist: Optional[AntagonistState] = None
    active_quest: Optional[QuestState] = None
    world: Optional[WorldGraph] = None
    org: Optional[OrgBlueprint] = None
    economics: CompanyEconomics = Field(default_factory=CompanyEconomics)
    agents: Dict[str, CharacterState] = Field(default_factory=dict)
    business_flags: Dict[str, bool] = Field(default_factory=dict)
    streak: int = 0
    replay_log: List[Dict[str, Any]] = Field(default_factory=list)

class StateStore:
    def __init__(self, filepath: Optional[str] = None):
        self.filepath = filepath
        self.state: Optional[CompanyState] = None
        self._lock = threading.RLock()

    def initialize_new_company(self, name: str, pitch: str, description: str = "", founder: Optional[FounderState] = None) -> CompanyState:
        with self._lock:
            self.state = CompanyState(
                name=name,
                description=description,
                pitch=pitch,
                founder=founder,
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
        with self._lock:
            try:
                with open(self.filepath, 'r') as f:
                    data = json.load(f)
                    self.state = CompanyState(**data)
                    return self.state
            except (FileNotFoundError, json.JSONDecodeError):
                return None

    def save(self) -> None:
        if self.filepath and self.state:
            with self._lock:
                dirpath = os.path.dirname(os.path.abspath(self.filepath))
                os.makedirs(dirpath, exist_ok=True)

                fd, temp_path = tempfile.mkstemp(dir=dirpath, prefix="state_", suffix=".json.tmp")
                try:
                    with os.fdopen(fd, 'w') as f:
                        json.dump(self.state.model_dump(), f, indent=2)
                    os.replace(temp_path, self.filepath)
                except Exception as e:
                    if os.path.exists(temp_path):
                        try:
                            os.remove(temp_path)
                        except OSError:
                            pass
                    raise e

    def log_event(self, event_type: str, actor: str, message: str, payload: Optional[Dict[str, Any]] = None) -> None:
        with self._lock:
            if self.state:
                self.state.replay_log.append({
                    "event_type": event_type,
                    "actor": actor,
                    "message": message,
                    "payload": payload or {}
                })
                self.save()
