"""The agent's own report and submission steps are drawn once, with no generated duplicate.

With "pdf" in ``technical_spec.output_types`` the generator adds a "Generate PDF
report" task, and for each ``technical_spec.integration_targets`` entry a
"Submit to …" send task. When the agent writes its own steps for that work (a
live run: ``invoice_pdf_report`` and ``erp_submission``, both
``component: custom``), the diagram showed the report and the submission twice.

- The report: a step that outputs a *generated* artifact of type pdf or report
  ``produced_by`` it. (An upload step's PDF is ``source: user_upload``.)
- The submission: a step whose ``parameters.integration_target`` is the
  target's exact name. Its data store stays, written by that step.
"""

import xml.etree.ElementTree as ET

from solution_wizard.blueprint import Blueprint
from solution_wizard.bpmn_generator import generate_bpmn

NS = {"bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL"}
END = "EndEvent_success"
ERP = "ERP system (approved invoice data)"


def _step(sid, kind="automated_task", deps=(), inputs=(), outputs=(), **extra):
    step = {
        "id": sid,
        "name": sid.replace("_", " ").capitalize(),
        "type": kind,
        "inputs": list(inputs),
        "outputs": list(outputs),
        "depends_on": list(deps),
        **extra,
    }
    if kind == "automated_task":
        step.setdefault("component", "custom")
    return step


def _art(kind, by=None, *, upload=False, final=False):
    if upload:
        return {"type": kind, "source": "user_upload", "optional": False}
    return {
        "type": kind,
        "source": "generated",
        "optional": False,
        "produced_by": by,
        "final_output": final,
    }


def _blueprint(
    steps, artifacts, *, targets=(ERP,), outputs=("structured_json", "pdf"), decisions=()
):
    return Blueprint.model_validate(
        {
            "blueprint_version": "1.0",
            "use_case": {"id": "uc", "name": "Invoices", "description": "x", "domain": "t"},
            "business_spec": {"intended_users": ["clerk"], "reviewers": ["manager"]},
            "technical_spec": {
                "input_types": ["pdf"],
                "output_types": list(outputs),
                "language": "en",
                "integration_targets": list(targets),
            },
            "target_output_spec": {"required_fields": ["a"]},
            "components": {
                "selected_modules": [],
                "selected_building_blocks": [],
                "custom_components": [],
            },
            "artifacts": artifacts,
            "workflow": {"steps": steps},
            "business_process": {"decision_points": list(decisions)},
        }
    )


def _flows(bp):
    root = ET.fromstring(generate_bpmn(bp))
    proc = root.find("bpmn:process", NS)
    flows = [
        (f.get("sourceRef"), f.get("targetRef")) for f in proc.findall("bpmn:sequenceFlow", NS)
    ]
    kinds = {e.get("id"): e.tag.split("}")[-1] for e in proc}
    writes = {
        e.get("id"): [
            a.findtext("bpmn:targetRef", namespaces=NS)
            for a in e.findall("bpmn:dataOutputAssociation", NS)
        ]
        for e in proc
    }
    return flows, kinds, writes


UPLOAD = _step("upload", "user_task", outputs=["invoice_pdf"])
EXTRACT = _step("extract", deps=["upload"], inputs=["invoice_pdf"], outputs=["record"])
BASE_ARTS = {"invoice_pdf": _art("pdf", upload=True), "record": _art("structured_json", "extract")}


def _invoice(*, report=True, submit=True, marker=ERP):
    steps, arts = [UPLOAD, EXTRACT], dict(BASE_ARTS)
    last = "extract"
    if report:
        steps.append(
            _step("invoice_pdf_report_x", deps=[last], inputs=["record"], outputs=["report_pdf"])
        )
        arts["report_pdf"] = _art("pdf", "invoice_pdf_report_x", final=True)
        last = "invoice_pdf_report_x"
    if submit:
        params = {"integration_target": marker} if marker else {}
        steps.append(
            _step(
                "send_erp",
                deps=[last],
                inputs=["record"],
                outputs=["erp_receipt"],
                parameters=params,
            )
        )
        arts["erp_receipt"] = _art("erp_submission", "send_erp", final=True)
    return _blueprint(steps, arts)


# The step ids above avoid "pdf" and "report_gen" on purpose where the old id rule
# must not be what decides: invoice_pdf_report_x contains "pdf", so its own
# test below uses a neutral id.


def test_the_agents_own_report_and_submission_are_drawn_once():
    steps = [
        UPLOAD,
        EXTRACT,
        _step("make_document", deps=["extract"], inputs=["record"], outputs=["report_pdf"]),
        _step(
            "deliver",
            deps=["make_document"],
            inputs=["record"],
            outputs=["receipt"],
            parameters={"integration_target": ERP},
        ),
    ]
    arts = {
        **BASE_ARTS,
        "report_pdf": _art("pdf", "make_document", final=True),
        "receipt": _art("erp_submission", "deliver", final=True),
    }
    flows, kinds, writes = _flows(_blueprint(steps, arts))

    assert "Activity_generate_pdf" not in kinds
    assert not any(k.startswith("Activity_submit_") for k in kinds)
    assert ("Activity_make_document", "Activity_deliver") in flows
    assert ("Activity_deliver", END) in flows
    # The integration's data store stays, written by the agent's own step.
    store = next(k for k, v in kinds.items() if v == "dataStoreReference")
    assert store in writes["Activity_deliver"]


def test_without_own_steps_both_boxes_are_generated_report_first():
    flows, kinds, _ = _flows(_invoice(report=False, submit=False))

    assert ("Activity_extract", "Activity_generate_pdf") in flows
    send = next(k for k in kinds if k.startswith("Activity_submit_"))
    assert ("Activity_generate_pdf", send) in flows
    assert (send, END) in flows


def test_an_own_report_step_without_a_submission_gets_the_generated_send_after_it():
    steps = [
        UPLOAD,
        EXTRACT,
        _step("make_document", deps=["extract"], inputs=["record"], outputs=["report_pdf"]),
    ]
    arts = {**BASE_ARTS, "report_pdf": _art("pdf", "make_document", final=True)}
    flows, kinds, _ = _flows(_blueprint(steps, arts))

    assert "Activity_generate_pdf" not in kinds
    send = next(k for k in kinds if k.startswith("Activity_submit_"))
    assert ("Activity_make_document", send) in flows


def test_an_own_submission_without_a_report_gets_the_generated_report_before_it():
    flows, kinds, _ = _flows(_invoice(report=False))

    assert not any(k.startswith("Activity_submit_") for k in kinds)
    assert ("Activity_extract", "Activity_generate_pdf") in flows
    assert ("Activity_generate_pdf", "Activity_send_erp") in flows
    assert ("Activity_send_erp", END) in flows


def test_a_marker_for_one_of_two_targets_keeps_the_other_targets_box():
    steps = [
        UPLOAD,
        EXTRACT,
        _step(
            "deliver",
            deps=["extract"],
            inputs=["record"],
            outputs=["receipt"],
            parameters={"integration_target": ERP},
        ),
    ]
    arts = {**BASE_ARTS, "receipt": _art("erp_submission", "deliver")}
    flows, kinds, _ = _flows(
        _blueprint(steps, arts, targets=(ERP, "archive_system"), outputs=("structured_json",))
    )

    sends = [k for k in kinds if k.startswith("Activity_submit_")]
    assert sends == ["Activity_submit_archive_system"]


def test_a_marker_naming_no_target_is_not_taken_for_the_submission():
    flows, kinds, _ = _flows(_invoice(report=False, marker="erp"))

    assert any(k.startswith("Activity_submit_") for k in kinds)


def test_an_upload_steps_pdf_is_not_taken_for_the_report():
    steps = [UPLOAD, EXTRACT]
    flows, kinds, _ = _flows(_blueprint(steps, dict(BASE_ARTS), targets=()))

    assert "Activity_generate_pdf" in kinds


def test_an_own_report_on_one_branch_only_is_trusted_and_nothing_is_generated():
    """What the agent wrote is drawn: a report on the manager's branch only is not
    copied onto the other branch."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("route", deps=["extract"]),
        _step("manager", "user_task", deps=["route"]),
        _step("make_document", deps=["manager"], inputs=["record"], outputs=["report_pdf"]),
        _step("archive", deps=["route"]),
    ]
    arts = {**BASE_ARTS, "report_pdf": _art("pdf", "make_document", final=True)}
    decision = {
        "id": "big",
        "name": "Big?",
        "after": "route",
        "branches": [
            {"condition": "yes", "target": "manager"},
            {"condition": "no", "target": "archive"},
        ],
    }
    flows, kinds, _ = _flows(_blueprint(steps, arts, targets=(), decisions=[decision]))

    assert "Activity_generate_pdf" not in kinds
