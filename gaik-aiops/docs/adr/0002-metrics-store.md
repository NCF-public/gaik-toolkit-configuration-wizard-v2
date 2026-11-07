# ADR 0002: Metrics store and derived service metrics

- Status: draft
- Date: 2026-10-10
- Work package: WP5 (V4), builds on ADR 0001

## Context

WP5 requires monitoring of usage, latency, error rates and cost. Producers should not need a new client
library for this, the store must work with the dashboard and alerting platform chosen later, and the
customer makes the final product choice. ADR 0001 already makes OTLP through the OpenTelemetry
Collector the only ingress.

## Options

| Option | Open source / standard | Pros | Cons |
|---|---|---|---|
| A. Prometheus with its native OTLP receiver | Yes / OTLP, PromQL | De facto standard; works with Grafana and Alertmanager; single binary; no extra exporter | Single-node; long-term storage needs an add-on |
| B. Prometheus-compatible scalable store (e.g. Mimir, VictoriaMetrics) | Yes / PromQL | Same queries as A, scales out, long retention | More to operate than an SME needs at first |
| C. Postgres (same store as the audit log) | Yes / SQL | One database | Not a time-series engine; no PromQL ecosystem |

Derived metrics: compute request rate, errors and duration from spans (`spanmetrics` connector) and log
volume and error counts from logs (`count` connector) in the collector, instead of asking each
producer to emit them.

## Recommendation

Option A for the baseline. Because queries are PromQL and ingress is OTLP, moving to option B later
does not change producers, rules or dashboards. Derive generic service health in the collector.
Leave LLM-specific metric definitions to the WP5 instrumentation side; the pipeline passes them through.

## Consequences

- Any service that emits traces or logs gets request rate, error ratio, latency percentiles and log
  error rate without code changes.
- Delta temporality from producers is converted in the collector (`deltatocumulative`).
- Open: retention period, authentication on the store's write endpoint (WP4), and long-term storage
  if retention beyond weeks is required.
