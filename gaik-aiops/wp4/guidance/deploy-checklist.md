# Deployment checklist (draft v1)

Tick every item before real business data is used. Items marked **decision** need a recorded choice by
the SME; the guidance gives a default.

## Identity and access (S1, S2)

- [ ] Users log in through the organisation's IdP with OIDC; no shared or development accounts exist (T1)
- [ ] MFA is enforced by the IdP for all users, at least for `admin` (T1) — **decision**
- [ ] Every role assignment is personal and has an owner; `admin` is held by at least two people
- [ ] The API rejects requests without a valid token for its audience (T7); the test suite passes
- [ ] Whether `approver` is a separate role from `expert` — **decision**

## Secrets (S3)

- [ ] No secrets in images, repositories or plain environment variables (T12)
- [ ] Model provider keys are per deployment, with a spend limit; sandbox jobs use their own key (T17)
- [ ] Rotation interval and procedure recorded and rehearsed once — **decision**

## Network and hardening (S6)

- [ ] Only the web front end is reachable from outside; database, API and collection layer are not
- [ ] Default-deny NetworkPolicies are applied; the egress test passes in the target cluster (T13)
- [ ] Name-based egress control: platform egress firewall or proxy — **decision**
- [ ] Workloads run at Pod Security "restricted"; images pinned by digest and scanned (T23)
- [ ] Sandbox jobs run in their own namespace (T11)

## Data (S5)

- [ ] Volume encryption at rest confirmed with the platform; database connections use TLS (T21)
- [ ] Retention and deletion of inputs and results defined per use case — **decision**
- [ ] Backups defined, encrypted, and a restore tested
- [ ] Model providers used are listed in the provider register with region and DPA (T15) — **decision**

## Audit and logging (S4)

- [ ] Audit events from the minimum event set arrive in the audit store (ADR 0006)
- [ ] Identities are pseudonymised with a vault-held key; client addresses are masked (T18, T20)
- [ ] Audit and log retention periods set — **decision**; scheduled purge runs
- [ ] Who may read the audit log and how re-identification is requested is documented
