# How It All Connects - the read-before-you-present narrative

One pass, start to finish, of what this build is, why every piece exists,
and how each piece feeds the next. Read it like a monologue; speak any
paragraph on its own and it holds.

Verified green on June 10, 2026: syntax-checked (19 Python, 3 JS files),
three-path smoke test passing (quest, world, evidence), live browser
playthrough witnessed, live server clean on port 8070.

---

## The one-sentence version

You sit in the founder's chair, pitch a campaign, and a Microsoft Foundry
workforce - designed on the spot, run on the Microsoft Agent Framework,
grounded in Foundry IQ, learning you through agent memory, drawing tools
from an MCP toolbox, checked by code interpreter validators, and sealed by
your own human approval at every gate - builds that campaign in front of you,
leaving evidence at every step.

## The chain, link by link

**It starts with a pitch.** The player types an idea - or points at a real
company URL. That brief is the seed of everything. The moment the venture is
chartered, the system writes its first memory: a user_profile entry -
"Founder is building X." The agents now know who they work for. From the
first minute, the system is learning, and the rail panel "Agent Memory -
learned" shows it.

**The Org Designer reasons before anyone works.** Instead of a fixed cast of
agents, an LLM designs the company's org: one human operator - you - plus
the digital workers this specific venture needs, each with a mandate, a
lifecycle stage, and a deployment hint that maps it onto the right class of
Foundry model. This is the first reasoning artifact: the team itself is
model output. The seam matters: the org the model designs is the org that
executes. `bind_world_to_org` stamps every chapter with its owning worker.

**The World Designer decomposes the venture.** Discovery, positioning, MVP,
go-to-market, retention - a dependency-ordered quest line. This is the
canonical Game Master pattern from the challenge spec, reskinned: the
campaign is the graph, the chapters are nodes, and each node is owned by
one of the workers the org just chartered.

**Each chapter is a real agent run, and you can watch it think.** When a
chapter starts, the worker spins up as a Microsoft Agent Framework Agent -
not a wrapped SDK call. Inference goes through FoundryChatClient on the
Foundry project Responses endpoint when configured; the OpenAI-compatible
client is the fallback; simulation mode is the floor. Before the model sees
a token, the framework's ContextProvider - our CampaignMemory - injects three
streams: the CEO's gate decisions (binding direction), Foundry IQ recall
(cited knowledge), and agent memory (what the workforce has learned about
how you operate). The narration says exactly this out loud while it runs.

**Knowledge and memory are deliberately different things.** Foundry IQ is
what the company knows - stable, curated playbooks, permission-aware and
cited, with the committed knowledge/ folder as the forkable fallback. Agent
memory is what the agents learn - your profile, your operating patterns from
gate choices, summaries of shipped work - the three kinds in Microsoft's
Agent Service memory preview (user_profile, procedural, chat_summary),
stored in the Foundry memory store when configured, in a local ledger
otherwise. IQ grounds the work; memory personalizes it. The UI gives each
its own panel so the audience never confuses them.

**Tools are drawn, not hidden.** Every worker pulls from one MCP-shaped
toolbox - tools/list, tools/call - that passes through to a managed Foundry
Toolbox when TOOLBOX_URL is set. The deterministic validators (positioning,
landing page, email, org chart, financial plan) are code-interpreter-style
checks, and on the Agent Framework path they become FunctionTools the model
itself can call mid-run to test its own draft. The rail names every tool
drawn before the artifact appears - the ludonarrative rule: show the work.

**Nothing ships without you.** The artifact lands, the rubric scores it -
four weighted dimensions with the deterministic validators as a floor the
score can never fall below - and then the game stops. The verification gate
is the core mechanic, not a confirmation dialog. Then the dilemma: a
venture-specific tradeoff written by the narrator model from the artifact
just sealed. Your choice writes a procedural memory and a decisions-ledger
entry, and the next worker's brief provably carries it. Choice -> memory ->
recall -> visibly different artifact. That loop is the game.

**Everything leaves evidence.** Every invocation logs four proof points -
iq_hits, memory_injected, tools_called, inference_usage - into the replay
log's STAGE_EXECUTED events, on every path including simulation. Memory
writes log MEMORY_WRITTEN events. The smoke test's evidence path fails the
build if any chapter ships without proof. When a judge asks "did the agents
actually do anything?", the answer is a grep, not a claim.

**And everything degrades, nothing crashes.** Foundry project endpoint
missing? The OpenAI-compatible path carries it. No keys at all? Simulation
mode plays the entire game deterministically - same code paths, mock
outputs, every panel still fills. IQ unreachable? Local playbooks answer.
Memory store unprovisioned? Local ledger learns. Toolbox URL blank? Local
registry serves. TTS down? Browser voice. A judge can git clone this with
zero credentials and play the whole thing - that is the forkability promise,
and it is also the live-demo insurance.

## Why this maps to the rubric

- **Accuracy and relevance:** direct reskin of the canonical Game Master
  challenge - decomposition, specialist agents, retrieval, tools,
  orchestration - every required primitive present and named on screen.
- **Reasoning and multi-step:** visible decomposition tree, live reasoning
  theater, reasoning-token counts (never raw chain-of-thought), tool calls
  the model chose itself, decisions that chain across chapters.
- **Reliability and safety:** human gates on everything, deterministic
  validator floors, four-layer degradation, secret scrubbing, no raw CoT.
- **Creativity:** the world-improvement campaign, a workforce the model designs for
  itself, memory as a game mechanic the player can hear.
- **UX:** one evidence rail that teaches the architecture while the game
  plays; narration that names each Microsoft piece as it is used.

## The closing line

"The campaign graph is your mission. The agents are your workforce. The gates are
your judgment. And every claim on this screen is a line in a log you can
read." 
