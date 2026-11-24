---
type: how-to
audience: [operator, developer, product-owner]
owner: unfold
last_verified: 2026-11-24
verified_by: "Written on 2026-11-24 from docs/how-to/link-claude-code-sessions.md, send-every-claude-code-session-to-unfold.md, connect-your-claude-routine.md and install-the-unfold-plugin.md, checked against apps/unfold/extensions/claude-code (README.md, .claude-plugin/plugin.json, commands/*.md, skills/, scripts/sign-in.mjs for the sign-in message), apps/unfold/public (shell.js for the Settings page names, views/editor-sign-in.js, views/linked-sessions.js, views/connect-claude.js, core/linked-handoff.js, core/linked-sessions.js, core/take-over.js), apps/unfold/src/linked-sessions.ts for who sees a Work Item's sessions, and apps/unfold/ploeg-release.json for the pinned Ploeg (0.2.0-rc.134). Nothing was run: no plugin install, no sign-in, no managed settings rollout and nothing against a live installation."
---

# Claude Code onboarding

People who work in their own Claude Code see each session on the Work Item it works on, with its state, the lines the agent wrote and Claude Code's own cost estimate. They can hand a session's work to Ploeg, or take Ploeg's work into their own session. Unfold never holds anyone's Claude sign-in: the plugin uses only the person's own Unfold credential ([ADR 0047](../../apps/unfold/docs/adrs/0047-people-link-their-own-agent-sessions-through-a-plugin-agent-trace-and-telemetry-never-a-claude-sign-in.md)).

**Status:** session linking, hand-off and `/unfold:start` run against the pinned Ploeg (0.2.0-rc.134). Taking over a running Run follows [Ploeg ADR-0142](../../apps/ploeg/docs/adrs/0142-a-person-takes-over-a-running-run-at-its-next-safe-point-and-hands-it-back-on-the-same-branch.md), which is proposed there, and does not work for Claude Code Runs yet. Starting work through your own Claude routine works only when the Ploeg installation turned routines on. The Unfold channel needs a Claude Code research-preview flag.

## Admin: connect Claude Code once

Before you start:

* Unfold has single sign-on configured: the plugin's sign-in is Unfold's editor sign-in.
* For cost and tokens: a collector that writes to a metrics store, with Unfold's `observability.metricsUrl` pointing at it ([live operation](../../apps/unfold/docs/operations/live.md#linking-the-estates-observability)).
* Node 22 or later on every machine.

1. Choose how settings reach every machine: device management (Jamf, Intune, Group Policy), a `managed-settings.json` file, or server-managed settings in the claude.ai admin console. Device management or the file reaches every machine and asks nobody anything; a repository's `.claude/settings.json` cannot switch telemetry on ([compare them](../how-to/send-every-claude-code-session-to-unfold.md#choose-how-the-settings-reach-every-machine)).
2. Put at least these keys in that source, with your own Unfold address:

    ```json
    {
      "env": { "UNFOLD_URL": "https://unfold.example.org" },
      "extraKnownMarketplaces": {
        "unfold": { "source": { "source": "git", "url": "https://github.com/unfold-hq/unfold.git" } }
      },
      "enabledPlugins": { "unfold@unfold": true }
    }
    ```

3. Add the telemetry keys and, for metrics signed with each person's identity, the telemetry helper. The full set is in [The settings](../how-to/send-every-claude-code-session-to-unfold.md#the-settings).
4. On one machine, run `/status` in Claude Code and check that `Setting sources` shows `Enterprise managed settings`.
5. Run `/unfold:login status` there, start a session and work for a minute.

**Done when** the session shows under **Settings › Agent sessions** within a second, and its cost estimate about a minute later. Full guide: [Send every Claude Code session in your organisation to Unfold](../how-to/send-every-claude-code-session-to-unfold.md).

## Developer: link your sessions and move work to and from Ploeg

1. **Install**, unless your admin already did. Add `"env": { "UNFOLD_URL": "https://unfold.example.org" }` to `~/.claude/settings.json`, then run in Claude Code:

    ```text
    /plugin marketplace add https://github.com/unfold-hq/unfold.git
    /plugin install unfold@unfold
    ```

2. **Sign in once.** Start a session. It shows `Unfold: approve the sign-in in your browser to link this session. Check that it shows BCDF-GHJK.` On the **Approve an editor sign-in** page, check the code and press **Approve**. Nobody pastes a token. The plugin renews itself and asks again about every 90 days.
3. **Link the session to a Work Item.** Work on a branch that names the ticket, such as `feat/vik-123-login`, or name the ticket or Work Item in a prompt. You can also ask for it with `/unfold:link-work-item`, or press **Link** on the session's page.
4. **Hand work to Ploeg.** Run `/unfold:handoff` in the session. It shows a preview of the Team, the spend, the branch and the diff, and sends nothing until you say yes. On the session's page, **Let Ploeg finish this** and **Start a Work Item from this session** do the same without the diff.
5. **Take work from Ploeg.** On the Work Item's **Your Claude Code** card, **Continue in my Claude Code** gives a command to copy and run in a clone of the repository. When a Run waits for your own Claude Code, the card shows `/unfold:start <id>`, or **Start with my Claude** once you connected your routine on the Claude card of **Settings › Linked accounts** (only when your Ploeg installation starts Runs through routines). Taking control of a running Run (**Take control**, then `/unfold:takeover <id>` and `/unfold:handback <id>`) is proposed in Ploeg and refused for Claude Code Runs: "Claude Code Runs cannot stop between steps yet."
6. **Hand over for review.** `/unfold:brief` writes a Delivery Brief of what changed and how it was checked, and adds its link to the Work Item.

**When it works,** your session is listed under **Settings › Agent sessions**, and the Work Item's **Agent sessions** card shows it with its state, branch and AI-written lines.

**When it fails,** run `/unfold:login status`, then `/unfold:login`. Run one session with `UNFOLD_HOOK_DEBUG=1` to see the hook's errors.

More: [Link your Claude Code sessions to Work Items](../how-to/link-claude-code-sessions.md), [Connect your Claude routine](../how-to/connect-your-claude-routine.md), and the [plugin's commands](../../apps/unfold/extensions/claude-code/README.md#commands).

## Product owner: see who works on a Work Item

1. Open the Work Item. The **Agent sessions** card lists every session people run on their own machines that is linked to it, with its owner, state, branch and AI-written lines.
2. A warning at the top of the card means two sessions, or a session and a running Ploeg Run, work the same Work Item at once. Ask the developer to stop one or move it to its own branch.

You see the cost only of your own sessions; administrators see the total. More: [Link your Claude Code sessions](../how-to/link-claude-code-sessions.md#4-work-as-usual).

## When something goes wrong

| What you see | Why | What to do |
| --- | --- | --- |
| No session appears under **Settings › Agent sessions** | `UNFOLD_URL` is missing where Claude Code starts, or the sign-in is not approved yet | Run `/unfold:login status`, then `/unfold:login` |
| The browser never opens for the sign-in | Claude Code runs without a browser, such as over SSH, or the last sign-in was denied or ignored less than an hour ago | Open the link the session shows, or run `/unfold:login` |
| `/unfold:login` says Unfold did not start a sign-in | Unfold has no single sign-on, or `UNFOLD_URL` is wrong | Ask the admin to configure single sign-on |
| The session does not link to the Work Item | The branch names no ticket, none of your task sources holds it, or you unlinked it before | Press **Link** on the session's page |
| **No telemetry for this session** | Telemetry is off, or Unfold has no `observability.metricsUrl` | Enable telemetry; the admin sets the store address |
| **Cost: Not known yet** | The metrics store holds nothing for the session yet | Wait a minute |
| `/unfold:handoff` is refused with `plugin_update_required` | The plugin is 0.17.0 or older | Update the plugin and run it again |
| **Take control** is disabled: "Claude Code Runs cannot stop between steps yet." | Only ACP Runs can stop between steps | Cancel the Run or wait for it to finish |

The full table is in [When it does not work](../how-to/link-claude-code-sessions.md#when-it-does-not-work); routine refusals are in [When Ploeg refuses](../how-to/connect-your-claude-routine.md#when-ploeg-refuses).
