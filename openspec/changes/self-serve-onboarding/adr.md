# ADR Review Manifest

## ADR Review Completed

- **Date**: 2026-11-17
- **Reviewer**: Claude (session with Ryan Grippeling)
- **Change**: `self-serve-onboarding`

## Accepted Records Reviewed

- `docs/adr/adr-0002-ploeg-is-the-only-engine.md` — Ploeg registers repositories, binds boards and runs the readiness Work Item; Unfold never routes.
- `docs/adr/adr-0005-unfold-is-offered-to-agencies.md` — never an account without a hard Budget; the Team spend-cap gate before the first onboarding spend.
- `docs/adr/adr-0006-the-ticket-is-the-billing-unit.md` — read and set aside: its €100 is the Agency Budget for metered usage, in EUR, not the cap that bounds a Run. The cap the onboarding confirms is the Ploeg Team's `spendCap`, which Ploeg's chart defaults to `{usd: 20, period: day}` (Ploeg ADR-0162 rule 6).
- `docs/adr/adr-0009-one-tenant-per-agency.md` — out of scope; design.md section 10 says where it attaches.
- `docs/adr/adr-0017-a-tenant-sits-above-teams-and-bounds-what-users-sources-and-budgets-reach.md` — Tenant on every new table, 404 outside it.
- `docs/adr/adr-0023-unfold-measures-happiness-and-confusion-with-first-party-events-surveys-and-bug-reports.md` — time to first pull request as product events.
- `docs/adr/adr-0039-unfold-depends-on-a-released-ploeg-through-its-contract-bundle-and-go-module.md` — every Ploeg need is a ploeg-hq change; nothing in `apps/ploeg` is edited.
- `docs/adr/adr-0044-unfold-refuses-a-ploeg-that-does-not-serve-the-contract-majors-it-requires.md` — the refuse-with-explanation state for steps Ploeg does not serve yet.
- `docs/adr/adr-0048-projects-share-accounts-and-repositories-within-a-tenant-and-a-work-item-has-one-origin.md` — Integration Account, source, repository, Repository Grant and Client Project; Own work is its Agency-own Client Project.
- `docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md` — rule 7 (one code base for hosted) and the tracker order.
- `docs/adr/adr-0058-people-sign-in-through-one-zitadel-broker-with-an-organisation-per-tenant.md` — out of scope; stage 0 attaches to it later.
- `docs/adr/adr-0033-unfold-plans-non-trivial-changes-as-openspec-changes.md` — the form of this change.

## Proposed Records Reviewed

- `docs/adr/adr-0047-unfold-describes-a-repository-with-the-ai-codebase-maturity-model-and-delivers-at-level-5.md` — the readiness pull request moves a repository to Level 2.
- `apps/unfold/docs/adrs/0064-people-add-tracker-connections-from-the-screen-and-unfold-keeps-them-with-an-encrypted-service-account-token.md` — saved connections and sources, configuration wins; its sealed token copy is kept as a named exception; its open questions 2 and 5 are answered by ADR-0059.
- `apps/unfold/docs/adrs/0063-unfold-reaches-ploeg-and-trackers-through-ports-with-interchangeable-adapters.md` — decision 5 and step T5: one Connection per origin, which `integration_accounts` implements (application ADR-0064 is its first slice).
- Ploeg [ADR-0184](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md), [ADR-0186](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0186-an-operator-consumer-binds-a-tracker-scope-to-a-team-at-runtime-and-static-routing-wins-on-conflict.md), [ADR-0192](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md), [ADR-0193](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0193-a-proven-operator-registers-a-work-target-at-runtime-only-for-a-repository-ploegs-forge-connection-was-granted.md) (runtime Work Target registration) and [ADR-0194](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0194-a-repository-missing-only-its-instruction-file-may-receive-one-run-that-adds-it.md) (prepare-repository Run), all merged on ploeg-hq/ploeg `development` as proposed — the upstream contracts the slices wait for. ADR-0184, 0186, 0193 and 0194 each have a proposed amendment (ploeg-hq/ploeg follow-up PR).
- `apps/ploeg/docs/adrs/0162-a-team-spends-at-most-its-cap-per-period-and-a-claim-over-it-starts-nothing.md` — the Team spend cap, `null` in the Teams read when a Team has none.

## Records Created

- `docs/adr/adr-0059-an-organisation-connects-its-forge-and-tracker-from-unfold-and-ploeg-learns-its-repositories-and-boards-at-runtime.md` — the onboarding journey over Ploeg's runtime operator API, credential custody with two named self-hosted exceptions, Own work, the readiness pull request and the time-to-first-pull-request measure. Proposed. Its index row is added. Numbers 0059 (system) were checked against `docs/adr/index.md` and the open pull requests of unfold-hq/unfold on 2026-11-17.

## Supersessions

- none. ADR-0059 replaces the *proposed direction* 6 of [Connect a repository](../../../docs/concepts/connect-a-repository.md#direction-6-connect-credentials-from-unfold) (Unfold writes credentials to OpenBao), which was never a record.

## Validation

```sh
$ python3 scripts/validate_adr_consistency.py .
validate-adr-consistency: OK (59 record(s) in docs/adr, registry-checked)
```

## Notes

- ADR-0059 is proposed. Its Confirmation asks for a timed trial under 15 minutes before it is accepted.
- Five upstream asks follow from the call order (design.md section 4): the connection's own account as hand-over agent (ADR-0186 amendment); a connection contract, covering OAuth code, manifest code, installation id and pasted token, list, state, replace, delete and `state` issuance (ADR-0184 amendment, whose rule 1 also allows a paste where the installation has no vendor OAuth app); store-backed connections in `trackerBindings.connections` (ADR-0186 amendment); an onboarding values profile; and active forges per installation in `/operator/connections`. The GitHub forge receiver for `installation` and `installation_repositories` events, verified with the store-held webhook secret, is part of the ADR-0193 amendment.
- 2026-11-17 review: ADR-0059 and the change were corrected after an independent review (two clocks, journey order, `prepareAvailable`, no estimate, install prerequisites, D8 moved to S9, ADR-0192 detection, spend cap, OAuth `state`, onboarding trigger, Integration Account key). The ADR-0063 citation above was checked and is right: "one Connection per origin" is application ADR-0063 decision 5, step T5.
