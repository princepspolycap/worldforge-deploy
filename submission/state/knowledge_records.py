"""Generated Search documents for run-specific game knowledge.

Static playbooks live in submission/knowledge/. These helpers turn the current
session state - founder profile, digital workers, world stages, and CEO choices
- into the same SearchDocument shape used by the Foundry IQ sync tool.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional

from state.consequences import initialize_economics_from_org
from state.schema import (
    ChoiceRecord,
    CompanyState,
    EncounterState,
    FounderProfile,
    GameRunState,
    InventoryItem,
    OrgBlueprint,
    SearchDocument,
    Stage,
    WorldDay,
    WorldGraph,
)


def _stable_doc_id(prefix: str, value: str) -> str:
    raw = (value or prefix).encode("utf-8")
    return f"{prefix}_{hashlib.sha1(raw).hexdigest()[:12]}"


def profile_from_payload(
    profile: Optional[Dict[str, Any]],
    *,
    source: str,
    source_ref: str,
    pitch: str = "",
    mode: str = "simulation",
) -> FounderProfile:
    """Normalize URL-analysis output or a pitch into a FounderProfile."""
    data = profile or {}
    summary = str(data.get("company_summary") or pitch or "").strip()
    return FounderProfile(
        source=source,
        source_ref=source_ref,
        source_kind=str(data.get("source_kind") or source),
        host=str(data.get("host") or ""),
        company_summary=summary[:400],
        what_they_sell=str(data.get("what_they_sell") or summary)[:300],
        target_customer=str(data.get("target_customer") or "mission collaborators")[:180],
        business_model=str(data.get("business_model") or "mission-first venture design")[:220],
        founder_archetype=str(data.get("founder_archetype") or "Builder"),
        founder_skill=str(data.get("founder_skill") or "building product"),
        signals=[str(s)[:240] for s in (data.get("signals") or [])[:8]],
        brief=str(data.get("brief") or summary or pitch)[:1600],
        scraped=bool(data.get("scraped", False)),
        osint_hits=int(data.get("osint_hits") or 0),
        mode=str(data.get("mode") or mode),
    )


def _profile_search_document(profile: FounderProfile) -> SearchDocument:
    content = "\n".join([
        f"Profile summary: {profile.company_summary}",
        f"Offering or capability: {profile.what_they_sell}",
        f"Beneficiary or customer: {profile.target_customer}",
        f"Business model: {profile.business_model}",
        f"Founder archetype: {profile.founder_archetype}",
        f"Founder skill: {profile.founder_skill}",
        "Signals: " + " | ".join(profile.signals),
        "",
        profile.brief,
    ]).strip()
    source_ref = profile.source_ref or profile.host or "pitch"
    return SearchDocument(
        id=_stable_doc_id("founder_profile", source_ref),
        title=f"Founder profile: {profile.company_summary[:80] or source_ref}",
        content=content[:8000],
        source=source_ref,
        kind="founder_profile",
        tags=sorted({profile.source, profile.source_kind, profile.founder_archetype.lower(), "founder"}),
        metadata={
            "host": profile.host,
            "scraped": profile.scraped,
            "osint_hits": profile.osint_hits,
            "mode": profile.mode,
        },
    )


def _org_search_documents(org: Optional[OrgBlueprint]) -> List[SearchDocument]:
    if not org:
        return []
    docs = [
        SearchDocument(
            id=_stable_doc_id("org_blueprint", org.source_ref or org.company_summary),
            title="Digital workforce blueprint",
            content=(
                f"Company summary: {org.company_summary}\n"
                f"Operating model: {org.operating_model}\n"
                f"Headcount: {org.headcount}; digital workers: {org.digital_worker_count}; "
                f"monthly burn: {org.monthly_burn_usd}; leverage ratio: {org.leverage_ratio}\n"
                "Notes: " + " | ".join(org.notes)
            )[:8000],
            source=org.source_ref or org.source or "session",
            kind="org_blueprint",
            tags=["org", "digital_workers", org.source],
            metadata={"headcount": org.headcount, "digital_worker_count": org.digital_worker_count},
        )
    ]
    for role in org.roles:
        if role.kind == "human":
            continue
        docs.append(SearchDocument(
            id=_stable_doc_id("worker", role.id),
            title=f"Digital worker: {role.title}",
            content=(
                f"Title: {role.title}\n"
                f"Mandate: {role.mandate}\n"
                f"Lifecycle stage: {role.lifecycle_stage}\n"
                f"KPIs: {' | '.join(role.kpis)}\n"
                f"Tools: {' | '.join(role.tools)}\n"
                f"Why this worker exists: {role.why}"
            )[:8000],
            source=org.source_ref or org.source or "session",
            kind="digital_worker",
            tags=sorted({"worker", "digital_worker", role.lifecycle_stage, role.deployment_hint}),
            metadata={"worker_id": role.id, "monthly_cost_usd": role.monthly_cost_usd},
        ))
    return docs


def _world_search_documents(world: Optional[WorldGraph]) -> List[SearchDocument]:
    if not world:
        return []
    docs: List[SearchDocument] = []
    for stage in world.stages:
        docs.append(SearchDocument(
            id=_stable_doc_id("world_stage", stage.id),
            title=f"World stage: {stage.title}",
            content=(
                f"Stage ID: {stage.id}\n"
                f"Title: {stage.title}\n"
                f"Goal: {stage.goal}\n"
                f"Success metric: {stage.success_metric}\n"
                f"Status: {stage.status}\n"
                f"Owner role: {stage.owner_role}\n"
                f"Assigned worker: {stage.assigned_worker_title or stage.assigned_worker_id}\n"
                f"Suggested tools: {' | '.join(stage.suggested_tools)}\n"
                f"Artifact summary: {json.dumps(stage.artifact or {})[:1800]}"
            )[:8000],
            source="session_world",
            kind="world_stage",
            tags=sorted({"world", "stage", stage.id, stage.owner_role}),
            metadata={"stage_id": stage.id, "owner_role": stage.owner_role},
        ))
    return docs


def _choice_search_documents(choices: List[ChoiceRecord]) -> List[SearchDocument]:
    docs: List[SearchDocument] = []
    for choice in choices:
        docs.append(SearchDocument(
            id=_stable_doc_id("choice", choice.id),
            title=f"CEO choice: {choice.stage_title or choice.stage_id}",
            content=(
                f"Stage: {choice.stage_title} ({choice.stage_id})\n"
                f"Prompt: {choice.prompt}\n"
                f"Choice: {choice.option}\n"
                f"Tradeoff: {choice.tradeoff}\n"
                f"Rule: {choice.rule_id}\n"
                f"Consequence: {choice.consequence_summary}"
            )[:8000],
            source="session_choices",
            kind="choice",
            tags=sorted({"choice", choice.stage_id, choice.rule_id}),
            metadata={"choice_id": choice.id, "day_index": choice.day_index},
        ))
    return docs


def _game_search_documents(game: GameRunState) -> List[SearchDocument]:
    docs: List[SearchDocument] = [
        SearchDocument(
            id=_stable_doc_id("game_run", game.run_id),
            title=f"Game run: {game.run_id}",
            content=(
                f"Run ID: {game.run_id}\n"
                f"Mode: {game.mode}\n"
                f"Day index: {game.day_index}\n"
                f"Turn index: {game.turn_index}\n"
                f"Loop phase: {game.loop_phase}\n"
                f"Energy: {game.energy}/{game.max_energy}\n"
                f"Hand: {' | '.join(c.name for c in game.hand)}\n"
                f"Pending rewards: {' | '.join(c.name for c in game.pending_rewards)}\n"
                f"Deck size: {len(game.deck)}; discard size: {len(game.discard)}; exhaust size: {len(game.exhaust)}\n"
                f"Threat level: {game.antagonist_arc.threat_level}\n"
                f"Escalation: {game.antagonist_arc.escalation_stage}\n"
                f"Current antagonist pressure: {game.antagonist_arc.current_pressure}\n"
                f"Open counterplays: {' | '.join(game.antagonist_arc.open_counterplays)}"
            )[:8000],
            source=game.run_id,
            kind="game_run",
            tags=["game", "run", game.loop_phase, game.antagonist_arc.escalation_stage],
            metadata={"day_index": game.day_index, "threat_level": game.antagonist_arc.threat_level},
        )
    ]
    for member in game.party:
        docs.append(SearchDocument(
            id=_stable_doc_id("party_member", member.worker_id),
            title=f"Party worker: {member.title}",
            content=(
                f"Worker: {member.title}\n"
                f"Role: {member.role}\n"
                f"Lifecycle: {member.lifecycle_stage}\n"
                f"Status: {member.status}\n"
                f"Morale: {member.morale}; fatigue: {member.fatigue}; trust: {member.trust}\n"
                f"Current stage: {member.current_stage_id}\n"
                f"Tools: {' | '.join(member.tools)}\n"
                f"Traits: {' | '.join(member.traits)}"
            )[:8000],
            source=game.run_id,
            kind="party_member",
            tags=sorted({"party", "worker", member.role, member.lifecycle_stage, member.status}),
            metadata={"worker_id": member.worker_id, "fatigue": member.fatigue, "morale": member.morale},
        ))
    for zone_name, cards in (
        ("deck", game.deck),
        ("hand", game.hand),
        ("discard", game.discard),
        ("exhaust", game.exhaust),
        ("reward", game.pending_rewards),
    ):
        for card in cards:
            docs.append(SearchDocument(
                id=_stable_doc_id("card", f"{zone_name}:{card.id}"),
                title=f"Card in {zone_name}: {card.name}",
                content=(
                    f"Card: {card.name}\n"
                    f"Zone: {zone_name}\n"
                    f"Kind: {card.kind}\n"
                    f"Cost: {card.cost}\n"
                    f"Description: {card.description}\n"
                    f"Effects: {json.dumps(card.effects)[:1000]}\n"
                    f"Tags: {' | '.join(card.tags)}"
                )[:8000],
                source=game.run_id,
                kind="game_card",
                tags=sorted(set(["card", zone_name, card.kind] + card.tags)),
                metadata={"card_id": card.id, "zone": zone_name, "cost": card.cost},
            ))
    for move in game.move_log[-30:]:
        docs.append(SearchDocument(
            id=_stable_doc_id("player_move", move.id),
            title=f"Player move: {move.move_type}",
            content=(
                f"Move: {move.move_type}\n"
                f"Turn: {move.turn_index}; day: {move.day_index}; stage: {move.stage_id}\n"
                f"Card: {move.card_id}\n"
                f"Target: {move.target_id}\n"
                f"Energy spent: {move.energy_spent}\n"
                f"Summary: {move.summary}\n"
                f"Effects: {json.dumps(move.effects_applied)[:1400]}"
            )[:8000],
            source=game.run_id,
            kind="player_move",
            tags=sorted({"move", move.move_type, move.stage_id, move.card_id}),
            metadata={"move_id": move.id, "turn_index": move.turn_index, "energy_spent": move.energy_spent},
        ))
    for item in game.inventory:
        docs.append(_inventory_document(game.run_id, item))
    for encounter in game.encounters:
        docs.append(_encounter_document(game.run_id, encounter))
    for move in game.antagonist_arc.moves:
        docs.append(SearchDocument(
            id=_stable_doc_id("antagonist_move", move.id),
            title=move.title,
            content=(
                f"Stage: {move.stage_id}\n"
                f"Tactic: {move.tactic}\n"
                f"Pressure type: {move.pressure_type}\n"
                f"Target metric: {move.target_metric} ({move.pressure_delta:+d})\n"
                f"Narrative: {move.narrative}\n"
                f"Counterplay: {move.counterplay}\n"
                f"Rule: {move.source_rule_id}"
            )[:8000],
            source=game.run_id,
            kind="antagonist_move",
            tags=sorted({"antagonist", "move", move.stage_id, move.pressure_type, move.target_metric}),
            metadata={"move_id": move.id, "day_index": move.day_index, "pressure_delta": move.pressure_delta},
        ))
    return docs


def _inventory_document(run_id: str, item: InventoryItem) -> SearchDocument:
    return SearchDocument(
        id=_stable_doc_id("inventory", item.id),
        title=f"Inventory: {item.name}",
        content=(
            f"Name: {item.name}\n"
            f"Kind: {item.kind}\n"
            f"Description: {item.description}\n"
            f"Source stage: {item.source_stage_id}\n"
            f"Owner worker: {item.owner_worker_id}\n"
            f"Effects: {json.dumps(item.effects)[:1000]}"
        )[:8000],
        source=run_id,
        kind="inventory_item",
        tags=sorted(set(["inventory", item.kind, item.source_stage_id] + item.tags)),
        metadata={"item_id": item.id, "source_stage_id": item.source_stage_id},
    )


def _encounter_document(run_id: str, encounter: EncounterState) -> SearchDocument:
    return SearchDocument(
        id=_stable_doc_id("encounter", encounter.id),
        title=f"Encounter: {encounter.title or encounter.stage_id}",
        content=(
            f"Encounter: {encounter.id}\n"
            f"Kind: {encounter.kind}\n"
            f"Status: {encounter.status}\n"
            f"Stage: {encounter.stage_id}\n"
            f"Workers: {' | '.join(encounter.worker_ids)}\n"
            f"Choices: {' | '.join(encounter.choice_ids)}\n"
            f"Antagonist move: {encounter.antagonist_move_id}\n"
            f"Artifacts: {' | '.join(encounter.artifact_keys)}"
        )[:8000],
        source=run_id,
        kind="encounter",
        tags=sorted({"encounter", encounter.kind, encounter.status, encounter.stage_id}),
        metadata={"encounter_id": encounter.id, "day_index": encounter.day_index},
    )


def refresh_session_knowledge(state: CompanyState) -> None:
    """Rebuild the generated Search-document view of the current run."""
    docs: List[SearchDocument] = []
    if state.founder_profile:
        docs.append(_profile_search_document(state.founder_profile))
    docs.extend(_org_search_documents(state.org))
    docs.extend(_world_search_documents(state.world))
    docs.extend(_choice_search_documents(state.choices))
    docs.extend(_game_search_documents(state.game))
    state.knowledge_records = docs


def _economics_snapshot(state: CompanyState) -> Dict[str, Any]:
    econ = state.economics or initialize_economics_from_org(state.org)
    return econ.model_dump() if hasattr(econ, "model_dump") else {}


def record_world_day(state: CompanyState, stage: Stage, choice: ChoiceRecord) -> None:
    """Upsert the day/room snapshot for a committed CEO choice."""
    worker_ids = [stage.assigned_worker_id or stage.owner_role]
    day = WorldDay(
        day_index=choice.day_index,
        stage_id=stage.id,
        title=stage.title,
        status="completed",
        worker_ids=[w for w in worker_ids if w],
        choice_id=choice.id,
        resource_snapshot=_economics_snapshot(state),
    )
    state.days = [d for d in state.days if d.stage_id != stage.id]
    state.days.append(day)
