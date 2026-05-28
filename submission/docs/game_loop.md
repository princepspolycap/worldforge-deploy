# Game Design and Build Plan

The demo should feel like a small playable game, not a form wrapped in pixel art. The player is not filling out a wizard; they are moving through a business dungeon, meeting specialist agents, judging their work, and unlocking the next room only after a useful artifact exists.

## Design Goal

Build a tight, demo-safe, side-scrolling RPG loop for reasoning agents:

1. The player enters a raw company pitch.
2. The Master Narrator decomposes it into a quest line.
3. Each room represents one agent handoff.
4. The player walks to the active NPC and starts the agent turn.
5. The agent produces an artifact, grounded by Foundry IQ and checked by deterministic tools.
6. The human verification gate approves or rejects the artifact.
7. Approval awards XP, updates streaks, and unlocks the next room.

The point is simple: orchestration becomes spatial, and verification becomes the core mechanic.

## Research Notes

- Phaser is the right UI layer for this submission because it is built for browser-first 2D games, uses familiar `preload`, `create`, and `update` scene functions, supports spritesheets and global animations, and gives us simple Arcade Physics for movement, overlap, and world bounds.
- Phaser's display list and camera model are enough for our demo: we can keep the canvas small and readable now, then grow into multiple rooms, camera panning, or tilemaps without changing frameworks.
- Microsoft Foundry Agent Service models agents as model plus instructions plus tools. That matches our Master Narrator and character agents cleanly: each character gets scoped instructions, tool access, and traceable calls.
- Foundry Agent Service supports prompt agents, workflow agents, and hosted agents. For the live demo, a code-first local orchestrator with Foundry-backed calls is the safest path; later, workflow agents can encode the fixed handoff sequence and human approval steps.
- Microsoft Agent Framework separates open-ended agents from explicit workflows. That is useful here: artifact creation is agentic, while quest progression, XP awards, room locks, and verification gates should stay deterministic.
- The official starter kit's Game Master pattern remains our map: orchestrator, character agents, tools, shared state, and human decisions. We are changing the domain and presentation, not the underlying reasoning pattern.

## Game Pillars

- Playable orchestration: every agent is a place in the world, not just a button in a panel.
- Human judgment: the player approves useful work and rejects weak work before XP is awarded.
- Visible reasoning: the replay log and future reasoning drawer show decomposition, retrieval, tool calls, validation, and state changes.
- Forkable demo safety: the public repo must run without private assets, live Azure credentials, or optional deployment tools.
- Business usefulness: each room must produce an artifact the player could actually use after the demo.

## Current Milestone

This branch already proves the first playable slice:

- FastAPI serves the game UI and quest APIs.
- The pitch form starts a three-step launch quest.
- The Phaser canvas renders a player, three NPC agents, room status labels, proximity checks, and active-room beacons.
- WASD, arrow keys, `E`, and Space support movement and interaction.
- The run button is locked until the player stands near the active NPC.
- Approving artifacts awards tiered XP, streak bonuses, and level progress.
- Autoplay walks to each NPC, runs the turn, and approves for a reliable live demo path.
- The private sprite layer is optional. When local character sheets exist, all four directions have idle and walk animations. When they are absent, procedural fallback art keeps the repo runnable after `git clone`.

## Current Design Issue

The game works, but the code is still prototype-shaped. The next branch should move things around before adding more rooms or visual detail.

Main issue: `submission/ui/game.js` currently owns too much at once. It contains DOM wiring, API calls, quest state helpers, Phaser scene setup, player movement, NPC creation, reward effects, autoplay, and asset animation registration. That is fine for a first slice, but it will slow us down when we add maps, a reasoning drawer, multiple quest lines, and richer room behavior.

The next design pass should split responsibilities without adding a heavy build system.

The sprite-game-specific mechanics plan lives in [sprite_game_mechanics.md](sprite_game_mechanics.md). Treat that document as the guide for what we should copy from proven sprite games: spatial verbs, room state, readable animation states, reward beats, and automation hooks. Do not copy protected assets, maps, names, or story content.

## Target Frontend Shape

Keep the current no-bundler setup for forkability, but split the browser code into small script files loaded by `index.html`:

```text
submission/ui/
|-- index.html
|-- game/
|   |-- config.js          # constants, sprite keys, room metadata, tier styles
|   |-- api_client.js      # fetch wrappers for /api endpoints
|   |-- state_selectors.js # active step, active agent, proximity-safe selectors
|   |-- ui_controller.js   # DOM updates, buttons, artifact panel, log rendering
|   |-- phaser_scene.js    # Phaser preload/create/update and world objects
|   `-- autoplay.js        # deterministic demo driver
`-- assets/
        |-- README.md
        `-- local/             # ignored private sprites and tiles
```

This gets the benefits of separation without forcing Vite, npm, or a new build command into the live demo path.

## Target State Shape

Quest YAML should eventually describe more of the world, not just agent prompts. The next schema can add room metadata while staying backwards-compatible:

```yaml
stages:
    - id: positioning
        agent: strategist
        room:
            name: Blueprint Room
            x: 180
            y: 130
            unlocks_after: pitch
        prompt: Help formulate the target definition and positioning pillars.
```

The backend remains authoritative for company state, quest state, artifacts, XP, streaks, and replay logs. The browser treats state as a projection, not as the source of truth.

## Core Player Flow

```text
Launcher
    -> Pitch submitted
    -> Quest active
            -> Room locked until active NPC is approached
            -> Agent turn running
            -> Artifact awaiting verification
            -> Approved: award XP, unlock next room
            -> Rejected: reset streak, return to same room
    -> Quest complete
    -> Replay/code walkthrough
```

The visible map should make that flow obvious before the user reads any panel text:

```text
Pitch Chamber -> Blueprint Room -> UX Lab -> Outreach Core -> Victory Stage
```

## Proper Game Feel Checklist

- Room silhouettes: each NPC should stand in a visually distinct space tied to their role.
- Door language: locked, active, cleared, and complete should be visible on the map itself.
- NPC body language: idle, walk, focus, success, and rejection states should be readable.
- Interaction affordance: approaching the active NPC should show a small prompt and enable `E`.
- Reward feedback: XP text, tier badge, streak indicator, and room unlock should fire together.
- Failure loop: rejection should feel like a productive retry, not a dead end.
- Reasoning visibility: the trace panel should update during the turn, not only after it finishes.
- Demo mode: autoplay should remain a first-class path for live presentation reliability.

## Backend and Agent Roadmap

1. Keep the current mock mode as the default safe path.
2. Add Foundry-backed agent calls behind explicit environment flags.
3. Add Foundry IQ retrieval with citations surfaced in the artifact and replay log.
4. Keep validators deterministic and local so artifact scoring does not depend on model mood.
5. Add one optional external tool, such as `deploy_landing_page`, with simulation fallback.
6. Save replay logs for every full run so the code walkthrough can inspect exact decisions.
7. Add evaluations once real Foundry calls are live: artifact quality, validator pass rate, retry rate, and trace completeness.

## Testing and Verification

Every branch after this one should keep these checks green:

- CLI smoke: `python3 submission/tools/run_quest_simulation.py --pitch "Your idea here"`
- Server smoke: launch FastAPI and confirm `/`, `/api/state`, and quest endpoints respond.
- Browser smoke: canvas is nonblank, player can move, active NPC proximity unlocks the run button, approval advances the quest.
- Asset fallback: delete or hide `submission/ui/assets/local/characters/` and confirm procedural mode still works.
- Sprite mode: when local sheets exist, confirm all eight animations are registered for player, strategist, designer, and marketer.
- Regression guard: approving gold/silver extends streak, bronze and rejection reset it, and XP uses the backend-calculated values.

## Branch Plan

Use this branch as the milestone commit for the playable shell:

1. Commit the current work: room-gated turns, directional animation, autoplay, tiered XP, and docs.
2. Merge `feat/dungeon-engine-scaffold` into `main` after verification.
3. Start the next branch from updated `main`, recommended name: `feat/game-design-refactor`.
4. First task on the new branch: split `submission/ui/game.js` into the no-bundler module shape above.
5. Second task: move hard-coded room positions and NPC metadata into quest/config data.

That keeps this branch shippable and gives the next branch a clean mandate: make the prototype architecture feel like a proper game foundation.
