"""HTTP smoke test for the local OpenAI-compatible runtime path.

Starts a tiny local `/v1/chat/completions` server, points model_config at it,
and verifies `create_chat_completion` reaches the local model. This proves the
normal gameplay route can use a local agent without Azure.

Run from the repo root:
    .venv/bin/python submission/tools/local_runtime_http_smoke_test.py
"""
from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class LocalModelHandler(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *_args):
        return

    def do_POST(self):  # noqa: N802 - stdlib handler API
        if self.path != "/v1/chat/completions":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("content-length", "0") or 0)
        payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        self.__class__.calls.append(payload)
        content = json.dumps({
            "ok": True,
            "provider": "local-http",
            "model": payload.get("model"),
        })
        body = json.dumps({
            "id": "local-smoke",
            "object": "chat.completion",
            "created": 0,
            "model": payload.get("model"),
            "choices": [{
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": content},
            }],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), LocalModelHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]

    os.environ["DEMO_MODE"] = "local"
    os.environ["AGENT_ROUTING"] = "local_first"
    os.environ["LOCAL_AGENT_BASE_URL"] = f"http://127.0.0.1:{port}/v1"
    os.environ["LOCAL_AGENT_MODEL"] = "local-http-model"
    os.environ["LOCAL_AGENT_API_KEY"] = "local"
    os.environ["LOCAL_AGENT_ENABLED"] = "true"
    os.environ["NARRATOR_MODEL"] = "cloud-narrator-should-not-be-called"

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from agents.model_config import create_chat_completion, model_for, runtime_mode

    assert runtime_mode() == "local"
    response = create_chat_completion(
        model_for("narrator"),
        [{"role": "user", "content": "Return JSON."}],
        response_format={"type": "json_object"},
    )
    parsed = json.loads(response.choices[0].message.content)
    assert parsed["provider"] == "local-http", parsed
    assert parsed["model"] == "local-http-model", parsed
    assert len(LocalModelHandler.calls) == 1
    print("ok - local HTTP runtime used local-http-model")
    server.shutdown()


if __name__ == "__main__":
    main()
