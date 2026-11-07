# ADR 0008: Target repository and distribution of the AIOps and security layers

- Status: draft
- Date: 2026-10-28
- Work package: shared (WP4, WP5 V7)

## Context

The work in this workspace has to move to a repository the customer chooses, and the customer decides
how it is published and licensed. Three kinds of code are involved, and they do not have to live in the
same place:

1. **Deployable stack**: collection layer (OTLP collector, sink, storage schema), metrics, dashboards,
   alerting, and the manifests to run them (compose, Kubernetes). Shared by the WP4 audit trail and WP5
   central logging (ADR 0001).
2. **Instrumentation hooks**: code inside toolkit components that emits traces, logs and evaluation
   events. The toolkit library already has an observability module with usage, timing and pricing
   records, which is the natural home for hooks.
3. **Application wiring and hardening**: changes to a specific application, such as the configuration
   wizard (an OTLP endpoint setting, its own security fixes).

The requirements ask for a generic solution, not one built for a single application. The configuration
wizard is the first application to be measured, not the place where the layer lives. The contract
between producers and the stack is OTLP plus the shared event schema, so the stack and the producers can
be versioned separately.

## Options

| Option | Open source / standard | Pros | Cons |
|---|---|---|---|
| A. Own top-level directory in the toolkit repository (stack), hooks in the toolkit library | Yes / OTLP | One place for users; hooks, schema and stack versioned and released together; existing CI and licence apply | Toolkit repository grows an operations part; release cadence shared with the library |
| B. Separate repository for the stack, hooks in the toolkit library | Yes / OTLP | Independent releases; the stack can serve non-toolkit producers; smaller blast radius for infrastructure changes | Schema version has to be pinned across two repositories; a second CI, licence and issue tracker |
| C. Inside an application repository (e.g. the configuration wizard) | Yes / OTLP | Fastest to wire to the first measured application | Ties a generic layer to one application, against the requirement; other applications would depend on it |
| D. Keep everything in a separate repository, hooks included | Yes / OTLP | Fully independent of the toolkit | Hooks outside the library they instrument; every component needs an extra dependency |

## Recommendation

**Option A**, with the stack in its own top-level directory that has no import dependency on library or
application code, and the hooks in the toolkit library's observability module. Applications only get
wiring: an OTLP endpoint setting and enabling the library hooks. Application-specific security fixes
stay in that application's repository.

Option B is a good alternative if the customer wants the stack released or operated separately from the
library. Because the boundary is OTLP and the schema, moving from A to B later is a file move plus a
schema version pin, not a redesign.

Option C is not recommended: it conflicts with the requirement for a generic solution.

The final choice belongs to the customer.

## Consequences

- The event schema gets a version and lives next to the hooks; the stack declares which schema
  versions it accepts.
- The stack needs its own CI job (lint, unit tests, a compose-based integration test) independent of the
  library tests.
- Publishing follows the target repository's licence and rules: English only, no customer material, no
  credentials.
- Code moves from this workspace in small, topic-sized commits (see "Exporting" in the README).
- Open for the customer: target repository and branch policy, licence, who reviews and merges, and the
  deployment project for the stack.
