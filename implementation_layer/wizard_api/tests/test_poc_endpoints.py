"""PoC package endpoints (#151): listing and zip download."""

import io
import os
import uuid
import zipfile

from helpers import requires_postgres
from wizard_api.services import session_service


def _session_output_dir(db_session, session_id: str) -> str:
    session = session_service.get_session(db_session, uuid.UUID(session_id))
    return session.output_dir


def _write_poc(output_dir: str) -> None:
    """Stand in for the V1 Phase 10 scaffolder."""
    poc = os.path.join(output_dir, "poc")
    os.makedirs(os.path.join(poc, "schemas"), exist_ok=True)
    with open(os.path.join(poc, "run.py"), "w", encoding="utf-8") as fh:
        fh.write("print('poc')\n")
    with open(os.path.join(poc, "schemas", "output_schema.json"), "w", encoding="utf-8") as fh:
        fh.write("{}\n")


@requires_postgres
def test_poc_files_reports_nothing_until_the_scaffolder_has_run(client, db_session) -> None:
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "PoC"}).json()

    listed = client.get(f"/sessions/{created['id']}/poc/files")
    assert listed.status_code == 200
    assert listed.json() == {"generated": False, "files": []}

    # And the download says 404 rather than handing back an empty archive.
    assert client.get(f"/sessions/{created['id']}/poc").status_code == 404


@requires_postgres
def test_poc_files_and_zip_expose_the_generated_package(client, db_session) -> None:
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "PoC"}).json()
    session_id = created["id"]
    _write_poc(_session_output_dir(db_session, session_id))

    listed = client.get(f"/sessions/{session_id}/poc/files").json()
    assert listed["generated"] is True
    assert listed["files"] == ["run.py", "schemas/output_schema.json"]

    got = client.get(f"/sessions/{session_id}/poc")
    assert got.status_code == 200
    assert got.headers["content-type"] == "application/zip"
    assert f"poc-{session_id}.zip" in got.headers["content-disposition"]

    # Entries keep the poc/ prefix so the archive unpacks into its own folder.
    with zipfile.ZipFile(io.BytesIO(got.content)) as zf:
        assert sorted(zf.namelist()) == ["poc/run.py", "poc/schemas/output_schema.json"]
        assert zf.read("poc/run.py") == b"print('poc')\n"


@requires_postgres
def test_poc_endpoints_404_for_an_unknown_session(client) -> None:
    missing = uuid.uuid4()
    assert client.get(f"/sessions/{missing}/poc/files").status_code == 404
    assert client.get(f"/sessions/{missing}/poc").status_code == 404


# ---------------------------------------------------------------------------
# #93 — generating the package from the session's blueprint
# ---------------------------------------------------------------------------

import json  # noqa: E402

import pytest  # noqa: E402
from wizard_api.services import artifact_sync, poc_service  # noqa: E402

requires_scaffolder = pytest.mark.skipif(
    not poc_service.solution_wizard_available(),
    reason="solution_wizard is not installed",
)

#: The output the user agreed at the Specification step. The agent writes it to
#: the draft blueprint; the V2 blueprint in the database does not carry it.
_AGREED_SPEC = {
    "schema_name": "IncidentReport",
    "fields": ["incident_id", "severity", "summary"],
    "field_types": {"incident_id": "str", "severity": "str", "summary": "str"},
    "required_fields": ["incident_id", "severity"],
    "optional_fields": ["summary"],
    "allowed_values": {"severity": ["low", "high"]},
}


def _write_draft(output_dir: str, spec: dict) -> None:
    path = artifact_sync.artifact_path(output_dir, artifact_sync.DRAFT_BLUEPRINT_FILE)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"target_output_spec": spec}, fh)


@requires_postgres
@requires_scaffolder
def test_generate_produces_the_v1_scaffolder_file_set(client, db_session) -> None:
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "PoC"}).json()
    session_id = created["id"]

    generated = client.post(f"/sessions/{session_id}/poc/generate")
    assert generated.status_code == 200
    body = generated.json()
    assert body["generated"] is True
    assert body["regenerated"] is False

    # The same set scaffold_poc writes — the endpoint adds nothing of its own
    # beyond the manifest, which is hidden from the listing.
    assert set(body["files"]) == {
        ".env.example",
        "README.md",
        "config.yaml",
        "evals/ground_truth/.gitkeep",
        "evals/run_basic_eval.py",
        "prompts/extraction_requirements.md",
        "requirements.txt",
        "run_poc.py",
        "schemas/output_schema.json",
        "schemas/output_schema.py",
        "schemas/output_schema_requirements.json",
    }

    # And the package is immediately visible to the endpoints that serve it.
    listed = client.get(f"/sessions/{session_id}/poc/files").json()
    assert listed["generated"] is True
    assert "run_poc.py" in listed["files"]
    assert poc_service.MANIFEST_NAME not in listed["files"]
    assert client.get(f"/sessions/{session_id}/poc").status_code == 200


@requires_postgres
@requires_scaffolder
def test_generated_schema_uses_the_agreed_output_fields(client, db_session) -> None:
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "Incidents"}).json()
    session_id = created["id"]
    output_dir = _session_output_dir(db_session, session_id)
    _write_draft(output_dir, _AGREED_SPEC)

    client.post(f"/sessions/{session_id}/poc/generate")

    schema = open(
        os.path.join(output_dir, "poc", "schemas", "output_schema.py"), encoding="utf-8"
    ).read()
    # Without the override the V2 → V1 adapter hands the scaffolder a
    # placeholder ("Output" with a single "result" field), so every PoC would
    # ship a dummy schema instead of the one the user agreed to.
    assert "class IncidentReport(BaseModel):" in schema
    assert "incident_id" in schema and "severity" in schema
    assert "class Output(BaseModel):" not in schema


@requires_postgres
@requires_scaffolder
def test_regenerating_after_a_blueprint_change_is_not_a_silent_no_op(client, db_session) -> None:
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "Incidents"}).json()
    session_id = created["id"]
    output_dir = _session_output_dir(db_session, session_id)
    _write_draft(output_dir, _AGREED_SPEC)

    client.post(f"/sessions/{session_id}/poc/generate")
    schema_path = os.path.join(output_dir, "poc", "schemas", "output_schema.py")
    before = open(schema_path, encoding="utf-8").read()
    assert "class IncidentReport(BaseModel):" in before

    # The user reworks the agreed output and the PoC is generated again.
    _write_draft(
        output_dir,
        {
            "schema_name": "ServiceRequest",
            "fields": ["request_id", "channel"],
            "field_types": {"request_id": "str", "channel": "str"},
            "required_fields": ["request_id", "channel"],
        },
    )
    again = client.post(f"/sessions/{session_id}/poc/generate")
    assert again.status_code == 200
    assert again.json()["regenerated"] is True
    assert again.json()["blueprint_changed"] is True

    after = open(schema_path, encoding="utf-8").read()
    # scaffold_poc leaves an existing output_schema.py alone so a schema the
    # user reviewed mid-conversation survives. That guard would freeze our own
    # output too, which is exactly the no-op this test forbids.
    assert "class ServiceRequest(BaseModel):" in after
    assert "class IncidentReport(BaseModel):" not in after


@requires_postgres
@requires_scaffolder
def test_regenerating_keeps_sample_inputs_and_earlier_results(client, db_session) -> None:
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "PoC"}).json()
    session_id = created["id"]
    output_dir = _session_output_dir(db_session, session_id)

    client.post(f"/sessions/{session_id}/poc/generate")
    poc = os.path.join(output_dir, "poc")
    with open(os.path.join(poc, "sample_input", "case.txt"), "w", encoding="utf-8") as fh:
        fh.write("a real input the user dropped in\n")
    with open(os.path.join(poc, "output", "result.json"), "w", encoding="utf-8") as fh:
        fh.write('{"from": "an earlier run"}\n')

    client.post(f"/sessions/{session_id}/poc/generate")

    assert open(os.path.join(poc, "sample_input", "case.txt"), encoding="utf-8").read()
    assert open(os.path.join(poc, "output", "result.json"), encoding="utf-8").read()


@requires_postgres
def test_generate_404s_for_an_unknown_session(client) -> None:
    assert client.post(f"/sessions/{uuid.uuid4()}/poc/generate").status_code == 404


@requires_postgres
@requires_scaffolder
def test_generate_never_overwrites_the_agents_own_package(client, db_session) -> None:
    """The agent wires the real GAIK component for the case's own pattern and can
    add synthetic test data and an eval rubric. Scaffolding over that would trade
    a working, case-specific PoC for a generic template (found while reviewing a
    live use-case run: every generated PoC was pattern-specific, none generic)."""
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "UC04"}).json()
    session_id = created["id"]
    output_dir = _session_output_dir(db_session, session_id)

    agent_run = (
        '"""UC04 extraction PoC — written by the agent."""\n'
        "from gaik.software_components.extractor import DataExtractor\n"
        "extractor = DataExtractor(schema=IncidentReport)\n"
    )
    poc = os.path.join(output_dir, "poc")
    os.makedirs(poc, exist_ok=True)
    with open(os.path.join(poc, "run_poc.py"), "w", encoding="utf-8") as fh:
        fh.write(agent_run)

    body = client.post(f"/sessions/{session_id}/poc/generate").json()
    assert body["source"] == "agent"
    assert body["scaffolded"] is False
    assert body["files"] == ["run_poc.py"]

    # Untouched: still the agent's wiring, not the generic template.
    with open(os.path.join(poc, "run_poc.py"), encoding="utf-8") as fh:
        assert fh.read() == agent_run

    # force=true is the deliberate escape hatch when the blueprint has moved on.
    forced = client.post(f"/sessions/{session_id}/poc/generate?force=true").json()
    assert forced["source"] == "scaffolder"
    assert forced["scaffolded"] is True
    with open(os.path.join(poc, "run_poc.py"), encoding="utf-8") as fh:
        assert "written by the agent" not in fh.read()


@requires_postgres
@requires_scaffolder
def test_schema_and_prompt_alone_are_built_on_not_kept_as_a_package(client, db_session) -> None:
    """The agent writes schemas/ and prompts/ at the schema-design step, long
    before a package exists. Treating those as "the agent's package" shipped a
    download with no run_poc.py (found in a live UC01 run). They are the
    approved schema and prompt: the scaffolder builds the package around them,
    keeps them as written, and a regeneration must not delete them."""
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "UC01"}).json()
    session_id = created["id"]
    output_dir = _session_output_dir(db_session, session_id)
    _write_draft(output_dir, _AGREED_SPEC)

    poc = os.path.join(output_dir, "poc")
    approved_schema = (
        "from pydantic import BaseModel\n\n"
        "class IncidentReport(BaseModel):\n"
        "    incident_id: str  # approved in the conversation\n"
    )
    approved_prompt = "# Extraction requirements — approved in the conversation\n"
    os.makedirs(os.path.join(poc, "schemas", "__pycache__"), exist_ok=True)
    os.makedirs(os.path.join(poc, "prompts"), exist_ok=True)
    with open(os.path.join(poc, "schemas", "output_schema.py"), "w", encoding="utf-8") as fh:
        fh.write(approved_schema)
    with open(
        os.path.join(poc, "schemas", "output_schema_requirements.json"), "w", encoding="utf-8"
    ) as fh:
        json.dump({"schema_name": "IncidentReport"}, fh)
    with open(
        os.path.join(poc, "prompts", "extraction_requirements.md"), "w", encoding="utf-8"
    ) as fh:
        fh.write(approved_prompt)
    with open(
        os.path.join(poc, "schemas", "__pycache__", "output_schema.cpython-311.pyc"), "wb"
    ) as fh:
        fh.write(b"\x00")

    body = client.post(f"/sessions/{session_id}/poc/generate").json()
    assert body["source"] == "scaffolder"
    assert body["scaffolded"] is True
    assert {"run_poc.py", "requirements.txt", "README.md"} <= set(body["files"])
    assert not any("__pycache__" in f for f in body["files"])

    def read(*parts: str) -> str:
        with open(os.path.join(poc, *parts), encoding="utf-8") as fh:
            return fh.read()

    assert read("schemas", "output_schema.py") == approved_schema
    assert read("prompts", "extraction_requirements.md") == approved_prompt

    again = client.post(f"/sessions/{session_id}/poc/generate").json()
    assert again["regenerated"] is True
    assert read("schemas", "output_schema.py") == approved_schema
    assert read("prompts", "extraction_requirements.md") == approved_prompt
    assert "run_poc.py" in again["files"]


@requires_postgres
@requires_scaffolder
def test_regenerating_never_overwrites_the_agents_wiring(client, db_session) -> None:
    """A composed pipeline has no template, so the scaffolder writes a TODO
    stub and the agent wires it in the conversation. Pressing "Aja PoC" again
    used to clear "our" run_poc.py and put the stub back over that work (found
    in a live UC02 run with VisionExtractor)."""
    created = client.post("/sessions", json={"user_id": "poc-user", "title": "UC02"}).json()
    session_id = created["id"]
    output_dir = _session_output_dir(db_session, session_id)
    _write_draft(output_dir, _AGREED_SPEC)

    first = client.post(f"/sessions/{session_id}/poc/generate").json()
    assert first["source"] == "scaffolder"

    run_poc = os.path.join(output_dir, "poc", "run_poc.py")
    wired = (
        '"""Wired by the agent."""\n'
        "from gaik.software_components.vision_extractor import VisionExtractor\n"
    )
    with open(run_poc, "w", encoding="utf-8") as fh:
        fh.write(wired)

    again = client.post(f"/sessions/{session_id}/poc/generate").json()
    assert again["source"] == "agent"
    assert again["scaffolded"] is False
    with open(run_poc, encoding="utf-8") as fh:
        assert fh.read() == wired

    forced = client.post(f"/sessions/{session_id}/poc/generate?force=true").json()
    assert forced["source"] == "scaffolder"
    with open(run_poc, encoding="utf-8") as fh:
        assert "Wired by the agent" not in fh.read()
