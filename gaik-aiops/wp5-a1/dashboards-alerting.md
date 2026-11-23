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
| Monitoring | Wizard operations | Prometheus | Solution Wizard API: live agents and sandbox runs against their limits, refusals by code, turn outcomes and length, agent failures by kind, sandbox runs by phase, sessions volume and database size, sessions overdue for removal, deletions, requests for other users' sessions, busiest owners, active alerts. |
| Monitoring | Hackathon live | Prometheus | Event view: active sessions, capacity, refusals, first-reply time, progress (sessions started, requirements and solution approved, successful PoC runs, PoC approved, documented), components in approved solutions. Cost panel waits for the cost metric. |
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
| AIOpsTestAlert | info | Only when fired on purpose with `send-test-alert.sh` (see [Test alert](#test-alert)) |

### Solution Wizard API

From the API's own `wizard_*` metrics (sent over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set on
the api) and its request spans.

| Alert | Severity | Condition (default threshold) |
|---|---|---|
| WizardApiDown | critical | No metrics from the API for 5 min |
| WizardApiRestarted | warning | The process start time changed in the last 15 min |
| WizardApiMemoryHigh | warning | api container above 85 % of its memory limit for 5 min |
| WizardAgentsNearLimit | warning | Live agents above 80 % of `WIZARD_MAX_LIVE_AGENTS` for 2 min |
| WizardSandboxNearLimit | warning | Active runs above 80 % of `WIZARD_MAX_ACTIVE_RUNS` for 5 min |
| WizardCapacityRefusals | warning | Any request refused because agents, the chat rate or the sandbox were full (10 min) |
| WizardTurnStuck | warning | A chat turn running longer than 50 min; its session is locked |
| WizardTurnFailures | warning | More than 20 % of at least 5 chat turns failed in 15 min |
| WizardModelProviderErrors | warning | More than 3 agent failures from rate limits, overload, server errors or timeouts in 10 min |
| WizardSandboxFailures | warning | More than 50 % of at least 3 sandbox runs failed in 30 min |
| WizardSessionsVolumeFilling | warning | Sessions volume above 80 % for 10 min |
| WizardSessionsVolumeFull | critical | Sessions volume above 90 % for 5 min |
| WizardDatabaseLarge | warning | Wizard database above 4 GiB for 30 min |
| WizardSessionsOverdue | warning | Sessions past the retention period still there after an hour: the removal has not run |
| WizardSessionDeleteFailed | warning | A session deletion failed (any reason) |
| WizardOwnershipDenials | warning | More than 10 requests for other users' sessions in 10 min |
| WizardSessionBurst | warning | One owner id created more than 10 sessions in 10 min |
| WizardSessionCreateFailing | warning | Creating a session failed in the last 10 min |
| WizardSessionLimitHits | info | Uploads refused at the session or case size limit |
| WizardSessionDataMismatch | info | Session rows without a folder, or folders without a row, for an hour |
| WizardMalwareScannerDown | critical | The upload malware scanner has not answered for 3 min; uploads are refused |
| WizardUploadsScannerUnavailable | warning | Uploads refused in 10 min because the scanner gave no verdict |
| WizardUnsafeUploadRefused | warning | An upload refused as unsafe (malware, macros, PDF actions) in 15 min |
| WizardMalwareSignaturesStale | warning | Scanner signatures older than 2 days for an hour |
| WizardUploadsNotScanned | warning | Uploads stored without a malware check (`WIZARD_MALWARE_SCANNER` not set) for 10 min |
| WizardRunsUseSharedModelKey | info | Reminder while sandbox runs use the project's shared model key (no spending cap); clears when `WIZARD_POC_RUNNER_SECRET` names another Secret |

### Thresholds

Every adjustable threshold is a constant in `prometheus/rules/thresholds.yml`
(`gaik:threshold:<name>`); the alerts compare against those series. A deployment changes a value
there and reloads Prometheus; the rules themselves stay as they are. Durations (`for:`) and the
minimum volumes in the ratio alerts are in the rules, because they are part of what an alert means.

`CollectorDown` suppresses per-service warnings while it fires. Thresholds become real once the customer
sets service levels. Rule logic is unit-tested with promtool:

```bash
docker run --rm -v "$PWD/deploy/compose/prometheus:/p" -w /p --entrypoint promtool \
  prom/prometheus:v3.2.1 test rules tests/collection-alerts.test.yml tests/wizard-alerts.test.yml \
  tests/rahti-required-environments.test.yml tests/test-alert.test.yml
```

The backlog alert exists because the collector retries failed deliveries for up to five minutes before
it counts records as failed; for an audit trail, waiting for actual loss is too late. Verified with a live outage: with the sink
stopped, the alert reached Alertmanager after about 2.5 minutes, and all 31 audit events sent during the
outage were stored once the sink came back.

## Test alert

`AIOpsTestAlert` (`prometheus/rules/test-alert.yml`) is fired on purpose to see an alert arrive and
clear, without touching the wizard or faking an outage. It fires while the gauge
`gaik.aiops.test_alert`, sent through the collector like any producer metric, is 1. Nothing else
sends that gauge, so it never fires on its own. It is `info`, and Alertmanager's only receiver has no
outside integration, so it pages nobody. `deploy/k8s/stack/overlays/rahti/send-test-alert.sh` sends
the gauge: `fire` sends 1, `clear` sends 0. A test alert that is never cleared clears on its own
5 minutes after the last `fire`.

Locally, with the compose stack up (from `gaik-aiops/`):

```bash
deploy/k8s/stack/overlays/rahti/send-test-alert.sh fire
```

Within about 30 seconds the alert is in Alertmanager (http://127.0.0.1:9093, or
`curl -s 'http://127.0.0.1:9093/api/v2/alerts?filter=alertname="AIOpsTestAlert"'`) and in the
"Active alerts" panel of Service health, Wizard operations and Hackathon live in Grafana, with the
labels `service_name="aiops-test-alert"` and `severity="info"`. Then:

```bash
deploy/k8s/stack/overlays/rahti/send-test-alert.sh clear
```

Within about 30 seconds it leaves Alertmanager's active alerts and the panels (reload the panel, or
wait for its 30-second refresh). `ENVIRONMENT=<name>` adds `deployment_environment_name` to the alert;
clear it with the same `ENVIRONMENT`, since each name is an alert of its own.
`test_test_alert_stack.py` runs the same fire and clear in the stack tests.

On Rahti, the rule and the dashboards must be deployed first. Deploy only what changed: render the
overlay (`oc kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/stack/overlays/rahti`),
create the new hashed `prometheus-rules-…` and `grafana-dashboards-monitoring-…` ConfigMaps from it,
and point `deployment/prometheus` and `deployment/grafana` at them. Do not `oc apply` the whole
overlay: it puts the images' pinned digests back to `:latest`. Then, with access to the
`gaik-aiops` project:

```bash
oc port-forward -n gaik-aiops svc/otel-collector 4318:4318   # second terminal
oc port-forward -n gaik-aiops svc/alertmanager 9093:9093     # third terminal, to see Alertmanager
deploy/k8s/stack/overlays/rahti/send-test-alert.sh fire
```

Look for it in Alertmanager (http://127.0.0.1:9093 through the port-forward) and in the "Active
alerts" panels on https://grafana-gaik-aiops.2.rahtiapp.fi, then send `clear` the same way and
see it leave both. The collector's OTLP Route works too (`OTLP_ENDPOINT=https://otlp-gaik-aiops.2.rahtiapp.fi`
with `OTLP_TOKEN`, see `deploy/k8s/stack/overlays/rahti/README.md`). Leave `ENVIRONMENT` unset there:
a new environment name shows up in the dashboards' Environment picker. The service name `aiops-test-alert` shows up in
Service health's service picker for as long as the dashboard's time range covers the test. The Hackathon live dashboard
shows the alert too, so do not fire it while that dashboard is on screen at an event.

## Notification channels

Alerts are seen in Grafana: the "Active alerts" panels on the Service health, Wizard operations and
Hackathon live dashboards list the firing and pending alerts of Prometheus' rules (through the
Prometheus datasource; the Alertmanager datasource cannot serve rules to that panel type), so a
silence set in Alertmanager does not hide an alert there. Alertmanager routes everything to a single `default`
receiver with no outside integration. That is the agreed channel for now; e-mail, chat or an
incident tool were not part of the delivered requirements and are a later addition, made in
`alertmanager.yml` only.

## Access control (link to WP4)

- Grafana requires login; anonymous access and sign-up are off. The local admin password is a placeholder.
- Grafana login through the WP4 identity provider (OIDC) with the WP4 role model: `identity.yml` overlay,
  see `wp4/grafana-oidc.md`. admin → Admin, other roles → Viewer, no role → refused.
- The audit datasource and dashboard are in a separate "Security" organisation that only the admin role
  joins (as Viewer). Folder permissions are not enough: in Grafana OSS any organisation member can query
  every datasource in that organisation through the API. The organisation is created by
  `grafana/setup/security_org.py`, because file provisioning cannot create organisations.
- The audit datasource uses the read-only `collection_reader` role.

## Logs

The collector receives logs only from applications that send them over OTLP. A shared cloud
project gives no way to collect pods' own output (that needs a node-level agent), so each service
sends its records itself: the Wizard API sends records at `WIZARD_OTEL_LOG_LEVEL` (WARNING unless
set) and above. They pass the collector's privacy step and feed the error-log panel and the
`ErrorLogs` alert. Where logs are stored for search is a separate choice (ADR draft).

