"""BPMN generation and sync for wizard_api sessions."""

from __future__ import annotations

from typing import Any

try:
    from solution_wizard.blueprint import Blueprint
    from solution_wizard.bpmn_generator import generate_bpmn
    from solution_wizard.bpmn_sync import sync_v2_blueprint_from_bpmn_xml
    from solution_wizard.v2_adapter import v2_to_v1_dict

    _SOLUTION_WIZARD_AVAILABLE = True
except ImportError:  # pragma: no cover - optional in minimal installs
    _SOLUTION_WIZARD_AVAILABLE = False


class BpmnGenerationError(RuntimeError):
    pass


def solution_wizard_available() -> bool:
    return _SOLUTION_WIZARD_AVAILABLE


def generate_bpmn_xml(v2_blueprint: dict[str, Any], *, session_id: str) -> str:
    if not _SOLUTION_WIZARD_AVAILABLE:
        raise BpmnGenerationError("solution_wizard package is not installed")
    v1 = v2_to_v1_dict(v2_blueprint, session_id=session_id)
    blueprint = Blueprint.model_validate(v1)
    return generate_bpmn(blueprint)


def sync_blueprint_from_bpmn(
    v2_blueprint: dict[str, Any],
    bpmn_xml: str,
) -> dict[str, Any]:
    if not _SOLUTION_WIZARD_AVAILABLE:
        raise BpmnGenerationError("solution_wizard package is not installed")
    return sync_v2_blueprint_from_bpmn_xml(v2_blueprint, bpmn_xml)
