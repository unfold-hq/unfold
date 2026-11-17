# Release notes

Each file in this directory is one release note: a change that people who use Unfold will notice. The release build reads them into the GitHub release, the [changelog](../docs/operations/release-notes.md) and the *What's new* dialog in the workbench. How to write one is in [Write release notes](../docs/operations/release-notes.md).

```markdown
---
type: added
highlight: true
---
See what changed in Unfold since you last looked, from the version in the sidebar.

A dot on the version shows that a newer release has notes you have not read.
```

- Name the file after the change, in lowercase words with dashes: `whats-new-dialog.md`.
- `type` is one of `added`, `changed`, `deprecated`, `removed`, `fixed` or `security`, the sections of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
- `highlight: true` opens the dialog for everyone after the upgrade. Use it for a change that alters how people work, a few times per minor version at most.
- The first paragraph is one sentence of at most 160 characters, written for the person using Unfold. Further paragraphs are optional details in Markdown.
