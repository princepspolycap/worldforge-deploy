"""Offline smoke tests for local-first agent routing.

This test does not call Azure or a local model server. It monkeypatches the
shared routing module with fake OpenAI-compatible clients so we can verify the
candidate order and fallback behavior deterministically.

Run from the repo root:
    python3 submission/tools/model_routing_smoke_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from typing import List

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents import model_config as mc  # noqa: E402


class FakeCompletions:
    def __init__(self, provider: str, calls: List[str], fail: bool = False):
        self.provider = provider
        self.calls = calls
        self.fail = fail

    def create(self, **kwargs):
        model = kwargs.get("model") or ""
        self.calls.append(f"{self.provider}:{model}")
        if self.fail:
            raise RuntimeError(f"{self.provider} failed")
        message = SimpleNamespace(content=f'{{"provider":"{self.provider}","model":"{model}"}}')
        choice = SimpleNamespace(message=message)
        usage = SimpleNamespace(prompt_tokens=1, completion_tokens=1, completion_tokens_details=None)
        return SimpleNamespace(choices=[choice], usage=usage)


class FakeClient:
    def __init__(self, provider: str, calls: List[str], fail: bool = False):
        self.provider = provider
        self.api_key = f"{provider}-key"
        self.base_url = f"http://{provider}.example/v1"
        self.chat = SimpleNamespace(completions=FakeCompletions(provider, calls, fail=fail))


def configure(*, mode: str = "live", routing: str = "local_first",
              local: bool = True, cloud: bool = True,
              local_fails: bool = False, cloud_fails: bool = False) -> List[str]:
    calls: List[str] = []
    mc.DEMO_MODE = mode
    mc.AGENT_ROUTING = routing
    mc.LOCAL_AGENT_ENABLED = local
    mc.LOCAL_AGENT_BASE_URL = "http://local.example/v1" if local else ""
    mc.LOCAL_AGENT_MODEL = "local-default" if local else ""
    mc.FOUNDRY_BASE_URL = "http://cloud.example/v1" if cloud else ""
    mc.FOUNDRY_API_KEY = "cloud-key" if cloud else ""
    mc.FOUNDRY_FALLBACK_MODEL = "cloud-fallback" if cloud else ""
    mc._LOCAL_AGENT_MODELS = {
        role: mc.AgentModel(role, f"local-{role}") for role in ["narrator", "strategist", "designer", "marketer", "ops", "npc"]
    }
    mc._CLOUD_AGENT_MODELS = {
        role: mc.AgentModel(role, f"cloud-{role}") for role in ["narrator", "strategist", "designer", "marketer", "ops", "npc"]
    }
    mc._local_client = FakeClient("local", calls, fail=local_fails) if local else None
    mc._cloud_client = FakeClient("cloud", calls, fail=cloud_fails) if cloud else None
    return calls


def call_narrator():
    return mc.create_chat_completion(
        mc.model_for("narrator"),
        [{"role": "user", "content": "Return JSON."}],
        response_format={"type": "json_object"},
    )


def test_local_first_prefers_local():
    calls = configure()
    response = call_narrator()
    assert response.choices[0].message.content == '{"provider":"local","model":"local-narrator"}'
    assert calls == ["local:local-narrator"], calls


def test_local_failure_falls_back_to_cloud_then_stops():
    calls = configure(local_fails=True)
    response = call_narrator()
    assert response.choices[0].message.content == '{"provider":"cloud","model":"cloud-narrator"}'
    assert calls == ["local:local-narrator", "local:local-narrator", "cloud:cloud-narrator"], calls


def test_cloud_first_prefers_cloud():
    calls = configure(routing="cloud_first")
    response = call_narrator()
    assert response.choices[0].message.content == '{"provider":"cloud","model":"cloud-narrator"}'
    assert calls == ["cloud:cloud-narrator"], calls


def test_local_only_never_calls_cloud():
    calls = configure(routing="local_only")
    response = call_narrator()
    assert response.choices[0].message.content == '{"provider":"local","model":"local-narrator"}'
    assert calls == ["local:local-narrator"], calls


def test_simulation_has_no_runtime():
    configure(mode="simulation", local=False, cloud=False)
    assert mc.runtime_mode() == "simulation"
    try:
        call_narrator()
    except RuntimeError as exc:
        assert "No local or cloud agent runtime configured" in str(exc)
    else:
        raise AssertionError("Expected create_chat_completion to fail without a runtime")


def main():
    tests = [
        test_local_first_prefers_local,
        test_local_failure_falls_back_to_cloud_then_stops,
        test_cloud_first_prefers_cloud,
        test_local_only_never_calls_cloud,
        test_simulation_has_no_runtime,
    ]
    for test in tests:
        test()
        print(f"ok - {test.__name__}")


if __name__ == "__main__":
    main()
