# Release Game Loop

The release path is the narrated story view served from `submission/ui/story.html`.
It is not the older game-art prototype path. The current loop should feel
playable because agent reasoning, verification, XP, memory, and artifact reveal
happen as visible state transitions, not because we depend on character art.

## Design Goal

Build a tight, demo-safe reasoning game:

1. The player enters a company pitch or URL.
2. The Org Designer maps the company into a one-human-plus-digital-workers org.
3. The World Designer decomposes the work into chapters.
4. Each chapter is bound to a specialist digital worker.
5. The worker produces an artifact with Microsoft Foundry-backed reasoning.
6. Deterministic tools validate the artifact.
7. The human verification gate approves or rejects the result.
8. Approval awards XP, updates memory, and unlocks the next chapter.

The mechanic is visible orchestration. A judge should be able to see what the
agent chose, which tools it used, what evidence it produced, and why the user
was asked to approve the result.

## Microsoft Starter-Kit Alignment

The Microsoft starter kits under `starter-kits/` remain untouched upstream
reference material. Our implementation lives under `submission/`.

We are aligned with the Reasoning Agents Game Master pattern:

| Starter-kit idea | This project |
| --- | --- |
| Game Master / orchestrator | Master Narrator, Org Designer, and World Designer |
| Character agents | Dynamic digital workers bound to chapter owners |
| Shared state | Pydantic company, org, quest, world, artifact, XP, and memory state |
| Tools | Local validators, retrieval, toolbox adapter, evidence capture |
| Human choice | Approval/rejection gates before XP and progression |
| Replayability | Event log and streamed trace surfaced in the story UI |

The release UI is different from the starter-kit sample presentation, but the
core reasoning architecture is intentionally the same: bounded agent turns,
tool use, shared state, and a human-controlled progression loop.

## Why We Moved Away From The Old Visual Prototype

The early plan explored a more asset-heavy interactive-map direction. That was
useful design research, but it created release risk:

- third-party art licensing could leak into the public fork,
- stale alternate UI routes made the repo harder to run after clone,
- visual polish competed with reasoning and evaluation work,
- public docs over-explained a path that is now internal history.

The release approach is geometric and generated-art-first: committed assets are
MIT-clean, local art stays ignored, and the reasoning loop works without any
private files.

## Current Runtime Shape

```text
submission/ui/
|-- story.html              # release surface
|-- game/
|   |-- audio.js            # narration and audio state
|   |-- intro.js            # entry and setup flow
|   `-- story.js            # chapter loop, artifacts, trace, verification
|-- assets/generated/lore/  # committed generated portraits/backgrounds
`-- vendor/mermaid.min.js   # local Mermaid renderer
```

FastAPI serves the release UI at `/` and `/story`.

## Core Player Flow

```text
Pitch or URL
    -> Org designed
    -> World chapters generated
        -> Next chapter selected
        -> Digital worker runs
        -> Evidence and trace stream
        -> Artifact appears
        -> Human approves or rejects
        -> XP, memory, and chapter state update
    -> Quest complete
    -> Replay/code walkthrough
```

## Release Checklist

- The public repo runs in simulation mode without Azure credentials.
- Foundry-backed mode is enabled only through local `.env` values.
- The story UI is the only documented release surface.
- Private planning, demo logistics, deployment names, quota notes, and local
  assets live under ignored paths.
- Microsoft platform links are centralized in
  [microsoft_platform_references.md](microsoft_platform_references.md).
- Evals are added around artifact quality, schema validity, trace completeness,
  retry behavior, and human-gate outcomes before deeper Agent 365 integration.

## Verification Commands

```bash
python3 submission/tools/run_quest_simulation.py --pitch "Your idea here"

DEMO_MODE=simulation CAMPAIGN_STATE_FILE=/tmp/campaign-state.json \
  python3 -m uvicorn submission.tools.server:app --host 127.0.0.1 --port 8051
```

Then open `http://127.0.0.1:8051/story` and run a short playthrough.
