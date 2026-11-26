"""The old saves (the Blueprint form's PATCH, the canvas's ``/bpmn/sync``) to the
agent's draft: what they are refused before the diff, and the version they are
made on.

- A save with more steps than a blueprint can hold is refused before it is
  compared with the draft, which happens under the session's locks.
- A save names the version it was made on, and one made on an older version is
  refused, so a canvas drawn before the agent's latest edit cannot turn it back.
- A session read lists its versions without loading their drafts.
"""

import copy
import re
import uuid

import pytest
from helpers import requires_postgres
from sqlalchemy import inspect
from test_patch_blueprint_writes_draft import _create, _read_draft, _rename_task, _versions
from wizard_api.services import agent_service, blueprint_ops, blueprint_service
from wizard_api.services import blueprint_edit_service as edits

pytestmark = pytest.mark.skipif(
    not blueprint_ops.solution_wizard_available(),
    reason="solution_wizard package not installed",
)


@pytest.fixture
def not_busy(monkeypatch):
    monkeypatch.setattr(agent_service, "is_busy", lambda session_id: False)


@pytest.fixture
def no_diff(monkeypatch):
    """Fails the test if a save reaches the diff."""

    def refuse(*args, **kwargs):
        raise AssertionError("the save reached the diff")

    monkeypatch.setattr(edits, "v2_edit", refuse)


def _canvas(client, sid: str) -> str:
    return client.get(f"/sessions/{sid}/bpmn").text


def _with_tasks(xml: str, count: int) -> str:
    """The canvas with ``count`` more tasks in its process."""
    tasks = "".join(
        f'<bpmn:userTask id="Activity_extra{i}" name="Extra {i}"/>' for i in range(count)
    )
    edited, n = re.subn(r"(</bpmn:process>)", tasks + r"\1", xml, count=1)
    assert n == 1
    return edited


# ---------------------------------------------------------------- step bound


@requires_postgres
def test_a_form_save_with_too_many_steps_is_refused_before_the_diff(
    client, db_session, not_busy, no_diff
) -> None:
    created = _create(client, db_session)
    sid = created["id"]
    content = copy.deepcopy(created["blueprint"])
    step = content["steps"][0]
    content["steps"] = [
        {**step, "id": f"s{i}", "name": f"Step {i}"} for i in range(edits.MAX_EDIT_STEPS + 1)
    ]
    before = len(_versions(db_session, sid))

    res = client.patch(
        f"/sessions/{sid}/blueprint",
        json={"content": content, "base_version": created["active_version"]},
    )

    assert res.status_code == 422, res.text
    assert res.json()["detail"]["error"] == "too_many_steps"
    assert len(_versions(db_session, sid)) == before


@requires_postgres
def test_a_canvas_with_too_many_tasks_is_refused_before_the_diff(
    client, db_session, not_busy, no_diff
) -> None:
    created = _create(client, db_session)
    sid = created["id"]
    xml = _with_tasks(_canvas(client, sid), edits.MAX_EDIT_STEPS + 1)
    before = len(_versions(db_session, sid))

    res = client.post(
        f"/sessions/{sid}/bpmn/sync",
        json={"xml": xml, "base_version": created["active_version"]},
    )

    assert res.status_code == 422, res.text
    assert res.json()["detail"]["error"] == "too_many_steps"
    assert len(_versions(db_session, sid)) == before


def test_the_step_bound_holds_every_step_a_blueprint_can_have() -> None:
    from solution_wizard.blueprint import MAX_STEPS

    # Workflow steps and manual steps, each up to MAX_STEPS, are tasks on the canvas.
    assert edits.MAX_EDIT_STEPS == 2 * MAX_STEPS


# ---------------------------------------------------------------- base_version


@requires_postgres
def test_a_form_save_to_the_draft_without_its_version_is_refused(
    client, db_session, not_busy
) -> None:
    created = _create(client, db_session)
    content = copy.deepcopy(created["blueprint"])
    content["steps"][0]["name"] = "Renamed"

    res = client.patch(f"/sessions/{created['id']}/blueprint", json={"content": content})

    assert res.status_code == 422, res.text
    assert res.json()["detail"]["error"] == "base_version_required"


@requires_postgres
def test_a_canvas_save_to_the_draft_without_its_version_is_refused(
    client, db_session, not_busy
) -> None:
    created = _create(client, db_session)
    sid = created["id"]
    xml = _rename_task(_canvas(client, sid), "extract", "Read it")
    before = _read_draft(created["output_dir"])

    res = client.post(f"/sessions/{sid}/bpmn/sync", json={"xml": xml})

    assert res.status_code == 422, res.text
    assert res.json()["detail"]["error"] == "base_version_required"
    assert _read_draft(created["output_dir"]) == before


@requires_postgres
def test_a_canvas_drawn_before_a_newer_edit_does_not_turn_it_back(
    client, db_session, not_busy
) -> None:
    created = _create(client, db_session)
    sid = created["id"]
    drawn_on = created["active_version"]
    stale = _canvas(client, sid)

    # A newer edit (here the form's; the agent's would add a version the same way).
    content = copy.deepcopy(created["blueprint"])
    content["steps"][0]["name"] = "Newer name"
    newer = client.patch(
        f"/sessions/{sid}/blueprint", json={"content": content, "base_version": drawn_on}
    )
    assert newer.status_code == 200, newer.text
    assert newer.json()["active_version"] > drawn_on
    kept = _read_draft(created["output_dir"])

    res = client.post(
        f"/sessions/{sid}/bpmn/sync",
        json={
            "xml": _rename_task(stale, "extract", "From the old canvas"),
            "base_version": drawn_on,
        },
    )

    assert res.status_code == 409, res.text
    assert res.json()["detail"]["error"] == "changed_elsewhere"
    assert _read_draft(created["output_dir"]) == kept


@requires_postgres
def test_the_version_is_checked_again_under_the_lock(
    client, db_session, not_busy, monkeypatch
) -> None:
    """A version added after the route's own check, before the write takes the
    lock, still refuses the save."""
    created = _create(client, db_session)
    sid = created["id"]
    drawn_on = created["active_version"]
    xml = _rename_task(_canvas(client, sid), "extract", "Late")
    real = edits._apply

    def newer_first(db, session, base_version, change):
        blueprint_service.add_version(db, session, note="Agent update", content=None)
        db.commit()
        return real(db, session, base_version, change)

    monkeypatch.setattr(edits, "_apply", newer_first)

    res = client.post(f"/sessions/{sid}/bpmn/sync", json={"xml": xml, "base_version": drawn_on})

    assert res.status_code == 409, res.text
    assert res.json()["detail"]["error"] == "changed_elsewhere"


# ---------------------------------------------------------------- version list


@requires_postgres
def test_the_version_list_leaves_the_drafts_unloaded(client, db_session) -> None:
    created = _create(client, db_session)

    db_session.expire_all()
    versions = blueprint_service.list_versions(db_session, uuid.UUID(created["id"]))

    assert versions
    assert all("draft" in inspect(v).unloaded for v in versions)
    assert all("note" not in inspect(v).unloaded for v in versions)
