# Org Designer & the Digital Workforce

> **Status:** vision / design draft, with a working first slice already shipped.
> Backed by live Foundry runs and a zero-Azure simulation fallback. This doc is
> the companion to [world_designer_and_worker_factory.md](world_designer_and_worker_factory.md):
> that one decomposes the *work*, this one designs the *company that does it*.

## North Star

A single human has a skill. They want to turn that skill - or a vibe-coded
prototype - into a real business without hiring a team on day one. The bet of
this project: the **execution layer** is a set of **digital workers** (AI agents
on Foundry), and the human stays the operator who sets direction and approves.

So the first question any founder has to answer is the one this subsystem
answers for them:

> **What org does this company actually need, and which of those seats should be
> a digital worker versus a person?**

Answering that well is the whole point. It is how the player *understands* their
company before they build it, and it is the reusable, educational core that
generalizes from "my idea" to "any company on the internet" (point it at a URL).

The campaign graph framing stays. The org is the **party sheet** for the venture: who is
on the team, what each one is accountable for, and why they exist at all.

---

## What exists today (the first slice)

A working Org Designer that runs on the real reasoning path with a simulation
fallback for forkability.

| Piece | Where | What it does |
|---|---|---|
| `OrgRole`, `OrgBlueprint` | [state/schema.py](../state/schema.py) | Typed state for a dynamic org: roles, reporting lines, KPIs, tools, cost, and an educational `why` per role. Layered onto `CompanyState` next to `world`. |
| `design_org()` | [agents/org_designer.py](../agents/org_designer.py) | LLM designs the smallest org that can deliver: one human operator + digital workers. Runs on `STRATEGIST_MODEL` live; rich brief-adaptive fallback offline. Normalizes + repairs the reporting tree and computes stats. |
| URL ingestion | [agents/retrieval.py](../agents/retrieval.py) | `ingest_url()` + `brief_from_url()` turn any public homepage into a brief. Stdlib only (forkable). SSRF-guarded: http/https only, public hosts only, blocks localhost, private ranges, link-local, and the cloud metadata IP. |
| `/api/company/analyze` | [tools/server.py](../tools/server.py) | Accepts a pitch OR a url, designs the org, awards a leverage-scaled charter XP, and persists it into the session so the venture build inherits it. |
| Story Mode surfacing | [ui/game/story.js](../ui/game/story.js), [ui/story.html](../ui/story.html) | Opening "Beat 1: The org this company needs" animates the org as a Mermaid chart; a persistent "Digital Workforce" rail shows the operating model + every role's rationale. URL input next to the pitch field. |

### The conceptual model

An `OrgBlueprint` is intentionally small and legible:

- **One operator** (`kind: human`, the root of the tree). The judgment and the
  accountability. Everything else reports up to a human seat.
- **Digital workers** (`kind: digital_worker`) - the execution layer. Each has a
  `mandate`, `kpis`, `tools`, a `deployment_hint` (reasoning / fast / creative),
  a `lifecycle_stage`, a `monthly_cost_usd`, and a `why`.
- **Derived stats** that power the game mechanic: `headcount`,
  `digital_worker_count`, `monthly_burn_usd`, and a **`leverage_ratio`** (digital
  workers per human). Leverage is the headline number - it is literally "how much
  company one person can run."

The `why` field is the educational spine. It is plain-language ("Most vibe-coded
apps die from building before validating - this worker keeps you honest about
demand") so a first-time founder learns *why the org looks the way it does*, not
just *what* it contains.

---

## The thing we need to think about (the gap)

Right now the system holds **two graphs that do not talk to each other**:

1. The **Org** (`CompanyState.org`) - *who the company is*. Dynamic, designed per
   company, mostly digital workers.
2. The **Venture / World** (`CompanyState.world`) - *what work happens*. Five
   chapters, each assigned to a fixed role from a small set
   (strategist / designer / marketer / ops).

The dynamic org is designed, shown, and then... set aside while a separate,
fixed cast does the chapter work. That is the seam. Closing it is the next phase,
and it is the single change that makes the whole story click:

> **Make each chapter owned by one of the dynamically designed digital workers.**

Then the chain reads end to end as one sentence: *the player gives a pitch or a
URL -> an LLM designs the digital workforce -> those exact workers execute the
venture -> the human verifies each artifact.* "The LLM creates the agents" and
"those agents do the work" stop being two demos and become one reasoning loop.
That is also the strongest version of the multi-step-reasoning rubric story:
design-time reasoning (org) feeds run-time reasoning (chapters).

---

## Roadmap (small, shippable, in priority order)

1. **Bind org roles to chapter ownership.** When the World Designer emits a
   chapter, resolve its `owner_role` against the `OrgBlueprint` (pick the worker
   whose `lifecycle_stage` / mandate matches) instead of the fixed four. The
   Worker Factory spawns *that* worker on its `deployment_hint`. State already
   supports it; this is mostly a scheduler lookup in
   [agents/worker_factory.py](../agents/worker_factory.py).

2. **Hire-on-demand mechanic.** If a chapter needs a capability no current role
   covers, the org *hires* a new digital worker mid-quest (a visible org-growth
   beat + a small XP/burn cost). This is the multi-hop "request a sub-worker"
   pattern from the World Designer doc, made concrete and on-screen.

3. **Runway + leverage as a real mechanic.** Today `monthly_burn_usd` and
   `leverage_ratio` are computed but cosmetic. Wire a simple runway: starting
   cash, burn per month, and a score that rewards high leverage (more company per
   human) against a budget. Makes the org a decision, not just a diagram.

4. **The "any company" path, deepened.** URL ingestion works for a single page;
   next is optional multi-page read and real Foundry IQ indexing of the fetched
   content so the org design is grounded in the company's own words. Keep the
   stdlib fallback so a fork with no Azure still works.

5. **Educational overlays - the prototype -> business arc.** Surface the
   per-role `why` and the operating model as teachable moments. The org screen
   is where "I have a prototype" becomes "I have a company."

6. **Geometric view reads the same org graph.** Point the geometric canvas at
   `CompanyState.org` so rooms/agents are the *designed* workforce, not a fixed
   layout - one source of truth across Story and Geometric views.

7. **Service-delivery framing (stretch).** The same blueprint models a human who
   sells their skill *as a service* and uses digital workers to fulfill it for
   clients. The org becomes the delivery team behind one operator. This is the
   bridge from "build my company" to "run my agency."

---

## Why this serves the rubric

| Criterion | How the dynamic org helps |
|---|---|
| Accuracy & Relevance | The org is the "party" from the canonical spec, designed instead of hard-coded. Closing the org->execution seam maps party members to the agents that act. |
| Reasoning & Multi-step | Design-time reasoning (what team) feeds run-time reasoning (the team works). Hire-on-demand is visible multi-hop. |
| Reliability & Safety | One human operator at the root of every org; the verification gate stays. SSRF-guarded URL ingestion is the safe boundary for untrusted input. |
| Creativity & Originality | "Your company as a designed digital workforce, mapped from a sentence or a URL" is a novel, useful reskin. |
| UX & Presentation | The Digital Workforce rail + animated org chart make an abstract idea legible at a glance. |
| Education | The per-role `why` and the leverage number teach how to turn a prototype into a company - the under-served gap. |

---

## Open questions for the maintainer

1. **Org->chapter binding**: should a chapter pick exactly one owner, or can two
   workers co-own a chapter (e.g., Product Builder drafts, Growth Marketer
   rewrites for conversion)? The schema allows either.
2. **Hire-on-demand**: auto-hire when a gap is detected, or pause for a human
   "approve this hire" gate? The gate is more on-brand but slower in a live demo.
3. **Runway**: do we want failure states (run out of cash) or is leverage a pure
   score with no game-over? Affects how tense the mechanic feels.
4. **URL ingestion depth**: single homepage (current) vs a small crawl. More
   signal vs more latency and more SSRF surface to guard.
5. **Service framing**: is "run my agency" in scope for June 10, or a post-event
   direction? It is the most ambitious read of the vision.

---

## How to run it today

```bash
# from repo root, no Azure required (simulation fallback)
source .venv/bin/activate
DEMO_MODE=simulation PORT=8070 python3 submission/tools/server.py
# open http://127.0.0.1:8070/story  ->  enter a pitch OR a company URL  ->  Begin

# design an org directly
curl -s -X POST localhost:8070/api/company/analyze \
  -H 'Content-Type: application/json' \
  -d '{"pitch":"An AI tool that helps freelance designers price their projects."}'

# or point it at any company
curl -s -X POST localhost:8070/api/company/analyze \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}'
```

Live Foundry produces a fully tailored org; simulation produces a rich,
brief-adaptive one. Both yield exactly one human operator at the root.
