---
status: accepted
date: 2026-11-16
decision-makers: Ryan Grippeling
---

# Unfold's images build on Wolfi, and CI needs no Docker Hub account

## Context and Problem Statement

Unfold publishes two images, `ghcr.io/unfold-hq/unfold` (the workbench) and `ghcr.io/unfold-hq/unfold-agent` (the agent workspace). [Application ADR 0010](../../apps/unfold/docs/adrs/0010-one-release-train-with-zero-cve-images.md) put both on Docker Hardened Images (`dhi.io/node:24-alpine`) with a budget of zero critical and zero high findings. `dhi.io` refuses anonymous pulls, so every image build needs a Docker Hub sign-in. After the move to GitHub ([ADR-0055](adr-0055-github-unfold-hq-is-the-project-home.md)) that sign-in is the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`. Without them `build-contexts` fails on every push and pull request, a pull request from a fork has to skip the image build, and a person who rebuilds an Unfold image needs a Docker account.

Ploeg had the same problem and moved its images to Wolfi ([Ploeg ADR-0144](https://github.com/ploeg-hq/ploeg/blob/development/docs/adrs/0144-every-published-image-is-built-on-a-base-that-scans-clean-and-pulls-without-credentials.md)). Which base should Unfold's two images use, so that CI and any rebuilder need no Docker Hub account and the zero budget still holds?

## Decision Drivers

* No credential to build. A pull request from a fork gets no secrets, and a downstream rebuilder or registry proxy must reproduce the build without an account at an image vendor.
* Zero critical and zero high findings, measured by the release gate's scanner (Grype, with reviewed OpenVEX statements only).
* Node 24, the line `mise.toml`, `engines.node` and the `@types/node` bound pin.
* The images keep their behaviour: uid 1000 `node`, the workbench without a shell or package manager and with git for delivery, the agent image with bash, git, ripgrep, npm and the OpenCode binary, both for AMD64 and ARM64.
* The same choice as Ploeg, so one person can maintain both.

## Considered Options

* Wolfi: `cgr.dev/chainguard/wolfi-base:latest` pinned by digest, with Node 24, npm and git from Wolfi's package repository
* Docker Hardened Images with the Docker Hub sign-in kept as a repository secret
* The official `node:24-alpine` image from Docker Hub

## Decision Outcome

Chosen option: "Wolfi", because it is the only option that pulls without credentials and has measured zero critical and high findings for Ploeg's images, and Ploeg already runs on it.

* **Base.** Both Dockerfiles take `ARG WOLFI_BASE_IMAGE=${REGISTRY_CHAINGUARD}/chainguard/wolfi-base:latest@sha256:…`. `REGISTRY_CHAINGUARD` defaults to `cgr.dev` and can point at a mirror. The Renovate annotation above the `ARG` moves the digest. Chainguard serves only the `latest` tag free of charge, so the digest is the pin.
* **Packages.** `apk add` installs `nodejs-24`, `npm`, `git` and the agent's tools from `https://packages.wolfi.dev/os` at build time. The package versions are not pinned, because Wolfi withdraws old package versions and a pin would break rebuilds. Renovate has no datasource for Wolfi packages. The package name holds the Node major, a build step fails unless `node --version` starts with `v24.`, and the signed CycloneDX SBOM of each platform image records what shipped. The Node patch level in an image can therefore differ from the one `mise.toml` pins for development.
* **Workbench image.** A `rootfs` stage runs `apk add --root /rootfs --initdb wolfi-baselayout ca-certificates-bundle nodejs-24 git`, removes `git-http-push`, adds the `node` user (uid and gid 1000) and is copied onto `FROM scratch`. The image keeps no shell and no package manager. The application tree, `/data`, the compile cache, the port, the environment and `CMD` are unchanged.
* **Agent image.** It runs on `wolfi-base` with `apk upgrade`, then `nodejs-24`, `npm`, `bash`, `git`, `ca-certificates-bundle` and `ripgrep`, and keeps busybox and apk-tools as the Alpine dev variant did. OpenCode comes from the glibc package `opencode-linux-<arch>`, because Wolfi is glibc. Before, it came from the musl package. The npm patch for `undici` and `brace-expansion` stays as it was.
* **CI.** No workflow reads `DOCKERHUB_USERNAME` or `DOCKERHUB_TOKEN` or signs in to `dhi.io`. `build-contexts` builds both images into the runner's image store and runs the release's CVE gate on each, so a pull request fails before merge when an image goes over its budget, instead of the release failing after its tag.
* **No Docker Hub at all.** Nothing in CI or the release pulls from `docker.io`. The Dockerfiles carry no `# syntax=` directive, which would pull the `docker/dockerfile` frontend, so the builder's own frontend parses them. The release builds each platform natively, AMD64 on `ubuntu-24.04` and ARM64 on `ubuntu-24.04-arm`, with the runner's own Docker and its BuildKit on the containerd image store, so it pulls neither binfmt for QEMU nor a BuildKit image. It pushes each platform by digest and merges both into one tagged index with `docker buildx imagetools create`. BuildKit still attaches SLSA provenance. Its SBOM scanner is a Docker Hub image, so the release attests a CycloneDX SBOM from syft for the index and for each platform image instead, signed keyless like the rest. The nightly MCP end-to-end suite takes Postgres from the ECR Public copy of the official image (`public.ecr.aws/docker/library/postgres`), the same digest as on Docker Hub.

### Consequences

* Good, because every pull request, forks included, builds and scans both images with no secret, and the two repository secrets can be deleted.
* Good, because Wolfi rebuilds a package when its upstream fixes a CVE, and the next image build picks the fix up. The agent image no longer needs the pinned Alpine `libcurl` and `libexpat` fallback.
* Good, because Unfold and Ploeg now use the same base.
* Bad, because two builds of the same commit a week apart can contain different package versions. Accepted, because the gate scans what is built and the SBOM records it. apko with a lockfile would make builds reproducible, and is a re-evaluation trigger below.
* Bad, because the images move from musl to glibc. An image built `FROM` `unfold-agent` that runs Alpine packages or musl binaries breaks, and must use Wolfi packages instead.
* Bad, because a digest that Renovate does not move stops receiving base fixes. The workbench takes all its packages fresh at build time and the agent image runs `apk upgrade`, so this matters only for the base layer itself.
* Good, because no job depends on Docker Hub's anonymous rate limit or availability.
* Bad, because the ARM64 build needs GitHub's `ubuntu-24.04-arm` runner, which is free only for public repositories. A private fork has to pay for it or go back to emulation.

### Confirmation

* `mise run release-check-github` runs [`scripts/github-workflow-policy.test.cjs`](../../scripts/github-workflow-policy.test.cjs). It fails when a pull request job reads a secret, when `build-contexts` takes an input, signs in to a registry or names `dhi.io`, or when it stops holding both images to their CVE budget.
* The `build-contexts` job on every pull request builds both images and fails when either goes over [`apps/unfold/ops/security/cve-budgets.yaml`](../../apps/unfold/ops/security/cve-budgets.yaml). The release repeats the gate on the pushed digests before it signs them.
* `git grep -n -i -E 'dhi\.io|REGISTRY_DHI|DOCKERHUB' -- .github apps/unfold/Dockerfile apps/unfold/ops/agent/Dockerfile` prints nothing.
* The same policy test fails when a workflow or action names `docker.io`, binfmt, a BuildKit image, `buildx create` or BuildKit's SBOM scanner, when either Dockerfile has a `# syntax=` directive, or when the MCP end-to-end compose file takes an image from anywhere but `ghcr.io` or `public.ecr.aws`.

## Pros and Cons of the Options

### Docker Hardened Images with the sign-in kept

* Good, because the images are small, signed and come with SBOM, provenance and OpenVEX from Docker.
* Bad, because `dhi.io` needs a Docker account for every pull. A fork cannot build the images, and the project depends on one vendor's login for its own build.

### The official `node:24-alpine` image

* Good, because it is the smallest change and pulls anonymously.
* Bad, because CI would still depend on Docker Hub, which rate-limits anonymous pulls, and the owner ruled that dependency out.

## Re-evaluation triggers

* `dhi.io` serves anonymous pulls, or keyless OIDC pulls that a fork's pull request can use.
* Chainguard stops serving `cgr.dev/chainguard/wolfi-base:latest` anonymously, or Wolfi drops a package the images need, such as `nodejs-24`.
* Unfold needs byte-for-byte reproducible images. apko with a resolved lockfile would then replace `apk add`.

## More Information

* Amends [application ADR 0010](../../apps/unfold/docs/adrs/0010-one-release-train-with-zero-cve-images.md): its base image choice is replaced, while its release train and zero budget stand.
* Amends [ADR-0055](adr-0055-github-unfold-hq-is-the-project-home.md): its consequence that a fork skips the image build no longer holds.
* 2026-11-16 — Decided by the owner: Unfold's CI must not need Docker Hub.
* 2026-11-16 — Widened by the owner to no Docker Hub at all: the release builds each platform on its own runner without binfmt or a BuildKit image, the Dockerfiles drop their `# syntax=` directive, BuildKit's SBOM gives way to signed per-platform CycloneDX SBOMs, and the nightly suite's Postgres comes from ECR Public. The neutral consequence that the release still pulled BuildKit and binfmt from `docker.io` was removed.
