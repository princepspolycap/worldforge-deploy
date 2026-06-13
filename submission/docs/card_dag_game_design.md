# Card DAG Game Design

Status: design direction grounded in the current local codebase. This expands
the card/deckbuilder idea into the actual Story Mode architecture we have now.

Related docs:

- `PROJECT_NARRATIVE.md` - public story and rubric framing.
- `submission/docs/world_improvement_pivot.md` - current product framing:
  profile-first, world-improvement run, no "company as dungeon" language.
- `submission/docs/profile_identity_enrichment.md` - profile URL inference,
  public scraping, and optional external enrichment API strategy.
- `submission/docs/ui_revamp_and_floating_characters.md` - visual design, cast,
  floating cards, and card-native redesign.
- `submission/docs/connected_experience_map.md` - end-to-end product flow and
  state responsibilities.
- `submission/docs/realtime_avatar_dilemma_system.md` - realtime dilemma,
  standup, avatar, and character-state direction.

Private inspiration screenshots live in `submission/private/ui-inspiration/`.
They are local-only and gitignored because they are third-party game screenshots.

## 1. Executive Summary

The experience should read as a roguelike deckbuilder wrapped around real
multi-agent world-improvement work.

The player is the founder. Their public profile and archetype define the human
seat. The mission becomes the graph. The digital workforce is the deck. Chapters
are mission rooms or campaign steps. Artifacts are result cards. Dilemmas are
decision cards. Agent conversations are graph events that change the world
state.

The important distinction:

- The fiction can be authored: rooms, card names, scene language, and world lore.
- The evidence must be real: Foundry calls, tool traces, memory, validation
  scores, metrics, and handoffs come from the runtime.

This gives the demo a clear game surface without weakening the Microsoft Agents
League story: real reasoning agents are visible as characters, cards, and graph
relationships.

## 2. Current Local Foundation

We are not starting from a blank slate. The local code already has most of the
state needed for this design.

| Concept | Current local implementation |
| --- | --- |
| Founder identity | `FounderState` in `submission/state/schema.py` |
| Runtime character contract | `CharacterRuntimeState` in `submission/state/schema.py` |
| Company state | `CompanyState`, `WorldGraph`, `Chapter`, `WorkerInvocation` in `submission/state/schema.py` |
| Org/workforce creation | `/api/company/analyze` in `submission/tools/server.py` |
| World/quest DAG creation | `/api/world/design` and `revealVentureGraph()` |
| Agent cards | `setParty()`, `cardEvidence`, `recordCardEvidence()` in `submission/ui/game/story.js` |
| Scenario/world canvas | `renderScenarioCanvas()` in `submission/ui/game/story.js` |
| Agent standup | `/api/world/standup`, `_character_state_for_turn()`, `renderAgentStandup()` |
| Dilemmas/consequences | `runDilemmaGate()` and `apply_decision_consequence()` |
| Tool/reasoning evidence | `tool_trace`, `maf_tools_called`, `maf_memory`, `reasoning_tokens` |
| Visual shell | `submission/ui/story.html` and `submission/ui/game/story.js` |

The next step is not inventing mechanics. It is presenting the existing
mechanics as one coherent card/DAG interface.

## 3. Core Loop

The run loop should be:

```text
Founder identity
  -> LinkedIn/public profile signal or mission pitch
  -> Org Designer creates the workforce deck
  -> World Designer creates the mission DAG
  -> agents claim rooms
  -> agent executes with memory + tools
  -> artifact/result card lands
  -> human verification gate
  -> dilemma/decision card
  -> consequence mutates metrics, memory, org, and next brief
  -> agent standup reacts
  -> next room
```

Failure, rejection, and rework can later become roguelike pressure, but the live
demo should prioritize one successful run with visible reasoning and human
approval.

## 4. Founder Creation

The pasted GDD framed this as LinkedIn import. The product direction is now
LinkedIn/profile-first, but the local implementation must stay robust:

- optional LinkedIn or public profile URL through `#in-url`;
- founder name derived from the public URL handle when possible;
- founder archetype inferred by the Profile Analyst;
- manual Builder/Seller/Designer/Operator selection as a later override, not
  the primary entry;
- future voice/avatar selection through `/api/voices` and
  `/api/founder/generate-avatar`.

Do not make private LinkedIn API integration a dependency for the demo. Treat a
LinkedIn URL as a public profile signal. If public scraping is limited, degrade
to the URL handle plus default mission and heuristic archetype inference. The
existing URL analysis path can already fetch public pages without credentials;
the next step is to name this as profile analysis rather than generic company
analysis everywhere.

Founder archetypes map to the player's starting class:

| Archetype | Human seat | Digital workers should cover |
| --- | --- | --- |
| Builder | Product judgment, prototypes, systems | market, growth, operations |
| Seller | Customers, partnerships, revenue | product, proof, operations |
| Designer | Taste, narrative, experience | build, sales, operations |
| Operator | Process, constraints, execution loops | product, story, growth |

This is already partly wired in `beginStory()`: the URL is sent to
`/api/company/analyze`, the profile response can infer `founder_archetype` and
`founder_skill`, and those values ride into `/api/world/design` as founder
context.

## 5. Deck Model

The player's deck is the digital workforce assembled around the founder's
strengths, blind spots, and mission.

### Card Types

Agent cards:

- Org Designer;
- World Designer;
- Strategist;
- Designer;
- Marketer;
- Ops;
- dynamically generated workers from the org blueprint.

Result cards:

- positioning brief;
- org chart;
- quest graph;
- product/landing page artifact;
- marketing artifact;
- financial/OKR chart;
- generated scene image, later.

Decision cards:

- dilemma options;
- custom CEO path;
- approval/rejection gates.

Memory cards:

- founder profile memory;
- procedural memory from CEO decisions;
- chapter summaries;
- durable worker learning.

Hazard cards, later:

- runway pressure;
- customer churn;
- integration failure;
- PR risk;
- compliance constraint;
- competitor pressure.

For the first implementation pass, hazards should be deterministic scenario
nodes or dilemma options. Do not add random deck pollution until the core graph
is legible.

## 6. DAG Model

The DAG is the mission/world state. Cards are nodes or node handles; edges are
the relationships between actors, artifacts, tools, memory, and decisions.

### DAG Layers

Map DAG:

- chapter nodes;
- dependency edges;
- owner agent;
- status: waiting, reasoning, artifact ready, approved, rejected, completed.

Council DAG:

- speaker nodes;
- target nodes;
- intent edges: answers, challenges, asks, hands off;
- turn order;
- selected worker highlights.

Evidence DAG:

- agent -> memory recalled;
- agent -> tool call;
- tool call -> artifact;
- artifact -> validator;
- validator -> score;
- score -> gate.

Consequence DAG:

- CEO decision -> metric deltas;
- CEO decision -> memory written;
- CEO decision -> new worker added;
- CEO decision -> next brief constraint;
- CEO decision -> next standup.

The center world surface should be able to switch among these DAG views without
changing the rest of the UI.

## 7. Inter-Agent Dynamics

Conversation is structured data, not only text. Each standup turn should be
renderable as an agent graph event.

Suggested event shape:

```json
{
  "id": "turn_ch_2_001",
  "type": "agent_turn",
  "speaker_id": "ops",
  "target_id": "designer",
  "intent": "challenge",
  "message": "Dahlia, that polish pass costs runway unless we narrow scope.",
  "tool_calls": ["calculate_consequence"],
  "state_changes": ["burn", "velocity"],
  "handoff_to": "marketer",
  "source": "maf"
}
```

Current local source:

- `/api/world/standup` returns `turns`;
- each turn gets `speaker_profile`;
- each turn gets `character_state`;
- `renderAgentStandup()` already displays the turn cards and speaks them.

Missing local bridge:

- normalize `target_id`;
- normalize `intent`;
- normalize `state_changes`;
- expose these as a `graph_events` array in the standup response;
- render edges in Council View.

Supported edge intents:

- `speaks_to`;
- `challenges`;
- `asks`;
- `answers`;
- `hands_off_to`;
- `depends_on`;
- `uses_tool`;
- `writes_memory`;
- `changes_metric`;
- `unlocks`.

UI animation should follow the data:

1. speaker card lights up;
2. edge draws to target card;
3. intent label appears;
4. tool chip pulses if a tool was called;
5. affected world meters move;
6. handoff card receives the next glow.

## 8. UI Layout

The target layout:

```text
+--------------------------------------------------------------+
| World surface: map DAG, council DAG, result card, scenario    |
|                                                              |
|                                      Right inspect panel      |
|                                                              |
+--------------------------------------------------------------+
| Agent card hand / workforce deck / bottom carousel            |
+--------------------------------------------------------------+
| Minimal controls, progress, audio, reset                      |
+--------------------------------------------------------------+
```

The existing UI is close:

- `#diagram` is already the center render target;
- `renderScenarioCanvas()` already makes the center a scenario surface;
- `#party` already renders agent cards;
- `#char-dialog` already contains a flip/dossier model;
- `#rail` already holds expert evidence.

Desired shift:

- bottom cards become the primary interaction surface;
- `#diagram` becomes a real world/DAG renderer, not just a Mermaid container;
- the card dossier moves from modal-first to inspect-panel-first where possible;
- the right rail stays as the expert/debug layer until cards carry the evidence.

## 9. What To Make Up vs What Must Be Real

Make up:

- room names;
- titles;
- scene flavor;
- card rarity language;
- character epithets;
- visual motifs;
- scenario framing;
- generated key art.

Do not make up:

- model/provider evidence;
- tool calls;
- memory entries;
- validation scores;
- metric deltas;
- generated worker ownership;
- handoff relationships;
- replay log events.

The whole credibility story depends on this separation.

## 10. Victory, Failure, And Meta-Progression

For the demo, victory is simple:

- all chapters completed;
- all artifacts passed human verification;
- final company graph/deck summary is shown.

Future failure states:

- capital/runway reaches zero;
- trust collapses;
- proof never reaches threshold;
- too many rejected artifacts;
- unresolved hazard nodes block the route.

Future meta-progression:

- repeated founder preferences become durable memory;
- rejected approaches become "avoid this next time" memory;
- newly unlocked workers become relic/passive cards;
- the founder's next run starts with a better workforce deck.

The local memory layer already points in this direction through
`submission/agents/memory.py` and `refreshLearned()` in the UI.

## 11. Build Plan

### Phase 1: Documented model

Done by this document:

- card hand;
- world surface;
- DAG layers;
- inter-agent graph events;
- local code mapping.

### Phase 2: Map View

Use existing data first:

- `state.chapters`;
- `depends_on`;
- `assigned_worker_title`;
- `owner_role`;
- chapter status.

Implementation:

- make `revealVentureGraph()` produce clickable DAG nodes;
- selecting a chapter opens an inspect panel;
- active/completed/rejected status is visually distinct;
- owner agent card is highlighted when its chapter node is selected.

### Phase 3: Card hand

Build on `setParty()` and `cardEvidence`:

- cards arrange as a hand/carousel;
- selected card lifts;
- Escape resets selected/flipped card;
- card back shows evidence from `recordCardEvidence()`;
- footer meters shrink or become summary-only.

### Phase 4: Council View

Build on `/api/world/standup`:

- add `graph_events` to the response;
- infer `target_id` and `intent` in simulation fallback;
- ask live MAF prompts to name a teammate and intent;
- draw speaker-to-target edges during `renderAgentStandup()`.

### Phase 5: Result cards

Wrap existing outputs:

- Mermaid diagrams;
- SVG financial plans;
- text artifacts;
- generated images later.

Each result card should carry:

- producing agent;
- chapter;
- score;
- tool trace link;
- memory link;
- gate status.

### Phase 6: Decision cards

Restyle dilemma options as cards:

- preview consequence deltas;
- show affected agents;
- show new worker unlocks;
- on commit, animate decision -> metrics -> memory -> next brief.

### Phase 7: Final run summary

End screen should show:

- cleared chapter DAG;
- final workforce deck;
- result cards produced;
- decisions made;
- memory learned;
- Microsoft/Foundry evidence summary.

## 12. Acceptance Criteria

A judge should understand the system without reading the code:

- the bottom cards are the workforce;
- the center graph is the campaign graph;
- the active speaker is visible;
- the target of a challenge/question is visible;
- every artifact is tied to an agent;
- every decision visibly changes metrics or memory;
- flipping/inspecting a card reveals real evidence;
- the right rail remains available for technical proof.

## 13. Risks

Overbuilding the card game:

- Avoid fake combat, hit points, and random card draw for the demo.
- The game is about verified business execution, not card combat.

Too much UI at once:

- Keep one selected node/card at a time.
- Keep the rail collapsible.
- Keep Mermaid/SVG fallbacks until the custom renderer is stable.

Unclear source of truth:

- `CompanyState` and server responses remain authoritative for now. A future
  rename can introduce a broader mission/run state, but do not fork state models
  until the current UI migration is stable.
- UI card state is presentation, not a second model.
- Graph events should be derived from standup, decision, chapter, and invocation
  state, not manually invented on the client.
