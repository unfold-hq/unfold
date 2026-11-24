---
type: landing
audience: [operator, developer, product-owner]
owner: unfold
last_verified: 2026-11-24
verified_by: "Checked that each linked onboarding page exists and that the roles match docs/concepts/users-and-journeys.md (Admin, Developer, Product owner). The status column repeats each page's own status; it was not checked separately."
---

# Onboarding per integration

Each integration has one page. On it, every role finds its own short section: what the integration gives them, what they do once, and what they do every day. Read only your own section; the links in it go to the full how-to when you need detail.

| Role | Who that is | What they do with an integration |
| --- | --- | --- |
| **Admin** | the person who runs your Unfold installation | connects the integration once, for everyone |
| **Developer** | anyone who hands work over, reviews agent pull requests or works next to agents | links their own account, works and reviews |
| **Product owner** | the person who makes work Ready and signs it off | hands work over and follows it, without touching code |

The roles are the ones in [Users and their journeys](../concepts/users-and-journeys.md).

## The integrations

| Integration | What it is for | Page |
| --- | --- | --- |
| GitLab | where the code lives: agents clone from it and open merge requests on it | [GitLab](gitlab.md) |
| ClickUp | where work is planned: tasks become Work Items | [ClickUp](clickup.md) |
| VS Code | follow and steer agent work from your editor | [VS Code](vscode.md) |
| Claude Code | link your own agent sessions to Work Items | [Claude Code](claude-code.md) |
| Open WebUI | ask Unfold about your work from a chat, through MCP | [Open WebUI](open-webui.md) |

Only integrations that run on a real installation are listed here. The [Integrations reference](../reference/integrations.md) lists everything Ploeg has a provider for, including integrations nobody has shown working yet.
