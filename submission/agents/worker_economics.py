"""Worker economics: a digital worker's cost is the REAL cost of it working.

A worker agent works by reasoning - it proposes a move, the world model reacts,
and that round-trip is inference we actually pay for. So a worker's "salary" is
not a hand-picked number; it is the inference cost of the cheapest model we run
that worker on, plus the fixed platform cost of keeping it always-on.

This module is the single source of truth for:
  1. WORKER_MODEL  - the one cheap model worker agents run on (pinned, env-overridable).
  2. unit price    - published USD per-token price for that model class.
  3. inference_cost_usd(...)        - real $ for one work turn from its token usage.
  4. projected_monthly_cost_usd(...) - a worker's monthly burn = infra + projected inference.

Keeping it here means org design, the burn HUD, and the per-turn receipts all
quote the same real economics instead of drifting copies.
"""
from __future__ import annotations

import os

# The cheapest model worker agents run on. Worker agents are the ones that
# propose moves and react to the world each turn, so we deliberately pin them to
# the cheapest capable deployment. Overridable via env; falls back to the fast
# NPC model, then to a gpt-4o-mini-class default so a fresh clone still has a
# real price to quote.
WORKER_MODEL = (
    os.getenv("WORKER_MODEL")
    or os.getenv("NPC_FAST_MODEL")
    or "gpt-4o-mini"
).strip()

# Published USD price per 1,000,000 tokens (input, output) for the cheap model
# classes we actually use for workers. Matched case-insensitively by substring
# so a deployment alias like "gpt-4o-mini-2024-07-18" still resolves.
_MODEL_PRICE_PER_M = {
    "gpt-4o-mini":  (0.15, 0.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-5-nano":   (0.05, 0.40),
    "gpt-5-mini":   (0.25, 2.00),
    "o4-mini":      (1.10, 4.40),
}
_DEFAULT_PRICE_PER_M = (0.15, 0.60)  # gpt-4o-mini-class default

# Fixed monthly platform cost of keeping a worker always-on (managed hosting,
# vector store / retrieval, orchestration, tool calls), by how heavy the seat is.
# This is the baseline that does not depend on how much the worker reasons.
_INFRA_BY_HINT = {"reasoning": 45, "creative": 30, "fast": 15, "n/a": 0}

# Token budget a worker burns per WORK TURN, by how heavy its reasoning is, and
# how many such turns an always-on worker does in a month. These project a
# monthly inference bill before any real turns are metered.
_TURN_TOKENS = {"reasoning": 8000, "creative": 6000, "fast": 2500, "n/a": 0}
_TURNS_PER_MONTH = 600
_INPUT_SHARE = 0.7  # a work turn is mostly context in, a little decision out


def worker_unit_price(model: str | None = None) -> tuple[float, float]:
    """(input, output) USD price per 1M tokens for this model class."""
    name = (model or WORKER_MODEL or "").lower()
    for key, price in _MODEL_PRICE_PER_M.items():
        if key in name:
            return price
    return _DEFAULT_PRICE_PER_M


def inference_cost_usd(tokens_in: int, tokens_out: int, model: str | None = None) -> float:
    """Real USD cost of one work turn from its actual token usage."""
    price_in, price_out = worker_unit_price(model)
    return (max(0, int(tokens_in)) * price_in
            + max(0, int(tokens_out)) * price_out) / 1_000_000


def projected_monthly_cost_usd(deployment_hint: str, model: str | None = None) -> int:
    """A worker's monthly burn: always-on infra + projected monthly inference.

    Used as the default worker cost at org-design time, before any real turns
    have been metered. The model may still override with its own number.
    """
    hint = (deployment_hint or "reasoning").lower()
    infra = _INFRA_BY_HINT.get(hint, 30)
    tokens = _TURN_TOKENS.get(hint, 4000)
    if tokens <= 0:
        return 0
    per_turn = inference_cost_usd(
        int(tokens * _INPUT_SHARE), int(tokens * (1 - _INPUT_SHARE)), model)
    return int(round(infra + per_turn * _TURNS_PER_MONTH))


# A worker's deployment_hint is sometimes phrased as the owning role name
# (strategist|designer|marketer|ops) instead of the cost class. Map those onto
# the cost classes so every caller derives the same real price.
_ROLE_TO_HINT = {
    "strategist": "reasoning",
    "narrator": "reasoning",
    "designer": "creative",
    "marketer": "creative",
    "ops": "fast",
    "npc": "fast",
}


def monthly_cost_for_role(deployment_hint: str, model: str | None = None) -> int:
    """Real metered monthly cost for a worker, accepting either a cost class
    (reasoning|creative|fast|n/a) or a role name (strategist|designer|...)."""
    hint = (deployment_hint or "reasoning").lower()
    hint = _ROLE_TO_HINT.get(hint, hint)
    return projected_monthly_cost_usd(hint, model)


# Present-world human median: a FALLBACK estimate of what a person in this seat
# would cost per month (fully-loaded market salary / 12), used only when the
# model did not reason a real per-role salary on the fly. Coarse game-design
# figures, not sourced market data. Keyed by lifecycle stage, nudged up for a
# "lead" seat. Single source so org design and mid-game hires agree.
_HUMAN_MEDIAN_USD = {
    "discovery": 7000,
    "positioning": 11000,
    "mvp": 10500,
    "gtm": 7500,
    "retention": 6500,
    "ops": 8500,
}
_LEAD_MEDIAN_MULTIPLIER = 1.4


def human_median_fallback_usd(lifecycle_stage: str, seniority: str = "ic") -> int:
    """Fallback present-world monthly salary for a seat when none was reasoned."""
    base = _HUMAN_MEDIAN_USD.get((lifecycle_stage or "ops").lower(), 8000)
    if (seniority or "").lower() == "lead":
        base = int(base * _LEAD_MEDIAN_MULTIPLIER)
    return base

