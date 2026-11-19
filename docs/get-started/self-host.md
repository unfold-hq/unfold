---
type: how-to
audience: [operator]
owner: unfold
last_verified: 2026-11-19
verified_by: "Read docs/how-to/self-host-the-whole-stack.md, docs/workflows/managed-execution.md, apps/unfold/docs/operations/task-connections.md, apps/unfold/src/task-providers/ (label and issues of each adapter), apps/unfold/src/onboarding.ts and src/ploeg-steps.json (secondForge), and at the pinned Ploeg 0.2.0-rc.130 bundle: how-to/connect-github-as-a-forge.md, how-to/let-operators-connect-trackers-and-forges.md, security/credential-flow.md, reference/support-matrix.md, ADR-0086, ADR-0184 and ADR-0192. Read the ploeg-hq/ploeg release notes of 0.2.0-rc.109 (several forges, per-Run read credentials) and 0.2.0-rc.112 (connection flows of ADR-0195). Nothing was installed on a cluster."
---

# Run your own installation

To give your own people Unfold, install Unfold and Ploeg on your own Kubernetes cluster and connect them to your own forge and tracker. You create every credential the installation uses. The Unfold project gives you code, charts and images, never an account, App or token.

## What you get

* One Helm chart that carries the Ploeg release it was tested with.
* Agent Runs in a sandbox on your nodes, model calls through your own gateway, and pull requests on your own forge.
* Work Items taken from your own tracker, and **Report a problem** filed into a tracker you choose.

## Before you start

* The cluster and services in [Self-host the whole stack: Before you start](../how-to/self-host-the-whole-stack.md#before-you-start): Kubernetes 1.30 or later, a network plugin that enforces NetworkPolicy, PostgreSQL 17 or 18, LiteLLM 1.103.0 or later, an OpenID Connect provider, an ingress and Helm.
* A secret mechanism, such as External Secrets, so no credential lives in Git.
* Admin rights on your forge and tracker, to create the App, bot user or tokens below.
* An account at a [Model Provider](../reference/glossary.md#model-provider) you accept, behind your gateway. Each installation pays its own.

## What you create for your forge

Ploeg pushes the agents' branches and opens their pull requests. It needs a credential it can mint per-Run credentials from, so that a Run only ever holds access to its own repository.

| Forge | You create | A Run gets | Limits |
| --- | --- | --- | --- |
| GitHub (github.com or Enterprise Server) | Your own GitHub App with five repository permissions: Contents read and write, Pull requests read and write, Checks read, Commit statuses read, Metadata read. Install it only on the repositories agents may work on | An installation token for its one repository, valid for at most an hour and refreshed while it runs. Ploeg revokes it when the Run settles. A reading Run gets a read-only token | Ploeg refuses a token wider than it asked for. Ploeg never merges |
| Forgejo 15 or later | A bot user, with its password in `botPasswordSecret` | A `write:repository` token restricted to its one repository, which Ploeg mints and deletes when the Run's outcome is recorded. A reading Run gets `read:repository` on that repository | Ploeg refuses to start below Forgejo 15, because earlier versions cannot restrict a token to one repository |
| GitLab | A token Ploeg shares with every Run | The shared token: GitLab has no per-Run minting in Ploeg | Outside Ploeg's supported profile. GitLab can only be the sole forge of an installation |

Sources: [Connect GitHub as a forge](../../apps/ploeg/docs/how-to/connect-github-as-a-forge.md) and [Ploeg ADR-0086](../../apps/ploeg/docs/adrs/0086-github-is-a-forge-and-a-run-pushes-with-its-own-github-app-installation-token.md) for GitHub, the [credential flow of a Run](../../apps/ploeg/docs/security/credential-flow.md#inventory) for both minted tokens, and the [support matrix](../../apps/ploeg/docs/reference/support-matrix.md#forges) for what is supported.

**Several forges.** Since Ploeg 0.2.0-rc.109, one installation can serve repositories on Forgejo and on GitHub at once, as long as every active forge mints per-Run credentials ([Run Forgejo and GitHub side by side](../../apps/ploeg/docs/how-to/connect-github-as-a-forge.md#run-forgejo-and-github-side-by-side), [Ploeg ADR-0192](../../apps/ploeg/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md)). Configure the second forge in Ploeg's chart, or, on an installation that already pushes to Forgejo, add GitHub from Unfold's **Connect GitHub** screen. Unfold refuses that with `409 second_forge_unsupported` only when it is built against a Ploeg older than 0.2.0-rc.109; this release pins 0.2.0-rc.130.

**Unfold's own forge reads.** Unfold reads GitHub issues and files reports with a credential of its own, separate from Ploeg's. Use a GitHub App you created, with Issues read and write, Metadata read and Contents read, or a fine-grained token ([Connect as a GitHub App](../../apps/unfold/docs/operations/task-connections.md#connect-as-a-github-app)). Workspace pods clone with a read credential you put in `repository-readonly` ([Create the Secrets](../how-to/self-host-the-whole-stack.md#3-create-the-secrets)).

## What you create for your tracker

Unfold reads tasks from six trackers, one adapter each in [`src/task-providers/`](../../apps/unfold/src/task-providers/index.ts). Ploeg takes work from three. Each needs a token or account you create in that tracker.

| Tracker | Ploeg takes its work | Unfold hands tasks to Ploeg | Report a problem files here |
| --- | --- | --- | --- |
| ClickUp | yes, by assignee | yes | no |
| Vikunja | yes, by assignee | yes | yes, as a task |
| GitHub Issues | yes, by a `ploeg:<team>` label or a mapped assignee | no | yes, as an issue without attachments |
| Forgejo issues | no | no | yes, as an issue |
| GitLab issues | no | no | no |
| Jira Cloud | no | no | yes, as an issue |

A tracker whose work Ploeg does not take can still be browsed and previewed in Unfold. The scopes each token needs are in [Provider recipes](../../apps/unfold/docs/operations/task-connections.md#provider-recipes), and the hand-off rules in [Hand a task to Ploeg](../../apps/unfold/docs/operations/task-connections.md#hand-a-task-to-ploeg).

ClickUp has no bot accounts, so you invite a member of your own for Unfold and use its token. That member acts as the person who made the token ([Add a connection from the screen](../../apps/unfold/docs/operations/task-connections.md#add-a-connection-from-the-screen)).

## Steps

1. **Prepare the nodes.** Encrypt disks and traffic, and install Kata Containers or gVisor ([step 1](../how-to/self-host-the-whole-stack.md#1-prepare-the-nodes)).
2. **Keep inference where you allow it.** Define only the model aliases you accept in your gateway ([step 2](../how-to/self-host-the-whole-stack.md#2-keep-inference-in-eu-regions-at-the-gateway)).
3. **Create the credentials above,** then the Secrets that hold them ([step 3](../how-to/self-host-the-whole-stack.md#3-create-the-secrets)).
4. **Write the values** from the chart's live example ([step 4](../how-to/self-host-the-whole-stack.md#4-write-the-values)).
5. **Set up sign-in and Teams** at your identity provider ([step 5](../how-to/self-host-the-whole-stack.md#5-set-up-sign-in)), and choose how Ploeg attributes changes ([step 6](../how-to/self-host-the-whole-stack.md#6-choose-how-ploeg-attributes-changes)).
6. **Connect the forge and the tracker** in both Unfold's and Ploeg's values ([step 7](../how-to/self-host-the-whole-stack.md#7-connect-the-forge-and-the-tracker)). For GitHub follow [Connect GitHub as a forge](../../apps/ploeg/docs/how-to/connect-github-as-a-forge.md); for a GitHub issue board, [Connect GitHub Issues](../../apps/ploeg/docs/how-to/connect-github-issues.md).
7. **Choose where Report a problem files.** Point `reports` at one of your trackers, or set it to `false` to keep every report inside Unfold ([File Report a problem into a tracker](../../apps/unfold/docs/operations/task-connections.md#file-report-a-problem-into-a-tracker)).
8. **Install and check** ([step 9](../how-to/self-host-the-whole-stack.md#9-install-and-check-it)), then set up backups and upgrades ([step 10](../how-to/self-host-the-whole-stack.md#10-back-up), [step 11](../how-to/self-host-the-whole-stack.md#11-upgrade)).
9. **Prepare each repository** with an `AGENTS.md` and branch rules ([Prepare a repository](../how-to/prepare-a-repository.md)), then hand the installation to its people: [Use Unfold day to day](use-unfold.md).

Once you have [opted Ploeg in to connection flows](../../apps/ploeg/docs/how-to/let-operators-connect-trackers-and-forges.md) (Ploeg 0.2.0-rc.112 and later) and configured a secret store, an Admin can create the GitHub App from **Settings → Connections → Connect GitHub** instead of by hand. Ploeg then holds the App's key in its own store ([Connect GitHub and register repositories](../../apps/unfold/docs/operations/task-connections.md#connect-github-and-register-repositories)). It is still your App, on your GitHub organisation.

## How you know it works

* The Status page shows the workspaces, gateway and Ploeg as `ok` or `idle`, and `GET /healthz` reports a compatible `ploegContract`.
* **Settings → Connections** lists each board and repository with its checks green ([Diagnose a connection](../../apps/unfold/docs/operations/task-connections.md#diagnose-a-connection)).
* ploegd logs `per-run forge credentials enabled` for Forgejo and `per-run GitHub App installation tokens enabled` for GitHub, and a Run's worker logs `using a per-run forge credential minted for this run` ([Verify](../../apps/ploeg/docs/how-to/connect-github-as-a-forge.md#verify), [Credential flow](../../apps/ploeg/docs/security/credential-flow.md#how-the-broker-knows-a-forgejo-token-is-restricted)).
* [First managed session](../../apps/unfold/docs/operations/live.md#first-managed-session) runs to its end on a small budget and shows the final spend.
* A test report from **Report a problem** appears in the tracker you chose.

Read the [known gaps](../how-to/self-host-the-whole-stack.md#known-gaps) before you rely on the installation: no one has yet followed the whole path on a cluster other than the project owner's.
