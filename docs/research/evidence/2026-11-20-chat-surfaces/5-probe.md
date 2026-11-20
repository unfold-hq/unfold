# Probe: Unfold's MCP endpoint against the MCP client Open WebUI uses

Date: 20 November 2026, against `origin/development` at `eaca9fd7`.

## Question

Open WebUI v0.13.4 talks to MCP servers through the official `mcp` Python SDK 2.3.0, with `Client(transport, extensions=[advertise('io.modelcontextprotocol/ui', …)], elicitation_callback=…)` and `client.call_tool(…)` ([1-open-webui.md](1-open-webui.md#1-mcp-client-implementation)). Unfold's HTTP endpoint answers JSON, keeps no session, and confirms every action with a 2026-07-28 `input_required` result. Does a confirming tool reach the person through that client, and act exactly once?

## Set-up

* Server: the Unfold application in live mode, started with the `application` helper from `apps/unfold/test/api-support.ts`, with `config.mcp` and an in-process identity provider and Ploeg stand-in built exactly as in the test "an action through unfold-mcp over HTTPS asks with input_required…" in `apps/unfold/test/mcp-http.test.ts`. The stand-in Ploeg logs every approve it receives. The person is an operator in Team `delivery`, with a signed 590-second access token whose `aud` is the resource.
* Client: `uv run --no-project --with mcp==2.3.0 --with httpx python -I client.py`, which builds the client the way Open WebUI's `backend/open_webui/utils/mcp/client.py` does: `streamable_http_client(url, http_client=httpx.AsyncClient(headers={"Authorization": "Bearer …"}), max_sse_event_size=None)`, the MCP Apps extension advertised, and an `elicitation_callback` that records what it is shown and answers `accept` (with `{"confirm": true}`) or `decline`. It calls `list_tools`, `unfold_get_work` for Work Item 106, then `unfold_approve_work` for 106.

No model was called and nothing was spent; Ploeg was a stand-in.

## Result

Accept:

```text
NEGOTIATED 2026-07-28
TOOLS 24 revision tool listed: True
ELICITATIONS [{"form": true, "message": "Approve Work Item 106 \"Add a regression test for negative half-cent totals\"? Ploeg queues it for Team delivery, and its Runs spend from Team delivery's budget."}]
APPROVE {"summary": "Approved Work Item 106; it is queued.", "done": true, "demo": false, "link": "https://unfold.example.test/#work/106", "result": {"state": "queued"}}
PLOEG_APPROVE {"path":"/api/v1/operator/work-items/106/approve","via":"mcp:mcp 0.1.0","actor":"oidc-…"}
```

Decline, against the same server:

```text
ELICITATIONS [{"form": true, "message": "Approve Work Item 106 …"}]
APPROVE {"summary": "Not done: you did not confirm. Nothing was changed.", "done": false, …}
```

The stand-in Ploeg still counted one approve after both runs.

## What this shows

1. The SDK's `auto` mode adopts 2026-07-28 through `server/discover` on Unfold's endpoint.
2. Unfold's `input_required` confirmation reaches the SDK's `elicitation_callback` as a form (`ElicitRequestFormParams`), which is the callback Open WebUI turns into its elicitation dialog. Accept acts once at Ploeg as the person; decline changes nothing.
3. The SDK lists 24 tools to a client that advertises MCP Apps: the 23 tools plus `unfold_work_item_revision`. Open WebUI hides that one from the model because its `_meta.ui.visibility` is `['app']` ([1-open-webui.md §2](1-open-webui.md#2-mcp-apps)).
4. **Finding.** Open WebUI passes no `client_info`, so the SDK's default name reaches Unfold, and the Action Record and Ploeg's `X-Ploeg-Via` say `mcp:mcp 0.1.0`, not Open WebUI.

## Not shown

* Open WebUI itself was not run. Its dialog appears only while the chat is open in a browser tab, and waits 60 to 240 seconds ([1-open-webui.md §1](1-open-webui.md#elicitation)); this probe exercised the SDK path behind that dialog, not the dialog.
* The OAuth 2.1 Static sign-in against a real identity provider was not exercised; the probe sent a signed token directly.
* The MCP Apps card was not rendered.
