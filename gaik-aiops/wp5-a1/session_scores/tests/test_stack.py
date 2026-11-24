"""The job against the running stack: a synthetic session goes through the collector
into MLflow, the job scores it, and the scores and the group's run are read back.

Skipped without the stack (gaik-aiops/deploy/compose). The session goes to the
``example-producer`` experiment, so the wizard's own experiment is left alone.
"""

import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

import pytest
from session_scores import facts, job

COLLECTOR = "http://127.0.0.1:4318"
MLFLOW = "http://127.0.0.1:5000"
EXPERIMENT = "example-producer"


def _up() -> bool:
    try:
        urllib.request.urlopen(f"{MLFLOW}/health", timeout=3)
        probe = urllib.request.Request(
            f"{COLLECTOR}/v1/traces", data=b"{}", headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(probe, timeout=3)
    except Exception:  # noqa: BLE001
        return False
    return True


pytestmark = pytest.mark.skipif(not _up(), reason="collector or MLflow not running")


def _attr(key: str, value) -> dict:
    if isinstance(value, float):
        return {"key": key, "value": {"doubleValue": value}}
    return {"key": key, "value": {"stringValue": str(value)}}


def _request(session: str, version: str, child_name: str, child: dict) -> dict:
    """One request trace: a root span naming the session and the agent, and one span under it."""
    trace_id, root_id, now = secrets.token_hex(16), secrets.token_hex(8), time.time_ns()
    root = {
        "traceId": trace_id,
        "spanId": root_id,
        "name": "PATCH /sessions/{session_id}",
        "kind": 2,
        "startTimeUnixNano": str(now - 2_000_000_000),
        "endTimeUnixNano": str(now),
        "attributes": [
            _attr("gaik.session.id", session),
            _attr("gaik.agent.model", "synthetic-model"),
            _attr("gaik.agent.reasoning", "high"),
        ],
    }
    under = {
        "traceId": trace_id,
        "spanId": secrets.token_hex(8),
        "parentSpanId": root_id,
        "name": child_name,
        "kind": 1,
        "startTimeUnixNano": str(now - 1_500_000_000),
        "endTimeUnixNano": str(now - 500_000_000),
        "attributes": [_attr("gaik.session.id", session), *(_attr(k, v) for k, v in child.items())],
    }
    body = {
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        _attr("service.name", EXPERIMENT),
                        _attr("service.version", version),
                        _attr("deployment.environment.name", "test"),
                    ]
                },
                "scopeSpans": [{"scope": {"name": "test"}, "spans": [root, under]}],
            }
        ]
    }
    request = urllib.request.Request(
        f"{COLLECTOR}/v1/traces",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        assert response.status == 200
    return {"trace_id": f"tr-{trace_id}"}


def _get(path: str, **query) -> dict:
    with urllib.request.urlopen(
        f"{MLFLOW}{path}?{urllib.parse.urlencode(query)}", timeout=10
    ) as response:
        return json.load(response)


def _stored(trace_id: str) -> dict:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            return _get("/api/3.0/mlflow/traces/get", trace_id=trace_id)["trace"]["trace_info"]
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                raise
        time.sleep(1)
    raise AssertionError(f"trace {trace_id} did not reach MLflow")


def _run_job() -> None:
    assert (
        job.main(["--experiment", EXPERIMENT, "--settle-minutes", "0", "--lookback-hours", "1"])
        == 0
    )


@pytest.fixture(scope="module")
def scored_session() -> dict:
    """A finished session with a passed PoC run, scored by one pass of the job."""
    session, version = f"session-{secrets.token_hex(6)}", f"test-{secrets.token_hex(4)}"
    first = _request(
        session, version, facts.TURN, {"gaik.turn.cost.eur": 1.25, "gaik.turn.cost.usd": 1.4}
    )
    time.sleep(0.05)
    others = [
        _request(
            session,
            version,
            facts.SANDBOX_RESULT,
            {"gaik.sandbox.kind": "run", "gaik.sandbox.phase": "succeeded"},
        ),
        _request(
            session,
            version,
            facts.GATE,
            {"gaik.gate": "gate_4", "gaik.gate.from": "pending", "gaik.gate.to": "approved"},
        ),
    ]
    for sent in (first, *others):
        _stored(sent["trace_id"])
    _run_job()
    return {
        "first": first["trace_id"],
        "others": [o["trace_id"] for o in others],
        "version": version,
    }


def _scores(trace_id: str) -> dict:
    return {
        a["assessment_name"]: a["feedback"]["value"]
        for a in _stored(trace_id).get("assessments", [])
        if a["source"]["source_id"] == job.SOURCE_ID
    }


def test_the_sessions_first_trace_carries_its_scores(scored_session):
    scores = _scores(scored_session["first"])
    assert scores[facts.FINISHED] == 1.0
    assert scores[facts.POC_PASSED] == 1.0
    assert scores[facts.REJECTIONS] == 0.0
    assert scores[facts.COST_EUR] == 1.25
    assert scores[facts.FINISHED_POC_COST_EUR] == 1.25


def test_the_sessions_other_traces_carry_none(scored_session):
    for trace_id in scored_session["others"]:
        assert _scores(trace_id) == {}


def test_a_second_pass_changes_nothing(scored_session):
    before = _stored(scored_session["first"])["assessments"]
    _run_job()
    assert _stored(scored_session["first"])["assessments"] == before


def test_the_group_has_a_run_with_its_rates(scored_session):
    filter_string = f"params.wizard_version = '{scored_session['version']}'"
    experiment = _get("/api/2.0/mlflow/experiments/get-by-name", experiment_name=EXPERIMENT)
    body = {"experiment_ids": [experiment["experiment"]["experiment_id"]], "filter": filter_string}
    request = urllib.request.Request(
        f"{MLFLOW}/api/2.0/mlflow/runs/search",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        (run,) = json.load(response)["runs"]
    metrics = {m["key"]: m["value"] for m in run["data"]["metrics"]}
    params = {p["key"]: p["value"] for p in run["data"]["params"]}
    assert params == {
        "environment": "test",
        "wizard_version": scored_session["version"],
        "model": "synthetic-model",
        "reasoning": "high",
    }
    assert metrics["sessions"] == 1.0
    assert metrics["finished_pct"] == 100.0
    assert metrics["poc_passed_pct"] == 100.0
    assert metrics["eur_per_finished_poc"] == 1.25
