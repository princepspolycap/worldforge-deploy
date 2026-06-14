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
            "The Automation Cartel",
            "BuildCo Infinite",
            "The Technofeudal Syndicate",
            "DevOps Oligarchy",
        ],
        "threat_description": "A highly-capitalized technical conglomerate using AI and automated systems to eliminate labor costs and capture market share.",
        "signature_tactic": "Automated replacement: deploying zero-labor algorithmic replicas of your core service.",
        "strengths": [
            "rapid automation",
            "machine learning leverage",
            "infrastructure lock-in",
            "capital consolidation"
        ],
        "strategy": "Accumulate technical capital ($R > G$) to commoditize the developer tier and reduce switching costs.",
        "motivation": "Maximum accumulation: automating the production line to eliminate the wage expense.",
    },
    "Seller": {
        "threat_type": "market",
        "name_templates": [
            "The Shareholder Syndicate",
            "Closing Force Venture",
            "Venture Dynamics Inc",
            "The Infinite Trust",
        ],
        "threat_description": "A ruthless commercial force that prioritizes stock buybacks, debt-leveraged acquisitions, and aggressive account consolidation.",
        "signature_tactic": "Fascist-style market containment: forcing customers into exclusive contracts to lock out organic alternatives.",
        "strengths": [
            "VC funding leverage",
            "corporate lobbying",
            "account acquisition",
            "monopolization paths"
        ],
        "strategy": "Blitzscale using massive quantitative-easing debt to starve and buy out community competitors.",
        "motivation": "Infinite growth: meeting the return expectations of the top 1% shareholders at all costs.",
    },
    "Designer": {
        "threat_type": "market",
        "name_templates": [
            "The Dopamine Cartel",
            "Engagement Lab",
            "Speculative Joy Inc",
            "The Hype Machine",
        ],
        "threat_description": "A venture-backed speculatively inflated competitor that sells hyper-delightful experiences built on addictive dopamine feedback loops.",
        "signature_tactic": "Cognitive capture: using addictive algorithmic design to trigger customer FOMO, alienation, and despair.",
        "strengths": [
            "behavioral manipulation",
            "speculative marketing",
            "viral distribution",
            "attention harvesting"
        ],
        "strategy": "Generate asset inflation by hyping virtual realities and AI bubbles to attract speculative investment.",
        "motivation": "Speculative exit: inflating stock valuation through pure hype before the bubble bursts.",
    },
    "Operator": {
        "threat_type": "market",
        "name_templates": [
            "Process Oligarchy",
            "Efficiency Bureau",
            "Lean Machine Consolidation",
            "The Equilibrium Crushing Group",
        ],
        "threat_description": "A ruthlessly optimized operations network designed to underprice you by outsourcing and slashing wages to the absolute minimum.",
        "signature_tactic": "Wage suppression: transforming high-paying creative work into piecework training tasks for automated algorithms.",
        "strengths": [
            "offshore outsourcing",
            "cost-minimization metrics",
            "supply chain control",
            "regulatory arbitrage"
        ],
        "strategy": "Consolidate distribution networks and lock out local cooperatives from the supply chains.",
        "motivation": "Operational dominance: eliminating human friction and wages to maximize returns per dollar.",
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
