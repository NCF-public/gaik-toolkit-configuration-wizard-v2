"""The test alert end to end against the local compose stack.

send-test-alert.sh fires AIOpsTestAlert through the collector; it must reach Alertmanager and the
rules Grafana's "Active alerts" panels list, and clear from both again. The rule's timing is
unit-tested with promtool (deploy/compose/prometheus/tests/test-alert.test.yml).
Skipped when the stack is not reachable.
"""

import base64
import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

OTLP = "http://127.0.0.1:4318"
ALERTMANAGER = "http://127.0.0.1:9093"
GRAFANA = "http://127.0.0.1:3000"
GRAFANA_AUTH = "admin:" + os.environ.get("GRAFANA_ADMIN_PASSWORD", "admin-local-only")
SCRIPT = Path(__file__).parents[4] / "deploy/k8s/stack/overlays/rahti/send-test-alert.sh"


def get(url: str, auth: str | None = None):
    req = urllib.request.Request(url)
    if auth:
        req.add_header("Authorization", "Basic " + base64.b64encode(auth.encode()).decode())
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.load(resp)


def _up() -> bool:
    try:
        get(f"{GRAFANA}/api/health")
        get(f"{ALERTMANAGER}/api/v2/status")
    except Exception:  # noqa: BLE001
        return False
    try:
        urllib.request.urlopen(OTLP, timeout=2)
    except urllib.error.HTTPError:
        return True  # the collector answers its root with 404
    except Exception:  # noqa: BLE001
        return False
    return True


pytestmark = pytest.mark.skipif(not _up(), reason="compose stack not running")


def send(action: str, environment: str) -> None:
    env = {**os.environ, "OTLP_ENDPOINT": OTLP, "ENVIRONMENT": environment}
    env.pop("OTLP_TOKEN", None)
    subprocess.run(
        ["bash", str(SCRIPT), action], env=env, check=True, capture_output=True, timeout=30
    )


def in_alertmanager(environment: str) -> bool:
    query = [
        ("filter", 'alertname="AIOpsTestAlert"'),
        ("filter", f'deployment_environment_name="{environment}"'),
        ("active", "true"),
    ]
    alerts = get(f"{ALERTMANAGER}/api/v2/alerts?" + urllib.parse.urlencode(query))
    return any(a["labels"].get("severity") == "info" for a in alerts)


def in_grafana_panel_source(environment: str) -> bool:
    # What the panels read: the Prometheus datasource's rules with their firing alerts.
    rules = get(f"{GRAFANA}/api/prometheus/prometheus/api/v1/rules", GRAFANA_AUTH)
    groups = rules["data"]["groups"]
    return any(
        a["state"] == "firing" and a["labels"].get("deployment_environment_name") == environment
        for g in groups
        for r in g["rules"]
        if r["name"] == "AIOpsTestAlert"
        for a in r.get("alerts", [])
    )


def wait_until(check, environment: str, expected: bool, timeout: float = 90) -> bool:
    deadline = time.time() + timeout
    while check(environment) != expected:
        if time.time() > deadline:
            return False
        time.sleep(2)
    return True


def test_test_alert_fires_and_clears():
    # Its own environment name, so a test alert someone fired by hand does not count. One fixed
    # name, so runs do not add values to the dashboards' Environment picker; a run that failed
    # before its clear is cleared first.
    environment = "stack-test"
    send("clear", environment)
    assert wait_until(in_alertmanager, environment, False), "an earlier run's alert stays"
    try:
        send("fire", environment)
        assert wait_until(in_alertmanager, environment, True), "not in Alertmanager"
        assert wait_until(in_grafana_panel_source, environment, True), "not in Grafana's rules"
        send("clear", environment)
        assert wait_until(in_alertmanager, environment, False), "still in Alertmanager"
        assert wait_until(in_grafana_panel_source, environment, False), "still in Grafana's rules"
    finally:
        # Best effort: a failing clear must not hide the assertion that failed above.
        try:
            send("clear", environment)
        except subprocess.SubprocessError:
            pass
