---
type: how-to
audience: [operator, developer, product-owner]
owner: unfold
last_verified: 2026-11-24
verified_by: "Read docs/how-to/serve-unfold-mcp-over-https.md (Open WebUI section), docs/how-to/ask-from-an-ai-client.md, docs/research/2026-11-20-chat-surfaces-fit.md, apps/unfold/changes/mcp-app-card-opens-in-open-webui.md, apps/unfold/src/mcp.ts (tool names, titles, read-only flags, confirmation and refusal texts), apps/unfold/src/mcp-apps.ts (the two MCP Apps views) and apps/unfold/src/mcp-http.ts (403 texts). Open WebUI's screen and button names were read from its public docs at https://docs.openwebui.com/features/extensibility/mcp on 2026-11-24. No test was run, and nothing was run against Open WebUI or a live Unfold installation."
---

# Open WebUI onboarding

Open WebUI is a shared chat app. Connected to Unfold over MCP, it lets anyone in your organisation ask "what waits for me?" from a chat, open a Work Item as a card, and approve, answer or stop work after confirming each action in a form.

Status: the connection and the confirmation flow were read from Open WebUI's source and tried with the MCP Python SDK it uses ([fit record](../research/2026-11-20-chat-surfaces-fit.md)); Open WebUI itself has not been run against Unfold yet. Do not give clients of your agency access through Open WebUI: Unfold has no client-safe MCP answers yet ([fit record, recommendation 4](../research/2026-11-20-chat-surfaces-fit.md#7-recommendations)).

## Admin: connect Open WebUI once

Before you start:

- Unfold serves its MCP endpoint over HTTPS, such as `https://unfold.example.org/mcp`, with single sign-on ([Serve Unfold's MCP tools over HTTPS](../how-to/serve-unfold-mcp-over-https.md)).
- Open WebUI is 0.12.4 or later; 0.13.0 or later also shows the Work Item card.
- Open WebUI's server can reach the Unfold endpoint. It calls Unfold from its backend, not from the browser.

1. At your identity provider, create a **confidential** client for Open WebUI only, such as `unfold-mcp-open-webui`, with the `unfold:mcp`, `openid` and `offline_access` scopes and the redirect URI `https://chat.example.org/oauth/clients/mcp:unfold/callback`. The last part, `unfold`, is the connection ID you use in step 3; it must never change.
2. On Unfold, add that client id to `UNFOLD_MCP_CLIENT_IDS` and set `UNFOLD_MCP_REQUEST_SCOPES` to `openid unfold:mcp offline_access`.
3. In Open WebUI, as an administrator, open **Settings → Integrations**. Under **External Tool Servers**, choose **+ Add Connection**. Set **Type** to **MCP (Streamable HTTP)**, the URL to `https://unfold.example.org/mcp`, **Auth** to **OAuth 2.1 (Static)**, enter the **Client ID** and **Client Secret**, and choose **Register Client**. Set the **Connection ID** to `unfold` and leave the scopes empty.
4. Under **Access Control**, grant the groups whose members may use Unfold. Without a grant, only administrators see it. Choose **Save**.
5. Do not choose **OAuth**, **Bearer** or **Session** as **Auth**: Unfold refuses those tokens. Connect Open WebUI to Unfold directly, not through an MCP gateway such as LiteLLM's, which drops every confirmation and the card.

Done when: in a new chat you enable Unfold under **+ → Tools**, sign in, and "what waits for me in Unfold?" lists your Work Items.

Full detail: [Serve Unfold's MCP tools over HTTPS, Open WebUI](../how-to/serve-unfold-mcp-over-https.md#open-webui).

## Developer: follow and steer your work from a chat

1. Sign in to Unfold in the browser once, so your account exists.
2. In an Open WebUI chat, choose **+ → Tools** and turn on **Unfold**. Open WebUI sends you to your identity provider; sign in. The grant is kept for your account only.
3. Ask in plain words, for example "what waits for me in Unfold?", "why does Work Item 184 wait?", "what did my Team spend this week?" or "what changed since this morning?".
4. To act, ask for it: "approve Work Item 184", "leave a note on 184 that the tests need a database", "stop 184". Open WebUI shows a form with exactly what will happen and what it may spend. Only ticking **Do it** and submitting acts.

Read-only tools, which never change anything: `unfold_now`, `unfold_find_work`, `unfold_get_work`, `unfold_sessions`, `unfold_linked_sessions`, `unfold_spend`, `unfold_my_usage`, `unfold_digest`, `unfold_permission_requests`.

Action tools, each confirmed in a form first: `unfold_hand_off`, `unfold_approve_work`, `unfold_reject_work`, `unfold_stop_work`, `unfold_retry_work`, `unfold_answer_question`, `unfold_add_note`, `unfold_take_over`, `unfold_hand_back`, `unfold_steer_session`, `unfold_message_session`, `unfold_answer_permission`. `unfold_ask` is free when the record answers the question; asking a model spends from your Team's Ask Allowance and asks you first. `unfold_link_session` links your own agent session without a form and spends nothing. What each tool does: [Ask Unfold and Ploeg from an AI client](../how-to/ask-from-an-ai-client.md#act-on-work).

What you see when it works: `unfold_now` shows the list of what waits for you as a panel (an MCP App), and choosing an item opens its card. The card shows the state, why it waits and the fix, the agent's question, links to the pull request and to Unfold, the last five Runs and spend against the latest Shift's budget. From the card you can **Ask**, answer the question, leave a note and **Approve** a proposal, each confirmed the same way. The card checks for changes every 20 seconds while you can see it ([See a Work Item as a card](../how-to/ask-from-an-ai-client.md#see-a-work-item-as-a-card)).

Differences from Claude Code or VS Code:

- The form appears only while the chat is open in a browser tab, and waits at most 120 seconds by default. Otherwise nothing changes.
- The `now`, `handoff` and `takeover` prompts are not offered; ask in words instead.
- Taking over works, but you pick the work up with `/unfold:takeover` in Claude Code in a clone, not in the chat.
- Your actions are recorded under **Who did what** with the channel `mcp:mcp 0.1.0`, because Open WebUI does not name itself.

## Product owner: follow work and sign it off from a chat

1. Sign in to Unfold in the browser once. Then, in an Open WebUI chat, choose **+ → Tools**, turn on **Unfold** and sign in.
2. Ask what you need to know: "what waits for me in Unfold?", "which Work Items of Team web are in review?", "why is Work Item 184 stuck, and what did it cost so far?". These answers only read, and cost nothing.
3. Act from the chat when you are ready: "approve the proposal 190", "reject 191 because the scope changed", "answer the question on 184: use the existing login page", or "hand task 86b2x on board to Team web". Read the form: it names the Work Item, what will happen and what it may spend. Tick **Do it** and submit, or close it to change nothing.
4. Review and merge the pull request itself on your forge, as before. Unfold links to it from the card.

If your Unfold role is viewer, every action is refused with "Your Unfold role is viewer, which cannot change work. Nothing was changed." Ask your admin for another role.

## When something goes wrong

| What you see | Why | What to do |
| --- | --- | --- |
| 403 "Signed in as …, but no Unfold account belongs to this identity." | You never signed in to Unfold in the browser, or the two identity provider clients give you different subjects | Sign in to Unfold in the browser once, then turn Unfold on again; if it persists, the admin aligns the subject mode |
| 403 "… the token holds none of the groups this workbench admits." | Your groups give you no Unfold role | Ask your admin to add you to an admitted group |
| "Not done: the confirmation was closed without an answer, so nothing was changed." | The form was closed, the tab was not open, or 120 seconds passed | Ask again with the chat open, or use the link it gives and act in Unfold |
| "This client cannot ask you to confirm, so nothing was changed." | Open WebUI is too old, or it reaches Unfold through a gateway that drops forms | Update Open WebUI to 0.12.4 or later and connect it directly |
| "What … would do changed since you confirmed, so nothing was changed." | The Work Item changed between the form and your answer | Ask again to see what it would do now |
| The tools stop working after a while | Open WebUI does not refresh a refused token | Turn Unfold off and on again under **+ → Tools** |
| "App did not initialize" where the card should be | An Unfold release without the card fix | Ask the admin to update Unfold |

More symptoms: [Serve Unfold's MCP tools over HTTPS](../how-to/serve-unfold-mcp-over-https.md#symptom--cause--fix).
