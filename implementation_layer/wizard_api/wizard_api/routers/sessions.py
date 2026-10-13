import asyncio
import io
import os
import uuid
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from wizard_api.db import get_db
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
    return {"generated": True, "files": files}


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
    updated = session_service.update_session(db, session, payload)
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
