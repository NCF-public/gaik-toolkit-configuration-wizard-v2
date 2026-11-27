"""A decision is drawn where it decides: after a review's approval, and at a decision step.

Two shapes the generator drew wrongly:

- A decision point after a ``human_review`` step was put between the review and
  its "Approved?" gateway: its branches skipped the approval, each branch's step
  was entered twice (from the decision and from the fork after the approval),
  and the decision had an unnamed way into the approval.
- A workflow step of type ``decision`` is drawn as an exclusive gateway, but a
  parallel fork followed it when two steps depended on it, so both ran.
"""

from test_bpmn_decision_paths import _blueprint, _flows, _step

REVIEW_STEPS = [
    dict(_step("extract", inputs=["src"]), outputs=["out"]),
    _step("review", "human_review", deps=["extract"]),
    _step("fast", deps=["review"]),
    _step("slow", deps=["review"]),
]
SPEED = {
    "id": "speed",
    "name": "Urgent?",
    "after": "review",
    "branches": [
        {"condition": "yes", "target": "fast"},
        {"condition": "no", "target": "slow"},
    ],
}


def _decision_step(sid, deps):
    return {
        "id": sid,
        "name": sid.replace("_", " ").title(),
        "type": "decision",
        "inputs": ["out"],
        "outputs": [],
        "depends_on": list(deps),
    }


def _into(flows, target):
    return sorted((s, n) for s, t, n in flows if t == target)


def _out_of(flows, source):
    return sorted((t, n) for s, t, n in flows if s == source)


# -------------------------------------------------- a decision after a review


def test_a_decision_after_a_review_follows_the_approval():
    flows, kinds = _flows(_blueprint(REVIEW_STEPS, decisions=[SPEED]))

    assert _out_of(flows, "Activity_review") == [("Gateway_approve_review", "")]
    assert _out_of(flows, "Gateway_approve_review") == [
        ("EndEvent_rejected_review", "No"),
        ("Gateway_decision_speed", "Yes"),
    ]
    assert _out_of(flows, "Gateway_decision_speed") == [
        ("Activity_fast", "yes"),
        ("Activity_slow", "no"),
    ]
    # Each step entered once, and nothing runs both: no fork after the review.
    assert _into(flows, "Activity_fast") == [("Gateway_decision_speed", "yes")]
    assert _into(flows, "Activity_slow") == [("Gateway_decision_speed", "no")]
    assert "Gateway_fork_review" not in kinds


def test_a_step_that_always_runs_after_the_approval_keeps_its_parallel_path():
    steps = [*REVIEW_STEPS, _step("audit", deps=["review"])]
    flows, kinds = _flows(_blueprint(steps, decisions=[SPEED]))

    assert kinds["Gateway_fork_review"] == "parallelGateway"
    assert _out_of(flows, "Gateway_approve_review") == [
        ("EndEvent_rejected_review", "No"),
        ("Gateway_fork_review", "Yes"),
    ]
    assert _out_of(flows, "Gateway_fork_review") == [
        ("Activity_audit", ""),
        ("Gateway_decision_speed", ""),
    ]
    assert _into(flows, "Activity_fast") == [("Gateway_decision_speed", "yes")]
    assert _into(flows, "Activity_slow") == [("Gateway_decision_speed", "no")]


def test_a_rework_loop_on_the_review_stays_with_a_decision_after_it():
    rework = {
        "id": "redo",
        "name": "Fix the data",
        "attached_to": "review",
        "condition": "No (rework)",
        "outcome": "loop_to:extract",
    }
    flows, _ = _flows(_blueprint(REVIEW_STEPS, decisions=[SPEED], exceptions=[rework]))

    assert ("Gateway_approve_review", "Activity_extract", "No (rework)") in flows
    assert ("Gateway_approve_review", "Gateway_decision_speed", "Yes") in flows
    assert _into(flows, "Activity_fast") == [("Gateway_decision_speed", "yes")]


def test_a_review_without_a_decision_is_drawn_as_before():
    flows, kinds = _flows(_blueprint(REVIEW_STEPS))

    assert ("Gateway_approve_review", "Gateway_fork_review", "Yes") in flows
    assert kinds["Gateway_fork_review"] == "parallelGateway"
    assert _out_of(flows, "Gateway_fork_review") == [("Activity_fast", ""), ("Activity_slow", "")]


# ---------------------------------------------- a step of type "decision"


def test_a_decision_steps_successors_leave_its_own_gateway():
    steps = [
        dict(_step("extract", inputs=["src"]), outputs=["out"]),
        _decision_step("check", ["extract"]),
        _step("accept", deps=["check"]),
        _step("ask_more", "user_task", deps=["check"]),
    ]
    flows, kinds = _flows(_blueprint(steps))

    assert kinds["Gateway_check"] == "exclusiveGateway"
    assert "Gateway_fork_check" not in kinds
    assert _out_of(flows, "Gateway_check") == [("Activity_accept", ""), ("Activity_ask_more", "")]


def test_a_step_after_both_ways_of_a_decision_step_is_reached_through_an_exclusive_merge():
    steps = [
        dict(_step("extract", inputs=["src"]), outputs=["out"]),
        _decision_step("check", ["extract"]),
        _step("accept", deps=["check"]),
        _step("ask_more", "user_task", deps=["check"]),
        _step("done", deps=["accept", "ask_more"]),
    ]
    flows, kinds = _flows(_blueprint(steps))

    assert kinds["Gateway_join_done"] == "exclusiveGateway"
    assert _into(flows, "Activity_done") == [("Gateway_join_done", "")]


def test_a_decision_steps_ways_take_the_conditions_of_a_decision_point_after_it():
    steps = [
        dict(_step("extract", inputs=["src"]), outputs=["out"]),
        _decision_step("check", ["extract"]),
        _step("accept", deps=["check"]),
        _step("ask_more", "user_task", deps=["check"]),
    ]
    labelled = {
        "id": "complete",
        "name": "Complete?",
        "after": "check",
        "branches": [
            {"condition": "complete", "target": "accept"},
            {"condition": "missing", "target": "ask_more"},
        ],
    }
    flows, kinds = _flows(_blueprint(steps, decisions=[labelled]))

    # One gateway decides: the step's own, with the point's conditions on its ways.
    assert "Gateway_decision_complete" not in kinds
    assert _out_of(flows, "Gateway_check") == [
        ("Activity_accept", "complete"),
        ("Activity_ask_more", "missing"),
    ]


def test_a_decision_point_before_a_decision_step_names_that_steps_ways():
    """Seen in a live run: the agent wrote one choice twice, as a decision step
    after check and as a decision point after check, both leading to manager or
    report. It is drawn as one gateway, the step's, named by the point."""
    steps = [
        dict(_step("extract", inputs=["src"]), outputs=["out"]),
        _step("check", deps=["extract"]),
        _decision_step("route", ["check"]),
        _step("manager", "user_task", deps=["route"]),
        _step("report", deps=["route", "manager"]),
    ]
    point = {
        "id": "needed",
        "name": "Review needed?",
        "after": "check",
        "branches": [
            {"condition": "big", "target": "manager"},
            {"condition": "small", "target": "report"},
        ],
    }
    flows, kinds = _flows(_blueprint(steps, decisions=[point]))

    assert "Gateway_decision_needed" not in kinds
    assert _out_of(flows, "Activity_check") == [("Gateway_route", "")]
    assert _out_of(flows, "Gateway_route") == [
        ("Activity_manager", "big"),
        ("Gateway_join_report", "small"),
    ]
    assert _into(flows, "Activity_manager") == [("Gateway_route", "big")]
    assert _into(flows, "Activity_report") == [("Gateway_join_report", "")]


def test_a_decision_step_with_one_successor_and_an_ordinary_fork_are_drawn_as_before():
    steps = [
        dict(_step("extract", inputs=["src"]), outputs=["out"]),
        _decision_step("check", ["extract"]),
        _step("accept", deps=["check"]),
        _step("notify", deps=["accept"]),
        _step("archive", deps=["accept"]),
    ]
    flows, kinds = _flows(_blueprint(steps))

    assert _out_of(flows, "Gateway_check") == [("Activity_accept", "")]
    assert kinds["Gateway_fork_accept"] == "parallelGateway"
    assert _out_of(flows, "Gateway_fork_accept") == [
        ("Activity_archive", ""),
        ("Activity_notify", ""),
    ]
