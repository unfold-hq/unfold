# Self-serve onboarding: an organisation connects its forge and tracker and gets its first agent pull request

## Why

**The measure of this change is the time from an Admin's first sign-in to the
first agent pull request on the organisation's own repository: under 15
minutes, with nobody from the Unfold project involved.** Today it takes hours
of manual edits in two configuration files, a cluster repository and a vault,
and none of it happens in Unfold ([Connect a repository](../../../docs/concepts/connect-a-repository.md),
[Customer environments](../../../docs/concepts/customer-environments.md),
journey 8 on [Users and their journeys](../../../docs/concepts/users-and-journeys.md#8-set-up-and-govern-an-organisation)).
Until an organisation can do this alone, Unfold is not usable by anyone but its
own maintainers.

The pieces that make it possible are now decided or proposed upstream: Ploeg
holds connection secrets in a store it writes itself
([Ploeg ADR-0184](../../../apps/ploeg/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md), proposed),
binds tracker Scopes to Teams at runtime
([Ploeg ADR-0186](../../../apps/ploeg/docs/adrs/0186-an-operator-consumer-binds-a-tracker-scope-to-a-team-at-runtime-and-static-routing-wins-on-conflict.md), proposed),
resolves a Run's forge from its Work Target
([Ploeg ADR-0192](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md), proposed),
registers a Work Target at runtime only for a repository its forge connection
was granted ([Ploeg ADR-0193](https://github.com/ploeg-hq/ploeg/pull/421), proposed), and lets a repository missing only its
instruction file receive one Run that adds it ([Ploeg ADR-0194](https://github.com/ploeg-hq/ploeg/pull/421), proposed). Unfold already
saves tracker connections from the screen
([application ADR-0064](../../../apps/unfold/docs/adrs/0064-people-add-tracker-connections-from-the-screen-and-unfold-keeps-them-with-an-encrypted-service-account-token.md))
and reads GitHub as a GitHub App (pull request #54,
[github-app.ts](../../../apps/unfold/src/task-providers/github-app.ts)).
This change is the plan that joins them into one journey.

Application: `apps/unfold`, with a system ADR because the journey crosses Ploeg
and Unfold. Ticket: none yet; it builds on VIK-2248 (ADR-0048's Integration
Accounts and Client Projects in Unfold). Every Ploeg part lands in
[ploeg-hq/ploeg](https://github.com/ploeg-hq/ploeg) first, then a `ploeg`-scoped
commit moves the pin ([ADR-0039](../../../docs/adr/adr-0039-unfold-depends-on-a-released-ploeg-through-its-contract-bundle-and-go-module.md)).

All design questions were decided by the owner on 2026-11-17; design.md lists
them as D1 to D11 and does not reopen them.

## What Changes

Everything below is **proposed**; nothing of it is built.

- **An onboarding checklist that is the Connections page.** Settings →
  Connections ([views/connections.js](../../../apps/unfold/public/views/connections.js)),
  today a read-only wiring check, becomes the backbone checklist: one line per
  step and per board and repository, each green or red, each red line with the
  button that fixes it. A new Admin lands on it at first sign-in.
- **Connect GitHub as a GitHub App, in one click.** A self-hoster creates the
  App with GitHub's App manifest flow; Ploeg converts the manifest code and
  keeps the key in its secret store; the Admin installs the App on the
  repositories they choose.
- **Connect ClickUp through a dedicated member called "Unfold".** The page
  explains in plain words why (ClickUp has no bot accounts; a token acts as
  the person who made it; webhooks die with their creator) and walks the Admin
  through creating it. Self-hosted: that member's token is pasted once and goes
  write-only to Ploeg's store. Hosted (later): OAuth through Unfold's own
  ClickUp app, consented as that member.
- **Add repositories and Lists at runtime.** Unfold asks Ploeg to register a
  repository its GitHub App installation already reaches (Ploeg ADR-0193) and to bind each List to a Team and its
  repositories (Ploeg ADR-0186). The static configuration stays a seed and
  wins on conflict, in Ploeg and in Unfold.
- **Repositories, Client Projects and grants in Unfold's database.** A
  repository becomes a stored entity next to the configured ones; everything
  lands in one silent Client Project, **Own work**
  ([ADR-0048](../../../docs/adr/adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md)).
  Projects appear in the screens only once a Client exists; sources and
  repositories can be moved between projects later.
- **A hard Budget before any spend.** The checklist shows the enforced cap and
  the Admin confirms it before the first paid Run
  ([ADR-0005](../../../docs/adr/adr-0005-unfold-is-offered-to-agencies.md),
  [ADR-0006](../../../docs/adr/adr-0006-the-ticket-is-the-billing-unit.md)).
- **A readiness pull request as the first value.** For a repository that is
  not ready only because `AGENTS.md` is missing, Unfold offers a "prepare
  repository" Work Item that writes it from the real code. The cost is shown
  and a person confirms it. It moves the repository to Level 2 of
  [ADR-0047](../../../docs/adr/adr-0047-unfold-describes-a-repository-with-the-ai-codebase-maturity-model-and-delivers-at-level-5.md).
- **Fixes to what exists.** Saved sources get the Ploeg target that import
  binding needs (today `task_binding_unconfigured`,
  [task-binding.ts](../../../apps/unfold/src/task-binding.ts)); the Tasks
  page's "How connections work" dialog stops describing a configuration-only
  flow.
- **Time to first pull request as a first-party measure**
  ([ADR-0023](../../../docs/adr/adr-0023-unfold-measures-happiness-and-confusion-with-first-party-events-surveys-and-bug-reports.md)).

## Capabilities

### New Capabilities

- `organisation-onboarding`: the checklist, its states, who may act, the Own
  work project, the Budget gate and the time-to-first-pull-request measure.
- `forge-connection`: connecting GitHub as a GitHub App and adding repositories
  through Ploeg's runtime Work Target registration (Ploeg ADR-0193).
- `tracker-scope-binding`: connecting ClickUp through a dedicated member and
  binding its Lists to a Team and repositories through Ploeg, including the
  saved-source target fix.
- `repository-readiness`: the readiness pull request offered for a repository
  that lacks only `AGENTS.md`.

### Modified Capabilities

- none. `openspec/specs/` holds no capability these change.

## Non-goals

- **Hosted multi-tenancy.** ADR-0009 isolation, the Zitadel broker
  ([ADR-0058](../../../docs/adr/adr-0058-people-sign-in-through-one-zitadel-broker-with-an-organisation-per-tenant.md)),
  the `Tenant` operator and Platform → Customers are out of scope. The design
  must not block them, and design.md says where each one attaches.
- **Installing Unfold and Ploeg.** The 15-minute clock starts at the first
  sign-in of an installed pair. The chart install, the public hostname and
  Ploeg's webhook endpoint are the installer's job and are measured separately.
- **Other forges and trackers in the first version.** GitHub Issues follows
  ClickUp; Linear stays where ADR-0050's tracker order puts it unless a pilot
  agency uses Linear. Forgejo, GitLab and Jira connect as today.
- **An opt-in status or tag trigger** for organisations without a ClickUp seat
  for Unfold. Recorded as a possible later slice.
- **Developers adding repositories or Lists.** Only an Admin may, in v1.
- **Changing a Team's Budget at runtime.** v1 shows and confirms the enforced
  cap; raising it needs a Ploeg contract that is not part of this change.
- **Editing `apps/ploeg`.** Every Ploeg need is described as a generic contract
  for ploeg-hq.
- **Production desired state.** Turning any of this on in a deployment is the
  owner's change in the cluster repository.

## Impact

- `apps/unfold/src/`: `tracker-connections.ts` (grows into Integration
  Accounts), new `repositories` and `client-projects` modules, `task-binding.ts`,
  `ploeg.ts` and the expectation set `ploeg-expectations.json`, `http.ts`
  routes, `store.ts` migrations, the product events.
- `apps/unfold/public/`: `views/connections.js` and `connections.js` (the
  checklist), `views/tasks.js` (the dialog), a GitHub and a ClickUp connect
  flow, the readiness offer.
- `apps/unfold/ops/helm/unfold/`: an optional mount of the GitHub App key
  secret Ploeg writes; values schema.
- `apps/unfold/docs/contracts/openapi.yaml`, `error-codes.md`,
  `docs/operations/task-connections.md`; `docs/concepts/connect-a-repository.md`
  and `customer-environments.md` once slices land.
- Upstream, in ploeg-hq: ADR-0184, ADR-0186, ADR-0192, ADR-0193 and ADR-0194
  (the last two in [ploeg-hq/ploeg#421](https://github.com/ploeg-hq/ploeg/pull/421)) must be accepted and
  released before the slices that wait for them.
- New system record: [ADR-0059](../../../docs/adr/adr-0059-an-organisation-connects-its-forge-and-tracker-from-unfold-and-ploeg-learns-its-repositories-and-boards-at-runtime.md), proposed.
