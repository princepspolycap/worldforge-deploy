# Model Cost Policy

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

## Cheap live profile

When a real Foundry call is needed during active UI iteration, bind every
reasoning role to the smallest, cheapest deployment available in the current
Foundry project:

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

This is the right setting for repeated onboarding, profile URL, carousel, graph,
and verification-gate tests.

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

Do not spend large-model tokens on UI churn. Iterate in simulation first, use the
cheap live profile for integration checks, then switch only the final visible
reasoning roles to larger deployments when the screen flow is stable.
