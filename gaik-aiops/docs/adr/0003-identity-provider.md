# ADR 0003: Identity provider and authentication

- Status: draft
- Date: 2026-10-10
- Work package: WP4 (S1)

## Context

S1 requires authentication against the organisation's existing login system (OAuth2 / OIDC / SSO).
SMEs using the toolkit already have very different identity setups: Microsoft Entra ID, Google
Workspace, a small Keycloak, or nothing at all. A solution should not rely on shared logins (T1), or
on a user id passed from the web front end to the API on trust (T7).

The toolkit must therefore depend on a protocol, not on a product.

## Options

| Option | Open source / standard | Pros | Cons |
|---|---|---|---|
| A. Plain OIDC in the toolkit, any compliant IdP (Entra ID, Google, Keycloak, Authentik, Zitadel) | Standard (OIDC, OAuth2) | Uses the SME's existing accounts and MFA; no identity data held by the toolkit | Role claims differ per IdP; needs a claim mapping |
| B. Keycloak bundled as the toolkit's broker, federating to the organisation's IdP | Yes (Apache 2.0) / OIDC, SAML | One place for role mapping; works for SMEs without an IdP; SAML too | One more stateful service to run and patch |
| C. Hosted identity service (Auth0, Cognito and similar) | No | Little to operate | Commercial lock-in; data outside the SME's control |
| D. Application-local accounts | – | No dependency | Duplicates identity, no SSO, password handling is ours |

## Recommendation

**A as the contract, B as the default deployment.** Applications speak only standard OIDC
(authorization code flow with PKCE for the browser, access token validation with issuer, audience and
expiry checks in the API) and read roles from one configurable claim. The reference deployment ships
Keycloak so an SME without an IdP has one, and so role mapping can be done in one place; an SME with
Entra ID or Google can point the toolkit at it directly or federate through Keycloak. MFA is enforced
by the IdP, not by the toolkit.

The API validates the user's access token itself instead of trusting a forwarded user id (T7); the
shared service token remains only for calls that have no user.

## Consequences

- Development logins are removed from production builds; local development uses the bundled Keycloak
  with test users.
- The role claim name and value mapping are configuration (see ADR 0004).
- Token lifetimes, refresh and logout (front-channel / back-channel) need defaults in the guidance.
- Replacing the IdP means changing issuer, client and claim mapping only.
