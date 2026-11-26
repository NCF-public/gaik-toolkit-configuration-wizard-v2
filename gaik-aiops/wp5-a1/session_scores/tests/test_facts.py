"""A session's scores from its spans (session_scores.facts)."""

from session_scores import facts
from session_scores.facts import Span

MIN = 60_000_000_000


def _gate(at: int, gate: str, old: str, new: str, **more) -> Span:
    attributes = {"gaik.gate": gate, "gaik.gate.from": old, "gaik.gate.to": new, **more}
    return Span(facts.GATE, at, at + 1, True, attributes)


def _turn(at: int, statuses: str = "", **costs) -> Span:
    return Span(facts.TURN, at, at + MIN, True, {"gaik.gate_statuses": statuses, **costs})


def _run(at: int, phase: str, kind: str = "run") -> Span:
    return Span(
        facts.SANDBOX_RESULT,
        at,
        at + 1,
        phase == "succeeded",
        {"gaik.sandbox.kind": kind, "gaik.sandbox.phase": phase},
    )


def _scores(*spans: Span, minutes: int = 30) -> dict:
    return facts.scores(list(spans), 0, minutes * MIN)


def test_a_session_whose_last_gate_is_approved_is_finished():
    assert _scores(_gate(5, "gate_4", "pending", "approved"))[facts.FINISHED] == 1.0


def test_a_session_that_stopped_before_the_last_gate_is_not_finished():
    assert _scores(_gate(5, "gate_3", "pending", "approved"))[facts.FINISHED] == 0.0


def test_a_session_with_no_gate_change_is_not_finished():
    assert _scores(_turn(1))[facts.FINISHED] == 0.0


def test_a_refused_approval_of_the_last_gate_does_not_finish_the_session():
    refused = _gate(5, "gate_4", "pending", "approved", **{"gaik.gate.refused": "gate_not_ready"})
    assert _scores(refused)[facts.FINISHED] == 0.0


def test_an_approval_the_api_failed_does_not_finish_the_session():
    failed = Span(
        facts.GATE,
        5,
        6,
        False,
        {"gaik.gate": "gate_4", "gaik.gate.from": "pending", "gaik.gate.to": "approved"},
    )
    assert _scores(failed)[facts.FINISHED] == 0.0


def test_a_last_gate_reopened_without_a_gate_span_is_seen_on_the_next_turn():
    approved = _gate(5, "gate_4", "pending", "approved")
    later = _turn(10, "gate_1=approved,gate_4=pending")
    assert _scores(approved, later)[facts.FINISHED] == 0.0


def test_a_reopening_recorded_as_a_gate_span_unfinishes_and_counts():
    # The wizard's span for the panel's Change on the last gate: no later turn is needed.
    got = _scores(
        _gate(5, "gate_4", "pending", "approved"),
        _gate(9, "gate_4", "approved", "pending", **{"gaik.gate.reopened_by": "user"}),
    )
    assert got[facts.FINISHED] == 0.0
    assert got[facts.REJECTIONS] == 1.0


def test_one_request_that_changes_two_gates_counts_each():
    both = _gate(5, "gate_3, gate_4", "pending, pending", "approved, approved")
    assert facts.gate_changes(both) == [
        ("gate_3", "pending", "approved"),
        ("gate_4", "pending", "approved"),
    ]
    assert _scores(both)[facts.FINISHED] == 1.0


def test_rejections_count_rejected_gates_and_approvals_taken_back():
    got = _scores(
        _gate(1, "gate_1", "pending", "rejected"),
        _gate(2, "gate_1", "rejected", "approved"),
        _gate(3, "gate_1", "approved", "pending"),
        _gate(4, "gate_1", "pending", "approved"),
        _gate(5, "gate_2", "pending", "rejected", **{"gaik.gate.refused": "gate_not_ready"}),
    )
    assert got[facts.REJECTIONS] == 2.0


def test_the_latest_run_of_the_package_decides_whether_the_poc_passed():
    assert _scores(_run(1, "failed"), _run(2, "succeeded"))[facts.POC_PASSED] == 1.0
    assert _scores(_run(1, "succeeded"), _run(2, "timeout"))[facts.POC_PASSED] == 0.0


def test_a_run_whose_result_is_not_known_says_nothing():
    assert facts.POC_PASSED not in _scores(_run(1, "running"))
    assert _scores(_run(1, "succeeded"), _run(2, "unknown"))[facts.POC_PASSED] == 1.0


def test_a_session_that_never_ran_its_package_has_no_poc_score():
    assert facts.POC_PASSED not in _scores(_run(1, "succeeded", kind="check"), _turn(2))


def test_the_cost_is_the_sum_of_the_turns():
    got = _scores(
        _turn(1, **{"gaik.turn.cost.usd": 0.5, "gaik.turn.cost.eur": 0.445}),
        _turn(2, **{"gaik.turn.cost.usd": "0.25", "gaik.turn.cost.eur": 0.2225}),
        _turn(3),
    )
    assert got[facts.COST_USD] == 0.75
    assert got[facts.COST_EUR] == 0.6675


def test_without_a_euro_rate_only_dollars_are_given():
    got = _scores(_turn(1, **{"gaik.turn.cost.usd": 0.5}))
    assert got[facts.COST_USD] == 0.5
    assert facts.COST_EUR not in got


def test_a_session_with_no_reported_cost_has_no_cost_score():
    got = _scores(_turn(1))
    assert facts.COST_USD not in got and facts.COST_EUR not in got


def test_the_duration_is_from_the_first_moment_to_the_last():
    assert _scores(_turn(1), minutes=42)[facts.DURATION] == 42.0


def test_a_finished_session_with_a_passed_poc_gives_the_price_and_time_of_one_poc():
    got = _scores(
        _turn(1, **{"gaik.turn.cost.usd": 2.0, "gaik.turn.cost.eur": 1.8}),
        _run(2, "succeeded"),
        _gate(3, "gate_4", "pending", "approved"),
        minutes=25,
    )
    assert got[facts.FINISHED_POC_COST_EUR] == 1.8
    assert got[facts.FINISHED_POC_DURATION] == 25.0


def test_an_unfinished_session_or_a_failed_poc_gives_no_price_of_a_poc():
    cost = _turn(1, **{"gaik.turn.cost.eur": 1.8})
    unfinished = _scores(cost, _run(2, "succeeded"))
    failed = _scores(cost, _run(2, "failed"), _gate(3, "gate_4", "pending", "approved"))
    for got in (unfinished, failed):
        assert facts.FINISHED_POC_COST_EUR not in got
        assert facts.FINISHED_POC_DURATION not in got


def test_every_score_given_is_a_listed_one():
    got = _scores(
        _turn(1, **{"gaik.turn.cost.usd": 2.0, "gaik.turn.cost.eur": 1.8}),
        _run(2, "succeeded"),
        _gate(3, "gate_4", "pending", "approved"),
    )
    assert set(got) == set(facts.SCORES)
