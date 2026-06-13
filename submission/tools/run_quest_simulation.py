import argparse
import sys
import yaml
import os
from typing import Dict, Any

# Ensure submission path is in Python path for local modular references
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from state.schema import StateStore, QuestState, QuestStep
from state.events import EventType
from agents.foundry_agents import MasterNarrator, StrategistAgent, DesignerAgent, MarketerAgent
from tools.code_interpreter_wrappers import validate_positioning, validate_landing_page, validate_marketing_email

def run_simulation(pitch: str) -> None:
    print("=" * 60)
    print("⚔️  GAMIFYING WORLD IMPROVEMENT - SIMULATOR RUN ⚔️")
    print("=" * 60)
    print(f"Propelling Pitch: '{pitch}'")
    
    # 1. Initialize State Store
    store = StateStore() # In-memory session
    state = store.initialize_new_company(
        name="My Spawned Venture",
        pitch=pitch,
        description="A campaign forged in QuestForge."
    )
    store.log_event(EventType.SESSION_START, "system", "Initialized fresh campaign session and spawned character workforce.")
    
    # 2. Master Narrator Decomposes the Pitch into 3 Quests
    narrator = MasterNarrator()
    steps_data = narrator.decompose_pitch(pitch)
    
    quest_state = QuestState(
        id="first_landing_page",
        title="Forge Your First Landing Page",
        description="Fulfill positioning, draft a page, and set up campaign outreach.",
        steps=[QuestStep(**s) for s in steps_data]
    )
    state.active_quest = quest_state
    store.save()
    
    store.log_event(EventType.QUEST_START, narrator.name, "Decomposed pitch into active quest-steps.", {"steps": steps_data})
    
    print("\n📜 Active Quests Decomposed by Master Narrator:")
    for idx, step in enumerate(state.active_quest.steps, start=1):
        print(f"  [{idx}] {step.title} (Reward: {step.xp_reward} XP)")
        print(f"      Description: {step.description}")
        print(f"      Assigned NPC: {step.assigned_to.capitalize()}")
    
    # Party setup
    strategist = StrategistAgent()
    designer = DesignerAgent()
    marketer = MarketerAgent()
    
    # 3. Quest execution loop
    for step in state.active_quest.steps:
        print("\n" + "-" * 50)
        print(f"🚩 Current Room: {step.title}")
        print(f"NPC Active: {step.assigned_to.capitalize()} Agent")
        
        step.status = "in-progress"
        store.log_event(EventType.STEP_START, step.assigned_to, f"Beginning work on {step.id}", {"step_id": step.id})
        
        artifact_data: Dict[str, Any] = {}
        success = False
        val_results: Dict[str, Any] = {}
        
        if step.assigned_to == "strategist":
            print(f"🤖 Soren (Strategist) is formulating positioning & ICP...")
            artifact_data = strategist.formulate_positioning(pitch)
            success, val_results = validate_positioning(artifact_data)
            
        elif step.assigned_to == "designer":
            print(f"🤖 Dahlia (Designer) is structuring layout & CTAs...")
            # Retrieve positioning context from previous runs if available
            positioning = state.active_quest.steps[0].artifact_data or {}
            artifact_data = designer.build_page_structure(positioning)
            success, val_results = validate_landing_page(artifact_data)
            
        elif step.assigned_to == "marketer":
            print(f"🤖 Maddox (Marketer) is drafting launch campaign email copy...")
            # Retrieve layout structure and positioning context
            positioning = state.active_quest.steps[0].artifact_data or {}
            page_structure = state.active_quest.steps[1].artifact_data or {}
            artifact_data = marketer.draft_launch_email(positioning, page_structure)
            success, val_results = validate_marketing_email(artifact_data)
            
        step.artifact_data = artifact_data
        step.validation_results = val_results
        
        print(f"\n📦 Artifact Produced:")
        for k, v in artifact_data.items():
            print(f"   * {k}: {v}")
            
        print(f"\n⚖️  Running Code Interpreter Validation Checks...")
        print(f"   Score: {val_results.get('score', 0)}/100")
        for check, res in val_results.get("checks", {}).items():
            status_symbol = "✅" if res else "❌"
            print(f"     [{status_symbol}] {check}")
            
        if val_results.get("feedback"):
            print("   Feedback on failures:")
            for item in val_results["feedback"]:
                print(f"     - {item}")
                
        # Simulating User Decision (Verification Gate)
        print("\n🛡️  Verification Gate: Human Intercedes!")
        print("   Would you like to approve this artifact and award XP? [Y/n]")
        # Standard auto-approve for automated runs, but lets us keep the prompt semantics
        user_choice = "y"
        print(f"   [Simulation Auto-Response]: Approved with Selection: '{user_choice}'")
        
        if user_choice.lower() in ["y", "yes", ""]:
            step.status = "completed"
            state.xp += step.xp_reward
            print(f"   🎉 Approved! +{step.xp_reward} XP awarded.")
            store.log_event(EventType.STEP_APPROVED, "human_verifier", f"Approved {step.id}. XP reward claim dispatched.", {"new_xp": state.xp})
        else:
            step.status = "failed"
            print(f"   ⚠️ Rejected artifact! Step failed. Narrative corrected.")
            store.log_event(EventType.STEP_REJECTED, "human_verifier", f"Rejected {step.id}. Refinement scheduled.")
            
    quest_state.status = "completed"
    # Award quest level completions
    if state.xp >= 50:
        state.level += 1
        print(f"\n🌟 LEVEL UP! You are now Level {state.level}! Total cumulative XP: {state.xp}")
        store.log_event(EventType.LEVEL_UP, "system", f"Level up achieved: Level {state.level}", {"xp": state.xp})
        
    print("\n" + "=" * 60)
    print("🏆 QUEST LINE COMPLETED SUCCESSFULLY!")
    print("=" * 60)
    print(f"Company: {state.name}")
    print(f"Level: {state.level}")
    print(f"Total XP: {state.xp}")
    print("=" * 60)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulator for Gamifying World Improvement")
    parser.add_argument("--pitch", type=str, default="A billing tracker for contractors", help="The campaign brief to feed initial narrative generation")
    args = parser.parse_args()
    
    run_simulation(args.pitch)
