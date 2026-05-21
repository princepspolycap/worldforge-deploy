# Agents League · Battle #2 — Teaching & Setup Plan

Source: Live prep sync with Carlotta Castelluccio and Lee Stott (Microsoft), May 21 2026.
Recording: https://fathom.video/share/xZjbRss5GeXMseuNaPLhzZ3s3xpZY7yo

This doc is our running plan for what we set up, teach, and ship around the live battle on **June 10, 2026, 9 AM PT**. It feeds the blog series under `submission/blogs/` and the live demo.

---

## 1. Format & expectations (from the sync)

- **Live platform**: StreamYard (browser, no install). Screen-share stays live the entire time; producer cuts between competitors.
- **Run of show**: ~5 min Carlotta + Lee intro -> competitor intros -> ~40 min build & narrate, tournament-style context switching between competitors.
- **Tech run-through**: rehearsal call around June 8 with the production team. Carlotta will notify.
- **Tone**: live sport / "good, bad, ugly" — having fun, mixed-ability friendly, no ninja expectations. Walk audience through *thought process* and *blockers*, not a polished lecture.
- **Audience**: AI engineers, developers, architects — assume some are new to Foundry. Explain acronyms. Provide code samples and repo links.
- **Action items from Microsoft side**:
  - Set us up as authors on the Educated Developer blog (Lee Stott).
  - Update the registration page with our bios + headshots (Carlotta).
  - Optional Discord roundtable after the stream for community Q&A.

---

## 2. Our angle: "Your Company Is the Dungeon"

What we said we'd bring:
- Side-scrolling, multi-agent reasoning RPG where the player's business idea becomes a dungeon, and the rooms are functional departments (strategy, design, marketing, etc.).
- Reuse of sprite work we already had (similar in spirit to Gather).
- Story arc: take an idea -> decompose into quests -> specialist agents produce real artifacts -> human verification gate awards XP.
- Education arc: how to go from a *vibe-coded* prototype to a *stable, observable* product. That's the gap Lee called out as under-served.

This is already scaffolded in `submission/`:
- State + agents + validators + quest YAML + CLI simulator
- FastAPI server + Phaser web client + verification gates UI

What we still need to wire (see Section 6 plan).

---

## 3. Teaching topics — direct from the sync

These came out as the highest-value topics for the community. Each becomes a blog post (or a beat in the demo).

### 3.1 Model selection (1,100+ models — which and why)
- How to pick a Foundry model for a given reasoning task.
- Quick comparison: GPT-5 family vs smaller / cheaper models for tier-1 chat openings ("hi", "can you help me").
- **Model Router** (28+ models, ~1 year old): when to use it, when not to. Our concrete pitfall: hard to pin a specific model per agent for cost tracking when going through LiteLLM. Worth showing this trade-off live.

### 3.2 Evaluation & observability — from dev to *operation*, not just production
- Benchmark / human-eval the model before shipping.
- Continue evaluating in production. People use the agent differently than you predicted.
- Re-pick the model once you see real usage patterns.
- Show traces, prompts, responses, tool calls. The "Reasoning Event Logs" panel in our UI is the entry point for this story.

### 3.3 From prototype to operationalized agent
- SDLC for agents: where it lives, how it deploys, how it changes.
- GitHub agentic workflows for ops.
- Change management around agent behavior changes.

### 3.4 Building rich context cheaply
- Lee's example: customer says "hi" — that goes to a mini model. By turn 3 ("order 59436 ordered July 12"), you've escalated.
- Our complement: pull prior context from a graph DB + vector DB *before* sending to the LLM, so even "hi" arrives enriched ("hi from Princeps, thanks for your last order"). Same wow-factor, lower per-turn cost.

### 3.5 Reasoning visibility
- Why showing the decomposition tree and tool calls matters for trust.
- How our Master Narrator decomposes a pitch into quest steps the user can see and approve.

### 3.6 Human-in-the-loop verification gates
- Why deterministic validators + a human checkpoint beats "let the LLM judge itself".
- Concrete example: positioning / landing page / email validators in `submission/tools/code_interpreter_wrappers.py`.

### 3.7 Spec-driven vs vibe-coded development
- Lee called out SpecKit and Amplifier as one end of the spectrum, full YOLO Copilot CLI on the other.
- We'll narrate our own choice and *why*, not prescribe. Acceptable answer per Lee: "I picked this because I've never done it before and want to learn."

### 3.8 Prompt engineering & guided generation
- How we constrain agent output so the deterministic validators can score it.
- What we do when the model hallucinates a missing field.

### 3.9 Tooling choice: VS Code vs Copilot CLI vs YOLO
- Both are valid. We'll demo VS Code (Princeps) and can reference CLI YOLO.

---

## 4. Blog series plan (Educated Developer / Agents League)

Once Lee Stott gives us author access on the Educated Developer blog, we publish under the **Agents League** series. Cross-posting to personal blog is fine.

Working backlog (each one targets AI engineers / devs / architects, explains acronyms, links to repo):

| # | Working title                                                              | Maps to topic | Status   |
|---|----------------------------------------------------------------------------|---------------|----------|
| 1 | Your Company Is the Dungeon — why we framed business onboarding as an RPG | Section 2     | drafted  |
| 2 | Picking a Foundry model: GPT-5 vs Model Router vs locking a deployment     | 3.1           | planned  |
| 3 | Evaluating agents from dev to operation (not just prod)                    | 3.2 / 3.3     | planned  |
| 4 | Reasoning visibility: showing the decomposition tree to your users         | 3.5           | planned  |
| 5 | Verification gates: deterministic validators + a human, in 50 lines        | 3.6           | planned  |
| 6 | "Hi" is a tier-1 problem: enriching cheap-model turns with graph + vector  | 3.4           | planned  |
| 7 | Vibe-coded to shipped: turning a prototype into a service                  | 3.3 / 3.7     | planned  |
| 8 | Post-mortem of the live battle: what broke, what we fixed live             | retro         | post-event |

Existing draft to fold into post #1: [submission/blogs/foundry_learnings.md](../blogs/foundry_learnings.md).

Reference reading we're drawing from:
- Microsoft Foundry progressive lab — https://techcommunity.microsoft.com/blog/azuredevcommunityblog/building-ai-agents-with-microsoft-foundry-a-progressive-lab-from-hello-world-to-/4521792
- Educator Developer Blog (target series home) — https://techcommunity.microsoft.com/category/educationsector/blog/educatordeveloperblog
- Microsoft Reactor series (live battle home) — https://developer.microsoft.com/en-us/reactor/series/S-1658/

---

## 5. Setup checklist (what we own)

- [ ] Create Educated Developer community profile, send to Lee Stott so he can grant blog author access.
- [ ] Send bio + headshot to Carlotta for the registration page.
- [ ] Confirm date/time of the June ~8 tech run-through with the production team.
- [ ] Verify StreamYard works in our browser (camera, mic, screen share, second monitor).
- [ ] Pin a Foundry model deployment per agent in `submission/.env` (no surprise model swaps mid-demo).
- [ ] Wire the agents to a real Foundry SDK call path (currently mock outputs).
- [ ] Decide: Model Router demo *as a contrast*, or keep all agents on a pinned model? Likely pin for the live run, mention Router as a sidebar.
- [ ] Add a "Reasoning Trace" view (decomposition tree + tool calls visible per step). Bones already exist in the event log.
- [ ] Add the graph + vector context enrichment example (Section 3.4) so we can demo it during the "Hi" beat.
- [ ] Cut a 90-second cold-open: title screen + first quest spawn.
- [ ] Dry-run the full 40-minute demo end-to-end at least twice before June 10.

---

## 6. Demo beats we want to hit live

Rough order — final ordering goes in `submission/docs/demo_script.md`:

1. Title screen, framing: "your company is the dungeon".
2. Pitch -> Master Narrator decomposition (visible reasoning).
3. Soren produces positioning. Show the deterministic validator scoring.
4. Verification gate: approve / reject. Talk about why this gate exists.
5. Dahlia produces page structure. Talk model selection here (why this agent uses this model).
6. Maddox produces launch email. Talk context enrichment here.
7. Code walkthrough: `agents/`, `tools/code_interpreter_wrappers.py`, `state/schema.py`.
8. Architecture: how it maps to the canonical Game Master pattern in `live_battle_challenge.md`.
9. Forkability: `git clone`, env reuse, YAML quest authoring.
10. Close with the blog series + community CTA.

---

## 7. Open questions to bring back to Carlotta / Lee

- Final producer name (Anna?) and tech run-through date.
- Discord roundtable: confirm format and time so we can promote it in the blog.
- Are slides required, or is the live build + voiceover enough?
- Any redlines on using third-party packages (Phaser, FastAPI) in the reasoning path? Reasoning core stays on Foundry — those are just renderers / transport.

---

## 8. Tone reminders for the blogs and the live run

- Show the *good, bad, and ugly*.
- Narrate the thought process, not the conclusion.
- Make assumptions explicit. Define every acronym the first time.
- Link to the repo and to specific files.
- Make it fun. Enterprise does not have to be boring.
