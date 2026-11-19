---
description: Hand a Work Item you took over back to Ploeg, once your work on its branch is committed and pushed
argument-hint: "<work item id or Unfold link> [note for the next Run]"
---

Hand an Unfold Work Item back to Ploeg. The first word after the command is the Work Item, anything after it is the person's note for the next Run.

In Claude Code, `/unfold:handback` runs the plugin's `scripts/unfold-takeover.mjs`. VS Code gives a Copilot session no path to the plugin's scripts, so this session cannot run it, and does the same through the `unfold_hand_back` tool instead:

1. If no `unfold_hand_back` tool is available, say that the `unfold` MCP server is not connected, that the route is Claude Code (`/unfold:handback` with the same arguments), and stop.
2. In the Work Item's worktree, check with `git status --porcelain` that nothing is uncommitted, and with `git status -sb` that the branch is not ahead of its upstream. If either fails, tell the person what to commit or push and stop. Do not commit or push for them unless they ask.
3. Call `unfold_hand_back` once with the Work Item and the note. It asks the person to confirm first; never confirm for them.
4. If Unfold refuses, pass its sentence on and stop. Do not retry.

Ploeg then resumes the Round that stopped, on the same branch from its head on the forge, with the note.
