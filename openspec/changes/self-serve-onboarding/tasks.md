# Tasks — self-serve-onboarding

Owner-only tasks are marked **[owner]**. Each slice is one pull request and
ends with `mise run verify` (and `mise run docs-check` when docs changed),
output pasted in the pull request.

## 0. Decisions and upstream

- [ ] 0.1 **[owner]** Review ADR-0059 and this change; answer design.md Open Questions 1 to 4
- [ ] 0.2 **[owner]** Sign or amend Ploeg ADR-0184 and ADR-0186 in ploeg-hq
- [ ] 0.3 Draft, in ploeg-hq's words, the two amendments of design.md section 4: the connection's own account as hand-over agent (ADR-0186) and the manifest code and installation id as ADR-0184 grants
- [ ] 0.4 **[owner]** Sign Ploeg ADR-0192, ADR-0193 and ADR-0194 (ploeg-hq/ploeg#420, #421)
- [ ] 0.5 Open the tickets for S1 to S11, each naming the Ploeg change it waits for

## 1. S1 Checklist backbone

- [ ] 1.1 Settings → Connections renders the stage lines and the board and repository lines with a fix action per non-green line
- [ ] 1.2 An Admin of a Tenant with no Integration Account lands on Connections after sign-in; others see the lines read-only
- [ ] 1.3 Configured entries shown as "Configured by the installation" from Ploeg's connections read
- [ ] 1.4 Rewrite the Tasks page "How connections work" dialog for the screen flow
- [ ] 1.5 Product events `onboarding.started`, `step_completed`, `step_failed`, `step_refused`, `first_pr_opened`; store test for no screen text
- [ ] 1.6 `ploeg_step_unavailable` refusal and the step-availability check from the version and read routes, recorded in `ploeg-expectations.json`; test that no write is sent
- [ ] 1.7 Docs: `docs/concepts/connect-a-repository.md` stage table and `apps/unfold/docs/operations/task-connections.md`

## 2. S2 Saved sources get their Ploeg target

- [ ] 2.1 `sync()` sets `ploeg.target` on a saved source from the static route that covers its List
- [ ] 2.2 Test: import from a saved source no longer answers `task_binding_unconfigured` (fails without the fix)

## 3. S3 Repositories and Own work in Unfold's store

- [ ] 3.1 Migration: `tracker_connections` to `integration_accounts` with `role`; `repositories`, `client_projects`, `repository_grants`; `client_project_id` on saved sources
- [ ] 3.2 Own work created on first use; projects hidden until a Client exists
- [ ] 3.3 Stored repositories join `config.repositories` after the configured ones; `shadowed` on a key clash
- [ ] 3.4 Tenant export classifies the new tables; OCSF records for each entity
- [ ] 3.5 Add Own work, Readiness Pull Request or any other new term to `docs/domain/model.yaml` and run `mise run domain`

## 4. S4 Connect GitHub and pick repositories

- [ ] 4.1 Manifest flow with a Ploeg-issued `state`, relay of the conversion code, callback checks
- [ ] 4.2 Installation relay and the reachable-repository picker
- [ ] 4.3 Runtime Work Target registration with dry run; repository stored and granted to Own work
- [ ] 4.4 Chart: optional read-only mount of the App key secret as `githubApp.privateKeyFile`; values schema
- [ ] 4.5 "Second forge" state until the pinned Ploeg serves ADR-0192
- [ ] 4.6 Redaction test: no code, key or token in any response, log, record, event or row
- [ ] 4.7 Move the Ploeg pin to the release with ADR-0184 grants and ADR-0193 (`ploeg`-scoped commit)

## 5. S5 Connect ClickUp and bind Lists

- [ ] 5.1 The member guide in plain words, from the ClickUp adapter's setup capability
- [ ] 5.2 Paste once: shape check, ClickUp accepts it, `connection_token_personal`, relay to Ploeg's store, ADR-0064 sealed copy kept (Open Question 1)
- [ ] 5.3 List picker and the map step: default repository, further repositories, Team
- [ ] 5.4 ADR-0186 dry run, create, `409 conflicts_with_static` shown as configured, idempotent retry, remove
- [ ] 5.5 Saved source takes the binding's target; removal drops it
- [ ] 5.6 Move the Ploeg pin to the release with ADR-0186 and ClickUp `ScopeProber`

## 6. S6 Budget gate

- [ ] 6.1 Read the Team's enforced Budget; Admin confirms it; `budget_missing` refusal for readiness and hand-off
- [ ] 6.2 **[owner]** Confirm the chart's default hard cap (ADR-0006's €100 a month) for self-hosted installs

## 7. S7 Readiness pull request

- [ ] 7.1 Offer only for a repository missing only `AGENTS.md`; estimate shown
- [ ] 7.2 Confirmation bound to the amount; re-ask on a changed estimate; one Work Item per repository on retry; cancel never restarts
- [ ] 7.3 After merge: re-read readiness, show Level 2 and the next Level 3 check (ADR-0047 part 4)
- [ ] 7.4 Move the Ploeg pin to the release with ADR-0194

## 8. S8 First task to first pull request, measured

- [ ] 8.1 Guided last step: assign to the Unfold member or hand off from Tasks
- [ ] 8.2 Time to first pull request p50 and p90 in Insights
- [ ] 8.3 End-to-end onboarding test against fakes of Ploeg, GitHub and ClickUp (ADR-0059 Confirmation)
- [ ] 8.4 **[owner]** Buy the ClickUp seat and create the GitHub organisation for the dogfood trial
- [ ] 8.5 **[owner]** Run the timed trial on a fresh installation; record the time; accept or amend ADR-0059

## 9. S9 GitHub Issues as the tracker

- [ ] 9.1 GitHub Issues setup capability with the same App; hand-off once Ploeg's team read reports GitHub logins

## 10. S10 Hardening before hosted

- [ ] 10.1 Unfold reads GitHub with short-lived tokens Ploeg mints; the key mount is removed
- [ ] 10.2 Unfold's ClickUp copy retired: service reads through Ploeg or people's own links, hand-off as a Ploeg action
- [ ] 10.3 **[owner]** Register Unfold's own ClickUp OAuth app for the hosted offer

## 11. S11 Move sources and repositories between projects

- [ ] 11.1 Move a source to another Client Project; add and remove Repository Grants; Work Items keep their origin's project

## 12. Every slice

- [ ] 12.1 `mise run verify` and `mise run docs-check`, output in the pull request
- [ ] 12.2 `python3 scripts/validate_adr_consistency.py .` when a record changes
- [ ] 12.3 **[owner]** Turn each slice on in a deployment through the cluster repository
