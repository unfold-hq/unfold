---
status: accepted
date: 2026-11-16
decision-makers: Ryan Grippeling
review-by: 2027-02-16
---

# Unfold names identifiers that do not resolve with tag URIs on unfoldhq.dev

## Context and Problem Statement

[ADR-0066](0066-unfold-identifies-its-published-schemas-by-their-address-on-docs-unfoldhq-dev.md) gives every contract schema in `docs/contracts/` its address on `docs.unfoldhq.dev`. Some identifiers Unfold mints name something that has no fixed document to serve. The tenant export ([leaving Unfold](../operations/leaving-unfold.md)) writes one JSON Schema per entity into the bundle, and [`src/tenant-export.ts`](../../src/tenant-export.ts) builds each table entity's schema from that installation's database columns at export time, so two installations on different versions write different schemas under the same identifier version. Each schema's `$id` was `urn:webgrip:unfold:tenant-export:<entity>:<version>`, which names a previous owner and claims a URN namespace that nobody registered.

Unfold also uses other names from the previous owner on surfaces outside the repository: label and annotation keys, metadata keys and attestation types. The owner asked on 2026-11-16 to move those that can move safely and to propose a migration for those that running installations depend on, and approved that migration the same day.

## Decision Drivers

* An identifier names a domain Unfold holds, so Unfold alone decides what it means.
* An identifier that cannot resolve does not pretend to be an address.
* Standard syntax that validators and registries accept as a URI.
* Bundles already exported stay readable.

## Considered Options

* A tag URI on `unfoldhq.dev` ([RFC 4151](https://www.rfc-editor.org/rfc/rfc4151)) (chosen)
* `urn:unfold:…`
* An `https` address on `docs.unfoldhq.dev`, as in ADR-0066

## Decision Outcome

Chosen option: **a tag URI on `unfoldhq.dev`**. A tag URI is the standard form for an identifier that a domain holder mints and that is never meant to be fetched. Its authority and date say who minted it and when that party held the name, so it needs no registry and does not move when a site does.

* **Rule.** An identifier Unfold mints for something with no fixed document to serve is `tag:unfoldhq.dev,2026-11-16:<kind>:<name>:<version>`. An identifier for a document Unfold publishes follows ADR-0066. The date is the day this rule was made, and it stays the same for later identifiers, because the tag only has to name a day on which Unfold held `unfoldhq.dev`.
* **Tenant export.** Each entity schema's `$id` is `tag:unfoldhq.dev,2026-11-16:tenant-export:<entity>:<schemaVersion>`, for example `tag:unfoldhq.dev,2026-11-16:tenant-export:users:1`. The schema version and the bundle's `formatVersion` stay `1`: the fields, the layout and the manifest are unchanged, and the manifest points at each schema by its file, not by its `$id`.
* **Reading old bundles.** Unfold has no import of a tenant export, so there is no reader to keep the old prefix in. A bundle made before this change keeps `urn:webgrip:unfold:tenant-export:…`. The [leaving Unfold guide](../operations/leaving-unfold.md) says so, and that a tool which keys schemas by `$id` should accept both. An importer, when it is built, accepts both prefixes.
* **Other identifiers.** The names that running installations or signed records depend on move in two releases with an upgrade note, [Move to Unfold's own keys](../operations/unfold-owned-keys.md); [Migrations](#migrations) lists them. A Kubernetes key uses the domain as its prefix (`unfoldhq.dev/<name>`), as Kubernetes recommends; a Docker label or `_meta` key uses reverse-DNS order (`dev.unfoldhq.unfold`), as Docker and the existing `_meta` keys do. A signed predicate type that names a document follows ADR-0066.

### Consequences

* Good, because the identifier names a domain Unfold holds and does not suggest an address that would answer.
* Good, because no installation has to change: nothing in Unfold reads these `$id`s.
* Bad, because a consumer that matched the old `urn:` string must accept the new one; the guide records the date of the change.
* Bad, because anything outside Unfold that selects or reads an old label, annotation or `_meta` key, such as an admission exception for verifier Pods, must move to the new key before release 2.
* Bad, because for one release every migrated label and `_meta` value is sent twice.
* Neutral, because a tag URI is longer than the URN it replaces.

### Confirmation

* `node --test test/tenant-export.test.ts` checks that every entity schema in an export carries its tag URI with the entity's name and schema version.
* `node --test test/delivery-kubernetes-verifier.test.ts` checks that verifier Pods carry every label and annotation under both prefixes, that a deny-all policy on either network key isolates them, and that the chart renders one deny-all policy per key.
* `node --test test/runtime-docker.test.ts test/delivery.test.ts` checks that workspace and verifier containers carry every Docker label under both prefixes.
* `node --test test/ahp-automations.test.ts test/ahp-customizations.test.ts test/ahp-progress.test.ts test/ahp-chat.test.ts` checks that Agent Host Protocol messages carry Unfold's facts under both `_meta` keys.
* `node --test test/attestations.test.ts` checks that a new candidate's predicate type is the address of its schema and the predicate validates against it, that the trace carries both metadata keys, and that `scripts/verify-candidate.mjs` accepts both predicate types and refuses another.

## Migrations

These identifiers carried the previous owner's name. Release 1 writes both names; release 2, a follow-up, writes only the new one. A step that changes desired state in production happens in the cluster's own repository.

| Identifier | Where it is produced | Who depends on it | Release 1 (built) | Release 2 (follow-up) |
| --- | --- | --- | --- | --- |
| Label and annotation keys `dev.webgrip.unfold/network`, `/purpose`, `/candidate`, `/policy`, `/check` | Verifier Pods and the deny-all NetworkPolicy ([`src/delivery-kubernetes-verifier.ts`](../../src/delivery-kubernetes-verifier.ts), [`templates/delivery-verifier.yaml`](../../ops/helm/unfold/templates/delivery-verifier.yaml)) | The NetworkPolicy selector, the verifier's own isolation check (`networkIsolated`), and a cluster admission exception that matches verifier Pods by `dev.webgrip.unfold/network: none` | Pods carry each label and annotation under both the old key and `unfoldhq.dev/<name>`. The chart adds `unfold-verifier-isolated`, a deny-all policy on `unfoldhq.dev/network`, beside `unfold-verifier-deny-all`. `networkIsolated` accepts a policy on either key, because the Pods carry both. The cluster's exception then moves to the new key. | Drop the old keys and `unfold-verifier-deny-all`. |
| Docker labels `dev.webgrip.unfold/session`, `/repository`, `/purpose`, `/transport`, and on verifier containers `/purpose`, `/candidate`, `/policy` | Workspace containers ([`src/runtime/docker.ts`](../../src/runtime/docker.ts)), verifier containers ([`src/delivery-verifier.ts`](../../src/delivery-verifier.ts)) | People and scripts that filter containers by label; nothing in Unfold reads them, because it finds its containers by name | Each label under both the old key and `dev.unfoldhq.unfold/<name>`. The verifier containers use the Docker prefix, not the Kubernetes one this table first proposed for them, so every Docker label Unfold writes has one prefix. | The new keys alone. |
| `_meta` key `dev.webgrip.unfold` | Agent Host Protocol messages ([`src/ahp/host.ts`](../../src/ahp/host.ts), `chats.ts`, `customizations.ts`, `automations.ts`) | Agent Host Protocol clients outside this repository, such as an editor; Unfold reads no client's copy | The same facts under both keys. | `dev.unfoldhq.unfold` alone. |
| Predicate type `https://webgrip.dev/attestations/agent-candidate/v1` | Signed candidate attestations ([`src/attestations.ts`](../../src/attestations.ts)) | Verifiers that pass `--type` or match the type, such as CI that refuses an unverified patch ([ADR-0014](0014-signed-candidates.md)); attestations already signed cannot change | New candidates carry version 2, `https://docs.unfoldhq.dev/unfold/contracts/agent-candidate.v2.schema.json`, the address of [a schema that describes the predicate](../contracts/agent-candidate.v2.schema.json). Version 2 names the Team `team` instead of `crew` ([HTTP contract](../contracts/api.md)). `scripts/verify-candidate.mjs` accepts both types. | Nothing: verifiers keep accepting version 1 for as long as they check candidates signed with it. |
| Trace metadata key `dev.webgrip.unfold` | Agent Trace records ([`src/attestations.ts`](../../src/attestations.ts)) | Tools that read the trace | The same metadata under both keys. | `dev.unfoldhq.unfold` alone. |
| SLSA `buildType` `https://webgrip.dev/attestations/unfold-vsix-build/v1` | The editor extension's provenance ([`scripts/sign_extension_asset.py`](../../../../scripts/sign_extension_asset.py)) | Nothing in this repository; a person reading the provenance | Not moved: it moves with the release workflow changes, to an Unfold address that describes the build. | |
| OCI label `org.opencontainers.image.source` `https://github.com/webgrip/unfold` | The defaults in [`Dockerfile`](../../Dockerfile) and [`ops/agent/Dockerfile`](../../ops/agent/Dockerfile) | Nothing for a released image: the release workflow sets its own value | The defaults are `https://github.com/unfold-hq/unfold`. | |

Ploeg's label `ploeg.webgrip.dev/component`, which the chart's Ploeg NetworkPolicy selects on, belongs to Ploeg and changes upstream.

## Pros and Cons of the Options

### `urn:unfold:…`

* Good, because it is short and reads like the identifier it replaces.
* Bad, because `unfold` is not a registered URN namespace, so Unfold would claim a name it does not hold, which is how the old identifier went wrong.

### An `https` address on `docs.unfoldhq.dev`

* Good, because it would resolve if a document were served there.
* Bad, because there is no single document to serve: each installation writes its own schema from its own database, so a fetched schema could disagree with the one in a bundle.

## More Information

* [System ADR-0050](../../../../docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md): a Tenant leaves with its data in open formats.
* Revisit when Unfold builds an import of a tenant export, or registers its schemas in a schema registry.
* 2026-11-16 — Proposed with its implementation for the tenant export; the owner asked to move the remaining identifiers that name the previous owner.
* 2026-11-16 — Accepted. The owner approved the migration plan, and release 1 was built: both names for label, annotation and `_meta` keys, the version 2 predicate type, and the OCI source default. Release 2, which drops the old keys and the old NetworkPolicy, is a follow-up.
