# UI Assets

This folder holds the game art that ships with the public, MIT-licensed
submission. The committed baseline is **generated-art-first with a geometric
fallback**: the `/story` view draws its diagrams procedurally and shows
Foundry-generated portraits when they exist, so the public repo ships with
**no third-party art** and is fully MIT-clean.

## Third-party sprite packs (historical note)

An earlier sprite-based view used the paid **Limezu** packs locally. That view
has been removed; the rules below are kept only so future art decisions stay
license-safe:

- Paid packs like Limezu's allow *use* in projects but **forbid
  redistribution** - their PNGs must never be committed to this public repo.
- Anything under `submission/ui/assets/local/` stays gitignored for that
  reason.

## Foundry-generated art (MAI-Image-2e) - the committed-art path

The repo's own way to ship real game art is to **generate it on Microsoft
Foundry** with **MAI-Image-2e** (Microsoft's efficient MAI image model - the
highest RPM quota of the MAI family; quality is good-not-best, the right trade
for game art at scale). Generated outputs are ours and **can be committed under
MIT**, so forkers get both the art and the generator.

- Config: `IMAGE_ENDPOINT`, `IMAGE_DEPLOYMENT`, `IMAGE_API_KEY` in
  `submission/.env` (see [.env.example](../../.env.example) for the deploy
  command and supported regions).
- Generator: run `python submission/tools/generate_art.py` to produce the
  worker-role portraits into `generated/` (offline-safe: prints a dry-run plan
  when no deployment is configured). The story view auto-shows a portrait when
  `generated/<role>.png` exists and stays geometric when it does not.
- API: `POST {IMAGE_ENDPOINT}/mai/v1/images/generations` with
  `{"model": "MAI-Image-2e", "prompt": ..., "width": 1024, "height": 1024}`
  and an `api-key` header. Output is always PNG (min 768px per side,
  width x height <= 1,048,576).
- House style prompt prefix: "minimal flat geometric portrait, dark navy
  background, teal and gold accents, clean vector style game avatar".
- Commit generated art under `submission/ui/assets/generated/` with a note that
  it is AI-generated (responsible-AI disclosure) and which model produced it.

## Motion backdrops (Veo) - local-only progressive enhancement

The intro lore cards upgrade themselves from stills to motion: if a clip named
`generated/lore/video/<scene>.mp4` exists for a scene (same base name as the
PNG - `sahara.mp4` next to `sahara.png`), the intro plays the looping clip as
the full-bleed backdrop instead of the Ken Burns still. Clips are **local-only
and gitignored** (too heavy for the repo); the committed MAI stills are the
baseline every fork gets, so nothing breaks without them.

Format: ~8s loopable, 16:9 (1280x720 or better), muted (the game supplies its
own narration and score), no text or logos in frame.

Scene prompts (generated with Google Veo 3 in Flow; one clip per lore card,
same house palette as the stills - dark navy night, teal and gold light):

| Scene file | Prompt |
|---|---|
| `sahara.mp4` | Slow aerial push over golden Sahara dunes at dawn; thin channels of water spread through the sand, green growth following them toward a distant glowing new city; minimal flat geometric vector style, dark navy sky, teal and gold light accents, no text, seamless loop |
| `premise.mp4` | Slow vertical drift down a glowing business tower at night: one small warm-lit boardroom of few silhouettes at the top, vast luminous lattice of working agent nodes pulsing below; flat geometric vector style, dark navy, teal and gold, no text, seamless loop |
| `needs.mp4` | Aerial glide over an automated landscape lighting up at night: greenhouse rows, water channels, solar microgrids and modular shelters connecting one by one with glowing logistics lines; flat geometric vector style, dark navy, teal and gold, no text, seamless loop |
| `workforce.mp4` | One human silhouette at a desk; above them a constellation of glowing digital worker avatars fans out, each tethered by a thread of light that pulses as work flows; flat geometric vector style, dark navy, teal and gold, no text, seamless loop |
| `flywheel.mp4` | A great luminous wheel of many small human figures and AI nodes slowly turning, light flowing evenly between them in a fair circular exchange; flat geometric vector style, dark navy, teal and gold, no text, seamless loop |
| `foundry.mp4` | A vast glowing foundry core like a reactor of reasoning, deep geometric machinery slowly rotating, orbited by small agent lights; flat geometric vector style, dark navy, teal and gold, no text, seamless loop |
| `gate.mp4` | A single human hand slowly pressing a glowing approval seal onto a monumental gate; light ripples across the gate as agent silhouettes wait behind it; flat geometric vector style, dark navy, teal and gold, no text, seamless loop |
| `title.mp4` | Slow descent into a glowing business-tower dungeon sinking into the earth, floors lit like circuit boards igniting one by one, tiny founder silhouette at the entrance; flat geometric vector style, dark navy, teal and gold, no text, seamless loop |

Drop the exported MP4s into `generated/lore/video/` and reload - the intro
picks them up automatically (and upgrades a scene mid-play once its clip
finishes loading). Disclosure: clips are AI-generated with Google Veo 3.

## Redistributable alternatives (if you want art committed to the repo)

To ship art *inside* a public MIT fork, use assets whose license permits
redistribution. Best options, in order of cleanliness for an MIT repo:

- **CC0 (public domain)** - cleanest. No attribution or share-alike. e.g.
  Kenney (<https://kenney.nl/assets>) and the OpenGameArt CC0 collection
  (<https://opengameart.org/content/cc0-resources>). Safe to commit and relicense.
- **Liberated Pixel Cup (LPC)** - top-down 32x32 RPG sprites/tilesets, but
  CC-BY-SA 3.0 / GPL 3.0. Redistributable **with attribution**, and the
  share-alike means the art keeps its own license (dual-license: code MIT, art
  CC-BY-SA + credits). <https://lpc.opengameart.org>

If art is committed, add a `CREDITS` entry naming each pack, author, license, and
source URL next to the files.
