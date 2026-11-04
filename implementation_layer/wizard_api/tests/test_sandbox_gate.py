"""The sandbox gate: runs go through the one container that holds the cluster token.

The api container runs the wizard agent, so it carries no cluster credential;
it asks the gate sidecar for runs instead (``wizard_api.sandbox_gate``). These
tests check that the gate answers only the service token, that it takes a run
and not a Job spec, and that ``SandboxRunner`` in the api reaches it over HTTP
with the same answers and errors it gives locally.
"""

import socket
import threading
import time

import pytest
import uvicorn
from fastapi.testclient import TestClient
from wizard_api import sandbox_gate
from wizard_api.services import sandbox_runner
from wizard_api.services.sandbox_runner import (
    RunNotFoundError,
    RunStatus,
    SandboxNotConfiguredError,
    SandboxRunner,
)

TOKEN = "gate-test-token"
SESSION = "0b5b7b2b-a9ce-4896-b224-8d73614a9bb7"


class _FakeRunner:
    """Stands in for the gate's local SandboxRunner; records what it was asked."""

    calls: list = []

    def create_run(self, session_id, **fields):
        self.calls.append(("create", session_id, fields))
        if fields.get("case_id") == "bad":
            raise ValueError("not a case id: 'bad'")
        return "20261102080000-614a9bb7"

    def status(self, run_id, session_id=None):
        self.calls.append(("status", run_id, session_id))
        if run_id == "missing" or (session_id and session_id != SESSION):
            raise RunNotFoundError(run_id)
        return RunStatus(run_id=run_id, phase="succeeded", exit_code=0)

    def run_kind(self, run_id):
        return "check"

    def read_log(self, run_id):
        return "line one\nline two\n"

    def stream_logs(self, run_id):
        if run_id == "never-started":
            raise SandboxNotConfiguredError("run never-started did not start")
        yield "first"
        yield ""
        yield "third"

    def delete_run(self, run_id):
        self.calls.append(("delete", run_id))


@pytest.fixture
def gate(monkeypatch):
    monkeypatch.setenv("WIZARD_API_TOKEN", TOKEN)
    _FakeRunner.calls = []
    monkeypatch.setattr(sandbox_gate, "_runner", _FakeRunner)
    return TestClient(sandbox_gate.app)


def auth(token=TOKEN):
    return {"X-Wizard-Service-Token": token}


# ---------------------------------------------------------------------------
# The gate itself
# ---------------------------------------------------------------------------


def test_the_gate_refuses_a_caller_without_the_service_token(gate):
    assert gate.post("/runs", json={"session_id": SESSION}).status_code == 401
    assert (
        gate.post("/runs", json={"session_id": SESSION}, headers=auth("wrong")).status_code == 401
    )
    assert gate.get("/runs/x/log").status_code == 401
    assert _FakeRunner.calls == []


def test_the_gate_refuses_everyone_when_no_token_is_configured(monkeypatch):
    """No "auth off" mode: an unconfigured gate would hand runs to anything in the pod."""
    monkeypatch.delenv("WIZARD_API_TOKEN", raising=False)
    monkeypatch.setattr(sandbox_gate, "_runner", _FakeRunner)
    client = TestClient(sandbox_gate.app)
    assert client.post("/runs", json={"session_id": SESSION}, headers=auth("")).status_code == 401


def test_the_gate_takes_a_run_not_a_job_spec(gate):
    """Fields beyond the run's own are ignored, so a caller cannot shape the Job."""
    res = gate.post(
        "/runs",
        json={
            "session_id": SESSION,
            "kind": "check",
            "image": "attacker/image",
            "spec": {"containers": []},
        },
        headers=auth(),
    )
    assert res.status_code == 200
    _, session_id, fields = _FakeRunner.calls[0]
    assert session_id == SESSION
    assert set(fields) == {"run_id", "kind", "case_id", "user_id"}


def test_the_gate_maps_errors_to_statuses(gate):
    assert gate.get("/runs/missing", headers=auth()).status_code == 404
    bad = gate.post("/runs", json={"session_id": SESSION, "case_id": "bad"}, headers=auth())
    assert bad.status_code == 422
    assert gate.get("/runs/never-started/stream", headers=auth()).status_code == 503


# ---------------------------------------------------------------------------
# SandboxRunner in the api, through a real gate on a socket
# ---------------------------------------------------------------------------


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def gate_url(monkeypatch):
    monkeypatch.setenv("WIZARD_API_TOKEN", TOKEN)
    _FakeRunner.calls = []
    monkeypatch.setattr(sandbox_gate, "_runner", _FakeRunner)
    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(sandbox_gate.app, host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        assert time.monotonic() < deadline, "gate did not start"
        time.sleep(0.05)
    url = f"http://127.0.0.1:{port}"
    monkeypatch.setenv("WIZARD_SANDBOX_GATE_URL", url)
    yield url
    server.should_exit = True
    thread.join(timeout=5)


def test_the_runner_goes_through_the_gate_when_one_is_configured(gate_url):
    runner = SandboxRunner()
    run_id = runner.create_run(SESSION, kind="check", user_id="dev@gaik.local")
    assert run_id == "20261102080000-614a9bb7"
    assert _FakeRunner.calls[0] == (
        "create",
        SESSION,
        {"run_id": None, "kind": "check", "case_id": None, "user_id": "dev@gaik.local"},
    )

    status = runner.status(run_id, session_id=SESSION)
    assert status == RunStatus(run_id=run_id, phase="succeeded", exit_code=0)
    assert runner.final_status(run_id).finished
    assert runner.run_kind(run_id) == "check"
    assert runner.read_log(run_id) == "line one\nline two\n"
    assert list(runner.stream_logs(run_id)) == ["first", "", "third"]
    runner.delete_run(run_id)
    assert ("delete", run_id) in _FakeRunner.calls


def test_the_runner_raises_the_same_errors_through_the_gate(gate_url):
    runner = SandboxRunner()
    with pytest.raises(RunNotFoundError):
        runner.status("missing")
    with pytest.raises(RunNotFoundError):
        runner.check_run_of_session("20261102080000-614a9bb7", "another-session")
    with pytest.raises(ValueError):
        runner.create_run(SESSION, case_id="bad")
    with pytest.raises(SandboxNotConfiguredError):
        list(runner.stream_logs("never-started"))


def test_an_unreachable_gate_is_a_configuration_error(monkeypatch):
    monkeypatch.setenv("WIZARD_SANDBOX_GATE_URL", f"http://127.0.0.1:{_free_port()}")
    with pytest.raises(SandboxNotConfiguredError):
        SandboxRunner().status("any")


def test_injected_clients_and_the_gate_itself_talk_to_the_cluster(monkeypatch):
    """The gate must never forward to a gate, and the tests' fake clients stay local."""
    monkeypatch.setenv("WIZARD_SANDBOX_GATE_URL", "http://127.0.0.1:1")
    assert SandboxRunner(local=True)._gate is None
    assert SandboxRunner(batch=object(), core=object())._gate is None
    assert SandboxRunner()._gate is not None
    monkeypatch.delenv("WIZARD_SANDBOX_GATE_URL")
    assert sandbox_runner.gate_url() is None
    assert SandboxRunner()._gate is None
