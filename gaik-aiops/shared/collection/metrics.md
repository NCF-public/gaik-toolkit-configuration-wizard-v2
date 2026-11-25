# Metrics pipeline

Usage, latency and errors for any GAIK service, plus pass-through storage for producer metrics.

```
spans ----> collector: spanmetrics --+
logs  ----> collector: count --------+--> deltatocumulative --> Prometheus (OTLP receiver)
metrics --> collector: otlp ---------+                           recording rules
```

## Where each measure comes from

| Measure | Source | Series |
|---|---|---|
| Request rate | The HTTP server metric, where a service sends it; else server spans | `http_server_request_duration_seconds_count`, else `traces_span_metrics_calls_total` |
| Error rate | The same metric's requests with `error_type`; else server spans with error status | `http_server_request_duration_seconds_count{error_type!=""}`, else `traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}` |
| Latency | The same metric's buckets (seconds); else server span duration | `http_server_request_duration_seconds_bucket`, else `traces_span_metrics_duration_milliseconds_bucket` |
| Log volume per event class | Log records (after privacy processing) | `gaik_log_records_total` |
| Log errors | Log records with severity ERROR or higher | `gaik_log_errors_total` |
| Anything a producer sends as an OTLP metric | Producer | Name translated to Prometheus form (`a.b.c` → `a_b_c`, counters get `_total`) |

Spans do not cover every request: a wizard session whose user did not allow storing
keeps its spans in the pod. A service that sends `http.server.request.duration` (FastAPI
does, when the pod has a metrics endpoint) is therefore judged by that metric, which
names no session; span metrics are the fallback for a service without it
(`prometheus/rules/collection-recording.yml`).

Usage and errors therefore need no new code in producers that already emit traces or logs. Every series
carries `service_name` (and `deployment_environment_name` when set).

## Recording rules

`deploy/compose/prometheus/rules/collection-recording.yml`:

| Rule | Meaning |
|---|---|
| `gaik:requests:rate5m` | Requests per second by service and operation |
| `gaik:request_errors:ratio5m` | Share of failed requests by service |
| `gaik:request_latency_ms:p50_5m`, `:p95_5m` | Request latency percentiles by service |
| `gaik:log_records:rate5m` | Log records per second by service and event class |
| `gaik:log_errors:rate5m` | Error log records per second by service |

When a service is idle the ratio and percentiles are `NaN` (no requests in the window); that is expected.

## Producer metrics (tokens, cost, LLM-specific measures)

The pipeline does not define these. Whatever a producer sends passes through unchanged, including delta
counters, which are converted to cumulative. Names, units, labels and rules for LLM-specific measures
belong to the WP5 instrumentation side; OpenTelemetry GenAI semantic conventions
(e.g. `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`) arrive as
`gen_ai_client_token_usage_*` and `gen_ai_client_operation_duration_*`.

Cost is not part of the conventions. The existing per-call usage record in the toolkit already computes
it, so it can be sent as a producer metric once its name is agreed.

## Notes

- Log-derived counters are only exported when logs arrive, so a service with no error logs has no
  `gaik_log_errors_total` series rather than a zero. Alert rules must use `absent()` / `or vector(0)`
  accordingly (alerting is the next task).
- Retention is 30 days (`--storage.tsdb.retention.time`), a placeholder until the customer decides.
- Prometheus is reachable on `127.0.0.1:9090` locally; it accepts writes only from the collector in the
  compose network design, but its OTLP endpoint has no authentication yet (WP4 hardening item).
