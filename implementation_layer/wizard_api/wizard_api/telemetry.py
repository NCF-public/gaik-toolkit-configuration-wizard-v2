"""OpenTelemetry spans for the WP5 AIOps stack.

The API sends its spans over OTLP/HTTP to the collector named by the standard
``OTEL_EXPORTER_OTLP_ENDPOINT`` (locally ``http://127.0.0.1:4318``) and nowhere
else; the collector pseudonymises ``enduser.id`` and drops message content
before MLflow sees anything. Spans carry numbers and statuses only, never what
the user or the agent wrote.

Without the endpoint ``setup()`` installs nothing and every span is a no-op, so
tests and deployments that have not been pointed at a collector behave as before.

The ``gaik.*`` attribute names are a draft until the WP5 event schema v1.
"""

import functools
import os
import time
from typing import Any

from fastapi import HTTPException
from opentelemetry import trace
from opentelemetry.trace import Span, Status, StatusCode

SERVICE_NAME = "wizard-v2-api"

tracer = trace.get_tracer("wizard_api")

_provider: Any = None


def setup() -> None:
    """Export spans to the collector when ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set. Idempotent."""
    global _provider
    if _provider is not None or not os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    # The service name picks the MLflow experiment (MLFLOW_EXPERIMENTS in gaik-aiops).
    resource = Resource.create({"service.name": os.getenv("OTEL_SERVICE_NAME") or SERVICE_NAME})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    _provider = provider


def shutdown() -> None:
    """Flush the spans still queued; called when the app stops."""
    if _provider is not None:
        _provider.shutdown()


def refusal(exc: Any) -> str:
    """The short reason an HTTPException gives (``gate_not_ready``, ``agent_busy`` …)."""
    detail = getattr(exc, "detail", None)
    if isinstance(detail, dict) and detail.get("error"):
        return str(detail["error"])
    return str(getattr(exc, "status_code", "error"))


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
                    span.set_attribute("gaik.sandbox.refused", refusal(exc))
                    raise
                if isinstance(started, dict) and started.get("run_id"):
                    span.set_attribute("gaik.sandbox.run_id", started["run_id"])
                return started

        return traced

    return wrap


def record_turn_usage(turn: Span, result: Any, model: str, purpose: str = "turn") -> None:
    """Add one ``chat <model>`` span under ``turn`` from the agent SDK's ResultMessage.

    The SDK runs several model calls inside one query and reports only their
    totals, so this span stands for all of them; ``gaik.agent.num_turns`` says
    how many there were. The SDK prices the query in USD. ``purpose`` tells the
    user's message (``turn``) from the agent's bootstrap (``setup``) and a
    reply-language change (``language``), which cost tokens too.
    """
    end = time.time_ns()
    start = end - int((getattr(result, "duration_ms", 0) or 0) * 1_000_000)
    span = tracer.start_span(
        f"chat {model}", context=trace.set_span_in_context(turn), start_time=start
    )
    usage = getattr(result, "usage", None) or {}
    attributes = {
        "gaik.event.class": "llm_call",
        "gen_ai.operation.name": "chat",
        "gen_ai.system": "anthropic",
        "gen_ai.request.model": model,
        "gen_ai.usage.input_tokens": usage.get("input_tokens"),
        "gen_ai.usage.output_tokens": usage.get("output_tokens"),
        "gen_ai.usage.cache_read.input_tokens": usage.get("cache_read_input_tokens"),
        "gen_ai.usage.cache_creation.input_tokens": usage.get("cache_creation_input_tokens"),
        "gaik.cost.usd": getattr(result, "total_cost_usd", None),
        "gaik.agent.num_turns": getattr(result, "num_turns", None),
        "gaik.agent.purpose": purpose,
    }
    span.set_attributes({k: v for k, v in attributes.items() if v is not None})
    if getattr(result, "is_error", False):
        span.set_status(Status(StatusCode.ERROR, getattr(result, "subtype", None)))
    span.end(end_time=end)
