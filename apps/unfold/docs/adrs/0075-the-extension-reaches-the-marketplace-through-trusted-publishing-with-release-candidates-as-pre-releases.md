---
status: accepted
date: 2026-11-19
decision-makers: Ryan Grippeling
review-by: 2027-05-19
---

# The extension reaches the Visual Studio Marketplace through Trusted Publishing, with release candidates as pre-releases

## Context and Problem Statement

[ADR 0021](0021-the-extension-ships-through-open-vsx-first.md) sent every release to Open VSX and only a stable `X.Y.Z` to the Visual Studio Marketplace, behind a personal access token or an Entra managed identity. Neither ever existed, and every Unfold release is a `0.x.y-rc.N` candidate, so the Marketplace step skipped on every release and plain VS Code users, most of the people who use the extension, had to sideload each VSIX by hand without updates.

Two facts changed. The Marketplace now offers Trusted Publishing for GitHub Actions: a policy on the publisher names the repository and workflow, and `vsce publish --oidc` trades the job's OIDC token for a short-lived publish credential, with no Azure subscription and no stored token. And the publisher `unfold-hq` exists on the Marketplace, so the id matches Open VSX.

The Marketplace still accepts only `major.minor.patch`, so a candidate needs a Marketplace version of its own.

## Decision Drivers

* Plain VS Code users get updates from the registry their editor uses.
* No stored registry credential, the same as Open VSX.
* People choose the channel: the release channel never receives a candidate.
* A Marketplace version is unique, rises with every candidate and never takes a number a later stable version needs.
* What the Marketplace serves can be tied back to the signed release.

## Considered Options

* Only stable versions on the Marketplace (ADR 0021)
* Every candidate as a Marketplace pre-release under a derived version
* Calendar versions for the whole product, which the Marketplace would accept as they are

## Decision Outcome

Chosen option: "Every candidate as a Marketplace pre-release under a derived version", because it reaches plain VS Code users now without changing the product's version scheme.

1. **Version rule.** [`scripts/marketplace_version.py`](../../../../scripts/marketplace_version.py) maps `X.Y.Z-rc.N` to `X.Y.((Z+1)×10000+N)`: `0.4.0-rc.152` becomes `0.4.10152`, `0.4.1-rc.3` becomes `0.4.20003`. A stable `X.Y.Z` stays as it is. A stable patch below 10000 can never meet a candidate, every later candidate sorts higher, and a candidate number of 10000 or more is refused.
2. **A second VSIX.** For a candidate the extension job packages `unfold-marketplace-<marketplace version>.vsix` with `--pre-release` from the same tagged tree, verifies it, signs it keyless, attests it and attaches it with its checksum and bundle to the draft release, next to `unfold-<version>.vsix`. A rerun reuses both from the release.
3. **Publication.** The job publishes that VSIX with `vsce publish --oidc`, after Open VSX. The policy on the `unfold-hq` publisher names `unfold-hq/unfold` and `on_release_published.yml`. No `VSCE_PAT` or Entra secret is used.
4. **Verification.** `scripts/publish_release.py` waits until the Marketplace lists the derived version as validated, checks its pre-release flag, and compares the downloaded VSIX byte for byte with the attached one, as it does for Open VSX. The evidence file records it under `marketplace`.
5. **Preflight.** The release preview fails when the Marketplace has no `unfold-hq` publisher.

### Consequences

* Good, because a plain VS Code user installs `unfold-hq.unfold` from the Extensions view and gets every candidate after choosing **Switch to Pre-Release Version**, and only stable versions otherwise.
* Good, because no registry credential is stored anywhere, and deleting the policy stops publication.
* Bad, because the version VS Code shows for a candidate (`0.4.10152`) differs from the release (`0.4.0-rc.152`); the release carries both VSIXes, each named by its own version.
* Bad, because a candidate is packaged twice, so the Marketplace VSIX is a second signed artifact rather than the same bytes as the Open VSX one.
* Bad, because a Marketplace outage now fails the extension job and keeps the release a draft, as an Open VSX outage already did.

### Confirmation

`scripts/test_release_distribution.py` proves the rule is unique, rising and clear of every stable patch below 10000, and that the distributor waits for validation and compares bytes. `scripts/github-workflow-policy.test.cjs` fails when the Marketplace step loses `--oidc`, names a Marketplace secret, or publishes before Open VSX. The first candidate after the merge must show `0.4.1xxxx` on the Marketplace as a pre-release, and `release-artifacts-unfold.json` must carry its digest.

## Pros and Cons of the Options

### Only stable versions on the Marketplace

* Good, because one VSIX per release and one version number.
* Bad, because nothing reaches the Marketplace until the first stable release from `main`.

### Calendar versions for the whole product

* Good, because a version such as `2026.11.152` needs no mapping on any registry.
* Bad, because it changes semantic-release, the images, the chart and the Ploeg pin together; that is a product decision of its own, not a registry detail.

## More Information

[Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) documents Trusted Publishing, pre-releases and the version format. The Marketplace serves the uploaded VSIX unchanged: on 2026-11-19 the `rust-lang.rust-analyzer` 0.3.3121 `linux-x64` download matched the GitHub release asset byte for byte. Whether Trusted Publishing creates a new extension on its first publish was not checked before this decision; `vsce` calls the create endpoint when the extension does not exist yet.

Reconsider when the product moves to calendar versions, a candidate number nears 10000, or the Marketplace accepts pre-release suffixes.
