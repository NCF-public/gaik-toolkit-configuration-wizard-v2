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


def _session_ready_to_generate(client, title: str = "PoC") -> dict:
    """A session whose Gate 2 is approved.

    Generating scaffolds from the *approved* blueprint, so the endpoint now
    requires that approval (R6). These tests are about what generation produces,
    not about the gate, so they start past it.
    """
    created = client.post(
        "/sessions", json={"user_id": "poc-user", "title": title}
    ).json()
    client.patch(
        f"/sessions/{created['id']}",
        json={"gate_statuses": {"gate_2": "approved"}},
    )
    return created


def _write_poc(output_dir: str) -> None:
    """Stand in for the V1 Phase 10 scaffolder — a *complete* package.

    The entrypoint is ``run_poc.py``, which is what the scaffolder writes and
    what the sandbox Job runs, and it imports a component: a package that wires
    nothing is not offered as a download any more.
    """
    poc = os.path.join(output_dir, "poc")
    os.makedirs(os.path.join(poc, "schemas"), exist_ok=True)
    with open(os.path.join(poc, "run_poc.py"), "w", encoding="utf-8") as fh:
        fh.write("from gaik.software_components.extractor import Extractor\n")
    with open(os.path.join(poc, "requirements.txt"), "w", encoding="utf-8") as fh:
        fh.write("gaik[extract]\n")
    with open(os.path.join(poc, "README.md"), "w", encoding="utf-8") as fh:
        fh.write("# PoC\n")
    with open(os.path.join(poc, "schemas", "output_schema.json"), "w", encoding="utf-8") as fh:
        fh.write("{}\n")


def _write_partial_poc(output_dir: str) -> None:
    """What the report actually found behind the download button: a few schema
    files, no entrypoint, no requirements, no README."""
    poc = os.path.join(output_dir, "poc")
    os.makedirs(os.path.join(poc, "schemas"), exist_ok=True)
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
    assert listed["ready"] is True
    assert listed["problems"] == []
    assert listed["files"] == [
        "README.md",
        "requirements.txt",
        "run_poc.py",
        "schemas/output_schema.json",
    ]

    got = client.get(f"/sessions/{session_id}/poc")
    assert got.status_code == 200
    assert got.headers["content-type"] == "application/zip"
    assert f"poc-{session_id}.zip" in got.headers["content-disposition"]

    # Entries keep the poc/ prefix so the archive unpacks into its own folder.
    with zipfile.ZipFile(io.BytesIO(got.content)) as zf:
        assert sorted(zf.namelist()) == [
            "poc/README.md",
            "poc/requirements.txt",
            "poc/run_poc.py",
            "poc/schemas/output_schema.json",
        ]
        assert b"gaik" in zf.read("poc/run_poc.py")


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


def _write_v1_draft(output_dir: str, blueprint: dict) -> None:
    """Write the agent's own complete V1 blueprint to use_case.blueprint.json —
    the artifact it produces at spec generation, the source #167 makes the
    scaffolder prefer over the minimal v2_to_v1_dict conversion."""
    path = artifact_sync.artifact_path(output_dir, artifact_sync.DRAFT_BLUEPRINT_FILE)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(blueprint, fh)


@requires_scaffolder
@pytest.mark.parametrize(
    "module_id, input_types, expected_pattern",
    [
        ("audio_to_structured_data", ["audio"], "audio_to_structured"),
        ("documents_to_structured_data", ["pdf"], "document_to_structured"),
        ("rag_workflow", ["document_collection"], "rag"),
    ],
)
def test_generate_scaffolds_the_agents_draft_pattern_not_generic(
    tmp_path, module_id, input_types, expected_pattern
) -> None:
    """#167: the agent's draft carries the selected module, so scaffolding from
    it wires the case's own pattern. ``v2_to_v1_dict`` is minimal — it drops the
    module into ``selected_building_blocks`` and hard-codes ``input_types`` — so
    the pattern never matches and the scaffolder falls back to ``_generic``: a
    ``run_poc.py`` that imports nothing and does nothing. The fix prefers the
    draft, so "Aja PoC" for audio/document/RAG produces the wired pattern.
    """
    output_dir = str(tmp_path)
    _write_v1_draft(
        output_dir,
        {
            "use_case": {
                "id": "uc",
                "name": "Draft-driven PoC",
                "description": "The agent selected a single covering module.",
                "domain": "manufacturing",
            },
            "technical_spec": {"input_types": input_types},
            "target_output_spec": _AGREED_SPEC,
            "components": {
                "selected_modules": [{"id": module_id, "name": module_id}],
                "selected_building_blocks": [],
            },
        },
    )

    # The V2 blueprint is deliberately the minimal shape v2_to_v1_dict would turn
    # into _generic; the fix must scaffold from the valid draft instead of it.
    result = poc_service.generate_poc(
        {"use_case": {"title": "Draft-driven PoC"}},
        session_id="draft-session",
        output_dir=output_dir,
    )

    assert result["source"] == "scaffolder"
    assert result["pattern"] == expected_pattern
    assert result["template_wired"] is True

    run_poc = open(os.path.join(output_dir, "poc", "run_poc.py"), encoding="utf-8").read()
    assert "your pipeline" not in run_poc.lower()  # not the _generic TODO skeleton


@requires_scaffolder
def test_generate_falls_back_to_conversion_without_a_valid_draft(tmp_path) -> None:
    """No agent draft (or an unparseable one) → the V2 → V1 conversion still runs,
    so "Aja PoC" never fails for want of a draft. The bare spec below is not a
    valid V1 Blueprint, standing in for a half-written file."""
    output_dir = str(tmp_path)
    _write_v1_draft(output_dir, {"target_output_spec": _AGREED_SPEC})

    result = poc_service.generate_poc(
        {"use_case": {"title": "No module selected"}},
        session_id="fallback-session",
        output_dir=output_dir,
        target_output_spec=_AGREED_SPEC,
    )

    assert result["source"] == "scaffolder"
    assert result["pattern"] == "_generic"
    schema = open(
        os.path.join(output_dir, "poc", "schemas", "output_schema.py"), encoding="utf-8"
    ).read()
    assert "class IncidentReport(BaseModel):" in schema  # override still applied


@requires_postgres
@requires_scaffolder
def test_generate_produces_the_v1_scaffolder_file_set(client, db_session) -> None:
    created = _session_ready_to_generate(client)
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
        # New with the upstream sync: the scaffolder now writes a provider
        # config beside the rest.
        "provider_config.py",
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
    created = _session_ready_to_generate(client, "Incidents")
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
    created = _session_ready_to_generate(client, "Incidents")
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
    created = _session_ready_to_generate(client)
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
    created = _session_ready_to_generate(client, "UC04")
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
    created = _session_ready_to_generate(client, "UC01")
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
    created = _session_ready_to_generate(client, "UC02")
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


@requires_postgres
def test_an_incomplete_package_is_not_offered_as_a_download(client, db_session) -> None:
    """19 / T8: the download was live as soon as any file existed under poc/."""
    created = client.post("/sessions", json={"user_id": "poc-user"}).json()
    _write_partial_poc(_session_output_dir(db_session, created["id"]))

    listed = client.get(f"/sessions/{created['id']}/poc/files").json()
    assert listed["generated"] is True
    assert listed["ready"] is False
    assert "run_poc.py is missing" in listed["problems"]

    refused = client.get(f"/sessions/{created['id']}/poc")
    assert refused.status_code == 409
    assert refused.json()["detail"]["error"] == "poc_package_incomplete"


@requires_postgres
def test_the_package_cannot_be_generated_before_gate_2_is_approved(client) -> None:
    """R6: the button worked at Gate 2 and reported success over a blueprint
    nobody had approved. A fresh session on purpose — no gate approved."""
    created = client.post("/sessions", json={"user_id": "poc-gate"}).json()

    refused = client.post(f"/sessions/{created['id']}/poc/generate")

    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["error"] == "gate_not_approved"
    assert detail["gate"] == "gate_2"


# ---------------------------------------------------------------------------
# Sandbox runs (#91 / #92)
# ---------------------------------------------------------------------------


@requires_postgres
def test_a_run_cannot_start_before_gate_2_is_approved(client) -> None:
    created = client.post("/sessions", json={"user_id": "run-user"}).json()

    refused = client.post(f"/sessions/{created['id']}/runs")

    assert refused.status_code == 409
    assert refused.json()["detail"]["error"] == "gate_not_approved"


@requires_postgres
def test_a_run_cannot_start_without_a_package(client) -> None:
    created = _session_ready_to_generate(client, "run-no-package")

    refused = client.post(f"/sessions/{created['id']}/runs")

    assert refused.status_code == 409
    assert "no PoC package" in refused.json()["detail"]


@requires_postgres
def test_a_run_cannot_start_on_an_incomplete_package(client, db_session) -> None:
    """A ten-minute Job to prove an unwired package does nothing helps nobody."""
    created = _session_ready_to_generate(client, "run-partial")
    _write_partial_poc(_session_output_dir(db_session, created["id"]))

    refused = client.post(f"/sessions/{created['id']}/runs")

    assert refused.status_code == 409
    assert refused.json()["detail"]["error"] == "poc_package_incomplete"


@requires_postgres
def test_a_run_says_what_the_deployment_is_missing(client, db_session) -> None:
    """With a complete package the request is legitimate, so a failure here is
    the deployment's, and the message names the piece rather than 500ing."""
    created = _session_ready_to_generate(client, "run-ready")
    _write_poc(_session_output_dir(db_session, created["id"]))

    started = client.post(f"/sessions/{created['id']}/runs")

    assert started.status_code in (201, 503)
    if started.status_code == 503:
        detail = started.json()["detail"]
        assert "namespace" in detail or "runner image" in detail or "kubernetes" in detail


@requires_postgres
def test_an_input_file_is_uploaded_listed_and_removed(client, db_session) -> None:
    """#95: the run view can hand the package a file, and the Job reads it at
    /workspace/poc/sample_input because the zip already carries it."""
    created = _session_ready_to_generate(client, "input-user")
    _write_poc(_session_output_dir(db_session, created["id"]))
    sid = created["id"]

    up = client.post(
        f"/sessions/{sid}/poc/input",
        files={"file": ("purchase-order.pdf", b"%PDF-1.7 ...", "application/pdf")},
    )
    assert up.status_code == 201
    assert up.json()["path"] == "sample_input/purchase-order.pdf"

    listed = client.get(f"/sessions/{sid}/poc/input").json()["files"]
    assert [f["name"] for f in listed] == ["purchase-order.pdf"]

    assert client.delete(f"/sessions/{sid}/poc/input/purchase-order.pdf").status_code == 204
    assert client.get(f"/sessions/{sid}/poc/input").json()["files"] == []


@requires_postgres
def test_an_uploaded_input_travels_with_the_package(client, db_session) -> None:
    """The point of putting it inside poc/: no manifest change is needed."""
    created = _session_ready_to_generate(client, "input-zip")
    _write_poc(_session_output_dir(db_session, created["id"]))
    sid = created["id"]
    client.post(
        f"/sessions/{sid}/poc/input",
        files={"file": ("incident.wav", b"RIFF....WAVE", "audio/wav")},
    )

    got = client.get(f"/sessions/{sid}/poc")

    assert got.status_code == 200
    with zipfile.ZipFile(io.BytesIO(got.content)) as zf:
        assert "poc/sample_input/incident.wav" in zf.namelist()


@requires_postgres
def test_an_upload_cannot_become_the_entrypoint(client, db_session) -> None:
    """run_poc.py is what the sandbox Job executes."""
    created = _session_ready_to_generate(client, "input-evil")
    output_dir = _session_output_dir(db_session, created["id"])
    _write_poc(output_dir)

    refused = client.post(
        f"/sessions/{created['id']}/poc/input",
        files={"file": ("../run_poc.py", b"import os; os.system('id')", "text/x-python")},
    )

    assert refused.status_code == 422
    entrypoint = os.path.join(output_dir, "poc", "run_poc.py")
    assert "gaik" in open(entrypoint, encoding="utf-8").read()
