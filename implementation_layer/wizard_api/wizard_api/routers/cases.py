"""Cases: run the generated solution as a process, with roles, on real input.

See ``wizard_api.services.case_service``. Same owner rule as every other
``/sessions/{session_id}/...`` route: the router carries the dependency.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from wizard_api.db import get_db
from wizard_api.ownership import requesting_user, session_belongs_to_requester
from wizard_api.services import case_service, poc_service, session_service
from wizard_api.services.artifact_sync import DRAFT_BLUEPRINT_FILE, WORKFLOW_BPMN_FILE

router = APIRouter(
    prefix="/sessions",
    tags=["cases"],
    dependencies=[Depends(session_belongs_to_requester)],
)


class SubmitRequest(BaseModel):
    role: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=2000)
    task: str | None = Field(default=None, max_length=200)


class StepRequest(BaseModel):
    task: str = Field(min_length=1, max_length=200)
    role: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=2000)


class ReviewRequest(BaseModel):
    action: str = Field(pattern="^(approve|return|reject)$")
    role: str = Field(default="", max_length=200)
    comment: str = Field(default="", max_length=2000)
    record: dict[str, Any] | list[dict[str, Any]] | None = None
    return_to: str | None = Field(default=None, max_length=200)


def _session(db: Session, session_id: uuid.UUID):
    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    if not session.output_dir:
        raise HTTPException(status_code=409, detail="session has no output directory")
    return session


def _draft(output_dir: str) -> dict[str, Any]:
    try:
        data = json.loads((Path(output_dir) / DRAFT_BLUEPRINT_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _spec(db: Session, session) -> dict[str, Any] | None:
    """The output fields: the agent's draft first, as the PoC was built from it."""
    spec = _draft(session.output_dir).get("target_output_spec")
    if isinstance(spec, dict) and spec.get("fields"):
        return case_service.normalize_spec(spec)
    detail = session_service.session_detail(db, session)
    return detail.target_output_spec.model_dump() if detail.target_output_spec else None


def _bpmn(db: Session, session, session_id: uuid.UUID) -> str | None:
    """The agent's BPMN when it wrote one, else the one generated from the blueprint."""
    path = Path(session.output_dir) / WORKFLOW_BPMN_FILE
    if path.is_file():
        return path.read_text(encoding="utf-8")
    from wizard_api.services import bpmn_service

    detail = session_service.session_detail(db, session)
    try:
        return bpmn_service.generate_bpmn_xml(
            detail.blueprint.model_dump(), session_id=str(session_id)
        )
    except bpmn_service.BpmnGenerationError:
        return None


def _review_needed(db: Session, session, session_id: uuid.UUID) -> bool:
    """Whether someone reviews the result: a second user task after the input."""
    xml = _bpmn(db, session, session_id)
    if not xml:
        return True
    nodes = case_service.process_from_bpmn(xml)["nodes"]
    return sum(n["kind"] in ("userTask", "manualTask") for n in nodes) >= 2


def _case(output_dir: str, case_id: str) -> dict[str, Any]:
    try:
        return case_service.get_case(output_dir, case_id)
    except case_service.CaseNotFoundError as exc:
        raise HTTPException(status_code=404, detail="case not found") from exc


def _state_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=409, detail=str(exc))


@router.get("/{session_id}/cases/model")
def case_model(session_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    """What the case UI is built from: the process (BPMN) and the output fields."""
    session = _session(db, session_id)
    xml = _bpmn(db, session, session_id)
    if not xml:
        raise HTTPException(status_code=409, detail="the session has no BPMN yet")
    spec = _spec(db, session)
    if not spec:
        raise HTTPException(status_code=409, detail="the session has no output fields yet")
    poc = os.path.join(session.output_dir, "poc")
    problems = poc_service.package_problems(poc) if os.path.isdir(poc) else ["no PoC package"]
    title = (_draft(session.output_dir).get("use_case") or {}).get("name") or spec.get(
        "schema_name", ""
    )
    return {
        "title": title,
        "spec": spec,
        "process": case_service.process_from_bpmn(xml),
        "package_ready": not problems,
        "package_problems": problems,
    }


@router.get("/{session_id}/cases")
def list_cases(session_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    session = _session(db, session_id)
    return {"cases": case_service.list_cases(session.output_dir)}


@router.post("/{session_id}/cases", status_code=201)
def create_case(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    user_id: str | None = Depends(requesting_user),
) -> dict:
    session = _session(db, session_id)
    return case_service.create_case(session.output_dir, created_by=user_id or session.user_id)


@router.get("/{session_id}/cases/{case_id}")
async def get_case(session_id: uuid.UUID, case_id: str, db: Session = Depends(get_db)) -> dict:
    """The case. A running case is settled here once its run has finished."""
    session = _session(db, session_id)
    case = _case(session.output_dir, case_id)
    if case["status"] != "running" or not case.get("run_id"):
        return case
    from wizard_api.services import sandbox_runner

    try:
        runner = sandbox_runner.SandboxRunner()
        status = await asyncio.to_thread(runner.status, case["run_id"], session_id=str(session_id))
    except sandbox_runner.RunNotFoundError:
        return await asyncio.to_thread(
            case_service.finish_run,
            session.output_dir,
            case_id,
            phase="failed",
            log=None,
            message="the run is no longer on the cluster",
            spec=None,
        )
    except sandbox_runner.SandboxNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not status.finished:
        return {**case, "run_phase": status.phase}
    log = None
    if status.phase == "succeeded":
        try:
            log = await asyncio.to_thread(runner.read_log, case["run_id"])
        except sandbox_runner.RunNotFoundError:
            log = None
    return await asyncio.to_thread(
        case_service.finish_run,
        session.output_dir,
        case_id,
        phase=status.phase,
        log=log,
        message=status.message,
        spec=_spec(db, session),
        review_needed=_review_needed(db, session, session_id),
    )


@router.post("/{session_id}/cases/{case_id}/inputs", status_code=201)
async def upload_case_input(
    session_id: uuid.UUID,
    case_id: str,
    file: UploadFile = File(...),
    task: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> dict:
    session = _session(db, session_id)
    _case(session.output_dir, case_id)
    data = await file.read()
    try:
        name = case_service.save_input(
            session.output_dir, case_id, file.filename or "", data, task=task
        )
    except poc_service.InputRejectedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except case_service.CaseStateError as exc:
        raise _state_error(exc) from exc
    return {"name": name, "bytes": len(data), "task": task}


@router.get("/{session_id}/cases/{case_id}/inputs/{filename}")
def get_case_input(
    session_id: uuid.UUID, case_id: str, filename: str, db: Session = Depends(get_db)
) -> FileResponse:
    """One input file, for the reviewer to listen to or open beside the record."""
    session = _session(db, session_id)
    _case(session.output_dir, case_id)
    try:
        path = case_service.input_path(session.output_dir, case_id, filename)
    except poc_service.InputRejectedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if path is None:
        raise HTTPException(status_code=404, detail="no such input file")
    return FileResponse(path, headers={"Cache-Control": "no-store"})


@router.delete("/{session_id}/cases/{case_id}/inputs/{filename}", status_code=204)
def delete_case_input(
    session_id: uuid.UUID, case_id: str, filename: str, db: Session = Depends(get_db)
) -> Response:
    session = _session(db, session_id)
    _case(session.output_dir, case_id)
    try:
        removed = case_service.delete_input(session.output_dir, case_id, filename)
    except poc_service.InputRejectedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except case_service.CaseStateError as exc:
        raise _state_error(exc) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="no such input file")
    return Response(status_code=204)


@router.post("/{session_id}/cases/{case_id}/submit")
def submit_case(
    session_id: uuid.UUID, case_id: str, payload: SubmitRequest, db: Session = Depends(get_db)
) -> dict:
    """Send the case's input to the sandbox: the package runs on this case's files."""
    from wizard_api.services import sandbox_runner

    session = _session(db, session_id)
    _case(session.output_dir, case_id)
    # The same gate as a run of the package (create_poc_run): a case runs the
    # generated code, which only an approved blueprint may produce.
    if session.gate_statuses.get("gate_2") != "approved":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "gate_not_approved",
                "gate": "gate_2",
                "message": "approve Gate 2 before running a case",
            },
        )
    poc = os.path.join(session.output_dir, "poc")
    problems = poc_service.package_problems(poc) if os.path.isdir(poc) else ["no PoC package"]
    if problems:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "poc_package_incomplete",
                "problems": problems,
                "message": "the package is not complete: " + "; ".join(problems),
            },
        )
    try:
        case_service.require_submittable(session.output_dir, case_id)
    except case_service.CaseStateError as exc:
        raise _state_error(exc) from exc
    try:
        run_id = sandbox_runner.SandboxRunner().create_run(str(session_id), case_id=case_id)
    except sandbox_runner.SandboxNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return case_service.mark_submitted(
        session.output_dir,
        case_id,
        run_id=run_id,
        role=payload.role,
        note=payload.note,
        task=payload.task,
    )


@router.post("/{session_id}/cases/{case_id}/step")
def complete_case_step(
    session_id: uuid.UUID, case_id: str, payload: StepRequest, db: Session = Depends(get_db)
) -> dict:
    """One person's part of the input is done; the next input task is up."""
    session = _session(db, session_id)
    _case(session.output_dir, case_id)
    try:
        return case_service.complete_step(
            session.output_dir, case_id, task=payload.task, role=payload.role, note=payload.note
        )
    except case_service.CaseStateError as exc:
        raise _state_error(exc) from exc


@router.post("/{session_id}/cases/{case_id}/review")
def review_case(
    session_id: uuid.UUID, case_id: str, payload: ReviewRequest, db: Session = Depends(get_db)
) -> dict:
    session = _session(db, session_id)
    _case(session.output_dir, case_id)
    try:
        return case_service.review(
            session.output_dir,
            case_id,
            action=payload.action,
            role=payload.role,
            record=payload.record,
            comment=payload.comment,
            spec=_spec(db, session),
            return_to=payload.return_to,
        )
    except case_service.CaseStateError as exc:
        raise _state_error(exc) from exc
