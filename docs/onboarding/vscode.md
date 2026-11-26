---
type: how-to
audience: [operator, developer]
owner: unfold
last_verified: 2026-11-26
verified_by: "On 2026-11-26 three rows were added to 'When something goes wrong' for VS Code 1.148 (Remote Environments, the diagnostic report, a laptop that slept), read in microsoft/vscode at tag 1.148.0 (remotesModel.ts, remotesTable.ts, sessionEnvironmentPicker.ts, connectionDiagnosticsService.ts, connectionDiagnosticsLogs.ts, reconnectPolicy.ts) following apps/unfold/docs/research/2026-11-26-vscode-1-148-fit.md; not run in VS Code. Earlier: Read apps/unfold/extensions/vscode/package.json (identity unfold-hq.unfold-workbench, commands, views Now/Tasks/Work/Sessions, settings; it declares no chat participant), its README, src/extension.ts, src/client.ts, src/browser-login.ts, src/auth-provider.ts, src/task-panel.ts and media/task.js for button names and error text; apps/unfold/public/views/editors.js and editor-sign-in.js for Settings › Signed-in editors and Connect VS Code; .github/workflows/on_release_published.yml and scripts/extension_version.py (Marketplace publication not paused) for how the extension ships; docs/how-to/install-the-unfold-plugin.md (In a managed VS Code); apps/unfold/docs/operations/live.md and configuration.md for the agent host and its settings; apps/unfold/docs/features.md. Checked on 2026-11-24 that release unfold-v0.4.0-rc.181 carries the VSIX, its .sha256 and .sigstore.json, and that Open VSX and the Visual Studio Marketplace list unfold-hq.unfold-workbench as a pre-release. Nothing was run against a live installation or in a running VS Code."
---

# VS Code onboarding

The Unfold extension for VS Code shows what waits on you, lets you answer agents, review their change and check out a Work Item's branch without leaving the editor. It signs in to your Unfold installation and runs no agent itself.

Status: every release so far is a release candidate, so the extension is published as a pre-release. Several parts are described in the [extension README](../../apps/unfold/extensions/vscode/README.md) as not yet checked in a running VS Code, among them the chat action tools and opening a session from a link in the Agents window.

## Admin: connect VS Code once

Nothing has to be switched on in Unfold for the extension to sign in. These settings decide how much of it works for everyone.

Before you start:

- You can change your installation's configuration ([Configuration](../../apps/unfold/docs/operations/configuration.md)).
- If your organisation manages VS Code with policies, you know who maintains them.

1. Set `UNFOLD_BASE_URL` (or `baseUrl`) to the public HTTPS address of Unfold, such as `https://unfold.example.org`. The extension needs HTTPS and an address at `/`; a path below it is not supported. The **Open in the browser** links in the Agents window need this address too.
2. If you set `auth.agentHostOriginMode` to `enforce`, keep `vscode-file://vscode-app` in `auth.agentHostOrigins`, or the Agents window cannot connect ([Who may open the WebSocket](../../apps/unfold/docs/operations/live.md#who-may-open-the-websocket)).
3. Optional: to give developers Ploeg's tools in VS Code chat, set `UNFOLD_PLOEG_MCP_URL` and `UNFOLD_PLOEG_MCP_CLIENT_ID` together. Without them, **Unfold: Add Ploeg MCP Server to VS Code** says the workbench names no Ploeg MCP server.
4. In a managed VS Code, allow the extension `unfold-hq.unfold-workbench` in your private extension marketplace, leave `ChatAgentMode` and `ChatAgentExtensionTools` on, and keep MCP access above `none`. The full list is in [In a managed VS Code](../how-to/install-the-unfold-plugin.md#in-a-managed-vs-code).
5. If Unfold sits behind an access gateway such as Cloudflare Access, give developers a credential the gateway accepts in a request header. The Agents window sends no headers, so behind a gateway it stays **Not connected** ([Connect through an access gateway](../../apps/unfold/extensions/vscode/README.md#connect-through-an-access-gateway)).

Done when a developer signs in with **Unfold: Connect to Workbench** and their editor appears under **Settings › Signed-in editors** in the browser.

Full detail: [Attaching VS Code as an agent host client](../../apps/unfold/docs/operations/live.md#attaching-vs-code-as-an-agent-host-client).

## Developer: follow and steer agent work from VS Code

You need VS Code 1.99 or later, and 1.143 or later for the Agents window. You need an operator account in Unfold to connect the Agents window or create work; a viewer account can only look.

1. **Install the extension.** In the Extensions view, search for `unfold-hq.unfold-workbench` and choose **Switch to Pre-Release Version**. VSCodium and Cursor install it from [Open VSX](https://open-vsx.org/extension/unfold-hq/unfold-workbench). You can also download `unfold-<version>.vsix` and its `.sha256` from a [GitHub release](https://github.com/unfold-hq/unfold/releases), check it with `shasum -a 256 -c unfold-<version>.vsix.sha256`, and choose **Extensions → … → Install from VSIX**. If you have the old `unfold-hq.unfold`, uninstall it first.
2. **Sign in.** Run **Unfold: Connect to Workbench** and enter your Unfold address, such as `https://unfold.example.org`. VS Code shows a short code and opens the browser. Approve the request only if the browser shows the same code. The browser then says **Approved**; return to VS Code, which finishes on its own. The sign-in lasts thirty days, and you can sign it out under **Settings › Signed-in editors**.
3. **See what waits on you.** Open the **Unfold** activity bar. **Now** lists **Ready for your review**, **Needs you**, **Proposed** and **Running**, and **Handed off by you** at the bottom. **Tasks** shows your team's tracker tasks, **Work** each Team's Work Items. Select a row to open its Work Item panel.
4. **Follow and answer.** After sign-in, Unfold appears in VS Code's Agents window within seconds. Use **Unfold: Open in Agents Window** on a row to follow its Rounds there. When an agent asks something, the session says **Needs attention**: answer in the chat and choose **Answer and resume Round n** or **Only save my answers**. In the editor window, the **Answer** icon on a **Now** row does the same after it shows what resuming costs.
5. **Hand a task over.** Open a task under **Tasks**, pick a Team under **Hand to Ploeg** and choose **Hand to <team>**. While it is still queued, **Take back from <team>** undoes it.
6. **Work on the branch yourself.** **Check Out Branch** in the Work Item panel opens the Work Item's branch in its own git worktree, beside your clone, in a new window. Taking a Work Item over is not an action of the extension: do it from Claude Code ([Claude Code onboarding](claude-code.md)) or the browser. To give it back, ask VS Code chat to use **Unfold: Hand Work Item Back** and confirm.

When it works, the status bar counts what needs you and turns amber when something does, and a notification appears when a session you own asks a question or has a result ready. Review and merge the pull request on your forge: neither VS Code nor Unfold merges it for you ([Review an agent's pull request](../how-to/review-an-agent-pr.md)).

When it fails, the error names the cause. `Use HTTPS for a remote server. HTTP is supported only on localhost.` means the address was `http://`. `The browser sign-in was not approved in time. Start it again.` means the code was not approved in time. An access gateway shows **Unfold: access gateway** in the status bar; run **Unfold: Set Access Gateway Headers**.

More: [the extension README](../../apps/unfold/extensions/vscode/README.md), [Follow the work you handed off](../how-to/follow-handed-off-work.md), [Install the Unfold plugin](../how-to/install-the-unfold-plugin.md#vs-code) for the skills and MCP server in VS Code chat.

## When something goes wrong

| What you see | Why | What to do |
| --- | --- | --- |
| `Use HTTPS for a remote server. HTTP is supported only on localhost.` | The workbench address starts with `http://` | Enter the `https://` address |
| `Use the server origin without credentials, path, query or fragment.` | The address has a path, such as `/unfold` | Enter only the origin; Unfold must be served at `/` |
| `The browser sign-in was not approved in time. Start it again.` | The code was not approved in the browser in time | Run **Unfold: Connect to Workbench** again |
| **Unfold: access gateway** in the status bar | A gateway in front of Unfold wants its own sign-in | **Unfold: Set Access Gateway Headers** with the header the gateway accepts |
| `Your viewer account can inspect sessions. An operator account is required to connect the Agents window.` | Your Unfold role is viewer | Ask your admin for an operator account |
| `The workbench at <host> does not serve the Agent Host Protocol.` | This workbench offers no Agents window connection | Ask your admin; the editor window still works |
| `This VS Code has no Agents window. It needs VS Code 1.141 or later.` | Your VS Code is too old | Update VS Code |
| Agents window shows **Not connected** | The token was refused, or a gateway sits in front | Choose **Reconnect** or **Troubleshoot**; the **Agent Host** output channel says why |
| Remote Environments has no Unfold row | VS Code 1.148 lists Unfold there only when an extension registered it, as Unfold Insiders does; the regular extension writes a `chat.remoteAgentHosts` entry | Manage that entry from its own entry in the Agents window's environment picker ([Unfold in Remote Environments](../../apps/unfold/extensions/vscode/README.md#unfold-in-remote-environments)) |
| You want to share a connection diagnostic report | The report from **Troubleshoot Connection...** names every environment the window knows, with its address, but not the token | Read it before you post it ([Before you share a diagnostic report](../../apps/unfold/extensions/vscode/README.md#unfold-in-remote-environments)) |
| The Agents window shows old state after the laptop slept | It reconnects after waking, retrying for about three minutes; the work ran on in Ploeg | Wait, or choose **Reconnect** |
| `The workbench at <origin> names no Ploeg MCP server, or you are not signed in. Its operator sets UNFOLD_PLOEG_MCP_URL and UNFOLD_PLOEG_MCP_CLIENT_ID.` | The Ploeg server for chat is not configured | Admin step 3 |
