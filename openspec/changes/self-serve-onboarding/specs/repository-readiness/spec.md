# Repository readiness

## ADDED Requirements

### Requirement: The readiness pull request is offered only where it fits

Unfold SHALL offer **Prepare this repository** only for a registered
repository for which Ploeg reports `prepareAvailable: true`, and MUST NOT
derive the offer from readiness reason text. A repository that is archived, a
mirror, or missing anything else MUST show that reason instead, without the
offer. The Run itself is owned by Ploeg ADR-0194, under which it may add only
`AGENTS.md`.

#### Scenario: Prepare available

- **WHEN** Ploeg reports a registered repository not ready with
  `prepareAvailable: true`
- **THEN** the repository's line offers **Prepare this repository** with the
  cap that bounds the Run

#### Scenario: Archived repository

- **WHEN** the repository is archived
- **THEN** the line says it is archived and offers no readiness pull request

### Requirement: A person confirms the cap before any spend

Unfold MUST show the cap that bounds the readiness Run, the lowest of the caps
Ploeg ADR-0194 section 5 names that Unfold can read, and no cost estimate. It
MUST send the Work Item only after a person confirms that cap, with the cap as
`budgetUsd`. A confirmation SHALL be bound to the cap shown; a changed cap
MUST ask again. Readiness work MUST be refused for a Team whose `spendCap` is
null.

#### Scenario: Confirmed

- **WHEN** an Admin confirms a cap of USD 2.00
- **THEN** Unfold asks Ploeg for one prepare-repository Work Item with
  `budgetUsd` 2.00 and writes an OCSF record naming the person and the cap

#### Scenario: Cap changed

- **WHEN** the cap Unfold reads at confirmation differs from the one the
  person saw
- **THEN** Unfold creates nothing and asks the person to confirm the new cap

#### Scenario: No spend cap

- **WHEN** Ploeg's Teams read reports `spendCap: null` for the Team
- **THEN** Unfold answers 409 `budget_missing`, sends nothing to Ploeg, and
  the installation line names the Team's spend cap as the value to set

### Requirement: Restart, retry and cancel never repeat paid work

A retried confirmation SHALL resolve to the existing readiness Work Item of
that repository instead of creating a second one. Cancelling it MUST stop the
Run through Ploeg and MUST NOT start a new one. A Unfold restart MUST NOT
resend the request. When the cancelled Work Item had already opened its pull
request, Unfold MUST close that pull request or keep tracking it, and MUST NOT
offer a second readiness Work Item until it is closed or merged.

#### Scenario: Double click

- **WHEN** the confirmation is sent twice for one repository
- **THEN** one Work Item exists and both answers name it

#### Scenario: Cancelled before a pull request

- **WHEN** a person cancels the readiness Work Item while it runs and before
  it opened a pull request
- **THEN** Ploeg stops it, the offer returns as **Prepare this repository**,
  and nothing restarts by itself

#### Scenario: Cancelled after the pull request opened

- **WHEN** a person cancels the readiness Work Item after its pull request
  opened
- **THEN** Unfold asks whether to close the pull request; until it is closed
  or merged the line tracks it and offers no second readiness Work Item

### Requirement: Merging the readiness pull request moves the repository up

After the readiness pull request merges, Unfold SHALL re-read the repository's
readiness facts and show it as ready and at Level 2 of ADR-0047, with the next
missing Level 3 check named, and SHALL then offer it for binding a List.

#### Scenario: Merged

- **WHEN** the readiness pull request merges and Ploeg reports
  `target.readiness_changed` with the repository ready
- **THEN** the repository's line is green, shows Level 2, names the next
  missing check, and the repository is offered in the List binding step
