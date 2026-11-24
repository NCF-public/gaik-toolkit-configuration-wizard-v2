"""A session whose user did not allow storing leaves no span outside the pod (WP5 M2)."""

import asyncio
import uuid

import pytest
from helpers import requires_postgres
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from wizard_api import telemetry

_EXPORTER = InMemorySpanExporter()


@pytest.fixture
def exported():
    """What left through the recording guard during the test, as the collector would get it."""
    provider = trace.get_tracer_provider()
    if not isinstance(provider, TracerProvider):
        provider = TracerProvider()
        trace.set_tracer_provider(provider)
    if not getattr(provider, "_recording_test_exporter", False):
        provider.add_span_processor(telemetry.recording.guard(SimpleSpanProcessor(_EXPORTER)))
        provider._recording_test_exporter = True
    _EXPORTER.clear()
    yield _EXPORTER.get_finished_spans
    _EXPORTER.clear()


def _names(spans) -> list[str]:
    return sorted(s.name for s in spans)


def _mentions(spans, text: str) -> list[str]:
    """The exported spans that hold ``text`` anywhere: name, attribute or event."""
    found = []
    for span in spans:
        values = [span.name, *map(str, (span.attributes or {}).values())]
        for event in span.events:
            values += [event.name, *map(str, (event.attributes or {}).values())]
        if any(text in value for value in values):
            found.append(span.name)
    return found


def test_a_trace_is_exported_when_its_request_span_ends(exported):
    with telemetry.tracer.start_as_current_span("request"):
        with telemetry.tracer.start_as_current_span("child"):
            pass
        assert exported() == ()  # held until the request's span has ended
    assert _names(exported()) == ["child", "request"]


def test_a_withheld_trace_exports_nothing_not_even_what_ended_before(exported):
    with telemetry.tracer.start_as_current_span("request") as request:
        with telemetry.tracer.start_as_current_span("before"):
            pass
        telemetry.recording.withhold(request)
        with telemetry.tracer.start_as_current_span("after"):
            pass
    assert exported() == ()


def test_a_span_that_ends_after_its_request_follows_the_requests_trace(exported):
    # A wizard.turn runs in its own task and ends long after the request.
    with telemetry.tracer.start_as_current_span("kept"):
        kept_turn = telemetry.tracer.start_span("wizard.turn")
    with telemetry.tracer.start_as_current_span("dropped") as request:
        telemetry.recording.withhold(request)
        dropped_turn = telemetry.tracer.start_span("wizard.turn")
    for turn in (kept_turn, dropped_turn):
        chat = telemetry.tracer.start_span("chat m", context=trace.set_span_in_context(turn))
        chat.end()
        turn.end()
    spans = exported()
    assert _names(spans) == ["chat m", "kept", "wizard.turn"]
    assert {s.context.trace_id for s in spans} == {kept_turn.get_span_context().trace_id}


def test_a_span_naming_a_session_not_known_as_stored_withholds_its_trace(exported):
    # Spans made outside a request (a gate reopened by the agent) name their
    # session themselves; nothing else says whether it is stored.
    unknown, stored = str(uuid.uuid4()), str(uuid.uuid4())
    telemetry.recording.allow(stored)
    for session in (unknown, stored):
        with telemetry.tracer.start_as_current_span("wizard.gate") as span:
            span.set_attribute("gaik.session.id", session)
            with telemetry.tracer.start_as_current_span("inner"):
                pass
    spans = exported()
    assert _names(spans) == ["inner", "wizard.gate"]
    assert _mentions(spans, unknown) == []


def test_a_request_path_with_a_session_not_known_as_stored_is_withheld(exported):
    # FastAPI puts the raw path, with the session's id, on the request's span.
    unknown = str(uuid.uuid4())
    with telemetry.tracer.start_as_current_span("GET /sessions/{session_id}") as span:
        span.set_attribute("url.path", f"/sessions/{unknown}/poc")
    assert exported() == ()


def test_a_session_that_is_no_longer_stored_is_withheld_again(exported):
    session = str(uuid.uuid4())
    telemetry.recording.allow(session)
    telemetry.recording.forget(session)
    with telemetry.tracer.start_as_current_span("wizard.gate") as span:
        span.set_attribute("gaik.session.id", session)
    assert exported() == ()


def test_a_withheld_trace_is_forgotten_only_after_its_keep_time(exported, monkeypatch):
    recording = telemetry.Recording(keep_seconds=60)
    now = [1000.0]
    monkeypatch.setattr(telemetry.time, "monotonic", lambda: now[0])
    with telemetry.tracer.start_as_current_span("first") as first:
        recording.withhold(first)
    now[0] += 59
    with telemetry.tracer.start_as_current_span("second") as second:
        recording.withhold(second)
    assert recording._withheld.keys() == {
        first.get_span_context().trace_id,
        second.get_span_context().trace_id,
    }
    now[0] += 2  # first is 61 s old, second 2 s
    with telemetry.tracer.start_as_current_span("third") as third:
        recording.withhold(third)
    assert first.get_span_context().trace_id not in recording._withheld
    assert second.get_span_context().trace_id in recording._withheld


def _create(client, answer: str | None, user: str = "rec-user") -> str:
    body = {"user_id": user, "title": "T"}
    if answer is not None:
        body["aiops_recording"] = answer
    created = client.post("/sessions", json=body, headers={"X-Wizard-User-Id": user})
    assert created.status_code == 201
    return created.json()["id"]


@requires_postgres
def test_a_stored_sessions_requests_are_exported_and_named(client, exported):
    sid = _create(client, "stored")
    headers = {"X-Wizard-User-Id": "rec-user"}
    assert client.get(f"/sessions/{sid}", headers=headers).status_code == 200

    (root,) = [s for s in exported() if s.name == "GET /sessions/{session_id}"]
    assert root.attributes["gaik.session.id"] == sid
    assert root.attributes["gaik.config.blueprint_version"] == 1


@requires_postgres
@pytest.mark.parametrize("answer", ["not_stored", None])
def test_a_session_that_is_not_stored_works_and_exports_no_span_of_itself(client, exported, answer):
    sid = _create(client, answer)
    headers = {"X-Wizard-User-Id": "rec-user"}

    assert client.get(f"/sessions/{sid}", headers=headers).status_code == 200
    patched = client.patch(f"/sessions/{sid}", json={"metadata": {"note": "n"}}, headers=headers)
    assert patched.status_code == 200
    saved = client.post(f"/sessions/{sid}/versions", json={"note": "saved"}, headers=headers)
    assert saved.status_code in (200, 201)
    assert client.get(f"/sessions/{sid}", headers=headers).json()["active_version"] == 2

    spans = exported()
    assert _mentions(spans, sid) == []
    # Creating a session and listing them name no session: exported as before.
    assert "POST /sessions" in _names(spans)
    assert not [s for s in spans if "{session_id}" in s.name]


@requires_postgres
def test_a_refused_request_for_a_session_that_is_not_stored_exports_nothing(client, exported):
    sid = _create(client, "not_stored")
    _EXPORTER.clear()

    other = client.get(f"/sessions/{sid}", headers={"X-Wizard-User-Id": "someone-else"})
    assert other.status_code == 404
    client.get(f"/sessions/{sid}")  # no user header: the sandbox Job's caller

    assert exported() == ()


@requires_postgres
def test_a_not_stored_sessions_turn_and_gate_spans_stay_in_the_pod(client, exported):
    stored, not_stored = _create(client, "stored"), _create(client, "not_stored")
    headers = {"X-Wizard-User-Id": "rec-user"}
    for sid in (stored, not_stored):
        client.get(f"/sessions/{sid}", headers=headers)
    _EXPORTER.clear()

    async def frames():
        yield "data: {}\n\n"

    async def turn(sid: str) -> None:
        async for _ in telemetry.traced_turn(
            frames(), {"gaik.session.id": sid}, lambda: [], "m", lambda frame: False
        ):
            pass

    for sid in (stored, not_stored):
        asyncio.run(turn(sid))
        with telemetry.tracer.start_as_current_span("wizard.sandbox.result") as span:
            span.set_attribute("gaik.session.id", sid)

    spans = exported()
    assert _names(spans) == ["wizard.sandbox.result", "wizard.turn"]
    assert _mentions(spans, not_stored) == []
