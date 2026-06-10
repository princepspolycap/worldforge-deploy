# Pixel-Art Party: Sprites, Progressive Enhancement, and Why Your Reasoning Agents Deserve a Body

> Series: Building "Your Company Is the Dungeon" for Microsoft Agents League - Battle #2
> Post: 03 - Asset & UI layer
> Audience: developers wiring real reasoning agents into a playable surface
> Companion code: [`submission/ui/game.js`](../ui/game.js) - [`submission/ui/assets/README.md`](../ui/assets/README.md)

When we set out to ship a reasoning-agent demo as a *side-scrolling RPG*, the temptation was to spend three weekends on art. We did the opposite: we shipped the agents first with cheap procedural shapes, then layered real pixel-art sprites on top as a **progressive enhancement** that lights up only when the assets are present on disk. This post explains why, how the loader works, and how to plug in your own character pack.

The thesis is small but load-bearing:

> The reasoning is the product. The sprites are the avatar layer. The demo has to be playable for a stranger who runs `git clone` - even with zero art assets present.

## 1. Why progressive enhancement (and not "just commit the PNGs")

We reuse the Limezu **Modern Interiors Revamped** character pack - the same atlas we use in our own local game work. It is beautiful work, but the license is unambiguous: *no redistribution of the source files, even in a fork*. That single constraint forced a design we now think every agent-demo repo should adopt:

1. **The public repo ships only MIT-safe art.** In our case, that means procedural shapes drawn with `Phaser.GameObjects.Graphics`: a head, a body, a name label, an "ACTIVE" badge. They are ugly. They work.
2. **The pixel-art layer is opt-in.** If - and only if - four specific PNGs exist under `submission/ui/assets/local/characters/`, the game loads them as spritesheets and replaces the procedural shapes at runtime.
3. **`local/` is `.gitignored`** ([`submission/ui/assets/.gitignore`](../ui/assets/.gitignore)). Nothing protected ever lands in `git status`.

That gives us three properties at once:

- A stranger can `git clone` the repo and immediately play the game (procedural mode).
- A maintainer who owns the asset license sees the pretty version locally.
- The rubric criterion *Reliability & Safety* gets a free win, because the asset layer can never break the agent layer.

If you maintain a demo with paid or restrictively-licensed assets, copy this pattern. The procedural fallback is ~30 lines of `Phaser.Graphics`. The license clarity is priceless.

## 2. The four-line contract

The sprite layer's entire interface with the rest of the game is one constant:

```js
// submission/ui/game.js
const SPRITE_KEYS = {
    player:     'player_sheet',
    strategist: 'npc_strategist',
    designer:   'npc_designer',
    marketer:   'npc_marketer',
};
```

Four texture keys, four file names. If a maintainer drops in their own pack with the right filenames, the game uses it. If not, the game falls back. No build step, no manifest, no config flag - just files on disk.

The file contract for a custom pack is exactly:

```
submission/ui/assets/local/characters/
|-- player.png       # the user's avatar
|-- strategist.png   # Soren
|-- designer.png     # Dahlia
`-- marketer.png     # Maddox
```

Each PNG must be a Limezu-style **32x64 character spritesheet** - 32 pixels wide per frame, 64 pixels tall per frame, with the front-facing idle pose at frame index 0. That's it. The rest of the atlas (walks, sits, swims, ...) is ignored for now; we keep the demo readable with a calm idle hold rather than a busy walk cycle.

> If you want to credit Limezu the way we do, look at the credits section near the bottom of [`submission/ui/assets/README.md`](../ui/assets/README.md). Their work funds itself on itch.io - buy them a coffee.

## 3. The graceful-fallback loader

The whole opt-in story lives in two functions inside `submission/ui/game.js`:

```js
function phaserPreload() {
    const base = '/game/assets/local/characters/';
    const sheets = [
        [SPRITE_KEYS.player,     'player.png'],
        [SPRITE_KEYS.strategist, 'strategist.png'],
        [SPRITE_KEYS.designer,   'designer.png'],
        [SPRITE_KEYS.marketer,   'marketer.png'],
    ];
    sheets.forEach(([key, file]) => {
        this.load.spritesheet(key, base + file, { frameWidth: 32, frameHeight: 64 });
    });
    // Swallow missing-file errors - procedural fallback handles them.
    this.load.on('loaderror', (file) => {
        console.info(`[sprites] '${file.key}' not present - using procedural fallback.`);
    });
}
```

Two design choices worth noticing:

- **`loaderror` is logged, not thrown.** Phaser's default behavior on a missing asset is loud. We silence it because a missing PNG is an *expected* state, not a bug. This is the difference between "the game is broken" and "the game is in fallback mode."
- **No conditional `if (assetsExist)` block in the loader.** We always *attempt* the load. The texture either ends up in `scene.textures` or it doesn't. Downstream code asks the texture system the truth instead of duplicating it.

The downstream check is one branch deep:

```js
function createProceduralNPC(scene, x, y, name, colorVal, spriteKey) {
    const container = scene.add.container(x, y);

    if (spriteKey && scene.textures.exists(spriteKey)) {
        // Pixel-art branch.
        const sprite = scene.add.sprite(0, 0, spriteKey, 0).setScale(1.5);
        const animKey = ensureIdleAnim(scene, spriteKey);
        if (animKey) sprite.play(animKey);
        // ... label, return container
    }

    // Procedural fallback: a circle, a rectangle, a name. Always runs if no sprite.
}
```

`scene.textures.exists(...)` is the single source of truth. Add a new agent? Add a key to `SPRITE_KEYS` and a row in `sheets`. The rest of the code does not need to know whether you ship art or not.

## 4. The atlas trap (and how we walked into it)

We almost shipped this with the characters cut in half. The Limezu Modern Interiors Revamped atlas is **1792 x 1312** and *looks* like a 32x32 grid (56 columns x 41 rows = 2297 cells). It is - for **tilemap furniture**. For **characters**, each sprite occupies **two stacked cells**: 32 wide x 64 tall.

We first loaded the file with `frameHeight: 32`, and our characters rendered as floating skirts:

![characters with only legs visible](./_images/sprites_only_legs.png)

(That image isn't in the repo - it lives in our laughter folder.)

The fix was one line:

```diff
- { frameWidth: 32, frameHeight: 32 }
+ { frameWidth: 32, frameHeight: 64 }
```

The lesson is not "read the manual." The lesson is **how we diagnosed it**: a five-line Python `PIL` crop to render the top-left 32x64 region of the source PNG at 8x scale, side-by-side with the 32x32 crop. The 32x32 crop was a row of hair tops. The 32x64 crop was a row of full characters. Done.

When you're wiring a third-party spritesheet, do not trust the grid line in the asset preview. Crop the actual bytes and look at them. PIL is two import lines and 30 seconds.

```python
from PIL import Image
im = Image.open('player.png')
im.crop((0, 0, 32, 64)).resize((256, 512), Image.NEAREST).save('/tmp/preview.png')
```

If the character looks complete, your frame height is right. If it doesn't, double it.

## 5. The idle animation is on purpose boring

The premade atlas is generous: 56 columns wide of poses per character - walk, run, sit, sleep, push, swim, point. For the calm, lit-room shots in the demo we hold a single idle frame per direction. But the four-direction walk cycle is wired and ready to play the moment a character moves.

The atlas mapping we use, for any future maintainer:

| Anim | Frames | Notes |
| --- | --- | --- |
| `idle_left`  | 0  | Row 0 col 0 |
| `idle_up`    | 1  | Row 0 col 1 |
| `idle_right` | 2  | Row 0 col 2 |
| `idle_down`  | 3  | Row 0 col 3 |
| `walk_left`  | 56-61 | Row 1, first 6 cols |
| `walk_up`    | 62-67 | Row 1, cols 6-11 |
| `walk_right` | 68-73 | Row 1, cols 12-17 |
| `walk_down`  | 74-79 | Row 1, cols 18-23 |

`ensureCharacterAnims(scene, key)` registers all eight as `${key}_idle_${dir}` / `${key}_walk_${dir}` on the scene. Each container then exposes a single `face(dir, moving = false)` helper, and the rest of the code never has to think about frame indices again.

In `phaserUpdate` the player picks a direction from its dominant input axis:

```js
const dir = dx !== 0
    ? (dx < 0 ? 'left' : 'right')
    : (dy < 0 ? 'up' : 'down');
player.face(dir, moving);
```

...and the autoplay tween does the same trick from `dx`/`dy` of the target - so the demo-mode loop walks every direction it goes. When the procedural fallback is active, `face()` is a no-op and the old scale-bounce + tilt feedback takes over instead. Two render modes, one movement contract.

## 6. Where this fits in the rubric

| Criterion | How the sprite layer scores |
| --- | --- |
| Accuracy & Relevance | Avatars match the canonical Game Master pattern (player + specialist NPCs). |
| Reasoning & Multi-step | Sprites are positional state - proximity to an NPC unlocks the active agent's turn. The sprite layer encodes the handoff. |
| **Reliability & Safety** | **The big one.** Asset layer cannot break the agent layer. Public repo always runs. License cannot be violated by a clone. |
| Creativity & Originality | The "your company is the dungeon" framing only lands if there's a body in the room. The sprites are the joke. |
| UX & Presentation | Pixel-art coherence + readable name labels + an `ACTIVE` badge per room = a side-scroller you can read in 5 seconds. |

The wins compound. Every minute we did *not* spend fighting the asset license was a minute spent on the reasoning panel, the autoplay loop, and the verification gate - all of which score on more lanes than the sprites do.

## 7. Try it yourself

If you cloned this repo:

```bash
# 1. Start the server.
./.venv/bin/python -m uvicorn submission.tools.server:app --reload

# 2. Visit http://127.0.0.1:8000/ - you'll see the procedural mode.
# 3. (Optional) Drop four 32x64 character PNGs into:
#      submission/ui/assets/local/characters/
#        player.png  strategist.png  designer.png  marketer.png
# 4. Refresh. Sprites take over automatically.
```

If you own a Limezu pack, the path from "pack on disk" to "pack in game" is one `cp` per character. If you ship your own art, the only contract is the file names and the 32x64 frame size.

That's the whole pattern: **make the protected layer optional, make the public layer correct, and let the texture system tell you which mode you're in.**

The agents do the work. The sprites just show up to it.

---

*Next post: how we wired the autoplay loop so the game can play itself for a 90-second demo, complete with streak bonuses and a Gold-tier finish.*
