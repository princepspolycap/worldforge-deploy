# Onboarding "alive": animation + live preflight console plan

Handoff spec for the next agent. Goal: make the character-creation screen feel
like a game, not a form. Show the system finding the account, extracting signal,
and minting the founder character - in motion, in real time - instead of a silent
"Building your character..." button. Add a real animation library, glitch/scramble
"alive" text, a breathing-pulse system, and make the burn glow noticeable.

Scope owner: the story-mode onboarding (the first screen only). Do not touch the
post-`beginStory()` run. We are in refinement mode: reuse the existing two-press
gate and the existing `ares` shape; upgrade the moment between the two presses.

---

## What the user asked for (verbatim intent)

1. "Show rather than tell" - when they paste a URL or speak their pitch, show the
   process: finding the account, extracting information, building the profile.
   Live feedback as they type / transcribe.
2. The text is not alive. Add glitch effects / scramble. Use a real animation
   library (they named anime.js as a good one; GSAP-style motion).
3. A breathing-pulse effect - components pulse at the rate of human breathing.
4. The burn glow is not noticeable ("the burn glows, I didn't notice him").
5. Make the card a little bit larger. "This one is becoming perfect."

Keep it forkable: MIT-only, CDN ESM, no build step (same as `mermaid` and Motion
One today). Respect `prefers-reduced-motion` everywhere. ASCII-only source.

---

## Library decision

Use **anime.js v4** (MIT, free). It imports as named ESM functions from a CDN,
exactly matching how the repo already loads `mermaid` and Motion One - zero build
step on a fresh `git clone`.

- Import: `https://cdn.jsdelivr.net/npm/animejs@4/+esm`
- v4 API is named imports (`animate`, `stagger`, `createTimeline`, `text`/SplitText,
  utility scramble). The old global `anime` object is gone - do not use v3 syntax.
- Why not GSAP: GSAP is now also 100% free including ScrambleText/SplitText
  (Webflow, May 2025), so it is license-viable, but its plugin registration is
  awkward without a bundler. anime.js v4's named-ESM-import model is the cleaner
  fit for this no-build repo. (If a future agent prefers GSAP, it is now allowed
  by the MIT/forkable rule - just keep the CDN-ESM, no-build constraint.)

Motion One stays for the height slide in `submission/ui/game/motion.js`. anime.js
covers text scramble, timelines, and staggers. Do not remove Motion One.

---

## Files and exact hook points (already verified)

| Concern | File | Anchor |
| --- | --- | --- |
| First "Begin" press, runs the analyze call | `submission/ui/game/story.js` | `gatherAndReady()` |
| Final "ready to begin" confirmation card | `submission/ui/game/story.js` | `renderReadyCard(ares)` |
| Restore form on "Edit details" | `submission/ui/game/story.js` | `restoreCreatorForm()` |
| Run start, consumes `state.preflight` | `submission/ui/game/story.js` | `beginStory()` |
| One payload shape for the analyze call | `submission/ui/game/story.js` | `analyzePayload()` |
| URL -> display name parsing (reuse, do not duplicate) | `submission/ui/game/story.js` | `founderNameFromProfileUrl()` |
| Mic transcription, has an `onResultCallback` seam | `submission/ui/game/story.js` | `bindSpeechRecognition()`, `setupVoiceInput()` |
| HTML for the card + all CSS | `submission/ui/story.html` | `.creator-card`, `.cc-step`, `.kicker`, `.first-step`, `#in-url`, `#mic-status` |
| Existing motion-lib wrapper pattern to copy | `submission/ui/game/motion.js` | `expand`/`collapse`, CDN import + offline fallback |
| Audio cues (aliased `A`) | `submission/ui/game/audio.js` (`window.DungeonAudio`) | `unlock`, `isUnlocked`, `uiPress`, `uiHover`, `chime`, `ambientStart`, `ambientStop`; note `thinkingStart`/`thinkingStop` are intentionally silent |
| Script load order + cache-bust query strings | `submission/ui/story.html` (bottom) | `audio.js?v=11`, `story.js?v=156` (module), `intro.js?v=30` |

The analyze response (`ares`) shape the console must reveal (no fake data - show
the real fields): `ares.profile.host`, `ares.profile.signals[]`,
`ares.profile.founder_archetype`, `ares.profile.company_summary`,
`ares.org.digital_worker_count`, `ares.org.leverage_ratio`. Source of truth is
`submission/agents/company_analyst.py`.

---

## Deliverables

### 1. `submission/ui/game/anim.js` - the animation capability (new, small)

A thin wrapper around anime.js v4, mirroring `motion.js`: import from CDN inside a
`try/catch`, fall back to instant set when offline or when
`prefers-reduced-motion` is set. Single source of truth for "make text alive."

Export a minimal, opinionated surface (keep it small - resist adding helpers no
one calls yet):

- `scramble(el, finalText, { duration, chars, onComplete })` - cycles each glyph
  through random chars (default set `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/`)
  then resolves to `finalText`. Reduced-motion / offline: set `textContent`
  instantly.
- `revealLines(nodelist, { stagger })` - staggered rise+fade entrance (anime.js
  `stagger`). Used for the console step lines and the signal chips.
- `timeline()` - returns an anime.js timeline (or a no-op shim offline) so the
  console can choreograph stages.
- `prefersReduced()` - shared guard.

Do not leak anime.js objects to callers; expose only these functions. If a future
component needs more, add the one function it needs - not a kitchen sink.

### 2. `submission/ui/game/preflight.js` - the live console (new, the core feature)

Exports `runPreflightConsole({ url, pitch, mount })` returning a controller:

- `controller.complete(ares)` - fast-forward to the final state, pop the real
  numbers/chips from `ares`, resolve, then resolve the returned promise.
- `controller.fail(message)` - show a `FAULT` line, reject so the caller restores
  the form.

Behavior: the console renders into the creator card (replacing the `.cc-step`
contents, same place the button was) and plays an anime.js timeline of stages,
each line scrambling in then locking with a status tick. Stages map to the REAL
pipeline so the motion is honest:

1. `LOCATING`  - parse + echo the host/handle from the URL (client-side only;
   reuse `founderNameFromProfileUrl` and a tiny source classifier mirroring
   `_source_kind` in `company_analyst.py`). Pitch-only path: "Reading your
   mission" instead.
2. `FETCHING`  - "Reading the public page" (the guarded scraper).
3. `OSINT`     - "Cross-referencing the open web"; signal chips stagger in as
   they are "found".
4. `REASONING` - "Profile Analyst forming your operating posture
   (STRATEGIST_MODEL, Foundry)" - holds on a breathing shimmer.
5. `MINTING`   - "Casting your founder archetype" -> glitch-locks to the real
   `founder_archetype` (Builder / Seller / Designer / Operator).
6. `ASSEMBLING`- "Org Designer sizing your digital workforce" -> resolves to
   "N digital workers / Mx leverage" from `ares.org`.

Pacing: the console starts immediately on press; the real `/api/company/analyze`
call (kicked off by the caller) runs concurrently. The scripted stages advance on
a timer, but stage 4 (`REASONING`) holds on its breathing shimmer until the real
data lands. When `complete(ares)` is called, stages 5-6 fill with the real
values. If the data lands early, stages still play quickly (do not feel fake; ~2.5
to 4.5s total feels right). On `fail`, show `FAULT` and let the caller restore.

No new network calls from this module. It is pure presentation over data the
caller already fetched. Reuse `A.uiPress`/`A.chime`/`A.uiHover`; optionally add a
soft per-stage tick (see "Audio" below).

### 3. Wire the console into `gatherAndReady()` (edit `story.js`)

Today `gatherAndReady()` disables the button, sets it to "Building your
character...", sets a hint, awaits `api("/api/company/analyze", analyzePayload())`,
then calls `renderReadyCard(ares)`. Change the middle:

- Replace the button-loading + hint text with `runPreflightConsole(...)` mounted
  in the card.
- Start the fetch and the console concurrently:
  `const p = api("/api/company/analyze", analyzePayload());`
  `const console = runPreflightConsole({ url: state.url, pitch: state.pitch, mount });`
  then `const ares = await p; await console.complete(ares);`
- On fetch error: `await console.fail("Could not gather the profile")` then restore
  the form exactly as the current catch block does (re-enable button, hint).
- Keep `state.preflight = { ares, profile: ares.profile || null }` and the call to
  `renderReadyCard(ares)` unchanged - the console hands off to the existing ready
  card. Do not duplicate `analyzePayload()`; the console consumes the same `ares`.

Net change: the silent loading moment becomes the show. We REMOVE the plain hint
loading text, we do not add a parallel path.

### 4. Glitch / scramble "alive" text (edit `story.html` CSS + `story.js`)

- On entrance (the `.first-step.enter` handoff already exists), scramble-decode the
  kicker ("CHARACTER CREATION") and the h1, then let them settle. Add `data-text`
  mirrors on those nodes for the CSS fallback.
- Idle micro-glitch: occasional 1-2 char flicker on the kicker so it feels alive
  but not noisy (anime.js, low frequency, pause on reduced-motion).
- CSS-only fallback glitch (`@keyframes glitchShift` using dual `text-shadow` RGB
  split + `clip-path` inset jitter) so even with anime.js blocked offline there is
  a glitch. JS scramble is the upgrade, CSS is the floor.
- Heavier glitch beat when the console finishes / on CTA hover.

### 5. Typing + transcribing feedback (edit `story.js` + small CSS)

- URL field `#in-url`: on debounced `input`, classify client-side and echo a live
  detected-source label under the field ("LinkedIn profile detected", "Personal
  site detected", host + handle), with a small scramble on change and a faint
  "ready" pip when the URL looks valid. No network on type. Reuse
  `founderNameFromProfileUrl`; add one small `classifyProfileUrl(url)` helper as
  the single source of truth for client-side source detection.
- Mic path: in `bindSpeechRecognition`'s `onResultCallback` / status updates, show
  a live equalizer (a few CSS bars animated by anime.js) + a pulsing record dot
  while listening, and "transcribing..." in `#mic-status`; resolve to "Heard you."
  with a glitch-lock on final. Builds on the existing `#mic-status` element and the
  existing interim-transcript-into-textarea behavior - do not rewrite recognition.

### 6. Breathing-pulse system (edit `story.html` CSS)

- One source of truth in `:root`: `--breathe-dur: 4.5s; --breathe-ease:
  cubic-bezier(.4,0,.2,1);` (about 13 breaths/min, calm).
- `@keyframes breathe` - subtle `transform: scale(1 -> 1.012)` + glow opacity.
- A `.breathing` opt-in class plus a `--breathe-glow` color var so any component
  can adopt it: the CTA, the active party-agent card, the console `REASONING`
  line, and the burn bar.
- Hard-stop under `prefers-reduced-motion: reduce` (there are already such blocks
  in `story.html` - extend them).

### 7. Make the burn glow noticeable (edit `story.html` CSS)

- Burn metric bar is `.party-metric-track span` / `.cc-metric-track span` with
  `background:#fb7185`. Give it a breathing glow:
  `box-shadow: 0 0 10px rgba(251,113,133,.55)` driven by the `breathe` keyframe,
  plus a subtle hot inner gradient so it reads as "burning."
- Optional: scale glow intensity to the burn value via an inline `--burn` var set
  where the bar width is set. Directly answers "the burn glows, I didn't notice."

### 8. Make the card larger (edit `story.html` CSS)

- `.creator-card` width `min(440px, 100%)` -> `min(520px, 100%)`; bump padding.
- `.first-step .creator-card h1` `34px` -> ~`40px`; nudge `.cc-lead` up a touch.
- Update the existing responsive breakpoints (the `@media` blocks near the top of
  the `.creator-card` styles) so it still fits small screens.

### 9. Audio (optional, small)

- Reuse `A.uiPress` on begin, `A.chime` when the console completes, `A.uiHover` on
  CTA hover.
- `thinkingStart`/`thinkingStop` are intentionally silent today. If a per-stage
  tick is wanted, add a soft `tick()` to `submission/ui/game/audio.js` (very low
  gain, short) and call it once per stage lock. Keep it subtle; gate on
  `A.isUnlocked()`.

---

## Constraints / guardrails for the executor

- MIT + CDN ESM + no build step. anime.js from `.../animejs@4/+esm` inside
  `anim.js`, wrapped in `try/catch` with an instant-set fallback (copy the
  `motion.js` shape). Never hard-fail if the CDN is blocked.
- Respect `prefers-reduced-motion` in every new animation: scramble -> instant
  set, breathing -> static, glitch -> off.
- ASCII-only in committed source and this doc. No emojis, no smart quotes.
- Bump the `?v=` cache-bust query strings on every changed asset in
  `submission/ui/story.html` (`story.js`, add `anim.js`/`preflight.js` imports
  inside `story.js` as ES modules like `./motion.js`, not new script tags).
- Single source of truth: do not duplicate `analyzePayload()`, the `ares` shape,
  or URL parsing. The console is presentation only - it makes zero network calls.
- Write less code: the console REPLACES the silent loading hint in
  `gatherAndReady`; it is not a second path. Keep `renderReadyCard`/`beginStory`
  contracts intact.

---

## Acceptance criteria

1. Pasting a LinkedIn URL and pressing Begin plays a visible, staged console that
   ends on the real archetype + real digital-worker count, then hands off to the
   existing ready card. No silent gap.
2. The pitch-only path (no URL) plays a mission-framed variant and still works.
3. Typing a URL shows a live detected-source label; speaking shows a live
   equalizer + record dot and a "Heard you." lock.
4. Kicker + h1 scramble-decode on entrance and have a subtle idle glitch.
5. The CTA, active agent card, and burn bar breathe at one shared rate; the burn
   bar visibly glows.
6. The card is noticeably larger and still responsive.
7. With anime.js blocked (offline) and with `prefers-reduced-motion`, everything
   degrades to instant, legible, non-animated states - the run still completes.
8. Fetch failure shows `FAULT` and restores the form (current behavior preserved).

## Manual test checklist

- URL path, pitch-only path, mic path.
- Slow network (console holds on `REASONING` until data) and fast network
  (stages still read as intentional, not skipped).
- `/api/company/analyze` failure -> form restored.
- Offline (anime.js CDN blocked) -> instant fallback, no console errors.
- `prefers-reduced-motion: reduce` -> no scramble/breathe/glitch.
- Mobile width -> card fits, console readable.

---

## Suggested execution order

1. `anim.js` wrapper (+ verify offline/reduced-motion fallback).
2. Breathing system + burn glow + larger card (pure CSS, fast wins, low risk).
3. Scramble/glitch on kicker + h1.
4. `preflight.js` console, then wire into `gatherAndReady`.
5. URL typing feedback + mic equalizer.
6. Bump `?v=` strings; run the manual checklist.
