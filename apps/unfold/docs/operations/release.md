# Release Unfold

GitHub Actions in [unfold-hq/unfold](https://github.com/unfold-hq/unfold) coordinates one version for the workbench image, workspace image, Helm chart and editor extension. Source checks run before a release tag is created; publication jobs consume that tag. A tag or green source job alone does not prove that every artifact was published.

The application's version is the Unfold version, with an `unfold-v<version>` tag ([system ADR-0019](../../../../docs/adr/adr-0019-unfold-pins-ploeg-from-its-own-repository-and-releases-only-its-application.md)). Ploeg releases on its own from [github.com/ploeg-hq/ploeg](https://github.com/ploeg-hq/ploeg); until `unfold-v0.4.0-rc.35` it released together with the application ([system ADR-0004](../../../../docs/adr/adr-0004-unfold-releases-one-version.md)). Publication remains disabled until the [distribution cutover](../../../../docs/m## Follow the release

| Stage | Source | Expected result |
| --- | --- | --- |
| Validate | [Source workflow](../../../../.github/workflows/on_source_change.yml), [pull-request workflow](../../../../.github/workflows/on_pull_request.yml) | Application, extension, generated-document and chart checks; cache-only image builds |
| Version | [Release train](../../../../.github/workflows/on_release_train.yml), [release configuration](../../../.releaserc.cjs) | A version tag on the checked commit and a draft GitHub release whose notes lead with the [release-note fragments](release-notes.md); no commit |
| Publish | [Publication workflow](../../../../.github/workflows/on_release_published.yml) | Both images, with the release notes resolved into the workbench image, the chart, keyless signatures and attestations, VSIX, checksum and sigstore bundle; the release taken out of draft |
| Build documentation | [Documentation workflow](../../../../.github/workflows/on_docs_change.yml) | Combined site built from [Unfold MkDocs](../../../../mkdocs.yml) and deployed by its own workflow ([Publish the documentation](../../../../docs/operations/docs-publishing.md)) |

Unfold checks pushes to `development` and pull requests, and the hourly release train versions the development head it checked. The repository's own semantic-release configuration in [`scripts/release-config`](../../../../scripts/release-config/) determines release eligibility from conventional commits and fails a release whose range holds a commit that is neither conventional nor a merge. A release is the tag alone: it commits no version, changelog or image reference. Every publish job runs the [stamp script](../../scripts/stamp-version.mjs) on its checkout of the tag, so a publication carries the tag's version while the committed chart and manifests keep an older one; do not hand-bump them to repair a failed publication. Renovate moves the `unfold-agent` image the warm pool and the live local example name.

Inspect the matching run in [GitHub Actions](https://github.com/unfold-hq/unfold/actions) and its [release assets](https://github.com/unfold-hq/unfold/releases). Record missing artifacts and the failing job. The publication workflow supports a manual dispatch at the existing tag (`gh workflow run on_release_published.yml --ref <tag> -f tag=<tag>`); examine which stages completed before rerunning it. Several stages skip an existing artifact, so a retry is not a blanket rebuild or replacement.

ng artifact, so a retry is not a blanket rebuild or replacement.

## Images and chart

The publication workflow builds the [workbench image](../../Dockerfile) and [workspace image](../../ops/agent/Dockerfile) for AMD64 and ARM64, each on a GitHub-hosted runner of that platform, and merges them into one index ([CI and release workflows](../../../../docs/operations/ci.md#publication)). The [CVE gate](../../../../.github/actions/cve-gate/action.yml) evaluates the published digest against [configured budgets](../../ops/security/cve-budgets.yaml) and [reviewed VEX statements](../../ops/vex/statements/). Keyless signing and attestation follow that gate. Verify the digest, signer and attached evidence when qualifying a release; an old vulnerability scan is not a permanent assertion about an image.

The workbench image carries a Node compile cache in `/app/.node-cache`, which roughly halves the time from process start to a listening server. The last build step imports `src/main.ts` with `NODE_COMPILE_CACHE` set, which loads every module without starting the server, because `main()` runs only when `src/main.ts` is the entry script. The build fails when that step writes almost nothing, so a cache that silently stopped working cannot ship. The source stays TypeScript and startup still compiles nothing ([ADR 0002](../adrs/0002-native-node-and-single-writer-storage.md)); the cache only spares V8 from parsing it again. Node uses an entry only when the running process matches the one that wrote it, on three points that otherwise fail without a message:

- **The same Node build.** The step runs in the runtime stage, `NODE_RUNTIME_IMAGE`, so the binary that writes the cache is the one that reads it; moving the step to the `-dev` stage would tie it to a second digest that Renovate bumps on its own.
- **The same user.** The cache directory is named after the uid. The image and the chart's `securityContext` both run as uid 1000; a deployment that overrides `runAsUser` starts without the cache.
- **The same file paths.** Entries are keyed by absolute path, so the application stays at `/app`.

A read-only root filesystem is fine: Node reads the cache and skips writing new entries.

When a vulnerability sits in a dependency that npm bundles and npm has not yet shipped a fix, the workspace image pins the fixed release as an annotated `NPM_<NAME>_VERSION` build argument, and [the patch script](../../ops/agent/patch-bundled-npm.mjs) swaps it in during the build. The script replaces only a copy that is older and in the same major version, fails the build if npm then cannot expand a brace pattern, and logs when npm itself has caught up, which is the signal to remove the pin. The first pins, `brace-expansion` 5.0.12 and `undici` 6.28.1, followed the advisories of 2026-09-29 that failed the budget in release run 358 on the previous forge.

The [chart](../../ops/helm/unfold/) defaults image versions from its `appVersion`. Explicit image overrides can create version skew and need their own qualification. Registry destinations belong to the publication workflow; consult it rather than a copied deployment inventory. Successful publication and public pull access must be checked from the actual run and destination.

Deploy through the target environment's desired-state repository. [Live operation](live.md) covers workspace and runtime configuration. Publishing an image or chart does not deploy the workbench.

## Extension distribution

The extension job of the publication workflow reuses the VSIXes already attached to the draft release, or packages the tagged extension, then runs the [listing and package verifier](../../scripts/extension-verify.mjs) on each. A release candidate gets two: `unfold-<version>.vsix` for the GitHub release and Open VSX, and `unfold-marketplace-<marketplace version>.vsix`, packaged with `--pre-release` under the version [`scripts/marketplace_version.py`](../../../../scripts/marketplace_version.py) derives, because the Marketplace accepts only `major.minor.patch`: `X.Y.Z-rc.N` becomes `X.Y.((Z+1)×10000+N)`, so `0.4.0-rc.152` is `0.4.10152`. A stable version keeps its number and one VSIX. The job signs each VSIX keyless, attests its build provenance, attaches it with its SHA-256 checksum and its sigstore bundle to the draft release, and only then publishes to a registry. The release stays a draft until the distribute job has verified every artifact, so a release page can exist while packaging is still running or has failed.

| Destination | Workflow condition |
| --- | --- |
| GitHub release | Attach every VSIX, its checksum and its sigstore bundle while the release is a draft, before any registry publication |
| Open VSX | Publish with Trusted Publishing (`ovsx publish --trusted-publishing`, ovsx 1.4.0 or newer); no token is stored |
| Visual Studio Marketplace | Publish the Marketplace VSIX with Trusted Publishing (`vsce publish --oidc`), a candidate as a pre-release, unless `PAUSED` in `scripts/marketplace_version.py` names a reason to skip; no token is stored |

[ADR 0021](../adrs/0021-the-extension-ships-through-open-vsx-first.md) records the Open VSX decision, [ADR 0075](../adrs/0075-the-extension-reaches-the-marketplace-through-trusted-publishing-with-release-candidates-as-pre-releases.md) the Marketplace one, and [ADR-0055](../../../../docs/adr/adr-0055-github-unfold-hq-is-the-project-home.md) moved the extension id to `unfold-hq.unfold`, which [ADR 0076](../adrs/0076-the-extension-is-unfold-hq-unfold-workbench-on-every-registry.md) renamed to `unfold-hq.unfold-workbench`. Each registry step writes what it published to the job summary. Account ownership and external registry availability require a fresh check when publishing there.

### Signature and provenance

The VSIX is signed with `cosign sign-blob` under the publication workflow's GitHub OIDC identity at the release tag, recorded in the public Rekor log, and gets a GitHub build-provenance attestation. A rerun reuses the bundle already on the release. To check a downloaded release by hand:

```sh
sha256sum -c unfold-<version>.vsix.sha256
cosign verify-blob --bundle unfold-<version>.vsix.sigstore.json \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/unfold-hq/unfold/\.github/workflows/on_release_published\.yml@refs/tags/unfold-v' \
  unfold-<version>.vsix
gh attestation verify unfold-<version>.vsix --repo unfold-hq/unfold
```

Versions published before the move to GitHub carry a `.vsix.sig` and a `.vsix.intoto.json` signed with the [committed public key](../../../../ops/security/cosign.pub) instead; check those with `cosign verify-blob --key cosign.pub --insecure-ignore-tlog`.

Neither registry takes this signature. Open VSX signs every published version with its own registry key and serves a `.sigzip` and that key's URL next to the VSIX; `ovsx verify <file.vsix>` checks a download against it. The Marketplace also signs every extension when it is published, and VS Code checks that signature on install. The cosign signature and provenance are for people who install from the GitHub release, and for anyone who wants to tie a registry download back to the release: the registries store the same bytes, which `scripts/publish_release.py` compares for both.

### Registry credentials

Open VSX publishes through Trusted Publishing, configured on open-vsx.org for `unfold-hq/unfold` and `on_release_published.yml`, so no Open VSX token exists. Trusted Publishing cannot create an extension, so `unfold-hq.unfold-workbench` must exist on Open VSX before the first publication from GitHub, created once with a token as described below. If Open VSX keeps Trusted Publishing per extension rather than per namespace, add the same configuration to the new extension.

The Visual Studio Marketplace publishes through Trusted Publishing as well: the `unfold-hq` publisher needs a policy under **Trusted Publishing** for owner `unfold-hq`, repository `unfold` and workflow `on_release_published.yml`, without an environment, and the job's `id-token: write` lets `vsce publish --oidc` trade its OIDC token for a publish credential that lasts 15 minutes. No `VSCE_PAT` or Azure credential exists. The release preview fails when the Marketplace has no `unfold-hq` publisher. A person who wants release candidates in VS Code chooses **Switch to Pre-Release Version** on the extension's page; everyone else gets stable versions only.

The extension is `unfold-hq.unfold-workbench` on both registries ([ADR 0076](../adrs/0076-the-extension-is-unfold-hq-unfold-workbench-on-every-registry.md)): the Marketplace refused `unfold`, which another publisher holds. `PAUSED` in `scripts/marketplace_version.py` remains the switch that skips the Marketplace, with its reason in the job summary, should publication there have to stop again.

Before the first release under that name, the owner of the `unfold-hq` namespace creates the Open VSX listing once, because Trusted Publishing cannot. From the tagged extension, with an Open VSX token in the environment and never in a file:

```sh
cd apps/unfold/extensions/vscode
npm pkg set version=0.4.0-rc.0
npx --no-install vsce package --no-dependencies --pre-release --out unfold-workbench-bootstrap.vsix
npx --no-install ovsx publish --packagePath unfold-workbench-bootstrap.vsix --pre-release -p "$OVSX_PAT"
git checkout package.json
```

The release train never cuts `0.4.0-rc.0`, so no release compares its bytes. Then mark `unfold-hq.unfold` deprecated with `unfold-hq.unfold-workbench` as its replacement.

For installation, download the matching VSIX and checksum from a completed [GitHub release](https://github.com/unfold-hq/unfold/releases), verify the checksum, then use the editor's **Install from VSIX** command. The [extension guide](../../extensions/vscode/README.md#install) gives the user-facing steps.

## Credentials and qualification

Use the secret and variable names in [CI and release workflows](../../../../docs/operations/ci.md#settings-secrets-and-variables); never put a value in this repository. Images, the chart and the VSIX are signed keyless with the workflow's OIDC identity, and GHCR and the GitHub release use the job's `GITHUB_TOKEN`, so no registry or signing secret exists. A workflow declaration proves which input is expected, not that a secret exists or the remote identity is authorized.

[Validation](../validation.md) records dated release and deployment checks. The [previous release guide](https://github.com/unfold-hq/unfold/blob/c5718cde7e1c7520927c64613c38beee11e087f7/docs/operations/release.md) preserves the initial publisher setup and failures. Those observations are history; use current job output to decide what still needs attention.
