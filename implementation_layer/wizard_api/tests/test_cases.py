"""Cases: the generated solution run as a process, on real input (case_service).

A case goes draft → running (the sandbox runs the package on the case's own
input) → review → approved, or back to the person who gave the input when the
reviewer returns it. What carries the weight: a case run reads only its own
input, a run's result is found in the run log by the output fields, and a
record the reviewer approves passes the same checks the form makes.
"""

import io
import json
import os
import uuid
import zipfile
from types import SimpleNamespace

import pytest
from helpers import requires_postgres
from wizard_api.services import case_service, poc_service, session_service
from wizard_api.services.sandbox_runner import (
    CASE_KIND,
    CASE_LABEL,
    RUN_KIND_LABEL,
    SandboxRunner,
    render_job_manifest,
)

IMAGE = "registry.example/gaik/wizard-v2-poc-runner:latest"
SESSION = "0b5b7b2b-a9ce-4896-b224-8d73614a9bb7"

SPEC = {
    "schema_name": "Ticket",
    "fields": ["reporter", "location", "urgency", "seen_on", "uncertain_fields"],
    "field_types": {"uncertain_fields": "list[string]"},
    "required_fields": ["location", "urgency"],
    "field_descriptions": {"seen_on": "Date it was seen, DD/MM/YYYY"},
    "allowed_values": {"urgency": ["low", "medium", "high"]},
}

RECORD = {
    "reporter": "A. Tester",
    "location": "Hall 3",
    "urgency": "high",
    "seen_on": "01/02/2026",
    "uncertain_fields": [],
}


def _log(record=RECORD, transcript="the spoken report"):
    return "\n".join(
        [
            "starting",
            "=== POC OUTPUT BEGIN ===",
            "--- output/report_ticket.json ---",
            json.dumps([record]),
            "--- output/report_validation.json ---",
            json.dumps({"hallucination_flags": [], "passed": True}),
            "--- output/report_transcript.txt ---",
            transcript,
            "",
            "=== POC OUTPUT END ===",
        ]
    )


@pytest.fixture
def out(tmp_path):
    return str(tmp_path)


def _running_case(out):
    case = case_service.create_case(out, created_by="u")
    case_service.save_input(out, case["id"], "report.wav", b"RIFF....WAVE")
    return case_service.mark_submitted(out, case["id"], run_id="r1", role="Technician", note="")


# ---------------------------------------------------------------------------
# A case and its input
# ---------------------------------------------------------------------------


def test_a_new_case_is_a_draft_with_no_input(out):
    case = case_service.create_case(out, created_by="u")

    assert case["status"] == "draft"
    assert case["round"] == 1
    assert case_service.get_case(out, case["id"])["inputs"] == []


def test_an_input_is_stored_with_the_case_not_in_the_package(out):
    case = case_service.create_case(out, created_by="u")

    case_service.save_input(out, case["id"], "report.wav", b"RIFF....WAVE")

    assert case_service.get_case(out, case["id"])["inputs"] == [
        {"name": "report.wav", "bytes": 12, "task": None}
    ]
    assert not os.path.exists(os.path.join(out, "poc", "sample_input"))


def test_an_input_name_that_climbs_out_is_refused(out):
    case = case_service.create_case(out, created_by="u")

    with pytest.raises(poc_service.InputRejectedError):
        case_service.save_input(out, case["id"], "../../poc/run_poc.py", b"print(1)")


def test_a_case_id_that_is_not_a_uuid_is_not_a_case(out):
    with pytest.raises(case_service.CaseNotFoundError):
        case_service.get_case(out, "../poc")


def test_a_case_is_not_submitted_without_input(out):
    case = case_service.create_case(out, created_by="u")

    with pytest.raises(case_service.CaseStateError):
        case_service.require_submittable(out, case["id"])


def test_the_input_of_a_running_case_cannot_change(out):
    case = _running_case(out)

    with pytest.raises(case_service.CaseStateError):
        case_service.save_input(out, case["id"], "other.wav", b"x")
    with pytest.raises(case_service.CaseStateError):
        case_service.delete_input(out, case["id"], "report.wav")


# ---------------------------------------------------------------------------
# The run's result
# ---------------------------------------------------------------------------


def test_the_record_is_the_json_whose_keys_are_the_output_fields():
    result = case_service.parse_run_output(_log(), SPEC)

    assert result["record"] == RECORD
    assert result["validation"] == {"hallucination_flags": [], "passed": True}
    assert result["transcript"] == "the spoken report"


def test_a_log_without_the_markers_has_no_result():
    assert case_service.parse_run_output("Traceback ...", SPEC)["record"] is None


def test_a_successful_run_puts_the_case_up_for_review(out):
    case = _running_case(out)

    settled = case_service.finish_run(
        out, case["id"], phase="succeeded", log=_log(), message=None, spec=SPEC
    )

    assert settled["status"] == "review"
    assert settled["record"] == RECORD


def test_a_run_that_wrote_no_record_fails_the_case_with_a_reason(out):
    case = _running_case(out)

    settled = case_service.finish_run(
        out, case["id"], phase="succeeded", log="no markers", message=None, spec=SPEC
    )

    assert settled["status"] == "failed"
    assert "no result" in settled["run_message"]


_TRACEBACK = """Warning: PyTorch not available. CUDA detection disabled.
Traceback (most recent call last):
  File "/workspace/poc/run_poc.py", line 192, in parse_pages
    m = meta_by_file[pdf.name]
        ~~~~~~~~~~~~^^^^^^^^^^
KeyError: 'employee_travel_policy.pdf'
=== POC OUTPUT BEGIN === r1

=== POC OUTPUT END === r1
"""


def test_the_reason_a_run_failed_is_the_last_exception_line_of_its_log():
    assert case_service.failure_reason(_TRACEBACK) == "KeyError: 'employee_travel_policy.pdf'"
    api_error = "openai.NotFoundError: Error code: 404 - {'error': {'code': 'DeploymentNotFound'}}"
    assert case_service.failure_reason("x\n" + api_error + "\n") == api_error
    assert (
        case_service.failure_reason(
            "import pandas as pd\nModuleNotFoundError: No module named 'pandas'"
        )
        == "ModuleNotFoundError: No module named 'pandas'"
    )


def test_the_reason_is_an_error_line_when_there_is_no_traceback_and_none_otherwise():
    log = "\n".join(
        [
            "Warning: docling missing",
            "ERROR: no PDF documents found in sample_input",
            case_service.OUTPUT_BEGIN,
        ]
    )
    assert case_service.failure_reason(log) == "ERROR: no PDF documents found in sample_input"
    assert case_service.failure_reason("Killed\n") is None
    assert case_service.failure_reason("") is None


def test_a_long_reason_is_cut_and_a_line_after_the_markers_does_not_count():
    long = "ValueError: " + "x" * 500
    reason = case_service.failure_reason(long)
    assert reason.startswith("ValueError: xxx") and reason.endswith("…") and len(reason) <= 240
    assert case_service.failure_reason("ok\n=== POC OUTPUT BEGIN ===\nValueError: echoed") is None


def test_a_failed_run_tells_the_case_what_its_log_said():
    reason = case_service.run_failure_message(
        "failed", _TRACEBACK, "Job has reached the specified backoff limit"
    )
    assert reason == "KeyError: 'employee_travel_policy.pdf'"
    assert case_service.run_failure_message("failed", "Killed", "backoff") == "backoff"
    assert case_service.run_failure_message("failed", "", None) == "the run ended: failed"
    assert case_service.run_failure_message("timeout", _TRACEBACK, "cut off") == "cut off"


def test_a_failed_case_carries_the_reason_from_its_log(out):
    case = _running_case(out)

    settled = case_service.finish_run(
        out, case["id"], phase="failed", log=_TRACEBACK, message="backoff limit", spec=SPEC
    )

    assert settled["status"] == "failed"
    assert settled["run_message"] == "KeyError: 'employee_travel_policy.pdf'"


def test_a_failed_run_can_be_sent_again(out):
    case = _running_case(out)
    case_service.finish_run(
        out, case["id"], phase="timeout", log=None, message="cut off", spec=SPEC
    )

    assert case_service.require_submittable(out, case["id"])["status"] == "failed"


# ---------------------------------------------------------------------------
# The review
# ---------------------------------------------------------------------------


def _in_review(out):
    case = _running_case(out)
    return case_service.finish_run(
        out, case["id"], phase="succeeded", log=_log(), message=None, spec=SPEC
    )


def test_the_reviewer_approves_the_corrected_record(out):
    case = _in_review(out)

    approved = case_service.review(
        out,
        case["id"],
        action="approve",
        role="Supervisor",
        record={**RECORD, "location": "Hall 3, east end"},
        comment="",
        spec=SPEC,
    )

    assert approved["status"] == "approved"
    assert approved["record"]["location"] == "Hall 3, east end"
    assert approved["result"]["record"]["location"] == "Hall 3"  # what the AI wrote is kept
    assert approved["events"][-1]["detail"] == "location"


@pytest.mark.parametrize(
    "change, problem",
    [
        ({"location": ""}, "location is required"),
        ({"urgency": "urgent"}, "urgency must be one of"),
        ({"seen_on": "2026-02-01"}, "seen_on must be DD/MM/YYYY"),
    ],
)
def test_a_record_the_form_would_refuse_is_not_approved(out, change, problem):
    case = _in_review(out)

    with pytest.raises(case_service.CaseStateError, match=problem):
        case_service.review(
            out,
            case["id"],
            action="approve",
            role="Supervisor",
            record={**RECORD, **change},
            comment="",
            spec=SPEC,
        )


def test_a_returned_case_goes_back_for_a_new_round_with_the_comment(out):
    case = _in_review(out)

    returned = case_service.review(
        out,
        case["id"],
        action="return",
        role="Supervisor",
        record=None,
        comment="Which hall?",
        spec=SPEC,
    )

    assert returned["status"] == "returned"
    assert returned["round"] == 2
    assert returned["comment"] == "Which hall?"
    # The input can be changed and the case sent again.
    case_service.save_input(out, case["id"], "report2.wav", b"RIFF")
    assert case_service.require_submittable(out, case["id"])


def test_returning_or_rejecting_needs_a_reason(out):
    case = _in_review(out)

    for action in ("return", "reject"):
        with pytest.raises(case_service.CaseStateError):
            case_service.review(
                out, case["id"], action=action, role="", record=None, comment=" ", spec=SPEC
            )


def test_a_case_not_in_review_cannot_be_approved(out):
    case = case_service.create_case(out, created_by="u")

    with pytest.raises(case_service.CaseStateError):
        case_service.review(
            out, case["id"], action="approve", role="", record=RECORD, comment="", spec=SPEC
        )


# ---------------------------------------------------------------------------
# The process the UI is built from
# ---------------------------------------------------------------------------

BPMN = """<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="P">
    <bpmn:laneSet>
      <bpmn:lane id="L_user" name="Technician">
        <bpmn:flowNodeRef>S</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>T_rec</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="L_ai" name="GenAI">
        <bpmn:flowNodeRef>T_ext</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="L_rev" name="Supervisor">
        <bpmn:flowNodeRef>T_rev</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>G</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>E_ok</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>E_no</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S"/>
    <bpmn:userTask id="T_rec" name="Record report">
      <bpmn:dataOutputAssociation><bpmn:targetRef>D_audio</bpmn:targetRef></bpmn:dataOutputAssociation>
    </bpmn:userTask>
    <bpmn:serviceTask id="T_ext" name="[A2S] Extract fields"/>
    <bpmn:userTask id="T_rev" name="Review ticket"/>
    <bpmn:exclusiveGateway id="G" name="Approved?"/>
    <bpmn:endEvent id="E_ok"/><bpmn:endEvent id="E_no" name="Rejected"/>
    <bpmn:dataObjectReference id="D_audio" name="Report Audio"/>
    <bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="T_rec"/>
    <bpmn:sequenceFlow id="f2" sourceRef="T_rec" targetRef="T_ext"/>
    <bpmn:sequenceFlow id="f3" sourceRef="T_ext" targetRef="T_rev"/>
    <bpmn:sequenceFlow id="f4" sourceRef="T_rev" targetRef="G"/>
    <bpmn:sequenceFlow id="f5" name="Yes" sourceRef="G" targetRef="E_ok"/>
    <bpmn:sequenceFlow id="f6" name="No" sourceRef="G" targetRef="E_no"/>
  </bpmn:process>
</bpmn:definitions>"""


def test_lanes_with_a_user_task_are_roles_and_the_ai_lane_is_not():
    process = case_service.process_from_bpmn(BPMN)

    assert [(lane["name"], lane["human"]) for lane in process["lanes"]] == [
        ("Technician", True),
        ("GenAI", False),
        ("Supervisor", True),
    ]


def test_tasks_keep_their_lane_their_data_and_a_readable_name():
    nodes = {n["id"]: n for n in case_service.process_from_bpmn(BPMN)["nodes"]}

    assert nodes["T_rec"]["lane"] == "L_user"
    assert nodes["T_rec"]["outputs"] == ["Report Audio"]
    assert nodes["T_ext"]["name"] == "Extract fields"  # component code dropped
    assert nodes["G"]["kind"] == "exclusiveGateway"


def test_the_gateway_branches_keep_their_names():
    flows = case_service.process_from_bpmn(BPMN)["flows"]

    assert {f["name"] for f in flows if f["from"] == "G"} == {"Yes", "No"}


# ---------------------------------------------------------------------------
# The sandbox run of a case
# ---------------------------------------------------------------------------

CASE = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b"


def _fetch_command(manifest):
    return manifest["spec"]["template"]["spec"]["initContainers"][0]["command"][-1]


def test_a_case_run_fetches_the_package_with_that_cases_input():
    manifest = render_job_manifest(SESSION, "run-1", IMAGE, case_id=CASE)

    assert f'/sessions/{SESSION}/poc?case={CASE}"' in _fetch_command(manifest)
    assert manifest["metadata"]["labels"][CASE_LABEL] == CASE
    assert manifest["spec"]["template"]["metadata"]["labels"][CASE_LABEL] == CASE
    # A case run is its own kind, so it never opens the deployable download.
    assert manifest["metadata"]["labels"][RUN_KIND_LABEL] == CASE_KIND
    assert manifest["spec"]["template"]["metadata"]["labels"][RUN_KIND_LABEL] == CASE_KIND


def test_a_plain_run_fetches_the_package_as_before():
    manifest = render_job_manifest(SESSION, "run-1", IMAGE)

    assert "?case=" not in _fetch_command(manifest)
    assert CASE_LABEL not in manifest["metadata"]["labels"]
    assert RUN_KIND_LABEL not in manifest["metadata"]["labels"]


def test_a_case_run_keeps_the_rest_of_the_reviewed_job():
    plain = render_job_manifest(SESSION, "run-1", IMAGE)
    case = render_job_manifest(SESSION, "run-1", IMAGE, case_id=CASE)

    assert (
        case["spec"]["template"]["spec"]["containers"]
        == plain["spec"]["template"]["spec"]["containers"]
    )
    assert case["spec"]["activeDeadlineSeconds"] == plain["spec"]["activeDeadlineSeconds"]


def test_a_case_id_that_could_inject_into_the_fetch_is_refused():
    with pytest.raises(ValueError):
        render_job_manifest(SESSION, "run-1", IMAGE, case_id='x" ; rm -rf / #')


def test_the_whole_log_of_a_finished_run_is_read_from_its_pod():
    class Core:
        def list_namespaced_pod(self, namespace, label_selector):
            return SimpleNamespace(items=[SimpleNamespace(metadata=SimpleNamespace(name="pod-1"))])

        def read_namespaced_pod_log(self, **kwargs):
            self.kwargs = kwargs
            return SimpleNamespace(data=_log().encode())

    core = Core()
    runner = SandboxRunner(namespace="ns", image=IMAGE, batch=object(), core=core)

    log = runner.read_log("run-1")

    assert "POC OUTPUT BEGIN" in log
    assert case_service.parse_run_output(log, SPEC)["record"] == RECORD
    # The client's own decoding escaped the newlines, so the raw body is read.
    assert core.kwargs["_preload_content"] is False
    assert "follow" not in core.kwargs


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def _session_with_package(client, db_session, gate_2="approved"):
    created = client.post("/sessions", json={"user_id": "case-user", "title": "Cases"}).json()
    client.patch(f"/sessions/{created['id']}", json={"gate_statuses": {"gate_2": gate_2}})
    out = session_service.get_session(db_session, uuid.UUID(created["id"])).output_dir
    poc = os.path.join(out, "poc")
    os.makedirs(os.path.join(poc, "sample_input"), exist_ok=True)
    os.makedirs(os.path.join(poc, "output"), exist_ok=True)
    with open(os.path.join(poc, "run_poc.py"), "w", encoding="utf-8") as fh:
        fh.write("from gaik.software_components.extractor import Extractor\n")
    for name, text in (
        ("requirements.txt", "gaik\n"),
        ("README.md", "# PoC\n"),
        ("sample_input/developer.wav", "dev"),
        ("output/old.json", "{}"),
    ):
        with open(os.path.join(poc, name), "w", encoding="utf-8") as fh:
            fh.write(text)
    with open(os.path.join(out, "use_case.blueprint.json"), "w", encoding="utf-8") as fh:
        json.dump({"use_case": {"name": "Fault reports"}, "target_output_spec": SPEC}, fh)
    with open(os.path.join(out, "workflow.bpmn"), "w", encoding="utf-8") as fh:
        fh.write(BPMN)
    return created["id"]


@requires_postgres
def test_the_model_carries_the_process_and_the_output_fields(client, db_session):
    sid = _session_with_package(client, db_session)

    model = client.get(f"/sessions/{sid}/cases/model").json()

    assert model["title"] == "Fault reports"
    assert model["spec"]["fields"] == SPEC["fields"]
    assert [lane["name"] for lane in model["process"]["lanes"]] == [
        "Technician",
        "GenAI",
        "Supervisor",
    ]


@requires_postgres
def test_the_package_of_a_case_run_carries_only_that_cases_input(client, db_session):
    sid = _session_with_package(client, db_session)
    case = client.post(f"/sessions/{sid}/cases").json()
    client.post(
        f"/sessions/{sid}/cases/{case['id']}/inputs",
        files={"file": ("report.wav", b"RIFF....WAVE", "audio/wav")},
    )

    zipped = client.get(f"/sessions/{sid}/poc", params={"case": case["id"]})

    names = zipfile.ZipFile(io.BytesIO(zipped.content)).namelist()
    assert "poc/sample_input/report.wav" in names
    assert "poc/sample_input/developer.wav" not in names
    assert "poc/output/old.json" not in names
    assert "poc/run_poc.py" in names


@requires_postgres
def test_submitting_starts_a_sandbox_run_of_the_case(client, db_session, monkeypatch):
    sid = _session_with_package(client, db_session)
    case = client.post(f"/sessions/{sid}/cases").json()
    client.post(
        f"/sessions/{sid}/cases/{case['id']}/inputs",
        files={"file": ("report.wav", b"RIFF....WAVE", "audio/wav")},
    )
    started = {}

    def create_run(self, session_id, *, run_id=None, kind=None, case_id=None):
        started.update(session_id=session_id, case_id=case_id)
        return "run-9"

    monkeypatch.setattr(SandboxRunner, "create_run", create_run)

    res = client.post(f"/sessions/{sid}/cases/{case['id']}/submit", json={"role": "Technician"})

    assert res.status_code == 200
    assert res.json()["status"] == "running"
    assert started == {"session_id": sid, "case_id": case["id"]}


@requires_postgres
def test_a_case_of_another_session_is_not_found(client, db_session):
    sid = _session_with_package(client, db_session)

    assert client.get(f"/sessions/{sid}/cases/{uuid.uuid4()}").status_code == 404
    assert client.get(f"/sessions/{sid}/poc", params={"case": str(uuid.uuid4())}).status_code == 404


# ---------------------------------------------------------------------------
# A document result (a generated report)
# ---------------------------------------------------------------------------

REPORT = {
    "status": "DRAFT",
    "title": "Quarterly report",
    "sections": [
        {"id": "summary", "title": "Summary", "text": "Deliveries were on time. [kpis.xlsx]"},
        {"id": "actions", "title": "Actions", "text": "| Action | Owner |"},
    ],
}


def _report_log():
    return "\n".join(
        [
            "=== POC OUTPUT BEGIN ===",
            "--- output/result.json ---",
            json.dumps(REPORT),
            "--- output/report_draft.md ---",
            "# Quarterly report",
            "=== POC OUTPUT END ===",
        ]
    )


def test_a_report_made_of_sections_is_the_result_even_without_field_names():
    result = case_service.parse_run_output(_report_log(), {"fields": ["executive_summary"]})

    assert result["record"] == REPORT
    assert result["document"] == "# Quarterly report"


def test_a_report_is_approved_on_its_sections_not_on_the_field_list(out):
    spec = {"fields": ["executive_summary"], "required_fields": ["executive_summary"]}
    case = _running_case(out)
    case_service.finish_run(
        out, case["id"], phase="succeeded", log=_report_log(), message=None, spec=spec
    )

    edited = {
        **REPORT,
        "sections": [{**REPORT["sections"][0], "text": "Edited."}, REPORT["sections"][1]],
    }
    approved = case_service.review(
        out, case["id"], action="approve", role="Reviewer", record=edited, comment="", spec=spec
    )

    assert approved["status"] == "approved"
    assert approved["record"]["sections"][0]["text"] == "Edited."


def test_a_report_with_an_emptied_section_is_not_approved():
    emptied = {**REPORT, "sections": [{**REPORT["sections"][0], "text": " "}]}

    assert case_service.record_problems(emptied, None) == ["section Summary is empty"]


# ---------------------------------------------------------------------------
# Answers to several questions, and a process with no reviewer
# ---------------------------------------------------------------------------

QA_SPEC = {
    "fields": ["query_id", "answer", "access_decision"],
    "required_fields": ["query_id", "answer"],
    "allowed_values": {"access_decision": ["allowed", "denied"]},
}
ANSWERS = [
    {"query_id": "Q1", "answer": "Forty.", "access_decision": "allowed"},
    {"query_id": "Q2", "answer": "Not for this role.", "access_decision": "denied"},
]


def _answers_log():
    return "\n".join(
        [
            "=== POC OUTPUT BEGIN ===",
            "--- output/checks.json ---",
            json.dumps({"records": 2}),
            "--- output/result.json ---",
            json.dumps(ANSWERS),
            "=== POC OUTPUT END ===",
        ]
    )


def test_several_records_stay_a_list():
    assert case_service.parse_run_output(_answers_log(), QA_SPEC)["record"] == ANSWERS


def test_without_a_reviewer_the_result_completes_the_case(out):
    case = _running_case(out)

    done = case_service.finish_run(
        out,
        case["id"],
        phase="succeeded",
        log=_answers_log(),
        message=None,
        spec=QA_SPEC,
        review_needed=False,
    )

    assert done["status"] == "completed"
    assert done["record"] == ANSWERS


def test_each_record_of_a_list_is_checked():
    broken = [ANSWERS[0], {**ANSWERS[1], "access_decision": "maybe"}]

    assert case_service.record_problems(broken, QA_SPEC) == [
        "#2: access_decision must be one of allowed, denied"
    ]


def test_an_approved_record_that_carries_its_review_status_says_so(out):
    spec = {
        **SPEC,
        "fields": [*SPEC["fields"], "review_status"],
        "allowed_values": {
            **SPEC["allowed_values"],
            "review_status": ["pending review", "approved", "returned"],
        },
    }
    case = _running_case(out)
    case_service.finish_run(
        out,
        case["id"],
        phase="succeeded",
        log=_log(record={**RECORD, "review_status": "pending review"}),
        message=None,
        spec=spec,
    )

    approved = case_service.review(
        out, case["id"], action="approve", role="Reviewer", record=None, comment="", spec=spec
    )

    assert approved["record"]["review_status"] == "approved"


def test_a_dotted_field_is_a_column_checked_on_every_row():
    spec = {
        "fields": ["po_number", "line_items", "line_item.article_code", "line_item.quantity"],
        "required_fields": ["po_number", "line_items", "line_item.article_code"],
    }
    record = {
        "po_number": "PO-1",
        "line_items": [
            {"article_code": "A-1", "quantity": "2"},
            {"article_code": "", "quantity": "1"},
        ],
    }

    assert case_service.record_problems(record, spec) == ["line_item 2: article_code is required"]


def test_a_report_spec_whose_fields_are_section_objects_reads_as_names():
    spec = {"fields": [{"id": "executive_summary", "title": "Summary"}, "period", {"x": 1}]}

    assert case_service.normalize_spec(spec)["fields"] == ["executive_summary", "period"]
    assert case_service.parse_run_output(_report_log(), spec)["record"] == REPORT


# ---------------------------------------------------------------------------
# Several people giving parts of the input
# ---------------------------------------------------------------------------


def test_each_person_gives_their_part_and_the_last_one_sends_the_case(out):
    case = case_service.create_case(out, created_by="u")
    case_service.save_input(out, case["id"], "kpis.xlsx", b"x", task="T_kpi")

    with pytest.raises(case_service.CaseStateError):
        case_service.complete_step(out, case["id"], task="T_audit", role="Quality", note="")

    case_service.complete_step(out, case["id"], task="T_kpi", role="Procurement", note="Q2 numbers")
    case_service.save_input(out, case["id"], "audit.pdf", b"y", task="T_audit")
    sent = case_service.mark_submitted(
        out, case["id"], run_id="r1", role="Quality", note="", task="T_audit"
    )

    assert sent["status"] == "running"
    assert sent["steps_done"] == ["T_kpi", "T_audit"]
    assert sent["notes"]["T_kpi"] == "Q2 numbers"
    assert {f["name"]: f["task"] for f in sent["inputs"]} == {
        "audit.pdf": "T_audit",
        "kpis.xlsx": "T_kpi",
    }


def test_a_case_returned_to_a_later_step_keeps_the_earlier_ones_done(out):
    case = case_service.create_case(out, created_by="u")
    case_service.save_input(out, case["id"], "kpis.xlsx", b"x", task="T_kpi")
    case_service.complete_step(out, case["id"], task="T_kpi", role="Procurement", note="")
    case_service.save_input(out, case["id"], "audit.pdf", b"y", task="T_audit")
    case_service.mark_submitted(
        out, case["id"], run_id="r1", role="Quality", note="", task="T_audit"
    )
    case_service.finish_run(out, case["id"], phase="succeeded", log=_log(), message=None, spec=SPEC)

    returned = case_service.review(
        out,
        case["id"],
        action="return",
        role="Reviewer",
        record=None,
        comment="Audit is the old one",
        spec=SPEC,
        return_to="T_audit",
    )

    assert returned["steps_done"] == ["T_kpi"]
    assert returned["return_to"] == "T_audit"


def test_a_deleted_input_forgets_whose_it_was(out):
    case = case_service.create_case(out, created_by="u")
    case_service.save_input(out, case["id"], "kpis.xlsx", b"x", task="T_kpi")

    case_service.delete_input(out, case["id"], "kpis.xlsx")

    assert case_service.get_case(out, case["id"])["input_tasks"] == {}


def test_an_empty_list_is_a_value_given_not_a_missing_one():
    spec = {"fields": ["answer", "citations"], "required_fields": ["answer", "citations"]}

    assert case_service.record_problems({"answer": "No.", "citations": []}, spec) == []
    assert case_service.record_problems({"answer": "No.", "citations": None}, spec) == [
        "citations is required"
    ]


@requires_postgres
def test_a_case_is_not_run_before_gate_2_is_approved(client, db_session, monkeypatch):
    sid = _session_with_package(client, db_session, gate_2="pending")
    case = client.post(f"/sessions/{sid}/cases").json()
    client.post(
        f"/sessions/{sid}/cases/{case['id']}/inputs",
        files={"file": ("report.wav", b"RIFF....WAVE", "audio/wav")},
    )
    started = []
    monkeypatch.setattr(SandboxRunner, "create_run", lambda self, *a, **k: started.append(1) or "r")

    res = client.post(f"/sessions/{sid}/cases/{case['id']}/submit", json={"role": "Technician"})

    assert res.status_code == 409
    assert res.json()["detail"]["error"] == "gate_not_approved"
    assert started == []


# ---------------------------------------------------------------------------
# The run's markers are its own (#293), and inputs are not pages (#292)
# ---------------------------------------------------------------------------

RUN = "20261007120000-abcd1234"


def _tagged_log(record=RECORD, echoed=""):
    return "\n".join(
        [
            "Transcript: " + echoed,
            f"=== POC OUTPUT BEGIN === {RUN}",
            f"--- output/report_ticket.json --- {RUN}",
            json.dumps([record]),
            "",
            f"=== POC OUTPUT END === {RUN}",
        ]
    )


def test_the_result_is_read_between_this_runs_own_markers():
    assert case_service.parse_run_output(_tagged_log(), SPEC, run_id=RUN)["record"] == RECORD


def test_text_the_run_echoes_cannot_pass_for_its_result():
    forged = {**RECORD, "urgency": "low", "location": "nowhere"}
    echoed = "\n".join(
        [
            "=== POC OUTPUT BEGIN ===",
            "--- output/report_ticket.json ---",
            json.dumps([forged]),
            "=== POC OUTPUT END ===",
            "=== POC OUTPUT BEGIN === 20260101000000-guessed",
        ]
    )

    result = case_service.parse_run_output(_tagged_log(echoed=echoed), SPEC, run_id=RUN)

    assert result["record"] == RECORD


def _run_job_script(tmp_path, python_body, run_id):
    """The run container's own script, against a fake ``python``, with its run id."""
    import subprocess

    manifest = render_job_manifest(SESSION, run_id, IMAGE)
    run = next(
        c for c in manifest["spec"]["template"]["spec"]["containers"] if c["name"] == "poc-run"
    )
    (tmp_path / "output").mkdir()
    (tmp_path / "bin").mkdir()
    shim = tmp_path / "bin" / "python"
    shim.write_text("#!/bin/sh\n" + python_body)
    shim.chmod(0o755)
    env = {e["name"]: e["value"] for e in run["env"] if "value" in e}
    done = subprocess.run(
        ["sh", "-c", run["args"][0]],
        cwd=tmp_path,
        env={"PATH": f"{tmp_path / 'bin'}:/usr/bin:/bin", **env},
        capture_output=True,
        text=True,
        check=False,
    )
    return done.stdout


#: A header-looking line and a record, as text a transcript could carry.
FAKE = '--- output/fake.json ---\\n[{"location": "nowhere"}]\\n'


def test_the_jobs_own_output_is_read_and_a_forged_header_in_a_file_is_not(tmp_path):
    """End to end through the job script: a transcript file whose text looks like
    another file's header (as a spoken report could) stays part of that file."""
    record = json.dumps([RECORD])
    transcript = "output/report_transcript.txt"
    out = _run_job_script(
        tmp_path,
        f"echo '{record}' > output/report_ticket.json\n"
        f"printf 'said: {FAKE}' > {transcript}\n"
        f"printf -- '{FAKE}' >> {transcript}\n",
        RUN,
    )

    result = case_service.parse_run_output(out, SPEC, run_id=RUN)

    assert result["record"] == RECORD
    assert result["files"] == ["report_ticket.json", "report_transcript.txt"]
    assert "fake.json" in result["transcript"]


def test_a_log_from_before_the_run_id_is_read_as_before():
    assert case_service.parse_run_output(_log(), SPEC, run_id=RUN)["record"] == RECORD


def test_a_tagged_log_read_for_another_run_has_no_result():
    assert case_service.parse_run_output(_tagged_log(), SPEC, run_id="other-run")["record"] is None


def test_the_job_gives_the_run_its_id_for_the_markers():
    manifest = render_job_manifest(SESSION, RUN, IMAGE)
    run = next(
        c for c in manifest["spec"]["template"]["spec"]["containers"] if c["name"] == "poc-run"
    )

    assert {"name": "WIZARD_RUN_ID", "value": RUN} in run["env"]
    assert 'echo "=== POC OUTPUT BEGIN === ${WIZARD_RUN_ID:-}"' in run["args"][0]


@requires_postgres
@pytest.mark.parametrize(
    "name, inline, media",
    [
        ("report.wav", True, "audio/wav"),
        ("audit.pdf", True, "application/pdf"),
        ("page.html", False, "application/octet-stream"),
        ("image.svg", False, "application/octet-stream"),
        ("notes.md", False, "application/octet-stream"),
    ],
)
def test_an_input_is_a_download_unless_it_is_a_recording_pdf_or_picture(
    client, db_session, name, inline, media
):
    sid = _session_with_package(client, db_session)
    case = client.post(f"/sessions/{sid}/cases").json()
    client.post(
        f"/sessions/{sid}/cases/{case['id']}/inputs", files={"file": (name, b"<svg onload=x>")}
    )

    res = client.get(f"/sessions/{sid}/cases/{case['id']}/inputs/{name}")

    assert res.headers["content-type"].startswith(media)
    assert res.headers["content-disposition"].startswith("inline" if inline else "attachment")
    assert res.headers["x-content-type-options"] == "nosniff"
