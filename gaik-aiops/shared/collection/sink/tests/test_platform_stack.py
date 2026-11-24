"""Dashboard and alerting platform checks against the local compose stack.

Alert rule logic itself is unit-tested with promtool
(deploy/compose/prometheus/tests/collection-alerts.test.yml).
Skipped when the stack is not reachable.
"""

import base64
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

import pytest

OTLP = "http://127.0.0.1:4318"
PROM = "http://127.0.0.1:9090"
ALERTMANAGER = "http://127.0.0.1:9093"
GRAFANA = "http://127.0.0.1:3000"
GRAFANA_AUTH = "admin:" + os.environ.get("GRAFANA_ADMIN_PASSWORD", "admin-local-only")


def get(url: str, auth: str | None = None, org: int | None = None):
    req = urllib.request.Request(url)
    if org is not None:
        req.add_header("X-Grafana-Org-Id", str(org))
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
    return True


pytestmark = pytest.mark.skipif(not _up(), reason="compose stack not running")


def test_prometheus_sends_alerts_to_alertmanager():
    active = get(f"{PROM}/api/v1/alertmanagers")["data"]["activeAlertmanagers"]
    assert any("alertmanager:9093" in a["url"] for a in active)


def test_alert_rules_loaded_and_healthy():
    groups = get(f"{PROM}/api/v1/rules?type=alert")["data"]["groups"]
    rules = {r["name"]: r for g in groups for r in g["rules"]}
    assert {
        "HighErrorRatio",
        "HighLatencyP95",
        "ErrorLogs",
        "CollectorDown",
        "EventDeliveryBacklog",
        "EventDeliveryFailing",
    } <= set(rules)
    assert all(r["health"] in ("ok", "unknown") and not r.get("lastError") for r in rules.values())


def test_collector_is_monitored():
    targets = get(f"{PROM}/api/v1/targets")["data"]["activeTargets"]
    collector = [t for t in targets if t["labels"]["job"] == "otel-collector"]
    assert collector and collector[0]["health"] == "up"


def test_grafana_requires_login():
    with pytest.raises(urllib.error.HTTPError) as err:
        get(f"{GRAFANA}/api/search")
    assert err.value.code == 401


def test_grafana_datasources_reach_their_backends():
    # The audit store lives in the separate "Security" organisation (id 2).
    for uid, org in (("prometheus", 1), ("audit-store", 2)):
        health = get(f"{GRAFANA}/api/datasources/uid/{uid}/health", GRAFANA_AUTH, org)
        assert health["status"] == "OK", (uid, health)
    status = get(f"{GRAFANA}/api/datasources/proxy/uid/alertmanager/api/v2/status", GRAFANA_AUTH)
    assert "cluster" in status


def test_dashboards_are_provisioned_in_their_folders():
    found = {
        (org, d["uid"]): d["folderTitle"]
        for org in (1, 2)
        for d in get(f"{GRAFANA}/api/search?type=dash-db", GRAFANA_AUTH, org)
    }
    assert found == {
        (1, "gaik-service-health"): "Monitoring",
        (1, "gaik-wizard-operations"): "Monitoring",
        (1, "gaik-hackathon-live"): "Monitoring",
        (2, "gaik-audit-trail"): "Security",
    }


def test_audit_store_is_not_in_the_main_organisation():
    # Any member of an organisation can query its datasources through the API (Grafana OSS), so the
    # audit store must not exist where viewers are.
    uids = {d["uid"] for d in get(f"{GRAFANA}/api/datasources", GRAFANA_AUTH, 1)}
    assert "audit-store" not in uids


def test_dashboard_queries_return_data_shape():
    # Every Prometheus expression in every monitoring dashboard must parse, also in one added later.
    search = get(f"{GRAFANA}/api/search?type=dash-db", GRAFANA_AUTH, 1)
    uids = [d["uid"] for d in search if d["folderTitle"] == "Monitoring"]
    assert len(uids) >= 3
    exprs = []
    for uid in uids:
        dash = get(f"{GRAFANA}/api/dashboards/uid/{uid}", GRAFANA_AUTH)["dashboard"]
        exprs += [t["expr"] for p in dash["panels"] for t in p.get("targets", []) if "expr" in t]
    assert exprs
    for expr in exprs:
        # The variables' "All" values: $environment matches .* so unlabelled series count too.
        expr = expr.replace('=~"$service"', '=~".+"').replace('=~"$environment"', '=~".*"')
        # Grafana's range of the view (or of a panel's own time, such as "today so far").
        expr = expr.replace("$__range", "1h")
        # No Grafana variable left (a "$" before a quote is a regex anchor, which is fine).
        assert not re.search(r"\$[A-Za-z_{]", expr), expr
        url = f"{PROM}/api/v1/query?" + urllib.parse.urlencode({"query": expr})
        assert get(url)["status"] == "success", expr


def test_alert_list_panels_read_a_rules_source():
    # The "Active alerts" panels list alert rules; their datasource must answer Grafana's rules
    # API. An Alertmanager datasource answers 400, and the panel stays empty while alerts fire.
    uids = {d["name"]: d["uid"] for d in get(f"{GRAFANA}/api/datasources", GRAFANA_AUTH, 1)}
    panels = [
        (d["uid"], p)
        for d in get(f"{GRAFANA}/api/search?type=dash-db", GRAFANA_AUTH, 1)
        for p in get(f"{GRAFANA}/api/dashboards/uid/{d['uid']}", GRAFANA_AUTH)["dashboard"][
            "panels"
        ]
        if p.get("type") == "alertlist"
    ]
    assert len(panels) == 3
    for dash, panel in panels:
        source = uids[panel["options"]["datasource"]]
        rules = get(f"{GRAFANA}/api/prometheus/{source}/api/v1/rules", GRAFANA_AUTH)
        assert rules["status"] == "success", (dash, panel["title"])
        # The stack's own rules, not just any source that answers.
        names = {r["name"] for g in rules["data"]["groups"] for r in g["rules"]}
        assert {"CollectorDown", "AIOpsTestAlert"} <= names, (dash, panel["title"])


def _post_cost(service: str, environment: str, points: list[tuple[int, int, float]]) -> None:
    """Send wizard.usage.cost_usd as the wizard API does: cumulative, one data point per export."""
    resource = {
        "attributes": [
            {"key": "service.name", "value": {"stringValue": service}},
            {"key": "deployment.environment.name", "value": {"stringValue": environment}},
        ]
    }
    data_points = [
        {"startTimeUnixNano": str(start), "timeUnixNano": str(at), "asDouble": value}
        for start, at, value in points
    ]
    metric = {
        "name": "wizard.usage.cost_usd",
        "sum": {"aggregationTemporality": 2, "isMonotonic": True, "dataPoints": data_points},
    }
    body = {"resourceMetrics": [{"resource": resource, "scopeMetrics": [{"metrics": [metric]}]}]}
    req = urllib.request.Request(
        f"{OTLP}/v1/metrics",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req, timeout=5)


def test_spend_today_adds_up_the_chosen_environments_across_restarts():
    dash = get(f"{GRAFANA}/api/dashboards/uid/gaik-hackathon-live", GRAFANA_AUTH)["dashboard"]
    panel = next(p for p in dash["panels"] if p["title"] == "Spend today")
    # Today so far, in Helsinki time: the panel's own time and the dashboard's time zone.
    assert panel["timeFrom"] == "now/d"
    assert dash["timezone"] == "Europe/Helsinki"
    (target,) = panel["targets"]
    # The value at this moment: a range query's last point lags up to a step behind.
    assert target["instant"] is True

    run = secrets.token_hex(4)
    # Its own service name, so the local wizard views do not show the test's spend.
    service = f"spend-test-{run}"
    now = time.time_ns()
    minute = 60 * 10**9
    first, second = now - 2 * minute, now - minute
    # One pod restarted (its counter starts again), the other kept counting.
    _post_cost(
        service, f"today-a-{run}", [(first, first, 0.0), (first, second, 1.5), (now, now, 0.25)]
    )
    _post_cost(
        service, f"today-b-{run}", [(first, first, 0.0), (first, second, 1.0), (first, now, 2.0)]
    )

    def spend(environment: str, expected: float) -> float:
        expr = target["expr"].replace('service_name="wizard-v2-api"', f'service_name="{service}"')
        assert service in expr
        expr = expr.replace("$environment", environment).replace("$__range", "10m")
        # At the last sample's millisecond (Prometheus keeps milliseconds), so that increase()
        # has nothing to extrapolate.
        params = {"query": expr, "time": f"{now // 10**6 / 1000:.3f}"}
        deadline = time.time() + 30
        while True:
            result = get(f"{PROM}/api/v1/query?" + urllib.parse.urlencode(params))["data"]["result"]
            value = float(result[0]["value"][1]) if result else -1.0
            # Wait until both environments' samples have arrived.
            if value == pytest.approx(expected) or time.time() > deadline:
                return value
            time.sleep(1)

    assert spend(f"today-.-{run}", 3.75) == pytest.approx(3.75)
    assert spend(f"today-b-{run}", 2.0) == pytest.approx(2.0)
