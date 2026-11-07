# ADR 0004: Role model and authorisation policy layer

- Status: draft
- Date: 2026-10-10
- Work package: WP4 (S2), used by WP5 dashboards

## Context

S2 names admin, expert and viewer as example roles. The reference application has no roles: access is
limited only by session ownership, and an approver's role is chosen by the user in the UI (T5, T6).
The WP5 dashboards and alerting are to use the same role model.

## Proposed roles

| Role | Can | Cannot |
|---|---|---|
| `viewer` | Read solutions, results and dashboards they are given access to | Change anything, upload, run, approve |
| `expert` | Everything `viewer` can; create and edit solutions, upload inputs, run jobs | Approve results, manage users or configuration |
| `approver` (optional) | Approve or reject results | Edit what they approve (separation of duties) |
| `admin` | Manage configuration, role assignments, retention; read the audit log | Bypass audit; read secrets in clear |

Roles are assigned in the IdP and arrive as a claim. Ownership still applies on top of roles: an
expert edits their own solutions unless shared.

## Options for the policy layer

| Option | Open source / standard | Pros | Cons |
|---|---|---|---|
| A. In-process policy table: permission names per role, checked by one function / middleware | Yes | Simple, testable, no extra service | Policy lives in code; each language needs its own small helper |
| B. Policy engine (Open Policy Agent / Rego, Cedar) as a sidecar or library | Yes | Policy as data, auditable, same engine across services | Extra component and language for an SME to learn |
| C. Authorisation in the IdP (Keycloak authorization services, UMA) | Yes | Central | Ties the toolkit to one IdP product |

## Recommendation

**A now, designed so it can move to B.** Define permissions (`solution.read`, `solution.write`,
`job.run`, `result.approve`, `audit.read`, `config.manage`, ...) and a role-to-permission table that is
configuration, not code. Every API route declares the permission it needs; routes without a
declaration are denied. Decisions are written to the audit log on denial. Whether `approver` is a
separate role is a customer decision.

## Consequences

- One permission table is the review artefact for S2 and the basis for the T1 tests.
- Dashboards (WP5) use the same claim: admin → Grafana Admin, other roles → Viewer, and only admin joins
  a separate Grafana organisation holding the audit log, because Grafana OSS cannot restrict queries per
  datasource (`wp4/grafana-oidc.md`).
- A later move to OPA keeps the permission names; only the evaluation changes.
