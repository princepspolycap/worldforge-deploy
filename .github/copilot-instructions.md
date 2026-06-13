# Copilot Instructions — Agents League: Gamifying World Improvement

Context for any AI coding agent working in this repo. Read this before making changes.

## What we're building

A submission for **Microsoft Agents League · Battle #2 — Reasoning Agents with Microsoft Foundry**, live battle on **June 10, 2026, 9 AM PT** at Microsoft Reactor.

**Concept:** "Gamifying World Improvement" - a gamified world-improvement simulator where a player enters their public profile, a Microsoft Foundry-powered Master Narrator decomposes the mission into a campaign graph, and specialist character agents produce real artifacts the player approves at verification gates. It maps the canonical `live_battle_challenge.md` Game Master pattern onto world-improvement stakes instead of fantasy combat.

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
    ├── ui/                       # narrated story-view release UI
    └── docs/                     # architecture, demo script, rubric, pitch
```

## Current status (update this section as we progress)

- ✅ Project narrative + rubric mapping documented
- ✅ State schema (`state/schema.py`) with `CompanyState`, `QuestState`, `QuestStep`, `CharacterState`, `StateStore`
- ✅ Agent stubs (`agents/foundry_agents.py`) — Master Narrator, Strategist, Designer, Marketer with mock outputs
- ✅ Code interpreter validators (`tools/code_interpreter_wrappers.py`) — positioning, landing page, marketing email
- ✅ First quest definition (`quests/first_landing_page.yaml`)
- ✅ End-to-end CLI simulator (`tools/run_quest_simulation.py`) — runs without Azure, all checks pass
- ✅ Thinking-token capture on all reasoning paths (`last_reasoning` sinks, SSE `invoke_done`, replay log) + secret scrubber (`scrub_secrets`)
- ✅ Voice upgrade chain (`TTS_DEPLOYMENTS`: gpt-audio-1.5 family first, gpt-4o-mini-tts fallback, browser TTS net)
- ✅ Foundry hosted agent scaffold (`submission/hosted_agent/` — invocations protocol, agent.yaml, Dockerfile)
- ✅ Agent memory layer (`agents/memory.py`) — Foundry Agent Service memory store (`FOUNDRY_MEMORY_STORE`) with local `state/memory.json` fallback; user_profile / procedural / chat_summary kinds; injected into every worker brief (ContextProvider on MAF path) and written at gate decisions + chapter completion
- ✅ Four proof points on every invocation (all paths incl. simulation): `iq_hits`, `memory_injected`, `tools_called`, `inference_usage` — in `CHAPTER_EXECUTED` replay events and the story UI evidence panels; `/api/memory` endpoint exposes the learning snapshot
- ⏳ Harden live Foundry-backed runs and eval coverage
- ⏳ Expand Foundry IQ knowledge base + retrieval quality checks
- ✅ Story-view UI shell (`submission/ui/story.html` + `submission/ui/game/`)
- ✅ Verification gate UI
- ✅ Reasoning panel and evidence rail
- ✅ Onboarding UI & Audio Polish (gated unmuted intro film, zoom-pan Earth, staggered entrance transitions, synthesized ambient music and hover chime)
- ✅ MAF Agent Group Chat standup (live sequential multi-agent group chat reacting to CEO decisions)
- ⏳ Optional `deploy_landing_page` tool with simulation fallback

## Current UI/runtime notes

- **Onboarding polish**: `submission/ui/game/intro.js` owns the intro film overlay. All film skip and completion paths reveal `.first-step` with its `.enter` animation and start the synthesized ambient pad via `DungeonAudio.ambientStart()`. `?intro=0` bypasses the film and still triggers the same first-step handoff.
- **Preflight gate**: the first "Begin the run" press calls `gatherAndReady()` (story.js), which reads the form once (`readFounderInputsFromForm`), fetches/reasons the profile via `/api/company/analyze` (`analyzePayload`), and renders a reversible "ready" confirmation card. The run never starts before that information is gathered. The second press (`renderReadyCard` confirm) calls `beginStory()`, which consumes `state.preflight.ares` instead of re-scraping. The intro film handoff (`CampaignStory.start`) still calls `beginStory()` directly and falls back to reading the form itself.
- **Audio cues**: `submission/ui/game/audio.js` is pure Web Audio. Hover chimes should only fire after the audio context is unlocked; the Begin press stops the ambient pad and plays the journey-start cue.
- **MAF standup**: `/api/world/standup` builds deterministic standup turns first, then in live mode upgrades them through `submission/agents/maf_runtime.py::run_maf_group_chat`. The live path uses a sequential loop of core Microsoft Agent Framework `Agent` instances, passing prior turns as transcript context. If MAF or Foundry is unavailable, the deterministic turns remain the stable fallback.
- **Standup smoke**: run `python3 submission/tools/maf_standup_smoke_test.py` for the offline response-contract check. Run it with `--live` from a configured `DEMO_MODE=live` environment to require real MAF turns.

## Reusable resources (local-only, do not commit paths)

These exist on the maintainer's machine. Reference them when wiring features but do **not** hardcode absolute paths in committed code.

### Azure / Foundry models — reuse a local Foundry env

- **Source**: a private Foundry `.env` on the maintainer's machine (path kept out of this public repo).
- Contains private Foundry credentials, deployment names, embedding deployments, and image generation settings. Copy only the values needed into a gitignored `submission/.env`.
- **Usage**: Copy the keys you need into `submission/.env` (gitignored). Map them onto our `AZURE_AI_PROJECT_ENDPOINT` / `AZURE_AI_MODEL_DEPLOYMENT` variables in [`.env.example`](../submission/.env.example).
- **Recommended models for this build**:
  - Master Narrator + character reasoning: `gpt-5` family deployment (use whatever is current in the local Foundry env)
  - Embeddings for Foundry IQ: `text-embedding-3-large` deployment from the local Foundry env
- **Constraint**: The runtime code path must still target a Microsoft Foundry deployment (the rule above). The local env just supplies the credentials/endpoint — don't introduce non-Foundry model routes into the reasoning core.

### Azure CLI

- `az` is installed (`az --version` confirmed 2.67.0). Use it for any quota checks, deployment listings, or resource provisioning before writing new infra.

### Game assets - generated-first, local-only enhancements

- The release UI is `submission/ui/story.html` plus the browser modules under `submission/ui/game/`.
- Old asset-heavy visual prototype notes belong in `submission/private/`, not public docs.
- **When pulling assets into this repo**: verify the asset license allows redistribution under MIT before committing. Restricted art stays local under `submission/ui/assets/local/` and remains gitignored. The committed baseline ships generated-art-first with no third-party art.

## Development conventions

- **We are in refinement mode, not greenfield. Write less code.** The system is feature-complete enough; the job now is to make it cleaner and more reliable. When you add something, look for something to remove. Prefer refactoring duplicated logic into one small, single-responsibility function over adding a parallel code path. Net lines added should trend toward zero.
- **Connect things modularly (SOLID).** Single source of truth for any DOM->state, payload, or config mapping (e.g., `readFounderInputsFromForm`, `analyzePayload` in `ui/game/story.js`). One concept, one function. Don't duplicate a request body or a parsing block in two callers - extract it and have both call it. Depend on small helpers, not on copy-paste.
- **Refactor in place before extending.** If a function is doing two jobs (e.g., reading inputs AND running the flow), split it first, then build on the clean seam. Reuse already-fetched results instead of re-fetching (the preflight gate fetches the profile once; `beginStory` consumes it).
- **Preserve local-first gameplay.** Normal play should route through local agents when configured; cloud Foundry is the fallback/escalation path for failed local turns, integration evidence, and final demo-quality reasoning.
- **Python**: 3.10+. Pydantic v2 for state models (already in use). Use `model_dump()` not `.dict()`.
- **No emojis or non-ASCII in committed source/markdown** unless they're inside a string literal that ships at runtime (e.g., CLI banner output). The CLI simulator banner is allowed; docs should stay ASCII for grep/diff cleanliness.
- **Imports**: Local imports use module paths relative to `submission/` (the simulator extends `sys.path` for now; package-ify later).
- **Tests**: when adding logic, add a `tools/` or `tests/` smoke script that runs without Azure credentials (simulation mode). The current `run_quest_simulation.py` is the pattern.
- **Logging**: use `StateStore.log_event(event_type, actor, message, payload)` for any agent/tool action so it shows up in the replay log (rubric: Reasoning visibility).
- **Branch naming**: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`. Base branch: `main`. Current feature branch: `feat/important-next-phase`.
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
# fill values from your own local Foundry env (do NOT commit submission/.env)
```

## Demo flow (what we're optimizing for)

20-min live demo on June 10:

1. **0-3 min** - Hook: story-view intro, founder frame, and live UI tour.
2. **3-10 min** - Live play: type pitch -> Narrator decomposes -> agents execute -> verification gates -> XP.
3. **10-15 min** - Code walkthrough: agent defs, IQ config, tool wrappers, state, replay log.
4. **15-18 min** - Architecture reasoning: map to canonical Game Master pattern.
5. **18-20 min** - Forkability close: `git clone`, simulation mode, YAML quest authoring.

Full script: [submission/docs/demo_script.md](../submission/docs/demo_script.md).

## Rubric — what every change should help with

| Criterion                | Weight | What helps                                                                 |
| ------------------------ | -----: | -------------------------------------------------------------------------- |
| Accuracy & Relevance     |    25% | Tighter mapping to `live_battle_challenge.md` primitives                   |
| Reasoning & Multi-step   |    25% | Visible decomposition, tool calls in replay log, multi-hop chains          |
| Reliability & Safety     |    20% | Verification gates, simulation fallbacks, deterministic validators         |
| Creativity & Originality |    15% | World-improvement campaign framing, generated lore, dynamic workforce loop |
| UX & Presentation        |    15% | Story-view polish, narration, evidence rail, verification gates            |

(Official weights from `live_battle_challenge.md` Evaluation Criteria; no community-vote criterion exists in the spec.)

Full breakdown: [submission/docs/rubric_mapping.md](../submission/docs/rubric_mapping.md).

## When in doubt

- Re-read [PROJECT_NARRATIVE.md](../PROJECT_NARRATIVE.md) and [starter-kits/2-reasoning-agents/live_battle_challenge.md](../starter-kits/2-reasoning-agents/live_battle_challenge.md).
- Prefer shipping a small, working slice over a big half-built feature. The demo is live and ~3 weeks out.
- Ask the maintainer before adding any non-Foundry dependency to the reasoning path or any non-MIT-compatible asset to the repo.
