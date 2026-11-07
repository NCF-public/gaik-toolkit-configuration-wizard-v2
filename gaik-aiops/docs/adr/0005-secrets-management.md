# ADR 0005: Secrets management

- Status: draft
- Date: 2026-10-10
- Work package: WP4 (S3), configuration layer shared with WP5

## Context

S3 requires a vault or equivalent for API keys, connection strings and certificates. Each consumer
should get only its own secrets: provider keys per deployment, delivered so that an agent cannot read
them from its environment, and kept apart from workloads that can start pods (T9, T11, T12, T17). The collection layer needs a
pseudonymisation key (T20).

## Options

| Option | Open source / standard | Pros | Cons |
|---|---|---|---|
| A. OpenBao (open Vault fork) with the Kubernetes auth method | Yes (MPL 2.0) / Vault API | Dynamic database credentials, leases, audit device, transit (HMAC) for pseudonymisation | A stateful, security-critical service to run, unseal and back up |
| B. External Secrets Operator syncing from any backend into Kubernetes Secrets | Yes | Backend-neutral (OpenBao, cloud KMS, ...); apps read plain mounted files | Secrets still land in etcd; needs a backend anyway |
| C. Sealed Secrets / SOPS in Git | Yes | Simple GitOps, no running vault | No rotation, leases or access audit; static keys |
| D. Cloud provider secret manager | No | Managed | Ties the toolkit to one cloud |

## Recommendation

**Applications read secrets from mounted files only; the backend is pluggable.** For the reference
deployment use **OpenBao** as the backend, delivered either by its agent / CSI provider or through
External Secrets Operator (B in front of A), so an SME with a cloud secret manager can swap the backend.
SOPS (C) is the documented minimum for a single-machine compose deployment.

Rules regardless of backend: no secrets in images or plain environment variables; one provider key per
deployment and a separate, spend-limited key for sandbox jobs; the agent's process gets only the keys it
uses; rotation procedure and interval documented and tested; the pseudonymisation key is held by the
vault and reaches the collector only as a file rendered by its agent, never through config or the
environment (ADR 0001, 0006 update 2026-10-31).

## Consequences

- Apps need to read `*_FILE` paths and reload on change (or restart on rotation).
- The vault's own audit device feeds the audit log through the collection layer.
- The spike (`wp4/secrets/`) shows the agent pattern, per-consumer policies, the vault-held
  pseudonymisation key delivered to the collector, and the audit device with the local compose stack.
- Running OpenBao adds an unseal / backup procedure to the operating guide.
