# Agents League Alignment - What We Are Doing, and Doing Well

> The bridge document. It connects our build to the official Battle #2 concepts,
> names the Azure / Foundry ecosystem we run on, scripts how we explain all
> of it in the 10 minutes we get, and calls out what else we highlight beyond the
> rubric. Read this with the maintainer's demo-readiness checklist (kept in the
> gitignored `submission/private/`) (the
> operational checklist) and [rubric_mapping.md](rubric_mapping.md) (the score).

Source of truth for the challenge:
[live_battle_challenge.md](../../starter-kits/2-reasoning-agents/live_battle_challenge.md).
Event: Battle #2 - Reasoning Agents with Microsoft Foundry
([Reactor event](https://developer.microsoft.com/en-us/reactor/events/26733)),
June 10, 2026.
Microsoft platform reference links are collected in
[microsoft_platform_references.md](microsoft_platform_references.md).

---

## 1. What the battle actually asks for

Battle #2 is "multi-step reasoning and orchestration - agents that plan, reason,
and act across complex tasks using Microsoft Foundry." The starter kit frames it
as a **role-play game**: a **Game Master agent** (orchestrator + narrator + world
builder) coordinates a cast of **character agents**, uses **tools**, maintains
**shared state**, and pauses for **human-in-the-loop** decisions. The kit makes
two things non-negotiable:

1. **Reasoning agents run on Microsoft Foundry models.**
2. **Foundry IQ is the required integration** - the world's source of truth, so
   the model retrieves grounded knowledge instead of inventing it.

Everything below maps our build onto that spec, element for element.

---

## 2. The canonical spec, mapped to our build

We did not abandon the role-play RPG; we **reskinned it from fantasy to
world-improvement**. The player is the founder; the campaign graph is their mission
roadmap. The mapping is one-to-one - this is the slide that earns "Accuracy and Relevance."

| Canonical concept (RPG) | Our build (world-improvement campaign) | Where it lives |
|---|---|---|
| **Game Master** (orchestrator + narrator + world builder) | **Org Designer + World Designer** - reads the pitch, designs the workforce, decomposes the venture into chapters | [agents/org_designer.py](../agents/org_designer.py), [agents/world_designer.py](../agents/world_designer.py) |
| **Character agents** (Warrior, Mage, Rogue, Healer, Rival) | **Digital workers** the Org Designer invents for *this* company, each with a role and a `why` | [agents/worker_factory.py](../agents/worker_factory.py) |
| **Tools: code interpreter** (rolls, checks, math) | **Deterministic validators** that score each artifact | [tools/code_interpreter_wrappers.py](../tools/code_interpreter_wrappers.py) |
| **Tools: Foundry IQ** (world lore, required) | **Per-chapter knowledge recall** from curated playbooks | [agents/retrieval.py](../agents/retrieval.py), [knowledge/](../knowledge/) |
| **Shared state** (campaign, party, world flags) | **CompanyState / QuestState** + replay log | [state/schema.py](../state/schema.py), [replay/](../replay/) |
| **Human-in-the-loop** (confirm major actions) | **Verification gate** on every artifact before XP | gate handler in [ui/game/story.js](../ui/game/story.js) |
| **Dice rolls / checks** | **Validator scores** shown on the gate | same validators |
| **Quest log / progression** | **Chapters, XP, levels, "launched"** | [ui/game/story.js](../ui/game/story.js) |

The seam is closed: the workers the Org Designer invents (design-time reasoning)
are the same workers that build the venture (run-time reasoning). That is the
multi-hop chain the battle rewards. Full system view:
[architecture.md](architecture.md).

---

## 3. The three Foundry primitives (we must show all three live)

The rubric requires evidence of Foundry's reasoning scaffold. We point at each
one on stage:

1. **Multi-agent orchestration** - Org Designer -> World Designer -> per-chapter
   workers. Visible in the "Active Worker" rail as it changes per beat.
2. **Foundry IQ retrieval** - the "Foundry IQ Memory" rail fills with a recalled
   playbook per chapter (e.g. `discovery_playbook.md`). This is the *required*
   integration, so we name it explicitly.
3. **Code interpreter** - the verification gate score is a deterministic check,
   not a vibe. Call it out when the number lands.

---

## 4. The Azure / Foundry ecosystem we run on

This is the "what are we actually working with" answer. Everything in the
reasoning core is a **Microsoft Foundry deployment**; non-Foundry vendors appear
only as optional tools, never in the reasoning path (the hard rule).

### Model bindings

The public repo documents model roles, not private deployment names. Forkers bind
their own Microsoft Foundry deployments through `submission/.env`.

| Purpose | Env binding | Where |
|---|---|---|
| Narrator/world reasoning | `NARRATOR_MODEL` | Microsoft Foundry deployment |
| Strategy/deep reasoning | `STRATEGIST_MODEL` | Microsoft Foundry deployment |
| Design/creative artifact work | `DESIGNER_MODEL` | Microsoft Foundry deployment |
| Marketing/ops execution | `MARKETER_MODEL`, `OPS_MODEL` | Microsoft Foundry deployment |
| Fast NPC/dialogue reactions | `NPC_FAST_MODEL` | Microsoft Foundry deployment |
| Voice and image generation | `TTS_*`, `IMAGE_*` | Optional Microsoft Foundry/Azure deployments |

Reasoning must stay Foundry-native. Non-Foundry providers, if ever used, belong
outside the core reasoning path as optional tools.

For day-to-day development, use the explicit cheap-iteration policy in
[model_cost_policy.md](model_cost_policy.md): simulation for UI churn, one
cheap Foundry deployment for live integration checks, and larger models only for
final visible reasoning passes.

### Azure services and patterns in play

- **Azure AI Foundry project + model deployments** - the reasoning core.
- **Azure AD auth via `DefaultAzureCredential`** (token scope
  `cognitiveservices.azure.com`), with an API-key fallback for quick local dev.
  No secrets in source; `.env` is gitignored. See
  [agents/model_config.py](../agents/model_config.py).
- **Foundry IQ / Azure AI Search** - the production retrieval surface. Today we
  ship a local keyword stub over [knowledge/](../knowledge/); the swap-in point
  for the real index is documented in [agents/retrieval.py](../agents/retrieval.py).
- **Code interpreter** - our deterministic validators are the forkable
  equivalent; Foundry's hosted code interpreter is the managed version.
- **Foundry Memory** - our `StateStore` + replay log is the forkable equivalent;
  Foundry Agent Service Memory is the managed version.
- **Voice Live** - browser TTS/STT is the forkable equivalent we demo; the
  `gpt-realtime` / `gpt-audio` deployments are the production upgrade we name.
- **Image models (pluggable)** - optional artifact visuals and portraits are
  generated through env-configured image deployments. Forkers can leave image
  generation blank and still get the committed generated assets.

### The honesty line (say this)

"Everything that reasons runs on Foundry. The game shell and the voice are
forkable browser tech so anyone can clone it after `git clone` - and the
production path is Foundry IQ for retrieval, Foundry Memory for state, and
Foundry Voice Live for speech."

---

## 5. How we explain it in 10 minutes

The detailed minute-by-minute operational run is in
the maintainer's demo-readiness checklist (gitignored `submission/private/`), section 5. This is the **framing
layer** - what to *say* so each beat lands as an Agents League concept, not just
a cool animation.

| Time | Beat | The league concept we name out loud |
|---|---|---|
| 0:00-1:00 | Intro lore auto-plays | "This is a role-play reasoning game on Foundry - the spec asked for a Game Master and a cast; we reskinned fantasy to world improvement." |
| 1:00-1:45 | Pick a front (mission or Poly) | **Human-in-the-loop** starts here: the founder sets intent; the agents execute. |
| 1:45-3:30 | Org Designer maps the company | **Orchestration + reasoning**: the Game Master decomposes a pitch into a workforce. Read one `why`. |
| 3:30-4:30 | World Designer decomposes the venture | **Multi-step reasoning**: design-time output becomes run-time chapters. Point at the dependency graph. |
| 4:30-7:30 | Run 2-3 chapters | Name all three primitives as they fire: worker (**orchestration**) -> IQ recall (**Foundry IQ**) -> score (**code interpreter**) -> **verification gate** (human-in-the-loop). Approve; XP. |
| 7:30-8:30 | Finale: "your campaign is launched" | **Reliability and safety**: nothing shipped without a human gate; simulation fallback means it cannot hard-fail. |
| 8:30-10:00 | Meta close: Poly maps Poly | **Accuracy + creativity**: a playable argument that one operator + a digital workforce is a company. MIT-licensed, forkable. |

Two run framings (pick one per audience): the **Vision run** (Terraform the
Sahara - the showstopper) or the **Meta run** (Agency of Poly mapping itself -
the "is this real?" proof). See [vision_and_evolution.md](vision_and_evolution.md).

---

## 6. What else we are highlighting (beyond the rubric)

These are the differentiators that make the build memorable after the scorecard:

- **Fantasy -> world-improvement reskin.** A **narrated management simulator** - visual-novel
  lore and choices, tycoon-style company building, RPG progression - instead of a
  chat box or a literal fantasy RPG. The player verb is *decide*: pitch, choose a
  front, approve or reject what your workforce builds. The reasoning artifacts
  (org charts, decompositions, scores) ARE the graphics - the genre that makes
  reasoning visible instead of hiding it.
- **The fair-data thesis.** The digital-worker platform is also a fair-data
  engine - real people paid evenly for real work, a human at the root even of a
  superintelligence. The ethical spine under the mechanic.
- **Based on a true story - our story.** The platform the game describes is the
  platform that built it. We point the game at ourselves (Agency of Poly maps
  itself). That is the strongest answer to "is this real?"
- **Teaching tool disguised as a game.** Built for the engineers and blog readers
  in the room - a funnel of play -> wonder -> join -> learn, with templates as the
  on-ramp. See [vision_and_evolution.md](vision_and_evolution.md) section 4 and 6.
- **Forkability.** MIT-licensed, runs after `git clone` with zero Azure
  (simulation mode), and degrades gracefully so a network blip cannot kill a
  live demo. Reliability *is* a feature.

---

## 7. The single clear statement of what we are doing

We took the Battle #2 role-play reasoning spec - Game Master, character agents,
tools, shared state, human-in-the-loop, Foundry IQ - and reskinned it into a
world-improvement campaign where you play the founder. A Microsoft Foundry workforce
designs your org, decomposes your venture, grounds each step with Foundry IQ,
checks it with a code interpreter, and ships nothing until you approve it at a
verification gate. It is forkable, MIT-licensed, based on our own real platform,
and it teaches the people most likely to build the future how humans and AI run a
company together.

---

## 8. Gaps to close before / right after the battle

- **Foundry IQ index is still a local stub.** The retrieval is real in shape but
  keyword-based over local files; the production win is indexing
  [knowledge/](../knowledge/) into Azure AI Search with `text-embedding-3-large`.
- **Templates + LLM front-routing not yet wired.** The on-ramp that lets a
  stranger click "3D-printed solar cells" and get routed to the right front is
  designed but not built ([vision_and_evolution.md](vision_and_evolution.md) s4).
- **Simulation copy is startup-generic** against grand missions. Live Foundry
  tailors it; prefer live mode for a grand-vision run.
