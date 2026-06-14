"""Simulator for the pivoted World-Improvement Campaign loop (Path B).

Exercises profile/pitch intake, dynamic org analysis, Harmon's story circle stages,
stage execution, dilemma gates, consequence rules, and multi-agent standups.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Ensure submission path is in Python path for local modular references
SUBMISSION_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(SUBMISSION_DIR))

from state.schema import StateStore, Stage, OrgBlueprint, WorldGraph
from state.consequences import apply_decision_consequence
from agents.org_designer import design_org
from agents.world_designer import design_world
from agents.worker_factory import execute_stage, bind_world_to_org
from state.consequences import RULES


def run_campaign_simulation(pitch: str, url: str | None = None) -> None:
    print("=" * 70)
    print("⚔️   GAMIFYING WORLD IMPROVEMENT - CAMPAIGN SIMULATOR (PATH B) ⚔️")
    print("=" * 70)
    print(f"Intake Pitch: '{pitch}'")
    if url:
        print(f"Intake Profile URL: '{url}'")

    # 1. Initialize Simulator State Store
    state_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state", "state_sim.json")
    if os.path.exists(state_file):
        try:
            os.remove(state_file)
        except Exception:
            pass

    store = StateStore(filepath=state_file)
    state = store.initialize_new_company(
        name="Spawned World Campaign",
        pitch=pitch,
        description="A campaign simulated in the World-Improvement framework."
    )

    # 2. Org Design: analyze pitch/URL and build dynamic digital workforce
    print("\n🔍 Designing the dynamic workforce org...")
    brief = url if url else pitch
    source = "url" if url else "pitch"
    source_ref = url if url else pitch

    blueprint = design_org(brief, source=source, source_ref=source_ref)
    state.org = OrgBlueprint(**blueprint)
    
    # Initialize economics from org
    from state.consequences import initialize_economics_from_org
    state.economics = initialize_economics_from_org(state.org)
    store.save()

    print(f"\n👥 Digital Workforce Chartered ({state.org.headcount} Seats):")
    print(f"  * Operator (Human CEO): Active")
    for role in state.org.roles:
        if role.kind != "human":
            print(f"  * Worker: {role.title:<28} | Cost: ${role.monthly_cost_usd}/mo | Stage: {role.lifecycle_stage}")
            print(f"    Mandate: {role.mandate}")

    # 3. World Design: construct the 8-stage world graph (Harmon Story Circle)
    print("\n🌐 Constructing the venture Campaign Graph...")
    stages_data = design_world(pitch)
    world = WorldGraph(
        brief=pitch,
        stages=[Stage(**ch) if isinstance(ch, dict) else ch for ch in stages_data],
        status="active"
    )
    bindings = bind_world_to_org(world, state.org)
    state.world = world
    store.save()

    print(f"\n📜 Venture Campaign Graph (Story Circle):")
    for idx, ch in enumerate(world.stages, start=1):
        worker_title = ch.assigned_worker_title or "Unassigned"
        print(f"  [{idx}] Stage: {ch.title}")
        print(f"      Goal: {ch.goal}")
        print(f"      Metric: {ch.success_metric}")
        print(f"      Owner Worker: {worker_title}")

    # 4. Campaign Stage Loop
    previous_artifacts = []
    
    # Canned dilemmas for local offline simulation
    from tools.server import _canned_dilemma_for_stage, _enrich_dilemma_options, _build_standup_turns

    for idx, stage in enumerate(world.stages, start=1):
        print("\n" + "=" * 70)
        print(f"🚩 STAGE {idx}/8: {stage.title}")
        print(f"Owner Active: {stage.assigned_worker_title}")
        print("-" * 70)

        # Execute Stage
        world.current_stage_index = idx - 1
        invocation, artifact, score = execute_stage(
            stage, world.brief, previous_artifacts, org=state.org, decisions=world.decisions
        )
        world.invocations.append(invocation)
        artifact = artifact or {}
        if artifact:
            previous_artifacts.append(artifact)
        stage.artifact = artifact
        stage.validation_score = score
        stage.status = "completed" if score >= 80 else "needs-review"
        
        if state.economics is None:
            from state.consequences import initialize_economics_from_org
            state.economics = initialize_economics_from_org(state.org)

        # Single source of truth for stage economics: earned market share ->
        # revenue -> deal cash (same path as the server). No flat per-role table.
        from state.consequences import apply_stage_outcome
        outcome = apply_stage_outcome(state, stage, score)

        # Award XP
        xp_earned = 10 + (score // 10)
        state.xp += xp_earned
        
        print(f"\n📦 Artifact Produced by {stage.assigned_worker_title}:")
        if artifact:
            for k, v in list(artifact.items())[:3]:
                print(f"   * {k}: {v}")
            if len(artifact) > 3:
                print(f"   * ... ({len(artifact) - 3} more fields)")
        else:
            print("   * No artifact produced; invocation failed or returned an empty payload.")

        print(f"\n⚖️  Validation Score: {score}/100")
        print(f"   XP Earned: +{xp_earned} (Total XP: {state.xp})")

        # 5. Pose Dilemma Card
        print("\n⚖️  Strategic Dilemma Card Posed:")
        canned = _canned_dilemma_for_stage(stage)
        enriched_options = _enrich_dilemma_options(state, stage, canned["options"])
        
        print(f"   Prompt: \"{canned['prompt']}\"")
        for i, opt in enumerate(enriched_options, start=1):
            print(f"   [{i}] {opt['option']}")
            print(f"       Tradeoff: {opt['tradeoff']}")
            print(f"       Effect: {opt['effect_line']}")

        # Simulate CEO Decision (Auto-select Option 1)
        selected_opt = enriched_options[0]
        print(f"\n🛡️  CEO decision made: Selected Option [1] -> \"{selected_opt['option']}\"")
        
        # Apply Consequence
        old_entry = next((d for d in world.decisions if d.get("stage_id") == stage.id), None)
        choice = {
            "prompt": canned["prompt"],
            "option": selected_opt["option"],
            "tradeoff": selected_opt["tradeoff"],
            "custom": False,
            "rule_id": selected_opt["rule_id"],
            "option_id": selected_opt["id"],
            "scene_id": f"{stage.id}:dilemma"
        }
        consequence = apply_decision_consequence(state, stage, choice, old_entry=old_entry)
        choice["rule_id"] = consequence["rule_id"]
        choice["consequence"] = consequence
        choice["consequence_summary"] = consequence["summary"]
        stage.dilemma_choice = choice
        
        entry = {"stage_id": stage.id, "stage_title": stage.title, **choice}
        world.decisions = [d for d in world.decisions if d.get("stage_id") != stage.id]
        world.decisions.append(entry)
        store.save()

        print(f"   Consequence Applied: {consequence['summary']}")

        # 6. Multi-Agent Standup
        print("\n💬 Multi-Agent Standup Reaction:")
        turns, context = _build_standup_turns(state, stage, entry)
        for turn in turns:
            print(f"   [{turn['speaker']} ({turn['role'].capitalize()})]:")
            print(f"     \"{turn['message']}\"")

    world.status = "completed"
    state.stage = "launched"
    store.save()

    print("\n" + "=" * 70)
    print("🏆 CAMPAIGN COMPLETED SUCCESSFULLY!")
    print("=" * 70)
    print(f"Venture Name:   {state.name}")
    print(f"Venture Stage:  {state.stage}")
    print(f"XP:             {state.xp} (Level {state.level})")
    print(f"Economics Metrics:")
    print(f"  * Proof Score:      {state.economics.proof}/100")
    print(f"  * Trust Score:      {state.economics.trust}/100")
    print(f"  * Velocity Score:   {state.economics.velocity}/100")
    print(f"  * Burn Pressure:    {state.economics.burn_pressure}/100")
    print(f"  * Market Share:     {state.economics.market_share}% of ${state.economics.addressable_market_usd:,}/mo")
    print(f"  * Monthly Revenue:  ${state.economics.monthly_revenue_usd:,}/mo")
    print(f"  * Monthly Burn:     ${state.economics.monthly_burn_usd:,}/mo")
    print(f"  * Net Profit:       ${state.economics.net_profit_usd:,}/mo")
    print(f"  * Treasury Points:  {state.economics.points}")
    print(f"  * Runway Months:    {state.economics.runway_months} months")
    print(f"  * Digital Workers:  {state.economics.digital_worker_count}")
    print("=" * 70)

    # Clean up simulator state file
    if os.path.exists(state_file):
        try:
            os.remove(state_file)
        except Exception:
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulator for Gamifying World Improvement Campaign")
    parser.add_argument("--pitch", type=str, default="Green energy grids for off-grid communities", help="The campaign brief to design")
    parser.add_argument("--url", type=str, default=None, help="The LinkedIn or public profile URL of the founder")
    args = parser.parse_args()

    run_campaign_simulation(args.pitch, args.url)
