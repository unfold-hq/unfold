---
type: landing
audience: [owner, operator, integrator, contributor, agent]
owner: unfold
last_verified: 2026-11-19
verified_by: "Read docs/concepts/who-unfold-is-for.md, docs/concepts/users-and-journeys.md, apps/unfold/docs/operations/task-connections.md, apps/unfold/src/task-providers/ (which adapters declare issues), CONTRIBUTING.md, SECURITY.md and .github/ISSUE_TEMPLATE; checked that https://unfoldhq.dev/demo/ and https://github.com/unfold-hq/unfold/issues/new answer 200. Nothing was installed or run against a forge or tracker."
---

# Get started

Unfold turns units of work, [Work Items](../reference/glossary.md#work-item), into pull requests that AI agents write and a person reviews. [Ploeg](../../apps/ploeg/docs/index.md) runs every agent [Run](../reference/glossary.md#run) with a budget and credentials that expire. The Unfold application is where people follow, steer and review that work.

**Status.** Unfold is pre-1.0. It runs self-hosted on Kubernetes. The hosted service for agencies is decided but not built ([Who Unfold is for](../concepts/who-unfold-is-for.md)).

## Pick your path

| You are | You want to | Path |
| --- | --- | --- |
| Evaluating Unfold | See it work without spending money, then decide | [Evaluate Unfold](evaluate.md) |
| Running Unfold for your people | Install Unfold and Ploeg on your own cluster and connect your forge and tracker | [Run your own installation](self-host.md) |
| A developer or reviewer on an installation | Hand work to agents, follow it and review the pull requests | [Use Unfold day to day](use-unfold.md) |
| An agency that wants Unfold hosted | Know what the hosted service would ask of you | [Hosted Unfold for agencies](agency.md) (proposed, not built) |
| Changing Unfold itself | Make a change and open a pull request | [Contribute to Unfold](contribute.md) |

## Three rules that hold on every path

**The installation provides every credential.** Whoever runs an installation creates its forge and tracker credentials: their own GitHub App, their own Forgejo bot user, their own GitLab token and their own tracker tokens. The Unfold project offers no App or account for you to install on your repositories. [Run your own installation](self-host.md#what-you-create-for-your-forge) lists what each forge needs.

**Report a problem stays in the installation.** The **Report a problem** dialog in the Unfold application files into a tracker that the installation configured: a Forgejo issue, a GitHub issue, a Jira issue or a Vikunja task ([File Report a problem into a tracker](../../apps/unfold/docs/operations/task-connections.md#file-report-a-problem-into-a-tracker)). It never reaches the Unfold project. Without a configured tracker, Unfold keeps the report and says so.

**A bug in Unfold itself goes to the project.** Open an issue at [github.com/unfold-hq/unfold/issues/new](https://github.com/unfold-hq/unfold/issues/new) under your own GitHub account and pick the *Report a problem* template. Leave out data from your installation's repositories. A security problem goes through a [private security advisory](https://github.com/unfold-hq/unfold/security/advisories/new) instead ([SECURITY.md](../../SECURITY.md)). A link inside the application that opens this issue prefilled is proposed, not built.

## Where to look things up

* Terms: the [glossary](../reference/glossary.md).
* Decisions: the [decision register](../reference/decisions.md).
* Everything else: the [start page](../index.md).
