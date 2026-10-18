"""The agent sees the latest PoC run, so Gate 3's run → feedback → fix loop can work (#96).

Customer test feedback (October 2026): the wizard "cannot see the sandbox output or
the generated PDF, so it fails to validate the PoC", and refining it was a struggle.
"""

import asyncio
import base64
import json
import os
import uuid

import pytest
from helpers import requires_postgres
from wizard_api.schemas.session import SessionUpdate
from wizard_api.services import agent_service, run_context, sandbox_runner, session_service
from wizard_api.services.sandbox_runner import RunStatus

_PDF = b"%PDF-1.4\n\x00binary\n%%EOF"


def _log(run_id: str, *, failed: bool) -> str:
    encoded = base64.b64encode(_PDF).decode()
    lines = ["Processing invoice.pdf"]
    if failed:
        lines += ["Traceback (most recent call last):", "KeyError: 'total_amount'"]
    lines += [
        f"=== POC OUTPUT BEGIN === {run_id}",
        f"--- output/result.json --- {run_id}",
        '{"supplier": "Testitoimittaja Oy"}',
        f"=== POC OUTPUT END === {run_id}",
        f"=== POC FILES BEGIN === {run_id}",
        f"--- file report.pdf {len(_PDF)} --- {run_id}",
        encoded,
        f"=== POC FILES END === {run_id}",
    ]
    return "\n".join(lines)


def test_a_finished_run_is_copied_for_the_agent_and_named_in_one_line(tmp_path) -> None:
    status = RunStatus(run_id="run-1", phase="failed", exit_code=1)
    line = run_context.collect(str(tmp_path), "run-1", status, _log("run-1", failed=True))

    dest = tmp_path / "runs" / "run-1"
    assert (dest / "output" / "report.pdf").read_bytes() == _PDF
    assert json.loads((dest / "output" / "result.json").read_text()) == {
        "supplier": "Testitoimittaja Oy"
    }
    assert "KeyError: 'total_amount'" in (dest / "log.txt").read_text()
    summary = json.loads((dest / "run.json").read_text())
    assert summary["phase"] == "failed"
    assert summary["failure_reason"] == "KeyError: 'total_amount'"
    assert summary["files"] == ["report.pdf", "result.json"]

    assert line.startswith("[PoC sandbox run run-1 failed: KeyError: 'total_amount'.")
    assert "report.pdf, result.json" in line
    assert "runs/run-1/" in line


def test_a_succeeded_run_says_so_without_a_reason(tmp_path) -> None:
    status = RunStatus(run_id="run-2", phase="succeeded", exit_code=0)
    line = run_context.collect(str(tmp_path), "run-2", status, _log("run-2", failed=False))
    assert line.startswith("[PoC sandbox run run-2 succeeded. It produced report.pdf, result.json.")


def test_a_run_id_with_a_path_in_it_is_refused(tmp_path) -> None:
    with pytest.raises(ValueError):
        run_context.run_dir(str(tmp_path), "../escape")


class _Runner:
    """A sandbox with one run of one session; phase and log set per test."""

    owner = ""
    phase = "failed"
    log = ""

    def __init__(self, *args, **kwargs):
        pass

    def status(self, run_id, *, session_id=None):
        if session_id is not None and session_id != self.owner:
            raise sandbox_runner.RunNotFoundError(run_id)
        return RunStatus(run_id=run_id, phase=self.phase, exit_code=None)

    def read_log(self, run_id):
        return self.log


def _fake_agent(monkeypatch, seen: list[str]) -> None:
    async def fake_get_or_create_session(session_id, output_dir, locale=None, **kwargs):
        return {"lock": asyncio.Lock()}

    async def fake_stream_turn_for(agent, message, parts):
        seen.append(message)
        parts.append("Luin ajon tuloksen.")
        yield agent_service.sse({"text": "Luin ajon tuloksen."})

    monkeypatch.setattr(agent_service, "get_or_create_session", fake_get_or_create_session)
    monkeypatch.setattr(agent_service, "stream_turn_for", fake_stream_turn_for)


@requires_postgres
def test_the_next_message_after_a_run_carries_it_once(client, db_session, monkeypatch) -> None:
    seen: list[str] = []
    _fake_agent(monkeypatch, seen)
    created = client.post("/sessions", json={"user_id": "refine", "title": "Refine"}).json()
    sid = created["id"]
    session = session_service.get_session(db_session, uuid.UUID(sid))
    session_service.update_session(
        db_session, session, SessionUpdate(metadata={"latest_run": "run-7"})
    )
    runner = type("R", (_Runner,), {"owner": sid, "phase": "running", "log": ""})
    monkeypatch.setattr(sandbox_runner, "SandboxRunner", runner)

    # Still running: mentioned, not marked as told.
    client.post(f"/sessions/{sid}/chat", json={"message": "Miten ajo menee?"})
    assert "run-7 is still running" in seen[-1]
    assert "agent_seen_run" not in client.get(f"/sessions/{sid}").json()["metadata"]

    # Finished: the line sits between the state line and the user's message.
    runner.phase, runner.log = "failed", _log("run-7", failed=True)
    client.post(f"/sessions/{sid}/chat", json={"message": "Summa puuttuu."})
    state, note, rest = seen[-1].split("\n", 2)
    assert state.startswith("[Session state:")
    assert note.startswith("[PoC sandbox run run-7 failed: KeyError: 'total_amount'.")
    assert rest == "\nSumma puuttuu."
    assert os.path.isfile(
        os.path.join(created["output_dir"], "runs", "run-7", "output", "report.pdf")
    )
    detail = client.get(f"/sessions/{sid}").json()
    assert detail["metadata"]["agent_seen_run"] == "run-7"
    assert detail["metadata"]["messages"][-2]["content"] == "Summa puuttuu."

    # Told once.
    client.post(f"/sessions/{sid}/chat", json={"message": "Korjaa se."})
    assert "PoC sandbox run" not in seen[-1]


@requires_postgres
def test_a_run_that_cannot_be_read_does_not_break_the_chat(client, db_session, monkeypatch) -> None:
    seen: list[str] = []
    _fake_agent(monkeypatch, seen)
    sid = client.post("/sessions", json={"user_id": "refine", "title": "R"}).json()["id"]
    session = session_service.get_session(db_session, uuid.UUID(sid))
    session_service.update_session(
        db_session, session, SessionUpdate(metadata={"latest_run": "run-8"})
    )
    runner = type("R", (_Runner,), {"owner": "someone-else"})
    monkeypatch.setattr(sandbox_runner, "SandboxRunner", runner)

    res = client.post(f"/sessions/{sid}/chat", json={"message": "Hei"})
    assert res.status_code == 200
    assert "PoC sandbox run" not in seen[-1]


@requires_postgres
def test_the_run_keys_are_the_servers_own(client) -> None:
    sid = client.post("/sessions", json={"user_id": "refine", "title": "K"}).json()["id"]
    for key in ("latest_run", "agent_seen_run"):
        refused = client.patch(f"/sessions/{sid}", json={"metadata": {key: "run-x"}})
        assert refused.status_code == 422
