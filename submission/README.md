# Your Company Is the Dungeon

Reasoning Agents submission for Microsoft Agents League, Battle #2.

This project turns the live battle RPG prompt into a business-building quest game: the player pitches a company idea, a Foundry-powered Master Narrator decomposes it into a quest line, specialist character agents execute each step, and the player verifies artifacts before XP is awarded.

## Current Status

- The full vision, lore, CEO role-play frame, two missions, and project evolution are documented in [docs/vision_and_evolution.md](docs/vision_and_evolution.md).
- Concept narrative is captured in [../PROJECT_NARRATIVE.md](../PROJECT_NARRATIVE.md).
- Official challenge references remain untouched under [../starter-kits/2-reasoning-agents](../starter-kits/2-reasoning-agents).
- This `submission/` folder is reserved for our build, docs, agent code, tools, state, knowledge, quests, UI, and replay logs.
- The current playable shell uses FastAPI plus Phaser: pitch entry, quest state, three NPC rooms, room-gated agent turns, verification gates, XP, streak bonuses, autoplay, and sprite/procedural rendering fallback.
- The next design step is mapped in [docs/game_loop.md](docs/game_loop.md): split the prototype UI code into smaller browser modules, move room metadata into data, and grow the experience into a proper game foundation.
- Sprite-game mechanics are mapped in [docs/sprite_game_mechanics.md](docs/sprite_game_mechanics.md): reusable movement, room, animation, reward, and automation patterns for the next game-feel pass.

## Phase 1 Demo Scope

Build one end-to-end quest line:

1. Player enters a business pitch.
2. Master Narrator creates a 3-step launch quest.
3. Strategist produces positioning and ICP.
4. Designer produces a landing-page artifact.
5. Marketer produces launch email copy.
6. Code tools validate outputs.
7. Player approves or rejects each artifact.
8. XP is awarded and the replay log is saved.

## Architecture Rules

- Foundry is the reasoning core: Master Narrator and character agents run on Microsoft Foundry models.
- Foundry IQ grounds the agents in curated business-launch knowledge.
- Code tools handle deterministic checks such as URL status, email validation, and scoring.
- Poly backend integrations are optional tools only, with simulation fallbacks.
- The repo must remain forkable and runnable without proprietary infrastructure.

## Planned Structure

```text
submission/
|-- agents/       # Master Narrator and character agent implementations
|-- docs/         # architecture, demo script, rubric mapping, external messaging
|-- knowledge/    # Foundry IQ source docs and sample knowledge
|-- quests/       # YAML quest definitions
|-- replay/       # saved demo session logs
|-- state/        # shared company/quest/agent state schemas and persistence
|-- tools/        # validation, retrieval, deployment, and simulation tools
`-- ui/           # side-scroller experience
```

## Setup Checklist

- [ ] Confirm Azure Foundry project endpoint and model deployment.
- [x] Decide UI stack: Phaser for the side-scroller, served by FastAPI for the current demo shell.
- [ ] Keep all third-party game art out of the public fork (geometric-first ships MIT-clean).
- [ ] Choose the project codename for package naming and branding.
- [ ] Ask Carlotta whether community voting applies to the invitational live battle.
- [x] Create the first working quest definition.
- [x] Implement Foundry agent stubs and simulation mode.
- [x] Build the first side-scroller shell and verification gate.
- [ ] Refactor the prototype UI into smaller game modules.
- [ ] Wire real Foundry-backed calls behind the existing simulation fallback.

## Local Environment

Copy [.env.example](.env.example) to `.env` and fill in local values. Do not commit `.env`.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r submission/requirements.txt

# end-to-end CLI simulator (no Azure required)
python3 submission/tools/run_quest_simulation.py --pitch "Your idea here"
```

For Foundry-backed runs, copy the keys you need from your own local Foundry env
(kept off this public repo) into `submission/.env`.
