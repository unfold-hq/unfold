---
status: proposed
date: 2026-11-17
decision-makers: Ryan Grippeling
review-by: 2027-02-28
---

# Release notes are written per change, and the workbench shows what is new

## Context and Problem Statement

The hourly release train cuts several Unfold release candidates a day ([system ADR-0046](../../../../docs/adr/adr-0046-an-hourly-release-train-versions-unfold-from-a-checked-development-head.md)). Each GitHub release listed its conventional commits: dependency bumps, CI, tests and internal chores beside the few changes a person using Unfold would notice. A release commits nothing, so `apps/CHANGELOG.md` stopped at `0.4.0-rc.114` on 2026-10-25 and still links to the previous forge. In the workbench the version was only on the System page; the sidebar asked for a version the bootstrap never sent. A person could not tell that Unfold had changed, what changed, or that the tab they had open was running an older version than the one deployed.

How do people who use Unfold learn, in the product, what changed and when, with notes written for them, while the release still commits nothing?

## Decision Drivers

* Notes are written for the person using Unfold, not derived from commit subjects meant for reviewers.
* A release adds a tag and no commit ([CI and release workflows](../../../../docs/operations/ci.md#the-release-train)); the release-policy guard refuses a release commit.
* Self-hosted and air-gapped installations read the notes from the image, without reaching GitHub.
* Interrupting someone costs attention: only a change that alters how people work may open a dialog by itself.
* While Unfold is 0.x every candidate runs on staging and in previews, so candidates get notes too.
* Least machinery: no new service, no new dependency, no per-person state on the server.

## Considered Options

* **Hand-written fragments per change, assigned to the first release tag that adds them, shown in a What's new dialog behind the sidebar version**
* Filtered conventional commits with an optional `Release-Note:` trailer
* One hand-edited `CHANGELOG.md` with an Unreleased section, folded by a release commit
* Fetch the GitHub release bodies from the browser

## Decision Outcome

Chosen option: "**Hand-written fragments per change**", because it is the only option that gives notes written for people while the release still commits nothing, and fragments in separate files never conflict between pull requests (the model of [towncrier](https://towncrier.readthedocs.io/) and [changie](https://changie.dev/), with the sections of [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)).

1. **Fragments.** A note is `apps/unfold/changes/<slug>.md`: front matter with `type` (`added`, `changed`, `deprecated`, `removed`, `fixed`, `security`) and an optional `highlight: true`, a one-sentence summary of at most 160 characters and optional Markdown details. [src/changelog.ts](../../src/changelog.ts) reads and validates them; `npm test` fails on a broken one. A fragment records no version and is never moved.
2. **Assignment.** A fragment belongs to the first `unfold-v` tag whose tree adds it. [scripts/changelog.ts](../../scripts/changelog.ts) `notes` lists the fragments added between two refs; `resolve` writes `changes/released.json` for every tag reachable from the checkout.
3. **GitHub release.** The Unfold train replaces the commit notes generator with [scripts/release-notes-fragments.cjs](../../../../scripts/release-notes-fragments.cjs), which puts the fragments under the release heading and folds the commit notes into a Commits disclosure. A release without fragments says it holds maintenance work only.
4. **Image.** Publication checks the tag out with full history, runs `changelog.ts resolve` and builds; the Dockerfile copies `changes/`. `GET /api/changelog` returns the running version, the releases newest first and the unreleased fragments. The bootstrap now carries `version`.
5. **What's new.** The sidebar version is a button that opens the What's new dialog: unread releases first and marked New, highlights with their details, then earlier releases, then notes not released yet. The last version a person has seen is a browser preference (`seenVersion`); a first visit records the running version and shows nothing. A dot on the version marks unread releases with notes; an unread highlight opens the dialog once by itself. Closing the dialog marks everything read.
6. **Newer deploy.** Every five minutes while the tab is visible, and when it becomes visible, the page compares `/api/health`'s version with the one it booted with. When they differ it shows a notice with Reload and Later; Later hides it until another version is deployed.
7. **Gate.** The pull-request job `release-notes` runs `changelog.ts require`: a `feat`, `fix` or `perf` commit, or a breaking one, that changes `apps/unfold` needs a fragment unless it is scoped `deps`, `ploeg`, `ci`, `test`, `docs`, `release` or `site`, or a commit carries `Release-Note: none`.

### Consequences

* Good, because notes are written for their readers, appear in the product, on GitHub and as a Keep a Changelog document from one source.
* Good, because nothing new commits during a release, and the image needs no network to show its notes.
* Good, because the dialog interrupts only for highlights; everything else is a dot.
* Bad, because every user-facing pull request carries one more file, and the gate fails until it does or says why not.
* Bad, because read state lives in each browser: a person who switches browsers sees the dot again. Per-person state on the server can follow when people ask for it.
* Bad, because the releases before this decision have no fragments and show nothing in What's new; their commits stay on GitHub.
* Neutral, because `apps/CHANGELOG.md` and `apps/unfold/CHANGELOG.md` stay as the record of the commit-generated history and point here.

### Confirmation

* `npm test` in `apps/unfold` runs `test/changelog.test.ts`, which validates every fragment in the repository and drives `notes`, `resolve` and `require` against a temporary Git history, and `test/whats-new.test.mjs` for the unread logic and the dialog.
* `mise run release-check-github` runs `scripts/release-policy.test.cjs` (the Unfold train uses the fragment notes plugin) and `scripts/github-workflow-policy.test.cjs` (the `release-notes` gate and the resolve step before the image build).
* After publication, `GET /api/changelog` on a deployment lists its own version first.

## Pros and Cons of the Options

### Filtered conventional commits with a `Release-Note:` trailer

* Good, because nothing new to write for most changes.
* Bad, because commit subjects are written for reviewers; filtering by type cannot turn "add approve endpoint" into a sentence for the person who approves.

### One hand-edited `CHANGELOG.md`

* Good, because it is the most familiar form.
* Bad, because parallel pull requests conflict on the same lines, and folding Unreleased into a version needs the release commit the policy forbids.

### GitHub release bodies fetched by the browser

* Bad, because an air-gapped installation cannot reach GitHub, and the notes would still be commit lists.

## More Information

* 2026-11-17: proposed with its implementation; the owner chose fragments, notes for every release candidate while Unfold is 0.x, a dot and the reload notice always, and the dialog by itself only for highlights.
* [Write release notes](../operations/release-notes.md) is the contributor guide.
