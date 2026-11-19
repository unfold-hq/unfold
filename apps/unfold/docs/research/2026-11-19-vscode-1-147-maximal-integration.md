# VS Code 1.147 against Unfold, maximal integration: most of the gain needs no new capability

Research date: 2026-11-19. The [1.147 dossier](2026-11-18-vscode-1-147-fit.md) of the day before asked what VS Code 1.145 to 1.147 change for Unfold and kept most new surfaces on Watch. On 2026-11-19 the owner decided that Unfold integrates with VS Code 1.147 as far as it can. This dossier asks the follow-up question for every surface: what can Unfold use today, what does it have to build, what stays closed, and who has to open it.

Sources:

- `microsoft/vscode` at tags 1.144.0 to 1.147.0, with 1.147.0 (`8a14f0cc`) as the reference; `src/vscode-dts` and `src/vs/workbench/api/common` diffed from 1.144.0 to 1.147.0;
- the release notes of [1.145](https://code.visualstudio.com/updates/v1_145), [1.146](https://code.visualstudio.com/updates/v1_146) and [1.147](https://code.visualstudio.com/updates/v1_147), fetched on 2026-11-19, and the closed `feature-request` issues of the 1.145.0 to 1.147.0 milestones;
- the [AHP repository](https://github.com/microsoft/agent-host-protocol) on `main` at 1.2.0 (unreleased), with its changelog and open pull requests, and the [Agent Plugins specification](https://github.com/agentplugins/agent-plugins-spec);
- this repository at `origin/development` `69f61645`.

**Citations.** A VS Code path is relative to `src/vs/` at tag 1.147.0, browsable at <https://github.com/microsoft/vscode/tree/1.147.0/src/vs>, unless it starts with `src/` or `extensions/`, which are relative to the repository root. An Unfold path is a link into this repository at `69f61645`.

**Method.** Five research agents ran in parallel, each on one cut: the nineteen candidates the 1.147 dossier left open, the stable extension API, every AHP feature against the host and the client, MCP and the Agent Plugin, and a sweep of the three releases' notes and milestones for anything the 1.147 dossier did not map. Each read source at the tags and wrote down the gate it found, as a file and line. Evidence read in code is marked **(source)**; the rest rests on release notes, pull request descriptions or the AHP changelog. Nothing was run against a VS Code client or Unfold's host, and nothing was filed upstream.

**Landing.** This dossier, an [ADR 0012](../adrs/0012-agent-host-protocol-host.md) update, a dated sentence on the AHP paragraph of the [protocol ledger](2026-09-11-ecosystem-alternatives.md#appendix-adjacent-components-and-communication-protocols) and the [watchlist](2026-10-13-protocol-integration-gaps.md#watchlist) (eight rows updated, T53 to T60 added).

## Verdict

1. **VS Code 1.147 already reads more from a third-party host than Unfold sends.** **(source)** The pull request pill, the Artifacts pill, the Inbox's Ready to merge and Failing CI states, and the Fix Checks banner all come from session `_meta` keys that the shared agent-host provider reads from any host. Unfold publishes its pull request under its own key, `_meta.git.pullRequest`, which the client ignores. Publishing the same facts under VS Code's keys is the largest gain in this round and is small.
2. **The changeset channel can do more than Unfold uses.** **(source)** A native confirmation before Accept and open pull request, a running spinner and a disabled state with its reason, reviewed-file marks that survive a reconnect, model and cache tokens per turn, number and multi-select questions, and a hint that the history is longer than the snapshot are all in the client and cost the host a few lines each.
3. **Confirmations do not work in VS Code over HTTPS.** **(source)** VS Code's MCP client speaks only 2025-11-25. Over HTTPS, `unfold-mcp` takes stateless POST and never keeps a back channel, so `unfold_ask` and every action tool refuse with `mcp_confirmation_unsupported` in VS Code, including the buttons on the MCP App card. This is the most valuable medium-sized fix.
4. **The Agent Plugin delivers only its skills to VS Code.** **(source)** VS Code reads the plugin as strict Agent Plugins v1: `skills/` and `mcp.json`. Commands, agents, rules and hooks reach VS Code only from `com.github.copilot/` folders, and the extension can ship the plugin, skills and instructions itself through stable contribution points.
5. **Five client gates stay closed to remote hosts.** **(source)** Send Later is switched off for remote providers in code, a rejected connection token cannot reach the 1.147 "Authentication failed" state over WebSocket, an automation with a host-defined trigger cannot be enabled or disabled or created, and canvases need the agent id `copilotcli`. Each has an upstream issue draft below for the owner to file.
6. **Four of the 1.147 dossier's statements were wrong or are out of date.** Inline session-list actions are gone in 1.147, Skills over MCP is on by default, setting a session's automation `origin` hides it from the main list, and the "Authentication failed" state never fires for a WebSocket host. The [corrections](#corrections-to-the-2026-11-18-record) list all eight.
7. **What stays out is what would spend or execute outside Ploeg.** Sampling, a language model chat provider, model comparison, scheduled automations created in VS Code and browsing through the host stay refused, for the same reasons the earlier records gave ([ADR-0002](../../../../docs/adr/adr-0002-ploeg-is-the-only-engine.md), [ADR 0023](../adrs/0023-unfold-submits-work-to-ploeg-and-never-executes-it.md)).

## The owner's decision

On 2026-11-19 the owner decided:

- Unfold integrates maximally with VS Code 1.147: every surface a third-party host, extension, MCP server or plugin can reach is built, unless it spends or executes outside Ploeg.
- From VS Code, anyone who may see a Team route may pause it. Only the route's manager may delete or clean one up, and only after a confirmation. Pausing is blocked in VS Code today (U3), and both need a Ploeg route write contract (S06).
- `tcpConnections` was allowed only as a spike limited to a Work Item's preview URL. It is dropped: neither Unfold nor Ploeg has a preview concept, and a TCP relay into the network Unfold runs on is a high SSRF risk.
- Upstream VS Code issues are drafted by the agent and filed by the owner. The drafts are [below](#upstream-issue-drafts-not-filed); none is filed.

## Corrections to the 2026-11-18 record

| The 1.147 dossier said | What the source says | Evidence |
| --- | --- | --- |
| Inline actions in the session list (1.146) are Watch; whether a third-party host's rows get them is not verified | They were removed in 1.147. `workbench/contrib/sessions/browser/views/sessionInlineActions.ts` and the setting `sessions.list.inlineActions` exist at 1.146.0 and are absent at 1.147.0. Fix Checks and Address Comments now sit in the input banner and depend on pull request references on the session | `workbench/contrib/sessions/browser/sessionInputBanners/sessionInputBannerModel.ts:387-420` **(source)** |
| A rejected credential at connect ends the connection with "Authentication failed. Reconnect to sign in again." and no retry | Only for the cloud sandbox host. The state comes only from `InitialAuthenticationError`, which needs `initialAuthenticationKey`, and only `cloudSandboxAgentHostService.ts` supplies it. A refused WebSocket upgrade is retried as a transport failure | `platform/agentHost/browser/remoteAgentHostServiceImpl.ts:875-878`, `platform/agentHost/browser/agentHostProtocolClient.ts:1581-1602`, `workbench/contrib/chat/browser/remoteAgentHost/cloudSandboxAgentHostService.ts:351`, `platform/agentHost/browser/webSocketClientTransport.ts:101-103` **(source)** |
| Skills over MCP is a preview behind `chat.agentHost.mcpSkills.enabled` | The setting defaults to `true` in 1.147 (it was `false` in 1.146), and it covers only VS Code's own Copilot agent-host sessions | `platform/agentHost/common/agentHostStarter.config.contribution.ts:304-308` **(source)** |
| The runs filter hides only a session whose own `origin` is an automation run, which Unfold never sets | That is right today, but setting `origin` would hide the session from the main Sessions list by default: `sessions.list.showAutomationSessions` defaults to `afterReply` | `workbench/contrib/sessions/browser/sessionsListModelService.ts:532-543`, `sessionsConfiguration.ts:84` **(source)** |
| Not covered | VS Code reads a session's pull request from `_meta['agentHost/sessionArtifacts']`, `_meta.githubData` or `_meta['copilot.githubReferences']`, and ignores Unfold's `_meta.git.pullRequest` | `platform/agentHost/common/sessionArtifacts.ts:75`, `workbench/contrib/sessions/providers/agentHost/browser/baseAgentHostSessionsProvider.ts:717-746`, `platform/agentHost/common/meta/copilotd/sessionGitHubReferences.ts:46`; [review.ts:384](../../src/ahp/review.ts#L384) **(source)** |
| Not covered | VS Code's MCP client speaks 2025-11-25 only, so over HTTPS `unfold_ask` and every action tool refuse with `mcp_confirmation_unsupported` | `platform/mcp/common/modelContextProtocol.ts:43`; [mcp-http.ts:128](../../src/mcp-http.ts#L128), [mcp-http.ts:175](../../src/mcp-http.ts#L175), [mcp.ts:403](../../src/mcp.ts#L403) **(source)** |
| An organisation can require the plugin with `enabledPlugins`, which keeps its skills, hooks and MCP servers installed | In VS Code the plugin delivers only `skills/` and `mcp.json`. Commands, agents, rules and hooks need `com.github.copilot/` folders. The specification lives at <https://github.com/agentplugins/agent-plugins-spec>; `microsoft/agent-plugins` returns 404 | `workbench/contrib/chat/common/plugins/AGENTS_PLUGINS.md:94-103`, `platform/agentPlugins/common/pluginParsers.ts:230-245` **(source)** |
| Not covered | Since 1.145 the Agents window opens without a GitHub sign-in when any provider is usable signed out, on desktop. With only Unfold connected, `protectedResources: []` and one model resolve to no sign-in. The web entry still forces GitHub | `workbench/services/sessions/browser/sessionsAuthGate.ts:46-58`, `baseAgentHostSessionsProvider.ts:824` **(source)**; [#345254](https://github.com/microsoft/vscode/issues/345254) |

Six of the 1.147 dossier's twelve recommendations have landed since: the annotations channel (2, [#122](https://github.com/unfold-hq/unfold/pull/122)), the test that pins what the three releases send unasked (3, [#128](https://github.com/unfold-hq/unfold/pull/128)), expiring provisional sessions (4, [#134](https://github.com/unfold-hq/unfold/pull/134)), the notice for an attachment that did not reach the Team (5, [#132](https://github.com/unfold-hq/unfold/pull/132)), the page on what an organisation's policies do (10, [#133](https://github.com/unfold-hq/unfold/pull/133)) and the Marketplace token date (12, [#121](https://github.com/unfold-hq/unfold/pull/121)). Its verdict 2, that the first review comment can lose its channel, no longer holds.

## Host and AHP

The client offers AHP `1.0.0, 0.9.0` (`platform/agentHost/common/agentHostProtocolCompatibility.ts:36-38`), and `1.2.0` only with the multi-harness setting on, so Unfold negotiates 1.0.0 ([versions.ts:2](../../src/ahp/versions.ts#L2)) while the client still reads 1.1 fields.

| Item | Fit | Gate or evidence | Size | Plan |
| --- | --- | --- | --- | --- |
| Pull request and issue as session artifacts and GitHub data | **Build** | Key `agentHost/sessionArtifacts` (`platform/agentHost/common/sessionArtifacts.ts:75`, shape `:45-67`); PR pill and GitHub info (`baseAgentHostSessionsProvider.ts:717-746`, `workbench/contrib/sessions/providers/agentHost/browser/agentHostSessionArtifacts.ts:102-125`); passing CI puts the session in Ready to merge (`workbench/contrib/sessions/browser/sessionAttentionService.ts:222`, `:330-377`). Unfold sends its own key only ([work-items.ts:147](../../src/ahp/work-items.ts#L147)). Never advertise the Inbox merge operation (`workbench/contrib/sessions/common/sessionInbox.ts:109`): merging stays with the person. CI polling uses the person's own GitHub sign-in (`sessionAttentionService.ts:290-300`) | S to M | M01 |
| Website and resource artifacts, a file pinned above the input | **Build**, after M01 | Same key; `mode: 'aboveInput'` needs `chat.resources.enabled`, off by default (`workbench/contrib/chat/browser/chatResources/chatResources.ts:11-20`); [#345427](https://github.com/microsoft/vscode/issues/345427) | M | M01 follow-up |
| Fix Checks and Address Comments in the input banner | **Build**, through M01 | They replaced the removed inline actions and need pull request references on the session (`sessionInputBannerModel.ts:387-420`). Their prompt arrives as an ordinary message, so the host maps it to Retry or steer | in M01 | M01 |
| Inbox acknowledgement | **Build** | Activity is `status:updatedAt:lastTurnEnd` (`sessionInbox.ts:38`); an acknowledged session returns when it changes or a new notification id appears (`:50-53`); the needs-input id is the pending confirmation's key, else `updatedAt` (`sessionAttentionService.ts:277-282`, `:399-424`). Unfold's `modifiedAt` is Ploeg's `updatedAt` ([work-items.ts:155](../../src/ahp/work-items.ts#L155)); input requests already exist ([work-item-commands.ts:173](../../src/ahp/work-item-commands.ts#L173), [host.ts:1041](../../src/ahp/host.ts#L1041)) | S | M02 |
| Needs-input marker on a stale Work Item | **Build**, if stale needs a person | The client maps status bits 24 to NeedsInput (`workbench/contrib/sessions/providers/agentHost/browser/agentHostDiffs.ts:22-23`). Unfold sets them for `proposed`, `needs_human` and `awaiting_review` ([work-items.ts:113](../../src/ahp/work-items.ts#L113)) and maps `stale` to `error` ([work-items.ts:120](../../src/ahp/work-items.ts#L120)) | S | M02 |
| Host-sent `ping` | **Build** | The client answers with `result: null` (`agentHostProtocolClient.ts:3483-3485`). Unfold answers the client's ping ([host.ts:1528](../../src/ahp/host.ts#L1528)) and sends none; [websocket.ts](../../src/ahp/websocket.ts) has no heartbeat | S | M03 |
| `ChangesetOperation.confirmation` on Accept and open pull request | **Build** | `workbench/contrib/sessions/providers/agentHost/browser/agentHostSessionChangesets.ts:328-330`; absent in [review.ts:52](../../src/ahp/review.ts#L52) | S | M04 |
| Operation status `running`, `disabled`, `error` and `changeset/operationStatusChanged` | **Build** | `agentHostSessionChangesets.ts:309-317`, `:505`; always `idle` in [review.ts:52](../../src/ahp/review.ts#L52) | S | M04 |
| `chat/usage` with `model` and cache tokens | **Build** | `stateToProgressAdapter.ts:1040-1062`, `:1348`, `:1394`. Unfold sends input and output tokens only ([host.ts:1160](../../src/ahp/host.ts#L1160)), and none on Work Item sessions | S | M05 |
| URL attachments and skill references | **Build** | Simple attachments carry `modelRepresentation` (`platform/agentHost/common/state/protocol/channels-chat/state.ts:942-955`). [attachments.ts:37](../../src/ahp/attachments.ts#L37) reports only embedded and non-skill resources, so a URL and a `displayKind: 'skill'` reference are dropped without a word. Passing skill content would need a Ploeg context-file contract (L) | S | M06 |
| `changeset/filesReviewChanged` stored per person | **Build** | `agentHostSessionChangesets.ts:619`; echoed only ([host.ts:2556](../../src/ahp/host.ts#L2556)) | S | M07 |
| `turnsNextCursor` on a snapshot cut at 200 turns | **Build** | VS Code 1.147 never calls `fetchTurns` but reads the cursor as "has more" (`agentHostSessionHandler.ts:2998`, `:6688`); [host.ts:50](../../src/ahp/host.ts#L50), [host.ts:1569](../../src/ahp/host.ts#L1569) | S | M07 |
| Number, integer and multi-select questions | **Build** | `stateToProgressAdapter.ts:246-256`; Unfold offers text and single-select ([host.ts:188](../../src/ahp/host.ts#L188), [questions.ts](../../src/ahp/questions.ts)) | S | M08 |
| Mermaid diagrams in replies | **Build** | `extensions/mermaid-markdown-features/package.json` declares `chatOutputRenderers` for `mermaid`; `chatMarkdownContentPart.ts:293-296` has no provider gate. Covers part of the 1.147 dossier's native-visuals spike without its two settings | S | M09 |
| `root/progress` on the `createSession` progress token | **Build** | `agentHostProtocolClient.ts:2268`, `:3370`, `agentHostDownloadProgress.ts:35-83`; Unfold ignores the token ([host.ts:1601](../../src/ahp/host.ts#L1601)) and reports preparation as notification text ([host.ts:1078](../../src/ahp/host.ts#L1078)) | M | M20 |
| Streaming tool input (`chat/toolCallDelta`) | **Build** | `stateToProgressAdapter.ts:113`, `partialToolInput.ts:14`; listed in [versions.ts](../../src/ahp/versions.ts) but never sent | M | M21 |
| Ask in a side chat (`vscode.sideChatWithoutContext`) | **Build** | The client refuses without the flag (`platform/agentHost/browser/agentHostProtocolClient.ts:2980-2981`); Unfold allows one chat per session ([host.ts:1662](../../src/ahp/host.ts#L1662)). A second, read-only Ask chat with the Ask's cost confirmation | M | M25 |
| `SessionSummary.origin` for route-started sessions | **Decide** | The client accepts `{kind:'automation', automation, run}` (`baseAgentHostSessionsProvider.ts:455`) and then hides the session from the main list by default (`sessionsListModelService.ts:532-543`, `sessionsConfiguration.ts:84`). Unfold publishes `runs: []` ([automations.ts:148](../../src/ahp/automations.ts#L148)). Needs Ploeg to say which route created a Work Item | M | S02 |
| VS Code's native pull request dialog (`create-pr`, `prepare-pull-request`) | **Decide** | `agentHostPullRequestCreation.ts:18-64`, `agentPullRequestOperationMeta.ts:12-45`, a VS Code `_meta` convention outside the spec; Unfold's operation is `accept-and-open-pull-request` ([review.ts:12](../../src/ahp/review.ts#L12)). Who writes the title and body, VS Code or Ploeg's publisher | M | S03 |
| Host log lines over OTLP | **Decide** | `InitializeResult.telemetry` and `otlp/export*` (`agentHostProtocolClient.ts:455`, `:3386`), forwarded by `remoteAgentHostLogForwarder.ts:88`; Unfold refuses debug logs ([host.ts:1590](../../src/ahp/host.ts#L1590)). Scoped to the person's own sessions | M | S04 |
| Web and phone Agents window | **Spike** | New phone entry `sessions/agents.web.mobile.main.ts:26`, `:313`, absent in 1.145 and 1.146; web forces GitHub sign-in (`sessionsAuthGate.ts`, `isWeb`). A browser WebSocket cannot send a bearer header, so it needs the `tkn` query ([upgrade-auth.ts](../../src/ahp/upgrade-auth.ts)) and an Origin allow-list | M | S05 |
| Delete a route, run a route now | **After a Ploeg contract** | Delete needs `Remove` in the entry's operations (`agentHostAutomationStore.ts:210-212`) and sends `automation/removed` (`:354-359`); Run now reaches the host (`sessions/contrib/automations/browser/providerAutomationService.ts:199`) and is refused ([automations.ts:80](../../src/ahp/automations.ts#L80)). [ploeg.ts](../../src/ploeg.ts) has no route write path | M | S06 |
| Pause a route | **Upstream** | A non-schedule trigger projects as `interval:'custom'` (`agentHostAutomationStore.ts:1411`), which makes the entry read-only (`:613-614`); `canUpdateAutomation` is false unless `purpose==='scheduledChat'` (`:207`) and `updateAutomation` throws (`:283-284`) | M, after S06 | U3 |
| Automation creation with end dates | **Upstream**, low | Creation needs `automations.create` (`:113-114`) and always writes a schedule trigger (`:953-955`); Unfold advertises no `create` ([automations.ts](../../src/ahp/automations.ts)). A scheduled automation would be a new work type Ploeg has not authorized | none now | U4 |
| Send Later (one-time automations) | **Upstream** | `remoteAgentHostSessionsProvider.ts:429` sets `supportsOneTimeAutomation: false`, checked again in `agentHostAutomationStore.ts:115-116`, `automationTools.ts:986-987` and `scheduledChatsService.ts:275`; VS Code's own host advertises `oneTime` only in its main process (`platform/agentHost/node/agentService.ts:1376`). AHP [#603](https://github.com/microsoft/agent-host-protocol/pull/603) and [#604](https://github.com/microsoft/agent-host-protocol/pull/604) are merged and unreleased | L, after upstream and a Ploeg contract | U1, T51 |
| "Authentication failed" for a rejected token | **Upstream** | See the corrections. Today the extension's own sign-in expiry handling stays | none now | U2 |
| Canvases | **Upstream**, low | `remoteAgentHostSessionsProvider.ts:908-909` requires the agent id `copilotcli` and a non-web platform | none now | U5 |
| `tcpConnections`, browsing and remote HTML files | **Skip** | `platform/agentHost/common/agentHostTcpSupport.ts:35`; browsing needs `workbench.browser.enableRemoteProxy`, off in Stable (`workbench/contrib/browserView/electron-browser/features/browserRemoteFeatures.ts:133`); the TCP channel needs windowed delivery (`platform/agentHost/common/state/protocol/channels-tcp/commands.ts:12-16`). No preview concept in Unfold or Ploeg; high SSRF risk | L | Skipped |
| Windowed delivery (`flowControl`) | **Watch** | Offered on subscribe (`agentHostProtocolClient.ts:2114`), a plain snapshot accepted (`:2121-2127`). Only the TCP channel needs it | M | T16 |
| Managed worktrees and their clean-up | **Skip** | Host-local Git paths (`platform/agentHost/common/agentHostWorktreeCleanup.ts:16-31`); Work Item workspaces live in Ploeg's sandboxes | none | Skipped |
| Model comparison against a Team | **Skip** | Needs `supportsPermissionsForCreation` and `getModelsSnapshotForCreation` (`sessions/contrib/sessionComparison/browser/modelEvaluationTools.ts:290-293`, `:300`); each comparison is 2 to 10 budgeted Shifts | none | Skipped |
| Mixed harnesses beyond the existing spike | **Skip** | `chat.agentHost.multipleChatProviders.enabled` defaults to false (`agentHostStarter.config.contribution.ts:228-229`); the 1.147 dossier's recommendation 9 covers it | none | Skipped |
| Forking a chat (`multipleChats`) | **Skip** | `agentHostSessionHandler.ts:2129`, `:2135`, `baseAgentHostSessionsProvider.ts:1915-1926`; conflicts with one chat per session ([host.ts:1662](../../src/ahp/host.ts#L1662)) | L | Skipped |
| Per-file operation `target` | Existing spike | `agentHostEditReview.ts:875`; refused ([host.ts:897](../../src/ahp/host.ts#L897)) | M | T23 |
| `ChangesetFile.status` Editing and nonces | Watch | `agentHostEditReview.ts:1089`; meaningful only for a live changeset during a Run | M | T23 |
| AHP 1.2.0 automation targets, draft sessions, open proposals | Watch | Targets ([#604](https://github.com/microsoft/agent-host-protocol/pull/604)) are not in 1.147's protocol copy; draft sessions ([#612](https://github.com/microsoft/agent-host-protocol/pull/612)) have no hit in 1.147; session artifacts [#508](https://github.com/microsoft/agent-host-protocol/pull/508), canvas registry #528, model sources #543, replay cursors #494, tool timing #465, repository preparation #451, tunnels #417, waiting runs #608 and account label #607 are open | none now | T52 |
| Low gain, not planned | Low | Reasoning timing (`stateToProgressAdapter.ts:1421`, `:1874`; [run-live.ts:199](../../src/ahp/run-live.ts#L199)), `contentRef` parts (`:1434`), `ToolCallResult.resultMetadata` (`:2213`), resources in tool results (`:2173`), richer `SessionModelInfo` (`agentHostLanguageModelProvider.ts:192`, `:213`), `workingDirectories`, `session/metaChanged`, `creationError`, `root/agentsChanged`, a root config schema, incremental changeset actions, `createResourceWatch`, and replay on `reconnect` (`agentHostProtocolClient.ts:1352`), which the 1.147 dossier's recommendation 1 already weighs | S each; replay M | none |
| No gain or refused by design | None | `terminalCommandPrefix` (no shell, `chatInputPart.ts:3174`); `ClientCapabilities.mcpApps`, which 1.147 never declares (`agentHostProtocolClient.ts:963-972`); `root/terminalsChanged` and `serverTools`, with no consumer; `chat/toolCallResultConfirmed` (Ploeg owns it); `chat/toolCallAuthRequired` (the gateway owns credentials); URL elicitation in AHP, with no consumer; `chatMutable` and `chat/configChanged`; `chat/truncated` (history is evidence); resource writes and host-to-client resource requests; background work, which VS Code renders only for the shell kind (`agentHostSessionHandler.ts:785`); `moveChat`; the context window gauge, which needs a copilotd-private key (`copilotdMetadataReader.ts:128`) | none | none |
| Already implemented | Done | `initialize` with `pathStyle`, `defaultDirectory` and completions; agents; session list and summaries; status, read and archive bits; titles; activity; lifecycle; active clients; input needed; session config; read-only customizations; the chat lifecycle with markdown, notification, input-request and error parts; tool calls; elicitation; pending and queued messages; drafts; Try Again; one-chat `createChat`; changesets; annotations; read-only terminals and notice-only client terminals; `resourceRead`, `resourceList` and `resourceResolve`; snapshot `reconnect`; error codes. Evidence per row in the AHP agent's table, [host.ts](../../src/ahp/host.ts) | none | none |
| Desktop-pass checks | Check | Agent-host terminals titled like local ones ([#346374](https://github.com/microsoft/vscode/issues/346374); Unfold's [terminals.ts](../../src/ahp/terminals.ts) sets titles); Run subagent calls in Conversation mode and a Work Item chat in its own window ([1.145 verbosity](https://code.visualstudio.com/updates/v1_145#_choose-agent-verbosity-experimental), [1.146 chat windows](https://code.visualstudio.com/updates/v1_146#_chat-windows-preview)) | S | desktop pass |

## Extension API

`vscode.d.ts` changed only in 1.145, for the Timeline API; 1.146 and 1.147 have no extension-authoring section. The extension keeps `engines.vscode: ^1.99.0` ([package.json:25](../../extensions/vscode/package.json#L25)), so anything newer needs the run-time detection [lm-tools.ts:34](../../extensions/vscode/src/lm-tools.ts#L34) and [mcp-servers.ts:50](../../extensions/vscode/src/mcp-servers.ts#L50) already use. Proposed APIs cannot ship on the Marketplace or Open VSX.

| Item | Fit | Gate or evidence | Size | Plan |
| --- | --- | --- | --- | --- |
| `isSessionsWindow` context key | **Build** | Stable, `workbench/common/contextkeys.ts:37`. The extension recognises the window by its workspace file name ([agent-host.ts:440](../../extensions/vscode/src/agent-host.ts#L440)); `when` clauses can hide commands that need views, the status bar or a checkout | S | M10 |
| README and CHANGELOG for the extension info page | **Build** | The page shows only while extension management is on, which is off in Stable (`sessions/contrib/extensions/browser/extensions.contribution.ts:35`, the AI Features group `:43`). The README says 1.99 and "workbench"; the changelog's Unreleased section is long | S | M10 |
| `chatSkills` and `chatInstructions` | **Build** | Stable as contributions, no proposal gate in `chatPromptFilesContribution.ts`; the run-time provider is proposed (`workbench/api/common/extHost.api.impl.ts:1817`). Ships [operate-agent-session/SKILL.md](../../skills/operate-agent-session/SKILL.md) with the extension | S | M11 |
| `chatPlugins` | **Build** | Stable since 1.144, `workbench/contrib/chat/common/plugins/agentPluginServiceImpl.ts:1031-1120`; older editors ignore it. May duplicate a plugin installed from the marketplace (`AGENTS_PLUGINS.md:241`) | S to M | M11 |
| Language model action tools with `confirmationMessages`, `when` and `icon` | **Build** | Unchanged from 1.144 to 1.147 (`languageModelToolsContribution.ts`). Today three read-only tools ([extension.ts:242](../../extensions/vscode/src/extension.ts#L242), [package.json:454](../../extensions/vscode/package.json#L454)) set none of the three. Approve, reject, retry and hand back, gated on `unfold.connected` | M | M16 |
| Timeline provider | **Build** | Finalized in 1.145 (`src/vscode-dts/vscode.d.ts:14774`). Ploeg gives changed-file counts and merge and head SHAs, not per-file lists ([ploeg.ts:162](../../src/ploeg.ts#L162)), so the provider matches local `git log` to Ploeg's merge SHAs. Detected at run time so `^1.99` stays. Not drawn in the Agents window | M | M23 |
| Authentication provider | **Build** | Stable; 1.147 changed only an internal fallback (`workbench/api/common/extHostAuthentication.ts:663`). Sign-in today uses SecretStorage and its own browser login ([extension.ts:92](../../extensions/vscode/src/extension.ts#L92), [extension.ts:603](../../extensions/vscode/src/extension.ts#L603)) | M | M24 |
| `capabilities.agentsWindow.supported` | Done | Honoured unconditionally since 1.145 (`extensionsRegistry.ts:605`); declared at [package.json:54](../../extensions/vscode/package.json#L54) | none | none |
| MCP server definition provider | Done | Used ([extension.ts:222](../../extensions/vscode/src/extension.ts#L222)); 1.147 validates the SSE endpoint's destination (`extHostMcp.ts`), which does not touch Unfold | none | none |
| Walkthroughs, status bar, tree views | Done, editor window only | Not drawn in the Agents window (`extensionManifestPropertiesService.ts:78`, `:86`, `:88`); [package.json:905](../../extensions/vscode/package.json#L905), [extension.ts:60](../../extensions/vscode/src/extension.ts#L60) | none | none |
| Webview view in the sidebar | **Skip** | Not drawn in the Agents window; webview panels already work there ([panel.ts:66](../../extensions/vscode/src/panel.ts#L66), [task-panel.ts:99](../../extensions/vscode/src/task-panel.ts#L99)) | M | Skipped |
| `@unfold` chat participant | **Skip** | Not supported outside the Local harness, which leaves in February 2027 | M | Skipped |
| Language model chat provider | **Skip** | Spend outside Ploeg's Run budget | L | Skipped, T19 |
| Continue a session in VS Code (`/code`, 1.146) | Watch | No public URI or command to open an agent-host session found ([1.146 notes](https://code.visualstudio.com/updates/v1_146#_continue-a-copilot-cli-session-in-vs-code-experimental)) | M | none |
| Proposed APIs | **Skip** | `languageModelToolSets` (`languageModelToolsContribution.ts:382`), `chatSessionsProvider` (`chatSessions.contribution.ts:422`), `chatStatusItem`, `notificationTelemetry`, `chatArtifactIntegrations`, `chatHooks` `UserPromptTransformed`, `canonicalUriProvider`, `contribChatResources` (`chatResourceContributions.ts:111`), `contribTitleBar`, `structuralDiff`, `agentSessionsWorkspace`. None can ship; `contribTitleBar` and `contribChatResources` are worth watching | none | Skipped, T14 |
| `github` namespace | n/a | Deleted in 1.147 | none | none |

## MCP

| Item | Fit | Gate or evidence | Size | Plan |
| --- | --- | --- | --- | --- |
| Confirmations over HTTPS | **Build** | VS Code speaks 2025-11-25 only (`platform/mcp/common/modelContextProtocol.ts:43`) and declares `elicitation:{form:{},url:{}}` (`workbench/contrib/mcp/common/mcpServerRequestHandler.ts:120`). Unfold takes only stateless POST ([mcp-http.ts:128](../../src/mcp-http.ts#L128)) and builds a server per request ([mcp-http.ts:175](../../src/mcp-http.ts#L175)), so [mcp.ts:403](../../src/mcp.ts#L403) refuses. Answer a confirming `tools/call` as `text/event-stream` and send `elicitation/create` on it; the reply must come back to the same process. The how-to already documents the gap ([serve-unfold-mcp-over-https.md](../../../../docs/how-to/serve-unfold-mcp-over-https.md)) | M to L | M15 |
| `openWorldHint: false` on action tools | **Build**, after M15 | `openWorldHint` true makes VS Code ask to review every result (`mcpLanguageModelToolContribution.ts:156-157`, `:234-242`); the action tools call only Unfold's own API | S | M15 follow-up |
| Progress notifications | **Build**, with M15 | `notifications/progress` becomes the tool's progress message (`mcpServerRequestHandler.ts:369`, `mcpServer.ts:1417`); over HTTP it needs the stream M15 adds | S over stdio, M over HTTP | M15 follow-up |
| Server and tool icons | **Build** | `mcpIcons.ts:41-92` accepts `data:` URIs with light and dark themes; `serverInfo` has none ([mcp.ts:98](../../src/mcp.ts#L98)) | S | M13 |
| Prompts and completions | **Build** | Prompts become `/mcp.<server>.<prompt>` (`mcpTypes.ts:608`, `mcpCommands.ts:1841`), completions fill their arguments (`mcpServerRequestHandler.ts:548`, `mcpPromptArgumentPick.ts:245`). Hand-off, now and take-over, with Work Item ids completed | M | M17 |
| Resources and resource templates | **Build** | Add Context, MCP Resources (`browser/mcpResourceQuickAccess.ts`, templates `:386-400`), subscribe and updates (`mcpServerRequestHandler.ts:372-375`, `:480`, `:487`). Unfold serves only `ui://` app resources ([mcp.ts:815](../../src/mcp.ts#L815)). Answers stay marked untrusted | M | M18 |
| Core 2025-11-25 tasks for `unfold_hand_off` | **Build** | VS Code declares `tasks` (`mcpServerRequestHandler.ts:121-128`) and uses one when the server declares `tasks.requests.tools.call` (`mcpServer.ts:1407-1416`). Unfold has only the 2026-07-28 Tasks extension, behind a flag. Polling works over stateless POST | M | M19 |
| MCP App: app-registered tools and host methods | **Build** | `chat.mcp.apps.enabled` defaults to true (`platform/mcp/common/mcpManagement.ts:327`); an app can register tools (`workbench/contrib/chat/browser/widget/chatContentParts/toolInvocationParts/chatMcpAppModel.ts:1053-1092`). The card uses `tools/call` and `ui/open-link` ([view.js](../../public/mcp-apps/view.js)) but not `ui/update-model-context` or `ui/request-display-mode`. Its buttons depend on M15. Not through the AHP host, since 1.147 never declares `mcpApps` there | M | M22 |
| Skills over MCP (SEP-2640) | **Spike** | Default true for Copilot agent-host sessions (`agentHostStarter.config.contribution.ts:304-308`), consent per server (`platform/agentHost/common/agentHostSchema.ts:991-993`). Discovery runs inside the Copilot SDK (`platform/agentHost/node/copilot/copilotAgentSession.ts:13013`), so the wire format is not in the tree. A prompt-injection surface into a person's Copilot context | M | S01, T10 |
| Extension-provided `unfold-mcp` by URL | Build, not planned yet | `McpHttpServerDefinition` carries no OAuth client id (`src/vscode-dts/vscode.d.ts:20745-20768`); the extension provides only the Ploeg server ([mcp-servers.ts:47](../../extensions/vscode/src/mcp-servers.ts#L47)). Inherits the client-id prompt and the M15 gap | S | none |
| Roots | Low | Answered by VS Code (`mcpServerRequestHandler.ts:303`); a stateless HTTP server cannot ask | S stdio, M HTTP | none |
| Structured content with a short text summary | Low | When `structuredContent` is present the model gets it instead of the text (`mcpLanguageModelToolContribution.ts:333`, `:389-391`) | S | none |
| URL elicitation | Watch | VS Code opens the link and retries once (`mcpServer.ts:1425-1460`), then waits for `notifications/elicitation/complete` (`browser/mcpElicitationService.ts:189-205`), which POST-only HTTP cannot send. The large-spend gate of [the MCP patterns research](../../../../docs/research/2026-09-30-mcp-server-patterns.md) needs it | M | none |
| Registry and gallery | Watch | `chat.mcp.gallery.serviceUrl` (`mcpManagement.ts:324`); one registry entry names one URL, while each installation has its own | M | none |
| OAuth, CIMD and enterprise sign-in | Done, docs | VS Code tries an override client id, the stored client, CIMD, then DCR, and XAA (`workbench/api/browser/mainThreadAuthentication.ts:182-215`); Unfold serves RFC 9728 metadata ([mcp-auth.ts](../../src/mcp-auth.ts)) | S to M | T31, T40 |
| Tools, output schema, server instructions, `listChanged` | Done | `mcpLanguageModelToolContribution.ts:144-160`, `mcpServer.ts:1203-1216`; [mcp.ts:846](../../src/mcp.ts#L846), [mcp.ts:77](../../src/mcp.ts#L77) | none | none |
| Sampling | **Skip** | `mcpSamplingService.ts`; a model call Ploeg does not authorize | none | Skipped |
| The Ploeg MCP server | Upstream | Its features live in `ploeg-hq/ploeg`; not assessed | none | none |

## Agent Plugin

| Item | Fit | Gate or evidence | Size | Plan |
| --- | --- | --- | --- | --- |
| Commands, an Unfold agent and rules under `com.github.copilot/` | **Build** | Read only from `com.github.copilot/commands/`, `agents/` and `rules/*.instructions.md` (`platform/agentPlugins/common/pluginParsers.ts:237-240`). The six files in [commands/](../../extensions/claude-code/commands) call `${CLAUDE_PLUGIN_ROOT}` scripts and need a portable form | S to M | M12 |
| Hooks with VS Code's names | **Build** | Read from `com.github.copilot/hooks/hooks.json` (`pluginParsers.ts:235`, `:241`). VS Code maps Claude-style SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, SubagentStart, SubagentStop and Stop (`workbench/contrib/chat/common/promptSyntax/hookTypes.ts:30-75`, [#345068](https://github.com/microsoft/vscode/pull/345068)); [hooks.json](../../extensions/claude-code/hooks/hooks.json) also uses Notification, PermissionRequest, PostToolUseFailure and SessionEnd. `allowManagedHooksOnly` blocks hooks unless the plugin is force-enabled (`AGENTS_PLUGINS.md:195`) | M | M12 |
| The plugin inside the extension (`chatPlugins`) | **Build** | See the extension table | S to M | M11 |
| OAuth client id on an inline Copilot MCP entry | Probe | Inline MCP under `extensions["com.github.copilot"]` is accepted (`AGENTS_PLUGINS.md:103`); the generator writes the second plugin without a client id ([agent-plugin-marketplace.mjs:57](../../scripts/agent-plugin-marketplace.mjs#L57)) | S | none, T18 |
| Install link as a button | **Build** | `vscode://chat-plugin/install?source=…&plugin=…[&harness=]` (`workbench/contrib/chat/browser/pluginUrlHandler.ts`), refused in remote and web windows; documented only ([install-the-unfold-plugin.md](../../../../docs/how-to/install-the-unfold-plugin.md)) | S | M14 |
| Repository-level `enabledPlugins` | **Docs** | `.github/copilot/settings.json` (`platform/agentHost/node/copilot/copilotRepositoryPluginSettings.ts:19-45`) | S | M14 |
| Manifest, skills, marketplaces | Done | The strict v1 parser reads `$schema`, `name`, `version`, `description` and `extensions` (`platform/agentPlugins/common/agentPluginParser.ts:16-53`); [plugin.json](../../extensions/claude-code/plugin.json), [skills](../../extensions/claude-code/skills) (`brief` works only in Claude Code), marketplace lookup order at `AGENTS_PLUGINS.md:142-155` | none | none |

## Docs

| Item | Fit | Evidence | Size | Plan |
| --- | --- | --- | --- | --- |
| The Agents window signed out, with only Unfold connected | **Docs**, then the desktop pass | See the corrections; whether the gate waits for a remote host to connect is not verified | S | M14 |
| Install-link button text | **Docs** | See the plugin table | S | M14 |
| Repository `enabledPlugins` | **Docs** | See the plugin table | S | M14 |
| Contact-admin links (`communication.support.url`) and Private Marketplace blocking | **Docs** | [1.146 help links](https://code.visualstudio.com/updates/v1_146#_organization-help-links-for-policy-restrictions), [#341049](https://github.com/microsoft/vscode/pull/341049); neither is in the "In a managed VS Code" section of [install-the-unfold-plugin.md](../../../../docs/how-to/install-the-unfold-plugin.md) | S | M14 |
| Enterprise proxies | **Docs**, after a check | [1.146 proxies](https://code.visualstudio.com/updates/v1_146#_copilot-sessions-behind-enterprise-proxies), [#347494](https://github.com/microsoft/vscode/issues/347494). Whether the agent-host WebSocket follows PAC, Kerberos and Basic-auth proxies is not verified | S | M14 |
| `workbench.externalUriOpeners` for Unfold's origin | **Docs** | [1.147 integrated browser](https://code.visualstudio.com/updates/v1_147#_open-nonlocalhost-links-in-the-integrated-browser): Work Item pages linked from chat open beside the session. Not verified for links clicked inside chat | S | M14 |

## The plan

All behaviour below is proposed. The keys are this dossier's own; sizes are the research agents' estimates, S, M or L.

**Wave 1, small and valuable.**

| Key | Surface | Item | Size |
| --- | --- | --- | --- |
| M01 | host | Show a Work Item's pull request and issue as session artifacts and GitHub data, so it lands in Ready to merge or Failing CI with Fix Checks mapped to Retry or steer; never advertise the merge operation | S to M |
| M02 | host | Keep acknowledged Work Items quiet in the Inbox: stable `modifiedAt` and input-request keys, pinned by a test; mark a stale Work Item as needing input if it needs a person | S |
| M03 | host | Ping each client and drop dead connections | S |
| M04 | host | Confirm and show progress on Accept and open pull request | S |
| M05 | host | Report the model and cache tokens per turn, on Work Item sessions too | S |
| M06 | host | Forward URL attachments and name skill references that stay behind | S |
| M07 | host | Keep reviewed-file marks across reconnects, and say when the history is longer than the snapshot | S |
| M08 | host | Offer number, integer and multi-select questions | S |
| M09 | host | Draw a Shift as a Mermaid diagram in Work Item replies | S |
| M10 | extension | Hide editor-only commands in the Agents window, and tidy the README and CHANGELOG for the info page | S |
| M11 | extension | Ship the Unfold skill, instructions and Agent Plugin with the extension | S to M |
| M12 | plugin | Deliver commands, an Unfold agent, rules and VS Code hook names to VS Code Copilot sessions | M |
| M13 | mcp | Give `unfold-mcp` and its tools Unfold's icon | S |
| M14 | docs | The signed-out Agents window, the install-link button, repository `enabledPlugins`, contact-admin links, Private Marketplace, proxies, `externalUriOpeners` | S |

**Wave 2, medium.**

| Key | Surface | Item | Size |
| --- | --- | --- | --- |
| M15 | mcp | Make confirmations work for VS Code over HTTPS; the most valuable item of this wave | M to L |
| M16 | extension | Action tools in chat with confirmation: approve, reject, retry, hand back | M |
| M17 | mcp | Prompts with completions for hand-off, now and take-over | M |
| M18 | mcp | Work Items as chat context through resources and templates | M |
| M19 | mcp | Follow `unfold_hand_off` as a 2025-11-25 task | M |
| M20 | host | Native progress while a workspace or Run is prepared | M |
| M21 | host | Stream a live Run's tool input | M |
| M22 | mcp | Tools registered by the Work Item card, and `ui/update-model-context` | M |
| M23 | extension | A Timeline of the Runs and pull requests that changed a file | M |
| M24 | extension | Sign in to Unfold through VS Code's Accounts menu | M |
| M25 | host | Ask about a Work Item in a side chat, with its cost confirmed | M |

**Spikes and decisions.**

| Key | Kind | Question |
| --- | --- | --- |
| S01 | spike | What wire format does Skills over MCP (SEP-2640) expect from `unfold-mcp`? |
| S02 | decision | Should route-started sessions be automation runs, given that VS Code then leaves them out of the main list until a reply? |
| S03 | decision | VS Code's native pull request dialog or Ploeg's publisher: who writes the title and body? |
| S04 | decision | Forward the host's own log lines for a person's sessions over OTLP, against today's debug-log refusal? |
| S05 | spike | Unfold in the web and phone Agents window, through the `tkn` query and an Origin allow-list |
| S06 | Ploeg upstream | A route write contract in Ploeg for pause, delete and run now from VS Code |

## Upstream issue drafts (not filed)

Drafted for the owner to file on [microsoft/vscode](https://github.com/microsoft/vscode/issues). None is filed. Paths are at tag 1.147.0.

### U1. Remote agent hosts cannot offer one-time automations (Send Later) even when they advertise `automations.oneTime`

> `RemoteAgentHostSessionsProvider` passes `supportsOneTimeAutomation: false` to its automation store (`remoteAgentHostSessionsProvider.ts:429`), so Send Later and `vscode_createAutomation` with `interval: once` are refused for every remote host before its `InitializeResult.automations.oneTime` is read (`agentHostAutomationStore.ts:115-116`, `automationTools.ts:986-987`, `scheduledChatsService.ts:275`). Honour the host's advertised `oneTime` capability, and `vscode.scheduledChatExistingConversation`, for remote providers, since a remote host is the case where the run does not depend on the local machine being awake.

### U2. Remote WebSocket agent hosts cannot signal a rejected connection token

> A WebSocket host that refuses the connection token at the upgrade (HTTP 401) is retried as a transport failure (`webSocketClientTransport.ts:101-103`), and a rejected `authenticate` for an advertised protected resource is only logged (`agentHostProtocolClient.ts:1598-1602`), so the 1.147 "Authentication failed. Reconnect to sign in again." state (`remoteAgentHostServiceImpl.ts:875-878`) is reachable only for cloud sandbox hosts. Map an upgrade refusal with 401 or 403, or a documented close code, to `AgentHostTransportFailureReason.AuthenticationFailed`, and stop retrying.

### U3. Agent host automations with a host-defined trigger cannot be enabled or disabled

> `agentHostAutomationStore` marks every automation whose trigger is not a schedule as read-only (`agentHostAutomationStore.ts:613-614`), so `canUpdateAutomation` is false even when the host lists `Update` among the entry's operations (`:207`). Allow an `{enabled}` change, or edits to `disableConditions`, for such entries when the host advertises `Update`, as is already done for scheduled chats.

### U4. Let agent hosts accept automation creation with a host-defined trigger type

Low priority.

> The guided creation flow always produces a schedule trigger (`agentHostAutomationStore.ts:953-955`), so a host whose automations start on external events, such as tracker assignment, cannot accept automations created in VS Code. Offer the trigger types the host advertises in `AutomationTriggerType` in the creation flow.

### U5. Allow canvases on remote agent hosts for agents other than `copilotcli`

Low priority.

> `supportsCanvasPresentation` in `RemoteAgentHostSessionsProvider` returns false unless the agent id is `copilotcli` (`remoteAgentHostSessionsProvider.ts:908-909`), so a third-party host that advertises `tcpConnections` cannot present canvases. Gate it on the host's capabilities instead of the agent id.

## Skipped

| Item | Reason |
| --- | --- |
| Managed worktrees and their clean-up | Work Item workspaces are Ploeg sandboxes; the host has no local Git checkout to clean |
| Inline actions in the session list | Removed in 1.147; their successor, the input banner, comes with M01 |
| Model comparison against a Team | Each comparison runs 2 to 10 budgeted Shifts, and eligibility of the remote provider is not verified |
| Mixed harnesses beyond the existing spike | Off by default; a Team's Roles choose the harness, and the 1.147 dossier's recommendation 9 already asks the question |
| Browsing through the host (`tcpConnections`) | No preview concept in Unfold or Ploeg, and an open relay into Unfold's network is a high SSRF risk |
| Sampling | A model call Ploeg does not authorize ([ADR-0002](../../../../docs/adr/adr-0002-ploeg-is-the-only-engine.md)) |
| Language model chat provider | Spend outside Ploeg's Run budget (T19) |
| `@unfold` chat participant | Works only in the Local harness, which leaves in February 2027 |
| Forking chats | Breaks the one-chat model, for an L-sized change |
| Proposed APIs | Cannot ship on the Marketplace or Open VSX |

## Watchlist changes

| Id | Change |
| --- | --- |
| T5 | Noted: VS Code implements core 2025-11-25 tasks, not the Tasks extension; M19 follows `unfold_hand_off` through them |
| T10 | Changed: on by default in 1.147 for Copilot agent-host sessions; spike S01 on the wire format |
| T13 | Upstream draft U5 written, not filed |
| T14 | Changed: VS Code 1.147 reads `_meta['agentHost/sessionArtifacts']` from any host, with no proposal; M01 builds it; #508 is still a draft |
| T15, T44 | Spike considered and dropped on 2026-11-19: no preview concept, SSRF risk, browsing off in Stable |
| T28 | Changed: VS Code already maps Claude-style hook names in Copilot sessions, from `com.github.copilot/hooks/`; M12 |
| T51 | Upstream draft U1 written, not filed |
| T53 (new) | Route-started sessions as automation runs; S02 |
| T54 (new) | VS Code's native pull request dialog against Ploeg's publisher; S03 |
| T55 (new) | The host's log lines in VS Code over OTLP; S04 |
| T56 (new) | Unfold in the web and phone Agents window; S05 |
| T57 (new) | Delete and run now on a Team route from VS Code; S06 |
| T58 (new) | A rejected connection token that VS Code shows as such; U2 |
| T59 (new) | Pausing a Team route from VS Code; U3 and S06 |
| T60 (new) | Creating an automation with a host-defined trigger; U4 |

## Not verified

- Nothing was run against a VS Code client or Unfold's host. Every VS Code claim is a reading of source at the tags.
- Whether the pull request pill and the Inbox pull request flow render for a session with no workspace folder (M01).
- Whether Ploeg moves a Work Item's `updatedAt` on events a person does not need to see, and whether a stale Work Item needs a person (M02).
- The wire format of Skills over MCP, which lives in the Copilot SDK (S01).
- Whether Ploeg exposes route pause, delete or run-now writes; only Unfold's [ploeg.ts](../../src/ploeg.ts) and the read-only Ploeg MCP tools were read (S06).
- How the Inbox treats automation-origin sessions beyond the list filter (S02).
- Whether skill, instruction and plugin contributions reach remote agent-host sessions, and how `chatPlugins` behaves under `strictPluginOnlyCustomization` (M11).
- Whether the authentication provider and the Accounts menu appear in the Agents window (M24); that the Timeline is absent there is inferred from the window drawing no contributed views (M23).
- Whether an inline Copilot-extension MCP entry keeps `oauth.clientId`.
- Whether VS Code ever negotiates MCP 2026-07-28; no code for it was found.
- How a `-32042` URL elicitation behaves without a completion notification, other than waiting until the person cancels.
- Whether the signed-out Agents window waits for a remote host to connect, who serves the phone entry, and its CORS and Origin behaviour (M14, S05).
- That the Agent Plugin's `.mjs` hook scripts run in the Copilot harness's environment (M12).
- The full model-comparison eligibility of the remote provider, and why VS Code set `supportsOneTimeAutomation: false`: the source tree was a shallow clone without history.
- The "since" version of AHP commands and fields is inferred from the changelog; open AHP pull requests other than #612 were checked in 1.147 by name only.
