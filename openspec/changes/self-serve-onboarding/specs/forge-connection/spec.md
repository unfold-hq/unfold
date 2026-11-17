# Forge connection

## ADDED Requirements

### Requirement: A GitHub App is created with the manifest flow

Unfold SHALL offer an Admin to create the installation's GitHub App with
GitHub's App manifest flow, asking only for the permissions Ploeg documents
for a GitHub forge. Unfold MUST relay the conversion code to Ploeg without
storing or logging it, and MUST accept the callback only with an OAuth
`state` started for the same signed-in person within ten minutes. Ploeg's routes are owned by Ploeg ADR-0184 and ADR-0193; Unfold restates none of them.

#### Scenario: The Admin creates the App

- **WHEN** an Admin completes GitHub's App creation page and GitHub redirects
  back with a code and a valid `state`
- **THEN** Unfold relays the code to Ploeg, Ploeg stores the key, and Unfold's
  database, logs and action records contain neither the code nor the key

#### Scenario: A forged callback

- **WHEN** the callback arrives with a `state` Unfold did not start for this
  person, or one already used
- **THEN** Unfold answers 400 `onboarding_state_invalid` and relays nothing

### Requirement: Installing the App is verified by Ploeg

After installation Unfold SHALL relay the installation id to Ploeg and MUST
mark the forge connection green only when Ploeg reports that the installation
belongs to its App and reaches at least one repository.

#### Scenario: Installed on two repositories

- **WHEN** the Admin installs the App on two repositories
- **THEN** the GitHub line is green and the repository picker lists exactly
  those two

#### Scenario: The App is uninstalled later

- **WHEN** Ploeg's connections read reports the installation gone
- **THEN** the GitHub line is red with **Reinstall**, every repository on it is
  marked unreachable, and hand-off and import for them are refused with that
  reason

### Requirement: A repository is registered only through Ploeg

Unfold MUST add a repository only after Ploeg's runtime Work Target
registration accepts it, running the dry run first and showing each check. A
repository Ploeg's forge connection does not reach MUST NOT be offered.

#### Scenario: A ready repository

- **WHEN** an Admin picks a repository that passes Ploeg's readiness check
- **THEN** Ploeg registers it, Unfold stores it keyed by forge instance and
  `owner/name`, grants it to Own work, and its line is green

#### Scenario: A repository missing only AGENTS.md

- **WHEN** the dry run refuses a repository only because `AGENTS.md` is
  missing
- **THEN** its line shows "not ready: AGENTS.md missing" with the readiness
  offer, and nothing is registered

### Requirement: Unfold reads the shared App key from Ploeg's secret

While the hardening slice has not landed, Unfold SHALL read the GitHub App
private key from the secret Ploeg wrote, mounted read-only as a file, and
MUST start when that secret does not exist yet.

#### Scenario: Unfold starts before the App exists

- **WHEN** Unfold starts and the mounted key file is absent
- **THEN** Unfold starts, and GitHub sources report the key as missing until
  the file appears

### Requirement: A second forge waits for Ploeg's multi-forge support

On an installation whose Ploeg already serves another forge, Unfold MUST
refuse to connect GitHub until the pinned Ploeg resolves a Run's forge from
its Work Target (Ploeg ADR-0192), and SHALL say so on the GitHub line.

#### Scenario: A Forgejo installation adds GitHub

- **WHEN** Ploeg's connections read reports a Forgejo forge and the pinned
  Ploeg does not serve per-target forges
- **THEN** the GitHub line names the Ploeg release that adds it and Unfold
  sends no forge connection request
