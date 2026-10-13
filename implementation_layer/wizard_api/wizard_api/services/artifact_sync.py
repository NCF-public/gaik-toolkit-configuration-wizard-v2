"""Bring the agent's on-disk artifacts into the session the UI reads (#141).

The wizard agent writes its artifacts into the session's ``output_dir`` —
``use_case.blueprint.json`` at spec generation, ``workflow.bpmn`` and the rest
later. The UI, meanwhile, reads the blueprint from the database
(``blueprint_versions``) and the BPMN is generated on demand from that same V2
blueprint. Nothing carried the former into the latter: the only code that
touched the generated files checked that ``use_case.blueprint.json`` *existed*
so the step could advance, and never read it. So the workspace kept showing the
seed blueprint however far the conversation had progressed — the demo-parity
gap in #141.

This module is that bridge, and it is the single place that knows the artifact
filenames and the V1 → V2 blueprint mapping.

Everything here is best-effort: a missing, half-written or malformed artifact
returns ``None`` rather than raising, because the agent writes these files
while the user is mid-conversation and a chat turn must never fail on one.
"""

from __future__ import annotations

import json
import os
from typing import Any

from sqlalchemy.orm import Session

from wizard_api.models import WizardSession
from wizard_api.schemas.blueprint import BlueprintContent, TargetOutputSpec
from wizard_api.services import blueprint_service

#: Draft blueprint the agent writes at Phase 3, right before Gate 1.
DRAFT_BLUEPRINT_FILE = "use_case.blueprint.json"
#: BPMN the agent writes at the visual-blueprint phase.
WORKFLOW_BPMN_FILE = "workflow.bpmn"
#: Mermaid workflow diagram written alongside the BPMN.
WORKFLOW_MMD_FILE = "workflow.mmd"

#: The agent's package and the files it writes there as the phases go by.
POC_DIR = "poc"
SCHEMA_FILES = ("schemas/output_schema_requirements.json", "schemas/output_schema.py")
PACKAGE_ENTRYPOINT = "run_poc.py"

#: UI step that each artifact shows the agent has reached: the artifact closes
#: a phase, so the session moves to the phase that follows it (#169). Gate steps
#: are the exception: the BPMN closes the visual-blueprint phase and the next
#: thing is Gate 2 itself. Mirrors the UI's phase list (4 = Gate 1, 5 schema,
#: 6 components, 7 blueprint, 8 BPMN, 9 = Gate 2, 10 PoC).
STEP_GATE_1 = 4
STEP_AFTER_SCHEMA = 6
STEP_AFTER_COMPONENTS = 7
STEP_GATE_2 = 9
STEP_POC = 10

#: V1 workflow step type → V2 UI step type. ``decision`` has no V2 equivalent
#: (gateways live in ``Blueprint.gateways``), so it is shown as an automated
#: step rather than dropped from the flow.
_V1_TO_V2_STEP_TYPE = {
    "user_task": "io",
    "automated_task": "ai",
    "human_review": "human_review",
    "decision": "ai",
}


def _v2_step_type(v1_type: str, component: str) -> str:
    """The V2 step type, using the component as the tie-breaker.

    V1's ``automated_task`` covers two different things: a step where a toolkit
    component calls a model, and a step that just moves data — writing the
    result to a spreadsheet, saving a file. Mapping both to ``ai`` labelled
    "Export results to Excel" as an AI step in the workflow the user reviews.

    A component is what does the model call, so an automated step without one is
    plain work, not AI. The same tie-breaker covers a type we do not recognise:
    guessing ``ai`` for an unknown step was the least safe default, since it
    claims the wizard is doing something it may not be.

    A ``decision`` keeps its existing mapping: it is a branch in the workflow
    rather than work, and reclassifying gateways is not what this is about.
    """
    if v1_type == "automated_task" and not component:
        return "io"
    mapped = _V1_TO_V2_STEP_TYPE.get(v1_type)
    if mapped is not None:
        return mapped
    return "ai" if component else "io"


def artifact_path(output_dir: str, filename: str) -> str:
    return os.path.join(output_dir or "", filename)


def read_draft_blueprint(output_dir: str) -> dict[str, Any] | None:
    """Parse the agent's draft blueprint, or ``None`` if it is not (yet) there."""
    try:
        with open(artifact_path(output_dir, DRAFT_BLUEPRINT_FILE), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def has_draft_blueprint(output_dir: str) -> bool:
    return os.path.exists(artifact_path(output_dir, DRAFT_BLUEPRINT_FILE))


def _has_component(draft: dict[str, Any]) -> bool:
    return any(_str(step.get("component")) for step in _steps_from_draft(draft))


def step_reached(output_dir: str) -> int | None:
    """The furthest UI step the agent's artifacts justify, or ``None`` before Gate 1.

    The session's step used to stop at Gate 1 while the agent went on to write
    the schema, choose components, assemble the blueprint and draw the BPMN:
    the timeline and the workspace tab stayed on step 4 for the rest of the
    conversation (#169). The files the wizard writes say where it is; the
    caller decides how far the gates let the session follow.
    """
    draft = read_draft_blueprint(output_dir)
    if draft is None:
        return STEP_GATE_1 if has_draft_blueprint(output_dir) else None
    step = STEP_GATE_1
    poc = artifact_path(output_dir, POC_DIR)
    if any(os.path.exists(os.path.join(poc, name)) for name in SCHEMA_FILES):
        step = STEP_AFTER_SCHEMA
    if _has_component(draft):
        step = STEP_AFTER_COMPONENTS
    if os.path.exists(artifact_path(output_dir, WORKFLOW_BPMN_FILE)):
        step = STEP_GATE_2
    if os.path.exists(os.path.join(poc, PACKAGE_ENTRYPOINT)):
        step = STEP_POC
    return step


def read_workflow_bpmn(output_dir: str) -> str | None:
    """The agent's own BPMN, when it has written one.

    The UI normally renders BPMN generated from the V2 blueprint, so this is
    for comparison and for the phases where the agent's file is the source.
    """
    try:
        with open(artifact_path(output_dir, WORKFLOW_BPMN_FILE), encoding="utf-8") as fh:
            xml = fh.read()
    except OSError:
        return None
    return xml if xml.strip() else None


def _str(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _str_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _steps_from_draft(draft: dict[str, Any]) -> list[dict[str, Any]]:
    workflow = draft.get("workflow")
    raw_steps = workflow.get("steps") if isinstance(workflow, dict) else None
    if not isinstance(raw_steps, list):
        return []

    steps: list[dict[str, Any]] = []
    for raw in raw_steps:
        if not isinstance(raw, dict):
            continue
        step_id = _str(raw.get("id"))
        name = _str(raw.get("name"))
        if not step_id and not name:
            continue
        component = _str(raw.get("component"))
        step: dict[str, Any] = {
            "id": step_id or name,
            "name": name or step_id,
            "type": _v2_step_type(_str(raw.get("type")), component),
        }
        if component:
            step["component"] = component
        # Component parameters are what the SME asked to see alongside the
        # component name (SME-4), and the V2 step carries them as `settings`.
        parameters = raw.get("parameters")
        if isinstance(parameters, dict) and parameters:
            step["settings"] = {
                str(key): value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
                for key, value in parameters.items()
            }
        steps.append(step)
    return steps


def blueprint_from_draft(draft: dict[str, Any]) -> BlueprintContent | None:
    """Map the agent's V1 draft blueprint onto the V2 blueprint the UI renders.

    Returns ``None`` when the draft carries no workflow yet — an early draft
    with only business framing must not overwrite the blueprint with an empty
    flow (the business framing is surfaced separately at Gate 1).
    """
    steps = _steps_from_draft(draft)
    if not steps:
        return None

    use_case = draft.get("use_case") if isinstance(draft.get("use_case"), dict) else {}
    business = draft.get("business_spec") if isinstance(draft.get("business_spec"), dict) else {}
    technical = draft.get("technical_spec") if isinstance(draft.get("technical_spec"), dict) else {}

    return BlueprintContent(
        name=_str(use_case.get("name")),
        description=_str(use_case.get("description")),
        goal=_str(business.get("poc_goal")),
        steps=steps,
        integration_targets=_str_list(technical.get("integration_targets")),
    )


def target_output_spec_from_draft(draft: dict[str, Any]) -> TargetOutputSpec | None:
    """The agreed output fields (``target_output_spec``) for the Specification
    view, which until now rendered mock fields."""
    raw = draft.get("target_output_spec")
    if not isinstance(raw, dict):
        return None
    fields = _str_list(raw.get("fields"))
    if not fields:
        return None

    def _str_map(value: object) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}
        return {str(k): _str(v) for k, v in value.items() if _str(v)}

    def _list_map(value: object) -> dict[str, list[str]]:
        if not isinstance(value, dict):
            return {}
        return {str(k): _str_list(v) for k, v in value.items() if _str_list(v)}

    return TargetOutputSpec(
        schema_name=_str(raw.get("schema_name")),
        fields=fields,
        field_types=_str_map(raw.get("field_types")),
        required_fields=_str_list(raw.get("required_fields")),
        optional_fields=_str_list(raw.get("optional_fields")),
        field_descriptions=_str_map(raw.get("field_descriptions")),
        allowed_values=_list_map(raw.get("allowed_values")),
        missing_value_policy=_str(raw.get("missing_value_policy")),
        validation_rules=_str_list(raw.get("validation_rules")),
    )


def sync_blueprint_from_draft(
    db: Session,
    session: WizardSession,
    draft: dict[str, Any] | None = None,
    *,
    note: str = "Agentin luonnos",
) -> bool:
    """Record the agent's current draft as the session's blueprint.

    A new version is written only when the mapped content actually differs from
    the active one, so a conversation does not accumulate an identical version
    per chat turn. Returns ``True`` when a version was added.
    """
    if draft is None:
        draft = read_draft_blueprint(session.output_dir)
    if draft is None:
        return False
    mapped = blueprint_from_draft(draft)
    if mapped is None:
        return False

    content = mapped.model_dump()
    active = blueprint_service.get_active_version(db, session)
    if active is not None and active.content == content:
        return False

    blueprint_service.add_version(db, session, note=note, content=content)
    db.commit()
    db.refresh(session)
    return True
