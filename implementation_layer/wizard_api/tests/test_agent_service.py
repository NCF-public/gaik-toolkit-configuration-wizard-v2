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


# ---------------------------------------------------------------------------
# The panel is the only gate approval (#173)
# ---------------------------------------------------------------------------


def test_bootstrap_makes_the_panel_the_only_gate_approval(tmp_path):
    prompt = agent_service._bootstrap_prompt(tmp_path, "fi")

    assert "GATES ARE APPROVED IN THE PANEL, NOT IN THE CHAT" in prompt
    assert 'Do NOT ask\n  them to reply "yes"/"kyllä"' in prompt
    assert (
        "Continue to the next\n  phase only when the state line says that gate is approved"
        in prompt
    )


def test_the_state_line_names_the_step_and_every_gate():
    line = agent_service.gate_context_line(5, {"gate_1": "approved", "gate_2": "pending"})

    assert line == (
        "[Session state: step 5 of 13; gate_1 approved, gate_2 pending, "
        "gate_3 pending, gate_4 pending]"
    )
    assert agent_service.with_gate_context("kyllä", 5, {}).endswith("]\n\nkyllä")


# ---------------------------------------------------------------------------
# Only the final text of a turn is the reply (#168)
# ---------------------------------------------------------------------------

sdk = pytest.importorskip("claude_agent_sdk")


def _delta(text: str):
    return sdk.StreamEvent(
        uuid="u",
        session_id="s",
        event={"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}},
    )


def _assistant(*blocks):
    return sdk.AssistantMessage(content=list(blocks), model="m")


def _result():
    return sdk.ResultMessage(
        subtype="success",
        duration_ms=1,
        duration_api_ms=1,
        is_error=False,
        num_turns=1,
        session_id="s",
    )


class _ScriptedClient:
    """Yields one scripted turn per ``receive_response``; records nudges."""

    def __init__(self, *turns):
        self.turns = list(turns)
        self.queries: list[str] = []

    async def query(self, text):
        self.queries.append(text)

    async def receive_response(self):
        for message in self.turns.pop(0):
            yield message


def _frames(raw: list[str]) -> list[dict]:
    return [json.loads(f[len("data: ") :]) for f in raw]


def _run(client):
    session = {"client": client, "id": "t", "last_active": 0}
    parts: list[str] = []

    async def go():
        return [f async for f in agent_service._stream_turn(session, parts)]

    return parts, _frames(asyncio.run(go()))


def test_tool_use_narration_is_dropped_and_only_the_final_text_is_kept():
    client = _ScriptedClient(
        [
            _delta("Applying both corrections now."),
            _assistant(
                sdk.TextBlock(text="Applying both corrections now."),
                sdk.ToolUseBlock(id="t1", name="Edit", input={}),
            ),
            _delta("Now let me fix the summary:"),
            _assistant(
                sdk.TextBlock(text="Now let me fix the summary:"),
                sdk.ToolUseBlock(id="t2", name="Edit", input={}),
            ),
            _delta("Both files are "),
            _delta("updated."),
            _assistant(sdk.TextBlock(text="Both files are updated.")),
            _result(),
        ]
    )

    parts, frames = _run(client)

    assert parts == ["Both files are updated."]
    kinds = [next(iter(f)) for f in frames]
    # each narrating message is streamed, then taken back
    assert kinds == ["delta", "narration_end", "delta", "narration_end", "delta", "delta", "done"]
    assert client.queries == []


def test_a_background_task_notice_is_not_the_reply_and_the_agent_is_nudged():
    notice = "(Background task completed — waiting for your response on the field list above.)"
    client = _ScriptedClient(
        [_delta(notice), _assistant(sdk.TextBlock(text=notice)), _result()],
        [
            _delta("Thanks, the fields are set. Next I will generate the schema."),
            _assistant(
                sdk.TextBlock(text="Thanks, the fields are set. Next I will generate the schema.")
            ),
            _result(),
        ],
    )

    parts, frames = _run(client)

    assert client.queries == ["Please continue."]
    assert parts == ["Thanks, the fields are set. Next I will generate the schema."]
    assert {"narration_end": True} in frames  # the notice was taken back from the UI
    assert frames[-1] == {"done": True}


def test_a_plain_reply_without_tools_is_kept_as_is():
    client = _ScriptedClient(
        [
            _delta("Hyvä, "),
            _delta("jatketaan."),
            _assistant(sdk.TextBlock(text="Hyvä, jatketaan.")),
            _result(),
        ]
    )

    parts, frames = _run(client)

    assert parts == ["Hyvä, jatketaan."]
    assert [next(iter(f)) for f in frames] == ["delta", "delta", "done"]


def test_a_summary_saved_with_a_tool_call_is_the_reply_when_nothing_follows():
    """Janne's review of #284: the wizard writes the Gate 1 summary and saves the
    blueprint in the same message; the turn ends with no further text."""
    summary = "Here is the specification summary: … Review it in the panel."
    client = _ScriptedClient(
        [
            _delta(summary),
            _assistant(
                sdk.TextBlock(text=summary),
                sdk.ToolUseBlock(id="t1", name="Write", input={}),
            ),
            _assistant(sdk.TextBlock(text="")),  # the message after the tool result: empty
            _result(),
        ]
    )

    parts, frames = _run(client)

    assert parts == [summary]
    assert {"narration_end": True} not in frames  # the user keeps seeing the summary
    assert client.queries == []
    assert frames[-1] == {"done": True}
