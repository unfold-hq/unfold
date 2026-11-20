---
type: how-to
audience: [owner, operator]
owner: unfold
last_verified: 2026-11-20
verified_by: "Written on 2026-11-20 from Anthropic's Claude Code documentation read that day (managed-settings, server-managed-settings, monitoring-usage, settings and plugins/org on code.claude.com) and from the sections it took over from Link your Claude Code sessions, whose helper behaviour test/claude-code-telemetry.test.ts checks against an in-process identity provider. No rollout was run: no MDM profile, server-managed configuration, real identity provider, collector or managed laptop was used, and the otelHeadersHelper shell line and marketplace clone path are pinned by no test."
---

# Send every Claude Code session in your organisation to Unfold

Use this when you run Claude Code for an organisation and want every person's sessions to show up in Unfold, with their cost and tokens, without anyone setting anything up by hand. When you finish:

* every machine has the Unfold plugin and your Unfold address, and every session reports to Unfold and links to the Work Items it works on;
* every session exports Claude Code's telemetry to your collector, signed with the person's own identity;
* each person approves one sign-in in the browser, once, or none at all when your machines already hold an identity-provider token.

For one person trying it on their own machine, follow [Link your Claude Code sessions](link-claude-code-sessions.md) instead.

## How the parts fit

Three things leave each machine, and only the first goes to Unfold directly:

1. **The plugin's hooks** send the session's id, state, branch, Work Item links and commits to Unfold, under the person's own editor credential. This is what ties a session to a person and to a Work Item ([ADR 0047](../../apps/unfold/docs/adrs/0047-people-link-their-own-agent-sessions-through-a-plugin-agent-trace-and-telemetry-never-a-claude-sign-in.md)).
2. **Claude Code's OpenTelemetry exporter** sends metrics and events to your collector, which writes them to a Prometheus-compatible metrics store and a logs store. Unfold receives no OTLP itself: it reads those stores by session id ([Linking the estate's observability](../../apps/unfold/docs/operations/live.md#linking-the-estates-observability)).
3. **The telemetry helper** in the plugin signs the person in at your identity provider and gives Claude Code an `Authorization` header for every export, so the collector knows who sends and can refuse anyone else ([ADR 0073](../../apps/unfold/docs/adrs/0073-the-plugin-carries-the-opentelemetry-headers-helper-that-signs-usage-metrics-with-the-identity-provider.md)).

So "send telemetry to Unfold" means: point the exporter at the collector whose stores Unfold reads. Unfold attributes the figures through the session id the plugin reported, not through the header.

## Before you start

* Unfold has single sign-on configured, because the plugin's browser sign-in is Unfold's editor sign-in ([ADR 0037](../../apps/unfold/docs/adrs/0037-an-editor-signs-in-only-after-its-person-approves-it-and-gets-its-own-credential.md)).
* A collector that laptops reach over HTTPS, writing to stores Unfold reads, with `observability.metricsUrl` and, for prompt and tool counts, `observability.logsUrl` set ([live operation](../../apps/unfold/docs/operations/live.md#linking-the-estates-observability)).
* For signed telemetry, a public client at your identity provider with the device authorization grant ([what it needs](#what-your-identity-provider-needs)).
* Node 22 or later on every machine: the plugin's hooks and the helper run on Node.

## Choose how the settings reach every machine

Claude Code reads settings from five levels, and the managed level wins over the others ([precedence](https://code.claude.com/docs/en/settings#settings-precedence)). Only some of them can switch telemetry on:

| Mechanism | Who it reaches | Can switch telemetry on | What each person does | Use it when |
| --- | --- | --- | --- | --- |
| [Server-managed settings](https://code.claude.com/docs/en/server-managed-settings), in the claude.ai admin console | Members of a Claude for Teams or Enterprise organisation who sign in with that organisation's claude.ai login, an OAuth token or a directly configured API key, talking to `api.anthropic.com` directly | Yes | Accepts one approval dialog, because `otelHeadersHelper` and `OTEL_EXPORTER_OTLP_ENDPOINT` need approval | Your machines are not under device management and everyone signs in with claude.ai |
| [MDM or OS policy](https://code.claude.com/docs/en/managed-settings#where-each-mechanism-stores-the-policy): macOS domain `com.anthropic.claudecode`, Windows `HKLM\SOFTWARE\Policies\ClaudeCode` | Every managed device, whatever sign-in or model gateway it uses | Yes | Nothing | Your devices are under Jamf, Intune, Group Policy or similar |
| [A `managed-settings.json` file](https://code.claude.com/docs/en/managed-settings#deploy-a-managed-settings-file), or a file in `managed-settings.d/` beside it | Every machine you write the file to | Yes | Nothing | Linux hosts, images you build, configuration management |
| A repository's `.claude/settings.json` | People who open that repository and accept its trust dialog | **No**: Claude Code ignores the OpenTelemetry exporter variables there ([monitoring](https://code.claude.com/docs/en/monitoring-usage#administrator-configuration)) | Trusts the folder | A pilot in one repository: sessions link, but no cost or tokens arrive |
| The plugin alone | Whoever installs it | **No**: the [plugin reference](https://code.claude.com/docs/en/plugins-reference) names no key that sets environment variables or `otelHeadersHelper` | Installs it and sets `UNFOLD_URL` | Never for an organisation; the plugin only carries the helper program |
| `~/.claude/settings.json` | One person | Yes | Everything, by hand | Trying it yourself |

Server-managed delivery is skipped when a person exports a custom `ANTHROPIC_BASE_URL` or a `CLAUDE_CODE_USE_*` provider variable such as Bedrock or Vertex, and keys from an `apiKeyHelper` do not trigger it ([platform availability](https://code.claude.com/docs/en/server-managed-settings#platform-availability)). When your organisation sends Claude Code through a model gateway, use MDM or the file.

**Recommendation:** use MDM or the file where you manage devices, because they reach every machine whatever it signs in with and ask nobody anything; use server-managed settings where you do not. A Team plan gets one configuration for everyone; group configurations need Enterprise.

**One managed source wins.** When a machine gets more than one managed source, Claude Code by default applies only the highest one that sets any policy key, in this order: server-managed, MDM, the file and its drop-ins, the Windows `HKCU` key ([how sources combine](https://code.claude.com/docs/en/managed-settings#how-claude-code-combines-managed-sources)). If your organisation already delivers a policy from a higher source, put Unfold's keys in that source, or set `managedSourcesBehavior` to `"merge"` in the highest source you deploy.

## The settings

Put this in whichever managed source you chose. Replace the four addresses and the client id with your own:

```json
{
  "env": {
    "UNFOLD_URL": "https://unfold.example.org",
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://otel.example.org",
    "UNFOLD_TELEMETRY_ISSUER": "https://idp.example.org/realms/people",
    "UNFOLD_TELEMETRY_CLIENT_ID": "claude-code-telemetry"
  },
  "otelHeadersHelper": "sh -c 'P=\"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/unfold/apps/unfold/extensions/claude-code/scripts/otel-headers.mjs\"; [ -f \"$P\" ] && exec node \"$P\" || echo {}'",
  "extraKnownMarketplaces": {
    "unfold": {
      "source": { "source": "git", "url": "https://github.com/unfold-hq/unfold.git" }
    }
  },
  "enabledPlugins": { "unfold@unfold": true }
}
```

| Key | Why |
| --- | --- |
| `UNFOLD_URL` | The only thing the plugin needs. Without it the hooks print nothing and exit |
| `extraKnownMarketplaces`, `enabledPlugins` | Register the marketplace and switch the plugin on for everyone. A plugin a managed source enables cannot be switched off by a person ([plugins for an organisation](https://code.claude.com/docs/en/plugins/org)). Add `strictKnownMarketplaces` with the same source to allow only approved marketplaces. Point the `url` at your own mirror if you build Unfold from one |
| `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` | Switch the exporter on for metrics, which carry cost and tokens, and for events, which carry prompt and tool counts. Set both selectors here: a person could otherwise switch a signal off |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`, because the helper's headers apply only to the two HTTP protocols, not to `grpc` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Your collector. Set here, it removes any endpoint a person set for one signal, so telemetry cannot go elsewhere ([locking the destination](https://code.claude.com/docs/en/monitoring-usage#how-managed-settings-lock-the-otlp-destination)) |
| `UNFOLD_TELEMETRY_ISSUER`, `UNFOLD_TELEMETRY_CLIENT_ID`, `otelHeadersHelper` | The [telemetry helper](#how-identity-is-attached-the-telemetry-helper) |

Leave `OTEL_METRICS_INCLUDE_SESSION_ID` unset or `true`: Unfold finds a session's metrics by that label. Leave `OTEL_LOG_USER_PROMPTS` and `OTEL_LOG_TOOL_DETAILS` off unless your collector is meant to keep prompt text and tool arguments; Unfold needs neither.

**Without the helper.** When the collector sits on a network only your machines reach, drop `otelHeadersHelper` and the two `UNFOLD_TELEMETRY_*` variables. A static `OTEL_EXPORTER_OTLP_HEADERS` token works too, but it is one secret shared by every machine and says nothing about who sent what.

**As a drop-in file.** To keep Unfold's part apart from the rest of your policy, write it as its own file in `managed-settings.d/`, such as `50-unfold.json`. Claude Code merges `managed-settings.json` first, then each `*.json` in that directory in name order, and merges `env` key by key ([split a policy](https://code.claude.com/docs/en/managed-settings#split-a-file-based-policy-across-teams)). The directories are:

| System | Directory |
| --- | --- |
| macOS | `/Library/Application Support/ClaudeCode/` |
| Linux and WSL | `/etc/claude-code/` |
| Windows | `C:\Program Files\ClaudeCode\` |

## How identity is attached: the telemetry helper

A collector that takes metrics from anyone cannot tell whose they are, and one that asks for a bearer token needs a program on every laptop that keeps that token fresh. Claude Code's `otelHeadersHelper` setting names such a program: a command Claude Code runs at start and about every 29 minutes, whose printed JSON object becomes the headers of every metrics and logs export ([dynamic headers](https://code.claude.com/docs/en/monitoring-usage#dynamic-headers)). The plugin ships that program, so nothing but the managed settings needs installing: [`scripts/otel-headers.mjs`](../../apps/unfold/extensions/claude-code/scripts/otel-headers.mjs) signs each person in at your identity provider once and prints `{"Authorization": "Bearer <access token>"}` from then on.

The helper line is a shell line, because `otelHeadersHelper` runs through a shell and does not expand `${CLAUDE_PLUGIN_ROOT}`, which only a plugin's own hooks get. It looks for the helper where Claude Code clones a marketplace registered in managed settings, `plugins/marketplaces/<marketplace name>/`, under `CLAUDE_CONFIG_DIR` or `~/.claude`, and prints `{}` on the very first start, before the marketplace is cloned. Name the marketplace `unfold` as above, or change the path to match. Set `UNFOLD_TELEMETRY_SCOPES` when `openid offline_access` is not enough, `UNFOLD_TELEMETRY_AUDIENCE` when your provider wants an `audience` to issue a token for the collector, and `UNFOLD_TELEMETRY_HEADER` when the collector reads another header than `Authorization`. The [plugin README](../../apps/unfold/extensions/claude-code/README.md#telemetry-headers) lists every variable, the subcommands and the exit codes.

### What your identity provider needs

A public client (no secret; the helper runs on laptops) with the device authorization grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)) and refresh tokens, so the person approves once; access tokens the collector can verify, usually JWTs the collector's proxy checks against the issuer's JWKS; and, to make the same approval the plugin's Unfold sign-in, token exchange ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)) at the token endpoint from that client to the audience `unfold` (`UNFOLD_TELEMETRY_EXCHANGE_AUDIENCE`) with the scopes `openid profile email` (`UNFOLD_TELEMETRY_EXCHANGE_SCOPES`) so the token carries the groups claim Unfold maps to a role, with the exchanged token a JWT whose `aud` the operator lists in Unfold's `auth.oidc.exchange.audiences` ([One sign-in for editors](../../apps/unfold/docs/operations/live.md#one-sign-in-for-editors)). Without token exchange the metrics still carry the identity, and the plugin falls back to its own browser approval.

### What a person sees

Nothing in the session: the helper is not a hook. On the first start a browser tab opens on the provider's device page with the code filled in, and a desktop notification says `Approve the sign-in in your browser. The page must show BCDF-GHJK.` (macOS and Linux; on Windows only the browser). The person signs in with their company account, checks the code and approves. From the next helper run on, about half an hour later at most, their metrics carry the header. Someone who closes the tab is asked again after four hours, not at every start, and `node ~/.claude/plugins/marketplaces/unfold/apps/unfold/extensions/claude-code/scripts/otel-headers.mjs login` asks at once; `status` and `logout` work the same way. Until the first approval the metrics go out without the header, and a collector that requires it drops them. On macOS the session is one entry in the login Keychain (service `dev.unfold.telemetry`), elsewhere `plugins/data/unfold/telemetry.json` under `~/.claude`, readable by the person only.

With server-managed settings, the person also sees Claude Code's approval dialog once, naming the helper and the endpoint, before they apply ([approval dialogs](https://code.claude.com/docs/en/server-managed-settings#security-approval-dialogs)).

### One approval for Unfold too

With `UNFOLD_TELEMETRY_ISSUER` set and no `UNFOLD_IDP_TOKEN_COMMAND`, the plugin's own sign-in runs the helper's `token` subcommand as its identity-provider token source, so the plugin's browser approval is never needed after the first sign-in ([One sign-in for every tool](link-claude-code-sessions.md#one-sign-in-for-every-tool)). An organisation whose machines already hold a token from the identity provider Unfold uses can set `UNFOLD_IDP_TOKEN_COMMAND` instead, which wins.

### What leaves the machine

The helper talks to the issuer only: the device code, the refresh token at each refresh, and the access token at a token exchange. Claude Code then sends the access token, as the header, to wherever `OTEL_EXPORTER_OTLP_ENDPOINT` points, with every export. Set that endpoint to HTTPS. Unfold never sees the telemetry token, and the helper never sends anything to Unfold. What the plugin itself sends to Unfold is in [What leaves your machine](link-claude-code-sessions.md#what-leaves-your-machine).

## Keep the settings in a repository

The managed settings are policy, so review them like code. Two shapes work:

* **A file in a repository, delivered by your device tooling.** Keep `50-unfold.json` in the repository that holds your workstation or platform configuration, change it through pull requests, and check in CI that it parses as JSON. Your MDM, configuration management or image build then writes it to the system directory above, or turns it into a macOS configuration profile or Windows registry value; Anthropic keeps starter templates for Jamf, Intune and Group Policy in its [MDM examples](https://github.com/anthropics/claude-code/tree/main/examples/mdm). Claude Code reloads the file when it changes, and checks an MDM policy every 30 minutes.
* **Server-managed settings, with the repository as the record.** The configuration lives in the claude.ai admin console, where only an Owner or Primary Owner can change it. Keep the same JSON in a repository, review changes there, and have an Owner paste the reviewed version. The pages read for this guide name no API to write it. Clients pick a change up at the next start or within an hour, after the approval dialog where one applies.

| | File through device tooling | Server-managed |
| --- | --- | --- |
| Source of truth | The repository | The admin console; the repository is a copy |
| Reaches machines on a model gateway, Bedrock or Vertex | Yes | No, the fetch is skipped |
| Protected from the person | The system directory needs administrator rights, and MDM can put it back | The person cannot change it, but a shell export of `ANTHROPIC_BASE_URL` skips it |
| Asks the person | Nothing | One approval dialog for the helper and the endpoint |
| Needs | Device management or configuration management | A Team or Enterprise plan and an Owner |

A dotfiles repository or a task in a developer tool that writes the file on each laptop is a third option. It needs administrator rights for the system directory, and the person can take it out again, so it is an opt-in, not a rollout.

## Check that it arrives

Check one machine before the whole organisation:

1. **The policy.** In Claude Code, `/status` shows `Enterprise managed settings` on its `Setting sources` line, with the source in parentheses: `(remote)`, `(plist)`, `(HKLM)`, `(file)` or `(drop-ins)`. `claude doctor` lists any entry Claude Code dropped ([check a policy](https://code.claude.com/docs/en/managed-settings#check-that-a-policy-is-in-force)). When the helper fails, `/status` says so as well.
2. **The plugin.** `/unfold:login status` says whether and until when the machine is signed in to Unfold.
3. **The helper.** `node ~/.claude/plugins/marketplaces/unfold/apps/unfold/extensions/claude-code/scripts/otel-headers.mjs status` names the issuer and the person; run the `otelHeadersHelper` line from the settings yourself and check it prints a header.
4. **Unfold.** Start a session and work for a minute. It shows under **Settings › Agent sessions** (`#settings/agent-sessions`) within a second. Its page shows the cost estimate, tokens and active time once the exporter has flushed, about a minute later. **No telemetry for this session** means Unfold has no `observability.metricsUrl`; **Cost: Not known yet** means the store holds no series for the session yet.
5. **The store.** Query the metrics store for the session id from the session's page, as `claude_code_cost_usage_USD_total{session_id="<id>"}` or, when the store keeps OTLP names, `claude_code.cost.usage` with label `session.id`. Unfold reads both ([names](../../apps/unfold/docs/contracts/api.md#claude-code-telemetry-names)).

For anything else that goes wrong on a machine, see [When it does not work](link-claude-code-sessions.md#when-it-does-not-work).

## Related pages

* [Link your Claude Code sessions to Work Items](link-claude-code-sessions.md): what a person does and sees, and everything the plugin does once it runs.
* [Install the Unfold plugin in Codex, Cursor, Copilot and VS Code](install-the-unfold-plugin.md): the same plugin for other clients, and Copilot's enterprise-managed settings.
* [Link your OpenCode and Codex sessions](link-opencode-and-codex-sessions.md).
* [What a session costs and how it is billed](link-claude-code-sessions.md#what-a-session-costs-and-how-it-is-billed).
* [ADR 0047](../../apps/unfold/docs/adrs/0047-people-link-their-own-agent-sessions-through-a-plugin-agent-trace-and-telemetry-never-a-claude-sign-in.md), [ADR 0073](../../apps/unfold/docs/adrs/0073-the-plugin-carries-the-opentelemetry-headers-helper-that-signs-usage-metrics-with-the-identity-provider.md) and [ADR 0068](../../apps/unfold/docs/adrs/0068-a-person-sees-their-own-usage-and-nobody-elses.md).
