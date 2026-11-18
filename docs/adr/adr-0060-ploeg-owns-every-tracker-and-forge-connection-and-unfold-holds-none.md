---
status: accepted
date: 2026-11-18
decision-makers: Ryan Grippeling
---

# Ploeg owns every tracker and forge connection, and Unfold holds none

## Context and Problem Statement

Today a tracker or a forge has two owners. [Application ADR-0063](../../apps/unfold/docs/adrs/0063-unfold-reaches-ploeg-and-trackers-through-ports-with-interchangeable-adapters.md) split tracker work by job on 2026-10-31: Unfold's adapters browse, read, hand off, file issues and link people's accounts; Ploeg's adapters take intake and write back. Each side therefore declares the same tracker, keeps its own credential for it and checks it in its own way:

* Unfold keeps a sealed ClickUp service-account token for its Tasks page and hand-off ([application ADR-0064](../../apps/unfold/docs/adrs/0064-people-add-tracker-connections-from-the-screen-and-unfold-keeps-them-with-an-encrypted-service-account-token.md)), reads GitHub as a GitHub App from its own key ([github-app.ts](../../apps/unfold/src/task-providers/github-app.ts)), stores people's own linked forge and tracker tokens ([application ADR-0016](../../apps/unfold/docs/adrs/0016-sign-in-and-link-your-own-accounts.md)), and files Report a problem issues into the Tenant's tracker with a token of its own ([ADR-0024](adr-0024-bug-reports-are-filed-by-unfold-into-the-tenants-own-tracker.md)).
* Ploeg keeps its own tracker and forge credentials for intake, write-back, per-Run forge credentials ([Ploeg ADR-0192](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md)), CI and pull request events, and has proposed a secret store it writes itself ([Ploeg ADR-0184](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md)) and connection flows that a consumer only relays ([Ploeg ADR-0195](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0195-a-proven-operator-makes-and-manages-a-tracker-or-forge-connection-through-a-flow-ploeg-starts-and-the-consumer-only-relays-codes.md)).

Setting up the GitHub App by hand on 2026-11-17 and 2026-11-18, the owner had to work out which of the two applications needed which key, which webhook and which declaration, and the self-serve onboarding plan ([ADR-0059](adr-0059-an-organisation-connects-its-forge-and-tracker-from-unfold-and-ploeg-learns-its-repositories-and-boards-at-runtime.md)) still carried named exceptions where Unfold kept a copy. Who owns the connection to an outside system, and what does the other application do instead?

## Decision Drivers

* One owner per outside system: one declaration, one credential, one place where a connection is checked, repaired and revoked.
* Ploeg is usable without Unfold ([ADR-0050](adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md) rule 8: Ploeg knows no consumer).
* Ploeg already needs every connection for its own work: intake, write-back, per-Run forge credentials, CI and pull request events.
* Unfold faces the internet; the fewer outside credentials it holds, the less a compromised Unfold reaches ([ADR-0009](adr-0009-one-tenant-per-agency.md)).
* Unfold stays the place where people connect, follow, review and budget work ([ADR-0002](adr-0002-ploeg-is-the-only-engine.md)).

## Considered Options

* A. Ploeg owns every tracker and forge connection; Unfold holds none and asks Ploeg
* B. Ploeg only schedules agents; Unfold owns every connection
* C. Split by job, as application ADR-0063 decided on 2026-10-31

## Decision Outcome

Chosen option: "**A. Ploeg owns every tracker and forge connection; Unfold holds none and asks Ploeg**", because it is the only option with one owner per outside system that also keeps Ploeg usable on its own.

1. **One owner per outside system.** Ploeg owns every tracker and forge connection: the credentials, in its secret store (Ploeg ADR-0184); the OAuth, App manifest, installation and pasted-token flows (Ploeg ADR-0195); webhooks; intake; write-back; per-Run forge credentials (Ploeg ADR-0192); and CI and pull request events.
2. **Unfold holds no credential for the trackers and forges where the work lives.** This covers every tracker or forge connection that work arrives from, is routed through or is delivered to. Unfold's own product integrations are not work connections and stay Unfold's, with credentials of their own that Ploeg never learns about: Report a problem filing into the place a Tenant chose for feedback about Unfold ([ADR-0024](adr-0024-bug-reports-are-filed-by-unfold-into-the-tenants-own-tracker.md), [ADR-0038](adr-0038-report-a-problem-becomes-its-own-component-that-any-application-embeds.md)), notifications, billing exports and error tracking. For work connections, Unfold's only outside credential is sign-in (OpenID Connect, [ADR-0058](adr-0058-people-sign-in-through-one-zitadel-broker-with-an-organisation-per-tenant.md)). Its credential to Ploeg itself, the Operator Consumer token and the person's exchanged token, is not an outside system's credential.
3. **Unfold is where people connect, follow, review and budget.** Every "Connect GitHub" and "Connect ClickUp" action in Unfold is a call to Ploeg's connection API: Unfold starts the flow, sends the person to the vendor and relays the code, the installation id or the pasted token to Ploeg, keeping nothing (Ploeg ADR-0195 section 3).
4. **Tracker reads go through Ploeg.** Showing a connection's Scopes (ClickUp Lists, Vikunja projects, boards) and their items in Unfold reads through Ploeg. Ploeg does not serve such a read yet; it is a new upstream ask, in Ploeg's words: *an operator consumer lists the Scopes a tracker connection can see and the items in one Scope, page by page, for display, with the same Team and Tenant scoping as every operator read*. Ploeg ADR-0195's probe returns only a count and the first 50 Scopes, which is a check, not a read.
5. **Hand-off goes through Ploeg too.** Handing a task over from Unfold ([application ADR-0025](../../apps/unfold/docs/adrs/0025-hand-tracker-tasks-to-ploeg-by-assignment.md)) assigns the item to a connection's hand-over agent (Ploeg ADR-0195 section 9) with a note. That is a tracker write, so by rule 1 it is a Ploeg operator call on behalf of the proven person, and it joins the upstream ask of rule 4 as one action: *assign an item in a bound Scope to a hand-over agent, with a note*. Until Ploeg serves it, Unfold refuses it with the reason ([ADR-0044](adr-0044-unfold-refuses-a-ploeg-that-does-not-serve-the-contract-majors-it-requires.md)) on an installation without a legacy adapter; a person can always assign the task to the hand-over agent in the tracker itself. Report a problem is not work and stays Unfold's own integration under rule 2.
6. **No personal tracker or forge links in v1.** People do not link their own tracker or forge accounts. Everyone who reaches the Tenant sees its connected Scopes through Ploeg, under the Tenant and Client rules of [ADR-0017](adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md). Revisit when Client users start using Unfold (ADR-0017's Client scoping), because a Client user may then need to see only what their own tracker account sees.
7. **Unfold's direct tracker and forge code is legacy.** The tracker adapters in [task-providers](../../apps/unfold/src/task-providers/) and the account links in [link-providers](../../apps/unfold/src/link-providers/) keep serving an installation whose pinned Ploeg does not serve the reads of rule 4, and are removed once it does. A new tracker is added to Ploeg, not to Unfold. Application ADR-0063's Tracker port stays as Unfold's own interface; its live adapter reads through Ploeg.
8. **The deterministic demo keeps working from fixtures.** The demo answers Scope and item reads from its fixtures and says it is a demo; it holds no credential and never invents a model call or spend.

### What changes in existing records

* [Application ADR-0064](../../apps/unfold/docs/adrs/0064-people-add-tracker-connections-from-the-screen-and-unfold-keeps-them-with-an-encrypted-service-account-token.md) is amended: the sealed ClickUp service-account token in Unfold goes away. It was already scheduled for removal in slice S10 of `self-serve-onboarding`; that is now the direction, not hardening. Saving a connection from the screen, the configuration winning, Tenant Admin only and the audit records stand; the token is relayed to Ploeg instead of kept.
* [Application ADR-0016](../../apps/unfold/docs/adrs/0016-sign-in-and-link-your-own-accounts.md) is amended: its sign-in half stands; its personal forge and tracker links are superseded by rule 6.
* [Application ADR-0063](../../apps/unfold/docs/adrs/0063-unfold-reaches-ploeg-and-trackers-through-ports-with-interchangeable-adapters.md) is amended: decision 4 (split by job) and its ownership table are superseded by rules 1, 4 and 5. Every other part of that record stands.
* [ADR-0059](adr-0059-an-organisation-connects-its-forge-and-tracker-from-unfold-and-ploeg-learns-its-repositories-and-boards-at-runtime.md) is amended: its named self-hosted exceptions, the sealed ClickUp copy and the shared GitHub App key, are withdrawn. The OpenSpec change [self-serve-onboarding](../../openspec/changes/self-serve-onboarding/design.md) follows.

### Consequences

* Good, because each outside system has one declaration, one credential and one place that checks it; the question "which application needs this key" no longer exists.
* Good, because a compromised Unfold server holds no tracker or forge credential.
* Good, because Ploeg stays usable without Unfold, and every new ask to Ploeg is a generic operator contract.
* Bad, because Unfold's Tasks page and hand-off depend on Ploeg contracts that do not exist yet (rules 4 and 5); until a Ploeg release serves them, an installation keeps Unfold's legacy adapters or loses those screens.
* Bad, because every tracker read in Unfold now passes through Ploeg, which adds a hop and puts the vendor's rate limit behind Ploeg's.
* Bad, because without personal links a person sees what the Tenant's connection sees, not what their own tracker account sees; acceptable while only the Agency's people use Unfold.
* Bad, because Unfold's trusted publisher still pushes and opens pull requests with a forge token of its own ([application ADR-0040](../../apps/unfold/docs/adrs/0040-accept-opens-a-pull-request-through-the-trusted-publisher-in-the-unfold-control-service.md)). Publishing is delivery of work, so by rule 2 that token goes too: publishing an approved candidate becomes a Ploeg operator action next to the merge Ploeg already performs for a proven person ([Ploeg ADR-0188](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0188-ploeg-merges-a-work-items-pull-request-at-a-named-head-for-a-proven-person-with-a-merge-identity-no-run-holds.md)). Until a Ploeg release serves that action, the publisher keeps its token and keeps working; then `delivery.publisher` and Unfold's delivery-publisher adapters are removed. The delivery ledger, attestations and acceptance records stay in Unfold.

### Confirmation

Not built yet. Once it is, these hold:

* An Unfold test against a fake Ploeg walks Connect GitHub and Connect ClickUp and asserts that no response, log line, action record, product event or database row holds an App key, a manifest code, an installation token or a tracker token, and that Unfold's store has no sealed tracker or forge credential (`integration_accounts` carries the Ploeg connection id only).
* An Unfold test that with a Ploeg serving the Scope read, the Tasks page and the List picker send no request to a tracker host.
* `grep -rln "tokenEnv\|privateKeyEnv\|privateKeyFile" apps/unfold/src/task-providers apps/unfold/src/link-providers` finds nothing once the legacy adapters are removed.

## Pros and Cons of the Options

### A. Ploeg owns every tracker and forge connection

* Good, because one owner per outside system, and it is the party that already needs every connection to run work.
* Good, because it matches Ploeg ADR-0184 and ADR-0195, which already put connection secrets and flows in Ploeg.
* Bad, because Unfold needs new Ploeg reads and actions before it can drop its own adapters.

### B. Ploeg only schedules agents; Unfold owns every connection

* Good, because Unfold's tracker screens would need no new Ploeg contract.
* Bad, because Ploeg would be unusable without Unfold, against ADR-0050 rule 8.
* Bad, because Unfold would take on per-Run credential minting, intake, write-back and CI and pull request event handling, which is engine work ([ADR-0002](adr-0002-ploeg-is-the-only-engine.md)).

### C. Split by job (application ADR-0063, 2026-10-31)

* Good, because it is what runs today and needs no new contract.
* Bad, because every outside system has two owners, two declarations and two credentials; the confusion the owner hit setting up the GitHub App by hand on 2026-11-17 and 2026-11-18.
* Bad, because the onboarding plan had to carry named exceptions for the copies Unfold kept.

## More Information

* Technical story: setting up the GitHub App by hand on 2026-11-17 and 2026-11-18; the OpenSpec change [self-serve-onboarding](../../openspec/changes/self-serve-onboarding/design.md).
* 2026-11-18 — Accepted: decided by the owner, Ryan Grippeling.
* Amends application ADR-0016, ADR-0063 and ADR-0064, and system ADR-0059 (above).
* Supported by Ploeg [ADR-0184](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md), [ADR-0192](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md) and [ADR-0195](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0195-a-proven-operator-makes-and-manages-a-tracker-or-forge-connection-through-a-flow-ploeg-starts-and-the-consumer-only-relays-codes.md), all proposed.

* 2026-11-18 — The owner decided three follow-up questions:
  1. **Report a problem does not file through Ploeg.** It is Unfold's own integration, not work; where a Tenant's reports land is no concern of Ploeg. ADR-0024 and ADR-0038 stand, and rule 2 is worded to cover work connections only.
  2. **Publishing becomes a Ploeg operator action** (Consequences above). It is an upstream ask, scheduled after the onboarding slices; the publisher keeps working until a Ploeg release serves it.
  3. **Personal views for Client users come from Ploeg.** If a Client user must see only what their own tracker account sees, Ploeg filters its Scope reads by that person's identity at the vendor; Unfold does not store their token. Nothing changes until Client users use Unfold.
