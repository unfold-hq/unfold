---
type: added
---
A new Unfold session started from VS Code reports native progress while its workspace is prepared and it waits for a Team.

The progress ends when a Run starts or the start fails. Only the window that created the session gets it. The chat notices such as "Workspace ready" stay. VS Code 1.147 titles its indicator "Preparing the workspace" and keeps that title while the session waits for a Team. Unfold reports no percentage, because it does not know how long preparation takes.
