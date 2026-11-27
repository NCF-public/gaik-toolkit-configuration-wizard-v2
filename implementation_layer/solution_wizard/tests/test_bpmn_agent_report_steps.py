"""The agent's own report and submission steps are drawn once, with no generated duplicate.

With "pdf" in ``technical_spec.output_types`` the generator adds a "Generate PDF
report" task, and for each ``technical_spec.integration_targets`` entry a
"Submit to …" send task. When the agent writes its own steps for that work (a
live run: ``invoice_pdf_report`` and ``erp_submission``, both
``component: custom``), the diagram showed the report and the submission twice.

- The report: a step that outputs a *generated* artifact of type pdf or report,
  with ``final_output: true``, ``produced_by`` it. (An upload step's PDF is
  ``source: user_upload``; an intermediate PDF is not the final output.)
- The submission: a step whose ``parameters.integration_target`` is the
  target's exact name. Its data store stays, written by that step.
- A decision's branch to "end" still passes the report and the submission once.

The checks walk the drawn diagram as a case would run it (`_runs`): every
choice at an exclusive gateway, every way out of a fork, a join waiting for
all its ways. So a step entered twice, or a token left waiting, shows.
"""

import xml.etree.ElementTree as ET

from solution_wizard.blueprint import Blueprint
from solution_wizard.bpmn_generator import generate_bpmn

NS = {"bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL"}
END = "EndEvent_success"
ERP = "ERP system (approved invoice data)"
PDF = "Activity_generate_pdf"


def _step(sid, kind="automated_task", deps=(), inputs=(), outputs=(), **extra):
    step = {
        "id": sid,
        "name": sid.replace("_", " ").capitalize(),
        "type": kind,
        "inputs": list(inputs),
        "outputs": list(outputs),
        "depends_on": list(deps),
        **extra,
    }
    if kind == "automated_task":
        step.setdefault("component", "custom")
    return step


def _send(sid, deps, target=ERP):
    return _step(
        sid,
        deps=deps,
        inputs=["record"],
        outputs=[f"{sid}_receipt"],
        parameters={"integration_target": target} if target else {},
    )


def _art(kind, by=None, *, upload=False, final=False):
    if upload:
        return {"type": kind, "source": "user_upload", "optional": False}
    return {
        "type": kind,
        "source": "generated",
        "optional": False,
        "produced_by": by,
        "final_output": final,
    }


def _blueprint(
    steps, artifacts, *, targets=(ERP,), outputs=("structured_json", "pdf"), decisions=()
):
    artifacts = dict(artifacts)
    for s in steps:
        for out in s["outputs"]:
            artifacts.setdefault(out, _art("structured_json", s["id"]))
    return Blueprint.model_validate(
        {
            "blueprint_version": "1.0",
            "use_case": {"id": "uc", "name": "Invoices", "description": "x", "domain": "t"},
            "business_spec": {"intended_users": ["clerk"], "reviewers": ["manager"]},
            "technical_spec": {
                "input_types": ["pdf"],
                "output_types": list(outputs),
                "language": "en",
                "integration_targets": list(targets),
            },
            "target_output_spec": {"required_fields": ["a"]},
            "components": {
                "selected_modules": [],
                "selected_building_blocks": [],
                "custom_components": [],
            },
            "artifacts": artifacts,
            "workflow": {"steps": steps},
            "business_process": {"decision_points": list(decisions)},
        }
    )


def _decision(did, after, *branches):
    return {
        "id": did,
        "name": did,
        "after": after,
        "branches": [{"condition": c, "target": t} for c, t in branches],
    }


def _flows(bp):
    root = ET.fromstring(generate_bpmn(bp))
    proc = root.find("bpmn:process", NS)
    flows = [
        (f.get("sourceRef"), f.get("targetRef")) for f in proc.findall("bpmn:sequenceFlow", NS)
    ]
    kinds = {e.get("id"): e.tag.split("}")[-1] for e in proc}
    writes = {
        e.get("id"): [
            a.findtext("bpmn:targetRef", namespaces=NS)
            for a in e.findall("bpmn:dataOutputAssociation", NS)
        ]
        for e in proc
    }
    return flows, kinds, writes


def _back_edges(flows):
    """The flows that return to a node on the way to them from the start: the
    rework ways (a loop, or a decision branch back to an earlier step)."""
    out = {}
    for a, b in flows:
        out.setdefault(a, []).append(b)
    back, state = set(), {"StartEvent_1": 1}
    stack = [("StartEvent_1", iter(out.get("StartEvent_1", [])))]
    while stack:
        node, it = stack[-1]
        nxt = next(it, None)
        if nxt is None:
            state[node] = 2
            stack.pop()
        elif state.get(nxt) == 1:
            back.add((node, nxt))
        elif nxt not in state:
            state[nxt] = 1
            stack.append((nxt, iter(out.get(nxt, []))))
    return back


def _runs(bp):
    """Every way a case can run through the drawn diagram.

    A token at an exclusive gateway with several ways takes each in turn (a way
    back, `_back_edges`, is rework and is not taken); a task or a fork sends a
    token down every way out; a parallel join fires when a token has come in on
    each of its forward ways. A node two tokens reach is passed twice. Returns
    ``(nodes in the order passed, nodes a token was left waiting at)`` per run.
    """
    flows, kinds, _ = _flows(bp)
    back = _back_edges(flows)
    out, indeg = {}, {}
    for a, b in flows:
        if (a, b) in back:
            continue
        out.setdefault(a, []).append(b)
        indeg[b] = indeg.get(b, 0) + 1
    runs = []

    def go(pending, order, waiting):
        while pending:
            n = pending.pop(0)
            kind = kinds[n]
            if kind == "exclusiveGateway" and len(out.get(n, [])) > 1:
                for t in out[n]:
                    go([t] + pending, order + [n], dict(waiting))
                return
            if kind == "parallelGateway" and indeg.get(n, 0) > 1:
                waiting[n] = waiting.get(n, 0) + 1
                if waiting[n] < indeg[n]:
                    continue
                waiting[n] = 0
            order = order + [n]
            if kind != "endEvent":
                pending = pending + out.get(n, [])
        runs.append((order, {n for n, c in waiting.items() if c}))

    go(["StartEvent_1"], [], {})
    return runs


def _assert_each_finished_run_passes_once(bp, reports, sends):
    """Every run that reaches the success end passes the report (an own report
    step or a generated one) and the submission (an own send step or a
    generated one) exactly once, and no run leaves a token waiting."""
    runs = _runs(bp)
    finished = [order for order, _ in runs if END in order]
    assert finished, runs
    for order, waiting in runs:
        assert not waiting, (order, waiting)
    for order in finished:
        n_reports = sum(1 for n in order if n in reports or n.startswith(PDF))
        n_sends = sum(1 for n in order if n in sends or n.startswith("Activity_submit_"))
        assert n_reports == 1, order
        assert n_sends == 1, order
    return finished


UPLOAD = _step("upload", "user_task", outputs=["invoice_pdf"])
EXTRACT = _step("extract", deps=["upload"], inputs=["invoice_pdf"], outputs=["record"])
BASE_ARTS = {"invoice_pdf": _art("pdf", upload=True), "record": _art("structured_json", "extract")}


def _report(sid, deps):
    return _step(sid, deps=deps, inputs=["record"], outputs=[f"{sid}_pdf"])


def _report_art(sid, final=True):
    return {f"{sid}_pdf": _art("pdf", sid, final=final)}


# -- the boxes ------------------------------------------------------------------


def test_the_agents_own_report_and_submission_are_drawn_once():
    steps = [
        UPLOAD,
        EXTRACT,
        _report("make_document", ["extract"]),
        _send("deliver", ["make_document"]),
    ]
    bp = _blueprint(steps, {**BASE_ARTS, **_report_art("make_document")})
    flows, kinds, writes = _flows(bp)

    assert PDF not in kinds
    assert not any(k.startswith("Activity_submit_") for k in kinds)
    assert ("Activity_make_document", "Activity_deliver") in flows
    assert ("Activity_deliver", END) in flows
    # The integration's data store stays, written by the agent's own step.
    store = next(k for k, v in kinds.items() if v == "dataStoreReference")
    assert store in writes["Activity_deliver"]
    _assert_each_finished_run_passes_once(bp, {"Activity_make_document"}, {"Activity_deliver"})


def test_without_own_steps_both_boxes_are_generated_report_first():
    flows, kinds, _ = _flows(_blueprint([UPLOAD, EXTRACT], dict(BASE_ARTS)))

    assert ("Activity_extract", PDF) in flows
    send = next(k for k in kinds if k.startswith("Activity_submit_"))
    assert (PDF, send) in flows
    assert (send, END) in flows


def test_an_own_report_step_without_a_submission_gets_the_generated_send_after_it():
    steps = [UPLOAD, EXTRACT, _report("make_document", ["extract"])]
    flows, kinds, _ = _flows(_blueprint(steps, {**BASE_ARTS, **_report_art("make_document")}))

    assert PDF not in kinds
    send = next(k for k in kinds if k.startswith("Activity_submit_"))
    assert ("Activity_make_document", send) in flows


def test_an_own_submission_without_a_report_gets_the_generated_report_at_the_end():
    """The generated report stays where it always was, on the one way into the
    end, so after the agent's own send step."""
    bp = _blueprint([UPLOAD, EXTRACT, _send("send_erp", ["extract"])], BASE_ARTS)
    flows, kinds, _ = _flows(bp)

    assert not any(k.startswith("Activity_submit_") for k in kinds)
    assert ("Activity_extract", "Activity_send_erp") in flows
    assert ("Activity_send_erp", PDF) in flows
    assert (PDF, END) in flows


def test_a_marker_for_one_of_two_targets_keeps_the_other_targets_box():
    steps = [UPLOAD, EXTRACT, _send("deliver", ["extract"])]
    flows, kinds, _ = _flows(
        _blueprint(steps, BASE_ARTS, targets=(ERP, "archive_system"), outputs=("structured_json",))
    )

    sends = [k for k in kinds if k.startswith("Activity_submit_")]
    assert sends == ["Activity_submit_archive_system"]


def test_a_marker_naming_no_target_is_not_taken_for_the_submission():
    bp = _blueprint([UPLOAD, EXTRACT, _send("send_erp", ["extract"], target="erp")], BASE_ARTS)
    _, kinds, _ = _flows(bp)

    assert any(k.startswith("Activity_submit_") for k in kinds)


def test_an_upload_steps_pdf_is_not_taken_for_the_report():
    _, kinds, _ = _flows(_blueprint([UPLOAD, EXTRACT], dict(BASE_ARTS), targets=()))

    assert PDF in kinds


def test_an_intermediate_pdf_is_not_taken_for_the_final_report():
    """A normalised PDF that the review then reads is not the report: the
    generated report is still drawn after approval."""
    steps = [
        UPLOAD,
        _step("normalise", deps=["upload"], inputs=["invoice_pdf"], outputs=["clean_pdf"]),
        _step("extract", deps=["normalise"], inputs=["clean_pdf"], outputs=["record"]),
        _step("review", "human_review", deps=["extract"], inputs=["record"]),
    ]
    arts = {**BASE_ARTS, "clean_pdf": _art("pdf", "normalise", final=False)}
    bp = _blueprint(steps, arts, targets=())
    flows, kinds, _ = _flows(bp)

    assert PDF in kinds
    runs = _runs(bp)
    assert all(not w for _, w in runs)
    finished = [o for o, _ in runs if END in o]
    assert finished
    for order in finished:
        assert order.index("Activity_review") < order.index(PDF)


def test_an_own_report_on_one_branch_only_is_trusted_and_nothing_is_generated():
    """What the agent wrote is drawn: a report on the manager's branch only is not
    copied onto the other branch, and both branches still finish."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("route", deps=["extract"]),
        _step("manager", "user_task", deps=["route"]),
        _report("make_document", ["manager"]),
        _step("archive", deps=["route"]),
    ]
    decision = _decision("big", "route", ("yes", "manager"), ("no", "archive"))
    bp = _blueprint(
        steps, {**BASE_ARTS, **_report_art("make_document")}, targets=(), decisions=[decision]
    )
    _, kinds, _ = _flows(bp)

    assert PDF not in kinds
    runs = _runs(bp)
    assert all(not waiting for _, waiting in runs)
    finished = [o for o, _ in runs if END in o]
    assert any("Activity_make_document" in o for o in finished)
    assert any("Activity_archive" in o and "Activity_make_document" not in o for o in finished)


# -- a decision's branch to "end" -------------------------------------------------


def test_a_branch_to_end_gets_the_report_and_submission_on_it():
    """The auto-approval shape: "small" goes to "end", "big" to the review and
    the agent's report and send steps. "small" still ends, with a generated
    report and submission on its way, so each finished run passes each once."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("review", "human_review", deps=["extract"], inputs=["record"]),
        _report("make_doc", ["review"]),
        _send("deliver", ["make_doc"]),
    ]
    decision = _decision("auto", "extract", ("small", "end"), ("big", "review"))
    bp = _blueprint(steps, {**BASE_ARTS, **_report_art("make_doc")}, decisions=[decision])
    flows, _, _ = _flows(bp)

    finished = _assert_each_finished_run_passes_once(
        bp, {"Activity_make_doc"}, {"Activity_deliver"}
    )
    assert any("Activity_review" not in o for o in finished)
    assert ("Gateway_decision_auto", "Activity_generate_pdf_auto") in flows
    send = "Activity_submit_ERP_system__approved_invoice_data__auto"
    assert ("Activity_generate_pdf_auto", send) in flows
    assert (send, END) in flows


def test_a_branch_to_end_is_not_led_through_a_review_after_the_report():
    """enrich, report, human review, send on "big": the auto-approved "small"
    case does not pass the review or its rejection."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("enrich", deps=["extract"]),
        _report("make_doc", ["enrich"]),
        _step("review", "human_review", deps=["make_doc"], inputs=["record"]),
        _send("deliver", ["review"]),
    ]
    decision = _decision("auto", "extract", ("small", "end"), ("big", "enrich"))
    bp = _blueprint(steps, {**BASE_ARTS, **_report_art("make_doc")}, decisions=[decision])

    finished = _assert_each_finished_run_passes_once(
        bp, {"Activity_make_doc"}, {"Activity_deliver"}
    )
    small = [o for o in finished if "Activity_enrich" not in o]
    assert small and all("Activity_review" not in o for o in small)


def test_a_branch_to_end_does_not_submit_twice_through_a_later_decision():
    """The report is followed by a decision whose "erp" branch sends: the
    auto-approved case gets one generated report and one generated submission,
    and does not run into the agent's steps."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("review", "human_review", deps=["extract"], inputs=["record"]),
        _report("make_doc", ["review"]),
        _send("deliver", ["make_doc"]),
        _step("archive", deps=["make_doc"]),
    ]
    decisions = [
        _decision("auto", "extract", ("small", "end"), ("big", "review")),
        _decision("where", "make_doc", ("erp", "deliver"), ("keep", "archive")),
    ]
    bp = _blueprint(steps, {**BASE_ARTS, **_report_art("make_doc")}, decisions=decisions)

    runs = _runs(bp)
    assert all(not w for _, w in runs)
    small = [o for o, _ in runs if END in o and "Activity_review" not in o]
    assert small
    for order in small:
        assert sum(1 for n in order if n.startswith("Activity_submit_")) == 1, order
        assert sum(1 for n in order if n.startswith(PDF)) == 1, order
        assert "Activity_deliver" not in order and "Activity_make_doc" not in order


def test_a_branch_to_end_after_a_routing_decision_gets_the_submission():
    """big: review, then the agent's send step; small: an auto check, then
    ok to "end". The send step is on another branch of the earlier decision,
    so the ok run gets a generated submission."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("review", "human_review", deps=["extract"], inputs=["record"]),
        _send("send_erp", ["review"]),
        _step("auto_check", deps=["extract"]),
    ]
    decisions = [
        _decision("route", "extract", ("big", "review"), ("small", "auto_check")),
        _decision("flagged", "auto_check", ("ok", "end"), ("flag", "review")),
    ]
    bp = _blueprint(steps, BASE_ARTS, outputs=("structured_json",), decisions=decisions)

    runs = _runs(bp)
    assert all(not w for _, w in runs)
    finished = [o for o, _ in runs if END in o]
    assert finished
    for order in finished:
        sends = [n for n in order if n == "Activity_send_erp" or n.startswith("Activity_submit_")]
        assert len(sends) == 1, order


def test_a_branch_to_end_after_the_own_steps_still_ends():
    steps = [UPLOAD, EXTRACT, _send("deliver", ["extract"]), _step("notify", deps=["deliver"])]
    decision = _decision("tell", "deliver", ("no", "end"), ("yes", "notify"))
    bp = _blueprint(steps, BASE_ARTS, outputs=("structured_json",), decisions=[decision])
    flows, _, _ = _flows(bp)

    assert ("Gateway_decision_tell", END) in flows
    runs = _runs(bp)
    assert all(not w for _, w in runs)
    for order in (o for o, _ in runs if END in o):
        assert order.count("Activity_deliver") == 1


def test_a_branch_to_end_beside_an_own_report_on_another_way_of_a_fork():
    """The report runs beside the decision (both follow a fork): it is passed
    anyway, so the branch ends and the report is entered once."""
    steps = [
        UPLOAD,
        EXTRACT,
        _report("make_doc", ["extract"]),
        _step("notify", deps=["extract"]),
        _step("escalate", deps=["notify"]),
    ]
    decision = _decision("esc", "notify", ("no", "end"), ("yes", "escalate"))
    bp = _blueprint(
        steps, {**BASE_ARTS, **_report_art("make_doc")}, targets=(), decisions=[decision]
    )
    flows, _, _ = _flows(bp)

    assert not any(a == "Gateway_decision_esc" and "make_doc" in b for a, b in flows)
    for order in (o for o, _ in _runs(bp) if END in o):
        assert order.count("Activity_make_doc") == 1


def test_a_rework_branch_does_not_lead_end_into_a_report_beside_the_decision():
    """extract forks into check and report → send; a decision after check has
    done → end and rework → extract. Following the rework branch reaches the
    report, but it runs beside the decision: done ends."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("check", deps=["extract"]),
        _report("make_doc", ["extract"]),
        _send("deliver", ["make_doc"]),
    ]
    decision = _decision("ok", "check", ("done", "end"), ("rework", "extract"))
    bp = _blueprint(steps, {**BASE_ARTS, **_report_art("make_doc")}, decisions=[decision])
    flows, _, _ = _flows(bp)

    assert ("Gateway_decision_ok", END) in flows
    assert not any(a == "Gateway_decision_ok" and "make_doc" in b for a, b in flows)
    _assert_each_finished_run_passes_once(bp, {"Activity_make_doc"}, {"Activity_deliver"})


def test_a_rework_branch_does_not_lead_end_into_a_report_before_the_decision():
    steps = [UPLOAD, EXTRACT, _report("make_doc", ["extract"]), _step("check", deps=["make_doc"])]
    decision = _decision("ok", "check", ("yes", "end"), ("no", "extract"))
    bp = _blueprint(
        steps, {**BASE_ARTS, **_report_art("make_doc")}, targets=(), decisions=[decision]
    )
    flows, _, _ = _flows(bp)

    assert ("Gateway_decision_ok", END) in flows
    assert not any(a == "Gateway_decision_ok" and "make_doc" in b for a, b in flows)


def test_two_decisions_draw_no_cycle_through_the_shortcut():
    steps = [
        UPLOAD,
        EXTRACT,
        _step("check", deps=["extract"]),
        _report("make_doc", ["check"]),
        _step("verify", deps=["make_doc"]),
        _send("deliver", ["verify"]),
    ]
    decisions = [
        _decision("first", "check", ("done", "end"), ("go", "make_doc")),
        _decision("second", "verify", ("fine", "end"), ("again", "check")),
    ]
    bp = _blueprint(steps, {**BASE_ARTS, **_report_art("make_doc")}, decisions=decisions)

    _assert_each_finished_run_passes_once(bp, {"Activity_make_doc"}, {"Activity_deliver"})


def test_a_shortcut_does_not_skip_a_join_that_waits_for_another_way():
    """fork(review, verify); check after the review; the report waits for check
    and verify. A decision after the approval must not send "finish" into the
    report past the join that waits for verify."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("review", "human_review", deps=["extract"], inputs=["record"]),
        _step("verify", deps=["extract"]),
        _step("check", deps=["review"]),
        _report("make_doc", ["check", "verify"]),
    ]
    decision = _decision("more", "review", ("finish", "end"), ("more", "check"))
    bp = _blueprint(
        steps, {**BASE_ARTS, **_report_art("make_doc")}, targets=(), decisions=[decision]
    )
    flows, _, _ = _flows(bp)

    assert not any(a == "Gateway_decision_more" and "make_doc" in b for a, b in flows)
    # The "finish" run skips the report the join waits for: it gets one of its own.
    assert ("Gateway_decision_more", "Activity_generate_pdf_more") in flows


def test_a_join_after_the_only_own_step_draws_the_report_on_the_branch():
    """The report runs beside another step after the decision and a join waits
    for both: the shortcut cannot enter it, so the branch gets a generated
    report of its own."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("review", "human_review", deps=["extract"], inputs=["record"]),
        _report("make_doc", ["review"]),
        _step("archive", deps=["review"]),
        _step("close", deps=["make_doc", "archive"]),
    ]
    decision = _decision("auto", "extract", ("small", "end"), ("big", "review"))
    bp = _blueprint(
        steps, {**BASE_ARTS, **_report_art("make_doc")}, targets=(), decisions=[decision]
    )
    runs = _runs(bp)
    assert all(not w for _, w in runs)
    finished = [o for o, _ in runs if END in o]
    assert finished
    for order in finished:
        n = sum(1 for x in order if x == "Activity_make_doc" or x.startswith(PDF))
        assert n == 1, order
    assert any(any(x.startswith(PDF + "_") for x in o) for o in finished)


def test_what_the_shortcut_cannot_pass_is_generated_on_it():
    """The report and the send step are on the decision's two other branches:
    the shortcut enters one of them and gets the other as a generated box."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("route", deps=["extract"]),
        _report("make_doc", ["route"]),
        _send("deliver", ["route"]),
    ]
    decision = _decision("way", "route", ("doc", "make_doc"), ("send", "deliver"), ("none", "end"))
    bp = _blueprint(steps, {**BASE_ARTS, **_report_art("make_doc")}, decisions=[decision])
    runs = _runs(bp)
    assert all(not w for _, w in runs)
    finished = [o for o, _ in runs if END in o]
    assert len(finished) == 3
    generated = [
        o
        for o in finished
        if any(x.startswith(("Activity_generate_pdf_", "Activity_submit_")) for x in o)
    ]
    assert len(generated) == 1
    (none_run,) = generated
    reports = [x for x in none_run if x == "Activity_make_doc" or x.startswith(PDF)]
    sends = [x for x in none_run if x == "Activity_deliver" or x.startswith("Activity_submit_")]
    assert len(reports) == 1 and len(sends) == 1, none_run


def test_two_marked_senders_on_two_branches_both_pass_the_generated_report():
    steps = [
        UPLOAD,
        EXTRACT,
        _send("send_small", ["extract"]),
        _send("send_large", ["extract"]),
    ]
    decision = _decision("size", "extract", ("small", "send_small"), ("large", "send_large"))
    bp = _blueprint(steps, BASE_ARTS, decisions=[decision])

    _assert_each_finished_run_passes_once(bp, set(), {"Activity_send_small", "Activity_send_large"})


def test_a_marked_sender_before_the_review_leaves_the_report_after_approval():
    steps = [
        UPLOAD,
        EXTRACT,
        _send("send_erp", ["extract"]),
        _step("review", "human_review", deps=["send_erp"], inputs=["record"]),
    ]
    bp = _blueprint(steps, BASE_ARTS)

    for order in _assert_each_finished_run_passes_once(bp, set(), {"Activity_send_erp"}):
        assert order.index("Activity_review") < order.index(PDF)


def test_a_marker_on_a_decision_step_is_not_taken_for_the_submission():
    """A step of type "decision" is drawn as a gateway: it sends nothing, so the
    target keeps its generated box and no gateway writes the data store."""
    steps = [
        UPLOAD,
        EXTRACT,
        _step("route", "decision", deps=["extract"], parameters={"integration_target": ERP}),
        _step("done", deps=["route"]),
    ]
    _, kinds, writes = _flows(_blueprint(steps, BASE_ARTS, outputs=("structured_json",)))

    assert any(k.startswith("Activity_submit_") for k in kinds)
    assert not any(w for k, w in writes.items() if kinds.get(k) == "exclusiveGateway")


def test_the_shared_rules_read_final_output_as_the_blueprint_does():
    from solution_wizard.bpmn_generator import report_box_needed

    draft = {
        "technical_spec": {"output_types": ["pdf"]},
        "artifacts": {
            "r": {
                "type": "pdf",
                "source": "generated",
                "produced_by": "make",
                "final_output": "true",
            }
        },
        "workflow": {"steps": [{"id": "make", "outputs": ["r"]}]},
    }
    assert report_box_needed(draft) is False
    draft["artifacts"]["r"]["final_output"] = "false"
    assert report_box_needed(draft) is True
