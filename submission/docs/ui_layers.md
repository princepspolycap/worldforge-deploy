# UI Layer System

The authoritative map of how the story-mode UI is layered, how those layers
coordinate, and the single sources of truth that keep them from overlapping.
This is the contract a human - or, soon, an agent - must respect when changing
or driving the UI. Read it before touching layout in
[../ui/story.html](../ui/story.html) or
[../ui/game/story.js](../ui/game/story.js).

> Why this matters now: we are moving toward **agents controlling the UI**. An
> agent that shows a panel, opens an overlay, or narrates must go through the
> same coordinator and CSS-variable contract a human does - never poke raw DOM
> styles. The seams below are the agent-facing API surface for the screen.

## The screen is one full-bleed stage with floating glass layers

`#stage` is `position: fixed; inset: 0`. Everything else floats above the
world canvas as a glass overlay. Top to bottom by intent:

| Layer | Element | Role | z-index |
| --- | --- | --- | --- |
| Header | `#scene-head` | beat + title + provenance (metadata) | base |
| World canvas | `#diagram` (centered) | the judged artifact: org graph, MRR chart, founding splash, council, decision receipt | base |
| Reasoning theater | `#theater` | a worker's live plan takes the whole stage | 7 |
| Speaker spotlight | `#cast-stage.speaking` | a Game Master / worker aside (non-modal) | 7 |
| Narration caption | `#narration` | typed subtitle line above the hand | 19 |
| Party rail | `#party` | the digital-worker hand (rides with the world canvas) | 18 |
| Footer HUD | `footer` | GM console + econ HUD + card hand + command line | 20 |
| Inspector / announcement / dilemma | `#cast-stage.inspect`, `body.announce-bridge #cast-stage.speaking`, `#worker-stage`, `#dilemma-overlay` | focused takeover overlays | 24-30 |

## Default World-Canvas Play State

This is the state shown during a normal run when the center contains a Mermaid
or SVG artifact, the player can see the party, and the footer contains current
options.

- `#diagram .world-canvas` owns the artifact. It should be readable behind the
  foreground layers and height-bounded by the lower reserve.
- `#party` is a held hand, not another panel. It is translucent, horizontally
  scrollable without a visible scrollbar, and partly tucked behind the footer by
  `--party-overlap`. Resting cards can be partially occluded; active/flipped
  cards lift above the footer and remove their fade mask.
- Party card markup is rendered by [../ui/game/party.js](../ui/game/party.js).
  `story.js` supplies state, evidence, metrics, and dossiers; the component owns
  the card face structure.
- `footer` is a separate control tray. It may expose collapsible subsections,
  but it should not hide the party by becoming another narrative surface.
- `#narration` is temporary worker captioning only. If the text is a stage
  briefing, decision consequence, org/world change, or rival move, route it to
  `#cast-stage.speaking.gm-announce` or `.rival-announce` instead.
- The intended visual stack in this state is:

```text
world-canvas -> party tray/cards -> footer controls
```

Announcements, dilemmas, stand-ups, inspectors, and reasoning theater are not
this state. They must enter through `setStageLayer()` and explicitly define how
the footer and party step aside.

## The lower band: three independently-fixed elements, one source of truth

Bottom-up, the lower band stacks three fixed elements, each at its own `bottom`
offset. Get this wrong and they overlap (the classic bug):

- `footer` -> `bottom: 0`. Its **measured height drives everything**.
- `#party` (card hand) -> `bottom: var(--hand-bottom)`. Lives INSIDE `#scene`.
- `#narration` (temporary worker caption) -> `bottom: var(--dialogue-bottom)`.
  **Sibling of `#scene`** (both under `#stage`), NOT a child.
- `#cast-stage.speaking.gm-announce` / `.rival-announce` -> centered
  announcement overlays for Game Master and rival/world-state dialogue. These
  are the default home for announcements and should not consume lower-band
  caption reserve.

`#scene` reserves the band with `padding-bottom: var(--lower-stage-reserve)` so
the centered `#diagram` artifact never slides under that stack.

### Single source of truth = shared CSS vars on `:root`

`syncFooterAwareLayout()` in [../ui/game/story.js](../ui/game/story.js) sets the
lower-band inputs on `document.documentElement` (`:root`) so EVERY consumer -
including the sibling `#narration` - resolves the same value:

- `--party-overlap` = the amount of each resting worker card tucked behind the
  footer.
- `--hand-bottom` = `max(real footer height - party-overlap, 4px)`.
- `--dialogue-h` = real visible `#narration` height, or `0px` when the caption
  is hidden. Do not keep a default caption reserve; it creates the blank band
  above the party hand.

CSS `calc` at `:root` owns the rest; never compute these in JS:

```text
--dialogue-bottom      = hand-bottom + hand-card-h(208) + 22
--lower-stage-reserve  = dialogue-bottom + dialogue-h + 14
```

World-state dialogue should route through the announcement layer instead of the
lower caption:

- Stage briefings: World Designer announcement.
- Decision consequences and org/workforce changes: Org Designer announcement.
- Rival escalation: rival announcement.

Game Master and rival announcements use the `announce-bridge` stage layer: the
footer glides away, the active stage card remains visible in one lane, and the
announcer portrait/speech occupies the other. On compact screens this bridge
collapses back to a centered announcement with the stage card softened behind it.

Worker execution reports may use the reasoning theater, card receipts, or a
temporary worker caption; they are not Game Master announcements.

A `ResizeObserver` watches `footer`, `#card-hand`, and `#narration` and re-runs
the sync. Special-state reserve overrides are **direct `#scene` rules** (for
example `body.standup-active #scene { ... }` and
`body.spotlight-active #scene { ... }`) and beat the inherited `:root` reserve
with NO `!important` (direct selector > inherited value).

**Bug history (do not regress):** setting `--hand-bottom` on `#scene` left the
sibling `#narration` at the stale default and it slid over the hand; computing
the reserve in JS dropped the narration term and clipped tall captions. The fix
is the two-input-on-`:root` model above.

## The stage-layer coordinator (the agent-facing API)

`setStageLayer(name, on)` in [../ui/game/story.js](../ui/game/story.js) is the
**single source of truth** for the takeover overlay layers. Components - and
agents - never toggle the body classes directly; they call this so every layer
knows what else is on stage.

- Owns body classes: `spotlight-active`, `announce-bridge`,
  `inspecting-agent`, `inspecting-worker`, `standup-active`, `theater`,
  `dilemma`.
- Derives `body.footer-quiet` from `FOOTER_QUIETING_LAYERS` - this hides the
  footer's playable cluster (`#card-hand`, `#player-command`,
  `#player-command-status`) so a takeover layer never overlaps the hand. The
  worker mini + econ HUD stay (identity + live pressure, not controls).
- `stageLayerActive(name)` lets any component query who else owns the stage.

## World-canvas occupancy decides the party rail (pure CSS)

The party hand is shown ONLY when `#diagram` renders a `.world-canvas`
(org graph / MRR chart / scenario):

```css
#scene:not(:has(#diagram .world-canvas)) #party { display: none !important; }
```

Full-screen narrative panels (founding splash, council, stand-up log, decision
receipt) carry no `.world-canvas`, so they own the centre alone and the rail
steps aside. This is pure CSS - no JS or MutationObserver needed, because the
reserve is CSS-derived.

## Artifact SVG must be height-bounded to the band

`story.js` emits the world-canvas SVG with inline `max-width:620px;width:100%`,
so width wins and height follows aspect ratio - a tall MRR chart used to
overflow ABOVE the header. `max-height:100%` alone does NOT clamp a replaced SVG
whose parent has only `max-height`. Both rules are required:

- `.world-canvas { height: 100%; min-height: 0; max-height: 100%; }` (definite height)
- `#diagram .world-canvas svg { height:100%!important; width:auto!important; max-width:100%!important; max-height:100%!important; }`

Scope to `.world-canvas` and out-specify the broad `#diagram svg` rule (use
`#diagram .world-canvas svg`, specificity 1,1,1 > `#diagram svg` 1,0,1) so the
stand-up transcript diagrams (`.council-diagram`, also under `#diagram`) keep
their own intrinsic sizing.

## Two agent classes, three card surfaces

Keep these visually distinct - this is the design language, not decoration.

**Two agent classes:**

1. **World-engine / Game Masters** (`.pa-layer.gm`): World Designer + Org
   Designer. They author the run (Story Circle, workforce, antagonist). Home:
   the footer `#worker` GM console and the `gm` party cards. There are exactly
   **two** of them - announcement speaker NAMES ("The Worldkeeper", "Profile
   Analyst") are flavor titles for the same World Designer agent, not extra GMs.
2. **Party / digital workers** (`.pa-layer.dw`): Strategist, Designer, Marketer,
   Operations - the player's team, executed by the worker factory. Home: the
   `#party` hand. Each carries a `WorkerInvocation` of receipts.

**Three card surfaces** (one renderer, two faces each - never a parallel modal):

1. **Party worker cards** (`#party .party-agent`): front = identity + headline
   metric + beat line; back (flip) = the dossier receipts.
2. **World / stage cards** (the `#diagram` graph nodes): world-engine output,
   advanced via `/api/world/run-next`, not "played".
3. **The roguelike hand** (`#card-hand`): playable `GameCard`s; face must read
   its effect without a tooltip.

## The Game Master announcement is a bridge

When a Game Master heralds a change, `#cast-stage` gets `.speaking.gm-announce`
and `body.announce-bridge` becomes active - distinct from a normal non-modal
worker aside (which stays a small side card). The pattern is CSS-only, scoped to
`.gm-announce` / `.rival-announce` plus the `announce-bridge` body class:

- Wide screens split the viewport into two lanes: the current stage card remains
  visible on the left, while the announcer portrait and speech occupy the right.
- Compact screens collapse to a centered announcement with the stage card kept
  as softened context behind it.
- The footer glides off-screen through `setStageLayer("announce-bridge", true)`,
  not by toggling raw body classes.
- "Transcription outside the card": `.cast-speech` is a child of `.cast-card`, so
  `.cast-card` is made transparent and the gold frame + `gmAnnouncePulse` move
  onto `.cast-card-art` (the portrait). Result: a big legible portrait card on
  top, a wider `.cast-speech` panel below it.

## Verify any layout change (in-browser, worst case)

1. `node --check submission/ui/game/story.js`; bump `story.js?v=N` in story.html
   on any JS change so the browser drops the cached module.
2. Render a `.world-canvas` with a 560x300 SVG and force `#narration.show` with a
   3-line caption, then assert all gaps `>= 0`:
   - `svg.top >= diagram.top` and `svg.bottom <= diagram.bottom` (no header bleed)
   - `diagram.bottom <= narration.top <= party.top`
   - `party.bottom <= footer.top`
3. A change is not done until it survives a server restart + page reload with the
   run rehydrated from `state.json` and the same numbers.
