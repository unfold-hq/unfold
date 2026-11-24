---
type: explanation
audience: [owner, operator, contributor, agent]
owner: unfold
last_verified: 2026-11-24
verified_by: "Source read on 2026-11-24 of origin/development 4759b33e: apps/unfold/public/shell.js (Settings pages), apps/unfold/public/views (account, connect-claude, connect-clickup, task-setup, webhooks, intake, billing, notifications, editors, linked-sessions, card-identity), apps/unfold/src/link-providers, src/task-setup.ts, src/http.ts, src/engine.ts and src/runtime/kubernetes.ts, apps/unfold/docs/features.md, docs/operations/task-connections.md and live.md, and ADR-0060. Nothing was run against a live installation."
---

# How Unfold connects

Unfold connects to people, their tools, Ploeg and outside systems in more than twenty ways, and most of them have a page under **Settings**. This page lists each one: who sets it up, whose account it acts as, where its secret is kept, and what it makes possible. Use it to answer "what do I get when I connect this?" and "which of the ClickUp pages do I need?". The adapters per tracker and forge are on [Integrations](../reference/integrations.md); how a repository and its board reach Ploeg is on [Connect a repository](connect-a-repository.md).

[ADR-0060](../adr/adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md) decided that Ploeg owns every tracker and forge connection and that Unfold holds none. Where today's code still differs, the **Decided** column says what replaces it. The legacy parts go in slice S10 of the OpenSpec change [self-serve-onboarding](../../openspec/changes/self-serve-onboarding/tasks.md), once the pinned Ploeg serves the tracker reads.

## Who sets it up

* **You**: under **Settings › Yours**, for your own account only.
* **Admin**: under **Settings › Workbench**, from the screen, for the Tenant.
* **Installation**: in Unfold's configuration, environment or Helm values, by whoever runs the installation.

## Who you are

| Connection | Set up by | Secret kept by | What it gives | Decided |
|---|---|---|---|---|
| Sign-in (OpenID Connect, or a local account) | installation | the identity provider | Access, your Access Role and Tenant. Unfold exchanges your sign-in for a person token that proves you to Ploeg on every change. | stands |
| SCIM and Shared Signals (`/scim/v2`, `/ssf/events`) | installation | configuration | Accounts, memberships and revocations pushed by the identity provider. | stands |

## Your tools that talk to Unfold

| Connection | Set up by | Secret kept by | What it gives | Decided |
|---|---|---|---|---|
| **Signed-in editors** (VS Code, the ACP agent) | you | the editor, one credential per editor you approved | Now, Tasks, Work and Sessions in the editor, the Work Item panel, language-model tools that act after a confirmation. | stands |
| Agents window (Agent Host Protocol) | you | a personal token in the `wss://` address | Sessions and Work Items as chats in VS Code's Agents window, with Candidate review. | stands |
| MCP (`unfold-mcp`) | you | `UNFOLD_TOKEN` for stdio; the identity provider's OAuth token over HTTPS | Unfold's tools in Claude Code, ChatGPT and other MCP clients: Now, find work, hand off with a confirmation. | stands |
| **Agent sessions** (the Claude Code plugin; Codex, OpenCode and ACP reporters) | you | none: the plugin reports, Unfold never holds your Claude sign-in | Your own sessions shown and linked to Work Items, their cost estimate, `/unfold:handoff` and `/unfold:takeover`. | stands |

## Your own accounts

| Connection | Set up by | Secret kept by | What it gives | Decided |
|---|---|---|---|---|
| **Linked accounts › ClickUp** | you | Unfold, sealed for your account | Pick ClickUp Lists by name under **Connect a tracker**; read ClickUp sources that name no `tokenEnv` with your own account. It does not hand work to Ploeg. | removed: no personal tracker links (ADR-0060 rule 6) |
| **Linked accounts › GitLab** | you | Unfold, sealed for your account | Sessions started in Unfold clone private repositories from that GitLab host; GitLab issue sources read with your own account. Only the clone step gets the token, never the agent. Work handed to Ploeg does not use it. | removed: no personal forge links (ADR-0060 rule 6) |
| **Connect Claude** | you | Ploeg | **Start with my Claude** on a Work Item: Ploeg starts your own Claude routine for that Team. Needs Ploeg 0.2.0-rc.128 or later. | stands |
| **Card logins** | you | none: only logins | Run cards from those forge and tracker logins in your binder and packs. Never used for attribution. | stands |
| **Notifications** (ntfy, Web Push, Slack, Microsoft Teams) | you | Unfold: a topic, a push subscription, a Slack user, a Teams workflow URL | A notice when something waits for you; in Slack also answering tool-permission prompts. Behind the `notifications.push` flag. | stands: a product integration (ADR-0060 rule 2) |

## The workbench

| Connection | Set up by | Secret kept by | What it gives | Decided |
|---|---|---|---|---|
| Ploeg | installation | the environment: the Operator Consumer token | Everything managed: Work, Runs, hand-off, spend, cards. | stands |
| Task sources in the configuration (`taskSources`) | installation | the environment (`tokenEnv`), or each person's linked account when there is none | The Tasks page: list, preview, import; hand-off for Vikunja and ClickUp; Report a problem where the tracker supports it. | reads and hand-off go through Ploeg (rules 4 and 5) |
| **Connect a tracker** | admin | Unfold, a sealed service-account token ([application ADR-0064](../../apps/unfold/docs/adrs/0064-people-add-tracker-connections-from-the-screen-and-unfold-keeps-them-with-an-encrypted-service-account-token.md)) | A ClickUp source without a configuration change or restart, picked by name through your own link; **Test connection** for every source. | the token is relayed to Ploeg instead of kept |
| **Connect ClickUp** | admin | Ploeg; Unfold keeps only the connection id | Ploeg takes in a task once it is assigned to Unfold's ClickUp member in a List bound to a Team. The Tasks page cannot read or hand off such a List yet. | already the decided shape |
| **Connections** | — | — | Reads what Ploeg routes: boards, repositories, Teams and whether each is wired. Connects nothing itself. | stands |
| Repositories | installation; admin behind the `repositories.stored` flag | a shared clone Secret (`kubernetes.gitSecretName`), or the GitLab link of the person who starts the Session | Where Unfold's own Sessions work. Repositories added from the screen are cloned anonymously. | Runs clone with a credential Ploeg mints per Run |
| Delivery publisher (Forgejo, GitHub, GitLab) | installation | the environment | A verified Candidate of an Unfold Session becomes a pull or merge request. Merging stays with a person. | forge writes are Ploeg's (rule 1) |
| Model gateway (LiteLLM) | installation | a key Ploeg issues per use | Asks, Chat, the Ready check, Run health and card art. | stands |
| **Webhooks** | admin | a signing secret | Unfold events as CloudEvents to n8n, Zapier, Make, a PSA tool or a chat channel. | stands |
| **Request intake** | admin | a verification secret per sender | Requests from feedback tools, forms and email. Also needs the `intake.requests` flag. | stands |
| **Billing** | admin | configuration | One line per accepted ticket in the agency's own billing tool (Simplicate), or as CSV, UBL or FOCUS. Unfold never sends an invoice. | stands: a product integration (rule 2) |
| Observability (Prometheus, VictoriaLogs, Grafana) | installation | configuration | Pod logs per Run, and telemetry and cost of agent sessions. | stands |

## ClickUp has four places

They do different things and none replaces another:

| Place | Whose account | Secret kept by | What it is for |
|---|---|---|---|
| Linked accounts | yours | Unfold, for you only | looking around ClickUp as yourself and picking Lists by name |
| Connect a tracker | a service account | Unfold, sealed | a source for the Tasks page that can also hand off |
| Connect ClickUp | Unfold's ClickUp member | Ploeg | Ploeg takes in tasks assigned to that member |
| `taskSources` in the configuration | `tokenEnv`, or each person's link | the environment | the same as Connect a tracker, kept in GitOps |

Once S10 lands, only **Connect ClickUp** remains: Ploeg holds the member's token, and the Tasks page reads and hands off through Ploeg.
