# Gamifying World Improvement

Reasoning Agents submission for Microsoft Agents League, Battle #2.

This project turns the live battle RPG prompt into a gamified world-improvement simulator: the player enters their public profile, a Foundry-powered Master Narrator decomposes the mission into a campaign graph, a customized AI workforce executes each step, and the player verifies artifacts at gates before XP is awarded.

## Current Status

- The full vision, lore, CEO role-play frame, two missions, and project evolution are documented in [docs/vision_and_evolution.md](docs/vision_and_evolution.md).
- Public concept narrative is captured in [../PROJECT_NARRATIVE.md](../PROJECT_NARRATIVE.md).
- Microsoft platform/source links and submission notes are captured in [docs/microsoft_platform_references.md](docs/microsoft_platform_references.md).
- Official challenge references remain untouched under [../starter-kits/2-reasoning-agents](../starter-kits/2-reasoning-agents).
- This `submission/` folder is reserved for our build, docs, agent code, tools, state, knowledge, quests, UI, and replay logs.
- The current playable shell uses FastAPI plus a narrated story view: profile entry, dynamic org design, chapter execution on Foundry deployments, verification gates, XP, animated Mermaid/SVG artifact diagrams, MAI-generated portraits, narration, and synthesized audio.
- The release game loop is mapped in [docs/game_loop.md](docs/game_loop.md): story view first, visible reasoning, human verification, and no public dependency on private art.

## Microsoft Scaffold Relationship

- `starter-kits/` is upstream Microsoft reference material and should remain untouched.
- `submission/` is our implementation.
- We used the Reasoning Agents Game Master pattern as the architecture map: orchestrator, character workers, shared state, tools, replay, and human choices.
- We did not ship the old game-art prototype as the release surface. The release surface is `submission/ui/story.html`.

## Phase 1 Demo Scope

Build one end-to-end quest line:

1. Player enters a LinkedIn or public profile URL.
2. Master Narrator creates a 3-step campaign graph.
3. Strategist produces positioning and ICP.
4. Designer produces a landing-page artifact.
5. Marketer produces launch email copy.
6. Code tools validate outputs.
7. Player approves or rejects each artifact.
8. XP is awarded and the replay log is saved.

## Architecture Rules

- Foundry is the reasoning core: Master Narrator and character agents run on Microsoft Foundry models.
- Foundry IQ grounds the agents in curated business-launch/world-improvement knowledge.
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
`-- ui/           # narrated story-view release UI
```

## Setup Checklist

- [ ] Confirm Azure Foundry project endpoint and model deployment.
- [x] Decide UI stack: a narrated story view (no bundler, vanilla JS + Mermaid) served by FastAPI.
- [ ] Keep all third-party game art out of the public fork (geometric-first ships MIT-clean).
- [x] Keep operational/demo-day planning in `submission/private/`, not public docs.
- [x] Create the first working quest definition.
- [x] Implement Foundry agent stubs and simulation mode.
- [x] Build the story-view shell and verification gate.
- [x] Split the release UI into smaller browser modules under `submission/ui/game/`.
- [ ] Wire real Foundry-backed calls behind the existing simulation fallback.

## Local Environment

Copy [.env.example](.env.example) to `.env` and fill in local values. Do not commit `.env`.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r submission/requirements.txt

# end-to-end CLI simulator (no Azure required)
python3 submission/tools/run_quest_simulation.py --pitch "Green energy grids"
```

For Foundry-backed runs, copy the keys you need from your own local Foundry env
(kept off this public repo) into `submission/.env`.
