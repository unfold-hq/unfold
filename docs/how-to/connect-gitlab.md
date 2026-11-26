---
type: how-to
audience: [owner, operator]
owner: unfold
last_verified: 2026-11-26
verified_by: "Read the pinned Ploeg's cmd/ploegd/runtime_connections.go (the gitlab connector), pkg/provider/gitlab/connect.go, pkg/connection/config.go (the methods a flow accepts), docs/reference/configuration.md (executor.gitlab) and docs/reference/support-matrix.yaml (forge-gitlab); read apps/unfold/src/gitlab-connections.ts, public/views/connect-gitlab.js and src/ploeg-steps.json (connect-gitlab, connect-gitlab-service-account and gitlab.mint), and test/connect-gitlab.test.ts against a fake Ploeg. The service-account flow is planned and was not run; nothing was run against a live GitLab. On 2026-11-24 the service-account section was reread against ploeg-hq/ploeg#464 (merged into v0.2.0-rc.131), the pinned 0.2.0-rc.134 bundle and apps/unfold/src/ploeg-steps.json; not run live. On 2026-11-26 the releases were rechecked after ploeg-steps.json recorded 0.2.0-rc.131 for connect-gitlab, connect-gitlab-service-account and gitlab.mint: #464's merge commit is v0.2.0-rc.131, gitlab_service_account first appears in that release's operator schema, and pkg/provider/gitlab/connect.go probes a pasted personal token's scopes and Maintainer reach from that release; test/connect-gitlab.test.ts covers rc.130 and rc.131 against a fake Ploeg."
---

# Connect GitLab

Use this when your code lives on GitLab and you want Ploeg to push agent branches and open merge requests there. Result: Ploeg holds a GitLab credential, pushes each writer Run's branch and opens a merge request for review. Unfold holds no GitLab credential ([ADR-0060](../adr/adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md)).

GitLab is **Experimental** as a forge: Ploeg implements it, but every writer Run shares one token, which puts it outside Ploeg's supported profile ([support matrix](../../apps/ploeg/docs/reference/support-matrix.md)). This page says what works today and what is planned.

## Today: configure GitLab in Ploeg

The operator of Ploeg sets GitLab in Ploeg's chart. The [configuration reference](../../apps/ploeg/docs/reference/configuration.md) lists every key.

1. Create a GitLab user for Ploeg and give it the Developer role or higher on the projects agents work in.
2. Create a token for it with scope `api` and store it in a Kubernetes Secret.
3. Set `executor.gitlab.url` to the GitLab base URL without `/api/v4`, and `executor.gitlab.tokenSecret` to the Secret. When `executor.gitlab.url` is set, GitLab must be the release's only forge.
4. Set `executor.gitlab.webhookSecret` and add a project or group webhook to `https://<ploeg>/webhooks/forge/gitlab` with the same secret, so Ploeg hears about merge request events.
5. If a Team has a reading Role, set `executor.gitlab.readTokenSecret` to a read-only token; the chart refuses to render without one.

Every writer Run pushes with the token from step 2. That token can reach every project the user can, so keep the user's memberships to the projects agents work in.

## Today: connect GitLab through Ploeg's connection API

Ploeg can also connect GitLab at runtime, through its connection flows with method `oauth` (an instance with a GitLab OAuth application) or `token` (a pasted token, when the instance has no OAuth application). [Let operators connect trackers and forges](../../apps/ploeg/docs/how-to/let-operators-connect-trackers-and-forges.md) describes the configuration.

Unfold starts the `token` flow from **Settings › Connections › Connect GitLab**: an Admin pastes the personal access token of a GitLab service account they made (scope `api`, Maintainer on the projects) under **I already made a service account**, and Unfold relays it to Ploeg once and keeps no copy. The installation's `connections.allow` must list `{port: forge, kind: gitlab, instance: gitlab, methods: [token]}`. Picking projects works. Registering one needs a connection Ploeg can mint each Run's credential through (Ploeg 0.2.0-rc.131 and later, with a token that has `api` and Maintainer reach); otherwise Ploeg answers `capability_missing` and the projects are configured in Ploeg's chart as above. [Diagnose a connection](../../apps/unfold/docs/operations/task-connections.md#connect-gitlab-and-register-projects) has the details.

## Connect GitLab in Unfold from a temporary Owner token

Ploeg serves the `gitlab_service_account` method from 0.2.0-rc.131 ([ploeg-hq/ploeg#464](https://github.com/ploeg-hq/ploeg/pull/464), [Ploeg ADR-0203](../../apps/ploeg/docs/adrs/0203-a-gitlab-forge-connection-is-a-group-service-account-that-mints-a-project-token-per-run.md)), and the pinned Ploeg is newer. Unfold records that release for the step `connect-gitlab-service-account` in [`ploeg-steps.json`](../../apps/unfold/src/ploeg-steps.json), so the page offers it; an Unfold built against an older Ploeg refuses it with `ploeg_step_unavailable` and names 0.2.0-rc.131. The same release lets GitLab connect next to another forge. GitLab gates service accounts and project access tokens by plan: on gitlab.com they need Premium or Ultimate, and the Owner must be identity-verified ([Ploeg's how-to](../../apps/ploeg/docs/how-to/let-operators-connect-trackers-and-forges.md)). Nothing here was run against a live GitLab. Connecting GitLab works like this:

1. An Owner of a top-level GitLab group opens **Settings › Connections › Connect GitLab** in Unfold.
2. They create a temporary personal access token with scope `api` and paste it. Unfold relays it to Ploeg once and keeps no copy.
3. They choose the group Ploeg may work in.
4. Ploeg creates a service account in that group with the temporary token, keeps the service account's own credential in its secret store, and revokes the temporary token.
5. For each writer Run, Ploeg mints a project access token limited to that Run's project and revokes it when the Run ends, so no Run holds a token that reaches another project.

The per-Run project tokens are what would bring GitLab inside Ploeg's supported profile, as GitHub App installation tokens and Forgejo repository tokens already are.

## Related

- [Integrations](../reference/integrations.md#port-forges): every forge, how each connects and what it speaks.
- [Connect ClickUp](connect-clickup.md), the tracker side of the same pattern.
