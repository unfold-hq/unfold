# Design — self-serve onboarding

Everything in this design is **proposed**. Where it says "Unfold does" or
"Ploeg does", read "will do once the slice lands". Route names for Ploeg are
illustrative until the Ploeg records that own them are accepted; Unfold adopts
whatever ploeg-hq publishes in its contract bundle.

## Thesis

The measure of success is the **time from an Admin's first sign-in to the
first agent pull request on the organisation's own repository: under 15
minutes, with nobody from the Unfold project involved.** Every decision below
is judged against it. A step that needs a person outside the organisation, a
file edit, a restart or a pasted secret the vendor could have avoided is a
defect in this design, not a detail.

There are two clocks, and only the first carries the promise:

- **Time to first agent pull request** stops at the first agent pull request
  of any kind, a readiness pull request or a task pull request. This is the
  15-minute goal.
- **Time to first task pull request** stops at the first pull request for a
  tracker task. For a repository that needs a readiness pull request it
  includes a person reviewing and merging that pull request, which nobody
  can schedule, so it has **no 15-minute promise**. The 15-minute path to a
  task pull request holds only for a repository that is already ready
  (`AGENTS.md` on its base branch).

Both clocks start after a one-time installation: the values the person
installing Unfold and Ploeg sets (section 1, *Installation prerequisites*).
v1 still needs them; they are not on either clock and the checklist checks
them first.

Today the same outcome takes hours: a `targets` and a `trackers.*.projects`
entry in Ploeg's configuration, a second `repositories` and `taskSources`
entry in Unfold's, bot tokens typed into a vault, a board shared by hand, and
a rollout of both ([Connect a repository](../../../docs/concepts/connect-a-repository.md#the-journey),
[What an installation asks for today](../../../docs/concepts/connect-a-repository.md#what-an-installation-asks-for-today)).

## Context

What exists on `development` (read on 2026-11-17):

- **Saved tracker connections.** [tracker-connections.ts](../../../apps/unfold/src/tracker-connections.ts)
  stores a ClickUp service-account token sealed in `internal_state` and saved
  sources in `tracker_connection_sources`
  ([application ADR-0064](../../../apps/unfold/docs/adrs/0064-people-add-tracker-connections-from-the-screen-and-unfold-keeps-them-with-an-encrypted-service-account-token.md)).
  Only ClickUp declares the setup capability (`TaskSetup.serviceAccount` in
  [clickup.ts](../../../apps/unfold/src/task-providers/clickup.ts)).
- **The saved-source gap.** `sync()` pushes saved sources into
  `config.taskSources` without a `ploeg` target
  ([tracker-connections.ts, `sync`](../../../apps/unfold/src/tracker-connections.ts#L113)),
  and `lookupTaskBinding` refuses any source without one with
  `409 task_binding_unconfigured`
  ([task-binding.ts](../../../apps/unfold/src/task-binding.ts#L20)). A List
  saved on the screen can be read and handed off but never imported into
  shared execution.
- **No repository entity.** `Repository` exists only as configuration
  ([types.ts](../../../apps/unfold/src/types.ts#L31)); a saved source must
  name a configured repository or it is `repository_missing`.
- **GitHub as a GitHub App.** Since pull request #54 Unfold reads GitHub
  sources as an App from `privateKeyEnv` or `privateKeyFile`
  ([github-app.ts](../../../apps/unfold/src/task-providers/github-app.ts)).
  Unfold also holds a forge write token for publishing
  (`delivery.publisher.tokenEnv`, [delivery-config.ts](../../../apps/unfold/src/delivery-config.ts)).
- **The wiring check.** Settings → Connections
  ([views/connections.js](../../../apps/unfold/public/views/connections.js))
  reads Ploeg's `GET /api/v1/operator/connections` (Ploeg ADR-0129) and shows
  every board and repository with each check. It changes nothing.
- **The Tasks page** first-run state links a "How connections work" dialog
  that describes the configuration-only flow
  ([views/tasks.js](../../../apps/unfold/public/views/tasks.js#L401)).
- **Ploeg** pushes to GitHub with per-Run App installation tokens (Ploeg
  ADR-0086, [connect GitHub as a forge](../../../apps/ploeg/docs/how-to/connect-github-as-a-forge.md)),
  routes boards only from its static file, and checks a Work Target's
  readiness (`AGENTS.md` on the base branch, not archived, not a mirror;
  `target_not_ready` otherwise). Its chart installs no Team
  (`executor.teams: []`) and gives every executor Team
  `executor.spendCap: {usd: 20, period: day}`
  ([Ploeg ADR-0162](../../../apps/ploeg/docs/adrs/0162-a-team-spends-at-most-its-cap-per-period-and-a-claim-over-it-starts-nothing.md) rule 6).

Upstream records this design depends on. All five are merged on
ploeg-hq/ploeg `development` with status **proposed**; Ploeg ADR-0184, 0186,
0193 and 0194 each have a **proposed amendment (ploeg-hq/ploeg follow-up PR)**
that carries the asks of section 4.

| Record | What it gives this journey |
|---|---|
| [Ploeg ADR-0184](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md) | store-backed forge and tracker connections; Ploeg does the OAuth or code exchange; a pasted token goes straight to the store; with no store configured, those calls fail closed (rule 5) |
| [Ploeg ADR-0186](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0186-an-operator-consumer-binds-a-tracker-scope-to-a-team-at-runtime-and-static-routing-wins-on-conflict.md) | runtime tracker bindings with a dry run, probes, webhooks, static wins; a binding to a target that is not ready is refused (`target_not_ready`); Teams are not created at runtime |
| [Ploeg ADR-0192](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md) | a Run's forge comes from its Work Target (the VIK-2247 fix); supersedes Ploeg ADR-0023 |
| [Ploeg ADR-0193](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0193-a-proven-operator-registers-a-work-target-at-runtime-only-for-a-repository-ploegs-forge-connection-was-granted.md) | a repository is registered only when Ploeg's own store-backed forge connection (ADR-0184) was granted it and a proven person with operator authority asks; a repository missing only `AGENTS.md` **is registered**, reported not ready with `prepareAvailable: true`; a withdrawn grant marks the target `invalid`, never deleted |
| [Ploeg ADR-0194](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0194-a-repository-missing-only-its-instruction-file-may-receive-one-run-that-adds-it.md) | a `prepare_repository` Work Item, admitted only against a registered target whose only readiness reason is `instruction_file_missing`; it may add `AGENTS.md` and nothing else; its Shift pool is the lowest of four caps (section 5) and "nothing is estimated or invented" |

## Goals / Non-Goals

**Goals:**

- An Admin goes from first sign-in to a first agent pull request in under 15
  minutes, alone, on a self-hosted installation with one organisation whose
  installer has set the prerequisites of section 1.
- Every step is a line on one checklist that says what is done, what failed
  and the one button that fixes it.
- No person handles a secret the vendor lets us avoid; where one must be
  pasted, it is pasted once and never shown again.
- A configured installation keeps working unchanged.
- The same code serves the hosted offer later
  ([ADR-0050](../../../docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md) rule 7).

**Non-Goals:** as in [proposal.md](proposal.md#non-goals), which also lists
the one-time install values.

## Decisions

The owner decided D1 to D11 on 2026-11-17. They are cited here, not reopened.
The review of the same day moved D8 from v1 to S9 and fixed the two clocks and
the journey order (see *Review corrections* below).

| # | Decision |
|---|---|
| D1 | First version: self-hosted, one organisation, but the flow is designed as an agency Admin walks it, so the same code goes hosted later. Multi-tenant hosting pieces (ADR-0009 isolation, the Zitadel broker of ADR-0058, the `Tenant` operator) are out of scope; the design must not block them. |
| D2 | Ploeg learns about boards and repositories at runtime through a generic operator API; its static file stays a seed and wins on conflict. Boards: Ploeg ADR-0186. Repositories: runtime Work Target registration, Ploeg ADR-0193. |
| D3 | Apps and OAuth first; no pasted secret where the vendor allows. Ploeg holds connection secrets and does the OAuth code exchange itself, writing to its secret store (Ploeg ADR-0184). Exception: D8, from S9. |
| D4 | First pair: GitHub as the forge (a GitHub App, created by a self-hoster with GitHub's App manifest flow in one click) and ClickUp as the tracker. Then GitHub Issues. Linear stays where ADR-0050's tracker order puts it unless a pilot agency uses Linear; Linear's `actor=app` agents need no seat, and watchlist item T48 tracks ClickUp opening assignable external agents. |
| D5 | ClickUp identity: a dedicated ClickUp member "Unfold" (one paid seat). Self-hosted: its token is pasted once and goes write-only to Ploeg's store. Hosted: OAuth through Unfold's own ClickUp app, consented as that member. The onboarding makes creating the member easy and explains why. Optional later: a status or tag trigger, opt-in, for organisations without the seat. |
| D6 | Connections first, projects later: everything lands in a silent default Client Project, **Own work** (ADR-0048). Projects appear in the screens only when a Client is added; moving sources and repositories between projects must be possible later. |
| D7 | A new repository's first Work Item is a readiness pull request from Ploeg's prepare-repository kind, for a repository that is not ready only because `AGENTS.md` is missing; the cap that bounds it is shown and a person confirms it. Tied to ADR-0047's levels. |
| D8 | Unfold and Ploeg read the same GitHub App key from one secret **once Unfold reads GitHub as a tracker (S9)**. Before hosted: only Ploeg holds the key and hands Unfold short-lived read tokens. |
| D9 | Runtime repository registration as in D2. |
| D10 | Configuration-file sources keep winning (application ADR-0064); time to first pull request is a first-party event (ADR-0023); multi-forge workers (VIK-2247, now Ploeg ADR-0192) do not block v1 for a single-forge organisation but do block hosted and any installation that already serves another forge. |
| D11 | Only an Admin (a Tenant Admin under `tenancy.enforce`) connects accounts and adds repositories and Lists in v1. This answers application ADR-0064 open question 2 for now. |

**Review corrections (2026-11-17).** The lead of this change decided, after an
independent review against the Ploeg sources:

- **Two clocks** (Thesis): the 15-minute goal is time to first agent pull
  request of any kind; time to first task pull request is measured
  separately and promised nothing when a readiness pull request comes first.
- **Journey order.** A repository that is not ready goes register → prepare
  (readiness pull request) → a person merges → Ploeg re-inspects → bind the
  List → task. A ready repository goes register → bind → task. Unfold never
  asks Ploeg to bind a List to a target that is not ready (ADR-0186 refuses it
  with `target_not_ready` anyway).
- **D8 moves to S9.** The v1 pair never reads GitHub through Unfold: the
  repository picker, pull requests and Runs all come through Ploeg. A
  manifest-created App's `appId` exists only at runtime, and the Unfold chart
  has no mount for a key Ploeg writes. The shared key is therefore designed
  with GitHub Issues, where Unfold first needs it.

The rest of this section is the design within them.

### 1. The journey, stage by stage

The checklist is Settings → Connections. A signed-in Admin lands there
instead of on Now while the Tenant has **no source and no repository at all,
stored or configured**; an installation with configured entries never
triggers onboarding. Each stage is one checklist line; the line is green when
its check passes against live state, not when a form was submitted. A person
who is not an Admin sees the same lines read-only with "Ask an administrator
to connect this", and is not shown who the Admins are.

| # | Stage | What the Admin does | What happens underneath | Done when |
|---|---|---|---|---|
| 0 | Sign in | signs in through the installation's OIDC | both clocks start (`onboarding.started`, once per Tenant) | the checklist is shown |
| 1 | Installation | nothing, unless a line is red: then hands the named install value to whoever installed Unfold and Ploeg | Unfold reads each prerequisite below from Ploeg where Ploeg reports it | every prerequisite Unfold can read is met |
| 2 | Connect GitHub | **Create the GitHub App** (manifest flow) or **Use an existing App** if the installation already has one, then **Install** and pick repositories on GitHub's own page | Ploeg issues the `state`, converts the manifest code, stores key, webhook secret and client secret, verifies the installation belongs to its App (the connection contract, section 4 ask 2) | Ploeg reports a GitHub forge connection that reaches at least one repository |
| 3 | Register repositories | ticks repositories from the list the installation reaches | Unfold dry-runs Ploeg ADR-0193 registration for each, then registers; stores the repository and grants it to Own work | each picked repository is registered: **ready**, or **not ready, prepare available** (Ploeg's `prepareAvailable: true`), or refused with Ploeg's reason |
| 4 | Connect ClickUp | follows **Create the Unfold member** (four steps), pastes that member's token once | Unfold checks the token's shape and that ClickUp accepts it, refuses the Admin's own account, relays the token to Ploeg's store | Ploeg reports a ClickUp connection whose account is the Unfold member |
| 5 | Pick Lists | picks Lists by name from the Workspace | Unfold saves each as a source in Own work | each List is saved |
| 6 | Budget | reads the Team's spend cap and confirms it | Unfold reads the Team's `spendCap` from Ploeg's Teams read; the chart's default is USD 20 a day | the Admin confirmed a Team whose `spendCap` is not null |
| 7 | Prepare | for each repository with `prepareAvailable`: reads the cap that bounds the Run, **Prepare this repository** | Unfold admits a `prepare_repository` Work Item with `budgetUsd` set to the confirmed cap | the readiness pull request is open (the first clock stops here when it is first) |
| 8 | Review and merge | a person reviews and merges the readiness pull request on GitHub | Ploeg re-inspects the target at merge and writes `target.readiness_changed` (ADR-0194 section 7) | the repository is ready (ADR-0047 Level 2) |
| 9 | Bind List | for each List: the default repository, optional further repositories (repo labels), the Team (preselected when there is one); only **ready** repositories are offered | Unfold dry-runs a Ploeg ADR-0186 binding, shows each check, then creates it; the saved source takes the binding's target | the binding is `active`. `awaiting_webhook` is not done: Ploeg does not poll ClickUp, so the line stays amber with the reason and **Check again** |
| 10 | First task | assigns a ClickUp task in a bound List to the member **Unfold**, or hands it off from Tasks | Ploeg ingests the Assignment through the binding (Ploeg ADR-0095) | a Work Item exists for it |
| 11 | First task pull request | nothing; Now shows the Work Item moving | the Run opens a pull request | the second clock stops (`onboarding.first_task_pr_opened`); the first clock stops too if no readiness pull request came before |

**Two paths through the table.** A ready repository skips stages 7 and 8: 0–6,
9, 10, 11, and its first agent pull request is its first task pull request.
A repository that is not ready walks every stage; stages 4 and 5 can be done
while the readiness Run works, but stage 9 for that repository waits for
stage 8. A repository that is not ready for another reason (archived, a
mirror) is refused at stage 3 with that reason and offers no readiness pull
request.

**Installation prerequisites.** These are the one-time install values of v1.
The checklist's stage 1 shows each as a line, read from Ploeg where Ploeg
reports it; where it does not, the line stays "unknown" until the first call
that depends on it answers, and a `422 registration_not_accepted` or
`422 bindings_not_accepted` turns it red (state matrix).

| Prerequisite | Install value (Ploeg chart or config unless named) | Read from Ploeg |
|---|---|---|
| A Team exists | `executor.teams[]` has at least one entry; the chart ships `teams: []`, and ADR-0186 rules out creating Teams at runtime | Teams read |
| The Team has a spend cap | `executor.spendCap` or the Team's own `spendCap`, not null (chart default `{usd: 20, period: day}`) | Teams read (`spendCap`, null without one) |
| The Team accepts runtime bindings | `teams.<team>.trackerBindings.connections` lists the ClickUp connection by name (no wildcard in ADR-0186), and `max` | not reported; `422 bindings_not_accepted` on the dry run |
| The installation accepts runtime targets | `targetRegistration.enabled: true`, `targetRegistration.connections` (the GitHub connection id or `["*"]`), `targetRegistration.requireClaims` (and step-up if wanted) | not reported; `422 registration_not_accepted` on the dry run |
| Unfold's consumer may do it | the Unfold entry in `consumers[]` with `execute`, `bindScopes: true`, `registerTargets: true` and the Team in its `teams` | not reported; `403 permission_required` |
| Changes are proven | `attribution: proven` with person tokens (`audiences` or `clientIds` for Unfold's consumer), and Unfold's token exchange ([application ADR-0055](../../../apps/unfold/docs/adrs/0055-unfold-proves-the-person-to-ploeg-with-a-token-exchanged-from-their-sign-in.md)); registration and prepare refuse asserted attribution in every mode | partly: a probe read with the exchanged token |
| The person carries the claims | the identity provider issues the claims `targetRegistration.requireClaims` names to the Admin | not reported; `403 person_claim_required` |
| A secret store | Ploeg's `SecretStore` configured (OpenBao or Vault KV, or the Kubernetes Secret adapter with its Role); without one, store-backed connections fail closed (ADR-0184 rule 5) | not reported until the connection contract (section 4 ask 2) reports it |
| Egress | ploegd's network policy allows the configured vendor URLs (`api.github.com`, `github.com`, `api.clickup.com`); Unfold's allows GitHub's App pages and ClickUp's API | not reported; the first probe's failure names the host |
| A public webhook URL | Ploeg's public webhook URL, which Unfold puts into the App manifest's `hook_attributes.url` and Ploeg uses for ClickUp webhooks | the connections read's webhook state |

Two upstream asks (section 4, asks 3 and 4) would shrink this list: a
`trackerBindings.connections` value that means "every store-backed connection
of this Tenant", so the installer need not know the connection's name in
advance, and an onboarding values profile in Ploeg's chart that sets every
row above at once. Until both land, the installer sets each value and names
the ClickUp connection in `trackerBindings.connections` before stage 9 works;
the connection contract must let Unfold create the connection under that name.

**Why the ClickUp member, in the page's own words** (the onboarding has to make
D5 feel reasonable): "ClickUp has no bot accounts. Unfold works in ClickUp as a
normal member called Unfold, which takes one seat. A token always acts as the
person who created it, and ClickUp stops a webhook when the person who made it
leaves, so using your own account would make Unfold's comments look like yours
and break when you leave. Assigning a task to Unfold is how you hand it over."
The four steps: invite an address you control (for example
`unfold@<your domain>`) as a Member, open the invitation in a private window,
create the member's personal API token there, paste it here. The page links
ClickUp's token documentation from the adapter's guide, as ADR-0064 does.

### 2. State matrix

Rows are states, columns what the checklist shows and does. Every red line
names its fix; nothing fails silently.

| State | Stages affected | What the Admin sees | Fix button |
|---|---|---|---|
| **First time** | all | every line grey with its one action; nothing else in the navigation asks for attention | the first line's action |
| **Partial** (left after any stage) | the next unfinished one | done lines green, the next one highlighted; the clocks keep running, `onboarding.resumed` on return | the next action |
| **Failed check** (probe, readiness, token rejected, webhook missing) | 2–5, 7, 9 | the line red with each failed check by name, as Ploeg's dry run returned it (`probe_failed`, `agent_cannot_see_scope`, `target_not_ready`, `connection_token_rejected`) | the check's own fix, for example "Share the List with the Unfold member", then **Check again** |
| **Not ready, prepare available** | 3, 7, 9 | the repository registered, amber, "AGENTS.md missing"; offered for stage 7 and not for stage 9 | **Prepare this repository** |
| **Readiness pull request waiting for review** | 8, 9 | the repository amber with a link to the pull request; its Lists cannot be bound yet | **Open the pull request** |
| **Binding awaiting webhook** | 9 | the List amber: "Ploeg holds the binding but ClickUp sends it nothing yet", with Ploeg's reason | **Check again** |
| **Ploeg serves the step but the installation has not opted in** (`422 registration_not_accepted`, `422 bindings_not_accepted`, `403 permission_required`, `403 person_claim_required`) | 1, 3, 9 | the stage 1 line for that prerequisite red, naming the exact install value and that the person who installed Ploeg sets it | **Show the install values** (copyable, for the installer) |
| **Revoked install** (App uninstalled, repository removed from the installation, ClickUp member removed or token revoked) | 2–5, 9 | the connection red, every repository or List that depends on it amber "unreachable" (Ploeg ADR-0193 marks a target whose grant was withdrawn `invalid` and keeps it), hand-off and import refused with the same reason | **Reinstall** (GitHub's install page) or **Replace token** |
| **Shadowed by configuration** | 3, 5, 9 | the line says "Configured by the installation" and shows the configured entry; the runtime one is marked `shadowed` (Ploeg ADR-0186 section 4, application ADR-0064) | none; the configuration wins. "Remove the runtime entry" is offered |
| **Ploeg too old for the step** | 2–9 | the line says which Ploeg release adds the step and offers the configuration entry to paste instead | **Show the configuration entry** |
| **Ploeg contract major missing** | all | the existing ADR-0044 banner; managed actions paused | none in Unfold |
| **Not an Admin** | all | lines read-only, "Ask an administrator to connect this"; the Admins are not listed | none |
| **No spend cap** (Teams read `spendCap: null`) | 6, 7, 9 | readiness work refused, and a Team without a cap cannot be picked for a binding made during onboarding | **Ask your installer to set the Team's spend cap** (v1) |
| **Second forge on an installation that serves another** | 2, 3 | "This installation pushes to `<forge>`. Adding GitHub needs Ploeg `<release with ADR-0192>`." | none until the pinned Ploeg is that release |

### 3. Data model, mapped to ADR-0048

Unfold's store gains, by migration, the Unfold side of
[ADR-0048](../../../docs/adr/adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md)
(VIK-2248). Each row belongs to one Tenant; in v1 that is `default`.

| ADR-0048 concept | Unfold table | Key | Holds | Never holds |
|---|---|---|---|---|
| Integration Account | `tracker_connections`, renamed `integration_accounts` with a `role` (`tracker` or `forge`) and a `provider` | Tenant + provider + instance (API root) + account: the GitHub App installation id, or the ClickUp Workspace and member id. An agency may install one App on several GitHub organisations; each installation is its own account | account display name, the Ploeg connection id it mirrors, who added it, when the credential was last set, state | a credential (see section 5 for the ADR-0064 copy) |
| source | `tracker_connection_sources`, plus `client_project_id` | integration account + container id | name, the Ploeg binding id, the target it resolved to, state | a token |
| repository | `repositories` (new) | forge instance + `owner/name`, lower-cased, without `.git` (the key D2 of `tenant-client-scoping` already uses) | base branch, the Ploeg Work Target key, the integration account it was registered through, readiness facts last read (including `prepareAvailable`), maturity level, state | a token |
| Repository Grant | `repository_grants` (new) | client project + repository | who granted and when | |
| Client Project | `client_projects` (new) | Tenant + optional Client + slug | name, default Team, Budget share (later), `is_default` | |

- **Own work.** Each Tenant gets one Client Project with no Client and
  `is_default = true`, named "Own work", created on first use. Every source and
  repository saved during onboarding is in it, and every repository is granted
  to it. The screens hide Client Projects while the Tenant has no Client; the
  first Client added shows them, with Own work listed first.
- **Moving.** A source moves to another Client Project of the same Tenant by
  changing `client_project_id`; a repository is granted to another project by
  adding a grant. Both keep their identity (ADR-0048: the key is instance plus
  container). A Work Item already created keeps the Client Project of its
  origin. Moving is in a later slice; the model allows it from the first one.
- **Configured entries** stay in configuration and are mirrored into the
  running workbench read-only, as saved sources already are; they belong to Own
  work unless they name a Client.
- **Running workbench.** `sync()` extends from sources to repositories: stored
  repositories join `config.repositories` after the configured ones, so the
  existing tenancy, hand-off and session code sees one list. A stored source
  with an `active` binding gets `ploeg: { target }` from it, which closes the
  `task_binding_unconfigured` gap.

### 4. Unfold ↔ Ploeg calls, in order

Unfold calls Ploeg only through its operator API with its operator consumer
and the person's exchanged token
([application ADR-0055](../../../apps/unfold/docs/adrs/0055-unfold-proves-the-person-to-ploeg-with-a-token-exchanged-from-their-sign-in.md)),
so every change is attributed to a proven Admin (Ploeg ADR-0171). Route names
are illustrative where the owning record has not fixed them.

| Step | Call | Owning record | Before it, Unfold checks |
|---|---|---|---|
| a | `GET /api/v1/operator/version` | ADR-0044 | the served contract majors; the release, against the pinned bundle version (section 7) |
| b | `GET /api/v1/operator/connections`, `GET /api/v1/operator/teams` | Ploeg ADR-0129, ADR-0162 | — (reads; drive the stage 1 lines and every line's state) |
| c | ask Ploeg for an OAuth `state` for this person and flow | connection contract (ask 2) | Admin |
| d | create a GitHub forge connection from the App manifest code; Ploeg converts it with `POST /app-manifests/{code}/conversions` and stores the key, webhook secret and client secret | connection contract (ask 2), ADR-0184 | the callback's `state` is one Ploeg issued in (c) **and** Unfold tied to this person's session (section 6) |
| e | relay the installation id GitHub returns; Ploeg verifies it with an App JWT | connection contract (ask 2) | the same two `state` checks |
| f | `GET /api/v1/operator/forge-connections/{connection}/repositories` | Ploeg ADR-0193 | — |
| g | `POST /api/v1/operator/targets?dryRun=true`, then without `dryRun` | Ploeg ADR-0193 | Admin; the repository is in (f) |
| h | create a ClickUp tracker connection from a pasted token; the answer names the account | connection contract (ask 2), ADR-0184 rule 1 as amended | shape check, ClickUp accepts it, not the Admin's own account |
| i | `POST /api/v1/operator/work-items` with `kind: "prepare_repository"`, the Team, the target and `budgetUsd` | Ploeg ADR-0194 | a person confirmed the cap shown; the target reports `prepareAvailable: true`; the Team's `spendCap` is not null |
| j | `POST /api/v1/operator/teams/{team}/tracker-bindings?dryRun=true`, then without `dryRun` | Ploeg ADR-0186 | Admin; the List's source is saved; `default` and `allow` name only **ready** targets from (g) or the static file; the Team's `spendCap` is not null |
| k | the existing Work Item, Run, pull request and events reads (`target.readiness_changed`, `tracker_binding.*`, `work_target.*`) | operator API v1 | — |

Five upstream asks follow from this order. All are in ploeg-hq's words,
naming no consumer; asks 1 to 3 are carried by the proposed amendments
(ploeg-hq/ploeg follow-up PR):

1. **The connection's own account is the hand-over assignee** (ADR-0186
   amendment). ADR-0186 keeps `trackers.clickup.agents` static, so a member
   created during onboarding would still need a file edit before an
   Assignment reaches Ploeg. Ask: a store-backed tracker connection may
   declare its own account as an agent for bindings on that connection.
2. **A connection contract** (ADR-0184 amendment). Operator routes to create
   a store-backed connection from an OAuth authorization code, a GitHub App
   manifest code, a GitHub installation id or a pasted token; to list
   connections and read each one's state (usable, credential refused, store
   missing); to replace its credential; to delete it; and to issue the OAuth
   `state` the relay must carry. ADR-0184 rule 1 is being amended to allow a
   pasted token where the installation has no OAuth app registered with that
   vendor, which is the self-hosted ClickUp case (D5). The same amendment of
   ADR-0193 covers the GitHub forge receiver: it must handle `installation`
   and `installation_repositories` events and verify them with the webhook
   secret held in the store, not an environment value.
3. **Store-backed connections in `trackerBindings.connections`** (ADR-0186
   amendment). A value that admits every store-backed connection of the
   Tenant, so the installer need not name a connection before it exists.
4. **An onboarding values profile** in Ploeg's chart that sets the
   prerequisites of section 1 together (a Team with a spend cap, the binding
   and registration opt-ins, the consumer permissions, proven attribution, a
   secret store), so the installer sets one value and a few names.
5. **Active forges per installation in `/operator/connections`.** The version
   route reports the release and contract majors only, so Unfold cannot tell
   from it whether Ploeg resolves a Run's forge per target (ADR-0192). Ask:
   `/connections` reports the forges the installation serves and whether
   targets on several forges are supported.

### 5. Credential custody per provider

| Credential | Who receives it | Where it lives | Who reads it | Unfold's DB |
|---|---|---|---|---|
| GitHub App private key, webhook secret, client secret | Ploeg, from the manifest conversion | Ploeg's secret store (OpenBao/Vault KV or a Kubernetes Secret Ploeg created) | Ploeg only in v1; from S9 also Unfold (D8) | nothing |
| GitHub installation tokens | minted per Run by Ploeg | memory only | Ploeg | nothing |
| ClickUp member token, self-hosted | the Admin pastes it once into Unfold, which relays it to Ploeg | Ploeg's secret store, write-only | Ploeg | see below |
| ClickUp OAuth token, hosted | Ploeg, from the code exchange as that member | Ploeg's secret store | Ploeg | nothing |
| ClickUp webhook secret | Ploeg, when it registers the webhook | Ploeg's secret store (`WebhookSecretSink`) | Ploeg | nothing |
| People's own linked ClickUp and GitHub accounts | unchanged (application ADR-0016) | Unfold's store, sealed | Unfold, for browsing as that person | unchanged |

**The ClickUp copy in Unfold.** Unfold reads tasks and hands them off with the
source's token today (application ADR-0064 and 0025). With the token only in
Ploeg's store, Unfold cannot do either. v1 keeps ADR-0064's sealed copy: the
one paste goes to Ploeg's store and into Unfold's `internal_state`, and the
page says so. This is the one place a connection secret stays in Unfold's
database in v1, named as an exception in
[ADR-0059](../../../docs/adr/adr-0059-an-organisation-connects-its-forge-and-tracker-from-unfold-and-ploeg-learns-its-repositories-and-boards-at-runtime.md).
It goes away before hosted: Unfold's service reads go through Ploeg or through
people's own links, and hand-off becomes a Ploeg action. See Open Questions 1.

**The shared App key (D8), from S9.** v1 needs no GitHub key in Unfold: the
repository picker, Work Items, Runs and pull requests all come through Ploeg.
When GitHub Issues becomes a tracker (S9), Unfold reads issues as the App and
needs the key. S9 designs the mount (the Unfold chart has none for a Secret
Ploeg writes today), and must resolve that a manifest-created App's `appId`
exists only at runtime, so it cannot be a chart value; Unfold reads it from
Ploeg's connection read instead. The hardening slice (S10) replaces the shared
key with short-lived read tokens Ploeg mints. Unfold's publisher token
(`delivery.publisher.tokenEnv`) is unchanged by this change.

### 6. Security

- **Who.** Every connect, register, bind, unbind and prepare action needs an
  Admin, and under `tenancy.enforce` an Admin membership of the Tenant (D11).
  Ploeg checks again: proven person, the consumer's `bindScopes`,
  `registerTargets` and Team scope, the person's `requireClaims`, the Team's
  `trackerBindings` opt-in and `targetRegistration`.
- **Out of Tenant is absent.** An integration account, source, repository or
  project of another Tenant answers the same 404 as a missing one, before any
  vendor or Ploeg request ([ADR-0017](../../../docs/adr/adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md)).
- **Audit.** Each change is an OCSF Entity Management record in the Tenant's
  chain (the `ocsf-audit` change, as ADR-0064 records tracker connections):
  Integration Account create, update with `credential_replaced`, delete;
  Repository register and unregister; Tracker binding create and remove;
  Client Project create; Repository Grant add and remove; Readiness Work Item
  confirmed, with the confirmed cap. Refused attempts are failures.
  No record carries a secret, a manifest code or an installation token.
- **No secret in Unfold's database**, logs, action records, product events or
  responses, except the ADR-0064 ClickUp copy above. The manifest conversion
  code and the installation id pass through Unfold's server once and are
  never stored or logged.
- **OAuth `state`, two bindings.** Ploeg issues the `state` (connection
  contract, ask 2), accepts it once and checks it on the relay. Unfold also
  ties it to the person's session: it keeps a hash of the `state` with the
  session id and the time, accepts a callback only from the same signed-in
  person within ten minutes, and forgets the hash on first use. A callback
  failing either check is `400 onboarding_state_invalid` and relays nothing.
- **Redirects.** The manifest's `redirect_url` and the App's setup URL point at
  Unfold's own origin and a fixed path. The code arrives in that URL's query
  string, so the path is excluded from Unfold's request logs, and the
  installer's ingress access logs are named as a risk (Risks).
- **Least privilege at the vendor.** The App manifest asks for the permissions
  Ploeg ADR-0086 lists and nothing else; the Admin installs it on selected
  repositories, never "All repositories" by default. The ClickUp member is
  invited as a Member to the Spaces it needs, never as an owner or admin
  (Ploeg ADR-0184 rule 4); see Risks for what a Member can still see.
- **Content never selects authority** (ADR-0048): a task cannot choose a
  repository; only a binding's registered targets can.

### 7. When Ploeg does not serve a step yet

Unfold follows ADR-0044: it sends nothing Ploeg cannot answer, stays usable,
and says why.

- The new routes are optional reads and writes in Unfold's expectation set
  ([ploeg-expectations.json](../../../apps/unfold/src/ploeg-expectations.json)),
  each tied to its owning Ploeg record. The version route reports contract
  majors, not routes, so Unfold learns whether Ploeg serves a step from the
  step's read route (a `404` on `GET …/tracker-bindings` means "not served").
  It never probes with a write.
- **Per-target forges (ADR-0192)** have no route to read. Unfold gates the
  second-forge case on the pinned Ploeg bundle version: the release that
  ships ADR-0192 is recorded in the expectation set, and a lower pin keeps
  the "second forge" state. Once `/operator/connections` reports active
  forges per installation (section 4, ask 5), Unfold reads it from there.
- A step Ploeg does not serve shows **refuse with explanation**: "This Ploeg
  (`<release>`) does not register repositories at runtime yet. Ploeg
  `<release>` adds it." with the configuration entry for that step folded
  below, as the setup page already offers "Keep it in the server configuration
  instead". The refusal is `503 ploeg_step_unavailable`, sent before any
  request, and is recorded once per step and release.
- A step Ploeg serves but the installation has not opted in to is a
  different state (section 2): Ploeg answers `422 registration_not_accepted`
  or `422 bindings_not_accepted` to the dry run, which writes nothing, and the
  stage 1 line names the install value.
- Each slice therefore ships before its Ploeg part: it shows the step, refuses
  it with the reason, and turns on by itself when the pin moves.

### 8. Migration from configuration-only installs

- Nothing is migrated. Configured `repositories[]` and `taskSources[]` stay,
  load into the same objects, and win (D10). Ploeg's static `targets` and
  `trackers.*.projects` stay and win (ADR-0186, ADR-0193).
- An installation with any configured source or repository does not trigger
  onboarding: no landing on the checklist and no `onboarding.started`.
- On first view the checklist shows configured entries as green or red lines
  marked "Configured by the installation", read from Ploeg's connections read,
  so an existing installation sees its state without doing anything.
- The spend-cap gate applies only to readiness work and to Teams bound during
  onboarding. Hand-off on an installation with configured sources is never
  refused by it.
- An operator who wants an entry managed from the screen removes it from the
  file and adds it on the screen, as ADR-0186 describes for Ploeg. The page
  says this and never offers to rewrite the file.
- Saved sources from before this change keep working; the next `sync()` gives
  them a `ploeg` target when Ploeg has a static route or an active binding for
  their List, which fixes `task_binding_unconfigured` for them too.
- **An installation that already serves another forge** cannot add GitHub
  until the pinned Ploeg ships ADR-0192, because Ploeg's workers push to one
  forge per installation today. The owner's own installation (Forgejo) is in
  exactly this state. For it, stages 2 and 3 show the "second forge" state,
  and every slice that adds GitHub names ADR-0192 as its prerequisite there.

### 9. Metrics

First-party product events (ADR-0023): pseudonymous actor, Tenant, no screen
text.

| Event | When | Props |
|---|---|---|
| `onboarding.started` | once per Tenant: the first sign-in of an Admin while the Tenant has no source and no repository, stored or configured | — |
| `onboarding.step_completed` | a checklist line turns green for the first time | `step`, seconds since start |
| `onboarding.step_failed` | a line turns red | `step`, error code |
| `onboarding.step_refused` | a step refused because Ploeg does not serve it or the installation has not opted in | `step`, Ploeg release, reason |
| `onboarding.first_agent_pr_opened` | the first agent pull request of any kind on a registered repository of the Tenant | seconds since start, `kind` (`readiness` or `task`) |
| `onboarding.first_task_pr_opened` | the first agent pull request for a tracker task on a registered repository of the Tenant | seconds since start, whether a readiness pull request came first |

- **Time to first agent pull request**: p50 and p90 of
  `first_agent_pr_opened − started`, target p50 under 15 minutes.
- **Time to first task pull request**: p50 and p90 of
  `first_task_pr_opened − started`, reported split by whether a readiness
  pull request came first. No target for the split that includes a human
  review; the ready-repository split shares the 15-minute target.
- **Drop-off**: the share of Tenants that start and never reach each step.
- **Failure codes** per step, to find the check that costs the most time.
- On a self-hosted installation these stay inside it unless its operator sets
  the optional sink; the owner's dogfood trials (tasks.md) are how the project
  itself sees the numbers in v1.

### 10. Hosted later, without rework

| Hosted piece | Where it attaches | What v1 must not do |
|---|---|---|
| Tenants per Agency, `tenancy.enforce` | every table already has a Tenant; v1 writes `default` | assume one Tenant in a query |
| Zitadel broker (ADR-0058) | stage 0 | depend on local login |
| `Tenant` operator, Ploeg's Tenant (Ploeg ADR-0178) | Ploeg's store path and consumer per Tenant; the install values of section 1 become the operator's per Tenant | put Tenant-wide secrets in Unfold |
| ClickUp OAuth through Unfold's own ClickUp app | stage 4 swaps the paste for consent as the member; Ploeg does the exchange | assume a pasted token |
| Ploeg-only App key (D8 hardening) | Unfold's reads switch to short-lived tokens Ploeg mints | read the key outside `github-app.ts` |
| Multi-forge (Ploeg ADR-0192) | stage 2 for a second forge | assume one forge per Tenant in Unfold's model |

## Risks / Trade-offs

- [Five upstream records, all proposed, and five asks] → each slice ships
  with its refuse-with-explanation state, so Unfold never waits on Ploeg to
  merge; the journey is complete only when the records and asks 1 and 2 are
  released.
- [One-time install values remain] → v1 is self-serve from first sign-in,
  not from install. Stage 1 names each missing value; asks 3 and 4 shrink the
  list.
- [The task clock includes a human review] → for a repository that is not
  ready, time to first task pull request includes a person reviewing the
  readiness pull request. It is measured and reported, not promised.
- [Run durations are unmeasured] → the 15-minute goal assumes a readiness Run
  opens its pull request in a few minutes. Nobody has measured a
  `prepare_repository` Run or a first task Run on an unknown repository yet;
  the dogfood trial is the first measurement.
- [A ClickUp seat is a real cost and a real member] → the page says so before
  the steps; the opt-in trigger stays a later slice for organisations that
  refuse it; T48 is watched.
- [ClickUp member invite scoping] → not verified: whether a Member invited to
  chosen Spaces can still see every public Space of the Workspace, or whether
  only a Guest is scoped (and what a Guest seat costs and may do). If Members
  see everything, ADR-0184 rule 4's least privilege needs private Spaces or a
  Guest.
- [Tag lower-casing versus `repo/<key>`] → ClickUp lower-cases tags, and
  Ploeg derives a runtime key `<forge>:<owner>:<name>` that may carry capitals.
  A `repo/<key>` tag could then never match. Unfold registers every runtime
  target with an explicit lower-case key; whether Ploeg compares labels
  case-insensitively is not verified.
- [GitHub manifest code lifetime and who may create an organisation App] →
  not verified: how long the manifest conversion code lives, and whether an
  App owned by an organisation needs an organisation owner (or an App manager)
  to create and install it. If it does, an Admin who is not one is stuck at
  stage 2; the page must say so before sending them to GitHub.
- [Access logs and the callback code] → the manifest code and installation id
  arrive in a query string. Unfold excludes the path from its own logs; not
  verified whether the installer's ingress or proxy access logs record it.
  The code is one-time and short-lived, which bounds the damage.
- [The Admin pastes their own token] → refused when Unfold can see it is the
  Admin's own account; otherwise the page states whose account it is before
  saving.
- [ClickUp copy in Unfold (section 5)] → kept for v1 by the owner; removed in
  S10.
- [Shared App key (D8), from S9] → a compromised Unfold pod could mint write
  tokens for every installed repository. Accepted for self-hosted from S9 by
  the owner; the key is mounted only into the server pod, never into agent
  workspaces, and S10 removes it before hosted.
- [Two sources of routes] → the checklist is the one place that shows both,
  with `source: static | runtime` from Ploeg.
- [An installation already on another forge] → blocked on ADR-0192, shown as
  its own state; the owner's installation needs it before dogfooding GitHub.
- [Webhooks need a public Ploeg endpoint] → an install prerequisite, checked
  in stage 1 from Ploeg's connections read; a binding without a webhook stays
  `awaiting_webhook` and is not done.

## Migration Plan

Section 8. Each slice is behind no flag of its own: a step is visible and
refused until Ploeg serves it. Rollback is removing the runtime entries on the
screen; configured entries are never touched.

## Slices

Thin vertical slices, each shippable alone, in order. "Waits for" names the
upstream change that turns the slice from refused to working.

| # | Slice | Ships | Waits for |
|---|---|---|---|
| S1 | Checklist backbone | Connections becomes the checklist with a fix button per line; Admin lands there when the Tenant has no source or repository; configured entries shown; stage 1 installation lines from the Teams and connections reads; "How connections work" rewritten; onboarding events | nothing (Ploeg ADR-0129 and the Teams read are served) |
| S2 | Saved sources get their Ploeg target | `sync()` gives a saved source the target of the static route that covers its List; `task_binding_unconfigured` gone for those | nothing; extended to runtime bindings in S5 |
| S3 | Repositories and Own work in Unfold's store | `repositories`, `client_projects`, `repository_grants`, `integration_accounts` (keyed with the installation or account id); Own work; configured entries mirrored | nothing |
| S4 | Connect GitHub and register repositories | Ploeg-issued `state` tied to the session, manifest flow, install, list, runtime registration with `prepareAvailable` shown | the **connection contract** (ask 2, ADR-0184 amendment), Ploeg ADR-0193 with its amendment's GitHub receiver; **and Ploeg ADR-0192 on any installation that already serves another forge** (gated on the pinned bundle version until ask 5) |
| S5 | Connect ClickUp and bind Lists | member guide, paste to Ploeg's store, pick Lists, map to **ready** repositories and Team, bindings done only when `active` | the **connection contract** (ask 2, including ADR-0184 rule 1's amended paste), ADR-0186 with ClickUp `ScopeProber`, ask 1 (connection account is the agent); ask 3 or the installer naming the connection |
| S6 | Spend-cap gate | the Team's `spendCap` read and confirmed before readiness work and onboarding bindings | Ploeg's Teams read (served); a runtime change is not in v1 |
| S7 | Readiness pull request | the offer from `prepareAvailable`, the cap and confirmation, progress, review-and-merge line, re-inspection | Ploeg ADR-0194 |
| S8 | First task to first pull request, measured | the guided last step, both clocks, the two figures in Insights | S4, S5 released |
| S9 | GitHub Issues as the tracker, with the shared App key (D8) | the same App as tracker, Lists replaced by repositories' issues; the key mount and the runtime `appId` read | GitHub Issues hand-off in Ploeg (the team read reporting GitHub logins, see the `jira-tracker` change); a Ploeg read of the App's `appId` |
| S10 | Hardening before hosted | Ploeg-only App key with short-lived read tokens; Unfold's ClickUp copy retired | a Ploeg route that mints read tokens; service reads and hand-off through Ploeg |
| S11 | Move sources and repositories between projects | the project screens once a Client exists | S3 |

## Open Questions

Each needs the owner. The plan follows the recommendation until he decides.

1. **The ClickUp token copy in Unfold.** D3 and D5 put the token in Ploeg's
   store only; Unfold's Tasks page and hand-off need it today. Recommended: v1
   keeps ADR-0064's sealed copy as a named exception (section 5), retired in
   S10 together with D8's hardening. Alternative: browse with people's own
   links and make hand-off a Ploeg action in v1, which adds a Ploeg contract
   to the critical path.
2. **Changing the spend cap at runtime.** v1 reads and confirms the cap the
   chart installs. Recommended: keep it so for self-hosted; a runtime Team
   cap contract in Ploeg is needed for hosted and should be asked for with
   S10.
3. **Readiness pull request versus the 15 minutes.** Decided by the lead on
   2026-11-17: two clocks (Thesis). The first agent pull request of any kind
   stops the 15-minute clock; time to first task pull request is measured
   separately with no promise when a readiness pull request comes first.
4. **The upstream asks of section 4.** Asks 1 to 3 are being raised as the
   proposed amendments to Ploeg ADR-0184, 0186 and 0193 (ploeg-hq/ploeg
   follow-up PR). Recommended: raise asks 4 (onboarding values profile) and 5
   (active forges in `/connections`) as issues in ploeg-hq, not as records.
