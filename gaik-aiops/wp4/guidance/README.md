# Security and privacy guidance, compliance framework (O1): v1 outline

Status: draft outline, to be developed jointly with the customer. Audience: an SME deploying a GenAI
solution built with the GAIK toolkit, and the person operating it. Not legal advice; not a certification.

## Planned documents

| Document | For whom | Content |
|---|---|---|
| `deploy-checklist.md` | Whoever installs | Go-live checklist: identity, roles, secrets, network, data, logging (below) |
| Operating guide | Operator | Key rotation, user and role changes, retention and purge, backups, incident steps |
| GDPR mapping (`gdpr-mapping.md`) | Controller (the SME) | Which toolkit control supports which obligation, and what remains the SME's job |
| Model provider register | Controller | Per provider: region, retention, training use, DPA, sub-processors |
| DPIA starter | Controller | Questions that decide whether a DPIA is needed and pre-filled toolkit parts |
| Residual risks | Decision makers | What the baseline does not cover (prompt injection, provider-side risks, ...) |

## Structure of each control

Every control in the guidance has the same fields, so the checklist, the tests (T1) and the GDPR mapping
point at the same thing:

| Field | Example |
|---|---|
| Id | `C-NET-1` |
| Control | Code-executing jobs can reach only DNS, the API and public HTTPS |
| Threat | T13 |
| Requirement | S6 |
| How the toolkit provides it | `deploy/k8s/sandbox-egress/` |
| How to verify | `test.sh` passes in the target cluster |
| SME decision needed | Egress firewall or proxy for name-based allow list |
