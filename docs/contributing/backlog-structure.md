---
type: reference
audience: [owner, contributor, agent]
owner: unfold
last_verified: 2026-11-19
verified_by: "Written from the owner's decision of 2026-11-19 on how the Unfold and Ploeg backlog is structured. Not checked against the tickets on the board: this page states the structure, not that every ticket already follows it."
---

# How the backlog is structured

The owner decided on 2026-11-19 how tickets for Unfold and Ploeg are sorted. Every ticket sits in one **Domain** (the horizontal axis) and, when it moves an outcome forward, in one **outcome epic** (the vertical axis). Five more axes describe who it is for, what it trusts, how far along it is, and where it shows up. [The board](way-of-working.md#the-board) still decides *when* a ticket is worked on; this page decides *where it belongs*.

## Domain

A Domain is the part of the system a ticket changes. A ticket has exactly one; when it seems to need two, split it.

| Domain | Covers |
| --- | --- |
| **D1 Tenancy** | Organisations, tenants and the separation of their data. |
| **D2 Human identity & access** | Login, roles and permissions of people. |
| **D3 Delegation & agent identity** | On-behalf-of: the token's `sub` is the person and `act` is the Team or Role acting for them. What an agent may do, the budget per actor, and who is responsible for what an agent did. |
| **D4 Connections & external identities** | The forge, the tracker, a Claude routine and the secret store, and the identities the agent appears as there: the GitHub App and the tracker member. |
| **D5 Execution & isolation** | Worker, harness, credential gateway, orchestrator, workload identity and admission. |
| **D6 Workflow** | Intake, work targets, Runs, budget, outcome, review and the pull request. |
| **D7 Product surface** | The Unfold interface, onboarding and notifications. |
| **D8 Delivery** | CI, contract pins, releases and the merge queue. |
| **D9 Observability & audit** | Telemetry, logs and the audit trail. |

### Four kinds of "who"

"Identity" means four different things in this system. Each lives in its own Domain, so a ticket about one does not drift into another.

| Who | What it is | Domain |
| --- | --- | --- |
| **A person** | Someone who logs in, with roles and permissions. | D2 |
| **An agent acting for a person** | A Team or Role working on behalf of a person: the person stays the subject, the agent is the actor, and the budget and responsibility follow from that pair. | D3 |
| **A workload** | The running process, such as a worker or a harness, proving what it is to the platform, independent of whom it works for. | D5 |
| **An external identity** | The account the agent appears as in another system: the GitHub App on the forge, the member on the tracker. | D4 |

## Outcome epics

An outcome epic is a result someone can observe, not a component. A ticket belongs to the epic whose outcome it moves; a ticket that moves none has no epic.

| Epic | Outcome |
| --- | --- |
| **V1** | A new organisation connects its forge and tracker itself. |
| **V2** | Claude on your own subscription works end to end. |
| **V3** | No secret in a pod, proven live. |
| **V4** | Teams are named for what they do. |
| **V5** | Merging is safe without anyone watching. |

## Extra axes

| Axis | Values | Meaning |
| --- | --- | --- |
| **Actor** | Developer, Reviewer/lead, Org decision-maker, Operator, Auditor, Client | Who the ticket is for. |
| **Trust boundary** | None, Secrets/credentials, Untrusted repo content, Tracker text, Model output, Cross-tenant data | The boundary the change crosses or handles. |
| **Maturity** | Proposed, Built, Opt-in, Default, Required, Deprecated | How far the capability has come. |
| **Lifecycle** | `onboard`, `configure`, `run`, `review`, `operate`, `offboard` | The stage of use the ticket touches; a tag, more than one allowed. |
| **Surface** | `web`, `cli-mcp`, `ide`, `tracker` | Where a person meets the change; a tag, more than one allowed. |

## The security-review rule

A ticket whose trust boundary is anything but **None** gets the `security-review` tag. Its pull request gets an independent security review before it merges, in addition to the [review guide](review.md).

## Sharp edges

Places where tickets that look independent are not.

- **Contract lag.** Unfold depends on a released Ploeg. A change that needs both lands in Ploeg first, and Unfold can only use it after the next contract pin.
- **Green alone, red together.** Two pull requests that each pass CI can still break `development` once both merge.
- **Parallel migration numbers.** Two branches that each add a database migration can pick the same number.
- **Convenience environment variables.** Any variable that hands a credential straight to a worker or harness breaks credential isolation, however handy it is.
- **claude.ai credentials.** Anthropic's terms forbid storing or relaying claude.ai credentials. V2 has to work without Unfold or Ploeg ever holding them.
- **Organisations stay apart.** No knowledge of one organisation (names, ids, hosts, people) reaches another's data, tickets or repositories.
- **Built to Required.** Moving a capability from Built (or Opt-in, or Default) to Required breaks every installation that has not migrated. Migrate every installation first.
