# Project Narrative — Your Company Is the Dungeon

> **Microsoft Agents League · Battle #2 — Reasoning Agents with Microsoft Foundry**
> Live invitational re-run · June 10, 2026 · 9:00 AM PT · ~20 min live demo
> Host: Carlotta (Microsoft) · 3 competitors
>
> This file is the origin strategy. The project has since evolved — the current
> vision, CEO role-play frame, lore, two missions, and the full evolution are
> documented in [submission/docs/vision_and_evolution.md](submission/docs/vision_and_evolution.md).

---

## 1. One-Sentence Pitch

**Boot.dev for building a business** — a side-scrolling, multi-agent reasoning game where the player pitches an idea, a Game Master agent decomposes it into a quest line, and a party of specialist character agents (Strategist, Marketer, Designer, Finance) execute steps that produce real, verifiable artifacts the player must approve before XP is awarded.

The player **orchestrates**. The agents **execute**. The human **verifies**. Same loop as a tabletop RPG — same loop as running a company.

---

## 2. Why This Wins the Rubric

Official judging weights (verified from `microsoft/agentsleague` README, May 2026):

| Criterion | Weight | Our Angle |
|---|---|---|
| Accuracy & Relevance | 20% | We are a **literal 1:1 reskin** of the canonical `live_battle_challenge.md` example. Game Master → Master Narrator. Warrior/Mage/Rogue/Healer/Rival → Strategist/Marketer/Designer/Finance/Rival Competitor. Code interpreter for dice rolls → code interpreter for artifact validation. Foundry IQ for campaign lore → Foundry IQ for business launch knowledge. Shared state JSON identical shape. Judges will see we read the brief deeply. |
| Reasoning & Multi-step Thinking | 20% | Visible reasoning panel showing the Master Narrator's decomposition tree in real-time. Every quest step is a multi-hop chain: intent → retrieve knowledge → propose plan → execute via tool → validate → present to verifier. Replay log shows the full chain. |
| Reliability & Safety | 20% | Every external/destructive action passes through a **human verification gate** before XP is awarded. Tools have simulation fallbacks for the live demo (no network failure can kill the run). Synthetic data only — no PII. |
| Creativity & Originality | 15% | Other teams will ship fantasy RPGs (canonical scenario) or chat UIs (default). We ship a **side-scrolling business dungeon** with an original geometric/narrated visual style that ships fully MIT-clean (no third-party art committed to the repo), where the "dungeon" is the player's business. Domain reskin + visual format are both novel. |
| User Experience & Presentation | 15% | Hand-drawn side-scroller aesthetic. NPC character agents stand in the dungeon room and speak in pixel-text bubbles. XP bar + level-up screen. Quest log scroll. Approve/Reject buttons styled as wax seals. Recognizable game-feel, not enterprise SaaS. |
| Community Vote | 10% | TBD — pending Carlotta confirmation on whether the Discord poll applies to the invitational format. |

**Expected rubric coverage**: Accuracy + Reasoning + Creativity + UX = **70% of the score directly addressed by the angle.** Reliability is engineered in via simulation fallbacks + verification gates. Community vote is a wildcard.

---

## 3. The Canonical Mapping (Why We Can't Lose on Accuracy)

The Microsoft spec literally describes our system. From `starter-kits/2-reasoning-agents/live_battle_challenge.md`:

| Their spec says | We ship |
|---|---|
| "Game Master Agent — orchestrator + narrator + world builder" | **Master Narrator Agent** — decomposes business pitch into quest line, narrates progress, builds the company state |
| "Each character agent should have its own personality, abilities, goals, and tool access" | **4 character agents** — Strategist (positioning/ICP), Marketer (channels/copy), Designer (landing pages/creative), Finance (pricing/projections). Each with personality + scoped tools. |
| "Code interpreter: roll dice, calculate modifiers, resolve combat math" | **Code interpreter** — validate landing page returns 200, regex-check email format, compute conversion math, score the artifact |
| "Foundry IQ for campaign lore" | **Foundry IQ** — curated knowledge base of business-launch playbooks (lean startup, MOM test, first-100-customers, pricing frameworks) |
| "Web search for general public-domain inspiration" | **Web search** — competitor scan, market sizing, public benchmarks |
| "Shared state: campaign, location, active_quest, party, world_flags" | **Shared state: company, stage, active_quest, agents, business_flags** — identical schema shape |
| "Human-in-the-loop confirmation for major irreversible actions" | **Verification gate on every artifact** — player approves/rejects before XP awarded |
| "Telemetry dashboard showing agent calls and reasoning flow" | **Reasoning panel** showing decomposition tree + tool calls live |

**The reskin is the moat.** Same architecture, different stakes — fantasy RPG is entertainment, business builder is useful. Judges see both at once.

---

## 4. The Loop (Core Game Mechanic)

```
Player pitches idea
   ↓
Master Narrator decomposes into 3–5 quest steps
   ↓
For each quest step:
   ├─ Narrator picks the right character agent(s)
   ├─ Character agent(s) plan + execute using tools
   │     ├─ Foundry IQ (retrieve grounded knowledge)
   │     ├─ Code interpreter (validate/compute)
   │     ├─ Web search (market scan)
   │     └─ External tool call (optional Poly backend hook)
   ├─ Artifact produced (landing page URL, email copy, ICP doc, pricing sheet)
   ├─ HUMAN VERIFICATION GATE — player reviews + approves/rejects
   └─ XP awarded on approval, retry/refine on rejection
   ↓
Quest complete → XP screen → next room in dungeon unlocked
```

The verification gate is the soul. It's what makes this a game and not a slop generator. It's also what makes it a real workflow — the human stays in the loop on every output.

---

## 5. Phase 1 Scope (Locked — Build for June 10 Demo)

**Single playable quest line.** First-time founder pitches a SaaS idea. Quest line: positioning → landing page → first email signup. ~3 weeks of build.

### Must-have for demo

- [ ] Master Narrator agent (Foundry-hosted, GPT-4o or equivalent)
- [ ] 3 character agents (Strategist, Marketer, Designer) — Foundry-hosted
- [ ] Foundry IQ knowledge base (10–20 synthetic business-launch docs)
- [ ] Code interpreter integration (landing page 200-check, email regex, copy length validator)
- [ ] Shared state JSON (company + quest + party schema)
- [ ] Side-scroller UI shell (1 dungeon room per quest step, original geometric NPCs - no third-party art - pixel-text bubbles)
- [ ] Verification gate UI (approve/reject artifact, styled as wax seal buttons)
- [ ] XP bar + level-up screen
- [ ] Reasoning panel (collapsible side drawer showing live decomposition tree + tool calls)
- [ ] One real external tool call ("deploy_landing_page") with simulation fallback for demo safety
- [ ] Replay log (saves full session for post-demo walkthrough)

### Nice-to-have if time permits

- [ ] Finance agent (4th character)
- [ ] Rival Competitor agent (creates dramatic tension — canonical pattern from spec)
- [ ] Multiple quest lines (B2C, B2B, marketplace, etc.)
- [ ] Character agent banter (canonical pattern from spec — party dynamics)
- [ ] Telemetry dashboard for judges to inspect after demo

### Explicitly out of scope

- Full Poly backend integration (one tool call max, with fallback)
- Multi-player / multi-tenant
- Production deployment hardening beyond demo
- Mobile UI
- Voice input

---

## 6. Demo Script (20 min Live)

**Minutes 0–3 — Hook**

- Open the side-scroller. Title screen. "Your Company Is the Dungeon."
- Quick visual tour: dungeon room, NPC sprites, XP bar, reasoning panel collapsed on the right.

**Minutes 3–10 — Live play (the meat)**

- Type a pitch: "AI tool that helps freelance designers price their projects."
- Master Narrator decomposes live → quest line appears as scrolls on screen.
- Walk through quest step 1: Strategist NPC speaks, reasoning panel shows Foundry IQ retrieval + decomposition.
- Artifact appears (positioning doc). Verification gate. **Click Approve.** XP awarded, sound effect, level-up animation.
- Step 2: Designer NPC builds landing page. Tool call to deploy. Real URL appears. Code interpreter validates 200. Click Approve.
- Step 3: Marketer NPC drafts launch email. Validates copy. Approve.
- Quest complete screen.

**Minutes 10–15 — Code walkthrough**

- Show repo structure. Highlight: Foundry agent definitions, Foundry IQ KB config, code interpreter tool wrappers, verification gate handler, state schema.
- Show the replay log of the demo we just ran — full reasoning chain visible.

**Minutes 15–18 — Architecture reasoning**

- Diagram: Master Narrator + party + tools + IQ + verification gate.
- Why this maps to the canonical Game Master pattern in `live_battle_challenge.md`.
- Why the verification gate is the safety story (Reliability 20%).
- Why the domain reskin is the creativity story (Creativity 15%).

**Minutes 18–20 — Forkability + close**

- Repo is MIT-licensed, public day one. `git clone` and ship your own dungeon.
- Quest definitions are YAML — community can author new dungeons (B2C, B2B, agency, indie game, etc.) without writing code.
- Q&A handoff.

---

## 7. Architecture Constraints (Non-Negotiable)

From official rubric and starter-kit README:

1. **Reasoning core MUST run on Microsoft Foundry models.** Can't swap GPT-5 for Claude. Master Narrator + character agents = Foundry-native.
2. **Must use scaffold primitives:** Foundry IQ (retrieval), code interpreter (deterministic tools), multi-agent orchestration.
3. **Must be forkable / open-source day one.** MIT license. Community clones and ships their own version. No proprietary dependencies in the reasoning path.
4. **Demo flow fixed:** UI demo → code walkthrough → architecture reasoning, ~20 min live.

### What this means for the Poly backend

- Poly is **optional hands**, not the brain. Reasoning lives in Foundry agents.
- One tool call max to a Poly endpoint (e.g., `deploy_landing_page`) — and only if it has a simulation fallback so a network failure during demo doesn't kill the run.
- Don't take a dependency on Poly. The repo must work standalone after `git clone`.

---

## 8. Repo Layout (Proposed)

```
agentsleague-afterbuild/                  # this fork
├── starter-kits/                         # upstream Microsoft starter kits (don't modify)
│   └── 2-reasoning-agents/
└── submission/                           # OUR build (everything new lives here)
    ├── README.md                         # quick-start, demo instructions
    ├── PROJECT_NARRATIVE.md              # this doc
    ├── docs/
    │   ├── architecture.md               # diagram + agent contracts
    │   ├── demo_script.md                # minute-by-minute demo run
    │   ├── rubric_mapping.md             # how each feature scores
    │   └── carlotta_pitch_draft.md       # reply to Microsoft contact
    ├── agents/
    │   ├── master_narrator.py            # orchestrator
    │   ├── strategist.py                 # character agent
    │   ├── marketer.py
    │   ├── designer.py
    │   └── finance.py                    # phase-1 stretch
    ├── tools/
    │   ├── code_interpreter_wrappers.py  # 200-check, regex, copy validator
    │   ├── foundry_iq_client.py          # KB retrieval
    │   ├── web_search.py
    │   └── deploy_landing_page.py        # with simulation fallback
    ├── state/
    │   ├── schema.py                     # company + quest + party state
    │   └── store.py                      # in-memory + persisted
    ├── knowledge/
    │   └── synthetic_docs/               # 10–20 launch playbook docs for Foundry IQ
    ├── quests/
    │   └── first_landing_page.yaml       # phase-1 quest definition
    ├── ui/
    │   ├── (TBD: React + Pixi.js? Phaser? Plain Canvas?)
    │   ├── sprites/                      # original art only (any third-party packs gitignored)
    │   ├── components/                   # reasoning panel, XP bar, verification gate
    │   └── pages/                        # title screen, dungeon room, level-up
    ├── replay/
    │   └── (saved session logs for code walkthrough)
    └── .env.example                      # AZURE_AI_PROJECT_ENDPOINT etc.
```

> **Why a `submission/` subdirectory inside the fork?** Keeps our build cleanly separated from the upstream starter kits. We can `git pull upstream main` to stay in sync with any spec updates without conflict.

---

## 9. Open Decisions (Need Princeps Input)

1. **Project name** — "Your Company Is the Dungeon" is the marketing name. Repo subdirectory name? Options: `questforge`, `dungeon-builder`, `poly-quest`, `boot-startup`, something else?
2. **UI framework** — Pixi.js (true game engine, more polish, longer build) vs Phaser (game engine, easier) vs React + plain Canvas (faster to ship, less game-feel) vs HTML/CSS side-scroller (fastest, weakest aesthetic). Recommendation: **Phaser** — balance of polish and ship speed.
3. **Sprite licensing** — keep all third-party game art out of the repo; ship geometric-first so the fork stays MIT-clean.
4. **Carlotta reply** — should I draft it now, or wait until Phase 1 scaffold exists so we have something concrete to show?
5. **Community vote** — ask Carlotta whether the 10% Discord poll applies to the invitational, or if it's just judge scoring.

---

## 10. The Bottom Line

We are not adapting a generic spec to a custom angle. We are a **direct domain reskin of the official canonical example.** The Game Master pattern they wrote into `live_battle_challenge.md` is the pattern we ship. The party of character agents with personalities and tools is the pattern we ship. The shared state JSON shape is the shape we ship. The code interpreter for resolution checks is the use case we ship.

What's novel is the **stakes** (real artifacts, real verification) and the **format** (side-scrolling video game, not chat). That's where Creativity (15%) and UX (15%) score.

Everything else — Accuracy (20%), Reasoning (20%), Reliability (20%) — is covered by executing the canonical spec well, with a verification gate as the safety story.

**Total addressable score: 90%.** Community vote (10%) is gravy.

Let's build.
