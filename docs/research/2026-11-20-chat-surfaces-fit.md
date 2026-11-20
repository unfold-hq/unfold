# Chat front ends × Unfold: fit record

Date: 20 November 2026, against `origin/development` at `eaca9fd7` with Ploeg pinned at `0.2.0-rc.134`, and Open WebUI at v0.13.4 (17 November 2026). This is a record. It changes no decision by itself. Its condensed verdict is a dated row in the [market landscape](../../apps/unfold/docs/research/market-landscape.md#414-chat-front-ends-the-teams-cockpit-added-20-november-2026), and the work it proposes is listed in [section 8](#8-tickets). The [glossary](../reference/glossary.md) defines each capitalised term.

> **Method.** Four research agents ran in parallel: a source and docs dig of Open WebUI ([1-open-webui.md](evidence/2026-11-20-chat-surfaces/1-open-webui.md)); a sweep of self-hosted chat front ends and embeddable chat frameworks ([2-self-hosted-competitors.md](evidence/2026-11-20-chat-surfaces/2-self-hosted-competitors.md)); a sweep of hosted chat surfaces, the client-portal pattern and absences ([3-hosted-and-absences.md](evidence/2026-11-20-chat-surfaces/3-hosted-and-absences.md)); and a read-only seam map of this repository ([4-seam-map.md](evidence/2026-11-20-chat-surfaces/4-seam-map.md)). One probe ran Unfold's live MCP endpoint against the MCP client Open WebUI uses ([5-probe.md](evidence/2026-11-20-chat-surfaces/5-probe.md)). Checked first-hand rather than taken from an agent: `mcp==2.3.0` in Open WebUI's `backend/requirements.txt` at v0.13.4; the `Client(…)` call in its `utils/mcp/client.py`, which passes an elicitation callback and no client name; LibreChat's elicitation issue #11526 and Open WebUI's CIMD issue #26059, both open; and every statement about Unfold's endpoint, against [mcp-http.ts](../../apps/unfold/src/mcp-http.ts) and [the HTTPS how-to](../how-to/serve-unfold-mcp-over-https.md). No Open WebUI instance was run and no model was called.

## Verdict

**A chat front end is a cockpit for the people who do not live in an editor: leads, product owners and, later, clients. Unfold should not build one for staff. It should serve every front end from `unfold-mcp`, and keep the parts no front end can own: the confirmation, the Action Record and the budget. Open WebUI is the best self-hosted front end for that today, and connects without a code change. Clients are a different matter: no front end, hosted or self-hosted, gives an agency's client an isolated, per-person, confirmable chat with a work engine, and Unfold has no Client-safe MCP surface yet. That is the honest opening, and it is gated on tenancy.**

The two verdict axes, stated separately:

* **Maturity.** Open WebUI ships every two weeks (21 releases since 29 June), has about 159,000 stars, and one founder writes 49 % of the last 90 days' commits; the top three accounts write 97.5 %. Its licence is BSD-3 plus a branding clause that binds above 50 users, and since v0.13 two of its parts, Tether and Terminals, are proprietary. It has a long security advisory record (166 advisories, 72 of them high or critical), including token leaks through tool-server connections. LibreChat (MIT, owned by ClickHouse since November 2025) is the steadier project; Goose is the only one under a foundation.
* **Fit.** Open WebUI is the only self-hosted front end that does both form elicitation and MCP Apps, and it speaks the stateless 2026-07-28 revision that Unfold's endpoint is built around. That decides it for staff. For clients, fit fails on every product, for the same three reasons: no per-client isolation, no guest identity that can confirm an action as itself, and no way to pay a client's model use from the Team's allowance.

**Absences.** Zero third-party mentions of Unfold or Ploeg in the official MCP Registry, PulseMCP, mcp.so, Glama, or the Open WebUI and LibreChat repositories ([3, absence checks](evidence/2026-11-20-chat-surfaces/3-hosted-and-absences.md#absence-checks-unfold-and-ploeg)). The bare name "unfold" is already used by at least three unrelated registry entries and an npm package, which matters if `unfold-mcp` is ever listed.

Summary:

1. **Open WebUI works today.** Its MCP client, the MCP Python SDK 2.3.0, negotiates 2026-07-28 with Unfold's endpoint, shows Unfold's confirmation as a form, acts once on accept and changes nothing on decline ([5-probe.md](evidence/2026-11-20-chat-surfaces/5-probe.md)).
2. **Connect it with OAuth 2.1 (Static) and its own client**, not by forwarding Open WebUI's sign-in token ([section 3](#3-how-open-webui-connects)).
3. **Three gaps on Open WebUI's side:** it names no client, so Action Records say `mcp:mcp 0.1.0`; it ignores MCP prompts; and a confirmation needs the chat open in a browser tab.
4. **The competitors add guests, widgets, budgets and SAML, but not the protocol** ([section 4](#4-what-the-others-offer-that-open-webui-lacks)).
5. **Clients cannot use `unfold-mcp` safely today**: there is no client role, `tenancy.enforce` is off by default, and `unfold_get_work` returns findings and spend that are not Client-safe ([section 5](#5-clients-the-one-honest-scenario)).

## 1. What a chat front end is to Unfold

A chat front end is a multi-user web app that holds conversations with a model and lets the model call tools on MCP servers an administrator added. It owns the model, the conversation history and its own sign-in. Unfold, reached over MCP, owns the facts, the actions and their confirmations.

Unfold already has three chat surfaces of its own, all built: the Ask (one metered question about one Work Item, [ADR-0031](../adr/adr-0031-people-ask-about-a-work-item-through-a-metered-read-only-ask-paid-from-a-monthly-allowance.md)), the "Unfold" chat in the VS Code Agents window ([Unfold ADR 0049](../../apps/unfold/docs/adrs/0049-the-agents-window-has-an-unfold-chat-that-reads-and-acts-on-confirm.md), proposed), and the side chat on a Work Item ([Unfold ADR 0012](../../apps/unfold/docs/adrs/0012-agent-host-protocol-host.md)). All three run the model through Ploeg's admission and allowance. ADR 0049 rejected "only `unfold-mcp` in another chat" because that chat's model use is outside Ploeg's allowance. That reason still holds for clients; for staff on a front end the organisation already pays for, it does not.

## 2. Layer map

| Layer | Open WebUI | Unfold | Ploeg | Nobody |
| --- | --- | --- | --- | --- |
| Who the person is | Its own sign-in (OIDC, LDAP, SCIM) | Maps the access token's subject to the account browser sign-in made ([mcp-http.ts](../../apps/unfold/src/mcp-http.ts)) | Maps groups to Operator Consumers in `ploeg-mcp` | **A Client's person as a confirmable identity** |
| Model and conversation | Owns both; spend goes to its own provider key | Only in its own chats | Admits and meters Unfold's chats | **A client's model use paid from the Team's allowance in a third-party front end** |
| Tools and facts | Lists the tools, hides app-only ones | 23 tools, prompts, resources, two MCP Apps views | 13 `ploeg_*` tools | |
| Confirmation | Shows the form while the tab is open | Seals it, binds it to the person and the text, acts once | Asks again for its own tools | |
| Record of the action | none | Action Record with channel and confirmation hash ([ADR-0037](../adr/adr-0037-people-act-on-work-through-either-mcp-server-and-every-action-names-its-person-channel-and-confirmation.md)) | Records `X-Ploeg-Via` and the actor | |
| Client isolation | Groups and access control per connection | Client memberships, only under `tenancy.enforce` | Teams | **Client-safe answers over MCP** |

The two empty seats in the last column are where the client scenario lives.

## 3. How Open WebUI connects

Open WebUI v0.13.4 offers six authentication modes for an MCP connection. Only OAuth 2.1 (Static) fits Unfold's resource server cleanly:

| Mode | What it sends | Fit |
| --- | --- | --- |
| None, Bearer | Nothing, or one shared token | Refused: Unfold accepts only a person's access token |
| Session | The person's Open WebUI session token | Refused: not issued by Unfold's provider |
| OAuth | The access token of the person's Open WebUI SSO sign-in | Works only if Open WebUI signs in at Unfold's provider, and then only by accepting every token issued to Open WebUI's own client under `UNFOLD_MCP_TOKEN_AUDIENCE=client-id`. Rejected |
| OAuth 2.1 (DCR) | A per-person token from a client Open WebUI registers itself | Works where the provider allows dynamic registration; Authentik does not |
| **OAuth 2.1 (Static)** | A per-person token from a pre-registered **confidential** client | **Chosen.** Per person, refreshed, and the client id is Open WebUI's alone |

The mechanics, from the source ([1-open-webui.md](evidence/2026-11-20-chat-surfaces/1-open-webui.md#3-auth-modes-for-mcp-connections) and its follow-up): Open WebUI discovers the provider through Unfold's RFC 9728 metadata, uses PKCE S256, sends the RFC 8707 `resource` parameter, requests the scopes in the metadata's `scopes_supported` when the connection names none, stores each person's tokens encrypted against their account, and refreshes five minutes before expiry. Its redirect URI is `<WEBUI_URL>/oauth/clients/mcp:<connection id>/callback`. It supports no public client and no CIMD. The steps are in [Serve Unfold's MCP tools over HTTPS, Open WebUI](../how-to/serve-unfold-mcp-over-https.md#open-webui).

What the probe showed and what it did not ([5-probe.md](evidence/2026-11-20-chat-surfaces/5-probe.md)): the SDK path behind Open WebUI's dialog confirms and declines correctly against Unfold. Open WebUI itself, its dialog and its sign-in were not run.

## 4. What the others offer that Open WebUI lacks

From [2-self-hosted-competitors.md](evidence/2026-11-20-chat-surfaces/2-self-hosted-competitors.md) and [3-hosted-and-absences.md](evidence/2026-11-20-chat-surfaces/3-hosted-and-absences.md), each checked against Open WebUI's own docs:

| Missing in Open WebUI | Who has it | Matters to Unfold? |
| --- | --- | --- |
| Guests or anonymous chat | Onyx (anonymous users), Claude Tag ("Channel only" for client channels) | Yes for clients, but neither gives a guest an identity that can confirm |
| A first-party widget for another site | Onyx (per-visitor JWT), AnythingLLM | Yes for a client page, without elicitation or MCP Apps |
| Spend limits per person or group | Onyx Enterprise, LibreChat (balance, rate), AnythingLLM (daily messages) | Only for front-end spend; Unfold's own spend already sits behind Ploeg |
| SAML | LibreChat (free), Onyx Enterprise | No: Unfold signs in through OIDC |
| CIMD | Onyx, LobeHub, Msty, ChatGPT, Claude | Small: saves registering one client per front end |
| MCP prompts in the UI | Cherry Studio, Vercel AI SDK | Small: `now`, `handoff` and `takeover` stay unused in Open WebUI |
| Audit log in an admin UI | LibreChat, AnythingLLM | No: Unfold keeps its own Action Records |
| White-labelling above 50 users | Every MIT front end | Yes, only if a front end were shown to clients |
| A directory that reaches people who already pay | ChatGPT, Claude, Microsoft, Slack | Later: needs a public endpoint and a public provider |

What none of them has, hosted or not: form elicitation **and** MCP Apps **and** guests with their own identity. Elicitation over 2026-07-28 is documented only by Open WebUI, ChatGPT (which also requires its own `openai/elicitation` extension for listed apps), Microsoft's Copilot Cowork, Goose and the Vercel AI SDK. claude.ai has no elicitation (anthropics/claude-ai-mcp#153, open), so every Unfold action there answers with the link to Unfold; reads work.

## 5. Clients: the one honest scenario

The opening: an agency's client talks to a chat that files a request, follows it to a reviewed pull request, answers the agent's questions and signs off. [3, client-portal pattern](evidence/2026-11-20-chat-surfaces/3-hosted-and-absences.md#client-portal-pattern-client-talks-to-an-agent-that-files-and-follows-dev-work) found the parts (Linear Asks in shared Slack channels, Jira Service Management's Rovo request agent, Intercom Fin acting over MCP, Slack-to-pull-request coding agents) and nobody who sells the whole. It matches what [ADR-0005](../adr/adr-0005-unfold-is-offered-to-agencies.md) and [ADR-0007](../adr/adr-0007-clients-approve-ready-work.md) already decided: a client portal is part of Unfold, and the client may talk to the refinement agent in the request thread.

What stands in the way, from [4-seam-map.md §3](evidence/2026-11-20-chat-surfaces/4-seam-map.md#3-clients-agency-customers):

* **No client role.** Roles are admin, operator and viewer; a Client is a membership that only narrows what a person sees, and only while `tenancy.enforce` is on, which is off by default. A client contact can reach `unfold-mcp` only if an administrator also gives them a staff role.
* **No Client-safe answer over MCP.** `unfold_get_work` returns Runs, findings, spend and Ploeg's own words. The Client-safe brief exists only on the Ask path, and every caller asks for the internal one.
* **An operator-role account with only a client membership could approve or stop its own Client's Work Items**, because those routes check the role, not the membership kind. Not tested; [ADR-0017](../adr/adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md) does not clearly allow it.
* **Spend.** A third-party front end pays the model from its own key, outside Ploeg's allowance, which is the reason ADR 0049 kept Unfold's own chat on Ploeg's admission.

The architectural tension: the surface that serves clients best is one Unfold owns, because only that one can pay from the Team's allowance and bind a client's confirmation to a client identity. Unfold ships no production npm dependencies ([Unfold ADR 0002](../../apps/unfold/docs/adrs/0002-native-node-and-single-writer-storage.md)), so the frameworks that do this best, the Vercel AI SDK and assistant-ui, cannot go into the Unfold application as they are. A client chat page would reuse what the Agents-window chat already does in process (a Ploeg chat admission, the same tools over 2026-07-28, the person's Allow as `inputResponses`), rendered in the browser instead of over AHP.

## 6. The cockpit

The [market landscape](../../apps/unfold/docs/research/market-landscape.md#413-t3-code-the-free-cockpit-added-3-november-2026) says "do not compete at the cockpit" for developers: VS Code, T3 Code and the Codex app own that seat. A chat front end is the same seat for everyone else. The same rule applies: do not build a staff chat; be the server every chat reaches, and own the confirmation and the record. Section 6 of the landscape already names the promise this serves: "the same work is controllable from several surfaces … they must observe the same session and authorization decisions, not three disconnected chat histories". Each front end gets its own channel in the Action Record, which is why the `mcp:mcp 0.1.0` gap matters.

## 7. Recommendations

1. **Connect Open WebUI to `unfold-mcp` with OAuth 2.1 (Static) and a confidential client of its own**, as the how-to now says. No Unfold change is needed. The installation's own configuration lives in the repository of the cluster that runs it.
2. **Ask Open WebUI to name itself.** One line, `client_info=Implementation(name='Open WebUI', version=…)` in its `Client(…)` call, turns `mcp:mcp 0.1.0` into `mcp:Open WebUI 0.13.x` in every Action Record. Upstream needs a CLA.
3. **Do not move staff to another front end.** LibreChat lacks elicitation, LobeHub lacks elicitation and MCP Apps, Onyx documents neither. Re-check at the triggers below.
4. **Do not put clients in any third-party front end, Open WebUI included.** No product isolates clients, and Unfold has no Client-safe MCP surface.
5. **Build the client chat into the portal when tenancy is enforced**, on the Ploeg chat admission and the Client-safe brief, as one ticket after the client role exists. Keep `ploeg-mcp` out of shared front ends: its tokens map to Operator Consumers, not to people.
6. **Correct the record.** ADR-0032 still says a 2025 client cannot be asked over HTTP; an entry of today records that it can, and that a 2026-07-28 Python client confirms.

### Re-evaluation triggers

* LibreChat ships form elicitation (issue #11526 closes): re-compare it with Open WebUI for staff, for its MIT licence and free SAML.
* Onyx documents elicitation or MCP Apps: re-check it as the packaged client chat, because it already has anonymous users and a per-visitor widget.
* claude.ai ships elicitation (anthropics/claude-ai-mcp#153 closes): actions work in Claude, which then needs a public endpoint.
* Unfold gains a client role or turns `tenancy.enforce` on by default: open the client chat ticket.
* Open WebUI moves MCP connections, elicitation or MCP Apps under its enterprise licence, as it did with Tether and Terminals: re-run this comparison.
* Open WebUI fixes refresh after a 401 (#34699) or ships CIMD (#26059): drop the matching caveat from the how-to.

## 8. Tickets

Proposed, not filed:

1. **Open WebUI names itself on MCP calls.** An upstream pull request to open-webui/open-webui that passes `client_info` in `utils/mcp/client.py`. Done when an Action Record made through Open WebUI shows `mcp:Open WebUI <version>`.
2. **A client role and Client-safe MCP answers.** Prerequisite for any client chat: a client account signs in without a staff role, reads only its Client's Work Items through the Client-safe brief, and cannot approve, stop or steer. Builds on [ADR-0017](../adr/adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md) and the proposed Client-facing connector in [identity.md](../../apps/unfold/docs/research/agent-standards/identity.md).
3. **Test whether a client-membership operator can approve or stop work.** Turn the untested inference in section 5 into a test, and fix it if it holds.
4. **Spike: a client chat in the portal on Ploeg's chat allowance.** After ticket 2. The Agents-window chat's engine in the browser, without a production dependency.
5. **Try Open WebUI end to end** against a staging Unfold: sign-in, confirmation dialog, MCP Apps card, refresh. Record the result in the how-to's `verified_by`.

## Not verified

* Open WebUI was not run. Its confirmation dialog, OAuth 2.1 (Static) sign-in, the Work Item card and refresh behaviour were read from source, not seen.
* Whether an identity provider accepts the colon in Open WebUI's redirect path.
* Competitor and hosted-surface claims rest on their docs on 20 November 2026; several OpenAI help pages refused automated fetches and rest on search snippets.
* The client-membership approve path in section 5 is inferred from code, not tested.
