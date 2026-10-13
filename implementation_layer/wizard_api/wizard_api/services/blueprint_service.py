import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from wizard_api.models import BlueprintVersion, WizardSession


def default_blueprint_content(title: str) -> dict:
    """Dummy blueprint so new sessions have editable BPMN/JSON before schema design."""
    name = title.strip() or "Nimetön sessio"
    return {
        "name": name,
        "description": (
            "Placeholder blueprint until schema design — replace with the agreed output fields."
        ),
        "goal": "Draft flow so BPMN and JSON are editable from the first session.",
        "steps": [
            {
                "id": "input",
                "name": "Input",
                "type": "io",
                "description": "User or system input (placeholder)",
            },
            {
                "id": "process",
                "name": "Process",
                "type": "ai",
                "component": "LLM",
                "description": "Core GenAI step (placeholder)",
            },
            {
                "id": "review",
                "name": "Human review",
                "type": "human_review",
                "description": "Optional check before output (placeholder)",
            },
            {
                "id": "output",
                "name": "Output",
                "type": "io",
                "description": "Returned result (placeholder)",
            },
        ],
    }


def create_initial_version(
    db: Session,
    session: WizardSession,
    *,
    title: str,
    note: str = "Alustava blueprint",
) -> BlueprintVersion:
    version = BlueprintVersion(
        session_id=session.id,
        version=1,
        note=note,
        content=default_blueprint_content(title),
    )
    db.add(version)
    session.active_version = 1
    return version


def add_version(
    db: Session,
    session: WizardSession,
    *,
    note: str,
    content: dict | None = None,
) -> BlueprintVersion:
    latest = get_latest_version(db, session.id)
    next_version = 1 if latest is None else latest.version + 1
    body = (
        content
        if content is not None
        else (latest.content if latest else default_blueprint_content(""))
    )
    version = BlueprintVersion(
        session_id=session.id,
        version=next_version,
        note=note,
        content=body,
    )
    db.add(version)
    session.active_version = next_version
    return version


def list_versions(db: Session, session_id: uuid.UUID) -> list[BlueprintVersion]:
    stmt = (
        select(BlueprintVersion)
        .where(BlueprintVersion.session_id == session_id)
        .order_by(BlueprintVersion.version.asc())
    )
    return list(db.scalars(stmt).all())


def get_latest_version(db: Session, session_id: uuid.UUID) -> BlueprintVersion | None:
    stmt = (
        select(BlueprintVersion)
        .where(BlueprintVersion.session_id == session_id)
        .order_by(BlueprintVersion.version.desc())
        .limit(1)
    )
    return db.scalars(stmt).first()


def get_active_version(db: Session, session: WizardSession) -> BlueprintVersion | None:
    stmt = select(BlueprintVersion).where(
        BlueprintVersion.session_id == session.id,
        BlueprintVersion.version == session.active_version,
    )
    return db.scalars(stmt).first()
