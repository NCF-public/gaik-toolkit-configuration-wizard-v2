"""A decision's branches are drawn once, and every successful path gets the report and delivery.

Found in an invoice run: a decision after "Route invoice" with a branch to the
finance manager drew the route -> manager flow twice, and the PDF report and the
ERP submission were each spliced onto a different flow into the end, so in the
diagram auto-approved invoices got no PDF and manager-approved ones never reached
the ERP. These cases are generic: any decision before a step, and any process with
more than one way to finish and a report or an integration target.
"""

import xml.etree.ElementTree as ET

from solution_wizard.blueprint import Blueprint
from solution_wizard.bpmn_generator import generate_bpmn

NS = {"bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL"}
END = "EndEvent_success"


def _blueprint(steps, *, outputs=("structured_json",), targets=(), decisions=(), exceptions=()):
    return Blueprint.model_validate(
        {
            "blueprint_version": "1.0",
            "use_case": {"id": "uc", "name": "Case", "description": "x", "domain": "t"},
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
                "selected_building_blocks": ["Extractor"],
                "custom_components": [],
            },
            "artifacts": {
                "src": {"type": "pdf", "source": "user_upload", "optional": False},
                "out": {
                    "type": "structured_json",
                    "source": "generated",
                    "optional": False,
                    "final_output": True,
                    "produced_by": "extract",
                },
            },
            "workflow": {"steps": steps},
            "business_process": {
                "decision_points": list(decisions),
                "exceptions": list(exceptions),
            },
        }
    )


def _step(sid, kind="automated_task", deps=(), inputs=("out",)):
    step = {
        "id": sid,
        "name": sid.replace("_", " ").title(),
        "type": kind,
        "inputs": list(inputs),
        "outputs": [],
        "depends_on": list(deps),
    }
    if kind == "automated_task":
        step["component"] = "Extractor"
    return step


def _invoice(*, outputs=("structured_json", "pdf"), targets=("erp_system",)):
    """upload -> extract -> route -> (auto: end | otherwise: manager review)."""
    steps = [
        _step("upload", "user_task", inputs=()),
        dict(_step("extract", deps=["upload"], inputs=["src"]), outputs=["out"]),
        _step("route", deps=["extract"]),
        _step("manager", "human_review", deps=["route"]),
    ]
    return _blueprint(
        steps,
        outputs=outputs,
        targets=targets,
        decisions=[
            {
                "id": "auto",
                "name": "Auto-approve?",
                "after": "route",
                "branches": [
                    {"condition": "under 5,000 EUR", "target": "end"},
                    {"condition": "otherwise", "target": "manager"},
                ],
            }
        ],
        exceptions=[
            {
                "id": "rejected",
                "name": "Rejected",
                "attached_to": "manager",
                "condition": "No",
                "outcome": "loop_to:upload",
            }
        ],
    )


def _flows(bp):
    xml = generate_bpmn(bp)
    proc = ET.fromstring(xml).find("bpmn:process", NS)
    flows = [
        (f.get("sourceRef"), f.get("targetRef"), f.get("name") or "")
        for f in proc.findall("bpmn:sequenceFlow", NS)
    ]
    kinds = {e.get("id"): e.tag.split("}")[-1] for e in proc}
    return flows, kinds


def _start(kinds):
    return next(nid for nid, kind in kinds.items() if kind == "startEvent")


def _reaches_end_without(flows, start, skipped):
    """Whether the success end can be reached from the start without passing ``skipped``."""
    seen, todo = {start}, [start]
    while todo:
        node = todo.pop()
        for src, tgt, _ in flows:
            if src == node and tgt != skipped and tgt not in seen:
                seen.add(tgt)
                todo.append(tgt)
    return END in seen


def test_a_decision_branch_to_its_own_steps_successor_is_drawn_once():
    flows, _ = _flows(_invoice())

    into_manager = [(s, n) for s, t, n in flows if t == "Activity_manager"]
    assert into_manager == [("Gateway_decision_auto", "otherwise")]


def test_without_a_report_or_an_integration_the_endings_are_left_as_they_are():
    flows, kinds = _flows(_invoice(outputs=("structured_json",), targets=()))

    assert not any(nid.startswith("Gateway_merge") for nid in kinds)
    assert {s for s, t, _ in flows if t == END} == {
        "Gateway_decision_auto",
        "Gateway_approve_manager",
    }


def test_a_single_path_is_drawn_as_before():
    steps = [
        dict(_step("extract", inputs=["src"]), outputs=["out"]),
        _step("review", "human_review", deps=["extract"]),
    ]
    flows, kinds = _flows(_blueprint(steps, outputs=["structured_json", "pdf"], targets=["erp"]))

    assert not any(nid.startswith("Gateway_merge") for nid in kinds)
    assert ("Gateway_approve_review", "Activity_generate_pdf") in {(s, t) for s, t, _ in flows}
