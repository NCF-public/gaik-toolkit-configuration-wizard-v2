# Dashboard and alerting platform

Grafana for dashboards, Prometheus rules plus Alertmanager for alerting. Everything is provisioned from
files in `deploy/compose/`, so a fresh deployment comes up with the same datasources, dashboards and
alerts and nothing is configured by hand.

| Component | Local address | Configuration |
|---|---|---|
| Grafana | http://127.0.0.1:3000 (login required) | `grafana/provisioning/`, `grafana/dashboards/` |
| Prometheus | http://127.0.0.1:9090 | `prometheus/prometheus.yml`, `prometheus/rules/` |
| Alertmanager | http://127.0.0.1:9093 | `alertmanager/alertmanager.yml` |

## Dashboards

| Folder | Dashboard | Source | Shows |
|---|---|---|---|
| Monitoring | Service health | Prometheus | Requests per second, failed request share, p50/p95 latency, error logs, log volume by event class, active alerts, collector throughput and delivery failures. Filter by service. |
| Security (own organisation) | Audit trail | Postgres (read-only role) | Denied and failed events over time, events by name and outcome, latest events with pseudonymised actor and masked address. |

Dashboards are read-only in the UI (`allowUiUpdates: false`); changes go through the JSON files.
Evaluation and configuration comparison views are not part of this platform's content; they are added
by the WP5 instrumentation side on top of the same Grafana and datasources.

## Alerts

| Alert | Severity | Condition (placeholder thresholds) |
|---|---|---|
| HighErrorRatio | warning | More than 5 % of requests fail for 5 min |
| HighLatencyP95 | warning | p95 latency above 2 s for 10 min |
| ErrorLogs | info | A service keeps logging errors for 5 min |
| CollectorDown | critical | Collector not reachable (or never scraped) for 2 min |
| EventDeliveryBacklog | warning | Records queue up because storage does not accept them, for 2 min |
| EventDeliveryFailing | critical | Records dropped after retries ran out |

`CollectorDown` suppresses per-service warnings while it fires. Thresholds become real once the customer
sets service levels. Rule logic is unit-tested with promtool:

```bash
docker run --rm -v "$PWD/deploy/compose/prometheus:/p" -w /p --entrypoint promtool \
  prom/prometheus:v3.2.1 test rules tests/collection-alerts.test.yml
```

The backlog alert exists because the collector retries failed deliveries for up to five minutes before
it counts records as failed; for an audit trail, waiting for actual loss is too late. Verified with a live outage: with the sink
stopped, the alert reached Alertmanager after about 2.5 minutes, and all 31 audit events sent during the
outage were stored once the sink came back.

## Notification channels

Alertmanager routes everything to a single `default` receiver with no integration yet. E-mail, chat or an
incident tool is a customer decision; only `alertmanager.yml` changes.

## Access control (link to WP4)

- Grafana requires login; anonymous access and sign-up are off. The local admin password is a placeholder.
- Grafana login through the WP4 identity provider (OIDC) with the WP4 role model: `identity.yml` overlay,
  see `wp4/grafana-oidc.md`. admin → Admin, other roles → Viewer, no role → refused.
- The audit datasource and dashboard are in a separate "Security" organisation that only the admin role
  joins (as Viewer). Folder permissions are not enough: in Grafana OSS any organisation member can query
  every datasource in that organisation through the API. The organisation is created by
  `grafana/setup/security_org.py`, because file provisioning cannot create organisations.
- The audit datasource uses the read-only `collection_reader` role.
