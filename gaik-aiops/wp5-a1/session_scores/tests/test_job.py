"""The scoring pass against a stand-in for MLflow (session_scores.job)."""

import math

from session_scores import facts, job
from session_scores.facts import Span
from session_scores.job import Header

MIN_MS = 60_000
NOW = 1_800_000_000_000
LABELS = {
    "deployment.environment.name": "s4",
    "service.version": "0.5.2",
    "gaik.agent.model": "model-a",
    "gaik.agent.reasoning": "high",
}


class FakeStore:
    """Traces, tags and assessments in memory, with every span read counted."""

    def __init__(self):
        self.traces: dict[str, dict] = {}
        self.experiment: dict[str, str] = {}
        self.runs: dict[str, dict] = {}
        self.span_reads: list[str] = []
        self.writes: list[tuple] = []
        self._ids = 0

    def add(self, trace_id, session, minutes_ago, spans=(), tags=None):
        self.traces[trace_id] = {
            "session": session,
            "started_ms": NOW - minutes_ago * MIN_MS,
            "spans": list(spans),
            "tags": dict(LABELS if tags is None else tags),
            "scores": {},
        }

    def experiment_tag(self, key):
        return self.experiment.get(key)

    def set_experiment_tag(self, key, value):
        self.experiment[key] = value

    def headers(self, filter_string):
        found = []
        for trace_id, t in sorted(self.traces.items(), key=lambda item: item[1]["started_ms"]):
            if "metadata." in filter_string and f"'{t['session']}'" not in filter_string:
                continue
            if job.CARRIER_TAG in filter_string and t["tags"].get(job.CARRIER_TAG) != "true":
                continue
            if "timestamp_ms > " in filter_string:
                if t["started_ms"] <= int(filter_string.rsplit("timestamp_ms > ", 1)[1]):
                    continue
            found.append(
                Header(
                    trace_id,
                    t["started_ms"],
                    1000,
                    t["session"],
                    dict(t["tags"]),
                    dict(t["scores"]),
                )
            )
        # One at a time, like the real store: nothing may count on a list.
        return iter(found)

    def spans(self, trace_id):
        self.span_reads.append(trace_id)
        return self.traces[trace_id]["spans"]

    def log_score(self, trace_id, name, value):
        self._ids += 1
        self.traces[trace_id]["scores"][name] = (f"a-{self._ids}", value)
        self.writes.append(("log", name, value))

    def delete_score(self, trace_id, assessment_id):
        scores = self.traces[trace_id]["scores"]
        (name,) = [n for n, (i, _v) in scores.items() if i == assessment_id]
        del scores[name]
        self.writes.append(("delete", name))

    def set_trace_tag(self, trace_id, key, value):
        self.traces[trace_id]["tags"][key] = value

    def delete_trace_tag(self, trace_id, key):
        # Like MLflow: deleting a tag the trace does not have is an error.
        del self.traces[trace_id]["tags"][key]

    def write_group(self, group, name, params, metrics, at_ms):
        self.runs[group] = {"name": name, "params": params, "metrics": metrics}

    def scores(self, trace_id):
        return {name: value for name, (_id, value) in self.traces[trace_id]["scores"].items()}


def _approve_last_gate(minutes_ago):
    at = (NOW - minutes_ago * MIN_MS) * 1_000_000
    return Span(
        facts.GATE,
        at,
        at + 1,
        True,
        {"gaik.gate": "gate_4", "gaik.gate.from": "pending", "gaik.gate.to": "approved"},
    )


def _passed_run():
    return Span(
        facts.SANDBOX_RESULT,
        1,
        2,
        True,
        {"gaik.sandbox.kind": "run", "gaik.sandbox.phase": "succeeded"},
    )


def _turn(eur):
    return Span(facts.TURN, 1, 2, True, {"gaik.turn.cost.eur": eur, "gaik.turn.cost.usd": eur})


def _pass(store, settle=30, max_traces=1000):
    return job.score_settled(store, NOW, settle * MIN_MS, 72 * 60 * MIN_MS, max_traces)


def test_a_settled_sessions_scores_go_on_its_first_trace():
    store = FakeStore()
    store.add("t1", "s", 90, [_turn(1.5)])
    store.add("t2", "s", 60, [_passed_run(), _approve_last_gate(60)])

    summary = _pass(store)

    assert summary.scored == 1
    assert store.scores("t1")[facts.FINISHED] == 1.0
    assert store.scores("t1")[facts.FINISHED_POC_COST_EUR] == 1.5
    assert store.scores("t2") == {}
    assert store.traces["t1"]["tags"][job.CARRIER_TAG] == "true"


def test_a_session_still_in_use_waits():
    store = FakeStore()
    store.add("t1", "s", 90)
    store.add("t2", "s", 5)

    summary = _pass(store)

    assert (summary.scored, summary.waiting) == (0, 1)
    assert store.span_reads == []


def test_a_trace_without_a_session_is_not_scored():
    store = FakeStore()
    store.add("t1", None, 90)
    assert _pass(store).scored == 0


def test_a_session_scored_before_is_not_read_again():
    store = FakeStore()
    # Recent enough that the next pass's look-back meets it again.
    store.add("t1", "s", 60, [_turn(1.0)])
    _pass(store)
    reads = len(store.span_reads)

    summary = _pass(store)

    assert summary.unchanged == 1
    assert len(store.span_reads) == reads


def test_a_session_that_went_on_is_scored_again_and_only_what_changed_is_rewritten():
    store = FakeStore()
    store.add("t1", "s", 300, [_turn(1.0)])
    _pass(store)
    assert store.scores("t1")[facts.FINISHED] == 0.0
    store.writes.clear()
    store.add("t2", "s", 60, [_approve_last_gate(60)])

    _pass(store)

    assert store.scores("t1")[facts.FINISHED] == 1.0
    rewritten = {write[1] for write in store.writes}
    assert facts.FINISHED in rewritten
    assert facts.COST_EUR not in rewritten  # the cost did not change


def test_a_score_the_session_no_longer_has_is_removed():
    store = FakeStore()
    store.add("t1", "s", 300, [_passed_run()])
    _pass(store)
    assert facts.POC_PASSED in store.scores("t1")
    # A new trace, and the stored run is gone (the trace was deleted).
    store.traces["t1"]["spans"] = []
    store.add("t2", "s", 60)

    _pass(store)

    assert facts.POC_PASSED not in store.scores("t1")


def test_a_header_lists_only_this_jobs_assessments():
    # The pass removes and rewrites only what a header lists, so an assessment from
    # another source (the UC checks, a person) is never touched.
    info = _Info(
        assessments=[
            _Assessment("EQ1 requirement recall", 0.9, "uc-comparison-workbook"),
            _Assessment(facts.FINISHED, 1.0, job.SOURCE_ID),
        ]
    )
    assert job._header(info).scores == {facts.FINISHED: ("a-x", 1.0)}


def test_the_watermark_moves_to_the_settle_cutoff():
    store = FakeStore()
    store.add("t1", "s", 90)
    _pass(store, settle=30)
    assert store.experiment[job.WATERMARK_TAG] == str(NOW - 30 * MIN_MS)


def test_a_pass_out_of_budget_leaves_the_rest_for_the_next_one():
    store = FakeStore()
    store.add("a1", "a", 300)
    store.add("a2", "a", 290)
    store.add("b1", "b", 200)

    first = _pass(store, max_traces=2)

    assert (first.scored, first.waiting) == (1, 1)
    assert int(store.experiment[job.WATERMARK_TAG]) < store.traces["b1"]["started_ms"]
    second = _pass(store, max_traces=2)
    assert second.scored == 1
    assert store.traces["b1"]["tags"][job.CARRIER_TAG] == "true"


def test_two_traces_that_began_together_have_one_carrier_whatever_their_order():
    store = FakeStore()
    store.add("t-b", "s", 90, [_turn(1.0)])
    store.add("t-a", "s", 90)

    _pass(store)

    assert store.traces["t-a"]["tags"][job.CARRIER_TAG] == "true"
    assert job.CARRIER_TAG not in store.traces["t-b"]["tags"]
    assert store.scores("t-b") == {}


def test_scores_move_when_an_earlier_trace_of_the_session_turns_up():
    store = FakeStore()
    store.add("late", "s", 40, [_turn(1.0)])
    _pass(store)
    assert store.scores("late")[facts.COST_EUR] == 1.0
    # Stored after the first pass, though it began before the trace scored then
    # (a long request is stored when it ends).
    store.add("early", "s", 50, [_turn(0.5)])

    _pass(store)

    assert store.scores("early")[facts.COST_EUR] == 1.5
    assert store.scores("late") == {}
    assert job.CARRIER_TAG not in store.traces["late"]["tags"]
    assert job.SEEN_TAG not in store.traces["late"]["tags"]
    job.write_groups(store, NOW, 30 * 24 * 60 * MIN_MS)
    assert store.runs["s4|0.5.2|model-a|high"]["metrics"]["sessions"] == 1.0


def test_an_old_carrier_that_was_never_marked_seen_still_hands_over():
    store = FakeStore()
    # A pass that stopped between the two tags left the carrier tag alone.
    store.add("late", "s", 40, tags={**LABELS, job.CARRIER_TAG: "true"})
    store.add("early", "s", 50)

    assert _pass(store, settle=30).failed == 0
    assert job.CARRIER_TAG not in store.traces["late"]["tags"]
    assert store.traces["early"]["tags"][job.CARRIER_TAG] == "true"


def test_a_session_that_cannot_be_read_does_not_stop_the_others():
    store = FakeStore()
    store.add("a1", "a", 300)
    store.add("b1", "b", 200)
    store.add("c1", "c", 100)
    read = store.spans

    def spans(trace_id):
        if trace_id == "b1":
            raise RuntimeError("MLflow could not give the trace")
        return read(trace_id)

    store.spans = spans

    summary = _pass(store)

    assert (summary.scored, summary.failed) == (2, 1)
    assert store.traces["c1"]["tags"][job.CARRIER_TAG] == "true"
    assert job.CARRIER_TAG not in store.traces["b1"]["tags"]
    # The failed session is read again next time: the watermark stays before it.
    assert int(store.experiment[job.WATERMARK_TAG]) < store.traces["b1"]["started_ms"]
    store.spans = read
    assert _pass(store).scored == 1
    assert store.traces["b1"]["tags"][job.CARRIER_TAG] == "true"


def test_groups_are_compared_by_environment_version_model_and_reasoning():
    store = FakeStore()
    store.add("a1", "a", 90, [_turn(2.0), _passed_run(), _approve_last_gate(90)])
    store.add("b1", "b", 80, [_turn(1.0)])
    store.add("c1", "c", 70, [_turn(4.0)], tags={**LABELS, "gaik.agent.model": "model-b"})
    _pass(store)

    assert job.write_groups(store, NOW, 30 * 24 * 60 * MIN_MS) == 2

    group = store.runs["s4|0.5.2|model-a|high"]
    assert group["params"] == {
        "environment": "s4",
        "wizard_version": "0.5.2",
        "model": "model-a",
        "reasoning": "high",
    }
    assert group["metrics"]["sessions"] == 2.0
    assert group["metrics"]["finished_pct"] == 50.0
    assert group["metrics"]["poc_run_pct"] == 50.0
    assert group["metrics"]["poc_passed_pct"] == 100.0
    assert group["metrics"]["eur_per_finished_poc"] == 2.0
    assert group["metrics"]["eur_per_session"] == 1.5
    assert store.runs["s4|0.5.2|model-b|high"]["metrics"]["sessions"] == 1.0


def test_a_session_without_labels_is_grouped_as_unknown():
    store = FakeStore()
    store.add("a1", "a", 90, tags={})
    _pass(store)
    job.write_groups(store, NOW, 30 * 24 * 60 * MIN_MS)
    assert list(store.runs) == ["unknown|unknown|unknown|unknown"]


def test_a_number_a_group_no_longer_has_is_written_as_not_a_number():
    store = FakeStore()
    store.add("a1", "a", 90, [_turn(1.0)])
    _pass(store)

    job.write_groups(store, NOW, 30 * 24 * 60 * MIN_MS)

    metrics = store.runs["s4|0.5.2|model-a|high"]["metrics"]
    assert set(metrics) == set(job.GROUP_METRICS)
    assert math.isnan(metrics["eur_per_finished_poc"])
    assert math.isnan(metrics["poc_passed_pct"])
    assert metrics["eur_per_session"] == 1.0


def test_every_number_a_group_can_have_is_a_listed_metric():
    full = {name: 1.0 for name in facts.SCORES}
    assert set(job.group_metrics([full])) == set(job.GROUP_METRICS)


def test_a_number_no_session_gives_is_left_out_of_the_group():
    metrics = job.group_metrics([{facts.FINISHED: 0.0, facts.REJECTIONS: 0.0}])
    assert "eur_per_finished_poc" not in metrics and "poc_passed_pct" not in metrics
    assert metrics["poc_run_pct"] == 0.0


class _Source:
    def __init__(self, source_id):
        self.source_id = source_id


class _Assessment:
    def __init__(self, name, value, source_id):
        self.name, self.value, self.assessment_id, self.source = (
            name,
            value,
            "a-x",
            _Source(source_id),
        )


class _Info:
    def __init__(self, assessments):
        self.trace_id, self.request_time, self.execution_duration = "t", 1, 1
        self.trace_metadata, self.tags, self.assessments = {}, {}, assessments
