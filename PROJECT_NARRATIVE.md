# Project Narrative - Gamifying World Improvement

Public narrative for the Microsoft Agents League Battle #2 submission. Internal
demo logistics and outreach planning live under the ignored `submission/private/`
folder.

## One-Sentence Pitch

**Gamifying World Improvement** is a card-and-graph based, multi-agent
world-improvement simulator where a player enters their public profile, a
Microsoft Foundry-powered Game Master decomposes the mission into a campaign graph,
and specialist worker agents execute each step to produce real artifacts that the
player must verify before XP is awarded.

The player decides. The agents execute. The human verifies.

## Challenge Fit

The Battle #2 prompt asks for a role-play game adventure powered by reasoning
agents. This project keeps that shape and changes the domain:

| Challenge concept | This submission |
|---|---|
| Game Master agent | Org Designer + World Designer |
| Character agents | Strategy, product, growth, and operations workers |
| Campaign lore | World-improvement playbooks through Foundry IQ/local fallback |
| Dice rolls and checks | Deterministic artifact validators |
| Shared world state | Campaign, quest, world, memory, and replay state |
| Human decisions | Verification gates before XP or progress |

The result is still a role-play game, but the campaign is the world-improvement
mission the player is leading.

## Current Loop

1. The player enters their LinkedIn or public profile URL.
2. The Org Designer creates an AI workforce tailored to the founder's profile and mission.
3. The World Designer decomposes the mission into a graph of chapters.
4. Each worker recalls knowledge, receives memory, uses tools, and produces an
   artifact.
5. Validators score the artifact.
6. The player approves or rejects the artifact at the gate.
7. Approved gates write memory and unlock the next nodes in the graph.

## Official Battle #2 Rubric

The live-battle rubric in
[`starter-kits/2-reasoning-agents/live_battle_challenge.md`](starter-kits/2-reasoning-agents/live_battle_challenge.md)
uses these weights:

| Criterion | Weight |
|---|---:|
| Accuracy and Relevance | 25% |
| Reasoning and Multi-step Thinking | 25% |
| Reliability and Safety | 20% |
| Creativity and Originality | 15% |
| User Experience and Presentation | 15% |

Detailed mapping is in
[`submission/docs/rubric_mapping.md`](submission/docs/rubric_mapping.md).

## Microsoft Platform Links

The public source list for Microsoft platform pieces, evaluation options,
submission process, and optional Agent 365 governance is maintained in
[`submission/docs/microsoft_platform_references.md`](submission/docs/microsoft_platform_references.md).

## Running Locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r submission/requirements.txt

python3 submission/tools/run_quest_simulation.py --pitch "Green energy grids"
```

No Azure credentials are required for simulation mode. A configured
`submission/.env` switches the same code paths toward live Microsoft Foundry
deployments.
