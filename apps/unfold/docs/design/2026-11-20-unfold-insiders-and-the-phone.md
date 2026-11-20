---
type: design
status: proposed
audience: [contributor, agent, owner]
owner: unfold
last_verified: 2026-11-20
verified_by: "Proposal only; nothing in it is built. API facts read on 2026-11-20 from src/vscode-dts/vscode.proposed.*.d.ts on microsoft/vscode main and from the vsce publish check in apps/unfold/extensions/vscode/node_modules/@vscode/vsce/out/publish.js; phone facts from apps/unfold/docs/browser-ui.md, apps/unfold/public/sw.js, apps/unfold/src/notify/web-push.ts and the notifications.push entry of src/flag-registry.json. Nothing was installed or run against VS Code Insiders."
---

# Unfold Insiders and the phone: be in charge of your work and your agents

This is a design record for a proposed change. Nothing in it is built.

## The test every part must pass

The owner set it on 2026-11-20: a person feels in charge of their work and their agents. They steer where it is needed, they see at once what they need to decide, and they see the open work they can take on, and taking it on is easy. Four rules follow from it and from the existing decisions:

1. The person decides, and sees what it will cost before it does.
2. There is always a way back: stop, take over, hand back.
3. The explanation is where the person already is, in plain words, not in a separate screen.
4. Nothing runs or spends outside Ploeg ([ADR-0002](../../../../docs/adr/adr-0002-ploeg-is-the-only-engine.md), [ADR 0023](../adrs/0023-unfold-submits-work-to-ploeg-and-never-executes-it.md)).

## Decisions taken

| # | Question | Decision |
| --- | --- | --- |
| 1 | Channel for VS Code's proposed APIs | A separate extension, **Unfold Insiders**, `unfold-hq.unfold-workbench-insiders` |
| 2 | Who uses it | The owner and a few early teams on VS Code Insiders, who enable it themselves |
| 3 | What "in charge" means | The test above |
| 4 | The phone | Both: Unfold's own workbench as the dependable base, VS Code's phone Agents window as an experiment in the Insiders channel |
| 5 | First round | Taking on work and seeing the right information; steering through the diff comes second |
| 6 | Feedback | A Feedback command in Unfold Insiders that opens a GitHub issue with the versions and the active proposals |
| 7 | Next to or instead of the extension | Instead of it: Unfold Insiders is the full extension plus the experimental parts, and the person disables `unfold-hq.unfold-workbench` while it is installed |
| 8 | Notifications on the phone | `notifications.push` defaults to on, so every person can choose ntfy or Web Push; nobody gets anything until they choose |

## Why a separate extension

The documentation for proposed APIs says extensions using them should not be published on the Marketplace, and `vsce publish` refuses an `enabledApiProposals` list unless it is bypassed with `--allow-proposed-apis` ([using the proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api); `publish.js` lines 262-266 of the pinned `@vscode/vsce`). Stable VS Code grants proposals only to extensions on Microsoft's own list; elsewhere a call throws ("CANNOT use API proposal"). So:

- Unfold Insiders ships only as a VSIX on each GitHub release, next to the extension's, signed and attested the same way. It goes to neither registry, so the listing, the verified domain and the search keywords of `unfold-hq.unfold-workbench` carry no risk.
- A person runs VS Code Insiders with `--enable-proposed-api unfold-hq.unfold-workbench-insiders`, or adds the identifier to `enable-proposed-api` in `argv.json`.
- Every proposed call is guarded: in Stable, or when a proposal changes, the extension behaves as the normal one and says which parts are off. The Timeline source already handles a refused proposal this way.
- It is built from the same source as the extension, with a second manifest that adds the identifier, `enabledApiProposals` and the `chatSessions` contribution. Sign-in, settings and views stay identical, which is why it replaces the extension rather than running next to it: secrets are kept per extension identifier, and two extensions would ask for two sign-ins.

## Round 1 in VS Code Insiders: take on work, see what to decide

Read from the proposals on `main` on 2026-11-20. None of them makes Unfold run a model; a reply in a session is forwarded to Ploeg as steering, never to `vscode.lm`.

| Surface | Proposal | What the person gets | Test |
| --- | --- | --- | --- |
| Work in the Sessions list | `chatSessionsProvider` (`chat.createChatSessionItemController`, the `chatSessions` contribution) | Work Items and Shifts as sessions with their state, **Needs input** when a person is asked, the files they changed with line counts, and the open and proposed work a person may take on. A new session started from that list takes on a proposed Work Item: it shows the Team, the budget and the typical cost, and approves only after the person confirms | take on, see |
| Work Items and pull requests mentioned in any chat | `chatArtifactIntegrations` (`chat.registerArtifactIntegrationProvider`) | A Work Item or pull request URL in a chat gets a state pill, what it has spent and what it waits on, with **Approve**, **Try again** and **Hand back** that go through the same confirmation as the existing language model tools | see, steer |
| What waits, above the chat input | `chatInputNotification` (`chat.createInputNotification`) | "2 need you", "3 ready for review" or "Team budget 90 % spent", with a button to the Work Item or to **Now** | see |
| Now at a glance | `treeViewMarkdownMessage`, `treeItemMarkdownLabel`, `statusBarItemTooltip` | A line at the top of **Now** ("3 ready for review · €4.10 today", with links), rows whose decisive part is bold, and a status bar hover that loads what runs and what it costs when it opens | see |
| The chat status menu | `chatStatusItem` | How many items need the person and today's spend | see |
| The Agents window without editing settings | `remoteAgentHost` (`chat.registerRemoteAgentHost`) | The workbench registers itself as an agent host on sign-in instead of the extension writing `chat.remoteAgentHosts` into the person's `settings.json` | — |
| Feedback | none | **Unfold Insiders: Send Feedback** opens a GitHub issue prefilled with the VS Code version, the extension version and which proposals are active | — |

Left out: `toolProgress` (useful only for tools Unfold does not have), `remoteCodingAgents` (an empty placeholder whose contribution only runs a command, overtaken by the sessions list) and `chatContextProvider` (it feeds another model, it does not help a person decide).

Open before building:

- Whether the editor window's Sessions list already shows the workbench's sessions through the agent host, so that `chatSessionsProvider` would list them twice. The first build answers it in a running Insiders; if they are listed twice, the provider lists only open and proposed work the person can take on.
- Whether a new session from the list can carry the confirmation a person must give before approval, or must hand over to the existing **Approve Work Item** confirmation.

## The phone

**Base: the workbench.** It already has a phone layout with a bottom bar, the primary action in a sticky bar above it and the command palette as a full-screen sheet ([browser UI](../browser-ui.md)), and it already sends ntfy and Web Push through its service worker ([`sw.js`](../../public/sw.js), [`web-push.ts`](../../src/notify/web-push.ts)) behind `notifications.push`, which defaults to off today. Round 1:

1. `notifications.push` defaults to on (decision 8), and the first visit on a phone offers notifications for "needs you" and "ready for review", once.
2. A notification opens the decision itself, not the dashboard: the question, the approval with its cost, the review.
3. **Take on** on the phone: open and proposed work as a list a thumb can work, approve with the cost shown, hand back, stop.

**Experiment: VS Code's phone Agents window.** VS Code 1.147 has a phone entry for the Agents window, but on the web it asks for a GitHub sign-in and the browser must reach the workbench host over a WebSocket (the [1.147 research](../research/2026-11-19-vscode-1-147-maximal-integration.md), "Web and phone Agents window"). It stays a spike in the Insiders channel; the base does not depend on it.

## Round 2: steer in the diff

`agentEditorComments` and `activeComment` let a person leave a comment on a line of the agent's diff and send it to the running Run as steering. It needs Ploeg to accept steering on a running Run in a stable contract, so it waits for that contract.

## How this is checked

Each part ships with its own tests and a note in the extension's changelog. The record is re-read against `src/vscode-dts` at each VS Code Insiders release, because proposals change without a version number: none of the eleven files read carried a `// version:` line.
