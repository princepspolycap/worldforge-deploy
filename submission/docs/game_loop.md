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

- Phaser is the right UI layer for this submission because it is built for browser-first 2D games, uses familiar `preload`, `create`, and `update` scene functions, and gives us simple Arcade Physics for movement, overlap, and world bounds.
- Phaser's display list, camera model, Graphics API, tweens, and particles are enough for our demo: we can build rooms, doors, halos, path lines, graph nodes, meters, and agent-state glyphs without a second engine or licensed art dependency.
- The current build should be geometric-first only. Sprites, tilemaps, and asset-pack work are out of scope until the core loop, autoplay, verification gates, audio, and artifact graphics feel complete.
- Tone.js or the Web Audio API should provide synthesized music and SFX so the public repo has no audio licensing risk. The live demo needs ambient loops, thinking loops, approval chimes, rejection buzzes, and quest-complete fanfare before it needs licensed music files.
- Mermaid and Chart.js are good artifact renderers: org charts, workflow maps, integration diagrams, OKR trees, KPI dashboards, and financial projections can all come from agent output and appear inside the verification panel.
- Microsoft Foundry Agent Service models agents as model plus instructions plus tools. That matches our Master Narrator and character agents cleanly: each character gets scoped instructions, tool access, and traceable calls.
- Foundry Agent Service supports prompt agents, workflow agents, and hosted agents. For the live demo, a code-first local orchestrator with Foundry-backed calls is the safest path; later, workflow agents can encode the fixed handoff sequence and human approval steps.
- Microsoft Agent Framework separates open-ended agents from explicit workflows. That is useful here: artifact creation is agentic, while quest progression, XP awards, room locks, and verification gates should stay deterministic.
- The official starter kit's Game Master pattern remains our map: orchestrator, character agents, tools, shared state, and human decisions. We are changing the domain and presentation, not the underlying reasoning pattern.

## Phaser Version Decision

Current UI loads Phaser `3.60.0` from jsDelivr. Current upstream research as of May 29, 2026:

- Phaser `3.90.0` is the latest Phaser 3 release and was published on May 23, 2025. It adds useful stability fixes and `Rectangle.setRounded()`, which directly helps our geometric UI.
- Phaser 4 is now released, with `4.1.0` published on April 30, 2026. It has a rebuilt renderer, a unified filter system, and stronger lighting, but it is a bigger migration surface.
- For this demo, stay on Phaser 3. Move from `3.60.0` to pinned `3.90.0` only after a browser smoke test passes. Do not migrate to Phaser 4 before the live battle.

Decision rule:

```text
Now:     Phaser 3.60.0 is acceptable while mechanics are changing quickly.
Next:    Test and pin Phaser 3.90.0 for better geometric primitives and fixes.
Later:   Evaluate Phaser 4 only after the demo, when renderer/filter upgrades matter more than stability.
```

Primary references:

- Phaser 3.90 release notes: https://phaser.io/news/2025/05/phaser-v390-released
- Phaser 3.90 download archive: https://phaser.io/download/release/v3.90.0
- Phaser 4.1 release notes: https://phaser.io/news/2026/04/phaser-4-1-0-salusa-release
- Phaser 3 to 4 migration guide: https://phaser.io/news/2026/04/migrating-from-phaser-3-to-phaser-4-what-you-need-to-know
- Phaser Game Object concepts: https://docs.phaser.io/phaser/concepts/gameobjects
- Phaser Tween concepts: https://docs.phaser.io/phaser/concepts/tweens
- Phaser Particle concepts: https://docs.phaser.io/phaser/concepts/gameobjects/particles

## Templates and Examples We Can Reuse

We should not build the game foundation from scratch, but we should also avoid copying in a heavy template that changes the repo's deployment shape. Use templates as reference material, then keep our runtime no-bundler and FastAPI-served.

| Source | What it gives us | Use in this repo |
|---|---|---|
| Phaser Create Game App | Official starter templates for Vite, Webpack, Rollup, ESBuild, Import Map, Bun, React, Vue, Svelte, Angular, Next, Solid, and Remix | Reference for project structure only. Do not adopt a bundler before the demo. |
| Phaser demo games | Small complete games such as space action, coin clicker, and memory card game | Reference for scene organization, preload/create/update rhythm, input, scoring, and restart loops. |
| Phaser Examples site | Thousands of focused examples for tweens, particles, graphics, cameras, input, sound, and game objects | Primary source for borrowing individual mechanics. Search for the exact effect, then adapt the smallest working pattern. |
| Phaser Sandbox | Fast browser-based experiments against current Phaser versions | Use to prototype an effect before adding it to `game.js`. |
| Phaser Launcher / Editor | Visual project templates and scene tools | Useful for learning and inspection, not a required tool for this repo. |

Best fit for us:

```text
Use official examples as recipe cards, not as an app scaffold.
Keep our shipped game as plain HTML + Phaser CDN + small browser scripts.
Only add a build system if the game becomes too large to maintain after the live battle.
```

Concrete recipe targets:

- **Door opening:** start from Tween examples; animate `scaleX`, `alpha`, or rectangle width on a door object.
- **Agent focus pulse:** start from Tween yoyo/repeat examples; pulse halo scale and alpha.
- **Thinking particles:** start from Particle examples; emit small dots/glyphs around the active agent and stop on completion.
- **Reward burst:** combine Text tween + particle burst + camera shake.
- **Company graph:** use Game Object/Container examples; make node containers and line graphics managed by state.
- **Camera emphasis:** use camera pan/zoom examples; avoid constant camera motion.
- **Audio cues:** use Phaser sound or Web Audio for short state cues; keep Tone.js only if we need richer synthesized loops.

## Game Pillars

- Playable orchestration: every agent is a place in the world, not just a button in a panel.
- Human judgment: the player approves useful work and rejects weak work before XP is awarded.
- Visible reasoning: the replay log and future reasoning drawer show decomposition, retrieval, tool calls, validation, and state changes.
- Forkable demo safety: the public repo must run without private assets, live Azure credentials, or optional deployment tools.
- Business usefulness: each room must produce an artifact the player could actually use after the demo.

## Visual Direction

The current direction is **geometric-first only**.

That means the game is readable and polished from code-native shapes:

- Rooms are rectangular zones with distinct floor bands, door frames, progress states, and role-colored lighting.
- Agents are expressive geometric avatars: cores, rings, status halos, eye-line markers, and thinking particles.
- The company being built is a living graph: nodes for customers, channels, products, integrations, hires, KPIs, and cash flow.
- Quest progress is visible as a path through the dungeon, not just text in a side panel.
- Verification gates are physical locks: artifact accepted opens the door; rejected returns the room to active focus.

No sprite or tilemap work is required for the live demo pass. This gives us three benefits: forkability, licensing safety, and a cleaner implementation path.

## Current Milestone

This branch already proves the first playable slice:

- FastAPI serves the game UI and quest APIs.
- The pitch form starts a three-step launch quest.
- The Phaser canvas renders a player, three NPC agents, room status labels, proximity checks, and active-room beacons.
- WASD, arrow keys, `E`, and Space support movement and interaction.
- The run button is locked until the player stands near the active NPC.
- Approving artifacts awards tiered XP, streak bonuses, and level progress.
- Autoplay walks to each NPC, runs the turn, and approves for a reliable live demo path.
- The committed visual layer works without private art assets.

## Current Design Issue

The game works, but the code is still prototype-shaped. The next branch should move things around before adding more rooms or visual detail.

Main issue: `submission/ui/game.js` currently owns too much at once. It contains DOM wiring, API calls, quest state helpers, Phaser scene setup, player movement, NPC creation, reward effects, and autoplay. That is fine for a first slice, but it will slow us down when we add a reasoning drawer, multiple quest lines, and richer room behavior.

The next design pass should split responsibilities without adding a heavy build system.

The visual mechanics plan lives in [sprite_game_mechanics.md](sprite_game_mechanics.md). Treat that document as the guide for what we should copy from proven games: spatial verbs, room state, readable animation states, reward beats, and automation hooks. Do not copy protected assets, maps, names, or story content.

## Target Frontend Shape

Keep the current no-bundler setup for forkability, but split the browser code into small script files loaded by `index.html`:

```text
submission/ui/
|-- index.html
|-- game/
|   |-- config.js          # constants, room metadata, tier styles
|   |-- api_client.js      # fetch wrappers for /api endpoints
|   |-- state_selectors.js # active step, active agent, proximity-safe selectors
|   |-- ui_controller.js   # DOM updates, buttons, artifact panel, log rendering
|   |-- phaser_scene.js    # Phaser preload/create/update and world objects
|   `-- autoplay.js        # deterministic demo driver
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
- NPC body language: idle, walk, focus, success, and rejection states should be readable through geometric animation.
- Interaction affordance: approaching the active NPC should show a small prompt and enable `E`.
- Reward feedback: XP text, tier badge, streak indicator, and room unlock should fire together.
- Failure loop: rejection should feel like a productive retry, not a dead end.
- Reasoning visibility: the trace panel should update during the turn, not only after it finishes.
- Audio state: ambient bed, thinking loop, approval chime, rejection buzz, and quest-complete fanfare should map directly to game state.
- Artifact graphics: org charts, workflow maps, KPI charts, and financial projections should render as artifacts, not as plain markdown whenever possible.
- Demo mode: autoplay should remain a first-class path for live presentation reliability.

## Library Decisions

| Need | Decision | Reason |
|---|---|---|
| Live game runtime | Phaser 3, target `3.90.0` after smoke test | Browser-first, no build step, stable enough for procedural geometry |
| Geometric visuals | Phaser Graphics + tweens + particles | Keeps the committed game polished without private assets |
| Music and SFX | Tone.js or direct Web Audio | MIT-clean synthesized audio with no asset licensing surface |
| Org/workflow diagrams | Mermaid | Agents can output graph syntax that becomes visual artifacts |
| KPI/finance charts | Chart.js | Lightweight dashboard-grade visuals for business artifacts |

## Phaser Implementation Playbook

Use Phaser as a deterministic world renderer for agent state:

- **Rooms:** draw each room as a `Container` with rectangle bands, grid lines, door geometry, labels, and state overlays.
- **Agents:** build each NPC from circles, rounded rectangles, eye-line markers, rings, and role-color halos. Keep the logical agent object separate from its visual container.
- **Doors:** model doors as stateful geometry: `sealed`, `active`, `opening`, `open`, `complete`. Door animation is a tween, not game logic.
- **Thinking state:** use particles or small circle/text glyphs around the active agent while the model call runs. Kill the effect when the artifact arrives or the request fails.
- **Route line:** draw an autoplay path from the player to the active approach point. Fade it when proximity is reached.
- **Company graph:** render approved artifacts as graph nodes in the world. Positioning unlocks ICP/pain/offer nodes; finance unlocks runway/MRR/burn nodes; GTM unlocks channel nodes.
- **Camera:** keep camera movement intentional. Zoom slightly into the active room during reasoning, then return to the full map after approval/rejection.
- **UI separation:** use DOM for dense artifact review and Phaser for spatial state. Do not force long documents into canvas text.

Performance rules:

- Reuse `Graphics` objects for dynamic effects instead of creating new objects every frame.
- Prefer `Container` groups for agent and room assemblies so tweens can target one parent object.
- Use `generateTexture()` later for static repeated geometry if profiling shows the Graphics layer is expensive.
- Destroy completed tweens, timers, particles, and temporary glyphs when state changes.
- Keep Canvas/WebGL resize behavior deterministic; test desktop and mobile widths before the demo.

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
- Geometric mode: confirm the committed game renders without private assets.
- Regression guard: approving gold/silver extends streak, bronze and rejection reset it, and XP uses the backend-calculated values.

## Branch Plan

Use this branch as the milestone commit for the playable shell:

1. Commit the current work: room-gated turns, directional animation, autoplay, tiered XP, and docs.
2. Merge `feat/dungeon-engine-scaffold` into `main` after verification.
3. Start the next branch from updated `main`, recommended name: `feat/game-design-refactor`.
4. First task on the new branch: split `submission/ui/game.js` into the no-bundler module shape above.
5. Second task: move hard-coded room positions and NPC metadata into quest/config data.

That keeps this branch shippable and gives the next branch a clean mandate: make the prototype architecture feel like a proper game foundation.
