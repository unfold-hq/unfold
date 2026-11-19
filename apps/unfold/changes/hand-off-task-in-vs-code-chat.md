---
type: added
---
A hand-off from VS Code's chat is followed as a task until Ploeg has picked the tracker task up, when the `mcp.tasks` flag is on for you.

VS Code 1.147 speaks MCP 2025-11-25, so `unfold-mcp` now also offers that protocol's own tasks for `unfold_hand_off`. The task ends with the Work Item's id, state and link once Ploeg made it, or with the reason when the task was taken back first. Cancelling it stops only the following; the hand-off stays. VS Code shows no status line while it waits. Clients that do not declare tasks, and Claude Code on 2026-07-28, get the same answers as before.
