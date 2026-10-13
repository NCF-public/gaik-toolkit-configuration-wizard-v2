"""Unit tests for the wizard agent bridge (#29) — pure helpers only.

These do not require the Claude Agent SDK, the `claude` CLI, Foundry creds, or
Postgres. They lock the SSE contract shape (so the Next.js proxy + UI keep
working) and the config guards. The live agent turn is validated against the
proven demo router.
"""

import asyncio
import json

import pytest
from wizard_api.services import agent_service


def test_sse_frames_match_ui_contract():
    assert agent_service.sse({"delta": "hi"}) == 'data: {"delta": "hi"}\n\n'
    # Every frame the UI proxy/client understands round-trips as `data: {json}`.
    for payload in ({"delta": "x"}, {"heartbeat": True}, {"done": True}, {"error": True}):
        frame = agent_service.sse(payload)
        assert frame.startswith("data: ") and frame.endswith("\n\n")
        assert json.loads(frame[len("data: ") :].strip()) == payload


class _FakeStreamEvent:
    def __init__(self, event):
        self.event = event


def test_extract_stream_text_pulls_visible_text_delta():
    ev = _FakeStreamEvent(
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}}
    )
    assert agent_service._extract_stream_text(ev) == "Hello"


def test_extract_stream_text_ignores_thinking_and_non_deltas():
    thinking = _FakeStreamEvent(
        {"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "hmm"}}
    )
    assert agent_service._extract_stream_text(thinking) == ""
    assert agent_service._extract_stream_text(_FakeStreamEvent({"type": "message_start"})) == ""
    assert agent_service._extract_stream_text(object()) == ""


def test_agent_env_never_requires_foundry(monkeypatch):
    # Ambient path: with no Foundry vars the env is still returned (defaults set)
    # so the agent runs on the ambient `claude` CLI auth instead of Foundry.
    for k in agent_service.REQUIRED_FOUNDRY_VARS:
        monkeypatch.delenv(k, raising=False)
    assert agent_service._foundry_configured() is False
    env = agent_service._agent_env()
    assert env["API_TIMEOUT_MS"] == "600000"
    assert env["DISABLE_TELEMETRY"] == "1"


def test_foundry_configured_and_env_passthrough_when_present(monkeypatch):
    for k in agent_service.REQUIRED_FOUNDRY_VARS:
        monkeypatch.setenv(k, "x")
    assert agent_service._foundry_configured() is True
    env = agent_service._agent_env()
    for k in agent_service.REQUIRED_FOUNDRY_VARS:
        assert env[k] == "x"


def test_resolve_wizard_dir_finds_solution_wizard():
    d = agent_service.resolve_wizard_dir()
    assert d is not None and (d / "SKILL.md").is_file()


def test_chat_raises_when_sdk_unavailable(monkeypatch):
    monkeypatch.setattr(agent_service, "_SDK_AVAILABLE", False)
    agent_service.AGENT_SESSIONS.clear()
    with pytest.raises(agent_service.AgentNotConfiguredError):
        asyncio.run(agent_service.get_or_create_session("sid", "/tmp/wizard-x"))
