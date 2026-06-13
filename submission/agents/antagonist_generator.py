"""Antagonist/Villain Generator — creates the story's competitive foil.

Given a founder's archetype and mission, generates a complementary antagonist that
represents the key challenge, competitor, or learning gap the founder must overcome.
This is the narrative tension point: every hero needs a worthy opponent.

Archetype pairings (founder ↔ antagonist):
  - Builder ↔ Seller (ships products but struggles to sell vs. sells but has no product)
  - Designer ↔ Operator (designs great UX but operational chaos vs. runs smooth ops but no innovation)
"""
from __future__ import annotations

from typing import Dict, Any, Optional, List
from state.schema import AntagonistState


# Archetype opposites: the natural foil for each founder type
ARCHETYPE_OPPOSITES = {
    "Builder": "Seller",
    "Seller": "Builder",
    "Designer": "Operator",
    "Operator": "Designer",
}

# Rich antagonist profiles keyed by their archetype
ANTAGONIST_PROFILES = {
    "Builder": {
        "threat_type": "market",
        "name_templates": [
            "The Tech Collective",
            "BuildCo AI",
            "Schema Masters",
            "DevOps Syndicate",
        ],
        "threat_description": "A well-funded team that builds faster, ships daily, and owns the dev ecosystem.",
        "signature_tactic": "Product velocity: releases multiple versions while you're still designing.",
        "strengths": [
            "rapid iteration",
            "technical depth",
            "engineering culture",
            "infrastructure mastery"
        ],
        "strategy": "Commoditize the tech stack to reduce switching costs and lock in network effects.",
        "motivation": "Pure engineering excellence — first to market with clean code wins.",
    },
    "Seller": {
        "threat_type": "market",
        "name_templates": [
            "The Sales Machine",
            "Closing Force",
            "Revenue Rangers",
            "Enterprise Dynamics",
        ],
        "threat_description": "A slick sales org that closes faster and owns the customer relationship.",
        "signature_tactic": "Relationship dominance: signs your target customers with better terms.",
        "strengths": [
            "deal closing",
            "relationship management",
            "large contract navigation",
            "buyer psychology"
        ],
        "strategy": "Capture the enterprise segment with aggressive account-based marketing.",
        "motivation": "Commission-driven — winning deals is winning.",
    },
    "Designer": {
        "threat_type": "market",
        "name_templates": [
            "The UX Collective",
            "Design Systems Inc",
            "User Joy Labs",
            "Experience Guild",
        ],
        "threat_description": "A design-first competitor that makes beautiful, intuitive products.",
        "signature_tactic": "Experience theft: releases a version so much cleaner that users defect.",
        "strengths": [
            "user research",
            "interaction design",
            "brand coherence",
            "delight engineering"
        ],
        "strategy": "Own the premium market segment by making competitors feel cheap.",
        "motivation": "Craft and beauty — great design is a moral imperative.",
    },
    "Operator": {
        "threat_type": "market",
        "name_templates": [
            "The Operations Cartel",
            "Process Perfection Co",
            "Efficiency Bureau",
            "Lean Machines Inc",
        ],
        "threat_description": "A ruthlessly efficient org that underprice you with half the headcount.",
        "signature_tactic": "Margin dominance: delivers similar value at 40% lower cost.",
        "strengths": [
            "process design",
            "cost management",
            "supply chain excellence",
            "team leverage"
        ],
        "strategy": "Automate every step and own the lowest-cost provider crown.",
        "motivation": "Operational excellence — maximize output per dollar.",
    }
}


def generate_antagonist(
    founder_archetype: str,
    founder_skill: str = "",
    mission_brief: str = "",
    target_customer: str = "",
) -> AntagonistState:
    """Create a worthy antagonist based on the founder's archetype.

    The antagonist represents:
    - The market gap the founder must fill (what they're NOT naturally good at)
    - A competing force with the opposite strength
    - A narrative reason for the dilemmas the player will face

    Args:
        founder_archetype: One of Builder, Seller, Designer, Operator
        founder_skill: What the founder does well (used to refine the threat)
        mission_brief: The founder's mission/pitch (adds specificity)
        target_customer: Who the founder serves (helps define the antagonist's overlap)

    Returns:
        An AntagonistState ready to persist in company state.
    """
    antagonist_archetype = ARCHETYPE_OPPOSITES.get(founder_archetype, "Seller")
    profile = ANTAGONIST_PROFILES.get(antagonist_archetype, {})

    # Pick a name from the templates
    name_templates = profile.get("name_templates", ["The Market"])
    # Use sum(ord(c)) for a deterministic choice instead of Python's unstable hash()
    hash_val = sum(ord(c) for c in founder_archetype)
    name = name_templates[hash_val % len(name_templates)]

    # Refine threat description based on mission if available
    threat_description = profile.get("threat_description", "A formidable competitor has entered the market.")
    if mission_brief:
        target = target_customer or "your market segment"
        threat_description = (
            f"A {antagonist_archetype.lower()}-first competitor targeting {target} "
            f"is executing on {mission_brief.split(':')[0].lower()}."
        )

    # Create the antagonist
    antagonist = AntagonistState(
        name=name,
        archetype=antagonist_archetype,
        threat_type=profile.get("threat_type", "market"),
        threat_description=threat_description,
        strengths=profile.get("strengths", []),
        strategy=profile.get("strategy", "Outcompete on their core strength."),
        signature_tactic=profile.get("signature_tactic", "Execute faster and better."),
        target_customer_overlap=target_customer or "similar customer segment",
        motivation=profile.get("motivation", "Beat the incumbent."),
    )

    return antagonist


def analyze_archetype_gap(founder_archetype: str) -> Dict[str, Any]:
    """Explain what the founder's archetype is naturally weak at.

    Used for narrative framing and dilemma generation.
    """
    gaps = {
        "Builder": {
            "weakness": "sales and customer connection",
            "growth_path": "learn to sell what you build",
            "danger": "ships great product nobody knows about",
        },
        "Seller": {
            "weakness": "product design and UX",
            "growth_path": "learn to design experiences",
            "danger": "sells solutions that frustrate users",
        },
        "Designer": {
            "weakness": "operations and business mechanics",
            "growth_path": "learn to scale operations",
            "danger": "beautiful things that don't reach the market",
        },
        "Operator": {
            "weakness": "innovation and differentiation",
            "growth_path": "learn to build new things",
            "danger": "runs efficient machinery without a clear purpose",
        },
    }
    return gaps.get(founder_archetype, gaps["Builder"])
