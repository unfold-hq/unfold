---
type: how-to
audience: [operator, developer, product-owner]
owner: unfold
last_verified: 2026-11-26
verified_by: "Read docs/how-to/connect-gitlab.md, docs/how-to/review-an-agent-pr.md, apps/unfold/src/gitlab-connections.ts, apps/unfold/src/ploeg-steps.json, apps/unfold/src/onboarding.ts (available), apps/unfold/public/views/connect-gitlab.js, apps/unfold/src/links.ts, apps/unfold/src/link-providers/gitlab.ts, apps/unfold/src/config.ts (links), apps/unfold/src/http.ts (the link callback), apps/unfold/public/views/account.js, apps/unfold/public/app.js, apps/unfold/public/shell.js, apps/unfold/public/views/session.js (What to do), apps/unfold/docs/operations/configuration.md (links.gitlab), apps/unfold/ops/helm/unfold/values.schema.json (config.links.gitlab) and apps/unfold/docs/operations/task-connections.md; read apps/unfold/src/engine.ts (linkHint, requireCloneLink), apps/unfold/src/error-catalogue.ts and apps/unfold/changes/ on origin/development at 235877dd. Nothing was run: no test, no installation, no GitLab. On 2026-11-26 the Status, Before you start and the table were updated for the 0.2.0-rc.131 release that src/ploeg-steps.json records for connect-gitlab-service-account and gitlab.mint, checked by test/connect-gitlab.test.ts against a fake Ploeg."
---

# GitLab onboarding

With GitLab connected, agents clone your GitLab projects, push their branches and open merge requests there for you to review. GitLab has two separate connections: the one Ploeg pushes and opens merge requests with (the Admin sets it up once), and each person's own GitLab link, which Unfold clones with for that person's sessions.

**Status:** GitLab is **Experimental** as a forge: every writer Run pushes with one shared token, which puts it outside Ploeg's supported profile ([support matrix](../../apps/ploeg/docs/reference/support-matrix.md), [Connect GitLab](../how-to/connect-gitlab.md)). Creating the connection from a temporary Owner token needs Ploeg 0.2.0-rc.131 or later, the release this Unfold records for it ([ploeg-steps.json](../../apps/unfold/src/ploeg-steps.json)); the pinned Ploeg is newer, so it is offered. It was not run against a live GitLab.

## Admin: connect GitLab once

Before you start:

- You are an Admin in Unfold, and you know your Unfold address, for example `https://unfold.example.org`.
- Your Ploeg is 0.2.0-rc.131 or later if it already pushes to another forge: below that release Unfold refuses GitLab next to another forge.
- You can create a GitLab service account (or a dedicated user) with the Maintainer role on the projects agents work in, and an OAuth application on `https://gitlab.example.org`.

**Part 1: the forge connection Ploeg uses.**

1. Create a personal access token for the service account with the `api` scope.
2. Open **Settings › Connections** and choose **Connect GitLab** (or go to `https://unfold.example.org/#settings/connections/gitlab`).
3. Open **I already made a service account**, paste the token into **The service account's token** and choose **Hand the token to Ploeg**. Unfold hands it to Ploeg once and keeps no copy. Or, as an Owner of the top-level group, use **Create the connection with a temporary Owner token**: Ploeg creates the service account itself and revokes the token you pasted.
4. Under **GitLab connections Ploeg holds**, choose **Pick projects**, then register the projects agents may work in. If Ploeg answers that it cannot give each Run its own GitLab credential, it registers nothing: the person who installed Ploeg configures the projects in Ploeg's chart instead (`executor.gitlab`), as [Connect GitLab](../how-to/connect-gitlab.md#today-configure-gitlab-in-ploeg) describes, including the merge request webhook.

If the page says **Not available yet** or **Not opted in**, the person who installed Ploeg must allow GitLab connections first (`connections.allow`); [Diagnose a connection](../../apps/unfold/docs/operations/task-connections.md#connect-gitlab-and-register-projects) has the details.

**Part 2: let people link their own GitLab account.**

1. In GitLab, create an OAuth application with the redirect URI `https://unfold.example.org/api/links/gitlab/callback` and the scopes `read_api`, `read_repository` and `write_repository`. Untick **Confidential**: Unfold uses OAuth with PKCE and holds no client secret.
2. In Unfold's configuration (Helm: `config.links.gitlab`), set `links.gitlab.baseUrl` to `https://gitlab.example.org` and `links.gitlab.clientId` to the application id (or `UNFOLD_GITLAB_CLIENT_ID`). Unfold's `baseUrl` must be its public address, because the redirect URI is built from it.

Without `links.gitlab.clientId`, people paste a personal token instead of signing in. Without `links.gitlab` at all, **Linked accounts** shows no GitLab card. A demo installation refuses `links`. Every key is in the [configuration reference](../../apps/unfold/docs/operations/configuration.md).

**Done when** the GitLab connection reads **Works** on **Connect GitLab**, and a developer sees a GitLab card for `gitlab.example.org` under **Settings › Linked accounts**.

## Developer: link your GitLab account and review merge requests

1. Open **Settings › Linked accounts** (`#settings/accounts`). The GitLab card shows your GitLab host and **Not linked**.
2. Choose **Link GitLab**, sign in at GitLab and authorize the application. Back in Unfold you see "GitLab is linked to your account."
3. No **Link GitLab** button, or you prefer a token: in GitLab open **Preferences › Access tokens**, create a token with `read_api`, `read_repository` and `write_repository`, paste it into **Personal token** (under **Use a personal token instead** when OAuth is offered) and choose **Save token**.
4. Start sessions as usual. Unfold clones repositories on that GitLab host with your link; the agent workspace never receives it.
5. When a Work Item waits for you, open it from **Now** (**Ready for your review**) and follow **Open pull request #N** to the merge request on GitLab. Check the evidence, then merge or close it on GitLab; Unfold does not merge. [Review an agent's pull request](../how-to/review-an-agent-pr.md) has the full checklist.

**When it works**, the card reads **Linked**, with **Signed in as**, **Method** (**Signed in with OAuth** or **Personal token**) and, for OAuth, **Access: Renews when used**. A token link shows its expiry and **Expires soon** in its last week.

**To send work back on GitLab**, put the requested changes in the ticket description, then remove the assignee and assign it again. Requesting changes in a GitLab review sends nothing back; only Forgejo reviews are read ([Send it back](../how-to/review-an-agent-pr.md#send-it-back)).

**When it fails**, see the table below. **Unlink GitLab** on the card forgets your tokens and asks GitLab to revoke them; a pasted token stays valid at GitLab until you revoke it there.

## Product owner: follow the merge request

1. Open the Work Item in Unfold. While it is ready for review, the box **Ready for your review** links **Open pull request #N**: the merge request on GitLab.
2. Sign-off follows the merge: once a developer merges it on GitLab, Ploeg moves the Work Item to `done` and comments on the ticket ([After you merge or close](../how-to/review-an-agent-pr.md#after-you-merge-or-close)).

## When something goes wrong

| What you see | Why | What to do |
| --- | --- | --- |
| "The provider refused the exchange. For GitLab that means the application is marked Confidential…" | The OAuth application is confidential; Unfold sends no client secret | Admin: edit the application in GitLab, untick **Confidential**; then link again |
| "The link attempt expired or was started elsewhere. Start it again from this page." | More than ten minutes passed, or you finished in another browser | Choose **Link GitLab** again in the same browser |
| "You declined the authorization at GitLab." | You chose not to authorize | Link again and authorize |
| "GitLab refused the linked account lookup with HTTP 401." | The pasted token is wrong, expired or lacks `read_api` | Create a new token with the three scopes and save it again |
| "Unfold clones *repository* with your own *host* link, and your account has none…" (`link_required`) | You have no GitLab link, and the repository is cloned with it | Link GitLab under **Settings › Linked accounts**, then start again |
| A failed session whose **What to do** says "Your *host* link exists but the clone was refused. Unlink and link *host* again…" | Your link no longer works for that repository | Unlink and link GitLab again, then try again |
| "The GitLab link expired and cannot be refreshed. Link GitLab again." | The OAuth link has no refresh token left | Link GitLab again |
| **Waits for Ploeg** on **Create the connection with a temporary Owner token** | The Ploeg this Unfold is built against is older than 0.2.0-rc.131 | Use **I already made a service account**, or move to an Unfold built against a newer Ploeg |
| "Ploeg cannot give each Run its own GitLab credential through this connection…" | Ploeg does not mint per-Run GitLab tokens through this connection: a Ploeg older than 0.2.0-rc.131, or a token without `api` or Maintainer reach | Configure the projects in Ploeg's chart ([Connect GitLab](../how-to/connect-gitlab.md)) |
| "The token lacks the api scope. Create it again with api ticked." | The service account's token has the wrong scope | Create a token with `api` and connect again |

The `link_required` refusal and the git output kept on a failed Kubernetes clone are on the development line and arrive with the next Unfold release; until then a session without a link fails after starting with "The workspace could not be prepared."
