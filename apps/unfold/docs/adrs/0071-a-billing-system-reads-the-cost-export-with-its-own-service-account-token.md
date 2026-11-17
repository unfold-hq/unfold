---
status: proposed
date: 2026-11-17
decision-makers: Ryan Grippeling
review-by: 2027-02-28
---

# A billing system reads the cost export with its own service account token

## Context and Problem Statement

The FOCUS cost export (`GET /api/ploeg/cost-export`, [ADR 0060](0060-the-focus-cost-export-writes-parquet-through-hyparquet-writer.md), [ADR 0069](0069-linked-session-cost-is-billing-input-recorded-as-an-estimate-at-api-list-prices.md)) is the input an agency's billing runs on. Until now only a person could fetch it: an operator or administrator signed in through the browser, or with an editor credential that acts as that person. An organisation's own billing system, a job that runs every night or every month, had to borrow a person's credential. That credential expires, leaves with the person, and makes the audit say a person read the cost when a machine did.

On 2026-11-17 the owner approved the goal: the billing system reads the export as a machine, without a person's credential and without a secret anyone has to create, store or rotate. Unfold runs on Kubernetes, and so, in the deployments this is for, does the billing job. How does the job prove itself, and what may it read?

## Decision Drivers

* No person's credential, and no static secret to seed, store or rotate.
* The machine reads the export and nothing else: no other route, no change.
* It reads only the Tenant and the Teams it is configured for, whether or not `tenancy.enforce` is on.
* The audit names the machine, never a person.
* Reuse what Unfold already trusts. Warm pool pods already prove themselves with a projected service account token checked by TokenReview ([ADR 0013](0013-sandbox-crd-placement-with-warm-kata-pools.md)).
* Least machinery: no new store, no new token issuer, no new dependency.

## Considered Options

* **A configured reader proves itself with a projected Kubernetes service account token, checked by TokenReview for its audience and exact service account**
* A static bearer token per reader, configured as an environment variable
* An OAuth client credentials grant at the identity provider
* An editor credential issued to a service person

## Decision Outcome

Chosen option: "**projected service account token, checked by TokenReview**", because Kubernetes already issues, binds and rotates the token, the API server already checks it, and nothing secret has to be created or stored by anyone.

1. **Configuration.** `costExportReaders` lists readers, each `{ id, serviceAccount: "<namespace>/<name>", audience, tenant, teams[] }`. `id` and `serviceAccount` are unique, `audience` is never `unfold-relay` (the warm pool's), and `teams` lists one to fifty Ploeg Teams, within `ploeg.teams` when that is set. A non-empty list needs live mode and a real Ploeg connection.
2. **Proof.** A request with `Authorization: Bearer <JWT>` to an `/api/` route (not the relay) is sent to the API server as one TokenReview with the configured audiences. It proves a reader only when the API server answers `authenticated: true`, the token's audiences include that reader's audience, and the username is exactly `system:serviceaccount:<namespace>:<name>` of that reader. A token for another audience, another service account, an expired one, or a review that fails proves nothing and the request is unauthenticated: 401. Unfold keeps no token.
3. **Principal.** A proven reader acts as `reader:<id>`: no person, role Viewer, a Viewer membership of its own Tenant only. Its Teams are granted to that principal in Ploeg's team scope when the server starts; a person's id cannot collide with it, because `ploeg.userTeams` keys have no colon.
4. **Route.** A reader reaches `GET /api/ploeg/cost-export` and nothing else. Any other `/api/` route answers 403 `reader_route` before it runs. Endpoints that take no Unfold sign-in (MCP, SCIM, webhooks, sign-in, the relay) refuse its token like any unknown credential.
5. **Scope.** The export a reader gets has the rows of its Teams whose Work Item belongs to its Tenant, judged by the Work Item's owner even while `tenancy.enforce` is off. The export's `tenant` and `client` filters can narrow that further, never widen it.
6. **Rate limit and audit.** The reader counts against the `export` limit as `user:reader:<id>`, and the audit records the download with the actor `reader:<id>`.
7. **Helm chart.** When `config.costExportReaders` is not empty, the chart binds a ClusterRole that allows `tokenreviews` `create` to the workbench's service account, as it does for a warm pool; otherwise it grants nothing new. The demo refuses the list.
8. **Static bearer variant.** Not built. It would need a secret to seed and rotate, which the goal excludes.

### Consequences

* Good, because no person's credential and no static secret is involved: the kubelet issues and rotates the token, and the API server checks it.
* Good, because the reader reaches one route and one Tenant's Teams, and the audit names it.
* Good, because it reuses the TokenReview pattern Unfold already runs for warm pools, with no new dependency or store.
* Bad, because it works only for a reader in the same Kubernetes cluster as the workbench, or one whose tokens that cluster's API server accepts. A billing system elsewhere still needs a person's credential. Accepted for now; re-evaluate when a reader outside the cluster is asked for.
* Bad, because the workbench's service account may create TokenReviews cluster-wide once a reader is configured. A TokenReview reveals only who a presented token belongs to, and the chart grants it only then.
* Bad, because every request with a bearer JWT costs one TokenReview while readers are configured, including a stray token sent to another route. Unfold does not cache reviews; a billing job calls rarely.

### Confirmation

* `npm test` in `apps/unfold`: `test/cost-export-readers.test.ts` (configuration refuses a loose service account, the warm pool audience, a demo or Ploeg-less install and Teams outside `ploeg.teams`; a token proves a reader only for its audience and exact service account; a non-JWT bearer is never reviewed and a failing review proves nothing; over HTTP the reader gets only its Tenant's rows of its Teams while an administrator gets all, a token for another service account, another audience, an expired or an unknown one answers 401, and every other route answers 403 `reader_route`; the audit names `reader:billing`; the chart renders the TokenReview grant only with a reader and refuses one in demo mode); `test/openapi.test.ts` checks that exactly the operations a reader reaches list `costExportReader`.
* The key guards were mutation-checked when written: dropping the username match, the audience match, the 403 on other routes, the Tenant limit, the Teams grant, the `authenticated` check, the chart condition, the Viewer exception on the export, the principal's identity check, the warm pool audience refusal, the `Auth` hook or the chart's demo refusal each makes a test fail.
* Not verified on a cluster: no billing job has fetched the export through a real API server's TokenReview yet.

## Pros and Cons of the Options

### A static bearer token per reader

* Good, because it works from anywhere, inside or outside the cluster.
* Bad, because someone must create, store and rotate it, which the goal excludes.

### OAuth client credentials at the identity provider

* Good, because it works outside the cluster and the identity provider manages the client.
* Bad, because Unfold would have to accept a second kind of access token and map a client to a Tenant and Teams, and a client secret still has to be seeded.

### An editor credential for a service person

* Good, because it needs no code.
* Bad, because it is a person in the audit, must be renewed by its person at least every ninety days, and reaches everything that person may do.

## More Information

* How-to: [Read the export from a billing system](../operations/focus-cost-export.md#read-the-export-from-a-billing-system); contract: [HTTP contract](../contracts/api.md), [OpenAPI](../contracts/openapi.yaml) security scheme `costExportReader`, error `reader_route` in [Error codes](../contracts/error-codes.md); code: [`src/cost-export-readers.ts`](../../src/cost-export-readers.ts).
* Amends [ADR 0060](0060-the-focus-cost-export-writes-parquet-through-hyparquet-writer.md) and [ADR 0069](0069-linked-session-cost-is-billing-input-recorded-as-an-estimate-at-api-list-prices.md), which let only operators and administrators export cost: a configured reader now may too, within its Tenant and Teams.
* Re-evaluate when a billing system outside the cluster needs the export, or when Ploeg issues its own machine identities.
* 2026-11-17: proposed with its implementation, after the owner approved the goal.
