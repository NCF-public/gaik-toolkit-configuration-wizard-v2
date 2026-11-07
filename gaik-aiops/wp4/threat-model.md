# Threat model: GAIK-based GenAI solution (toolkit level)

- Status: draft for review at the start of the contract period
- Method: STRIDE per trust boundary, severity before and after real business data is in use
- Basis: a generic deployment of a GAIK toolkit solution. The first reference application (a solution
  wizard with an agent and a sandbox runner) was used to check that the threats are real; its specifics are
  not repeated here.

The baseline (S1–S6) must be reusable across solutions built with the toolkit, so this model describes
component roles, not one application. A solution that lacks a component (for example no sandbox) simply
drops the threats of that boundary.

## 1. Reference architecture

```
[Browser: designer / operator / approver / viewer]
      | HTTPS                                                    B1 internet -> web
[Web front end]  session cookie
      | HTTP (service credential + forwarded user identity)       B2 web -> API
[API + agent / LLM orchestration] ---- database (sessions, results, configuration)
      |                            \--- file storage (inputs, artefacts, generated code)
      | creates jobs                                              B3 API -> sandbox
[Sandbox job: runs generated code against inputs]
      | outbound network                                          B4 sandbox -> outside
[API, sandbox] -> model providers (hosted LLM, speech, OCR)       B5 -> model providers
[All components] -> collection layer (audit log, central logs)    B6 -> collection layer
[Operators] -> cluster / platform API                             B7 platform administration
```

## 2. Assets

| # | Asset | Why it matters |
|---|---|---|
| A1 | Business inputs: documents, recordings, spreadsheets | Personal data and trade secrets of the SME and its customers |
| A2 | Results: transcripts, extracted data, reports, approval decisions | Same as A1, plus decisions others rely on |
| A3 | Conversations and solution descriptions | Describe the SME's processes |
| A4 | Secrets: model provider keys, service credentials, cookie / session keys, database credentials, pseudonymisation key | Give access to everything else and incur cost |
| A5 | Generated code and runner images | Executable code that nobody reviews before it runs |
| A6 | Audit trail | Evidence for accountability (GDPR Art. 5(2)) and incident handling |
| A7 | Availability of the solution | SMEs depend on a single small deployment |

## 3. Threats by trust boundary

Severity: H = high, M = medium, L = low. "Now" = synthetic data, "Real data" = production use by an SME.
"Req" is the WP4 requirement that owns the control.

### B1 Browser -> web

| # | STRIDE | Threat | Baseline control | Severity now / real data | Req |
|---|---|---|---|---|---|
| T1 | S | Shared or development logins; no personal identity, no MFA | OIDC login against the organisation's IdP; MFA enforced by the IdP; development login impossible in production builds | M / H | S1 |
| T2 | S | Session cookie forged or replayed | Signed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie with short lifetime; key from the vault; startup fails without a key | L / M | S1, S3 |
| T3 | T | XSS and content injection via uploaded files or reflected parameters | Downloads as attachments with `nosniff`; strict CSP without `unsafe-eval`; no reflected free text on login pages | M / M | S6 |
| T4 | D | Oversized or malformed uploads and request bodies | Size and count limits per file, case and user; content length required; schema validation | L / M | S5, S6 |
| T5 | I | Reading another user's or tenant's data | Ownership check plus role check on every API route (deny by default) | M / H | S2 |
| T6 | R | Who uploaded, approved or exported something cannot be shown | Audit events for login, upload, approval, export, role change, with actor, time and client address; approver role from the token, not from the UI | M / H | S4 |

### B2 Web -> API

| # | STRIDE | Threat | Baseline control | Severity | Req |
|---|---|---|---|---|---|
| T7 | S | API called directly, bypassing the web front end, with a shared service token that can act as any user | API validates the user's access token (audience, issuer, expiry) instead of trusting a forwarded user id; service token only for service-to-service calls without a user | M / H | S1, S2 |
| T8 | S | Other workloads in the same namespace reach the API | Ingress NetworkPolicy: API accepts traffic only from the web front end and the ingress controller | M / H | S6 |
| T9 | E | The agent runs with broad tool permissions in the API process and can read its environment | Agent gets its own minimal environment without provider keys it does not need; tools limited to the session directory; prompt-injection treated as expected input | M / H | S3, S6 |

### B3 API -> sandbox

| # | STRIDE | Threat | Baseline control | Severity | Req |
|---|---|---|---|---|---|
| T10 | E | Generated code escapes the container | Non-root, no capabilities, no privilege escalation, read-only root, `emptyDir` only, no service account token, resource limits, deadline, TTL | M / H | S6 |
| T11 | E | Permission to create pods equals permission to read every secret in the namespace | Sandbox jobs in their own namespace; the API's role there allows jobs only; no secrets mounted except a dedicated sandbox key | M / H | S3, S6 |
| T12 | I | Job definitions and pod logs show tokens and results to everyone in the namespace | Credentials as mounted files, not env vars; results read from storage, not logs; short log TTL | M / H | S3, S4 |

### B4 Sandbox -> outside

| # | STRIDE | Threat | Baseline control | Severity | Req |
|---|---|---|---|---|---|
| T13 | I / D | Exfiltration of inputs, abuse for mining or scanning, access to other services' databases | Default-deny egress NetworkPolicy: DNS, the API and HTTPS to the internet only; cluster-internal and private ranges denied. Name-based allow lists need a platform egress firewall or an egress proxy | **H / H** | S6 |
| T14 | T | Generated code forges a result marker by echoing input text | Result markers carry a per-run id that the code cannot learn from the input | L / L | S5 |

### B5 Model providers

| # | STRIDE | Threat | Baseline control | Severity | Req |
|---|---|---|---|---|---|
| T15 | I | Business data sent to a model provider without a data processing agreement, region decision or retention terms | Provider register in the guidance (region, retention, training use, DPA); per-solution decision recorded by the SME | M / H | O1, S5 |
| T16 | T | Prompt injection in input documents changes results or instructions | Human approval before results are used; injection noted as a residual risk in the guidance | M / M | O1 |
| T17 | D / R | One shared provider key for all deployments: no cost limit, no attribution, broad blast radius on leak | One key per deployment and per sandbox, with spend limits; rotation procedure | M / H | S3 |

### B6 Collection layer

| # | STRIDE | Threat | Baseline control | Severity | Req |
|---|---|---|---|---|---|
| T18 | I | Personal data in logs without a retention decision (e-mail on every request line) | Pseudonymised identity and masked client address at the collector; retention per event class; secrets and content never logged | M / H | S4 |
| T19 | T / R | Audit events altered or deleted | Append-only store, insert-only writer role, delete only after retention, tested | L / H | S4 |
| T20 | I | Pseudonymisation reversible by anyone who knows the salt | Keyed hash with a random vault-held key, delivered to the collector as a file by its agent and readable only by the collector role; one pseudonym for every store; rotation only after a compromise, documented as changing pseudonyms | M / M | S3, S4 |

### B7 Platform administration and data at rest

| # | STRIDE | Threat | Baseline control | Severity | Req |
|---|---|---|---|---|---|
| T21 | I | Database and file storage unencrypted, shared with other projects, no backup or deletion policy | Platform volume encryption verified; TLS to the database; per-solution namespace; deletion of inputs after approval when the use case requires it; documented backups | M / H | S5 |
| T22 | E | Broad namespace access for many people (everyone can read pod environments and logs) | Least-privilege namespace roles; secrets only via the vault; separate namespaces for demo, test and production | M / H | S2, S6 |
| T23 | T | Unpinned or unscanned images and dependencies | Pinned versions and digests, image scanning in CI, no secrets in images | M / M | S6, T1 |

## 4. Highest priorities for the baseline

1. **T13** egress restriction for code-executing workloads (only "high" today).
2. **T1, T7, T5** personal identity end to end and role checks on the API.
3. **T11, T17, T9** secrets out of environment variables, per-deployment keys, sandbox isolation.
4. **T6, T18, T20** audit log with privacy controls (collection layer exists, keyed pseudonymisation open).
5. **T21** data at rest and deletion policy.

## 5. Out of scope

Platform-internal security of the hosting provider and the model providers, toolkit library code
(upstream), platform-level DoS, penetration testing beyond the baseline (not part of WP4).

## 6. Open questions for the customer

- Identity provider and MFA requirement.
- Is admin / expert / viewer enough, or is a separate approver role needed?
- Retention periods for audit and operational logs; e-mail or pseudonym in logs.
- Is an egress firewall available on the target platform, or is an egress proxy acceptable?
- Separate namespaces (or projects) for sandbox jobs, demo and production.
