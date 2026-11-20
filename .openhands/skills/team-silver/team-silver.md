---
name: team-silver
description: >-
  The Team Silver delivery discipline for a single OpenHands agent working on
  Unfold, the repository that depends on a released Ploeg: phased delivery, the
  `mise run verify` gate set run before every pull request update, an explicit
  adversarial self-review against the review guide's risk areas, and the
  release-train rules.
---

<!--
  FILENAME IS LOAD-BEARING. This is a legacy-format OpenHands repo skill: a
  plain `.md` (NOT `SKILL.md`) with no `triggers`. The SDK partitions it into
  `repo_skills` → injected into REPO_CONTEXT on *every* run — the discipline
  is guaranteed. An AgentSkills-format `SKILL.md` would land in
  `<available_skills>` (progressive disclosure) and only reach the model if
  invoked — optional discipline defeats the purpose. Do NOT rename to SKILL.md.
-->

# Team Silver — discipline for a single agent on Unfold

You are running one Work Item end to end as one agent on Unfold, the
application in `apps/unfold`. `apps/ploeg` is the unpacked contract bundle of a
pinned Ploeg release from github.com/ploeg-hq/ploeg, not code you change.
Ploeg mints a budgeted model key for every Run and Unfold shows people what
their Runs cost, so a mistake here can cost real money. Read the root `AGENTS.md` and
the `AGENTS.md` of each application you change first; their rules override
this file where they conflict.

## Phases (do them in order, announce each)

1. **Scope.** Check the Work Item against the live repository: the problem with
   evidence, acceptance conditions someone can verify, and the gate commands
   that prove them. If it is not ready, stop and say what it needs; do not
   invent scope. State the files you expect to touch before editing.
2. **Read before write.** Trace the code path you change end to end and quote
   the lines you rely on in your notes.
3. **Build** on the branch Ploeg's brief names, created from `development`.
   Small Conventional Commits. Never name a ticket id or tracker
   URL in a commit, branch or pull request. A bug fix includes a regression
   test that fails on the unfixed code; prove it by running the test against
   the original code first when you can.
4. **Gates** from `AGENTS.md`, before opening the pull request and before every
   update of it. A gate the Run's sandbox cannot run (no container daemon, no
   registry access, a missing toolchain) is CI's job: push the branch, let CI
   run it on the pull request, write "gates left to CI: …" in the description,
   read the result on the pull request, and iterate until green. Never retry an
   image pull the sandbox cannot reach. Either way, paste the evidence: the gate
   output, or the CI run link and status. Claiming a gate you never saw run is
   worse than reporting that you could not run it.
5. **Adversarial self-review.** No independent judge runs inside the Run, so
   simulate one, then say honestly what a person should re-check. Walk the
   risk areas of the review guide
   (https://github.com/unfold-hq/unfold/blob/development/docs/contributing/review.md#risk-areas)
   that the diff touches, failure paths first: does cleanup run on every
   return, timeout and kill; can a retry repeat paid work; does every mutation
   check identity and owner; does the change still match Ploeg's published
   schemas.
6. **Pull request** into `development`. Title is the Conventional Commit
   subject. Description from the template: what and why, the gate evidence,
   and the risk notes from your self-review. Never merge.
7. **Report.** Your outcome summary names the pull request link and what a
   person must verify before merge.

## Hard rules

- Never touch `main`, the release workflows, or files inside `apps/ploeg`. A
  Ploeg change lands in github.com/ploeg-hq/ploeg first; Renovate brings the
  release here.
- Never print or log secret values (master keys, minted keys, tokens).
- If the task needs more than the Work Item's budget or scope allows, stop and
  report `stuck` with the reason; a truthful stuck beats a sloppy pull request.
