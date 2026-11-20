# 6. LiteLLM MCP gateway: evidence (2026-11-20)

Raw evidence only. Sources: docs.litellm.ai, GitHub BerriAI/litellm (issues, PRs, advisories, releases), and the source at `main` commit `41210f8f7bdbf23d2bc82be657e99916d6e68138` (committed 2026-11-20T08:08:19Z), read from a sparse clone. Doc quotes marked "(paraphrase)" came through a summarizing fetch tool and are not guaranteed verbatim. Code and GitHub quotes are verbatim.

Note: LiteLLM's docs source is no longer in the `BerriAI/litellm` repository (`docs/my-website` is absent at that commit), so doc pages were read live only.

## 1. Version and protocol revisions

- Latest stable release: **v1.110.2**, published 2026-11-20T04:06:19Z, marked "Latest". Also published the same day: v1.111.0-rc.3 (pre-release), v1.109.3, 1.108.13 (LTS), v1.106.12, v1.112.0-dev.1. https://github.com/BerriAI/litellm/releases
- Spec versions the code knows (`litellm/types/mcp.py`): `nov_2024 = "2024-11-05"`, `mar_2025 = "2025-03-26"`, `jun_2025 = "2025-06-18"`, `nov_2025 = "2025-11-25"`, `jul_2026 = "2026-07-28"`. https://github.com/BerriAI/litellm/blob/main/litellm/types/mcp.py
- **Toward clients, 2026-07-28 is off unless enabled.** `litellm/proxy/_types.py`, `mcp_advertised_versions`: *"MCP revisions enabled by the gateway. Defaults to all completed legacy revisions. Modern protocol serving requires explicit opt-in. Apps/Tasks remain disabled."* https://github.com/BerriAI/litellm/blob/main/litellm/proxy/_types.py
- PR #45464 (merged 2026-10-09, included in v1.110.2): *"Modern support remains opt-in through `mcp_advertised_versions: ["2025-11-25", "2026-07-28"]`. Replicas need the same `LITELLM_SALT_KEY` for portable continuations."* https://github.com/BerriAI/litellm/pull/45464
- Conflicting text in `litellm/mcp_client/Readme.md` at the same commit: *"Modern protocol advertisement remains disabled during the Phase 0 upgrade. An initialize body requesting `2026-07-28` falls back to the supported legacy version `2025-11-25`; an explicit `MCP-Protocol-Version: 2026-07-28` HTTP header is rejected with HTTP 400"*. This probably describes the default only. Not verified at runtime. https://github.com/BerriAI/litellm/blob/main/litellm/mcp_client/Readme.md
- **`server/discover` exists.** `capabilities.py` imports `DiscoverResult` and defines `build_discovery(...)`. The `mcp_disabled_capabilities` description says a disabled capability *"is left out of the initialize and server/discover responses"*. https://github.com/BerriAI/litellm/blob/main/litellm/proxy/mcp_server/capabilities.py
- Operations the gateway serves (`GATEWAY_OPERATIONS`): `tools/list`, `tools/call`, `prompts/list`, `prompts/get`, `resources/list`, `resources/read`, `resources/templates/list`, `subscriptions/listen`. For every revision, `REVISION_SUPPORT` sets `extensions=frozenset()`, so the gateway negotiates **no extensions**. Same file.
- `2026-07-28` has transports `{http, stdio}`, not SSE, and results `{"complete", "input_required"}`. Same file.
- **Toward upstream servers:** `MCPUpstreamProtocol = MCPLegacyVersion | Literal["auto", "2026-07-28"]`, with *"Modern MCP requires HTTP or stdio transport"* (`litellm/types/mcp.py`). The PR that first added the upstream `"2026-07-28"` pin (*"That pin connects with `server/discover` at exactly 2026-07-28"*) was closed unmerged on 2026-11-09 (https://github.com/BerriAI/litellm/pull/44219), but the literal is present on `main`. Live docs say *"There is no supported per-server `spec_version` configuration field."* (paraphrase, https://docs.litellm.ai/docs/mcp_config_reference). Exact upstream negotiation behaviour is not verified.
- Sessions: PR #26857 (merged 2026-05-30) *"Support both stateless (curl, Inspector) and stateful (Claude Code, Cursor, VSCode) MCP clients simultaneously by routing based on `mcp-session-id` header"*. https://github.com/BerriAI/litellm/pull/26857
- PR #42741 (merged 2026-10-10): *"keeps one upstream MCP session open per gateway `mcp-session-id` and server"*. https://github.com/BerriAI/litellm/pull/42741
- Troubleshooting page: *"Responses arrive as `text/event-stream` frames even for single JSON-RPC calls"* (paraphrase). https://docs.litellm.ai/docs/mcp_troubleshoot

## 2. Authentication

### Client to gateway

- A LiteLLM virtual key in `x-litellm-api-key`, or `Authorization: Bearer` (paraphrase). https://docs.litellm.ai/docs/mcp_usage and https://docs.litellm.ai/docs/mcp
- LiteLLM can also act as an OAuth front for MCP clients. It serves `.well-known/oauth-protected-resource` and `.well-known/oauth-authorization-server`, plus `/register`, `/authorize` and `/token` at gateway level and per server. With `per_server_oauth_discovery: true` it *"publishes discovery documents for `/{mcp_server_name}/mcp`"* (paraphrase). https://docs.litellm.ai/docs/mcp_oauth
- `mcp_allowed_clients` / `mcp_client_id_header`: *"The client picks this value itself, so it is a policy control rather than a security boundary"* (`_types.py`).

### Gateway to upstream

`auth_type` values: `none, api_key, bearer_token, basic, authorization, oauth2, aws_sigv4, token, oauth2_token_exchange, oauth2_id_jag, true_passthrough, oauth_delegate` (`litellm/types/mcp.py`).

- **Shared static credential** (`api_key`, `bearer_token`, `basic`, `token`, `authorization`): *"using the same credential on every request"*. Also: *"A LiteLLM API key used for gateway admission is not copied to the upstream server."* (paraphrase) https://docs.litellm.ai/docs/mcp_authentication
- **Per-user OAuth run by LiteLLM** (`oauth2`): LiteLLM *"runs the browser flow, stores each user's access and refresh tokens encrypted"*. Credentials are *"keyed to `(user_id, server_id)`, not to the virtual key"*, and are stored in the *"LiteLLM database, encrypted"* (paraphrase). https://docs.litellm.ai/docs/mcp_per_user_auth
- Bug fixed 2026-08-19: *"Per-user authorization-code credentials are omitted from MCP prompt and resource operations"*. https://github.com/BerriAI/litellm/issues/37497
- **Forwarding the caller's own token**, from https://docs.litellm.ai/docs/mcp_oauth_passthrough (paraphrase):
  - `true_passthrough`: LiteLLM *"forwards it untouched"*, and *"Both modes return the upstream's protected-resource metadata verbatim during discovery."* Caveat: *"The MCP route becomes an unauthenticated ingress at the LiteLLM layer."* Spend tracking, per-key rate limits and per-user audit do not run.
  - `oauth_delegate`: *"The caller admits with a LiteLLM credential in `x-litellm-api-key`"*. The upstream token *"rides in `Authorization`"*, or in `x-mcp-<alias>-authorization` on aggregate requests. *"LiteLLM validates admission, then forwards only the upstream bearer, never the admission credential."* LiteLLM does not check the token's audience. *"Sender-constrained tokens (DPoP, RFC 9449, or mTLS-bound tokens, RFC 8705) cannot be relayed."* *"If the caller's token was minted for a different resource, neither mode can make it work."*
- **Token exchange / OBO** (`oauth2_token_exchange`): *"LiteLLM uses that bearer token as the RFC 8693 `subject_token`"*. The `audience` setting is the *"Resource identifier for the MCP server"*, and *"LiteLLM forwards only the exchanged scoped token to the MCP server."* Entra OBO is supported. *"There is no fallback to OAuth `client_credentials`."* (paraphrase) https://docs.litellm.ai/docs/mcp_obo_auth
- ID-JAG (Okta): https://docs.litellm.ai/docs/mcp_id_jag. Not read in detail.
- **Header forwarding:**
  - `extra_headers`: *"Optional list of additional header names that should be forwarded from client to the MCP server"*.
  - Per-server client headers use the form `x-mcp-{server_alias}-{header_name}`, or `x-mcp-{access_group}-{header_name}` for an access group. (paraphrase) https://docs.litellm.ai/docs/mcp
  - Open bug, 2026-10-15: *"BYOK/static-auth MCP `tools/list` rejects per-request `x-mcp-{alias}-authorization` credential"*. https://github.com/BerriAI/litellm/issues/46664
  - The term `mcp_server_auth_headers` appears only as an internal parameter name in `operations.py`. It is not on the docs pages I read.
- **A gateway-signed identity the upstream can verify: `mcp_jwt_signer` guardrail.** From the docstring of `litellm/proxy/guardrails/guardrail_hooks/mcp_jwt_signer/mcp_jwt_signer.py`:
  - *"Signs outbound MCP requests with a LiteLLM-issued RS256 JWT so that MCP servers can trust a single signing authority (liteLLM) instead of every upstream IdP."*
  - Claims: *"sub: End-user identity (resolved via end_user_claim_sources, RFC 8693)"*, *"act: Actor/agent identity (team_id or org_id, RFC 8693 delegation)"*, *"aud: MCP audience (configurable)"*, with `DEFAULT_AUDIENCE = "mcp"` and a single `audience` per signer.
  - Verification: *"MCP servers verify tokens via: GET /.well-known/openid-configuration ... GET /.well-known/jwks.json"*.
  - Options include `optional_claims: ["groups", "roles"]` (pass-through from the incoming JWT) and *"Verify + re-sign — validate incoming Bearer token before signing"*.
  - https://github.com/BerriAI/litellm/blob/main/litellm/proxy/guardrails/guardrail_hooks/mcp_jwt_signer/mcp_jwt_signer.py
  - Open gap, issue #32329 (2026-07-07): *"with `mcp_jwt_signer` (`mode: pre_mcp_call`) enabled, `tools/call` gets a signed `Authorization: Bearer <JWT>` but `resources/read` does not — servers that verify that JWT reject resource reads while tool calls succeed."* https://github.com/BerriAI/litellm/issues/32329
  - Fixed 2026-11-14: *"keep an MCP server's own Authorization key when the JWT signer is on"*. https://github.com/BerriAI/litellm/pull/51867
- **Spoofable end-user header:** `x-litellm-end-user-id` scopes permissions and budgets (https://docs.litellm.ai/docs/mcp_control). It is a caller-supplied header, not a verifiable token.

## 3. Feature passthrough

- **Elicitation, 2025-11-25 style (server→client `elicitation/create`).** From `litellm/proxy/mcp_server/README.md` (verbatim):
  - *"Elicitation is disabled by default. Enable it per upstream in `config.yaml`; `allow_elicitation` is currently YAML-only and is not editable through the Admin UI or database-backed server API"*
  - *"Use the gateway's legacy SSE endpoint (`/mcp/sse`) for the verified interactive form and URL relay path. The current Streamable HTTP endpoint (`/mcp`) can lose initialization state before a tool call, so even a client that advertised support receives an explicit elicitation error instead of an input request. Successful interactive relay over Streamable HTTP is not currently verified. Stateless calls and LLM tool bridges with no downstream MCP client also receive explicit errors"*
  - https://github.com/BerriAI/litellm/blob/main/litellm/proxy/mcp_server/README.md
  - History: feature request #23761 was closed as not planned by the stale bot (https://github.com/BerriAI/litellm/issues/23761). PR #27109 (merged 2026-06-04) then landed *"core sampling and elicitation flow"* (https://github.com/BerriAI/litellm/pull/27109). PR #45255 (merged 2026-10-08) changed this: *"unavailable or failed elicitation returns a tool error, replacing a fabricated user decline"* (https://github.com/BerriAI/litellm/pull/45255).
- **Elicitation, 2026-07-28 `input_required` (MRTR).** PR #45464 (merged 2026-10-09, in v1.110.2): https://github.com/BerriAI/litellm/pull/45464
  - It *"reuses the SDK driver for bounded retries across `tools/call`, `prompts/get`, and `resources/read`"*.
  - Legacy clients get the upstream input request translated into a confirmation request.
  - *"A modern client can instead return `inputResponses` with the opaque `requestState` to another replica. Another caller cannot reuse that state"*.
  - *"Elicitation is rejected when the upstream server has not opted in."* It is opt-in through `mcp_advertised_versions`.
- **URL elicitation `-32042`:** fixed 2026-11-19, so that *"`/mcp` relays upstream `-32042` as a JSON-RPC error with its data"*. In v1.112.0-dev.1. Not in v1.111.0-rc.3 or v1.110.2: the compare API reports those tags as diverged from the merge commit. https://github.com/BerriAI/litellm/pull/52384
- **Sampling is not relayed to the client.** The gateway answers it itself. `sampling_handler.py` docstring: *"Handles `sampling/createMessage` requests from upstream MCP servers by routing them through LiteLLM's internal completion infrastructure."* PR #45464: *"For modern clients, the gateway handles sampling internally"*. https://github.com/BerriAI/litellm/blob/main/litellm/proxy/mcp_server/sampling_handler.py
- **MCP Apps (`ui://`, `_meta.ui`).**
  - The gateway does not negotiate the extension: `extensions=frozenset()`, and *"Apps/Tasks remain disabled"*.
  - Tool `_meta` probably survives listing. `to_gateway_tool` is `tool.model_copy(deep=True, update={"name": name})`, which copies everything and changes only the name (`result_conversion.py`). This is inferred from the code, not tested.
  - The source has no handling of `_meta.ui.visibility` or app-only tools: a grep for `visibility`, `resourceUri` and `io.modelcontextprotocol/ui` finds nothing relevant. **App-only tools would be listed to the model like any other tool.** Inferred, not tested.
  - `ui://` reads on the aggregate `/mcp` route failed with `"Multiple MCP servers configured; read_resource currently supports exactly one allowed server."` (https://github.com/BerriAI/litellm/issues/34906). Fixed by PR #51462 (merged 2026-11-13): *"MCP App widgets never render through the aggregate endpoint"* → *"Reads from the single server whose listing has the exact URI"*. That fix is in v1.111.0-rc.3, not in v1.110.2 (the compare API reports v1.110.2 as diverged). https://github.com/BerriAI/litellm/pull/51462
  - The "MCP Apps page" in the LiteLLM UI (PR #23320, https://github.com/BerriAI/litellm/pull/23320) is LiteLLM's own server catalog grid, not the MCP Apps extension.
- **Prompts and resources** are supported and served under prefixed names (`_create_prefixed_prompts` and `_create_prefixed_resources` in `mcp_server_manager.py`). They can be switched off with `mcp_disabled_capabilities`.
  - Open: no `pre_mcp_call` guardrails or JWT signing on `resources/*` and `prompts/*`. https://github.com/BerriAI/litellm/issues/32329
  - Fixed: binary resources *"returned as TextResourceContents"*. https://github.com/BerriAI/litellm/issues/32330
- **Tasks extension:** not supported. *"Apps/Tasks remain disabled"*, and a grep for `tasks/`, `taskSupport` and `io.modelcontextprotocol/tasks` in the MCP server and client source finds nothing.
- **ext-apps issues (both still open):**
  - #745, opened 2026-08-15: *"An app calls its server's tools by the name the server registered. When the host is connected to an aggregating intermediary ... that name has usually been rewritten ... and the app has no way to learn the rewritten name. Its `tools/call` fails."* Also: *"an app can always call **the tool that opened it**, but not any other tool on its own server."* https://github.com/modelcontextprotocol/ext-apps/issues/745
  - #753, opened 2026-08-23: *"Every example app that calls `app.callServerTool()` hardcodes a literal tool-name string ... breaks under any MCP host/proxy that aggregates multiple servers"*. The workaround it gives is deriving the prefix from `getHostContext().toolInfo.tool.name`. https://github.com/modelcontextprotocol/ext-apps/issues/753

## 4. Tool namespacing

- Docs: *"LiteLLM namespaces multiple MCP servers by prefixing each tool name with its MCP server name"* (paraphrase, https://docs.litellm.ai/docs/mcp). Also: *"Tool names are prefixed with the server alias, so call `deepwiki-ask_question`, not `ask_question`."* (paraphrase, https://docs.litellm.ai/docs/mcp_troubleshoot)
- Code: `MCP_TOOL_PREFIX_SEPARATOR: Final = os.environ.get("MCP_TOOL_PREFIX_SEPARATOR", "-")` (`utils.py`). Every tool listing is called with `add_prefix=True,  # Always add server prefix` (`operations.py`). The prefix is the alias, else server_name, else server_id, or a 3-character hash with `LITELLM_USE_SHORT_MCP_TOOL_PREFIX`.
- The prefix cannot be turned off. Open feature request #46692 (2026-10-15): *"The prefix cannot be disabled today."* https://github.com/BerriAI/litellm/issues/46692
- Unprefixed names:
  - Bug #44831, fixed 2026-10-13: unprefixed `tools/call` on `/{server_name}/mcp` was resolved through a process-wide mapping, giving *"404 when cold, 403 when another server has a tool with the same name"*. https://github.com/BerriAI/litellm/issues/44831
  - README: *"Complete initial pages retain legacy bare-name routing. Use the server-prefixed names returned by the gateway for paginated catalogs"*.
- **Effect on app-initiated calls:** an MCP App that calls a sibling tool by its bare upstream name can fail behind the aggregate route. This is the case in ext-apps #745 and #753. Bare-name fallback exists, but only for complete, unpaginated catalogs and only when the name is unambiguous.
- **Effect on confirmations:** the elicitation and `requestState` continuation is bound to *"its original upstream server"* (PR #45464). Nothing found suggests that prefixing changes elicitation content.

## 5. What the gateway adds

- **Permissions** (paraphrase, https://docs.litellm.ai/docs/mcp_control):
  - *"LiteLLM supports managing permissions for MCP Servers by Keys, Teams, Organizations"*
  - *"If no level has a list, the request can access every MCP server (open by default)."*
  - Access groups, plus `allowed_tools` / `disallowed_tools` and `mcp_tool_permissions` per key or team.
  - End-user rows via `x-litellm-end-user-id`.
  - IdP groups map only through SCIM teams: *"To give an IdP group an access group, grant it to the team SCIM provisions for that group"*.
- **Cost:** per-server default cost and per-tool `tool_name_to_cost_per_query`, or a custom post-MCP hook (paraphrase). https://docs.litellm.ai/docs/mcp_cost
- **Guardrails:** `pre_mcp_call`, `during_mcp_call` and `post_mcp_call` modes appear in PR #52384 and issue #32329. Not covered on resources or prompts (#32329, open).
- **Logging:** OTEL spans for MCP operations (PR #28301 was closed; PR #29468 *"Add MCP semantic conventions to otelv2"* was merged). Tool calls appear in spend logs (see the log in issue #35342). A dedicated MCP audit-log feature was not found.
- `mcp_require_explicit_server_scope`, `mcp_allowed_clients`, upstream tool-list caching (PR #51160), and pinned-tool drift alerts: *"sends an mcp_pinned_tools_changed alert"* (paraphrase, https://docs.litellm.ai/docs/mcp_control).

## 6. Security history, 2026 (GitHub advisories, https://github.com/BerriAI/litellm/security/advisories)

- **CVE-2026-59822** (high, 2026-06-30): *"MCP Authentication Bypass via OAuth2 Passthrough Fallback"*. *"the fallback path could replace failed LiteLLM key validation with an empty `UserAPIKeyAuth()` object. This allowed requests with a fabricated `Authorization` header to reach MCP tooling without a valid LiteLLM key."* Fixed in 1.84.0. https://github.com/BerriAI/litellm/security/advisories/GHSA-7488-6r32-c95q
  - Third-party reports say CISA added it to KEV on 2026-09-02. I did not check the CISA catalog itself. https://tech-insider.org/litellm-mcp-vulnerability-cve-2026-59822-cisa-kev-2026/
- **CVE-2026-42271** (high, 2026-04-21): *"Authenticated command execution via MCP stdio test endpoints"*. https://github.com/BerriAI/litellm/security/advisories/GHSA-v4p8-mg3p-g94g
  - Horizon3 chained it with a Starlette host-header bypass into unauthenticated RCE. https://horizon3.ai/attack-research/vulnerabilities/cve-2026-42271-chained-with-cve-2026-48710/
- **CVE-2026-30623** (MCP stdio command injection): *"This was not exploitable by unauthenticated users."* Fixed in v1.83.6-nightly / v1.83.7-stable (paraphrase). https://docs.litellm.ai/blog/mcp-stdio-command-injection-april-2026
- Proxy-wide advisories that also expose the MCP gateway:
  - CVE-2026-49468, critical: *"Authentication Bypass via Host Header Injection"*
  - CVE-2026-42208, critical: *"SQL injection in Proxy API key verification"*
  - CVE-2026-35030, critical: *"Authentication bypass via OIDC userinfo cache key collision"*
  - CVE-2026-114612, critical, 2026-09-30: *"Privilege Escalation to Proxy Admin via Cross-Domain Reuse of the Salt Key"*. Relevant because MCP continuations and cursors depend on `LITELLM_SALT_KEY`.
  - GHSA-w4c7-34wj-hqm8, critical, 2026-10-27: *"Unauthenticated file read leaks master key on Enterprise proxy"*
- A dev.to roundup headline mentions *"6 CVEs, a Supply Chain Attack"*. Not verified. https://dev.to/dmaxdev/litellm-vulnerability-6-cves-a-supply-chain-attack-and-the-fixes-20cn

## 7. Open WebUI and LiteLLM's MCP gateway

- **No documented integration found.** The Open WebUI MCP page does not mention LiteLLM or MCP gateways. Its only proxy is mcpo (paraphrase). https://docs.openwebui.com/features/extensibility/mcp
- LiteLLM's MCP usage page lists Cursor, generic MCP clients and the OpenAI Responses API. *"The page does not mention Open WebUI"* (fetch result). https://docs.litellm.ai/docs/mcp_usage
- Open WebUI MCP facts relevant to routing (paraphrase, same Open WebUI page):
  - Transport: *"Streamable HTTP only"*.
  - Auth options: None, Bearer, Session, OAuth, OAuth 2.1 (DCR), and OAuth 2.1 (Static). *Session* *"Sends the user's own Open WebUI session token as a bearer token"*. *OAuth* *"Sends the access token from the user's Open WebUI SSO sign-in as a bearer token"*.
  - Custom headers can use `{{USER_ID}}` and `{{USER_GROUPS}}` placeholders.
  - Elicitation and MCP Apps are supported.
- Other gateways with an Open WebUI guide: agentgateway (https://agentgateway.dev/docs/kubernetes/main/integrations/web-uis/open-webui/) and IBM MCP Context Forge, which goes through mcpo (https://ibm.github.io/mcp-context-forge/latest/tutorials/openwebui-tutorial/).

## Absences and not verified

- Not run: no LiteLLM instance was tested. Every behaviour claim above comes from docs, PRs or reading the code.
- Not verified at runtime: whether `_meta.ui` survives `tools/list`, and whether app-only tools are hidden from the model.
- Not found: any LiteLLM docs page covering MCP Apps, Tasks, or `_meta.ui.visibility`.
- Not found: a per-server JWT-signer audience. As read, one signer has one `audience`, default `"mcp"`.
- Not found: a way to forward the person's own token with a per-server audience other than `true_passthrough` / `oauth_delegate`, which pass the token unchanged and do not check audience, or `oauth2_token_exchange`, which needs an IdP with RFC 8693 or Entra OBO.
- Doc quotes marked "(paraphrase)" passed through a summarizing fetcher. Check them against the live page before citing them as exact text.
