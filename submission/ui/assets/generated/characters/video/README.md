# Cast idle clips (Veo image-to-video) - drop-in folder

Looping idle animations for the floating cast. Each clip is an optional,
local-only progressive enhancement over the committed PNG sprite in the parent
folder. The UI (`ui/game/story.js` -> `upgradeCastToClip`) probes for
`<role>.mp4` here and, if present, plays it muted + looping over the still; the
PNG stays the instant fallback, so a missing clip never breaks anything and a
fresh fork runs on stills alone.

## File names (one per cast role)

    narrator.mp4  orgdesigner.mp4  strategist.mp4  designer.mp4
    marketer.mp4  ops.mp4  founder.mp4

These `.mp4` files are gitignored (heavy, local-only), exactly like the lore
film. This README is tracked so the path stays visible.

## How to make them (Veo 3, image-to-video)

Input image = the matching sprite in the parent folder
(`assets/generated/characters/<role>.png`). Use this prompt for EVERY character,
swapping only the final `[CHARACTER]` line so the whole cast moves as one set:

    Animate this character as a seamless looping idle, keeping the EXACT same
    character, outfit, colors, and flat dark navy background from the input
    image.

    Motion: a calm, alive idle loop - gentle breathing, subtle weight shift from
    one foot to the other, slow natural blinking, cloak/fabric and braids
    swaying softly. The glowing gold sacred-geometry markings slowly pulse
    brighter and dimmer, and the teal energy accents shimmer faintly. Slight
    head movement as if quietly present and listening.

    Camera: locked, static, no zoom, no pan, no parallax. Character stays
    centered and full-body in frame at all times.

    Loop: the first and last frame must match so it loops perfectly and
    seamlessly.

    Style: same Afrofuturist flat vector game-art look as the input, cinematic
    rim lighting, soft ground shadow. Do NOT change the background - keep it the
    plain even dark navy field. No new props, no text, no scenery, no other
    characters, no camera motion.

    [CHARACTER]: <one line, per table below>

Per-character `[CHARACTER]` line:

| role        | line |
|-------------|------|
| founder     | a regal human founder cupping a small spark of gold light, hopeful upward gaze |
| narrator    | an elder griot-oracle Worldkeeper in a hooded robe holding a glowing compass and an ankh staff |
| orgdesigner | a master-builder Architect shaping a luminous org-chart constellation of light |
| strategist  | a focused tactician (Soren) in obsidian-and-gold attire with a chess-knight and target-reticle motif |
| designer    | a warm artisan (Dahlia) tracing a glowing bezier curve with a drafting stylus |
| marketer    | an energetic griot-herald (Maddox) mid-stride raising a megaphone with a growing arrow trail |
| ops         | a steady engineer-guardian Steward with a turning gear and shield emblem |

Tips: static camera, ~4-6s, enable a loop toggle if offered, tall/portrait
aspect to match the sprite. Export as MP4 (H.264) and drop it here as
`<role>.mp4`.
