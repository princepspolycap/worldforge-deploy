# Sprite Game Mechanics Plan

The next build pass should make the Phaser layer feel like a small sprite game that happens to run agents, not a dashboard with a canvas attached. The important move is to copy durable game mechanics, not protected art, maps, names, or story beats.

## What To Copy

- Spatial verbs: walk, approach, face, interact, unlock, clear, retry, celebrate.
- Readable states: locked room, active room, running turn, artifact ready, approved, rejected, complete.
- Room grammar: each specialist has a distinct space, a visual role, an interaction point, and a reward beat.
- Animation grammar: idle by direction, walk by direction, focus while the agent reasons, success on approval, reset on rejection.
- Presentation rhythm: move to room, trigger action, show thinking, reveal artifact, judge it, award feedback, unlock next space.
- Automation hooks: every mechanic should be scriptable so autoplay can rehearse the demo and future tests can verify the game loop.

This lets us reuse genre-standard behavior while keeping the submission original and legally clean.

## Current Sprite Mechanics

The current game already has the seed of a proper loop:

1. Player movement with WASD and arrow keys.
2. Directional player facing and walk cycles when local spritesheets exist.
3. Procedural fallback bodies when spritesheets are absent.
4. Active NPC proximity gates before a turn can run.
5. Room status labels for locked, active, and cleared states.
6. XP, tier, and streak feedback after approval.
7. Autoplay that walks to each active agent and runs the demo path.

The weak spot is that these mechanics are still mixed into `submission/ui/game.js`. The first refactor is to move the constants and reusable rules into small browser scripts, then leave `game.js` to orchestrate the scene until we split it further.

## Mechanics Registry

The first new file is `submission/ui/game/mechanics.js`. It defines the game grammar as data:

```text
spriteKeys      -> optional local character sheets
dirFrames       -> idle/walk atlas frame mapping
roomSequence    -> room positions, NPC positions, labels, colors, approach points
agents          -> display names and room names by agent key
dialogue        -> proximity prompt copy by agent key
tierStyles      -> UI presentation for bronze, silver, gold
getWalkDirection()
getApproachPoint()
getTierForScore()
```

That gives us a single source of truth for both manual play and automation. The same room approach point can drive the visible map, the proximity gate, and the autoplay tween.

## Automation Contract

Autoplay should remain more than a demo shortcut. It is our smoke-testable script for the whole sprite game loop:

1. Find the active quest step.
2. Resolve the assigned agent to a room.
3. Walk the player sprite to the room's approach point.
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

Those are presentation mechanics, but they serve the rubric: they make multi-agent orchestration visible before we explain the architecture.

## Implementation Order

1. Data extraction: keep `mechanics.js` as the source for sprite keys, room positions, labels, dialogue, and atlas frames.
2. Scene split: move Phaser scene code into `phaser_scene.js` without changing behavior.
3. UI split: move DOM rendering and API calls out of the scene file.
4. Game-feel pass: add doors, interaction markers, and running/success/rejection state effects.
5. Automation pass: expose a browser smoke function that verifies canvas, movement, proximity, run, approve, and quest completion.

The goal is a sprite-game foundation that keeps paying us back: better presentation for the live battle, easier automation, and cleaner places to add future rooms.
