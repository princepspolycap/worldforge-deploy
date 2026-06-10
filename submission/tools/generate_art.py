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
    parser.add_argument("--only", default="", help="comma-separated roles to generate")
    args = parser.parse_args()

    roles = [r.strip() for r in args.only.split(",") if r.strip()] or list(PORTRAITS)
    unknown = [r for r in roles if r not in PORTRAITS]
    if unknown:
        print(f"Unknown roles: {unknown}. Valid: {list(PORTRAITS)}")
        return 1

    if not (IMAGE_ENDPOINT and IMAGE_API_KEY and IMAGE_DEPLOYMENT):
        print("Image deployment not configured (IMAGE_ENDPOINT / IMAGE_DEPLOYMENT / "
              "IMAGE_API_KEY). Would generate:")
        for role in roles:
            print(f"  - {role}.png  <- '{STYLE}, {PORTRAITS[role]}'")
        print("The game keeps its procedural look without these. Exiting 0.")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failures = 0
    for role in roles:
        out = OUT_DIR / f"{role}.png"
        if out.exists() and not args.force:
            print(f"skip {out.name} (exists; use --force to regenerate)")
            continue
        prompt = f"{STYLE}, {PORTRAITS[role]}"
        print(f"generating {out.name} on {IMAGE_DEPLOYMENT} ...")
        try:
            png = _request_image(prompt)
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as exc:
            print(f"  FAILED {role}: {exc}")
            failures += 1
            continue
        out.write_bytes(png)
        print(f"  wrote {out} ({len(png) // 1024} KB)")

    (OUT_DIR / "CREDITS.md").write_text(CREDITS_NOTE.format(model=IMAGE_DEPLOYMENT))
    print(f"done. failures: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
