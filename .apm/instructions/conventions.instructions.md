---
description: How every change to Unfold is made
---
# Conventions

- Never write a secret value into a file, commit, log or pull request. Reference it by name from the environment or the deployment's secret store.
- Deliver through a pull request against `development`: push a branch and open the pull request. After a push, check the commit is on the remote (`git merge-base --is-ancestor <sha> origin/<branch>`). Never force-push a shared branch.
- Several sessions can share one working tree. Commit only the paths you wrote (`git commit -- <paths>`), never `git add -A`, `git add .` or `git commit -a`; the `stage-explicit-paths` hook blocks them.
- Open a file with your file-reading tool, not `cat`, `head` or `sed` in a shell: a rule scoped to a path loads only when that tool reads a matching file.
- Write Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`) with an optional scope, one change per commit.
- Renovate owns dependency versions: review its pull requests instead of bumping what it manages.
- No comments in code. Carry intent in names, types, small functions and tests; reasoning goes to `docs/` or an ADR. Machine-read directives stay: shebangs, `# syntax=`, `# renovate:`, schema hints, `@ts-*`, `eslint-*`, `# shellcheck`, `# noqa`, `//go:*` and doc comments a tool reads.
- Docs live in MkDocs under `docs/` and an application's `docs/`, and change with the behaviour. Durable knowledge goes into the repository, never into agent memory.
- Say plainly which gate failed or was skipped, and check the primary source before claiming something works or never worked.
- Name no employer or client, nor their hosts, ids or people, in this repository.
- The Bash tool may run zsh: quote variables, use arrays, `set -o pipefail` before gating on a pipeline, and close stdin (`< /dev/null`) for CLIs that may read it.
