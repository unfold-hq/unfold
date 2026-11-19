---
type: added
---
VS Code and other 2025-11-25 MCP clients connected over HTTPS can now confirm and run an Ask or an action on a Work Item from chat.

When the client declared form elicitation, Unfold asks for the confirmation on the stream of the tool call and acts only after the person accepts. A decline, a closed form, a closed stream, a restart or two minutes without an answer change nothing and spend nothing, and the refusal links to the Unfold page. Before, these clients were always refused over HTTPS.
