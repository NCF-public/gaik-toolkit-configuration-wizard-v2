# WP5 AI Ops: monitoring and observability foundation (Expert 1)

Scope: centralised logging, metrics, dashboards, alerts, and connecting systems to the monitoring
infrastructure. Instrumentation, evaluation workflows, configuration version tracking and variant
comparison are outside this folder (see the scope boundary in the top-level README).

## Requirements covered

| # | Requirement | Our part |
|---|---|---|
| V1 | Structured logs, traces and evaluation data | Collection and pipeline |
| V3 | Metadata storage and retrieval | Storage layer |
| V4 | Usage, latency, error rate and cost monitoring | All |
| V7 | Integration interfaces to GAIK systems | Infrastructure (schema is joint) |

## Preparatory work (before 19 Oct)

- [x] Collection, storage and correlation layer v0 (`shared/collection/`, same layer as the WP4 audit log)
- [x] Event schema draft: transport, storage, retention fields only (marked draft)
- [x] Central logging in compose (collector, sink, Postgres, Prometheus, Grafana, Alertmanager)
- [x] Metrics pipeline: usage, latency, errors derived in the collector, producer metrics pass through (`shared/collection/metrics.md`)
- [x] Dashboard and alerting platform (`dashboards-alerting.md`)
- [ ] ADR draft: reference stack options (e.g. OpenTelemetry + Grafana stack, Langfuse)

## Period 1 (19 Oct – 15 Nov)

- [x] MLflow behind the collector in compose: traces pseudonymised, address-masked and without content
  before export (`deploy/compose/mlflow/`, ADR 0001 update, `test_mlflow_stack.py`)
- [x] Producer quickstart and an example producer (`quickstart-producers.md`, `examples/send_llm_call.py`)
- [x] CI: collector config, alert rule tests, unit tests and the stack tests on a fresh stack (`.github/workflows/ci.yml`)
- [ ] Event schema v1 with Expert 2 (`llm_call`, `evaluation`, `feedback`, run id, configuration version)
- [x] Collector key from the secrets store for both logs and spans (one pseudonym everywhere)
- [x] Per-application MLflow experiments (routing on `service.name`, `mlflow/setup_experiments.py`)
- [x] Kubernetes manifests for the stack and a local k3s run with arbitrary UIDs (`deploy/k8s/stack/`)
- [ ] Rahti overlay and deployment (needs the customer's approval and a namespace)
