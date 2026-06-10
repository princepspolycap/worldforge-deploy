# Narration Pipeline - How the Game Speaks

How "Your Company Is the Dungeon" produces its voice-over, how to change
what it says, and how to regenerate the audio. Read this before touching
anything narration-related.

---

## The chain (best voice first, never breaks)

Every narrated line walks the same fallback chain at runtime:

```
1. Baked take      ui/assets/generated/lore/narration/<scene>.mp3
   curated, directed, ships committed - what the audience should hear
        | (file missing or fails to play)
        v
2. Live server TTS POST /api/tts -> Azure gpt-4o-mini-tts deployment
   neural voice + delivery instructions - needs TTS_* env config
        | (server unconfigured, offline, or errors)
        v
3. Browser voice   window.speechSynthesis
   robotic but free - works offline after a fresh clone
        | (TTS unavailable or muted)
        v
4. Silence         the film paces itself on fixed dwell times
```

Design rule: **a missing file or dead endpoint degrades, never crashes.**
Each step only fires if the one above it is unavailable. A fresh fork with
zero keys still gets step 1 (the mp3s ship in the repo), and a fork that
deletes them still narrates via step 3.

## Who owns what

| File | Role |
|---|---|
| [ui/game/intro.js](../ui/game/intro.js) | **The script.** Each lore card's `vo:` field is the spoken line; `NARRATOR_STYLE` is the shared delivery direction; `NARR_BASE` points at the baked takes. |
| [ui/game/audio.js](../ui/game/audio.js) | **The player.** `DungeonAudio.speak(text, opts)` implements the chain: `opts.baked` (URL) tries the take first, `opts.instructions` rides along to live TTS. |
| [tools/server.py](../tools/server.py) | **The synthesizer.** `/api/tts` forwards text + voice + instructions to the Azure deployment; `/api/tts/status` tells the UI if it can. |
| [tools/generate_narration.py](../tools/generate_narration.py) | **The bakery.** Parses the script out of intro.js and writes one mp3 per scene. |

Single source of truth: **the script lives only in intro.js.** The bake tool
parses it from there - there is no second copy to drift.

## Changing a line (the loop you will actually run)

```bash
# 1. Edit the vo: text (or NARRATOR_STYLE) in submission/ui/game/intro.js

# 2. Re-bake the scene(s) you touched (venv + submission/.env required)
python3 submission/tools/generate_narration.py --force --only sahara

# 3. Listen to it
afplay submission/ui/assets/generated/lore/narration/sahara.mp3   # macOS

# 4. Bump the intro.js cache version in submission/ui/story.html
#    (intro.js?v=N -> N+1), reload, watch the scene

# 5. Commit the .js change AND the .mp3 together
```

Scene names = the card's `img` base name (`sahara`, `premise`, `needs`,
`workforce`, `flywheel`, `foundry`, `gate`, `title`) plus `choice` for the
character-creation screen.

The takes are committed on purpose: the directed cinematic voice is the
baseline every fork hears, demo day does not depend on a live endpoint, and
the robotic browser voice is the last resort instead of the first
impression.

## Configuration (live TTS + baking)

In `submission/.env` (gitignored - never commit):

```
TTS_ENDPOINT=        # Azure OpenAI endpoint with an audio deployment
TTS_DEPLOYMENT=gpt-4o-mini-tts
TTS_API_KEY=
TTS_VOICE=onyx
TTS_API_VERSION=2025-03-01-preview
```

Without these, the bake tool prints what it *would* generate and exits 0
(offline-safe, CI-safe), and the runtime chain skips straight from baked
takes to the browser voice.

Verify the live path: `GET /api/tts/status` -> `{"available": true, ...}`.

## Delivery direction

`NARRATOR_STYLE` in intro.js is passed as `instructions` to
gpt-4o-mini-tts - both at bake time and on the live-TTS fallback, so the
voice is consistent across the chain. Current direction: warm cinematic
film narrator, intimate, unhurried, natural pauses, never monotone or
robotic. If a take sounds flat, sharpen the *instructions* before swapping
the voice.

## Rules

- **Licensing:** baked takes are AI-generated outputs of our own script on
  an Azure deployment, ship under MIT, and are disclosed in
  [generated/CREDITS.md](../ui/assets/generated/CREDITS.md). Keep that file
  updated if you change models.
- **No secrets:** the bake tool reads `submission/.env`; never hardcode
  endpoints or keys, never commit `.env`.
- **Keep takes short:** lines over ~45 seconds fight the intro's pacing cap
  (`DWELL_MAX`). Write for the ear - read it aloud once before baking.
- **Commit script + audio together** so the repo never ships a take that
  contradicts the on-screen text.
- **Sanity-check a fresh bake:** a tiny mp3 (< 4 KB) is an error blob, not
  audio - the tool rejects these, but listen before committing anyway.
