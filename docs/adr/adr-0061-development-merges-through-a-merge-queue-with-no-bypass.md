---
status: accepted
date: 2026-11-19
decision-makers: Ryan Grippeling
---

# `development` merges through a merge queue, with no bypass

## Context and Problem Statement

[ADR-0055](adr-0055-github-unfold-hq-is-the-project-home.md) put a ruleset on `development` that requires the `gate` check of [on_pull_request.yml](../../.github/workflows/on_pull_request.yml) before a pull request merges. `gate` ran against the pull request's head and the `development` it was opened from. Two pull requests that each pass against an older `development` can still break the trunk together, and the ruleset leaves administrators a bypass, so a merge can land without any check. Agents open several pull requests at once and the Ploeg pin lands on its own, so both gaps are reached in ordinary work, and a broken `development` stops the hourly release train ([ADR-0046](adr-0046-an-hourly-release-train-versions-unfold-from-a-checked-development-head.md)).

How does a pull request reach `development` so that the commit that lands is the commit that was checked, for everyone?

## Decision Drivers

* The commit that lands on `development` is the one `gate` passed, combined with the trunk it lands on.
* No person or bot, the owner included, merges past the checks.
* The Ploeg pin still lands without a person.
* The ruleset keeps requiring one check, so a job added to the workflow never needs a ruleset change.

## Considered Options

* A merge queue on `development` that requires `gate`, with no bypass
* Require branches to be up to date before merging, with no bypass
* Keep ADR-0055's ruleset

## Decision Outcome

Chosen option: "A merge queue on `development` that requires `gate`, with no bypass", because it is the only option that checks the combined commit without making every author rebase and rerun after each merge.

This amends the branch rule of ADR-0055, decision 8 and the ruleset described in [Branch rules](../contributing/way-of-working.md#branch-rules):

1. **The queue.** The ruleset on `development` requires a merge queue with the merge method **Merge commit** and the status check `gate`. `on_pull_request.yml` runs on `merge_group`, so `gate` and every job it waits for run on the queue's commit; the jobs that read a commit range (`agent-trace`, `release-notes`, `gitleaks`) take it from `github.event.merge_group.base_sha` and `head_sha` there.
2. **No bypass.** The ruleset's bypass list is empty. An administrator merges through the queue like everyone else.
3. **The Ploeg pin.** [`scripts/release_train_pin.py`](../../scripts/release_train_pin.py) turns on auto-merge for the newest pin, which queues it once it is green. A pin that is already green is added to the queue with the GraphQL `enqueuePullRequest` mutation at the head it read (`expectedHeadOid`); the script no longer merges a pin through `PUT /pulls/{n}/merge`, which a queue-only ruleset refuses.

The settings themselves are applied by the owner in the repository; [Repository requirements](../operations/ci.md#repository-requirements) lists them.

### Consequences

* Good, because `development` only receives commits whose combination with the trunk passed `gate`, so the release train no longer meets a trunk two green pull requests broke together.
* Good, because the ruleset still names one check, `gate`.
* Bad, because every merge runs the pull request checks a second time, which lengthens the time to merge by one `gate` run and doubles CI minutes per merged pull request.
* Bad, because the owner can no longer merge past a failing or stuck check; an outage of a check blocks every merge until the check is fixed or the ruleset is changed.

### Confirmation

* [`scripts/github-workflow-policy.test.cjs`](../../scripts/github-workflow-policy.test.cjs), run by `mise run release-check-github` and the `release-policy` job, fails when `on_pull_request.yml` does not run on `merge_group`, when `agent-trace`, `release-notes` or `gitleaks` reads a range that is empty on a merge group, or when `gate` is limited to one event.
* [`scripts/test_release_train_pin.py`](../../scripts/test_release_train_pin.py), run by `mise run verify`, fails when a green pin is merged through REST instead of queued with `enqueuePullRequest` at its head, or when a refused enqueue passes.
* The ruleset is confirmed by reading it: `gh api repos/unfold-hq/unfold/rulesets` shows a `development` ruleset with a `merge_queue` rule, a required status check `gate` and no bypass actors.

## Pros and Cons of the Options

### Require branches to be up to date, with no bypass

* Good, because it needs no workflow change.
* Bad, because every merge makes every other open pull request stale, so each author, and the pin, rebases and waits for a full rerun in turn.

### Keep ADR-0055's ruleset

* Good, because each pull request runs its checks once.
* Bad, because two green pull requests can still break `development`, and an administrator can merge past `gate`.

## More Information

* Amends [ADR-0055](adr-0055-github-unfold-hq-is-the-project-home.md), decision 8 and its branch rule.
* 2026-11-19 — Proposed. The workflows and the pin script support the queue; the repository settings are not applied yet.
* 2026-11-19 — Accepted by the owner: merge method Merge commit, every required check green, at most three entries built at once, and no bypass actors. The repository settings are applied after this change merges.
* 2026-11-19 — Applied by the owner. The ruleset "Protect development" (`gh api repos/unfold-hq/unfold/rulesets/27403078`) holds the rules `deletion`, `required_status_checks` (`gate`), `non_fast_forward`, `pull_request` (no required approvals, merge method merge) and `merge_queue` (merge method `MERGE`, grouping `ALLGREEN`, at least 1 entry after a 1-minute wait, up to 3 entries built and merged at once, 60-minute check timeout), and its bypass list is empty: the administrator bypass is removed. Repository auto-merge is allowed. The queue is at <https://github.com/unfold-hq/unfold/queue/development>. On 2026-11-19 pull requests [#142](https://github.com/unfold-hq/unfold/pull/142), [#143](https://github.com/unfold-hq/unfold/pull/143), [#144](https://github.com/unfold-hq/unfold/pull/144), [#146](https://github.com/unfold-hq/unfold/pull/146), [#147](https://github.com/unfold-hq/unfold/pull/147), [#148](https://github.com/unfold-hq/unfold/pull/148), [#149](https://github.com/unfold-hq/unfold/pull/149) and [#139](https://github.com/unfold-hq/unfold/pull/139) merged through the queue, and the queue removed [#145](https://github.com/unfold-hq/unfold/pull/145) on a merge conflict with a pull request ahead of it, leaving `development` untouched (`gh pr view <n> --json mergedAt`, `gh api repos/unfold-hq/unfold/issues/145/timeline`).
