---
status: accepted
date: 2026-11-16
decision-makers: Ryan Grippeling
review-by: 2027-02-16
---

# Unfold identifies its published schemas by their address on docs.unfoldhq.dev

## Context and Problem Statement

Two of Unfold's contract schemas carry an `https` `$id`: [`cloudevent.v1.schema.json`](../contracts/cloudevent.v1.schema.json), the schema of every outbound event, and [`config.v1.schema.json`](../contracts/config.v1.schema.json), the schema of the configuration file. Both `$id`s were the raw-file address of the `development` branch on the previous forge. The CloudEvent `$id` is also on the wire: every event Unfold delivers carries it in `dataschema` ([`src/outbound/catalogue.ts`](../../src/outbound/catalogue.ts)), and the [configuration guide](../operations/configuration.md) tells people to put the configuration `$id` in their files as `$schema`.

[System ADR-0055](../../../../docs/adr/adr-0055-github-unfold-hq-is-the-project-home.md) moved Unfold to GitHub `unfold-hq/unfold`, and the previous forge is going away. An identifier on that forge stops resolving when it goes, and it names a host that Unfold does not own. The owner asked on 2026-11-16 to fix this as a versioned contract change.

The outbound events contract is versioned in the AsyncAPI document's `info.version` (`contractVersion` in [`src/outbound/contracts.ts`](../../src/outbound/contracts.ts)), which "changes only with the catalogue's meaning". No rule in the repository says whether a changed `$id` is breaking. The [CloudEvents specification](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md#dataschema) says only that incompatible changes to the schema should get a different `dataschema` URI. The outbound events shipped in release candidates from `unfold-v0.4.0-rc.126`, behind the off-by-default `events.webhooks` flag.

## Decision Drivers

* An identifier that resolves: a person or a validator that fetches the `$id` gets the schema.
* A host Unfold owns, under the `unfoldhq.dev` zone.
* No new publication machinery when an existing pipeline already serves the files.
* A move of the file must not silently break the identifier.
* Receivers that follow the contract keep working, and the change is visible in the contract version.

## Considered Options

* The path the documentation site already serves, `https://docs.unfoldhq.dev/unfold/contracts/<file>` (chosen)
* A dedicated path on the documentation site, such as `https://docs.unfoldhq.dev/schemas/<name>/v1.json`
* The marketing site, `https://unfoldhq.dev/schemas/<file>`
* A raw-file address on GitHub
* A URN that does not resolve

## Decision Outcome

Chosen option: **the path the documentation site already serves**. [The docs build](../../../../docs/operations/docs-publishing.md) copies every file under `apps/unfold/docs` to `unfold/` on the site, so `docs/contracts/cloudevent.v1.schema.json` is already published at `https://docs.unfoldhq.dev/unfold/contracts/cloudevent.v1.schema.json`. The docs workflow publishes on every documentation change to `development`, which is what the old branch address promised.

* **Identifiers.** An Unfold schema with an `https` `$id` uses `https://docs.unfoldhq.dev/unfold/contracts/<name>.v<major>.schema.json`, its own path on the site. Today that is:
  * `https://docs.unfoldhq.dev/unfold/contracts/cloudevent.v1.schema.json`
  * `https://docs.unfoldhq.dev/unfold/contracts/config.v1.schema.json`
* **`dataschema`** is the CloudEvent `$id` followed by `#/$defs/data/<type>`, for example `https://docs.unfoldhq.dev/unfold/contracts/cloudevent.v1.schema.json#/$defs/data/work_item.needs_you`.
* **Versions.** The file keeps `v1`: the schemas validate exactly what they validated before. The outbound events contract goes from `1.0.0` to `1.1.0`. A receiver that follows the schema keeps working, because `dataschema` is any URI there, but the value on the wire changed, which is more than a patch. A change to what a schema accepts that breaks a receiver gets a new major file (`cloudevent.v2.schema.json`) and a new `$id`; the `v1` file stays served beside it.
* **The guard.** [The output check](../../../../scripts/docs-output.py) fails when a schema whose `$id` is on `docs.unfoldhq.dev` is not at that path in the built site, or differs from its source. [The live check](../../../../scripts/docs-live.py) fetches each one at its `$id` path after every deploy, on staging and on production. Moving or renaming such a file fails the build instead of breaking the identifier.
* **No transition on the producer side.** Unfold sends one `dataschema` per event, so it cannot send both addresses. There is no reader of `dataschema` in this repository. The [outbound events guide](../operations/outbound-events.md) records the change with its date and tells receivers to route on `type`, which does not change.

### Consequences

* Good, because both identifiers are on a host Unfold owns, and the build that publishes the docs also publishes the schemas.
* Good, because the build and the deploy check that every published `$id` resolves to the file it names.
* Good, because the configuration schema's new `$id` reaches the generated [configuration guide](../operations/configuration.md) through `npm run config:build`.
* Bad, because the identifier contains the documentation layout (`unfold/contracts/`). Restructuring the docs must leave these files where they are; the output check enforces that.
* Bad, because a receiver that compares `dataschema` to the old string stops matching. It must accept the new address; the old address stops resolving when the previous forge goes.
* Bad, because `docs.unfoldhq.dev` was not answering on 2026-11-16 (Cloudflare 522), so the new identifiers resolve only after the first successful docs deploy.
* Neutral, because the Ploeg-shared schemas (`work-order.v1`, `event-envelope.v1`) and `card-theme.v1` keep their `urn:` identifiers. They are proposed or local contracts that nothing fetches, and renaming them is a separate change.

### Confirmation

* `node --test test/outbound-events.test.ts` proves the committed `cloudevent.v1.schema.json` and `events.asyncapi.yaml` match `src/outbound/catalogue.ts`, including the `$id` and `info.version`.
* `node scripts/config-reference.mjs --check`, which `npm run check` runs, proves the configuration guide shows the configuration `$id`.
* [`docs-output.test.py`](../../../../scripts/docs-output.test.py) and [`docs-live.test.py`](../../../../scripts/docs-live.test.py) prove the output and live checks reject a missing, stale or misplaced schema; `mise run docs-check` runs both and the output check on the real build.

## Pros and Cons of the Options

### A dedicated path on the documentation site

* Good, because the identifier does not depend on where the docs keep the file.
* Bad, because it needs a copy or redirect step in the docs build and a second rule for which files it copies, while the plain path is already served and the output check holds it in place.

### The marketing site

* Good, because `unfoldhq.dev` is the shortest Unfold host.
* Bad, because the site releases on its own `unfold-site-v…` train ([system ADR-0012](../../../../docs/adr/adr-0012-the-marketing-site-releases-and-deploys-on-its-own.md)), so a contract change would wait for a site release, and the site would need a copy step from `apps/unfold`.

### A raw-file address on GitHub

* Good, because it needs no publication at all.
* Bad, because the identifier names the forge again, which is how the old one ended up on a host Unfold no longer uses, and it serves `text/plain`.

### A URN that does not resolve

* Good, because it never moves.
* Bad, because an editor cannot fetch the configuration schema from a `$schema` URN, and a `dataschema` that does not resolve tells a receiver nothing.

## More Information

* [System ADR-0050](../../../../docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md): events leave Unfold as CloudEvents documented in AsyncAPI.
* Revisit when Unfold registers its schemas in a schema registry, or when the documentation site moves.
* 2026-11-16 — Proposed with its implementation; the owner asked for the move of the schema identifiers off the previous forge as a versioned contract change.
* 2026-11-16 — Accepted by the owner.
* 2026-11-16 — Scope extended by the owner to every Unfold contract schema: `card-theme.v1`, `event-envelope.v1` and `work-order.v1` move from their `urn:` identifiers to `https://docs.unfoldhq.dev/unfold/contracts/<file>`, so the output and live checks hold them too, and the neutral consequence about those `urn:` identifiers no longer applies. Each keeps `v1` because it validates exactly what it validated before. Nothing reads these `$id`s: a card theme refuses a `$schema` key, the [OpenAPI document](../contracts/openapi.yaml) refers to the card theme schema by its file, and the other two are a proposed and a superseded record that Ploeg does not use.
