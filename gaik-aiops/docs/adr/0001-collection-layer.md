# ADR 0001: Shared collection, storage and correlation layer

- Status: draft
- Date: 2026-10-10
- Work package: shared (WP4 S4, WP5 V1 / V3 / V4)

## Context

The WP4 security audit log and WP5 central logging need the same things: one way for components to send
events, privacy processing before storage, persistent storage with retention, and correlation by trace.
Building this once is a stated goal for both work packages. An application can write structured JSON logs with a
correlation id and a defined audit event set, and it still needs persistent storage, retention and masking
from somewhere.

The customer makes the final technology choices, so the layer has to keep products replaceable.

## Options

| Option | Open source / standard | Pros | Cons |
|---|---|---|---|
| A. OTLP ingress (OpenTelemetry Collector) + Postgres via a small sink | Yes / OTLP | Postgres already part of the toolkit stack; SQL retention and append-only guarantees; few moving parts for an SME | Not a log search UI; sink is our code to maintain |
| B. OTLP ingress + Grafana stack (Loki, Tempo, Prometheus) | Yes / OTLP | Strong search and dashboards; standard WP5 monitoring pattern | Weaker immutability for audit; more services to operate |
| C. OTLP ingress + OpenSearch | Yes / OTLP | Full-text search, mature retention policies | Heavy for SME deployments |
| D. LLM observability platform (e.g. Langfuse) as the store | Yes | Rich LLM traces | Built for LLM calls, not for a security audit trail |

## Recommendation

Make **OTLP the only ingress contract** and keep storage behind the collector, so storage can change
without touching producers. Start with option A for the audit trail and as the baseline store, and add
option B exporters from the same collector for search and dashboards when the WP5 stack is chosen. The
collector is also where privacy processing happens (pseudonymisation, address masking), so no
backend ever receives raw identities.

## Consequences

- Producers depend only on OpenTelemetry, not on a storage product.
- Audit guarantees (append-only, delete only after retention, insert-only writer) live in the database
  and are tested.
- LLM call and evaluation events pass through the same ingress; their stores and views are decided by the
  WP5 instrumentation side and can be added as further collector exporters.
- Open: pseudonymisation key management (WP4 S3), retention periods, and whether the sink is replaced by
  a standard exporter if one fits.

## Update 2026-10-31: traces to MLflow

The customer proposed MLflow as the central store for LLM traces, evaluations and feedback. It is added
as a further collector exporter (OTLP/HTTP, MLflow 3.6 or later, SQL backend in its own database on the
same Postgres), so producers are unchanged.

- Spans now pass the same privacy processing as logs before any exporter: `enduser.id` becomes
  `enduser.pseudo.id`, `client.address` is masked to /24 or /48, and prompt and response content
  (`gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.prompt*`, `gen_ai.completion*`,
  `mlflow.spanInputs`, `mlflow.spanOutputs`) is dropped as a second line of defence behind the
  producer's own default.
- **Pseudonymisation direction:** one keyed hash in the collector, before branching, for every
  destination (MLflow, Postgres, Prometheus), with the key held in the secrets store. OTTL has no HMAC
  function, so the key is used as a secret prefix to SHA-256. Without the key a pseudonym cannot be
  reversed, which is what matters here; the length-extension property of a secret-prefix hash does not
  reveal identities and a pseudonym is not an authentication token. With the OpenBao overlay the
  collector reads the key from the vault (agent-rendered file) and the sink no longer pseudonymises. Rotating the key breaks continuity, so it is
  rotated only after a compromise.
