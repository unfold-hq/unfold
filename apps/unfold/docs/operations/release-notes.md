# Write release notes

Unfold's release notes are written by hand, one file per change, in [`apps/unfold/changes/`](../../changes/README.md) ([ADR 0072](../adrs/0072-release-notes-are-written-per-change-and-the-workbench-shows-what-is-new.md)). The release build turns them into three things:

- the top of each [GitHub release](https://github.com/unfold-hq/unfold/releases), above a folded list of its commits;
- **What's new** in the workbench: the version at the bottom of the sidebar opens it, a dot on the version means there are notes you have not read, and a highlight opens it once by itself after an upgrade;
- a [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) document, printed by `node apps/unfold/scripts/changelog.ts markdown`.

While Unfold is 0.x every release candidate is a release people run, on staging and in the hosted preview, so every candidate gets its notes. A deployment that skips candidates sees the notes of every release it skipped, together.

## When a change needs a note

Write a note when someone using Unfold will notice the change: a new screen or action, a changed behaviour, a fixed bug they could have hit, something removed or deprecated, or a security fix. The [pull-request workflow](../../../../.github/workflows/on_pull_request.yml) runs `changelog.ts require`: when a `feat`, `fix` or `perf` commit, or any breaking commit, changes `apps/unfold` and the pull request adds no fragment, the `release-notes` job fails. Commits scoped `deps`, `ploeg`, `ci`, `test`, `docs`, `release` or `site` are exempt, because bots open them or nobody using Unfold sees them.

When nobody notices the change, for example a fix to an internal name, add the trailer `Release-Note: none` to one of the commit messages instead.

## Write the note

Create `apps/unfold/changes/<what-changed>.md`, named in lowercase words with dashes:

```markdown
---
type: fixed
---
Spend below one cent no longer shows as $0.00 on the Work Item.
```

- `type` is one of the Keep a Changelog sections: `added`, `changed`, `deprecated`, `removed`, `fixed` or `security`.
- `highlight: true` puts the note at the top, with its details, and opens What's new by itself once after the upgrade. Keep it for a change that alters how people work, a few times per minor version at most: a dialog that opens for every fix teaches people to close it unread.
- The first paragraph is the note: one sentence of at most 160 characters. Write what the person can now do or no longer runs into, in the [glossary](../../../../docs/reference/glossary.md)'s words, not what the code does. "Approve a Work Item from the review queue" rather than "add approve endpoint".
- Further paragraphs are details in Markdown. What's new shows them for highlights; the GitHub release and the changelog show them for every note.

`node apps/unfold/scripts/changelog.ts check` reads every fragment and names the file and the rule a broken one fails; `npm test` runs the same check.

## How a note finds its release

A release adds a tag and no commit ([CI and release workflows](../../../../docs/operations/ci.md#the-release-train)), so a fragment never moves or records its version. The version is the first release tag whose tree adds the file:

- semantic-release's notes step, [`scripts/release-notes-fragments.cjs`](../../../../scripts/release-notes-fragments.cjs), runs `changelog.ts notes --from <previous tag> --to <release commit>` and puts the result under the release heading;
- publication runs `changelog.ts resolve` on a full checkout of the tag before it builds the image, which writes `changes/released.json` (ignored by Git) beside the fragments. The server reads both and answers `GET /api/changelog`; without the index, as in development and the demo, every fragment is listed as not released yet.

To correct a note after its release, edit the fragment: the next image shows the new wording. The GitHub release keeps the text it was published with until someone edits it there.
