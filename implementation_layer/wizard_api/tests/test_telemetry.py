"""The spans the API sends to the WP5 collector (wizard_api.telemetry).

Each test reads what was recorded through an in-memory exporter: the span's
name, its numbers and statuses, and that nothing the user or the agent wrote
ended up in it.
"""

import asyncio
import uuid

import pytest
from helpers import requires_postgres
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from wizard_api import telemetry
from wizard_api.services import agent_service

sdk = pytest.importorskip("claude_agent_sdk")

_EXPORTER = InMemorySpanExporter()


@pytest.fixture
def spans():
    """The spans recorded during the test, by name."""
    if not isinstance(trace.get_tracer_provider(), TracerProvider):
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(_EXPORTER))
        trace.set_tracer_provider(provider)
    _EXPORTER.clear()

    def by_name(name: str) -> list:
        return [s for s in _EXPORTER.get_finished_spans() if s.name == name]

    yield by_name
    _EXPORTER.clear()


def _result(**overrides):
    fields = {
        "subtype": "success",
        "duration_ms": 1500,
        "duration_api_ms": 1200,
        "is_error": False,
        "num_turns": 3,
        "session_id": "s",
        "total_cost_usd": 0.042,
        "usage": {
            "input_tokens": 120,
            "output_tokens": 340,
            "cache_read_input_tokens": 9000,
            "cache_creation_input_tokens": 500,
        },
        "result": "Tässä on vastaukseni.",
    }
    fields.update(overrides)
    return sdk.ResultMessage(**fields)


def _all_values(span) -> str:
    return " ".join(str(v) for v in span.attributes.values())


def test_without_an_endpoint_nothing_is_set_up(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    monkeypatch.setattr(telemetry, "_provider", None)
    telemetry.setup()
    assert telemetry._provider is None


def test_a_turns_model_usage_becomes_a_chat_span_under_the_turn(spans):
    turn = telemetry.tracer.start_span("wizard.turn")
    telemetry.record_turn_usage(turn, _result(), "claude-sonnet")
    turn.end()

    (chat,) = spans("chat claude-sonnet")
    assert chat.parent.span_id == turn.get_span_context().span_id
    assert chat.attributes["gaik.event.class"] == "llm_call"
    assert chat.attributes["gen_ai.request.model"] == "claude-sonnet"
    assert chat.attributes["gen_ai.usage.input_tokens"] == 120
    assert chat.attributes["gen_ai.usage.output_tokens"] == 340
    assert chat.attributes["gen_ai.usage.cache_read.input_tokens"] == 9000
    assert chat.attributes["gaik.cost.usd"] == 0.042
    assert chat.attributes["gaik.agent.num_turns"] == 3
    assert (chat.end_time - chat.start_time) == 1500 * 1_000_000
    assert "vastaukseni" not in _all_values(chat)


def test_usage_the_sdk_did_not_report_is_left_out(spans):
    turn = telemetry.tracer.start_span("wizard.turn")
    telemetry.record_turn_usage(turn, _result(usage=None, total_cost_usd=None), "m")
    turn.end()
    (chat,) = spans("chat m")
    assert "gen_ai.usage.input_tokens" not in chat.attributes
    assert "gaik.cost.usd" not in chat.attributes


@requires_postgres
def test_a_chat_message_is_one_turn_span_with_its_usage_and_no_text(client, monkeypatch, spans):
    async def fake_get_or_create_session(session_id, output_dir, locale=None, **kwargs):
        # A new agent: its bootstrap query is counted with the first turn.
        return {"lock": asyncio.Lock(), "turn_results": [("setup", _result(total_cost_usd=0.01))]}

    async def fake_stream_turn_for(agent, message, parts):
        agent["turn_results"].append(("turn", _result()))
        parts.append("Tässä on vastaukseni.")
        yield agent_service.sse({"delta": "Tässä on vastaukseni."})
        yield agent_service.sse({"done": True})

    monkeypatch.setattr(agent_service, "get_or_create_session", fake_get_or_create_session)
    monkeypatch.setattr(agent_service, "stream_turn_for", fake_stream_turn_for)
    sid = client.post("/sessions", json={"user_id": "u-1", "title": "T"}).json()["id"]

    client.post(
        f"/sessions/{sid}/chat",
        json={"message": "Salainen liiketoimintaongelma"},
        headers={"X-Wizard-User-Id": "u-1"},
    )

    (turn,) = spans("wizard.turn")
    assert turn.attributes["gaik.session.id"] == sid
    assert turn.attributes["gaik.step"] == 1
    assert "gate_1=pending" in turn.attributes["gaik.gate_statuses"]
    assert turn.attributes["enduser.id"] == "u-1"
    assert turn.status.is_ok
    setup, chat = spans(f"chat {agent_service._model()}")
    assert setup.attributes["gaik.agent.purpose"] == "setup"
    assert setup.attributes["gaik.cost.usd"] == 0.01
    assert chat.attributes["gaik.agent.purpose"] == "turn"
    for span in (setup, chat):
        assert span.parent.span_id == turn.context.span_id
    for span in (turn, setup, chat):
        assert "Salainen" not in _all_values(span)
        assert "vastaukseni" not in _all_values(span)


@requires_postgres
def test_usage_is_counted_once(client, monkeypatch, spans):
    agent = {"lock": asyncio.Lock()}

    async def fake_get_or_create_session(session_id, output_dir, locale=None, **kwargs):
        return agent

    async def fake_stream_turn_for(agent, message, parts):
        agent.setdefault("turn_results", []).append(("turn", _result()))
        parts.append("ok")
        yield agent_service.sse({"done": True})

    monkeypatch.setattr(agent_service, "get_or_create_session", fake_get_or_create_session)
    monkeypatch.setattr(agent_service, "stream_turn_for", fake_stream_turn_for)
    sid = client.post("/sessions", json={"user_id": "u", "title": "T"}).json()["id"]

    client.post(f"/sessions/{sid}/chat", json={"message": "yksi"})
    client.post(f"/sessions/{sid}/chat", json={"message": "kaksi"})

    assert len(spans("wizard.turn")) == 2
    assert len(spans(f"chat {agent_service._model()}")) == 2


@requires_postgres
def test_a_refused_gate_approval_says_why(client, spans):
    sid = client.post("/sessions", json={"user_id": "g", "title": "G"}).json()["id"]

    response = client.patch(f"/sessions/{sid}", json={"gate_statuses": {"gate_1": "approved"}})

    assert response.status_code == 409
    (gate,) = spans("wizard.gate")
    assert gate.attributes["gaik.gate"] == "gate_1"
    assert gate.attributes["gaik.gate.from"] == "pending"
    assert gate.attributes["gaik.gate.to"] == "approved"
    assert gate.attributes["gaik.gate.refused"] == "gate_not_ready"


@requires_postgres
def test_an_approved_gate_is_recorded(client, db_session, spans):
    from helpers import write_gate_artifacts
    from wizard_api.services import session_service

    created = client.post("/sessions", json={"user_id": "g", "title": "G"}).json()
    session = session_service.get_session(db_session, uuid.UUID(created["id"]))
    write_gate_artifacts(session.output_dir, through="gate_1")

    response = client.patch(
        f"/sessions/{created['id']}", json={"gate_statuses": {"gate_1": "approved"}}
    )

    assert response.status_code == 200
    (gate,) = spans("wizard.gate")
    assert gate.attributes["gaik.gate.to"] == "approved"
    assert "gaik.gate.refused" not in gate.attributes


@requires_postgres
def test_a_request_that_changes_no_gate_makes_no_gate_span(client, spans):
    sid = client.post("/sessions", json={"user_id": "g", "title": "G"}).json()["id"]
    client.patch(f"/sessions/{sid}", json={"title": "Renamed"})
    assert spans("wizard.gate") == []


@requires_postgres
def test_a_sandbox_run_refused_before_gate_2_is_recorded(client, spans):
    sid = client.post("/sessions", json={"user_id": "s", "title": "S"}).json()["id"]

    assert client.post(f"/sessions/{sid}/runs").status_code == 409

    (start,) = spans("wizard.sandbox.start")
    assert start.attributes["gaik.sandbox.kind"] == "run"
    assert start.attributes["gaik.sandbox.refused"] == "gate_not_approved"
    assert "gaik.sandbox.run_id" not in start.attributes


class _Runner:
    """Stands in for SandboxRunner: a preflight that starts and fails."""

    def __init__(self, *args, **kwargs):
        pass

    def start_check(self, session_id, version, *, user_id=None):
        return {"run_id": "run-9-chk", "phase": "pending", "reused": False}

    def check_run_of_session(self, run_id, session_id):
        pass

    def stream_logs(self, run_id):
        yield "ModuleNotFoundError: no module named 'gaik'"

    def final_status(self, run_id, **_):
        from wizard_api.services.sandbox_runner import RunStatus

        return RunStatus(run_id, "failed", exit_code=1)

    def run_kind(self, run_id):
        return "check"


@requires_postgres
def test_a_sandbox_check_is_recorded_when_it_starts_and_when_it_settles(
    client, db_session, monkeypatch, spans
):
    from test_poc_endpoints import _write_poc
    from wizard_api.services import sandbox_runner, session_service

    monkeypatch.setattr(sandbox_runner, "SandboxRunner", _Runner)
    sid = client.post("/sessions", json={"user_id": "s", "title": "S"}).json()["id"]
    _write_poc(session_service.get_session(db_session, uuid.UUID(sid)).output_dir)

    assert client.post(f"/sessions/{sid}/poc/check").status_code == 201
    client.get(f"/sessions/{sid}/runs/run-9-chk/stream")

    (start,) = spans("wizard.sandbox.start")
    assert start.attributes["gaik.sandbox.kind"] == "check"
    assert start.attributes["gaik.sandbox.run_id"] == "run-9-chk"
    (result,) = spans("wizard.sandbox.result")
    assert result.attributes["gaik.sandbox.run_id"] == "run-9-chk"
    assert result.attributes["gaik.sandbox.phase"] == "failed"
    assert result.attributes["gaik.sandbox.exit_code"] == 1
    assert not result.status.is_ok
    assert "ModuleNotFoundError" not in _all_values(result)


@requires_postgres
def test_a_case_run_refused_before_gate_2_is_recorded(client, spans):
    sid = client.post("/sessions", json={"user_id": "c", "title": "C"}).json()["id"]

    response = client.post(f"/sessions/{sid}/cases/case-1/submit", json={})

    assert response.status_code in (404, 409)
    (start,) = spans("wizard.sandbox.start")
    assert start.attributes["gaik.sandbox.kind"] == "case"
    assert "gaik.sandbox.refused" in start.attributes
