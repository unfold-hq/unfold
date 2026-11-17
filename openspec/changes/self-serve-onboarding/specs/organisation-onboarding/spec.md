# Organisation onboarding

## ADDED Requirements

### Requirement: The Connections page is the onboarding checklist

Settings → Connections SHALL show one line per onboarding stage and one line
per board and repository, each with a state computed from live Ploeg and
vendor reads, and every line that is not green MUST name what failed and
offer the action that fixes it. An Admin of a Tenant with no Integration
Account SHALL land on it after signing in.

#### Scenario: A new Admin signs in

- **WHEN** an Admin signs in to a Tenant that has no Integration Account
- **THEN** Unfold opens Settings → Connections with every stage grey and the
  first stage's action offered

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
require an administrator, and while `tenancy.enforce` is on an Admin
membership of the Tenant. Others SHALL see the lines read-only. An object of a
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

### Requirement: No paid step without a hard Budget

Unfold MUST refuse to start a readiness Work Item or hand off a task while the
Team's enforced Budget read from Ploeg is absent or zero, and SHALL show the
enforced cap for an Admin to confirm before the first paid step.

#### Scenario: No cap

- **WHEN** Ploeg reports no enforced Budget for the Team and an Admin starts a
  readiness Work Item
- **THEN** Unfold answers 409 `budget_missing`, sends nothing to Ploeg, and the
  Budget line names who sets it

### Requirement: A step Ploeg does not serve is refused with its reason

When the pinned Ploeg does not serve the route a step needs, Unfold MUST
refuse the step before sending any request, with `503 ploeg_step_unavailable`
naming the Ploeg release that adds it, and SHALL offer the equivalent
configuration entry. Unfold MUST detect this from Ploeg's version answer or
from the step's read route, never by sending a write.

#### Scenario: Ploeg without runtime bindings

- **WHEN** `GET /api/v1/operator/tracker-bindings` answers 404 and an Admin
  binds a List
- **THEN** Unfold answers `503 ploeg_step_unavailable`, sends no binding
  request, and shows the configuration entry for the List

#### Scenario: Ploeg is upgraded

- **WHEN** the same Unfold later reads a Ploeg that serves the route
- **THEN** the step becomes available without an Unfold restart or release

### Requirement: Time to first pull request is measured

Unfold SHALL record the product events `onboarding.started`,
`onboarding.step_completed`, `onboarding.step_failed`,
`onboarding.step_refused` and `onboarding.first_pr_opened` with a
pseudonymous actor, the Tenant and no screen text, and MUST record
`onboarding.first_pr_opened` once per Tenant with the seconds since
`onboarding.started` and whether a readiness or a task Work Item opened it.

#### Scenario: The first pull request opens

- **WHEN** a Run opens the Tenant's first agent pull request on a registered
  repository
- **THEN** one `onboarding.first_pr_opened` event is stored with the elapsed
  seconds and its kind, and a second pull request records none
