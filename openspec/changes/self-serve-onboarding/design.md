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
  `target_not_ready` otherwise).

Upstream records this design depends on, all **proposed**; ADR-0193 and ADR-0194 are in
[ploeg-hq/ploeg#421](https://github.com/ploeg-hq/ploeg/pull/421), not merged yet:

| Record | What it gives this journey |
|---|---|
| [Ploeg ADR-0184](../../../apps/ploeg/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md) | store-backed forge and tracker connections; Ploeg does the OAuth or code exchange; a pasted token goes straight to the store |
| [Ploeg ADR-0186](../../../apps/ploeg/docs/adrs/0186-an-operator-consumer-binds-a-tracker-scope-to-a-team-at-runtime-and-static-routing-wins-on-conflict.md) | runtime tracker bindings with a dry run, probes, webhooks, static wins |
| [Ploeg ADR-0192](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md) | a Run's forge comes from its Work Target (the VIK-2247 fix); supersedes Ploeg ADR-0023 |
| [Ploeg ADR-0193](https://github.com/ploeg-hq/ploeg/pull/421): a proven operator registers a Work Target at runtime only for a repository Ploeg's forge connection was granted, and static targets win on conflict | a repository is registered only when Ploeg's own store-backed forge connection (ADR-0184) was granted it, a proven Admin asks, and it passes readiness; a withdrawn grant marks the target `invalid`, never deleted |
| [Ploeg ADR-0194](https://github.com/ploeg-hq/ploeg/pull/421): a repository missing only its instruction file may receive one kind of work, a Run whose only deliverable is a pull request that adds it | a Run that writes `AGENTS.md` from the real code and may change nothing else; a proposed default cap of USD 2.00 per Team for such Runs |

## Goals / Non-Goals

**Goals:**

- An Admin goes from first sign-in to a first agent pull request in under 15
  minutes, alone, on a self-hosted installation with one organisation.
- Every step is a line on one checklist that says what is done, what failed
  and the one button that fixes it.
- No person handles a secret the vendor lets us avoid; where one must be
  pasted, it is pasted once and never shown again.
- A configured installation keeps working unchanged.
- The same code serves the hosted offer later
  ([ADR-0050](../../../docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md) rule 7).

**Non-Goals:** as in [proposal.md](proposal.md#non-goals).

## Decisions

The owner decided D1 to D11 on 2026-11-17. They are cited here, not reopened.

| # | Decision |
|---|---|
| D1 | First version: self-hosted, one organisation, but the flow is designed as an agency Admin walks it, so the same code goes hosted later. Multi-tenant hosting pieces (ADR-0009 isolation, the Zitadel broker of ADR-0058, the `Tenant` operator) are out of scope; the design must not block them. |
| D2 | Ploeg learns about boards and repositories at runtime through a generic operator API; its static file stays a seed and wins on conflict. Boards: Ploeg ADR-0186. Repositories: runtime Work Target registration, now Ploeg ADR-0193. |
| D3 | Apps and OAuth first; no pasted secret where the vendor allows. Ploeg holds connection secrets and does the OAuth code exchange itself, writing to its secret store (Ploeg ADR-0184). Exception: D8. |
| D4 | First pair: GitHub as the forge (a GitHub App, created by a self-hoster with GitHub's App manifest flow in one click) and ClickUp as the tracker. Then GitHub Issues. Linear stays where ADR-0050's tracker order puts it unless a pilot agency uses Linear; Linear's `actor=app` agents need no seat, and watchlist item T48 tracks ClickUp opening assignable external agents. |
| D5 | ClickUp identity: a dedicated ClickUp member "Unfold" (one paid seat). Self-hosted: its token is pasted once and goes write-only to Ploeg's store. Hosted: OAuth through Unfold's own ClickUp app, consented as that member. The onboarding makes creating the member easy and explains why. Optional later: a status or tag trigger, opt-in, for organisations without the seat. |
| D6 | Connections first, projects later: everything lands in a silent default Client Project, **Own work** (ADR-0048). Projects appear in the screens only when a Client is added; moving sources and repositories between projects must be possible later. |
| D7 | A new repository's first Work Item is a readiness pull request from Ploeg's prepare-repository kind, for a repository that is not ready only because `AGENTS.md` is missing; its cost is shown and a person confirms it. Tied to ADR-0047's levels. |
| D8 | For now Unfold and Ploeg read the same GitHub App key from one secret. Before hosted: only Ploeg holds the key and hands Unfold short-lived read tokens. |
| D9 | Runtime repository registration as in D2. |
| D10 | Configuration-file sources keep winning (application ADR-0064); time to first pull request is a first-party event (ADR-0023); multi-forge workers (VIK-2247, now Ploeg ADR-0192) do not block v1 for a single-forge organisation but do block hosted and any installation that already serves another forge. |
| D11 | Only an Admin (a Tenant Admin under `tenancy.enforce`) connects accounts and adds repositories and Lists in v1. This answers application ADR-0064 open question 2 for now. |

The rest of this section is the design within them.

### 1. The journey, stage by stage

The checklist is Settings → Connections. A signed-in Admin of a Tenant with no
Integration Account lands there instead of on Now. Each stage is one checklist
line; the line is green when its check passes against live state, not when a
form was submitted. A person who is not an Admin sees the same lines read-only
with "An Admin connects this".

| # | Stage | What the Admin does | What happens underneath | Done when |
|---|---|---|---|---|
| 0 | Sign in | signs in through the installation's OIDC | the onboarding clock starts (`onboarding.started`) | the checklist is shown |
| 1 | Connect GitHub | **Create the GitHub App** (manifest flow) or **Use an existing App** if the installation already has one, then **Install** and pick repositories on GitHub's own page | Ploeg converts the manifest code, stores key, webhook secret and client secret; Ploeg verifies the installation belongs to its App | Ploeg reports a GitHub forge connection that reaches at least one repository |
| 2 | Pick repositories | ticks repositories from the list the installation reaches | Unfold dry-runs runtime Work Target registration for each, then registers; stores the repository and grants it to Own work | each picked repository is registered, or shows `not ready: AGENTS.md missing` with the readiness offer |
| 3 | Connect ClickUp | follows **Create the Unfold member** (four steps), pastes that member's token once | Unfold checks the token's shape and that ClickUp accepts it, refuses the Admin's own account, relays the token to Ploeg's store | Ploeg reports a ClickUp connection whose account is the Unfold member |
| 4 | Pick Lists | picks Lists by name from the Workspace | Unfold saves each as a source in Own work | each List is saved |
| 5 | Map List → repositories and Team | for each List: the default repository, optional further repositories (repo labels), the Team (preselected when there is one) | Unfold dry-runs a Ploeg ADR-0186 binding, shows each check, then creates it; the saved source takes the binding's target | the binding is `active`, or `awaiting_webhook` with the reason |
| 6 | Budget | reads the hard cap and confirms it | Unfold reads the Team's enforced Budget from Ploeg; no account without a hard Budget (ADR-0005); the shipped default is ADR-0006's €100 a month | the Admin confirmed a non-zero enforced cap |
| 7 | Readiness pull request | for each repository missing only `AGENTS.md`: reads the estimate, **Prepare this repository** | Unfold asks Ploeg for a prepare-repository Work Item with a Shift Budget; a person confirms the cost first | the readiness pull request is open; after merge the repository re-checks as ready (ADR-0047 Level 2) |
| 8 | First task | assigns a ClickUp task in a bound List to the member **Unfold**, or hands it off from Tasks | Ploeg ingests the Assignment through the binding (Ploeg ADR-0095) | a Work Item exists for it |
| 9 | First pull request | nothing; Now shows the Work Item moving | the Run opens a pull request | `onboarding.first_pr_opened`; the clock stops |

Stage 7 and stage 8 can run in parallel when a repository is already ready.
The readiness pull request counts for stage 9 only if it targets the
organisation's own repository, which it always does; the measure therefore
records which kind of Work Item stopped the clock.

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
| **Partial** (left after any stage) | the next unfinished one | done lines green, the next one highlighted; the clock keeps running, `onboarding.resumed` on return | the next action |
| **Failed check** (probe, readiness, token rejected, webhook missing) | 1–5, 7 | the line red with each failed check by name, as Ploeg's dry run returned it (`probe_failed`, `agent_cannot_see_scope`, `target_not_ready`, `connection_token_rejected`) | the check's own fix, for example "Share the List with the Unfold member", then **Check again** |
| **Revoked install** (App uninstalled, repository removed from the installation, ClickUp member removed or token revoked) | 1–5 | the connection red, every repository or List that depends on it amber "unreachable" (Ploeg ADR-0193 marks a target whose grant was withdrawn `invalid` and keeps it), hand-off and import refused with the same reason | **Reinstall** (GitHub's install page) or **Replace token** |
| **Shadowed by configuration** | 2, 4, 5 | the line says "Configured by the installation" and shows the configured entry; the runtime one is marked `shadowed` (Ploeg ADR-0186 section 4, application ADR-0064) | none; the configuration wins. "Remove the runtime entry" is offered |
| **Ploeg too old for the contract** | 1–7 | the line says which Ploeg release adds the step and offers the configuration entry to paste instead | **Show the configuration entry** |
| **Ploeg contract major missing** | all | the existing ADR-0044 banner; managed actions paused | none in Unfold |
| **Not an Admin** | all | lines read-only, "An Admin connects this", with who the Admins are | none |
| **Budget unset or zero** | 6, 7 | stage 7 and hand-off refused until a hard cap exists | **Ask your installer to set the Team Budget** (v1) |
| **Second forge on an installation that serves another** | 1, 2 | "This installation pushes to `<forge>`. Adding GitHub needs Ploeg `<release with ADR-0192>`." | none until ADR-0192 ships |

### 3. Data model, mapped to ADR-0048

Unfold's store gains, by migration, the Unfold side of
[ADR-0048](../../../docs/adr/adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md)
(VIK-2248). Each row belongs to one Tenant; in v1 that is `default`.

| ADR-0048 concept | Unfold table | Key | Holds | Never holds |
|---|---|---|---|---|
| Integration Account | `tracker_connections`, renamed `integration_accounts` with a `role` (`tracker` or `forge`) and a `provider` | Tenant + provider + instance (API root) | account display name, the Ploeg connection id it mirrors, who added it, when the credential was last set, state | a credential (see section 5 for the ADR-0064 copy) |
| source | `tracker_connection_sources`, plus `client_project_id` | integration account + container id | name, the Ploeg binding id, the target it resolved to, state | a token |
| repository | `repositories` (new) | forge instance + `owner/name`, lower-cased, without `.git` (the key D2 of `tenant-client-scoping` already uses) | base branch, the Ploeg Work Target key, readiness facts last read, maturity level, integration account, state | a token |
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
  with a live binding gets `ploeg: { target }` from it, which closes the
  `task_binding_unconfigured` gap.

### 4. Unfold ↔ Ploeg calls, in order

Unfold calls Ploeg only through its operator API with its operator consumer
and the person's exchanged token
([application ADR-0055](../../../apps/unfold/docs/adrs/0055-unfold-proves-the-person-to-ploeg-with-a-token-exchanged-from-their-sign-in.md)),
so every change is attributed to a proven Admin (Ploeg ADR-0171). Route names
are illustrative.

| Step | Call | Owning record | Before it, Unfold checks |
|---|---|---|---|
| a | `GET /api/v1/operator/version` | ADR-0044 | the served contracts include the routes below (section 7) |
| b | `GET /api/v1/operator/connections` | Ploeg ADR-0129 | — (read; drives every line's state) |
| c | create a GitHub forge connection from an App manifest code; Ploeg converts it with `POST /app-manifests/{code}/conversions` and stores the key, webhook secret and client secret | Ploeg ADR-0184 (needs the manifest code as an accepted grant) | Admin, OAuth `state` bound to the person and issued by Ploeg |
| d | relay the installation id GitHub returns; Ploeg verifies it with an App JWT | Ploeg ADR-0184 | the same `state` |
| e | list the repositories the forge connection reaches | Ploeg ADR-0193 | — |
| f | register a Work Target, `dryRun=true` first, then for real | Ploeg ADR-0193 | Admin; the repository is in (e) |
| g | create a ClickUp tracker connection from a pasted token (ADR-0184's paste fallback); the answer names the account | Ploeg ADR-0184 | shape check, ClickUp accepts it, not the Admin's own account |
| h | `POST /api/v1/operator/teams/{team}/tracker-bindings?dryRun=true`, then without `dryRun` | Ploeg ADR-0186 | Admin; the List's source is saved; `default` and `allow` name targets from (f) or the static file |
| i | read the Team's enforced Budget | Ploeg's Team and budget reads | — |
| j | create a prepare-repository Work Item, estimate first, then with the confirmed Shift Budget | Ploeg ADR-0194 | a person confirmed the shown cost |
| k | the existing Work Item, Run and pull request reads | operator API v1 | — |

Two upstream asks follow from this order, and the plan cannot work without
them. Both are in ploeg-hq's words, naming no consumer:

1. **The connection's own account is the hand-over assignee.** ADR-0186 keeps
   `trackers.clickup.agents` static, so a member created during onboarding
   would still need a file edit before an Assignment reaches Ploeg. Ask: a
   store-backed tracker connection may declare its own account as an agent for
   bindings on that connection (ADR-0186 section 1, "out of the binding").
2. **A manifest code and an installation id are grants ADR-0184 accepts.**
   ADR-0184 describes the OAuth authorization code; GitHub's manifest flow
   returns a conversion code and the install returns an installation id.

### 5. Credential custody per provider

| Credential | Who receives it | Where it lives | Who reads it | Unfold's DB |
|---|---|---|---|---|
| GitHub App private key, webhook secret, client secret | Ploeg, from the manifest conversion | Ploeg's secret store (OpenBao/Vault KV or a Kubernetes Secret Ploeg created) | Ploeg; and Unfold reads the private key from the same secret, mounted read-only as `privateKeyFile` (D8) | nothing |
| GitHub installation tokens | minted per Run by Ploeg; minted by Unfold for its own reads (D8) | memory only | the minter | nothing |
| ClickUp member token, self-hosted | the Admin pastes it once into Unfold, which relays it to Ploeg | Ploeg's secret store, write-only | Ploeg | see below |
| ClickUp OAuth token, hosted | Ploeg, from the code exchange as that member | Ploeg's secret store | Ploeg | nothing |
| ClickUp webhook secret | Ploeg, when it registers the webhook | Ploeg's secret store (`WebhookSecretSink`) | Ploeg | nothing |
| People's own linked ClickUp and GitHub accounts | unchanged (application ADR-0016) | Unfold's store, sealed | Unfold, for browsing as that person | unchanged |

**The ClickUp copy in Unfold.** Unfold reads tasks and hands them off with the
source's token today (application ADR-0064 and 0025). With the token only in
Ploeg's store, Unfold cannot do either. v1 keeps ADR-0064's sealed copy: the
one paste goes to Ploeg's store and into Unfold's `internal_state`, and the
page says so. This is the one place a connection secret stays in Unfold's
database, and it is named as the second exception beside D8 in
[ADR-0059](../../../docs/adr/adr-0059-an-organisation-connects-its-forge-and-tracker-from-unfold-and-ploeg-learns-its-repositories-and-boards-at-runtime.md).
It goes away with the same hardening as D8, before hosted: Unfold's service
reads go through Ploeg or through people's own links, and hand-off becomes a
Ploeg action. See Open Questions 1.

**The shared App key (D8).** Ploeg writes the key; the Unfold chart mounts the
same Secret read-only as a file (`githubApp.privateKeyFile`, already
supported), `optional: true`, so Unfold starts before the App exists and picks
the key up when the kubelet refreshes the volume. With OpenBao, the External
Secrets resource that already feeds ploegd feeds the same Secret. Unfold's
publisher token (`delivery.publisher.tokenEnv`) is unchanged by this change.

### 6. Security

- **Who.** Every connect, register, bind, unbind and prepare action needs an
  Admin, and under `tenancy.enforce` an Admin membership of the Tenant (D11).
  Ploeg checks again: proven person, the consumer's `bindScopes` and Team
  scope, the Team's `trackerBindings` opt-in.
- **Out of Tenant is absent.** An integration account, source, repository or
  project of another Tenant answers the same 404 as a missing one, before any
  vendor or Ploeg request ([ADR-0017](../../../docs/adr/adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md)).
- **Audit.** Each change is an OCSF Entity Management record in the Tenant's
  chain (the `ocsf-audit` change, as ADR-0064 records tracker connections):
  Integration Account create, update with `credential_replaced`, delete;
  Repository register and unregister; Tracker binding create and remove;
  Client Project create; Repository Grant add and remove; Readiness Work Item
  confirmed, with the confirmed Shift Budget. Refused attempts are failures.
  No record carries a secret, a manifest code or an installation token.
- **No secret in Unfold's database**, logs, action records, product events or
  responses, except the ADR-0064 ClickUp copy above. The manifest conversion
  code and the installation id pass through Unfold's server once, are never
  stored or logged, and are bound to an OAuth `state` that Ploeg issues, ties
  to the person and accepts once.
- **Redirects.** The manifest's `redirect_url` and the App's setup URL point at
  Unfold's own origin and a fixed path; Unfold accepts a callback only with a
  `state` it started for the same signed-in person within ten minutes.
- **Least privilege at the vendor.** The App manifest asks for the permissions
  Ploeg ADR-0086 lists and nothing else; the Admin installs it on selected
  repositories, never "All repositories" by default. The ClickUp member is
  invited as a Member to the Spaces it needs, never as an owner or admin
  (Ploeg ADR-0184 rule 4).
- **Content never selects authority** (ADR-0048): a task cannot choose a
  repository; only a binding's registered targets can.

### 7. When Ploeg does not serve a step yet

Unfold follows ADR-0044: it sends nothing Ploeg cannot answer, stays usable,
and says why.

- The new routes are optional reads and writes in Unfold's expectation set
  ([ploeg-expectations.json](../../../apps/unfold/src/ploeg-expectations.json)),
  each tied to its owning Ploeg record. Unfold learns whether Ploeg serves a
  step from the version route when Ploeg reports it, otherwise from the step's
  read route (a `404` on `GET …/tracker-bindings` means "not served"). It never
  probes with a write.
- A step Ploeg does not serve shows **refuse with explanation**: "This Ploeg
  (`<release>`) does not register repositories at runtime yet. Ploeg
  `<release>` adds it." with the configuration entry for that step folded
  below, as the setup page already offers "Keep it in the server configuration
  instead". The refusal is `503 ploeg_step_unavailable`, sent before any
  request, and is recorded once per step and release.
- Each slice therefore ships before its Ploeg part: it shows the step, refuses
  it with the reason, and turns on by itself when the pin moves.

### 8. Migration from configuration-only installs

- Nothing is migrated. Configured `repositories[]` and `taskSources[]` stay,
  load into the same objects, and win (D10). Ploeg's static `targets` and
  `trackers.*.projects` stay and win (ADR-0186).
- On first view the checklist shows configured entries as green or red lines
  marked "Configured by the installation", read from Ploeg's connections read,
  so an existing installation sees its state without doing anything.
- An operator who wants an entry managed from the screen removes it from the
  file and adds it on the screen, as ADR-0186 describes for Ploeg. The page
  says this and never offers to rewrite the file.
- Saved sources from before this change keep working; the next `sync()` gives
  them a `ploeg` target when Ploeg has a static route or a binding for their
  List, which fixes `task_binding_unconfigured` for them too.
- **An installation that already serves another forge** cannot add GitHub
  until Ploeg ADR-0192 ships, because Ploeg's workers push to one forge per
  installation today. The owner's own installation (Forgejo) is in exactly
  this state. For it, stages 1 and 2 show the "second forge" state, and every
  slice that adds GitHub names ADR-0192 as its prerequisite there.

### 9. Metrics

First-party product events (ADR-0023): pseudonymous actor, Tenant, no screen
text.

| Event | When | Props |
|---|---|---|
| `onboarding.started` | first sign-in of an Admin in a Tenant with no Integration Account | — |
| `onboarding.step_completed` | a checklist line turns green for the first time | `step`, seconds since start |
| `onboarding.step_failed` | a line turns red | `step`, error code |
| `onboarding.step_refused` | a step refused because Ploeg does not serve it | `step`, Ploeg release |
| `onboarding.first_pr_opened` | the first agent pull request on a registered repository of the Tenant | seconds since start, `kind` (`readiness` or `task`) |

- **Time to first pull request**: p50 and p90 of `first_pr_opened − started`,
  target p50 under 15 minutes, read from the store or the optional sink.
- **Drop-off**: the share of Tenants that start and never reach each step.
- **Failure codes** per step, to find the check that costs the most time.
- On a self-hosted installation these stay inside it unless its operator sets
  the optional sink; the owner's dogfood trials (tasks.md) are how the project
  itself sees the number in v1.

### 10. Hosted later, without rework

| Hosted piece | Where it attaches | What v1 must not do |
|---|---|---|
| Tenants per Agency, `tenancy.enforce` | every table already has a Tenant; v1 writes `default` | assume one Tenant in a query |
| Zitadel broker (ADR-0058) | stage 0 | depend on local login |
| `Tenant` operator, Ploeg's Tenant (Ploeg ADR-0178) | Ploeg's store path and consumer per Tenant | put Tenant-wide secrets in Unfold |
| ClickUp OAuth through Unfold's own ClickUp app | stage 3 swaps the paste for consent as the member; Ploeg does the exchange | assume a pasted token |
| Ploeg-only App key (D8 hardening) | Unfold's reads switch to short-lived tokens Ploeg mints | read the key outside `github-app.ts` |
| Multi-forge (Ploeg ADR-0192) | stage 1 for a second forge | assume one forge per Tenant in Unfold's model |

## Risks / Trade-offs

- [Five upstream records, all proposed] → each slice ships with its
  refuse-with-explanation state, so Unfold never waits on Ploeg to merge; the
  journey is complete only when all five are released.
- [The 15-minute target fails on the readiness Run] → the readiness Work Item
  has a small Shift Budget and a short prompt; if its p50 is above 10 minutes,
  the clock is measured on the first task instead and the readiness pull
  request stays as first value.
- [A ClickUp seat is a real cost and a real member] → the page says so before
  the steps; the opt-in trigger stays a later slice for organisations that
  refuse it; T48 is watched.
- [The Admin pastes their own token] → refused when Unfold can see it is the
  Admin's own account; otherwise the page states whose account it is before
  saving.
- [Shared App key (D8)] → a compromised Unfold pod could mint write tokens for
  every installed repository. Accepted for self-hosted v1 by the owner; the
  key is mounted only into the server pod, never into agent workspaces, and
  the hardening is a named slice before hosted.
- [ClickUp copy in Unfold (section 5)] → same bound and the same hardening.
- [Two sources of routes] → the checklist is the one place that shows both,
  with `source: static | runtime` from Ploeg.
- [An installation already on another forge] → blocked on ADR-0192, shown as
  its own state; the owner's installation needs it before dogfooding GitHub.
- [Webhooks need a public Ploeg endpoint] → an install prerequisite, checked as
  the first line of the checklist from Ploeg's connections read.

## Migration Plan

Section 8. Each slice is behind no flag of its own: a step is visible and
refused until Ploeg serves it. Rollback is removing the runtime entries on the
screen; configured entries are never touched.

## Slices

Thin vertical slices, each shippable alone, in order. "Waits for" names the
upstream change that turns the slice from refused to working.

| # | Slice | Ships | Waits for |
|---|---|---|---|
| S1 | Checklist backbone | Connections becomes the checklist with a fix button per line; Admin lands there; configured entries shown; "How connections work" rewritten; onboarding events | nothing (Ploeg ADR-0129 read is served) |
| S2 | Saved sources get their Ploeg target | `sync()` gives a saved source the target of the static route that covers its List; `task_binding_unconfigured` gone for those | nothing; extended to runtime bindings in S5 |
| S3 | Repositories and Own work in Unfold's store | `repositories`, `client_projects`, `repository_grants`, `integration_accounts`; Own work; configured entries mirrored | nothing |
| S4 | Connect GitHub and pick repositories | manifest flow, install, list, runtime registration, shared key mount | Ploeg ADR-0184 (store-backed forge connection; manifest code and installation as grants), Ploeg ADR-0193; **and Ploeg ADR-0192 on any installation that already serves another forge** |
| S5 | Connect ClickUp and bind Lists | member guide, paste to Ploeg's store, pick Lists, map to repositories and Team, bindings | Ploeg ADR-0184 (paste to store), ADR-0186 with ClickUp `ScopeProber`, the "connection account is the agent" ask |
| S6 | Budget gate | the enforced cap read and confirmed before any paid step | Ploeg's Team Budget read (served); a runtime change is not in v1 |
| S7 | Readiness pull request | the offer, estimate, confirmation and progress | Ploeg ADR-0194 |
| S8 | First task to first pull request, measured | the guided last step, `first_pr_opened`, the time-to-first-PR figure in Insights | S4, S5 released |
| S9 | GitHub Issues as the tracker | the same App as tracker, Lists replaced by repositories' issues | GitHub Issues hand-off in Ploeg (the team read reporting GitHub logins, see the `jira-tracker` change) |
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
2. **Changing the Budget at runtime.** v1 reads and confirms the cap the chart
   installs. Recommended: keep it so for self-hosted; a runtime Team Budget
   contract in Ploeg is needed for hosted and should be asked for with S10.
3. **Readiness pull request versus the 15 minutes.** Recommended: the clock
   stops at whichever agent pull request opens first, and the event records
   which kind, so the owner can see both.
4. **The two upstream asks of section 4** (connection account as agent;
   manifest code and installation id as ADR-0184 grants). Recommended: raise
   them as amendments to Ploeg ADR-0186 and ADR-0184 before they are accepted,
   rather than as new records.
