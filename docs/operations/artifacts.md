---
type: reference
audience: [operator, contributor]
owner: unfold
last_verified: 2026-11-19
verified_by: "Visual Studio Marketplace parts updated on 2026-11-19 against .github/workflows/on_release_published.yml, scripts/marketplace_version.py, scripts/publish_release.py and scripts/release_preflight.py; no Marketplace publication observed yet. Rewritten on 2026-11-16 for the move to GitHub against .github/workflows/on_release_published.yml, scripts/publish_release.py, scripts/publish_chart.py, scripts/release_registry.py and scripts/release_preflight.py. Pre-move identities are from the 2026-10-03 audit record; no artifact was published from GitHub yet, so the GitHub identities are what the workflow publishes, not what a registry was seen to serve."
---

# Source mirrors and release artifacts

[GitHub `unfold-hq/unfold`](https://github.com/unfold-hq/unfold) owns source changes, versioning and publication ([ADR-0055](../adr/adr-0055-github-unfold-hq-is-the-project-home.md)). The repository was transferred from `webgrip/unfold`, so its tags and releases stayed and the old name redirects; every `refs/notes/*` ref was pushed to it on the cutover day. Forgejo keeps a one-way pull mirror, `webgrip/unfold-mirror`, and the old Forgejo repository is archived. Nothing in GitHub pushes to Forgejo or to any other Webgrip system; whoever needs an artifact pulls it.

Unfold releases under `unfold-v0.x.y-rc.N` tags ([ADR-0019](../adr/adr-0019-unfold-pins-ploeg-from-its-own-repository-and-releases-only-its-application.md)); every artifact below carries that version. Until `unfold-v0.4.0-rc.35` the same tags also published Ploeg ([ADR-0004](../adr/adr-0004-unfold-releases-one-version.md)). The imported `ploeg-v…` tags and the tags of the front end's former repository remain as history. The [publication workflow](../../.github/workflows/on_release_published.yml) builds each image once, for AMD64 and ARM64, straight into GHCR, holds it to its CVE budget with the [CVE gate](../../.github/actions/cve-gate/action.yml) and signs it keyless; nothing is copied between registries. A chart is packaged once, after every image of the release is pushed, with each image's digest as its default and the pinned Ploeg chart vendored ([publication](ci.md#publication)).

## Published identities

| Artifact | Published at | Signed by |
| --- | --- | --- |
| Unfold application | `ghcr.io/unfold-hq/unfold` | keyless cosign, with a CycloneDX SBOM and the CVE-budget verdict attested to the index, a CycloneDX SBOM attested to each platform image, and BuildKit provenance attached |
| Unfold workspace image | `ghcr.io/unfold-hq/unfold-agent` | as above |
| Unfold chart | `oci://ghcr.io/unfold-hq/charts/unfold` | keyless cosign |
| Editor extension | [Open VSX `unfold-hq.unfold`](https://open-vsx.org/extension/unfold-hq/unfold); the Visual Studio Marketplace once the extension's rename ends the pause in [application ADR 0075](../../apps/unfold/docs/adrs/0075-the-extension-reaches-the-marketplace-through-trusted-publishing-with-release-candidates-as-pre-releases.md); each VSIX, SHA-256 file and sigstore bundle on the [GitHub release](https://github.com/unfold-hq/unfold/releases) | keyless `cosign sign-blob`, plus a GitHub build-provenance attestation |

Use the bare application version as the image or chart tag. Prereleases never move `latest`. The chart defaults each image to the digest its job pushed and names `ghcr.io/unfold-hq` as their registry. The separate unattended `agent-runner` image is maintained outside Unfold.

Every signature names the workflow at the release tag: certificate identity `https://github.com/unfold-hq/unfold/.github/workflows/on_release_published.yml@refs/tags/unfold-v0.x.y-rc.N`, issuer `https://token.actions.githubusercontent.com`, logged in the public Rekor log. A cluster's admission policy checks that identity with the regular expression `^https://github\.com/unfold-hq/unfold/\.github/workflows/on_release_published\.yml@refs/tags/unfold-v0\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$`, which [`scripts/release_registry.py`](../../scripts/release_registry.py) also uses. Check a download with:

```sh
cosign verify --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/unfold-hq/unfold/\.github/workflows/on_release_published\.yml@refs/tags/unfold-v' \
  ghcr.io/unfold-hq/unfold:<version>
cosign verify-blob --bundle unfold-<version>.vsix.sigstore.json \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/unfold-hq/unfold/\.github/workflows/on_release_published\.yml@refs/tags/unfold-v' \
  unfold-<version>.vsix
gh attestation verify unfold-<version>.vsix --repo unfold-hq/unfold
```

There are currently no publishable npm or Composer packages: the application npm manifests are private, and no Composer package exists. A future library needs its own manifest, public API, version policy and consumer installation check. The Visual Studio Marketplace is to carry each `rc.N` version as a pre-release under a derived `major.minor.patch`; publication is paused until the extension is renamed ([application ADR 0075](../../apps/unfold/docs/adrs/0075-the-extension-reaches-the-marketplace-through-trusted-publishing-with-release-candidates-as-pre-releases.md)).

## Versions published before the move

Versions published before the cutover stay where they were: the images and charts at `harbor.webgrip.dev/webgrip`, `forgejo.webgrip.dev/webgrip` (charts under `charts/`) and `ghcr.io/webgrip`, signed with the [committed public key](../../ops/security/cosign.pub), and the extension `webgrip.unfold` on Open VSX with its VSIX, `.sig` and `.intoto.json` on the release. Check those with `cosign verify --key cosign.pub --insecure-ignore-tlog`; their signatures were never uploaded to a transparency log. An editor with `webgrip.unfold` does not move on its own; install `unfold-hq.unfold`.

## Ploeg's artifacts

[github.com/ploeg-hq/ploeg](https://github.com/ploeg-hq/ploeg) versions and publishes Ploeg from `v0.1.0`, with GitHub Actions as its only publisher: Linux binaries, checksums and source provenance on its GitHub releases, the image `ghcr.io/ploeg-hq/ploegd`, the chart `oci://ghcr.io/ploeg-hq/charts/ploeg`, and the Go module `github.com/ploeg-hq/ploeg`. Each release also publishes its contract bundle, `ghcr.io/ploeg-hq/ploeg-contract`. Unfold pins the bundle, the Go module and the chart at one release and publishes none of these on their own ([ADR-0039](../adr/adr-0039-unfold-depends-on-a-released-ploeg-through-its-contract-bundle-and-go-module.md)); the Unfold chart vendors that Ploeg chart unchanged ([ADR-0043](../adr/adr-0043-an-unfold-release-is-one-chart-that-carries-the-ploeg-it-was-tested-with.md)).

The versions Unfold published for Ploeg stay where they are, up to `0.4.0-rc.35`: `ploegd` and `charts/ploeg` on Harbor, Forgejo and `ghcr.io/webgrip`, and the Go module `github.com/webgrip/ploeg`. Unfold's exporter pushed each module version to `github.com/webgrip/ploeg` as a commit holding exactly that release's `apps/ploeg` tree. The exporter is retired, and [the publisher](../../scripts/publish_release.py) refuses `ploeg` before any Git, network or file access.

The 2026-10-03 history rewrite changed the bytes behind 14 published versions of the old module, and 17 versions survive only in the public module proxy. Downloads through the proxy still verify; a direct download of a changed version fails its checksum. `@latest` resolves to `v0.2.0`, and the withdrawn `v1.0.0-rc.1` remains the highest version. The [audit record](../research/2026-10-03-release-floors-and-identity.md) lists each version, and the [release floors](ci.md#release-floors) keep Ploeg's record so no Unfold train reuses a version.

## Integrity and retries

[`scripts/publish_release.py`](../../scripts/publish_release.py) verifies every artifact anonymously before it publishes the release: both images' AMD64 and ARM64 labels against the version, the Unfold commit and the source `https://github.com/unfold-hq/unfold` ([`scripts/release_registry.py`](../../scripts/release_registry.py)), their keyless signatures and CycloneDX attestations, the chart's keyless signature, and that Open VSX, and the Visual Studio Marketplace unless its publication is paused, serve the same VSIX bytes as the release. It then attaches `release-artifacts-unfold.json`, schema version 2, which lists each artifact by digest, and takes the GitHub release out of draft without marking it latest. Releases up to `unfold-v0.4.0-rc.35` also carry `release-artifacts-ploeg.json`.

An existing version must have the expected digest; a mismatch fails without replacing it, and a rerun skips what already verifies. GitHub package visibility is independent of repository visibility: new GHCR packages start private, and the anonymous pull check fails until each package (`unfold`, `unfold-agent`, `charts/unfold`) is made public; rerun the distribute job after that. See [GitHub package permissions](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages). A GitHub release takes assets only while it is a draft, so never publish an Unfold release by hand.

Run the [release preview](../../.github/workflows/on_release_preview.yml) before enabling releases. Its preflight checks that the GitHub API answers as `unfold-hq/unfold` rather than through a rename redirect, that `webgrip/unfold` has not come back as a repository of its own, that the trunk is public and current, that `GITHUB_TOKEN` may push to the three GHCR packages, that Open VSX has the `unfold-hq` namespace, and that the job gets an OIDC identity for keyless signing. Actual uploads and destination verification remain the responsibility of the first publication. Follow the [cutover playbook](first-cutover.md) to distinguish publication from a live application rollout.
