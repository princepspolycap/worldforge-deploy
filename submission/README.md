# Gamifying World Improvement

**A card-stacking roguelike RPG powered by Microsoft Foundry reasoning agents.**

Reasoning Agents submission for Microsoft Agents League, Battle #2.

You sit in the founder's chair and pitch a world-improvement campaign - solar
microgrids for rural clinics, food-security logistics, clean water access. A
Microsoft Foundry-powered Master Narrator decomposes that mission into an 8-stage
Story Circle graph. A digital workforce - Strategist, Designer, Marketer, Operations
- is designed on the spot from your profile. Then the campaign runs like a roguelike
deckbuilder: workers execute stages, you play cards from a hand of tactical moves,
dilemma gates force real founder choices, a rival antagonist escalates pressure, and
nothing counts until you press the verification seal.

The player decides. The agents execute. The human verifies. The world improves.

## Why this is a game, not a dashboard

- **Roguelike card hand.** Each run gives you a starting deck built from your
  founder archetype. Cards cost energy, produce market share, raise trust, and
  counter the rival. Reward cards are forged from the real tool calls and IQ
  sources your workers actually used - not templates.
- **8-stage Story Circle (world graph).** Every run is a dependency-ordered DAG:
  YOU / NEED / GO / SEARCH / FIND / TAKE / RETURN / CHANGE. Each node is a
  stage owned by a worker. The graph is designed by a reasoning agent, not
  hand-authored.
- **Antagonist pressure.** A rival (named from market forces, never from your
  name) escalates a 0-100 threat meter. The clock is real pressure.
- **Party worker cards.** The workforce is your playable party: flip a card to
  see the dossier - tools called, IQ recalled, reasoning quote, metric grid.
- **Verification gates.** Every artifact is scored by a deterministic validator
  before you approve it. Nothing advances on vibes alone.

## Award positioning

| Award target | Why this project qualifies |
|---|---|
| **Best Overall Agent** | Most complete reasoning-agent demo: multi-step decomposition, MAF group chat, IQ citations, four proof points per invocation, simulation fallback, human verification gates |
| **Best Reasoning Agent** | World Designer decomposes pitch -> Org Designer builds workforce -> workers execute with recall + memory + tool calls + validation; CEO decisions chain across all 8 stages |
| **Best Use of IQ Tools** | Foundry IQ grounds every worker brief with cited playbook knowledge; evidence rail shows IQ hits live; local `knowledge/` folder is the forkable fallback |
| **Hack for Good** | The premise IS community benefit: solo founders run world-improvement campaigns (climate, health, food, housing) with an AI workforce fraction of the cost of a human team |
| **Accessibility Award** | Keyboard-first grammar (space/arrows/1-4 keys); mic voice input; TTS narration on every beat; no color-only information; verification gate never requires mouse |

Prize rules allow stacking one main-track prize (Best Overall or Best Reasoning) with
the "otherwise noted" special prizes (Hack for Good, Accessibility) - see
[docs/rubric_mapping.md](docs/rubric_mapping.md) for the full prize and checklist breakdown.

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

## Local Agent Gameplay With Ollama

Normal gameplay can run through a local OpenAI-compatible model. Ollama is the
recommended default local runtime.

```bash
# 1. Confirm Ollama is running and has a model
ollama list

# If needed, pull a small model first
ollama pull llama3.2:3b

# 2. Smoke-test the same local route the game uses
LOCAL_AGENT_MODEL=llama3.2:3b \
  .venv/bin/python submission/tools/ollama_local_smoke_test.py

# 3. Start the game in local-agent mode
DEMO_MODE=local \
AGENT_ROUTING=local_first \
LOCAL_AGENT_BASE_URL=http://localhost:11434/v1 \
LOCAL_AGENT_API_KEY=ollama \
LOCAL_AGENT_MODEL=llama3.2:3b \
PORT=8787 \
  .venv/bin/python submission/tools/server.py
```

Then open `http://127.0.0.1:8787/?intro=0`.

On this machine, the local Ollama runtime has been verified with `gemma4:e4b`:

```bash
LOCAL_AGENT_MODEL=gemma4:e4b \
  .venv/bin/python submission/tools/ollama_local_smoke_test.py
```

Cloud Foundry remains the fallback/escalation path. For hybrid runs, keep
`AGENT_ROUTING=local_first`, configure the `LOCAL_*` variables above, and also
set the cloud `NARRATOR_MODEL`, `STRATEGIST_MODEL`, `DESIGNER_MODEL`,
`MARKETER_MODEL`, `OPS_MODEL`, `NPC_FAST_MODEL`, and `FOUNDRY_FALLBACK_MODEL`.
