---
type: added
---
Unfold's MCP endpoint can accept sign-ins from several OAuth clients of one identity provider that gives each client its own issuer.

Set `UNFOLD_MCP_ADDITIONAL_ISSUERS` to the issuers of the other clients, for example when both Claude Code and Open WebUI sign in through Authentik.
