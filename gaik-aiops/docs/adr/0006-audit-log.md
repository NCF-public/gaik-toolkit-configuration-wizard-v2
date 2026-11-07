# ADR 0006: Security audit log: event set and privacy controls

- Status: draft
- Date: 2026-10-10
- Work package: WP4 (S4), builds on ADR 0001

## Context

S4 requires an audit log of security events with privacy controls. ADR 0001 provides transport, the
append-only store, retention and pseudonymisation at the collector. This ADR decides what is logged,
with which fields, and how identities are protected.

## Minimum event set

| Event | When |
|---|---|
| `auth.login`, `auth.logout`, `auth.login_failed` | Session start and end, failed attempts |
| `authz.denied` | A permission check fails |
| `role.assigned`, `role.removed` | Role changes (if managed by the toolkit) |
| `data.uploaded`, `data.exported`, `data.deleted` | Business data enters, leaves or is removed |
| `result.approved`, `result.rejected` | Human decisions on results |
| `job.started`, `job.finished` | Generated code runs (with run id) |
| `config.changed`, `secret.rotated`, `credential.issued` | Configuration, key and credential changes (vault events: `wp4/secrets/`) |
| `audit.read`, `audit.purged` | Access to and removal from the audit log itself |

Fields follow `shared/collection/schema/envelope.md`: actor, outcome, resource, client address,
trace id. Content, secrets and tokens are never logged.

## Options for identity in the log

| Option | Pros | Cons |
|---|---|---|
| A. Raw e-mail / user id | Readable | Personal data in every row; retention and access become GDPR-heavy |
| B. Salted hash (current v0) | Simple | Anyone with the salt can test guesses; salt in collector config |
| C. Keyed HMAC with a vault-held key; re-identification through the IdP or a separate lookup | Not reversible without the key; key access is itself audited | Key rotation changes pseudonyms (needs a mapping period) |

## Recommendation

**C**, with the client address masked (IPv4 /24, IPv6 /48) as in v0. Re-identification is an admin
action that is itself an audit event. Retention per class is configuration; the guidance proposes
defaults and the SME decides.

## Consequences

- The pseudonymisation step moves from a salt in collector config to an HMAC with a key from the vault
  (ADR 0005); the collector or a small processor needs access to it.
- The OpenTelemetry Collector has no HMAC function. With a vault-held key the collector forwards the raw
  identity and the sink pseudonymises with transit HMAC before storing, failing closed when the vault is
  unavailable (spike: `wp4/secrets/`). This is safe only while the sink is the only logs exporter; with
  more backends, pseudonymisation has to move in front of the fan-out.
- Stored pseudonyms carry the key version (`vault:v1:...`), so rotation is visible and old values can
  still be verified.
- **Update 2026-10-31:** the second backend arrived (MLflow for traces, ADR 0001), so pseudonymisation
  moved in front of the fan-out: the collector hashes with a key read from the vault (KV, rendered to a
  file by an OpenBao agent) for logs and spans alike, and the sink no longer calls transit. One user now
  has one pseudonym in every store. Trade-off: the key leaves the vault into the collector's process
  (file mode 0400, agent volume), instead of staying inside the transit engine; stored pseudonyms are
  plain 64-character hex without a key version, so rotation is not visible in the value.
- The event set is the test checklist for S4 in T1.
- Event names and fields are part of the joint schema agreement and stay marked draft until then.
