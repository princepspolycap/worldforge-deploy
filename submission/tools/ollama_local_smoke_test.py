"""Optional smoke test for Ollama as the local agent runtime.

This test is intentionally optional: it exits with code 0 when Ollama is not
running, so CI and fresh clones do not fail. When Ollama is available, it routes
through the same `agents.model_config.create_chat_completion` path used by the
game and verifies that the local model returns JSON.

Run:
    .venv/bin/python submission/tools/ollama_local_smoke_test.py

Override the model:
    LOCAL_AGENT_MODEL=llama3.2:3b .venv/bin/python submission/tools/ollama_local_smoke_test.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def _ollama_running(base: str) -> bool:
    tags_url = base.replace("/v1", "").rstrip("/") + "/api/tags"
    try:
        with urllib.request.urlopen(tags_url, timeout=2) as resp:
            return resp.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def main():
    base_url = os.getenv("LOCAL_AGENT_BASE_URL", "http://localhost:11434/v1").rstrip("/")
    model = os.getenv("LOCAL_AGENT_MODEL", "").strip()

    if not _ollama_running(base_url):
        print("skip - Ollama is not running at http://localhost:11434")
        return
    if not model:
        print("skip - set LOCAL_AGENT_MODEL to a model from `ollama list`")
        return

    os.environ["DEMO_MODE"] = "local"
    os.environ["AGENT_ROUTING"] = "local_first"
    os.environ["LOCAL_AGENT_ENABLED"] = "true"
    os.environ["LOCAL_AGENT_BASE_URL"] = base_url
    os.environ["LOCAL_AGENT_API_KEY"] = os.getenv("LOCAL_AGENT_API_KEY", "ollama")
    os.environ["LOCAL_AGENT_MODEL"] = model

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from agents.model_config import create_chat_completion, model_for, runtime_mode

    assert runtime_mode() == "local", runtime_mode()
    response = create_chat_completion(
        model_for("npc") or model_for("narrator"),
        [
            {"role": "system", "content": "Return only compact JSON."},
            {"role": "user", "content": "Return {\"status\":\"ok\",\"provider\":\"ollama\"}."},
        ],
        max_completion_tokens=120,
        response_format={"type": "json_object"},
        temperature=0,
    )
    content = response.choices[0].message.content or ""
    parsed = json.loads(content)
    assert parsed.get("status") == "ok", parsed
    print(f"ok - Ollama local runtime responded with {model}")


if __name__ == "__main__":
    main()
