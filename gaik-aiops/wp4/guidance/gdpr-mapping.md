# GDPR mapping (draft v1)

How the baseline supports the controller's obligations. The SME is the controller; the toolkit supplies
technical measures and templates, not compliance by itself. Articles refer to Regulation (EU) 2016/679.

| Article | Obligation | Toolkit support | Remains with the SME |
|---|---|---|---|
| 5(1)(c) | Data minimisation | Pseudonymised identities and masked addresses in logs; no content in audit events | Choosing which inputs are processed at all |
| 5(1)(e) | Storage limitation | Retention per event class, enforced purge; deletion of inputs after approval (configurable) | Setting the periods |
| 5(1)(f), 32 | Integrity, confidentiality, security of processing | S1–S6 controls, deployment checklist, baseline tests | Platform choice, operating the controls |
| 5(2) | Accountability | Append-only audit trail; control-to-threat mapping | Keeping records and decisions |
| 25 | Data protection by design and by default | Deny-by-default access, restricted workloads, no development logins in production | Configuration choices that relax defaults |
| 28 | Processors | Model provider register template | DPAs with hosting and model providers |
| 30 | Records of processing | Pre-filled toolkit part of the record (data categories, recipients, retention fields) | Completing and maintaining the record |
| 33–34 | Breach notification | Audit trail and correlation to reconstruct incidents; operating guide incident steps | Notification decisions and timelines |
| 35 | DPIA | DPIA starter with toolkit-side answers | Carrying out the DPIA when required |
| 44–49 | Transfers to third countries | Provider register records region and transfer basis | Choosing providers and regions |

Open for joint development: AI Act transparency and human oversight points relevant to SME use,
sector-specific requirements, and the format the customer prefers for the published guidance.
