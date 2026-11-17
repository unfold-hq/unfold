---
status: proposed
date: 2026-11-17
decision-makers: Ryan Grippeling
review-by: 2027-02-28
---

# A person sees their own usage, and nobody else's

## Context and Problem Statement

A person who uses Claude through Unfold cannot see what that use cost them. The figures exist, spread over three places: their Asks carry a cost from Ploeg, the Work Items they started in Unfold carry a budget and spend, and their Linked Sessions carry Claude Code's own estimate in the metrics store ([ADR 0047](0047-people-link-their-own-agent-sessions-through-a-plugin-agent-trace-and-telemetry-never-a-claude-sign-in.md)). Now lists "Your questions" without a total, and Agent sessions shows only the Linked Session estimate.

System [ADR-0023](../../../../docs/adr/adr-0023-unfold-measures-happiness-and-confusion-with-first-party-events-surveys-and-bug-reports.md) treats per-person views of agency staff as employee monitoring, which needs works council consent and a DPIA. Where does a person see their own usage, and how does that stay theirs?

## Decision Drivers

* A person can answer "what did my AI use cost this month?" from one screen.
* A per-person figure must not become a view of other people's use, for an administrator either.
* A cost Unfold does not know is never shown as zero ([ADR-0036](../../../../docs/adr/adr-0036-ploeg-and-unfold-use-one-vocabulary-with-named-screen-words.md)'s cost status: unknown is never zero).
* No new store, collector or Ploeg change: only data Unfold already keeps.

## Considered Options

* **Your usage under Settings, Yours, read from Unfold's own records and keyed on the caller's id**
* A per-person section on Insights, which administrators read for the whole workbench
* Wait for Ploeg to report spend per person and show everything at once

## Decision Outcome

Chosen option: "**Your usage under Settings, Yours, keyed on the caller's id**", because it gives the person their own figures now and gives nobody else a way to read them.

1. **Where.** `#settings/usage`, labelled "Your usage" in the Yours group next to Agent sessions, and `GET /api/me/usage`. The MCP tool `unfold_my_usage` reads the same route.
2. **Whose.** Every read is keyed on the caller's own id, whatever their role. There is no parameter that names another person, and an administrator sees their own usage here. Unfold builds no ranking or comparison between people.
3. **What.** For the current UTC calendar month (the period an Ask Allowance resets on) or the last 30 days: Asks created in the period with their cost; sessions the person owns that changed in the period, with their whole spend against their budget; and the person's Linked Sessions seen in the period with Claude Code's cost estimate and tokens, labelled an estimate at API prices that a Claude plan is not billed.
4. **Unknown and missing.** An amount Unfold does not know reads "Not known yet", a sum with unknown parts "At least", and Linked Sessions without a metrics store read "No telemetry connected". Demo items are left out and counted. Work Items handed to Ploeg and Agents-window chat messages are listed as not attributed yet: Ploeg pays them from Team budgets and does not report spend per person.

### Consequences

* Good, because a person sees their own Asks, sessions and Claude Code estimate in one place, with what is not counted named.
* Good, because no route reveals another person's usage, so the view is not monitoring under ADR-0023.
* Bad, because the total leaves out the largest spend, work handed to Ploeg, until Ploeg attributes it. Accepted: it is named on the page, never summed as zero.
* Bad, because a session or Linked Session counts its whole spend in any period it was active in, so a long session also counts in the next month. Accepted for now: neither record keeps spend by day.

### Confirmation

* `npm test` in `apps/unfold`: `test/my-usage.test.ts` (another person's Asks, sessions and Linked Sessions never reach the answer, an administrator gets only their own, the metrics store is asked only about the caller's sessions, unknown costs are not summed as zero) and `test/usage-view.test.mjs` (the page's wording for unknown, partial and unconnected figures); `test/mcp.test.ts` calls `unfold_my_usage`.
* All of it runs through `mise run verify`.

## Pros and Cons of the Options

### A per-person section on Insights

* Good, because Insights already shows spend.
* Bad, because administrators read Insights for everyone, which makes it a per-person view of staff under ADR-0023.

### Wait for Ploeg's per-person spend

* Good, because the total would be complete.
* Bad, because Ploeg has no such report and nothing is planned, so the person keeps seeing nothing.

## More Information

* Contract: [HTTP contract, Your usage](../contracts/api.md#your-usage); behaviour: [Browser UI, Settings and sign-in](../browser-ui.md#settings-and-sign-in).
* Re-evaluate when Ploeg reports spend per person (`acts_for`, `handed_by` on Work Items), or when sessions record spend by day.
* 2026-11-17: proposed with its implementation.
