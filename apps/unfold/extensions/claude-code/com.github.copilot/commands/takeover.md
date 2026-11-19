---
description: Pick up a Work Item you took control of in Unfold; in a Copilot session it names the Claude Code route
argument-hint: "<work item id or Unfold link>"
---

This command runs the Unfold plugin's `scripts/unfold-takeover.mjs`. It checks that Ploeg parked the Work Item for this person and checks its branch out in a worktree with a brief of what Ploeg left. VS Code gives a Copilot session no path to the plugin's scripts, so this session cannot run it.

Tell the person exactly that, in one or two sentences, and that the route is Claude Code: open Claude Code in this repository and run `/unfold:takeover` with the same arguments.

Do not search for the script, do not run any command, and do not try to do its work another way.
