# Tasks — self-serve-onboarding

Owner-only tasks are marked **[owner]**. Each slice is one pull request and
ends with `mise run verify` (and `mise run docs-check` when docs changed),
output pasted in the pull request.

## 0. Decisions and upstream

- [ ] 0.1 **[owner]** Review ADR-0059 and this change; answer design.md Open Questions 2 and 4 (1 was decided by the owner on 2026-11-18 in [ADR-0060](../../../docs/adr/adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md); 3 by the lead: two clocks)
- [ ] 0.2 **[owner]** Sign or amend [Ploeg ADR-0184](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md) and [ADR-0186](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0186-an-operator-consumer-binds-a-tracker-scope-to-a-team-at-runtime-and-static-routing-wins-on-conflict.md) in ploeg-hq
- [ ] 0.3 Land the proposed amendments (ploeg-hq/ploeg follow-up PR) carrying asks 1 to 3 of design.md section 4: the connection's own account as hand-over agent and store-backed connections in `trackerBindings.connections` (ADR-0186); the connection contract (OAuth code, manifest code, installation id, pasted token; list; state; replace; delete; `state` issuance) and rule 1's paste where the installation has no vendor OAuth app (ADR-0184); the GitHub forge receiver for `installation` and `installation_repositories` events with the store-held webhook secret (ADR-0193)
- [ ] 0.4 **[owner]** Sign [Ploeg ADR-0192](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md), [ADR-0193](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0193-a-proven-operator-registers-a-work-target-at-runtime-only-for-a-repository-ploegs-forge-connection-was-granted.md) and [ADR-0194](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0194-a-repository-missing-only-its-instruction-file-may-receive-one-run-that-adds-it.md), with their amendments
- [ ] 0.5 Raise asks 4 and 5 of design.md section 4 in ploeg-hq, in its words: an onboarding values profile in Ploeg's chart, and active forges per installation in `/operator/connections`
- [ ] 0.6 Open the tickets for S1 to S11, each naming the Ploeg change it waits for
- [ ] 0.7 Propose ask 6 of design.md section 4 in ploeg-hq as a record, in its words: an operator consumer reads a tracker connection's Scopes and their items, and assigns an item in a bound Scope to a hand-over agent with a note

## 1. S1 Checklist backbone

- [x] 1.1 Settings → Connections renders the stage lines and the board and repository lines with a fix action per non-green line
- [x] 1.2 An Admin lands on Connections after sign-in only while the Tenant has no source and no repository, stored or configured; others see the lines read-only with "Ask an administrator", without the Admins listed
- [x] 1.2a Stage 1 installation lines: Team exists and its `spendCap` from the Teams read, webhook state from the connections read; `registration_not_accepted`, `bindings_not_accepted`, `permission_required` and `person_claim_required` shown as "not opted in" with the install value; **Show the install values**
- [x] 1.3 Configured entries shown as "Configured by the installation" from Ploeg's connections read
- [x] 1.4 Rewrite the Tasks page "How connections work" dialog for the screen flow
- [ ] 1.5 Product events `onboarding.started` (once per Tenant), `step_completed`, `step_failed`, `step_refused`, `first_agent_pr_opened`, `first_task_pr_opened`; store test for no screen text. Built: the events, the once-per-Tenant rules and the store test; detecting the first pull requests from Ploeg's reads is left to S8
- [x] 1.6 `ploeg_step_unavailable` refusal and the step-availability check from the read routes, recorded in `ploeg-expectations.json`; the ADR-0192 release recorded there for the second-forge gate; test that no write is sent. Recorded in `src/ploeg-steps.json` instead: Ploeg decodes the expectation set strictly and checks each interaction against its served schemas, so an unserved route cannot go there
- [x] 1.7 Docs: `docs/concepts/connect-a-repository.md` stage table and `apps/unfold/docs/operations/task-connections.md`

## 2. S2 Saved sources get their Ploeg target

- [x] 2.1 `sync()` sets `ploeg.target` on a saved source from the static route that covers its List
- [x] 2.2 Test: import from a saved source no longer answers `task_binding_unconfigured` (fails without the fix)

## 3. S3 Repositories and Own work in Unfold's store

- [x] 3.1 Migration: `tracker_connections` to `integration_accounts` with `role`, keyed with the installation or account id; `repositories`, `client_projects`, `repository_grants`; `client_project_id` on saved sources
- [x] 3.2 Own work created on first use; projects hidden until a Client exists
- [x] 3.3 Stored repositories join `config.repositories` after the configured ones; `shadowed` on a key clash
- [x] 3.4 Tenant export classifies the new tables; OCSF records for each entity
- [x] 3.5 Add Own work, Readiness Pull Request or any other new term to `docs/domain/model.yaml` and run `mise run domain` (Own work added; Readiness Pull Request is first used in S7 and is added there)

## 4. S4 Connect GitHub and register repositories

- [ ] 4.1 Manifest flow with a Ploeg-issued `state` that Unfold also ties to the session, relay of the conversion code, callback checks; callback path kept out of request logs
- [ ] 4.2 Installation relay and the reachable-repository picker; one Integration Account per installation
- [ ] 4.3 Runtime Work Target registration with dry run and an explicit lower-case key; repository stored and granted to Own work; `prepareAvailable` stored and shown
- [ ] 4.4 "Second forge" state until the pinned Ploeg bundle is the release with ADR-0192, or Ploeg reports active forges (ask 5)
- [ ] 4.5 Redaction test: no code, key or token in any response, log, record, event or row
- [ ] 4.6 Move the Ploeg pin to the release with the connection contract and ADR-0193 (`ploeg`-scoped commit)

## 5. S5 Connect ClickUp and bind Lists

- [ ] 5.1 The member guide in plain words, from the ClickUp adapter's setup capability
- [ ] 5.2 Paste once: shape check, relay to Ploeg's connection flow only (Ploeg ADR-0195), Ploeg's probe answer shown, `connection_token_personal` removes the connection again; nothing sealed in Unfold (ADR-0060), with a test that no token reaches Unfold's database
- [ ] 5.3 List picker from Ploeg's Scope read (ask 6), refused with `ploeg_step_unavailable` until the pinned Ploeg serves it; the map step: default repository, further repositories, Team; only ready repositories offered
- [ ] 5.4 ADR-0186 dry run, create, `409 conflicts_with_static` shown as configured, idempotent retry, remove; done only when `active`, `awaiting_webhook` amber with **Check again**
- [ ] 5.5 Saved source takes the binding's target; removal drops it
- [ ] 5.6 Move the Ploeg pin to the release with the connection contract, ADR-0186, ClickUp `ScopeProber`, the connection account as agent and the Scope read

## 6. S6 Spend-cap gate

- [x] 6.1 Read the Team's `spendCap` from the Teams read; Admin confirms it; `budget_missing` refusal when it is null, for readiness work and for Teams bound during onboarding only; test that hand-off from a configured source is not refused. Built: the gate in `Onboarding.admit`, which the binding (S5) and readiness (S7) routes call once they exist, and readiness work also waits for a confirmation that matches the cap Ploeg reports now (`spend_cap_unconfirmed`)
- [ ] 6.2 **[owner]** Confirm Ploeg's chart default spend cap (`{usd: 20, period: day}`, Ploeg ADR-0162) for self-hosted installs

## 7. S7 Readiness pull request

- [x] 7.1 Offer only where Ploeg reports `prepareAvailable: true`; the cap that bounds the Run shown, no estimate
- [x] 7.2 Confirmation bound to the cap, sent as `budgetUsd`; re-ask on a changed cap; one Work Item per repository on retry; cancel never restarts; a cancel after the pull request opened closes or tracks it before a second prepare
- [x] 7.3 Review-and-merge line with the pull request link; after merge (`target.readiness_changed`): show Level 2 and the next Level 3 check (ADR-0047 part 4), and offer the repository for binding
- [ ] 7.4 Move the Ploeg pin to the release with ADR-0194

## 8. S8 First task to first pull request, measured

- [ ] 8.1 Guided last step: assign to the Unfold member or hand off from Tasks
- [ ] 8.2 Time to first agent pull request and time to first task pull request (split by whether a readiness pull request came first), p50 and p90, in Insights
- [ ] 8.3 End-to-end onboarding test against fakes of Ploeg, GitHub and ClickUp (ADR-0059 Confirmation)
- [ ] 8.4 **[owner]** Buy the ClickUp seat and create the GitHub organisation for the dogfood trial
- [ ] 8.5 **[owner]** Run the timed trial on a fresh installation after the install values are set, once with a ready repository and once with one missing `AGENTS.md`; record both clocks and the Run durations; accept or amend ADR-0059

## 9. S9 GitHub Issues as the tracker, through Ploeg

- [ ] 9.1 GitHub Issues as a tracker connection in Ploeg on the same App; issues read through Ploeg's Scope read; hand-off through Ploeg once its team read reports GitHub logins
- [ ] 9.2 No App key, `appId` or GitHub token in Unfold's chart, configuration or store (ADR-0060)

## 10. S10 Remove Unfold's tracker credentials and direct reads

- [ ] 10.1 The Tasks page reads every source's tasks through Ploeg's Scope read; hand-off is a Ploeg action for every source
- [ ] 10.2 A migration deletes ADR-0064 sealed tracker tokens and people's linked tracker and forge tokens from `internal_state`, once the pinned Ploeg serves the reads
- [ ] 10.3 Remove the legacy adapters in `src/task-providers` and `src/link-providers` and the GitHub App reader `github-app.ts` for installations whose Ploeg serves the reads; the demo keeps answering from fixtures
- [ ] 10.4 **[owner]** Register the hosted offer's ClickUp OAuth app, configured in Ploeg (Ploeg ADR-0195)

## 11. S11 Move sources and repositories between projects

- [ ] 11.1 Move a source to another Client Project; add and remove Repository Grants; Work Items keep their origin's project

## 12. Every slice

- [ ] 12.1 `mise run verify` and `mise run docs-check`, output in the pull request
- [ ] 12.2 `python3 scripts/validate_adr_consistency.py .` when a record changes
- [ ] 12.3 **[owner]** Turn each slice on in a deployment through the cluster repository
