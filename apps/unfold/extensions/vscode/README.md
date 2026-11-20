![Unfold](https://raw.githubusercontent.com/unfold-hq/unfold/development/apps/unfold/public/og-image.png)

# Unfold for VS Code

Follow, answer and review the agent work Unfold and Ploeg run, from VS Code. The agents, model calls and checkouts stay on an Unfold workbench, on your machine or a server; the extension signs in to it and runs no agent itself.

- **In an editor window** (VS Code 1.99 or later), the Unfold sidebar shows what waits on you (**Now**), your team's tracker tasks (**Tasks**), each Team's **Work** and your supervised **Sessions**, and the status bar counts what needs you. A Work Item or session opens in a panel, where you answer questions, review the change and its checks, hand a task to a Ploeg team, check out a Work Item's branch or send editor content to a session.
- **In the Agents window** (VS Code 1.143 or later), signing in adds the workbench as a remote agent host, so Unfold sessions and the Work Items Ploeg runs appear next to your other agents, where you follow each Round and answer questions in the chat. The extension runs there too, with its commands, three read-only chat tools and the Ploeg MCP server. That window has no sidebar, status bar or checkout, so the commands that need one are offered only in an editor window ([below](#use-unfold-from-the-agents-window)).

The [product designs](https://github.com/unfold-hq/unfold/blob/development/apps/unfold/docs/PRODUCT-DESIGN.md) include proposals beyond the implemented extension. This guide describes the current client.

## Install

Download the VSIX and its matching `.sha256` file from a completed [GitHub release](https://github.com/unfold-hq/unfold/releases). In the download directory, run `shasum -a 256 -c` with that checksum filename and confirm the VSIX reports **OK**. Then choose **Extensions → … → Install from VSIX** and select that file. Use the filenames attached to your chosen release; a release page without the assets is not ready for this installation path.

In VS Code, install `unfold-hq.unfold-workbench` from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=unfold-hq.unfold-workbench); in VSCodium, Cursor and other forks, from [Open VSX](https://open-vsx.org/extension/unfold-hq/unfold-workbench). Release candidates reach the Marketplace as pre-releases: choose **Switch to Pre-Release Version** on the extension's page to receive them, and both registries show them under the extension's own version, such as `0.4.10152` for Unfold `0.4.0-rc.152`.

The extension was called `unfold-hq.unfold` until 2026-11-19. If you have that one, uninstall it, install `unfold-hq.unfold-workbench` and sign in again; the old one gets no updates and does not open links from a newer workbench.

A sideloaded VSIX does not receive registry updates automatically. An editor window needs VS Code 1.99 or later, and the extension runs in the Agents window from VS Code 1.143. The extension runs in the editor's Node extension host and does not require provider keys, a harness or Kubernetes tools on the client machine. A local workbench has its own runtime requirements.

## Unfold Insiders

**Unfold Insiders** (`unfold-hq.unfold-workbench-insiders`) is this extension built from the same source with VS Code's proposed APIs switched on, for people who run VS Code Insiders and want to try what is not in Stable VS Code yet ([design record](https://github.com/unfold-hq/unfold/blob/development/apps/unfold/docs/design/2026-11-20-unfold-insiders-and-the-phone.md)). It is the full extension plus the experimental parts, so it replaces the regular one rather than running next to it: sign-in and stored secrets are kept per extension identifier, and two extensions would ask for two sign-ins.

It ships only as a VSIX on each [GitHub release](https://github.com/unfold-hq/unfold/releases), signed and attested like the regular one, and is on neither the Visual Studio Marketplace nor Open VSX, because VS Code asks extensions that use proposed APIs to stay off the Marketplace. To install it:

1. Download `unfold-insiders-<version>.vsix` and its `.sha256` file from the release, and check it with `shasum -a 256 -c unfold-insiders-<version>.vsix.sha256`.
2. In VS Code Insiders, disable `unfold-hq.unfold-workbench` (**Extensions → Unfold → Disable**), then choose **Extensions → … → Install from VSIX** and pick the file.
3. Allow its proposed APIs. Either start VS Code Insiders with `code-insiders --enable-proposed-api unfold-hq.unfold-workbench-insiders`, or run **Preferences: Configure Runtime Arguments** and add `"enable-proposed-api": ["unfold-hq.unfold-workbench-insiders"]` to `argv.json`, then restart.
4. Sign in to your workbench again.

Without step 3, or in Stable VS Code, which grants proposed APIs only to extensions Microsoft lists, Unfold Insiders works exactly like the regular extension and says once which experimental parts are off and how to turn them on. It says so again only when that list changes.

What the experimental parts do today:

| Part | Proposal | State |
| --- | --- | --- |
| The Agents window without editing settings | `remoteAgentHost` | Built. On sign-in the workbench is registered with `vscode.chat.registerRemoteAgentHost` while the extension runs, instead of being written to `chat.remoteAgentHosts` in your `settings.json`; the token stays in SecretStorage. If VS Code refuses the call, the extension writes the setting as the regular one does. |
| What waits, above the chat input | `chatInputNotification` | Built. A notice above the chat input says what waits on you, such as "2 need you · 3 ready for review", or that a session's budget is 90 % spent or more. It warns when you are needed or a budget nears its end, is an error once a budget is spent, and only informs for reviews. Its button opens the Work Item or session when one thing waits, and **Now** otherwise. It clears when nothing waits; on a demo workbench it says so. |
| Now at a glance | `treeViewMarkdownMessage`, `treeItemMarkdownLabel`, `statusBarItemTooltip` | Built. The top of **Now** shows "3 ready for review · 2 need you · US$ 4,10 today"; a count links to its Work Item when there is one, and to the browser's Now page when there are several. Rows that need you or wait for your review have their title in bold. Hovering the Unfold status bar item reads Now again and lists what runs, with its Role, time and cost so far, and today's spend. |
| The chat status menu | `chatStatusItem` | Built. How many things need you and today's spend, with what is ready for review below. |
| Work in the Sessions list, Work Items in chat | `chatSessionsProvider`, `chatArtifactIntegrations` | Declared, not built yet. |

Today's spend is what the Runs on Ploeg's Now settled, for those that finished today (local time), plus what running Runs observed at the gateway so far, in US dollars as the workbench reports them. It reads "at least" when Ploeg cut a list short or a Run reported no amount, it is not shown when Ploeg could not be read, and a demo shows none. The budget warning reads each session's own authorized budget: the extension does not read a Team's spend cap.

**Unfold Insiders: Send Feedback** opens a new issue on [unfold-hq/unfold](https://github.com/unfold-hq/unfold/issues) with your VS Code version, the extension version, your platform, the workbench's origin and which proposals are on. It sends nothing itself: you read and edit the issue before you submit it.

Links the workbench opens in VS Code, such as **Connect VS Code** and **Open the Work Item in VS Code**, still name `unfold-hq.unfold-workbench`, so they do not reach Unfold Insiders yet. Not verified: nothing in Unfold Insiders has been tried in a running VS Code Insiders. That VS Code reports only the granted proposals in the extension's manifest is read from the VS Code source, not observed.

## Try the local demonstration

With Node 24 and Git available through the repository's tool configuration, run this from the repository root:

```sh
mise exec -- npm run demo
```

1. Open the **Unfold** activity bar and run **Unfold: Connect to Workbench**. Enter `http://127.0.0.1:4080`; demo mode supplies its identified demonstration user.
2. **Now** lists the demo's illustrative Ploeg work, marked as an illustration: pull requests ready for your review, work that needs you, proposals and running Runs. None of it makes model calls or spends anything.
3. Expand **Tasks → Demo tasks** and open the fixture task. It opens in its own tab with its description; the demo fixture is not linked to Ploeg.
4. Choose **Start a supervised session**, select a team, runtime and budget, then confirm **Create session**. The wizard supports going back before confirmation.
5. Choose **Start remote team** in the queued session. This command name also controls work on a local workbench.
6. Inspect **Checks**, **Changes** and the final review, then download the Git bundle, patch or manifest from **Brief**.

The demo runs a fixed repository fixture and real checks without AI calls or Ploeg. An arbitrary objective in demo mode does not turn the fixture into a live coding agent. **New Remote Session** creates an ad hoc session; live work requires a configured live runtime. See the [demo guide](https://github.com/unfold-hq/unfold/blob/development/apps/unfold/docs/operations/demo.md).

## Connect and sign in

Run **Unfold: Connect to Workbench** with the deployed HTTPS origin. When configured, **Sign in with <provider>** shows a short code such as `BCDF-GHJK` and opens the workbench's browser sign-in. After you sign in, the browser names the request and shows the same code: approve it only if the codes match. The editor then acts as you, with its own credential that lasts thirty days and that you can sign out under **Settings › Signed-in editors** in the browser. Local-account login is also supported.

The editor credential, or the session cookie of a local-account login, stays in VS Code SecretStorage, scoped to that origin. There are no password or API-key settings. The extension runs in the local UI host even in a Remote SSH window, so the workbench must be reachable from your machine. HTTPS is required except for loopback development. Use an origin at `/`; reverse-proxy subpaths are unsupported. A workbench behind an access gateway needs that gateway's headers: see [Connect through an access gateway](#connect-through-an-access-gateway).

Unfold also shows in VS Code's **Accounts** menu, as your account name and the workbench's host, for example `ryan · unfold.example.com`. **Sign in with Unfold** there runs the same sign-in as **Unfold: Connect to Workbench**, with the same code to compare. **Sign Out** there does what **Unfold: Sign Out** does: the workbench revokes the editor credential, the extension deletes it from SecretStorage, and the Agents window entry it wrote goes too. When the workbench stops accepting the credential, for example after thirty days or after you signed the editor out in the browser, the menu shows Unfold as signed out and offers to sign in again. The account is the one stored for the configured workbench; a credential you already held stays signed in. Another extension that asks VS Code for your Unfold sign-in gets it only after VS Code's own consent prompt. An editor without the authentication API keeps the commands only.

The server enforces identity and session ownership. Viewers inspect visible sessions, operators change their own sessions, and administrators can access all sessions. Changing the connection invalidates pending actions so they cannot be submitted to the wrong workbench.

## Connect through an access gateway

Some installations put an access gateway in front of the workbench: an identity-aware proxy, such as Cloudflare Access, that sends a browser to a sign-in page before a request reaches Unfold. The extension is not a browser and never follows a redirect, so it cannot complete that sign-in. Its error says so and names the host or path the request was sent to, the status bar reads **Unfold: access gateway**, and both lead to the command below.

When the gateway also accepts a credential in request headers, store it with **Unfold: Set Access Gateway Headers**:

1. Choose **Add a header** and enter the header's name exactly as the gateway expects it.
2. Enter its value. The box is masked, and the value is never shown again.
3. Repeat for each header, then press Escape. The extension reconnects and continues with the workbench sign-in.

For a [Cloudflare Access service token](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/), add `CF-Access-Client-Id` and `CF-Access-Client-Secret`, and have the gateway's operator give the application a Service Auth policy that includes the token. Any gateway that takes a fixed credential in a header works the same way.

Your own Cloudflare Access session works too, without a service token and without asking the operator for anything. Run `cloudflared access login https://<workbench>`, then store the output of `cloudflared access token -app=https://<workbench>` as the header `cf-access-token` ([Cloudflare's command-line guide](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/)). The gateway then knows it is you. The token lasts as long as the session the gateway's administrator configured, after which you store a new one.

The extension then sends those headers with every request to that workbench: API calls, the live event stream and downloads. Things to know:

- The headers are a second credential beside your Unfold sign-in, kept in VS Code SecretStorage under the workbench's origin. They never appear in settings, never reach the webview, and are never sent anywhere else, because the extension follows no redirect. **Sign Out** leaves them in place; remove them with the same command.
- The extension refuses a header it sets itself, such as `Authorization`, `Cookie` and `Origin`. A gateway that takes its credential only in one of those cannot be passed this way, because your Unfold credential travels there.
- A workbench takes at most 16 headers, each value on one line in printable ASCII.
- A value that expires, such as a token you copied from a command-line sign-in, has to be replaced by hand. The extension then reports that the gateway refused the stored headers; your Unfold sign-in is kept.
- The browser sign-in still opens your browser, which signs in to the gateway its own way.
- VS Code's Agents window makes its own connection to the workbench and takes no headers, so behind an access gateway it stays **Not connected**. The same holds for the **Ploeg** server in VS Code chat when that server sits behind a gateway: its definition carries a URL only.

The tests run the client against a local server that redirects to a sign-in page until it sees the headers. Against Cloudflare Access, checked on 2026-11-18: without headers the extension names the gateway's sign-in host, and with a service token Access does not know it reports that the gateway refused the stored headers. Not checked yet: a service token or a personal token the gateway admits, and the command in a desktop VS Code.

## Use Unfold from the Agents window

After you sign in, Unfold appears in VS Code's Agents window on its own, within seconds and without a reload. Its sessions show up there next to your other agents, grouped as **Unfold · <repository> [Unfold]**. To start one, use **Unfold: Start a Session in the Agents Window**: the Unfold button at the top of the **Now** and **Sessions** views, or **Start an Unfold session** in the status bar. It asks which repository when the workbench has more than one, remembers your pick, and opens the Agents window on a new session with that repository's folder already chosen. Choosing **New**, then **Workspace ▾ → Folders (Unfold) → <repository>** in the Agents window does the same by hand. The extension adds the workbench to `chat.remoteAgentHosts` in your default profile's user `settings.json`. It keeps your comments and other settings, and removes the entry again when you sign out. The entry is called **Unfold**; once you use more than one workbench, each is called **Unfold (<host>)**. A name you gave the entry yourself stays. **Unfold: Connect VS Code Agents Window** does the same on demand and offers **Start an Unfold Session**; **Unfold: Open Agents Window** adds a missing entry and opens the window, and the **Get started** walkthrough has a step for it. **Connect VS Code** on the workbench's **Settings › Signed-in editors** page opens `vscode://unfold-hq.unfold-workbench/connect-agents-window`, which does the same from the browser. The status bar shows **Start an Unfold session** once an Agents window has connected with this editor's token, checked every 20 seconds. **Not connected** leads to **Open Agents Window**, **Reconnect** and **Troubleshoot**; the Agents window's **Agent Host** output channel says why a connection failed.

**Without a GitHub sign-in.** In a desktop VS Code 1.145 or later, the Agents window opens without a GitHub sign-in when a connected agent can run without one, and Unfold's agents can: they list no protected resources and at least one model ([`sessionsAuthGate.ts:46-59`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/services/sessions/browser/sessionsAuthGate.ts#L46-L59), [`baseAgentHostSessionsProvider.ts:824-829`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/sessions/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L824-L829) at 1.147.0; [microsoft/vscode#345254](https://github.com/microsoft/vscode/issues/345254)). So you need no Copilot licence to follow Work Items there; only agents that need GitHub ask for it when you pick them ([`sessionsAuthGate.ts:23-26`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/services/sessions/browser/sessionsAuthGate.ts#L23-L26)). VS Code for the Web still asks for GitHub sign-in first. Not verified: a signed-out desktop Agents window with only Unfold connected has not been tried in a running VS Code.

The other way round, each session in the Agents window starts with **Open the Work Item in VS Code** and **Open in the browser ↗**. The first opens the Work Item panel, or an Unfold session's own panel, in the editor window you used last rather than in the Agents window. To make that work, the extension tells the workbench which window that is whenever the window gains focus, and forgets it when you sign out. The line shows once a session's chat has a turn; a Work Item's chat always has one, its brief. The browser link needs the workbench to know its public address. When a Work Item has a pull request, the line ends with **Pull request #n ↗**.

**Following work you handed off.** Whatever you hand off, with `unfold_hand_off` from Claude Code, from the browser, by a tracker label or from the Claude Code plugin, Ploeg turns it into a Work Item, and the Agents window lists it within seconds as **#n <title>**. While it is queued, the line under the title reads **Queued for <team>**, followed by **· handed off by you** when Ploeg recorded you as the person who handed it off; tracker work names its task in the brief instead. Its chat opens with the brief: the title and where it came from. While it runs, each Round is a turn and each Run a subagent you can open for its messages, tool calls and pod logs; the line reads **<Role> · Round n · <spent>/<budget>**. When an agent asks you something, the session says **Needs attention** and the question waits in the chat: answer it there and choose **Answer and resume Round n** or **Only save my answers**. The question says what resuming spends first. Closing the question sends nothing. When the pull request is ready, the line reads **Ready for review · PR #n**, with what the attempt spent, and the chat links the pull request: review and merge it on the forge. The Agents window never merges for you.

**Open in Agents Window**, on a session or Work Item row in the **Now**, **Sessions** and **Ploeg** views and in the Command Palette, opens that one session in the Agents window. It asks the workbench for the session's link and builds it with this editor's URL scheme, so Insiders opens Insiders. The link names the host as your own `chat.remoteAgentHosts` entry spells it, because VS Code identifies the host by that exact address. Without an entry for this workbench, it offers **Connect Agents Window** first. A session opens for its owner and for administrators, the people whose Agents window lists it; a Work Item opens for the people Ploeg lets see it. The session page and the Work Item page in the browser have the same action. The link needs VS Code 1.142 or later in the Agents window; the extension itself still runs on 1.99. If the Agents window cannot find the session, it says so after about 15 seconds. A click-through against a desktop VS Code is not verified yet.

**The extension inside the Agents window.** From VS Code 1.143 the extension declares that it can run in the Agents window too (`capabilities.agentsWindow` in its manifest), so its commands, its read-only tools for agents and its `ploeg-mcp` server definition are there as well. It recognises that window by the workspace VS Code opens in it, `agent-sessions.code-workspace` in your user settings folder, and stays quiet there: it shows no notifications, because the editor window already shows them and the Agents window marks a waiting session **Needs attention** itself, and it never claims the **Open the Work Item in VS Code** links, so those keep opening in the editor window. The Agents window draws no contributed views, status bar or walkthrough, and its workspace is no checkout, so its Command Palette leaves out **Refresh**, **Refresh Tasks** and **Refresh Work** (they refresh views it does not show), **Open Agents Window** (you are in it), **Send Selection to Remote Session…** and **Send Current File to Remote Session…** (they send a file from your checkout) and **Follow Hand-offs in a Claude Code Terminal** (it starts `claude` in the workspace folder); an editor window keeps offering all of them. The palette tells the windows apart by VS Code's own `isSessionsWindow` context key; the extension's code reads the workspace file, because VS Code gives an extension that flag only through a proposed API. To keep it out of the Agents window, set `"extensions.supportAgentsWindow": {"unfold-hq.unfold-workbench": false}` in your user settings. VS Code 1.142 and older ignore the declaration. Checked on 2026-10-24 in a desktop VS Code 1.143.1 with a separate profile: the extension activates in both windows, the Agents window reports `agent-sessions.code-workspace` under the user settings folder as its workspace and an editor window on a folder reports none, and the three tools below are registered in both. That it draws no views, status bar or walkthrough is read in the VS Code 1.147.0 source, not seen in a running window. Not checked yet: which of the extension's panels the Agents window shows, the palette there, and the quiet behaviour while signed in to a workbench.

The entry carries a personal connection token in plain text, because VS Code 1.144 reads it only from there: the setting has no machine scope, and the Agents window takes no token from SecretStorage or a header. So that Settings Sync never uploads it, the extension adds `chat.remoteAgentHosts` to `settingsSync.ignoredSettings` before it writes a token, and leaves it there after you sign out. Your other remote agent hosts then stop syncing too; remove the line from `settingsSync.ignoredSettings` if you want them synced and accept that the token travels with them. A token that sat in a synced entry before is replaced and revoked on the workbench. The extension keeps a copy in SecretStorage and reuses it while the workbench accepts it, and checks it with an `Authorization` header so the check puts no token in a URL. Set `unfold.agentHost.autoConnect` to `false` to connect only through the command. If `settings.json` cannot be parsed or written, nothing changes and **Copy address** offers the manual route: in the Agents window, run **Sessions: Add Remote Agent Host…** and paste the copied `wss://…?tkn=…` address. The [operations guide](https://github.com/unfold-hq/unfold/blob/development/apps/unfold/docs/operations/live.md#attaching-vs-code-as-an-agent-host-client) has the details.

## Use Ploeg's tools in VS Code chat

When the workbench names a remote Ploeg MCP server, the extension provides it to VS Code's chat as **Ploeg** (VS Code 1.101 or later). The definition holds only the server's URL: no token, no header, nothing secret on disk. When chat first uses a Ploeg tool, VS Code opens your browser to sign in at the workbench's identity provider and keeps the token in its own secret storage, with a refresh token from 1.142 on.

VS Code asks for a client ID the first time. An extension's server definition has no field for one, and the identity provider does not register clients on the fly, so VS Code says the authorization server "does not support automatic client registration". Choose **Copy URIs & Proceed**, enter the client ID the extension shows you (on the homelab, `ploeg-mcp`) and leave the client secret blank. VS Code remembers it for that server.

To skip that question, run **Unfold: Add Ploeg MCP Server to VS Code**. It opens VS Code's own install view for a user `mcp.json` entry with the URL and `oauth.clientId`, and turns off the extension's copy so the tools do not appear twice. **Copy mcp.json Entry** copies the same entry for an editor without that install view. `unfold.mcp.provideServers` turns the provider off.

The extension does not provide `unfold-mcp`, the server for Unfold's own reasons and sessions. It runs on your machine with your `UNFOLD_TOKEN` in its environment, and VS Code writes an extension's server environment to disk in plain text when it passes servers to agent-host harnesses. Add it yourself as [the guide](https://github.com/unfold-hq/unfold/blob/development/docs/how-to/ask-from-an-ai-client.md#unfold) shows, until `unfold-mcp` also runs remotely behind a browser sign-in.

Not verified against a desktop VS Code: the sign-in through the provider and the client ID question, the install view keeping `oauth.clientId`, and whether the Copilot, Claude and Codex harnesses in the Agents window can sign in to a forwarded Ploeg server. VS Code 1.142 forwards the URL to them but drops the client ID.

## Follow hand-offs in a Claude Code terminal

Claude Code shows MCP tasks in its terminal CLI only, from 2.1.304 on, and not in its VS Code panel. **Unfold: Follow Hand-offs in a Claude Code Terminal** checks `claude --version` (and links the install guide or offers `claude update` when it is missing or older), runs `claude mcp list` to find your `unfold-mcp` server, writes each check to the **Unfold: Claude Code** output (version, server, whether protocol 2026-07-28 would be negotiated, and any setting that turns tasks off), then opens an integrated terminal in the workspace running `claude`, where hand-offs appear under `/tasks`. Without an `unfold-mcp` server it offers to copy the `claude mcp add` command for this workbench. See [Follow hand-offs as tasks in a terminal](https://github.com/unfold-hq/unfold/blob/development/docs/how-to/follow-hand-offs-as-tasks-in-a-terminal.md). Not checked in a desktop VS Code yet.

## Tools for agents in VS Code

The extension lends agents in VS Code chat three read-only tools, so an agent session in the editor window can answer "what waits for me" or "where is this Work Item" without an MCP server:

- **Unfold: What Waits for Me** (`unfold_now`, `#unfoldNow`) lists what needs you, what is ready for your review and what is proposed, each with why it waits and the fix, the Runs that are running and the tracker tasks Ploeg refused to route.
- **Unfold: Work Item State** (`unfold_get_work`, `#unfoldGetWork`) gives one Work Item by id or `#work/<id>` link: its state and why it waits, the agent review and the pull request with its CI, the Runs, and spend against budget.
- **Unfold: Find Work Items** (`unfold_find_work`, `#unfoldFindWork`) finds Work Items by title words, a tracker id such as `VIK-123`, a Work Item id or a branch name. Without a query it uses the Git branch of the repository holding the active file.

They read the same workbench routes as the **Now** view and the Work Item panel, with this editor's sign-in, and change nothing.

Four more tools act on a Work Item, each only after you confirm in chat:

- **Unfold: Approve Work Item** (`unfold_approve_work`, `#unfoldApproveWork`) approves a proposal, so Ploeg queues it and its Runs spend from the Team's budget.
- **Unfold: Reject Work Item** (`unfold_reject_work`, `#unfoldRejectWork`) rejects a proposal with a reason; nothing runs.
- **Unfold: Try Work Item Again** (`unfold_retry_work`, `#unfoldRetryWork`) restarts a Work Item that needs you or went stale, with an optional note.
- **Unfold: Hand Work Item Back** (`unfold_hand_back`, `#unfoldHandBack`) hands a Work Item you took over back to Ploeg.

Before one runs, the extension reads the Work Item and VS Code shows a confirmation naming it, what will happen and, for a retry or a hand-back, what it may spend, read from Unfold. Declining sends nothing. The extension acts only on the plan you were shown: when the Work Item changed in between, or the confirmation is older than ten minutes or was already used, it changes nothing and says so. A refusal, such as a viewer's or one for a Work Item outside your Teams, comes back in Unfold's words. Each action goes through the browser's route and is recorded in Unfold's Action Records under this editor's sign-in with the channel `VS Code chat` and the hash of the text you agreed to. VS Code lets you skip its confirmation for a tool (**Allow in this Session**, **in this Workspace**, **Always**, or the global auto-approve setting); choosing that lets an agent act without asking you each time, so leave these four tools out of it. Stop, take over and steer are not chat tools of the extension; use Unfold's web page or `unfold-mcp`. The action tools are not checked in a running VS Code yet.

All seven tools are offered only while the extension is signed in (`unfold.connected`). Titles, questions and reports that come from a tracker or an agent are quoted and labelled as untrusted data, as `unfold-mcp` does. Signed out or offline, a tool answers in one sentence and names **Unfold: Connect to Workbench**. An administrator turns extension tools off for everyone with VS Code's `ChatAgentExtensionTools` policy, and from VS Code 1.147 also by turning MCP off. [In a managed VS Code](https://github.com/unfold-hq/unfold/blob/development/docs/how-to/install-the-unfold-plugin.md#in-a-managed-vs-code) lists what an organisation's policies switch off in Unfold and what to allow. The tools need an editor with the language-model tool API; on one without it the extension runs as before. In a desktop VS Code 1.143.1 all three are listed in `vscode.lm.tools` in the editor window and in the Agents window (checked 2026-10-24); an agent calling them in chat is not checked yet.

### The Unfold skill, instructions and plugin

From VS Code 1.144, the extension also brings what tells chat how to work with Unfold, so you do not have to install it separately. While you are signed in, VS Code's Agent Customizations editor lists:

- the **operate-agent-session** skill, for operating a durable agent session and preparing a reviewable hand-off;
- the **unfold** instructions, which say what Unfold is, which of the three tools to call, and that tracker and agent text is untrusted data;
- the **unfold** Agent Plugin, provided by this extension, with its `unfold`, `link-work-item` and `brief` skills. VS Code reads it as an Agent Plugins v1 package, so only its skills reach VS Code; `brief` works only in Claude Code.

Signed out, offline, or before you first sign in, none of the three is active. An editor older than 1.144 ignores them and the extension runs as before.

If you also installed the Unfold plugin from a marketplace ([Install the Unfold plugin](https://github.com/unfold-hq/unfold/blob/development/docs/how-to/install-the-unfold-plugin.md)), VS Code 1.147 lists two **unfold** plugins and enables both, without a duplicate notice: it groups copies by marketplace and name, and a plugin an extension provides has neither, so the two are never treated as one. Disable one of them in the Agent Customizations editor, or uninstall the marketplace copy. This is read in VS Code's source at tag 1.147.0, not yet seen in a running editor.

## See what waits on you

The Unfold sidebar opens on **Now**, the same list as the browser's Now page:

1. **Ready for your review**: Work Items whose pull request waits on a person, with the pull request number. The inline icon opens the pull request. A pull request whose CI is still running says **CI running**; one whose CI did not pass is not ready for review and is listed under **Needs you** as **CI did not pass**, and its Work Item panel leads with the checks that did not pass.
2. **Needs you**: Work Items Ploeg stopped on, each led by its reason ("Budget ran out", "Agent is stuck", …), plus sessions that wait for your answer, stopped or failed. A Work Item that a session drives appears once, as the session.
3. **Proposed**: follow-up work an agent proposed, which runs only after a person approves it.
4. **Running**: each running session with the Role that works, its elapsed time and spend so far, and each other running Run with its Role, Round, elapsed time and the gateway's cost so far, which is not settled spend.

Select a row to open its Work Item panel; the second inline icon opens it in the browser. The activity-bar badge counts what is ready for your review or needs you, each Work Item once. The status bar shows the same counts and turns amber only when something needs you. While exactly one session runs, it names the working Role with a running clock, for example **Reviewer 0:41**, and a click opens that Work Item. A Ploeg Work Item that newly needs you raises a notification; with `unfold.notifications.workItems` set to `all`, so does one that newly becomes ready for review. Sessions you own notify on their own, as [Notifications](#notifications) describes.

## Follow the work you handed off

Whatever client you hand work off from, this VS Code follows it: the browser, this extension's task view, or an AI client that reaches Unfold through `unfold-mcp`, such as the Claude Code panel or terminal, GitHub Copilot, ChatGPT or claude.ai. Every hand-off is recorded under your name with its channel ([system ADR-0037](https://github.com/unfold-hq/unfold/blob/development/docs/adr/adr-0037-people-act-on-work-through-either-mcp-server-and-every-action-names-its-person-channel-and-confirmation.md)), and the extension reads your own hand-offs from `GET /api/handoffs`.

- **Handed off by you**, at the bottom of **Now**, lists your recent hand-offs, newest first: the title as the tracker wrote it, the Team, the state, why it waits on you, the pull request number once there is one, and the spend so far. A hand-off Ploeg has not listed as a Work Item yet reads **Waiting for Ploeg**. Select a row to open its Work Item panel, or the task while there is no Work Item yet. On a row that waits on your answer, the inline **Answer** icon answers it; on a row with a pull request, the inline icon opens the pull request.
- The status bar shows how many are in flight, for example **2 handed off**, with each one in its tooltip. It hides when none is. A click opens Now.
- A hand-off that starts waiting on you raises a warning with **Answer** and **Open Work Item**; one whose pull request is ready raises a notification with **Review** and **Open pull request**. Each change notifies once: the extension keeps what it announced in its global storage, so another VS Code window, or this one after a reload, stays quiet about it. What already waits when you first connect does not notify. A Work Item announced this way is not announced again as a Now Work Item. `unfold.notifications.handOffs` turns these notifications off; the list and the status bar stay.
- **Answer** asks for each question the Work Item waits on in an input box, then states what sending does and costs and waits for your confirmation, as the browser's Answer dialog does. When Ploeg offers to resume the Round that asked, you choose between resuming it and starting over. Your answers go through the same workbench routes the browser uses, and Ploeg records you as their author. Closing an input box or the confirmation sends nothing. The demo sends nothing either.

The list refreshes with Now, at most every 15 seconds while a view is visible and every 30 seconds while every view is closed and `unfold.notifications.needsYou` is on. It is not read faster for being a hand-off, and the extension does not pause when the window loses focus.

Claude Code's terminal shows the same hand-off as an MCP task. VS Code's chat clients, Copilot and the Claude Code extension, do not show MCP tasks, and an extension cannot change how their MCP client handles a tool result, so VS Code shows it here instead.

**Tasks** lists your team's tracker boards. A task Ploeg holds shows its state, for example "Ready for review" or "Needs you · Budget ran out". **Work** browses each Team's lanes. **Sessions** holds supervised sessions. It appears in the demo, with shared execution, or when you have sessions, and starts collapsed.

States, reasons, amounts and dates come from the browser's own modules, so both clients word them the same way: `US$ 1.234,50`, 24-hour times, and "Not reported" when spend is unknown, never zero. Each status tone is a theme colour you can change in `workbench.colorCustomizations`: `unfold.live` (running), `unfold.attention` (needs you), `unfold.review` (ready for review), `unfold.success`, `unfold.danger` and `unfold.severe` (stopped retrying, infrastructure failures). By default they follow your theme's own colours.

## Work and review

| Surface | What to use it for |
| --- | --- |
| Now | See what waits on you across every Team, and what is running |
| Sessions tree | Find active work, pending decisions, queued sessions and history. Expand a session for its team, evidence and source task |
| Brief | Read the objective, imported snapshot, retained transcripts, review candidate and handoff |
| Changes | Inspect captured patches by file |
| Checks | Read recorded check output and distinguish passing, failing and expected fixture failures |
| Activity | Inspect durable events, tool input/output and the brief supplied to each role |
| Gateway | Inspect attributed model requests, routing, cost and errors; open configured Grafana links |
| Work Item panel | See a Work Item's state, reason and next action, its pull requests with CI and reviews, cost per role and Runs; read the task, hand it to a Ploeg team or take it back, check out its branch, or start a supervised session. The header names the tracker ticket (`VIK-1505`, a link to it) and never a machine identifier, which stays in the tooltip on the header's first line; effort reads as **Agent runs** and **Attempts**, with Round and Shift explained on hover. When an Unfold session drives the Work Item, the panel leads with its progress: the header pill says the state once and the headline leads with the outcome ("Reviewer approved · 1 file +57 −45"), the working Role with a ticking clock and its last activity, the Steps (each Role's outcome and verdict, a cut-off Run and a verdict read only from its transcript marked as such, and a long report folded behind a plain-text preview of its first paragraph), the Change (files, lines, branch, candidate), what Unfold and Ploeg disagree about, and the actions that fit: **View change** in VS Code's multi-file diff editor, **Investigate** as a Markdown document, **Answer**, **Resume**, **Pause**, **Download change** (the Git bundle or patch, as **Unfold: Download Review Candidate**), **Accept** (it records your decision and pushes, merges and publishes nothing, which the panel says under the buttons), **Accept and open pull request** in its place on a verified gated candidate when the workbench publishes, **Reject**, **Open session**, and **Deliver approved work** (confirmed, it opens a pull request) or **Run again** (queues a new session) when the workbench's recovery answer offers them. It follows the session's event stream while visible. Ploeg's own Runs move under **As Ploeg records it** |
| Work tree | Browse each Team's lanes in a bounded snapshot. A Work Item opens its panel; the inline icon opens it in the browser |

**Check Out Branch**, in the Work Item panel and on Now and Work rows, opens the branch Ploeg works on in its own git worktree, in a new window, so the open clone of the Work Item's repository stays on its branch. It reads the Work Item from the workbench, finds the open folder with a remote that points at the target repository's full path on the forge of its pull request link, fetches the branch, and adds a worktree beside that clone named after the clone and the branch (`shop-agent-vik-50` beside `shop`), creating a local tracking branch when there is none. A worktree that already has the branch is reused. It fast-forwards the branch when it is only behind and leaves a diverged branch as it is. Without a matching clone it offers the git command and, when the forge is known, **Clone repository**. The browser's **Open in VS Code** opens `vscode://unfold-hq.unfold-workbench/checkout?workItem=<id>&origin=<workbench>`: the extension refuses a link for another workbench than the one it is connected to, and always asks before it adds a worktree. Demo Work Items have nothing to check out. A remote host matches the forge when it is the same host, when both share a parent domain below their first label (`forgejo-ssh.example.dev` and `forgejo.example.dev`), or when `unfold.remoteHostAliases` maps it to the forge, for example `{"ssh.git.example.com": "git.example.com"}`. Before the Work Item has a pull request link, a clone of the same full path on any host matches.

The team strip distinguishes implementation, analysis and the final independent review. Earlier read roles supply analysis. Writing teams require an explicit final approval. A completed session awaits the person's review; accept or reject it from the toolbar or **Record Review** command. Rejection requires a reason, and the decision records the person who made it. Accept only records your decision in the session; nothing is pushed or merged.

A session under a delivery policy, on a workbench whose delivery view reports `publicationEnabled`, offers **Accept and open pull request** instead, once its independent checks passed, as the primary action in the session panel and the Work Item panel, or through **Unfold: Accept and Open Pull Request**. After a confirmation it sends the candidate, receipt and policy the panel displayed to the workbench's publish route, which approves the commit when needed and opens one pull request; merging stays with you. The panels then show the pull request stage: **Publishing…**, **Pull request #N** with **Open pull request #N ↗**, **Needs recovery** with what stopped it, or **Refused**. A candidate whose checks did not pass is never offered it.

Permission and question cards wait for an explicit answer. **Allow once** grants the displayed request; broader choices appear only for declared patterns. Container and Kubernetes sessions can switch between **Approve automatically** and **Ask me again** while active. Local-backend sessions always ask, and questions require an answer in either mode.

Start, pause, resume and cancel follow the server's permitted transitions. Cancellation does not create replacement work. An instruction is saved for the next execution; **Pause the active run first** pauses before saving it. The composer distinguishes a local draft, sending, saved and delivery unknown.

No API mutation is retried automatically. A read that meets an unreachable workbench or a gateway error is retried once. If a response is lost, refresh before repeating the action: the server may have accepted it. Shared execution also has stricter recovery and budget rules than standalone mode. In particular, the current shared API does not support the standalone additional-budget operation. See the [HTTP contract](https://github.com/unfold-hq/unfold/blob/development/apps/unfold/docs/contracts/api.md).

The spending card distinguishes authorization, observations, holds and settlement. Unknown spend is not zero. Gateway data can arrive late and cannot prove an exact ceiling for requests already in flight.

## Work from a task

An administrator configures sources on the workbench. Registered Forgejo, GitHub, GitLab, ClickUp and Vikunja sources appear in both clients. Tracker credentials stay on the server. Personal GitLab account linking is available through **Unfold: Linked Accounts**; it does not automatically register a task source. Configuration and scope limits are in the [task connection guide](https://github.com/unfold-hq/unfold/blob/development/apps/unfold/docs/operations/task-connections.md).

Select a task to open its task view. The description is rendered from the tracker as inert text; links open in your browser only when they use HTTPS. The head of the panel says whether Ploeg already has the task, what state it is in, why, and what happens next.

**Hand to Ploeg** is offered on boards that Ploeg owns. Choose a team and confirm: the workbench assigns that team's tracker user and comments that you handed it over, which is how Ploeg receives work. Ploeg queues it, works on a branch and opens a pull request for review. **Take back** removes the assignment while the item is still queued; work that has started is cancelled from the browser's Work Item page. Viewers can read the task view but cannot hand work over. Older workbench servers show the task without Ploeg status.

**Start a supervised session** prepares operator-led work instead: choose the team and authorization, then confirm the workbench and task revision. A stale revision requires a fresh preview. Repeating the same import reopens its existing session; it does not create another paid attempt. Import prepares queued work; Start begins execution. Standalone import requires an interactive source and repository. In shared mode, registered Vikunja and ClickUp targets can bind to the existing Ploeg Work Item, which is claimed on Start. Import itself does not mutate the tracker. Source text cannot select another repository or change execution authority.

## See which Work Item changed a file

On VS Code 1.145 or later, open the Timeline of a file in a Git repository and keep the **Unfold** source on. It lists the Work Items whose merged pull request changed the file, with the title, merge date and pull request number. Choose one to open the Work Item; the pull request icon beside it opens the pull request.

For each file the extension runs one `git log --first-parent -- <file>` in its repository and matches those commits to the merge and head SHAs of the pull requests on your done Work Items for the same repository. That list is read once per repository through your own sign-in, from the newest closed Work Items of up to six of your Teams, and kept for ten minutes; **Refresh** in the Timeline reads it again. A pull request merged by rebase shows only on the file its last commit changed, and older Work Items beyond those pages are not listed. Signed out, in an untrusted workspace or in the demo, the source lists nothing. Older editors get no Unfold source.

## Bring back evidence

The **Brief** tab shows the review candidate when capture is available. **Download Git bundle**, **Download patch** and **Download manifest** each ask for a local destination. **Unfold: Download Review Candidate** offers the same choices.

The bundle preserves exported Git objects, including binary content, modes and deletions. The patch describes changes against the recorded base; the manifest identifies the captured state. An export alone does not certify independent verification or permission to publish.

Downloads authenticate to the workbench, refuse redirects, enforce a size limit and verify bundle/patch digests before saving. Existing destination files are preserved. An unavailable capture keeps its explanation visible. The extension does not execute, apply or merge downloaded changes automatically.

**Open Evidence** opens retained patches, checks and summaries as read-only documents. A patch view is not a live remote filesystem or native comparison of complete base/head files.

## Send editor context

Use **Unfold: Send Selection to Remote Session…** or **Unfold: Send Current File to Remote Session…**. Select the destination, inspect the preview and confirm. The preview names the workbench, session, repository, file, range and unsaved-buffer state.

Each attachment is limited to 12,000 characters and becomes a durable instruction. It does not upload the repository or synchronize the checkout. Workspace Trust is required. Review the content before sending; this is not a channel for credentials.

## Connection and privacy

A failed refresh keeps the last loaded sessions and tasks on screen and says the extension is reconnecting; the views switch to offline after three consecutive failures or an expired sign-in. Open panels consume the server event stream, with polling as a fallback. The footer distinguishes live, polling and disconnected states. Disconnection disables panel mutations; closing the editor does not stop remote work. **Open complete history** fetches retained events beyond the bounded panel buffer. Now refreshes at most every 15 seconds and the Work tree every 30 seconds while visible; both use snapshots rather than a lossless subscription.

Configure `unfold.liveUpdates` and the polling interval in settings. No global keyboard shortcuts are registered; the composer supports Ctrl+Enter or Cmd+Enter.

## Notifications

When a session you own needs you, the extension shows one VS Code notification with the action that fits. The wording and the action come from the same progress states the browser and the Agents window read ([`public/core/progress.js`](https://github.com/unfold-hq/unfold/blob/development/apps/unfold/public/core/progress.js)).

| The session | Notification | Primary action |
| --- | --- | --- |
| asks a question or asks permission | warning naming the request | **Answer** opens the request in the session panel |
| has a result ready for your review | information with the change size | **Review** opens the change |
| stopped, and the server offers delivery | warning with what was achieved and why it stopped | **Deliver**, after the same confirmation as in the panel |
| stopped, and the server offers to resume or run again | warning | **Open** |
| failed | warning with the failing stage | **Open** |

Each state change notifies once. A poll that finds the same state again is silent; a session that leaves a state and returns to it, or asks a new question, notifies again. What already waits when you connect does not notify; the badge and the status bar show it. Sessions other people own, and every session in the demo, never notify. A Work Item that one of your sessions drives notifies once, as the session.

The extension reads the session list on every refresh. An open session panel also forwards its live event stream, so a question, stop or result there refreshes within a second instead of at the next poll. With every Unfold view closed, the extension still checks every 30 seconds while `unfold.notifications.needsYou` is on. Turn that setting off to stop these notifications; `unfold.notifications.workItems` covers Ploeg Work Items on Now, and `unfold.notifications.handOffs` the work you handed off, as [Follow the work you handed off](#follow-the-work-you-handed-off) describes. An older `unfold.notifications` value moves to `unfold.notifications.workItems` on activation, and `none` also turns `unfold.notifications.needsYou` off.

**While the window is in the background.** VS Code 1.141 shows an extension's notifications inside the window only. It sends no operating-system notification and does not flash the taskbar or bounce the Dock for them, and the extension API has no call that does. A notification that arrives while the window is unfocused stays until you return, because its hide timer starts only once the window has focus again ([`notificationsToasts.ts:381-415`](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/browser/parts/notifications/notificationsToasts.ts#L381-L415)). VS Code 1.141 raises operating-system notifications only for its own chat and Agents window sessions, under `chat.notifyWindowOnConfirmation` and `chat.notifyWindowOnResponseReceived`, both `windowNotFocused` by default ([`chatWindowNotifier.ts:120-175`](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/contrib/chat/browser/chatWindowNotifier.ts#L120-L175), [`sessionsWindowNotifier.ts:97-150`](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/sessions/contrib/sessions/browser/sessionsWindowNotifier.ts#L97-L150)). Those notifications cover sessions that VS Code itself shows, so they can also cover an Unfold session opened in the Agents window; they do not cover this extension's notifications. For an operating-system notification outside VS Code, keep an Unfold browser tab open with desktop notifications turned on in Preferences.

Cookies remain in the extension host. The webview receives public session data through a narrow message protocol, never login secrets, inference keys or Kubernetes credentials. Its scripts and styles are packaged locally; the content security policy blocks network connections and remote code. The server origin is application-scoped, so workspace settings cannot redirect it. [Access gateway headers](#connect-through-an-access-gateway) stay in SecretStorage too and go only to the workbench they were stored for. There is no cross-origin credential forwarding or disabled certificate verification.

The extension implements no analytics or background repository uploads. Drafts can persist in local webview state; saved instructions and evidence follow the workbench's retention policy.

## Develop and validate

Open this directory in VS Code, install its dependencies, then use the included **Run Unfold Extension** F5 configuration. Keep the local demo server available. From the repository root:

```sh
mise exec -- npm ci --prefix extensions/vscode
mise exec -- npm run extension:build
mise exec -- npm run extension:test
mise exec -- npm run extension:package
mise exec -- npm run extension:verify
```

[Client integration tests](https://github.com/unfold-hq/unfold/blob/development/apps/unfold/extensions/vscode/test/client.test.ts) exercise the actual server with local fixtures. [Webview tests](https://github.com/unfold-hq/unfold/blob/development/apps/unfold/extensions/vscode/test/webview.test.ts) inspect the shipped panel script; other tests cover status, authorization and account flows. These checks do not use paid providers. Node tests and browser rendering do not substitute for an actual Extension Development Host check. The [validation matrix](https://github.com/unfold-hq/unfold/blob/development/apps/unfold/docs/validation.md) records what has been exercised.

`npm --prefix extensions/vscode run package:insiders` builds the Unfold Insiders VSIX in `extensions/vscode/dist-insiders/`. Code that calls a proposed API goes through `ProposalGuard` in `src/proposals.ts`: `usable(name)` says whether it may be tried, and `use(name, call)` runs it and returns `undefined` when VS Code refuses the proposal or lacks the API, so the caller falls back. The proposals' type definitions are the exact `vscode.proposed.<name>.d.ts` files of microsoft/vscode at one pinned commit, checked in under `extensions/vscode/proposed/`, rather than `npx @vscode/dts dev`, which downloads whatever `main` holds at that moment and reads the list from `enabledApiProposals`, which the regular manifest does not have. To move them, download the same files at a newer commit, name it in the changelog, and adjust the code to any change. Proposals change without a version number.

For API maintenance, use the official [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host), [webview](https://code.visualstudio.com/api/extension-guides/webview), [SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) and [extension testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension) documentation.
