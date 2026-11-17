# Organisation onboarding

## ADDED Requirements

### Requirement: The Connections page is the onboarding checklist

Settings → Connections SHALL show one line per onboarding stage and one line
per board and repository, each with a state computed from live Ploeg and
vendor reads, and every line that is not green MUST name what failed and
offer the action that fixes it. An Admin SHALL land on it after signing in
only while the Tenant has no source and no repository at all, stored or
configured.

#### Scenario: A new Admin signs in

- **WHEN** an Admin signs in to a Tenant that has no source and no
  repository, stored or configured
- **THEN** Unfold opens Settings → Connections with every stage grey and the
  first stage's action offered

#### Scenario: A configured installation signs in

- **WHEN** an Admin signs in to a Tenant whose configuration names a task
  source or a repository
- **THEN** Unfold opens Now as before and records no `onboarding.started`

#### Scenario: A check fails

- **WHEN** Ploeg's dry run for a List returns `agent_cannot_see_scope`
- **THEN** the List's line is red, names that check, offers "Share the List
  with the Unfold member" and **Check again**, and creates nothing

#### Scenario: A configured installation opens the page

- **WHEN** an installation with configured repositories and task sources and
  no runtime entries opens the page
- **THEN** each configured entry is shown as "Configured by the installation"
  with its checks, and nothing is created or changed

### Requirement: Only an Admin connects and adds

Creating, replacing or removing an Integration Account, registering a
repository, saving or binding a List, and starting a readiness Work Item MUST
require an administrator, and under `tenancy.enforce` an Admin membership of
the Tenant. Others SHALL see the lines read-only with "Ask an administrator",
without the Admins listed. An object of a
Tenant the person does not reach MUST answer the same 404 as a missing one,
before any request to Ploeg or a vendor.

#### Scenario: A Developer tries to add a repository

- **WHEN** a person with a Developer membership posts a repository
  registration
- **THEN** Unfold answers 403 and sends nothing to Ploeg

#### Scenario: Another Tenant's Integration Account

- **WHEN** an Admin of Tenant A requests an Integration Account of Tenant B
- **THEN** Unfold answers 404 and sends no request to Ploeg or the vendor

### Requirement: Everything lands in Own work until a Client exists

Each Tenant SHALL have one default Client Project with no Client, named "Own
work". Every source and repository added during onboarding MUST belong to or
be granted to it. The screens MUST NOT show Client Projects while the Tenant
has no Client.

#### Scenario: First repository added

- **WHEN** an Admin registers the Tenant's first repository
- **THEN** Unfold creates Own work if it does not exist, stores the
  repository, grants it to Own work, and shows no project selector

#### Scenario: The first Client is added

- **WHEN** the Tenant gains its first Client
- **THEN** Client Projects appear in the screens with Own work listed first,
  and no existing source or grant changes

### Requirement: The configuration wins

A configured repository or task source that has the same key as a stored one
SHALL hide the stored one, which MUST be marked `shadowed` and kept, never
deleted. Unfold MUST NOT rewrite the configuration.

#### Scenario: The installer adds a repository to the configuration later

- **WHEN** a repository stored from the screen is also added to
  `repositories[]` and Unfold restarts
- **THEN** the configured entry is used, the stored one is marked `shadowed`
  and the line offers "Remove the runtime entry"

### Requirement: No onboarding spend without a Team spend cap

Unfold MUST refuse to start a readiness Work Item, and MUST refuse to bind a
List during onboarding to a Team, while Ploeg's Teams read reports that Team's
`spendCap` as null, and SHALL show the cap for an Admin to confirm before the
first paid step. The gate MUST NOT refuse hand-off or import on an
installation whose sources or bindings were configured, or bound, outside
onboarding.

#### Scenario: No cap

- **WHEN** Ploeg reports `spendCap: null` for the Team and an Admin starts a
  readiness Work Item
- **THEN** Unfold answers 409 `budget_missing`, sends nothing to Ploeg, and the
  installation line names the Team's spend cap as the value the installer sets

#### Scenario: A configured installation without a cap

- **WHEN** a Team has no spend cap and a person hands off a task from a
  configured source
- **THEN** the hand-off proceeds as before this change

### Requirement: The installation prerequisites are checked first

The checklist SHALL show each one-time install value of design.md section 1
as a line, read from Ploeg where Ploeg reports it. Unfold MUST treat a
`422 registration_not_accepted` or `422 bindings_not_accepted` from a dry run
as "the installation has not opted in", naming the install value, and not as
a Ploeg that does not serve the step.

#### Scenario: No Team

- **WHEN** Ploeg's Teams read lists no Team
- **THEN** the installation line is red, says that Teams are set by the person
  installing Ploeg, and the repository and List steps explain that they need
  a Team

#### Scenario: Bindings not accepted

- **WHEN** Ploeg answers a binding dry run with `422 bindings_not_accepted`
- **THEN** Unfold creates nothing, and the installation line names
  `teams.<team>.trackerBindings.connections` and the connection to list

### Requirement: A step Ploeg does not serve is refused with its reason

When the pinned Ploeg does not serve the route a step needs, Unfold MUST
refuse the step before sending any request, with `503 ploeg_step_unavailable`
naming the Ploeg release that adds it, and SHALL offer the equivalent
configuration entry. Unfold MUST detect this from the step's read route, or
from the pinned Ploeg bundle version where the step has no route, never by
sending a write.

#### Scenario: Ploeg without runtime bindings

- **WHEN** `GET /api/v1/operator/tracker-bindings` answers 404 and an Admin
  binds a List
- **THEN** Unfold answers `503 ploeg_step_unavailable`, sends no binding
  request, and shows the configuration entry for the List

#### Scenario: Ploeg is upgraded

- **WHEN** the same Unfold later reads a Ploeg that serves the route
- **THEN** the step becomes available without an Unfold restart or release

### Requirement: Two clocks are measured

Unfold SHALL record the `onboarding.*` product events of design.md section 9
with a pseudonymous actor, the Tenant and no screen text. `started`,
`first_agent_pr_opened` (any kind, with its kind) and `first_task_pr_opened`
(with whether a readiness pull request came first) MUST each be recorded at
most once per Tenant, the last two with the seconds since `started`.

#### Scenario: A readiness pull request opens first

- **WHEN** a readiness Run opens the Tenant's first agent pull request
- **THEN** one `onboarding.first_agent_pr_opened` event with kind `readiness`
  is stored and no `onboarding.first_task_pr_opened`

#### Scenario: The first task pull request opens later

- **WHEN** a task Run later opens the Tenant's first task pull request
- **THEN** one `onboarding.first_task_pr_opened` event is stored marked as
  following a readiness pull request, and no second
  `onboarding.first_agent_pr_opened`

#### Scenario: The Admin signs in again

- **WHEN** a second Admin of the same Tenant signs in before onboarding is
  done
- **THEN** no second `onboarding.started` is recorded
