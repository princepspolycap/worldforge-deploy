# Model Cost Policy

## Routing principle

The default runtime posture is **local-first**:

1. Local agent for normal gameplay.
2. Cheap cloud Foundry deployment when local output fails, is unavailable, or we
   need integration evidence.
3. Larger cloud Foundry deployment only for final visible reasoning passes.

This keeps the game cheap to play repeatedly while preserving the Microsoft
Foundry path required for the demo and rubric.

## Current routing

All reasoning calls route through [agents/model_config.py](../agents/model_config.py).
The app does not hardcode model names in source. It reads deployment names from
the gitignored `submission/.env` file:

| Runtime role | Env var | Current purpose |
|---|---|---|
| Narrator / world designer | `NARRATOR_MODEL` | Mission graph, chapters, world state |
| Strategist | `STRATEGIST_MODEL` | Profile analysis, org design, plans |
| Designer | `DESIGNER_MODEL` | UI and artifact structure |
| Marketer | `MARKETER_MODEL` | GTM, positioning, growth artifacts |
| Ops | `OPS_MODEL` | Ops artifacts; falls back to `MARKETER_MODEL` if blank |
| Fast dialogue / NPC | `NPC_FAST_MODEL` | Low-latency reactions and lightweight worker turns |
| Fallback | `FOUNDRY_FALLBACK_MODEL` | Retry deployment when a primary role errors or rate-limits |

Voice and image generation are separate optional tool paths:

| Tool path | Env vars | Cost stance |
|---|---|---|
| Narration | `TTS_DEPLOYMENTS`, `TTS_DEPLOYMENT`, `TTS_*` | Browser fallback is free; cloud TTS only when needed |
| Image generation | `IMAGE_ENDPOINT`, `IMAGE_DEPLOYMENT`, `IMAGE_API_KEY` | Manual/off during UI iteration unless generating final assets |

## Development default

Use `DEMO_MODE=simulation` while iterating on UI, layout, copy, card motion, and
DAG interactions. This makes no Foundry calls and still exercises the playable
flow with deterministic outputs.

## Local play profile

The normal playable game should run on a local agent by default. Local inference
is not just an emergency fallback; it is the primary runtime for repeated play
sessions, UI exploration, and player experimentation.

Use local agents for:

- NPC dialogue, card reactions, short worker banter, and inter-agent dynamics.
- Graph labels, mission summaries, lightweight profile cleanup, and replay text.
- Full local gameplay loops where the player is exploring the system rather than
  preparing a judged demo run.

Keep the local path compatible with the same agent contracts as the cloud path:
workers still return structured JSON, emit replay events, and pass through the
same verification gates. That lets the game feel real locally while preserving
the option to escalate selected turns to cloud Foundry.

Cloud Foundry becomes the fallback/escalation layer:

- If the local agent is unavailable.
- If a local response fails schema validation or quality gates.
- If a run needs official Foundry proof points for demo, judging, or recording.
- If a specific chapter needs deeper reasoning than the local model can provide.

## Cheap live profile

When a cloud Foundry call is needed during active UI iteration, bind every
reasoning role to the smallest, cheapest deployment available in the current
Foundry project. This is the first fallback after local agents, not the default
play path:

```env
DEMO_MODE=live
NARRATOR_MODEL=<cheap-fast-foundry-deployment>
STRATEGIST_MODEL=<cheap-fast-foundry-deployment>
DESIGNER_MODEL=<cheap-fast-foundry-deployment>
MARKETER_MODEL=<cheap-fast-foundry-deployment>
OPS_MODEL=<cheap-fast-foundry-deployment>
NPC_FAST_MODEL=<cheap-fast-foundry-deployment>
FOUNDRY_FALLBACK_MODEL=<cheap-fast-foundry-deployment>
```

This is the right cloud setting for repeated onboarding, profile URL, carousel,
graph, and verification-gate tests when local execution is not enough.

## Demo-quality profile

Reserve larger reasoning deployments for the few beats where output quality is
visible on stage:

- `NARRATOR_MODEL`: final mission graph and world-state pass.
- `STRATEGIST_MODEL`: profile interpretation, org design, and high-stakes
  planning artifacts.
- `DESIGNER_MODEL`: final polished artifact structure.

Keep `NPC_FAST_MODEL` on the cheap deployment even in demo-quality runs. It is
for short reactive text, not deep reasoning.

## Operating rule

Do not spend cloud tokens on UI churn or normal play. Iterate in simulation
first, run normal gameplay through a local agent by default, use cheap cloud
Foundry as the fallback/integration path, then switch only the final visible
reasoning roles to larger deployments when the screen flow is stable.
