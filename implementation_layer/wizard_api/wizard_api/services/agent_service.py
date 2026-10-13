"""V1 wizard agent bridge (#29 / S2-1).

Runs the interactive GAIK Solution Configuration Wizard (Claude Agent SDK,
``ClaudeSDKClient`` on Azure Foundry) behind wizard_api's chat endpoint. One live
client per wizard session keeps the conversation context across messages; each
``POST /sessions/{id}/chat`` streams exactly one turn over SSE using the UI's own
chat-SSE contract so the Next.js proxy can pipe it through unchanged:

    data: {"delta": "<token>"}   (repeated)
    data: {"heartbeat": true}    (keep-alive; ignored by the client)
    data: {"done": true}         (turn finished)
    data: {"error": true, ...}   (failure)

Ported from ``toolkit_demo_app/api/routers/solution_wizard.py`` (the proven demo
implementation), adapted to wizard_api's DB-backed sessions and the UI contract.
The Claude Agent SDK is imported defensively so this module (and its pure
helpers) import even where the SDK/CLI is not installed; the chat endpoint then
returns a clear 503 instead of failing at import time.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from collections.abc import AsyncGenerator
from pathlib import Path

try:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeAgentOptions,
        ClaudeSDKClient,
        ResultMessage,
        TextBlock,
    )

    _SDK_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only where the SDK is absent
    _SDK_AVAILABLE = False
    AssistantMessage = ClaudeAgentOptions = ClaudeSDKClient = ResultMessage = TextBlock = None  # type: ignore

# StreamEvent (token-level partials) lives in the types submodule on some SDK
# versions, the top level on others. Optional.
try:
    from claude_agent_sdk.types import StreamEvent  # type: ignore
except ImportError:  # pragma: no cover
    try:
        from claude_agent_sdk import StreamEvent  # type: ignore
    except ImportError:
        StreamEvent = None  # type: ignore

_HERE = Path(__file__).resolve()

DEFAULT_MODEL = "claude-sonnet-4-6"
SESSION_IDLE_SECONDS = 30 * 60  # reap live clients idle longer than this
_HEARTBEAT_INTERVAL = 20  # seconds between SSE keep-alive frames
REQUIRED_FOUNDRY_VARS = [
    "CLAUDE_CODE_USE_FOUNDRY",
    "ANTHROPIC_FOUNDRY_API_KEY",
    "ANTHROPIC_FOUNDRY_RESOURCE",
]

# wizard_api session id (str) -> {client, output_dir, lock, last_active}
AGENT_SESSIONS: dict[str, dict] = {}


class AgentNotConfiguredError(RuntimeError):
    """Raised when the Claude Agent SDK/CLI or the wizard assets are missing."""


# ---------------------------------------------------------------------------
# Config helpers (pure — unit-testable without the SDK)
# ---------------------------------------------------------------------------


def resolve_wizard_dir() -> Path | None:
    """Locate implementation_layer/solution_wizard (env override wins)."""
    env_dir = os.getenv("WIZARD_DIR", "").strip()
    if env_dir:
        return Path(env_dir)
    # …/wizard_api/wizard_api/services/agent_service.py → parents[3] = implementation_layer
    candidate = _HERE.parents[3] / "solution_wizard"
    return candidate if candidate.is_dir() else None


def _foundry_configured() -> bool:
    """True when every Azure Foundry variable is set (production routing)."""
    return all((os.getenv(k) or "").strip() for k in REQUIRED_FOUNDRY_VARS)


def _agent_env() -> dict[str, str]:
    """Subprocess env for the wizard CLI.

    Uses Azure Foundry when it is fully configured (production); otherwise falls
    back to the *ambient* ``claude`` CLI auth already present in the environment
    (local dev — no Foundry resource needed). Foundry vars, when set, are already
    in ``os.environ`` and pass straight through. Never raises: an unauthenticated
    CLI surfaces a clear error on the first turn instead.
    """
    env = dict(os.environ)
    env.setdefault("API_TIMEOUT_MS", "600000")
    env.setdefault("DISABLE_TELEMETRY", "1")
    return env


def _model() -> str:
    return (
        os.getenv("ANTHROPIC_MODEL") or os.getenv("ANTHROPIC_DEFAULT_SONNET_MODEL") or DEFAULT_MODEL
    ).strip()


def sse(data: dict) -> str:
    """One SSE frame in the UI chat contract (``data: {json}\\n\\n``)."""
    return f"data: {json.dumps(data)}\n\n"


def sse_headers() -> dict[str, str]:
    return {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }


def _extract_stream_text(event) -> str:
    """Incremental assistant text from a StreamEvent (visible text deltas only)."""
    ev = getattr(event, "event", None)
    if not isinstance(ev, dict) or ev.get("type") != "content_block_delta":
        return ""
    delta = ev.get("delta") or {}
    if isinstance(delta, dict) and delta.get("type") == "text_delta":
        return delta.get("text", "") or ""
    return ""


_LOCALE_LANGUAGE = {"fi": "Finnish", "en": "English"}


def _language_line(locale: str | None) -> str:
    """A bootstrap instruction pinning the reply language to the UI locale."""
    lang = _LOCALE_LANGUAGE.get((locale or "").strip().lower())
    if not lang:
        return ""
    return (
        f"\n- Respond to the user in {lang}. Ask every question and write every "
        f"reply in {lang}, regardless of the language the user writes in."
    )


def _bootstrap_prompt(output_dir: Path, locale: str | None = None) -> str:
    """Internal first message: invoke the skill and pin the output directory."""
    return f"""\
/solution-wizard

You are running an interactive GAIK Solution Configuration Wizard session in a
web chat. Load and follow the complete wizard instructions from ./SKILL.md (you
are already in the wizard directory).

The output directory is pre-selected and managed by the server:
{output_dir}
Use it directly and write ALL generated files there. Do NOT ask the user where
to save files, and never write anywhere else.

IMPORTANT INSTRUCTIONS FOR THIS WEB SESSION:
- The web UI has already displayed a welcome message. Do NOT greet the user or
  introduce yourself. Start the conversation directly.
- Never mention the output directory path to the user. File management is handled
  invisibly by the server.
- The user's FIRST message will be their use-case description (Step 1.2 of
  Phase 1). Acknowledge it briefly (1-2 sentences: pattern classification +
  what you understood), then move straight into Phase 2 requirement collection.
- Ask one or two questions per message and wait for the reply. Use Markdown.{_language_line(locale)}
"""


# ---------------------------------------------------------------------------
# Streaming bridge
# ---------------------------------------------------------------------------


async def _receive_with_heartbeat(client):
    """Interleave ``receive_response()`` with periodic ``None`` heartbeat
    sentinels so a silent, tool-heavy turn never trips an idle-connection
    timeout in the browser or an upstream proxy."""
    queue: asyncio.Queue = asyncio.Queue()

    async def _drain() -> None:
        async for msg in client.receive_response():
            await queue.put(msg)
        await queue.put(StopAsyncIteration)

    async def _ping() -> None:
        while True:
            await asyncio.sleep(_HEARTBEAT_INTERVAL)
            await queue.put(None)

    drain_task = asyncio.create_task(_drain())
    ping_task = asyncio.create_task(_ping())
    try:
        while True:
            item = await queue.get()
            if item is StopAsyncIteration:
                break
            yield item
    finally:
        ping_task.cancel()
        drain_task.cancel()


async def _stream_turn(
    session: dict, out_parts: list[str], *, _silent_retries: int = 0
) -> AsyncGenerator[str, None]:
    """Stream one wizard turn as SSE (UI contract). Ends at the ResultMessage.

    Visible text deltas are both streamed and appended to ``out_parts`` so the
    caller can persist the assembled assistant reply after the turn. A turn that
    ends with no visible text is nudged with a quiet "Please continue." (up to
    two retries), mirroring the demo router.
    """
    client = session["client"]
    had_text = False
    try:
        async for message in _receive_with_heartbeat(client):
            if message is None:
                yield sse({"heartbeat": True})
                continue

            if StreamEvent is not None and isinstance(message, StreamEvent):
                delta = _extract_stream_text(message)
                if delta:
                    had_text = True
                    out_parts.append(delta)
                    yield sse({"delta": delta})
                continue

            if isinstance(message, AssistantMessage):
                for block in message.content:
                    # With partials on, full TextBlocks duplicate the deltas;
                    # only use them when StreamEvent is unavailable.
                    if isinstance(block, TextBlock) and StreamEvent is None:
                        had_text = True
                        out_parts.append(block.text)
                        yield sse({"delta": block.text})
            elif isinstance(message, ResultMessage):
                if message.is_error:
                    yield sse(
                        {
                            "error": True,
                            "message": message.result or f"stopped: {message.stop_reason}",
                        }
                    )
                    break
                if not had_text and _silent_retries < 2:
                    await client.query("Please continue.")
                    async for chunk in _stream_turn(
                        session, out_parts, _silent_retries=_silent_retries + 1
                    ):
                        yield chunk
                else:
                    yield sse({"done": True})
                break
    except Exception as exc:  # noqa: BLE001
        yield sse({"error": True, "message": str(exc)})
    finally:
        session["last_active"] = time.time()


async def _drain_silent(client) -> None:
    """Consume one turn without emitting (used for the bootstrap turn)."""
    async for message in client.receive_response():
        if isinstance(message, ResultMessage):
            break


def _build_options(wizard_dir: Path, output_dir: Path):
    return ClaudeAgentOptions(
        cwd=str(wizard_dir),
        add_dirs=[str(output_dir)],
        env=_agent_env(),
        model=_model(),
        allowed_tools=["Read", "Grep", "Glob", "Write", "Edit", "Bash"],
        permission_mode="bypassPermissions",
        setting_sources=[],
        include_partial_messages=True,
    )


async def get_or_create_session(
    session_id: str, output_dir: str, locale: str | None = None
) -> dict:
    """Return the live agent session for ``session_id``, spawning + bootstrapping
    a ClaudeSDKClient on first use. ``locale`` (fi/en) pins the agent's reply
    language at bootstrap. Uses Azure Foundry when configured, else the ambient
    ``claude`` CLI auth. Raises AgentNotConfiguredError only if the Claude Agent
    SDK/CLI or the wizard assets are missing."""
    existing = AGENT_SESSIONS.get(session_id)
    if existing is not None:
        return existing

    if not _SDK_AVAILABLE:
        raise AgentNotConfiguredError("claude-agent-sdk is not installed")
    wizard_dir = resolve_wizard_dir()
    if wizard_dir is None or not (wizard_dir / "SKILL.md").is_file():
        raise AgentNotConfiguredError(
            "wizard assets not found (set WIZARD_DIR to the solution_wizard directory)"
        )

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    client = ClaudeSDKClient(options=_build_options(wizard_dir, out))
    await client.connect()
    # Bootstrap turn: invoke the skill + pin output dir. Drained silently — the
    # prompt tells the agent not to greet, so it produces nothing user-facing.
    await client.query(_bootstrap_prompt(out, locale))
    await _drain_silent(client)

    session = {
        "client": client,
        "output_dir": out,
        "lock": asyncio.Lock(),
        "last_active": time.time(),
    }
    AGENT_SESSIONS[session_id] = session
    return session


async def stream_turn_for(
    session: dict, user_message: str, out_parts: list[str]
) -> AsyncGenerator[str, None]:
    """Send one user message and stream the wizard's reply for this session."""
    async with session["lock"]:
        await session["client"].query(user_message)
        async for chunk in _stream_turn(session, out_parts):
            yield chunk


async def end_session(session_id: str) -> bool:
    """Disconnect and drop a live session. Returns True if one existed."""
    session = AGENT_SESSIONS.pop(session_id, None)
    if session is None:
        return False
    try:
        await session["client"].disconnect()
    except Exception:  # noqa: BLE001
        pass
    return True


async def cleanup_idle_sessions() -> None:
    """Background loop: disconnect + drop clients idle beyond the timeout."""
    while True:
        await asyncio.sleep(600)
        cutoff = time.time() - SESSION_IDLE_SECONDS
        stale = [sid for sid, s in AGENT_SESSIONS.items() if s["last_active"] < cutoff]
        for sid in stale:
            await end_session(sid)
