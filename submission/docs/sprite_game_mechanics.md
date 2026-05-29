# Visual Game Mechanics Plan

The next build pass should make the Phaser layer feel like a small game that happens to run agents, not a dashboard with a canvas attached. The important move is to copy durable game mechanics, not protected art, maps, names, or story beats.

The direction for this demo pass is **geometric-first only**. The committed baseline should be fully open source, visually intentional, and free of private asset dependencies.

## What To Copy

- Spatial verbs: walk, approach, face, interact, unlock, clear, retry, celebrate.
- Readable states: locked room, active room, running turn, artifact ready, approved, rejected, complete.
- Room grammar: each specialist has a distinct space, a visual role, an interaction point, and a reward beat.
- Animation grammar: idle, walk, focus while the agent reasons, success on approval, reset on rejection.
- Presentation rhythm: move to room, trigger action, show thinking, reveal artifact, judge it, award feedback, unlock next space.
- Automation hooks: every mechanic should be scriptable so autoplay can rehearse the demo and future tests can verify the game loop.

This lets us reuse genre-standard behavior while keeping the submission original and legally clean.

## Geometric Mechanics

Phaser can express the world with code-native geometry:

- **Rooms:** role-colored zones with borders, floor grids, wall bands, and state overlays.
- **Doors:** locked, active, open, and cleared gates between rooms.
- **Agents:** circular cores with rings, eyes, facing direction, status halos, and role colors.
- **Reasoning:** pulsing thought particles, circuit lines, and trace-node highlights while an LLM call runs.
- **Company graph:** product, customer, channel, integration, hiring, KPI, and finance nodes that appear as artifacts are approved.
- **Verification gate:** a physical lock or seal that accepts/rejects an artifact and changes the room state.
- **Autoplay path:** a visible route line from the player to the next active agent.

This gives the game a coherent identity and fits the product idea: the player is walking through a living operating system for building a company.

## Phaser Primitive Map

Use a small set of Phaser primitives consistently:

| Game concept | Phaser primitive | Notes |
|---|---|---|
| Room shell | `Container` + `Rectangle`/`Graphics` | Group floor, wall, door, labels, and overlays under one parent |
| Room state overlay | `Graphics` alpha fill + tween | Locked = dim, active = pulsing border, cleared = stable glow |
| Door/gate | `Rectangle` or `Graphics` | Animate scale/alpha/opening with tweens; state comes from backend |
| Player avatar | `Container` of circles/rectangles | Keep movement object separate from decorative children |
| Agent avatar | `Container` of circles/rings/text | One visual grammar for strategist/designer/marketer colors |
| Thinking effect | Particle emitter or pooled circles | Start on agent run, stop on artifact/error |
| XP/reward burst | Text + pooled circles + camera shake | Tie to backend XP award, not client-side score guesses |
| Autoplay path | `Graphics` line | Redraw only when target changes |
| Company graph | `Container` of node groups and lines | Add nodes when artifacts are approved |
| Camera emphasis | `cameras.main.pan/zoomTo/shake` | Use sparingly so it feels intentional |

Phaser details that matter:

- Graphics objects are best for dynamic vector-like drawing, but they should not be recreated every frame.
- Tweens are scene-owned and can target any object property, including container position, alpha, scale, camera zoom, and sound volume.
- Particles are appropriate for transient reasoning and reward effects; long-lived state should be ordinary game objects so it remains easy to inspect and test.
- Game objects have display-list order and `depth`; use explicit depth bands for background, rooms, doors, avatars, effects, labels, and UI prompts.
- Keep DOM and Phaser roles separate: Phaser shows where the player is and what state the world is in; DOM panels show dense text, validation results, and approvals.

Suggested depth bands:

```text
0-9     background grid and ambience
10-19   rooms, walls, company graph edges
20-29   doors, room status overlays, graph nodes
30-39   player and agents
40-49   particles, XP bursts, route lines
50-59   interaction prompts and speech bubbles
```

## Current Mechanics

The current game already has the seed of a proper loop:

1. Player movement with WASD and arrow keys.
2. Procedural player and NPC bodies.
3. Active NPC proximity gates before a turn can run.
4. Room status labels for locked, active, and cleared states.
5. XP, tier, and streak feedback after approval.
6. Autoplay that walks to each active agent and runs the demo path.

The weak spot is that these mechanics are still mixed into `submission/ui/game.js`. The first refactor is to move the constants and reusable rules into small browser scripts, then leave `game.js` to orchestrate the scene until we split it further.

## Mechanics Registry

The first new file is `submission/ui/game/mechanics.js`. It defines the game grammar as data:

```text
roomSequence    -> room positions, NPC positions, labels, colors, approach points
agents          -> display names and room names by agent key
dialogue        -> proximity prompt copy by agent key
tierStyles      -> UI presentation for bronze, silver, gold
getWalkDirection()
getApproachPoint()
getTierForScore()
```

That gives us a single source of truth for both manual play and automation. The same room approach point can drive the visible map, the proximity gate, the autoplay tween, and the route-line overlay.

The registry should grow to include visual-state tokens:

```text
roomStates      -> locked, active, running, artifact_ready, cleared, rejected
doorStates      -> sealed, opening, open, complete
agentStates     -> idle, focus, success, reject, waiting
audioCues       -> ambient, thinking, approve, reject, level_up, complete
artifactKinds   -> doc, landing_page, org_chart, workflow_map, kpi_chart, finance_chart
```

## Automation Contract

Autoplay should remain more than a demo shortcut. It is our smoke-testable script for the whole game loop:

1. Find the active quest step.
2. Resolve the assigned agent to a room.
3. Walk the player avatar to the room's approach point.
4. Confirm proximity unlocks interaction.
5. Run the agent turn.
6. Wait for artifact state.
7. Approve through the same path a human uses.
8. Repeat until the quest completes.

Future browser tests can use the same assumptions without needing model calls or private art assets.

## Better Than The Current Prototype

Next implementation passes should prioritize mechanics that change what the audience understands at a glance:

- Add room doors or gates that visually open when a step unlocks.
- Add an interaction marker above the active NPC only when the player is close enough.
- Add agent focus poses or effects while a turn is running.
- Add a small artifact pickup/reveal animation before the verification gate appears.
- Add rejection feedback that visibly returns the room to active instead of feeling like a failed click.
- Add a completion walk to a final stage so the quest ends in the world, not only in the side panel.
- Add a geometric company graph that grows after each approval.
- Add audio cues tied to the same state transitions so the loop has a readable rhythm.
- Add artifact renderers for Mermaid and Chart.js outputs so company diagrams and financial plans feel like game rewards.

Those are presentation mechanics, but they serve the rubric: they make multi-agent orchestration visible before we explain the architecture.

## State-To-Visual Contract

Every backend state transition should map to one visible game reaction:

| State/event | Visual reaction | Audio reaction |
|---|---|---|
| Quest initialized | Rooms draw in locked state except first active room | Start ambient bed |
| Active step changes | Door/room border pulses; route line appears | Soft activation tone |
| Player near active NPC | `E` prompt appears; agent halo brightens | Tiny proximity blip |
| Agent turn starts | Agent focus rings and thinking particles start; camera eases in | Thinking loop starts |
| Artifact produced | Pedestal/lock reveal animation; verification panel opens | Reveal chime |
| Artifact approved | Door opens; graph node appears; XP burst fires | Approval seal + XP arpeggio |
| Artifact rejected | Room shakes lightly; halo returns to active; streak indicator resets | Rejection buzz |
| Quest complete | Final room/path lights up; camera returns to full map | Short fanfare |

This contract matters for autoplay because the audience may not click anything. They should still understand what is happening from the world state alone.

## Dependency Policy

Keep the live game dependency stack small:

- **Phaser 3:** live runtime for geometry, physics, camera, input, tweens, and particles. Target `3.90.0` after a smoke-tested CDN upgrade.
- **Tone.js or Web Audio:** synthesized music and SFX.
- **Mermaid:** render org charts, workflows, and dependency graphs from agent output.
- **Chart.js:** render KPI, finance, and channel-mix artifacts.

Avoid adding sprites, tilemaps, a second game engine, a React/Vite build stack, or an asset-heavy audio library before the demo. The current no-bundler path is a feature because judges and developers can run it after `git clone`.

## Borrowed Recipe Checklist

Use Phaser examples/templates as targeted recipes:

1. **Scene shape:** copy the standard `preload`, `create`, `update` flow from official starter templates, but keep our plain script loading.
2. **Object factories:** use small factory functions for `createRoom`, `createAgent`, `createDoor`, `createGraphNode`, and `createRewardBurst`.
3. **Tween recipes:** borrow repeat/yoyo/stagger/camera tween patterns for pulses, door opens, route fades, and XP floaters.
4. **Particle recipes:** borrow emitter patterns for thinking dots, approval sparks, rejection fragments, and final fanfare.
5. **Input recipes:** keep keyboard interaction simple: movement keys update player position, `E` triggers only when proximity state is true.
6. **State recipes:** do not use Phaser as the source of truth. Phaser reads backend quest state and renders it.
7. **Restart recipes:** use complete demo games as reference for reset/restart flow so live demos can recover quickly.

Avoid wholesale template adoption before the live battle. Pull the mechanic, not the project structure.

## Implementation Order

1. Data extraction: keep `mechanics.js` as the source for room positions, labels, dialogue, and visual-state tokens.
2. Geometric polish: add doors, interaction markers, route lines, agent halos, and running/success/rejection effects using Phaser Graphics.
3. Audio pass: add ambient, thinking, approve, reject, level-up, and completion cues.
4. Artifact pass: add Mermaid and Chart.js renderers for org charts, workflow maps, KPI charts, and finance charts.
5. Scene split: move Phaser scene code into `phaser_scene.js` without changing behavior.
6. UI split: move DOM rendering and API calls out of the scene file.
7. Automation pass: expose a browser smoke function that verifies canvas, movement, proximity, run, approve, and quest completion.

The goal is a visual-game foundation that keeps paying us back: better presentation for the live battle, easier automation, and cleaner places to add future rooms.
