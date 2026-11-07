# WP4 Security baseline

Target: a reusable, toolkit-level security baseline that an SME can deploy and operate safely.
Wizard V2 is the first concrete test target.

## Requirements

| # | Requirement | Status |
|---|---|---|
| S1 | Authentication against an existing identity provider (OAuth2 / OIDC / SSO) | – |
| S2 | Role-based access control (e.g. admin, expert, viewer) | – |
| S3 | Secrets management with a vault or equivalent: API keys, connection strings, certificates | – |
| S4 | Security event audit log with privacy controls | – |
| S5 | Secure handling and storage of business data | – |
| S6 | Hardening: secure defaults, unnecessary services and ports off, network restrictions | – |
| S7 | Integration into the toolkit deployment environment | contract period |
| O1 | Security and privacy guidance, compliance framework (GDPR, SME use) | – |
| T1 | Baseline security testing of the implemented mechanisms | – |

## Preparatory work (before 19 Oct)

- [x] Threat model generalised to toolkit level (`threat-model.md`)
- [x] ADR drafts: identity provider, role model, vault, audit schema, hardening line (`docs/adr/0003`–`0007`)
- [x] Guidance and compliance framework v1 outline (GDPR mapping, checklists; `guidance/`)
- [x] OIDC spike in compose (Keycloak as an open, replaceable IdP; `deploy/compose/keycloak/`)
- [x] RBAC policy layer spike (`authz/`)
- [x] Secrets management spike: OpenBao, per-consumer policies, vault-held pseudonymisation key (`secrets/`)
- [x] Grafana login and role mapping from the same IdP and role claim (`grafana-oidc.md`)
- [x] Egress NetworkPolicy for sandbox jobs (local k3s, `deploy/k8s/sandbox-egress/`)
