---
type: how-to
audience: [contributor, agent]
owner: unfold
last_verified: 2026-11-16
verified_by: "Rewritten for GitHub on 2026-11-16 against .github/pull_request_template.md, the gate job of .github/workflows/on_pull_request.yml and docs/adr/adr-0055-github-unfold-hq-is-the-project-home.md."
---

# Open a pull request

1. When people using Unfold will notice the change, add a release note in `apps/unfold/changes` ([Write release notes](../../apps/unfold/docs/operations/release-notes.md)); otherwise put `Release-Note: none` in a commit message of a `feat` or `fix` change.
2. Run `mise run verify` (and `mise run docs-check` after a docs or `AGENTS.md` change) and keep the output for the description.
3. Write the description from the [template](https://github.com/unfold-hq/unfold/blob/development/.github/pull_request_template.md): what changed and why, how you verified it, and the risk areas from the [review guide](review.md) that it touches. Never name a tracker URL or ticket id ([ADR-0055](../adr/adr-0055-github-unfold-hq-is-the-project-home.md)).
4. Push the branch to `github.com/unfold-hq/unfold`, or to your fork, and open the pull request into `development`, in the web interface or with `gh pr create --repo unfold-hq/unfold --base development --body-file description.md`.
5. Wait for the `gate` check ([the pull request gate](../operations/ci.md#the-pull-request-gate)). A pull request from a fork skips the image build of `build-contexts`; `development` builds it after the merge.
6. Stack a dependent change as its own pull request, and say in its description which pull request it builds on.
