---
status: proposed
date: 2026-11-18
decision-makers: Ryan Grippeling
---

# An organisation connects its forge and tracker from Unfold, and Ploeg learns its repositories and boards at runtime

## Context and Problem Statement

An organisation that installs Unfold cannot use it until someone edits Ploeg's configuration, Unfold's configuration, a cluster repository and a vault, and rolls both out: hours of work, none of it in Unfold ([Connect a repository](../concepts/connect-a-repository.md), [Customer environments](../concepts/customer-environments.md), journey 8 on [Users and their journeys](../concepts/users-and-journeys.md#8-set-up-and-govern-an-organisation)). Ploeg has proposed the runtime pieces, all five merged on ploeg-hq/ploeg `development` as proposed records: connection secrets in a store Ploeg writes itself ([Ploeg ADR-0184](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md)), tracker Scopes bound to Teams at runtime ([Ploeg ADR-0186](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0186-an-operator-consumer-binds-a-tracker-scope-to-a-team-at-runtime-and-static-routing-wins-on-conflict.md)), a Run's forge taken from its Work Target ([Ploeg ADR-0192](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md)), Work Targets registered at runtime only for repositories Ploeg's forge connection was granted ([Ploeg ADR-0193](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0193-a-proven-operator-registers-a-work-target-at-runtime-only-for-a-repository-ploegs-forge-connection-was-granted.md)), and one Run that adds the instruction file to a repository missing only that ([Ploeg ADR-0194](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0194-a-repository-missing-only-its-instruction-file-may-receive-one-run-that-adds-it.md)). ADR-0184, 0186, 0193 and 0194 each have a proposed amendment (ploeg-hq/ploeg follow-up PR). How does a new organisation get from first sign-in to its first agent pull request on its own repository, alone, and who holds what along the way?

## Decision Drivers

* The measure is the time from an Admin's first sign-in to the first agent pull request of any kind on the organisation's own repository: under 15 minutes, with nobody from the Unfold project involved. The time to the first task pull request is measured separately and carries that promise only for a repository that is already ready.
* Ploeg authorizes, budgets and executes every Run ([ADR-0002](adr-0002-ploeg-is-the-only-engine.md)) and keeps a closed, operator-declared set of Work Targets; Unfold never routes work itself.
* No person handles a secret the vendor lets us avoid; Ploeg holds connection secrets.
* A configured installation keeps working unchanged; configuration wins on conflict ([application ADR-0064](../../apps/unfold/docs/adrs/0064-people-add-tracker-connections-from-the-screen-and-unfold-keeps-them-with-an-encrypted-service-account-token.md)).
* The same code serves the hosted offer later ([ADR-0050](adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md) rule 7).
* Never an account without a hard Budget ([ADR-0005](adr-0005-unfold-is-offered-to-agencies.md)); in Ploeg that is a Team's spend cap ([Ploeg ADR-0162](../../apps/ploeg/docs/adrs/0162-a-team-spends-at-most-its-cap-per-period-and-a-claim-over-it-starts-nothing.md)).

## Considered Options

* Unfold drives an onboarding checklist over Ploeg's runtime operator API; Ploeg registers repositories and binds boards; static configuration stays the seed and wins
* Unfold opens a pull request on the deployment's configuration for each connection (connect a repository, direction 5)
* Unfold writes connection secrets to the vault itself and keeps routing in configuration (connect a repository, direction 6)

## Decision Outcome

Chosen option: "**Unfold drives an onboarding checklist over Ploeg's runtime operator API**", because it is the only option without a rollout or a person outside the organisation in the path, and it keeps every secret with the party that receives it.

1. **The journey.** Settings → Connections is the onboarding checklist. It opens for an Admin only while the Tenant has no source and no repository, stored or configured. For a ready repository: sign in, installation check, connect GitHub, register repositories, connect ClickUp, pick Lists, confirm the Team's spend cap, bind each List to ready repositories and a Team, a first task, a first task pull request. For a repository missing only `AGENTS.md`, register, prepare (a readiness pull request), a person reviews and merges it, Ploeg re-inspects, and only then is a List bound to it; Unfold never asks Ploeg to bind to a target that is not ready. A List's step is done only when its binding is `active`, because Ploeg does not poll ClickUp. Each line is computed from live state and offers the action that fixes it. Two clocks are recorded as first-party events ([ADR-0023](adr-0023-unfold-measures-happiness-and-confusion-with-first-party-events-surveys-and-bug-reports.md)): time to first agent pull request, of any kind, is the 15-minute measure; time to first task pull request includes the human review of a readiness pull request where there is one and carries no promise then.
2. **First version.** Self-hosted, one organisation, walked as an agency Admin would walk it. GitHub is the first forge, as a GitHub App created with GitHub's App manifest flow; ClickUp is the first tracker; GitHub Issues follows. Tenancy, the Zitadel broker ([ADR-0058](adr-0058-people-sign-in-through-one-zitadel-broker-with-an-organisation-per-tenant.md)) and the `Tenant` operator are not part of it and are not blocked by it. v1 still needs one-time install values set by the person installing Unfold and Ploeg: a Team with a spend cap, the Team's `trackerBindings` naming the connection, `targetRegistration`, the consumer permissions `bindScopes` and `registerTargets`, proven attribution with the required claims, a secret store, egress and a public webhook URL. The checklist checks them first, and a dry run's `422 registration_not_accepted` or `bindings_not_accepted` is shown as an installation that has not opted in.
3. **Ploeg learns at runtime.** Unfold registers a repository through Ploeg's runtime Work Target registration (Ploeg ADR-0193), which accepts one only when Ploeg's own forge connection already reaches it and a proven Admin asks. A repository that passes readiness is registered ready; one missing only `AGENTS.md` is registered as not ready with `prepareAvailable`, which drives Unfold's readiness offer; any other readiness failure is refused. Unfold binds a List through Ploeg ADR-0186. Ploeg's static file stays a seed and wins on conflict; so do Unfold's configured `repositories[]` and `taskSources[]`.
4. **Credentials.** Apps and OAuth first; Ploeg receives, exchanges and stores connection secrets (Ploeg ADR-0184). ClickUp is reached through a dedicated member "Unfold" with one paid seat, because ClickUp has no bot accounts and a token acts as the person who made it. Self-hosted, that member's token is pasted once and goes write-only to Ploeg's store; hosted, it comes from OAuth through Unfold's own ClickUp app consented as that member. **Named exceptions, for self-hosted only and removed before hosted:** in v1, Unfold keeps application ADR-0064's sealed copy of the ClickUp token for its Tasks page and hand-off. From the GitHub Issues slice, when Unfold first reads GitHub itself, it also reads the same GitHub App key Ploeg wrote, from that one secret mounted read-only; v1 needs no GitHub key in Unfold, because the repository picker, Runs and pull requests all come through Ploeg. Before hosted, only Ploeg holds the key and mints short-lived read tokens for Unfold, and Unfold's service reads go through Ploeg or people's own links. The OAuth `state` of every consent flow is issued by Ploeg and also tied by Unfold to the person's session.
5. **Projects later.** Everything added lands in one silent Client Project, "Own work", as [ADR-0048](adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md) defines for the Agency's own work. Repositories, Client Projects and Repository Grants become stored entities in Unfold. Projects appear in the screens only once a Client exists; sources and repositories can be moved between projects later.
6. **First value.** A repository that Ploeg reports with `prepareAvailable` is offered a readiness pull request from Ploeg's prepare-repository Run (Ploeg ADR-0194), which may add only `AGENTS.md`. Nothing is estimated: Unfold shows the cap that bounds the Run, the lowest of the caps ADR-0194 names, a person confirms that cap, and Unfold sends it as the Run's budget. Readiness work and Teams bound during onboarding need a Team spend cap; a configured installation's hand-off is never refused for lacking one. It is the step to Level 2 of [ADR-0047](adr-0047-unfold-describes-a-repository-with-the-ai-codebase-maturity-model-and-delivers-at-level-5.md).
7. **Who.** Only an Admin, and a Tenant Admin under `tenancy.enforce`, connects accounts and adds repositories and Lists. Objects of another Tenant answer 404. Every change is an OCSF audit record without a secret.
8. **When Ploeg is behind.** A step whose route the pinned Ploeg does not serve is refused before anything is sent, with the Ploeg release that adds it and the configuration entry to use instead ([ADR-0044](adr-0044-unfold-refuses-a-ploeg-that-does-not-serve-the-contract-majors-it-requires.md)). An installation that already serves another forge cannot add GitHub until the pinned Ploeg ships ADR-0192; Unfold decides this from the pinned bundle version until Ploeg reports active forges per installation in its connections read, since the version route reports contract majors only.

The plan, state matrix, data model, call order and slices are the OpenSpec change [self-serve-onboarding](../../openspec/changes/self-serve-onboarding/design.md).

### Consequences

* Good, because, once the install values are set, connecting an organisation becomes a checklist in Unfold that one Admin finishes alone, with no rollout and no file edit.
* Good, because every board and repository line, configured or runtime, shows its state and its fix in one place.
* Good, because the secrets stay with Ploeg, except the named self-hosted exceptions, which have a slice that removes them.
* Bad, because the journey depends on five Ploeg records that are proposed, not built, and on a Ploeg connection contract; until each is released its step is refused with the reason.
* Bad, because v1 still needs one-time install values in Ploeg's chart; onboarding is self-serve from first sign-in, not from install.
* Bad, because the first task pull request on a repository that needs a readiness pull request waits for a person's review and merge.
* Bad, because the ClickUp member costs an organisation one paid seat.
* Bad, because from the GitHub Issues slice a compromised Unfold server pod could use the shared GitHub App key until the hardening lands.
* Neutral, because routes and repositories now have two sources, static and runtime; Ploeg's list routes and the checklist show both.

### Confirmation

Proposed, none of these exist yet:

* An Unfold onboarding test against fakes of Ploeg, GitHub and ClickUp walks every stage, on both paths (a ready repository, and one that needs a readiness pull request), from a Tenant with no source and no repository to `onboarding.first_agent_pr_opened` and `onboarding.first_task_pr_opened`, and asserts that no response, log line, action record, product event or database row contains the App key, a manifest code or the ClickUp token, apart from the sealed ADR-0064 value in `internal_state`.
* An Unfold test that a step whose Ploeg read route answers 404 is refused with `ploeg_step_unavailable` and sends no write, and that a dry run answering `422 registration_not_accepted` is shown as an installation that has not opted in.
* An Unfold test that no binding request names a target Ploeg reports as not ready.
* An Unfold test that a configured entry with the same key marks the stored one `shadowed`.
* The owner's timed trial on a fresh installation, after the install values are set, records both clocks; this record is accepted only after a trial whose time to first agent pull request is under 15 minutes.

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
* 2026-11-17 — Corrected after an independent review against the Ploeg sources, still proposed: two clocks, with the 15-minute goal on the first agent pull request of any kind; the journey order for a repository that is not ready (prepare, merge, re-inspect, then bind); a repository missing only `AGENTS.md` is registered with `prepareAvailable`; no cost estimate, the confirmed cap becomes the Run's budget; the one-time install values named; the shared GitHub App key moved to the GitHub Issues slice; ADR-0192 support gated on the pinned bundle version.
* 2026-11-18 — Amended by [ADR-0060](adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md), still proposed: Ploeg owns every tracker and forge connection and Unfold holds none. The named self-hosted exceptions of decision 4 are withdrawn: the one ClickUp paste goes to Ploeg's store only and Unfold keeps no sealed copy, Unfold never reads the GitHub App key, and Unfold's tracker reads and hand-off go through Ploeg. The change's slices S5, S9 and S10 follow.
* 2026-11-19 — Decision 8's second-forge gate is met, still proposed: Ploeg 0.2.0-rc.109 shipped ADR-0192 (one installation serves several forges when each active forge mints per-Run credentials), and Unfold pins 0.2.0-rc.130. `apps/unfold/src/ploeg-steps.json` now records 0.2.0-rc.109 as the release, so an installation that already serves another forge adds GitHub; the `409 second_forge_unsupported` refusal applies only to an Unfold built against an older Ploeg.
