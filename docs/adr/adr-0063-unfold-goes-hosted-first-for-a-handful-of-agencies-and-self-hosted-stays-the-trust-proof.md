---
status: accepted
date: 2026-11-27
decision-makers: Ryan Grippeling
---

# Unfold goes hosted first for a handful of agencies; self-hosted stays the trust proof

## Context and Problem Statement

[ADR-0005](adr-0005-unfold-is-offered-to-agencies.md) and [Who Unfold is for](../concepts/who-unfold-is-for.md) put a self-hosted phase first: the owner and the owner's employer run Unfold on their own clusters and pay Unfold nothing, and the hosted agency business is a second phase whose spending, hosting, legal and sales steps start "once the self-hosted phase works and there is money to fund them".

On 2026-11-27 the owner had the value proposition red-teamed. Its findings:

* The only segment likely to pay soon is the one ADR-0005 already names: small Dutch software agencies of 5 to 80 people.
* Those agencies do not run Kubernetes. A self-hosted-first offering asks them to run a cluster, Ploeg and Unfold before they see one pull request, so it sells them nothing. Money to fund the hosted phase would therefore never come from the self-hosted phase, and the condition in ADR-0005 cannot be met.
* Self-hosting still matters to the buyers who need sovereignty and inspection (the public sector, the self-hosting community). For them it is the proof that the claims hold, not the first commercial step.

The same day the owner made two related decisions in Ploeg. [Ploeg ADR-0032](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0032-keep-the-dispatch-plane-and-compete-on-authorized-spend.md), as amended on 2026-11-27, positions Ploeg as the open-source governance plane for coding agents you run yourself: a ticket starts only within its budget and you see what each ticket really cost, the agent process never sees your credentials, and every claim is checked against published evidence. A scope freeze, recorded in [Ploeg's decision records](https://github.com/ploeg-hq/ploeg/tree/development/docs/adrs), holds new scope until one outside design partner runs real tickets.

Which comes first commercially: the self-hosted product or the hosted service?

## Decision Drivers

* The first money comes from a buyer who will pay soon, and that buyer does not run Kubernetes.
* Every claim Unfold and Ploeg make stays checkable by running the open-source code yourself ([ADR-0050](adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md)).
* The scope freeze: no new product surface until one outside design partner runs real tickets.
* Work already decided for hosting (one Tenant per Agency, one identity broker, per-Tenant SCIM, the public GitHub App) is reused, not redone.

## Considered Options

* Hosted first for a handful of agencies; self-hosted stays supported as the trust proof
* Keep self-hosted first, and start the hosted service once self-hosted works and there is money (ADR-0005 as written)
* Self-hosted only, with paid support and setup for agencies that self-host

## Decision Outcome

Chosen option: "**Hosted first for a handful of agencies; self-hosted stays supported as the trust proof**", because it is the only option that reaches the segment likely to pay soon, while the open-source self-hosted release keeps every claim inspectable.

1. **The first commercial step is the hosted service.** It serves a handful of Dutch agencies of 5 to 80 people, design partners first. It does not open to everyone until those agencies run real tickets on it.
2. **Self-hosted stays supported.** The open-source release, the self-hosting guides and the owner's own installations keep working, and no feature is held back from the open-source code (ADR-0005). Self-hosting is the trust and sovereignty proof for the public sector and the self-hosting community, not the first thing Unfold sells.
3. **This replaces ADR-0005's phase condition.** Hosted spending, hosting, legal and sales steps no longer wait for the self-hosted phase to work and fund them. Everything else in ADR-0005 stands, including the first segment, the Editions and the pilot terms.
4. **Pricing starts from what is decided.** The Token Charge, the Delivery Fee in Credits and the Edition's platform fee ([ADR-0006](adr-0006-the-ticket-is-the-billing-unit.md), ADR-0005) are the starting point for the first agencies.
5. **The scope freeze bounds the work.** Until one outside design partner runs real tickets, hosted work is limited to what that partner needs to run them: the Tenant and sign-in work below, and an environment to run it in.
6. **Where hosted Unfold runs is not decided here.** Its desired state lives in the repository of the cluster that runs it, never in this repository.

Not built. No part of the hosted service exists yet; this record changes the order of the work, not the code.

### Consequences

* Good, because the offer matches the buyer: an agency gets pull requests without running a cluster.
* Good, because self-hosting remains a real, supported way to check every claim, which is what the public sector and the self-hosting community ask for.
* Good, because the tenant and identity work already decided is on the hosted path: one Zitadel broker with an organisation per Tenant ([ADR-0058](adr-0058-people-sign-in-through-one-zitadel-broker-with-an-organisation-per-tenant.md), whose spike passed on 2026-11-27), the customer's identity provider pushing SCIM per Tenant ([application ADR 0059](../../apps/unfold/docs/adrs/0059-the-identity-provider-provisions-and-deprovisions-people-through-scim-and-pushed-shared-signals.md), merged on 2026-11-27 and still proposed), one Tenant per Agency ([ADR-0009](adr-0009-one-tenant-per-agency.md)) and the public GitHub App ([ADR-0062](adr-0062-hosted-unfold-reaches-github-through-one-public-app-the-customer-installs-and-other-forges-through-a-bot-account-the-customer-creates.md), proposed).
* Bad, because the project now pays before it earns: an EU production environment beyond the rented cluster of [ADR-0040](adr-0040-unfold-production-runs-on-a-rented-eu-talos-cluster-and-the-homelab-is-staging.md), a GDPR data processing agreement with each agency and with each sub-processor (the model providers, the hosting provider), support for agencies' people, and someone on call when the service is down.
* Bad, because the project holds other people's code and credentials, so a breach of the hosted service reaches customers, not only the owner (ADR-0009, ADR-0062).
* Bad, because it gives up the purity of phase-1-first: the hosted service runs before the self-hosted product has proven itself for its own users, so a defect is found by a paying agency instead of by the owner.
* Bad, because a handful of agencies is a small sample; their needs could pull the product toward one agency, which ADR-0005 forbids ("features made for one agency that others will not use").
* Neutral, because the open-source code, the licence and the self-hosting guides do not change.

### Open questions

Each is the owner's to answer.

* **Legal entity and contracts.** Which entity signs with the agencies, and the terms, the data processing agreement and the pilot agreement of ADR-0005.
* **Which agencies.** A handful, design partners first; who they are is not recorded in this repository.
* **Pricing.** Whether the first agencies pay the ADR-0006 prices, a pilot price, or nothing during the pilot.
* **Where the hosted environment runs.** Which provider and region, and whether it shares the ADR-0040 cluster; its desired state lives in the cluster repository.
* **Support and on-call.** Who answers an agency, in which hours, and who is paged.

### Confirmation

* This record holds while [Who Unfold is for](../concepts/who-unfold-is-for.md) and [Hosted Unfold for agencies](../get-started/agency.md) describe the hosted service as the first commercial step and self-hosting as supported; `mise run docs-check` checks their links to this record.
* **Re-evaluate** when no agency has paid for hosted Runs by 2027-05-27. Then the owner decides again between this record and the two other options.

## Pros and Cons of the Options

### Hosted first for a handful of agencies

* Good, because it reaches the buyer the red-team found likely to pay.
* Good, because a handful of design partners keeps support and on-call small.
* Bad, because it brings costs, legal work and operational duty before any revenue.

### Keep self-hosted first (ADR-0005 as written)

* Good, because nothing is spent on hosting before the product works.
* Bad, because the agencies likely to pay do not run Kubernetes, so the money that would start the hosted phase does not come.

### Self-hosted only, with paid support and setup

* Good, because the project never holds customers' code or credentials.
* Bad, because it sells only to buyers who already run a cluster, which the first segment does not.
* Neutral, because ADR-0005's Enterprise edition already offers this to self-hosters, and it stays.

## More Information

* Amends the phasing of [ADR-0005](adr-0005-unfold-is-offered-to-agencies.md).
* Explained in [Who Unfold is for](../concepts/who-unfold-is-for.md).
* 2026-11-27 — accepted: after a red-team of the value proposition the owner chose hosted first for a handful of agencies, kept self-hosting supported as the trust proof, and set the re-evaluation date of 2027-05-27.
