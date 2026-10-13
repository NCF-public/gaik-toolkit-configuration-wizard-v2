import os
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv

load_dotenv()


def get_database_url() -> str:
    return os.getenv(
        "WIZARD_DATABASE_URL",
        "postgresql+psycopg://wizard:wizard@localhost:5432/wizard",
    )


def get_service_token() -> str | None:
    """Shared secret the web app must present on every call (#132).

    Unset means service auth is OFF, so local dev, the docker stack and the
    test suite keep working untouched. `main.py` logs a loud warning in that
    case — a deployed environment is expected to set it. Read at call time,
    not import time, so tests can toggle it via monkeypatch.
    """
    token = os.getenv("WIZARD_API_TOKEN", "").strip()
    return token or None


def service_auth_enabled() -> bool:
    return get_service_token() is not None


def get_session_output_root() -> Path:
    return Path(os.getenv("WIZARD_SESSION_OUTPUT_ROOT", "/tmp/wizard-sessions"))


def build_session_output_dir(user_id: str, session_id: UUID) -> str:
    """Per-session artefact path (S1-5 convention stub)."""
    safe_user = user_id.replace("/", "_")
    return str(get_session_output_root() / safe_user / str(session_id))
