---
description: Start a Ploeg Run that waits for your own Claude Code; in a Copilot session it names the Claude Code route
argument-hint: "<work item id or Unfold link>"
---

This command runs the Unfold plugin's `scripts/unfold-start.mjs`. It claims the Run through Unfold and dispatches it with the person's own `claude` CLI and login. VS Code gives a Copilot session no path to the plugin's scripts, so this session cannot run it.

Tell the person exactly that, in one or two sentences, and that the route is Claude Code: open Claude Code in this repository and run `/unfold:start` with the same arguments.

Do not search for the script, do not run any command, and do not try to do its work another way.
