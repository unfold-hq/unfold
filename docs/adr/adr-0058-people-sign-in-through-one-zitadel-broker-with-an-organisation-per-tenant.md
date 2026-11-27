---
status: accepted
date: 2026-11-17
decision-makers: Ryan Grippeling
---

# People sign in through one Zitadel broker on the production cluster, with an organisation per Tenant

## Context and Problem Statement

Unfold is RBAC'd, SSO'd and multi-tenant ([ADR-0017](adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md)), with one Tenant per Agency ([ADR-0009](adr-0009-one-tenant-per-agency.md)). An Agency's people should sign in with their own company's Google Workspace or Microsoft Entra ID and land in their own Tenant with the right role, without a password and without a Tenant picker. Their Clients' people, who have no company sign-in Unfold can trust, should still get in with an invitation.

Unfold itself is ready for this. It signs people in through OpenID Connect with discovery, PKCE and a JWKS check (`apps/unfold/src/oidc.ts`). It turns the groups `unfold/<tenant>/<role>` and `unfold/<tenant>/client/<client>` into memberships at sign-in and through SCIM (`apps/unfold/src/tenancy.ts`). It provisions and removes people through SCIM and shared signals ([application ADR 0059](../../apps/unfold/docs/adrs/0059-the-identity-provider-provisions-and-deprovisions-people-through-scim-and-pushed-shared-signals.md)). What is missing is the identity provider in front of it: something that holds one organisation per Agency, links each Agency's own identity provider, routes a person to it by email domain, and puts the Tenant and the role in the token.

None of the identity providers in use can do that ([customer environments](../concepts/customer-environments.md#sign-in-today)). The owner's staging cluster Authentik is reachable only on the LAN and is single-tenant by design. Cloudflare Access counts seats per person, holds at most 50 identity providers by default and gives Unfold no Tenant or role. Signing in with Google Workspace directly serves only the owner's own staff.

Which identity provider does Unfold trust, and where does it run?

## Decision Drivers

* An Agency admin links their own Google Workspace or Entra ID and manages their own people, without asking an Unfold operator.
* A person types only their email address. The broker routes them to their company's sign-in by verified domain.
* Creating a Tenant creates its sign-in through an API, so the `Tenant` operator of [customer environments](../concepts/customer-environments.md#4-one-reconciler-turns-a-tenant-record-into-everything-it-needs) can do it from Git.
* A mistake in one Agency's settings reaches only that Agency.
* Customer sign-in does not depend on the owner's staging cluster ([ADR-0040](adr-0040-unfold-production-runs-on-a-rented-eu-talos-cluster-and-the-homelab-is-staging.md)).
* Self-hosted in the EU, with no per-tenant licence, and with a managed EU fallback if running it ourselves fails.
* Unfold reads the groups it reads today, so Unfold's sign-in code does not change.

## Considered Options

* Zitadel on the production cluster, with an organisation per Tenant
* Authentik moved to the production cluster
* Keycloak 26 on the production cluster, with Organizations
* Google Workspace directly, also for customers

## Decision Outcome

Chosen option: "Zitadel on the production cluster, with an organisation per Tenant". It is the only option built for an organisation per customer whose own admins manage their identity providers and people, and it routes a person to their company's sign-in by verified email domain out of the box.

* **One broker.** Zitadel runs self-hosted on the production cluster, with its own Postgres, and is the only OpenID Connect issuer Unfold trusts in the hosted service. A self-hosted installation keeps any OIDC issuer; this decision is about the hosted service.
* **One organisation per Tenant.** The `Tenant` operator creates the organisation, its three role grants (viewer, member, admin) and an invitation to the first admin through Zitadel's API. A Client's people get a Client role in that same organisation.
* **The Agency's own sign-in.** An Agency admin links their Google Workspace or Entra ID to their organisation and verifies their email domain. From then on anyone with that domain lands in that organisation. Small Agencies and Clients' people sign in with a passkey, or with an emailed link, on an invitation.
* **The token Unfold reads.** A Zitadel Action writes the person's organisation roles into the groups claim as `unfold/<tenant>/<role>` and `unfold/<tenant>/client/<client>`. Unfold's `auth.oidc` points at the broker, with `groupsClaim: groups`.
* **The owner's staff.** The owner's own organisation in the broker links Google Workspace, so staff keep one Google sign-in and the security-key check of the owner's cluster ADR.
* **Staging.** Staging moves to the broker directly, with the owner's organisation as its first Tenant. The interim step of signing in to staging with Google Workspace directly is skipped (decided 2026-11-17). Until the broker runs, the owner's staff sign in to staging through the owner's staging cluster Authentik, as on the owner's own Unfold, from a browser on that cluster's network (decided the same day).
* **Cloudflare Access** stays in front of staging and the operators' consoles only, never in front of customers or previews.

Not implemented yet. The order is in [customer environments](../concepts/customer-environments.md#order).

### Consequences

* Good, because an Agency's people sign in with the account they already have, and nobody at Unfold handles their passwords.
* Good, because creating a Tenant creates its sign-in through one API, so a customer can be made from one `Tenant` file.
* Good, because one Agency's identity-provider settings cannot reach another's.
* Good, because Unfold's sign-in, tenancy and SCIM code stays as it is.
* Bad, because the broker is a new system to run, upgrade and back up, and customer sign-in fails when it is down. It needs at least two replicas, a backed-up database and an alert before the first customer.
* Bad, because Zitadel is AGPL-3.0 since version 3. Running it unmodified and calling its API creates no obligation, per Zitadel's licence FAQ. Modifying Zitadel itself would.
* Bad, because until the broker runs, staging's sign-in depends on the owner's staging cluster and works only from its network.

### Confirmation

Not built yet. Once it is, these hold:

* Staging's Unfold configuration has `auth.oidc.issuer` set to the broker and `auth.localLogin: false`, and a person signs in with their Google account and lands in the owner's Tenant.
* The `Tenant` operator's end-to-end test creates a `Tenant`, sees an organisation with three role grants and an invitation appear in Zitadel, and removes them again when the `Tenant` is deleted.
* A token for a person in two organisations carries both Tenants' groups, and `apps/unfold/src/tenancy.ts` gives that person both memberships and no more.

## Pros and Cons of the Options

### Zitadel on the production cluster, with an organisation per Tenant

* Good, because organisations, per-organisation identity providers, domain discovery and organisation admins are built in ([domain discovery](https://zitadel.com/docs/guides/solution-scenarios/domain-discovery)).
* Good, because organisations, identity providers, domains and role grants are all API.
* Good, because it is one Go binary and Postgres, and Zitadel Cloud in an EU or Swiss region is a managed fallback.
* Bad, because nobody here runs it yet.

### Authentik moved to the production cluster

* Good, because it is known: the access plane in OpenTofu, the Google source, the passkey flow and the end-to-end suite of `unfold-mcp` exist.
* Bad, because real tenancy is an Enterprise feature, alpha, with a licence per tenant ([tenancy](https://docs.goauthentik.io/sys-mgmt/tenancy/)).
* Bad, because applications, sources and policies are global, so one bad policy reaches every customer, and every customer's groups share one namespace.
* Bad, because routing a person to their company's sign-in by domain is a flow we would write.

### Keycloak 26 on the production cluster, with Organizations

* Good, because Organizations with identity-first login by domain exist since version 26, under Apache-2.0.
* Bad, because it is heavier to run, about 1.25 GB per pod by Red Hat's sizing, and has no managed EU fallback of its own.

### Google Workspace directly, also for customers

* Good, because there is nothing to run.
* Bad, because a Google ID token carries no groups, Entra ID customers would need a second path, and Clients without a Workspace could not sign in at all.

## More Information

* Technical story: [Customer environments](../concepts/customer-environments.md), direction 2
* Supported by [ADR-0009](adr-0009-one-tenant-per-agency.md) and [ADR-0017](adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md)
* 2026-11-17 — accepted: the owner chose Zitadel over Authentik moved to the production cluster, and chose to move staging to the broker directly instead of signing in with Google Workspace first; until then staging signs in through the owner's staging cluster Authentik
* 2026-11-27 — the owner kept Zitadel conditional on a spike, and decided that the customer's own identity provider pushes SCIM straight to Unfold with a token per Tenant, so provisioning does not depend on the broker ([application ADR 0059](../../apps/unfold/docs/adrs/0059-the-identity-provider-provisions-and-deprovisions-people-through-scim-and-pushed-shared-signals.md), amended the same day). Re-evaluate Zitadel when the spike fails on any of: creating an organisation through the API, a groups claim for a person in two organisations, or a token exchange to Ploeg's audience that carries `act`; when Zitadel has shipped neither RFC 8707 `resource` nor Client ID Metadata Documents by 2027-02-27; or when another critical advisory hits Login V2. The fallback is Keycloak 26.8 with Organizations.
* 2026-11-27 — the spike passed on Zitadel v4.20.6 with Login V2, so Zitadel stays the broker ([spike dossier](../research/2026-11-27-zitadel-spike.md)). Two constraints carry into the rollout: token lifetime is set per instance, not per application, so a five-minute token for Ploeg means five-minute access tokens for the browser and editors too, with refresh tokens covering longer sessions; and Zitadel refuses outbound calls to private address ranges by default, so the Actions target that writes the groups claim needs a deny-list exception for its one in-cluster range or a public route.
