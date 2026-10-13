import json
import os
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from wizard_api.config import build_session_output_dir
from wizard_api.models import BlueprintVersion, WizardSession
from wizard_api.schemas.blueprint import (
    AssumptionItem,
    BusinessContext,
    SessionDetailResponse,
)
from wizard_api.schemas.session import SessionCreate, SessionUpdate
from wizard_api.services import blueprint_service
from wizard_api.session_state import MAX_STEP, merge_gate_statuses
from wizard_api.storage import ensure_output_dir


def _session_status(step: int, metadata: dict) -> str:
    if metadata.get("status") == "done" or step >= MAX_STEP:
        return "done"
    return "active"


def _session_title(metadata: dict) -> str:
    title = metadata.get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    return "Nimetön sessio"


def _to_response(session: WizardSession) -> dict:
    return {
        "id": session.id,
        "user_id": session.user_id,
        "step": session.step,
        "gate_statuses": session.gate_statuses,
        "metadata": session.session_metadata,
        "output_dir": session.output_dir,
        "active_version": session.active_version,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }


def _read_business_context(output_dir: str) -> BusinessContext | None:
    """Read the business-facing framing from the agent's V1 draft blueprint
    (``use_case.blueprint.json``) if it has been written. Returns ``None`` when
    the file is missing or unreadable — this is best-effort, never fatal."""
    path = os.path.join(output_dir or "", "use_case.blueprint.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    business = data.get("business_spec") or {}
    use_case = data.get("use_case") or {}

    def _str(value: object) -> str:
        return value.strip() if isinstance(value, str) else ""

    def _list(value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]

    ctx = BusinessContext(
        current_process=_str(business.get("current_process")),
        pain_points=_list(business.get("pain_points")),
        intended_users=_list(business.get("intended_users")),
        reviewers=_list(business.get("reviewers")),
        expected_value=_list(business.get("expected_value")),
        knowledge_processes=_list(use_case.get("knowledge_processes")),
        domain=_str(use_case.get("domain")),
    )
    # Nothing worth surfacing if the file had no business framing at all.
    if not any(
        [
            ctx.current_process,
            ctx.pain_points,
            ctx.intended_users,
            ctx.reviewers,
            ctx.expected_value,
            ctx.knowledge_processes,
            ctx.domain,
        ]
    ):
        return None
    return ctx


def _read_assumptions(output_dir: str) -> list[AssumptionItem]:
    """Read the draft blueprint's ``assumptions[]`` if it has been written.
    Best-effort — returns an empty list when the file is missing/unreadable."""
    path = os.path.join(output_dir or "", "use_case.blueprint.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return []
    raw = data.get("assumptions") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return []
    out: list[AssumptionItem] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        out.append(
            AssumptionItem(
                id=str(item.get("id") or ""),
                text=text.strip(),
                status=str(item.get("status") or "unconfirmed"),
                impact=str(item.get("impact") or ""),
            )
        )
    return out


def session_detail(
    db: Session,
    session: WizardSession,
    versions: list[BlueprintVersion] | None = None,
    active: BlueprintVersion | None = None,
) -> SessionDetailResponse:
    if versions is None:
        versions = blueprint_service.list_versions(db, session.id)
    if active is None:
        active = blueprint_service.get_active_version(db, session)
    metadata = session.session_metadata
    messages = metadata.get("messages")
    if not isinstance(messages, list):
        messages = []
    blueprint = (
        active.content
        if active
        else blueprint_service.default_blueprint_content(_session_title(metadata))
    )
    return SessionDetailResponse(
        id=str(session.id),
        user_id=session.user_id,
        title=_session_title(metadata),
        step=session.step,
        status=_session_status(session.step, metadata),
        gate_statuses=session.gate_statuses,
        metadata=metadata,
        output_dir=session.output_dir,
        active_version=session.active_version,
        versions=[
            {"version": v.version, "note": v.note, "created_at": v.created_at} for v in versions
        ],
        blueprint=blueprint,
        business_context=_read_business_context(session.output_dir),
        assumptions=_read_assumptions(session.output_dir),
        messages=messages,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


def create_session(db: Session, payload: SessionCreate) -> WizardSession:
    session_id = uuid.uuid4()
    output_dir = payload.output_dir or build_session_output_dir(payload.user_id, session_id)
    ensure_output_dir(output_dir)

    title = (payload.title or "").strip() or "Nimetön sessio"
    metadata = dict(payload.metadata)
    metadata.setdefault("title", title)
    metadata.setdefault("status", "active")
    metadata.setdefault("messages", [])

    session = WizardSession(
        id=session_id,
        user_id=payload.user_id,
        output_dir=output_dir,
        session_metadata=metadata,
    )
    db.add(session)
    db.flush()
    blueprint_service.create_initial_version(db, session, title=title)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, session_id: uuid.UUID) -> WizardSession | None:
    return db.get(WizardSession, session_id)


def list_sessions(db: Session, user_id: str) -> list[WizardSession]:
    stmt = (
        select(WizardSession)
        .where(WizardSession.user_id == user_id)
        .order_by(WizardSession.updated_at.desc())
    )
    return list(db.scalars(stmt).all())


def update_session(db: Session, session: WizardSession, payload: SessionUpdate) -> WizardSession:
    if payload.step is not None:
        session.step = payload.step
        metadata = dict(session.session_metadata)
        metadata["status"] = _session_status(session.step, metadata)
        session.session_metadata = metadata
    if payload.gate_statuses is not None:
        session.gate_statuses = merge_gate_statuses(session.gate_statuses, payload.gate_statuses)
    if payload.metadata is not None:
        session.session_metadata = {**session.session_metadata, **payload.metadata}
    session.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(session)
    return session


def append_messages(
    db: Session,
    session: WizardSession,
    user_content: str,
    assistant_content: str,
) -> WizardSession:
    metadata = dict(session.session_metadata)
    messages = list(metadata.get("messages") or [])
    ts = datetime.now(UTC).isoformat()
    messages.append(
        {
            "id": f"msg_{uuid.uuid4().hex[:8]}",
            "role": "user",
            "content": user_content,
            "createdAt": ts,
        }
    )
    messages.append(
        {
            "id": f"msg_{uuid.uuid4().hex[:8]}",
            "role": "assistant",
            "content": assistant_content,
            "createdAt": ts,
        }
    )
    metadata["messages"] = messages
    session.session_metadata = metadata
    session.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(session)
    return session


def session_response(session: WizardSession) -> dict:
    return _to_response(session)
