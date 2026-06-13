# UI Revamp + Floating Characters - Working Design Doc

Status: DRAFT / living document. We iterate on this before we touch more CSS.
Owner: maintainer. Last updated: 2026-06-13.

This is the single place we think through the look, the storytelling, the
score, and the "make it feel like a game" character layer. Nothing here is
final - it exists so we stop patching screen-by-screen and start building from
one agreed system.

---

## North star: "infiniteconversation.com, but it is YOUR company"

Reference: https://www.infiniteconversation.com/ - two characters (Herzog,
Zizek) talk forever: each has a fixed portrait, a distinct synthesized voice,
and the dialogue streams continuously, turn by turn, with the speaker's face
lit. It is mesmerizing because it feels ALIVE and never asks you to click.

That is the feeling we are chasing - with three differences that make it OURS:

1. It is a CAST, not a duo. The narrator + the digital workers (strategist,
   designer, marketer, ops, org designer) are characters living in the story
   world, talking to each other AND to you about building the company.
2. The conversation is GROUNDED, not free-associating. Every line is a real
   agent turn - tool calls, IQ recalls, reasoning, handoffs - dressed as
   dialogue. The infinite-conversation magic, backed by real Foundry reasoning.
3. YOU are a character in it. The player creates their own character (the
   founder/CEO) and the cast addresses them directly; at decision gates the
   conversation turns to you and waits. Infinite conversation is passive; ours
   pauses for the human at the moments that matter (the gold seal).

So the design target is: a continuous, voiced, face-to-face conversation among
characters who live in this world - that occasionally turns to YOU and asks for
a call. Cinematic to watch, real reasoning underneath, and you are in the cast.

---

## 0. Why this doc exists

We kept polishing one screen at a time (film gate, then first-step, then the
play UI). Each looks good alone, but the seams between them feel like three
different products. The fix is not more polish - it is ONE design language, ONE
narrative spine, and ONE adaptive score, applied across every screen. Plus the
thing that actually makes it read as a game: characters that are present on
screen, not just portraits in a side rail.

The bar we are holding ourselves to: a judge should not be able to tell where
"the intro" ends and "the app" begins. It should feel like one authored world.

---

## 1. The diagnosis (what is inconsistent today)

Three visual languages are currently stitched together:

1. Film gate - chamfered teal/amber "console" button, mono caps, "> Begin".
2. First-step screen - rounded gold seal button, Fraunces display, glowing kicker.
3. Play UI - utilitarian dashboard: flat mono labels, blue pill buttons, dense
   meters, glass rail panels.

Symptoms:
- Buttons disagree (chamfered console vs rounded seal vs blue pill).
- Color has no fixed meaning - gold, blue, and teal all appear everywhere.
- Type sizing is ad hoc (per-screen clamp() values) so nothing lines up.
- Audio is disconnected one-shot cues, not a score that carries the player.
- Characters live only as 40px portraits in the rail - the world has no cast on
  stage, so it reads as a dashboard, not a game.

---

## 2. The chosen direction: "Cinematic shell, instrument core"

We picked direction C (over "all cinematic" or "all instrument"):

- Framing moments (intro, charter, dilemma gates, completion, narration) are
  CINEMATIC and warm - this carries the emotional arc.
- Working surfaces (rail, meters, reasoning theater, traces) are PRECISE
  INSTRUMENTS - this carries the credibility ("real reasoning is happening").
- The CONTRAST between the two is the design idea, not an accident.

Three principles:

1. Living-world surfaces, instrument-grade controls. Backgrounds breathe (Earth,
   scenes, drifting characters); the controls you act through are calm and exact.
   Cinematic where you WATCH, instrument where you ACT.
2. Color means something. Lock it:
   - GOLD = human consequence (Begin, approve, seal, gate decisions). Rare.
   - BLUE = Foundry / system / reasoning.
   - TEAL = the autonomous digital workforce / living layer.
   Color becomes information, not decoration.
3. One button system, three weights:
   - Seal (gold) - the big human moments. Rounded, breathing glow.
   - Primary (blue) - advance / Next / Commit.
   - Ghost (quiet) - Reset / secondary.
   No chamfered consoles competing with rounded seals.

---

## 2b. The art anchor: Afro-solarpunk (what the visuals are actually telling us)

The character art generated in the parallel chat (the v2 sprites that bumped the
old set to `_v1_prewakanda`) and the film's Earth-from-space opening point at ONE
coherent aesthetic. We name it so the UI can match the art instead of guessing:

  AFRO-SOLARPUNK - a hopeful near-future where technology and nature are woven
  together. Warm gold light, deep teal/jade growth, ornate but not busy, human
  and optimistic. The founder is the one clearly-human figure, cupping a spark
  of gold light - the human at the root of an automated world.

Read directly off the assets:
- The FILM opens on Earth from space - deep space navy, atmosphere-blue rim,
  warm continents. That is our background world.
- The SPRITES are warm-gold + deep-teal on dark, ornate, dignified, hopeful -
  not cold sci-fi. Afrofuturist optimism, not cyberpunk dread.
- The FOUNDER sprite is the emotional key: a human holding gold light. Gold =
  the human spark. This is why gold must mean "human consequence" everywhere.

So the UI is not "a dashboard with a space theme." It is the INTERFACE OF THIS
WORLD - the surfaces the founder and their workers act through. Warm, luminous,
woven, hopeful. The instrument panels are precise but they glow with the same
gold/teal life as the cast.

### Type system (researched, with rationale)

Goal: a DISPLAY voice with warmth + character (Afrofuturist editorial feel), a
BODY voice that is clean and readable, a MONO voice for telemetry. Contrast =
serif elegance meets sans clarity (the 2025 pairing consensus), but tuned warm.

- Display (hero titles, scene headings): KEEP Fraunces. It is already the right
  call - a soft, high-contrast "old style" serif with optical sizing and a lot
  of warmth/character; it reads editorial and hopeful, not corporate. We push it
  harder (heavier optical weights at large sizes) rather than replacing it.
  - Alt to A/B if we want MORE character: "Cormorant" (more dramatic, higher
    contrast) for hero-only moments. Risk: less legible small; keep Fraunces for
    anything under ~28px.
- Body (prose, narration, UI labels): consider moving off Inter to a slightly
  warmer humanist sans for personality, while staying boringly readable:
  - "Hanken Grotesk" or "Mona Sans" - warmer than Inter, still neutral and
    screen-clean. Low-risk upgrade.
  - If we do not want churn, Inter STAYS and is fine - it is the safe default.
- Mono (kickers, codes, telemetry, numerals): KEEP JetBrains Mono. It carries
  the "instrument" half of the design and the numerals are excellent.
- Numerals: use mono tabular figures for all live metrics (XP, scores, burn,
  latency) so they do not jitter as they animate.

Decision: lock DISPLAY=Fraunces + MONO=JetBrains Mono now (already loaded, zero
risk). Treat BODY (Inter -> Hanken/Mona) as a SEPARATE, optional A/B - do not
block the revamp on it.

### Color tokens (anchored to the art, extends :root, does not fork it)

Keep our existing token names; retune values toward the warm Afro-solarpunk
palette and lock MEANING (section 2). Proposed direction (confirm before wiring):

- Space + surfaces (the world behind everything):
  - --bg deep space navy (current #0a0e1a is already right), --bg-2 darker.
  - A subtle warm-gold + atmosphere-blue radial bloom at the top (we have a
    blue bloom; ADD a faint gold one so the world feels lit, not cold).
- Gold = HUMAN consequence (the founder's spark). Current gold ramp
  (#f5c87a / #d9a34a / #f4c95d) is good; reserve it for Begin/approve/seal/gates
  and the player presence. Make it RARE so it stays meaningful.
- Teal/jade = the LIVING / automated workforce layer (--ops #2dd4bf). Lean into
  it as the "growth/solarpunk" accent for the digital workers and org graph.
- Blue = FOUNDRY / system / reasoning (--blue #5b8cff, atmosphere-blue). The
  "thinking" color.
- Role accents stay (strategist=blue, designer=violet, marketer=amber,
  ops=teal, narrator=slate) but all sit inside the gold/teal/blue meaning frame.
- Ink ramp stays; add a warm-tinted ink for on-gold surfaces (already #2a1c06 on
  the seal button).

Net: we are not inventing a new palette - we are RETUNING toward warm + luminous,
LOCKING meaning, and adding a faint gold world-bloom so every screen feels like
it belongs to the film's world.

---

## 2c. The roguelike-deck lens (a framing, not a pivot)

The maintainer floated "deck game design with simple roguelike gameplay." It
fits - because it NAMES what the game already is, rather than adding a new game
on top. We adopt the VOCABULARY and STRUCTURE of a roguelike deckbuilder; we do
NOT bolt on card combat, RNG draws, or fake randomness that would undercut the
"real reasoning, verified artifacts" credibility.

The mapping (all of this already exists in code):

| Roguelike-deck concept | What it already is in our game |
|------------------------|--------------------------------|
| A run                  | One venture: pitch -> quest line -> cleared. The completion screen literally says "your campaign is launched." |
| Rooms                  | Chapters. One worker claims each room. |
| Your deck              | Your DIGITAL WORKFORCE. The org designer "drafts" the starting workers. |
| Drawing/adding a card  | Dilemma gates already ADD workers ("adds Niche Research Scout"). |
| Cards                  | The characters (we already decided characters become clickable CARDS). |
| Card cost/effect text  | Dilemma options already read like cards: "Proof +9, Trust +7, Velocity -4, burn +450/mo, runway -1mo, adds X". |
| Resource economy       | Proof / Trust / Velocity / Burn / Autonomy meters. |
| Your starting class    | The CEO archetype (Builder/Seller/Designer/Operator) the player picks. |
| Boss / gate            | The verification gate + the human gold-decision. |

What adopting the lens BUYS us (cheap, mostly naming + a little UI):
- The character cards (section 5.6) become literal "cards in your deck" - same
  art, just framed as your hand/party. Clicking a card to see its tool calls is
  pure deckbuilder muscle memory.
- The dilemma options become "draft a card" moments with clear cost/effect - we
  already render the numbers; we just present them as cards.
- The run structure (rooms -> boss -> cleared -> tally) gives the demo a clean,
  legible arc judges instantly recognize.

What we must NOT do (it would hurt the rubric, not help):
- No fake combat, no hit points, no luck-of-the-draw randomness. Our "draws" are
  the org design's REASONED choices and the player's decisions - determinism and
  verification are our reliability story. Keep them.
- No deck-thinning busywork. The workforce changes because the BUSINESS reasons
  it should, not to satisfy a card-game loop.

Verdict: YES, use the roguelike-deck lens as the game's grammar (run, rooms,
deck=workforce, cards=characters, draft=decisions, resources=meters, boss=gate).
It is mostly a presentation + naming layer over mechanics we already ship, and
it makes the whole thing read as a game without faking anything. Treat it as the
frame the rest of this doc (cast, cards, score, spine) hangs on.

---

## 3. The token foundation (so it can never drift again)

Everything inherits from the :root block in ui/story.html (already the single
source of truth, read by ui/game/tokens.js). We extend it, we do not fork it.

Add / formalize:

- Type scale (fixed, not per-screen clamp soup):
  - display  (Fraunces)  - hero titles only
  - title    (Fraunces)  - scene/section headings
  - body     (Inter)     - prose, narration
  - label    (Inter)     - UI labels
  - mono     (JetBrains) - kickers, codes, telemetry
- One elevation/glass recipe (the rail glass) used by every floating panel.
- One focus-glow recipe.
- One entrance-motion curve. We already have `fsRise` + cubic-bezier(.2,.7,.2,1)
  on the first-step; promote it to THE entrance for every scene.
- Button classes: `.seal`, `.primary`, `.ghost` - used by BOTH the intro and the
  play UI. The intro's `.intro-begin` and the play UI's `.cta`/`.btn` collapse
  into these.

Acceptance test: the film "Begin" and the first-step "Begin the journey" use the
exact same `.seal` class. No bespoke button CSS per screen.

---

## 4. The storytelling spine (one continuous descent)

Today the narration is strong but the VISUAL story resets at each phase. Make it
one descent with a persistent "scene frame":

  Film (the why)
   -> First step (the threshold)
   -> Charter (your seat is named)
   -> The workforce forms (the cast assembles)
   -> Chapters as rooms (each worker claims a room)
   -> Gates as the human moment (gold)
   -> The campaign, mapped (your campaign is launched)

The connective tissue is a persistent SCENE FRAME present from the film through
every chapter:
- same lower-third title treatment,
- same kicker style,
- same beat-pill,
- same entrance motion.

The world behind it changes; the frame that tells the story stays constant. That
constancy is what makes it feel authored instead of assembled.

---

## 5. Floating characters - the "it's a game" layer

This is the piece the maintainer flagged as important. A management RPG needs a
visible cast, not a dashboard with avatars in a sidebar.

### 5.1 What we already have (no new dependencies)

- Six role BUSTS, 512x512, flat vector style on dark navy, consistent art:
  `assets/generated/{strategist,designer,marketer,ops,narrator,orgdesigner}.png`
  - These stay as the RAIL avatars (the instrument layer).
- NEW: full-body CAST SPRITES, ~768x1344, generated on the same Foundry MAI
  deployment in the same house style, into `assets/generated/characters/`:
  `{narrator,orgdesigner,strategist,designer,marketer,ops,founder}.png`
  - Each is a full figure, heroic standing pose, teal/gold rim light, soft
    ground shadow, on an EVEN dark-navy field so the UI can feather/mask it and
    float it over a scene. Per-role motif matches the bust (e.g. strategist =
    chess-knight + target reticle).
  - Generate/regenerate with: `python submission/tools/generate_art.py
    --characters` (offline-safe; needs the image deployment in submission/.env).
- Larger local character art (1792x1312): `assets/local/characters/*` for
  strategist, designer, marketer, player. Local-only / heavier; reserve for
  one-off hero shots, not for many-on-screen.
- A coherent color per role already in tokens (strategist=blue, designer=violet,
  marketer=amber, ops=teal, narrator=slate).

This is now enough to ship floating characters with zero NEW art generation and
zero new libraries - pure CSS/Canvas over the sprites we just generated.

### 5.1a The cast roster (fixed art; named workers reuse role art)

| Sprite        | Role on stage           | Color      | Motif                    |
| ------------- | ----------------------- | ---------- | ------------------------ |
| founder       | the human seat (you)    | gold       | spark of light in hand   |
| narrator      | Master Narrator / guide | slate      | glowing compass          |
| orgdesigner   | Org Designer            | violet     | org-chart constellation  |
| strategist    | Strategist workers      | blue       | chess knight + target    |
| designer      | Designer workers        | violet     | bezier curve, stylus     |
| marketer      | Marketer workers        | amber      | megaphone + growth arrow |
| ops           | Operations workers      | teal       | gear + shield            |

Per-run named workers (Niche Research Scout, Runway Steward, ...) reuse their
role's sprite + color; the NAME is a label, the ART is the archetype. This keeps
the cast finite while the workforce stays dynamic.

### 5.1b Sprite masking / float treatment (how the navy field disappears)

The MAI model does not emit true alpha, so the sprites ship on an even navy field
that matches the app background. To float them cleanly:
- The scene background is the SAME navy family, so a feathered radial mask
  (CSS `mask-image: radial-gradient(...)`) blends the sprite edges into the
  scene with no hard rectangle. Cheap, no per-image cutout step.
- Optional upgrade (local-only, not required): a one-time background-removal pass
  to true PNG alpha for crisper edges over bright scenes. If we do it, it stays a
  build step; the committed baseline keeps the maskable navy field.


### 5.2 The concept: a "party" that lives on stage

Characters drift in the scene as living presences, react to game state, and
hand off to each other - so the multi-agent orchestration is something you SEE,
not something you read in a log.

Behaviors (in priority order):

1. Idle float - each active character bobs/drifts slowly (sine on translateY +
   tiny rotate), with a soft ground shadow and a role-colored aura. CSS keyframes
   with randomized phase per character so they never sync up.
2. Summon - when a worker becomes active, its character rises/fades into its
   "room" with the shared entrance curve and a role-colored glow pulse + the
   summon audio cue.
3. Speak - the active speaker scales up slightly, its aura brightens, and a
   speech tether connects it to the narration band. Others dim/desaturate.
4. Handoff - a light/particle travels from the finishing character to the next
   one along the dependency edge (we already narrate handoffs - now we show the
   baton).
5. Reasoning tell - while the model reasons, the character has a "thinking"
   micro-loop (subtle aura flicker / orbiting dot) synced to the thinking audio
   layer. This doubles as rubric evidence: reasoning made visible.

### 5.3 How we render it (options, cheapest first)

- Option A - CSS layer (recommended start). Absolutely-positioned `<img>` per
  character in a `#cast` layer above the scene background, below the rail.
  Float/summon/speak via CSS classes + transforms. Pros: trivial, accessible,
  respects prefers-reduced-motion, no perf risk. Cons: handoff particles need a
  little extra work (a moving element or a tiny canvas just for the baton).
- Option B - Single Canvas/`<canvas>` "stage". Draw the same PNGs as sprites,
  drive float + particles in one requestAnimationFrame loop. Pros: rich particle
  handoffs, parallax, one render budget. Cons: more code, must gate on
  reduced-motion + visibility, accessibility needs parallel DOM labels.
- Option C - Library (only if A/B fall short): a tiny tween lib (e.g. animejs)
  or a 2D engine (PixiJS). NOTE: per repo rules, any new dependency in the
  reasoning path is off-limits; a UI-only animation lib is allowed but must be
  MIT and vendored under ui/vendor/. Default answer is "we do not need this."

Decision: start with Option A (CSS), add a tiny dedicated canvas ONLY for the
handoff baton/particles if A feels flat. No engine, no new runtime dep.

### 5.3a Making them MOVE - sprite sheets vs CSS vs video (researched)

Question raised: generate sprites in a grid, crop them, and animate frames so
characters "walk"/gesture? Honest assessment of what these image models can do:

- Sprite sheet from gpt-image-2 (Option C - NOT recommended). The model can be
  prompted for a "character sheet, NxN grid of poses", but it gives the worst of
  three worlds for a finite named cast:
  1. Frame consistency - text-to-image cannot guarantee the SAME face/outfit/
     markings across cells; braids and gold markings drift frame to frame, and
     for a cast where continuity IS the point, that drift is glaring.
  2. No pixel-grid alignment - poses are not placed on a precise grid, so clean
     auto-cropping needs manual nudging per character x per frame.
  3. Resolution tax - one 1024px image split into 4 cells = ~512px frames; we
     would trade the 1.2MB hero sprite for four mediocre ones.

- CSS puppeting of the single sprite (Option A - v1, recommended). Bob + sway +
  breathing-scale + aura-pulse + pointer parallax on the ONE hero sprite. Zero
  new art, and the v2 gpt-image-2 sprites are strong enough that subtle motion
  reads as alive. This is also exactly what a DECK/roguelike needs (see below):
  expressive idle + reaction states, not walk cycles.

- Image-to-video per character (the REAL motion upgrade, progressive). Feed ONE
  hero sprite to Veo/Omni -> a 2-4s looping idle clip: crisp, full-res,
  consistent. This reuses the EXACT stills->clips masking + fallback machinery
  we already built for the lore film (sprite.png poster + sprite.mp4 clip,
  local-only, never required on a fresh fork). This - not sprite sheets - is how
  we get true motion when we want it.

Ranking: A (ship now) -> B/video (upgrade) -> sprite sheet only if we ever pivot
to a deliberately retro pixel-art look (a different art language entirely).

Deck-game / roguelike fit: if we lean into simple deckbuilder-roguelike
gameplay, characters are standing portraits that REACT (glow, lean, lift when
played), not figures that traverse the screen - which is precisely Option A.
A deckbuilder needs expressive idle + reaction states, so the CSS path serves
that direction directly with no extra art. (Gameplay framing itself - cards =
decisions/dilemmas, a run = a venture, relics = unlocked workers - is tracked as
an open direction in section 8, not committed here.)

### 5.6 Character cards - a face AND a presence (clickable)

The maintainer's call: each character is a CARD with a face that floats/has
presence on stage, and is CLICKABLE to open that character's detail dialog -
its tool calls and the metrics we already track for it. So a character does two
jobs at once: it moves the narrative forward (it speaks), and it is a handle
into the real evidence (click it, see the receipts).

What the card shows at rest (on stage):
- face (role portrait), name, role, role-colored aura,
- live status line ("reasoning...", "sealed their room", "waiting"),
- a tiny tool/play badge hinting there is more inside.

What the click opens (the character dialog - reuse, do not reinvent):
- We ALREADY compute all of this per worker: the rail's Active Worker card has
  deployment, `worker-ms` (Microsoft service badge), `worker-state`,
  `worker-tools` (Toolbox chips), `worker-trace` (tools/call trace, live,
  server-recorded), and `worker-reasoning` (thinking tokens + memory injected +
  FunctionTools the model called). The dilemma overlay already shows per-worker
  tools too.
- The character dialog is that SAME evidence, re-presented per character: tool
  calls, IQ recalls, reasoning preview, memory injected, score at its gate.
- This means the floating cast is not new telemetry - it is a friendlier, in-
  world FRONT DOOR to the telemetry we already render in the rail. One source
  of truth, two presentations (rail = always-on instrument; card = in-world).

Why this is the right move:
- It collapses "dashboard vs game": the dashboard data becomes the character's
  inner life. Clicking a face to see what it actually did is the most game-like
  way to expose reasoning - and it is straight rubric points (Reasoning
  visibility, UX/Presentation).
- It reuses existing data plumbing (chapter invocation -> inv.maf_tools_called,
  inv.maf_memory, reasoning_tokens, trace) so there is little new state.

Implementation note: keep ONE store of per-character run evidence (keyed by
worker name / chapter id) that BOTH the rail and the card dialog read, so they
can never disagree.

### 5.7 Player character creation (you are in the cast)

Infinite-conversation has no "you". Ours does - the player creates a character
so the cast can address them by who they are, and so the human seat in the org
is concrete.

What exists today (reuse, upgrade): the first-step screen already HIDES a
founder-creator with four CEO archetypes (Builder / Seller / Designer /
Operator), each carrying a `skill` that already seeds the human lane of the org
design (story.js sets `state.archetype = {name, skill}`). The narration already
speaks the archetype back ("The founder is a {name}: their skill is {skill}").
So the MECHANIC is built and wired - it is just hidden behind the one-press
handoff.

The revamp: promote character creation into a proper, in-world beat between the
film and the run - short, cinematic, on-brand - so YOU enter the conversation
as a defined character:
- Pick your archetype (the four CEOs) - this is your starting "class".
- Optionally a name/handle the cast uses to address you.
- A player presence on stage (we have `assets/local/characters/player.png`):
  small, always-present, "you are here", lit when the conversation turns to you
  at a gate.
- The archetype keeps doing its real job: seeding the org's human lane + riding
  into every worker brief (already implemented), so character creation is
  MEANINGFUL, not cosmetic.

Keep it to ONE short screen (do not rebuild the heavy founder form): archetype
choice + optional name, with the same `.seal` Begin. Pitch/URL keep their
sensible defaults hidden, exactly as now, so the run still starts in one press.

Decision to confirm with maintainer: is character creation BEFORE the film (you
define yourself, then watch the world you are entering) or AFTER (the film
hooks you, then you step in as a character)? Leaning AFTER - the film is the
why, character creation is crossing the threshold into it. Either way it is one
beat in the spine in section 4.

### 5.4 Parallax (depth without 3D)

Three drift planes give a game-like depth on flat art:
- far: the scene/Earth background (slow `earthDrift`, already in).
- mid: the cast (characters), slightly faster, react to pointer with a few px of
  parallax.
- near: HUD/rail/narration (fixed, crisp).

Pointer parallax is a few pixels of translate on the cast layer following the
cursor - cheap, and it instantly reads as "a scene I'm inside."

### 5.5 Accessibility + perf guardrails (non-negotiable)

- Respect `prefers-reduced-motion`: no float, no parallax, characters simply
  fade in/out. (We already do this for earthDrift + first-step entrance.)
- Pause all loops when the tab is hidden (visibilitychange) and when a character
  is off-screen.
- Characters are decorative: `alt=""` + the real info stays in the rail/DOM, so
  screen readers are unaffected.
- One animation budget: if we go canvas, single rAF loop for cast + particles.

---

## 6. Better music - an adaptive layered score

Replace disconnected cues with ONE generative bed that responds to game state.
Still pure Web Audio API (oscillators), zero files, offline-safe after clone -
this is a hard repo constraint and a creativity-rubric win.

Layers (each a gain we fade, not a separate "song"):
- Base pad (always) - the warm chord we already have, but as the FLOOR.
- Tension layer - fades in while an agent reasons (replaces the lone thinking
  pulse). Tied to the same state that drives the character "thinking" tell.
- Resolution layer - swells on a passing gate; brief dissonance dip on rejection.
- Motif - a 3-note "Poly186" theme on Begin that RESOLVES on quest completion,
  so the ending rhymes with the opening.

It becomes a soundtrack that tracks the reasoning, not wallpaper. Same audio
state should drive: the music layer, the character thinking-tell, and the
existing rail telemetry - one signal, three expressions.

Current state (already built, to fold into this): `CampaignAudio.ambientStart/
ambientStop`, `uiHover`, `uiPress`, `thinkingStart/Stop`, `chime`, `approve`,
`reject`, `levelUp`, `complete`. We refactor these into the layered model rather
than adding more one-shots.

---

## 7. Build order (shippable slices, demo never breaks)

1. Token + button foundation (`.seal`/`.primary`/`.ghost`, type scale, glass,
   entrance curve). Low risk; instantly unifies the two intro screens.
2. Apply to the intro pair (film gate + first-step become one language).
3. Player character creation beat - promote the hidden founder-creator into one
   short in-world screen (archetype + optional name) between film and run, with
   the player presence on stage. Mechanic already wired; this is presentation.
4. Floating character CARDS v1 - Option A (CSS): idle float + summon + speak on
   the existing portraits, each card clickable to open the character dialog
   (re-presenting the per-worker evidence we already compute). One shared
   per-character evidence store feeding both rail and card.
5. Conversation layer - make the beats feel continuous and voiced (the
   infinite-conversation feel): speaker lit + face-to-face turns, others dimmed,
   the narration band as the "subtitle" of the spoken line. Pauses and turns to
   YOU at gold gates.
6. Adaptive score - refactor cues into the layered model; wire the tension layer
   to the reasoning state (shared with the character thinking-tell).
7. Apply the language to the play UI (header, footer meters, controls, rail) so
   gold/blue/teal carry meaning everywhere.
8. Handoff baton/particles (tiny canvas) if step 4 feels flat.
9. Persistent scene frame across all chapters (narrative continuity).

Each step is independently shippable and the live demo keeps working throughout.

---

## 8. Open questions (decide as we go)

- Character creation BEFORE or AFTER the film? (Leaning: after - cross the
  threshold into the world the film just showed you.)
- Does the conversation auto-advance (infinite-conversation style, hands-free)
  or step on Next? (Leaning: auto-advance with a visible "pause / your turn"
  whenever it reaches a gold gate; Next still works for presenters.)
- Do characters persist across ALL chapters (a standing party) or only summon for
  their active room? (Leaning: standing party, dimmed, the active one lit.)
- How many on stage at once before it gets busy? (Leaning: max 3-4 visible, rest
  implied in the rail.)
- Player presence art: use `assets/local/characters/player.png` (local-only) or
  generate a committed, lighter player portrait so a fresh fork shows it too?
- Canvas vs CSS for the final cut - revisit after v1.
- Eventual upgrade path: animated character clips (Veo/Omni) as progressive
  enhancement over the PNGs, same as the lore stills->clips pattern. Optional,
  local-only, never required for a fresh fork.

---

## 10. The larger narrative - "your company in the Poly186 world"

The framing the maintainer wants: this is not a standalone tool, it is ONE
venture inside a larger story world. "Gamifying World Improvement" is a chapter
in the Poly186 universe - a near-future where humanity gamifies world
improvement and people stand up companies, backed by a league of reasoning
agents, to automate basic needs and terraform the Sahara. The film already
establishes this cosmology; the game is you taking your place in it.

What this buys us narratively:
- Your company is a quest line inside a bigger campaign (room -> company ->
  world). The completion screen ("your campaign is launched") becomes "your
  contribution to the larger world," not just an end card.
- The cast are recurring inhabitants of that world, not generic assistants -
  they have names, voices, and faces because they LIVE here. (Cast bible below.)
- It sets up the upgrade path: more ventures, a persistent world, the player's
  character carrying memory across runs (the agent-memory layer already does
  this for operating patterns).

Keep it light-touch in v1: the world framing lives in the film + the narrator's
lines + the completion screen. We do NOT build a metaverse - we make the single
run feel like it belongs to something bigger.

---

## 11. The core cast (bible)

We already have voices and faces for six agents (VOICE_BY_ROLE + ROLE_NAME in
ui/game/story.js; PORTRAITS/CHARACTERS in tools/generate_art.py). This codifies
them as CHARACTERS so writers and art stay consistent. Names marked (proposed)
are not yet in code - confirm before wiring.

| Character (proposed name) | Role id     | Voice  | Color    | Motif / look                                  | In-world job |
|---------------------------|-------------|--------|----------|-----------------------------------------------|--------------|
| The Narrator / Worldkeeper| narrator    | onyx   | slate    | hooded guide, glowing compass                 | Welcomes you, decomposes the pitch into the quest line, speaks the world |
| The Architect (proposed)  | orgdesigner | sage   | violet   | measured architect, org-chart constellation   | Designs the workforce - one human seat + digital workers |
| Soren                     | strategist  | ballad | blue     | analyst, chess-knight + target reticle         | Positioning, market wedge, the sharp call |
| Dahlia                    | designer    | coral  | violet   | creative, drafting stylus + bezier curve       | Product/brand/experience artifacts |
| Maddox                    | marketer    | verse  | amber    | herald mid-stride, megaphone + growth arrow    | Go-to-market, launch narrative, growth |
| The Steward (proposed)    | ops         | alloy  | teal     | engineer, turning gear + shield                | Reliability, runway, keeping the machine honest |
| You / the Founder         | founder     | (you)  | gold     | the only clearly human figure, gold spark      | The human seat - judgment, the gold-gate decisions |

Casting rules:
- VOICE is fixed per character (continuity = the infinite-conversation feel).
  We have a deep voice bench (onyx/sage/ballad/coral/verse/alloy verified on the
  TTS deployment) plus the gpt-audio/MAI-Voice upgrade chain; each character
  keeps ONE voice for the whole run.
- COLOR is fixed per character and obeys section 2 (gold=human, blue=system,
  teal=living layer; violet/amber are role accents within that).
- FACE: every character has a committed 512 portrait (bust) AND a full-body
  sprite (tools/generate_art.py --characters) for the floating-cast layer.
- VOICE INSTRUCTIONS (delivery direction) are per character too - a calm warm
  narrator vs an energetic herald - passed to /api/tts `instructions`. We
  already pass a NARRATOR_STYLE; extend to a per-character style preset map.

Note: chapter workers get DYNAMIC titles from the org design (e.g. "Product
Strategy Digital Worker", "Runway Steward"). Those map onto a core role (and so
inherit that role's voice/face/color), but keep their generated title on screen
- so the cast feels populated by THIS company's specific workers while still
reading as the same six archetypes. The mapping already exists (owner_role ->
ROLE_PORTRAIT/VOICE_BY_ROLE); the bible just names the archetypes.

---

## 11a. Art direction - the Afrofuturist house style (the cast LOOK)

The cast's visual language is Afrofuturism: a Wakanda-grade fusion of African
heritage and advanced technology, set in the terraformed-Sahara Poly186 world.
This is the look that makes the cast feel like inhabitants of a SPECIFIC world,
not generic vector assistants - and it is the maintainer's own aesthetic, so it
is authentic to the project, not borrowed.

Source: the maintainer's personal character profile (Princeps Polycap) is the
REFERENCE, not a character we ship. We do NOT put that exact person in the game.
Instead we extract a shared visual VOCABULARY from it that every cast member
draws on, each in their own way. (If we ever want a single signature avatar for
the founder/host, that is a separate opt-in decision.)

### Shared visual vocabulary (every character pulls from this)

- Heritage faces: African (notably East African) features, deeply melanated
  skin, rendered with dignity, pride, and strength. This is the default cast,
  not an exception.
- Palette = our existing tokens, reframed in-world:
  - obsidian navy (--bg family) = the night, the deep, the ground.
  - gold (--gold) = human consequence, royalty, the spark of insight.
  - "Zima" cyan/teal (--ops) = energy, the living/automated layer, cosmic clarity.
  This is why the direction fits: it IS our color system, named for the world.
- Glowing energy markings: sacred-geometry / fractal tattoos and trim that emit
  a soft GOLD glow which INTENSIFIES at moments of insight. This is the same
  signal as the "reasoning tell" (section 5.2.5) and the music's tension layer -
  one idea expressed in art, motion, and sound. Recurring symbols: Ankh, Eye of
  Horus, Poincare/hyperbolic disk, spiraling DNA, fractal lattices.
- Materials & wardrobe: brass and gold, obsidian, woven textiles with tribal +
  fractal motifs, ceremonial sashes, high collars, regal-but-practical solarpunk
  desert utility (Dune-adjacent flowing robes meet ceremonial royalty).
- Hair: braids are a hero feature; a metallic-white / silver braid accent reads
  as "heritage meets future" and is a nice recurring note (use sparingly so
  every character is distinct).
- Demeanor: calm, measured, heroic presence. The cast carries authority lightly.

### Per-character expression (same vocabulary, distinct silhouette)

- founder (You) - the only clearly HUMAN seat; most regal of the cast. Gold
  fractal markings, a gold spark cupped in hand, upward hopeful gaze. The
  gold-gate decider.
- narrator / Worldkeeper - elder griot-oracle; hooded ceremonial robe, Ankh +
  glowing compass, cosmic depth.
- orgdesigner / Architect - master builder; brass instruments, an org-chart
  constellation drawn in light, geometric calm.
- strategist / Soren - tactician; obsidian + gold, chess-knight + target reticle,
  sharp focus.
- designer / Dahlia - artisan; woven textiles, drafting stylus tracing a glowing
  bezier curve, warm creativity.
- marketer / Maddox - griot-herald mid-stride; megaphone + growth-arrow trail,
  vibrant and energetic.
- ops / Steward - engineer-guardian; brass exosuit accents, turning gear + shield
  emblem, steady reliability.

### How it ships (no new pipeline)

This direction lives in the prompts of tools/generate_art.py: a shared
AFRO_FUTURE style fragment is woven into SPRITE_STYLE (full-body cast) and the
bust STYLE, and each per-character prompt adds its own silhouette + motif. Same
Foundry MAI deployment, same offline-safe behavior, same maskable navy field.
Regenerate the cast with:
    python submission/tools/generate_art.py --characters --force
    python submission/tools/generate_art.py --force          # busts, if desired

The procedural/geometric baseline still stands alone on a fresh fork; this art is
the progressive-enhancement layer, now with a coherent, owned aesthetic.

---

## 12. In-world image generation (the workers paint the world)

The maintainer's idea: workers use image-creation tools with STYLING PRESET
prompts to immerse the player - so the multi-agent conversation is illustrated
live, in one consistent house style, by the characters themselves.

We already have the engine: tools/generate_art.py talks to the Foundry MAI image
deployment (IMAGE_ENDPOINT/IMAGE_DEPLOYMENT/IMAGE_API_KEY) with a shared STYLE
and SPRITE_STYLE preset, and it is offline-safe (no key -> prints what it would
make, exits 0; the UI hides missing art). foundry_integration_plan.md already
lists `generate_image` as a worker tool on MAI-Image-2.5.

The design: a `generate_scene` tool, exposed to workers, that takes a short
subject and ALWAYS composes it with a locked house-style preset, so anything any
character "paints" matches the game's look.

Style presets (locked, composed server-side - the worker only supplies subject):
- scene/key-art preset (wide, cinematic, the lore look) - for chapter
  establishing shots ("the company's first product taking shape").
- portrait/sprite presets (already exist) - for any new character/worker the org
  design invents mid-run, so a freshly-spawned "Niche Research Scout" can get a
  face in the house style on the fly.
- artifact preset (clean, diagrammatic) - to illustrate an artifact a worker
  just shipped, as a stylized still beside the real diagram.

How it serves immersion (voice + multi-agent + image together):
- When a worker speaks its beat (voice) and claims its room, it can ALSO paint
  the room (image) - so the conversation is illustrated as it happens, by the
  character doing the work. Voice + face + freshly-generated scene = the
  infinite-conversation feel, but cinematic and specific to THIS company.
- New workers the org invents get on-brand faces immediately (no "missing
  portrait" gaps), which keeps the floating cast complete as the org grows.

Hard guardrails (do not break the demo):
- Generated-art-FIRST but never art-REQUIRED. Every image is a progressive
  enhancement: the procedural/diagram baseline must stand alone on a fresh fork
  with no image key. Image calls are async, cached, and time-boxed - a slow or
  failed generation NEVER blocks a beat or the run loop.
- Cost/latency: generate at most a few images per run, cache by subject+preset,
  and prefer pre-generated committed art for the fixed cast. Live generation is
  for the dynamic, this-company-specific moments only.
- Licensing/safety: outputs are AI-generated on a Microsoft Foundry deployment,
  shipped MIT with the existing CREDITS.md disclosure; subjects are derived from
  the player's public business brief (no secrets, no real people).
- Style lock lives SERVER-SIDE: the worker/tool supplies only the subject; the
  preset is appended by the tool so the house style can never drift and a model
  cannot be prompted into an off-brand or unsafe image.

Build note: this is build-order step ~6-8 territory (after the cast + cards +
conversation read well). It is the "wow" layer, not the foundation - sequence it
after the language and the cast are coherent, or it amplifies inconsistency.

---

## 13. Guardrails carried from repo rules

- No new dependency in the reasoning path. UI-only anim libs only if MIT +
  vendored, and only if CSS/canvas truly cannot do it (default: they can).
- All audio stays oscillator-generated (no audio files), offline-safe.
- Generated-art-first: committed baseline uses the generated portraits; heavier
  local character art stays local-only / gitignored.
- ASCII-only in committed source/docs.
- Every change should move a rubric criterion (UX/Presentation, Creativity,
  Reasoning visibility) - note which one in the PR.

---

## 14. Card-native redesign - "the cards ARE the interface"

The next leap: stop treating cards as a decoration stage-left and make the CARD
the primary surface of the whole experience. Every character is a card; the
active speaker's card grows and shows its live speech + tool calls; flipping a
card reveals its full dossier (trace, reasoning, memory, gate score); artifacts
(mermaid diagrams, generated images) appear as "result cards" played onto the
table. This collapses dashboard-vs-game into one thing: the telemetry we already
compute becomes the inner life of a living card.

Companion spec: `submission/docs/card_dag_game_design.md` expands this into the
full card/DAG game model and maps it to the actual local code (`FounderState`,
`WorldGraph`, `/api/world/standup`, `setParty()`, `cardEvidence`,
`renderScenarioCanvas()`, and dilemma consequences). Use that document as the
source of truth for the bottom-card carousel, world/DAG surface, inspect panel,
and inter-agent graph-event model.

### 14.1 Game inspirations (what we borrow, and why)

- Sultan's Game - the closest cousin: a narrative card game where character
  cards drive decisions and each decision shifts consequence meters. This is
  almost exactly our model (dilemmas = cards, decisions move Proof/Trust/
  Velocity/Burn/Autonomy). Borrow: the table-of-cards layout, decisions as cards
  you commit, meters reacting in real time.
- Inscryption - cards as LIVING characters with a diegetic, tactile UI; the
  cards talk to you. Borrow: characters that speak FROM the card, holographic/
  physical card feel, the card as a being not a button.
- Reigns - character-driven decision cards + minimalist consequence meters; the
  whole game is one card at a time. Borrow: focus (one active card at a time),
  decision-as-gesture, meters as the only HUD.
- Slay the Spire - hover-to-enlarge cards, clean archetypes, and RELICS as
  persistent passive upgrades. Borrow: hover/tap to enlarge, and "relics" =
  unlocked workers / earned capabilities shown as a small persistent row.
- TCG holo/foil (Hearthstone golden cards, Pokemon holos) - the card-flip
  inspect view and premium foil treatment. Borrow: double-tap to FLIP to the
  card back (the dossier), gold/holo rarity = a worker's gate score tier.
- Citizen Sleeper / Disco Elysium - dossier-style character + skill panels
  (not cards, but the "inspect a character's stats and history" feel). Borrow:
  the back-of-card dossier content model (who they are + what they did).

### 14.2 The card anatomy (front and back)

FRONT (at rest / on the table):
- character art (the gpt-image-2 sprite, or its Veo idle clip),
- name + role + role-colored frame glow,
- rarity = gate-score tier (bronze/silver/gold foil) once they have shipped,
- a small status line ("reasoning...", "sealed their room", "waiting"),
- a tool/play badge hinting there is more inside (flip affordance).

FRONT (active speaker - the card grows center-ish):
- LIVE TRANSCRIPTION of the character's narration streams on the card (the
  speaker + caption live on the card, per the maintainer's call),
- tool-call chips light up as the model calls them (calculate_consequence,
  render_org_graph, write_memory, recall, validate_*),
- the aura brightens while it reasons (shared signal with audio tension layer).

BACK (double-tap / click to FLIP - the dossier):
- full tools/call trace (live, server-recorded) - already computed,
- reasoning preview (thinking tokens) + memory injected (IQ + agent memory),
- the Microsoft service badge + deployment,
- gate score + rubric breakdown for this character's chapter,
- "handoff" line: who they pass to next.
This is the SAME evidence the rail shows today (section 5.6) - one store, two
faces. Flipping a card is the most game-like way to expose real reasoning =
direct rubric points (Reasoning visibility, UX/Presentation).

### 14.3 Result cards (artifacts played onto the table)

When a worker ships an artifact, it is dealt onto the table as a RESULT CARD:
- a mermaid diagram (org chart, quest graph, integration map) rendered INSIDE a
  card frame, or
- a generated image (in-world scene from generate_scene, section 12), or
- a financial/OKR chart (the existing SVG charts) framed as a card.
The result card is tied to the character who played it (same accent, a thread
to their card) so cause (worker) and effect (artifact) read as one move. Result
cards stack into the "company deck" - the growing record of what was built (the
completion screen is then literally your deck laid out).

### 14.4 Table layout (the redesign)

- The scene becomes a TABLE: the party's cards sit in a hand/arc along the
  bottom or left; the active speaker's card lifts and enlarges center.
- The center stage shows the current RESULT card (diagram/image) being played.
- Meters (Proof/Trust/Velocity/Burn/Autonomy) stay as the minimal HUD (Reigns).
- Dilemma gates are full-focus decision CARDS (Sultan's Game): the options are
  cards you commit, and the meters visibly react.
- The rail can collapse into "inspect mode" (the card backs carry its content),
  or stay as the always-on instrument for the demo - keep both, toggle.

### 14.5 Interaction model

- hover / tap a card -> enlarge + preview (Slay the Spire).
- double-tap / click -> FLIP to dossier back (trace, reasoning, memory, score).
- the active speaker card auto-enlarges and streams its caption + tool calls.
- play/commit a decision -> the chosen option card animates in, meters react.
- result cards deal onto the table as artifacts are produced.
- everything respects prefers-reduced-motion (flip becomes a cross-fade).

### 14.6 Build approach (incremental, demo never breaks)

This is a REDESIGN, so stage it behind the existing UI rather than a big-bang
rewrite:
1. Promote the current cast card (section 5/built) into the full front-face card
   with live caption + tool-call chips (reuse the rail's per-worker data).
2. Add the FLIP-to-dossier back (reuse worker-trace / worker-reasoning / gate
   data - one shared per-character store).
3. Result cards: wrap the existing mermaid/image/chart render in a card frame
   and thread it to its author card.
4. Table layout pass: arrange party cards as a hand; active card center.
5. Dilemma gates as decision cards (the dilemma overlay already has options +
   tool chips - restyle into cards).
6. Optional: rarity/foil = gate-score tier; "relics" row = unlocked workers.
Each step is shippable; the rail stays as the fallback instrument until the
card backs fully carry the evidence. No new runtime dependency - pure CSS 3D
flip (transform: rotateY) + the data we already compute.

### 14.7 Open questions (card redesign)

- Card flip: true 3D (transform-style: preserve-3d) vs a cross-fade swap?
  (Lean: 3D flip on capable browsers, cross-fade under reduced-motion.)
- Do result cards REPLACE the center diagram or sit beside it? (Lean: the result
  card IS the center diagram, framed.)
- How many party cards visible before it crowds? (Lean: arc of up to 5-6, rest
  in a "+N" stack you can fan out.)
- Keep the right rail at all, or fully migrate its evidence onto card backs for
  the demo? (Lean: keep rail as the always-on instrument; cards are the in-world
  front door - the section 2 "instrument core + cinematic shell" split.)
