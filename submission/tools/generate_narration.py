"""Bake the intro narration with the configured Azure TTS deployment.

Reads the voice-over script straight out of ui/game/intro.js (single source
of truth - edit the script there, re-run this) and synthesizes one curated
mp3 per lore scene with the shared cinematic delivery direction, saving them
under submission/ui/assets/generated/lore/narration/. The takes ship
committed under MIT with an AI-generation disclosure (see CREDITS.md), so a
fresh fork narrates with the directed voice and zero keys.

At runtime audio.js plays these takes first and only falls back to live TTS
(then the browser voice) when a file is missing - baking is an enhancement,
never a requirement.

Usage (requires TTS_ENDPOINT / TTS_DEPLOYMENTS or TTS_DEPLOYMENT / TTS_API_KEY in
submission/.env):
    python submission/tools/generate_narration.py            # missing takes
    python submission/tools/generate_narration.py --force    # re-bake all
    python submission/tools/generate_narration.py --only sahara,choice

Offline-safe: with no TTS deployment configured it prints what it *would*
bake and exits 0, so CI and fresh forks never fail.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

_ENV = Path(__file__).resolve().parent.parent / ".env"
if _ENV.exists():
    load_dotenv(_ENV)

TTS_ENDPOINT = os.getenv("TTS_ENDPOINT", "").strip().rstrip("/")
TTS_DEPLOYMENT = os.getenv("TTS_DEPLOYMENT", "gpt-4o-mini-tts").strip()
TTS_DEPLOYMENTS = [
    dep.strip()
    for dep in os.getenv("TTS_DEPLOYMENTS", "").split(",")
    if dep.strip()
]
if TTS_DEPLOYMENT and TTS_DEPLOYMENT not in TTS_DEPLOYMENTS:
    TTS_DEPLOYMENTS.append(TTS_DEPLOYMENT)
TTS_API_KEY = os.getenv("TTS_API_KEY", "").strip()
TTS_VOICE = os.getenv("TTS_VOICE", "onyx").strip()
TTS_API_VERSION = os.getenv("TTS_API_VERSION", "2025-03-01-preview").strip()

INTRO_JS = Path(__file__).resolve().parent.parent / "ui" / "game" / "intro.js"
OUT_DIR = (Path(__file__).resolve().parent.parent
           / "ui" / "assets" / "generated" / "lore" / "narration")


def read_script() -> tuple[str, dict[str, str]]:
    """Pull the narrator style and scene -> line map out of intro.js."""
    src = INTRO_JS.read_text(encoding="utf-8")

    m = re.search(r'NARRATOR_STYLE\s*=\s*"((?:[^"\\]|\\.)*)"', src)
    style = m.group(1) if m else (
        "Warm cinematic film narrator. Intimate, unhurried, grounded awe. "
        "Natural pauses, soft dynamics. Never monotone, never robotic.")

    lines: dict[str, str] = {}
    # Lore cards: a vo: line followed by its img: scene name.
    for vo, img in re.findall(
            r'vo:\s*"((?:[^"\\]|\\.)*)",\s*\n\s*img:\s*"([^"]+)\.png"', src):
        lines[img] = vo

    # The choice screen: an A.speak call bound to choice.mp3.
    m = re.search(
        r'A\.speak\("((?:[^"\\]|\\.)*)",\s*\{[^}]*?"choice\.mp3"', src)
    if m:
        lines["choice"] = m.group(1)

    return style, lines


def synthesize(text: str, instructions: str) -> bytes:
    last_error = ""
    for deployment in TTS_DEPLOYMENTS:
        url = (f"{TTS_ENDPOINT}/openai/deployments/{deployment}"
               f"/audio/speech?api-version={TTS_API_VERSION}")
        body = json.dumps({
            "model": deployment,
            "input": text,
            "voice": TTS_VOICE,
            "instructions": instructions,
        }).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"api-key": TTS_API_KEY, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            last_error = f"{deployment}: {exc}"
    raise RuntimeError(f"TTS upstream error: {last_error}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true",
                        help="re-bake takes that already exist")
    parser.add_argument("--only", default="",
                        help="comma-separated scene names (e.g. sahara,choice)")
    args = parser.parse_args()

    style, lines = read_script()
    if not lines:
        print("ERROR: could not parse any vo lines out of intro.js")
        return 1

    only = {s.strip() for s in args.only.split(",") if s.strip()}
    todo = {k: v for k, v in lines.items() if not only or k in only}

    configured = bool(TTS_ENDPOINT and TTS_API_KEY and TTS_DEPLOYMENTS)
    print(f"narration takes: {len(todo)} scene(s); voice={TTS_VOICE} "
          f"deployments={', '.join(TTS_DEPLOYMENTS) or '(none)'}")
    if not configured:
        print("No TTS deployment configured (TTS_ENDPOINT/TTS_API_KEY); "
              "would bake:")
        for name, text in todo.items():
            print(f"  - {name}.mp3  ({len(text)} chars)")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failures = 0
    for name, text in todo.items():
        out = OUT_DIR / f"{name}.mp3"
        if out.exists() and not args.force:
            print(f"  skip {out.name} (exists; --force to re-bake)")
            continue
        try:
            audio = synthesize(text, style)
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            print(f"  FAIL {out.name}: {exc}")
            failures += 1
            continue
        if len(audio) < 4096:  # an error blob, not audio
            print(f"  FAIL {out.name}: response too small ({len(audio)} bytes)")
            failures += 1
            continue
        out.write_bytes(audio)
        print(f"  baked {out.name} ({len(audio) // 1024} KB)")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
