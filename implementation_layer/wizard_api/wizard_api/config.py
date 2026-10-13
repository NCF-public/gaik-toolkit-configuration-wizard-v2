import os
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Secrets the API needs but no child process may inherit
# ---------------------------------------------------------------------------
#
# The wizard agent (Claude Agent SDK, ``services/agent_service.py``) is spawned
# from this process and inherits its whole environment: the SDK merges
# ``ClaudeAgentOptions.env`` *over* ``os.environ`` instead of replacing it, so
# an allowlist handed to the SDK removes nothing. The agent has a Bash tool,
# which puts every variable one ``env`` away from a prompt injection — and with
# the service token in hand the agent could call this API as any user.
#
# So the API-internal secrets are read *once*, taken out of ``os.environ`` and
# kept only in this module. The agent, its Bash tool and the V1 scripts it runs
# never see them. Everything the agent legitimately needs (Foundry / Azure /
# OpenAI provider variables for ``generate_schema.py``) is left untouched.
#
# Known limit: a same-UID process can still read this process's *initial*
# environment through ``/proc/<pid>/environ``. Only running the agent in its
# own pod (or restricting its Bash tool) closes that. This is defence in depth,
# not isolation.

API_SECRET_ENV = ("WIZARD_API_TOKEN", "WIZARD_DATABASE_URL")

_consumed: dict[str, str] = {}


def _consume_secret(name: str) -> str | None:
    """Return ``name``'s value, removing it from ``os.environ`` on first read.

    Later reads return the cached value. If the variable is set again after
    that (tests, reconfiguration) the new value is consumed the same way.
    """
    if name in os.environ:
        _consumed[name] = os.environ.pop(name)
    return _consumed.get(name)


def consume_api_secrets() -> None:
    """Take every API-internal secret out of the environment. Idempotent.

    Runs at import so the guarantee does not depend on which getter happens
    to be called before the first agent is spawned.
    """
    for name in API_SECRET_ENV:
        _consume_secret(name)


def forget_consumed_secret(name: str) -> None:
    """Drop the cached value so the next read starts from the environment.

    Exists for the test suite, which toggles secrets per test via monkeypatch;
    production never calls it.
    """
    _consumed.pop(name, None)


consume_api_secrets()


def get_database_url() -> str:
    url = _consume_secret("WIZARD_DATABASE_URL")
    if url is not None:
        return url
    return "postgresql+psycopg://wizard:wizard@localhost:5432/wizard"


def get_service_token() -> str | None:
    """Shared secret the web app must present on every call (#132).

    Unset means service auth is OFF, so local dev, the docker stack and the
    test suite keep working untouched. `main.py` logs a loud warning in that
    case — a deployed environment is expected to set it. Read at call time,
    not import time, so tests can toggle it via monkeypatch. Each read consumes
    the variable from the environment (see above), so the wizard agent never
    inherits it.
    """
    token = (_consume_secret("WIZARD_API_TOKEN") or "").strip()
    return token or None


def service_auth_enabled() -> bool:
    return get_service_token() is not None


def user_header_required() -> bool:
    """When set, every call must name the user it acts for (X-Wizard-User-Id).

    Off by default: the sandbox Job's init container and the stack E2E helpers
    still call the API with the service token alone. Ownership is enforced
    whenever the header IS present regardless of this flag.
    """
    return os.getenv("WIZARD_REQUIRE_USER_HEADER", "").strip() == "1"


def get_session_output_root() -> Path:
    return Path(os.getenv("WIZARD_SESSION_OUTPUT_ROOT", "/tmp/wizard-sessions"))


def build_session_output_dir(user_id: str, session_id: UUID) -> str:
    """Per-session artefact path (S1-5 convention stub)."""
    safe_user = user_id.replace("/", "_")
    return str(get_session_output_root() / safe_user / str(session_id))
