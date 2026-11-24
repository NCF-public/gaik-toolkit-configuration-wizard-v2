"""Score the wizard sessions that have settled, and write the scores to MLflow.

One pass:

1. Read the trace headers (no spans) that arrived since the last pass and
   group them by session.
2. For each session quiet for ``--settle-minutes``, read its traces one at a
   time, compute the scores (``facts.scores``) and write them as assessments
   on the session's first trace, where the Overview's Quality tab and the trace
   search find them. A session that gets new traces later is scored again.
3. Write one MLflow run per group of sessions with the same environment,
   wizard version, model and reasoning level, with the group's rates and
   averages as metrics, so groups can be compared side by side.

Only numbers and statuses are read. Traces are read one at a time and a pass
stops at ``--max-traces``: MLflow builds a whole trace in memory to answer, and
a client that asks for hundreds at once can get the server killed.
"""

from __future__ import annotations

import argparse
import logging
import math
import os
import statistics
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass, field

from session_scores import facts

logger = logging.getLogger("session_scores")

EXPERIMENT = "wizard-v2-api"
#: Who gave the assessments: this job. Its own are the only ones it changes.
SOURCE_ID = "session-scores"
#: On a session's first trace: that it carries the session's scores, and the
#: traces (count and newest) the scores were computed from.
CARRIER_TAG = "gaik.session_scores.carrier"
SEEN_TAG = "gaik.session_scores.seen"
#: On the experiment: the time up to which sessions have been scored.
WATERMARK_TAG = "gaik.session_scores.watermark_ms"
#: On a comparison run: the group it stands for.
GROUP_TAG = "gaik.session_scores.group"
SESSION_KEY = "mlflow.trace.session"

#: The trace tags sessions are grouped by, with the name each has on a run.
LABELS = {
    "deployment.environment.name": "environment",
    "service.version": "wizard_version",
    "gaik.agent.model": "model",
    "gaik.agent.reasoning": "reasoning",
}
UNKNOWN = "unknown"

#: A trace that started this long before the watermark may still have been
#: stored after it (a long request is stored when it ends), so each pass looks
#: back this far again. A session read twice is not scored twice (SEEN_TAG).
OVERLAP_MS = 2 * 60 * 60 * 1000


@dataclass(frozen=True)
class Header:
    """A trace without its spans."""

    trace_id: str
    started_ms: int
    duration_ms: int
    session: str | None
    tags: dict
    #: This job's assessments on the trace: name -> (assessment id, value).
    scores: dict = field(default_factory=dict)


@dataclass
class Summary:
    scored: int = 0
    unchanged: int = 0
    waiting: int = 0
    failed: int = 0
    groups: int = 0


class Store:
    """The MLflow calls the job makes, so tests can stand in for the server."""

    def __init__(self, tracking_uri: str, experiment: str):
        import mlflow
        from mlflow import MlflowClient

        mlflow.set_tracking_uri(tracking_uri)
        self._mlflow = mlflow
        self._client = MlflowClient()
        found = self._client.get_experiment_by_name(experiment)
        if found is None:
            raise SystemExit(f"experiment {experiment!r} does not exist")
        self._experiment_id = found.experiment_id

    def experiment_tag(self, key: str) -> str | None:
        return self._client.get_experiment(self._experiment_id).tags.get(key)

    def set_experiment_tag(self, key: str, value: str) -> None:
        self._client.set_experiment_tag(self._experiment_id, key, value)

    def headers(self, filter_string: str) -> Iterator[Header]:
        """Every trace header that matches, oldest first, a page at a time.

        An iterator, so a caller that reads a long stretch of traces holds one
        page of them, not all.
        """
        token = None
        while True:
            page = self._client.search_traces(
                locations=[self._experiment_id],
                filter_string=filter_string,
                max_results=100,
                order_by=["timestamp_ms ASC"],
                page_token=token,
                include_spans=False,
            )
            for trace in page:
                yield _header(trace.info)
            token = page.token
            if not token:
                return

    def spans(self, trace_id: str) -> list[facts.Span]:
        from mlflow.entities import SpanStatusCode

        trace = self._client.get_trace(trace_id, display=False)
        return [
            facts.Span(
                name=span.name,
                start_ns=span.start_time_ns,
                end_ns=span.end_time_ns or span.start_time_ns,
                ok=span.status.status_code != SpanStatusCode.ERROR,
                attributes=dict(span.attributes),
            )
            for span in trace.data.spans
        ]

    def log_score(self, trace_id: str, name: str, value: float) -> None:
        from mlflow.entities import AssessmentSource, AssessmentSourceType

        self._mlflow.log_feedback(
            trace_id=trace_id,
            name=name,
            value=value,
            source=AssessmentSource(source_type=AssessmentSourceType.CODE, source_id=SOURCE_ID),
        )

    def delete_score(self, trace_id: str, assessment_id: str) -> None:
        self._mlflow.delete_assessment(trace_id=trace_id, assessment_id=assessment_id)

    def set_trace_tag(self, trace_id: str, key: str, value: str) -> None:
        self._client.set_trace_tag(trace_id, key, value)

    def delete_trace_tag(self, trace_id: str, key: str) -> None:
        self._client.delete_trace_tag(trace_id, key)

    def write_group(self, group: str, name: str, params: dict, metrics: dict, at_ms: int) -> None:
        """Put the group's numbers on its run, making the run the first time."""
        runs = self._client.search_runs(
            [self._experiment_id], filter_string=f"tags.`{GROUP_TAG}` = '{group}'", max_results=1
        )
        if runs:
            run_id = runs[0].info.run_id
        else:
            run = self._client.create_run(
                self._experiment_id, run_name=name, tags={GROUP_TAG: group}
            )
            run_id = run.info.run_id
            for key, value in params.items():
                self._client.log_param(run_id, key, value)
            self._client.set_terminated(run_id)
        for key, value in metrics.items():
            self._client.log_metric(run_id, key, value, timestamp=at_ms, step=at_ms // 1000)


def _header(info) -> Header:
    scores = {
        a.name: (a.assessment_id, a.value)
        for a in info.assessments or []
        if getattr(a.source, "source_id", None) == SOURCE_ID
    }
    return Header(
        trace_id=info.trace_id,
        started_ms=info.request_time,
        duration_ms=info.execution_duration or 0,
        session=(info.trace_metadata or {}).get(SESSION_KEY),
        tags=dict(info.tags or {}),
        scores=scores,
    )


def _quoted(value: str) -> str:
    return value.replace("'", "")


def score_session(store, session: str, summary: Summary, budget: list[int]) -> None:
    """Compute one session's scores and make its first trace carry exactly them."""
    headers = list(store.headers(f"metadata.`{SESSION_KEY}` = '{_quoted(session)}'"))
    if not headers:
        return
    # The earliest trace; the id settles two that began in the same millisecond, whose
    # order the search does not promise.
    carrier = min(headers, key=lambda h: (h.started_ms, h.trace_id))
    for other in headers:
        if other is not carrier and other.tags.get(CARRIER_TAG) == "true":
            # An earlier trace has arrived since, or one was deleted: the scores move,
            # so the session is not counted twice.
            for assessment_id, _value in other.scores.values():
                store.delete_score(other.trace_id, assessment_id)
            # MLflow refuses to delete a tag the trace does not have.
            for tag in (CARRIER_TAG, SEEN_TAG):
                if tag in other.tags:
                    store.delete_trace_tag(other.trace_id, tag)
    seen = f"{len(headers)}:{max(h.started_ms for h in headers)}"
    if carrier.tags.get(SEEN_TAG) == seen:
        summary.unchanged += 1
        return
    spans = []
    for header in headers:
        spans.extend(store.spans(header.trace_id))
    budget[0] -= len(headers)
    started_ns = min(h.started_ms for h in headers) * 1_000_000
    ended_ns = max(h.started_ms + h.duration_ms for h in headers) * 1_000_000
    wanted = facts.scores(spans, started_ns, ended_ns)
    for name, (assessment_id, value) in carrier.scores.items():
        if wanted.get(name) != value:
            store.delete_score(carrier.trace_id, assessment_id)
    for name, value in wanted.items():
        if name not in carrier.scores or carrier.scores[name][1] != value:
            store.log_score(carrier.trace_id, name, value)
    store.set_trace_tag(carrier.trace_id, CARRIER_TAG, "true")
    # Last: a pass that fails half-way leaves the old mark, so the next one scores it again.
    store.set_trace_tag(carrier.trace_id, SEEN_TAG, seen)
    summary.scored += 1


def score_settled(store, now_ms: int, settle_ms: int, lookback_ms: int, max_traces: int) -> Summary:
    """Score the sessions with new traces that have been quiet for ``settle_ms``."""
    summary = Summary()
    cutoff = now_ms - settle_ms
    stored = store.experiment_tag(WATERMARK_TAG)
    watermark = int(stored) if stored and stored.isdigit() else now_ms - lookback_ms
    newest: dict[str, int] = {}
    for header in store.headers(f"timestamp_ms > {watermark - OVERLAP_MS}"):
        if header.session:
            newest[header.session] = max(newest.get(header.session, 0), header.started_ms)
    budget = [max_traces]
    reached = cutoff
    for session, last in sorted(newest.items(), key=lambda item: item[1]):
        if last > cutoff:
            summary.waiting += 1
            continue
        if budget[0] <= 0:
            # Out of budget: the next pass starts from the first session left.
            reached = min(reached, last - 1)
            summary.waiting += 1
            continue
        try:
            score_session(store, session, summary, budget)
        except Exception:  # noqa: BLE001 - one session must not stop the others
            # The session id is a pseudonym already; the traceback names the call that failed.
            logger.exception("session %s could not be scored; the next pass tries again", session)
            summary.failed += 1
            if last > now_ms - lookback_ms:
                reached = min(reached, last - 1)
            # Older than the look-back, it is given up: a session that fails every
            # pass must not hold the others' place for ever.
    if reached > watermark:
        store.set_experiment_tag(WATERMARK_TAG, str(reached))
    return summary


def _mean(values: list[float]) -> float | None:
    return round(statistics.fmean(values), 4) if values else None


#: Every metric a group's run has. Each pass writes them all (see ``write_groups``).
GROUP_METRICS = (
    "sessions",
    "finished_pct",
    "poc_run_pct",
    "poc_passed_pct",
    "eur_per_finished_poc",
    "minutes_per_finished_poc",
    "eur_per_session",
    "usd_per_session",
    "gate_rejections_per_session",
)


def group_metrics(sessions: list[dict]) -> dict[str, float]:
    """One group's numbers from its sessions' scores. A number nothing gives is left out."""

    def having(name: str) -> list[float]:
        return [s[name] for s in sessions if name in s]

    def percent(values: list[float]) -> float | None:
        return round(100 * sum(values) / len(values), 1) if values else None

    numbers = {
        "sessions": float(len(sessions)),
        "finished_pct": percent(having(facts.FINISHED)),
        "poc_run_pct": round(100 * len(having(facts.POC_PASSED)) / len(sessions), 1),
        "poc_passed_pct": percent(having(facts.POC_PASSED)),
        "eur_per_finished_poc": _mean(having(facts.FINISHED_POC_COST_EUR)),
        "minutes_per_finished_poc": _mean(having(facts.FINISHED_POC_DURATION)),
        "eur_per_session": _mean(having(facts.COST_EUR)),
        "usd_per_session": _mean(having(facts.COST_USD)),
        "gate_rejections_per_session": _mean(having(facts.REJECTIONS)),
    }
    return {name: value for name, value in numbers.items() if value is not None}


def write_groups(store, now_ms: int, window_ms: int) -> int:
    """Write a run per group of scored sessions that began within the window."""
    groups: dict[tuple, list[dict]] = {}
    for carrier in store.headers(
        f"tags.`{CARRIER_TAG}` = 'true' AND timestamp_ms > {now_ms - window_ms}"
    ):
        key = tuple(carrier.tags.get(tag) or UNKNOWN for tag in LABELS)
        groups.setdefault(key, []).append(
            {name: value for name, (_id, value) in carrier.scores.items()}
        )
    for key, sessions in groups.items():
        metrics = group_metrics(sessions)
        store.write_group(
            group="|".join(_quoted(part) for part in key),
            name="sessions: " + " · ".join(key),
            params=dict(zip(LABELS.values(), key)),
            # A number the group no longer has is written as NaN: left out, the run
            # would go on showing the last value it had.
            metrics={name: metrics.get(name, math.nan) for name in GROUP_METRICS},
            at_ms=now_ms,
        )
    return len(groups)


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw.isdigit() else default


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--experiment", default=os.environ.get("SESSION_SCORES_EXPERIMENT", EXPERIMENT)
    )
    parser.add_argument(
        "--settle-minutes",
        type=int,
        # Longer than a turn may run (the wizard's WIZARD_TURN_TIMEOUT_SECONDS, 45 minutes):
        # a turn's span, with its cost, is stored when the turn ends.
        default=_int_env("SESSION_SCORES_SETTLE_MINUTES", 60),
        help="score a session once it has been quiet this long (default 60)",
    )
    parser.add_argument(
        "--lookback-hours",
        type=int,
        default=_int_env("SESSION_SCORES_LOOKBACK_HOURS", 72),
        help="how far back the first pass reads (default 72)",
    )
    parser.add_argument(
        "--window-days",
        type=int,
        default=_int_env("SESSION_SCORES_WINDOW_DAYS", 30),
        help="sessions begun within this many days are compared (default 30)",
    )
    parser.add_argument(
        "--max-traces",
        type=int,
        default=_int_env("SESSION_SCORES_MAX_TRACES", 1500),
        help="stop starting sessions after reading this many traces in one pass (default 1500)",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    store = Store(os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000"), args.experiment)
    now_ms = int(time.time() * 1000)
    summary = score_settled(
        store,
        now_ms,
        settle_ms=args.settle_minutes * 60_000,
        lookback_ms=args.lookback_hours * 3_600_000,
        max_traces=args.max_traces,
    )
    summary.groups = write_groups(store, now_ms, args.window_days * 86_400_000)
    logger.info(
        "scored %d sessions, %d unchanged, %d not settled or left for the next pass, "
        "%d failed, %d groups",
        summary.scored,
        summary.unchanged,
        summary.waiting,
        summary.failed,
        summary.groups,
    )
    # A failed session makes the pass a failed Job, so it shows without reading the log.
    return 1 if summary.failed else 0


if __name__ == "__main__":
    sys.exit(main())
