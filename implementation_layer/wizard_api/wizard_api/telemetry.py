"""OpenTelemetry spans for the WP5 AIOps stack.

The API sends its spans over OTLP/HTTP to the collector named by the standard
``OTEL_EXPORTER_OTLP_ENDPOINT`` or ``OTEL_EXPORTER_OTLP_TRACES_ENDPOINT``
(locally ``http://127.0.0.1:4318``) and nowhere else. Spans carry numbers,
statuses and the session id only: never what the user or the agent wrote, and
never who the user is (no e-mail address, no ``enduser.id``).

Without an endpoint ``setup()`` installs nothing and every span is a no-op, so
tests and deployments that have not been pointed at a collector behave as before.

The ``gaik.*`` attribute names are a draft until the WP5 event schema v1.
"""

import asyncio
import contextvars
import functools
import logging
import os
import re
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterable
from typing import Any

from fastapi import HTTPException
from opentelemetry import trace
from opentelemetry.trace import Span, Status, StatusCode

SERVICE_NAME = "wizard-v2-api"

tracer = trace.get_tracer("wizard_api")
logger = logging.getLogger(__name__)

_provider: Any = None

#: Seconds an export may take, so a collector that does not answer cannot hold
#: up the API's shutdown for the exporter's default 10 s. The standard
#: ``OTEL_EXPORTER_OTLP_(TRACES_)TIMEOUT`` overrides it.
EXPORT_TIMEOUT_S = 2


def enabled() -> bool:
    """Whether an OTLP endpoint for traces is configured."""
    return bool(
        os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    )


def setup() -> None:
    """Export spans to the collector when an OTLP endpoint is set. Idempotent."""
    global _provider
    if _provider is not None or not enabled():
        return
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    # The service name picks the MLflow experiment (MLFLOW_EXPERIMENTS in gaik-aiops).
    resource = Resource.create({"service.name": os.getenv("OTEL_SERVICE_NAME") or SERVICE_NAME})
    provider = TracerProvider(resource=resource)
    timeout_set = os.getenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT") or os.getenv(
        "OTEL_EXPORTER_OTLP_TIMEOUT"
    )
    exporter = OTLPSpanExporter() if timeout_set else OTLPSpanExporter(timeout=EXPORT_TIMEOUT_S)
    # Only spans of sessions whose user allowed storing leave the pod.
    provider.add_span_processor(recording.guard(BatchSpanProcessor(exporter)))
    trace.set_tracer_provider(provider)
    _provider = provider
    # Metrics go to the same collector when its base or metrics endpoint is set
    # (a traces-only endpoint says nothing about where metrics belong).
    if os.getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        from wizard_api import ops_metrics

        ops_metrics.setup(resource)
    if os.getenv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        _setup_logs(resource)


_SESSION_PATH = re.compile(
    r"/sessions/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
)


def _local_root(span: Any) -> bool:
    """Whether ``span`` is the first span this process made in its trace."""
    return span.parent is None or span.parent.is_remote


def _sessions_named(span: Any) -> set[str]:
    """The sessions a finished span names: by attribute, or in the request's path."""
    attributes = span.attributes or {}
    named = set()
    if attributes.get("gaik.session.id"):
        named.add(str(attributes["gaik.session.id"]).lower())
    match = _SESSION_PATH.search(str(attributes.get("url.path") or ""))
    if match:
        named.add(match.group(1).lower())
    return named


class Recording:
    """Which sessions' spans may leave the pod (WP5 M2: the user's choice).

    A user chooses when a session starts whether its data is stored for AIOps.
    Only a session known here as stored is exported: a session that said no, was
    never asked, or that this process has not seen is kept in the pod, so a
    mistake drops a span and never sends one.

    The choice is known only after the request's own span has started, and spans
    end in any order: FastAPI's child spans before their root, a ``wizard.turn``
    long after it. So the decision is kept per trace. ``guard`` holds a trace's
    spans until the request's span ends; a trace of a session that is not stored
    is ``withhold``-ed, and its spans are dropped then and for ``keep_seconds``
    after its last one (longer than a turn may run).
    """

    #: Sessions and held traces remembered at most; the oldest go first, which
    #: drops their spans.
    MAX_ENTRIES = 50_000

    def __init__(self, keep_seconds: float | None = None) -> None:
        self._keep_seconds = keep_seconds
        self._lock = threading.Lock()
        self._stored: dict[str, None] = {}
        self._withheld: dict[int, float] = {}

    def keep_seconds(self) -> float:
        if self._keep_seconds is not None:
            return self._keep_seconds
        from wizard_api import config

        return config.turn_timeout_seconds() + 15 * 60

    def allow(self, session_id: Any) -> None:
        """The user of ``session_id`` allowed storing: its spans may be exported."""
        key = str(session_id).lower()
        with self._lock:
            self._stored.pop(key, None)
            self._stored[key] = None
            while len(self._stored) > self.MAX_ENTRIES:
                self._stored.pop(next(iter(self._stored)))

    def forget(self, session_id: Any) -> None:
        """Stop exporting ``session_id``'s spans (it is not stored after all)."""
        with self._lock:
            self._stored.pop(str(session_id).lower(), None)

    def allowed(self, session_id: Any) -> bool:
        with self._lock:
            return str(session_id).lower() in self._stored

    def withhold(self, span: Span) -> None:
        """Keep the whole trace ``span`` is in inside the pod."""
        context = span.get_span_context()
        if context.is_valid:
            self._withhold(context.trace_id)

    def _withhold(self, trace_id: int) -> None:
        now = time.monotonic()
        with self._lock:
            self._withheld.pop(trace_id, None)
            self._withheld[trace_id] = now
            # Oldest first: every write moves its trace to the end, so only the
            # front is ever looked at, however many traces are remembered.
            limit = now - self.keep_seconds()
            while self._withheld:
                oldest = next(iter(self._withheld))
                if self._withheld[oldest] >= limit and len(self._withheld) <= self.MAX_ENTRIES:
                    break
                del self._withheld[oldest]

    def withheld(self, span: Any) -> bool:
        """Whether ``span``'s trace stays in the pod; decided from the span too.

        A span that names a session which is not known as stored withholds its
        trace, whoever made the span and whether or not a request named it."""
        trace_id = span.context.trace_id
        if not all(self.allowed(session) for session in _sessions_named(span)):
            self._withhold(trace_id)
            return True
        with self._lock:
            known = trace_id in self._withheld
        if known:
            self._withhold(trace_id)  # still in use: keep it from expiring
        return known

    def guard(self, export: Any) -> Any:
        """A span processor that passes on to ``export`` only what may leave."""
        from opentelemetry.sdk.trace import SpanProcessor

        recording = self

        class Guard(SpanProcessor):
            def __init__(self) -> None:
                self._lock = threading.Lock()
                #: trace id -> [request spans still open, spans that ended]
                self._held: dict[int, list] = {}

            def on_start(self, span: Any, parent_context: Any = None) -> None:
                if _local_root(span):
                    with self._lock:
                        held = self._held.setdefault(span.context.trace_id, [0, []])
                        held[0] += 1
                        while len(self._held) > recording.MAX_ENTRIES:
                            self._held.pop(next(iter(self._held)))
                export.on_start(span, parent_context)

            def on_end(self, span: Any) -> None:
                trace_id = span.context.trace_id
                withheld = recording.withheld(span)
                with self._lock:
                    held = self._held.get(trace_id)
                    if held is None:
                        # The request's span has ended: a turn's spans come later.
                        release = [] if withheld else [span]
                    else:
                        held[1].append(span)
                        if _local_root(span):
                            held[0] -= 1
                        if withheld:
                            held[1].clear()
                        if held[0] > 0:
                            release = []
                        else:
                            release = held[1]
                            del self._held[trace_id]
                for ended in release:
                    export.on_end(ended)

            def shutdown(self) -> None:
                export.shutdown()

            def force_flush(self, timeout_millis: int = 30000) -> bool:
                return export.force_flush(timeout_millis)

        return Guard()


#: The process's one record of which sessions are stored.
recording = Recording()


_log_provider: Any = None


_UUID = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)
_ADDRESS = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")


def exportable_record(record: logging.LogRecord) -> logging.LogRecord:
    """A copy of ``record`` fit to leave the pod.

    The collector pseudonymises session ids in attributes, not inside a message,
    so ids (session, run, case: all UUIDs) and any e-mail address in the text are
    replaced. The record keeps its trace id, which leads to the pseudonymised
    session. A traceback stays in the pod's own log: it can hold paths and
    values; the exported record names only the exception type.
    """
    copy = logging.makeLogRecord(record.__dict__)
    text = _ADDRESS.sub("<address>", _UUID.sub("<id>", record.getMessage()))
    if record.exc_info and record.exc_info[0] is not None:
        text = f"{text} ({record.exc_info[0].__name__})"
    copy.msg, copy.args = text, None
    copy.exc_info = copy.exc_text = copy.stack_info = None
    return copy


#: The API's own loggers: ``wizard_api`` and everything under it.
API_LOGGER = "wizard_api"
_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def log_level() -> int:
    """``WIZARD_LOG_LEVEL`` as a level (DEBUG, INFO, WARNING, ERROR); INFO unless set."""
    level = logging.getLevelName(os.getenv("WIZARD_LOG_LEVEL", "").strip().upper() or "INFO")
    return level if isinstance(level, int) else logging.INFO


def _let_through(level: int) -> None:
    """Let the API's loggers pass records at ``level`` on to their handlers."""
    tree = logging.getLogger(API_LOGGER)
    if tree.getEffectiveLevel() > level:
        tree.setLevel(level)


def configure_logging(stream: Any = None) -> None:
    """Print the API's own log lines in the pod, from ``WIZARD_LOG_LEVEL``. Idempotent.

    Uvicorn configures its own loggers only, so the API's were left at the root's
    WARNING: an INFO line, such as each tool call the agent's guard decides, was
    dropped before any handler saw it. The ``wizard_api`` loggers get their level
    here and a handler that prints to stderr (``stream`` in tests), unless one
    that writes to a stream is already on them or on the root, which would print
    each line twice.

    Records still go on to the root, where the collector's handler keeps its own
    level (``WIZARD_OTEL_LOG_LEVEL``, WARNING unless set): an INFO line reaches the
    collector only when that asks for it, and once.
    """
    level = log_level()
    tree = logging.getLogger(API_LOGGER)
    tree.setLevel(level)
    if any(
        isinstance(h, logging.StreamHandler) for h in tree.handlers + logging.getLogger().handlers
    ):
        return
    handler = logging.StreamHandler(stream)
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    tree.addHandler(handler)


class _NotOwnExporter(logging.Filter):
    """Keep the exporter's own complaints out of the records it exports."""

    def filter(self, record: logging.LogRecord) -> bool:
        return not record.name.startswith(("opentelemetry", "urllib3"))


def _setup_logs(resource: Any) -> None:
    """Send log records at ``WIZARD_OTEL_LOG_LEVEL`` (WARNING unless set) and above.

    The pod's own output is not collected in a shared project, so the API sends
    its records to the collector itself; the collector's privacy step runs on
    them before they are stored.
    """
    global _log_provider
    if _log_provider is not None:
        return
    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor

    level = getattr(logging, os.getenv("WIZARD_OTEL_LOG_LEVEL", "WARNING").upper(), logging.WARNING)
    provider = LoggerProvider(resource=resource)
    timeout_set = os.getenv("OTEL_EXPORTER_OTLP_LOGS_TIMEOUT") or os.getenv(
        "OTEL_EXPORTER_OTLP_TIMEOUT"
    )
    exporter = OTLPLogExporter() if timeout_set else OTLPLogExporter(timeout=EXPORT_TIMEOUT_S)
    provider.add_log_record_processor(BatchLogRecordProcessor(exporter))

    class _ExportHandler(LoggingHandler):
        def emit(self, record: logging.LogRecord) -> None:
            super().emit(exportable_record(record))

    handler = _ExportHandler(level=level, logger_provider=provider)
    handler.addFilter(_NotOwnExporter())
    logging.getLogger().addHandler(handler)
    # WIZARD_OTEL_LOG_LEVEL=INFO must reach the API's INFO lines even where the
    # pod prints only warnings; the pod's handler keeps WIZARD_LOG_LEVEL.
    _let_through(level)
    _log_provider = provider


def shutdown() -> None:
    """Flush the spans and metrics still queued; called when the app stops."""
    from wizard_api import ops_metrics

    ops_metrics.shutdown()
    if _log_provider is not None:
        _log_provider.shutdown()
    if _provider is not None:
        _provider.shutdown()


def refusal(exc: Any) -> str:
    """The short reason an HTTPException gives (``gate_not_ready``, ``agent_busy`` …)."""
    detail = getattr(exc, "detail", None)
    if isinstance(detail, dict) and detail.get("error"):
        return str(detail["error"])
    return str(getattr(exc, "status_code", "error"))


def record_failure(span: Span, exc: BaseException) -> None:
    """Mark ``span`` failed by an exception the API did not expect (not a refusal).

    Only the exception's type goes on the span: its message can quote data.
    """
    span.set_attribute("error.type", type(exc).__qualname__)
    span.set_status(Status(StatusCode.ERROR, type(exc).__qualname__))


def record_refusal(span: Span, attribute: str, exc: HTTPException) -> None:
    """Put the reason an HTTPException gives on ``span``.

    A 4xx is an answer (the request may not be done now), so the span keeps its
    status. A 5xx is the API failing to do it, so the span is an error too.
    """
    reason = refusal(exc)
    span.set_attribute(attribute, reason)
    if getattr(exc, "status_code", 500) >= 500:
        span.set_attribute("error.type", reason)
        span.set_status(Status(StatusCode.ERROR, reason))


#: The request's own span (FastAPI's root span, named by route template), set
#: by ``RequestSpanMiddleware`` for the request's whole handling.
_request_span: contextvars.ContextVar[Span | None] = contextvars.ContextVar(
    "wizard_request_span", default=None
)


class RequestSpanMiddleware:
    """Keep the request's own span for the code that handles the request.

    FastAPI makes the request's span outside every middleware, so here it is the
    current one. Further in, a dependency (the ownership check) or the endpoint
    runs in FastAPI's child spans (``fastapi.dependencies``, ``fastapi.endpoint``),
    while MLflow reads a trace's tags only on its root span. Plain ASGI, so the
    variable is set in the task that runs the route and its streaming body.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        token = _request_span.set(trace.get_current_span())
        try:
            await self.app(scope, receive, send)
        finally:
            _request_span.reset(token)


def current_span() -> Span:
    """The span code runs in now, such as a ``wizard.sandbox.start`` span."""
    return trace.get_current_span()


def request_span() -> Span:
    """The request's own span; the current span outside a request.

    A request span that has ended (a turn outlived its request) is still
    returned, so naming it does nothing rather than reaching a span inside the
    turn."""
    span = _request_span.get()
    if span is not None and span.get_span_context().is_valid:
        return span
    return trace.get_current_span()


def name_session(session_id: Any, stored: bool) -> bool:
    """Put the session's id on the request's span, so the collector files the
    request under that session (MLflow groups traces by it). The id is
    pseudonymised in the collector like every ``gaik.session.id``. Without a
    recording span this does nothing.

    Only for a session whose user allowed storing (``stored``). The request of
    any other session is not named and its whole trace stays in the pod
    (``Recording``). Returns ``stored``."""
    if not stored:
        recording.forget(session_id)
        recording.withhold(request_span())
        return False
    recording.allow(session_id)
    request_span().set_attribute("gaik.session.id", str(session_id))
    return True


#: The session's active blueprint version when a span was recorded (WP5 M2).
BLUEPRINT_VERSION = "gaik.config.blueprint_version"


def name_blueprint_version(version: Any, span: Span | None = None) -> None:
    """Put the session's active blueprint version on ``span`` (by default the
    request's own span, ``request_span``), so its traces can be compared version
    by version. A missing version adds nothing, and neither does a span that has
    already ended (a turn outlives its request)."""
    span = span or request_span()
    if version is None or not span.is_recording():
        return
    span.set_attribute(BLUEPRINT_VERSION, int(version))


def sandbox_start_span(kind: str):
    """Wrap a run-starting endpoint in a ``wizard.sandbox.start`` span.

    The run itself is a Job that goes on after the request returns; its
    outcome is the ``wizard.sandbox.result`` span, matched by ``run_id``.
    """

    def wrap(endpoint):
        @functools.wraps(endpoint)
        def traced(*args, **kwargs):
            # A refused start is an answer, not a failure of the API: no error status.
            with tracer.start_as_current_span(
                "wizard.sandbox.start", record_exception=False, set_status_on_exception=False
            ) as span:
                span.set_attributes(
                    {"gaik.session.id": str(kwargs.get("session_id")), "gaik.sandbox.kind": kind}
                )
                try:
                    started = endpoint(*args, **kwargs)
                except HTTPException as exc:
                    record_refusal(span, "gaik.sandbox.refused", exc)
                    raise
                except Exception as exc:
                    record_failure(span, exc)
                    raise
                if isinstance(started, dict) and started.get("run_id"):
                    span.set_attribute("gaik.sandbox.run_id", started["run_id"])
                return started

        return traced

    return wrap


def query_cost(agent: dict, result: Any) -> float | None:
    """What this one query cost, in USD.

    The SDK's ``total_cost_usd`` is a running total for the agent's client, not
    the price of the last query: each query's cost is the difference from the
    previous total, which is kept on the agent. A new client starts from zero.
    """
    total = getattr(result, "total_cost_usd", None)
    if total is None:
        return None
    before = agent.get("cost_total_usd", 0.0)
    agent["cost_total_usd"] = total
    return total - before if total >= before else total


#: What a query that ended with no result (a timeout, a crashed or killed
#: agent) is charged for the usage caps, in USD, when its agent's own budget
#: does not leave less: its real cost never arrives. About one long reply.
UNREPORTED_QUERY_COST_USD = 1.0


def unreported_query_cost(agent: dict) -> float:
    """The estimate charged for ``agent``'s query that ended with no result."""
    from wizard_api import ops_metrics

    estimate = UNREPORTED_QUERY_COST_USD
    budget = agent.get("budget_usd")
    if budget is not None:
        estimate = max(0.0, min(estimate, budget - agent.get("cost_total_usd", 0.0)))
    logger.warning("a query ended with no result; %.2f USD is counted for it", estimate)
    ops_metrics.usage_unreported.add(1)
    return estimate


def _response_model(result: Any) -> str | None:
    """The model that did most of the query's work, from the SDK's per-model usage."""
    per_model = getattr(result, "model_usage", None) or {}
    if not per_model:
        return None
    return max(per_model, key=lambda name: (per_model[name] or {}).get("outputTokens") or 0)


def cost_attributes(cost_usd: float | None, prefix: str = "gaik.cost") -> dict:
    """``<prefix>.usd`` and, with ``WIZARD_USD_EUR_RATE`` set, ``<prefix>.eur`` and the rate.

    Empty when there is no cost. The euros are the USD estimate at the deployment's
    fixed rate (``config.usd_eur_rate``), kept beside it (``gaik.cost.usd_eur_rate``) so a
    trace says which rate it used. ``gaik.cost.*`` is a model call's own cost; a total of
    several has its own prefix, so adding up a trace's ``gaik.cost.eur`` counts each once.
    """
    from wizard_api import config

    if cost_usd is None:
        return {}
    attributes = {f"{prefix}.usd": cost_usd}
    rate = config.usd_eur_rate()
    if rate is not None:
        attributes[f"{prefix}.eur"] = round(cost_usd * rate, 6)
        attributes["gaik.cost.usd_eur_rate"] = rate
    return attributes


def record_turn_usage(
    turn: Span,
    result: Any,
    model: str,
    purpose: str = "turn",
    cost: float | None = None,
    *,
    replaced: bool = False,
) -> None:
    """Add one ``chat <model>`` span under ``turn`` from the agent SDK's ResultMessage.

    The SDK runs several model calls inside one query and reports only their
    totals, so this span stands for all of them; ``gaik.agent.num_turns`` says
    how many there were. ``model`` is the model the API asked for; the model
    that answered, from the SDK's per-model usage, is ``gen_ai.response.model``.
    ``cost`` is the query's own price in USD (see ``query_cost``), also in euros when
    the deployment sets a rate (``cost_attributes``). ``purpose``
    tells the user's message (``turn``) from the agent's bootstrap (``setup``)
    and a reply-language change (``language``), which cost tokens too.

    ``gen_ai.usage.input_tokens`` counts every input token, as the OTel GenAI
    convention asks: Anthropic's ``input_tokens`` leaves out the tokens read
    from or written to the prompt cache, which are added here and also kept
    on their own attributes.

    ``replaced`` marks a failed query whose message was answered by a retry on a
    new agent: it is recorded, with ``gaik.agent.replaced``, but not as an error.
    """
    end = time.time_ns()
    start = end - int((getattr(result, "duration_ms", 0) or 0) * 1_000_000)
    span = tracer.start_span(
        f"chat {model}", context=trace.set_span_in_context(turn), start_time=start
    )
    # The turn's session, so that a chat span says by itself whose it is: the
    # recording guard then keeps it in the pod without having to know its trace.
    session = (getattr(turn, "attributes", None) or {}).get("gaik.session.id")
    if session:
        span.set_attribute("gaik.session.id", session)
    usage = getattr(result, "usage", None) or {}
    uncached = usage.get("input_tokens")
    cache_read = usage.get("cache_read_input_tokens")
    cache_creation = usage.get("cache_creation_input_tokens")
    parts = [n for n in (uncached, cache_read, cache_creation) if n is not None]
    attributes = {
        "gaik.event.class": "llm_call",
        "gen_ai.operation.name": "chat",
        "gen_ai.system": "anthropic",
        "gen_ai.request.model": model,
        "gen_ai.response.model": _response_model(result),
        "gen_ai.usage.input_tokens": sum(parts) if parts else None,
        "gen_ai.usage.output_tokens": usage.get("output_tokens"),
        "gen_ai.usage.cache_read.input_tokens": cache_read,
        "gen_ai.usage.cache_creation.input_tokens": cache_creation,
        **cost_attributes(cost),
        "gaik.agent.num_turns": getattr(result, "num_turns", None),
        "gaik.agent.purpose": purpose,
    }
    span.set_attributes({k: v for k, v in attributes.items() if v is not None})
    if getattr(result, "terminal_reason", None) in ("aborted_streaming", "aborted_tools"):
        # The user stopped the reply: the query ended early, as asked.
        span.set_attribute("gaik.agent.stopped", True)
    elif getattr(result, "is_error", False):
        if replaced:
            span.set_attribute("gaik.agent.replaced", True)
        else:
            span.set_status(Status(StatusCode.ERROR, getattr(result, "subtype", None)))
    span.end(end_time=end)


async def traced_turn(
    frames: AsyncIterator[str],
    attributes: dict,
    agents: Callable[[], Iterable[tuple[dict, bool]]],
    model: str,
    is_error: Callable[[str], bool],
    is_stopped: Callable[[str], bool] | None = None,
    on_cost: Callable[[float], None] | None = None,
) -> AsyncIterator[str]:
    """Pass a chat turn's SSE ``frames`` through, inside one ``wizard.turn`` span.

    When the stream ends, each query the agents ran for it (``turn_results`` on
    the agent: the message itself, and a setup or language change before it)
    becomes a ``chat`` span under the turn. ``agents()`` gives the agents to read,
    at the end of the stream, each with whether a retry replaced it. The turn
    is an error when a frame the user saw was an error. A turn the client left
    before it ended (closed tab, dropped connection) is ``gaik.turn.aborted``;
    the query it cut short has no ``chat`` span, as its usage never arrived. A
    turn the user stopped (a frame ``is_stopped`` knows) is ``gaik.turn.stopped``
    and counted with the outcome ``stopped``, not as a failure. The turn span has
    the sum of its chat spans' cost as ``gaik.turn.cost.usd`` and ``.eur``
    (``cost_attributes``). ``on_cost`` is
    given the turn's whole cost in USD, when the queries reported one, for the
    usage caps (services/usage_caps.py). ``attributes`` is set when the turn
    starts and again when it ends, so the caller can update a value meanwhile.
    """
    from wizard_api import ops_metrics

    turn = tracer.start_span("wizard.turn")
    turn.set_attributes(attributes)
    failed = False
    stopped = False
    outcome = "completed"
    started = time.monotonic()
    first = True
    try:
        async for frame in frames:
            if first:
                ops_metrics.turn_first_frame.record(time.monotonic() - started)
                first = False
            failed = failed or is_error(frame)
            stopped = stopped or (is_stopped is not None and is_stopped(frame))
            yield frame
    except (asyncio.CancelledError, GeneratorExit):
        turn.set_attribute("gaik.turn.aborted", True)
        outcome = "aborted"
        raise
    except Exception as exc:
        record_failure(turn, exc)
        outcome = "failed"
        raise
    finally:
        if outcome == "completed" and failed:
            outcome = "failed"
        elif outcome == "completed" and stopped:
            outcome = "stopped"
            turn.set_attribute("gaik.turn.stopped", True)
        ops_metrics.turns.add(1, {"outcome": outcome})
        if outcome != "aborted":
            ops_metrics.turn_duration.record(time.monotonic() - started, {"outcome": outcome})
        # Each client keeps its own running cost, so each is priced against its own.
        spent = 0.0
        reported: float | None = None
        for agent, replaced in agents():
            for purpose, result in agent.pop("turn_results", None) or []:
                cost = query_cost(agent, result)
                record_turn_usage(turn, result, model, purpose, cost=cost, replaced=replaced)
                spent += cost or 0.0
                if cost is not None:
                    reported = (reported or 0.0) + cost
            if agent.pop("query_unfinished", False):
                spent += unreported_query_cost(agent)
        # The turn's cost is what its chat spans reported; the estimate for a query whose
        # cost never arrived counts for the usage caps only.
        turn.set_attributes(cost_attributes(reported, prefix="gaik.turn.cost"))
        if on_cost is not None and spent > 0:
            on_cost(spent)
        if failed:
            turn.set_status(Status(StatusCode.ERROR))
        # Read again: a value the turn itself changed (the blueprint version the
        # agent's draft became) is recorded as the turn left it.
        turn.set_attributes(attributes)
        turn.end()
