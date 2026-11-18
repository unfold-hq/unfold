---
type: explanation
audience: [owner, operator, contributor, agent]
owner: unfold
last_verified: 2026-11-18
verified_by: "Read on origin/development a39e8794: system ADRs 0005, 0006, 0007, 0009, 0017, 0031, 0048 and 0049; Unfold ADRs 0060, 0068, 0069 and 0071; apps/unfold/src billing.ts, billing-export.ts, billing-simplicate.ts, focus-export.ts, linked-usage.ts, delivery-economics.ts, tenant-scope.ts and audit/capture.ts; the FOCUS cost export guide and the Linked Session how-to. Nothing was run. Every slice, question and measure below is a proposal; only the section 'What is built' describes the implementation."
---

# Billing AI work to Clients (mostly proposed)

An Agency that uses Unfold should be able to turn the AI work done for a Client into invoice lines the Client accepts without a phone call. This page is the product plan for that: which prices an Agency can offer, how money moves for one Work Item, what makes a line trustworthy, the edge cases, the controls, and the smallest slices that close the gaps.

**Most of this page is a proposal.** The section [What is built](#what-is-built) describes the implementation; everything else is labelled **Proposed** or is an open question for the owner. The [glossary](../reference/glossary.md) defines each **bold** term. Unfold's own charge to an Agency (Credits, Token Charge, Markup) is decided in [ADR-0006](../adr/adr-0006-the-ticket-is-the-billing-unit.md) and is not repeated here; this page is about what the Agency charges its Client.

## The answer in short

* **Recommended first offer:** a capped cost-plus line per accepted Work Item. The Client pays the AI cost recorded on a Work Item it accepted, plus the Agency's margin, shown on the line, up to a cap agreed per Client. Work that is never accepted is not billed; cost above the cap is the Agency's. Metered cost and estimated cost stay on separate lines.
* **What already works:** an Agency that keeps its own ledger can invoice this today by reading the [FOCUS cost export](../../apps/unfold/docs/operations/focus-cost-export.md) per Work Item, day and source, with its margin in a separate column, and pairing it with the acceptance date from the delivery ledger.
* **What is missing first:** a report of the cost that reaches no Work Item, a month-close check, Client ownership taken from the Work Item's origin instead of its repository, and a Client-facing cost summary per accepted Work Item.

## What is built

As read on `development` on 2026-11-18:

| Part | What it does | Source |
| --- | --- | --- |
| Two cost sources | `ploeg-run`: a Ploeg Run's spend as the model gateway metered it ($0 on a local model). `linked-session`: Claude Code's own estimate at API list prices for a Linked Session, which an Agency on fixed seats is not billed | [ADR 0069](../../apps/unfold/docs/adrs/0069-linked-session-cost-is-billing-input-recorded-as-an-estimate-at-api-list-prices.md), [`linked-usage.ts`](../../apps/unfold/src/linked-usage.ts) |
| Recorded estimates | Cumulative readings per session, never lowered, never invented; charged per UTC day; a session linked to several Work Items is split evenly | ADR 0069 |
| Margin per source | `usage_markups`: a percentage per Tenant or Client for `ploeg-run`, `linked-session` or `all`, dated, never backdated after the first; applied only to a billable column | ADR 0069 |
| FOCUS export | One row per Work Item, day and source; metered rows bill only once settled; estimate rows keep `BilledCost` at 0 and carry `x_UnfoldEstimatedCost` and `x_UnfoldBillableCost`. Headers count unsettled, unreported and unowned work. US$, or euro at a rate the caller passes | [ADR 0060](../../apps/unfold/docs/adrs/0060-the-focus-cost-export-writes-parquet-through-hyparquet-writer.md), [`focus-export.ts`](../../apps/unfold/src/focus-export.ts) |
| Machine reader | A billing job in the cluster reads the export with its own service account token, for one Tenant and its Teams | [ADR 0071](../../apps/unfold/docs/adrs/0071-a-billing-system-reads-the-cost-export-with-its-own-service-account-token.md) |
| Billing outbox | One line per accepted Work Item (merged, approved or silent) at the Agency's fixed price per Client, sent once to a PSA exporter or written as CSV and UBL; Reversal credit lines within 14 days | [`billing.ts`](../../apps/unfold/src/billing.ts), [`billing-export.ts`](../../apps/unfold/src/billing-export.ts) |
| Your usage | Each person sees their own Asks, sessions and Linked Session estimates, and nobody else's | [ADR 0068](../../apps/unfold/docs/adrs/0068-a-person-sees-their-own-usage-and-nobody-elses.md) |
| Team spend cap | Ploeg caps each Team's spend per UTC period; onboarding asks an Admin to confirm it | [Task connections](../../apps/unfold/docs/operations/task-connections.md) |

Four facts from the source shape the plan:

1. **The outbox carries no cost.** Its line is a fixed price per accepted Work Item. Per-Size prices can be mapped, but no line has a Size yet, so a Client without a per-ticket price gets lines that wait for a price by hand.
2. **A Client is found through the repository.** The export and the outbox take a Work Item's owner from its target repository. A repository that two Clients share gives no owner, and its Work Items are counted in `X-Unfold-Unowned-Work-Items` and left out of every row. [ADR-0048](../adr/adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md) says a Work Item takes its Client from its origin.
3. **Cost that reaches no Work Item disappears.** A Linked Session linked to no Work Item adds no row and no count anywhere except the person's own Your usage.
4. **Attribution moves after the fact.** The split of a session's cost follows its links at export time, so unlinking a Work Item later moves cost out of a month that was already invoiced (ADR 0069, consequences).

## Words on this page

* **Margin** (proposed term): the percentage an Agency adds to a cost when it bills its Client. The glossary's **Markup** is Unfold's own percentage to an Agency, and says the Agency's price "is not a Markup". The code and ADR 0069 call the Agency's percentage a markup (`usage_markups`). This page says margin and lists the conflict as [question 6](#open-questions-for-the-owner).
* **Contested line** (proposed term): a Client's objection to a line on the Agency's invoice. It is not a **Dispute**, which is between Unfold and an Agency.
* **Bill-to**: the Unfold Client that owns the Work Item. The owner decided this; an **Approver** that is a main contractor does not change who is billed.

## 1. Pricing models an Agency can offer

| Model | The Client sees | Who carries the risk | Unfold today | What it needs |
| --- | --- | --- | --- | --- |
| **Pass-through plus margin**: recorded AI cost plus a visible margin, per period | Cost per Work Item and source, the margin, a total | Client: cost is unpredictable and includes failed attempts | Works through the export and the Agency's own ledger. The outbox cannot write cost lines | A cost line in the outbox (slice B5); a Client Budget (B6) so the Client is not surprised |
| **Fixed price per Work Item with a cap** ([ADR-0006](../adr/adr-0006-the-ticket-is-the-billing-unit.md)): a Quote by Size, charged on Acceptance | One price per accepted Work Item | Agency: a wrong Size costs it margin. Bounded by the Shift Budget | The outbox writes a fixed price per accepted Work Item per Client | Size, Quote and Client approval ([ADR-0007](../adr/adr-0007-clients-approve-ready-work.md)); a Shift Budget per Size in Ploeg; nothing caps a Linked Session |
| **Retainer with included AI budget**: a monthly fee that includes an AI amount; above it, overage or a stop | The fee, the included amount used, any overage | Shared: the Agency up to the included amount, the Client above it | Nothing beyond the export; the ledger computes it | A Client Budget per month with alerts (B6); a monthly usage statement per Client |
| **Outcome-based per accepted pull request**, uncapped | One price per accepted change | Agency: cost per attempt is unbounded | The outbox does exactly this | Nothing to start; cost per accepted Work Item on Insights to price it sanely |

**Recommendation (proposed): start with capped cost-plus per accepted Work Item.** It follows the owner's decisions (the Client pays the recorded cost, the margin is visible on the line) and keeps the two promises that make [ADR-0006](../adr/adr-0006-the-ticket-is-the-billing-unit.md) sellable: the Client never pays more than an agreed number, and pays only for work it received.

* The line is the sum of all recorded AI cost on one accepted Work Item, every attempt and fix Round included, metered and estimated on separate sub-lines, each with its margin.
* A cap per Work Item, set per Client in the contract, bounds the line. Cost above it is the Agency's and is shown on the line as "above cap, not charged".
* A Work Item that is never accepted is not billed. Its cost is the Agency's, and shows up in the measures below, so the Agency sees what rejected work costs it.
* Fixed price per Size follows once Refinement, Quotes and the Client Portal exist; the cost-plus line then becomes evidence behind the fixed price instead of the price.

Trade-off: cost-plus exposes the Agency's real cost, and a Client may compare it with its own seat price. An estimate at API list prices for work done on a flat-rate seat is not what the Agency paid. That is defensible only when the contract says so in plain words and every line labels the estimate (section 3).

## 2. The money flow for one Work Item

1. **Quote.** The Agency agrees the price model with the Client in the contract. For capped cost-plus, the contract holds the margin per source, the fixed exchange rate, the cap per Work Item and the monthly Client Budget. Per Work Item, the Client sees an estimate range before work starts: the median and p90 recorded cost of accepted Work Items of the same kind for that Client, or the Agency's default when there are fewer than 20. **Proposed**; nothing computes it yet.
2. **Budget.** Ploeg holds the spend of every Run within the Team's spend cap today, and within a Shift Budget per Size once Sizes exist. A Linked Session has no budget: Unfold never starts or steers it ([glossary: Linked Session](../reference/glossary.md)). For sessions the cap works on the invoice, not on the work.
3. **Work.** Ploeg Runs are metered by the model gateway. People's own sessions report through the plugin and are linked to the Work Item by its tracker id or branch. Both are recorded per day.
4. **Cost recorded.** A Run's cost becomes billable when it settles; a session's estimate is recorded on every read and after it stops.
5. **Client Sign-off and Acceptance.** The Client's Sign-off is input ([ADR-0049](../adr/adr-0049-a-client-sign-off-is-input-to-acceptance-bound-to-the-head-commit-and-each-client-has-an-approver.md)); the Agency's Acceptance (approval, merge or ten working days of silence) makes the Work Item a **Delivery** and is the billing moment.
6. **Invoice line.** **Proposed:** at Acceptance, Unfold freezes the attribution and writes one line per accepted Work Item: cost per source, margin per source, cap, total, exchange rate, and evidence links. Cost that arrives later becomes a correction line (section 4).
7. **Payment.** The Agency's own ledger or PSA invoices and collects. Unfold never sends an invoice or takes payment for an Agency ([ADR-0050](../adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md)).

Who sees what, and when (**proposed**, except where marked built):

| | Before work | During work | At Acceptance | After invoicing |
| --- | --- | --- | --- | --- |
| **Client** (Client Access Role) | The price model, the estimate range, the cap | Status only; no running cost, so it does not steer by spend | The cost summary of the Work Item, if the Agency shows it | The invoice line and its summary; can contest a line |
| **Product owner or Lead** | The estimate and the Client Budget left | Running cost per source against the cap, alerts at 50, 75, 90 and 100% | The line before it is sent, with any "above cap" amount | Contested lines on their Work Items |
| **Developer** | The cap of the Work Item | Their own session cost (built: Your usage) and the Work Item's metered cost | Nothing new | Nothing; never another person's use |
| **Finance or Account owner** | Contract terms per Client | Client Budget burn, unattributed cost | Lines waiting for approval above a threshold | Month close, corrections, contested lines, measures |

## 3. Trust and contested lines

**Disclosure.** Every line that contains an estimate says so in words the Client can read: "Estimated at the model provider's list prices from session telemetry; not a metered charge." Metered and estimated amounts are never added into one number on a line or a summary; a total is shown only as their sum with both parts visible. A $0 metered cost on a local model is shown as "€0,00 (local model)", never left out, so the Client sees the work happened.

**Evidence per line (proposed).** Each line links to a cost summary of the Work Item that names, without naming any person:

* the Work Item, its tracker reference and the pull request that was accepted, with how it was accepted;
* cost per source and per day, the margin of each, the exchange rate and the cap;
* the number of Runs and sessions, and the Agent Trace summary of what the sessions wrote into that pull request;
* what is excluded: unsettled Runs, cost above the cap, cost recorded after the line was frozen.

**Contesting a line (proposed).** The Client contests a line within the window its contract sets (recommended: 14 days after the invoice, matching the Reversal window). The Agency answers with the summary. Three outcomes: upheld (nothing changes), credited in part, or credited in full. A credit is a negative line keyed to the original, written by a person, never automatically. Unfold records the outcome so the contested-line rate can be measured.

**Refunds and credits.** A Reversal (a revert within 14 days for a defect inside the Acceptance Conditions) already credits the outbox's fixed-price line (built). **Proposed:** it also credits the cost-plus line by default, because a Client will not accept paying for a change that was reverted as defective.

**Cap reached.** For Runs, Ploeg stops the Shift and offers a split; it never tops up silently (ADR-0006). For sessions nothing stops, so the line shows the capped amount and the excess as "not charged". A Lead who wants the Client to pay more opens a new Work Item with its own approval, never a raised cap after the fact.

**Failed work.** A Work Item that is closed without Acceptance is not billed under the recommended offer. Attempts that failed before a later attempt was accepted are part of the accepted Work Item's cost. Attempts that fail through Unfold's or Ploeg's own fault are never billed, as ADR-0006 decides for Unfold's own charge; **proposed:** the line leaves out Runs Ploeg marks as infrastructure failures.

**Rework.** A fix Round inside the Shift is part of the Work Item. Rework the Client asks for after Acceptance is a new Work Item (a Follow-Up), billed on its own. A defect found after Acceptance is a Reversal within 14 days, or the Agency's warranty after that.

**Internal and billable work.** Own work (the Client Project without a Client) is never billed and never appears on a Client's export. **Proposed:** a Work Item can be marked non-billable by a Lead before Acceptance, with a reason, so an Agency can do goodwill work for a Client without hand-editing its ledger.

**Repositories shared by several Clients.** Today their Work Items are dropped from the export as unowned. **Proposed (slice B2):** the Client comes from the Work Item's origin, its tracker source, as ADR-0048 decides; the repository is only where the work happened.

## 4. Edge cases

| Case | Today | Proposed | Who absorbs it |
| --- | --- | --- | --- |
| A session linked to no Work Item | Its estimate is recorded but reaches no export row, count or report | An unattributed-cost report per Tenant and month (B1); the person sees their own unlinked sessions with a "link it" action | The Agency, as overhead. Never spread over Clients |
| One session on several Work Items | Split evenly per day | Keep the even split; show "1 of 2 Work Items" on the summary. Revisit when lines are contested over it | The Clients, by the split |
| A Work Item with no Client | Billed to the Tenant (`SubAccountType` Tenant) in the export; outbox needs a Tenant mapping | Never billable; shown as Own work | The Agency |
| Currency | Costs in US$; the export converts at a rate the caller passes; the outbox has one currency for all lines | A fixed exchange rate per Client contract, stored with its start date like a margin, and printed on every line | The Agency carries the difference between the contract rate and the day rate |
| Month boundaries and time zones | Days are UTC; a long session is split by when its cost was read | Keep UTC and say "days in UTC" on the statement. Under the recommended offer the line follows Acceptance, so a boundary only decides which invoice, not the amount | Nobody |
| Late settlement | Unsettled Runs are never billable; an export is an overwrite snapshot | Cost recorded after a line was frozen becomes a correction. A positive correction is written automatically on the next invoice (owner decision); a negative one waits for a person | The Client for positive corrections inside the cap |
| A tracker task deleted or merged | Links stay on the Work Item id; unlinking moves past cost | Freeze attribution at the line (B4). A merged duplicate's links move to the surviving Work Item before Acceptance only | The surviving Work Item |
| A person leaves | Recorded readings stay per session; the export names no person | No change: billing never depends on the person. Unlinked sessions of a leaver stay unattributed | The Agency for unlinked cost |
| Metrics store forgets a session | The recorded figure survives (ADR 0069) | A month-close check warns about sessions active in the month that were never read | The Agency, when nothing was recorded |
| Export truncated | `X-Unfold-Truncated` says so | The month-close check refuses to call a month ready | Nobody, if the check is respected |

## 5. Controls

* **Client Budget per month (proposed, B6).** Set per Client in the contract, covering both sources. Alerts at 50, 75, 90 and 100%, the values ADR-0006 sets for the Agency Budget. Ploeg can enforce it for Runs once it knows Client Budgets; that is a Ploeg change, made upstream. Sessions can only be alerted on.
* **Alerts before overspend.** To the Lead and the Account owner, per Client and per Work Item at 75% of its cap. Never to the Client automatically: Unfold never contacts a Client ([ADR-0007](../adr/adr-0007-clients-approve-ready-work.md)).
* **Approval thresholds (proposed, B8).** A line above an amount the Account owner sets, or with an "above cap" part, waits in a `needs_approval` state before it is sent, like `needs_price` today.
* **Margin governance.** Built: margins are dated, a new one starts today or later, and a changed margin never rewrites a billed day. **Proposed:** only the Account owner sets margins and exchange rates; a Tenant may set a floor and ceiling; every change is audited. Today the Billing mapping and every line action are captured as audit records, but a margin change is not ([`audit/capture.ts`](../../apps/unfold/src/audit/capture.ts)).
* **Audit trail.** Each line keeps its source rows, margin, rate, cap and the frozen links, so the amount can be recomputed from recorded facts years later. The audit records who approved, sent, credited or contested it.
* **Privacy.** No view built for billing ranks or compares people. On a Work Item one person worked alone, its cost equals their use; the Client summary therefore never names who worked, and staff-level views stay under [ADR 0068](../../apps/unfold/docs/adrs/0068-a-person-sees-their-own-usage-and-nobody-elses.md).

## 6. Slices, smallest first

Each slice ships alone, behind the existing `billing.export` flag or a new one, and leaves the demo without spend.

**B1. Month-close check and unattributed cost.** One Billing panel for a month and Tenant: unsettled and unreported Runs, unowned Work Items, truncation, sessions active but never read, and the total and count of Linked Session cost linked to no Work Item. Read-only.

* Given a month with an unsettled Run, the panel says "not ready to close" and names the Work Item.
* The unattributed total equals the recorded estimates of sessions with no link in that month, and the panel names no person and no session to an administrator.
* A person sees their own unlinked sessions of the month in Your usage with a link action.

**B2. Client from the Work Item's origin.** The export and the outbox take the owner from the Work Item's source, falling back to the repository only when the source has none.

* A Work Item from Client A's source in a repository granted to A and B appears in A's export and not in B's, and `X-Unfold-Unowned-Work-Items` no longer counts it.
* A Work Item whose source and repository have no Client stays Own work.

**B3. Client-facing cost summary per accepted Work Item.** A page and a JSON and PDF download per accepted Work Item, for the Agency to attach to a line, showing the evidence listed in section 3.

* Metered and estimated amounts appear apart, each labelled, with the margin of each; no figure adds them without showing both.
* The summary names no person and no session id.
* A Client user reaches only its own Client's summaries; the Agency can switch summaries off per Client.

**B4. Frozen attribution.** At Acceptance Unfold stores, per Work Item, the links, the daily rows and the margins it billed. A later relink changes no frozen line; it produces a correction instead.

* Unlinking a Work Item after its line was frozen leaves that line's amount unchanged in the outbox and in a re-export of the frozen period, and creates a correction for the other Work Item.

**B5. Cost-plus line in the outbox.** A line kind `usage` per accepted Work Item, with sub-lines per source, margin per source, the Client's contract exchange rate and cap, sent through the existing exporters and the UBL file.

* A Work Item with $3 metered, $5 estimated, 20% margin on both, a rate of 0,92 and a cap of €6 gives sub-lines of €3,31 and €5,52, a charged total of €6,00 and €2,83 "above cap, not charged".
* A Work Item with only local-model Runs gives a €0,00 metered sub-line marked "local model".

**B6. Client Budget with alerts.** A monthly budget per Client over both sources, alerts at 50, 75, 90 and 100% to the Lead and the Account owner.

* Crossing 75% sends one alert per Client and month; no message reaches a Client user.
* Enforcement for Runs is a separate Ploeg change.

**B7. Late corrections.** Cost recorded on a Work Item after its line was sent produces a correction: positive ones are written automatically, inside the cap and within a window; negative ones wait for a person.

* A Run that settles three days after the line was sent produces one positive correction line on the next sync, keyed to the original, and only once.
* A lower figure never produces a line by itself.

**B8. Approvals, contested lines and audit.** `needs_approval` above a threshold; recording a contested line and its outcome; margin and rate changes in the audit chain.

* A line above the threshold is not sent until an Account owner approves it, and the audit names them.
* A margin change appears as an audit record with old and new values.

Later and larger: Size on every line, Quotes and Client approval in the Client Portal, Ask cost as a third source, and Ploeg-enforced Client Budgets.

## 7. Success measures

| Measure | Definition | Pair it with | Proposed target |
| --- | --- | --- | --- |
| Attributed share | Recorded AI cost linked to a Work Item with a Client, divided by all recorded AI cost, per source and month | Contested-line rate, so nobody links cost to Clients to raise the share | 90% for metered, 80% for estimates after three months |
| Contested-line rate | Lines contested divided by lines sent, per quarter | Attributed share | Below 2% |
| Time to invoice line | Median from Acceptance to a sent line | Correction rate | Under 1 working day |
| Correction rate | Correction lines divided by lines sent | Time to invoice line, so lines are not held back to avoid corrections | Below 10% |
| Absorbed cost | Cost above caps plus cost on Work Items never accepted plus unattributed cost, divided by all recorded cost | Delivery rate | Known every month; target set after the first quarter |
| Close effort | Working days from month end until the month-close check reads ready | — | 3 working days |

Each needs a baseline before its target means anything; none is instrumented yet.

## Open questions for the owner

1. **First offer.** Is capped cost-plus per accepted Work Item the first offer? *Recommended: yes.* It follows the decisions already taken and keeps a ceiling for the Client. Against: it shows the Agency's cost, which fixed price per Size would hide.
2. **Unaccepted work.** Does a Client ever pay for a Work Item that was not accepted? *Recommended: no, the Agency absorbs it.* Against: an Agency with a low delivery rate loses money, which is the signal it should get.
3. **When a line is written.** On Acceptance, or monthly by the days the cost was recorded? *Recommended: on Acceptance for per-Work-Item offers, monthly for retainers.* Against: cost of a long Work Item waits until it is accepted.
4. **One cap over both sources.** Does a session estimate count against the same cap as metered Runs? *Recommended: yes, one cap, each source shown apart.* Against: an estimate can then crowd out metered cost the Agency really paid.
5. **Unattributed cost.** Is cost linked to no Work Item always the Agency's? *Recommended: yes, never spread over Clients.* Against: Agencies under-link and absorb more until B1 makes it visible.
6. **The word for the Agency's percentage.** The glossary reserves Markup for Unfold's charge; ADR 0069 and the code use markup for the Agency's. *Recommended: add Margin to the product model for the Agency's percentage and keep the code identifiers until the next contract version.* Against: two words for one column until then.
7. **A Client's objection to a line.** *Recommended: add Contested Line to the product model, separate from Dispute.* Against: one more term.
8. **Freeze attribution at Acceptance.** This amends ADR 0069's accepted consequence that attribution follows the links at export time. *Recommended: freeze.* Against: a wrongly linked session stays wrong on the frozen line and needs a correction.
9. **Who governs billing.** Today any administrator sets margins and sends lines. *Recommended: only the Account owner sets margins, exchange rates and thresholds, as the Access Roles say.* Against: it needs the Access Roles built first.
10. **Estimate disclosure.** *Recommended: the estimate label is fixed text on every line and summary, and an Agency cannot switch it off.* Against: some Agencies will want to present it as a plain cost.
11. **Late corrections window.** How long after a line may a positive correction still be written automatically? *Recommended: 30 days, after that the Agency absorbs it.* Against: a Run that settles very late is lost revenue.
12. **What a Client may see.** *Recommended: the summary of section 3 and the pull request link, never raw logs or per-person data; the Agency switches the summary on per Client.* Against: a technical Client may ask for the Agent Trace itself.

## Related

* [Who Unfold is for](who-unfold-is-for.md) and [Users and their journeys](users-and-journeys.md), journeys 7 and 10.
* [FOCUS cost export](../../apps/unfold/docs/operations/focus-cost-export.md) and [Link your Claude Code sessions](../how-to/link-claude-code-sessions.md#what-a-session-costs-and-how-it-is-billed).
* The OpenSpec changes [billing-export](../../openspec/changes/billing-export/proposal.md) and [delivery-ledger](../../openspec/changes/delivery-ledger/proposal.md).
