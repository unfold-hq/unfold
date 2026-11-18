---
type: how-to
audience: [owner, operator]
owner: unfold
last_verified: 2026-11-18
verified_by: "Written with the implementation: apps/unfold/src/claude-routines.ts, src/onboarding.ts, src/ploeg-steps.json, public/views/connect-claude.js, public/core/connect-claude.js and public/core/linked-handoff.js, against Ploeg 0.2.0-rc.128's pkg/httpapi/claude_routines.go and docs/contracts/operator-api.v1.schema.json. test/connect-claude.test.ts covers connecting, starting and removing against a fake Ploeg, every refusal of the start, the refusals of a malformed fire URL or token, a viewer, a pin before rc.128, and that the token is in no answer, log line or database row. No real claude.ai routine, self-hosted environment or credential gateway was used."
---

# Connect your Claude routine and start work with it

Use this when your Team's Runs start through your own Claude routine ([Ploeg ADR-0197](../../apps/ploeg/docs/adrs/0197-no-credential-enters-a-run-pod-and-a-credential-gateway-outside-it-attaches-each-one-a-run-uses.md), section 7). When you finish, a Work Item that waits for you starts with one click, on your own Claude account and limits, and no Claude login is stored anywhere.

You need a Ploeg of 0.2.0-rc.128 or later whose installation turned routines on (`PLOEG_CLAUDE_ROUTINES`) behind its credential gateway, a Team with a `claude-environment` Role that has `carrier: routine`, and single sign-on into Unfold, so Ploeg can prove it is you. Before that, Settings → Connect Claude and the onboarding checklist say what is missing.

## 1. Create the routine in claude.ai

1. Create a [routine](https://code.claude.com/docs/en/routines). Choose the installation's [self-hosted environment](https://code.claude.com/docs/en/self-hosted-environments) as its environment, and the repositories your Team works on.
2. Give it a saved prompt that tells Claude to carry out the Ploeg task in the `<routine-fire-payload>` block. Ploeg sends the Work Item's prompt there, and Anthropic marks it as untrusted until the prompt opts in.
3. Add an API trigger. claude.ai shows its fire URL, `https://api.anthropic.com/v1/claude_code/routines/trig_…/fire`, and a token. It shows the token once.

## 2. Paste the fire URL and token in Unfold

Open **Settings → Connect Claude** (`#settings/claude`), or **Connect Claude** on the onboarding checklist. Each of your Teams has a line that says **Connected** or **Not connected**. Paste the fire URL and the token on your Team's line and choose **Connect**.

Unfold sends both to Ploeg as you, only with the proof your single sign-on gives it: without that proof it sends nothing and asks you to sign in again. Ploeg keeps the token in its secret store. Unfold never stores, logs or shows the token: the action log and audit trail record it as `[redacted]`, and no page shows it again. To rotate it, paste the new token and choose **Replace**. **Remove** asks Ploeg to delete the routine and its token.

Ploeg does not say which Teams start their Runs through a routine. Connecting a Team that does not answers that no Role of the Team starts its Runs through a Claude routine.

## 3. Start a Work Item with your Claude

On a Work Item whose Run waits for you, the **Your Claude Code** card shows **Start with my Claude** once your routine for its Team is connected. Ploeg claims the Run, fires your routine with the Work Item's prompt, and records the session it started; the card links to it in claude.ai. Without a connected routine the card shows the `/unfold:start` command and a link to Connect Claude.

## When Ploeg refuses

Ploeg names each refusal and Unfold shows it in plain words, never Ploeg's own message; a code Unfold has no sentence for is named in a general one. Before the claim the Run keeps waiting; after it, the Run ends stuck and the Work Item follows its retry policy. The [error codes](../../apps/unfold/docs/contracts/error-codes.md) list each one.

| Code | What it means | What to do |
| --- | --- | --- |
| `routines_not_accepted` | The installation does not start Runs through routines. | Ask whoever installed Ploeg to turn on `PLOEG_CLAUDE_ROUTINES` with the credential gateway. |
| `credential_gateway_required` | The credential gateway is not configured, so no routine Run starts. | Ask whoever installed Ploeg to configure it. |
| `no_routine_team` | No Role of the Team starts its Runs through a routine. | Connect a routine only for a Team that does. |
| `routine_not_registered` | You have no routine connected for the Team. | Connect it on Settings → Connect Claude. |
| `routine_rate_limited` | Anthropic allows 30 starts an hour per routine and 100 per account, and Ploeg keeps some room below that. | Try again in the next hour. |
| `routine_token_refused` | Anthropic refused the token: it was rotated or the trigger was deleted. The Run ended stuck. | Paste the current fire URL and token. |
| `routine_not_found` | Anthropic has no routine or trigger at the fire URL. The Run ended stuck. | Connect the routine's current fire URL. |
| `routines_unavailable`, `routine_fire_unrecorded`, `routine_session_unrecorded` | Anthropic could not start the session, or Ploeg could not record it. The Run ended stuck. | Stop any session it started in claude.ai, then try again. |
| `invalid_fire_url`, `invalid_token` | The fire URL or token is not what claude.ai shows for an API trigger. Nothing was sent or stored. | Copy them again from the trigger. |
| `secret_store_unavailable` | Ploeg's secret store did not answer. Nothing changed. | Try again later. |

A session that another Claude account starts never takes over your Run: the first session your routine starts ties it to your Anthropic account, and Ploeg refuses a session from any other account. Connect Claude shows whether Ploeg has seen your account yet. That refusal happens between Ploeg and the runner, so Unfold sees it only as a Run that does not finish.
