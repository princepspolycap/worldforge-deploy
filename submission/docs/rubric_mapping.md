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

## Prize stacking - what the rules actually say

Official rules (Section 9): "We will only award one (1) prize per person during
the Entry Period **unless otherwise noted in the table above**."

What is "otherwise noted" in the table:
- Top student award, Accessibility award, and Hack for Good each have their own
  selection criteria and 3 winners each - these are the "otherwise noted" prizes.
- Best Overall, Best Reasoning, Best Creative, Best Enterprise, Best IQ Tools all
  say "1 winner" with no special note - these CANNOT stack with each other.

Practical prize strategy:
- Win ONE of: Best Overall ($15k) OR Best Reasoning ($5k) OR Best IQ Tools ($5k).
  Best Overall is highest-value; target it first.
- ALSO potentially win: Accessibility Award and/or Hack for Good as "noted" carve-outs.
- Max realistic stack: Best Overall + Accessibility + Hack for Good = ~$18k.

## Target Award Matrix

| Award | Prize | How this game qualifies |
|---|---|---|
| Best Overall Agent | $15k cash | Highest score across all 6 rubric dimensions; the most complete reasoning-agent demo in the contest |
| Best Reasoning Agent | $5k cash | Visible multi-step decomposition (World Graph), Foundry-native workers, MAF group chat, IQ recall with citations, four proof points per invocation |
| Best Use of IQ Tools | $5k cash | Foundry IQ grounds every worker brief; local knowledge playbooks as fallback; citations visible in evidence rail and card backs |
| Accessibility Award | swag + Azure credits + Copilot Pro | Keyboard-first interaction grammar (space/arrows/1-4 keys); voice input via mic; TTS narration for every beat; no color-only information encoding; verification gate never requires mouse |
| Hack for Good | swag + Azure credits + Copilot Pro | The entire premise: a solo founder uses a Foundry AI workforce to run a world-improvement campaign; the game is explicitly a tool for climate, health, education, and social good founders |

## Final 24-Hour Checklist

Primary target: Best Overall Agent.
Also target: Accessibility Award + Hack for Good (stackable per rules).
Secondary target: Best Reasoning Agent / Best IQ Tools (same submission - same rubric score drives both).

### 1. Submission package (must-complete before 11:59 PM PT June 14)
- [ ] Public GitHub repo is current, clean, runnable with `git clone` + `pip install -r requirements.txt`.
- [ ] Demo video (<= 5 min) is live on YouTube or Vimeo - unlisted is fine, link must work.
- [ ] Project description text explicitly names: card-stacking roguelike, world improvement, Foundry IQ, MAF, verification gates.
- [ ] Architecture diagram matches shipped code (Foundry -> MAF -> workers -> IQ -> gates).
- [ ] Submission form "Projects" tab is complete: description, video link, repo, diagram, team info.

### 2. Best Overall + Best Reasoning (rubric proof - 6 dimensions)
- [ ] Accuracy: demo shows full run from pitch to accepted artifact.
- [ ] Reasoning: show world graph decomposition + worker invocation with IQ citations and tool trace.
- [ ] Reliability: show verification gate + validator output; mention simulation fallback in description.
- [ ] Creativity: show the roguelike card hand, party worker cards, and antagonist pressure in description/video.
- [ ] UX: demo flow has no dead ends, missing buttons, or stale state after reset.
- [ ] Community vote: Discord post live with screenshot showing reasoning + evidence + gate in one frame.

### 3. Best Use of IQ Tools
- [ ] Demo video explicitly shows the Foundry IQ citation appearing in the evidence rail or card back.
- [ ] Project description calls out: "Foundry IQ grounds every worker brief; local playbooks are the forkable fallback."
- [ ] At least one IQ hit per worker invocation is visible in the replay log.

### 4. Hack for Good (3-winner special award)
- [ ] Project description explicitly names the community need: solo founders running world-improvement campaigns (climate, health, education, food security, housing).
- [ ] The game's opening premise - "Gamifying World Improvement" - is in the first sentence of the description.
- [ ] Demo video shows a world-improvement pitch (e.g., "Solar microgrids for rural clinics") flowing into the agent workforce.
- [ ] Mission framing: the Sahara terraforming / basic needs lore is mentioned as the game's founding mission.

### 5. Accessibility Award (3-winner special award)
- [ ] Keyboard navigation works for every primary action: start run, play card, approve/reject gate, send CEO move.
- [ ] Voice input (mic button) is functional and labeled in the demo.
- [ ] TTS narration covers every major game beat (voiced intro + worker narration).
- [ ] No information is conveyed by color alone (threat meter, card types, gate state all have text labels).
- [ ] Demo video captions or clear voiceover explains what is happening on screen.
- [ ] Project description mentions: "keyboard-first, voice-input, and narrated for screen-reader-adjacent use."

### 6. Community vote (10% of judging)
- [ ] Discord post at https://aka.ms/agentsleague/discord with: problem in one sentence, 30-sec value summary, repo link, demo link.
- [ ] Include one screenshot or gif that shows reasoning evidence + verification gate in a single frame.
- [ ] No incentives, no spam, no automation - strictly compliant.

### 7. Final compliance sweep
- [ ] `git status --ignored` confirms no `.env`, private notes, or generated state in the push.
- [ ] No credentials, deployment names, quota notes, or private URLs in any committed file.
- [ ] License is MIT; third-party assets are confirmed MIT-compatible or generated.
- [ ] Submission filed before June 14, 11:59 PM Pacific Time.

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
