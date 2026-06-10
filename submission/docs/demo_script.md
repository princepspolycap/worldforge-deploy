# Demo Script

## 0-3 min: Hook

- Open the narrated management-RPG experience (`/story`).
- Show the title: Your Company Is the Dungeon.
- Point out the player, NPC agents, XP bar, quest log, and reasoning drawer.

## 3-10 min: Live Play

- Enter pitch: `AI tool that helps freelance designers price their projects.`
- Master Narrator decomposes the pitch into a launch quest.
- Strategist creates positioning and ICP.
- Player approves the artifact and XP is awarded.
- Designer creates landing-page artifact and validation runs.
- Marketer writes launch email copy and validation runs.
- Quest completion screen appears.

## 10-15 min: Code Walkthrough

- Show Foundry agent definitions.
- Show Foundry IQ knowledge sources.
- Show deterministic tool wrappers.
- Show shared state and replay log.
- Show verification gate handler.

## 15-18 min: Architecture Reasoning

- Map the build back to the official Game Master challenge.
- Explain Foundry as the brain and optional external systems as tools.
- Explain why verification gates improve reliability and safety.

## 18-20 min: Forkability Close

- Show how the repo can be cloned.
- Show where new quest definitions live.
- Close with the community build path: author a new business dungeon.

---

## Q&A hardening - one sentence per Microsoft piece + where to point

Verified live June 10. When a judge asks "is that real?", say the sentence,
then open the file.

| Piece | The sentence | Point at |
|---|---|---|
| Reasoning models | "Every worker is a live Foundry deployment - narrator on gpt-5.5, and the org binds each chapter to a worker whose deployment_hint picks its model class; you watched a 56-second real reasoning run." | `agents/model_config.py` (AGENT_MODELS), rail's deploy label |
| Rubric evaluator | "The gate score is a Foundry rubric evaluation - four weighted dimensions judged per artifact by the narrator deployment - and the deterministic validators are the floor it can never fall below." | `agents/worker_factory.py` (`rubric_evaluate`), gate panel bars |
| Toolbox | "Workers draw tools from one MCP-shaped catalog - tools/list and tools/call - which passes through to a managed Foundry Toolbox when TOOLBOX_URL is set; the chips in the rail are the tools it actually drew." | `tools/toolbox.py`, `/api/toolbox`, rail tool chips |
| Foundry IQ / retrieval | "Before reasoning, each worker recalls from the knowledge base and the citations render in the rail as it thinks - recall is itself a toolbox tool." | `agents/retrieval.py`, IQ Memory rail panel |
| Memory (session) | "Your gate decisions write to a decisions ledger that becomes binding direction in the next worker's brief - chapter 2's artifact provably followed the wedge you picked after chapter 1." | `state/schema.py` (`WorldGraph.decisions`), `/api/decision`, ch2 narration |
| Dilemma gates | "The dilemmas aren't canned - the narrator model writes a venture-specific tradeoff from the artifact just sealed; offline forks get a deterministic fallback per role." | `tools/server.py` (`/api/dilemma`), `_CANNED_DILEMMAS` |
| Human-in-the-loop | "Nothing counts until the human seals it - the verification gate is the core mechanic, not a confirmation dialog." | gate flow in `ui/game/story.js`, `/api/step/approve` |
| Hosted agent | "The same agent ships as a Foundry hosted agent - invocations protocol, agent.yaml, Dockerfile - in the hosted_agent folder." | `hosted_agent/` |
| Voice | "Narration is gpt-4o-mini-tts on Azure - baked takes ship in the repo so a fork with zero keys still hears the cinematic voice, and the browser voice is the last-resort net." | `tools/generate_narration.py`, `docs/narration_pipeline.md` |
| Forkability | "git clone, pip install, python tools/server.py - no keys: simulation mode plays the whole game deterministically; add a .env and the same code paths go live." | `README.md`, `DEMO_MODE` in `agents/model_config.py` |

Hard questions, honest answers:

- **"Is the income beat real revenue?"** - "It is scripted in the committed
  build - the feed is your designed org's workers and the rate derives from
  the marketer's financial plan; the production path is a Routine calling
  the real Poly platform, and that is on the roadmap slide, not claimed."
- **"What breaks if Foundry is down?"** - "Every subsystem degrades:
  simulation artifacts, validator-derived rubrics, canned dilemmas, browser
  TTS. The demo law is degrade, never crash - kill the .env and replay it."
- **"Why two agents instead of a crew?"** - "Everything that looks like a
  subagent is a loop with tools: pick, run, score, gate, remember. Two
  reasoning agents - World Designer and a parameterized Worker - cover every
  role the org designs, which is the architecture rule in
  docs/foundry_integration_plan.md."