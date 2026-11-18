# User journeys — from connecting an organisation to picking up work

Everything on this page is **proposed**. Nothing here is built unless a line
says it exists today, with its source. It extends [design.md](design.md): the
onboarding stages there (section 1) are the Admin's half of the story, and
this page adds what people do once the organisation is connected. The
decisions it rests on are D12 to D18 in [design.md](design.md#decisions); the
questions still open are design.md Open Questions 5 to 10.

"Journey" here means one person's path from a trigger to an outcome, as on
[Users and their journeys](../../../docs/concepts/users-and-journeys.md). The
technical paths a Work Item takes through Ploeg are on
[Journeys](../../../docs/concepts/journeys.md).

**Evidence.** No user research was done. The roles and journeys come from the
owner's decisions (D1 to D18), the accepted records cited inline, and a read
of the code on `development` on 2026-11-18. Where a line says *hypothesis*,
nobody has checked it with users.

**The bar.** Every screen in these journeys is judged against the owner's
sentence for the primary user on
[Users and their journeys](../../../docs/concepts/users-and-journeys.md):
"I was able to move much more development work than I would have normally,
and frictionless." For this change the "eureka" is concrete: **a developer
signs in with the company login, sees exactly the ClickUp tasks they already
see in ClickUp, assigns one to Unfold, and gets a pull request back with its
link on the task, without linking any account or asking anyone.**

## 1. Who is in the story

The built-in Access Roles were decided on 2026-10-14
([Users and their journeys](../../../docs/concepts/users-and-journeys.md#the-cast));
this page uses them and adds no new role except the proposed Finance role
(Open Question 7). The code's roles today are `admin`, `operator` and
`viewer`; operator becomes Developer.

| Persona | Access Role | Where they mostly work | What this change gives them |
|---|---|---|---|
| Admin (platform engineer, often the agency owner in a small agency) | Admin, or Account owner | Unfold Settings → Connections, ClickUp admin, GitHub organisation settings | connects ClickUp and GitHub once, binds Lists, confirms Clients and repositories |
| Developer (the daily user; called *operator* in today's code) | Developer, member of the Team bound to a List | ClickUp, Unfold Now and Tasks, GitHub, their own Claude Code | sees their own ClickUp tasks in Unfold, hands them to Ploeg or works them in Claude Code, approves outsiders' hand-offs, reviews pull requests |
| Lead | Lead | Unfold Now, Insights | as Developer, plus Team policy and budgets within the cap |
| Outsider (a project manager, a colleague outside the Team, a ClickUp Guest) | none, or Developer of another Team, or Product owner | ClickUp | assigns "Unfold" in ClickUp; the hand-off waits for a Team member's approval |
| Viewer | Viewer | Unfold Now | reads the work they may see; changes nothing |
| Client approver | Client (the Approver of [ADR-0049](../../../docs/adr/adr-0049-a-client-sign-off-is-input-to-acceptance-bound-to-the-head-commit-and-each-client-has-an-approver.md)), recorded by Agency people on the Client's behalf until Client memberships exist | a preview, mail | gives a Client Sign-off on a pull request; never Acceptance |
| Finance | proposed Finance role, or Account owner (Open Question 7) | Unfold Billing, the FOCUS export | cost per Client and per Work Item at month end, never per person |

The **buyer** is the agency owner (Account owner); the **daily user** is the
Developer. The ClickUp member **Unfold** and the GitHub App are not people:
they are the organisation's Integration Accounts
([ADR-0048](../../../docs/adr/adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md)).

### Permission matrix

Every action below also needs the person's Tenant membership
([ADR-0017](../../../docs/adr/adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md));
outside it everything is absent. "Team member" means a person of the Team
bound to the task's List (Open Question 5 decides where that membership
lives). ✓ allowed, — not allowed, *own* only their own figures.

| Action | Account owner | Admin | Lead | Developer, Team member | Developer, other Team | Product owner | Viewer | Client | Finance (proposed) |
|---|---|---|---|---|---|---|---|---|---|
| Connect or disconnect ClickUp and GitHub (D11, D12) | ✓ | ✓ | — | — | — | — | — | — | — |
| Register a repository, bind a List, confirm a List's Client and default repository (D11, D16) | ✓ | ✓ | — | — | — | — | — | — | — |
| See a ClickUp task in Unfold (D13) | when they see it in ClickUp | same | same | same | same | same | same | same, and only their Client's | — (no task content) |
| Start work directly: assign "Unfold" or **Hand to** (D14) | ✓ if Team member | ✓ if Team member | ✓ for their Teams | ✓ | — waits for approval | — waits for approval | — | — | — |
| Approve or decline a waiting hand-off (D14) | ✓ | ✓ | ✓ for their Teams | ✓ | — | — | — | — | — |
| Work a task in their own Claude Code and link it | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| Set the per-task "Repository" field in ClickUp (D16) | anyone who may edit the task in ClickUp; it only picks among the List's allowed repositories | | | | | | | | |
| Review, request changes, accept (merge on the forge) | ✓ | ✓ | ✓ | ✓ | ✓ with forge rights | — | — | — | — |
| Record a Client Sign-off | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ own Client, once memberships exist | — |
| Spend: the Team's spend cap bounds every start; raising it | chart value in v1 | chart value in v1 | — | — | — | — | — | — | — |
| Set a billing markup ([ADR-0069](../../../apps/unfold/docs/adrs/0069-linked-session-cost-is-billing-input-recorded-as-an-estimate-at-api-list-prices.md)) | ✓ | ✓ (today's administrator) | — | — | — | — | — | — | — |
| See cost: own usage ([ADR-0068](../../../apps/unfold/docs/adrs/0068-a-person-sees-their-own-usage-and-nobody-elses.md)) | own | own | own | own | own | own | own | — | — |
| See cost per Work Item, per Client, the export | ✓ | ✓ | ✓ for their Teams' Work Items | own share of linked sessions | own share | — | — | what the Agency chooses (phase 2) | ✓ |
| Offboard a person | at the identity provider and in ClickUp; Unfold follows (journey h) | | | | | | | | |

Audit: every connect, bind, confirm, approve, decline, start and offboarding
effect writes an OCSF record in the Tenant's chain naming the person
([design.md section 6](design.md#6-security)); approvals and declines also
name the waiting assigner.

## 2. Job stories

Each is tagged with its source.

1. **Admin.** When my organisation decides to try Unfold, I want to connect
   ClickUp and GitHub once, for everyone, so nobody else has to set anything
   up before they can hand work over. (D12, D11; ADR-0059)
2. **Developer.** When I open Unfold, I want to see the ClickUp tasks I can
   see in ClickUp and nothing else, so it feels like my board and never like
   someone else's. (D13)
3. **Developer.** When a task is ready and I would rather review than write
   it, I want to assign it to Unfold where I already am, in ClickUp, and see
   the pull request link land on the task, so I never leave my tracker to
   know where it stands. (D14, D18; [ADR-0025](../../../apps/unfold/docs/adrs/0025-hand-tracker-tasks-to-ploeg-by-assignment.md))
4. **Developer.** When I would rather do a task myself with Claude Code, I want
   my session linked to the task by its branch and its cost recorded, so the
   work is visible and billable without paperwork. (D15; [ADR-0069](../../../apps/unfold/docs/adrs/0069-linked-session-cost-is-billing-input-recorded-as-an-estimate-at-api-list-prices.md), [Link your Claude Code sessions](../../../docs/how-to/link-claude-code-sessions.md#4-work-as-usual))
5. **Team member.** When someone outside my Team assigns Unfold to a task, I
   want to approve or decline it with one click, so our budget and review
   time go only where my Team agrees. (D14)
6. **Admin.** When a new List or Client appears in ClickUp, I want Unfold to
   suggest its Client and repository and let me confirm, so every task is
   billed to the right Client without me maintaining a mapping. (D16;
   ADR-0048)
7. **Finance.** At month end, I want cost per Client and per accepted Work
   Item, metered and estimated apart, so I can invoice without asking
   developers what they worked on. (ADR-0069, ADR-0006)
8. **Admin.** When someone leaves, I want their access to end where it
   already ends, at the company login and in ClickUp, so I never have to
   remember Unfold. (D12, D13)

Proxy ranking of the top tasks by frequency (*hypothesis*, from the journeys
of [Users and their journeys](../../../docs/concepts/users-and-journeys.md)):
see my tasks (several times a day) > hand a task over (daily) > review a pull
request (daily) > work a task myself (daily) > approve an outsider's hand-off
(weekly) > confirm a new List's mapping (monthly) > month-end cost (monthly)
> offboard (rare) > first-time setup (once, decisive).

## 3. Flows

Each flow lists numbered steps with the tool (**[ClickUp]**, **[Unfold]**,
**[GitHub]**, **[Claude Code]**, **[IdP]**), then its states. A step that
leaves Unfold is marked; leaving Unfold to *finish* would be a finding, and
none of these flows does.

### (a) Admin: first-time setup to first pull request, under 15 minutes

**Actors:** Admin (responsible); the installer (consulted when a stage 1 line
is red). **Starts when:** the Admin signs in for the first time.
**Done when:** the first agent pull request is open on the organisation's
repository. **How often:** once per organisation. **Measure:** time to first
agent pull request, p50 under 15 minutes (design.md section 9).

This is design.md section 1, stages 0 to 11; the steps below are its
touchpoints, not a second copy.

1. **[IdP → Unfold]** Signs in with the company login. A Tenant with no
   source and no repository lands on Settings → Connections, the checklist.
2. **[Unfold]** Stage 1, installation lines. All green, or a red line names
   the install value and **Show the install values** for the installer.
3. **[Unfold → GitHub → Unfold]** **Create the GitHub App** (manifest flow),
   **Install**, picks repositories on GitHub's own page, comes back.
4. **[Unfold]** Ticks repositories; each comes back **ready**, **not ready,
   prepare available**, or refused with Ploeg's reason.
5. **[ClickUp → Unfold]** Follows **Create the Unfold member** (four steps,
   one paid seat, D5, D17), pastes its token once.
6. **[Unfold]** Picks Lists by name. **New (D16):** each List shows its
   suggested Client, taken from its ClickUp Space or Folder name, and
   **Own work** when none fits; the Admin confirms or changes it (flow f).
7. **[Unfold]** Reads and confirms the Team's spend cap.
8. **[Unfold]** For a not-ready repository: **Prepare this repository** with
   the cap shown. The readiness pull request opens: **the first clock stops
   here** when it comes first.
9. **[GitHub]** A person merges the readiness pull request (no promise on
   time).
10. **[Unfold]** Binds each List: Team preselected, default repository (D16:
    pinned now, or learned from the first task), optional further allowed
    repositories, and **New (D18):** the List's ClickUp statuses matched to
    Unfold's (section 4), suggested by name.
11. **[ClickUp]** Assigns a task in a bound List to **Unfold**, or uses the
    checklist's **Try it on a task** link to Tasks. As an Admin who is a Team
    member, it starts directly (D14).
12. **[ClickUp]** The task moves to the matched "in progress" status. **[Unfold]**
    Now shows the Work Item moving.
13. **[GitHub, ClickUp]** The pull request opens; the task gets a comment with
    its link and moves to "in review" (D18). The second clock stops.
14. **[Unfold]** The checklist turns into a short **Invite your team** card:
    "People sign in with the company login and see the ClickUp tasks they
    already see. Nobody links an account." It shows the sign-in address to
    share and how many ClickUp members matched a sign-in so far.

| State | What the Admin sees |
|---|---|
| First time | design.md section 2, "First time" |
| Any failed check, revoked install, shadowed, too old, no cap | design.md section 2, unchanged |
| No ClickUp member matches the Admin's sign-in email | step 11 still works by assigning in ClickUp; Tasks shows the "not matched" state of flow b |
| No List has a confirmed Client | allowed: everything lands in Own work (D6); the measure "tasks with a confirmed Client" counts it as unconfirmed |
| Status match left empty | allowed: the task gets the comments but its ClickUp status is not moved (section 4) |
| The Admin is not a member of the bound Team | step 11 waits for approval (flow d); the checklist says so before the Admin assigns |

### (b) Developer picks up a ClickUp task interactively from Unfold

**Actors:** Developer (responsible). **Starts when:** they open Unfold to
choose their next task. **Done when:** they work the task in their own
Claude Code, linked to it, or decide to hand it over (flow c).
**How often:** daily. **Today:** Tasks lists every task of a saved source to
everyone who may open Tasks, read with the source's token
([views/tasks.js](../../../apps/unfold/public/views/tasks.js)); a session
links only to a task that already has a Ploeg Work Item
([Link your Claude Code sessions](../../../docs/how-to/link-claude-code-sessions.md#4-work-as-usual)).

1. **[IdP → Unfold]** Signs in with the company login; no account to link
   (D12).
2. **[Unfold]** Unfold matches the sign-in's verified email to a ClickUp
   member of the connected Workspace (D13). Now's **Up next** and Tasks show
   only tasks that member can see in ClickUp, with **Assigned to me** first.
3. **[Unfold]** Opens a task: the brief, its ClickUp status and assignees,
   its List's Client and the repository it would go to (D16), and two
   actions with equal weight: **Hand to Ploeg** (flow c) and **Work on it
   myself**.
4. **[Unfold]** **Work on it myself** (D15) shows a command to copy:
   it clones or switches to a branch named `CU-<task id>_<slug>`, as
   ClickUp's git integration names it, and starts `claude`. Unfold adds the
   person as an assignee in ClickUp (as the Unfold member, with a comment
   naming them), unless they already are.
5. **[Claude Code]** The plugin links the session to the task by its branch
   (flow e).
6. **[Unfold, ClickUp]** The task shows on Now under **Your sessions**; the
   developer moves their own ClickUp card, as the board rule for people
   says ([How work on Unfold is done](../../../docs/contributing/way-of-working.md#the-board)).
7. **[GitHub]** They open the pull request themselves; the session links to
   it and the task gets the pull request link comment (D18).

| State | What the Developer sees |
|---|---|
| Not matched: no ClickUp member has their verified email | "Your sign-in (`<email>`) is not a member of the ClickUp Workspace Unfold is connected to, so Unfold shows you no tasks. Ask your administrator to invite this address in ClickUp." No task is shown. |
| Matched, sees no task | "You see no open tasks in the connected Lists." with the Lists' names they can see and **Open ClickUp** |
| ClickUp unreachable or the Unfold member's token refused | the last list read, marked with its age, and "ClickUp did not answer; tasks may be out of date". Hand-off disabled with the reason |
| Task left the person's ClickUp access while open | the page answers like a missing task (404), as outside a Tenant |
| Task already handed to Ploeg | **Work on it myself** becomes **Take it over** (the existing take-over, Ploeg ADR-0142) |
| Repository not chosen yet for the List | **Work on it myself** still works; the command names no repository and asks which one, offering only allowed ones |
| Another session or Run works the task | the existing collision warning |

### (c) Developer hands a task to Ploeg and reviews the pull request

**Actors:** Developer (responsible, a Team member); reviewer (often the same
person); Lead (informed). **Starts when:** a Ready task they want agents to
do. **Done when:** accepted (merged), sent back, or taken over, with their
name on it. **How often:** daily. **Today:** works by assigning the Team's
ClickUp user or **Hand to** on Now
([Working with Unfold from ClickUp](../../../apps/unfold/docs/operations/working-from-clickup.md));
progress is not written back to ClickUp beyond the hand-off comment.

1. **[ClickUp]** Assigns **Unfold** to the task (one member for the whole
   organisation, D17). Or **[Unfold]** **Hand to Ploeg**, which does the same
   and shows the terms first: Team (from the List's binding), repository,
   what is left of the Team's spend cap, and how to take it back.
2. **[Ploeg]** The assignment arrives through the List's binding. The
   assigner is a Team member, so it starts directly (D14).
3. **[ClickUp]** Status → matched "in progress", with a comment "Unfold
   started this" and a link to the Work Item (D18).
4. **[Unfold]** Now shows it under In flight; the Work Item page shows the
   live track.
5. **[GitHub, ClickUp]** The pull request opens; status → "in review", a
   comment with the pull request link.
6. **[Unfold, GitHub]** Review: the walkthrough on the Work Item page, then
   approve and merge, or request changes on GitHub. Changes requested starts
   a fix Round on the same branch; the ClickUp status goes back to "in
   progress".
7. **[GitHub, ClickUp]** Merged: status → "done" (matched), and the comment
   says who accepted it.

| State | ClickUp shows | Unfold shows |
|---|---|---|
| Agents stop with a question | matched "needs you" status (or unchanged when not matched) and the question as a comment | Needs you with **Answer** |
| Spent budget | the same, with the reason | Needs you, **Try again** or split |
| Unassigned before a worker starts | back to its earlier status; comment "taken back by `<person>`" | Take back done; nothing spent |
| Repository field names a repository the List does not allow | comment "This repository is not allowed for this List; ask an administrator" | Needs you, `repository_not_allowed` |
| Closed without merging | "needs you" with the one-click reason | Needs you |
| Team's spend cap reached | comment "Waiting: the Team's budget for today is spent" | Queued with the cap line |

### (d) An outsider assigns "Unfold": the approval flow

**Actors:** the outsider (starts it); any Team member, Lead or Admin
(decides, D14); the Team (informed). **Starts when:** someone who is not a
member of the Team bound to the List assigns **Unfold** in ClickUp, or
presses **Hand to Ploeg** in Unfold. **Done when:** approved and moving, or
declined and unassigned with a reason on the task. **How often:** weekly
(*hypothesis*). **Today:** missing; any assignment starts work.

1. **[ClickUp]** The outsider assigns **Unfold**.
2. **[Ploeg]** The assignment arrives; its assigner is not on the binding's
   list of accounts that start work (upstream ask 7). Ploeg admits the Work
   Item as `needs_human` with reason `assignment_needs_approval`, spending
   nothing.
3. **[ClickUp]** A comment: "Waiting for approval by `<Team>`: assigned by
   someone outside the Team. Nothing has started." The status is not moved.
4. **[Unfold]** Every Team member sees it on Now under **Needs you** with
   the task, the assigner (by ClickUp name), the repository, the terms, and
   two equal buttons: **Approve and start** and **Decline**. A notification
   goes to the Team's channel (ADR-0026).
5. **[Unfold]** **Approve and start**: one click, no dialog; Ploeg resumes
   the Work Item, and the approver is recorded as the person who handed it
   over. **[ClickUp]** comment "Approved by `<person>`", status → "in
   progress". Flow c continues from step 3.
6. **[Unfold]** Or **Decline** with an optional one-line reason: Unfold asks
   Ploeg to cancel the Work Item, removes **Unfold** from the task, and
   comments "Declined by `<person>`: `<reason>`".

| State | What happens |
|---|---|
| Nobody decides | Needs you keeps it; a reminder after one working day; no expiry and no automatic start |
| The outsider unassigns before anyone decides | the Work Item is withdrawn, the row disappears, nothing spent |
| Two members click at once | the first wins; the second sees "Approved by `<person>` a moment ago" |
| The approver lost Team membership since the page loaded | refused with `approval_not_permitted`, the row stays |
| The assigner is a ClickUp Guest or someone with no Unfold sign-in | same flow; the row says "not a person in Unfold" |
| The assignment came from Unfold's own **Hand to** by a non-member | same flow; Unfold says before the click that it will wait for approval |
| Ploeg too old to hold assignments for approval | the binding step says so, and the List's assignments start directly as today, named on the binding line |

### (e) Working from one's own Claude Code with the plugin

**Actors:** Developer. **Starts when:** they start work on a branch in
their own terminal. **Done when:** the session is linked to the task and its
cost recorded against it. **How often:** daily. **Today:** the plugin finds
`CU-<id>` and ClickUp custom ids in the branch, prompts and commits, and
links only when one of the person's own task sources holds the task and Ploeg
has a Work Item for it in their Teams
([Link your Claude Code sessions](../../../docs/how-to/link-claude-code-sessions.md#4-work-as-usual));
a ClickUp source without its own token needs the person's linked ClickUp
account. Cost is recorded per Work Item and day ([ADR-0069](../../../apps/unfold/docs/adrs/0069-linked-session-cost-is-billing-input-recorded-as-an-estimate-at-api-list-prices.md)).

1. **[Claude Code]** Installs the plugin once with the Unfold address and
   approves once in the browser with the company login (exists).
2. **[Claude Code]** Starts on `CU-86c1abcde_login` or `feat/web-42-login`.
3. **[Unfold]** The plugin sends the id. Unfold resolves it through the
   organisation's connection (no personal link, D12) and links the session
   when the person can see the task in ClickUp (D13). **Proposed:** a task
   with no Ploeg Work Item links too, to the tracker item itself (Open
   Question 6).
4. **[Unfold]** The session appears on the task's page and on Now; its
   estimate is recorded as it works and after it goes idle.
5. **[GitHub]** The pull request the session opens links too; the task gets
   the link comment (D18).
6. **[Unfold]** The recorded estimate counts toward the task's Client at
   month end (flow j).

| State | What the Developer sees |
|---|---|
| The branch names no task | "Not linked" on the session page with suggested tasks on the same repository and a **Link** field (exists) |
| The person cannot see the task in ClickUp | not linked, and the session page says only "No task you can see has that id" |
| The id matches tasks on two connected Workspaces | not linked; both offered to pick from |
| No telemetry connected | linked, cost reads "No telemetry connected", never zero (exists) |
| The task is later handed to Ploeg | the session stays linked; the Work Item inherits the tracker item's linked sessions (Open Question 6) |

### (f) A new List or Client appears

**Actors:** Admin (confirms); Developers (informed). **Starts when:** someone
creates a List, Folder or Space in ClickUp that the Unfold member can see.
**Done when:** the List is bound with a confirmed Client and a default
repository, or dismissed. **How often:** monthly. **Today:** missing.

1. **[ClickUp]** A project manager creates Folder `<client>` with List
   `Website`.
2. **[Unfold]** Settings → Connections shows a line "New List: `<client>` /
   Website", suggesting Client `<client>` from the Folder (or Space) name,
   matched to an existing Client or offered as a new one, and a repository
   when one of the registered repositories carries the same name (D16).
3. **[Unfold]** The Admin confirms the Client (creating it if new), picks
   or leaves open the default repository, picks allowed repositories, and
   binds the Team. Adding the first Client shows Client Projects in the
   screens (D6).
4. **[Unfold]** If no default repository was pinned, the first task handed
   over from the List asks the Developer which allowed repository it goes to;
   that choice becomes the List's default, shown on the binding line with
   **Change**.
5. **[ClickUp]** Optionally the Admin adds a dropdown custom field
   **Repository** to the List with the allowed repositories as options; Unfold
   offers to create it. A task's value overrides the default for that task
   only.

| State | What happens |
|---|---|
| Suggestion matches no Client | the line offers **New Client `<name>`** and **Own work** with equal weight |
| Two Folders map to one Client | allowed: both Lists confirmed to the same Client |
| The Admin dismisses the List | it stays unbound and is listed under "Not connected" with **Connect**; tasks in it are not handed over |
| An agent finds the repository is wrong | the Run may only suggest: a comment "This looks like `<repo>`" and Needs you; a person changes the field (D16) |
| A List is moved to another Folder | the suggestion changes; the confirmed Client does not change without the Admin |
| A non-Admin opens the line | read-only: "An administrator connects new Lists" |

### (g) A task spanning two repositories

**Actors:** Developer (decides the split); Ploeg (works each part).
**Starts when:** a task needs changes in two repositories. **Done when:**
both pull requests are accepted and the ClickUp task is done.
**How often:** weekly in agencies with a frontend and backend repository
(*hypothesis*). **Decided:** work across several repositories is split
into Work Items, one per repository, under one root, each with its own grant
and Acceptance, sharing the root's budget and Client
([ADR-0048](../../../docs/adr/adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md)).

1. **[ClickUp]** The task's **Repository** field allows several values; the
   Developer picks two before assigning, or the first Run stops with "this
   also needs `<repo>`" (a suggestion only).
2. **[Unfold]** Needs you: "This task needs two repositories" with
   **Split into two** listing both, each checked against the List's allowed
   repositories and the Client Project's grants.
3. **[Unfold]** **Split into two** creates one child Work Item per
   repository under the task's Work Item. Each runs and opens its own pull
   request.
4. **[ClickUp]** One comment per pull request; the status stays "in
   progress" until every child's pull request is open, then "in review", and
   "done" when all merged.
5. **[Unfold]** The root's page shows both children with their state; cost
   is per child under the one Client.

| State | What happens |
|---|---|
| Second repository not allowed for the List | **Split** is offered only for allowed ones; "Ask an administrator to allow `<repo>` for this List" |
| Second repository not granted to the Client Project | the Admin sees **Grant `<repo>` to `<project>`** |
| One child accepted, one sent back | ClickUp stays "in review" with a comment per pull request |
| One child closed without merging | the root goes to Needs you; the other child is unaffected |
| The changes must merge together | a comment on both pull requests names the other; merge order stays a person's decision (Unfold never merges) |

### (h) Offboarding a person or revoking access

**Actors:** Admin (at the identity provider and in ClickUp). **Starts when:**
a person leaves, changes Team, or the organisation disconnects.
**Done when:** the person reaches nothing, and nothing of the organisation's
work breaks. **How often:** rare, decisive.

1. **[IdP]** The Admin removes the person (or their Unfold group). Their
   next request to Unfold fails, their delegated credentials stop on the next
   request ([ADR-0051](../../../docs/adr/adr-0051-an-unowned-work-item-belongs-to-the-default-tenant-and-delegated-credentials-keep-shared-memberships.md)),
   and the plugin's credential is refused.
2. **[ClickUp]** The Admin removes them from the Workspace. Unfold's match
   ends at its next refresh: if they could still sign in, they would see no
   task, and their ClickUp account leaves every binding's list of accounts
   that start work, so a later assignment by that account waits for approval
   (flow d).
3. **[Unfold]** Their work in flight keeps running: a Work Item belongs to
   its origin and Team, not to the person. Reviews waiting on them show on
   Now for the Team; the Lead sees "Waiting on someone who left" on Insights.
4. **[Unfold]** Their linked sessions and recorded estimates stay as billing
   facts; their own usage page is gone with them.

| Variant | What happens |
|---|---|
| Changes Team | Team membership changes at its source (Open Question 5); their assignments in the old Team's Lists now wait for approval |
| The person who created the Unfold member leaves | nothing breaks: the member is its own address (D5) |
| The Unfold member's token is revoked | Connections red, every List amber "unreachable", hand-off refused with the reason, **Replace token** |
| The organisation disconnects ClickUp | bindings removed in Ploeg, work in flight continues to its pull request, no status is written any more, Tasks empty with **Connect ClickUp** |
| The last Admin is removed | refused at Unfold's role mapping only when it is managed there; at the IdP Unfold cannot stop it, and the checklist says "No administrator" to anyone who signs in |

### (i) A Client approves

**Actors:** Client approver (gives the Sign-off); an Agency person
(records it on the Client's behalf until Client memberships exist);
Developer (decides Acceptance). **Starts when:** a pull request for a
Client's task is ready for review. **Done when:** the Developer accepted or
sent it back with the Client's Sign-off as input. **Decided:**
[ADR-0049](../../../docs/adr/adr-0049-a-client-sign-off-is-input-to-acceptance-bound-to-the-head-commit-and-each-client-has-an-approver.md)
(proposed; behind a flag that is off by default).

1. **[ClickUp]** The task is "in review" with the pull request link; the
   account manager tells the Client, as today.
2. **[Unfold]** The Work Item page shows **Client Sign-off** for that
   Client, bound to the head commit.
3. **[Unfold]** The Agency person records "looks good" or "needs changes"
   with a note, on the Client's behalf.
4. **[Unfold, GitHub]** The Developer accepts or sends back; with a
   required Sign-off, a merge is Acceptance only with a current one.

States: as ADR-0049: a new push dismisses the Sign-off; a Sign-off never
merges or changes ClickUp status. **D13 adds:** a Client user who later
signs in sees only tasks of their own Client that their ClickUp account
(often a Guest) can see (Open Question 8).

### (j) What Finance sees at month end

**Actors:** Finance or the Account owner (reads and exports); Admin (sets
markups). **Starts when:** month end. **Done when:** they have cost per Client
and per accepted Work Item, metered and estimated apart, ready to invoice.
**How often:** monthly. **Today:** the FOCUS export with per-Work-Item
Linked Session rows and markups exists
([ADR-0069](../../../apps/unfold/docs/adrs/0069-linked-session-cost-is-billing-input-recorded-as-an-estimate-at-api-list-prices.md));
there is no Billing page per Client.

1. **[Unfold]** Billing (proposed) opens on last month: one row per Client
   plus **Own work** and **No Client confirmed**.
2. Each row: Work Items accepted, Ploeg metered cost, linked sessions
   estimated cost (labelled an estimate at API list prices), each with its
   billable amount after the markup, never added together.
3. Opening a Client lists its Work Items with the ClickUp task title and id,
   accepted or not, and the same columns. No person is named
   ([ADR-0023](../../../docs/adr/adr-0023-unfold-measures-happiness-and-confusion-with-first-party-events-surveys-and-bug-reports.md)).
4. **Export** downloads the FOCUS file for the month with linked sessions
   included (exists as an API).
5. **No Client confirmed** links the Admin to the Lists still to confirm
   (flow f), so the next month is cleaner.

| State | What Finance sees |
|---|---|
| Unknown cost | "Not reported", never zero |
| A Work Item handed over in one month, accepted in the next | cost per day in each month; Acceptance in the month it happened |
| Telemetry not connected for some sessions | "At least" with the count of sessions not counted |
| A month not closed (Shifts still open) | open Shifts' spend shown as not yet billable |

## 4. Task state matrix and status mapping

One row per state of a task. "ClickUp status" is the matched status of the
List (D18): during binding, the Admin matches four of the List's statuses,
suggested by name; an unmatched one means Unfold leaves the status as it is
and only comments. Comments are written as the Unfold member, notify nobody
(as the hand-off comment does today), and name the person when one acted.

| # | Situation | ClickUp: assignee and status | Unfold / Ploeg state | Written back to ClickUp |
|---|---|---|---|---|
| 1 | Task exists, nobody started it | no Unfold; any status | not a Work Item; shown in Tasks to people who see it | nothing |
| 2 | A person works it themselves | the person assigned; they move it | linked session on the tracker item (Open Question 6) | the person as assignee when they start from Unfold; the pull request link when it opens |
| 3 | Assigned to Unfold by a Team member | Unfold assigned | `queued` → `running` | "in progress" + comment "started" with the Work Item link |
| 4 | Assigned to Unfold by an outsider | Unfold assigned | `needs_human`, `assignment_needs_approval` | comment "waiting for approval"; status unchanged |
| 5 | Approved | Unfold assigned | `queued` → `running` | "in progress" + comment "approved by" |
| 6 | Declined | Unfold removed | cancelled | comment "declined by … : reason"; status unchanged |
| 7 | Taken back before a worker starts | Unfold removed | withdrawn | back to the status before step 3 + comment |
| 8 | Agents need a person | Unfold assigned | `needs_human` with a reason | "needs you" + the question or reason as a comment |
| 9 | Pull request open | Unfold assigned | `awaiting_review` | "in review" + comment with the pull request link |
| 10 | Changes requested | Unfold assigned | `running` (fix Round) | "in progress" |
| 11 | Merged (Acceptance) | Unfold assigned | `done` | "done" + comment "accepted by" |
| 12 | Closed without merging | Unfold assigned | `needs_human` | "needs you" + the one-click reason |
| 13 | Split across repositories | Unfold assigned | root with children | "in review" only when every child's pull request is open; "done" when all merged |
| 14 | Task closed or deleted in ClickUp while work runs | — | Ploeg's existing withdrawal | nothing more is written |
| 15 | The task left a person's ClickUp access | unchanged | unchanged | nothing; it disappears from that person's Unfold |

**Who writes.** Status changes and comments for Ploeg work are written by
Ploeg, through the List's binding (upstream ask 8): Ploeg is the engine and
holds the connection. Unfold writes only what it writes today (the hand-off
and take-back), plus the person as assignee and the approval and decline
comments, through the same connection, which under D12 means as a Ploeg
action for the proven person (design.md Open Question 10). On the owner's own board Ploeg already
moves cards from its static configuration
([How work on Unfold is done](../../../docs/contributing/way-of-working.md#the-board));
the ask makes that a per-binding setting.

## 5. Success measures

First-party product events ([ADR-0023](../../../docs/adr/adr-0023-unfold-measures-happiness-and-confusion-with-first-party-events-surveys-and-bug-reports.md)),
per Tenant, never per person. None is instrumented yet.

| Measure | Formula | Target | Guard (paired so the target cannot be gamed) |
|---|---|---|---|
| Time to first agent pull request | p50 and p90 of `onboarding.first_agent_pr_opened − onboarding.started` (design.md section 9) | p50 < 15 min | drop-off per checklist step |
| Time to first task pull request by a non-Admin | p50 of first `task_pr_opened` for a Work Item handed over by someone other than the onboarding Admin − `onboarding.started` | no target in v1; baseline from the dogfood trial | share of people who signed in and saw at least one task |
| Tasks with a confirmed Client | Work Items created in the month whose source has an Admin-confirmed Client or is explicitly Own work ÷ all Work Items created | ≥ 90 % after the first month | number of Client changes after confirmation |
| Approval waiting time | p50 and p90 from `assignment_needs_approval` to approve or decline, working hours | p50 < 4 working hours | share declined; share withdrawn by the outsider |
| Matched people | people who signed in and matched a ClickUp member ÷ people who signed in | ≥ 95 % | count of "not matched" states shown |

## 6. Slices

The onboarding slices S1 to S11 in [design.md](design.md#slices) come first.
These follow, each a thin vertical slice, in order. Each names what it waits
for.

| # | Slice | Ships | Waits for |
|---|---|---|---|
| **P1** | **Visibility follows the tracker (the smallest first slice, D13)** | person ↔ ClickUp member by verified email; Tasks, Now's Up next and tracker-origin Work Items filtered to what the member can see; the not-matched state; Admin-visible match count | S5 (the organisation connection); design.md ask 6's Scope read saying which accounts see each Scope, since under D12 Unfold holds no token to ask ClickUp itself; Open Question 8 |
| P2 | The pull request link and status on the task (D18) | the status match on the binding; Ploeg writes status and comments | upstream ask 8 |
| P3 | Outsider approval (D14) | binding's starting accounts kept in sync with the Team's people; Needs you **Approve and start** / **Decline** | upstream ask 7; Open Questions 5 and 10 |
| P4 | Client and repository suggestions (D16) | Client from Space or Folder, learned or pinned default repository, the per-task **Repository** value | S11 (Client Projects shown), S5; Open Question 9 |
| P5 | Work on it myself (D15) | the command, the person as assignee, tracker-item linking without a Ploeg Work Item | Open Questions 6 and 10 |
| P6 | Two repositories | **Split into two**, per-child status rule | P4; Ploeg's child Work Items under a root |
| P7 | Billing per Client | the month view and the "No Client confirmed" row | P4; Open Question 7 |
| G1 | GitLab as the forge, same flow | connect GitLab (group-level), register projects, everything else unchanged | a GitLab forge connection in Ploeg's connection contract (ask 2) and ADR-0193 for GitLab; Ploeg ADR-0192 when an installation already serves GitHub |

**Why P1 first.** With D12 everyone reads tasks through the organisation's
connection, so without P1 every signed-in person sees every task the Unfold
member can see. P1 is therefore the gate for letting anyone but Admins into
Tasks, needs of Ploeg only that its Scope read says who sees each Scope (the
D13 sentence in design.md ask 6), and is the moment the product feels like
"my board". Until P1 ships, Tasks stays Admin-only on a Tenant whose sources
come from onboarding.

**Order after P1.** P2 makes the eureka visible where people already work
(the link on the task); P3 protects budget and review time before anyone
outside the Team is told about Unfold; P4 to P7 make billing right; G1 starts
once the GitHub path has passed the timed trial (tasks.md 8.5).

## 7. Upstream asks added by these journeys

In ploeg-hq's words, naming no consumer; they continue design.md section 4,
whose list ends at ask 6 (the Scope and item read and the hand-over action).

7. **A binding names the tracker accounts whose Assignments start work.** An
   Assignment through the binding by any other account is admitted as
   `needs_human` with reason `assignment_needs_approval`, spends nothing, and
   resumes on an operator's approval or is cancelled on a decline. Ploeg
   records the assigning account as reported by the tracker. Not verified:
   that ClickUp's assignee webhook names who made the change on every plan.
8. **A binding carries a status map and writes delivery comments.** Ploeg
   moves the task to the mapped status at start, needs-a-person, pull request
   open, changes requested and done, and comments the pull request link;
   an unmapped state writes only the comment.

## 8. Not verified

- Whether ClickUp's List member read (`/list/{id}/member`, which
  [clickup.ts](../../../apps/unfold/src/task-providers/clickup.ts) already
  calls) includes people who reach a public List through the Space, and how
  private tasks inside a List are exposed; P1 must check both against a real
  Workspace before it claims "what you see in ClickUp".
- Whether ClickUp emails are verified for every member, so an email match is
  safe; the sign-in side uses the identity provider's `email_verified`.
- Whether a dropdown custom field can be created by the Unfold member as a
  Member, or needs a Workspace admin.
- GitLab: which token kind a group connection uses on GitLab.com tiers and
  on self-managed GitLab.
