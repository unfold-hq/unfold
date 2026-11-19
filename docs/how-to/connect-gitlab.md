---
type: how-to
audience: [owner, operator]
owner: unfold
last_verified: 2026-11-19
verified_by: "Read the pinned Ploeg's cmd/ploegd/runtime_connections.go (the gitlab connector), pkg/provider/gitlab/connect.go, pkg/connection/config.go (the methods a flow accepts), docs/reference/configuration.md (executor.gitlab) and docs/reference/support-matrix.yaml (forge-gitlab); read apps/unfold/public/views/connections.js and src/ploeg-steps.json, which have no GitLab step. The service-account flow is planned and was not run; nothing was run against a live GitLab."
---

# Connect GitLab

Use this when your code lives on GitLab and you want Ploeg to push agent branches and open merge requests there. Result: Ploeg holds a GitLab credential, pushes each writer Run's branch and opens a merge request for review. Unfold holds no GitLab credential ([ADR-0060](../adr/adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md)).

GitLab is **Experimental** as a forge: Ploeg implements it, but every writer Run shares one token, which puts it outside Ploeg's supported profile ([support matrix](../../apps/ploeg/docs/reference/support-matrix.md)). Unfold's **Settings › Connections** has no Connect GitLab step yet. This page says what works today and what is planned.

## Today: configure GitLab in Ploeg

The operator of Ploeg sets GitLab in Ploeg's chart. The [configuration reference](../../apps/ploeg/docs/reference/configuration.md) lists every key.

1. Create a GitLab user for Ploeg and give it the Developer role or higher on the projects agents work in.
2. Create a token for it with scope `api` and store it in a Kubernetes Secret.
3. Set `executor.gitlab.url` to the GitLab base URL without `/api/v4`, and `executor.gitlab.tokenSecret` to the Secret. When `executor.gitlab.url` is set, GitLab must be the release's only forge.
4. Set `executor.gitlab.webhookSecret` and add a project or group webhook to `https://<ploeg>/webhooks/forge/gitlab` with the same secret, so Ploeg hears about merge request events.
5. If a Team has a reading Role, set `executor.gitlab.readTokenSecret` to a read-only token; the chart refuses to render without one.

Every writer Run pushes with the token from step 2. That token can reach every project the user can, so keep the user's memberships to the projects agents work in.

## Today: connect GitLab through Ploeg's connection API

Ploeg can also connect GitLab at runtime, through its connection flows with method `oauth` (an instance with a GitLab OAuth application) or `token` (a pasted token, when the instance has no OAuth application). [Let operators connect trackers and forges](../../apps/ploeg/docs/how-to/let-operators-connect-trackers-and-forges.md) describes the configuration. Unfold does not start these flows for GitLab yet, so an operator consumer other than Unfold has to.

## Planned: Connect GitLab in Unfold

Planned, not built: no Ploeg release serves the `gitlab_service_account` method, and Unfold has no page for it. When a Ploeg release serves it, connecting GitLab will work like this:

1. An Owner of a top-level GitLab group opens **Settings › Connections › Connect GitLab** in Unfold.
2. They create a temporary personal access token with scope `api` and paste it. Unfold relays it to Ploeg once and keeps no copy.
3. They choose the group Ploeg may work in.
4. Ploeg creates a service account in that group with the temporary token, keeps the service account's own credential in its secret store, and revokes the temporary token.
5. For each writer Run, Ploeg mints a project access token limited to that Run's project and revokes it when the Run ends, so no Run holds a token that reaches another project.

The per-Run project tokens are what would bring GitLab inside Ploeg's supported profile, as GitHub App installation tokens and Forgejo repository tokens already are.

## Related

- [Integrations](../reference/integrations.md#port-forges): every forge, how each connects and what it speaks.
- [Connect ClickUp](connect-clickup.md), the tracker side of the same pattern.
