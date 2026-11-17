---
status: proposed
date: 2026-11-17
decision-makers: Ryan Grippeling
---

# An organisation connects its forge and tracker from Unfold, and Ploeg learns its repositories and boards at runtime

## Context and Problem Statement

An organisation that installs Unfold cannot use it until someone edits Ploeg's configuration, Unfold's configuration, a cluster repository and a vault, and rolls both out: hours of work, none of it in Unfold ([Connect a repository](../concepts/connect-a-repository.md), [Customer environments](../concepts/customer-environments.md), journey 8 on [Users and their journeys](../concepts/users-and-journeys.md#8-set-up-and-govern-an-organisation)). Ploeg has proposed the runtime pieces: connection secrets in a store Ploeg writes itself ([Ploeg ADR-0184](../../apps/ploeg/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md)), tracker Scopes bound to Teams at runtime ([Ploeg ADR-0186](../../apps/ploeg/docs/adrs/0186-an-operator-consumer-binds-a-tracker-scope-to-a-team-at-runtime-and-static-routing-wins-on-conflict.md)), and a Run's forge taken from its Work Target ([Ploeg ADR-0192](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md)), Work Targets registered at runtime only for repositories Ploeg's forge connection was granted ([Ploeg ADR-0193](https://github.com/ploeg-hq/ploeg/pull/421)), and one Run that adds the instruction file to a repository missing only that ([Ploeg ADR-0194](https://github.com/ploeg-hq/ploeg/pull/421)). All five are proposed. How does a new organisation get from first sign-in to its first agent pull request on its own repository, alone, and who holds what along the way?

## Decision Drivers

* The measure is the time from an Admin's first sign-in to the first agent pull request on the organisation's own repository: under 15 minutes, with nobody from the Unfold project involved.
* Ploeg authorizes, budgets and executes every Run ([ADR-0002](adr-0002-ploeg-is-the-only-engine.md)) and keeps a closed, operator-declared set of Work Targets; Unfold never routes work itself.
* No person handles a secret the vendor lets us avoid; Ploeg holds connection secrets.
* A configured installation keeps working unchanged; configuration wins on conflict ([application ADR-0064](../../apps/unfold/docs/adrs/0064-people-add-tracker-connections-from-the-screen-and-unfold-keeps-them-with-an-encrypted-service-account-token.md)).
* The same code serves the hosted offer later ([ADR-0050](adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md) rule 7).
* Never an account without a hard Budget ([ADR-0005](adr-0005-unfold-is-offered-to-agencies.md)).

## Considered Options

* Unfold drives an onboarding checklist over Ploeg's runtime operator API; Ploeg registers repositories and binds boards; static configuration stays the seed and wins
* Unfold opens a pull request on the deployment's configuration for each connection (connect a repository, direction 5)
* Unfold writes connection secrets to the vault itself and keeps routing in configuration (connect a repository, direction 6)

## Decision Outcome

Chosen option: "**Unfold drives an onboarding checklist over Ploeg's runtime operator API**", because it is the only option without a rollout or a person outside the organisation in the path, and it keeps every secret with the party that receives it.

1. **The journey.** Settings → Connections is the onboarding checklist: sign in, connect GitHub, pick repositories, connect ClickUp, pick Lists, map each List to repositories and a Team, confirm the Budget, a readiness pull request, a first task, a first pull request. Each line is computed from live state and offers the action that fixes it. The success measure is time to first agent pull request, recorded as first-party events ([ADR-0023](adr-0023-unfold-measures-happiness-and-confusion-with-first-party-events-surveys-and-bug-reports.md)).
2. **First version.** Self-hosted, one organisation, walked as an agency Admin would walk it. GitHub is the first forge, as a GitHub App created with GitHub's App manifest flow; ClickUp is the first tracker; GitHub Issues follows. Tenancy, the Zitadel broker ([ADR-0058](adr-0058-people-sign-in-through-one-zitadel-broker-with-an-organisation-per-tenant.md)) and the `Tenant` operator are not part of it and are not blocked by it.
3. **Ploeg learns at runtime.** Unfold registers a repository through Ploeg's runtime Work Target registration (Ploeg ADR-0193), which accepts one only when Ploeg's own forge connection already reaches it, a proven Admin asks, and it passes readiness. Unfold binds a List through Ploeg ADR-0186. Ploeg's static file stays a seed and wins on conflict; so do Unfold's configured `repositories[]` and `taskSources[]`.
4. **Credentials.** Apps and OAuth first; Ploeg receives, exchanges and stores connection secrets (Ploeg ADR-0184). ClickUp is reached through a dedicated member "Unfold" with one paid seat, because ClickUp has no bot accounts and a token acts as the person who made it. Self-hosted, that member's token is pasted once and goes write-only to Ploeg's store; hosted, it comes from OAuth through Unfold's own ClickUp app consented as that member. **Two named exceptions, both for self-hosted only and both removed before hosted:** Unfold reads the same GitHub App key Ploeg wrote, from that one secret mounted read-only; and Unfold keeps application ADR-0064's sealed copy of the ClickUp token for its Tasks page and hand-off. Before hosted, only Ploeg holds the key and mints short-lived read tokens for Unfold, and Unfold's service reads go through Ploeg or people's own links.
5. **Projects later.** Everything added lands in one silent Client Project, "Own work", as [ADR-0048](adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md) defines for the Agency's own work. Repositories, Client Projects and Repository Grants become stored entities in Unfold. Projects appear in the screens only once a Client exists; sources and repositories can be moved between projects later.
6. **First value.** A repository that is not ready only because `AGENTS.md` is missing is offered a readiness pull request from Ploeg's prepare-repository Run (Ploeg ADR-0194), which may change only `AGENTS.md`. A person confirms its cost first. It is the step to Level 2 of [ADR-0047](adr-0047-unfold-describes-a-repository-with-the-ai-codebase-maturity-model-and-delivers-at-level-5.md).
7. **Who.** Only an Admin, and a Tenant Admin under `tenancy.enforce`, connects accounts and adds repositories and Lists. Objects of another Tenant answer 404. Every change is an OCSF audit record without a secret.
8. **When Ploeg is behind.** A step whose route the pinned Ploeg does not serve is refused before anything is sent, with the Ploeg release that adds it and the configuration entry to use instead ([ADR-0044](adr-0044-unfold-refuses-a-ploeg-that-does-not-serve-the-contract-majors-it-requires.md)). An installation that already serves another forge cannot add GitHub until Ploeg ADR-0192 is released.

The plan, state matrix, data model, call order and slices are the OpenSpec change [self-serve-onboarding](../../openspec/changes/self-serve-onboarding/design.md).

### Consequences

* Good, because connecting an organisation becomes a checklist in Unfold that one Admin finishes alone, with no rollout and no file edit.
* Good, because every board and repository line, configured or runtime, shows its state and its fix in one place.
* Good, because the secrets stay with Ploeg, except the two named self-hosted exceptions, which have a slice that removes them.
* Bad, because the journey depends on five Ploeg records that are proposed, not built; until each is released its step is refused with the reason.
* Bad, because the ClickUp member costs an organisation one paid seat.
* Bad, because a compromised Unfold server pod could use the shared GitHub App key until the hardening lands.
* Neutral, because routes and repositories now have two sources, static and runtime; Ploeg's list routes and the checklist show both.

### Confirmation

Proposed, none of these exist yet:

* An Unfold onboarding test against fakes of Ploeg, GitHub and ClickUp walks every stage from a Tenant with no Integration Account to `onboarding.first_pr_opened`, and asserts that no response, log line, action record, product event or database row contains the App key, a manifest code or the ClickUp token, apart from the sealed ADR-0064 value in `internal_state`.
* An Unfold test that a step whose Ploeg read route answers 404 is refused with `ploeg_step_unavailable` and sends no write.
* An Unfold test that a configured entry with the same key marks the stored one `shadowed`.
* The owner's timed trial on a fresh installation records the time to first pull request; this record is accepted only after a trial under 15 minutes.

## Pros and Cons of the Options

### Unfold opens a pull request on the deployment's configuration

* Good, because the configuration stays the only source of routes.
* Bad, because every connection waits for a review and a rollout, and Unfold needs write access to the infrastructure repository.
* Bad, because nothing probes the tracker or forge before the merge.

### Unfold writes connection secrets to the vault and keeps routing in configuration

* Good, because no person types a secret.
* Bad, because Unfold, which faces the internet, would hold a vault write role, and webhook secrets a vendor returns once would still have to reach Ploeg.
* Bad, because routing still needs a configuration change and a rollout.

## More Information

* Builds on [Connect a repository](../concepts/connect-a-repository.md) directions 3, 5 and 6, and replaces direction 6's "Unfold writes each credential to OpenBao" with Ploeg ADR-0184.
* Answers application ADR-0064 open question 2 (only an Admin, for now) and question 5 (Ploeg ADR-0186).
* 2026-11-17 — Proposed. The owner decided the design questions D1 to D11 recorded in the change's design.md; the record stays proposed until he signs it.
