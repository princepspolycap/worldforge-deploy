"""Dilemma Generator — creates situational choice points in the story.

Every chapter that completes leads to a dilemma: a narrative choice that moves
economics, narrative momentum, and player agency forward. Dilemmas are generated
dynamically based on:

  1. Founder archetype (what they're naturally good/bad at)
  2. Antagonist strategy (what the competitor is doing)
  3. Current economics (cash, velocity, burn)
  4. Chapter outcome (what just succeeded or almost failed)

Each dilemma is a tradeoff that echoes real business pressures: speed vs.
quality, hiring vs. training, market grab vs. sustainability, etc.
"""
from __future__ import annotations

from typing import Dict, Any, Optional, List
from state.schema import Dilemma, CompanyEconomics, AntagonistState, FounderState


DILEMMA_TEMPLATES = {
    "speed_vs_quality": {
        "title": "Move Fast or Move Right?",
        "axis": "speed_vs_quality",
        "threat_framing": "{antagonist_name} just shipped a feature. Your customer sees it.",
        "option_a": {
            "label": "Ship fast, iterate later",
            "description": "Deploy the MVP now to stay ahead. Technical debt is temporary.",
            "economics": {"velocity": 20, "burn": 5, "proof": 10},
            "narrative": "You move fast. Your reputation grows. But cracks are forming.",
        },
        "option_b": {
            "label": "Perfect it first, then launch",
            "description": "Spend 2 more weeks. Ship something bulletproof.",
            "economics": {"velocity": -5, "burn": 15, "proof": 25},
            "narrative": "Delayed launch. But when you ship, it's rock solid. Trust jumps.",
        },
    },
    "hiring_vs_training": {
        "title": "Hire Specialist or Train Founder?",
        "axis": "hiring_vs_training",
        "threat_framing": "{antagonist_name} just hired 3 {skill_domain} experts. They're moving faster.",
        "option_a": {
            "label": "Hire a specialist (burn capital)",
            "description": "Bring in a {skill_domain} expert for 3 months. Expensive, fast.",
            "economics": {"velocity": 25, "burn": 40, "autonomy": -15, "proof": 5},
            "narrative": "You hire fast. Work quality improves immediately. But now you depend on them.",
        },
        "option_b": {
            "label": "Go deeper yourself (save capital)",
            "description": "Spend the next 4 weeks learning {skill_domain}. Slow but empowering.",
            "economics": {"velocity": 0, "burn": -30, "autonomy": 20, "proof": 5},
            "narrative": "You invest in yourself. It's slow, but you unlock a new superpower.",
        },
    },
    "market_grab_vs_sustainability": {
        "title": "Blitz for Market Share or Build to Last?",
        "axis": "market_grab_vs_sustainability",
        "threat_framing": "{antagonist_name} is flooding {target_customer} with discounts. Customers are tempted.",
        "option_a": {
            "label": "Match their price, grab share",
            "description": "Go aggressive on pricing. Win customers. Accept lower margins.",
            "economics": {"velocity": 15, "burn": 50, "proof": 20, "trust": -10},
            "narrative": "You grab market share fast. But margins compress. Sustainability questioned.",
        },
        "option_b": {
            "label": "Stay premium, focus on retention",
            "description": "Keep your price. Out-deliver on value. Build moat with loyal customers.",
            "economics": {"velocity": -5, "burn": -20, "proof": 15, "trust": 15},
            "narrative": "You lose some near-term share. But the customers who stay are loyal.",
        },
    },
    "outsource_vs_insource": {
        "title": "Delegate or Do It In-House?",
        "axis": "outsource_vs_insource",
        "threat_framing": "Your customer success rate is slipping. {antagonist_name} has dedicated support.",
        "option_a": {
            "label": "Hire internal team",
            "description": "Build your own {function} team. Full control, high burn.",
            "economics": {"velocity": 10, "burn": 35, "trust": 15, "autonomy": 15},
            "narrative": "You own the full value chain. It's expensive but you control quality.",
        },
        "option_b": {
            "label": "Partner with a vendor",
            "description": "Outsource {function} to specialists. Less control, lower burn.",
            "economics": {"velocity": 5, "burn": -15, "trust": 5, "autonomy": -15},
            "narrative": "You focus on core. Vendor handles logistics. Trade control for speed.",
        },
    },
    "expand_or_deepen": {
        "title": "Expand to New Markets or Deepen Current Niche?",
        "axis": "expand_vs_deepen",
        "threat_framing": "{antagonist_name} is eyeing your niche. They're well-funded.",
        "option_a": {
            "label": "Go after new customer segment",
            "description": "Pivot to {new_segment}. Diversify risk. New growth vector.",
            "economics": {"velocity": 10, "burn": 25, "proof": 10, "autonomy": 5},
            "narrative": "You spread your bets. Revenue diversifies. Complexity rises.",
        },
        "option_b": {
            "label": "Own your niche completely",
            "description": "Double down on {current_niche}. Become the undisputed leader.",
            "economics": {"velocity": 15, "burn": -10, "proof": 20, "trust": 15},
            "narrative": "You become the category. Defensible position. But limited to one segment.",
        },
    },
    "cooperative_vs_shareholder": {
        "title": "Cooperative Equilibrium or Shareholder Growth?",
        "axis": "cooperative_vs_shareholder",
        "threat_framing": "{antagonist_name} is launching a venture-backed offensive to consolidate {target_customer}. They pressure you to abandon your local focus.",
        "option_a": {
            "label": "Adopt shareholder growth model",
            "description": "Yield board seats to raise external capital. Pursue infinite growth metrics.",
            "economics": {"velocity": 30, "burn": 20, "autonomy": -25, "trust": -10},
            "narrative": "You raise funding and accelerate, but your mission is now subservient to infinite growth metrics.",
            "rule_id": "ops.shareholder",
            "id": "a",
        },
        "option_b": {
            "label": "Form a worker-cooperative alliance",
            "description": "Establish a dual-power equilibrium model with unions and mutual aid.",
            "economics": {"velocity": -10, "burn": -15, "autonomy": 30, "trust": 30},
            "narrative": "You transition to a cooperative equilibrium. Growth slows, but you weather market storms with a loyal community.",
            "rule_id": "ops.cooperative",
            "id": "b",
        },
    },
}


def generate_dilemma(
    chapter_id: str,
    chapter_title: str,
    founder: Optional[FounderState] = None,
    antagonist: Optional[AntagonistState] = None,
    economics: Optional[CompanyEconomics] = None,
    suggested_template: str = "speed_vs_quality",
) -> Dilemma:
    """Generate a situational dilemma at a chapter completion gate.

    The dilemma is rooted in the founder's archetype gap, the antagonist's move,
    and current economics. It offers two paths, each with narrative and economic
    consequences the player must weigh.

    Args:
        chapter_id: The chapter that just completed
        chapter_title: What the chapter accomplished
        founder: The player's character (to refine framing)
        antagonist: The competitive force (to add threat urgency)
        economics: Current business metrics (to make tradeoffs meaningful)
        suggested_template: Which dilemma type to use (defaults to speed_vs_quality)

    Returns:
        A Dilemma ready to present to the player.
    """
    template = DILEMMA_TEMPLATES.get(suggested_template, DILEMMA_TEMPLATES["speed_vs_quality"])

    # Build narrative framing with actual character names and stakes
    founder_name = founder.name if founder else "You"
    antagonist_name = antagonist.name if antagonist else "The Market"

    # Query the founder's growth gap (weakness) to construct the dilemma tradeoffs
    from agents.antagonist_generator import analyze_archetype_gap
    gap_info = analyze_archetype_gap(founder.archetype if founder else "Builder")
    gap_domain = gap_info["weakness"]

    context = f"""
    {founder_name}, your recent move ({chapter_title.lower()}) got your attention.
    {antagonist_name} is responding. You're at a crossroads.
    """

    threat_msg = template["threat_framing"]
    if "{antagonist_name}" in threat_msg:
        threat_msg = threat_msg.replace("{antagonist_name}", antagonist_name)
    if "{skill_domain}" in threat_msg:
        threat_msg = threat_msg.replace("{skill_domain}", gap_domain)
    if "{target_customer}" in threat_msg and antagonist:
        threat_msg = threat_msg.replace(
            "{target_customer}",
            antagonist.target_customer_overlap or "your market segment"
        )

    # Build option A and B, refining with actual economics if provided
    option_a = _build_option(template["option_a"], gap_domain, economics)
    option_b = _build_option(template["option_b"], gap_domain, economics)

    if "rule_id" in template["option_a"]:
        option_a["rule_id"] = template["option_a"]["rule_id"]
    if "rule_id" in template["option_b"]:
        option_b["rule_id"] = template["option_b"]["rule_id"]
    if "id" in template["option_a"]:
        option_a["id"] = template["option_a"]["id"]
    if "id" in template["option_b"]:
        option_b["id"] = template["option_b"]["id"]

    dilemma = Dilemma(
        id=f"dlm_{chapter_id}",
        chapter_id=chapter_id,
        title=template["title"],
        context=context.strip() + f"\n\n{threat_msg}",
        antagonist_move=antagonist.signature_tactic if antagonist else "The market has shifted.",
        option_a=option_a,
        option_b=option_b,
        tradeoff_axis=template["axis"],
    )

    return dilemma


def _build_option(base_option: Dict[str, Any], skill_domain: str, economics: Optional[CompanyEconomics] = None) -> Dict[str, Any]:
    """Materialize an option template with concrete details."""
    option = base_option.copy()

    # Substitute skill domain references
    if "{skill_domain}" in option["label"]:
        option["label"] = option["label"].replace("{skill_domain}", skill_domain)
    if "{skill_domain}" in option["description"]:
        option["description"] = option["description"].replace("{skill_domain}", skill_domain)
    if "{function}" in option["description"]:
        option["description"] = option["description"].replace(
            "{function}",
            f"{skill_domain} operations"
        )
    if "{new_segment}" in option["description"]:
        option["description"] = option["description"].replace("{new_segment}", "adjacent markets")
    if "{current_niche}" in option["description"]:
        option["description"] = option["description"].replace("{current_niche}", "your niche")

    return option


def apply_dilemma_choice(
    choice: str,  # "a" or "b"
    dilemma: Dilemma,
    economics: CompanyEconomics,
) -> Dict[str, Any]:
    """Apply the consequences of a dilemma choice to game economics.

    Returns a report: {option_taken, impacts, new_economics, narrative_consequence}.
    """
    if choice not in ("a", "b"):
        raise ValueError(f"Invalid choice: {choice}. Must be 'a' or 'b'.")

    option_key = f"option_{choice}"
    option = getattr(dilemma, option_key)

    impacts = option.get("economics", {})
    new_economics = economics.model_copy()

    # Apply impacts to economics (clamped to 0-100 for pressures)
    for metric, delta in impacts.items():
        if metric == "burn":
            new_economics.burn_pressure = max(0, min(100, new_economics.burn_pressure + delta))
        elif metric == "velocity":
            new_economics.velocity = max(0, min(100, new_economics.velocity + delta))
        elif metric == "proof":
            new_economics.proof = max(0, min(100, new_economics.proof + delta))
        elif metric == "trust":
            new_economics.trust = max(0, min(100, new_economics.trust + delta))
        elif metric == "autonomy":
            new_economics.autonomy = max(0, min(100, new_economics.autonomy + delta))

    return {
        "option_taken": option["label"],
        "narrative": option.get("narrative", ""),
        "impacts": impacts,
        "new_economics": new_economics.model_dump(),
    }


def suggest_dilemma_for_chapter(chapter_id: str, founder_archetype: str) -> str:
    """Suggest which dilemma template fits a given chapter and founder archetype."""
    if "retention" in chapter_id or "ops" in chapter_id:
        return "cooperative_vs_shareholder"
    # Simple heuristic: match founder weakness to dilemma
    suggestions = {
        "Builder": "hiring_vs_training",  # Builders struggle with people/sales
        "Seller": "market_grab_vs_sustainability",  # Sellers chase volume
        "Designer": "speed_vs_quality",  # Designers get caught perfecting
        "Operator": "expand_or_deepen",  # Operators optimize what exists
    }
    return suggestions.get(founder_archetype, "speed_vs_quality")
