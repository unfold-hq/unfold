---
status: proposed
date: 2026-11-17
decision-makers: Ryan Grippeling
review-by: 2027-02-28
---

# Linked Session cost is billing input, recorded as an estimate at API list prices

## Context and Problem Statement

An agency that runs Unfold bills its clients for the AI work done on each Work Item. Much of that work does not run in Ploeg: people run Claude Code on their own machines and link the session to the Work Item ([ADR 0047](0047-people-link-their-own-agent-sessions-through-a-plugin-agent-trace-and-telemetry-never-a-claude-sign-in.md)). On 2026-11-17 the owner decided that the agency invoices this cost: Claude Code's estimate at API prices, per Work Item, plus a margin it sets.

Until now Unfold read that estimate live from the metrics store, by session id, every time a page asked (`src/linked-telemetry.ts`). The store keeps samples for a limited time (30 days was observed), so the figure behind last month's invoice could be gone by the time it is checked or billed again. Nothing in Unfold kept it. [ADR 0068](0068-a-person-sees-their-own-usage-and-nobody-elses.md) had chosen "no new store" for Your usage.

How does Unfold keep Linked Session cost so that it can be billed per Work Item, honestly labelled, and still there after the metrics store forgets it?

## Decision Drivers

* The amount on an invoice must be traceable to a recorded fact with a source and a time, and must not change later.
* An estimate is never shown as zero when it is unknown, and Unfold never invents an amount ([system ADR-0036](../../../../docs/adr/adr-0036-ploeg-and-unfold-use-one-vocabulary-with-named-screen-words.md) cost status).
* The agency's margin is its own commercial choice; it must not alter the recorded estimate, and changing it must not rewrite what was already billed.
* No cost is counted twice when one session worked on several Work Items.
* A per-person view of staff stays out of reach ([system ADR-0023](../../../../docs/adr/adr-0023-unfold-measures-happiness-and-confusion-with-first-party-events-surveys-and-bug-reports.md), ADR 0068).
* Standard formats out ([system ADR-0050](../../../../docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md)): extend the FOCUS export rather than add a second one.

## Considered Options

* **Record cumulative readings per session in the workbench database, bill per Work Item and day, and keep the markup as dated rows applied only to a billable column**
* Keep reading live and ask operators to raise the metrics store's retention
* Store one figure per session, overwritten on every read
* Bake the markup into the recorded figure

## Decision Outcome

Chosen option: "**Record cumulative readings, bill per Work Item and day, dated markups on a billable column**", because it keeps the figure after the store forgets it, makes every billed amount traceable to a reading, and keeps the margin apart from the fact.

1. **What is recorded.** `linked_session_usage` holds readings of a Claude Code session's cumulative estimate and tokens: `session_id`, `observed_at`, `cost_micros` (whole micro-dollars), the four token counts and `source` `telemetry-estimate`. The amount is Claude Code's own `claude_code.cost.usage` estimate at API list prices, which a Claude plan is not billed.
2. **When.** After every live telemetry read of a session's own page or a Work Item page, and through the durable job `linked.usage` three minutes after the session reports `idle` or `end` (Claude Code exports metrics once a minute). Repeated notices coalesce into one job.
3. **Never lower, never invented.** A reading with neither cost nor tokens records nothing, so an empty answer is not a $0 fact. A reading lower than the last one, as a store that dropped old samples answers, keeps the higher figure. An unchanged reading adds no row.
4. **Per day.** A day's charge is what that day's readings added to the cumulative figure, so a month boundary splits a long session by when its cost was read. Cost before a session's first reading lands on that first day.
5. **Per Work Item.** A session's daily charge is split evenly over the Work Items it is linked to when the charge is computed, in whole micro-dollars with the remainder on the first ones, so the parts add up to the session's charge exactly.
6. **Markup.** `usage_markups` holds a markup in basis points per Tenant, and optionally per Client, from a first day on. A Client's own markup wins over its Tenant's; none means 0. The billable amount is the estimate times (1 + markup), rounded half up to a micro-dollar. The first markup of an owner may start on any date; after that a markup starts today or later, and only one not yet in effect may be replaced, so a day already billed keeps its amount. Administrators set it through `PUT /api/billing/usage-markups`.
7. **Where it shows.** Each session carries `recordedUsage` on its page and on the Work Item. `GET /api/linked-sessions?workItemId=&telemetry=1` adds `usage`: the recorded estimate, the billable amount and today's markup for the Work Item, over every session for an administrator and only the caller's own for anyone else. Your usage shows the recorded sum when the live sum is gone or lower, and says so.
8. **Export.** `GET /api/ploeg/cost-export?linkedSessions=include` adds one FOCUS row per Work Item and day: `ListCost` the estimate, `BilledCost` and the other paid costs 0 (nobody invoiced it, and FOCUS keeps estimates out of `BilledCost`), `x_UnfoldCostSource` `telemetry-estimate`, `x_UnfoldEstimatedCost`, `x_UnfoldMarkupPercent` and `x_UnfoldBillableCost`. A row names the Work Item and its owner, never the session or the person.
9. **Tenant export.** Both tables are in the Tenant export: readings under their Linked Session, markups under their Tenant.

### Consequences

* Good, because the figure behind an invoice survives the metrics store's retention, and every billed amount traces to a reading with its time and source.
* Good, because the markup never touches the recorded estimate, a markup of 0 bills the estimate exactly, and changing a markup cannot change a day already billed.
* Good, because a session worked on two Work Items is billed once, split between them.
* Bad, because a session nobody opened and that never reported `idle` or `end` (a crash, a machine that slept) is recorded only if someone opens it within the store's retention. Accepted: the hooks send `idle` after every turn.
* Bad, because the attribution follows the links at the time of export. Unlinking a Work Item moves its share of past days to the session's other Work Items, or out of the export. Accepted for now; re-evaluate if invoices are disputed.
* Bad, because a Work Item page's total combines several people's sessions for an administrator. It is a figure per Work Item, not per person, and the export names no person, but on a Work Item one person worked alone it equals that person's use. The owner decides whether this is acceptable under ADR-0023 before rollout.
* Bad, because the amount is an estimate at API list prices, not what the agency paid: on a Claude plan the agency pays a seat, not these prices. The estimate is labelled as such everywhere, and the decision to invoice it is the agency's.

### Confirmation

* `npm test` in `apps/unfold`: `test/linked-usage.test.ts` (a reading with neither cost nor tokens is not kept, a lower later reading keeps the higher figure, the estimate survives the metrics store losing the session on the session and the Work Item, `idle` and `end` queue one read that records it, another person sees only their own share, a split adds up exactly, markup 0 equals the estimate, a markup change never rewrites an earlier day and a backdated one is refused, the FOCUS rows only with `linkedSessions=include` and without a session or person, Your usage falls back to the recorded sum, only administrators set a markup); `test/focus-export.test.ts` for the column types; `test/linked-handoff-view.test.mjs`, `test/linked-sessions-view.test.mjs` and `test/usage-view.test.mjs` for the pages.
* The key tests were mutation-checked when written: removing each guard (higher figure kept, empty reading skipped, recording on the Work Item read, backdating refused, the split, markup 0, unreadable Work Items left out) makes a test fail.
* All of it runs through `mise run verify`.

## Pros and Cons of the Options

### Keep reading live and raise retention

* Good, because it adds nothing to Unfold.
* Bad, because retention belongs to whoever runs the metrics store, often not the agency, and a longer retention still ends; the invoice's figure stays one query away from gone.

### One figure per session, overwritten

* Good, because it is one row per session.
* Bad, because it cannot say which month a long session's cost belongs to, and an overwrite leaves no trace of what a past export read.

### Bake the markup into the recorded figure

* Good, because the billable amount needs no computation.
* Bad, because the recorded fact would no longer be the estimate, a markup change could not be told apart from a cost change, and the owner ruled it out.

## More Information

* Contract: [HTTP contract, Linked Sessions and Billing](../contracts/api.md); [FOCUS cost export](../operations/focus-cost-export.md#linked-session-estimates); how-to: [Link your Claude Code sessions](../../../../docs/how-to/link-claude-code-sessions.md#what-a-session-costs-and-how-it-is-billed).
* Amends ADR 0068's "no new store" driver for the Linked Session estimate, and its consequence that no record keeps spend by day.
* Re-evaluate when Claude Code or the agency's plan reports billed cost per session, when invoices are disputed over attribution, or when Ploeg reports linked work itself.
* 2026-11-17: proposed with its implementation.
