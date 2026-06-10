# Rubric Mapping

> The reasoning behind every choice below - the CEO role-play, the grand-vision
> lore, the two missions, the fair-data flywheel - is documented in
> [vision_and_evolution.md](vision_and_evolution.md).

| Criterion | Weight | Implementation Evidence |
|---|---:|---|
| Accuracy and Relevance | 20% | Directly maps the official RPG architecture to business-building quests. |
| Reasoning and Multi-step Thinking | 20% | Master Narrator decomposes pitch into quest steps, routes agents, retrieves knowledge, validates outputs, and updates state. |
| Reliability and Safety | 20% | Human verification gate, simulation fallback, synthetic demo data, deterministic validation tools. Gate scores come from a Foundry rubric evaluation (four weighted dimensions, judged per artifact by the narrator deployment) with the deterministic validators as the floor the final score can never fall below; the same rubric renders offline, derived from the validators. |
| Creativity and Originality | 15% | A narrated management RPG (business dungeon) instead of a chat UI or literal fantasy-only RPG; Foundry-generated MAI game art. |
| UX and Presentation | 15% | Game-like quest flow, NPC agents, XP, replay log, and visible reasoning drawer. |
| Community Vote | 10% | Confirm with Carlotta whether this applies to the June 10 invitational. |

## Proof Points to Show Live

- Foundry-hosted Master Narrator and character agents.
- Foundry IQ citations in the reasoning panel.
- Code validation results attached to each artifact.
- Rubric-scored gates: the score bar fills from weighted rubric dimensions on screen - the judges grade us on a rubric while our gates grade artifacts with one.
- Replay log with agent handoffs and tool calls.
- Verification gates before XP awards.
