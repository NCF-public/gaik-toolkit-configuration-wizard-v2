"""What a wizard session's spans say about how it went.

Everything here is read from numbers and statuses the wizard records
(``wizard_api/telemetry.py``): gate changes, sandbox results, the cost of each
turn and when things happened. No prompt or response text exists in the stack,
and none is needed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

GATE = "wizard.gate"
TURN = "wizard.turn"
SANDBOX_RESULT = "wizard.sandbox.result"

#: The sandbox phases that say how a run ended; any other is a run not yet known.
SETTLED_PHASES = ("succeeded", "failed", "timeout")

#: The gate that ends a session: with it approved, the user accepted the result.
LAST_GATE = "gate_4"

FINISHED = "Session finished"
POC_PASSED = "PoC run passed"
REJECTIONS = "Gate rejections"
COST_EUR = "Session cost EUR"
COST_USD = "Session cost USD"
DURATION = "Session duration min"
FINISHED_POC_COST_EUR = "Finished PoC cost EUR"
FINISHED_POC_DURATION = "Finished PoC duration min"

#: Every score this module can give, for the ones a session no longer has.
SCORES = (
    FINISHED,
    POC_PASSED,
    REJECTIONS,
    COST_EUR,
    COST_USD,
    DURATION,
    FINISHED_POC_COST_EUR,
    FINISHED_POC_DURATION,
)


@dataclass(frozen=True)
class Span:
    """One span, as far as scoring reads it."""

    name: str
    start_ns: int
    end_ns: int
    ok: bool = True
    attributes: dict = field(default_factory=dict)


def _listed(span: Span, key: str) -> list[str]:
    return [part.strip() for part in str(span.attributes.get(key, "")).split(",") if part.strip()]


def gate_changes(span: Span) -> list[tuple[str, str, str]]:
    """The gate changes a ``wizard.gate`` span made, as (gate, from, to).

    A refused change (``gaik.gate.refused``) and one the API failed (error
    status) changed nothing.
    """
    if span.name != GATE or not span.ok or "gaik.gate.refused" in span.attributes:
        return []
    return list(
        zip(
            _listed(span, "gaik.gate"),
            _listed(span, "gaik.gate.from"),
            _listed(span, "gaik.gate.to"),
        )
    )


def _last_gate_sightings(spans: list[Span]) -> list[tuple[int, str]]:
    """Each time a span says what the last gate's status is, as (when, status).

    A gate span says it when it ends. A turn span says where the gates stood
    when the turn began, which also shows a gate reopened without a gate span
    (the reopen endpoint and the agent's tool make none).
    """
    seen = []
    for span in spans:
        for gate, _old, new in gate_changes(span):
            if gate == LAST_GATE:
                seen.append((span.end_ns, new))
        if span.name == TURN:
            for pair in _listed(span, "gaik.gate_statuses"):
                gate, _, status = pair.partition("=")
                if gate == LAST_GATE:
                    seen.append((span.start_ns, status))
    return sorted(seen)


def _number(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _total(spans: list[Span], key: str) -> float | None:
    """The sum of ``key`` over the turns; None when no turn has it."""
    costs = [_number(s.attributes.get(key)) for s in spans if s.name == TURN]
    costs = [c for c in costs if c is not None]
    return round(sum(costs), 6) if costs else None


def scores(spans: list[Span], started_ns: int, ended_ns: int) -> dict[str, float]:
    """The session's scores, from all its spans and its first and last moment.

    - ``Session finished``: 1 when the last gate stands approved, else 0.
    - ``PoC run passed``: 1 when the latest settled run of the package succeeded,
      0 when it failed or timed out; absent when no run settled. A run whose
      result was not known (still running, unknown) says nothing, and a
      preflight check or a single case's run is not a run of the package.
    - ``Gate rejections``: how many times the user rejected a gate or took an
      approval back.
    - ``Session cost EUR`` / ``USD``: the turns' cost; euros only when the
      deployment has a rate.
    - ``Session duration min``: from the first span to the last, idle time included.
    - ``Finished PoC cost EUR`` / ``duration min``: the same two numbers, given
      only for a finished session whose PoC run passed, so their average is the
      price and time of one working PoC.
    """
    sightings = _last_gate_sightings(spans)
    finished = bool(sightings) and sightings[-1][1] == "approved"

    runs = sorted(
        (
            s
            for s in spans
            if s.name == SANDBOX_RESULT
            and s.attributes.get("gaik.sandbox.kind") == "run"
            and s.attributes.get("gaik.sandbox.phase") in SETTLED_PHASES
        ),
        key=lambda s: s.end_ns,
    )
    rejections = sum(
        1
        for span in spans
        for _gate, old, new in gate_changes(span)
        if new == "rejected" or (old == "approved" and new == "pending")
    )
    duration = round(max(0, ended_ns - started_ns) / 60e9, 2)
    result: dict[str, float] = {
        FINISHED: 1.0 if finished else 0.0,
        REJECTIONS: float(rejections),
        DURATION: duration,
    }
    if runs:
        result[POC_PASSED] = (
            1.0 if runs[-1].attributes.get("gaik.sandbox.phase") == "succeeded" else 0.0
        )
    eur, usd = _total(spans, "gaik.turn.cost.eur"), _total(spans, "gaik.turn.cost.usd")
    if eur is not None:
        result[COST_EUR] = eur
    if usd is not None:
        result[COST_USD] = usd
    if finished and result.get(POC_PASSED) == 1.0:
        result[FINISHED_POC_DURATION] = duration
        if eur is not None:
            result[FINISHED_POC_COST_EUR] = eur
    return result
