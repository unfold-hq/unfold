---
status: proposed
date: 2026-11-27
decision-makers: Ryan Grippeling
review-by: 2027-01-31
---

# The identity provider provisions and deprovisions people through SCIM and pushed Shared Signals

## Context and Problem Statement

The security audit of 2026-10-29 found that removing someone at the identity provider does not remove their access to Unfold. A browser session lasts up to `auth.sessionHours`, an editor credential 30 days, an Agents-window connection token slides with use, and the sign-in tokens Unfold keeps to prove a person to Ploeg go on refreshing. A changed role or group applies only at the next browser sign-in, and nothing provisions or deprovisions anyone.

System ADR-0050 ([pull request #697](https://forgejo.webgrip.dev/webgrip/unfold/pulls/697), accepted by the owner and not yet merged) names SCIM 2.0 as the standard for provisioning and lists its absence as a known violation. How does the identity provider's decision reach Unfold at once, and how does Unfold make it take effect everywhere?

## Decision Drivers

* Removing a person ends every credential they hold within one request, not at an expiry.
* A membership or role change applies to the next request.
* An agency uses Authentik, Okta or Entra ID; one standard implementation serves all of them (system ADR-0050 rule 2).
* Each new route is off until an administrator turns it on.

## Considered Options

* **A SCIM 2.0 service provider, a Shared Signals receiver for pushed SETs, and one revocation function every path calls**
* SCIM only
* Shorter credential lifetimes, and an OIDC check at every request

## Decision Outcome

Chosen option: "**A SCIM 2.0 service provider, a Shared Signals receiver for pushed SETs, and one revocation function every path calls**", because SCIM is the only standard all three identity providers speak for provisioning, and Shared Signals adds session and credential events that SCIM does not carry.

* Unfold serves SCIM 2.0 ([RFC 7643](https://www.rfc-editor.org/rfc/rfc7643.html), [RFC 7644](https://www.rfc-editor.org/rfc/rfc7644.html)) at `/scim/v2` behind the `identity.scim` flag, authenticated by one bearer token from the environment. A Group's display name grants the membership `unfold/<tenant>/<role>` or `unfold/<tenant>/client/<client>` already names at sign-in.
* Unfold receives SETs ([RFC 8417](https://www.rfc-editor.org/rfc/rfc8417.html)) by push ([RFC 8935](https://www.rfc-editor.org/rfc/rfc8935.html)) at `/ssf/events` behind the `identity.shared-signals` flag, verified against each configured transmitter's JWKS, issuer, audience and `jti`, and acts on CAEP 1.0, RISC 1.0 and [RFC 9967](https://www.rfc-editor.org/rfc/rfc9967.html) events. It does not poll ([RFC 8936](https://www.rfc-editor.org/rfc/rfc8936.html)): push needs one route and no cursor that must survive restarts.
* `Revocation` in `src/identity/revocation.ts` is the one way credentials end: sign-out for one sign-in, SCIM and Shared Signals for a whole person.
* An account the identity provider turned off stays off for every sign-in path until the same channel turns it back on.

### Consequences

* Good, because deprovisioning at the identity provider ends Unfold access at once, on every credential type.
* Good, because the same SCIM code serves Authentik, Okta and Entra ID, quirks included.
* Bad, because a SCIM Group the identity provider does not push is a membership Unfold removes at the next Group change; the operator has to push every `unfold/…` group.
* Bad, because a SaaS identity provider must reach Unfold's public URL to push, and Unfold leaves stream creation at the transmitter to the operator.
* Bad, because only Okta and Authentik transmit SETs today, and only `session-revoked` and `credential-change`.

### Confirmation

`test/identity-scim.test.ts` deactivates and deletes a SCIM User and checks that the browser session, editor credential, Agents-window tokens and kept sign-in tokens are gone, that the next sign-in is refused, and that a Group member removed through SCIM loses the Tenant's repositories on the next request. `test/identity-revocation.test.ts` checks every credential type against `Revocation`, and `test/identity-shared-signals.test.ts` checks the SET signature, typ, issuer, audience, age, `jti` replay and an unknown event.

## Pros and Cons of the Options

### SCIM only

* Good, because it is one protocol.
* Bad, because it carries no session revocation or credential change, which Okta and Authentik already send as CAEP events.

### Shorter lifetimes and an OIDC check at every request

* Good, because it needs nothing from the identity provider.
* Bad, because editor credentials and Agents-window tokens have no OIDC token to check, and a check per request ties every request to the identity provider's availability.

## More Information

* Operations: [Provision and deprovision people](../operations/provision-and-deprovision-people.md).
* OpenSpec change: `openspec/changes/scim-and-shared-signals/`.
* Specifications: [OpenID Shared Signals Framework 1.0](https://openid.net/specs/openid-sharedsignals-framework-1_0-final.html), [CAEP 1.0](https://openid.net/specs/openid-caep-1_0-final.html), [RISC 1.0](https://openid.net/specs/openid-risc-1_0-final.html), [RFC 9493](https://www.rfc-editor.org/rfc/rfc9493.html).
* Builds on [ADR 0037](0037-an-editor-signs-in-only-after-its-person-approves-it-and-gets-its-own-credential.md) (editor credentials) and [ADR 0055](0055-unfold-proves-the-person-to-ploeg-with-a-token-exchanged-from-their-sign-in.md) (kept sign-in tokens).

## Amendment 2026-11-27: each Tenant's identity provider pushes SCIM straight to Unfold

The owner decided the identity architecture on 2026-11-27: people sign in through one broker with an organisation per Agency ([system ADR-0058](../../../../docs/adr/adr-0058-people-sign-in-through-one-zitadel-broker-with-an-organisation-per-tenant.md), Zitadel pending a spike), and **the customer's own identity provider, such as Entra ID or Okta, pushes SCIM directly to Unfold**. Provisioning does not depend on the broker: a broker outage or a broker without a SCIM client does not stop an Agency from adding and removing its people.

* **A token per Tenant.** A Tenant administrator issues and rotates the Tenant's own SCIM bearer token at `POST /api/admin/scim/tenants/{tenant}/token`. Unfold shows it once and keeps only its SHA-256 hash; a presented token is compared in constant time against every hash. The URL stays `/scim/v2`: the token decides the Tenant. The installation-wide token `identity.scim.tokenEnv` names works as before, for the installation's own identity provider.
* **Isolation.** A Tenant's token sees, changes and deactivates only the Users and Groups it pushed, and grants memberships only in its own Tenant, never the installation-wide account role. Another Tenant's User or Group is 404 to it, and a Group named `unfold/<other tenant>/…` grants nothing.
* **Group mapping.** A Tenant administrator maps the customer's own group names or externalIds to an Access Role and Client memberships in the Tenant, so customers need not rename their groups. `unfold/<tenant>/…` names keep working.
* **Linking.** A Tenant's SCIM User links to a person by the customer identity provider's user id, carried in the sign-in claim `identity.scim.userIdClaim` names and matched to the User's `externalId`, and otherwise by email. The broker is to add that claim through an Action; that part is proposed and not built. A Tenant's token never creates an account.
* **Deprovisioning.** A Tenant's deactivation or deletion turns the account off and ends every credential, as before, when the person holds no membership of another Tenant. When they do, it removes only that Tenant's memberships, so one Agency's identity provider cannot sign a person out of another Agency.
* **Google Workspace** can push SCIM only through its beta [custom SCIM profiles](https://knowledge.workspace.google.com/admin/users/advanced/automated-user-provisioning-with-custom-scim-profiles), for SAML apps and limited participants. The fallback, Unfold reading the Directory API, is not built.
* **Deprovisioning at the broker** is to reach Unfold through a broker event until the broker transmits Shared Signals itself. Neither is built.

Consequences of the amendment:

* Good, because an Agency's own identity provider provisions its people, independent of the broker.
* Good, because a Tenant's token cannot read or change another Tenant's people.
* Bad, because a person who belongs to no Tenant yet can be linked by email, and so turned off, by any Tenant whose identity provider names that email. The broker's claim, carrying an organisation-scoped user id, is meant to close that.
* Bad, because a membership a Tenant's SCIM grants and one the sign-in's groups grant are merged at sign-in, so a Tenant's removal stands only until a sign-in whose groups name the Tenant again.

Confirmation: `test/identity-scim-tenants.test.ts` checks a token per Tenant shown once and kept as a hash, a wrong and a rotated-out token refused, a cross-Tenant read, change, grant and membership refused, deactivation ending every credential of a person in one Tenant and only that Tenant's memberships of a person in two, mappings by display name and externalId, and linking by the identity provider's user id with email as fallback.

### History

* 2026-10-30: proposed with the implementation.
* 2026-11-27: amended with SCIM per Tenant, pushed by the customer's identity provider independent of the broker; implemented with the amendment. Google Workspace's Directory API fallback and broker-driven deprovisioning are not built.
