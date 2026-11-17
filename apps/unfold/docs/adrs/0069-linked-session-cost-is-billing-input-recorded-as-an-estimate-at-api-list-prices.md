---
status: proposed
date: 2026-11-17
decision-makers: Ryan Grippeling
review-by: 2027-02-28
---

# Linked Session cost is billing input, recorded as an estimate at API list prices

## Context and Problem Statement

An agency that runs Unfold bills its clients for the AI work done on each Work Item. Much of that work does not run in Ploeg: people run Claude Code on their own machines and link the session to the Work Item ([ADR 0047](0047-people-link-their-own-agent-sessions-through-a-plugin-agent-trace-and-telemetry-never-a-claude-sign-in.md)). On 2026-11-17 the owner decided that the agency invoices this cost: Claude Code's estimate at API prices, per Work Item, plus a margin it sets. The same day the owner extended the margin to Ploeg's metered Run cost, settable per source, with the two sources never mixed.

Until now Unfold read that estimate live from the metrics store, by session id, every time a page asked (`src/linked-telemetry.ts`). The store keeps samples for a limited time (30 days was observed), so the figure behind last month's invoice could be gone by the time it is checked or billed again. Nothing in Unfold kept it. [ADR 0068](0068-a-person-sees-their-own-usage-and-nobody-elses.md) had chosen "no new store" for Your usage.

How does Unfold keep Linked Session cost so that it can be billed per Work Item, honestly labelled, and still there after the metrics store forgets it?

## Decision Drivers

* The amount on an invoice must be traceable to a recorded fact with a source and a time, and must not change later.
* An estimate is never shown as zero when it is unknown, and Unfold never invents an amount ([system ADR-0036](../../../../docs/adr/adr-0036-ploeg-and-unfold-use-one-vocabulary-with-named-screen-words.md) cost status).
* The agency's margin is its own commercial choice; it must not alter a recorded or metered amount, and changing it must not rewrite what was already billed.
* A metered cost and an estimate are different facts: each keeps its source on every row and figure, and an estimate is never added into a metered amount.
* No cost is counted twice when one session worked on several Work Items.
* A per-person view of staff stays out of reach ([system ADR-0023](../../../../docs/adr/adr-0023-unfold-measures-happiness-and-confusion-with-first-party-events-surveys-and-bug-reports.md), ADR 0068).
* Standard formats out ([system ADR-0050](../../../../docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md)): extend the FOCUS export rather than add a second one.

## Considered Options

* **Record cumulative readings per session in the workbench database, bill per Work Item and day, and keep the markup as dated rows per source applied only to a billable column**
* Keep reading live and ask operators to raise the metrics store's retention
* Store one figure per session, overwritten on every read
* Bake the markup into the recorded figure
* One markup for every cost, with no source

## Decision Outcome

Chosen option: "**Record cumulative readings, bill per Work Item and day, dated markups per source on a billable column**", because it keeps the figure after the store forgets it, makes every billed amount traceable to a reading or a metered Run, and keeps the margin apart from the fact.

1. **What is recorded.** `linked_session_usage` holds readings of a Claude Code session's cumulative estimate and tokens: `session_id`, `observed_at`, `cost_micros` (whole micro-dollars), the four token counts and `source` `telemetry-estimate`. The amount is Claude Code's own `claude_code.cost.usage` estimate at API list prices, which a Claude plan is not billed.
2. **When.** After every live telemetry read of a session's own page or a Work Item page, and through the durable job `linked.usage` three minutes after the session reports `idle` or `end` (Claude Code exports metrics once a minute). Repeated notices coalesce into one job.
3. **Never lower, never invented.** A reading with neither cost nor tokens records nothing, so an empty answer is not a $0 fact. A reading lower than the last one, as a store that dropped old samples answers, keeps the higher figure. An unchanged reading adds no row.
4. **Per day.** A day's charge is what that day's readings added to the cumulative figure, so a month boundary splits a long session by when its cost was read. Cost before a session's first reading lands on that first day.
5. **Per Work Item.** A session's daily charge is split evenly over the Work Items it is linked to when the charge is computed, in whole micro-dollars with the remainder on the first ones, so the parts add up to the session's charge exactly.
6. **Two sources.** A cost is `ploeg-run` (a Ploeg Run's spend as the model gateway metered it) or `linked-session` (the recorded telemetry estimate). Each keeps its own rows in the export and its own figures on the Work Item page, and `x_UnfoldCostSource` (with `x_UnfoldCostBasis` `metered` or `telemetry-estimate`) names it on every row. No figure adds an estimate to a metered amount; the Work Item page's former "Total cost", which did, is gone.
7. **Markup.** `usage_markups` holds a markup in basis points per Tenant, optionally per Client, for a `source`: `ploeg-run`, `linked-session` or `all`, the default, so one percentage covers both until a source gets its own. For one source on one day the first in effect wins: the Client's for that source, the Client's for `all`, the Tenant's for that source, the Tenant's for `all`; none means 0. The billable amount is the cost times (1 + markup); the recorded estimate and the metered cost never carry it. The first markup of an owner and source may start on any date; after that a markup starts today or later, and only one not yet in effect may be replaced, so a day already billed keeps its amount. Administrators set it through `PUT /api/billing/usage-markups`.
8. **Where it shows.** Each session carries `recordedUsage` on its page and on the Work Item. `GET /api/linked-sessions?workItemId=&telemetry=1` adds `usage` with `linkedSessions` (recorded estimate, billable amount, today's markup; every session for an administrator, only the caller's own for anyone else) and `ploegRuns` (metered spend, and the billable amount of closed Shifts with the `ploeg-run` markup of the day each closed). The page shows metered, estimated and each billable amount apart. Your usage shows the recorded sum when the live sum is gone or lower, and says so.
9. **Export.** `GET /api/ploeg/cost-export` marks every Run row `ploeg-run`, `metered`; a settled one gets `x_UnfoldMarkupPercent` and `x_UnfoldBillableCost` while `BilledCost` stays the metered cost, and an unsettled one is never billable. With `linkedSessions=include` it adds one row per Work Item and day: `ListCost` the estimate, `BilledCost` and the other paid costs 0 (nobody invoiced it, and FOCUS keeps estimates out of `BilledCost`), `linked-session`, `telemetry-estimate`, `x_UnfoldEstimatedCost`, `x_UnfoldMarkupPercent` and `x_UnfoldBillableCost`. A row names the Work Item and its owner, never the session or the person; the owner accepted this per-Work-Item export for operators on 2026-11-17.
10. **Tenant export.** Both tables are in the Tenant export: readings under their Linked Session, markups under their Tenant.

### Consequences

* Good, because the figure behind an invoice survives the metrics store's retention, and every billed amount traces to a reading with its time and source.
* Good, because the markup never touches a recorded or metered amount, a markup of 0 bills the cost exactly, changing a markup cannot change a day already billed, and each source can carry its own margin.
* Good, because a reader always knows whether a figure was metered or estimated: the two are never added.
* Good, because a session worked on two Work Items is billed once, split between them.
* Bad, because a session nobody opened and that never reported `idle` or `end` (a crash, a machine that slept) is recorded only if someone opens it within the store's retention. Accepted: the hooks send `idle` after every turn.
* Bad, because the attribution follows the links at the time of export. Unlinking a Work Item moves its share of past days to the session's other Work Items, or out of the export. Accepted for now; re-evaluate if invoices are disputed.
* Bad, because a Work Item's figure combines several people's sessions for an administrator and in the export. It is a figure per Work Item, not per person, and names no person, but on a Work Item one person worked alone it equals that person's use. The owner accepted the per-Work-Item export for operators on 2026-11-17.
* Bad, because the Work Item page no longer shows one total; a reader adds metered and estimated amounts themselves if they want to. Accepted: the owner ruled that an estimate is never mixed into a metered figure.
* Bad, because the amount is an estimate at API list prices, not what the agency paid: on a Claude plan the agency pays a seat, not these prices. The estimate is labelled as such everywhere, and the decision to invoice it is the agency's.

### Confirmation

* `npm test` in `apps/unfold`: `test/linked-usage.test.ts` (a reading with neither cost nor tokens is not kept, a lower later reading keeps the higher figure, the estimate survives the metrics store losing the session on the session and the Work Item, `idle` and `end` queue one read that records it, another person sees only their own share, a split adds up exactly, markup 0 equals the estimate, a markup change never rewrites an earlier day and a backdated one is refused, a markup for `all` applies to both sources and one for a source only to that source, the Work Item's linked total and the export's Linked Session rows use the `linked-session` markup, Ploeg's metered spend stays unmarked and only closed Shifts bill, the FOCUS rows only with `linkedSessions=include` and without a session or person, Your usage falls back to the recorded sum, only administrators set a markup); `test/focus-export.test.ts` for the column types and a settled Run billing its metered cost plus the `ploeg-run` markup, never the estimate one, with `BilledCost` unchanged and unsettled spend never billable; `test/linked-handoff-view.test.mjs`, `test/linked-sessions-view.test.mjs` and `test/usage-view.test.mjs` for the pages.
* The key tests were mutation-checked when written: removing each guard (higher figure kept, empty reading skipped, recording on the Work Item read, backdating refused, the split, markup 0, unreadable Work Items left out) makes a test fail, and so does each wrong-source mutation: the `linked-session` markup on a Run row, the `ploeg-run` markup on the export's or the Work Item's Linked Session figures, source markups ignored, a Run's billable amount without its markup, the markup baked into `BilledCost`, and open Shifts billed.
* All of it runs through `mise run verify`.

## Pros and Cons of the Options

### Keep reading live and raise retention

* Good, because it adds nothing to Unfold.
* Bad, because retention belongs to whoever runs the metrics store, often not the agency, and a longer retention still ends; the invoice's figure stays one query away from gone.

### One figure per session, overwritten

* Good, because it is one row per session.
* Bad, because it cannot say which month a long session's cost belongs to, and an overwrite leaves no trace of what a past export read.

### One markup for every cost, with no source

* Good, because it is one number to set.
* Bad, because an agency may price its own metered spend and an estimate of a person's own seat differently, which the owner asked for.

### Bake the markup into the recorded figure

* Good, because the billable amount needs no computation.
* Bad, because the recorded fact would no longer be the estimate, a markup change could not be told apart from a cost change, and the owner ruled it out.

## More Information

* Contract: [HTTP contract, Linked Sessions and Billing](../contracts/api.md); [FOCUS cost export](../operations/focus-cost-export.md#linked-session-estimates); how-to: [Link your Claude Code sessions](../../../../docs/how-to/link-claude-code-sessions.md#what-a-session-costs-and-how-it-is-billed).
* Amends ADR 0068's "no new store" driver for the Linked Session estimate, and its consequence that no record keeps spend by day.
* Re-evaluate when Claude Code or the agency's plan reports billed cost per session, when invoices are disputed over attribution, or when Ploeg reports linked work itself.
* 2026-11-17: proposed with its implementation; the same day extended with markups per source on Ploeg Run costs, at the owner's decision.
