"""Stable response helpers for the game API.

The frontend should render the backend contract instead of inferring durable
game rules from ad hoc response shapes. These helpers keep existing keys while
adding explicit contract metadata for future frontend splits.
"""

from typing import Any, Dict, Optional

from state.schema import Stage, CompanyState, QuestStep, WorkerInvocation


CONTRACT_VERSION = "2026-06-11.game-backend.v1"

FLOW_STAGES = [
    "founder_intake",
    "org_design",
    "world_design",
    "stage_execution",
    "artifact_validation",
    "human_gate",
    "xp_memory_replay",
]

CANONICAL_SURFACES = {
    "legacy_quest": {
        "description": "Three-step quest path retained for the original simulator/UI.",
        "state_field": "active_quest",
    },
    "world_graph": {
        "description": "Preferred release path for dynamic workforce gameplay.",
        "state_field": "world",
    },
}


def contract_metadata(surface: str = "world_graph") -> Dict[str, Any]:
    return {
        "contract_version": CONTRACT_VERSION,
        "canonical_surface": surface,
        "flow_stages": FLOW_STAGES,
        "surfaces": CANONICAL_SURFACES,
    }


def state_response(
    state: Optional[CompanyState],
    surface: str = "world_graph",
    **extra: Any,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "initialized": state is not None,
        "state": state.model_dump() if state else None,
        "contract": contract_metadata(surface),
    }
    payload.update(extra)
    return payload


def step_response(state: CompanyState, step: QuestStep, **extra: Any) -> Dict[str, Any]:
    return state_response(
        state,
        surface="legacy_quest",
        current_step=step.model_dump(),
        **extra,
    )


def stage_response(
    state: CompanyState,
    stage: Stage,
    invocation: WorkerInvocation,
    **extra: Any,
) -> Dict[str, Any]:
    return state_response(
        state,
        surface="world_graph",
        stage=stage.model_dump(),
        invocation=invocation.model_dump(),
        **extra,
    )


def reset_response() -> Dict[str, Any]:
    return {
        "success": True,
        "message": "State reset successfully.",
        "contract": contract_metadata(),
    }
