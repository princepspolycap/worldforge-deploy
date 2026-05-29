# Copilot Instructions — Agents League: Your Company Is the Dungeon

Context for any AI coding agent working in this repo. Read this before making changes.

## What we're building

A submission for **Microsoft Agents League · Battle #2 — Reasoning Agents with Microsoft Foundry**, live battle on **June 10, 2026, 9 AM PT** at Microsoft Reactor.

**Concept:** "Your Company Is the Dungeon" — a side-scrolling, multi-agent RPG where the player pitches a business idea, a Foundry Master Narrator decomposes it into a quest line, and specialist character agents (Strategist, Designer, Marketer) produce real artifacts the player approves at verification gates. Direct reskin of the canonical `live_battle_challenge.md` example with business stakes instead of fantasy.

Authoritative narrative: [PROJECT_NARRATIVE.md](../PROJECT_NARRATIVE.md). Official spec to map against: [starter-kits/2-reasoning-agents/live_battle_challenge.md](../starter-kits/2-reasoning-agents/live_battle_challenge.md).

## Hard rules (non-negotiable)

1. **All reasoning agents run on Microsoft Foundry models.** Master Narrator + character agents = Foundry-native. Other model vendors can ONLY be invoked as tools (and only if needed at all).
2. **Use the required scaffold primitives**: Foundry IQ (retrieval), code interpreter (deterministic tools), multi-agent orchestration. Showing all three is part of the rubric.
3. **Forkable, MIT-licensed, runnable after `git clone`.** No proprietary dependencies in the reasoning path. Poly backend = optional tool with simulation fallback.
4. **All new code lives under `submission/`.** Never modify `starter-kits/` — that's upstream Microsoft content and we `git pull upstream main` against it.
5. **Every artifact passes a human verification gate before XP is awarded.** This is the reliability story for the rubric.
6. **Never commit secrets.** `.env` is gitignored. Only `.env.example` ships.

## Repo layout

```
agentsleague-afterbuild/
├── PROJECT_NARRATIVE.md          # strategy + rubric mapping (READ THIS)
├── starter-kits/                 # upstream Microsoft — DO NOT MODIFY
│   └── 2-reasoning-agents/
│       ├── README.md             # async track spec
│       └── live_battle_challenge.md   # OUR canonical spec
└── submission/                   # everything we build
    ├── README.md
    ├── .env.example
    ├── agents/                   # Foundry agent definitions
    ├── tools/                    # code interpreter wrappers, simulator
    ├── state/                    # Pydantic state schemas + StateStore
    ├── quests/                   # YAML quest definitions
    ├── knowledge/                # Foundry IQ source docs
    ├── replay/                   # saved session logs
    ├── ui/                       # Phaser side-scroller (not yet built)
    └── docs/                     # architecture, demo script, rubric, pitch
```

## Current status (update this section as we progress)

- ✅ Project narrative + rubric mapping documented
- ✅ State schema (`state/schema.py`) with `CompanyState`, `QuestState`, `QuestStep`, `CharacterState`, `StateStore`
- ✅ Agent stubs (`agents/foundry_agents.py`) — Master Narrator, Strategist, Designer, Marketer with mock outputs
- ✅ Code interpreter validators (`tools/code_interpreter_wrappers.py`) — positioning, landing page, marketing email
- ✅ First quest definition (`quests/first_landing_page.yaml`)
- ✅ End-to-end CLI simulator (`tools/run_quest_simulation.py`) — runs without Azure, all checks pass
- ⏳ Wire agents to real Foundry SDK (currently mock returns)
- ⏳ Foundry IQ knowledge base + retrieval client
- ⏳ Phaser side-scroller UI shell
- ⏳ Verification gate UI (currently auto-approves in CLI)
- ⏳ Reasoning panel (visible decomposition tree + tool calls)
- ⏳ Optional `deploy_landing_page` tool with simulation fallback

## Reusable resources (local-only, do not commit paths)

These exist on the maintainer's machine. Reference them when wiring features but do **not** hardcode absolute paths in committed code.

### Azure / Foundry models — reuse Poly env

- **Source**: `/Users/princeps/Projects/Poly186/Poly/.env`
- Contains private Foundry credentials, deployment names, embedding deployments, and image generation settings. Copy only the values needed into a gitignored `submission/.env`.
- **Usage**: Copy the keys you need into `submission/.env` (gitignored). Map them onto our `AZURE_AI_PROJECT_ENDPOINT` / `AZURE_AI_MODEL_DEPLOYMENT` variables in [`.env.example`](../submission/.env.example).
- **Recommended models for this build**:
  - Master Narrator + character reasoning: `gpt-5` family deployment (use whatever is current in Poly env)
  - Embeddings for Foundry IQ: `text-embedding-3-large` deployment from Poly env
- **Constraint**: The runtime code path must still target a Microsoft Foundry deployment (the rule above). Poly env just supplies the credentials/endpoint — don't introduce non-Foundry model routes into the reasoning core.

### Azure CLI

- `az` is installed (`az --version` confirmed 2.67.0). Use it for any quota checks, deployment listings, or resource provisioning before writing new infra.

### Game assets — reuse Polyverse

- **Asset catalog**: `/Users/princeps/Projects/Poly186/Polyverse/docs/asset_catalog.md`
- **Asset sources**:
  - `Modern Interiors RPG Tileset.zip` and `Modern Office Revamped v1.2.zip` (in `Polyverse/docs/`)
  - Extracted PNGs: `/Users/princeps/Projects/Poly186/Polyverse/frontend/public/assets/raw/office/` and `.../interiors/`
- **Existing Phaser usage in Polyverse** confirms our UI framework choice — Phaser, with 32x32 tilesets, preloader pattern, scene-per-room.
- **When pulling assets into this repo**: copy needed sprites into `submission/ui/assets/` and verify the asset pack license allows redistribution under MIT before committing. If licenses are restrictive, load locally only and add to `.gitignore`.

## Development conventions

- **Python**: 3.10+. Pydantic v2 for state models (already in use). Use `model_dump()` not `.dict()`.
- **No emojis or non-ASCII in committed source/markdown** unless they're inside a string literal that ships at runtime (e.g., CLI banner output). The CLI simulator banner is allowed; docs should stay ASCII for grep/diff cleanliness.
- **Imports**: Local imports use module paths relative to `submission/` (the simulator extends `sys.path` for now; package-ify later).
- **Tests**: when adding logic, add a `tools/` or `tests/` smoke script that runs without Azure credentials (simulation mode). The current `run_quest_simulation.py` is the pattern.
- **Logging**: use `StateStore.log_event(event_type, actor, message, payload)` for any agent/tool action so it shows up in the replay log (rubric: Reasoning visibility).
- **Branch naming**: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`. Working branch right now: `feat/dungeon-engine-scaffold`.
- **Commits**: small, scoped, imperative subject (e.g., `add Foundry IQ retrieval client`).

## How to run things locally

```bash
# from repo root
python3 -m venv .venv && source .venv/bin/activate
pip install pydantic pyyaml  # add more as needed; no requirements.txt yet

# end-to-end simulator (no Azure required — uses mock agent outputs)
python3 submission/tools/run_quest_simulation.py --pitch "Your idea here"

# to wire real Foundry calls
cp submission/.env.example submission/.env
# fill values from /Users/princeps/Projects/Poly186/Poly/.env (do NOT commit submission/.env)
```

## Demo flow (what we're optimizing for)

20-min live demo on June 10:

1. **0–3 min** — Hook: side-scroller title screen, tour the UI.
2. **3–10 min** — Live play: type pitch → Narrator decomposes → 3 character agents execute → verification gates → XP.
3. **10–15 min** — Code walkthrough: agent defs, IQ config, tool wrappers, state, replay log.
4. **15–18 min** — Architecture reasoning: map to canonical Game Master pattern.
5. **18–20 min** — Forkability close: `git clone`, YAML quest authoring.

Full script: [submission/docs/demo_script.md](../submission/docs/demo_script.md).

## Rubric — what every change should help with

| Criterion                | Weight | What helps                                                         |
| ------------------------ | -----: | ------------------------------------------------------------------ |
| Accuracy & Relevance     |    20% | Tighter mapping to `live_battle_challenge.md` primitives           |
| Reasoning & Multi-step   |    20% | Visible decomposition, tool calls in replay log, multi-hop chains  |
| Reliability & Safety     |    20% | Verification gates, simulation fallbacks, deterministic validators |
| Creativity & Originality |    15% | Side-scroller game-feel, business-dungeon framing                  |
| UX & Presentation        |    15% | Phaser polish, NPC dialogue, XP/level-up animations                |
| Community Vote           |    10% | Pending confirmation from Carlotta                                 |

Full breakdown: [submission/docs/rubric_mapping.md](../submission/docs/rubric_mapping.md).

## When in doubt

- Re-read [PROJECT_NARRATIVE.md](../PROJECT_NARRATIVE.md) and [starter-kits/2-reasoning-agents/live_battle_challenge.md](../starter-kits/2-reasoning-agents/live_battle_challenge.md).
- Prefer shipping a small, working slice over a big half-built feature. The demo is live and ~3 weeks out.
- Ask the maintainer before adding any non-Foundry dependency to the reasoning path or any non-MIT-compatible asset to the repo.
