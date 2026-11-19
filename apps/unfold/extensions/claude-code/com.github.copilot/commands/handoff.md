---
description: Hand this session's work to a Ploeg Team; in a Copilot session it names the Claude Code route
argument-hint: "[work item id or Unfold link] [--team <team> [--target <repository>]]"
---

This command runs the Unfold plugin's `scripts/unfold-handoff.mjs`. Only that script builds the hand-off commit, scans it for secrets and asks Unfold for a confirmation bound to the preview. VS Code gives a Copilot session no path to the plugin's scripts, so this session cannot run it.

Tell the person exactly that, in one or two sentences, and that the route is Claude Code: open Claude Code in this repository and run `/unfold:handoff` with the same arguments.

Do not search for the script, do not run any command, and do not try to do its work another way.
