# Self-hosted and embeddable chat surfaces compared with Open WebUI v0.13 (2026-11-20)

The question is which self-hostable or open-source chat front-end, or which embeddable chat framework, best lets staff and an agency's external clients reach one product's remote MCP server. That server has these properties:

- Stateless Streamable HTTP with JSON responses.
- An OAuth 2.1 resource server: RFC 9728 metadata, tokens from an external OIDC IdP.
- Form-mode elicitation in the 2026-07-28 InputRequired style.
- MCP Apps: `ui://` views carrying `_meta.ui`.
- Tools that read and act on work items.

## Method and confidence

- **Sources.** All findings come from web fetches of official docs, GitHub release pages, issues and PRs, and npm/PyPI registry data on 2026-11-20. Three research subagents covered the competitors; I checked the Open WebUI baseline myself on docs.openwebui.com.
- **Release years.** GitHub release pages show day and month but not the year. The year 2026 is inferred from release notes, issue dates or footers, except where the tag or changelog states it.
- **"Not found".** A "not found" means the cited docs page says nothing on the subject. I read no source code and ran no software.
- **Not verified:**
  - Any behaviour in a running instance, including whether any client copes with JSON-only Streamable HTTP responses. No product documents that mode explicitly.
  - Goose OAuth, CIMD and DCR. Only secondary sources mention them.
  - Cherry Studio Enterprise features. Its docs host did not resolve.
  - Onyx licence gating of OIDC and audit logging in self-hosted deployments.
  - Behaviour of unmerged LobeHub PRs.
  - The date Literal AI shut down.
  - TanStack AI MCP Apps support. Its docs page returned 404.

## Baseline: Open WebUI v0.13 (verified on docs.openwebui.com)

| Topic | Finding | Source |
|---|---|---|
| License and governance | "Open WebUI License" from v0.6.6. It requires "You may NOT alter, remove, or obscure any 'Open WebUI' branding" unless "You have 50 or fewer users" in 30 days or you hold an enterprise license. Code up to v0.6.5 stays BSD-3. Single maintainer org. | https://docs.openwebui.com/license |
| Latest release | v0.13.4, 17 Nov. Earlier: v0.13.3, v0.13.2 and v0.13.1 on 8 Nov, and v0.13.0 on 3 Nov. | https://github.com/open-webui/open-webui/releases |
| SSO | OIDC ("Google, Microsoft, Okta, Keycloak, or any OIDC provider"), LDAP, and trusted header (`WEBUI_AUTH_TRUSTED_EMAIL_HEADER`). OAuth group sync via `ENABLE_OAUTH_GROUP_MANAGEMENT` and `OAUTH_GROUP_CLAIM`; role mapping via `ENABLE_OAUTH_ROLE_MANAGEMENT`. **No SAML.** | https://docs.openwebui.com/features/authentication-access, https://docs.openwebui.com/features/authentication-access/auth/sso |
| SCIM and RBAC | SCIM 2.0 at `/api/v1/scim/v2/`. Roles are Admin, User and Pending; groups grant per-resource permissions. "True takes precedence": a group cannot take away a permission. | https://docs.openwebui.com/features/authentication-access/auth/scim.md, https://docs.openwebui.com/features/authentication-access/rbac/permissions.txt |
| MCP transport and protocol | "Native MCP support in Open WebUI is **Streamable HTTP only**". Connects on "the stateless `2026-07-28` protocol revision and on older revisions". The v0.13.4 release notes add local stdio servers, which contradicts the docs page. | https://docs.openwebui.com/features/extensibility/mcp, https://github.com/open-webui/open-webui/releases |
| MCP auth | Six modes: None, Bearer (shared), Session (forwards the Open WebUI token), OAuth (reuses the SSO access token), OAuth 2.1 with DCR, and OAuth 2.1 (Static). OAuth 2.1 grants are per user and "stored against their account alone". RFC 8707 resource parameter and scopes are supported. **CIMD is not mentioned.** OAuth 2.1 tools should not be default tools on a model. | https://docs.openwebui.com/features/extensibility/mcp |
| MCP registration and scoping | "MCP servers can only be added to the instance by administrators". Access Control scopes a server to users or groups. Users can add their own servers through Tether. | https://docs.openwebui.com/features/extensibility/mcp |
| Elicitation | Supported. Form requests open a schema-driven dialog and URL requests show a link; the user can Decline or Cancel. Timeout is 120 s or `WEBSOCKET_EVENT_CALLER_TIMEOUT`, and the dialog appears only when the chat is open in a tab. | https://docs.openwebui.com/features/extensibility/mcp |
| MCP Apps | Supported for `ui://` resources of type `text/html;profile=mcp-app`, up to 5 MB, in a sandboxed iframe. Each app-initiated tool call needs confirmation, and app messages are text only. Shipped in v0.13.0; v0.13.1 adds app-sent messages behind a "Confirm Prompt from Embed" dialog. | https://docs.openwebui.com/features/extensibility/mcp, https://github.com/open-webui/open-webui/releases |
| MCP prompts and resources | Apps can read and list resources. **MCP prompts are not described.** | https://docs.openwebui.com/features/extensibility/mcp |
| Agents, RAG, artifacts | Sub-agents and automations (`SUBAGENTS_MAX_*`, `AUTOMATION_MAX_COUNT`), knowledge and RAG, and Artifacts rendered in an iframe under `IFRAME_CSP`. | https://docs.openwebui.com/reference/env-configuration, https://docs.openwebui.com/features/ |
| Sharing | Three link levels: Private, Public (signed-in users only) and Open, which needs no sign-in, is read-only and is gated by `USER_PERMISSIONS_CHAT_ALLOW_OPEN_SHARING` (default False). Recipients can clone the chat, or "Allow replies" lets named users, groups or Public write into the live chat. **No guest or anonymous accounts.** | https://docs.openwebui.com/features/chat-conversations/chat-features/chatshare.md |
| Audit | `AUDIT_LOG_LEVEL` (METADATA, REQUEST, REQUEST_RESPONSE), `ENABLE_AUDIT_STDOUT`, `LOG_FORMAT=json`. These go to stdout or a file; I found no admin UI for audit logs. | https://docs.openwebui.com/security/chat-data-privacy-and-encryption |
| Analytics | "Usage dashboards with message volume, token consumption, and cost tracking". | https://docs.openwebui.com/features/ |
| Per-user limits | **No native per-user or per-group rate limit, token quota or budget.** None found in the features page or in the first 100k characters of the env reference. The only caps are on automations and sub-agents. Third-party guides recommend Filter Functions or an AI gateway. | https://docs.openwebui.com/features/, https://docs.openwebui.com/reference/env-configuration, https://fast.io/resources/open-webui-rate-limit/ |
| Embed widget | **No first-party widget.** Only the community project taylorwilsdon/open-webui-embeddable-widget, with an API key behind a proxy and "not meant for public-facing" use. The Rich UI docs cover iframes inside chat, not embedding Open WebUI elsewhere. | https://github.com/taylorwilsdon/open-webui-embeddable-widget, https://docs.openwebui.com/features/extensibility/plugin/development/rich-ui.md |
| Multi-tenancy | Not mentioned. | https://docs.openwebui.com/features/ |

## Self-hosted multi-user front-ends

### LibreChat

| Topic | Finding |
|---|---|
| License and governance | MIT. ClickHouse acquired it on 4 Nov 2025; it "remains 100% open-source under its existing MIT license". https://github.com/danny-avila/LibreChat, https://clickhouse.com/blog/clickhouse-acquires-librechat |
| Latest release | v0.8.9, 17 Nov, marked pre-release. Highlights "MCP Apps, clearer tool approvals". https://github.com/danny-avila/LibreChat/releases |
| SSO and RBAC | OIDC, SAML, LDAP/AD, passkeys and social login. https://www.librechat.ai/docs/configuration/authentication. Admin Panel groups and custom roles "beyond `USER` and `ADMIN`". https://www.librechat.ai/docs/features/admin_panel. `OPENID_ADMIN_ROLE`; group sync for Entra ID only. https://www.librechat.ai/docs/configuration/access_control. **SCIM not found.** All of this is free. |
| MCP transport | "For multi-user or production deployments, use `streamable-http`". https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers |
| MCP OAuth | DCR "If no client id & client secret is provided"; a static client goes in an `oauth` block. **CIMD not found.** Same URL as above. |
| MCP tokens | "Connections are per user. Your OAuth tokens and saved credentials are never used for anyone else", with background refresh. https://www.librechat.ai/docs/features/mcp. `OPENID_REUSE_TOKENS` passes the live OIDC session to MCP. https://www.librechat.ai/docs/configuration/authentication/OAuth2-OIDC/token-reuse |
| Elicitation | **Not supported.** Issue #11526 is open. https://github.com/danny-avila/LibreChat/issues/11526 |
| MCP Apps | Yes, rendered "in a sandboxed frame". Running a tool from an app asks first, and apps "do not render in shared conversations". https://www.librechat.ai/docs/features/mcp |
| MCP prompts and resources | Not found. https://www.librechat.ai/docs/features/mcp |
| Agents, RAG, artifacts | Agents and subagents, file search, "Code Artifacts create React, HTML, and Mermaid content". https://github.com/danny-avila/LibreChat |
| Sharing | Read-only snapshots. `ALLOW_SHARED_LINKS_PUBLIC` "Default: false". "Continue this chat" needs sign-in. No guest accounts. https://www.librechat.ai/docs/features/shareable_links |
| Audit | An append-only grant and sharing audit log at `/api/admin/audit-log` with CSV export and `AUDIT_LOG_FAIL_CLOSED`. https://www.librechat.ai/docs/configuration/dotenv. A reviewer flagged fail-open gaps. https://github.com/LibreChat-AI/LibreChat/pull/17054 |
| Limits | Token balance (`startBalance`, `autoRefillEnabled`) applies globally; **I found no per-user override.** https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/balance. Per-user message rate via `LIMIT_MESSAGE_USER`. https://www.librechat.ai/docs/configuration/dotenv |
| Embed widget | Not found. Issue #15005 was a third-party project filed by mistake. https://github.com/danny-avila/LibreChat/issues/15005 |

### LobeHub (formerly LobeChat)

| Topic | Finding |
|---|---|
| License and governance | "LobeHub Community License", which is Apache 2.0 plus conditions. Commercial use is allowed "without modifying the source code"; modified versions need a licence from the producer. Single vendor, LobeHub. https://github.com/lobehub/lobehub/blob/main/LICENSE |
| Latest release | v2.3.4, 18 Nov 2026. https://github.com/lobehub/lobehub/releases/tag/v2.3.4 |
| SSO and RBAC | Better Auth with 17 providers plus Generic OIDC. https://raw.githubusercontent.com/lobehub/lobehub/canary/docs/self-hosting/auth.mdx. **SAML and SCIM not found self-hosted.** Workspace roles are Owner, Member and Viewer. "SSO/SAML" is Enterprise, and "roles & audit logs" is the Business cloud plan. https://lobehub.com/workspace, https://lobehub.com/enterprise |
| MCP transport | HTTP and STDIO; STDIO is desktop only. https://raw.githubusercontent.com/lobehub/lobehub/canary/docs/usage/community/mcp-market.mdx |
| MCP OAuth | Tries a pre-registered client first, then **CIMD**, then DCR. CIMD needs a public HTTPS `APP_URL`; private deployments use DCR (PR #22456, merged 6 Nov 2026). https://github.com/lobehub/lobehub/pull/22456. Default scopes come from the protected resource (#22564). |
| MCP tokens | Per user, with multiple accounts per connector. "creating the connector does not make a teammate's account yours". https://github.com/lobehub/lobehub/pull/22988 |
| Elicitation | **Not shipped.** PR #21750 is open. https://github.com/lobehub/lobehub/issues?q=elicitation |
| MCP Apps | **Not shipped.** PR #23325 "render MCP-UI ui:// resources in tool cards" is open. |
| MCP prompts and resources | Not found. https://raw.githubusercontent.com/lobehub/lobehub/canary/docs/usage/agent/connectors.mdx |
| Agents, RAG, artifacts | Agent Team ("sequential, parallel, iterative or debate"), a Resource Library and knowledge base, and artifacts. https://github.com/lobehub/lobehub, https://lobehub.com/docs/self-hosting/advanced/knowledge-base, https://lobehub.com/changelog/2024-09-20-artifacts |
| Sharing | "Anyone with the link" for read-only access. Whether a visitor must sign in is not documented. https://raw.githubusercontent.com/lobehub/lobehub/canary/docs/usage/agent/topic.mdx |
| Audit | Cloud Business plan and Enterprise only; not found in the self-hosted docs. https://lobehub.com/enterprise |
| Limits | Cloud workspace budget and credit pool; Enterprise has "per-user quotas". https://lobehub.com/workspace, https://lobehub.com/enterprise |
| Embed widget | **Not shipped.** PR #23333 "embed a shared Agent on any website" is open, behind the `agent_embed` flag. https://github.com/lobehub/lobehub/pull/23333 |

### AnythingLLM

| Topic | Finding |
|---|---|
| License and governance | MIT, from Mintplex Labs Inc. Pro is a paid desktop subscription. https://github.com/Mintplex-Labs/anything-llm, https://docs.anythingllm.com/pro/overview |
| Latest release | v1.20.0, 17 Nov. https://github.com/Mintplex-Labs/anything-llm/releases/tag/v1.20.0 |
| SSO and RBAC | Multi-user mode only in Docker. Roles are Admin, Manager and Default. https://docs.anythingllm.com/features/security-and-access. **No OIDC or SAML**; only "Simple SSO Passthrough". The maintainer declined SAML. https://github.com/Mintplex-Labs/anything-llm/issues/2880. SCIM and groups not found. |
| MCP transport | stdio, `sse` (the default) and streamable. https://docs.anythingllm.com/mcp-compatibility/overview |
| MCP OAuth | **Not supported.** Issue #6396 is open. https://github.com/Mintplex-Labs/anything-llm/issues/6396 |
| MCP tokens | Static headers are "the same for every user and workspace". `anythingllm.forwardIdentity` adds `X-AnythingLLM-*` headers. https://docs.anythingllm.com/mcp-compatibility/overview |
| Elicitation, MCP Apps, prompts and resources | Not found. Same URL. |
| Agents, RAG, artifacts | No-code agent builder and workspace RAG on LanceDB. Artifacts not found. https://github.com/Mintplex-Labs/anything-llm |
| Sharing | No chat share links or guests; workspace link sharing is a feature request. https://github.com/Mintplex-Labs/anything-llm/issues/117 |
| Audit | Event Logs record logins, messages, settings changes and uploads. https://docs.anythingllm.com/features/event-logs |
| Limits | Per-user daily message limit, with admins exempt. https://github.com/Mintplex-Labs/anything-llm/pull/2417. No token budget. |
| Embed widget | **Yes.** A `<script>` tag with a domain allowlist and chat caps per widget per 24 h and per session. "only available in the Docker version". https://docs.anythingllm.com/features/chat-widgets |

### Onyx (formerly Danswer)

| Topic | Finding |
|---|---|
| License and governance | Open core: "MIT Expat" outside `ee`, and "All content that resides under 'ee' directories ... is licensed under the Onyx Enterprise License". Single vendor, Onyx. https://github.com/onyx-dot-app/onyx/blob/main/LICENSE |
| Latest release | v5.1.3, 16 Nov; Helm chart onyx-0.9.56, 19 Nov. https://github.com/onyx-dot-app/onyx/releases |
| SSO and RBAC | Basic auth, Google OAuth, OIDC and SAML. https://docs.onyx.app/deployment/configuration/configuration. OIDC and SAML SSO are Enterprise; RBAC is Business; "SCIM / Group Sync" and "Custom Roles and Permissions" are Enterprise. https://onyx.app/pricing, https://docs.onyx.app/admins/billing/overview. v5.0.0: "The SCIM and Service Accounts pages now require a license". https://docs.onyx.app/changelog |
| MCP transport | Streamable HTTP is the default; SSE is legacy. https://docs.onyx.app/admins/actions/mcp |
| MCP OAuth | "Set up automatically" (DCR), "Use your own OAuth client" (static), and "Use client metadata document" (**CIMD**, since v4.6.0). "OAuth Pass-through" forwards the user's Onyx OAuth token. Group-restricting servers needs Business or Enterprise. https://docs.onyx.app/admins/actions/mcp |
| MCP tokens | A shared key, or a per-user key or OAuth grant. Same URL. |
| Elicitation, MCP Apps, prompts and resources | **Not found** in the docs or changelog. https://github.com/onyx-dot-app/onyx/issues?q=elicitation |
| Agents, RAG, artifacts | Agents and actions, connectors with "Agentic RAG", and "downloadable artifacts". https://github.com/onyx-dot-app/onyx |
| Sharing and guests | **Anonymous users** (admin toggle): "visitors can start chats without signing in" and "see only their own chats". https://docs.onyx.app/admins/managing_features/chat. Chat sharing goes to team members; public links not found. https://docs.onyx.app/llms-full.txt |
| Audit | JSON events on the `onyx.audit` logger, SIEM-ready, from v4.3. Licence gating not stated. https://docs.onyx.app/admins/auditing/audit_logs |
| Limits | Spending limits in tokens or USD. Workspace-wide limits need Business; per-user and per-group limits "require an Enterprise plan". https://docs.onyx.app/admins/advanced_configs/spending_limits |
| Embed widget | **Yes**, "available on all editions". With a shared API key it runs as "one Onyx service account". With `tokenProvider` JWT passthrough, each visitor "acts as their own Onyx user", but that is "for self-hosted, single-tenant deployments only". MCP inside the widget is not documented. https://docs.onyx.app/overview/onyx_anywhere/website_widget |

### HuggingFace chat-ui

- **License and governance.** Apache-2.0, maintained by Hugging Face. SvelteKit with MongoDB. It "only supports OpenAI-compatible APIs". https://github.com/huggingface/chat-ui
- **Latest release.** v0.10.0, 11 May. https://github.com/huggingface/chat-ui/releases
- **SSO.** OIDC via `OPENID_PROVIDER_URL`, with `ALLOWED_USER_EMAILS` and `ALLOWED_USER_DOMAINS`. No SAML, SCIM, groups or RBAC. https://huggingface.co/docs/chat-ui/configuration/open-id
- **MCP.**
  - Admin `MCP_SERVERS` entries take a `url` and static `headers`. Servers users add are "stored in the browser". https://huggingface.co/docs/chat-ui/configuration/mcp-tools
  - The only per-user credential is `MCP_FORWARD_HF_USER_TOKEN`.
  - No MCP OAuth, elicitation, MCP Apps, or prompts and resources.
- **Sharing.** "Share convos" and "allow guest on home and shared convo". https://github.com/huggingface/chat-ui/releases/tag/v0.9.6
- **RAG.** Removed.
- **Not found:** audit, per-user limits, widget.

### Khoj

- **License and governance.** AGPL-3.0, from Khoj Inc. https://github.com/khoj-ai/khoj
- **Latest release.** 2.0.0-beta.28, 26 Mar. https://github.com/khoj-ai/khoj/releases/tag/2.0.0-beta.28
- **Auth.** Google OAuth and magic links only. https://docs.khoj.dev/advanced/authentication
- **MCP.** Admin-added, "SSE or Stdio", research mode only. https://github.com/khoj-ai/khoj/pull/1229. No Streamable HTTP, OAuth, elicitation or MCP Apps.
- **Sharing.** Public links. https://docs.khoj.dev/features/share
- **Agents and RAG.** Agents with custom knowledge, plus automations.
- **Not found:** audit, limits, widget.

### Cherry Studio

- **License and governance.** AGPL-3.0 with a commercial exemption, from CherryHQ. Community Edition is a desktop app; Enterprise offers "private deployment options". https://raw.githubusercontent.com/CherryHQ/cherry-studio/main/README.md
- **Latest release.** v2.2.3, 19 Nov 2026. https://github.com/CherryHQ/cherry-studio/releases
- **Multi-user.** Enterprise lists "employee access controls". OIDC, SAML and SCIM are unverified because the docs host failed DNS.
- **MCP.**
  - stdio, SSE and streamable HTTP, with OAuth (no detail on DCR or CIMD). https://cherryai.com.cn/docs/zh-cn/advanced-basic/extensions/mcp/
  - **MCP prompts and resources are supported** ("MCP 提示词", "MCP 资源").
  - Elicitation and MCP Apps not found.
- **Agents and knowledge.** Agents with tool permissions and local knowledge bases.
- **Not found:** guest sharing, audit, limits, widget.

### Jan

- **License and governance.** Apache-2.0, from Menlo Research. Desktop app. https://github.com/janhq/jan
- **Latest release.** v0.8.8, 28 Oct 2026. https://github.com/janhq/jan/releases
- **MCP.**
  - "`HTTP` (Streamable HTTP)", STDIO and SSE.
  - OAuth: "discovers the provider's metadata, registers itself dynamically, and runs the authorization-code flow with PKCE", with a loopback redirect. https://docs.jan.ai/desktop/integrations/mcp-servers, https://docs.jan.ai/agent/mcp
  - No CIMD, elicitation or MCP Apps.
- **Single-user.** A separate **jan-server** (MIT) has "OAuth/OIDC authentication via Keycloak with guest access". It has no releases and is in early development. https://github.com/janhq/jan-server

### big-AGI

- **License and governance.** MIT, single maintainer. https://github.com/enricoros/big-AGI
- **Latest release.** v2.1.3, 27 Oct 2026. https://github.com/enricoros/big-AGI/releases
- **Multi-user.** HTTP Basic auth only.
- **MCP.** Not shipped. Issue #892 is open. https://github.com/enricoros/big-AGI/issues/892
- **Sharing.** Link sharing exists.

### Msty Studio

- **License and governance.** Proprietary, not open source, from CloudStack, LLC. https://msty.ai/pricing
- **Latest release.** 3.0.1, 17 Nov 2026. https://msty.ai/resources/changelog/studio/
- **Enterprise.** SSO (Entra ID named) and audit logs of user and team actions, but "Msty currently stores User, Team, and Audit Log data on our servers". https://docs.msty.ai/studio/enterprise/overview
- **MCP.** Streamable HTTP, and OAuth with "CIMD support for MCP OAuth registration" (3.0.0 Beta 14). No elicitation or MCP Apps found.
- **Fit.** It fails the self-hosted, open-source criterion.

### Chatbox

- **License and governance.** Community Edition is GPLv3. Desktop, web and mobile, with no self-hosted server. https://github.com/chatboxai/chatbox
- **Latest release.** v1.24.4, 12 Nov 2026. https://github.com/chatboxai/chatbox/releases
- **MCP.** v1.23.2 "Added OAuth authorization for remote MCP servers". https://github.com/chatboxai/chatbox/releases/tag/v1.23.2. No elicitation or MCP Apps found.
- **Multi-user.** Single-user; no SSO.

### Goose (aaif-goose)

- **License and governance.** Apache-2.0. It "is part of the Agentic AI Foundation (AAIF)" at the Linux Foundation, the only foundation-governed product here. https://github.com/aaif-goose/goose, https://linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation
- **Latest release.** v1.60.2, 20 Nov. https://github.com/aaif-goose/goose/releases
- **Form.** Single-user desktop app and CLI. `goose acp` can serve as a backend for other apps.
- **MCP.**
  - `streamable_http` with headers. https://goose-docs.ai/docs/guides/config-files
  - Elicitation "supports form mode requests". https://goose-docs.ai/docs/guides/mcp-elicitation
  - MCP Apps "through the official MCP Apps specification", experimental and desktop-only. https://goose-docs.ai/docs/guides/interactive-chat/mcp-ui/
  - OAuth with DCR and CIMD is claimed by secondary sources only (https://eseospace.com/blog/goose-mcp-setup/); not verified.

## Embeddable chat frameworks for a product's own client UI

### assistant-ui

- **License and governance.** MIT, single vendor (YC-backed). https://github.com/assistant-ui/assistant-ui
- **Latest release.** `@assistant-ui/react` 0.15.37 and `@assistant-ui/react-mcp` 0.1.29, both 18 Nov. https://github.com/assistant-ui/assistant-ui/releases
- **Auth.** The app owns users. Guides exist for Clerk and Better Auth. https://www.assistant-ui.com/docs/integrations/auth/clerk
- **Browser MCP (`@assistant-ui/react-mcp`).** https://www.assistant-ui.com/docs/tools/user-managed-mcp
  - StreamableHTTP only.
  - OAuth with PKCE and RFC 7591 DCR. A CIMD-only authorization server needs a pre-registered `clientId`, and the package does not claim to implement CIMD.
  - Form elicitation via `McpElicitationPrimitive`.
  - Default `McpLocalStorage` "stores tokens in plain text and is XSS-exposed"; `McpCustomStorage` with HTTP-only cookies is recommended.
- **Server MCP.** Uses the AI SDK in the route handler. https://www.assistant-ui.com/docs/tools/mcp.md
- **MCP Apps host.** https://www.assistant-ui.com/docs/tools/mcp-apps.md
  - `McpAppRenderer` and `McpAppsRemoteHost` handle `ui://` URIs and `_meta.ui.resourceUri`.
  - Each widget gets its own cross-origin domain, and "Resource CSP metadata is enforced".
  - An `allowedTools` allowlist, and display modes `inline`, `fullscreen` and `pip`.
  - "The renderer trusts whatever the route returns".
- **Tool UI and approvals.** `makeAssistantToolUI` and inline human approvals.
- **Hosted tier.** Assistant Cloud: Free up to 200 MAU, Pro $50/mo, and Enterprise including on-premises. On Cloud, workspace scoping comes from a JWT claim. https://www.assistant-ui.com/pricing, https://www.assistant-ui.com/docs/cloud/authorization.md

### CopilotKit and AG-UI

- **License and governance.** Both MIT, single vendor CopilotKit. AG-UI was "created by CopilotKit". https://github.com/CopilotKit/CopilotKit, https://github.com/ag-ui-protocol/ag-ui
- **Latest releases.**
  - CopilotKit v1.89.0, 17 Nov: "expands MCP Apps with model-context sharing". https://github.com/CopilotKit/CopilotKit/releases
  - AG-UI 1.0.5, 2026-11-17, a "stable, frozen specification".
  - `@ag-ui/mcp-apps-middleware` 0.1.3.
- **Auth.** The app's `onRequest` and `identifyUser` hooks. "A static identifyUser value is suitable only for a single-user demo". https://docs.copilotkit.ai/a2a/auth
- **MCP.**
  - HTTP or SSE.
  - Headers are documented for SSE, and are "not supported" for HTTP in the transport reference.
  - **OAuth, DCR, CIMD and elicitation not found.** https://docs.showcase.copilotkit.ai/built-in-agent/mcp-servers
- **MCP Apps.** https://docs.copilotkit.ai/generative-ui/mcp-apps
  - `mcpApps.servers` on `CopilotRuntime`, rendered in `<CopilotChat />`, in a "sandboxed iframe with an opaque origin".
  - Supports `sendMessage` and `updateModelContext`.
  - Apps are "stored in conversation history and restored on reconnect".
- **Approvals.** `useHumanInTheLoop`.
- **Paid tier.** CopilotKit Intelligence: Free (non-production), $49/mo, or Annual with SSO. Cloud or self-hosted on Kubernetes. https://copilotkit.ai/pricing

### Vercel AI SDK (`@ai-sdk/mcp`, useChat) and AI Elements

- **License and governance.** Single vendor, Vercel. `@ai-sdk/mcp` is Apache-2.0. https://github.com/vercel/ai
- **Latest release.** `ai` 7.0.177, 18 Nov; `@ai-sdk/mcp` 2.0.101. https://github.com/vercel/ai/releases
- **MCP client.** https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools, https://ai-sdk.dev/docs/reference/ai-sdk-core/create-mcp-client
  - `type: 'http' | 'sse'`. "MCP `2026-07-28` is stateless", and `protocolVersionDiscovery` probes `server/discover`.
  - OAuth "by providing an `authProvider`", including DCR, `validateAuthorizationServerURL` and `redirect: 'error'`. **CIMD not found.**
  - Elicitation via `onElicitationRequest`. Changelog 2.0.88: "Handle MCP 2026-07-28 input-required results through the registered elicitation handler". https://github.com/vercel/ai/blob/main/packages/mcp/CHANGELOG.md
  - `listResources`, `readResource`, `listPrompts`, `getPrompt`.
- **MCP Apps.** https://ai-sdk.dev/docs/ai-sdk-core/mcp-apps
  - `mcpAppClientCapabilities`, `readMCPAppResource` (which checks `ui://` and the MIME type and returns the CSP), and `MCPAppRenderer` in `@ai-sdk/react`.
  - The app provides the sandbox proxy origin.
- **Approvals.** `toolApproval`, with `addToolApprovalResponse` for manual responses. https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage
- **Persistence and auth.** Not provided: "This guide does not cover authorization". https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence
- **AI Elements.** "will be deprecated at the end of November 2026 and replaced by AI Elements from shadcn/ui". https://elements.ai-sdk.dev/

### Chainlit

- **License.** Apache-2.0.
- **Status.** "This repository was archived by the owner on Oct 15, 2026. It is now read-only." The original team stepped back in May 2025. https://github.com/Chainlit/chainlit
- **Last release.** 2.12.0, 25 Aug. It fixed CVE-2026-45018 (stdio command injection) and CVE-2026-45019 (SSRF via streamable-http and SSE). https://github.com/Chainlit/chainlit/releases
- **MCP.** Tools only; no OAuth, elicitation or MCP Apps. https://docs.chainlit.io/advanced-features/mcp
- **Verdict.** Treat it as dead.

### Significant 2026 additions

- **`@modelcontextprotocol/ext-apps`.**
  - Apache-2.0, the official MCP Apps spec and SDK. The stable spec is 2026-01-26.
  - Latest tag v2.1.0, 10 Nov 2026; npm still shows 2.0.4.
  - The host side is `app-bridge`, with an `examples/basic-host`. https://github.com/modelcontextprotocol/ext-apps
  - Client matrix: https://modelcontextprotocol.io/extensions/client-matrix
- **MCP-UI (`@mcp-ui/client`).** Apache-2.0. It is "the recommended SDK for MCP Apps Hosts", with an `AppRenderer` React component. Listed hosts include LibreChat and Goose. https://github.com/MCP-UI-Org/mcp-ui
- **jan-server.** Keycloak OIDC with guest access. Early, with no releases. https://github.com/janhq/jan-server
- **TanStack AI.** An MCP Apps integration built on `@mcp-ui/client` appeared in search results. Its docs returned 404, so it is not verified.

## Feature matrix for our MCP server

Each "y" or "n" rests on the docs cited above. "?" means the docs say nothing.

| Product | Streamable HTTP | Per-user OAuth | DCR | Static client | CIMD | Elicitation (form) | MCP Apps | Guests or anonymous | Per-user limits | Widget |
|---|---|---|---|---|---|---|---|---|---|---|
| **Open WebUI 0.13** | y | y | y | y | ? | **y** | **y** | n (Open links are read-only) | n | n |
| LibreChat 0.8.9 | y | y | y | y | ? | **n** | y | n | message rate only | n |
| LobeHub 2.3.4 | y | y | y | y | **y** | n (PR) | n (PR) | read-only link | Enterprise | n (PR) |
| AnythingLLM 1.20 | y | **n** | n | n | n | ? | ? | n | daily messages | **y** |
| Onyx 5.1 | y | y | y | y | **y** | ? | ? | **y (anonymous)** | Enterprise | **y (per-user JWT)** |
| chat-ui 0.10 | y | n | n | n | n | ? | ? | guest view | ? | n |
| Goose 1.60 | y | y (unverified) | y (unverified) | y (unverified) | y (unverified) | y | y (experimental) | single-user | — | n |
| assistant-ui | y | y | y | clientId | n | y | y | app-defined | app-defined | it *is* the UI |
| AI SDK | y | y | y | y | ? | y (input-required) | y | app-defined | app-defined | it *is* the UI |
| CopilotKit | y | n | n | n | n | ? | y | app-defined | app-defined | it *is* the UI |

## What the others have that Open WebUI v0.13 does not

Each absence below was checked against the docs.openwebui.com page cited.

1. **SAML login.** LibreChat has it for free (https://www.librechat.ai/docs/configuration/authentication). Onyx has it in Enterprise (https://onyx.app/pricing). Open WebUI's SSO page covers OAuth/OIDC, LDAP and trusted header only (https://docs.openwebui.com/features/authentication-access/auth/sso).
2. **CIMD for MCP OAuth.** Onyx has "Use client metadata document" (https://docs.onyx.app/admins/actions/mcp), LobeHub merged it in #22456, and Msty has it too. Open WebUI's MCP auth options are DCR or a static client only (https://docs.openwebui.com/features/extensibility/mcp).
3. **Native per-user or per-group spend and usage limits.**
   - Onyx: token or USD limits per user and group, in Enterprise (https://docs.onyx.app/admins/advanced_configs/spending_limits).
   - LibreChat: a token balance and per-user message rate limits (https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/balance).
   - AnythingLLM: per-user daily message limits.
   - Open WebUI has analytics only (https://docs.openwebui.com/features/), and third parties confirm there is no native cap (https://fast.io/resources/open-webui-rate-limit/).
4. **Anonymous or guest chatting.** Onyx's anonymous users can start their own chats and "see only their own chats" (https://docs.onyx.app/admins/managing_features/chat). chat-ui allows guests on shared conversations. Open WebUI's Open links are read-only snapshots only; replying or cloning requires sign-in (https://docs.openwebui.com/features/chat-conversations/chat-features/chatshare.md).
5. **A first-party embeddable widget for external sites.**
   - Onyx: available on all editions, with per-visitor JWT passthrough (https://docs.onyx.app/overview/onyx_anywhere/website_widget).
   - AnythingLLM: a script tag with domain allowlist and per-session caps (https://docs.anythingllm.com/features/chat-widgets).
   - Open WebUI has only a community widget (https://github.com/taylorwilsdon/open-webui-embeddable-widget).
6. **An admin UI or API for the audit log.** LibreChat has `/api/admin/audit-log` with CSV export (https://www.librechat.ai/docs/configuration/dotenv), and AnythingLLM has an Event Logs UI. Open WebUI's audit goes to stdout or files via `AUDIT_LOG_LEVEL` (https://docs.openwebui.com/security/chat-data-privacy-and-encryption).
7. **MCP prompts surfaced in the UI.** Cherry Studio has "MCP 提示词" (https://cherryai.com.cn/docs/zh-cn/advanced-basic/extensions/mcp/). The AI SDK has `listPrompts` and `getPrompt`. Open WebUI's MCP docs do not describe prompts.
8. **Removing or replacing the branding without a 50-user cap or enterprise licence.** LibreChat, AnythingLLM and the frameworks are MIT; Onyx's core is MIT. Open WebUI's licence forbids changing branding above 50 users (https://docs.openwebui.com/license). This matters for a client-facing, white-labelled surface.
9. **Foundation governance.** Only Goose is under a foundation, the AAIF at the Linux Foundation. Open WebUI, like most others, has a single vendor.

Where **Open WebUI leads** the self-hosted apps:
- It is the only one of them that documents **both** form elicitation **and** MCP Apps. LibreChat has MCP Apps without elicitation; Onyx and LobeHub have neither shipped.
- It explicitly supports the stateless 2026-07-28 revision.
- It is free, which beats Onyx's paywall on SCIM.

## Best fit for external clients (non-staff, guest access, per-client isolation) on an MCP server

**No self-hosted app satisfies all of these:** per-client isolation, guest or external access, per-user OAuth to the MCP server, elicitation and MCP Apps.

- **Best packaged app: Onyx.**
  - Visitors: anonymous visitors see only their own chats.
  - Widget: a website widget with JWT `tokenProvider` passthrough, so each visitor "acts as their own Onyx user".
  - MCP auth: per-user MCP OAuth with CIMD, DCR, static clients and OAuth pass-through, and servers restricted by group.
  - Controls: per-user and per-group spending limits, and an audit stream.
  - Gaps:
    - No documented elicitation or MCP Apps, so confirmations and `ui://` views would not render.
    - The per-user widget is "for self-hosted, single-tenant deployments only".
    - SSO, SCIM, custom roles and per-user limits need Enterprise. https://docs.onyx.app/overview/onyx_anywhere/website_widget, https://docs.onyx.app/admins/actions/mcp
- **Best for staff alongside Open WebUI: LibreChat.** It is MIT, free SAML and OIDC, per-user MCP OAuth and MCP Apps. It lacks elicitation, guests and a widget, so it is weaker than Open WebUI on our protocol surface.
- **Best for external clients overall: an embeddable framework inside the product's own client portal.** The product then owns tenancy, client isolation and branding.
  - **Vercel AI SDK** is the most complete documented MCP client for our server:
    - The stateless 2026-07-28 protocol with `server/discover`.
    - Input-required elicitation.
    - OAuth `authProvider` with DCR.
    - Resources and prompts.
    - MCP Apps host helpers.
  - **assistant-ui** adds the chat UI, browser-side MCP OAuth with DCR and form elicitation, and a cross-origin `McpAppRenderer`.
  - Gaps:
    - CIMD is undocumented in both, so the IdP needs a pre-registered client or DCR.
    - The app builds persistence, users, limits and audit itself.
    - JSON-only responses are untested.
- **Recommendation.** Keep Open WebUI as the staff surface; it has the best protocol coverage of the self-hosted apps. Serve external clients through an AI SDK plus assistant-ui chat inside the product's own UI, with the product's OIDC IdP issuing per-client tokens to the MCP server. Evaluate Onyx only if a packaged, no-code client chat with anonymous access matters more than elicitation and MCP Apps.
