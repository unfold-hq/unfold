---
type: how-to
audience: [owner, operator]
owner: unfold
last_verified: 2026-11-19
verified_by: "Copilot session parts added on 2026-11-19, read in microsoft/vscode at tag 1.147.0 (pluginParsers.ts, hookTypes.ts, AGENTS_PLUGINS.md, extensions/copilot chatHookService.ts) and run as test/agent-plugin.test.ts and test/claude-code-plugin.test.ts; not run in VS Code. On 2026-11-19 'An install link' was re-read against pluginUrlHandler.ts at microsoft/vscode tag 1.147.0, 'Turn the plugin on for a repository' read in copilotRepositoryPluginSettings.ts and copilotAgent.ts at 1.147.0, and the private marketplace row, 'Tell people where to ask', 'Open Unfold links in the integrated browser' and 'Behind a proxy' read against the 1.146 and 1.147 release notes, code.visualstudio.com/docs/enterprise/extensions and /docs/setup/network, docs.github.com enterprise-managed-settings, microsoft/vscode#341049 and #347494, and configuration.ts and browserTabManagementFeatures.ts at 1.147.0; every link was fetched that day. Nothing was run in a VS Code, no repository settings file or proxy was tried. Section 'In a managed VS Code' added on 2026-11-19: read against code.visualstudio.com/docs/enterprise/policies, /docs/enterprise/manage-ai-settings, /docs/agent-customization/agent-plugins, the 1.145, 1.146 and 1.147 release notes and docs.github.com enterprise-managed-settings reference, all fetched that day; the (source) statements read in microsoft/vscode at tag 1.147.0 (languageModelToolsService.ts against 1.146.0, copilotManagedSettings.ts, agentHostStarter.config.contribution.ts, pluginUrlHandler.ts). No policy was deployed, no allow-list tried and neither install link clicked. Earlier: read apps/unfold/extensions/claude-code against the Agent Plugins 1.0.0 specification and schemas at agentplugins/agent-plugins-spec ff8ab5e; ran test/agent-plugin.test.ts. VS Code steps read in the VS Code 1.144.0 source (pluginUrlHandler.ts, marketplaceReference.ts, pluginMarketplaceService.ts, AGENTS_PLUGINS.md). Codex steps read in the openai/codex main branch source on 2026-10-30 (marketplace_cmd.rs, marketplace.rs, plugin_namespace.rs, agent_plugin_config.rs), not the 0.166.0 tag. Copilot CLI steps read in its plugin reference and changelog up to 1.0.105. Cursor and Kiro steps read in their documentation only. No install was run in any of these clients, and no client signed in to unfold-mcp from a plugin."
---

# Install the Unfold plugin in Codex, Cursor, Copilot and VS Code

**Goal:** your agent knows Unfold. It gets two skills, `unfold` (how to use Unfold's MCP tools) and `link-work-item` (link a session to a Work Item), and, when your operator publishes it, the connection to your Unfold's MCP tools. For Claude Code, which also reports sessions and records Agent Trace, follow [Link your Claude Code sessions](link-claude-code-sessions.md#1-install-the-plugin-with-your-unfold-address) instead.

One directory, [`apps/unfold/extensions/claude-code`](../../apps/unfold/extensions/claude-code/README.md), is the plugin for every client. Its root `plugin.json` is an [Agent Plugins 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md) manifest, which these clients read before any client-specific one. Claude Code reads `.claude-plugin/plugin.json` in the same directory.

Each step says how far it was checked:

* **Source**: read in the client's source code. Not run.
* **Docs**: read in the client's documentation or changelog. Not run.
* **Not checked**: an assumption from the two above.

## What each client gets

| Client | Installs from this repository | Skills | Unfold's MCP tools | Session reporting |
| --- | --- | --- | --- | --- |
| Codex | yes, marketplace (Source) | yes (Source) | from your operator's marketplace, or `codex mcp add` | the separate [Codex reporter](link-opencode-and-codex-sessions.md) |
| GitHub Copilot CLI | yes, marketplace (Docs) | yes (Docs) | from your operator's marketplace, or your own MCP settings | no |
| VS Code (Copilot agent plugins) | yes, `chat.plugins.marketplaces` or an install link (Source) | yes (Source) | from your operator's marketplace, or your `mcp.json` | Copilot sessions, from VS Code 1.145, with `UNFOLD_URL` in VS Code's environment (Source) |
| Cursor | no, copy the folder (Docs) | yes (Docs) | your `~/.cursor/mcp.json` | no |
| Kiro | no, import the folder (Docs) | yes (Docs) | your Kiro MCP settings | no |

The `brief` skill also loads in every client, but its scripts need Claude Code's `${CLAUDE_PLUGIN_ROOT}`, so it only works in Claude Code. Claude Code runs the plugin's hooks from `hooks/hooks.json`. VS Code's Copilot sessions run four of them from `com.github.copilot/hooks/hooks.json`, and also get the commands, an `Unfold` agent and a rule from that folder; the commands that need a script name the Claude Code command instead ([plugin README](../../apps/unfold/extensions/claude-code/README.md#copilot-sessions-in-vs-code)). Portable hooks wait for the specification ([agent-plugins-spec #89](https://github.com/agentplugins/agent-plugins-spec/pull/89), a draft).

## Why the MCP connection is a second plugin

The `unfold` plugin ships no `mcp.json`, because it works with any Unfold installation. Agent Plugins 1.0.0 forbids placeholders in a remote server's `url` and has no field for an OAuth client id, so an `mcp.json` names exactly one installation. An operator therefore generates a small second plugin, `unfold-mcp`, whose `mcp.json` names their own unfold-mcp endpoint, and publishes it next to the pinned `unfold` plugin ([below](#for-operators-publish-a-marketplace-for-your-installation)). It holds no credential. Each client signs you in through the browser itself.

Sign-in needs a client id when the identity provider supports neither Dynamic Client Registration nor Client ID Metadata Documents. Authentik, which [Serve Unfold's MCP tools over HTTPS](serve-unfold-mcp-over-https.md) uses, supports neither, so the client must send `unfold-mcp`:

* **VS Code** asks you for a client id and secret when registration fails (Source). Enter `unfold-mcp` and leave the secret empty.
* **Codex** has no prompt (Source). Add the server yourself with the client id, as below.
* **Copilot CLI** has a static client id setting (Docs). Whether it prompts for one: Not checked.
* **Cursor** and **Kiro** take a client id only in their own MCP settings (Docs), so add the server there.

## Codex

```sh
codex plugin marketplace add https://github.com/unfold-hq/unfold.git
codex plugin add unfold@unfold
```

Source: Codex accepts any HTTPS git URL as a marketplace, reads `.claude-plugin/marketplace.json` when the repository has no `.agents/plugins/marketplace.json`, and takes the root `plugin.json` over `.claude-plugin/plugin.json`. Codex was not run against the repository's forge.

For the MCP tools without an operator marketplace:

```sh
codex mcp add unfold --url https://unfold.example.com/mcp --oauth-client-id unfold-mcp
```

Source: the `--url` and `--oauth-client-id` flags. Not run.

## GitHub Copilot CLI

```sh
copilot plugin marketplace add https://github.com/unfold-hq/unfold.git
copilot plugin install unfold@unfold
```

Docs: Copilot CLI reads `.claude-plugin/marketplace.json` after `marketplace.json`, `.plugin/marketplace.json` and `.github/plugin/marketplace.json` (this repository has none of those), and a root `plugin.json` with the Agent Plugins `$schema` takes precedence. The reference shows only github.com URLs; a Forgejo URL is Not checked.

## VS Code

Add the marketplace to your user settings, then install **unfold** from the **Agent Customizations** editor, or with **Chat: Install Plugin from Source**:

```json
"chat.plugins.enabled": true,
"chat.plugins.marketplaces": ["https://github.com/unfold-hq/unfold.git"]
```

Source: VS Code accepts an HTTPS URL as a marketplace, with or without `.git`, and `#<ref>` after it pins a branch, tag or commit. It reads the same `.claude-plugin/marketplace.json`. Its Claude agent harness gets only remote MCP servers from an Agent Plugins package, not the skills.

### An install link

VS Code 1.147 opens `vscode://chat-plugin/install?source=<marketplace>&plugin=<name>`, with an optional `&harness=copilot` or `&harness=vscode`. Put it behind a button on your own page:

```html
<a href="vscode://chat-plugin/install?source=https%3A%2F%2Fgithub.com%2Funfold-hq%2Funfold.git&plugin=unfold">Install the Unfold plugin in VS Code</a>
```

Source, read in [`pluginUrlHandler.ts`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/chat/browser/pluginUrlHandler.ts) at tag 1.147.0:

* The `source` value may be `owner/repo`, an HTTPS or SSH git URL, or either one base64-encoded ([`:325-333`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/chat/browser/pluginUrlHandler.ts#L325-L333)). Percent-encode a URL, as above.
* VS Code refuses a `file://` source, a plugin name with `@`, and any `harness` other than `copilot` or `vscode` ([`:84-94`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/chat/browser/pluginUrlHandler.ts#L84-L94)). It also refuses the link in a remote or web window ([`:95-97`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/chat/browser/pluginUrlHandler.ts#L95-L97)), and needs chat on and `chat.plugins.enabled` ([`:231-236`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/chat/browser/pluginUrlHandler.ts#L231-L236)).
* Without `harness` it asks where to install: **Copilot**, its own plugins on this machine, which needs no chat session, or **VS Code**, the shared installation compatible harnesses use ([`:238-258`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/chat/browser/pluginUrlHandler.ts#L238-L258)). Then it asks you to confirm the source ([`:107-122`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/chat/browser/pluginUrlHandler.ts#L107-L122)).
* For **Copilot**, the Copilot agent host adds the marketplace when it is missing and installs `<plugin>@<marketplace>` ([`:260-302`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/chat/browser/pluginUrlHandler.ts#L260-L302)). For **VS Code**, VS Code installs it from the source itself ([`:304-323`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/chat/browser/pluginUrlHandler.ts#L304-L323)).

Not checked: whether either installer clones a non-GitHub URL from a link. Use the setting above when the link fails.

### Turn the plugin on for a repository

A repository can turn an installed plugin on or off for Copilot sessions that work in it, in `.github/copilot/settings.json`:

```json
{
  "enabledPlugins": {
    "unfold@unfold": true,
    "unfold-mcp@unfold": true
  }
}
```

Source, read in VS Code at tag 1.147.0:

* The Copilot agent host reads `enabledPlugins` from `.github/copilot/settings.json` in the session's working directory; each value must be `true` or `false`, and a file it cannot parse is an error ([`copilotRepositoryPluginSettings.ts:18-45`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/platform/agentHost/node/copilot/copilotRepositoryPluginSettings.ts#L18-L45)).
* A key is `<plugin>@<marketplace>`, as in [Require the plugin](#require-the-plugin), and covers only a plugin installed from a marketplace ([`copilotAgent.ts:3262`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L3262), [`:3289`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L3289), [`:3689-3696`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L3689-L3696)).
* The file turns a plugin on; it does not install one. Each person still installs `unfold` and `unfold-mcp`. Turning a plugin on for a repository from VS Code writes the same file, refuses a plugin that is not installed, and refuses a plugin the organisation manages ([`copilotAgent.ts:3676-3696`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L3676-L3696)).

Commit the file so everyone who opens a Copilot session in the repository gets the plugin turned on. Not checked: that a Copilot session in a running VS Code then loads the plugin's skills and MCP server.

## Cursor

Cursor imports team marketplaces from GitHub, GitLab, Bitbucket and Azure DevOps only (Docs), so copy the plugin in:

```sh
git clone https://github.com/unfold-hq/unfold.git
mkdir -p ~/.cursor/plugins/local
cp -R unfold/apps/unfold/extensions/claude-code ~/.cursor/plugins/local/unfold
```

Then run **Developer: Reload Window** and check **Customize**. Docs: Cursor loads an Agent Plugins package from that folder, and follows a symbolic link only when it points inside the folder, so copy rather than link. Whether Cursor also runs the Claude Code `hooks/hooks.json` of an Agent Plugins package is Not checked. Without `UNFOLD_URL` and `UNFOLD_TOKEN` the hook script exits silently.

Add the MCP tools in `~/.cursor/mcp.json`, as in [Serve Unfold's MCP tools over HTTPS](serve-unfold-mcp-over-https.md#3-connect-a-client).

## Kiro

In the Powers panel choose **Add Custom Power**, then **Import power from a folder**, and pick `apps/unfold/extensions/claude-code` in a clone of this repository. Docs: Kiro reads the root `plugin.json`, `skills/` and `mcp.json` as a power and documents GitHub-only imports. Its documentation names no precedence over `.claude-plugin/`.

## For operators: publish a marketplace for your installation

Generate a marketplace that pins the `unfold` plugin to one Unfold commit and adds `unfold-mcp` with your endpoint. The URL is the `UNFOLD_MCP_RESOURCE` your Unfold serves unfold-mcp on:

```sh
UNFOLD_MCP_RESOURCE=https://unfold.example.com/mcp \
  node apps/unfold/scripts/agent-plugin-marketplace.mjs \
  --sha "$(git rev-parse 'unfold-v0.4.0-rc.125^{commit}')" \
  --out ../your-agent-plugins
```

It writes five files:

* `.claude-plugin/marketplace.json` with a `git-subdir` entry, which VS Code, Codex and Copilot CLI 1.0.102 or later accept, pinned by the full 40-character `sha`;
* `unfold-mcp/plugin.json`;
* `unfold-mcp/mcp.json`, one `streamable-http` server named `unfold` with your URL and no headers;
* `unfold-mcp/.claude-plugin/plugin.json` and `unfold-mcp/.mcp.json` for Claude Code, which reads neither of the two above: one `http` server named `unfold` with your URL and `oauth.clientId`. `--client-id` sets it, `unfold-mcp` by default. Claude Code then connects on protocol 2026-07-28, where `unfold_hand_off` can become an MCP task ([Follow hand-offs as tasks in a terminal](follow-hand-offs-as-tasks-in-a-terminal.md)).

It refuses a URL that is not HTTPS (except `localhost`), or that carries user information, a query, a fragment or a placeholder, so no credential can end up in it. `--repository` points the pin at your own mirror. It must be an HTTPS URL ending in `.git`, which VS Code requires.

Commit the output to a repository your people can clone, and give them that repository's URL instead of this one in the steps above. Then they install both `unfold` and `unfold-mcp`. To move to a new Unfold release, generate again with the new commit.

## In a managed VS Code

An organisation can manage VS Code in two ways: with VS Code's [device policies](https://code.visualstudio.com/docs/enterprise/policies), and with [Copilot enterprise-managed settings](https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings). Either can switch off a part of Unfold, as of VS Code 1.147. A developer who sees only part of Unfold can run **Developer: Policy Diagnostics**, which lists every policy that applies and where it came from ([Verify policy enforcement](https://code.visualstudio.com/docs/enterprise/policies#_verify-policy-enforcement)), and take that list to whoever manages the settings.

Statements marked **(source)** were read in VS Code's source at tag 1.147.0, because its documentation does not cover them.

### What can be switched off

| Part of Unfold | Switched off by | Where it says so |
| --- | --- | --- |
| The connections: Unfold's sessions in the Agents window | `ChatAgentMode` set to `false`, which makes the Agents window unavailable. No policy names remote agent hosts such as Unfold's, and `chat.remoteAgentHosts` and `chat.remoteAgentHostsEnabled` are settings the developer controls **(source)**: none of VS Code's 64 policies at 1.147.0 names them. | [Control the Agent option and Agents window](https://code.visualstudio.com/docs/enterprise/manage-ai-settings#_control-the-agent-option-and-agents-window); the [policy reference](https://code.visualstudio.com/docs/enterprise/policies#_vs-code-enterprise-policy-reference) lists no remote agent host policy |
| The extension's three chat tools (`unfold_now`, `unfold_get_work`, `unfold_find_work`) | `ChatAgentExtensionTools` (`chat.extensionTools.enabled`) set to `false`, or MCP turned off with `ChatMCP` (`chat.mcp.access`) set to `none`. The second applies from VS Code 1.147 **(source)**: 1.146 checked only the first. | [Enable or disable extension language tools](https://code.visualstudio.com/docs/enterprise/manage-ai-settings#_enable-or-disable-extension-language-tools); the [policy reference](https://code.visualstudio.com/docs/enterprise/policies#_vs-code-enterprise-policy-reference) entry for `ChatAgentExtensionTools`: "These tools are also disabled when your organization disables MCP" |
| `unfold-mcp`, Unfold's MCP server, and the extension's **Ploeg** server | `allowedMcpServers` that no entry of theirs matches, a `deniedMcpServers` entry that matches, or MCP turned off. Since VS Code 1.145 the allow-list decides on its own, and an empty list, `[]`, blocks every server. | [Configure managed MCP server access](https://code.visualstudio.com/docs/enterprise/manage-ai-settings#_configure-managed-mcp-server-access); [`allowedMcpServers`](https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings#allowedmcpservers), [`deniedMcpServers`](https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings#deniedmcpservers); [1.145 release note](https://code.visualstudio.com/updates/v1_145#_managed-mcp-allowlists-take-precedence-over-registry-only-access) |
| The Agent Plugin, `unfold` and `unfold-mcp` | `ChatPluginsEnabled` set to `false`; `strictKnownMarketplaces` or the `ChatStrictMarketplaces` policy without your marketplace (both an empty list and a list that names other marketplaces leave it out); `enabledPlugins` or `ChatEnabledPlugins` set to `false` for the plugin. `ChatExtraMarketplaces` and `extraKnownMarketplaces` add a marketplace; they never remove one. | [Manage agent plugins and marketplaces](https://code.visualstudio.com/docs/enterprise/manage-ai-settings#_manage-agent-plugins-and-marketplaces); [`strictKnownMarketplaces`](https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings#strictknownmarketplaces), [`enabledPlugins`](https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings#enabledplugins) |
| The Unfold extension, `unfold-hq.unfold-workbench` | A [private extension marketplace](https://code.visualstudio.com/docs/enterprise/extensions#_host-a-private-extension-marketplace) whose allow list leaves it out. Since VS Code 1.146 an extension it blocks cannot be installed, updated or auto-updated from the gallery, is left out of chat's extension search, and its page says the policy or the marketplace blocks it. Not checked: whether installing the release's VSIX is refused too. | [Host a private extension marketplace](https://code.visualstudio.com/docs/enterprise/extensions#_host-a-private-extension-marketplace); [microsoft/vscode#341049](https://github.com/microsoft/vscode/pull/341049), listed in the [1.146 release notes](https://code.visualstudio.com/updates/v1_146) |

### What does not block Unfold's agent host

Copilot enterprise-managed settings switch off VS Code's own Claude and Codex harnesses, and since VS Code 1.147 `vscode.allowedHarnesses` lets an administrator permit them again. Its only valid entries are `claude` and `codex` ([Claude and Codex availability](https://code.visualstudio.com/docs/enterprise/manage-ai-settings#_claude-and-codex-availability), [1.147 release note](https://code.visualstudio.com/updates/v1_147#_permit-claude-and-codex-alongside-managed-settings)). **(source)** The restriction is attached only to the settings that enable those two local harnesses (`Claude3PIntegration` and `Codex3PIntegration`, through `thirdPartyAgentEnabledValue` in `copilotManagedSettings.ts`). Unfold's host is a remote agent host, so neither the managed settings nor the list of allowed harnesses blocks it, and Unfold does not need to be on that list.

### What to allow

Give these to the administrator:

1. **The MCP server.** When the organisation sets `allowedMcpServers`, add an entry for `unfold-mcp`. Match it by URL or command, which the documentation prefers over a name, because a name is whatever the configuration's author typed ([Configure managed MCP server access](https://code.visualstudio.com/docs/enterprise/manage-ai-settings#_configure-managed-mcp-server-access)):
   * served over HTTPS, the `UNFOLD_MCP_RESOURCE` of your Unfold, which the generated `unfold-mcp` plugin also names: `{ "serverUrl": "https://unfold.example.com/mcp" }`;
   * run locally as in [Ask from an AI client](ask-from-an-ai-client.md#unfold), the exact command and arguments, in order: `{ "serverCommand": ["node", "/path/to/apps/unfold/scripts/mcp.ts"] }`. The path differs per machine, so the URL form is the one to roll out.

   Add the URL of the extension's **Ploeg** server the same way when your people use it. Make sure no `deniedMcpServers` entry matches either one, because a deny rule wins over the allow-list.
2. **The plugin marketplace.** When the organisation sets `strictKnownMarketplaces` (or the `ChatStrictMarketplaces` policy), add the repository of your [operator marketplace](#for-operators-publish-a-marketplace-for-your-installation), for example `{ "source": "git", "url": "https://git.example.com/your-agent-plugins.git" }` ([`strictKnownMarketplaces`](https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings#strictknownmarketplaces)). `extraKnownMarketplaces` or `ChatExtraMarketplaces` then offers it to everyone without a setting of their own.
3. **The chat tools.** Leave `ChatAgentExtensionTools` on and MCP access above `none`.
4. **The extension.** When people install extensions from a private marketplace, add `unfold-hq.unfold-workbench` to its allow list ([Host a private extension marketplace](https://code.visualstudio.com/docs/enterprise/extensions#_host-a-private-extension-marketplace)).

### Tell people where to ask

Set `communication.support.url` in Copilot enterprise-managed settings to an absolute HTTP or HTTPS address of your own help page, for example the page that explains how your organisation runs Unfold. Since VS Code 1.146, a developer who meets a supported policy restriction, such as a disabled Agents window or a model the organisation turned off, sees a **Contact Admin** link to that page ([1.146 release note](https://code.visualstudio.com/updates/v1_146#_organization-help-links-for-policy-restrictions)). The setting is informational only and changes no access ([supported keys](https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings#supported-keys)):

```json
{
  "communication": {
    "support": {
      "url": "https://intranet.example.com/unfold"
    }
  }
}
```

Not checked: which of the restrictions in [What can be switched off](#what-can-be-switched-off) show the link.

### Open Unfold links in the integrated browser

From VS Code 1.147, `workbench.externalUriOpeners` can send links to the integrated browser instead of the default browser ([1.147 release note](https://code.visualstudio.com/updates/v1_147#_open-non-localhost-links-in-the-integrated-browser)). Map your Unfold's address to it in your user settings:

```json
"workbench.externalUriOpeners": {
  "https://unfold.example.com": "workbench.integratedBrowser"
}
```

A pattern of `https://` and a host matches that host on HTTPS and every path under it ([`configuration.ts:27-37`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/externalUriOpener/common/configuration.ts#L27-L37) at 1.147.0). The integrated browser registers this opener only in the desktop app ([`browserTabManagementFeatures.ts:630`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/browserView/electron-browser/features/browserTabManagementFeatures.ts#L630), [`:650`](https://github.com/microsoft/vscode/blob/1.147.0/src/vs/workbench/contrib/browserView/electron-browser/features/browserTabManagementFeatures.ts#L650), in `electron-browser`). Not checked: which of Unfold's links take this route, such as **Open in the browser ↗** in the Agents window and links in chat, and whether the integrated browser needs its own Unfold sign-in.

### Behind a proxy

Three kinds of connection carry Unfold in VS Code, and only the first has a documented proxy behaviour:

* **Copilot sessions**, which reach `unfold-mcp` when the plugin carries it. Since VS Code 1.146 they follow VS Code's [proxy configuration](https://code.visualstudio.com/docs/setup/network#_proxy-server-support), including proxy auto-configuration (PAC) and Kerberos, when they run locally, in WSL or in a local Dev Container ([1.146 release note](https://code.visualstudio.com/updates/v1_146#_copilot-sessions-behind-enterprise-proxies)). Proxies that need Basic authentication are [microsoft/vscode#347494](https://github.com/microsoft/vscode/issues/347494), closed as completed in the 1.147.0 milestone. Not verified: that the session's MCP connection to `unfold-mcp` takes the same route, and Basic authentication in a running VS Code.
* **The Agents window's WebSocket** to Unfold's agent host. VS Code says it has the same proxy support as Chromium ([Proxy server support](https://code.visualstudio.com/docs/setup/network#_proxy-server-support)). Not verified: whether this WebSocket follows a PAC file, Kerberos or an authenticated proxy. The proxy must pass WebSocket upgrades, as in [Troubleshooting the Agents window](../../apps/unfold/docs/operations/live.md#troubleshooting-the-agents-window).
* **The extension's own requests** to the workbench, and VS Code's MCP client when it reaches `unfold-mcp` from the editor's chat. Not verified.

### Require the plugin

An organisation can require the plugin. `enabledPlugins` set to `true` for `unfold@unfold` and `unfold-mcp@unfold` (plugin name, then the marketplace name, which the generator sets to `unfold` unless you pass `--name`) installs both for everyone, and since VS Code 1.145 nobody can uninstall a required plugin ([`enabledPlugins`](https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings#enabledplugins), [1.145 release note](https://code.visualstudio.com/updates/v1_145#_organization-required-plugins-cant-be-uninstalled)).

The plugin is also the route that still works where standalone customizations are blocked. `ChatStrictPluginOnlyCustomization` (`strictPluginOnlyCustomization` in Copilot enterprise-managed settings) blocks the skills, agents, hooks, instructions and MCP servers a developer adds by hand, and keeps those from eligible plugins ([policy reference](https://code.visualstudio.com/docs/enterprise/policies#_vs-code-enterprise-policy-reference), [1.146 release note](https://code.visualstudio.com/updates/v1_146#_enterprise-controls-for-canvas-extensions)). An `unfold-mcp` entry in a developer's own `mcp.json` is blocked there; the `unfold-mcp` plugin carries the same server and is the route the policy leaves open. The documentation does not say what makes a plugin eligible, so try the plugin in one managed VS Code before you roll the policy out.

### An install link for a managed VS Code

From VS Code 1.147 a plugin link takes an optional `harness`, and `harness=vscode` installs into VS Code's shared plugin installation, which VS Code makes available to compatible harnesses, without asking where to install **(source)**: `pluginUrlHandler.ts` accepts `copilot` or `vscode` and refuses the link in a remote or web window. The [deep-link documentation](https://code.visualstudio.com/docs/agent-customization/agent-plugins#_share-and-install-plugins-with-deep-links) describes the rest of the form, and says a link never bypasses enterprise policies. For your operator marketplace:

```text
vscode://chat-plugin/install?source=https%3A%2F%2Fgit.example.com%2Fyour-agent-plugins.git&plugin=unfold&harness=vscode
vscode://chat-plugin/install?source=https%3A%2F%2Fgit.example.com%2Fyour-agent-plugins.git&plugin=unfold-mcp&harness=vscode
```

Not clicked yet: neither link has been opened in a desktop VS Code 1.147.

## Symptom → cause → fix

| Symptom | Cause | Fix |
| --- | --- | --- |
| The client lists no `unfold` plugin after adding the marketplace | It read another marketplace file first, or skipped the entry | Check that the repository has no `marketplace.json`, `.plugin/marketplace.json` or `.github/plugin/marketplace.json` |
| VS Code skips `unfold` from a generated marketplace | The pin is not a full 40-character commit | Generate again with `git rev-parse <tag>^{commit}` |
| The MCP server fails to sign in, or asks for a client id | Your identity provider registers no clients by itself | Enter `unfold-mcp` when asked, or add the server with that client id in the client's own MCP settings |
| `unfold_*` tools are missing, but the skills are there | No MCP connection | Install `unfold-mcp` from your operator's marketplace, or add the server yourself |
| The install link says plugin links are unavailable | `chat.plugins.enabled` is off, or chat is disabled | Turn it on, or use `chat.plugins.marketplaces` |
| In an organisation's VS Code, a part of Unfold is missing and no setting brings it back | A device policy or Copilot enterprise-managed setting switches it off | Run **Developer: Policy Diagnostics** and give the administrator [what to allow](#what-to-allow) |
