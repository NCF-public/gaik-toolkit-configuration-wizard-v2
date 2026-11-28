"""The diagram drawn from the reduced blueprint keeps the agent's submission marker.

When the agent's draft does not validate, the Workflow tab draws the reduced
(V2) blueprint with the draft's steps merged in (``with_agent_process``). The
V2 → V1 adapter rebuilds each step's ``parameters``, so the step that sends to
an integration target lost ``parameters.integration_target``, and the diagram
added a "Submit to …" task beside it.
"""

import pytest
from wizard_api.services import bpmn_service

pytestmark = pytest.mark.skipif(
    not bpmn_service.solution_wizard_available(),
    reason="solution_wizard package not installed",
)

if bpmn_service.solution_wizard_available():
    from solution_wizard.v2_adapter import v2_to_v1_dict

V2 = {
    "name": "Invoices",
    "description": "d",
    "goal": "",
    "steps": [
        {"id": "extract", "name": "Extract", "type": "ai", "component": "custom"},
        {"id": "send_erp", "name": "Send to the ERP", "type": "ai", "component": "custom"},
    ],
    "integration_targets": ["erp_system"],
}
DRAFT = {
    "workflow": {
        "steps": [
            {"id": "extract", "type": "automated_task", "component": "custom"},
            {
                "id": "send_erp",
                "type": "automated_task",
                "component": "custom",
                "parameters": {"integration_target": "erp_system", "other": "x"},
            },
        ]
    }
}


def test_the_agents_submission_marker_reaches_the_reduced_blueprints_step():
    v1 = v2_to_v1_dict(V2, session_id="s")
    out = bpmn_service.with_agent_process(v1, V2, DRAFT)

    steps = {s["id"]: s for s in out["workflow"]["steps"]}
    assert steps["send_erp"]["parameters"]["integration_target"] == "erp_system"
    # Only the marker is carried over, not the rest of the draft's parameters.
    assert "other" not in steps["send_erp"]["parameters"]
    assert "integration_target" not in (steps["extract"].get("parameters") or {})


def test_the_reduced_diagram_draws_no_submit_task_beside_the_agents_step():
    xml, mapping, drawn_from = bpmn_service.generate_bpmn_view(
        V2, session_id="s", agent_draft=DRAFT
    )

    assert "Activity_submit_erp_system" not in xml
    assert 'id="Activity_send_erp"' in xml
    named = bpmn_service.named_mapping(mapping, drawn_from)
    assert named["Activity_extract"]["done_delivery"] == "conditional"
    assert named["Activity_send_erp"]["done_delivery"] == "complete"


def test_parameters_that_are_not_an_object_keep_the_rest_of_the_agents_process():
    """A sender whose parameters is a list: the marker is not read, and the
    draft's rework path is still drawn (it was dropped with the whole draft)."""
    draft = {
        "workflow": {
            "steps": [
                {"id": "extract", "type": "automated_task", "component": "custom"},
                {
                    "id": "send_erp",
                    "type": "automated_task",
                    "component": "custom",
                    "parameters": ["untyped"],
                },
            ]
        },
        "business_process": {
            "exceptions": [
                {
                    "id": "bad_scan",
                    "name": "Unreadable",
                    "attached_to": "send_erp",
                    "condition": "unreadable",
                    "outcome": "loop_to:extract",
                }
            ]
        },
    }
    xml, _, _ = bpmn_service.generate_bpmn_view(V2, session_id="s", agent_draft=draft)

    assert 'id="Gateway_exc_bad_scan"' in xml
    reduced = v2_to_v1_dict(V2, session_id="s")
    reduced["workflow"]["steps"][0]["parameters"] = {"keep": "existing"}
    draft["workflow"]["steps"][0]["parameters"] = {
        "integration_target": "erp_system",
        "discard": "unrelated draft parameter",
    }
    combined = bpmn_service.with_agent_process(reduced, V2, draft)
    steps = {step["id"]: step for step in combined["workflow"]["steps"]}
    assert steps["extract"]["parameters"] == {
        "keep": "existing",
        "integration_target": "erp_system",
    }
    assert "integration_target" not in steps["send_erp"]["parameters"]
    assert combined["business_process"]["exceptions"] == draft["business_process"]["exceptions"]
