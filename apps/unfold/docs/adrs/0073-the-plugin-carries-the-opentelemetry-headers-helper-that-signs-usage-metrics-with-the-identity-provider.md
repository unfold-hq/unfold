---
status: proposed
date: 2026-11-18
decision-makers: Ryan Grippeling
review-by: 2027-02-18
---

# The plugin carries the OpenTelemetry headers helper that signs usage metrics with the identity provider

## Context and Problem Statement

Unfold reads a Linked Session's cost and tokens from Claude Code's own telemetry ([ADR 0047](0047-people-link-their-own-agent-sessions-through-a-plugin-agent-trace-and-telemetry-never-a-claude-sign-in.md)). An organisation that collects that telemetry wants each export to carry who sent it, so the collector can refuse strangers and the metrics stay per person. Claude Code offers one hook for that: the `otelHeadersHelper` setting names a command that prints a JSON object of headers, run at start and about every 29 minutes ([monitoring](https://code.claude.com/docs/en/monitoring-usage)).

Until now the organisation had to write that command itself and put it on every laptop with device management, beside the plugin that managed settings already install. Two things to roll out, one of them bespoke, for one header. [ADR 0070](0070-an-editor-trades-an-identity-provider-token-for-its-credential.md) then asked the same organisation for a third: a command that prints an identity-provider token so the plugin's own sign-in needs no browser approval.

How does an organisation sign Claude Code's telemetry with each person's identity when nothing but Claude Code's managed settings may install anything on the laptop?

## Decision Drivers

* Managed settings install the plugin's marketplace; nothing else may be assumed on the laptop. Node is there because Claude Code's hooks already need it.
* Generic: standards on the wire (OpenID Connect discovery, RFC 8628 device authorization, RFC 8693 token exchange), no identity-provider vendor named, configuration by environment variables only ([system ADR-0050](../../../../docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md)).
* Claude Code must never wait: the helper prints at once, and a failing identity provider never blocks a session.
* One approval. The person signs in once in the browser and the helper keeps itself signed in; the plugin's own Unfold sign-in reuses that approval.
* No secret in a log, a settings file or a process list.

## Considered Options

* **The plugin ships `scripts/otel-headers.mjs`, and managed settings point `otelHeadersHelper` at its path inside the marketplace clone** (chosen)
* The organisation deploys its own helper with device management (the situation before)
* The plugin's `SessionStart` hook writes the header into the person's settings
* Claude Code's hooks export the telemetry themselves, with the plugin's editor credential

## Decision Outcome

Chosen option: **the plugin ships the helper**, because the plugin is the one thing managed settings already install on every laptop, and a helper beside the plugin's other scripts needs nothing more than the Node those scripts need.

### The helper

[`scripts/otel-headers.mjs`](../../extensions/claude-code/scripts/otel-headers.mjs) reads `UNFOLD_TELEMETRY_ISSUER` (an OpenID Connect issuer; its endpoints come from `/.well-known/openid-configuration`, cached for a day), `UNFOLD_TELEMETRY_CLIENT_ID` (a public client), `UNFOLD_TELEMETRY_SCOPES` (default `openid offline_access`), and optionally `UNFOLD_TELEMETRY_AUDIENCE`, `UNFOLD_TELEMETRY_HEADER` (default `Authorization`) and `UNFOLD_TELEMETRY_EXCHANGE_AUDIENCE` (default `unfold`). Nothing in it names an organisation.

Run without a subcommand, as Claude Code runs it, it prints the headers and exits 0, whatever happens:

* with a valid access token, `{"Authorization": "Bearer …"}` without a network call;
* with a refresh token, the same after a silent refresh (`grant_type=refresh_token`, five seconds at most). An issuer that answers `invalid_grant` or 401 forgets the session; an issuer that does not answer leaves it, and the helper prints the last token while it is valid, `{}` once it is not;
* with nothing, `{}` at once, and it starts the device authorization flow ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)) in a detached process: `device_authorization_endpoint`, the browser on `verification_uri_complete`, a desktop notification with the user code (`osascript` on macOS, `notify-send` on Linux when present), and polling of the token endpoint with the issuer's interval, five seconds more on `slow_down`, until approval, denial or expiry.

A flow the person did not approve is not started again for four hours. `login` runs the same flow in the foreground and prints its progress, `status` says which issuer and client this machine is signed in to, as whom, until when and where the session is kept, and `logout` deletes it.

`token` prints one line: an access token for Unfold obtained by token exchange at the issuer's token endpoint ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693): `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token` the telemetry access token, `subject_token_type=urn:ietf:params:oauth:token-type:access_token`, `audience` from `UNFOLD_TELEMETRY_EXCHANGE_AUDIENCE`). It never opens a browser, gives up after five seconds, and prints nothing and exits 1 without a session. With `UNFOLD_TELEMETRY_ISSUER` set and no `UNFOLD_IDP_TOKEN_COMMAND`, the plugin's sign-in runs `node <plugin>/scripts/otel-headers.mjs token` as its identity-provider token source and trades the result at `POST /api/auth/editor/exchange` ([ADR 0070](0070-an-editor-trades-an-identity-provider-token-for-its-credential.md)). So the telemetry approval is also the Unfold sign-in. `UNFOLD_IDP_TOKEN_COMMAND` stays as the explicit override.

### Where the session is kept

On macOS the refresh token, access token, expiry, issuer, client id and the person's name from the ID token are one generic password in the login Keychain, service `dev.unfold.telemetry`, account the issuer, handed to `security -i` on standard input. Elsewhere, and on a Mac whose Keychain is missing or locked, they are `plugins/data/unfold/telemetry.json` under `$CLAUDE_CONFIG_DIR` or `~/.claude`, mode 0600 in a 0700 directory; `status` says when the file was the fallback. `UNFOLD_TELEMETRY_STORE=file` or `keychain` chooses. The device flow's progress and the discovery document live in `telemetry-state.json` beside it and hold no token and no device code. Every message and debug line masks bearer values and token fields.

### Pointing Claude Code at it

Hooks and MCP servers get `${CLAUDE_PLUGIN_ROOT}` from Claude Code; `otelHeadersHelper` does not, because it is a plain setting, not a plugin hook, and Claude Code expands the variable only when it runs a plugin's own manifest. The setting does run through a shell, and a marketplace registered in managed settings is cloned to `$CLAUDE_CONFIG_DIR/plugins/marketplaces/<name>/`. So the managed settings carry a shell line that finds the helper inside that clone and prints `{}` while the clone does not exist yet, on the first start before Claude Code fetched the marketplace:

```sh
sh -c 'P="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/marketplaces/unfold/apps/unfold/extensions/claude-code/scripts/otel-headers.mjs"; [ -f "$P" ] && exec node "$P" || echo {}'
```

### Consequences

* Good, because an organisation rolls out one managed settings file and nothing else: the marketplace, the plugin, the helper line and six environment variables.
* Good, because the person approves once, in the browser they already use for the identity provider, and never pastes a token.
* Good, because the telemetry and the plugin's Unfold credential come from one approval and one refresh token, and `logout` ends both at the next renewal.
* Bad, because the shell line names the marketplace's clone path, which Claude Code does not document as stable. A changed path makes the helper print `{}`, never an error, so metrics would travel unsigned until someone notices.
* Bad, because the helper only prints what Claude Code sends; it cannot tell whether the collector accepted the metrics. Until the first approval the metrics go out without the header, and a collector that requires it drops them.
* Bad, because on Windows there is no Keychain and no notification: the file store and the browser only.
* Neutral: the refresh token is deleted at `logout` and never revoked at the issuer.

### Confirmation

* [`test/claude-code-telemetry.test.ts`](../../test/claude-code-telemetry.test.ts) runs the helper as Claude Code does, against an in-process issuer that serves discovery, device authorization and the device code, refresh and token exchange grants, with the file store in a temporary `CLAUDE_CONFIG_DIR`: the first call prints `{}` at once and starts the flow, approval stores the session with mode 0600, the next call prints the header, an expired token is refreshed silently and the rotated refresh token kept, `token` performs the exchange, `logout` clears it, a refused refresh token is forgotten, a denied flow is not asked again, an issuer that does not answer gets `{}` and exit 0, and the plugin's `SessionStart` hook signs in through the helper with no browser. The Keychain store runs against a stub `security`, which also fails to exercise the file fallback.
* Mutating the four-hour wait, the exit codes, the `{}` fallback, the token exchange parameters or the subject token type fails these tests.
* Not checked: a real Keychain, a real identity provider, and Claude Code's expansion of the shell line on a managed laptop. The clone path and the shell behaviour were observed by hand on Claude Code before this decision and are not pinned by any test.

## Pros and Cons of the Options

### The organisation deploys its own helper with device management

* Good, because the organisation controls every line.
* Bad, because every organisation writes the same helper, and laptops without device management get nothing.

### The `SessionStart` hook writes the header into the person's settings

* Good, because no new setting is needed.
* Bad, because a hook that edits the person's settings file is the kind of thing a plugin must not do, and a token in a settings file is a token on disk in clear.

### The hooks export the telemetry themselves with the plugin's editor credential

* Good, because the identity is Unfold's own.
* Bad, because the plugin would re-implement Claude Code's exporter and send the metrics twice, and the credential would reach a collector that is not Unfold.

## More Information

* [Link your Claude Code sessions](../../../../docs/how-to/link-claude-code-sessions.md#send-claude-codes-usage-metrics-with-your-identity-the-telemetry-helper) carries the managed settings an organisation pastes and what the person sees; the [plugin README](../../extensions/claude-code/README.md#telemetry-headers) the exit codes.
* RFC 8628, OAuth 2.0 Device Authorization Grant: <https://www.rfc-editor.org/rfc/rfc8628>. RFC 8693, OAuth 2.0 Token Exchange: <https://www.rfc-editor.org/rfc/rfc8693>. OpenID Connect Discovery 1.0: <https://openid.net/specs/openid-connect-discovery-1_0.html>.

### History

* 2026-11-18: proposed with the implementation in plugin 0.21.0.
