# Rubric Mapping

> The reasoning behind every choice below - the CEO role-play, the grand-vision
> lore, the two missions, the fair-data flywheel - is documented in
> [vision_and_evolution.md](vision_and_evolution.md).

Weights below are the OFFICIAL evaluation criteria from
`starter-kits/2-reasoning-agents/live_battle_challenge.md` plus the contest
rules in `microsoft/Agents-League-AISF-Regulations` (`OFFICIAL RULES.md`),
verified on June 13, 2026.

| Criterion | Weight | Implementation Evidence |
|---|---:|---|
| Accuracy and Relevance | 20% | Direct reskin of the official Game Master scenario: a Game Master (World Designer/Narrator) plus in-story character agents build a venture as an interactive RPG. Every required primitive present and named on screen: multi-agent orchestration, Foundry IQ recall with citations, code interpreter validators, world state, quests, dynamic consequences. |
| Reasoning and Multi-step Thinking | 20% | The World Designer decomposes the pitch into a dependency-ordered chapter graph; the Org Designer reasons out the workforce before any work happens; each chapter is a multi-step run (recall -> memory injection -> reasoning -> tool calls -> validation) with the live reasoning theater showing the plan form. CEO decisions chain across chapters: choice -> memory -> recall -> visibly different artifact. |
| Reliability and Safety | 20% | Human verification gate on every artifact, deterministic validator floors under the rubric score, four-layer degradation (Foundry project endpoint -> /openai/v1 -> simulation; IQ -> local playbooks; memory store -> local ledger; Toolbox -> local registry), secret scrubbing, no raw chain-of-thought, SSRF-guarded URL ingestion. The evidence smoke test fails the build if any chapter ships without proof points. |
| Creativity and Originality | 15% | "Gamifying World Improvement" - a gamified world-improvement simulator where the model designs its own workforce; agent memory as an audible game mechanic; dilemma gates written by the narrator from the artifact just sealed; cinematic voiced intro film that hands off into live play. |
| UX and Presentation | 15% | Voiced intro film -> founding screen -> live reasoning theater, one evidence rail (Active Worker, Agent Framework, Digital Workforce, Foundry IQ Memory, Agent Memory - learned, Verification Gate), XP/levels, Mermaid artifact diagrams, multi-voice neural TTS narration. |
| Community vote (Discord poll) | 10% | Public demo clip + concise project post + Discord engagement plan that points voters to the required proof points (Foundry reasoning, IQ citations, verification gates, replay evidence). |

Prize note from official rules: one prize per person during the Entry Period
unless otherwise noted.

## Final 24-Hour Checklist (Highest-EV Target: Best Overall Agent)

Primary target: Best Overall Agent.
Secondary target: Best Reasoning Agent.
Constraint: assume one prize per person, so optimize one polished submission.

1. Submission package lock (must-have)
- [ ] Public GitHub repo is current, runnable, and includes clear setup + demo steps.
- [ ] Demo video link (<= 5 minutes) is live on YouTube or Vimeo.
- [ ] Project description is concise and mapped to rubric language.
- [ ] Architecture diagram is present and matches shipped code paths.
- [ ] Team/member fields are complete on the contest project page.

2. Rubric proof pass (judge confidence)
- [ ] Accuracy: show one complete run from founder input to accepted artifact.
- [ ] Reasoning: show decomposition (world graph) and one worker invocation with evidence.
- [ ] Reliability: show verification gate + deterministic validator output + fallback mode.
- [ ] Creativity: show what is uniquely game-like in this product (not just chat UX).
- [ ] UX: show end-to-end flow without dead ends, visual glitches, or confusing prompts.

3. Reliability hardening (high-weight + tie-breaker leverage)
- [ ] Run simulation smoke path and capture clean output for demo day.
- [ ] Verify replay log contains agent/tool/evidence events across a full run.
- [ ] Verify state save/reload continuity after server restart.
- [ ] Remove flaky paths, stale feature flags, or non-essential toggles from the demo flow.

4. IQ and reasoning receipts (Best Overall + Best Reasoning + Best IQ signal)
- [ ] Show at least one Foundry IQ citation in a real chapter execution.
- [ ] Show at least one tool-use receipt and one memory injection receipt.
- [ ] Ensure the evidence rail/back-of-card receipts are readable in the video.

5. Accessibility and presentation polish (award upside)
- [ ] Keyboard navigation works for primary actions (start, choice, gate action).
- [ ] Color contrast and text legibility are acceptable in key screens.
- [ ] Captions or clear narration exist in the demo video.

6. Community vote execution (10%)
- [ ] Publish one concise Discord post with: problem, 30-second value summary, repo link, demo link.
- [ ] Include one screenshot/gif that proves "reasoning + evidence + gate" in a single frame.
- [ ] Keep outreach compliant (no incentives, no spam, no automation).

7. Final compliance sweep
- [ ] No secrets or private data in repo, video, screenshots, or logs.
- [ ] License and third-party asset usage are clean for public submission.
- [ ] Submission is completed before deadline (June 14, 11:59 PM Pacific Time).

## Submission Requirements Checklist (spec: "To be considered valid")

| Requirement | Status | Where |
|---|---|---|
| Multi-agent system aligned with the role-play scenario | DONE | World Designer + Org Designer + per-chapter digital workers (`agents/`) |
| Microsoft Foundry and/or Agent Framework | DONE (both) | Foundry deployments via `model_config.py`; MAF agents via `maf_runtime.py` (FoundryChatClient first) |
| Reasoning + multi-step decisions across agents | DONE | Chapter graph, org binding, decision ledger, reasoning theater |
| Game Master agent (orchestrator + narrator + world builder) | DONE | World Designer/Narrator: decomposes, narrates every beat, writes dilemmas |
| Every agent has a clear in-story character role | DONE | Discovery Analyst, Strategy & Positioning Lead, Product Builder, Growth Marketer, Retention & Ops Worker - the business-RPG party |
| External tools / APIs / MCP where useful | DONE | MCP-shaped toolbox (`tools/toolbox.py`), code interpreter validators, web `map_company` scraper |
| Foundry IQ integration for campaign knowledge | DONE | `agents/retrieval.py` - real IQ first (cited), committed playbooks fallback |
| Demoable live or recorded | DONE | Live server + simulation mode + voiced film; smoke-tested end to end |
| Docs: agent roles | DONE | `docs/org_designer_and_digital_workforce.md`, `docs/world_designer_and_worker_factory.md` |
| Docs: reasoning flow + orchestration | DONE | `docs/architecture.md`, `docs/game_loop.md`, `docs/how_it_all_connects.md` |
| Docs: game loop | DONE | `docs/game_loop.md`, `docs/game_design.md` |
| Docs: tools/MCP/IQ usage | DONE | `docs/foundry_integration_plan.md`, `docs/how_it_all_connects.md` |
| Docs: state management | DONE | `state/schema.py` docstrings, `docs/architecture.md` |

## Optional "highly valued" items we also hit

| Optional item | Status | Where |
|---|---|---|
| Evaluations / telemetry / monitoring | DONE | Rubric evaluator at every gate; four proof points per invocation; replay log; evidence smoke test |
| Advanced patterns (planner-executor, reflection) | DONE | World Designer plans, workers execute; validators as FunctionTools = self-check reflection mid-run |
| Responsible AI guardrails | DONE | Human gates, no raw CoT, secret scrubbing, SSRF guards, synthetic data |
| Persistent world memory backed by retrieval | DONE | Foundry IQ + Agent Service memory (user_profile / procedural / chat_summary) with local ledgers |
| Player character progression | DONE | XP, levels, founder archetype as starting gear |
| In-character dialogue / party dynamics | DONE | Multi-voice TTS cast; workers speak in role; narrator credits the party |
| Creative gameplay mechanics | DONE | Dilemma gates, memory the player can hear, income beat, business flags |
| Strong demo storytelling | DONE | Voiced intro film (5 clips) flowing into live play - one continuous narrative |

## The flow: film -> reasoning agents -> role-play (one thread)

1. **The film IS the welcome.** Five voiced clips (title, sahara, needs,
   workforce, foundry) set the cosmology: missions worth running a company
   for. The film's close is answered by the game's first narrated line when
   `fromFilm` is set - "And it takes you." One breath, no second welcome.
2. **Mission choice = character creation.** Picking Mission A/B (or typing a
   pitch) seeds the company; picking an archetype (Builder/Seller/Designer/
   Operator) seeds the HUMAN seat of the org - the film's "aligned human and
   AI workforce" made playable.
3. **The Org Designer answers the film's promise.** The film shows a
   workforce; the first reasoning beat designs one, live, for THIS venture.
4. **Chapters are the role-play.** Each node of the campaign graph is a chapter
   owned by an in-story character agent; the reasoning theater is the
   "watch the party act" moment; the gate is the player's turn.
5. **Memory closes the loop.** What the CEO decides at each gate becomes who
   the workforce is for the rest of the run - the film's alignment theme,
   mechanized.

## Proof Points to Show Live

- Foundry-hosted Master Narrator and character agents.
- Foundry IQ citations in the reasoning panel.
- Code validation results attached to each artifact.
- Rubric-scored gates: the score bar fills from weighted rubric dimensions on screen - the judges grade us on a rubric while our gates grade artifacts with one.
- Replay log with agent handoffs, tool calls, and the four proof points (iq_hits, memory_injected, tools_called, inference_usage).
- Verification gates before XP awards.
- Agent memory panel growing as the CEO plays (learned profile, patterns, shipped work).
- "Under the Hood - live evidence" rail panel: accuracy ("is it grounded?"), reasoning ("is it thinking?"), and reliability ("can you trust it?") each keep a live counter plus the most recent real evidence line, fed by every chapter run, gate verdict, and CEO decision - the three invisible rubric dimensions, watchable while the game plays.
