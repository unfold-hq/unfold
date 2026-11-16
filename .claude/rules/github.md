---
paths:
  - ".github/**"
---

# GitHub workflows

These workflows and actions run CI, releases and publication on GitHub Actions in `unfold-hq/unfold` ([ADR-0055](https://github.com/unfold-hq/unfold/blob/development/docs/adr/adr-0055-github-unfold-hq-is-the-project-home.md)). Read [CI and release workflows](https://github.com/unfold-hq/unfold/blob/development/docs/operations/ci.md) before changing one.

- Start every job's `if:` with `github.repository == 'unfold-hq/unfold'`, pin actions to a full commit and images to a digest, and never name a Webgrip host, secret or shared action. Run `mise run release-check-github` after a change.
- Only `on_release_published.yml`, run at a release tag, may sign: the cluster admits that file's keyless identity and nothing else.
- A workflow, action or task never prunes, mirrors or deletes refs or pushes notes; `scripts/test_release_refs.py` fails on it.
