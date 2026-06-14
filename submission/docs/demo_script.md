# Demo Script

## 0-3 min: Hook

- Open the narrated management-RPG experience (`/story`).
- Show the title: Gamifying World Improvement.
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
- Close with the community build path: author a new world-improvement campaign.

---

## Q&A hardening - one sentence per Microsoft piece + where to point

Verified live June 10. When a judge asks "is that real?", say the sentence,
then open the file.

| Piece | The sentence | Point at |
|---|---|---|
| Reasoning models | "Every worker runs on the configured Microsoft Foundry deployment for its role, and the org binds each chapter to a worker whose deployment_hint picks the right model class." | `agents/model_config.py` (AGENT_MODELS), rail's deploy label |
| Agent Framework | "Each worker runs as a real Microsoft Agent Framework Agent - FoundryChatClient on the project Responses endpoint when FOUNDRY_PROJECT_ENDPOINT is set, OpenAIChatClient as the compatibility net - and the rail names which client carried the run." | `agents/maf_runtime.py`, requirements (`agent-framework-foundry`), Agent Framework rail panel |
| Rubric evaluator | "The gate score is a Foundry rubric evaluation - four weighted dimensions judged per artifact by the narrator deployment - and the deterministic validators are the floor it can never fall below." | `agents/worker_factory.py` (`rubric_evaluate`), gate panel bars |
| Toolbox | "Workers draw tools from one MCP-shaped catalog - tools/list and tools/call - which passes through to a managed Foundry Toolbox when TOOLBOX_URL is set; the chips in the rail are the tools it actually drew." | `tools/toolbox.py`, `/api/toolbox`, rail tool chips |
| Code interpreter | "The validators aren't post-hoc scripts - on the Agent Framework path they're FunctionTools the model itself calls mid-run to check its draft, and the panel shows which ones it chose to call." | `tools/code_interpreter_wrappers.py`, `_wrap` in `agents/maf_runtime.py`, 'Tools the model called' row |
| Foundry IQ / retrieval | "Before reasoning, each worker recalls from the knowledge base and the citations render in the rail as it thinks - recall is itself a toolbox tool, real IQ first, local playbooks as the forkable fallback." | `agents/retrieval.py`, IQ Memory rail panel |
| Memory (session) | "Your gate decisions write to a decisions ledger that becomes binding direction in the next worker's brief - chapter 2's artifact provably followed the wedge you picked after chapter 1." | `state/schema.py` (`WorldGraph.decisions`), `/api/decision`, ch2 narration |
| Agent memory (learned) | "Memory is not IQ: IQ is what the company knows, memory is what the agents learn about YOU - your operating patterns, profile, shipped work - written at every gate, recalled in every brief, Foundry Agent Service memory store when configured." | `agents/memory.py`, `/api/memory`, 'Agent Memory - learned' rail panel |
| Proof points | "Every invocation logs four pieces of evidence - iq_hits, memory_injected, tools_called, inference_usage - so the replay log proves agents worked, not just that a model answered." | `STAGE_EXECUTED` events in the replay log, `tools/demo_smoke_test.py` evidence path |
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
- **"Are you showing raw chain-of-thought?"** - "No. We show reasoning-token
  counts, a bounded 280-char preview only when the model itself returns
  reasoning text, tool plans, and citations - never a dumped CoT stream.
  See reasoning_from_response in agents/model_config.py."

---

## Stack checklist - the June 2026 Microsoft path, item by item

The build tracks the current recommended stack. Each row is: what the list
asked for, where it lives, and the WHY line to speak on stage.

| # | Stack item | Status | Where | Why (the spoken line) |
|---|---|---|---|---|
| 1 | Microsoft Agent Framework | DONE | `agents/maf_runtime.py` (Agent, @tool, ContextProvider) | "We didn't wrap an SDK - the workers ARE Agent Framework agents, with memory and tools flowing through the framework's own primitives." |
| 2 | `agent-framework-foundry` / FoundryChatClient | DONE (auto-fallback) | `maf_runtime.py` `_run(use_foundry)`, `requirements.txt` | "Inference goes through the Foundry project Responses endpoint with AAD - the new path Microsoft shipped at Build - and degrades to the /openai/v1 client so a fork without RBAC still runs." |
| 3 | `azure-ai-projects>=2.0.0` | DECLARED (used as IQ/memory surface arrives) | `requirements.txt` | "The new Foundry project SDK is in the dependency set; the IQ and memory REST calls target the same project endpoint it manages." |
| 4 | Foundry IQ | DONE (cited, with fallback) | `agents/retrieval.py` `_iq_retrieve`, `knowledge/` | "Stable company knowledge is permission-aware and cited - and the same query falls back to the committed playbooks so a keyless clone recalls identically." |
| 5 | Agent Service Memory | DONE (with local ledger) | `agents/memory.py`, `/api/memory`, `FOUNDRY_MEMORY_STORE` | "IQ is what the company knows; memory is what the agents learn about the CEO - user profile, procedural patterns from gate choices, chapter summaries - the three kinds in Microsoft's memory preview." |
| 6 | Toolboxes (MCP) | DONE (passthrough + local) | `tools/toolbox.py`, `TOOLBOX_URL` | "One governed catalog, MCP shape, tools/list + tools/call - a real Foundry Toolbox slots in by setting one env var, and the game shows workers drawing from it by name." |
| 7 | Code interpreter | DONE (as FunctionTools) | `tools/code_interpreter_wrappers.py`, MAF `_wrap` | "Deterministic validators the model can call on its own draft mid-run - reliability you can grep, not vibes." |
| 8 | Hosted agents | SCAFFOLDED (GA expected July) | `hosted_agent/` | "Wired and shippable - invocations protocol, agent.yaml, Dockerfile - shown as scaffold because hosted agents are still preview this week." |
| 9 | Four proof points per invocation | DONE (all paths, tested) | `STAGE_EXECUTED` payloads, smoke test `check_evidence_path` | "Every run logs iq_hits, memory_injected, tools_called, inference_usage - the smoke test fails the build if any stage ships without evidence." |
| 10 | No raw chain-of-thought | DONE | `reasoning_from_response`, UI reasoning panel | "Token counts, tool plans, citations, and a bounded preview only when the model returns one - visible thinking without dumping CoT." |

Priority order we executed: IQ first, then memory, then toolbox - exactly the
"judges see agents actually working, not just model calls" ordering.
