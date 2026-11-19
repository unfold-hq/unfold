---
type: explanation
audience: [owner, operator]
owner: unfold
last_verified: 2026-11-19
verified_by: "Read docs/concepts/who-unfold-is-for.md, system ADRs 0005, 0006, 0009, 0059 (rule 4) and 0060, and Ploeg ADR-0184 at the pinned 0.2.0-rc.130 bundle. No code implements the hosted service, so nothing was run. The public GitHub App is the owner's stated direction; no ADR records it yet."
---

# Hosted Unfold for agencies

**Not built.** Hosted Unfold is phase 2 of [Who Unfold is for](../concepts/who-unfold-is-for.md). Everything on this page is proposed. Today the only way to use Unfold is to [run your own installation](self-host.md).

## What an Agency would get

An [Agency](../reference/glossary.md#agency) is a business that builds software for its [Clients](../reference/glossary.md#client), including a freelancer or an in-house team. In hosted Unfold it would get:

* Its own [Tenant](../reference/glossary.md#tenant) on a rented EU cluster, with its own namespaces, network, sandboxed runtime, model budget and per-Run credentials ([ADR-0009](../adr/adr-0009-one-tenant-per-agency.md)).
* A price per Work Item instead of per hour: a Token Charge for every attempt, and a Delivery Fee only on Acceptance, plus a monthly platform fee ([ADR-0006](../adr/adr-0006-the-ticket-is-the-billing-unit.md)).
* The same loop as self-hosted: a small, explained pull request that the Agency's developer reviews and merges. Unfold would never merge or deploy.

## What an Agency would provide

The Agency would still own its forge, its tracker and its repositories. It would connect them; it would not hand the Unfold project an account of its own.

| System | What the Agency would do | Where it is decided |
| --- | --- | --- |
| GitHub | Install the hosted service's public GitHub App on the repositories agents may work on | Not recorded in an ADR yet |
| Forgejo or GitLab | Create a bot user and hand its token over once. Ploeg would store it in its own secret store, and no person would handle it again | [Ploeg ADR-0184](../../apps/ploeg/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md) (proposed) |
| ClickUp | Invite a dedicated member for Unfold and consent to Unfold's ClickUp app as that member | [ADR-0059](../adr/adr-0059-an-organisation-connects-its-forge-and-tracker-from-unfold-and-ploeg-learns-its-repositories-and-boards-at-runtime.md), rule 4 (proposed) |

Ploeg would hold every tracker and forge credential, and the Unfold application none ([ADR-0060](../adr/adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md)).

## What you can do today

1. Read [Who Unfold is for](../concepts/who-unfold-is-for.md) and [Billing AI work to Clients](../concepts/billing-ai-work.md) to see whether the model fits your agency.
2. [Evaluate Unfold](evaluate.md) with the demos, which cost nothing.
3. To use it now, [run your own installation](self-host.md). The hosted service would run the same open-source code, with no feature held back from it.

## How you will know it exists

This page, [Who Unfold is for](../concepts/who-unfold-is-for.md) and the [start page](../index.md) will stop saying "not built".
