# Forge connection

## ADDED Requirements

### Requirement: A GitHub App is created with the manifest flow

Unfold SHALL offer an Admin to create the installation's GitHub App with
GitHub's App manifest flow, asking only for the permissions Ploeg documents
for a GitHub forge, and MUST relay the conversion code to Ploeg without
storing or logging it. The OAuth `state` MUST be one Ploeg issued, and Unfold
MUST also tie it to the person's session and accept the callback only from
that person, once, within ten minutes. Ploeg's routes are owned by Ploeg
ADR-0184 and its proposed amendment.

#### Scenario: The Admin creates the App

- **WHEN** an Admin completes GitHub's App creation page and GitHub redirects
  back with a code and a `state` Ploeg issued and Unfold tied to this session
- **THEN** Unfold relays the code and the `state` to Ploeg, Ploeg stores the
  key, and Unfold's database, logs and action records contain neither the code
  nor the key

#### Scenario: A forged callback

- **WHEN** the callback arrives with a `state` Unfold did not tie to this
  person's session, one already used, or one older than ten minutes
- **THEN** Unfold answers 400 `onboarding_state_invalid` and relays nothing

### Requirement: Installing the App is verified by Ploeg

After installation Unfold SHALL relay the installation id to Ploeg and MUST
mark the forge connection green only when Ploeg reports that the installation
belongs to its App and reaches at least one repository. Each installation is
its own Integration Account, keyed with its installation id.

#### Scenario: Installed on two repositories

- **WHEN** the Admin installs the App on two repositories
- **THEN** the GitHub line is green and the repository picker lists exactly
  those two

#### Scenario: Installed on a second GitHub organisation

- **WHEN** the Admin installs the same App on a second GitHub organisation
- **THEN** Unfold stores a second Integration Account with that installation's
  id, and the first one is unchanged

#### Scenario: The App is uninstalled later

- **WHEN** Ploeg's connections read reports the installation gone
- **THEN** the GitHub line is red with **Reinstall**, every repository on it is
  marked unreachable, and hand-off and import for them are refused with that
  reason

### Requirement: A repository is registered only through Ploeg

Unfold MUST add a repository only after Ploeg's runtime Work Target
registration accepts it, running the dry run first and showing each check. A
repository Ploeg's forge connection does not reach MUST NOT be offered. Unfold
SHALL take whether a repository may be prepared from Ploeg's
`prepareAvailable` field and MUST NOT derive it from readiness reason text.

#### Scenario: A ready repository

- **WHEN** an Admin picks a repository that passes Ploeg's readiness check
- **THEN** Ploeg registers it, Unfold stores it keyed by forge instance and
  `owner/name`, grants it to Own work, and its line is green

#### Scenario: A repository missing only AGENTS.md

- **WHEN** Ploeg registers a repository and reports it not ready with
  `prepareAvailable: true`
- **THEN** Unfold stores and grants it, its line shows "not ready: AGENTS.md
  missing" with the readiness offer, and it is not offered for binding a List

#### Scenario: An archived repository

- **WHEN** Ploeg refuses a repository with `422 target_not_ready` because it
  is archived
- **THEN** its line shows that reason without a readiness offer, and Unfold
  stores nothing

#### Scenario: The installation has not opted in

- **WHEN** Ploeg answers the dry run with `422 registration_not_accepted`
- **THEN** Unfold registers nothing and the installation line names
  `targetRegistration` as the install value to set

### Requirement: A second forge waits for Ploeg's multi-forge support

On an installation whose Ploeg already serves another forge, Unfold MUST
refuse to connect GitHub until the pinned Ploeg resolves a Run's forge from
its Work Target (Ploeg ADR-0192), and SHALL say so on the GitHub line. Unfold
MUST decide this from the pinned Ploeg bundle version until Ploeg reports the
forges it serves in its connections read, and SHALL then use that report. It
MUST NOT infer it from the version route's contract majors.

#### Scenario: A Forgejo installation adds GitHub

- **WHEN** Ploeg's connections read reports a Forgejo forge and the pinned
  Ploeg bundle is older than the release that ships ADR-0192
- **THEN** the GitHub line names the Ploeg release that adds it and Unfold
  sends no forge connection request
