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
import logging
import os
import re
import time
from collections.abc import AsyncGenerator
from pathlib import Path

logger = logging.getLogger(__name__)

try:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeAgentOptions,
        ClaudeSDKClient,
        ResultMessage,
        TextBlock,
        ToolUseBlock,
    )

    _SDK_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only where the SDK is absent
    _SDK_AVAILABLE = False
    AssistantMessage = ClaudeAgentOptions = ClaudeSDKClient = ResultMessage = TextBlock = None  # type: ignore
    ToolUseBlock = None  # type: ignore

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

    What is deliberately *not* here: the API's own secrets (``WIZARD_API_TOKEN``,
    ``WIZARD_DATABASE_URL``). ``wizard_api.config`` takes them out of
    ``os.environ`` at import, and that is the only place it can be done — the
    SDK merges this dict over the inherited environment rather than replacing
    it, so dropping keys here would not keep them from the agent's Bash tool.
    """
    env = dict(os.environ)
    env.setdefault("API_TIMEOUT_MS", "600000")
    env.setdefault("DISABLE_TELEMETRY", "1")
    state_dir = agent_state_dir()
    if state_dir is not None:
        env.setdefault("CLAUDE_CONFIG_DIR", str(state_dir))
    return env


def agent_state_dir() -> Path | None:
    """Where the wizard CLI keeps its transcripts, so a session can be resumed.

    By default the CLI writes under ``$HOME/.claude``; in the api pod HOME is
    the ephemeral root filesystem, so every restart (and every idle reap) lost
    the agent's context for good (#174). The transcripts go on the sessions
    volume instead, next to the session output directories, or wherever
    ``WIZARD_AGENT_STATE_DIR`` points. None when neither is configured (local
    dev with the ambient CLI keeps its own state).
    """
    explicit = os.getenv("WIZARD_AGENT_STATE_DIR", "").strip()
    if explicit:
        return Path(explicit)
    root = os.getenv("WIZARD_SESSION_OUTPUT_ROOT", "").strip()
    return Path(root) / ".claude-agent" if root else None


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


#: An internal notice the agent sometimes writes as if it were its reply
#: ("(Background task completed — waiting for your response …)"). It is not an
#: answer to the user's message (#168).
_NOTICE_RE = re.compile(r"^\W*(background task|task notification|system notification)", re.I)


def _is_notice(text: str) -> bool:
    return bool(_NOTICE_RE.match(text.strip()))


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


def _normalise_locale(locale: str | None) -> str | None:
    """The locale as the language map knows it, or None when we do not."""
    key = (locale or "").strip().lower()
    return key if key in _LOCALE_LANGUAGE else None


def relanguage_prompt(previous: str | None, incoming: str | None) -> str | None:
    """An instruction re-pinning the reply language, or None when none is needed.

    The locale reached the agent only in the bootstrap turn, so a session that
    began in one language kept answering in it after the user switched the UI —
    the English UI still showing Finnish field labels is that, seen from the
    other side. A live agent cannot be re-bootstrapped without losing the
    conversation, so the change is sent as its own short instruction instead.
    """
    before = _normalise_locale(previous)
    after = _normalise_locale(incoming)
    if after is None or after == before:
        return None
    lang = _LOCALE_LANGUAGE[after]
    return (
        f"The user switched the interface to {lang}. From now on, write every "
        f"reply and every artifact you generate in {lang}, regardless of the "
        f"language the user writes in. Do not comment on this instruction."
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
- Ask one or two questions per message and wait for the reply. Use Markdown.
- GATES ARE APPROVED IN THE PANEL, NOT IN THE CHAT. The UI has an approval
  button for each gate (Gate 1 after the specification, Gate 2 after the
  blueprint and BPMN, Gate 3 after the PoC run). Each user message begins with a
  bracketed session-state line that gives the current step and the status of
  every gate; it is written by the server, not the user. At a gate, present the
  summary and tell the user to review and approve it in the panel. Do NOT ask
  them to reply "yes"/"kyllä", and do NOT treat a chat reply as the approval:
  as long as the state line says the gate is pending, stay at the gate and
  answer their questions or make the changes they ask for. Continue to the next
  phase only when the state line says that gate is approved.{_language_line(locale)}
"""


#: Prefix of the state line the server puts in front of every user message.
STATE_LINE_PREFIX = "[Session state:"


def gate_context_line(step: int, gate_statuses: dict[str, str]) -> str:
    """One line telling the agent where the session is and which gates are open.

    The agent cannot see the UI, so a chat "yes" at a gate used to be its only
    signal and the UI's approval a second, separate one (#173). The server now
    says what the UI knows, and the bootstrap prompt makes the panel the only
    approval.
    """
    gates = ", ".join(
        f"{key} {gate_statuses.get(key, 'pending')}"
        for key in ("gate_1", "gate_2", "gate_3", "gate_4")
    )
    return f"{STATE_LINE_PREFIX} step {step} of 13; {gates}]"


def with_gate_context(user_message: str, step: int, gate_statuses: dict[str, str]) -> str:
    return f"{gate_context_line(step, gate_statuses)}\n\n{user_message}"


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

    Text deltas are streamed as they come. A turn is made of several assistant
    messages when the agent uses tools, and the text before a tool call is
    usually the agent narrating its work, not its reply (#168). It is dropped
    only once a later message brings real text: a ``narration_end`` frame then
    tells the UI to clear what it showed for the earlier message, and nothing of
    it is kept. If the turn ends with no further text, that last pre-tool text
    *is* the reply (the wizard often writes a summary and saves a file in the
    same message), so it is kept and no frame is sent. Only one message's text
    goes into ``out_parts`` for the transcript. A turn whose reply is empty or an
    internal notice ("Background task completed …") is nudged with a quiet
    "Please continue." (up to two retries), mirroring the demo router.
    """
    client = session["client"]
    current: list[str] = []  # text of the assistant message being streamed
    shown = ""  # text of the last closed message that is still on the user's screen
    try:
        async for message in _receive_with_heartbeat(client):
            if message is None:
                yield sse({"heartbeat": True})
                continue

            if StreamEvent is not None and isinstance(message, StreamEvent):
                delta = _extract_stream_text(message)
                if delta:
                    if not current and shown:
                        # A new message starts talking: what the previous one
                        # said was narration after all.
                        yield sse({"narration_end": True})
                        shown = ""
                    current.append(delta)
                    yield sse({"delta": delta})
                continue

            if isinstance(message, AssistantMessage):
                if StreamEvent is None:
                    # Without partials the full TextBlocks are the only text.
                    for block in message.content:
                        if isinstance(block, TextBlock) and block.text:
                            if not current and shown:
                                yield sse({"narration_end": True})
                                shown = ""
                            current.append(block.text)
                            yield sse({"delta": block.text})
                text = "".join(current)
                current = []
                if text.strip():
                    shown = text
            elif isinstance(message, ResultMessage):
                if getattr(message, "session_id", None):
                    session["sdk_session_id"] = message.session_id
                if message.is_error:
                    yield sse(
                        {
                            "error": True,
                            "message": message.result or f"stopped: {message.stop_reason}",
                        }
                    )
                    break
                final_text = shown or "".join(current)
                if _is_notice(final_text):
                    # Shown while it streamed; take it back, it is not the answer.
                    yield sse({"narration_end": True})
                    final_text = ""
                if not final_text.strip() and _silent_retries < 2:
                    await client.query("Please continue.")
                    async for chunk in _stream_turn(
                        session, out_parts, _silent_retries=_silent_retries + 1
                    ):
                        yield chunk
                else:
                    out_parts[:] = [final_text] if final_text.strip() else []
                    yield sse({"done": True})
                break
    except Exception as exc:  # noqa: BLE001
        logger.exception("agent chat turn failed for session %s", session.get("id"))
        yield sse({"error": True, "message": str(exc)})
    finally:
        session["last_active"] = time.time()


async def _drain_silent(client):
    """Consume one turn without emitting (used for the bootstrap turn).
    Returns the ResultMessage, whose ``session_id`` names the CLI session."""
    async for message in client.receive_response():
        if isinstance(message, ResultMessage):
            return message
    return None


def _build_options(wizard_dir: Path, output_dir: Path, *, resume: str | None = None):
    return ClaudeAgentOptions(
        cwd=str(wizard_dir),
        add_dirs=[str(output_dir)],
        env=_agent_env(),
        model=_model(),
        allowed_tools=["Read", "Grep", "Glob", "Write", "Edit", "Bash"],
        permission_mode="bypassPermissions",
        setting_sources=[],
        include_partial_messages=True,
        resume=resume,
    )


#: Shown once in the chat when the agent had to be restarted from the stored
#: transcript instead of resumed with its own context (#174).
RESTART_NOTICE = {
    "fi": (
        "⟳ Wizard käynnistettiin uudelleen (palvelin käynnistyi tai yhteys oli pitkään "
        "käyttämättä). Aiempi keskustelu ja tiedostot palautettiin sille tallennetusta "
        "historiasta; tarkista tarvittaessa, että se muistaa viimeisimmät päätökset.\n\n"
    ),
    "en": (
        "⟳ The wizard was restarted (the server restarted or the session was idle for "
        "long). The earlier conversation and files were restored from the stored "
        "history; check that it remembers the latest decisions if in doubt.\n\n"
    ),
}

_RESTORE_MAX_MESSAGES = 12
_RESTORE_MAX_CHARS = 1500


def restore_context_prompt(messages: list[dict] | None) -> str:
    """The stored transcript, folded into the bootstrap when a resume is not possible.

    Not a substitute for the agent's own context (tool results and reasoning are
    gone), but enough that it continues the case instead of asking for the use
    case again. The last messages matter most, so earlier ones are left out.
    """
    recent = [m for m in (messages or []) if isinstance(m, dict) and m.get("content")]
    if not recent:
        return ""
    recent = recent[-_RESTORE_MAX_MESSAGES:]
    lines = []
    for m in recent:
        who = "User" if m.get("role") == "user" else "You"
        text = str(m.get("content", "")).strip()
        if len(text) > _RESTORE_MAX_CHARS:
            text = text[:_RESTORE_MAX_CHARS] + " …"
        lines.append(f"{who}: {text}")
    body = "\n\n".join(lines)
    return f"""

CONTEXT RESTORED AFTER A RESTART:
Your process was restarted and this conversation is being continued, not
started. Below is the end of the conversation so far, as stored by the server.
The files you wrote earlier are still in the output directory: read them
before changing anything. Do NOT restart the interview or ask for the use case
again; pick up exactly where the last message left off. Do not mention this
note to the user.

{body}
"""


def transcript_exists(sdk_session_id: str) -> bool | None:
    """Whether the CLI still has the transcript to resume from.

    The CLI starts fine with ``--resume <id>`` and reports "No conversation
    found" only on the first turn, so a stale id would fail every message for
    good. The transcript is ``<state dir>/projects/<cwd slug>/<id>.jsonl``; when
    no state dir is configured there is nothing to check and None is returned.
    """
    state_dir = agent_state_dir()
    if state_dir is None:
        return None
    return any((state_dir / "projects").glob(f"*/{sdk_session_id}.jsonl"))


def frame_is_error(frame: str) -> bool:
    """True for an SSE frame carrying ``{"error": true}``."""
    try:
        return bool(json.loads(frame[len("data: ") :]).get("error"))
    except (ValueError, AttributeError):
        return False


async def get_or_create_session(
    session_id: str,
    output_dir: str,
    locale: str | None = None,
    *,
    resume_id: str | None = None,
    transcript: list[dict] | None = None,
) -> dict:
    """Return the live agent session for ``session_id``, spawning + bootstrapping
    a ClaudeSDKClient on first use. ``locale`` (fi/en) pins the agent's reply
    language at bootstrap. Uses Azure Foundry when configured, else the ambient
    ``claude`` CLI auth. Raises AgentNotConfiguredError only if the Claude Agent
    SDK/CLI or the wizard assets are missing."""
    existing = AGENT_SESSIONS.get(session_id)
    if existing is not None:
        # The session is already live, so the locale cannot be pinned by
        # bootstrapping again — send the change as its own instruction instead.
        repin = relanguage_prompt(existing.get("locale"), locale)
        if repin is not None:
            await existing["client"].query(repin)
            await _drain_silent(existing["client"])
            existing["locale"] = _normalise_locale(locale)
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

    client = None
    resumed: str | None = None
    sdk_session_id: str | None = None
    if resume_id and transcript_exists(resume_id) is False:
        logger.info("agent session %s has no transcript to resume for %s", resume_id, session_id)
        resume_id = None
        transcript = transcript or []  # still a restart: fall through to the notice
    if resume_id:
        # The CLI session from before the restart or the idle reap: with its
        # transcript on the sessions volume, the agent comes back with its own
        # context and nothing has to be re-explained (#174).
        try:
            client = ClaudeSDKClient(options=_build_options(wizard_dir, out, resume=resume_id))
            await client.connect()
            resumed = "sdk"
            sdk_session_id = resume_id
        except Exception:  # noqa: BLE001 - the fallback below says what happened
            logger.warning(
                "could not resume agent session %s for %s; bootstrapping from the transcript",
                resume_id,
                session_id,
            )
            client = None
    if client is None:
        client = ClaudeSDKClient(options=_build_options(wizard_dir, out))
        await client.connect()
        # Bootstrap turn: invoke the skill + pin output dir. Drained silently —
        # the prompt tells the agent not to greet, so it produces nothing
        # user-facing. After a lost context the stored transcript rides along.
        restore = restore_context_prompt(transcript) if transcript is not None else ""
        await client.query(_bootstrap_prompt(out, locale) + restore)
        result = await _drain_silent(client)
        sdk_session_id = getattr(result, "session_id", None)
        if restore:
            resumed = "transcript"

    session = {
        "client": client,
        "output_dir": out,
        "lock": asyncio.Lock(),
        "last_active": time.time(),
        # What the bootstrap pinned, so a later turn can tell a switch from a
        # repeat and only re-instruct on a real change.
        "locale": _normalise_locale(locale),
        # How this client came to be: None (first contact), "sdk" (the CLI
        # session resumed with its context) or "transcript" (re-bootstrapped
        # with the stored messages; the user is told once).
        "resumed": resumed,
        "notice_pending": resumed == "transcript",
        "sdk_session_id": sdk_session_id,
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
