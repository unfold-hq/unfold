---
type: how-to
audience: [contributor, agent]
owner: unfold
last_verified: 2026-11-19
verified_by: "Read CONTRIBUTING.md, SECURITY.md, .github/ISSUE_TEMPLATE, docs/contributing/way-of-working.md, open-a-pull-request.md, set-up-a-worktree.md, review.md, agent-instructions.md and docs/documentation.md; ran mise run setup and mise run docs-check in a worktree."
---

# Contribute to Unfold

To change Unfold itself, open a pull request against `development` on [github.com/unfold-hq/unfold](https://github.com/unfold-hq/unfold). People, interactive agent sessions and Ploeg's own Teams all follow the same flow and pass the same gates. Contributions come in under Apache-2.0, with no CLA ([CONTRIBUTING.md](../../CONTRIBUTING.md)).

## What you get

* A change in Unfold, released by the hourly release train once it merged.
* A review against the [review guide](../contributing/review.md), by a person, by an agent reviewer, or both.

## Before you start

* A GitHub account. Fork the repository, or push a branch if you have access.
* [mise](https://mise.jdx.dev/). Run `mise run setup` once from the repository root; it installs every tool at its pinned version and unpacks Ploeg's contract bundle into `apps/ploeg`.
* Know where Ploeg ends. `apps/ploeg` is a read-only copy of a released Ploeg. Change Ploeg in [ploeg-hq/ploeg](https://github.com/ploeg-hq/ploeg), never here.

## Steps

1. **Start from an issue or a task.** To report a bug, open an issue at [github.com/unfold-hq/unfold/issues/new](https://github.com/unfold-hq/unfold/issues/new) with the *Report a problem* template. A security problem goes to a [private advisory](https://github.com/unfold-hq/unfold/security/advisories/new) ([SECURITY.md](../../SECURITY.md)). The ready rule for a task is in [The flow](../contributing/way-of-working.md#the-flow).
2. **Design first when the change is not trivial:** an ADR, an OpenSpec change or an RFC ([The flow](../contributing/way-of-working.md#the-flow), step 2).
3. **Work in your own worktree** on a branch named `<type>/<short-slug>` ([Set up a worktree](../contributing/set-up-a-worktree.md)).
4. **Commit small.** Conventional Commits, one change per commit, and stage only the paths you wrote ([The flow](../contributing/way-of-working.md#the-flow), step 4). Code carries no comments; reasoning goes to `docs/` or an ADR.
5. **Change the docs with the behaviour.** Follow the [documentation policy](../documentation.md): one type per page, front matter, and "not implemented yet" for anything proposed.
6. **Run the gates.** `mise run verify` before every push, and `mise run docs-check` after a change under `docs/`.
7. **Open the pull request** into `development` and fill in the template ([Open a pull request](../contributing/open-a-pull-request.md)).
8. **For agent rules, skills and commands,** read [Agent instructions](../contributing/agent-instructions.md) first: they live in `.apm/`, and the generated `AGENTS.md` files are never edited by hand.

## How you know it works

* `mise run verify` and `mise run docs-check` pass on your machine.
* The `gate` check on your pull request is green ([the pull request gate](../operations/ci.md#the-pull-request-gate)); `development` refuses a merge before that.
* After the merge, the next release candidate carries your change ([CI and releases](../operations/ci.md)).

The project names no employer, client or installation that runs Unfold. Keep such names, hosts and ids out of code, docs, commits and pull requests.
