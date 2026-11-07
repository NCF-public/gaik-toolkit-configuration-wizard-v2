# ADR 0007: Hardening and network baseline

- Status: draft
- Date: 2026-10-10
- Work package: WP4 (S6, S5), deployment integration S7

## Context

S6 requires secure defaults, unnecessary services and ports off, and network restrictions. The highest
current threat is unrestricted outbound traffic from workloads that run generated code (T13). The
target platform is Kubernetes / OpenShift; local work uses k3s and Docker Compose.

## Options for egress control

| Option | Open source / standard | Pros | Cons |
|---|---|---|---|
| A. Kubernetes NetworkPolicy, default deny, allow DNS + named in-cluster services + TCP 443 to non-private ranges | Standard | Portable, no extra components | IP-based only: cannot limit to provider domain names |
| B. A + platform egress firewall (e.g. OpenShift EgressFirewall with DNS names) | Platform-specific | Name-based allow list | Not available on every platform |
| C. A + egress HTTP proxy (e.g. Squid or Envoy with an allow list), only the proxy may leave | Yes | Name-based, portable, logs destinations | One more component; clients must use the proxy |
| D. CNI-specific policies (Cilium FQDN policies) | Yes | Name-based, no proxy | Requires a specific CNI |

## Recommendation

**A everywhere as the floor, plus B where the platform offers it, otherwise C** for code-executing jobs.
Namespaces get a default-deny ingress and egress policy and explicit allows per component.

Workload baseline (Pod Security Standards "restricted" level): non-root with arbitrary UID support,
no privilege escalation, all capabilities dropped, read-only root filesystem, seccomp `RuntimeDefault`,
no service account token unless needed, resource limits, pinned image digests. Only the web front end is
exposed; databases, the API and the collection layer have no external route. Container images contain
no secrets and are scanned in CI.

## Consequences

- Each component documents the ports it listens on and the destinations it needs.
- Local tests in k3s check the policies (allowed and denied connections), so they are part of T1.
- Platform features (egress firewall, routes, SCC) are verified in the target environment during the
  contract period.
