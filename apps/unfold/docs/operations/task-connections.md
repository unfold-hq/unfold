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

**Where they are kept.** A connection is an Integration Account (system [ADR-0048](../../../../docs/adr/adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md)) in the `integration_accounts` table, with the role `tracker`, keyed by Tenant, provider, API root and account id. A store from before this table is migrated on the first start: each connection keeps its id and the token stays sealed under the same id. A saved source without a Client belongs to its Tenant's **Own work**, the Client Project without a Client, which Unfold makes on first use.

**Tenant export.** The connections and their sources are exported with their Tenant as `integration-accounts` and `tracker-connection-sources`; their tokens are not. After an import an administrator pastes each token again; until then the connection says its token is missing.

### Repositories added from the screen

An administrator, and while `tenancy.enforce` is on an Admin of the Tenant, can store a repository with `POST /api/repositories` and an HTTPS forge URL such as `https://github.com/acme/shop`. Its key is the forge host and `owner/name`, lower-cased and without `.git`, the same key [who owns a source and a repository](#who-owns-a-source-and-a-repository) uses; Unfold refuses a second repository with the same key (`repository_exists`). The repository belongs to the Tenant and is granted to the Tenant's Own work, which is made on first use. It joins the configured repositories after them, so saved sources, hand-off and sessions can use it, and `PATCH` and `DELETE /api/repositories/{id}` change or remove it; removing is refused while a saved source uses it (`repository_in_use`). Storing a repository sends nothing to Ploeg or the forge: Ploeg still works only on the targets it knows.

A repository in the configuration wins. When one with the same key or id is added there later, the stored one is marked `shadowed`, kept and not used; a configured repository cannot be changed from the screen (`repository_read_only`). Another Tenant's repository answers 404. `GET /api/client-projects` lists each Tenant's Client Projects with `visible`, which is false until the Tenant has a Client, so the screens show no project choice before then.

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

Start at **Settings → Connections** (`#settings/connections`, also linked from the Task connections check on Environment). It reads Ploeg's `GET /api/v1/operator/connections` (Ploeg ADR-0129) and matches it against the task sources here. Each board shows whether assignments reach Ploeg, which Teams can be assigned on it, where its work goes and whether Unfold lists it. Each repository shows whether it is ready for agents, whether its forge has sent Ploeg any pull request event in 30 days, and which boards reach it. A task source that hands work to Ploeg on a board Ploeg does not route is listed first, because a hand-off there assigns the Team and nothing starts. Every problem names its fix. A Ploeg release without the connections read gets a note saying so instead.

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
