# Connect a task system

Unfold reads tasks from **Vikunja, ClickUp, Forgejo, GitHub, GitLab and Jira Cloud** through the same operator workflow: choose a connection, browse tasks, inspect a preview, and explicitly import one into a queued session. Browser and VS Code use the same server registrations and API. Importing does not start agents, assign the task, post a comment or change its status. [Handing a Vikunja task to Ploeg](#hand-a-task-to-ploeg) is a separate, explicit action that does assign it and leaves a comment.

An administrator registers each source in the server configuration, or, for a tracker whose adapter offers it (ClickUp today), adds it from the screen: Unfold then keeps the source and the token of the tracker account it acts as in its own database ([Add a connection from the screen](#add-a-connection-from-the-screen), [ADR 0064](../adrs/0064-people-add-tracker-connections-from-the-screen-and-unfold-keeps-them-with-an-encrypted-service-account-token.md)). Personal GitLab and ClickUp account links are also implemented, including optional OAuth; see [account linking](live.md#linking-clickup). People browse with those links while they set a source up; they do not replace the source's own token.

## Task providers are adapters

Each task system is an adapter in `src/task-providers/`, one file per provider, registered by name in `src/task-providers/index.ts`. The adapter browses, reads and normalizes tasks for import, and declares what else its tracker can do. Code outside the adapters asks for a capability and never names a provider ([system ADR-0050](../../../../docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md), rule 1); a test fails when it does. A source whose `provider` no adapter registered is refused at start-up with `Unsupported task source provider`.

| Provider | Hand to Ploeg | Report a problem | Descriptions | Reference | Personal link |
| --- | --- | --- | --- | --- | --- |
| `forgejo` | no | issues | Markdown | none | none |
| `github` | no | issues, without attachments | Markdown | none | none |
| `gitlab` | no | no | Markdown | none | `gitlab` |
| `vikunja` | yes, and Ploeg's assignment routes | tasks | HTML, shown as Markdown | `VIK-<id>` | none |
| `clickup` | yes | no | Markdown, tidied for display | none; a custom task ID shows as the task's reference | `clickup`, and set-up by name |
| `jira` | no | issues | Atlassian Document Format, shown as Markdown | the issue key, `<KEY>-<n>` | none |
| `demo` | no (demo mode only) | no | Markdown | none | none |

The hand-off and reporting messages list the adapters that declare the capability, so a new adapter appears in them without another change. Personal account links are a registry of their own in `src/link-providers/`. Adding a tracker is a new adapter file and one line in the index.

## Task source and code host are separate choices

`taskSources[].repositoryId` maps a task source to an administrator-registered repository. That repository fixes the clone URL, base branch and verification command. A Vikunja project can point at a Forgejo repository; a ClickUp List can point at GitHub or GitLab. A forge's issue source can also be used directly. Task content never chooses a clone URL or a runtime endpoint.

| You want to use | Register the task source as | Register the code checkout as |
| --- | --- | --- |
| Vikunja tasks with Forgejo code | `provider: "vikunja"`, numeric project ID | A repository with the Forgejo HTTPS clone URL |
| ClickUp tasks with GitLab code | `provider: "clickup"`, numeric home List ID | A repository with the GitLab HTTPS clone URL |
| GitHub issues with GitHub code | `provider: "github"`, `owner/repo` | A repository with the GitHub HTTPS clone URL |
| Forgejo issues with Forgejo code | `provider: "forgejo"`, `owner/repo` | A repository with the Forgejo HTTPS clone URL |
| GitLab issues with GitLab code | `provider: "gitlab"`, numeric ID or namespace/path | A repository with the GitLab HTTPS clone URL |

Issue credentials authorize the control plane to read task content. They are not used for Git cloning, model inference or publication. Private repository read credentials are a separate workspace deployment concern described in [live operation](live.md).

## Register the connection

Copy the complete example, keep only the sources you need, and replace its example repository, model alias, API roots and project IDs:

```sh
cp config/task-sources.example.json config/live.local.json
```

Set the server environment and live runtime prerequisites using [live operation](live.md). Supply each registered task token through the environment variable named by `tokenEnv`, populated through the deployment's secret mechanism or a short-lived vault-backed shell. The JSON contains variable names, never token values.

Start the configured server:

```sh
npm start -- --config config/live.local.json
```

The following is one `taskSources` entry, placed inside the array in the full configuration:

```json
{
  "id": "team-vikunja",
  "name": "Engineering · Vikunja",
  "provider": "vikunja",
  "baseUrl": "https://tasks.example/api/v1",
  "project": "42",
  "repositoryId": "application",
  "tokenEnv": "UNFOLD_TASK_VIKUNJA_TOKEN",
  "executionOwner": "interactive"
}
```

| Field | Meaning |
| --- | --- |
| `id` | Stable, unique lowercase connection slug. Keep it stable so retained task references continue identifying their source |
| `name` | Human-facing connection label shown in both clients |
| `provider` | `forgejo`, `github`, `gitlab`, `clickup`, `vikunja` or `jira` |
| `baseUrl` | The API root, including its API version path where applicable. It is not a browser issue URL |
| `project` | The configured repository, home List or project identifier for that provider; use a string |
| `repositoryId` | An existing entry in `repositories`. Operators cannot substitute another checkout during import |
| `tokenEnv` | Optional name of the server environment variable containing this source's credential. If supplied, it must contain a token when the server starts. Omit only for an API that permits the intended unauthenticated reads. Do not reuse the LiteLLM master or an operator login secret |
| `executionOwner` | `ploeg` when Ploeg owns dispatch and execution, which every importable live source needs; `interactive` sources stay readable but import only into the retired standalone mode |
| `ploeg` | Optional explicit Work Target for shared Vikunja or ClickUp imports; requires shared execution configuration |
| `tenant` | Optional [Tenant](../../../../docs/reference/glossary.md#tenant) that owns the source; `default` when unset. It must be the Tenant of the source's repository |
| `client` | Optional [Client](../../../../docs/reference/glossary.md#client) inside that Tenant that owns the source. A repository with a `client` takes sources of that Client only |

### Who owns a source and a repository

Each task source and each entry in `repositories` belongs to exactly one Tenant and, inside it, to at most one Client ([system ADR-0017](../../../../docs/adr/adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md)). Both take the same optional `tenant` and `client` fields; an entry that sets neither belongs to the `default` Tenant with no Client, which is what every install without tenancy has. Ids are lower-case letters, digits and inner hyphens, at most 63 characters.

```json
"repositories": [{ "id": "acme-shop", "name": "Acme shop", "url": "https://forge.example/agency/acme-shop.git", "baseBranch": "main", "verify": ["npm", "test"], "tenant": "agency", "client": "acme" }],
"taskSources": [{ "id": "acme-board", "name": "Acme · Vikunja", "provider": "vikunja", "baseUrl": "https://tasks.example/api/v1", "project": "42", "repositoryId": "acme-shop", "tokenEnv": "UNFOLD_TASK_VIKUNJA_TOKEN", "executionOwner": "ploeg", "tenant": "agency", "client": "acme" }]
```

Unfold refuses to start, naming both entries, when:

* one repository is registered twice for different owners. A repository is keyed by its forge host and `owner/name`, without `.git` and in any case, so its HTTPS and SSH URLs are one repository;
* one tracker project is registered twice, under two connection ids, for different owners. A project is keyed by provider, API root and project id, so the same project id on another instance is another source. Two connection ids for one project and one owner stay allowed, as before;
* a source's Tenant is not its repository's Tenant, or its repository belongs to a Client and the source does not belong to that same Client. A Client's source may use a repository of its Tenant that no Client owns.

What the owner limits for people signed in is in [Tenant and Client memberships](live.md#tenant-and-client-memberships).

Use HTTPS for remote API roots. HTTP is accepted only for loopback development fixtures. The adapters reject redirects and embedded URL credentials. A reverse proxy must expose the provider API directly at the configured root. Network access and DNS resolution occur on the Unfold server.

## Add a connection from the screen

For a tracker whose adapter offers it, ClickUp today, an administrator adds sources on **Settings › Connect a tracker** without touching the configuration or restarting ([ADR 0064](../adrs/0064-people-add-tracker-connections-from-the-screen-and-unfold-keeps-them-with-an-encrypted-service-account-token.md)). The tracker's account link must be configured, because people pick the project with their own link.

**Unfold's tracker user.** Handing a task off assigns the Team's tracker user and leaves a note, and Unfold does that as a tracker user of its own: a **service account** the agency creates once, such as `unfold@your-agency.example` in ClickUp. The page explains why and lists the tracker's steps. The administrator pastes that user's token in a write-only field. Unfold refuses a value without the token's shape (`connection_token_invalid`) before sending it anywhere, asks the tracker whose token it is (`connection_token_rejected` when it refuses), and only then stores it. It shows the account's name and when the token was set, never the token. A Tenant has one such connection per tracker and API root.

**Where the token is kept.** In the store's encrypted `internal_state`, sealed with AES-256-GCM under the store key, like people's linked-account tokens: `UNFOLD_STORE_KEY` when set, otherwise the `unfold.sqlite.key` file next to the database. Back the key up with the database; without it the tokens cannot be read, and an administrator pastes them again. The token is never logged, never in an action record or audit record, never in a Tenant export, and Unfold replaces it with `[redacted]` wherever it would appear in an answer.

**Rotate or remove.** **Replace token** checks and stores a new token; every source of the connection uses it from the next request. **Remove** forgets the token; it is refused while a saved source still uses the connection, so remove those first. A saved source's **Remove** stops its tasks showing in Unfold. Work Items it started stay in Ploeg, and nothing changes in the tracker.

**Who may.** Everyone who reaches the Tenant sees its connections and saved sources. Adding, replacing and removing need an administrator, and while `tenancy.enforce` is on an Admin of the connection's Tenant ([who owns a source](#who-owns-a-source-and-a-repository)). A saved source belongs to its connection's Tenant, may name a Client inside it, and passes the same checks as a configured one. Each change is an Entity Management record in the Tenant's [audit trail](audit-siem.md): `Tracker connection` or `Task source`, created, updated or deleted, with refused attempts as failures.

**Next to the configuration.** Saved sources run alongside the configured ones, which win: a configured source with the same id, or reading the same project at the same API root, hides the saved one, and the page marks it as not in use. A configured source cannot be changed or removed from the screen (`source_read_only`). `GET /api/task-sources` says where each source is kept in `managedBy`. Saving does not configure Ploeg: Ploeg starts work only on projects its own tracker configuration routes to a Team, which [Diagnose a connection](#diagnose-a-connection) shows.

**Its Ploeg target.** A saved source that Ploeg executes takes its [import target](#import-the-existing-ploeg-work-item) from Ploeg's static route for its project: the routed repository whose owner, name and base branch match the source's repository. Unfold reads the routes from Ploeg's connections read at start-up and each time a source is saved or changed. When no route covers the project, the source has no target and an import is refused with `task_binding_unconfigured`, saying so; route the project in Ploeg's configuration, then save the source again.

**Where they are kept.** A connection is an Integration Account (system [ADR-0048](../../../../docs/adr/adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md)) in the `integration_accounts` table, with the role `tracker`, keyed by Tenant, provider, API root and account id. A store from before this table is copied on the first start: each connection keeps its id and the token stays sealed under the same id. A saved source without a Client belongs to its Tenant's **Own work**, the Client Project without a Client, which Unfold makes on first use.

**Back up before you upgrade.** Copy the data directory's `unfold.sqlite` (with the workbench stopped, or with `sqlite3 unfold.sqlite ".backup unfold-before-upgrade.sqlite"`) before you start a version that adds tables, and keep the encryption key with it: the tokens in the copy open only with that key.

**Rolling back.** The upgrade drops nothing. The older `tracker_connections` table stays, and Unfold writes every connection to it as well as to `integration_accounts`, so an image from before Integration Accounts still starts, sees every connection with its token and can add connections and sources. A saved source refers to its connection by id without a database foreign key, which lets both kinds of image add one. Each start reconciles the two tables: a connection only one of them has is copied to the other with its id, and when both have it the body with the later `updatedAt` wins, so a token replaced while rolled back is kept. A source added while rolled back joins its Tenant's Own work on the next start. A connection removed while rolled back comes back after the roll-forward without a token, because the older image deleted the token; remove it again. Stored repositories, Repository Grants and Client Projects are not read by the older image and are there again after the roll-forward.

**Tenant export.** The connections and their sources are exported with their Tenant as `integration-accounts` and `tracker-connection-sources`; their tokens are not. After an import an administrator pastes each token again; until then the connection says its token is missing.

### Repositories added from the screen

This is off until the `repositories.stored` [flag](feature-flags.md) is turned on. While it is off, `POST`, `PATCH` and `DELETE /api/repositories` answer 404 `repositories_off`, and repositories stored earlier stay in the database with `state` `off`: they do not join the configured repositories, the Tenant checks or the saved sources, and a saved source that names one says `repository_missing`.

An administrator, and while `tenancy.enforce` is on an Admin of the Tenant, can store a repository with `POST /api/repositories` and an HTTPS forge URL such as `https://github.com/acme/shop`. Its key is the forge host and `owner/name`, lower-cased and without `.git`, the same key [who owns a source and a repository](#who-owns-a-source-and-a-repository) uses; Unfold refuses a second repository with the same key in the same Tenant (`repository_exists`). The host must be one the configured repositories use, on the standard HTTPS port, and never an IP address, a name without a dot or a private name such as `*.svc.cluster.local` (`repository_invalid`). Its id starts with `r-`, so it never equals a configured id, and the `Location` header of the answer names it. The repository belongs to the Tenant and is granted to the Tenant's Own work, which is made on first use. It joins the configured repositories after them, so saved sources, hand-off and sessions can use it, and `PATCH` and `DELETE /api/repositories/{id}` change or remove it; removing is refused while a saved source uses it (`repository_in_use`). Storing a repository sends nothing to Ploeg or the forge: Ploeg still works only on the targets it knows.

**Credentials.** A stored repository is cloned anonymously. It never gets the workspace pods' shared git secret (`kubernetes.gitSecretName`) or the person's linked forge account; a forge Integration Account for stored repositories is proposed, not built. A private repository must be in the configuration for now.

**Shadowing.** A repository in the configuration wins. A stored repository is marked `shadowed`, kept and not used when a configured repository has its key or id, when a repository of another Tenant, configured or stored, has the same `owner/name` on any forge host, or when its host is no longer one the configuration uses. Ploeg names a Work Item's target by forge and `owner/name` without a host, so two Tenants holding the same `owner/name` would make the owner of that work ambiguous; neither stored one is then used. A saved source says `repository_missing` when its repository belongs to another Tenant or Client, and when the stored repository it was saved against is not in use, even if a configured repository has the same id.

**Other Tenants.** Adding a key another Tenant already holds succeeds and is shadowed, so the answer never tells an Admin what another Tenant holds. `PATCH` and `DELETE` on another Tenant's repository, stored or configured, answer 404 `repository_not_found`; `repository_read_only` is only said to a person who reaches the configured repository. A configured repository cannot be changed from the screen. `GET /api/client-projects` lists each Tenant's Client Projects with `visible`, which is false until the Tenant has a Client, so the screens show no project choice before then.

Each change is an Entity Management record in the Tenant's audit trail: `Repository` created, updated or deleted, `Repository Grant` added or removed, and `Client Project` created when Own work is made. The Tenant export carries them as `stored-repositories`, `repository-grants` and `client-projects`; repositories from the configuration stay in `repositories`.

## Provider recipes

These entries use the same registered `application` repository. Choose the rows that match your actual systems; configuring all five is optional.

| Provider | `baseUrl` example | `project` example | Environment variable example |
| --- | --- | --- | --- |
| Forgejo | `https://forge.example/api/v1` | `acme/application` | `UNFOLD_TASK_FORGEJO_TOKEN` |
| GitHub.com | `https://api.github.com` | `acme/application` | `UNFOLD_TASK_GITHUB_TOKEN` |
| GitHub Enterprise Cloud with data residency (GHE.com) | `https://api.octocorp.ghe.com` | `acme/application` | `UNFOLD_TASK_GITHUB_TOKEN` |
| GitHub Enterprise Server | `https://github.example/api/v3` | `acme/application` | `UNFOLD_TASK_GITHUB_TOKEN` |
| GitLab | `https://gitlab.example/api/v4` | `acme/platform/application` or `"123"` | `UNFOLD_TASK_GITLAB_TOKEN` |
| ClickUp | `https://api.clickup.com/api/v2` | `"901234567890"` | `UNFOLD_TASK_CLICKUP_TOKEN` |
| Vikunja | `https://tasks.example/api/v1` | `"42"` | `UNFOLD_TASK_VIKUNJA_TOKEN` |
| Jira Cloud, service account | `https://api.atlassian.com/ex/jira/CLOUD-ID/rest/api/3` | `APP` | `UNFOLD_TASK_JIRA_TOKEN` |
| Jira Cloud, user API token | `https://SITE.atlassian.net/rest/api/3` | `APP` | `UNFOLD_TASK_JIRA_TOKEN` |

For Forgejo and GitHub, use exactly `owner/repository` without `.git`, issue number or URL. GitLab accepts a numeric project ID or an unescaped namespace path, including subgroups; the adapter encodes it for the API. ClickUp uses the task's home List, not its Workspace, Space or Folder. Vikunja uses its numeric project ID. Jira uses the project key in capitals, such as `APP`. API reverse-proxy prefixes are supported when the required suffix remains present.

### Forgejo

Create a token with **`read:issue`** and restrict it to the intended repository where the instance supports that token option. The connector performs issue list/get operations. Code clone permissions are separately provisioned. Forgejo documents both issue read scope and the specific-repository token boundary in its [access token scope reference](https://forgejo.org/docs/latest/user/authentication/token-scope/).

The adapter uses the configured repository scope, excludes pull requests, and fetches issue details by the repository-local issue number. It does not enumerate all repositories or install webhooks.

### GitHub

Unfold reads and files GitHub issues either as a **GitHub App**, which is the recommended credential, or with a token in the variable `tokenEnv` names. A source takes exactly one of the two: setting both, or `githubApp` on another tracker, stops Unfold at start-up. The list and get issue endpoints need **Issues: read**. GitHub's issues API also returns pull requests; the adapter excludes records containing `pull_request`. See the [official issue endpoint contract](https://docs.github.com/en/rest/issues/issues#list-repository-issues).

The `baseUrl` is `https://api.github.com` for GitHub.com and `https://api.SUBDOMAIN.ghe.com`, with no path, for an enterprise on GHE.com, where `SUBDOMAIN` is the enterprise's dedicated subdomain ([GitHub's REST API base URL](https://docs.github.com/en/enterprise-cloud@latest/rest/using-the-rest-api/getting-started-with-the-rest-api), [GHE.com network details](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/network-details-for-ghecom)). Enterprise Server keeps its own host with the `/api/v3` path. Any other `ghe.com` host or path is rejected, and issue links open on the matching web host: `github.com`, `SUBDOMAIN.ghe.com` or the Enterprise Server host.

#### Connect as a GitHub App

With `githubApp` Unfold holds no token at all. It signs a JSON Web Token with the App's private key (RS256, issued a minute in the past, valid for nine minutes) and asks GitHub for an installation token for the source's one repository with exactly these permissions:

| Repository permission | Access | What Unfold uses it for |
| --- | --- | --- |
| Issues | Read and write | List, read and file issues, add the `reported-in-app` label, comment on a filed report, read its timeline |
| Metadata | Read | Basic repository data; GitHub includes it with repository permissions, and Unfold asks for it explicitly so the grant it checks matches the one GitHub returns |
| Contents | Read | List releases, for *Fixed in* a release on a private repository |

GitHub lists these per endpoint in [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps): the issue, label, comment and timeline endpoints under Issues, `GET /repos/{owner}/{repo}/releases` under Contents. Give the App nothing else. Unfold sends `repositories: [<name>]` and that permission set to [`POST /app/installations/{id}/access_tokens`](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app), and refuses a token whose answer reaches further, another repository, every repository, another permission or a higher level, with `github_app_grant_too_wide`, without using it. An installation that lacks one of the three permissions answers `github_app_permissions_missing`; accept the App's permission request on the installation.

Each token is kept in memory for the repository it was minted for and minted again five minutes before GitHub's `expires_at`. A request GitHub answers with 401 mints once more and is repeated once. Nothing is written to disk. The private key, whole, JSON-escaped and line by line, and every minted token join the secrets Unfold replaces with `[redacted]` in error reports, API answers and agent output, like a `tokenEnv` value.

```json
{
  "id": "acme-github",
  "name": "Acme · GitHub",
  "provider": "github",
  "baseUrl": "https://api.github.com",
  "project": "acme/application",
  "repositoryId": "application",
  "githubApp": { "appId": 123456, "privateKeyEnv": "UNFOLD_GITHUB_APP_PRIVATE_KEY" },
  "executionOwner": "ploeg"
}
```

| `githubApp` field | Meaning |
| --- | --- |
| `appId` | The App ID, or the App's Client ID, from the App's settings page. Neither is a secret |
| `installationId` | Optional. Leave it out and Unfold looks the installation up with `GET /repos/{owner}/{repo}/installation` once per repository |
| `privateKeyEnv` | The environment variable that holds the App's PEM private key |
| `privateKeyFile` | Instead of `privateKeyEnv`: the absolute path of a mounted file that holds it. Unfold reads the file again at every mint, so a rotated key needs no restart |

Unfold checks at start-up that the key reads as a PEM RSA private key; a task source with a missing or broken key stops Unfold, a reports connection with one is turned off with `reports.app_key_missing`.

**How the key reaches the pod.** Generate a private key on the App's settings page and store it once in the deployment's secret store. Nobody copies a token anywhere, because Unfold mints its own. With the Helm chart, map the stored key to the variable `privateKeyEnv` names, either as a key of `credentialsSecret`, through `credentialRefs`, or through `externalSecrets.credentials`, which renders an ExternalSecret that External Secrets fills from the secret store:

```yaml
externalSecrets:
  enabled: true
  secretStoreRef: {kind: ClusterSecretStore, name: SECRET-STORE}
  credentials:
    UNFOLD_GITHUB_APP_PRIVATE_KEY: {key: PATH/TO/GITHUB-APP, property: private-key}
```

Outside the chart, mount the key as a read-only file and point `privateKeyFile` at it. A PEM in an environment variable may keep its line breaks or carry them as `\n`.

GitHub Enterprise Server and GHE.com use the same endpoints under the same `baseUrl` as the issue reads, so an App registered on the Enterprise Server instance works with its `/api/v3` root.

#### Connect with a token

A fine-grained personal access token limited to the selected repository with **Issues: read**, preferably of a dedicated machine account, still works through `tokenEnv`. To file [Report a problem](#file-report-a-problem-into-a-tracker) issues it also needs **Issues: read and write**. An installation token minted outside Unfold expires after an hour; use `githubApp` instead of renewing one into `tokenEnv`.

Unfold does not install a GitHub App or create pull requests through this connection. Public and private connectivity, for either credential, must still be qualified against the configured GitHub.com, GHE.com or Enterprise Server instance.

### GitLab

Prefer a project access token where available, with **`read_api`**, and an account role that can read the intended issues. GitLab's token model distinguishes a project token's project scope from a personal token's wider account access; `read_repository` alone grants repository access rather than general issue API access. See [access token scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/) and [project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/).

The adapter sends the token in the `PRIVATE-TOKEN` header and uses project-local issue IIDs for detail requests. It does not fetch merge requests or perform GitLab OAuth, DPoP signing or token renewal. Qualify the actual deployment's authentication requirements before the pilot.

### ClickUp

**Set it up by name.** Configure the [ClickUp account link](live.md#linking-clickup) (`links.clickup`, with OAuth or pasted personal tokens). A person then opens **Settings › Connect a tracker** (`#settings/task-setup`, also offered on an empty Tasks page), and:

1. links their ClickUp account if they have not (the page says so and links to Linked accounts);
2. picks a **Workspace**, **Space**, **Folder** and **List** by name. A Space shows its Folders and the Lists outside any Folder; archived Spaces, Folders and Lists, and ClickUp's hidden Folders, are left out. A level with one choice is picked for them. Everything is read with that person's own account, so they see only what it sees;
3. gets a check that changes nothing: the account Unfold reads as, the List's path and statuses (an archived List is a problem), and the first page of open tasks with five previewed the way an import reads them: custom task ID or id, title, assignees, tags, due date and the start of the description. Comments, attachments and custom fields are not read;
4. chooses the registered repository the work goes to and a name, and an administrator chooses **Save** ([Add a connection from the screen](#add-a-connection-from-the-screen)). The check also says whether Unfold's own ClickUp user can open the List. A List some source already reads says so instead. For an installation that keeps every source in GitOps, **Keep it in the server configuration instead** still shows the `taskSources` entry: it has no `tokenEnv`, so everyone reads with their own linked account, and `executionOwner: "ploeg"`. An administrator adds it to the configuration and restarts Unfold.

Under **Connected now** the same page lists every source with where it is kept, **Added here** or **Server configuration**, and has **Test connection** for each (`GET /api/task-sources/{id}/check`), which reads with the source's own token or the person's link and also says whether its tasks can be handed to Ploeg.

**Token.** A source without `tokenEnv` reads with each person's linked account. A source with `tokenEnv`, or one saved from the screen, reads with a **personal API token** of one ClickUp user (Settings › Apps), sent in the raw `Authorization` header. ClickUp tokens are not scoped: a token carries its account's whole access, so use a user that sees only the intended Lists ([ClickUp authentication](https://developer.clickup.com/docs/authentication)). Hand-off needs such a token, because the server assigns the Team's user with it.

**What it reads.** The source is one home List: `GET /list/{id}/task` with `include_closed=false`, `include_timl=false`, `subtasks=true`, `include_markdown_description=true`, newest change first, 100 tasks a page, following ClickUp's `last_page` ([Get Tasks](https://developer.clickup.com/reference/gettasks)). A task, or subtask, whose home List is another List is left out of the page rather than failing it; opening one directly answers `task_outside_source`. ClickUp status types `open` and `custom` are open, `closed` and `done` closed, so custom statuses work. All assignees show. A custom task ID (such as `SHOP-12`) is the task's reference in the list; the task still opens by its ClickUp id. Due dates are ClickUp's UTC timestamps, shown in the reader's time zone.

**Descriptions** are ClickUp's own Markdown. For display, images become links that say `Image: …` (the browser shows no remote images) and the inline underline, span and line-break tags ClickUp mixes in become plain text; the stored snapshot and its revision keep ClickUp's text. The renderer escapes everything else and keeps only `http`, `https` and `mailto` links.

**Rate limits.** ClickUp lets each token ask 100 times a minute on most plans and answers 429 with `X-RateLimit-Reset` ([ClickUp rate limits](https://developer.clickup.com/docs/rate-limits)). Unfold waits out a 429 that asks for two seconds or less and asks once more. A longer one answers `task_rate_limited` with `Retry-After` and a message naming the seconds, and Unfold then asks nothing with that token until the reset; a response that reports `X-RateLimit-Remaining: 0` does the same before ClickUp has to refuse. Setup reads are cached per person for a minute, so clicking back and forth through the pickers costs little. All ClickUp reads happen while a person waits; Unfold has no background ClickUp work, so none of it goes through the job queue.

### Vikunja

Create an API token in **Settings → API Tokens** and grant the reads needed for task listing and task detail on the configured project. The connector uses a Bearer token. A dedicated account with read-only access to the project can further limit the integration; Vikunja describes that project sharing right as `0`. See [API authentication](https://vikunja.io/docs/api-documentation/) and [project permissions](https://vikunja.io/docs/permissions/).

This adapter targets **Vikunja API v1**. It lists tasks through `/tasks` with the configured `project_id` and incomplete-state filter, fetches details through `/tasks/{id}`, and checks the returned project ID. It does not depend on a legacy `/projects/{id}/tasks` route. Check your instance's `/api/v1/docs` when qualifying it. Vikunja currently documents v1 as supported alongside v2, with deprecation planned for 3.0 and removal for 4.0; use a compatible instance until a v2 adapter is implemented. [Vikunja API version guidance](https://vikunja.io/docs/api-documentation/).

Vikunja task links assume the frontend uses the API's origin and reverse-proxy prefix. A frontend hosted on a different origin needs a future explicit frontend-URL setting; API task reads can succeed while the generated browser link is unsuitable for that deployment.

### Jira

The adapter reads one Jira Cloud project through REST API v3. Jira Data Center has no v3 API and is not supported.

**Use a service account.** In Atlassian Administration, under **Directory → Service accounts**, create an account for Unfold and give it a scoped API token ([Atlassian: manage API tokens for service accounts](https://support.atlassian.com/user-management/docs/manage-api-tokens-for-service-accounts/)). Choose the scopes when you create the token; they cannot be changed afterwards:

| Unfold does | Scopes |
| --- | --- |
| Browse, preview and import | `read:jira-work` |
| Report a problem into the project | `read:jira-work`, `write:jira-work` and `read:jira-user` (for `GET /myself`) |

A scoped token works only through Atlassian's gateway, so `baseUrl` is `https://api.atlassian.com/ex/jira/CLOUD-ID/rest/api/3`. The site's cloud ID is the `cloudId` in `https://SITE.atlassian.net/_edge/tenant_info`. Put the token alone in the variable `tokenEnv` names; Unfold sends it as a Bearer token. Through the gateway, Unfold reads the site's address once from `GET /serverInfo` to build `https://SITE.atlassian.net/browse/APP-12` links, and accepts only an `atlassian.net` address there.

A classic API token of an ordinary Atlassian account also works, against the site's own root `https://SITE.atlassian.net/rest/api/3`. Put `email:token` in the variable; Unfold sends it as Basic credentials. A classic token carries the account's whole access, so use a dedicated account.

**Scope it per Client.** The service account sees what its Jira project roles let it see, and the token's scopes do not narrow that. Grant it **Browse projects** on exactly the projects Unfold may read, through each project's permission scheme, and register one task source per project. Give each source the `client` of the Client that owns the project ([who owns a source](#who-owns-a-source-and-a-repository)). Unfold lists a source's issues with this JQL, built from the configured key and never from task content:

```text
project = "APP" AND statusCategory != Done ORDER BY updated DESC, key DESC
```

Every issue it reads must belong to that project; one from another project answers `task_outside_source`.

**What it reads.** Lists go through `GET /search/jql`, which replaced the removed `GET /search` ([Atlassian: run a JQL search with the REST API](https://confluence.atlassian.com/display/JIRAKB/Run+JQL+search+query+using+Jira+Cloud+REST+API)). That endpoint pages with a `nextPageToken`, not a page number, so Unfold remembers the token of each page it has read and reaches a later page by walking at most ten pages from the nearest one it knows. One issue is read with `GET /issue/{key}`. An issue is named by its key, such as `APP-12`, which is also its reference in Unfold. A moved or renamed issue answers `task_moved`; open it from the list again.

Descriptions are Atlassian Document Format (ADF). Unfold renders them as HTML in which every text is escaped and only `http`, `https` and `mailto` links survive, and shows that HTML as Markdown like a Vikunja description. Mentions keep their display text, images and files show as `[attachment]`, and node types Unfold does not know keep their text. The status comes from Jira's status category: **Done** is closed, **To Do** and **In Progress** are open. Labels, the assignee, priority and due date show beside the task.

**Report a problem** files a Bug in the project (else a Task, else the project's first standard type, from `GET /issue/createmeta/{key}/issuetypes`), with the body converted to ADF, and attaches the screenshot, `console.json` and `requests.json` with `POST /issue/{key}/attachments`. Replies and repeat reports are comments. Unfold follows the issue's status category, labels, assignee and latest ten comments. The service account needs **Create issues**, **Create attachments** and **Add comments** on the report project.

**Not built.** Hand-off to Ploeg: Ploeg takes no Jira work (see [the hand-off matrix](#hand-a-task-to-ploeg)). Personal Atlassian account links through OAuth 2.0 (3LO). Transitions: Unfold never changes an issue's status. A panel inside Jira is a later, separate piece, built as an [Atlassian Forge](https://developer.atlassian.com/platform/forge/) app, because Atlassian ends support for Connect apps on 31 January 2027 ([Atlassian: Connect end of support extended to January 31, 2027](https://community.developer.atlassian.com/t/connect-end-of-support-extended-to-january-31-2027/102002)).

## Use the connection

Open the task browser in Unfold or run the extension's task import command. Choose a source, browse a page of open tasks, and preview the selected task. The preview shows its provider, source identity, current task content and destination repository. Select the Team, configured runtime and budget, then import it. Review the queued session and start it when ready.

The server refetches the task when importing and compares it with the previewed revision. If the task changed, refresh the preview and inspect the update. Closed or completed tasks cannot be imported. Task text is source content, not authority to change runtime policy, access credentials or override the registered repository.

Importing the same task revision again returns its existing session for that operator, including an already completed session; it does not create another paid attempt. If another operator owns the import, the server returns a conflict without exposing that person's session ID. Administrators can access the existing session. A changed task revision may create a new session only after prior work is terminal, no worker or uncertain interruption remains, and Holds on spend are resolved. Otherwise inspect the existing work first. Standalone imports coordinate one Unfold store. Shared imports use the Ploeg claim described below.

Task listing is paged, not an exhaustive background synchronization. Most providers return at most 50 records per request; ClickUp uses up to 100. Move to the next page to browse further. The server bounds response size and task text. A list page cuts a description over 16,000 characters and marks it truncated, so one long task does not hide the rest. Previewing or importing that task still refuses it with an explicit error instead of silently dropping acceptance criteria. Tasks also show labels, assignees, priority, due date and the tracker's own identifier where the provider returns them, and Vikunja's HTML descriptions are converted to plain Markdown for reading. The imported revision covers normalized title, description, state, update timestamp and link. It does not include comments, labels, checklists, assignees, priority, custom fields or linked documents. Put the required acceptance criteria in the task description for this pilot; changes to other fields are outside its revision check.

The same task may be represented in several systems. This release identifies imports by their registered source and task identity; it does not infer that a ClickUp task and a linked Forgejo issue are the same Work Item. Use one authoritative source per Work Item for the pilot.

## Share a server deliberately

All authenticated Unfold users share the registered source visibility, including viewers. The server credential's permitted task content is therefore visible to those users. Viewers cannot import or start work. Unfold does not currently reproduce each person's provider permissions or isolate sources by team membership. Use one trusted team per deployment and scope the configured source account accordingly. Session ownership checks continue to apply after import.

An `executionOwner` declaration alone is a local routing rule. A live Unfold always runs with [shared execution](../../../../docs/workflows/managed-execution.md), so Ploeg remains the authority and tracker imports must bind the existing Work Item using the registered target below.

The server checks source and repository configuration again before first admission. Existing repository registrations without an ownership declaration retain the interactive default; new task source entries require an explicit declaration. Declare repository ownership too when introducing Ploeg alongside the service.

## Import the existing Ploeg Work Item

Enable the [shared execution connection](../../../../docs/workflows/managed-execution.md), then register a supported source with an explicit target. This example maps the existing `application` repository whose URL is `https://forge.example/team/application.git` and base branch is `main`:

```json
{
  "id": "engineering",
  "name": "Engineering",
  "provider": "vikunja",
  "baseUrl": "https://tasks.example/api/v1",
  "project": "42",
  "repositoryId": "application",
  "tokenEnv": "UNFOLD_TASK_VIKUNJA_TOKEN",
  "executionOwner": "ploeg",
  "ploeg": {
    "target": {
      "forge": "primary",
      "owner": "team",
      "repo": "application",
      "baseBranch": "main"
    }
  }
}
```

The forge ID must exist in Ploeg, and the API root must be the same singleton Vikunja or ClickUp instance Ploeg uses. The native project or home List and exact target must match the existing Ploeg mirror. All target fields are required. A missing, unresolved, already claimed or previously executed item stays unavailable for this import path and never becomes a manual duplicate. On the Tasks page such a task shows only its Ploeg card, which says where the task stands and offers the hand-off; the import form appears only for a queued Work Item of the execution team.

Open the task preview and review the linked Work Item and target. Import creates one queued session. Start refetches the source as the session's owner and asks Ploeg to atomically claim the existing item. Import itself makes no tracker mutation and starts no model work. If a queued draft becomes stale, cancel it and review a fresh import; an old mandate never silently becomes a new one. An uncertain admission retries its original persisted request.

The [binding contract](../contracts/ploeg-tracker-binding.md) separates preview hashes, native tracker revisions and Ploeg row freshness. Browser qualification uses `mise exec -- node scripts/browser-task-binding-check.mjs`; its tracker and Ploeg are explicitly labelled fixtures and it starts no agents or model calls.

## Hand a task to Ploeg

Ploeg takes work from the trackers whose adapter declares hand-off, Vikunja and ClickUp, when a task is assigned to the tracker user that routes to one of its teams. What the pinned Ploeg release takes from each tracker decides which adapters declare hand-off:

| Tracker | Ploeg takes its work | Unfold hands off | Why |
| --- | --- | --- | --- |
| Vikunja | by assignee, through the `task.assignee.created` webhook | yes | Ploeg reports each team's assignees and pinned projects |
| ClickUp | by assignee, through the `taskAssigneeUpdated` webhook | yes | Ploeg reports each team's assignees and pinned Lists |
| GitHub Issues | by a `ploeg:<team>` label, or by an assignee listed in `PLOEG_GITHUB_TEAM_MAP` | no | Ploeg's team read reports only the assignees of `teams.<team>.assignees` and `PLOEG_TEAM_MAP`, so Unfold cannot know which GitHub login routes to a team, nor the label prefix |
| GitLab issues | no; Ploeg uses GitLab only as a forge | no | Ploeg has no GitLab tracker |
| Forgejo issues | no | no | Ploeg has no Forgejo tracker |
| Jira | no | no | Ploeg has no Jira tracker |

GitHub hand-off needs one generic change in Ploeg first: its team read reports the routing assignees per tracker.

The Tasks page and the editor's task view offer **Hand to Ploeg** with a team picker, and **Take back** while Ploeg has not started. The server does the assignment with the connection's token, so nobody needs to know which tracker user belongs to which team. The [API contract](../contracts/api.md#hand-a-task-to-ploeg) lists the routes and refusals, and [ADR 0025](../adrs/0025-hand-tracker-tasks-to-ploeg-by-assignment.md) records why.

A connection can hand off when all of these hold:

* its adapter declares hand-off (Vikunja or ClickUp) and it has a `tokenEnv`;
* its `executionOwner` is `"ploeg"`. A `ploeg.target` is not needed for hand-off; it is only for [importing the existing Ploeg Work Item](#import-the-existing-ploeg-work-item);
* the server has a live `ploeg` operator connection, not the demo;
* Ploeg reports tracker assignees for its teams. Ploeg's teams config `teams.<team>.assignees` and `PLOEG_TEAM_MAP` set them.

Only one team holds a task at a time. Hand-off is refused while another team's tracker user is on the task or Ploeg has live work for it, and take-back is refused once any team has started. When Ploeg pins a board to a team (a Vikunja project or ClickUp List with an `id` and a `team:` in Ploeg's tracker configuration), every assignment on that board runs as the pinned team, so the task view offers only that team.

The token then needs more than reads. A read-only token still browses and previews; hand-off answers `task_write_forbidden`.

* **Vikunja:** give it permission to add and remove task assignees and to add task comments on the project. Vikunja lists these as separate API token permissions.
* **ClickUp:** the account behind the personal token must be able to edit tasks and comment in the List. Unfold adds and removes the assignee with `PUT /task/{id}` (`assignees.add` and `assignees.rem`) and comments with `POST /task/{id}/comment` with `notify_all: false`. It finds the team's tracker user among the List's members (`GET /list/{id}/member`) and then the Workspace's (`GET /team`). Ploeg routes a ClickUp assignee by username or email, so either may be the team's tracker user.

A person can hand a task only to a Ploeg team they may use (`ploeg.userTeams`, or any team in scope for an administrator) that has a tracker user. Viewers see the status but cannot hand off. The server rereads the task first. A done, closed or archived task, or one that changed since it was opened, is refused, and the client reloads it. Handing off again, or taking back a task that is not assigned, changes nothing.

The comment reads *Handed to Ploeg team `silver` by NAME from Unfold.*, posted by the connection's tracker account; on ClickUp it is plain text. Taking back removes the assignee only while Ploeg's Work Items for that team are queued, withdrawn, done or stale; once Ploeg has started, cancel the work from the Ploeg view. Ploeg itself withdraws a queued Work Item when its assignee is removed.

The status beside the task shows which team holds it, Ploeg's Work Items for it with their state, branch, spend and pull request, and why hand-off is unavailable when it is. The demo fixture source is not linked to Ploeg and shows no Ploeg work.

## File Report a problem into a tracker

Report a problem ([RFC-0002](../../../../docs/design/rfc-0002-report-a-problem.md)) files what people report into any registered tracker whose adapter declares issue filing: a Forgejo issue, a GitHub issue, a Vikunja task or a Jira issue today. The screenshot, `console.json` and `requests.json` are attached on every tracker except GitHub, whose REST API has no endpoint to upload a file to an issue: there the issue body ends with *Not attached, because this tracker takes no file uploads* and the file names, and Unfold deletes the files with the report's other files after 90 days. The adapter decides the body format (Markdown on Forgejo and GitHub, HTML on Vikunja, ADF converted from Markdown on Jira), whether and how files attach, and what Unfold reads back when it follows the report. It uses one of the task sources above:

```json
"reports": { "source": "forgejo-unfold", "project": "acme/unfold" }
```

On GitHub, `githubApp` takes the place of `tokenEnv` in a connection of its own (see [Connect as a GitHub App](#connect-as-a-github-app)), and a task source that is an App files with a token minted for the report `project`:

```json
"reports": { "provider": "github", "baseUrl": "https://api.github.com", "project": "acme/unfold", "githubApp": { "appId": 123456, "privateKeyEnv": "UNFOLD_GITHUB_APP_PRIVATE_KEY" } }
```

Or give reports a connection of their own, which is not a task source and never appears on the Tasks page. Use this when no task source fits, for example when the repository is one Ploeg dispatches work for, where a task source owned by Unfold is refused at start-up:

```json
"reports": { "provider": "forgejo", "baseUrl": "https://forgejo.example/api/v1", "project": "acme/unfold", "tokenEnv": "UNFOLD_REPORTS_FORGEJO_TOKEN" }
```

* `source` names a task source with a token or a GitHub App whose adapter files issues (Forgejo, GitHub, Vikunja or Jira). Leave `reports` out to use the first such source that Unfold owns (`executionOwner: interactive`) and its own project. A source Ploeg dispatches from is never the default, and naming one requires a different `project`, so a report never becomes agent work. Set `reports` to `false` to keep every report in Unfold and file nothing.
* `project` is optional: `owner/repository` on Forgejo and GitHub, a numeric project ID on Vikunja, or a project key on Jira, when reports belong somewhere other than the source's work.
* If the variable `tokenEnv` names is not set, Unfold starts anyway, logs `reports.token_missing` and keeps reports without filing them. An unreadable GitHub App private key does the same with `reports.app_key_missing`. A connection of its own with both `tokenEnv` and `githubApp`, or neither, stops Unfold at start-up.
* On Forgejo and GitHub the issue gets the label `reported-in-app` when the repository has one by that name; Unfold never creates it. GitHub's [create an issue](https://docs.github.com/en/rest/issues/issues#create-an-issue) drops labels set by a user without push access; when the new issue comes back without the label, Unfold adds it with [`POST /repos/{owner}/{repo}/issues/{number}/labels`](https://docs.github.com/en/rest/issues/labels#add-labels-to-an-issue), which GitHub lists under the Issues write permission for an App's installation token. A personal token needs at least triage access to the repository for that call; a GitHub App needs only Issues read and write. A refused label never stops the report.
* The token needs to create issues and upload issue attachments on Forgejo (`write:issue`), create issues and comment on them on GitHub (a fine-grained token with **Issues: read and write** on the repository; see [GitHub](#github)), create tasks and attachments in the project on Vikunja, or create issues and attachments and add comments in the project on Jira (see [Jira](#jira)).
* Unfold keeps each report before it files it. If the tracker refuses or cannot be reached, the person sees "Saved. Unfold will file it when the tracker answers", and Unfold retries with growing gaps for 24 hours, continuing an issue it already created. The server log line `report.file_failed` gives the tracker's answer.
* Files are deleted 90 days after a report is filed. The report row and its address stay.
* Unfold follows each filed report on the tracker every ten minutes for 180 days (two weeks after it closes, longer while a merged fix waits for a release) and shows the reporter where it stands. On Forgejo the token also needs to read the repository's pull requests and releases (`read:repository`) for *Fixed in* a release. On GitHub the fix is the newest pull request of the same repository in the issue's timeline that references it, and *Fixed in* needs **Contents: read** to list releases. With a token, Unfold recognises its own comments by the login `GET /user` returns. An installation token cannot read `GET /user`, so with `githubApp` Unfold reads the App's slug once from `GET /app`, signed with the App's JWT, and treats comments by `SLUG[bot]`, the login GitHub shows on what an App writes, as its own. A failed read logs `report.follow_failed` and keeps the last answer.
* People can reply to their filed report from Unfold, and a repeat report joins an open one as a comment. Both are written by the token's account, so the token needs to comment on issues or tasks.
* `acknowledgement` (optional, both forms) is one line of at most 280 characters the success screen shows, for example `"We read every report on weekdays."`. Leave it out rather than promise a response time you do not keep.
* With no tracker configured, and always in the demo, Unfold keeps the report and says so.

## Diagnose a connection

Start at **Settings → Connections** (`#settings/connections`, also linked from the Task connections check on Environment). It opens with the **onboarding checklist** ([ADR-0059](../../../../docs/adr/adr-0059-an-organisation-connects-its-forge-and-tracker-from-unfold-and-ploeg-learns-its-repositories-and-boards-at-runtime.md), slice S1 of the `self-serve-onboarding` change), read from `GET /api/onboarding`: one line per stage from signing in to the first pull request, each green only when its check passes against Ploeg's live reads, never because a form was sent.

| Stage | Line | Read from | Today |
|---|---|---|---|
| 0 | Sign in | the session | done when the page shows |
| 1 | Installation | Ploeg's Teams read (a Team exists, its `spendCap`), the connections read (webhooks), and the answers of later dry runs | each install value as a line; `registration_not_accepted`, `bindings_not_accepted`, `connections_not_accepted`, `permission_required` and `person_claim_required` turn their line red as "not opted in" with the install value. **Show the install values** lists every value for the person who installed Unfold and Ploeg |
| 2 | Connect GitHub | the connections read; `GET /api/v1/operator/forge-connections` for whether Ploeg serves the step | "Configured by the installation" when Ploeg routes a GitHub repository; **Connect GitHub** once Ploeg serves its connection routes (Ploeg ADR-0195), green once a GitHub connection made from the screen works; otherwise not available yet. An installation that pushes to another forge reads that adding GitHub needs the Ploeg release with Ploeg ADR-0192 only while the pinned Ploeg is older than 0.2.0-rc.109 |
| 3 | Register repositories | the connections read; repositories added in Unfold; `GET /api/v1/operator/targets` for whether Ploeg serves the step | configured repositories, **Pick repositories** once Ploeg serves runtime registration, green with the repositories Ploeg registered from the screen, or not available yet (Ploeg ADR-0193). Repositories added in Unfold are named with their state: in use, hidden by the configuration, or not in use while the `repositories.stored` flag is off, which turns the line amber |
| 4 | Connect ClickUp | the connections read; `GET /api/v1/operator/tracker-connections` for whether Ploeg serves the step; the connections Ploeg holds that Unfold recorded | configured ClickUp Lists; or, once Ploeg serves the step, green when Ploeg holds a ClickUp connection made through **Connect ClickUp** and otherwise **Connect ClickUp**; or not available yet (Ploeg ADR-0195) |
| 5 | Pick Lists | Unfold's task sources, configured or saved | **Connect a tracker** while there are none |
| 6 | Budget | the Teams read and the confirmations Admins recorded | each Team's cap in USD per UTC period as Ploeg reports it, never an estimate; **Confirm USD 20 a day for `<team>`** records who confirmed which cap and when (`POST /api/onboarding/spend-cap`, audited as an OCSF Entity Management record). A confirmation holds only while Ploeg reports the same cap; a changed cap asks again. Red with "Ask your installer to set the Team's spend cap" when Ploeg reports none; the demo says it is a demo and offers nothing to confirm |
| 7 | Prepare a repository | the pinned Ploeg bundle; the connections read (`prepareAvailable`), the Teams read and each readiness Work Item | not available yet until the pinned bundle carries Ploeg ADR-0194; then one line per repository, described under the readiness pull request below |
| 8 | Review and merge | the connections read and each readiness Work Item | before Ploeg ADR-0194, red with the fix while a repository is not ready; after it, **Open the pull request** for each open readiness pull request, and Level 2 with the next Level 3 check once it merged |
| 9 | Bind Lists | the connections read; `GET /api/v1/operator/tracker-bindings` for whether Ploeg serves the step and each binding's state | configured boards; or, once Ploeg serves the step, one line per List bound through **Connect ClickUp**, green only while Ploeg reports the binding `active`; or not available yet (Ploeg ADR-0186) |
| 10 | Connect Claude | the pinned Ploeg bundle (0.2.0-rc.128 adds the routine routes, Ploeg ADR-0197 section 7) and the Teams this person connected | each person's own line, only for Teams that start their Runs through the person's own Claude routine: **Connect Claude** opens `#settings/claude`, green once the person connected a routine for a Team; not available yet before rc.128. See [Connect your Claude routine](../../../../docs/how-to/connect-your-claude-routine.md) |
| 10, 11 | First task, first pull request | — | the next action; not measured on this page yet |

A step Ploeg does not serve is shown as **Not available yet** with the record that adds it and **Show the configuration entry**, the entry to keep in the configuration instead. Unfold learns it from the step's read route, a `404` meaning not served, or, for a step without one, from the Ploeg bundle it is built against; it never sends a write to find out, and a step a later slice tries before Ploeg serves it is refused with `503 ploeg_step_unavailable`. The step routes and the release that ships Ploeg ADR-0192 are recorded in [`src/ploeg-steps.json`](../../src/ploeg-steps.json), next to the expectation set, and the bundle is the one [`ploeg-release.json`](../../ploeg-release.json) pins, which the image carries: Ploeg decodes `src/ploeg-expectations.json` strictly and checks every interaction in it against its served schemas, so a route no released Ploeg serves cannot be recorded there yet. When Ploeg serves the route, the step turns on without an Unfold restart.

### Connect GitHub and register repositories

**Settings → Connections → Connect GitHub** (`#settings/connections/github`, slice S4) connects GitHub through Ploeg. Ploeg owns the connection ([system ADR-0060](../../../../docs/adr/adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md)): it starts every flow, issues its `state`, converts the App manifest code, holds the App's private key, webhook secret and client secret in its secret store and registers each repository ([Ploeg ADR-0195](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0195-a-proven-operator-makes-and-manages-a-tracker-or-forge-connection-through-a-flow-ploeg-starts-and-the-consumer-only-relays-codes.md), [Ploeg ADR-0193](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0193-a-proven-operator-registers-a-work-target-at-runtime-only-for-a-repository-ploegs-forge-connection-was-granted.md)). Unfold holds no GitHub credential. Only an Admin, and under `tenancy.enforce` an Admin of the Tenant, takes these steps; Ploeg also requires a proven person in every attribution mode.

1. **Create the GitHub App** (or **Install** an App Ploeg already holds). Unfold calls `POST /api/v1/operator/connection-flows` with `port: forge`, `kind: github`, the method and Unfold's callback `<baseUrl>/api/onboarding/github/callback` as `redirectUri`. It keeps only a hash of the `state` Ploeg issues, tied to the person's browser sign-in for ten minutes, and sends the person to GitHub through a one-time page on Unfold whose single form posts the manifest Ploeg built to GitHub. That one-time step is kept in the Unfold process's memory, which assumes one Unfold replica, as its SQLite store does; after a restart the Admin starts again.
2. **GitHub sends the person back** to the callback with the manifest `code`, or after an install with `installation_id` and `setup_action`. Unfold accepts a `state` only from the same person and sign-in, within ten minutes, once, and otherwise answers `400 onboarding_state_invalid` and relays nothing. It relays the value to `POST /api/v1/operator/connection-flows/complete` in a request body, allowing it 45 seconds, and stores and logs none of it. It forgets the `state` once Ploeg completed or refused the flow and keeps it when Ploeg could not answer, so reloading the page gets Ploeg's `replayed` answer instead of a second exchange. After the App is created, the person goes straight on to install it on the repositories agents may work on.
3. **Pick repositories.** `GET /api/v1/operator/forge-connections/{connection}/repositories` lists what the installation reaches; Unfold reads every page of it (Ploeg answers at most 100 per page) up to 1000 repositories, and offers only those the grant may write to (`canWrite`). For each one the Admin names an explicit lower-case key (`repo/<key>` on tasks) and **Check**s it: `POST /api/v1/operator/targets?dryRun=true` shows every check. **Register** runs the dry run again, then `POST /api/v1/operator/targets`, and stores the repository in Unfold (it needs the `repositories.stored` flag; a repository the Tenant already has is refused with `409 repository_exists` before Ploeg is asked), granted to Own work, with the target key and Ploeg's `prepareAvailable`, never derived from reason text.

Unfold stores one Integration Account per Ploeg connection, keyed with the Ploeg connection id; the installation id stays in Ploeg. Each Integration Account and each GitHub App Ploeg created is audited as an OCSF Entity Management record. The callback path carries the code in its query string: Unfold writes no request log and records no `GET` in its action records or audit chain, but the installer's ingress access log can, so exclude `/api/onboarding/github/callback` from it.

Until Ploeg serves `GET /api/v1/operator/forge-connections` (and `GET /api/v1/operator/targets` for registering), every step is refused with `503 ploeg_step_unavailable` before anything is sent. An installation whose Ploeg already pushes to another forge is refused with `409 second_forge_unsupported` only while the pinned Ploeg is older than 0.2.0-rc.109, the first release with Ploeg ADR-0192; the pinned Ploeg is newer, so Connect GitHub works next to another forge. Ploeg's opt-in refusals, `422 connections_not_accepted` and `422 registration_not_accepted`, turn the installation line red with the install value; when Ploeg refuses the connections read itself, the page shows the code and the install value and changes nothing. Below that release, if Ploeg's connections read fails, Unfold cannot tell whether the installation pushes to another forge and starts no connection. The connection routes and fields Unfold reads follow Ploeg's operator schema as built for Ploeg ADR-0195 (ploeg-hq/ploeg pull request #433); the runtime target routes follow Ploeg ADR-0193 until Ploeg serves them.

The **spend-cap gate** (slice S6) sits in front of the two onboarding steps that spend or lead to spend. Preparing a repository and binding a List during onboarding are refused with `409 budget_missing` while Ploeg's Teams read reports the Team's `spendCap` as null, and preparing a repository also with `409 spend_cap_unconfirmed` until an Admin confirmed the cap Ploeg reports now. Unfold reads the Teams fresh and sends Ploeg nothing when it refuses. Hand-off and import from task sources configured outside onboarding never pass through the gate: a configured installation keeps working as before, whatever its Teams' caps. A cap cannot be zero (Ploeg's schema requires more than 0), and the chart's default is USD 20 a day ([Ploeg ADR-0162](../../../ploeg/docs/adrs/0162-a-team-spends-at-most-its-cap-per-period-and-a-claim-over-it-starts-nothing.md)); changing it at runtime is not part of v1.

The **readiness pull request** (slice S7) is the first value for a repository that misses only its `AGENTS.md`. It waits for the release of [Ploeg ADR-0194](../../../ploeg/docs/adrs/0194-a-repository-missing-only-its-instruction-file-may-receive-one-run-that-adds-it.md): until [`src/ploeg-steps.json`](../../src/ploeg-steps.json) names that release and the pinned bundle reaches it, the line stays **Not available yet** and `POST /api/onboarding/prepare` answers `503 ploeg_step_unavailable` without sending anything. Once Ploeg serves it:

- **The offer.** Only a repository Ploeg reports with `prepareAvailable: true` gets **Prepare this repository**; Unfold never reads it from the reason text. An archived repository, a mirror or any other reason shows that reason and no offer. The button names the cap that bounds the Run: the lowest cap Unfold can read, today the Team's spend cap from the Teams read. Ploeg lowers the Run's pool further to the Team's prepare cap (USD 2.00 by default) and the plan's pool, which it does not report, and the line says so. Nothing is estimated.
- **The confirmation.** The button sends the cap shown; Unfold re-reads the Team and answers `409 spend_cap_changed` when the cap is another one now, so the person confirms again. It admits one `prepare_repository` Work Item through `POST /api/v1/operator/work-items` with `kind`, `team`, `target`, `budgetUsd` set to that cap and no title or brief, as the person, with their token where person proof is set up (Ploeg refuses asserted attribution for this kind). The confirmation is audited as an OCSF Entity Management record naming the person, the repository and the cap.
- **Once per repository.** Unfold stores the Admission's `requestId`, which carries a random part, before sending it. A double click, a retry after a lost answer or a restart answers the Work Item that exists; a restart never resends anything by itself. A `409 prepare_in_progress` keeps that request, so the next try replays it. Only a read by someone who manages the Tenant stores what Ploeg reports about the Work Item; anyone else's read changes nothing.
- **Cancel.** **Cancel** stops the Work Item through Ploeg's cancel and never starts another. Before the pull request opened, the offer returns. After it opened, the line shows what Ploeg answered: the pull request closed, and the offer returns; or still open, and the line links it and offers nothing until a person closes it, while Ploeg answers `409 prepare_in_progress` to a new prepare.
- **Review and merge.** An open readiness pull request gets **Open the pull request** on the Review and merge line, with a note that a reviewer's findings are posted but no Run fixes them. Seeing it open records `onboarding.first_agent_pr_opened` once per Tenant. After a person merges it and Ploeg reports the repository ready, the line shows Level 2 of the AI Codebase Maturity Model ([ADR-0047](../../../../docs/adr/adr-0047-unfold-describes-a-repository-with-the-ai-codebase-maturity-model-and-delivers-at-level-5.md)) and names the next Level 3 check, required checks on the base branch, which Ploeg does not report yet. The Bind Lists line names the repository as ready for a List.

Product events of these per-repository lines are not recorded, so no event names a repository. The demo says it is a demo, opens nothing and spends nothing.

Only an administrator, and under `tenancy.enforce` an Admin of the Tenant, gets the actions and the install values. Everyone else reads the same lines with "Ask an administrator to connect this", and the page never says who the administrators are. An Admin who signs in while the Tenant has no task source and no repository at all, configured or stored (a stored repository counts even while the `repositories.stored` flag keeps it out of use), lands on this page instead of Now; an installation with configured entries never does. The checklist records the `onboarding.*` product events (`started` once per Tenant, `step_completed`, `step_failed`, `step_refused`, `first_agent_pr_opened`, `first_task_pr_opened`) with a pseudonymous actor and codes only, never screen text; they stay inside the installation unless an [insight sink](live.md) is set.

### Connect ClickUp and bind Lists

**Settings → Connect ClickUp** (`#settings/connect-clickup`, slice S5 of the `self-serve-onboarding` change) connects ClickUp through Ploeg and keeps no ClickUp credential in Unfold, as the owner decided on 2026-11-18 (system ADR-0060, being written). Only an Admin acts on it. Every step is admitted through the checklist's step availability, so the page is safe on a Ploeg that does not serve the routes yet: it says which release adds the step and sends nothing.

1. **The member guide.** The ClickUp adapter's setup capability says, in plain words, why Unfold needs its own ClickUp member (ClickUp has no bot accounts; a token acts as the person who made it, and ClickUp stops a webhook when that person leaves) and the four steps to invite it, sign up as it in a private window and generate its token.
2. **Hand the token to Ploeg once.** The pasted token is checked for ClickUp's shape (`400 connection_token_invalid` before any request leaves Unfold), then relayed to Ploeg's connection flow (`POST /api/v1/operator/connection-flows` with `method: token` and `handOverAgent: true`, then `POST /api/v1/operator/connection-flows/complete`, Ploeg ADR-0195). Ploeg checks it with ClickUp and stores it in its own secret store. Unfold records an Integration Account holding the Ploeg connection id, the method and the account name, and no token: the ADR-0064 sealed copy is never written for such a connection, and **Connect a tracker** refuses to replace or remove it (`409 connection_held_by_ploeg`). When the account Ploeg names is the signed-in Admin's own, Unfold asks Ploeg to remove the connection again and answers `400 connection_token_personal`. The check is best effort: it matches the account's immutable ClickUp id against the Admin's linked account where Unfold knows that id, and otherwise only the Admin's sign-in name and linked ClickUp login, so it catches the common mistake, not a determined one. When Ploeg answers `409 already_connected`, Unfold adopts the connection Ploeg names. A connection Ploeg holds that Unfold never recorded, because an answer was lost, is listed under **Held by Ploeg, not recorded here** with **Adopt** and **Remove from Ploeg**. When the installation has a ClickUp OAuth application, **Sign in to ClickUp as the Unfold member** starts Ploeg's `oauth` flow instead; ClickUp returns to `/api/onboarding/clickup/callback`, which relays the code only for the same person and browser sign-in within ten minutes (`onboarding_state_invalid` otherwise), and only to ClickUp's own origin is the person sent. Completing waits up to 45 seconds, and the `state` is kept until Ploeg completes the flow or refuses it, so a callback retried after a lost answer gets Ploeg's `replayed` outcome instead of a refusal. Unfold keeps only a hash of Ploeg's `state`, and neither the code nor the state is stored or logged.
3. **Pick a List.** The picker reads the connection's containers through Ploeg's Scope read ([Ploeg ADR-0196](https://github.com/ploeg-hq/ploeg/pull/430), proposed): `GET /api/v1/operator/tracker-connections/{id}/scopes`, one level at a time, Workspace → Space → Folder or folderless List → List, passing each Scope's `ref` back as `parent`. Only a List is bindable. Names come under `untrusted` and are shown escaped, never as markup or instructions. Ploeg answers only a consumer whose `readTrackers` grant names the connection (`403 permission_required`, which turns the Installation line red). No Ploeg release serves the read yet, so the step is gated on the pinned release in `src/ploeg-steps.json`; until then, and when a read fails, the page asks for the List's id. Unfold never asks ClickUp itself.
4. **Map and bind.** The Admin picks the Team (one without a spend cap cannot be picked: `409 budget_missing`), the default repository and further repositories. Only Work Targets that Ploeg's connections read reports **ready** and that match a repository of the Tenant's own work are offered; a repository that waits for its readiness pull request is named and refused with `409 repository_not_ready` before anything is sent. Unfold runs Ploeg's dry run first (`POST /api/v1/operator/teams/{team}/tracker-bindings?dryRun=true`, Ploeg ADR-0186) and shows each check; only when every check passes does it create the binding. Ploeg answers a repeated create with the binding that exists, so a retry leaves one binding. The List is saved as a task source in Own work with the binding's id, Team, state and Work Target; while the binding is `active` or `awaiting_webhook` the source carries that target, so import from it no longer answers `task_binding_unconfigured`. `409 conflicts_with_static` means the installation's configuration routes the List: the page says "Configured by the installation" with the entry Ploeg names and stores nothing.
5. **Done only when active.** A binding Ploeg holds as `awaiting_webhook` stays amber with **Check again**: Ploeg does not poll ClickUp, so no task arrives until a webhook delivers. **Check again** and every load of the page read Ploeg's bindings again; a binding Ploeg no longer holds turns the List red with **Bind again**, and the source loses its target. **Remove the binding** asks Ploeg to remove it and treats an already removed one as done, writing one OCSF delete record. A connection is removed only after its Lists are (`409 connection_in_use`), through `DELETE /api/v1/operator/tracker-connections/{id}`.

Each connection and binding created or removed is an OCSF Entity Management record in the Tenant's audit chain, without a token, code or `state`. Until Ploeg serves the Scope read and the hand-over action (design ask 6), the Tasks page cannot read or hand off a List bound this way, because Unfold holds no token for it; a person assigns the task to the Unfold member in ClickUp, and Ploeg takes it in through the binding.

Below the checklist, every board and repository Ploeg routes to is marked **Configured by the installation**: today all of them come from Ploeg's configuration. The page reads Ploeg's `GET /api/v1/operator/connections` (Ploeg ADR-0129) and matches it against the task sources here. Each board shows whether assignments reach Ploeg, which Teams can be assigned on it, where its work goes and whether Unfold lists it. Each repository shows whether it is ready for agents, whether its forge has sent Ploeg any pull request event in 30 days, and which boards reach it. A task source that hands work to Ploeg on a board Ploeg does not route is listed first, because a hand-off there assigns the Team and nothing starts. Every problem names its fix. A Ploeg release without the connections read gets a note saying so instead.

| Symptom | Check |
| --- | --- |
| Server rejects a missing credential | The named environment variable is present in the actual server process. Supplying it only to the editor does not configure the server |
| Authorization rejected | Token expiry, provider read permissions, account/project access and the instance's authentication policy |
| Source or task missing | API root versus browser URL, exact repository/project/List scope, home List membership, and issue number versus global provider ID |
| No tasks on a page | Open/incomplete task state, selected page, and whether the provider returned only excluded pull requests |
| Task changed during import | Refresh the preview and approve the new content; don't reuse the previous revision |
| Shared import blocked | Check the explicit source target, singleton API root, configured execution team and current queued/pristine Ploeg item. Unsupported tracker providers remain inspection-only in shared mode |
| Redirect or unexpected content rejected | Configure the final API root directly and inspect the reverse proxy; login HTML is not an API response |
| Description too large | Bound the task's actionable scope in the tracker, or create a smaller task. A list shows it truncated; preview and import refuse it rather than truncate it |
| Jira answers `task_page_expired`, `task_page_missing` or `task_moved` | Jira pages by token, so a page far past the last one read is refused: start from the first page. A moved or renamed issue has a new key: open it from the list again |
| Jira refuses the credentials | A scoped token needs the gateway root `api.atlassian.com/ex/jira/CLOUD-ID/rest/api/3`; a classic `email:token` needs the site root `SITE.atlassian.net/rest/api/3` |
| Not sure whether a source works | **Settings › Connect a tracker › Test connection** reads it the way the Tasks page does, says as whom, and names the code and fix of the first step that fails |
| `task_rate_limited` | The tracker refused because this token asked too often; the message names the seconds until it may ask again. On ClickUp, several people sharing one `tokenEnv` source share its 100 requests a minute; sources read with linked accounts spend each person's own |
| Hand-off refused with `task_write_forbidden` | The tracker token can read but not change the task. Grant it task assignee and comment permissions in Vikunja, or task edit and comment access to the List in ClickUp |
| No team to hand off to | Your account needs Ploeg team access in `ploeg.userTeams`, and the team needs a tracker user in Ploeg's configuration. An older Ploeg does not report tracker users at all |

The tests exercise provider contracts with local HTTP fixtures. They do not demonstrate live authentication against your accounts, verify every self-hosted version, or create external tasks. The [connector source notes](../research/task-connector-sources.md) record the inspected official API contracts and adapter limits. Record the instance version and a real list → preview → import result in [validation](../validation.md) during qualification.

## Proposed extensions

The connection-management proposal includes provider authorization where applicable and one Connection per origin for the tracker, account-link and publisher roles; adding ClickUp sources and rotating their token from the screen is its first slice. The health view is the Connections page above. The broader unattended delivery proposal includes authenticated webhooks and reconciliation through Ploeg, transactional deduplication, one canonical WorkOrder, independent verification and fenced publication. Both clients should remain thin views over those shared contracts.

The [ticket integration design](../design/ticket-integration.md) and [system design](../PRODUCT-DESIGN.md) describe that larger system. The registered adapters are a starting point for it; they do not make arbitrary project-management APIs automatically compatible.
