# Probe: Unfold's MCP endpoint behind LiteLLM's MCP gateway

Date: 20 November 2026, against `origin/development` at `eaca9fd7`, with LiteLLM `1.110.0` and `1.110.2` (`litellm[proxy]`), the latest stable release that day.

## Question

Some installations route every MCP server a chat front end uses through LiteLLM's MCP gateway, so the gateway admits each call on a virtual key, filters the tools and records the call. LiteLLM's `oauth_delegate` mode forwards the caller's own `Authorization` header to the upstream server, so the upstream still sees the person's own token. Does `unfold-mcp` keep working on that path: the person's identity, the confirmation of actions, and the MCP Apps card?

## Set-up

* Server: the same local live Unfold as in [5-probe.md](5-probe.md), with a stand-in Ploeg that logs every approve.
* Gateway: `litellm --config litellm.yaml --port 4555`, no database, a master key, and one server:

  ```yaml
  mcp_servers:
    unfold:
      transport: "http"
      url: "http://127.0.0.1:<port>/mcp"
      auth_type: "oauth_delegate"
  ```

* Client: the MCP Python SDK 2.3.0, built as Open WebUI builds it (MCP Apps advertised, an elicitation callback that accepts), connected to `http://127.0.0.1:4555/unfold/mcp` with `Authorization: Bearer <the person's access token>` and `x-litellm-api-key: Bearer <key>`, as an Open WebUI connection would send them.

## Result

```text
NEGOTIATED 2025-11-25
TOOLS 23 ['unfold-unfold_now', 'unfold-unfold_find_work', 'unfold-unfold_get_work', 'unfold-unfold_sessions'] revision tool listed: False
TOOL_META_UI []
RESOURCES ['unfold://now']
ELICITATIONS []
APPROVE ["This client cannot ask you to confirm, so nothing was changed. Do it in Unfold instead: https://unfold.example.test/#work/106"]
```

Unfold's log shows each call admitted as the person (`"actor":"oidc-…"`, `"protocol":"legacy"`), and the stand-in Ploeg received no approve.

### Second run: LiteLLM 1.110.2 with elicitation and 2026-07-28 switched on

LiteLLM keeps elicitation off unless a server opts in (`allow_elicitation: true`, YAML only) and serves 2026-07-28 to clients only when `general_settings.mcp_advertised_versions` lists it ([6-litellm-mcp-gateway.md](6-litellm-mcp-gateway.md#3-feature-passthrough)). The same probe against `litellm[proxy]==1.110.2` with both set:

```text
NEGOTIATED 2026-07-28
TOOLS 23 ['unfold-unfold_now', 'unfold-unfold_find_work', 'unfold-unfold_get_work', 'unfold-unfold_sessions'] revision tool listed: False
TOOL_META_UI []
RESOURCES ['unfold://now']
ELICITATIONS []
APPROVE ["The confirmation did not come back, so nothing was changed. Do it in Unfold instead: https://unfold.example.test/#work/106"]
```

The client now gets 2026-07-28 from the gateway, and the gateway now declares elicitation to Unfold over the legacy handshake, so Unfold asks on the stream of the call. The question never reached the client: Unfold waited, ended the call with `mcp_confirmation_missing`, and nothing changed. LiteLLM's own README says interactive relay is verified only on its legacy SSE endpoint (`/mcp/sse`), and Open WebUI speaks Streamable HTTP only.

## What this shows

1. **Identity survives.** In `oauth_delegate` mode the person's own token reaches Unfold, which maps it to their account as on a direct connection.
2. **The gateway speaks the legacy handshake to Unfold.** By default it also answers clients with 2025-11-25; with the opt-in it answers 2026-07-28, but still initializes Unfold the legacy way.
3. **Actions are refused, safely, in both runs.** No confirmation reached the client: without the opt-in Unfold refused with `mcp_confirmation_unsupported`, with it the question was lost in the gateway and Unfold ended with `mcp_confirmation_missing`. Nothing changed either time. Through LiteLLM's Streamable HTTP gateway, `unfold-mcp` is read-only.
4. **No Work Item card.** The tools carry no `_meta.ui`, and the app-only `unfold_work_item_revision` is not listed, because the gateway did not declare the MCP Apps extension to Unfold.
5. **Tool names are prefixed** with the server name (`unfold-unfold_now`). Open WebUI's block list matches by suffix and copes; an MCP App that calls its own server's tools by bare name would not ([ext-apps #745, #753](https://github.com/modelcontextprotocol/ext-apps/issues/745)).

## Not shown

* Any LiteLLM version other than 1.110.0 and 1.110.2, and its legacy SSE endpoint `/mcp/sse`, which Open WebUI cannot use.
* LiteLLM with its database, virtual keys, access groups or `allowed_tools`.
* Open WebUI itself.
