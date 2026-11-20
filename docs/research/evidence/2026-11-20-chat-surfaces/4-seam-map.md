# 4. Unfold seam map for third-party chat front-ends

> Date: 20 November 2026, against `development` at `eaca9fd7` (worktree `unfold-chat-surfaces`). Method: one read-only agent; every claim names its path and line, relative to the repository root. "Implemented" means code on `development`; "proposed" quotes the record's own label. Ploeg paths under `apps/ploeg/` were read from an unpacked contract bundle of the same pinned release (`0.2.0-rc.134`, `apps/unfold/ploeg-release.json:2`); this worktree has no `apps/ploeg`, because `mise run setup` was not run here.

## Summary

- A third-party chat front-end can reach exactly one Unfold surface: the remote `unfold-mcp` endpoint inside the Unfold server (implemented, off unless `UNFOLD_MCP_RESOURCE` is set). It serves 23 model-visible tools: 9 read-only, 1 write without confirmation (`unfold_link_session`) and 13 that confirm through form elicitation first (`unfold_ask` with `use_model` plus 12 action tools).
- Confirmation is the binding constraint. A front-end that declares no form elicitation gets every reading tool and `unfold_link_session`, and `mcp_confirmation_unsupported` with an Unfold link on the 13 confirming tools. A 2025-11-25 client *can* confirm over HTTP: on an SSE answer to that one `tools/call`, if its `initialize` declared form elicitation and reached the same process within 24 hours. ADR-0032 still says this is impossible; that sentence is stale.
- Staff: admin, operator and viewer accounts that already signed in once in the browser. Clients: there is no client role, no client portal and no Client-safe MCP view. A Client is a membership kind (`unfold/<tenant>/client/<client>`) that only narrows reach, and only while `tenancy.enforce` is on (default off). A client contact can use the MCP server only if an admin also maps them to a role group in `auth.oidc.roles`. They then get the same tools and the same non-Client-safe answers as staff of that role, limited to their Client's Work Items.
- `ploeg-mcp` still exists, upstream in `ploeg-hq/ploeg` (`cmd/ploeg-mcp`), and is consumed only through the pinned contract bundle. Unfold advertises its URL to editors and does not run it.
- Unfold's own chats run on the VS Code Agents window over AHP: the "Unfold" chat (ADR 0049, proposed, built) and the Work Item side chat (ADR 0012 update, built). Neither is reachable from a third-party front-end. Both reuse the MCP tools in-process.
- The repository never tried Open WebUI, LibreChat, LobeChat or AnythingLLM against Unfold. LobeChat and AnythingLLM appear nowhere.

## 1. The remote MCP endpoint (implemented)

### Where and when it exists

- Built in `apps/unfold/src/http.ts:481-500`: only when `config.mcp && config.auth.oidc`. `createMcpHttp` is fed `entitle` (`entitledRole`, `http.ts:486`), `memberships` (`membershipsFromGroups` of the groups claim, `http.ts:487`), `delegate`, `apiUrl` (loopback), and the flags `mcp.tasks`, `mcp.events` and `mcp.skills` evaluated per person (`http.ts:493-499`).
- `UNFOLD_MCP_RESOURCE` turns it on. Any other `UNFOLD_MCP_*` without it refuses to start (`apps/unfold/src/mcp-auth.ts:70-76`). Live mode and `auth.oidc` are required (`docs/how-to/serve-unfold-mcp-over-https.md:61`).

### Environment variables (`apps/unfold/src/mcp-auth.ts:70-104`; table `docs/how-to/serve-unfold-mcp-over-https.md:49-59`)

| Variable | Rule |
| --- | --- |
| `UNFOLD_MCP_RESOURCE` | Required; exact public URL; its own path, outside `/api`, `/.well-known`, `/healthz`, `/readyz` (`mcp-auth.ts:77-78`) |
| `UNFOLD_MCP_ISSUER` | Required; matched byte for byte (`mcp-auth.ts:79-81`, `241`) |
| `UNFOLD_MCP_JWKS_URL` | Optional; otherwise discovery `jwks_uri` (`mcp-auth.ts:82-83`, `165-172`) |
| `UNFOLD_MCP_TOKEN_AUDIENCE` | `resource` (default) or `client-id`; `client-id` needs `UNFOLD_MCP_CLIENT_IDS` and logs a warning (`mcp-auth.ts:84-88`; `mcp-http.ts:135`) |
| `UNFOLD_MCP_CLIENT_IDS` | Comma list of client ids or Client ID Metadata Document URLs; empty accepts any client (`mcp-auth.ts:86-87`, `254`) |
| `UNFOLD_MCP_SCOPE` | Default `unfold:mcp`; a missing scope gets 403 `insufficient_scope` (`mcp-auth.ts:89`; `mcp-http.ts:149`) |
| `UNFOLD_MCP_REQUEST_SCOPES` | Scopes advertised in metadata and challenge; the required scope is added (`mcp-auth.ts:91-93`) |
| `UNFOLD_MCP_MAX_TOKEN_LIFETIME` | Default 10m, at most 24h; a token with a longer `exp - iat` is refused (`mcp-auth.ts:26`, `94-100`, `250`) |
| `UNFOLD_MCP_SUBJECT_NAMESPACE` | Namespace for mapping `sub` to an account (`mcp-auth.ts:101-103`) |

### Token and account rules

- JWT access tokens only, signed with RS, PS or ES; `iss`, `aud` (resource, or client id under `client-id`), `exp`, `iat`, `sub`, `scope` and `azp` or `client_id` are required; 60 s skew (`mcp-auth.ts:217-258`).
- RFC 9728 metadata at `/.well-known/oauth-protected-resource` and the path-inserted form, with CORS `*` (`mcp-auth.ts:107-114`; `mcp-http.ts:244-251`). A 401 carries an RFC 6750 challenge with `resource_metadata` (`mcp-auth.ts:267-275`; `mcp-http.ts:141`).
- The account must already exist: `sub` maps to the id browser sign-in created. Otherwise 403 "Sign in to Unfold in the browser once" (`mcp-http.ts:154-159`).
- Role: `entitle(claims)` must yield admin, operator or viewer, or 403 `not_entitled` (`mcp-http.ts:160-165`). The request acts at the lower of the stored and the entitled role (`mcp-http.ts:166`; `oidc.ts:70-73`). Memberships are narrowed to those held both in the store and in the token (`mcp-http.ts:167`; `tenancy.ts:56-64`).
- A foreign `Origin` header gets 403 (`mcp-http.ts:150-151`). Only POST is accepted; GET and others get 405 (`mcp-http.ts:152`). Bodies are JSON only, at most 1 MiB (`mcp-http.ts:168-170`).
- Tools call Unfold's own API on loopback with a per-request delegated credential that lives 120 s, longer while a stream waits (`mcp-http.ts:51`, `204`, `215`). The caller's token goes no further (`mcp-http.ts:105-114`).
- Audit: every request, refusal and response is logged (`mcp-http.ts:139`, `178`, `216-219`). A stateless 2025 call shows as `mcp:unnamed client` (`docs/how-to/serve-unfold-mcp-over-https.md:129`).

### Protocol revisions and transport

- Legacy `initialize` revisions are `2025-11-25`, `2025-06-18` and `2025-03-26`; the modern `_meta`-per-request revision is `2026-07-28` (`apps/unfold/src/mcp.ts:19-21`).
- Stateless Streamable HTTP: no `Mcp-Session-Id`, JSON responses by default (`mcp-http.ts:105-106`; `docs/how-to/serve-unfold-mcp-over-https.md:113-120`). Under 2026-07-28 the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers must match the body (`mcp-http.ts:184-199`). `server/discover` is modern only, and `ping` is legacy only (`mcp.ts:888-901`).
- A 2025 client's capabilities (MCP Apps, form elicitation, core tasks) are remembered per person, OAuth client and `User-Agent` for 24 h in process memory, at most 10,000 entries (`mcp-http.ts:52-53`, `125-134`, `200-201`, `214`).

### Confirmations for each client type

- **2026-07-28 client that declares form elicitation in `_meta` capabilities:** the first call returns `resultType: input_required` with `elicitation/create` (mode `form`) and an HMAC-sealed `requestState` (10 min, single use, per process, bound to person, tool and arguments). The retry with `inputResponses` acts (`mcp.ts:685-700`, `1010`, `1135-1155`; contract `apps/unfold/docs/contracts/api.md:438`).
- **2025 client over HTTP (such as 2025-11-25):** elicitation *is* possible. All of these must hold:
  1. its `initialize` declared form elicitation and reached this process within 24 h;
  2. the confirming `tools/call` sends `Accept: text/event-stream`;
  3. the token has life left.

  Unfold then answers that call as SSE. It sends `elicitation/create` with id `unfold-<random>` and heartbeats every 15 s, and waits up to 2 min. The client's answer is its own POST, which gets 202 (`mcp-http.ts:54-56`, `72-79`, `175-182`, `202-203`, `212`, `224-238`; `docs/how-to/serve-unfold-mcp-over-https.md:126`).
- **Otherwise** the tool answers with `mcp_confirmation_unsupported`: "This client cannot ask you to confirm, so nothing was changed. Do it in Unfold instead: `<link>`" (`mcp.ts:698`; for `unfold_ask`, `mcp.ts:412`). A lost answer gets `mcp_confirmation_missing` (`mcp.ts:419`, `703`).
- **Stale record:** `docs/adr/adr-0032-unfold-also-serves-its-own-read-only-mcp-tools-next-to-ploeg-mcp.md:77` still says "Over stateless HTTP, a 2025 client cannot be asked, because the server sends no requests of its own there". The code and how-to above supersede it, and no ADR entry records the change.
- A viewer is refused before anything is asked (`mcp.ts:679-683`). Planned text must still match at execution, or `mcp_plan_changed` (`mcp.ts:693-695`).
- Multi-replica: the key, the ledger and the waiting calls live in one process. A second replica or a restart refuses (`mcp.ts:27-35`; `docs/how-to/serve-unfold-mcp-over-https.md:130`).

### Tools (`apps/unfold/src/mcp.ts`)

Annotations: `readOnly: false` gives `readOnlyHint:false, destructiveHint:<destructive>, idempotentHint:false, openWorldHint:true`; otherwise `readOnlyHint:true, idempotentHint:true, openWorldHint:false` (`mcp.ts:902`).

| Tool | Line | Read-only | Confirms | Destructive | Notes |
| --- | --- | --- | --- | --- | --- |
| `unfold_now` | 203 | yes | | | MCP Apps view `ui://unfold/now` |
| `unfold_find_work` | 221 | yes | | | |
| `unfold_get_work` | 235 | yes | | | MCP Apps view `ui://unfold/work-item` |
| `unfold_work_item_revision` | 259 (def. `mcp-apps.ts:76-103`) | yes | | | App-only: listed and callable only for MCP Apps clients (`mcp.ts:902-903`; `mcp-apps.ts:82`) |
| `unfold_sessions` | 261 | yes | | | |
| `unfold_linked_sessions` | 272 | yes | | | |
| `unfold_link_session` | 285 | **no** | **no** | no | Writes without elicitation (link or unlink a session) |
| `unfold_spend` | 299 | yes | | | Team spend totals |
| `unfold_my_usage` | 320 | yes | | | Own usage only |
| `unfold_digest` | 336 | yes | | | Over HTTP the default window is 24 h |
| `unfold_ask` | 377 | no | yes (only with `use_model:true`) | no | Record answers are free; a model answer spends the Team's Ask Allowance |
| `unfold_hand_off` | 450 | no | yes | no | Can return an MCP task (flag `mcp.tasks`) |
| `unfold_approve_work` | 485 | no | yes | no | |
| `unfold_reject_work` | 494 | no | yes | **yes** | |
| `unfold_stop_work` | 504 | no | yes | **yes** | |
| `unfold_retry_work` | 514 | no | yes | no | Spends |
| `unfold_answer_question` | 526 | no | yes | no | Spends; missing from the HTTP how-to's action list (`docs/how-to/serve-unfold-mcp-over-https.md:125`) |
| `unfold_add_note` | 539 | no | yes | no | |
| `unfold_take_over` | 550 | no | yes | no | |
| `unfold_hand_back` | 568 | no | yes | no | Spends |
| `unfold_steer_session` | 582 | no | yes | **yes** | |
| `unfold_message_session` | 614 | no | yes | no | |
| `unfold_permission_requests` | 635 | yes | | | |
| `unfold_answer_permission` | 648 | no | yes | no | |

`workAction` sets `confirms: true` on every Work Item action (`mcp.ts:429-440`).

### Other MCP surface

- Prompts `now`, `handoff` and `takeover`, with completion (`apps/unfold/src/mcp-prompts.ts:19`, `24`, `34`); always on over HTTP (`mcp-http.ts:211`).
- Context resources `unfold://now` and the template `unfold://work-item/{id}`, answered by `unfold_now` and `unfold_get_work` (`apps/unfold/src/mcp-resources.ts:7-34`); always on over HTTP (`mcp-http.ts:211`).
- MCP Apps (`io.modelcontextprotocol/ui`, MIME `text/html;profile=mcp-app`), offered only to a client that declares the extension with that MIME type (`apps/unfold/src/mcp-apps.ts:5-9`, `52-55`). Views (`mcp-apps.ts:14-17`):
  - `ui://unfold/work-item`, tool `unfold_get_work`, visibility `['model','app']`;
  - `ui://unfold/now`, tool `unfold_now`, visibility `['model','app']`;
  - the revision tool with visibility `['app']` only (`mcp-apps.ts:69-73`).

  The CSP blocks every connection, and everything is inline (`mcp-apps.ts:9`, `25-47`). A 2025 HTTP client gets the views only if its `initialize` was seen within 24 h (`docs/how-to/ask-from-an-ai-client.md:137`).
- Instructions string (`mcp.ts:85`).

### Feature flags (`apps/unfold/src/flag-registry.json`; every flag below has `defaultVariant: off`)

- `mcp.tasks` (line 348): a hand-off as an MCP task (Tasks extension 2026-07-28, and core tasks for a 2025-11-25 client). Enforced at `mcp.ts:709-719`, `868`, `890-892`.
- `mcp.events` (line 390): MCP Events (SEP-3415) webhooks for `work_item.needs_you`, `pull_request.ready` and `run.finished`, "such as ChatGPT"; 2026-07-28 clients only (`mcp-http.ts:210`; `apps/unfold/src/mcp-events.ts:17-23`, `107-127`, `231-233`). The subscribe input takes `team`, `tenant` and `client` (`mcp-events.ts:82-89`).
- `mcp.skills` (line 404): SEP-2640 skills `unfold` and `link-work-item` (`apps/unfold/src/mcp-skills.ts:7`, `13`). Description: "Keep it off until one exchange in VS Code 1.147 is captured."
- Not behind any flag: all 23 tools, prompts, context resources and MCP Apps.

## 2. Ploeg's MCP server

- `ploeg-mcp` lives upstream in `ploeg-hq/ploeg` at `cmd/ploeg-mcp` (`docs/adr/adr-0011-unfold-is-reachable-over-mcp-through-a-read-first-server.md:37`). Unfold consumes Ploeg only as an OCI contract bundle unpacked into a git-ignored `apps/ploeg`, plus the Go module (`docs/adr/adr-0039-unfold-depends-on-a-released-ploeg-through-its-contract-bundle-and-go-module.md:33-40`). The pin is `ghcr.io/ploeg-hq/ploeg-contract:0.2.0-rc.134@sha256:d3af…` (`apps/unfold/ploeg-release.json:2`).
- Unfold does not run it. It only names it to editors: `UNFOLD_PLOEG_MCP_URL` and `UNFOLD_PLOEG_MCP_CLIENT_ID`, served at `GET /api/mcp-servers` (`apps/unfold/src/config.ts:317`; `apps/unfold/ops/helm/unfold/README.md:90-95`; `apps/unfold/docs/operations/configuration.md:68`).
- Tools, from the pinned bundle:
  - read-only (`apps/ploeg/cmd/ploeg-mcp/tools.go:47-59`): `ploeg_overview`, `ploeg_find_work`, `ploeg_get_work`, `ploeg_recent_runs`, `ploeg_run_spend`, `ploeg_changes_since`;
  - actions (`apps/ploeg/cmd/ploeg-mcp/actions.go:339-369`): `ploeg_submit_work`, `ploeg_approve_work`, `ploeg_reject_work` (destructive), `ploeg_retry_work`, `ploeg_stop_work` (destructive), `ploeg_add_note`, `ploeg_steer_execution` (destructive).
- Tokens (`apps/ploeg/cmd/ploeg-mcp/main.go:1-15`):
  - stdio reads only, with `PLOEG_MCP_TOKEN`, the bearer of an Operator Consumer "that should not execute";
  - `ploeg-mcp http` is an OAuth resource server (`PLOEG_MCP_ISSUER`, `PLOEG_MCP_RESOURCE`, `PLOEG_MCP_CLIENT_IDS`, `PLOEG_MCP_TOKEN_AUDIENCE` and others, `http.go:58-128`) that maps the caller's groups to Operator Consumers through `PLOEG_MCP_GROUPS` and calls ploegd with that consumer's token;
  - action tools exist only for a group marked `execute`, and act with the person's token exchanged for Ploeg's audience (`PLOEG_MCP_EXCHANGE_*`, Ploeg ADR-0150, proposed; `actions.go:114-135`; `http.go:197`, `308`).
- Confirmation: a form elicitation sealed once (Ploeg ADR-0152, proposed), or, with `PLOEG_MCP_CONFIRMATION_MODE=login`, URL-mode elicitation to a ploeg-mcp page that requires a fresh OIDC login (Ploeg ADR-0153, proposed; `apps/ploeg/docs/adrs/0153-a-person-confirms-a-ploeg-mcp-action-by-signing-in-afresh-at-a-ploeg-mcp-page.md:36-42`). With the mode unset, the server logs a deprecation warning (`pages.go:40`). Ploeg ADR-0108 (accepted) requires a person's confirmation for every MCP action.
- How-to: `docs/how-to/ask-from-an-ai-client.md:13-18`, `139-143`. ploeg-mcp has no MCP Apps, prompts or client notion; not found in the files read.

## 3. Clients (agency customers)

### What the records say (quotes)

- System ADR-0005 (accepted) chose "Agencies, with a client portal". Clients "submit requests and approve Quotes in the portal" (`docs/adr/adr-0005-unfold-is-offered-to-agencies.md:22`, `29`, `32`). "**Portal:** the client portal is part of Unfold" (`:50`). Confirmation is still open: "when one agency, other than webgrip, runs a client request from the portal to a merged pull request" (`:63`).
- System ADR-0007 (accepted): the client approves in the portal and may "talk to the refinement agent in the request thread", and "Unfold never contacts an agency's clients directly" (`docs/adr/adr-0007-clients-approve-ready-work.md:28`, `32`, `38`, `70`).
- System ADR-0009 (accepted): "Clients of an agency are users inside that tenant, not tenants" (`docs/adr/adr-0009-one-tenant-per-agency.md:36`).
- System ADR-0017 (accepted):
  - "A user with a client membership sees, follows and attaches context to … only the Work Items of their Client, and cannot approve, cancel or steer anything else" (`docs/adr/adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md:42`);
  - the groups `unfold/<tenant>/client/<client>` (`:44`);
  - "Proposed tests, none of which exist yet" (`:96`).
- System ADR-0031 (accepted): the Ask "serves the owner now and an agency's Clients later", from a Client-safe brief. "The owner decided that Clients only ask for now; steering … may come later" (`docs/adr/adr-0031-people-ask-about-a-work-item-through-a-metered-read-only-ask-paid-from-a-monthly-allowance.md:22`, `40`, `42`, `90`).
- System ADR-0035 (`status: proposed`): knowledge tools in unfold-mcp, so that "A client user's session reaches only their Client's knowledge"; "Proposed checks, none built yet" (`docs/adr/adr-0035-interactive-sessions-reach-tenant-knowledge-only-through-unfold-mcp.md:2`, `15`, `30`, `45`). None of `unfold_search_knowledge`, `unfold_read_knowledge`, `unfold_write_note` or `unfold_suggest_promotion` exists in `mcp.ts`.
- System ADR-0049 (`status: proposed`): Client Sign-off and an Approver per Client. "Not implemented yet. The first slice records a Sign-off … behind a flag that is off by default, and only Agency people record one, on the Client's behalf, until Client memberships … exist" (`docs/adr/adr-0049-a-client-sign-off-is-input-to-acceptance-bound-to-the-head-commit-and-each-client-has-an-approver.md:2`, `37-43`, `47`).
- System ADR-0051 (accepted): a Work Item with an unknown owner belongs to the `default` Tenant with no Client, and a delegated credential keeps only memberships held twice (`docs/adr/adr-0051-an-unowned-work-item-belongs-to-the-default-tenant-and-delegated-credentials-keep-shared-memberships.md:29`).
- System ADR-0058 (accepted): one Zitadel organisation per Tenant; "A Client's people get a Client role in that same organisation", written into groups as `unfold/<tenant>/client/<client>` (`docs/adr/adr-0058-people-sign-in-through-one-zitadel-broker-with-an-organisation-per-tenant.md:41-43`).
- Unfold ADR 0057 (`status: proposed`): a delivery brief rendered per audience, including the Client's part (`apps/unfold/docs/adrs/0057-a-delivery-brief-is-one-evidence-backed-record-rendered-per-audience.md:2`, `12`, `22`). Unfold ADR 0059 (`status: proposed`): SCIM groups grant client memberships (`apps/unfold/docs/adrs/0059-the-identity-provider-provisions-and-deprovisions-people-through-scim-and-pushed-shared-signals.md:2`, `33`).
- `docs/concepts/who-unfold-is-for.md:13`: "**None of the agency offering is implemented yet.**" (last_verified 2026-09-30, `:5`).
- No ADR mentions "guest". No search turned up an ADR on a client role or on client access to the MCP server.

### What the code does (implemented)

- There is no client role. `UserRole = 'admin' | 'operator' | 'viewer'` (`apps/unfold/src/types.ts:23`). A Client is a membership `{kind:'client', tenant, client}` (`apps/unfold/src/tenancy.ts:8-10`), parsed from the group `unfold/<tenant>/client/<client>` (`tenancy.ts:27-35`).
- Signing in needs a role. Browser sign-in throws `oidc_not_entitled` unless `entitledRole` matches (`apps/unfold/src/oidc.ts:263-264`). `entitledRole` matches only the role claim or literal entries in `auth.oidc.roles.{admin,operator,viewer}`: exact group names, `email:` or `hd:`, at most 20 per role (`oidc.ts:35-51`; `apps/unfold/docs/operations/configuration.md:316-319`). A client membership group alone therefore grants no sign-in. The MCP endpoint uses the same `entitle` and refuses with 403 `not_entitled` (`mcp-http.ts:160-165`; `http.ts:486`).
- Reach is narrowed only under `tenancy.enforce`, which defaults to `false` (`apps/unfold/src/tenant-scope.ts:5-15`; `configuration.md:633`). While it is off, every signed-in person reaches everything (`tenant-scope.ts:33-37`).
  - With it on, a client membership reaches only what a Client-owned source or repository owns (`tenant-scope.ts:17-23`).
  - A Work Item whose target matches no registered repository belongs to the default Tenant with no Client, so it is invisible to client users (`tenant-scope.ts:83-95`).
  - Ploeg Team access is a separate gate (`ploeg.allows`, `apps/unfold/src/ploeg.ts:1371`; `ploeg.userTeams`, `ploeg.ts:1180-1181`).
- Acting:
  - Work Item decisions (approve, reject, cancel) check only `role !== 'viewer'`, plus reach through `detail` (`ploeg.ts:1844-1851`). An operator-role account with only a client membership could therefore approve or stop its own Client's Work Items, which ADR-0017 does not obviously allow; not tested here.
  - Hand-off and import require `actsFor`, a Developer or Admin *Tenant* membership (`http.ts:1023`, `1051`; `tenant-scope.ts:25-28`), so a client member is refused.
  - MCP `mayAct` checks only for viewer (`mcp.ts:679-683`).
- No Client-safe answers over MCP. `unfold_get_work` returns Runs with `findings`, Shifts, spend and Ploeg's own words (`mcp.ts:245-256`). The Client-safe brief exists only on the Ask path, and its `'client'` audience is never passed: `apps/unfold/src/ask/types.ts:3-4`; every caller passes `'internal'` (`http.ts:1304`; `apps/unfold/src/ahp/asks.ts:133`); the record branch returns null for any other audience (`apps/unfold/src/ask/record.ts:230`).
- No client portal: `portal` appears in `apps/unfold/src` and `public` only in the comment at `ask/types.ts:3` and a Freshdesk template field (`intake/templates.ts:109`).
- Client Sign-off (flag `client.sign-off`, off; `flag-registry.json:236`): "Lets an administrator or operator record and withdraw a Client Sign-off on the Client's behalf" (`apps/unfold/src/client-sign-off.ts:10-28`; `http.ts:415`). A Client cannot record one itself.
- MCP Events subscriptions can filter by `client` (`mcp-events.ts:87`, `279`).

### Proposed (research) items for Clients in chat apps

- "Client-safe card for the hosted connector … Proposed: a third ui:// view built only on the Client-safe brief of ADR-0031, shipped with the phase 3 connector listing after tenancy" (`apps/unfold/docs/research/agent-standards/client-ui.md:189`; also `standards.yaml:1764`).
- "Proposed: Client-facing connector … a separate resource limited to the Client-safe brief" (`apps/unfold/docs/research/agent-standards/identity.md:393`).
- `apps/unfold/docs/research/2026-10-13-protocol-integration-gaps.md:73`, `144`: "claude.ai custom connector, ChatGPT plugin | Owner and Clients … Phase 3". Line 73 ("no remote endpoint, no OAuth") is stale since the 2026-10-16 amendment of ADR-0032.

## 4. Existing docs

- How-tos:
  - `docs/how-to/ask-from-an-ai-client.md`: stdio and HTTP tools (`:41-52`), actions (`:54-75`), tasks (`:77-88`), prompts (`:90-100`), MCP Apps card and client table (`:104-137`), Ploeg (`:139-143`), troubleshooting (`:145-154`);
  - `docs/how-to/serve-unfold-mcp-over-https.md`: IdP setup with redirect URIs for Claude Code, VS Code and Cursor only (`:17-43`), env (`:45-72`), connect for Claude Code, VS Code and Cursor (`:74-111`), revisions (`:113-120`), HTTP differences (`:122-131`), tasks (`:133-151`);
  - `docs/how-to/follow-hand-offs-as-tasks-in-a-terminal.md` is referenced from `ask-from-an-ai-client.md:86`.
  - No how-to covers claude.ai, ChatGPT, Open WebUI or LibreChat as a client. `serve-unfold-mcp-over-https.md:72`: "claude.ai and ChatGPT connectors cannot use it while the provider is reachable on the LAN and VPN only."
  - `apps/unfold/docs/how-to` has no MCP or chat how-to.
- Client matrix `docs/research/evidence/2026-09-29-mcp-access/client-matrix.md` (raw agent output, `:3`):
  - Open WebUI is absent from the old official matrix (`:19`);
  - it has "Native MCP since v0.6.31, Streamable HTTP only"; "OAuth 2.1" (DCR) and "OAuth 2.1 (Static)" pre-registered auth; it forwards RFC 8707 `resource`; CIMD is not documented; header templates `{{USER_ID}}`, `{{USER_EMAIL}}`, `{{USER_ROLE}}`, `{{USER_GROUPS}}`, `{{CHAT_ID}}`; "**Admin-only install**"; "OAuth grants are per user. OAuth 2.1 tools cannot be set as model default tools"; "Resources, prompts, elicitation and sampling are not documented as supported" (`:99-104`);
  - summary row: stdio N, SHTTP Y only, SSE N (mcpo), OAuth "Y / N / Y", Elicit n/d, Apps N, admin-only (`:128`);
  - LibreChat: DCR when no client id, header templates, no elicitation or sampling in code, renders `ui://` (`:92-97`, row `:127`);
  - inconsistency: `ecosystem-and-clients.md:171-175`, `230` say Open WebUI documents only static client credentials.
- Newer Open WebUI evidence:
  - "Open WebUI v0.13.0 'MCP Apps in chat' (2026-11-03)" (`apps/unfold/docs/research/agent-standards/client-ui.md:191`; `standards.yaml:1720`), which supersedes the matrix's Apps "N";
  - Open WebUI consumes OpenAPI tool servers, with a proposed doc path "Open WebUI-style clients can call the API directly from the OpenAPI description" (`apps/unfold/docs/research/agent-standards/tool.md:90`, `94`; `standards.yaml:1171`, `1193`).
- The estate uses Open WebUI internally as a LiteLLM chat front-end, not connected to Unfold: `docs/research/2026-10-11-agentic-models-and-topology.md:38`, `96`; `docs/research/2026-10-14-litellm-and-fireworks-update.md:85`.
- Market landscape `apps/unfold/docs/research/market-landscape.md` (348 lines):
  - sections `## 1` to `## 12`; the last is "## 12. Research limitations and next refresh" (`:344`);
  - the shortlist table under `## 4` (`:56`) has the columns Product | Source and deployment boundary | Ticket and coordination surface | Remote execution / IDE | Why it matters to Ploeg + Unfold (`:60`), with 15 rows (`:62-76`), the last T3 Code (`:76`);
  - numbered subsections 4.1 to **4.13**; the last is "### 4.13 T3 Code: the free cockpit, added 3 November 2026" (`:190`), and the format puts "added `<date>`" in the heading;
  - no chat front-end appears in it.
- "Cockpit" as a term means the developer's agent session front end, not something Unfold builds:
  - `market-landscape.md:76`, `188` ("VS Code as the multi-harness cockpit"), `190`, `196` ("do not compete at the cockpit");
  - `docs/research/2026-11-02-t3code-fit.md:11`, `161`, `169`;
  - `docs/research/2026-10-01-vscode-surface-and-agency-fit.md:31` ("Use VS Code as the developer's cockpit, not as an engine. It is also only one of two cockpits.");
  - `apps/unfold/docs/research/2026-10-29-vscode-1-144-fit.md:193`;
  - UI meaning: the live-view layout "Direction F, the cockpit" (`apps/unfold/public/live/layouts.js:40-52`; `apps/unfold/docs/workbench.md:69`; `apps/unfold/docs/adrs/0053-a-work-item-and-the-session-that-started-it-are-one-page.md:12`; `apps/CHANGELOG.md:335`).

## 5. Unfold's own chat surfaces

- **Ask** (system ADR-0031, accepted; built): one question about one Work Item. The record answers what it can for free; otherwise one metered model call from the Team's Ask Allowance. No tools, read-only, Client-safe brief (`docs/adr/adr-0031-…:38-42`).
  - Code: `apps/unfold/src/ask/service.ts:146`; HTTP `POST /api/ploeg/work-items/:id/asks` (`http.ts:1304`); MCP `unfold_ask` (`mcp.ts:377-422`).
- **Unfold chat in the VS Code Agents window** (Unfold ADR 0049, `status: proposed`, built): a second AHP agent `unfold-chat` ("Unfold") (`apps/unfold/docs/adrs/0049-the-agents-window-has-an-unfold-chat-that-reads-and-acts-on-confirm.md:2`, `37-43`).
  - Each message is one Ploeg chat admission with a capped key (`POST /api/v1/operator/teams/{team}/chats`). The record names it "Ploeg ADR-0115, unreleased" (`:39`, `50`, `72`). The pinned bundle serves these routes (`apps/ploeg/pkg/httpapi/operator_chat.go:31-33`) under Ploeg ADR-0128, `status: proposed` (`apps/ploeg/docs/adrs/0128-a-chat-message-is-a-read-only-run-about-no-work-item-paid-from-a-teams-chat-allowance.md:2`). The ADR's number is out of date.
  - Engine: `apps/unfold/src/chat/service.ts`.
    - OpenAI-style `POST <litellm>/chat/completions` with the Ploeg-minted key (`:223-251`); at most 8 tool rounds (`:65`); `unfold_ask` excluded (`:63`); the demo gives a fixed reply (`:67`, `141`); system prompt (`:71-77`).
    - Read tools run at once. Confirming tools plan, then show the planned message, then perform (`:200-221`).
  - Tools: the same `createMcpServer` in process, over 2026-07-28 with a simulated form-elicitation capability. The person's in-chat Allow becomes `inputResponses.confirm_action` (`apps/unfold/src/chat/tools.ts:19-61`).
  - Wiring: only into the AHP agent host (`http.ts:366-367`; `apps/unfold/src/ahp/chats.ts:6`, `61`; `apps/unfold/src/ahp/host.ts:404`). The browser UI and HTTP have no chat endpoint. Contract: `apps/unfold/docs/contracts/api.md:708` ("Chatting with Unfold").
- **Side chat on a Work Item** (Unfold ADR 0012 update of 2026-11-19; built in #187): VS Code 1.147 only, offered only to clients that declare `vscode.ahpChatUris`. It is Ask-only, with the Ask's cost confirmation, per person, and reaches neither the Team nor Ploeg commands (`apps/unfold/docs/adrs/0012-agent-host-protocol-host.md:240-244`; `apps/unfold/src/ahp/side-chats.ts:9-13`, `33-45`, `81`; `apps/unfold/changes/ask-about-a-work-item-in-a-side-chat.md:4-6`).
- **Overlap with a third-party chat front-end:**
  - The ADR 0049 chat is functionally "an LLM chat with Unfold's MCP tools and confirm-before-act", the same thing Open WebUI or LibreChat plus `unfold-mcp` would give.
  - Differences: Unfold's chat is paid from a Ploeg-admitted Team chat allowance and is visible only in VS Code over AHP. An external front-end uses its own model and key, outside Ploeg's metering, and needs elicitation for actions. ADR 0049 rejected "Only `unfold-mcp` in another chat" because "it needs another product's chat and model, outside Ploeg's allowance" (`apps/unfold/docs/adrs/0049-…:64-68`).

## 6. Mentions of the named front-ends (case-insensitive search of the whole repository)

- Open WebUI:
  - `docs/research/evidence/2026-09-29-mcp-access/client-matrix.md:19`, `99`, `128`;
  - `docs/research/evidence/2026-09-29-mcp-access/ecosystem-and-clients.md:171`, `175`, `230`, `249`;
  - `apps/unfold/docs/research/agent-standards/client-ui.md:191`;
  - `apps/unfold/docs/research/agent-standards/standards.yaml:1171`, `1193`, `1720`, `4833`, `4900`;
  - `apps/unfold/docs/research/agent-standards/tool.md:90`, `94`;
  - `docs/research/2026-10-11-agentic-models-and-topology.md:38`, `96`;
  - `docs/research/2026-10-14-litellm-and-fireworks-update.md:13`, `85`.
- LibreChat:
  - `docs/research/evidence/2026-09-29-mcp-access/client-matrix.md:16`, `92`, `95`, `127`;
  - `docs/research/evidence/2026-09-29-mcp-access/ecosystem-and-clients.md:164-169`;
  - `apps/unfold/docs/research/2026-10-30-mcp-extensions-fit.md:9`.
- LobeChat or LobeHub: no hit.
- AnythingLLM: no hit.

## Not verified

- No third-party front-end (Open WebUI, LibreChat, claude.ai, ChatGPT) was run against Unfold's endpoint. These are inferred from code, not observed:
  - whether a server-side front-end sends an `Origin` header that trips `mcp-http.ts:150-151`;
  - whether its IdP tokens exceed the 10-minute lifetime cap;
  - whether it sends `Accept: text/event-stream` and declares form elicitation.
- Not traced: whether `unfold_spend`, `unfold_digest` and `/api/ploeg/summary` filter Team spend totals by Client under `tenancy.enforce`.
- Ploeg facts come from the bundle unpacked in the stale main checkout. Its `ploeg-contract.json` names `0.2.0-rc.134`, the same as the worktree's pin, but the digest was not re-checked.
