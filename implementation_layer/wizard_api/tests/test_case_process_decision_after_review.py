"""The case screens follow a diagram whose decision comes after a review's approval.

The case process is read from the BPMN (``case_service.process_from_bpmn``) and
walked from the start event, taking the flow named like "Yes" at a gateway. A
decision after a review is now drawn after the "Approved?" gateway, on its
"Yes", so the walk passes the review, the approval and the decision, and the
review is still the step that reviews.
"""

import pytest
from wizard_api.services import bpmn_service, case_service

pytestmark = pytest.mark.skipif(
    not bpmn_service.solution_wizard_available(),
    reason="solution_wizard package not installed",
)

if bpmn_service.solution_wizard_available():
    from solution_wizard.blueprint import Blueprint
    from solution_wizard.bpmn_generator import generate_bpmn


def _step(sid, kind, deps, **extra):
    return {
        "id": sid,
        "name": sid.capitalize(),
        "type": kind,
        "inputs": [],
        "outputs": [],
        "depends_on": deps,
        **extra,
    }


def _blueprint() -> "Blueprint":
    return Blueprint.model_validate(
        {
            "blueprint_version": "1.0",
            "use_case": {"id": "uc", "name": "Claims", "description": "d", "domain": "d"},
            "business_spec": {"intended_users": ["clerk"], "reviewers": ["manager"]},
            "technical_spec": {"input_types": ["pdf"], "output_types": ["structured_json"]},
            "target_output_spec": {"required_fields": ["a"]},
            "components": {
                "selected_modules": [],
                "selected_building_blocks": ["Extractor"],
                "custom_components": [],
            },
            "artifacts": {},
            "workflow": {
                "steps": [
                    _step("upload", "user_task", []),
                    _step("extract", "automated_task", ["upload"], component="Extractor"),
                    _step("review", "human_review", ["extract"]),
                    _step("fast", "automated_task", ["review"], component="Extractor"),
                    _step("slow", "automated_task", ["review"], component="Extractor"),
                ]
            },
            "business_process": {
                "decision_points": [
                    {
                        "id": "speed",
                        "name": "Urgent?",
                        "after": "review",
                        "branches": [
                            {"condition": "yes", "target": "fast"},
                            {"condition": "no", "target": "slow"},
                        ],
                    }
                ]
            },
        }
    )


def _nodes_walked(process: dict) -> list[str]:
    """Every node the case walk passes, gateways too, by its own rule: from the
    start event, the flow named like "Yes" at a fork, else the first one."""
    flows = process["flows"]
    start = next(n["id"] for n in process["nodes"] if n["kind"] == "startEvent")
    walked, node = [], start
    while node and node not in walked:
        walked.append(node)
        out = [f for f in flows if f["from"] == node]
        chosen = next(
            (f for f in out if case_service._YES.match(f["name"])), out[0] if out else None
        )
        node = chosen["to"] if chosen else None
    return walked


def test_the_case_walk_passes_the_approval_and_then_the_decision_after_the_review():
    process = case_service.process_from_bpmn(generate_bpmn(_blueprint()))

    assert case_service.process_problem(process) is None
    assert case_service.reviewer_task(process) == "Activity_review"
    walked = _nodes_walked(process)
    review = walked.index("Activity_review")
    # Review, its approval, then the decision on the approval's "Yes", then one way on.
    assert walked[review + 1 : review + 3] == ["Gateway_approve_review", "Gateway_decision_speed"]
    assert walked[review + 3] in ("Activity_fast", "Activity_slow")
