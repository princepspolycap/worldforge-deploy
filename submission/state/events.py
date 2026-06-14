"""Replay event names used by the game/backend contract.

Keeping event names here makes the reasoning trace a real API contract instead
of scattered string literals across the server and simulator.
"""


class EventType:
    SESSION_START = "SESSION_START"
    QUEST_START = "QUEST_START"
    STEP_START = "STEP_START"
    STEP_COMPLETED_REASONING = "STEP_COMPLETED_REASONING"
    STEP_EXECUTION_ERROR = "STEP_EXECUTION_ERROR"
    STEP_APPROVED = "STEP_APPROVED"
    STEP_REJECTED = "STEP_REJECTED"
    LEVEL_UP = "LEVEL_UP"
    QUEST_LINE_COMPLETED = "QUEST_LINE_COMPLETED"
    WORLD_DESIGNED = "WORLD_DESIGNED"
    STAGE_EXECUTED = "STAGE_EXECUTED"
    WORLD_COMPLETED = "WORLD_COMPLETED"


REASONING_EVENTS = {
    EventType.QUEST_START,
    EventType.STEP_START,
    EventType.STEP_COMPLETED_REASONING,
    EventType.WORLD_DESIGNED,
    EventType.STAGE_EXECUTED,
}


HUMAN_GATE_EVENTS = {
    EventType.STEP_APPROVED,
    EventType.STEP_REJECTED,
}
