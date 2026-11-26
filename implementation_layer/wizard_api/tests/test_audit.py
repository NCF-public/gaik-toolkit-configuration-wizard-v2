"""Audit events (wizard_api.audit): what each one carries, and what it never carries.

Read through an in-memory log exporter in place of the collector: the class,
the name, the outcome, the owner id and the session, and no e-mail address,
title or other text in any record.
"""

import json
import uuid

import pytest
from helpers import requires_postgres, write_gate_artifacts
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.sdk._logs.export import InMemoryLogRecordExporter, SimpleLogRecordProcessor
from wizard_api import audit, owner_id, session_admin, telemetry
from wizard_api.models import WizardSession
from wizard_api.ownership import USER_HEADER
from wizard_api.security import SERVICE_TOKEN_HEADER
from wizard_api.services import session_service, usage_caps

OWNER = owner_id.owner_id("alice@example.test", "k")
OTHER = owner_id.owner_id("bob@example.test", "k")
TITLE = "Alice's secret plan"


@pytest.fixture
def records(monkeypatch):
    exporter = InMemoryLogRecordExporter()
    provider = LoggerProvider()
    provider.add_log_record_processor(SimpleLogRecordProcessor(exporter))
    monkeypatch.setattr(telemetry, "_log_provider", provider)

    def read(name: str | None = None) -> list[dict]:
        out = []
        for data in exporter.get_finished_logs():
            attrs = dict(data.log_record.attributes or {})
            if name is None or attrs.get(audit.EVENT_NAME) == name:
                out.append(attrs)
        return out

    yield read
    provider.shutdown()


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setenv("WIZARD_SESSION_OUTPUT_ROOT", str(tmp_path))
    monkeypatch.delenv("WIZARD_AGENT_STATE_DIR", raising=False)
    return tmp_path


def _create(client, user: str) -> str:
    res = client.post(
        "/sessions", json={"user_id": user, "title": TITLE}, headers={USER_HEADER: user}
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _no_personal_text(rows: list[dict]) -> None:
    text = json.dumps(rows)
    assert "@" not in text
    assert TITLE not in text


def test_an_event_carries_the_envelope_and_known_fields_only(records) -> None:
    session = uuid.uuid4()
    audit.event(
        "session.delete",
        audit.SUCCESS,
        {"gaik.audit.reason": "owner", "gaik.title": TITLE, "gaik.cost.usd": 0.1234567},
        owner=OWNER,
        session_id=session,
    )
    (row,) = records("session.delete")
    assert row[audit.EVENT_CLASS] == "audit"
    assert row[audit.OUTCOME] == "success"
    assert row[audit.ACTOR] == OWNER
    assert row[audit.SESSION] == str(session)
    assert row["gaik.audit.reason"] == "owner"
    assert row["gaik.cost.usd"] == 0.123457
    assert "gaik.title" not in row
    assert row[audit.REQUEST_ID]


def test_an_address_or_long_text_never_goes_out(records) -> None:
    audit.event(
        "session.create",
        audit.SUCCESS,
        {"gaik.audit.reason": "alice@example.test", "gaik.gate": "x" * 65},
        owner="alice@example.test",  # a session from before owner ids
    )
    (row,) = records("session.create")
    assert audit.ACTOR not in row
    assert "gaik.audit.reason" not in row and "gaik.gate" not in row
    _no_personal_text([row])


def test_an_unknown_outcome_is_not_sent_and_does_not_raise(records) -> None:
    audit.event("session.create", "maybe")
    assert records() == []


def test_without_a_logs_endpoint_nothing_is_sent(monkeypatch, caplog) -> None:
    monkeypatch.setattr(telemetry, "_log_provider", None)
    assert telemetry.audit_logger() is None
    with caplog.at_level("INFO", logger="wizard_api.audit"):
        audit.event("session.create", audit.SUCCESS, owner=OWNER)
    # Only the pod's line: nothing to send it through, and no error.
    assert [r.getMessage() for r in caplog.records] == ["audit session.create success"]


def test_a_session_id_in_any_form_is_sent_in_one_form(records) -> None:
    session = uuid.uuid4()
    audit.event("session.delete", audit.SUCCESS, session_id=session.hex.upper())
    audit.event("session.delete", audit.SUCCESS, session_id=f"{{{session}}}")
    assert {r[audit.SESSION] for r in records("session.delete")} == {str(session)}


@requires_postgres
def test_creating_denying_and_deleting_a_session_are_audited(client, root, records) -> None:
    session_id = _create(client, OWNER)
    (created,) = records("session.create")
    assert created[audit.ACTOR] == OWNER and created[audit.SESSION] == session_id
    assert created[audit.OUTCOME] == "success"

    assert client.get(f"/sessions/{session_id}", headers={USER_HEADER: OTHER}).status_code == 404
    (denied,) = records("authz.denied")
    assert denied[audit.ACTOR] == OTHER  # who asked, not whose it is
    assert denied[audit.SESSION] == session_id
    assert denied["gaik.audit.reason"] == "not_owner"

    res = client.delete(f"/sessions/{session_id}?reason=retention", headers={USER_HEADER: OWNER})
    assert res.status_code == 204
    (deleted,) = records("session.delete")
    assert deleted[audit.ACTOR] == OWNER and deleted[audit.SESSION] == session_id
    assert deleted["gaik.audit.reason"] == "retention"
    _no_personal_text(records())


@requires_postgres
def test_a_session_over_the_limit_is_audited_as_denied(client, root, records, monkeypatch) -> None:
    monkeypatch.setenv("WIZARD_MAX_SESSIONS_PER_USER", "1")
    _create(client, OWNER)
    res = client.post(
        "/sessions", json={"user_id": OWNER, "title": TITLE}, headers={USER_HEADER: OWNER}
    )
    assert res.status_code == 429
    refused = [r for r in records("session.create") if r[audit.OUTCOME] == "denied"]
    assert [r["gaik.audit.reason"] for r in refused] == ["session_limit"]
    assert refused[0][audit.ACTOR] == OWNER


@requires_postgres
def test_a_gate_approval_is_audited_refused_and_given(client, db_session, root, records) -> None:
    session_id = _create(client, OWNER)
    approve = {"gate_statuses": {"gate_1": "approved"}}

    def patch():
        return client.patch(f"/sessions/{session_id}", json=approve, headers={USER_HEADER: OWNER})

    assert patch().status_code == 409  # no specification yet
    row = db_session.get(WizardSession, uuid.UUID(session_id))
    write_gate_artifacts(row.output_dir, "gate_1")
    assert patch().status_code == 200

    refused, given = records("gate.change")
    for event in (refused, given):
        assert event["gaik.gate"] == "gate_1" and event["gaik.gate.from"] == "pending"
        assert event["gaik.gate.to"] == "approved" and event["gaik.gate.by"] == "user"
        assert event[audit.ACTOR] == OWNER and event[audit.SESSION] == session_id
    assert refused[audit.OUTCOME] == "denied" and refused["gaik.audit.reason"] == "gate_not_ready"
    assert given[audit.OUTCOME] == "success" and "gaik.audit.reason" not in given


@requires_postgres
def test_every_turns_cost_is_audited_with_its_owner_session_and_totals(
    db_session, records, monkeypatch
) -> None:
    row = WizardSession(user_id=OWNER, output_dir="/tmp/x", session_metadata={})
    db_session.add(row)
    db_session.commit()

    usage_caps.record_cost(db_session, OWNER, 1.25, session=row)
    usage_caps.record_cost(db_session, OWNER, 0.5, session=row)

    costs = records("usage.cost")
    assert [r["gaik.cost.usd"] for r in costs] == [1.25, 0.5]
    assert costs[-1]["gaik.cost.session_total_usd"] == pytest.approx(1.75)
    assert costs[-1]["gaik.cost.user_total_usd"] == pytest.approx(1.75)
    assert costs[-1]["gaik.cost.deployment_total_usd"] == pytest.approx(1.75)
    assert all(r[audit.ACTOR] == OWNER and r[audit.SESSION] == str(row.id) for r in costs)


@requires_postgres
def test_a_reached_cap_is_audited(db_session, records, monkeypatch) -> None:
    monkeypatch.setenv("WIZARD_USER_MAX_COST_USD", "1")
    row = WizardSession(user_id=OWNER, output_dir="/tmp/x", session_metadata={})
    db_session.add(row)
    db_session.commit()
    usage_caps.record_cost(db_session, OWNER, 1.0, session=row)
    with pytest.raises(usage_caps.UsageCapError):
        usage_caps.caps_left(db_session, row)
    (reached,) = records("usage.cap_reached")
    assert reached["gaik.audit.reason"] == "user" and reached[audit.ACTOR] == OWNER


def test_a_rejected_service_token_is_audited(api_client, records, monkeypatch) -> None:
    monkeypatch.setenv("WIZARD_API_TOKEN", "the-token")
    assert api_client.get("/sessions", headers={SERVICE_TOKEN_HEADER: "wrong"}).status_code == 401
    (row,) = records("auth.token_rejected")
    assert row[audit.OUTCOME] == "denied" and row["gaik.audit.reason"] == "bad_token"
    assert row["gaik.http.method"] == "GET"


def test_a_rejected_token_is_not_filed_under_the_owner_it_names(api_client, records, monkeypatch):
    monkeypatch.setenv("WIZARD_API_TOKEN", "the-token")
    session = str(uuid.uuid4())
    res = api_client.get(
        f"/sessions/{session}", headers={SERVICE_TOKEN_HEADER: "wrong", USER_HEADER: OWNER}
    )
    assert res.status_code == 401
    (row,) = records("auth.token_rejected")
    assert audit.ACTOR not in row and audit.SESSION not in row


def test_an_upload_refusal_is_audited_without_the_file(records) -> None:
    from wizard_api import errors

    errors._count_refusal("input_unsafe", 422)
    errors._count_refusal("not_found", 404)
    (row,) = records("upload.refused")
    assert row["gaik.audit.reason"] == "input_unsafe"


def test_an_operator_command_is_audited_without_the_address(records, monkeypatch, capsys) -> None:
    monkeypatch.setattr(telemetry, "shutdown", lambda: None)
    monkeypatch.setenv("WIZARD_PSEUDONYM_KEY", "k")
    session_admin.main(["owner-id", "alice@example.test"])
    assert capsys.readouterr().out.strip() == OWNER
    (row,) = records("operator.session_admin")
    assert row["gaik.operator.command"] == "owner-id" and row[audit.OUTCOME] == "success"
    _no_personal_text([row])


def test_a_failed_operator_command_is_audited_as_an_error(records, monkeypatch) -> None:
    monkeypatch.setattr(telemetry, "shutdown", lambda: None)
    monkeypatch.setattr(session_admin, "delete", lambda *a: (_ for _ in ()).throw(SystemExit(1)))
    session_id = str(uuid.uuid4())
    with pytest.raises(SystemExit):
        session_admin.main(["delete", session_id, "--reason", "data-subject-request"])
    (row,) = records("operator.session_admin")
    assert row[audit.OUTCOME] == "error"
    assert row["gaik.audit.reason"] == "data-subject-request"
    assert row[audit.SESSION] == session_id


@requires_postgres
def test_a_reopened_gate_is_audited_with_who_reopened_it(db_session, records, tmp_path) -> None:
    row = WizardSession(
        user_id=OWNER,
        output_dir=str(tmp_path),
        session_metadata={},
        gate_statuses={"gate_1": "approved"},
    )
    db_session.add(row)
    db_session.commit()
    session_service.reopen_gate(db_session, row, "gate_1", by="agent")
    (reopened,) = records("gate.change")
    assert reopened["gaik.gate"] == "gate_1" and reopened["gaik.gate.from"] == "approved"
    assert reopened["gaik.gate.to"] == "pending" and reopened["gaik.gate.by"] == "agent"
    assert reopened[audit.ACTOR] == OWNER and reopened[audit.SESSION] == str(row.id)


def test_a_sandbox_start_names_its_session_and_no_run(records) -> None:
    session = uuid.uuid4()

    @telemetry.sandbox_start_span("run")
    def start(session_id):
        return {"run_id": str(uuid.uuid4())}

    run_id = start(session_id=session)["run_id"]
    (row,) = records("sandbox.start")
    assert row["gaik.sandbox.kind"] == "run" and row[audit.SESSION] == str(session)
    assert run_id not in json.dumps(row)
