"""A chat turn goes on when the page that started it is gone, and a page can join it.

A reload in the middle of a reply closed the response the turn lived in: the
user's message and the reply so far vanished from the page, and the next message
was refused with "the wizard is still finishing the previous reply". The turn
now runs as its own task and keeps its frames; the session detail names the
message being answered and ``GET /chat/stream`` brings the reply from its start.
"""

import asyncio
import json
import threading
import time

from conftest import requires_postgres
from wizard_api.services import agent_service
from wizard_api.services.agent_service import Turn, sse


def _frames(text: str) -> list[dict]:
    return [
        json.loads(line[len("data: ") :])
        for line in text.split("\n\n")
        if line.startswith("data: ")
    ]


def _replies(frames: list[dict]) -> list[dict]:
    """The frames without the keep-alives each reader adds for itself."""
    return [frame for frame in frames if "heartbeat" not in frame]


def test_a_reader_that_comes_late_gets_the_reply_from_its_first_frame():
    async def scenario() -> tuple[list[str], list[str]]:
        turn = Turn("Hei")
        early: list[str] = []
        late: list[str] = []

        async def read(into: list[str]) -> None:
            async for frame in turn.subscribe():
                into.append(frame)

        first = asyncio.create_task(read(early))
        await turn.publish(sse({"delta": "Mo"}))
        await turn.publish(sse({"delta": "i"}))
        second = asyncio.create_task(read(late))
        await turn.publish(sse({"done": True}))
        await turn.finish()
        await asyncio.gather(first, second)
        return early, late

    early, late = asyncio.run(scenario())

    assert [json.loads(f[6:]) for f in early] == [{"delta": "Mo"}, {"delta": "i"}, {"done": True}]
    assert late == early


def test_a_reader_stays_until_the_turn_is_through_not_until_the_reply_is():
    """The exchange is stored after the reply's last frame; a page that reads
    the session when the stream closes must find it there."""

    async def scenario() -> bool:
        turn = Turn("Hei")
        await turn.publish(sse({"done": True}))
        reader = turn.subscribe()
        assert json.loads((await anext(reader))[6:]) == {"done": True}
        waiting = asyncio.ensure_future(anext(reader))
        await asyncio.sleep(0.05)
        still_open = not waiting.done()
        await turn.finish()
        try:
            await waiting
        except StopAsyncIteration:
            pass
        return still_open

    assert asyncio.run(scenario())


def test_a_quiet_turn_keeps_each_reader_alive(monkeypatch):
    monkeypatch.setattr(agent_service, "_HEARTBEAT_INTERVAL", 0.01)

    async def scenario() -> str:
        turn = Turn("Hei")
        reader = turn.subscribe()
        frame = await anext(reader)
        await turn.finish()
        return frame

    assert agent_service.is_heartbeat(asyncio.run(scenario()))


def _fake_agent(monkeypatch, stream) -> None:
    async def fake_get_or_create_session(session_id, output_dir, locale=None, **kwargs):
        return {"lock": asyncio.Lock()}

    monkeypatch.setattr(agent_service, "get_or_create_session", fake_get_or_create_session)
    monkeypatch.setattr(agent_service, "stream_turn_for", stream)


def _wait_for(condition, seconds: float = 5.0) -> None:
    deadline = time.monotonic() + seconds
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.02)


@requires_postgres
def test_a_page_loaded_mid_reply_sees_the_message_and_joins_the_reply(client, monkeypatch):
    release = threading.Event()

    async def stream(agent, message, parts):
        yield sse({"delta": "Katson"})
        yield sse({"activity": {"kind": "read", "file": "SKILL.md"}})
        while not release.is_set():
            await asyncio.sleep(0.01)
        yield sse({"narration_end": True})
        parts.append("Valmista tuli.")
        yield sse({"delta": "Valmista tuli."})
        yield sse({"done": True})

    _fake_agent(monkeypatch, stream)
    sid = client.post("/sessions", json={"user_id": "reload", "title": "Reload"}).json()["id"]

    started: dict = {}
    sender = threading.Thread(
        target=lambda: started.update(
            res=client.post(f"/sessions/{sid}/chat", json={"message": "Tee tämä"})
        )
    )
    sender.start()
    try:
        _wait_for(lambda: agent_service.running_turn(sid) is not None)
        _wait_for(lambda: len(agent_service.running_turn(sid).frames) == 2)

        # The page is loaded again: the session says what is being answered.
        detail = client.get(f"/sessions/{sid}").json()
        assert detail["pending_turn"]["user_message"] == "Tee tämä"
        assert detail["metadata"]["messages"] == []
        # A second message does not start beside the first.
        assert client.post(f"/sessions/{sid}/chat", json={"message": "Toinen"}).status_code == 409

        joined: dict = {}
        joiner = threading.Thread(
            target=lambda: joined.update(res=client.get(f"/sessions/{sid}/chat/stream"))
        )
        joiner.start()
    finally:
        release.set()
    sender.join(timeout=10)
    joiner.join(timeout=10)

    expected = [
        {"delta": "Katson"},
        {"activity": {"kind": "read", "file": "SKILL.md"}},
        {"narration_end": True},
        {"delta": "Valmista tuli."},
        {"done": True},
    ]
    assert started["res"].status_code == 200
    assert _replies(_frames(started["res"].text)) == expected
    assert joined["res"].status_code == 200
    assert _replies(_frames(joined["res"].text)) == expected

    after = client.get(f"/sessions/{sid}").json()
    assert after["pending_turn"] is None
    assert [m["content"] for m in after["metadata"]["messages"]] == ["Tee tämä", "Valmista tuli."]
    # Nothing is running any more: the stored conversation has it all.
    assert client.get(f"/sessions/{sid}/chat/stream").status_code == 204
    assert not agent_service.is_busy(sid)


@requires_postgres
def test_a_turn_that_breaks_tells_the_chat_and_frees_the_session(client, monkeypatch):
    async def stream(agent, message, parts):
        yield sse({"delta": "Aloitan"})
        raise RuntimeError("the agent process went away")

    _fake_agent(monkeypatch, stream)
    sid = client.post("/sessions", json={"user_id": "broken", "title": "Broken"}).json()["id"]

    res = client.post(f"/sessions/{sid}/chat", json={"message": "Hei"})

    frames = _replies(_frames(res.text))
    assert frames[0] == {"delta": "Aloitan"}
    assert frames[-1]["error"] is True
    assert "went away" not in res.text  # the cause is in the log, not in the chat
    assert not agent_service.is_busy(sid)
    assert client.get(f"/sessions/{sid}").json()["pending_turn"] is None

    # The next message is taken.
    async def works(agent, message, parts):
        parts.append("Nyt toimii.")
        yield sse({"delta": "Nyt toimii."})

    monkeypatch.setattr(agent_service, "stream_turn_for", works)
    assert client.post(f"/sessions/{sid}/chat", json={"message": "Uudestaan"}).status_code == 200


@requires_postgres
def test_a_message_refused_before_the_turn_starts_leaves_nothing_running(client, monkeypatch):
    async def no_room(session_id, output_dir, locale=None, **kwargs):
        raise agent_service.AgentCapacityError("The wizard is busy with other sessions.")

    monkeypatch.setattr(agent_service, "get_or_create_session", no_room)
    sid = client.post("/sessions", json={"user_id": "full", "title": "Full"}).json()["id"]

    assert client.post(f"/sessions/{sid}/chat", json={"message": "Hei"}).status_code == 503
    assert agent_service.running_turn(sid) is None
    assert client.get(f"/sessions/{sid}").json()["pending_turn"] is None
