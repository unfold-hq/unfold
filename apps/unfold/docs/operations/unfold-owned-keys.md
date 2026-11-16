---
type: how-to
audience: [owner, operator, integrator]
owner: unfold
last_verified: 2026-11-16
verified_by: "Written with release 1 of the migration: src/unfold-keys.ts and its callers; test/delivery-kubernetes-verifier.test.ts (both label prefixes, either deny-all policy, the chart's two policies), test/runtime-docker.test.ts, test/delivery.test.ts, the AHP tests and test/attestations.test.ts passed. Not checked: a live cluster, a real Docker engine, or cosign against a version 2 candidate."
---

# Move to Unfold's own keys

Unfold labels the Pods and containers it creates, tags the messages it sends and types the statements it signs. Those names carried the previous owner's domain. [ADR-0067](../adrs/0067-unfold-names-identifiers-that-do-not-resolve-with-tag-uris-on-unfoldhq-dev.md) moves them to names on `unfoldhq.dev` in two releases:

1. **This release** writes every label, annotation and `_meta` key under both the retiring name and the new one, with the same value, and signs new candidates with the new predicate type. Nothing you run today stops matching.
2. **The next release** writes only the new names and removes the chart's NetworkPolicy on the retiring label.

Anything outside Unfold that selects or reads a retiring name must move to the new name **before you upgrade to the next release**. Until then both work.

## What changes

| What | Retiring name | New name | Who reads it | What to change |
| --- | --- | --- | --- | --- |
| Verifier Pod labels | `dev.webgrip.unfold/network`, `/purpose`, `/candidate` | `unfoldhq.dev/network`, `/purpose`, `/candidate` | The chart's deny-all NetworkPolicies, the verifier's own isolation check, and any admission policy or exception that matches verifier Pods | Select `unfoldhq.dev/network: none` instead of `dev.webgrip.unfold/network: none` |
| Verifier Pod annotations | `dev.webgrip.unfold/policy`, `/check` | `unfoldhq.dev/policy`, `/check` | Nothing in Unfold | Read the new key |
| Verifier NetworkPolicy | `unfold-verifier-deny-all`, selecting the retiring label | `unfold-verifier-isolated`, selecting `unfoldhq.dev/network: none` | The verifier, before each verification | A policy you manage yourself instead of the chart's selects the new label |
| Docker labels on workspace containers | `dev.webgrip.unfold/session`, `/repository`, `/purpose`, `/transport` | `dev.unfoldhq.unfold/session`, `/repository`, `/purpose`, `/transport` | People and scripts that filter containers, such as `docker ps --filter label=…` | Filter on the new key |
| Docker labels on verifier containers | `dev.webgrip.unfold/purpose`, `/candidate`, `/policy` | `dev.unfoldhq.unfold/purpose`, `/candidate`, `/policy` | Same | Filter on the new key |
| Agent Host Protocol `_meta` key | `dev.webgrip.unfold` | `dev.unfoldhq.unfold` | Agent host clients that show Unfold's own facts | Read the new key |
| Agent Trace metadata key | `dev.webgrip.unfold` | `dev.unfoldhq.unfold` | Tools that read `candidate.trace.json` | Read the new key |
| Candidate provenance predicate type | `https://webgrip.dev/attestations/agent-candidate/v1` | `https://docs.unfoldhq.dev/unfold/contracts/agent-candidate.v2.schema.json` | Verifiers that pass `--type` or match the type | Accept both, see below |
| OCI `org.opencontainers.image.source` default | `https://github.com/webgrip/unfold` | `https://github.com/unfold-hq/unfold` | Only a locally built image; the release workflow sets its own value | Nothing |

Kubernetes keys use the domain as their prefix (`unfoldhq.dev/`), as Kubernetes recommends. Docker labels and `_meta` keys use reverse-DNS order (`dev.unfoldhq.unfold`), as Docker and the existing `_meta` keys do.

## Signed candidates keep their type

A signed statement cannot change, so a candidate signed by an earlier release keeps the first predicate type and names the session's Team `crew`. Candidates signed from this release on carry version 2, whose predicate names the Team `team` and whose type is the address of [its schema](../contracts/agent-candidate.v2.schema.json). The predicate type does not lose its old value in the next release: a verifier that checks old candidates accepts both types for as long as it checks them. `node scripts/verify-candidate.mjs` accepts both and refuses any other ([verifying a candidate](live.md#verifying-a-candidate)).

## Check before the next release

* `kubectl get networkpolicy -n unfold-verifier` lists `unfold-verifier-isolated`.
* No NetworkPolicy you manage selects `dev.webgrip.unfold/…`: `kubectl get networkpolicies -A -o yaml | grep dev.webgrip.unfold` finds only the chart's `unfold-verifier-deny-all`. Search your admission controller's policies and exceptions the same way, and the repository that holds your cluster's desired state.
* No script or dashboard filters containers or reads `_meta` by `dev.webgrip.unfold`.
* A verifier that passes `cosign verify-blob-attestation --type` passes the version 2 type for new candidates.
