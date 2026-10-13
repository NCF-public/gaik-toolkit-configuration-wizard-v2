import asyncio
import io
import os
import uuid
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from wizard_api.db import get_db
from wizard_api.session_state import GateNotApprovedError
from wizard_api.schemas.blueprint import SessionDetailResponse
from wizard_api.schemas.session import (
    SessionCreate,
    SessionListResponse,
    SessionResponse,
    SessionUpdate,
)
from wizard_api.services import (
    agent_service,
    artifact_sync,
    blueprint_service,
    session_service,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


class MessageAppend(BaseModel):
    user_content: str = Field(min_length=1)
    assistant_content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    locale: str | None = None


class VersionCreate(BaseModel):
    note: str = Field(default="", max_length=512)
    content: dict | None = None


class BlueprintPatch(BaseModel):
    content: dict
    note: str = Field(default="Blueprint päivitetty", max_length=512)


class BpmnSyncRequest(BaseModel):
    xml: str = Field(min_length=1)


@router.patch("/{session_id}/blueprint", response_model=SessionDetailResponse)
def patch_blueprint(
    session_id: uuid.UUID,
    payload: BlueprintPatch,
    db: Session = Depends(get_db),
) -> SessionDetailResponse:
    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    blueprint_service.add_version(
        db,
        session,
        note=payload.note,
        content=payload.content,
    )
    db.commit()
    db.refresh(session)
    return session_service.session_detail(db, session)


@router.get("/{session_id}/bpmn")
def get_session_bpmn(session_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    from wizard_api.services import bpmn_service

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    detail = session_service.session_detail(db, session)
    try:
        xml = bpmn_service.generate_bpmn_xml(
            detail.blueprint.model_dump(),
            session_id=str(session_id),
        )
    except bpmn_service.BpmnGenerationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(
        content=xml,
        media_type="application/xml; charset=utf-8",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/{session_id}/bpmn/sync", response_model=SessionDetailResponse)
def sync_session_bpmn(
    session_id: uuid.UUID,
    payload: BpmnSyncRequest,
    db: Session = Depends(get_db),
) -> SessionDetailResponse:
    from wizard_api.services import bpmn_service

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    detail = session_service.session_detail(db, session)
    try:
        synced = bpmn_service.sync_blueprint_from_bpmn(
            detail.blueprint.model_dump(),
            payload.xml,
        )
    except bpmn_service.BpmnGenerationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    blueprint_service.add_version(
        db,
        session,
        note="BPMN canvas sync",
        content=synced,
    )
    db.commit()
    db.refresh(session)
    return session_service.session_detail(db, session)


def _poc_dir(output_dir: str) -> str | None:
    """Resolve the session's generated PoC folder (``<output_dir>/poc``), guarding
    against path escapes. Returns None if output_dir is unset or the resolved poc
    path would fall outside it."""
    if not output_dir:
        return None
    base = os.path.realpath(output_dir)
    poc = os.path.realpath(os.path.join(base, "poc"))
    if poc != base and not poc.startswith(base + os.sep):
        return None
    return poc


@router.get("/{session_id}/poc/files")
def list_poc_files(session_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    """List the files in the generated PoC folder so the UI can show what the
    agent produced. Empty (generated=False) until the PoC scaffolder has run."""
    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    poc = _poc_dir(session.output_dir)
    if not poc or not os.path.isdir(poc):
        return {"generated": False, "files": []}
    files = sorted(
        os.path.relpath(os.path.join(root, name), poc)
        for root, _, names in os.walk(poc)
        for name in names
    )
    # `generated` says files exist; `ready` says they add up to a package worth
    # handing over. The UI showed a download as soon as the first was true.
    from wizard_api.services import poc_service

    problems = poc_service.package_problems(poc)
    return {
        "generated": True,
        "files": files,
        "ready": not problems,
        "problems": problems,
    }


@router.get("/{session_id}/poc")
def download_poc(session_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    """Zip the generated PoC folder and return it as a download. 404 until the
    PoC scaffolder (V1 Phase 10) has produced <output_dir>/poc."""
    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    poc = _poc_dir(session.output_dir)
    if not poc or not os.path.isdir(poc):
        raise HTTPException(status_code=404, detail="no PoC generated yet")
    # An incomplete package is worse than no package: it downloads, it installs
    # nowhere, and it runs to no effect, which reads to the user as the wizard
    # having produced something broken rather than not having finished.
    from wizard_api.services import poc_service

    problems = poc_service.package_problems(poc)
    if problems:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "poc_package_incomplete",
                "problems": problems,
                "message": "the generated package is not complete: " + "; ".join(problems),
            },
        )
    parent = os.path.dirname(poc)  # so archive entries keep the poc/ prefix
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, names in os.walk(poc):
            for name in names:
                fp = os.path.join(root, name)
                zf.write(fp, os.path.relpath(fp, parent))
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="poc-{session_id}.zip"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/{session_id}/poc/generate")
def generate_poc(
    session_id: uuid.UUID,
    force: bool = Query(
        False,
        description=(
            "Scaffold over a package the agent produced. Off by default: the "
            "agent wires the real component for the case's own pattern, which "
            "this deterministic scaffolder cannot reproduce."
        ),
    ),
    db: Session = Depends(get_db),
) -> dict:
    """Scaffold the runnable PoC package from the session's active blueprint (#93).

    Deterministic and safe to repeat: a second call after a blueprint change
    rewrites the package rather than quietly leaving the old one in place. The
    generated files are the same set the V1 scaffolder produces, and they are
    served by the two endpoints above.

    When the agent already produced a package in the conversation, this reports
    it and changes nothing unless ``force`` is set.
    """
    from wizard_api.services import poc_service

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    # The package is scaffolded from the approved blueprint, so Gate 2 has to
    # have been approved first. Without this the button worked at Gate 2 and
    # reported "generating the PoC package from the approved blueprint" over a
    # blueprint nobody had approved.
    if session.gate_statuses.get("gate_2") != "approved":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "gate_not_approved",
                "gate": "gate_2",
                "status": session.gate_statuses.get("gate_2", "pending"),
                "message": "approve Gate 2 before generating the PoC package",
            },
        )
    # Gate 3's blueprint-first rule (#96). The newest piece of feedback decides:
    # if it was an intent change, the blueprint has to have moved since it was
    # given, or regenerating now produces a package that disagrees with the
    # document it is supposed to come from.
    from wizard_api.services import blueprint_service, refinement

    history = list(session.session_metadata.get("refinements") or [])
    if history:
        last = history[-1]
        if last.get("classification") == "intent":
            active = blueprint_service.get_active_version(db, session)
            try:
                refinement.check_regeneration_allowed(
                    refinement.Refinement(
                        classification="intent",
                        feedback=last.get("feedback", ""),
                        rule=refinement.INTENT_RULE,
                    ),
                    blueprint_version_at_feedback=int(last.get("blueprint_version") or 0),
                    blueprint_version_now=active.version if active else 0,
                )
            except refinement.RefinementRejected as exc:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": "blueprint_change_required",
                        "message": str(exc),
                        "feedback": last.get("feedback", ""),
                    },
                ) from exc

    if _poc_dir(session.output_dir) is None:
        raise HTTPException(status_code=409, detail="session has no usable output_dir")

    detail = session_service.session_detail(db, session)
    spec = detail.target_output_spec.model_dump() if detail.target_output_spec else None
    try:
        return poc_service.generate_poc(
            detail.blueprint.model_dump(),
            session_id=str(session_id),
            output_dir=session.output_dir,
            target_output_spec=spec,
            force=force,
        )
    except poc_service.PocGenerationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("", response_model=SessionDetailResponse, status_code=201)
def create_session(payload: SessionCreate, db: Session = Depends(get_db)) -> SessionDetailResponse:
    session = session_service.create_session(db, payload)
    return session_service.session_detail(db, session)


@router.get("", response_model=SessionListResponse)
def list_sessions(
    user_id: str = Query(min_length=1, max_length=255),
    db: Session = Depends(get_db),
) -> SessionListResponse:
    sessions = session_service.list_sessions(db, user_id)
    return SessionListResponse(
        sessions=[SessionResponse(**session_service.session_response(s)) for s in sessions]
    )


@router.get("/{session_id}", response_model=SessionDetailResponse)
def get_session(session_id: uuid.UUID, db: Session = Depends(get_db)) -> SessionDetailResponse:
    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session_service.session_detail(db, session)


@router.patch("/{session_id}", response_model=SessionDetailResponse)
def update_session(
    session_id: uuid.UUID,
    payload: SessionUpdate,
    db: Session = Depends(get_db),
) -> SessionDetailResponse:
    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        updated = session_service.update_session(db, session, payload)
    except GateNotApprovedError as exc:
        # 409, not 422: the request is well-formed, the session is simply not in
        # a state where it may be granted. The caller (the UI or the agent) is
        # expected to show the gate rather than retry.
        raise HTTPException(
            status_code=409,
            detail={
                "error": "gate_not_approved",
                "gate": exc.gate_key,
                "gate_step": exc.gate_step,
                "status": exc.status,
                "message": str(exc),
            },
        ) from exc
    return session_service.session_detail(db, updated)


@router.post("/{session_id}/messages", response_model=SessionDetailResponse)
def append_messages(
    session_id: uuid.UUID,
    payload: MessageAppend,
    db: Session = Depends(get_db),
) -> SessionDetailResponse:
    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    updated = session_service.append_messages(
        db,
        session,
        payload.user_content,
        payload.assistant_content,
    )
    return session_service.session_detail(db, updated)


@router.post("/{session_id}/chat")
async def chat(
    session_id: uuid.UUID,
    payload: ChatRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Send a user message to the live V1 wizard agent and stream its reply as
    SSE (UI chat contract). On turn end the exchange is persisted to the
    session's ``metadata["messages"]`` so a reload shows the full transcript.
    """
    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    try:
        agent = await agent_service.get_or_create_session(
            str(session_id), session.output_dir, payload.locale
        )
    except agent_service.AgentNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if agent["lock"].locked():
        raise HTTPException(status_code=409, detail="The wizard is still responding.")

    user_message = payload.message

    async def gen():
        parts: list[str] = []
        async for frame in agent_service.stream_turn_for(agent, user_message, parts):
            yield frame
        assistant_text = "".join(parts).strip()
        if assistant_text:
            # Persist off the event loop (sync SQLAlchemy commit).
            await asyncio.to_thread(
                session_service.append_messages,
                db,
                session,
                user_message,
                assistant_text,
            )
        # The agent writes its artifacts to disk as the conversation moves;
        # pull them into the session so the workspace keeps up (#141).
        await asyncio.to_thread(_sync_artifacts_and_advance, db, session)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers=agent_service.sse_headers(),
    )


def _sync_artifacts_and_advance(db: Session, session) -> None:
    """After a chat turn: adopt the agent's draft blueprint, then advance to
    Gate 1 if gathering has just finished.

    The wizard writes ``use_case.blueprint.json`` at Phase 3 (spec generation),
    right before Gate 1. Its appearance means gathering is complete → advance to
    Gate 1 so the user cannot skip it. Its *content* is the blueprint the
    workspace shows, and BPMN is generated from that, so reading it here is what
    makes blueprint, schema and diagram follow the conversation (#141) instead
    of staying on the seed blueprint.

    Best-effort by design: the file is written mid-conversation and a chat turn
    must not fail because it was missing or half-written.
    """
    draft = artifact_sync.read_draft_blueprint(session.output_dir)
    if draft is not None:
        artifact_sync.sync_blueprint_from_draft(db, session, draft)
    if session.step < 4 and artifact_sync.has_draft_blueprint(session.output_dir):
        session_service.update_session(db, session, SessionUpdate(step=4))


@router.post("/{session_id}/versions", response_model=SessionDetailResponse)
def create_blueprint_version(
    session_id: uuid.UUID,
    payload: VersionCreate,
    db: Session = Depends(get_db),
) -> SessionDetailResponse:
    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    blueprint_service.add_version(
        db,
        session,
        note=payload.note or f"Vaihe {session.step}",
        content=payload.content,
    )
    db.commit()
    db.refresh(session)
    return session_service.session_detail(db, session)


# ---------------------------------------------------------------------------
# Sandbox PoC runs (#91 SandboxRunner, #92 SSE log stream)
# ---------------------------------------------------------------------------


def _record_successful_run(session_id: uuid.UUID, run_id: str) -> None:
    """Note a run that succeeded, in its own session scope."""
    from wizard_api.db import SessionLocal

    with SessionLocal() as db:
        session = session_service.get_session(db, session_id)
        if session is None:
            return
        metadata = dict(session.session_metadata)
        metadata["last_successful_run"] = run_id
        session_service.update_session(db, session, SessionUpdate(metadata=metadata))


@router.post("/{session_id}/runs", status_code=201)
def create_poc_run(session_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    """Start a sandbox run of this session's generated PoC package.

    The package must be complete — an unwired one downloads and does nothing,
    and starting a ten-minute Job to prove that helps nobody. Gate 3 is where
    the run belongs, so the gate below it has to be approved first.
    """
    from wizard_api.services import poc_service, sandbox_runner

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    if session.gate_statuses.get("gate_2") != "approved":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "gate_not_approved",
                "gate": "gate_2",
                "message": "approve Gate 2 before running the PoC",
            },
        )

    poc = _poc_dir(session.output_dir)
    if not poc or not os.path.isdir(poc):
        raise HTTPException(status_code=409, detail="no PoC package to run yet")
    problems = poc_service.package_problems(poc)
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
        runner = sandbox_runner.SandboxRunner()
        run_id = runner.create_run(str(session_id))
    except sandbox_runner.SandboxNotConfiguredError as exc:
        # 503, not 500: the deployment is missing a piece, and the message says
        # which one rather than leaving the user to guess.
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"run_id": run_id, "session_id": str(session_id), "phase": "pending"}


@router.get("/{session_id}/runs/{run_id}")
def get_poc_run(session_id: uuid.UUID, run_id: str, db: Session = Depends(get_db)) -> dict:
    """Where the run got to, for a client that is not following the stream."""
    from wizard_api.services import sandbox_runner

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    try:
        status = sandbox_runner.SandboxRunner().status(run_id)
    except sandbox_runner.SandboxNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "run_id": status.run_id,
        "phase": status.phase,
        "exit_code": status.exit_code,
        "message": status.message,
        "finished": status.finished,
    }


@router.get("/{session_id}/runs/{run_id}/stream")
async def stream_poc_run(
    session_id: uuid.UUID, run_id: str, db: Session = Depends(get_db)
) -> StreamingResponse:
    """Follow one run's output live, in the UI's own SSE contract (#92).

        data: {"log": "<line>"}      (repeated, as the run produces them)
        data: {"heartbeat": true}    (keep-alive during silent steps)
        data: {"done": true, "phase": "succeeded"}
        data: {"error": true, "message": "..."}

    A PoC can be quiet for minutes — a model call produces nothing until it
    answers — so the heartbeat is what keeps the connection from being dropped
    by a proxy in between.
    """
    from wizard_api.services import agent_service, sandbox_runner

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    async def gen():
        try:
            runner = sandbox_runner.SandboxRunner()
        except sandbox_runner.SandboxNotConfiguredError as exc:
            yield agent_service.sse({"error": True, "message": str(exc)})
            return

        queue: asyncio.Queue = asyncio.Queue()

        def pump() -> None:
            try:
                for line in runner.stream_logs(run_id):
                    queue.put_nowait(("log", line))
            except Exception as exc:  # noqa: BLE001 - reported to the client below
                queue.put_nowait(("error", str(exc)))
            finally:
                queue.put_nowait(("eof", None))

        task = asyncio.create_task(asyncio.to_thread(pump))
        try:
            while True:
                try:
                    kind, payload = await asyncio.wait_for(queue.get(), timeout=20)
                except TimeoutError:
                    yield agent_service.sse({"heartbeat": True})
                    continue
                if kind == "log":
                    yield agent_service.sse({"log": payload})
                elif kind == "error":
                    yield agent_service.sse({"error": True, "message": payload})
                    return
                else:
                    break
            status = await asyncio.to_thread(runner.status, run_id)
            if status.phase == "succeeded":
                # Recorded rather than re-queried later: a finished Job is
                # reaped an hour after it ends (ttlSecondsAfterFinished), and
                # the deployable download must still know the run happened.
                await asyncio.to_thread(_record_successful_run, session_id, run_id)
            yield agent_service.sse(
                {"done": True, "phase": status.phase, "message": status.message}
            )
        finally:
            task.cancel()

    return StreamingResponse(
        gen(), media_type="text/event-stream", headers=agent_service.sse_headers()
    )


# ---------------------------------------------------------------------------
# Sample input for a sandbox run (#95)
# ---------------------------------------------------------------------------


@router.post("/{session_id}/poc/input", status_code=201)
async def upload_poc_input(
    session_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """Add one sample input file to this session's PoC package.

    It lands in ``poc/sample_input/``, which the zip endpoint already serves and
    the Job's init container already unpacks — so the run reads it at
    ``/workspace/poc/sample_input`` with no change to the manifest. Regenerating
    the package keeps it.

    Only that directory: the package root holds ``run_poc.py``, the file the Job
    executes, and an upload must never be able to become it.
    """
    from wizard_api.services import poc_service

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    poc = _poc_dir(session.output_dir)
    if not poc or not os.path.isdir(poc):
        raise HTTPException(status_code=409, detail="generate the PoC package first")

    data = await file.read()
    try:
        name = poc_service.save_sample_input(poc, file.filename or "", data)
    except poc_service.InputRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"name": name, "bytes": len(data), "path": f"sample_input/{name}"}


@router.get("/{session_id}/poc/input")
def list_poc_inputs(session_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    from wizard_api.services import poc_service

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    poc = _poc_dir(session.output_dir)
    if not poc or not os.path.isdir(poc):
        return {"files": []}
    return {"files": poc_service.list_sample_inputs(poc)}


@router.delete("/{session_id}/poc/input/{filename}", status_code=204)
def delete_poc_input(
    session_id: uuid.UUID, filename: str, db: Session = Depends(get_db)
) -> Response:
    from wizard_api.services import poc_service

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    poc = _poc_dir(session.output_dir)
    if not poc or not os.path.isdir(poc):
        raise HTTPException(status_code=404, detail="no PoC package")
    try:
        removed = poc_service.delete_sample_input(poc, filename)
    except poc_service.InputRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="no such input file")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Gate 3 refinement (#96)
# ---------------------------------------------------------------------------


@router.post("/{session_id}/runs/{run_id}/feedback", status_code=201)
def submit_run_feedback(
    session_id: uuid.UUID,
    run_id: str,
    payload: dict,
    db: Session = Depends(get_db),
) -> dict:
    """Record what was wrong with a run, and what kind of change it calls for.

    The classification comes from the agent, which has V1's table and the
    conversation; this records it and reports the rule that follows from it, so
    the user is told what will happen before it happens.
    """
    from wizard_api.services import blueprint_service, refinement

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    try:
        recorded = refinement.classify(
            payload.get("feedback", ""), payload.get("classification", "")
        )
    except refinement.RefinementRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    active = blueprint_service.get_active_version(db, session)
    version = active.version if active else 0

    # Kept on the session so the loop leaves a trail: what was asked for, after
    # which run, and against which blueprint version.
    metadata = dict(session.session_metadata)
    history = list(metadata.get("refinements") or [])
    history.append(
        {
            "run_id": run_id,
            "classification": recorded.classification,
            "feedback": recorded.feedback,
            "blueprint_version": version,
        }
    )
    metadata["refinements"] = history[-50:]
    session_service.update_session(db, session, SessionUpdate(metadata=metadata))

    return {
        "run_id": run_id,
        "classification": recorded.classification,
        "rule": recorded.rule,
        "requires_blueprint_change": recorded.requires_blueprint_change,
        "blueprint_version": version,
    }


@router.get("/{session_id}/refinements")
def list_refinements(session_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return {"refinements": list(session.session_metadata.get("refinements") or [])}


@router.get("/{session_id}/poc/deployable")
def download_deployable_poc(session_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    """The package as someone else receives it, after a run has proved it (#143).

    Two things separate this from the development zip. It is gated on a run that
    actually succeeded — handing over a package nobody has seen work is the
    thing the whole sandbox step exists to prevent — and it leaves behind what
    belongs to developing it: the sample input, the previous run's output, and
    the __pycache__ a package review found being shipped.
    """
    from wizard_api.services import poc_service

    session = session_service.get_session(db, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    run_id = session.session_metadata.get("last_successful_run")
    if not run_id:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "no_successful_run",
                "message": "run the PoC in the sandbox successfully before taking the package",
            },
        )

    poc = _poc_dir(session.output_dir)
    if not poc or not os.path.isdir(poc):
        raise HTTPException(status_code=404, detail="no PoC generated yet")
    problems = poc_service.package_problems(poc)
    if problems:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "poc_package_incomplete",
                "problems": problems,
                "message": "the package is not complete: " + "; ".join(problems),
            },
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for relative in poc_service.deployable_files(poc):
            zf.write(os.path.join(poc, relative), os.path.join("poc", relative))
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="poc-{session_id}-deployable.zip"',
            "X-Wizard-Run-Id": str(run_id),
            "Cache-Control": "no-store",
        },
    )
