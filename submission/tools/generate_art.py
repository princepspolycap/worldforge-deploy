"""Generate committed game art with the configured Foundry MAI image deployment.

Produces the worker-role portraits (and optional key art) the story view shows,
in the house style, saving PNGs under submission/ui/assets/generated/. Outputs
are AI-generated on a Microsoft Foundry MAI deployment and ship under MIT with
a disclosure note (see the generated CREDITS.md).

Usage (requires IMAGE_ENDPOINT / IMAGE_DEPLOYMENT / IMAGE_API_KEY in
submission/.env):
    python submission/tools/generate_art.py            # all missing portraits
    python submission/tools/generate_art.py --force    # regenerate everything
    python submission/tools/generate_art.py --only strategist,designer

Offline-safe: with no image deployment configured it prints what it *would*
generate and exits 0, so CI and fresh forks never fail. The game's procedural
geometric look remains the zero-config baseline; these portraits are a
progressive enhancement (the UI hides any portrait that is missing).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

_ENV = Path(__file__).resolve().parent.parent / ".env"
if _ENV.exists():
    load_dotenv(_ENV)

IMAGE_ENDPOINT = os.getenv("IMAGE_ENDPOINT", "").strip().rstrip("/")
IMAGE_DEPLOYMENT = os.getenv("IMAGE_DEPLOYMENT", "MAI-Image-2e").strip()
IMAGE_API_KEY = os.getenv("IMAGE_API_KEY", "").strip()

OUT_DIR = Path(__file__).resolve().parent.parent / "ui" / "assets" / "generated"

# House style shared by every asset so the cast feels like one game.
STYLE = (
    "minimal flat geometric portrait, dark navy background filling the entire "
    "canvas edge to edge, teal and gold accents, clean vector style game "
    "avatar, centered bust, no text, no border, no frame, no letterboxing, "
    "no white bars"
)

# role -> portrait prompt. Matches VOICE_BY_ROLE / ROLE_NAME in ui/game/story.js.
PORTRAITS = {
    "narrator": "wise hooded guide with a subtle glowing compass motif",
    "orgdesigner": "measured architect figure with org-chart constellation motif",
    "strategist": "thoughtful analyst figure with chess-knight and target motif",
    "designer": "bright creative figure with drafting tools and bezier-curve motif",
    "marketer": "energetic herald figure with megaphone and growth-arrow motif",
    "ops": "steady engineer figure with gear and shield motif",
}

CREDITS_NOTE = """# Generated art credits

All images in this folder are AI-generated on a Microsoft Foundry deployment
of **{model}** by the repo maintainers, using the prompts in
[tools/generate_art.py](../../../tools/generate_art.py). They are original
outputs (no third-party art inputs) and ship under this repo's MIT license.

Disclosure: AI-generated content. Model: {model}.
"""

# Wide cinematic key art for the intro lore cards (16:9-ish; w*h <= 1,048,576).
# One scene per lore beat, same house palette so the sequence reads as one film.
# Wide cinematic key art for the intro lore cards (16:9-ish; w*h <= 1,048,576).
# One scene per lore beat. Style cues distilled from the maintainer's original
# Poly186 vision boards (terraformed-Sahara concept art): cinematic painterly
# realism, ground-level or aerial vistas, golden-hour or moonlit light, vast
# scale - unified with the game's navy/teal/gold palette so UI chrome still fits.
KEYART_STYLE = (
    "epic cinematic concept art, painterly photorealism, vast establishing "
    "shot, volumetric golden-hour light against deep navy-blue night shadows, "
    "teal and gold accent lighting, atmospheric haze, breathtaking scale, "
    "no text, no border, no frame, full bleed edge to edge"
)
KEYART = {
    "title": "a colossal business-tower dungeon descending into the earth beneath a desert city at dusk, its underground floors glowing like circuit boards through the cutaway, a tiny founder silhouette at the gate above",
    "premise": "split vista at twilight: a small warmly lit boardroom of human silhouettes on a mesa top, and beneath it a vast luminous lattice of agent lights working through the rock like a living circuit cavern",
    "sahara": "ground-level view of a terraformed Sahara at sunrise, dew on new grasslands spreading through golden dunes, water channels catching first light, pyramids on the horizon watching over green growth and a distant gleaming city",
    "needs": "aerial view of an automated oasis settlement at golden hour: geodesic greenhouses, solar microgrids, water channels and modular homes threaded together by glowing logistics lines across reclaimed green desert",
    "workforce": "a lone founder at a desk on an open dune at night, a constellation of glowing digital worker avatars fanned out across the starry sky above, each tethered to the desk by a thread of golden light",
    "flywheel": "a great luminous wheel turning over a moonlit green valley, many small human figures and AI nodes around its rim exchanging light evenly, energy flowing in a fair circular loop down into villages below",
    "foundry": "a vast glowing foundry core like a reactor of reasoning rising from desert rock at night, orbited by small agent lights, monumental geometric machinery breathing teal and gold fire",
    "gate": "a single human hand pressing a glowing approval seal onto a monumental stone gate at dawn, agent silhouettes waiting respectfully behind with artifacts of light, long shadows across the sand",
}


def _request_image(prompt: str, width: int = 1024, height: int = 1024) -> bytes:
    """Call the MAI images/generations API and return PNG bytes."""
    url = f"{IMAGE_ENDPOINT}/mai/v1/images/generations"
    body = json.dumps({
        "model": IMAGE_DEPLOYMENT,
        "prompt": prompt,
        "width": width,
        "height": height,
    }).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"api-key": IMAGE_API_KEY, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        ctype = (resp.headers.get("Content-Type") or "").lower()
        raw = resp.read()
    if "image/" in ctype:
        return raw  # API returned raw PNG bytes
    payload = json.loads(raw.decode("utf-8"))
    data = (payload.get("data") or [{}])[0]
    b64 = data.get("b64_json") or data.get("b64") or ""
    if b64:
        return base64.b64decode(b64)
    img_url = data.get("url") or ""
    if img_url:
        with urllib.request.urlopen(img_url, timeout=60) as r2:  # nosec B310 - API-provided asset URL
            return r2.read()
    raise ValueError(f"No image in response (keys: {list(payload.keys())})")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate worker portraits via Foundry MAI.")
    parser.add_argument("--force", action="store_true", help="regenerate even if the file exists")
    parser.add_argument("--only", default="", help="comma-separated roles/scenes to generate")
    parser.add_argument("--keyart", action="store_true",
                        help="generate the wide lore key-art scenes instead of portraits")
    args = parser.parse_args()

    catalog = KEYART if args.keyart else PORTRAITS
    out_sub = OUT_DIR / "lore" if args.keyart else OUT_DIR
    roles = [r.strip() for r in args.only.split(",") if r.strip()] or list(catalog)
    unknown = [r for r in roles if r not in catalog]
    if unknown:
        print(f"Unknown entries: {unknown}. Valid: {list(catalog)}")
        return 1

    if not (IMAGE_ENDPOINT and IMAGE_API_KEY and IMAGE_DEPLOYMENT):
        print("Image deployment not configured (IMAGE_ENDPOINT / IMAGE_DEPLOYMENT / "
              "IMAGE_API_KEY). Would generate:")
        for role in roles:
            print(f"  - {role}.png")
        print("The game keeps its procedural look without these. Exiting 0.")
        return 0

    out_sub.mkdir(parents=True, exist_ok=True)
    failures = 0
    for role in roles:
        out = out_sub / f"{role}.png"
        if out.exists() and not args.force:
            print(f"skip {out.name} (exists; use --force to regenerate)")
            continue
        if args.keyart:
            prompt = f"{KEYART_STYLE}, {catalog[role]}"
            width, height = 1344, 768  # wide cinematic, w*h within API limit
        else:
            prompt = f"{STYLE}, {catalog[role]}"
            width, height = 1024, 1024
        print(f"generating {out.name} on {IMAGE_DEPLOYMENT} ...")
        png = None
        for attempt in range(4):
            try:
                png = _request_image(prompt, width=width, height=height)
                break
            except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as exc:
                is_429 = isinstance(exc, urllib.error.HTTPError) and exc.code == 429
                if is_429 and attempt < 3:
                    wait = 30 * (attempt + 1)
                    print(f"  rate limited; retrying in {wait}s ...")
                    time.sleep(wait)
                    continue
                print(f"  FAILED {role}: {exc}")
                failures += 1
                break
        if png is None:
            continue
        out.write_bytes(png)
        print(f"  wrote {out} ({len(png) // 1024} KB)")

    (OUT_DIR / "CREDITS.md").write_text(CREDITS_NOTE.format(model=IMAGE_DEPLOYMENT))
    print(f"done. failures: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
