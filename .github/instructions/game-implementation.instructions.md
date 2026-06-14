---
description: "Use when implementing, refining, running, or debugging the playable game in submission/ (the card-stacking roguelike world-improvement sim). Covers the end-to-end gameplay loop, how the game systems connect (state save/load, world state, agents, economics/burn, cards, antagonist, game-over), the Game-Master-LLM vs tool split, design-language and no-duplication rules, and the run/simulation commands. Read before adding game dynamics or wiring a feature through the full user experience."
name: "Game Implementation & Run Guide"
applyTo: "submission/agents/**, submission/state/**, submission/tools/**, submission/ui/**"
---

# Game Implementation & Run Guide

This is the playable game: a **card-stacking roguelike** where a founder's pitch becomes
an 8-stage venture run. A Master Narrator decomposes the world, designed digital-worker
agents execute stages, the CEO (player) makes gated decisions, an antagonist escalates,
and the company's economics (burn vs revenue) tick toward victory or game-over.

Read this alongside the always-on [.github/copilot-instructions.md](../copilot-instructions.md).
That file owns the hard rules (Foundry-only reasoning, MIT, `submission/` only, secrets).
This file owns _how the game is built, connected, and run_.

## Prime directive: refine and connect, don't bolt on

We are in **refinement mode, not greenfield**. The systems below already exist. The job is
to connect them into one coherent, end-to-end playthrough, not to add parallel features.

- **Defer new features. Connect existing ones.** Before writing a new system, find the one
  that already does ~80% of it and wire into it. Net new lines should trend toward zero.
- **One concept, one function (SOLID).** A DOM->state, payload, config, or economics mapping
  lives in exactly one place. Reuse the single-source helpers (see "Frontend seams"). Never
  copy a request body or a parsing block into a second caller.
- **No duplicate components.** Reuse the existing card, panel, rail, gate, and HUD renderers
  and the existing CSS tokens. If you need a variant, extend the token/renderer, don't fork it.
- **Stay in the design language.** Colors, fonts, spacing, and motion come from
  [submission/ui/game/tokens.js](../../submission/ui/game/tokens.js) and the CSS variables in
  [submission/ui/story.html](../../submission/ui/story.html). Do not introduce new palettes,
  one-off inline colors, or ad-hoc animations.
- **Refactor in place before extending.** If a function does two jobs, split it on the clean
  seam first, then build on the seam.

## Every task must thread the full loop

A change is not done until it works **end-to-end through the real user experience**. For any
game-affecting task, verify the whole thread:

1. **Input** reaches state through the single-source helper (not a fresh ad-hoc read).
2. **State mutates** on the Pydantic models in [submission/state/schema.py](../../submission/state/schema.py).
3. **State persists**: `StateStore.save()` writes `state.json`; `StateStore.log_event(...)`
   appends to the replay log. Every agent/tool action logs an event.
4. **State is retrievable**: a reload (`GET /api/state`) rehydrates the exact same run.
5. **Agents are tracked**: each worker turn records a `WorkerInvocation` (tokens, tools, IQ
   hits, reasoning) so the receipts render on the card backs and evidence rail.
6. **UI re-syncs** from the returned state via the existing sync helpers.

If a feature can't survive a server restart + page reload, it isn't wired correctly yet.

## System map (the seams to connect into)

### Backend — [submission/tools/server.py](../../submission/tools/server.py)

FastAPI routes, grouped by subsystem. Wire into these; do not invent parallel endpoints.

- **Onboarding / analyze**: `POST /api/founder/analyze` (pitch or URL -> founder profile +
  `design_org` + forge antagonist), `POST /api/founder/generate-avatar`, `POST /api/init`.
- **World design**: `POST /api/world/design` (8-stage Story-Circle graph; carries forward a
  prior chartered org).
- **Gameplay loop**: `POST /api/world/run-next` (execute next stage), `POST /api/world/autoplay`,
  `POST /api/dilemma` (CEO choice gate), `POST /api/decision` (apply consequences),
  `POST /api/world/standup` + `/respond` (live multi-agent reaction).
- **Card game**: `POST /api/game/turn/start|card/play|reward/claim|turn/end|room/choose`.
- **State / memory / mode**: `GET /api/state`, `GET /api/game`, `GET /api/memory`, `GET /api/mode`,
  `POST /api/reset`.
- **Narration / tools**: `POST /api/tts`, `GET /api/voices`, `POST /api/lore`,
  `GET /api/toolbox` + `POST /api/toolbox/call`.

### State — [submission/state/](../../submission/state/)

- [schema.py](../../submission/state/schema.py): `CompanyState` (root), and `StateStore`
  (load/save to `submission/state/state.json`, atomic write, `log_event`). Sub-models:
  `WorldGraph`/`Stage`/`WorkerInvocation`, `OrgBlueprint`/`OrgRole`, `CompanyEconomics`,
  `GameRunState`/`GameCard`, `AntagonistState`/`AntagonistArc`, `ChoiceRecord`.
- [consequences.py](../../submission/state/consequences.py): `initialize_economics_from_org`,
  `apply_decision_consequence` + the deterministic `RULES` map. **All economics mutation lives
  here** — do not mutate economics inline in `server.py`.
- [game_state.py](../../submission/state/game_state.py): roguelike layer (`initialize_game_run`,
  `play_card`, `claim_reward_card`, turn/room flow, antagonist pressure, run status).
- [events.py](../../submission/state/events.py): replay `EventType` contract.
- [api_contract.py](../../submission/state/api_contract.py): canonical response shapes — use
  its helpers so every route returns the same envelope.

### Agents — [submission/agents/](../../submission/agents/)

Two distinct kinds. Keep them separate.

- **Game-Master / reasoning LLMs (Foundry-native):** `foundry_agents.py` (Narrator + character
  reasoners), `world_designer.py` (`design_world`), `org_designer.py` (`design_org`),
  `worker_factory.py` (`execute_stage` — the worker that proposes the move), `maf_runtime.py`
  (Microsoft Agent Framework path + group chat), `antagonist_generator.py`, `founder_analyst.py`.
- **Infrastructure / tools (not reasoning):** `model_config.py` (routing + auth),
  `memory.py` (`remember`/`recall_memories`), `retrieval.py` (`retrieve` = Foundry IQ),
  `worker_economics.py` (the cost model).
- **Routing**: `model_config.runtime_mode()` returns `simulation | local | live | hybrid` from
  `DEMO_MODE` + `AGENT_ROUTING`. Never hardcode a model name in agent code — read deployments
  from env via `model_for(role)`.

### Frontend seams — [submission/ui/](../../submission/ui/)

Shell is [story.html](../../submission/ui/story.html); logic is the modules under
[submission/ui/game/](../../submission/ui/game/). Single-source-of-truth helpers in
[story.js](../../submission/ui/game/story.js) — call these, never re-read the DOM or rebuild a
payload yourself:

- `readFounderInputsFromForm()` (DOM -> inputs), `analyzePayload()` (inputs -> request body).
- `setEconHud(org)` (economy HUD), `setOrgPanel(org)` (workforce rail), `syncGameState(game)`
  (cards/party/antagonist). The UI re-renders from server state after each call; don't keep a
  divergent client copy.
- `intro.js`, `preflight.js`, `audio.js`, `motion.js`, `tokens.js` own intro film, onboarding
  gate, Web Audio, transitions, and design tokens respectively.

## UI component layering: two agent classes, three card surfaces

The screen is a stack of layers, and every piece of it is one of two kinds of agent rendered
on one of three card surfaces. Before adding any panel, decide which class and which surface it
belongs to, then reuse that surface's renderer. Do not invent a fourth surface.

### The two agent classes (keep them visually distinct)

1. **World-engine agents (the Game-Master tier).** The Master Narrator / World Designer,
   Org Designer, and Antagonist generator in [submission/agents/](../../submission/agents/).
   They _author_ the world: the 8-stage Story Circle, the org/workforce, and the antagonist arc.
   They are not units the player commands - they are the authorship/provenance of the run. Their
   home is the footer "World Designer" chip (`#worker` in [story.html](../../submission/ui/story.html))
   and the `#scene-head` provenance line, not the playable hand. The design tokens already mark
   them with the `.pa-layer.gm` ("Worldkeeper / game master") badge.
2. **Party / digital-worker agents (the player's team).** Strategist, Designer, Marketer,
   Operations - the org built from the founder profile, executed by
   [worker_factory.py](../../submission/agents/worker_factory.py). These are the characters the
   player builds, inspects, and wins with. Their home is the `#party` hand, tagged `.pa-layer.dw`
   ("Digital Worker"). Each carries a `WorkerInvocation` of receipts (tools, IQ hits, reasoning).

The two classes share the `#party` tray grammar but must read as different layers via the
`.pa-layer.gm` vs `.pa-layer.dw` badge and accent - never collapse them into one undifferentiated
row, and never render a world-engine agent as a playable party card or vice versa.

### The three card surfaces

1. **Party worker cards** (`#party .party-agent`, rendered by `syncGameState`/party render in
   [story.js](../../submission/ui/game/story.js)). The card _is_ the inspector: front =
   identity + the two headline metrics + the current Story-Circle beat line; back (flip on
   click/tap) = the dossier receipts (tools the model called, IQ recalls, reasoning quote, full
   metric grid). The flip CSS already exists in [story.html](../../submission/ui/story.html)
   (`.pa-inner` `preserve-3d`, `.pa-face` `backface-visibility:hidden`, the 540ms transform).
   **Today a click opens a separate `#cast-stage.inspect` overlay that duplicates the dossier -
   that is the no-duplicate-component violation to retire.** Wire the click to add a `flipped`
   class on `.pa-inner` and render the existing `cast-dossier` markup onto a `.pa-back` face, so
   there is exactly one card component with two faces and no second modal.
2. **World / stage cards** (the `#diagram` centre - the 8-node Story-Circle graph). These are
   world-engine _output_, not playable hand cards. Each node is one Story Circle beat
   (YOU/NEED/GO/SEARCH/FIND/TAKE/RETURN/CHANGE, see
   [world_designer.py](../../submission/agents/world_designer.py)) and shows progress, which
   worker owns it, and gate state. They advance via `/api/world/run-next`, never by being
   "played" from a hand.
3. **The roguelike hand** (`#card-hand` footer buttons - "Automate Loop", "Trust Seal",
   "Counter-Position", "Customer Signal"). These are the playable deck: each is a `GameCard`
   (`kind` = worker / counterplay / proof) costing `energy`, mutating the 0-100 narrative meters
   and antagonist `threat_level` through [game_state.py](../../submission/state/game_state.py).
   They are the moment-to-moment tactical move and are distinct from both the party cards (the
   team) and the stage graph (the world). A first-time player must be able to read what each
   card does from its face (name / cost / effect via `cardEffectLine`) without a tooltip.

### The flip contract (one renderer, two faces)

Front is glanceable; back is receipts. One component owns both. If you need a deeper view, add
it to the back face, do not spawn a parallel overlay. The same rule governs the stage graph
(node front = title+owner+gate; node detail = the artifact/receipts) and the hand (card front =
effect; reward draft = the same card grammar, not a bespoke modal). Colors, spacing, motion, and
the `.gm`/`.dw` accents come only from [tokens.js](../../submission/ui/game/tokens.js) and the CSS
variables in [story.html](../../submission/ui/story.html).

### Cards are authored by the engine from real reasoning (the connected seam)

Cards are game _dynamics_; the agents are game _reasoning_. The two are wired together in
[game_state.py](../../submission/state/game_state.py): when a worker ships a stage,
`_reward_cards_from_stage` mints that stage's reward draft from the worker's **real
`WorkerInvocation` receipts** (`_invocation_for_stage`), not a fixed template. The proof card is
named for the IQ source the worker actually recalled, the leverage card for the tool it actually
called (`maf_tools_called`/`tools_drawn`), and the counter card quotes its reasoning - all
populated on every path, simulation included, and degrading to role/stage flavor when an
invocation has no receipts. The **starter deck** also carries provenance: a founder-signature card
(`_founder_signature_card`) is derived from the analyzed `founder_archetype` (Builder/Seller/
Designer/Operator -> a different strength), so even the opening hand reads as _this founder's_ deck.
Extend this seam, do not fork it; card effects must keep flowing through the economics rules, never
inline.

### Profitability is earned, not seeded

A run starts at **$0 revenue** - the company only becomes profitable when the workforce wins
customers. The single source for share -> revenue -> cash is `consequences.add_market_share`,
shared by two paths: shipping a verified stage (`apply_stage_outcome` wins market share weighted by
role and dampened by the antagonist's contest) and the **Customer Signal card** (`market_share_delta`
routed through `_apply_card_effects`). Revenue is always `market_share% x addressable_market`;
shipping/closing also books a one-time deal into the treasury. Never seed a flat revenue number -
derive it from share actually won. The footer HUD refreshes from one seam too: `setEconHud` is
called inside `setResourcesFromEconomics` so every economics change (card, reward, decision, tick)
updates the Treasury/Market/Rev/threat pills immediately.

### The antagonist loop (the lethal meter) - what "Infinite Trust" is

The rival (`AntagonistArc.threat_level`, 0-100) is the run's **lethal meter**; cheap burn means
money rarely ends a run, the antagonist does. The loop, all in
[game_state.py](../../submission/state/game_state.py) + [consequences.py](../../submission/state/consequences.py):

- **Rises:** a gentle time climb (`tick_antagonist_over_time`, faster at higher escalation stage,
  suppressed when the company is visibly winning), elite rooms, and dilemma pressure. At 100 the
  run is lost (`_refresh_run_status` / the tick's defeat).
- **Falls:** counterplay cards (`antagonist_threat_delta < 0`) and strong stage outcomes (the
  receipt-forged "Counter ..." reward card).
- **Fairness cap:** the money clock charges the full idle wall-clock, but the threat meter advances
  at most `ANTAGONIST_MAX_CATCHUP_DAYS` per observation - an idle/away gap (app closed, reading
  dossiers, a reload) can **never** jump straight to defeat. The rival climbs from engaged play
  over time, not from the wall-clock running unwatched.
- **UI:** the econ HUD pill reads `threat/100 . <stage>` with a one-line explanation, and
  counterplay cards in the hand pulse (`.counter-hot`) once threat is non-trivial so the player
  learns the counter. Keep this loop legible: every threat change must be visible and attributable.

### Open threads to tidy (wire through the source, do not patch the UI)

- **The run is named from the pitch, but URL-only sim runs still fall back.** `derive_run_name`
  ([world_designer.py](../../submission/agents/world_designer.py)) deterministically names the run
  from a real pitch ("Solar microgrids for rural clinics" -> "Solar Microgrids"), wired into both
  `/api/founder/analyze` and `/api/world/design` and carried forward on resume. It is gated to a
  real pitch (never a bare URL) and bails to the placeholder for anything ambiguous. The remaining
  gap: a **URL-only** LinkedIn run in simulation still shows the placeholder; the proper fix is to
  have the live World Designer emit a `run_name` (and personalize the 8 beat titles) from the
  analyzed profile, so the live path names URL runs too. **Resume is not broken** -
  `restoreRunFromState` faithfully rehydrates stages, index, org, and economics from `state.json`.
  The fix is upstream: have the World Designer name the run and title the 8 beats from the analyzed
  profile so saved data reads as _this founder's_ run, then resume shows the personalized world.
- **Hand legibility - done; keep it.** Each `#card-hand` card shows a kind badge (color-coded),
  cost, name, polarity-colored consequence chips (`cardEffectChips`: gain / cost / threat /
  customers), and a provenance line (`cardSourceLine`: "starter deck", "your signature move", or
  "forged by &lt;worker&gt;"). Reward-draft cards name the real tool/IQ source the worker used (see
  "Cards are authored by the engine"). Reuse this one grammar; never fork a second card renderer.

## Economics: burn is the honest cost of running a digital workforce

The premise is leverage: a solo founder runs an AI-native company whose digital workers do the
work of a full human team for a fraction of the cost. So **burn = the real, cheap cost of
running the workforce**, and the wow is the **savings vs. an equivalent human team**.

- **Burn = run cost (cheap), not human wages.** Each digital worker's `monthly_cost_usd` is its
  real monthly RUN cost (pinned cheap model inference + tooling), reasoned per-role by the model
  or derived from `worker_economics.projected_monthly_cost_usd`. `monthly_burn_usd` = sum of run
  costs. The human operator costs 0 (the founder takes no salary).
- **Savings is the headline.** Each role also carries `human_median_usd` - what a person in that
  seat would cost today. The org totals `monthly_human_equivalent_usd` and
  `monthly_savings_usd` (= human-equivalent - burn). This is never charged; it is the
  "you replaced a $48k/mo team with a $300/mo one" story on the org panel. `inference_usd`
  equals the run cost (dossier color).
- **The real-time clock lives in one place:** [submission/state/consequences.py](../../submission/state/consequences.py)
  `tick_economy(state)`. It converts elapsed wall-clock into in-game days, charges
  `days * (daily_burn - daily_revenue)` to the treasury (`economics.points`, in USD), updates
  `days_elapsed` / `daily_burn_usd` / `runway_days`, and flips the run to defeat when the
  treasury hits 0. `initialize_economics_from_org` seeds a **fixed founder seed**
  (`FOUNDER_SEED_USD`, default ~$25k bootstrap capital). Because the workforce runs cheap, this
  is a generous, honest runway - the clock is real pressure but rarely the killer. The server
  calls `tick_economy` on every `/api/state` and `/api/game` read (and persists), so the HUD
  drains live; the UI also polls via `ensureEconClock` in
  [story.js](../../submission/ui/game/story.js).
- **The live threat is the antagonist and the narrative meters,** not payroll. With cheap burn,
  runway is long; a run is lost when the antagonist's `threat_level` or a collapsing meter
  (trust 0, burn_pressure 100) ends it, or the player is so unprofitable that even the cheap run
  cost drains the seed. Tighten pressure via the antagonist arc and meters, not by inflating burn.
- **Do the math, don't fabricate.** Derive every dollar from the run-cost sum, the
  human-equivalent sum, or real token usage. Never invent a figure, and coerce to finite numbers
  before rendering (a missing field must read `$0`, never `$NaN`).

## What "game over" means

Win/lose is economic and narrative, decided in the state layer (not the UI):

- **Defeat:** a narrative meter collapses or the antagonist wins (trust 0, burn_pressure 100,
  antagonist `threat_level` 100) in `game_state._refresh_run_status`, or - the soft solvency
  floor - the treasury drains to 0 (`tick_economy` drives `economics.points <= 0` ->
  `game.run_status = "defeat"`). With the cheap-run-cost model, the antagonist/meters are the
  primary threat; treasury-zero is the backstop for a wildly unprofitable run.
- **Victory:** all 8 stages completed with the treasury still solvent; the final `ops.*` choice
  colors the ending (cooperative = equilibrium win; shareholder = scaled-but-lost-autonomy).
- Treasury, daily run cost, runway (days), revenue, savings, the 0-100 narrative meters, and the
  antagonist `threat_level` update continuously through `tick_economy`,
  `apply_decision_consequence`, and `game_state.py`. The HUD must always reflect current state.

## Do we need a game engine?

**No.** Do not add Unity/Godot/Phaser or any game-engine dependency. This is a server-authored,
DOM-rendered card game: Python owns the rules/state (the "engine" is `state/` + `consequences.py`

- `game_state.py`), and the browser renders from server state with plain modules + Web Audio +
  CSS/SVG/Mermaid. A heavy engine would break forkability (must run after `git clone`), the
  Foundry reasoning path, and the simulation fallback. Improve the loop by deepening these systems,
  not by importing an engine.

## How to run it

Use the project virtualenv (`.venv`) — it has FastAPI/uvicorn. `DEMO_MODE=simulation` needs no
Azure and is the default for UI/logic iteration.

```bash
# Playable server (simulation mode, no credentials)
DEMO_MODE=simulation PORT=8070 .venv/bin/python submission/tools/server.py
# open http://127.0.0.1:8070/?intro=0

# End-to-end CLI simulator (no Azure)
python3 submission/tools/run_quest_simulation.py --pitch "Your idea here"

# Live Foundry path: copy creds, then DEMO_MODE=live (see model_cost_policy.md)
cp submission/.env.example submission/.env
```

Restarting the server is required to pick up Python changes; bump the `story.js?v=N` query in
`story.html` when changing JS so the browser drops the cached module.

## Verify before you call it done

- **Python:** `python3 -c "import ast; ast.parse(open('<file>').read())"` and run the relevant
  smoke test in `submission/tools/` (`*smoke*test*`, `run_*simulation*`) — they must pass with
  no credentials.
- **JS:** `node --check submission/ui/game/story.js`.
- **End-to-end:** drive the running server in the browser, then reload the page and confirm the
  run rehydrates from `state.json` with the same numbers. Numbers shown must be derived, never
  fabricated (carry over the hallucination discipline: estimates are labeled as estimates).
