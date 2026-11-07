"""Operator commands for sessions, run in the api pod.

    python -m wizard_api.session_admin list <user id>
    python -m wizard_api.session_admin delete <session id> --reason data-subject-request
    python -m wizard_api.session_admin protect <session id> [--off]
    python -m wizard_api.session_admin export <user id> --out <folder>

``delete`` goes through the running API, because that process owns the live
agents: it refuses a session in mid-turn and ends the agent before removing it.
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

from wizard_api import config
from wizard_api.db import SessionLocal
from wizard_api.ownership import USER_HEADER
from wizard_api.schemas.session import SessionUpdate
from wizard_api.security import SERVICE_TOKEN_HEADER
from wizard_api.services import session_export, session_removal, session_service

REASONS = ("data-subject-request", "owner-left", "other")


def _api_url() -> str:
    return os.getenv("WIZARD_API_LOCAL_URL", "http://127.0.0.1:8100").rstrip("/")


def _find(db, session_id: str):
    session = session_service.get_session(db, uuid.UUID(session_id))
    if session is None:
        sys.exit(f"no session {session_id}")
    return session


def list_sessions(user_id: str) -> None:
    with SessionLocal() as db:
        sessions = session_service.list_sessions(db, user_id)
        for session in sessions:
            kept = " protected" if session_removal.is_protected(session) else ""
            updated = session.updated_at.date().isoformat()
            title = session.session_metadata.get("title", "")
            print(f"{session.id}  {updated}{kept}  {title}")
        print(f"{len(sessions)} session(s)")


def delete(session_id: str, reason: str) -> None:
    with SessionLocal() as db:
        owner = _find(db, session_id).user_id
    query = urllib.parse.urlencode({"reason": reason})
    headers = {USER_HEADER: owner}
    token = config.get_service_token()
    if token:
        headers[SERVICE_TOKEN_HEADER] = token
    request = urllib.request.Request(
        f"{_api_url()}/sessions/{session_id}?{query}", method="DELETE", headers=headers
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        opener.open(request, timeout=120).close()
    except urllib.error.HTTPError as exc:
        sys.exit(f"not deleted: {exc.code} {exc.read().decode(errors='replace')[:300]}")
    print(f"deleted {session_id}")


def protect(session_id: str, on: bool) -> None:
    with SessionLocal() as db:
        session = _find(db, session_id)
        session_service.update_session(
            db, session, SessionUpdate(metadata={session_removal.PROTECTED_KEY: on})
        )
    print(f"{session_id} protected={on}")


def export(user_id: str, out: str) -> None:
    """One zip per session of the user, for a request to see their data."""
    os.makedirs(out, exist_ok=True)
    with SessionLocal() as db:
        sessions = session_service.list_sessions(db, user_id)
        for session in sessions:
            with open(os.path.join(out, f"session-{session.id}.zip"), "wb") as target:
                session_export.write_archive(session, target)
    print(f"{len(sessions)} session(s) exported to {out}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="session_admin")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list").add_argument("user_id")
    delete_args = commands.add_parser("delete")
    delete_args.add_argument("session_id")
    delete_args.add_argument("--reason", choices=REASONS, required=True)
    protect_args = commands.add_parser("protect")
    protect_args.add_argument("session_id")
    protect_args.add_argument("--off", action="store_true")
    export_args = commands.add_parser("export")
    export_args.add_argument("user_id")
    export_args.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    if args.command == "list":
        list_sessions(args.user_id)
    elif args.command == "delete":
        delete(args.session_id, args.reason)
    elif args.command == "export":
        export(args.user_id, args.out)
    else:
        protect(args.session_id, not args.off)


if __name__ == "__main__":
    main()
