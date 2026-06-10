# UI Assets

This folder is reserved for game art that is safe to ship with the public,
MIT-licensed submission. The committed baseline is **geometric-first**: the live
`/story` view draws everything procedurally (Phaser shapes), so the public repo
ships with **no third-party art** and is fully MIT-clean.

## Third-party sprite packs (Limezu) - use rules

The optional `/sprites` view can load the **Limezu "Modern Interiors"** and
**"Modern Office"** packs for a richer local demo. These are **paid, licensed**
assets - not ours, and not MIT. The license terms below were verified against the
`LICENSE.txt` shipped inside each pack and the live itch.io product pages
(<https://limezu.itch.io/moderninteriors>, <https://limezu.itch.io/modernoffice>):

```
YOU CAN:
- Edit and use the asset in any commercial or non-commercial project
- Use the asset in any commercial or non-commercial project
YOU CAN'T:
- Resell or distribute the asset to others
- Edit and resell the asset to others
- Credits required (limezu.itch.io)
```

What that means for this repo:

- **Using** the packs in a local live demo is allowed (commercial use is
  explicitly permitted) **as long as we credit `limezu.itch.io`**.
- **Committing/redistributing** the raw PNGs in this public repo is **not
  allowed** - publishing the files so others can download them is exactly the
  "distribute the asset to others" the license forbids.
- Therefore the PNGs stay **gitignored** under `submission/ui/assets/local/`
  (never committed). After `git clone`, the procedural fallback takes over and
  the game still runs. If you present `/sprites` live, show a visible
  "Art: Limezu (limezu.itch.io)" credit.

> Note: a few itch.io comments loosely call this "CC-BY". The binding text is the
> shipped `LICENSE.txt` / product-page license above, which explicitly prohibits
> redistribution. Treat it as: use yes, redistribute no.

## Foundry-generated art (MAI-Image-2e) - the committed-art path

The repo's own way to ship real game art is to **generate it on Microsoft
Foundry** with **MAI-Image-2e** (Microsoft's efficient MAI image model - the
highest RPM quota of the MAI family; quality is good-not-best, the right trade
for game art at scale). Generated outputs are ours and **can be committed under
MIT**, so forkers get both the art and the generator.

- Config: `IMAGE_ENDPOINT`, `IMAGE_DEPLOYMENT`, `IMAGE_API_KEY` in
  `submission/.env` (see [.env.example](../../.env.example) for the deploy
  command and supported regions).
- API: `POST {IMAGE_ENDPOINT}/mai/v1/images/generations` with
  `{"model": "MAI-Image-2e", "prompt": ..., "width": 1024, "height": 1024}`
  and an `api-key` header. Output is always PNG (min 768px per side,
  width x height <= 1,048,576).
- House style prompt prefix: "minimal flat geometric portrait, dark navy
  background, teal and gold accents, clean vector style game avatar".
- Commit generated art under `submission/ui/assets/generated/` with a note that
  it is AI-generated (responsible-AI disclosure) and which model produced it.

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
