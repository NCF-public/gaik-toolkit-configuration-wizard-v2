"""#141 — the agent's on-disk artifacts reach the session the UI reads."""

import json
import os
import uuid

from helpers import requires_postgres
from wizard_api.services import artifact_sync, session_service

DRAFT = {
    "use_case": {
        "id": "incident_reports",
        "name": "Incident report generation",
        "description": "Turn maintenance notes into structured incident reports.",
        "domain": "maintenance",
    },
    "business_spec": {
        "current_process": "Technicians write free-form notes.",
        "poc_goal": "Show that a report can be produced from one note.",
    },
    "technical_spec": {"integration_targets": ["Maximo"]},
    "target_output_spec": {
        "schema_name": "IncidentReport",
        "fields": ["asset_id", "severity", "summary"],
        "field_types": {"asset_id": "str", "severity": "str", "summary": "str"},
        "required_fields": ["asset_id", "severity"],
        "optional_fields": ["summary"],
        "field_descriptions": {"asset_id": "Asset the incident concerns"},
        "allowed_values": {"severity": ["low", "high"]},
        "missing_value_policy": "leave_empty",
        "validation_rules": ["asset_id matches ^A-[0-9]+$"],
    },
    "workflow": {
        "steps": [
            {"id": "collect", "name": "Collect note", "type": "user_task"},
            {
                "id": "extract",
                "name": "Extract fields",
                "type": "automated_task",
                "component": "StructuredDataExtractor",
                "parameters": {"schema_ref": "schemas/output_schema.py", "retries": 2},
            },
            {"id": "review", "name": "Technician review", "type": "human_review"},
            {"id": "branch", "name": "Severity check", "type": "decision"},
        ]
    },
    "assumptions": [{"id": "a1", "text": "Notes are in Finnish", "status": "unconfirmed"}],
}


def write_draft(tmp_path, draft) -> str:
    path = os.path.join(tmp_path, artifact_sync.DRAFT_BLUEPRINT_FILE)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(draft, fh)
    return str(tmp_path)


def test_reads_the_draft_and_maps_it_to_the_v2_blueprint(tmp_path) -> None:
    output_dir = write_draft(tmp_path, DRAFT)
    draft = artifact_sync.read_draft_blueprint(output_dir)
    assert draft is not None

    blueprint = artifact_sync.blueprint_from_draft(draft)
    assert blueprint is not None
    assert blueprint.name == "Incident report generation"
    assert blueprint.goal.startswith("Show that a report")
    assert blueprint.integration_targets == ["Maximo"]

    # V1 step types map onto the three V2 types; `decision` has no V2
    # equivalent and must still appear rather than vanish from the flow.
    assert [(s["id"], s["type"]) for s in blueprint.steps] == [
        ("collect", "io"),
        ("extract", "ai"),
        ("review", "human_review"),
        ("branch", "ai"),
    ]
    extract = blueprint.steps[1]
    assert extract["component"] == "StructuredDataExtractor"
    # Parameters become the settings the SME asked to see (SME-4), stringified.
    assert extract["settings"] == {"schema_ref": "schemas/output_schema.py", "retries": "2"}


def test_missing_or_malformed_draft_is_not_fatal(tmp_path) -> None:
    assert artifact_sync.read_draft_blueprint(str(tmp_path)) is None
    assert artifact_sync.read_draft_blueprint("") is None

    half_written = os.path.join(tmp_path, artifact_sync.DRAFT_BLUEPRINT_FILE)
    with open(half_written, "w", encoding="utf-8") as fh:
        fh.write('{"use_case": {"name": "Incid')
    assert artifact_sync.read_draft_blueprint(str(tmp_path)) is None


def test_a_draft_without_a_workflow_does_not_replace_the_blueprint(tmp_path) -> None:
    # Early drafts carry business framing only; adopting one would wipe the
    # blueprint to an empty flow.
    output_dir = write_draft(tmp_path, {"use_case": {"name": "Early"}, "business_spec": {}})
    draft = artifact_sync.read_draft_blueprint(output_dir)
    assert artifact_sync.blueprint_from_draft(draft) is None


def test_target_output_spec_comes_from_the_draft(tmp_path) -> None:
    draft = artifact_sync.read_draft_blueprint(write_draft(tmp_path, DRAFT))
    spec = artifact_sync.target_output_spec_from_draft(draft)
    assert spec is not None
    assert spec.schema_name == "IncidentReport"
    assert spec.fields == ["asset_id", "severity", "summary"]
    assert spec.required_fields == ["asset_id", "severity"]
    assert spec.allowed_values == {"severity": ["low", "high"]}
    assert spec.missing_value_policy == "leave_empty"

    # No fields agreed yet → nothing to show.
    empty = artifact_sync.read_draft_blueprint(
        write_draft(tmp_path, {"target_output_spec": {"schema_name": "X"}})
    )
    assert artifact_sync.target_output_spec_from_draft(empty) is None


@requires_postgres
def test_chat_turn_adopts_the_draft_blueprint(client, db_session) -> None:
    created = client.post("/sessions", json={"user_id": "sync-user", "title": "Seeded"}).json()
    session_id = created["id"]
    assert created["blueprint"]["steps"][0]["id"] == "input"  # seed blueprint
    assert created["active_version"] == 1

    session = session_service.get_session(db_session, uuid.UUID(session_id))
    write_draft(session.output_dir, DRAFT)

    assert artifact_sync.sync_blueprint_from_draft(db_session, session) is True

    detail = client.get(f"/sessions/{session_id}").json()
    assert detail["active_version"] == 2
    assert detail["blueprint"]["name"] == "Incident report generation"
    assert [s["id"] for s in detail["blueprint"]["steps"]] == [
        "collect",
        "extract",
        "review",
        "branch",
    ]
    # The Specification view's field schema and Gate 1's framing come from the
    # same draft, so they arrive with it.
    assert detail["target_output_spec"]["schema_name"] == "IncidentReport"
    assert detail["business_context"]["current_process"].startswith("Technicians")

    # An unchanged draft must not add a version per chat turn.
    assert artifact_sync.sync_blueprint_from_draft(db_session, session) is False
    assert client.get(f"/sessions/{session_id}").json()["active_version"] == 2


def test_business_values_written_as_one_string_are_kept() -> None:
    """The blueprint template gives expected_value as a list, but the agent
    sometimes writes one sentence as a plain string. Dropping it left Gate 1
    saying "Puuttuu: Odotettu arvo" with the approve button disabled, while the
    conversation had answered it (found in a live UC02 run)."""
    ctx = session_service._business_context_from_draft(
        {
            "business_spec": {
                "expected_value": "Faster, more consistent order entry.",
                "pain_points": ["Manual entry is slow", "  "],
                "reviewers": "  ",
            }
        }
    )
    assert ctx is not None
    assert ctx.expected_value == ["Faster, more consistent order entry."]
    assert ctx.pain_points == ["Manual entry is slow"]
    assert ctx.reviewers == []


# ---------------------------------------------------------------------------
# The step follows the agent after Gate 1 (#169)
# ---------------------------------------------------------------------------


def _touch(root, relative: str) -> None:
    path = os.path.join(root, relative)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("x")


def test_the_artifacts_say_which_step_the_agent_has_reached(tmp_path) -> None:
    assert artifact_sync.step_reached(str(tmp_path)) is None

    bare = {**DRAFT, "workflow": {"steps": [{"id": "collect", "name": "Collect note"}]}}
    root = write_draft(tmp_path, bare)
    assert artifact_sync.step_reached(root) == artifact_sync.STEP_GATE_1

    _touch(root, "poc/schemas/output_schema_requirements.json")
    assert artifact_sync.step_reached(root) == artifact_sync.STEP_AFTER_SCHEMA

    write_draft(tmp_path, DRAFT)  # a step now names a component
    assert artifact_sync.step_reached(root) == artifact_sync.STEP_AFTER_COMPONENTS

    _touch(root, artifact_sync.WORKFLOW_BPMN_FILE)
    assert artifact_sync.step_reached(root) == artifact_sync.STEP_GATE_2

    _touch(root, "poc/run_poc.py")
    assert artifact_sync.step_reached(root) == artifact_sync.STEP_POC


@requires_postgres
def test_the_session_step_follows_the_agent_but_waits_at_a_pending_gate(client, db_session) -> None:
    from wizard_api.routers.sessions import _sync_artifacts_and_advance

    created = client.post("/sessions", json={"user_id": "follow", "title": "Follow"}).json()
    session_id = created["id"]
    client.patch(f"/sessions/{session_id}", json={"gate_statuses": {"gate_1": "approved"}})
    client.patch(f"/sessions/{session_id}", json={"step": 5})
    session = session_service.get_session(db_session, uuid.UUID(session_id))

    # The agent has chosen components and drawn the BPMN: the session goes to Gate 2.
    root = write_draft(session.output_dir, DRAFT)
    _touch(root, artifact_sync.WORKFLOW_BPMN_FILE)
    _sync_artifacts_and_advance(db_session, session)
    assert client.get(f"/sessions/{session_id}").json()["step"] == 9

    # It writes the package too, but Gate 2 is pending: the session waits on the gate.
    _touch(root, "poc/run_poc.py")
    _sync_artifacts_and_advance(db_session, session)
    detail = client.get(f"/sessions/{session_id}").json()
    assert detail["step"] == 9
    assert detail["metadata"]["agent_step"] == 10

    # The user approves Gate 2, moves on, then steps back to review components.
    client.patch(f"/sessions/{session_id}", json={"gate_statuses": {"gate_2": "approved"}})
    client.patch(f"/sessions/{session_id}", json={"step": 6})
    db_session.refresh(session)
    # Nothing new from the agent: another turn must not push the user forward.
    _sync_artifacts_and_advance(db_session, session)
    assert client.get(f"/sessions/{session_id}").json()["step"] == 6


@requires_postgres
def test_gathering_still_ends_at_gate_1(client, db_session) -> None:
    from wizard_api.routers.sessions import _sync_artifacts_and_advance

    created = client.post("/sessions", json={"user_id": "follow", "title": "Gate 1"}).json()
    session = session_service.get_session(db_session, uuid.UUID(created["id"]))
    root = write_draft(session.output_dir, DRAFT)
    _touch(root, artifact_sync.WORKFLOW_BPMN_FILE)  # even with more artifacts already there

    _sync_artifacts_and_advance(db_session, session)

    # Gate 1 is pending, so the session stops on it whatever the agent has written.
    assert client.get(f"/sessions/{created['id']}").json()["step"] == 4
