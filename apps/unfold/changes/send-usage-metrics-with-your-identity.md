---
type: added
highlight: false
---
The Claude Code plugin can sign Claude Code's usage metrics with your organisation's identity provider, so nothing but the plugin needs installing on a laptop.

An administrator points Claude Code's `otelHeadersHelper` at the plugin's `scripts/otel-headers.mjs` and sets the issuer and client id in managed settings. The helper signs you in once through your browser with a device code, keeps the session in the macOS Keychain or a private file, refreshes it by itself, and the plugin's own Unfold sign-in reuses that approval instead of opening the browser again.
