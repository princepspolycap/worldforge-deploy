# Hero's Journey: Stages Rename + Narrative Template

> Implementation plan for renaming "chapters" to "stages" across the codebase
> and creating the canonical narrative document the LLM uses at runtime.

---

## Summary

Two changes:
1. **Rename "chapters" to "stages"** — align the code with Dan Harmon's Story Circle terminology
2. **Create `heros_journey.md`** — the single source of narrative truth for all LLM system prompts

## Why

The game is built on Dan Harmon's Story Circle. The code should speak that language.
Currently the narrative logic is scattered across 4 system prompts in different files.
A single narrative document gives the LLM (and human readers) one place to understand
the hero, the villains, the conflict mechanics, and the tone.

## Breaking Changes

> **Saved sessions will break.** Stage IDs change from `ch_*` to `stage_*`.
> Any existing `state.json` files referencing the old IDs will fail to load.
> Pre-demo, this is acceptable — just needs a clean slate.

## Stage ID Mapping

| Old ID              | New ID             | Story Circle Beat |
|---------------------|--------------------|-------------------|
| `ch_1_discovery`    | `stage_1_you`      | YOU (beat 1)      |
| `ch_2_positioning`  | `stage_2_need`     | NEED (beat 2)     |
| `ch_3_mvp`          | `stage_3_go`       | GO (beat 3)       |
| `ch_4_gtm`          | `stage_4_search`   | SEARCH (beat 4)   |
| `ch_5_retention`    | `stage_5_find`     | FIND (beat 5)     |
| n/a                 | `stage_6_take`     | TAKE (beat 6)     |
| n/a                 | `stage_7_return`   | RETURN (beat 7)   |
| n/a                 | `stage_8_change`   | CHANGE (beat 8)   |

We keep a one-to-one relationship between Story Circle beats and playable
stages. No beat compression: the game should get the story structure right,
even if that means more gates.

## Files Changed

### New Files
- `submission/docs/heros_journey.md` — canonical narrative template

### Modified Files (stages rename)

| File | What Changes |
|------|-------------|
| `state/schema.py` | `Chapter` → `Stage`, `WorldGraph.chapters` → `.stages`, `current_chapter_index` → `current_stage_index`, `Dilemma.chapter_id` → `.stage_id` |
| `agents/world_designer.py` | SYSTEM prompt, USER_TEMPLATE, `FALLBACK_CHAPTERS` → `FALLBACK_STAGES`, `_normalize_chapters` → `_normalize_stages`, all `ch_*` IDs |
| `agents/foundry_agents.py` | `MasterNarrator.system_instructions`, `_CANONICAL_STEPS`, `generate_lore` |
| `tools/dilemma_generator.py` | `chapter_id` → `stage_id` in signatures, `suggest_dilemma_for_chapter` → `suggest_dilemma_for_stage` |
| `state/consequences.py` | `chapter: Chapter` → `stage: Stage` in `apply_decision_consequence`, `_role_id` generation |
| `agents/worker_factory.py` | All `chapter` variable names → `stage`, `WorldGraph.chapters` → `.stages` |
| `tools/server.py` | API response fields |
| `state/events.py` | Event references |
| `state/api_contract.py` | Contract fields |
| `agents/maf_runtime.py` | Chapter references |
| `agents/memory.py` | Chapter references |
| `ui/game/story.js` | JS API response parsing |
| `ui/game/tokens.js` | Token references |
| `ui/story.html` | HTML references |
| Various smoke tests | Test references |

## Narrative Document Structure (`heros_journey.md`)

```
# The Hero's Journey — Narrative Template

## The Story Circle (Dan Harmon's 8 Beats)
  Maps each beat to one playable stage

## The Hero (Founder Archetypes)
  Builder | Seller | Designer | Operator
  What each is good at, what each fears

## The Villains (Systemic Forces)
  Automation Cartel ↔ Builder
  Shareholder Syndicate ↔ Seller
  Dopamine Cartel ↔ Designer
  Process Oligarchy ↔ Operator
  Why each villain is the antithesis

## Conflict Escalation Per Stage
  How the villain's pressure increases through the 8 stages

## Tone Guide
  The cooperative anthem vs. the infinite-growth dirge
  Post-capitalist worldview: cooperatives, dual power, mutual aid

## LLM Instruction Block
  How the narrator agent should use this document at runtime
```

## Music Direction

Harp-cinematic, Ori and the Will of the Wisps meets Hollow Knight:
- **Lead:** Harp arpeggios in E minor
- **Low end:** Melancholic cello drones
- **Atmosphere:** Reverb-heavy cathedral pads, choral whispers
- **Rhythm:** Sparse timpani rolls on stage transitions
- **Mood:** Solitary founder against the system — fragile but defiant

**AI generation prompt (Suno/Udio):**
> Ethereal cinematic harp arpeggios in E minor, atmospheric orchestral.
> Solo harp lead over reverb-heavy string pads. Melancholic cello countermelody.
> Ori and the Will of the Wisps meets Hollow Knight. Sparse timpani rolls.
> Choral whispers in the background. Building from fragile solo harp to full
> orchestral swell. No percussion in the first half. Emotional, determined,
> bittersweet. 3 minutes.

## Verification

```bash
# 1. Grep for orphaned "chapter" references (should find zero in Python)
grep -rn "chapter" submission/agents/ submission/state/ submission/tools/ \
  --include="*.py" | grep -v "__pycache__"

# 2. Run the quest simulator
python3 submission/tools/run_quest_simulation.py --pitch "Green energy grids"

# 3. Run game server locally
LOCAL_AGENT_MODEL=gemma4:e4b python3 submission/game_server.py
```
