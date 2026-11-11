"""One pseudonym per user across destinations, and the two collector configs kept in step.

The collector pseudonymises once, before branching, so an audit row in Postgres and a trace in MLflow
carry the same pseudonym for the same identity. The stack test is skipped when the stack is
not running; the config test always runs.
"""

import json
import re
import secrets
import time
import urllib.error
import urllib.request
from pathlib import Path

import psycopg
import pytest

OTLP = "http://127.0.0.1:4318"
MLFLOW = "http://127.0.0.1:5000"
READER = "host=127.0.0.1 port=55432 dbname=observability user=collection_reader password=reader-local-only"
COMPOSE = Path(__file__).resolve().parents[4] / "deploy" / "compose"


def _privacy_statements(path: Path, key_source: str) -> list[str]:
    text = path.read_text()
    block = text[text.index("  transform/privacy:"):]
    block = block[: re.search(r"\n  [a-z][\w/]*:\n", block[1:]).start() + 1]
    lines = [line.strip() for line in block.splitlines() if line.strip().startswith(("- set", "- delete", "- replace"))]
    return [line.replace(key_source, "<key>") for line in lines]


def test_the_openbao_overlay_differs_from_the_base_only_in_the_key_source():
    base = _privacy_statements(COMPOSE / "otel-collector.yaml", "${env:PSEUDONYM_KEY}")
    vault = _privacy_statements(COMPOSE / "openbao" / "otel-collector.openbao.yaml", "${file:/run/bao/pseudonym_key}")
    assert base and base == vault


def _post(path: str, body: dict) -> None:
    req = urllib.request.Request(f"{OTLP}{path}", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert resp.status == 200


def _s(key: str, value: str) -> dict:
    return {"key": key, "value": {"stringValue": value}}


def _up() -> bool:
    try:
        with psycopg.connect(READER, connect_timeout=2):
            pass
        urllib.request.urlopen(f"{MLFLOW}/health", timeout=2)
    except Exception:  # noqa: BLE001
        return False
    return True


@pytest.mark.skipif(not _up(), reason="compose stack not running")
def test_an_audit_row_and_a_trace_share_the_pseudonym():
    identity = f"user-{secrets.token_hex(6)}@example.com"
    trace_id = secrets.token_hex(16)
    resource = {"attributes": [_s("service.name", "pseudonym-test")]}
    _post("/v1/logs", {"resourceLogs": [{"resource": resource, "scopeLogs": [{"logRecords": [{
        "traceId": trace_id,
        "attributes": [_s("gaik.event.class", "audit"), _s("event.name", "auth.login"),
                       _s("gaik.audit.outcome", "success"), _s("enduser.id", identity)],
    }]}]}]})
    now = time.time_ns()
    _post("/v1/traces", {"resourceSpans": [{"resource": resource, "scopeSpans": [{"spans": [{
        "traceId": trace_id, "spanId": secrets.token_hex(8), "name": "chat", "kind": 3,
        "startTimeUnixNano": str(now - 1_000_000), "endTimeUnixNano": str(now),
        "attributes": [_s("gaik.event.class", "llm_call"), _s("enduser.id", identity)],
    }]}]}]})

    deadline = time.monotonic() + 30
    audit = span = None
    while time.monotonic() < deadline and not (audit and span):
        with psycopg.connect(READER) as conn:
            row = conn.execute("SELECT actor_pseudo_id FROM collection.audit_events WHERE trace_id = %s",
                               (trace_id,)).fetchone()
        audit = row[0] if row else None
        try:
            trace = json.load(urllib.request.urlopen(f"{MLFLOW}/api/3.0/mlflow/traces/get?trace_id=tr-{trace_id}",
                                                     timeout=5))["trace"]
            attrs = {a["key"]: next(iter(a["value"].values())) for a in trace["spans"][0]["attributes"]}
            span = attrs.get("enduser.pseudo.id")
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                raise
        time.sleep(1)

    assert audit and span, f"audit={audit!r} span={span!r}"
    assert audit == span
    assert identity not in audit
