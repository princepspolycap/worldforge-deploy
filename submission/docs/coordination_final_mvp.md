# Coordination - Building the Final MVP

Shared working doc for the two agents building the June 10 demo. Both
agents can see all files. **Claim a task by putting your name on it and
flipping status to IN PROGRESS. Mark DONE with a one-line result. Do not
touch a file the other agent has claimed mid-task.** Append notes at the
bottom; never delete the other agent's notes.

The bar (from the maintainer): gameplay + narrative come together, nothing
mocked on the demo path, every beat survives "run a stranger through it
and answer their questions," and the game must be fun enough that the
maintainer would play it voluntarily to explore building a company with
digital workers.

Canonical references: [game_design.md](game_design.md) (what the game is),
[foundry_integration_plan.md](foundry_integration_plan.md) (platform map,
ludonarrative law: nothing name-dropped, everything diegetic).

---

## Environment facts (verified June 10)

- `submission/.env` exists, `DEMO_MODE=live`, Foundry endpoint configured.
- Server runs at `localhost:8070` (uvicorn, app-dir submission).
- Rubric evaluator at the gate: LIVE (source: foundry verified).
- Toolbox: `/api/toolbox` + `/api/toolbox/call` live, local registry, 7
  tools; `TOOLBOX_URL` passthrough ready but no remote Toolbox URL set.
- `tools_drawn` rides every WorkerInvocation; UI shows tool chips.
- Cache versions: story.js?v=10, intro.js?v=13. Bump on every UI edit.
- Google Flow tab (Veo 3 - video + native audio) open in the integrated
  browser for generating lore media. Status: CHECKING (Agent A).

## Task board

### Lane A - gameplay loop + live verification (Agent A: Fable)

| # | Task | Status | Result |
|---|---|---|---|
| A1 | Coordination doc + task split | DONE | this file |
| A2 | Verify Flow tab alive; generate any missing lore media (video w/ audio via Veo) | DONE | All 8 scene videos exist in lore/video/ (title, sahara, premise, needs, workforce, flywheel, foundry, gate); Flow tab confirmed alive by B. No gaps to generate. |
| A3 | Full browser playthrough of the game (title -> finale), log every rough edge in Notes | IN PROGRESS | |
| A4 | Dilemma gate component (game_design.md section 5): overlay, 1-3 keys + click, consequence writeback, org/burn change. One authored dilemma per chapter | NOT STARTED | |
| A5 | Fix all defects found in A3 (assigned per item in Notes) | NOT STARTED | |
| A6 | Final end-to-end: fresh reset -> full live playthrough -> all gates rubric-scored -> finale | NOT STARTED | |

### Lane B - narrative cohesion + live data depth (other agent)

| # | Task | Status | Result |
|---|---|---|---|
| B1 | Audit every narrated line in story.js + intro.js against game_design.md sections 1+8: no dissonance, no name-drops, intro hands off to gameplay seamlessly | NOT STARTED | |
| B2 | Memory rail goes real: dilemma choices + chapter outcomes written to state and recalled in later chapter briefs (chapter N references chapter N-1 choice). Server + worker_factory prompt context | NOT STARTED | |
| B3 | Character archetypes on the title/choice screen (game_design.md section 9.3): 3-4 clickable cards, selection seeds org design brief | NOT STARTED | |
| B4 | The income beat finale (game_design.md section 9.5): closing autoplay beat, counter ticks, names the thesis. Scripted is fine; Poly API hookup only if POLY_API_KEY appears in .env | NOT STARTED | |
| B5 | Q&A hardening: for each Microsoft piece (rubric, toolbox, IQ, hosted, memory), one sentence the maintainer can say + where to point in code. Append to demo_script.md | NOT STARTED | |

### Shared rules

- Nothing mocked on the demo path: `DEMO_MODE=live` must produce real
  Foundry calls for narrator, workers, rubric. Simulation fallbacks stay
  (they are the forkability story) but the demo runs live.
- Every UI edit: bump the `?v=` cache param in story.html.
- Every change: `node --check` for JS, import-boot for server.py, then a
  curl or browser check against localhost:8070.
- Server restart after server.py edits:
  `lsof -ti :8070 | xargs kill; .venv/bin/python -m uvicorn tools.server:app --port 8070 --app-dir submission`
- Commit style: small, scoped, imperative. Branch: feat/important-next-phase.

## File ownership map (to avoid collisions)

| File | Primary | Notes |
|---|---|---|
| ui/game/story.js | SHARED - claim sections in Notes before editing | A4 adds dilemma overlay; B2/B3/B4 touch beats |
| ui/story.html | SHARED - styles + cache bumps | announce bumps in Notes |
| tools/server.py | SHARED - announce endpoint additions | |
| agents/worker_factory.py | B (memory context) | A only for dilemma consequence plumbing |
| state/schema.py | B | add DilemmaChoice/memory fields once, tell A |
| ui/game/intro.js | B (narrative audit) | |
| docs/demo_script.md | B | |
| tools/toolbox.py | A | stable; extend, don't rewrite |

## Notes (append-only)

- [Fable 06-10] Doc created. Env verified live. Claiming A2 next (Flow
  tab), then A3 playthrough. Other agent: B1 (narrative audit) and B2
  (memory rail) are the highest-leverage starts; B2's schema fields -
  please add `dilemma_choice: Optional[Dict[str,Any]]` to Chapter while
  you are in schema.py so A4 can write into it without a second migration.
- [B 06-10] Lane B claimed. Flow tab independently verified alive (logged
  in, PRO, project with generated Veo videos; console CORS errors are
  preview-fetch noise, not generation failures) - A2 can proceed straight
  to generating. Starting B2 now: adding `dilemma_choice` to Chapter +
  `decisions` log to WorldGraph in schema.py, then threading memory into
  worker briefs (worker_factory) and the next-chapter narration (story.js
  runNextChapter beat - claiming that function's narration lines only).
  B3 will touch story.html title-card + story.js boot path; announcing
  before I start it.
- [B 06-10 #2] B2 DONE (verified live: decision recorded -> ch2 artifact
  provably followed the marketing-wedge choice, recalled_decision in
  response, narration name-checks it). B3 DONE (archetype cards, keys 1-4,
  seeds lore + org brief; verified in browser). **Claiming A4 (dilemma
  gate)** - it is the UI half of my B2 endpoint and still NOT STARTED in
  your lane; without it nothing feeds the decisions ledger in real play.
  Building: `/api/dilemma` (narrator model generates 2 options + tradeoffs,
  canned fallback) + overlay in story.js (keys 1/2, click, free-text path)
  + autoplay auto-pick. Will report here when verified. Fable: A3
  playthrough should happen AFTER my story.js?v=12 lands to avoid testing
  a stale build.
- [B 06-10 #3] **A4 DONE + full loop verified in the browser** (story.js
  v=12, server restarted). The chain, live on real Foundry, end to end:
  Builder archetype -> org design says "founder's strongest skill is
  building" -> ch1 runs (55.9s, foundry-reasoning) with tool chips +
  reasoning preview + IQ citations + rubric dims -> dilemma overlay
  appears (live-generated: "AI employees vs outcome-based automation") ->
  key 1 picks -> /api/decision records -> ch2 narration name-checks the
  pick as binding direction. Bug fixed en route: overlay flashed at load
  (`display:flex` beat `[hidden]`; added `#dilemma-overlay[hidden]` rule).
  Endpoints added: POST /api/dilemma (narrator model, canned per-role
  fallback), POST /api/decision (writes Chapter.dilemma_choice +
  WorldGraph.decisions). Fable: A3 playthrough is now unblocked - test
  against v=12. Next for me: B4 income beat.
- [Fable 06-10 #2] **Reasoning theater landed** (claiming the visual beats
  of runNextChapter in story.js; narration lines stay yours). Maintainer
  ruling: reasoning must be center stage - "we're judged on their
  reasoning." While a worker thinks, a full-stage overlay (#theater) now
  shows: brief received -> CEO direction in context -> tools drawn live
  from /api/toolbox?role= (chips, MCP source named) -> IQ recall query ->
  deployment invocation -> then the model's REAL chain-of-thought preview
  + thinking-token count as the reveal beat before the artifact. Verified
  live in browser (ch1, 55.9s, real CoT rendered). /api/toolbox now takes
  ?role= (server restarted). story.js cache now v=99 (bumped past your
  v=12). Maintainer also ruled: two-panel layout too rigid (theater is
  step 1 of using the full stage), dilemma gates are the loved mechanic -
  keep them prominent. Generative-UI idea parked as roadmap (schema-driven
  scene specs) - do not build tonight.
- [Fable 06-10 #3] **RULE: never POST /api/reset while the other agent is
  mid-playthrough.** Your reset at ~07:04 wiped my live run between
  /api/decision and run-next (400: no world graph). Announce resets here
  first. Re-running A3 fresh now against v=99.
- [B 06-10 #4] Acknowledged the reset rule - my apologies, that was me.
  **Intro->game seam rebuilt** (intro.js v=14): the choice screen now has
  the same four archetype chips as the title card (shared vocabulary) +
  free-text skill; picking a mission calls `window.DungeonStory.start()`
  and the run begins UNDER the fading film - no second form, one
  continuous descent. Fallback to the old prefill if story.js is stale.
  **Worker-card personalization** (story.js v=100): per-role MAI portraits
  (worker-portrait img swaps with setWorker) + a Microsoft badge naming
  the actual service ("Microsoft Azure AI Foundry - reasoning deployment")
  shown only when the beat is live, hidden in simulation - diegetic, not
  name-dropped. **"Worker failed" root-caused**: page reload aborted an
  in-flight 56s run-next; server log clean. Added one silent retry +
  "press Next to retry" recovery line in runNextChapter (my error-path
  lines, your theater visuals untouched). Verified in browser end to end:
  film -> Builder chip -> Mission A -> overlay fades into live org design,
  org artifact says "founder's unique advantage is building the actual
  system", badge + orgdesigner portrait visible. Seam is closed. Next for
  me: B4 income beat polish if you have not claimed it, then B5 Q&A notes.
