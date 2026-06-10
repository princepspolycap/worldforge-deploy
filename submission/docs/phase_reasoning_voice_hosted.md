# Phase: Reasoning Visibility, Voice Upgrade, Hosted Agent

What changed in this phase and why. This document is committed; anything with
real deployment names, quota numbers, or demo-day logistics lives in the
gitignored `submission/private/` folder instead.

## 1. Thinking tokens, end to end

The rubric rewards visible multi-step reasoning. We now capture the model's
"thinking" signal on **every** reasoning path, not just the world/chapter path:

- `agents/model_config.py` - `reasoning_from_response()` extracts the
  reasoning-token count (gpt-5.x / grok report it in
  `usage.completion_tokens_details.reasoning_tokens`) and, for models that
  expose chain-of-thought text (e.g. Kimi via `message.reasoning_content`), a
  short preview.
- `agents/foundry_agents.py` - every character agent (Narrator, Strategist,
  Designer, Marketer) records its last call's reasoning signal in
  `agent.last_reasoning`. `generate_lore()` returns it too.
- `tools/server.py` - the SSE stream's `invoke_done` phase now carries
  `reasoning_tokens` + `reasoning_preview`, and both execute paths persist them
  into the replay log (`STEP_COMPLETED_REASONING` payload).
- `ui/game.js` - the streamed trace prints a `thinking>` line with the
  scrubbed chain-of-thought excerpt when the deployment exposes one. The story
  view already rendered this for chapters (`setReasoning`).

## 2. Leak prevention (open-source hygiene)

This is a public repo and reasoning previews can land in committed replay
logs, so model output is scrubbed as defense in depth:

- `scrub_secrets()` in `agents/model_config.py` redacts anything
  credential-shaped (OpenAI-style keys, AWS key ids, GitHub PATs, JWTs,
  credentials embedded in URLs, `api_key=...` patterns) before a reasoning
  preview is surfaced or persisted.
- `submission/private/` is gitignored for maintainer-only notes; `.env`,
  state json, and smoke-test results were already ignored.
- The hosted-agent folder ships no secrets - configuration is injected at
  deploy time via environment variables.

## 3. Voice model upgrade chain

Narration moves off the single older `gpt-4o-mini-tts` deployment onto an
upgrade chain (`TTS_DEPLOYMENTS`, newest first):

- `gpt-audio-1.5` family / `MAI-Voice-1` - newer Microsoft audio models that
  speak through the chat-completions audio API (auto-detected by name).
- `gpt-4o-mini-tts` - older `/audio/speech` API, kept as fallback.
- Browser `speechSynthesis` - final net; a fresh `git clone` still narrates
  with zero Azure configuration.

The multi-voice cast is unchanged: each agent persona speaks with its own
voice (`VOICE_BY_ROLE` in `ui/game/story.js`), so the party sounds like
different characters, not one narrator.

## 4. Foundry hosted agent (agent-to-agent surface)

`submission/hosted_agent/` packages the Master Narrator as a deployable
**Foundry hosted agent** speaking the `invocations` protocol - the
agent-callable surface other agents and apps can invoke (A2A-style interop):

- `main.py` - `InvocationAgentServerHost` + `@app.invoke_handler`; accepts
  `{"pitch": ...}` (or portal-style `{"message": ...}`), returns lore, the
  decomposed quest line, and the reasoning-token count.
- `agent.yaml` - hosted-agent runtime config (protocol, resources, env vars).
- `Dockerfile` + `requirements.txt` - container build reusing the same
  `agents/` reasoning core as the local game server, so hosted and local
  behavior cannot drift.
- Offline-safe: with no credentials it serves the simulation quest line, so
  the protocol is testable after a fresh clone.

## What this buys on the rubric

| Criterion | Contribution |
| --- | --- |
| Reasoning & Multi-step | Thinking tokens + chain-of-thought previews visible live in the trace and persisted in the replay log |
| Reliability & Safety | Secret scrubbing on model output; TTS chain degrades through three levels; hosted agent simulation fallback |
| Accuracy & Relevance | Hosted agent maps our Narrator onto Foundry's official agent-hosting primitive |
| UX & Presentation | Newer neural voices, per-character voice cast preserved |

## Still open (next phase)

- Visual treatment of the reasoning panel (this phase wired the data; visuals
  are next).
- Real Foundry IQ index behind `agents/retrieval.py` (still local-keyword).
- Deploying the hosted agent to a real project and demoing a cross-agent call.
