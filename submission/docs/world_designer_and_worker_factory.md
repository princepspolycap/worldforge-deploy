# World Designer & Worker Factory

> **Status:** vision / design draft. Backed by a local smoke-test run (ignored by Git) showing the configured Foundry deployments producing rich, structured artifacts.

## North Star

Take **Gamifying World Improvement** from "decompose a pitch into 3 quest steps" to a **world-improvement campaign simulator** where a player can:

1. Drop a pitch *or* a competitor URL.
2. Watch a Foundry-driven team **self-organize** around the brief - allocate roles, propose org chart, set OKRs, draft a financial plan, pick GTM channels, wire integrations.
3. **Autoplay** the simulation while still hitting verification gates, so the player can sit back and watch the venture unfold, or step in to approve / reject.
4. Walk away with a usable bundle: positioning doc, landing page spec, integration map, org chart, OKRs, 6-month financial plan, GTM channel mix, launch email.

The campaign graph framing stays. What changes is the **fidelity of the artifacts**, the **autonomy of the agents** between gates, and the **world response** after each approval.

The playable world should stay story-view-first for this demo pass. The World Designer should generate a venture graph, chapter metadata, evidence, and artifact kinds that the browser renders as narrated beats, Mermaid diagrams, SVG artifacts, KPI meters, and company-system maps.

---

## Two new subsystems

### 1. World Designer (the meta-Narrator)

Today: `MasterNarrator.decompose_pitch()` returns 3 steps for {strategist, designer, marketer}.

Future: a `WorldDesigner` agent that produces the *entire venture world* up front:

- **Chapters** (5+, not 3): Discovery, Positioning, MVP, GTM, Retention, Scale, ...
- **Each chapter** declares: title, goal, owner_role, success_metric, depends_on, suggested_tools.
- **Side-quests**: optional branches (e.g., "Validate before you build" only fires when discovery_score < threshold).
- **World state**: timeline (month 0 -> month 6), runway, persona library, competitor map.
- **Room metadata**: room label, color token, door dependency, artifact kind, graph node IDs, camera target, and reward beat.

This is the **graph** the Worker Factory schedules against. The smoke test shows the narrator deployment already produces this shape correctly in roughly one live request.

Minimal generated world shape:

```json
{
  "chapters": [
    {
      "id": "positioning",
      "title": "Positioning Chamber",
      "owner_role": "strategist",
      "artifact_kind": "positioning_doc",
      "success_metric": "ICP and wedge are specific enough to validate",
      "depends_on": [],
      "room": {
        "x": 180,
        "y": 132,
        "color": "strategy",
        "door_from": "pitch_chamber",
        "graph_nodes": ["icp", "pain", "offer"]
      }
    }
  ]
}
```

### 2. Worker Factory (specialist agent pool)

A pool of specialist roles, each pinned to a Foundry deployment. The World Designer's chapter graph tells the factory *which worker to spawn when*.

| Worker role | Env var | What it produces | Smoke-test verdict |
|---|---|---|---|
| Narrator / World Designer | `NARRATOR_MODEL` | Chapter graph, dependency edges, tool suggestions | Fast, tight JSON, picks great success metrics |
| Strategist | `STRATEGIST_MODEL` | Org chart, OKRs, hiring plan, persona depth | Highest fidelity but slower and verbose - use for deep work, not gates |
| Designer | `DESIGNER_MODEL` | Landing page IA, integration map, UI sections | Rich nested structure with CTAs and integration maps |
| Marketer | `MARKETER_MODEL` | GTM channels, CAC, weekly hours, financial plan | Opinionated channel mix with leverage notes |
| NPC chatter | `NPC_FAST_MODEL` | One-line barks, dialogue flavor | Keep this low-latency |

**Routing rule of thumb** (set in `agents/model_config.py`):
- Latency-sensitive on-screen reactions -> low-latency dialogue deployment.
- Single-screen artifacts you'll show the player -> Designer / Marketer / Narrator.
- Deep multi-section reports the player will scroll through -> deep reasoning deployment.

---

## Autoplay loop

Add an `/api/autoplay` endpoint that:

1. Initializes a session from a pitch.
2. Walks the chapter graph in topological order.
3. For each step: spawn the worker, call its Foundry deployment, run the deterministic validator (code interpreter), log to the reasoning trace.
4. Auto-approves if validator score >= silver threshold; **pauses for human gate** if bronze.
5. Streams events to the UI (Server-Sent Events or WebSocket).

The verification gate is still the rubric story for *Reliability & Safety*. Autoplay just removes the click-through when the validator is confident.

The UI should visualize autoplay rather than hiding it:

- Draw a route line from the player to the next active room.
- Move the avatar through the same proximity gate used for manual play.
- Put the active worker into `focus` state during the model call.
- Pulse the relevant company graph nodes while the artifact is being created.
- Open the next door only after the validator and approval rule pass.

---

## Self-organization (where this gets interesting)

Right now the Narrator assigns each step to a specific role. The richer pattern, seeded by the smoke-test results:

1. **World Designer** outputs the chapter graph **with role suggestions, not assignments**.
2. A short **Worker Factory deliberation** call (one Narrator turn) reviews the graph and assigns concrete workers, possibly splitting a chapter across two workers ("Designer drafts copy, Marketer rewrites for conversion").
3. Each worker can **request a sub-worker** mid-task (e.g., Strategist asks for a fresh persona pass from another Strategist instance with a tighter focus). This is the multi-hop reasoning rubric demands.
4. State + memory live in the existing `StateStore` - extend `CompanyState` with `world: WorldGraph` and `workers: list[WorkerInvocation]` so the replay log captures who-spawned-whom.

---

## Artifact types as game rewards

The Worker Factory should produce artifacts that can become visuals in the verification panel and in the campaign graph itself.

| Artifact kind | Producing worker | Visual renderer | In-world effect |
|---|---|---|---|
| Positioning doc | Strategist | Markdown card | Opens ICP/pain/offer graph nodes |
| Org chart | Strategist | Mermaid | Adds worker/team nodes to the company graph |
| Landing page spec | Designer | HTML preview or structured card | Lights up product and CTA nodes |
| Integration map | Designer | Mermaid | Connects product, data, CRM, email, and analytics nodes |
| KPI/OKR tree | Strategist or Marketer | Mermaid | Adds goal meters above rooms |
| Financial plan | Marketer | Chart.js | Adds runway, MRR, burn, and breakeven meters |
| GTM plan | Marketer | Chart.js + markdown | Adds channel lanes and launch timeline |

This is how graphics become more than decoration: every approved artifact changes the world model.

---

## What this needs from Foundry beyond chat completions

| Foundry primitive | Used for | Status |
|---|---|---|
| Chat completions on configured Foundry OpenAI v1 endpoint | All reasoning | Wired |
| AAD via `DefaultAzureCredential` | Prod auth, no keys in CI | Wired (key fallback for local) |
| Foundry IQ (retrieval) | Pull competitor URL content, past playbook excerpts | Not yet wired - next step |
| Code interpreter | Deterministic validators (positioning shape, financial plan math, GTM CAC sanity) | Wired for v1 step set; extend for financial plan |
| Tracing / monitoring | Captured into our own `replay/` log; can mirror to App Insights later | Local only |

---

## Concrete next steps (small, shippable)

1. **State model**: add `WorldGraph`, `Chapter`, `WorkerInvocation` to `state/schema.py`. Keep the existing `QuestState` shape so the UI doesn't break - `WorldGraph` is layered on top.
2. **`WorldDesigner` agent**: subclass `BaseFoundryAgent`, deployment = `NARRATOR_MODEL`, method `design_world(brief)` returning `WorldGraph`. Smoke-test prompt becomes its reference template.
3. **`WorkerFactory`**: a thin scheduler that walks the graph, picks the worker, calls it. Pure Python, no LLM call of its own.
4. **`/api/autoplay`** endpoint + UI button next to the existing "Autoplay Demo" (already exists in the toolbar) - rewire it to hit the new endpoint instead of the canned mock loop.
5. **Financial-plan validator**: new code-interpreter wrapper that checks MRR ramp monotonicity, breakeven math, burn vs runway.
6. **Foundry IQ knowledge base**: seed with public bootstrapper playbooks (Indie Hackers posts, etc.) and wire a retrieval pass into the Strategist prompt.
7. **Visual world renderer**: render `WorldGraph` and `artifact_kind` metadata into story-view diagrams, artifact panels, and evidence rails.
8. **Artifact renderers**: add Mermaid and Chart.js support to make org charts, workflows, KPIs, and financial plans visible at gates.

---

## Empirical model notes from the smoke test

These came directly from a local smoke-test result file that is ignored by Git - keep them in mind when picking a deployment for a new worker:

- **Narrator-class deployment**: may reject non-default temperature. The agent helper now handles this transparently. Best at concise structured planning.
- **Deep strategist deployment**: may consume a large completion budget and wrap output in JSON code fences. Worth the latency only when depth matters (org chart, OKRs).
- **Designer-class deployment**: good default for UI-facing artifacts with nested structures (e.g., hero -> CTA -> link).
- **Marketer-class deployment**: strong fit for marketing and financial channel-mix work; may also wrap output in code fences.

---

## Open questions for the maintainer

1. Should autoplay default to "pause on bronze" or "pause on any validator failure"?
2. For the URL ingestion path, do we want Foundry IQ to fetch + chunk, or a small `httpx` + readability pipeline owned by us?
3. The Worker Factory could spawn workers in parallel where the chapter graph allows it - worth doing for the live demo, or keep it sequential for narrative clarity?
