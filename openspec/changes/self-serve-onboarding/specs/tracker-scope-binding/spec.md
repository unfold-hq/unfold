# Tracker Scope binding

## ADDED Requirements

### Requirement: ClickUp is connected through a dedicated member

The ClickUp connect step SHALL explain why Unfold needs its own ClickUp member
and take that member's token once in a write-only field. Unfold MUST check
the token's shape and relay it only to Ploeg's connection flow (Ploeg
ADR-0195), MUST keep no copy (system ADR-0060), and MUST never show, log or
export it.

#### Scenario: The member's token is pasted

- **WHEN** an Admin pastes a valid token of the member "Unfold"
- **THEN** Unfold relays it to Ploeg's connection flow, shows the account name
  Ploeg reports and when it was set, and never returns the token in any
  response

#### Scenario: Nothing is kept in Unfold

- **WHEN** Ploeg has stored the member's token
- **THEN** Unfold's database, logs, action records and product events hold
  the Ploeg connection id and no token

#### Scenario: The Admin pastes their own token

- **WHEN** the account Ploeg reports for the token has the signed-in Admin's
  email address
- **THEN** Unfold asks Ploeg to remove the connection, answers 400
  `connection_token_personal`, and explains why a separate member is needed

#### Scenario: A malformed token

- **WHEN** the value does not have the shape ClickUp's adapter declares
- **THEN** Unfold answers 400 `connection_token_invalid` before any request
  leaves Unfold

### Requirement: Lists and their tasks are read through Ploeg

Unfold SHALL read a Ploeg connection's Lists and their tasks through
Ploeg's Scope read (design.md section 4, ask 6) and MUST NOT call the tracker
itself for them. Until the pinned Ploeg serves that read, Unfold SHALL refuse
the step with the release that adds it. The demo SHALL answer from fixtures.

#### Scenario: Picking Lists

- **WHEN** an Admin opens the List picker for a ClickUp connection made
  through Ploeg, and the pinned Ploeg serves the Scope read
- **THEN** the picker shows the Lists Ploeg returns, and no request leaves
  Unfold for a ClickUp host

#### Scenario: Ploeg does not serve the read yet

- **WHEN** the pinned Ploeg answers 404 on the Scope read
- **THEN** the picker answers 503 `ploeg_step_unavailable` with the Ploeg
  release that adds it, and sends no request to the tracker

### Requirement: A List is bound to a Team and repositories through Ploeg

Unfold SHALL bind a saved List by running Ploeg's dry run first, showing each
check, and creating the binding only when every check passes. The binding's
destinations MUST be registered Work Targets granted to the source's Client
Project that Ploeg reports as ready; Unfold MUST NOT ask Ploeg to bind a List
to a target that is not ready. A retried create with the same body MUST leave
one binding. The List's step SHALL count as done only when Ploeg reports the
binding `active`.

#### Scenario: Binding a List

- **WHEN** an Admin maps a List to repository `shop` and the Team `delivery`
  and the dry run passes
- **THEN** Ploeg holds one active binding, the saved source records its id,
  and the List's line is green

#### Scenario: A repository waiting for its readiness pull request

- **WHEN** the only repository granted to Own work is registered but not
  ready
- **THEN** the map step offers no repository, says the readiness pull request
  must be merged first, and Unfold sends no binding request

#### Scenario: The binding waits for a webhook

- **WHEN** Ploeg creates the binding as `awaiting_webhook`
- **THEN** the List's line stays amber with Ploeg's reason and **Check
  again**, because Ploeg does not poll ClickUp and the binding receives no
  Assignment until a webhook delivers

#### Scenario: A lost response is retried

- **WHEN** the create response is lost and Unfold sends the same create again
- **THEN** Ploeg answers with the existing binding and Unfold stores one
  binding id

#### Scenario: The List is routed by the configuration

- **WHEN** Ploeg answers `409 conflicts_with_static`
- **THEN** the line says "Configured by the installation" with the static
  entry Ploeg named, and Unfold stores no binding

### Requirement: A saved source carries its Ploeg target

A saved source whose List Ploeg routes, through a static route or a live
binding, SHALL carry that route's default Work Target as its `ploeg` target
in the running workbench, so that importing its tasks into shared execution
does not fail with `task_binding_unconfigured`.

#### Scenario: Import from a saved source

- **WHEN** a task from a saved List with an active binding is imported
- **THEN** the import binding lookup runs against the binding's target instead
  of answering `409 task_binding_unconfigured`

#### Scenario: Binding removed

- **WHEN** the binding is removed in Ploeg
- **THEN** the next sync drops the source's `ploeg` target and the List's line
  is red with **Bind again**

### Requirement: Removing a binding or connection is complete and safe to retry

Removing a binding SHALL ask Ploeg to remove it and treat an already removed
binding as success. Removing a ClickUp connection MUST be refused while a
saved source or binding still uses it.

#### Scenario: Remove twice

- **WHEN** an Admin removes a binding and the request is retried
- **THEN** both answers succeed and one OCSF delete record is written

#### Scenario: Connection still in use

- **WHEN** an Admin removes a connection that a saved source uses
- **THEN** Unfold answers 409 `connection_in_use` and removes nothing
