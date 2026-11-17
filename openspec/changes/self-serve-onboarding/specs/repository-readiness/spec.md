# Repository readiness

## ADDED Requirements

### Requirement: The readiness pull request is offered only where it fits

Unfold SHALL offer **Prepare this repository** only for a repository Ploeg
reports as not ready solely because `AGENTS.md` is missing on its base branch.
A repository that is archived, a mirror, or missing anything else MUST show
that reason instead, without the offer. The Run itself is owned by Ploeg ADR-0194, under which it may change only `AGENTS.md`.

#### Scenario: Only AGENTS.md missing

- **WHEN** Ploeg's readiness facts for a reachable repository list
  `AGENTS.md` missing and nothing else
- **THEN** the repository's line offers **Prepare this repository** with the
  estimate

#### Scenario: Archived repository

- **WHEN** the repository is archived
- **THEN** the line says it is archived and offers no readiness pull request

### Requirement: A person confirms the cost before any spend

Unfold MUST show the estimated cost and the Shift Budget cap of the readiness
Work Item and MUST send it to Ploeg only after a person confirms that amount.
A confirmation SHALL be bound to the amount shown; a changed estimate MUST ask
again.

#### Scenario: Confirmed

- **WHEN** an Admin confirms an estimate of USD 0.80 under a cap of USD 2.00
- **THEN** Unfold asks Ploeg for one prepare-repository Work Item with that cap
  and writes an OCSF record naming the person and the cap

#### Scenario: Estimate changed

- **WHEN** the estimate Ploeg returns at creation differs from the one the
  person confirmed
- **THEN** Unfold creates nothing and asks the person to confirm the new
  amount

### Requirement: Restart, retry and cancel never repeat paid work

A retried confirmation SHALL resolve to the existing readiness Work Item of
that repository instead of creating a second one. Cancelling it MUST stop the
Run through Ploeg and MUST NOT start a new one. A Unfold restart MUST NOT
resend the request.

#### Scenario: Double click

- **WHEN** the confirmation is sent twice for one repository
- **THEN** one Work Item exists and both answers name it

#### Scenario: Cancelled

- **WHEN** a person cancels the readiness Work Item while it runs
- **THEN** Ploeg stops it, the offer returns as **Prepare this repository**,
  and nothing restarts by itself

### Requirement: Merging the readiness pull request moves the repository up

After the readiness pull request merges, Unfold SHALL re-read the repository's
readiness facts and show it as ready and at Level 2 of ADR-0047, with the next
missing Level 3 check named.

#### Scenario: Merged

- **WHEN** the readiness pull request merges and Ploeg's next readiness read
  finds `AGENTS.md`
- **THEN** the repository's line is green, shows Level 2, and names the next
  missing check
