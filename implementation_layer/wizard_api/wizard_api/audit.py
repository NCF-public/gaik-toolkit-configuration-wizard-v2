"""Audit events: who did what to which session, and what it cost.

Each event is one OpenTelemetry log record of the class ``audit``
(``gaik.event.class``), sent with the API's other records to the AIOps
collector, which pseudonymises the owner and the session and hands the record
to the collection sink. The sink keeps audit records apart from the logs, for
their own retention, and they cannot be changed afterwards
(``gaik-aiops/shared/collection``).

Audit events are a security and accounting record, so they are sent for every
session, whether or not its user allowed storing usage data: who started a
session, approved a gate, ran the sandbox or spent money must be traceable when
something goes wrong. That is also why an event carries no more than ids, fixed
codes and numbers: never an e-mail address, a title, a file name or anything a
user or the agent wrote. ``event`` drops any field it does not know, and any
owner that is not an owner id (``o_…``; a session made before owner ids has its
owner's address as its user id, which is left out).

The owner and the session default to the request's: ``AuditContextMiddleware``
reads the ``X-Wizard-User-Id`` header and the session in the path. Without an
OTLP logs endpoint nothing is sent; the pod's own log gets one INFO line per
event either way.
"""

from __future__ import annotations

import contextvars
import logging
import time
from typing import Any

from wizard_api.owner_id import is_owner_id

logger = logging.getLogger(__name__)

EVENT_CLASS = "gaik.event.class"
AUDIT = "audit"
EVENT_NAME = "event.name"
OUTCOME = "gaik.audit.outcome"
ACTOR = "enduser.id"
SESSION = "gaik.session.id"
REQUEST_ID = "gaik.request.id"

SUCCESS = "success"
DENIED = "denied"
ERROR = "error"
OUTCOMES = frozenset({SUCCESS, DENIED, ERROR})

#: The fields an event may carry besides the envelope, and what each holds.
#: Values are fixed codes, ids that lead to no person, or numbers.
FIELDS = frozenset(
    {
        "gaik.audit.reason",  # a fixed code: why (delete reason, refusal code, cap scope)
        "gaik.gate",
        "gaik.gate.from",
        "gaik.gate.to",
        "gaik.gate.by",  # user, agent, change
        "gaik.sandbox.kind",  # run, check, case
        "gaik.sandbox.run_id",
        "gaik.cost.usd",
        "gaik.cost.user_total_usd",
        "gaik.cost.session_total_usd",
        "gaik.cost.deployment_total_usd",
        "gaik.cost.period",  # the month a deployment total is for, YYYY-MM
        "gaik.usage.limit",  # agent, usage_cap
        "gaik.http.method",
        "gaik.operator.command",
        "gaik.operator.apply",
        "gaik.operator.count",
    }
)
#: The longest string value kept; a longer one is no code or id.
MAX_TEXT = 64

_owner: contextvars.ContextVar[str | None] = contextvars.ContextVar("audit_owner", default=None)
_session: contextvars.ContextVar[str | None] = contextvars.ContextVar("audit_session", default=None)


def _clean(fields: dict[str, Any]) -> dict[str, Any]:
    kept: dict[str, Any] = {}
    for key, value in fields.items():
        if key not in FIELDS or value is None:
            if value is not None:
                logger.warning("audit field %s is not in the audit schema; left out", key)
            continue
        if isinstance(value, bool | int):
            kept[key] = value
        elif isinstance(value, float):
            kept[key] = round(value, 6)
        else:
            text = str(value)
            if len(text) > MAX_TEXT or "@" in text:
                logger.warning("audit field %s is no code or id; left out", key)
                continue
            kept[key] = text
    return kept


def attributes(
    name: str,
    outcome: str,
    fields: dict[str, Any] | None = None,
    *,
    owner: str | None = None,
    session_id: Any = None,
) -> dict[str, Any]:
    """The record's attributes for ``event``: the envelope and the known fields only."""
    if outcome not in OUTCOMES:
        raise ValueError(f"audit outcome must be one of {sorted(OUTCOMES)}")
    from wizard_api import errors

    owner = owner if owner is not None else _owner.get()
    session = str(session_id) if session_id is not None else _session.get()
    attrs: dict[str, Any] = {
        EVENT_CLASS: AUDIT,
        EVENT_NAME: name,
        OUTCOME: outcome,
        REQUEST_ID: errors.current_trace_id(),
    }
    if owner and is_owner_id(owner):
        attrs[ACTOR] = owner
    if session:
        attrs[SESSION] = session
    attrs.update(_clean(fields or {}))
    return attrs


def event(
    name: str,
    outcome: str,
    fields: dict[str, Any] | None = None,
    *,
    owner: str | None = None,
    session_id: Any = None,
) -> None:
    """Send one audit event. Never raises: a lost audit record is logged, not a failed request.

    ``fields`` maps keys of ``FIELDS`` to their values; ``owner`` and
    ``session_id`` default to the request's.
    """
    try:
        attrs = attributes(name, outcome, fields, owner=owner, session_id=session_id)
    except ValueError:
        logger.exception("audit event %s not sent", name)
        return
    logger.info("audit %s %s", name, outcome)
    from wizard_api import telemetry

    emitter = telemetry.audit_logger()
    if emitter is None:
        return
    try:
        from opentelemetry._logs import SeverityNumber

        emitter.emit(
            timestamp=time.time_ns(),
            severity_number=SeverityNumber.INFO,
            severity_text="INFO",
            body=name,
            event_name=name,
            attributes=attrs,
        )
    except Exception:  # noqa: BLE001 - the request goes on; the pod's log has the line
        logger.exception("audit event %s not sent", name)


def operator(
    command: str, outcome: str, fields: dict[str, Any] | None = None, *, session_id: Any = None
) -> None:
    """An operator command's event (``session_admin``), with its subcommand."""
    event(
        "operator.session_admin",
        outcome,
        {"gaik.operator.command": command, **(fields or {})},
        session_id=session_id,
    )


class AuditContextMiddleware:
    """Name the request's owner and session for the audit events it causes.

    The owner is the ``X-Wizard-User-Id`` header the web app's proxy sends under
    the service token; the session is the one in the path. Plain ASGI, so the
    values reach the route, its streaming body and the tasks it starts.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        from wizard_api import telemetry
        from wizard_api.ownership import USER_HEADER

        header = USER_HEADER.lower().encode("latin-1")
        owner = next(
            (v.decode("latin-1").strip() for k, v in scope.get("headers") or [] if k == header),
            None,
        )
        named = telemetry.session_in_path(scope.get("path") or "")
        owner_token = _owner.set(owner or None)
        session_token = _session.set(named[0] if named else None)
        try:
            await self.app(scope, receive, send)
        finally:
            _owner.reset(owner_token)
            _session.reset(session_token)
