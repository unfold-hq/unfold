---
type: how-to
audience: [owner, operator]
owner: unfold
last_verified: 2026-11-16
verified_by: "Updated on 2026-11-16 after the move to GitHub against the published release unfold-v0.4.0-rc.132 (GitHub release, anonymous GHCR pulls, Open VSX unfold-hq.unfold) and .github/workflows/on_release_preview.yml, on_release_train.yml, on_release_published.yml, scripts/release_preflight.py and scripts/publish_release.py; earlier repository claims checked against cutover-record.example.json, the Unfold /healthz route and the order-service test path; external registries, GitOps and cluster state were not re-checked"
---

# First Unfold release and live test

The project home moved from Forgejo to GitHub `unfold-hq/unfold` on 2026-11-16; [Move the home to GitHub](#move-the-home-to-github) at the end of this page records how. Releases come only from GitHub Actions, `UNFOLD_RELEASES_ENABLED` is `true`, and `unfold-v0.4.0-rc.132` is the first release published from GitHub.

Use this playbook to qualify a published release and test it in a controlled environment. Sections 2 to 6 are the gates for publishing a release; rerun them when the release path changes, with `UNFOLD_RELEASES_ENABLED` set back to `false` until they pass again.

The [12 September readiness record](../research/2026-09-12-cutover-readiness.json) separates observed results from missing evidence. The [23 September readiness record](../research/2026-09-23-cutover-readiness.json) and its [summary](../research/2026-09-23-cutover-readiness.md) show which blockers are fixed and which owner actions remain. The [CI guide](ci.md) maps the current event entry points and publication guards. Copy the [execution record](cutover-record.example.json) for your test and replace its empty fields as each stage completes. Keep credentials, cookies, model prompts containing private data and database contents out of that record. A stage passes only when its evidence is attached; a skipped job is not a pass.

This procedure does not enable general availability. The Unfold application and Ploeg have independent versions: Unfold releases its application, and Ploeg releases from [github.com/ploeg-hq/ploeg](https://github.com/ploeg-hq/ploeg) ([ADR-0019](../adr/adr-0019-unfold-pins-ploeg-from-its-own-repository-and-releases-only-its-application.md)). Both applications remain on `0.x.y-rc.N`; each release configuration refuses a major or stable version. A release is complete when its required artifacts are verified; a rollout is complete when the selected environment passes the live checks. These are separate checkpoints.

## 1. Choose the test and capture the starting state

Use one operator, one registered test repository, one concurrent session and an explicitly approved model budget. The current GitOps configuration sets a per-session ceiling of USD 0.25; confirm the effective setting and model access before using it. An in-flight request can settle after cancellation, so the configured budget is not proof of an exact final charge. Do not enable unattended dispatch for this first interactive test.

Choose either an isolated pilot with a separate database and Unfold volume, or an upgrade of the existing installation. An isolated pilot can qualify the new application pair without proving an upgrade of existing data. Record which claim the test is meant to establish. The existing Unfold contract requires a registered repository and Team; use a disposable repository or an approved fixture branch and review the resulting change without publishing it.

From Unfold, record the source revision and check that the checkout is clean:

```sh
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/development
git fetch origin '+refs/notes/*:refs/notes/*'
mise run setup
mise run verify
mise run release-check-github
```

Record the matching successful run in [Unfold Actions](https://github.com/unfold-hq/unfold/actions). Local verification includes deterministic standalone and managed execution; it does not exercise a paid model or qualify ARM64 publication.

From an up-to-date checkout of the GitOps repository that holds the environment's desired state, confirm the intended context before these read-only checks. The commands use the namespace `ploeg`; substitute yours:

```sh
mise exec -- kubectl config current-context
mise exec -- kubectl -n flux-system get gitrepository flux-system \
  -o 'custom-columns=NAME:.metadata.name,REVISION:.status.artifact.revision'
mise exec -- kubectl -n ploeg get helmrelease,ocirepository
mise exec -- kubectl -n ploeg get deployment unfold ploeg \
  -o 'custom-columns=NAME:.metadata.name,READY:.status.availableReplicas,IMAGE:.spec.template.spec.containers[*].image'
```

Record the GitOps commit, both chart tags and digests, application image digests, Unfold workspace-image digest, extension version, configuration revision and persistent-volume identifiers. Get the workspace-image setting from the Unfold HelmRelease in that repository. These recorded values are the rollback baseline; do not copy a dated version from this playbook.

## 2. Close the release blockers

Complete this table before opening the gate. These are preparation tasks, not claims that the current workflows already support the desired result.

| Gate | Required change or check | Evidence that closes it |
| --- | --- | --- |
| One release authority | The archived Forgejo repository and its pull mirror run no Actions; the old front-end and Ploeg repositories stay frozen. | No release job outside `unfold-hq/unfold` is able to tag or publish Unfold. |
| Release baseline | Keep the remote `main` baseline required by the semantic-release branch configuration. Work stays on `development`; the release train does not release from `main`. | The release-policy step of the [release train](../../.github/workflows/on_release_train.yml) verifies the remote branch exists, and the preview resolves both branch types. |
| Notes and tags | Every `refs/notes/*` ref and every release tag is on GitHub. | The weekly `release-notes` job and `scripts/verify-import.py` with `UNFOLD_REQUIRE_IMPORT_NOTES=true` pass on GitHub. |
| Ploeg module compatibility | Retired by [ADR-0019](../adr/adr-0019-unfold-pins-ploeg-from-its-own-repository-and-releases-only-its-application.md): Unfold exports no Go module. | [The publisher](../../scripts/publish_release.py) refuses `ploeg` before any side effect; its tests in `scripts/test_release_floors.py` prove it. |
| Settings, secrets and variables | Set what [CI and release workflows](ci.md#settings-secrets-and-variables) lists, with `UNFOLD_RELEASES_ENABLED` left unset; allow auto-merge; add the ruleset that requires `gate`; configure Open VSX Trusted Publishing for `on_release_published.yml`. | The release preview's preflight passes. A declared secret name alone does not prove the secret exists. |
| Public packages | Make the GHCR packages `unfold`, `unfold-agent` and `charts/unfold` public once they exist. | An anonymous pull of each succeeds. |
| Signature verification | Admission policies that check Unfold artifacts accept the keyless identity in [Source mirrors and release artifacts](artifacts.md). | `cosign verify` with that identity passes for both images and the chart of the first release. |
| Retry behavior | Rehearse recovery from an existing image or chart and a failed extension upload. | Retrying the same tag finishes missing artifacts without replacing an existing version, changing its digest or creating another application release. |
| Release preview | Run the preview in the next section after all source changes are present. | The preview reports the intended Unfold version, channel and notes, or an explained no-release result, for the recorded source revision. |

No signing or registry secret exists: signing uses the workflow's OIDC identity and GHCR uses `GITHUB_TOKEN`. Record the secret names and verification results, never a value. Marketplace publishing is optional for this prerelease test and must be recorded as intentionally excluded.

## 3. Preview the versions while publishing is disabled

Open [Unfold Actions](https://github.com/unfold-hq/unfold/actions), select **[Workflow] On Release Preview**, choose `development`, and dispatch it. The [preview workflow](../../.github/workflows/on_release_preview.yml) runs the same release toolchain and application configurations as the release jobs as a semantic-release dry run. It has no artifact publisher or deployment step and does not require opening `UNFOLD_RELEASES_ENABLED`.

Record the source SHA, last recognized Unfold tag, predicted next version, channel and release notes. The first preview must recognize the `glide-v0.3.0` baseline and predict `0.4.0-rc.1` (or `0.3.1-rc.1` if only fixes follow the baseline); anything lower means the baseline tag is missing from GitHub. Check the proposed versions against every existing registry and extension destination; do not reuse a version already published with different contents.

The first successful preview, run 7 on the previous forge, under the earlier per-application versions, recognized Unfold `rc.16` and Ploeg `rc.7` at source `d39a180`, with no release-worthy changes for either application. It proves configuration, branch/history resolution and push permission for that revision; it does not predict a release for a later change.

The preview can legitimately report no release. Documentation, test and maintenance commits do not promise a version bump. Do not invent a feature or hand-edit versions merely to get a tag. If a first release is still required, land the actual reviewed release-related fix in an application, then preview again. A change outside `apps/`, such as a workflow or root documentation, is not selected by the commit filter.

A [semantic-release dry run](https://semantic-release.org/usage/configuration/#dryrun) omits prepare, publish and success hooks, but still checks repository push permission. It therefore does not prove the version-preparation scripts, image build, chart upload, signing, package exports or marketplaces work. Existing local checks cover parts of that path; the first publication must supply the remaining evidence. Changing the source after a preview invalidates the preview.

## 4. Establish recovery before touching existing data

For an existing-installation upgrade, finish or explicitly pause/cancel active sessions and managed Runs, then confirm that remote work has stopped and inference authorization is resolved or conservatively held. Stop new admission during the rollout. Do not change a managed session into standalone mode to bypass an unavailable Ploeg service.

Verify a recent PostgreSQL backup and restore it into an isolated database. Verify a consistent backup of Unfold's persisted state and the configuration needed to read it, using the storage system's approved backup procedure. Preserve the existing at-rest keys; generating new credentials is not a restore. Review [Ploeg migrations](../../apps/ploeg/pkg/store/migrations/) and [Unfold storage](../../apps/unfold/src/store.ts) between the baseline and candidate before deciding whether the old binaries can read the new state.

The 12 September audit saw completed Ploeg backups but an unhealthy `cnpg-disaster-recovery` cluster. That observation does not establish a tested restore, and does not mean the healthy primary database has failed. An upgrade of existing data remains blocked until a fresh restore exercise succeeds or an independently verified recovery path is recorded. An isolated pilot must use separate state and must not claim to have closed this upgrade gate.

## 5. Publish the first Unfold release

With preparation evidence complete and the old release authorities frozen, set the repository variable `UNFOLD_RELEASES_ENABLED=true` in [Unfold repository settings](https://github.com/unfold-hq/unfold/settings/variables/actions). Record who changed it and when. Coordinate a quiet `development` window so the source cannot advance unnoticed.

The [release jobs](../../.github/workflows/on_release_train.yml) run in the hourly release train on `development` ([ADR-0046](../adr/adr-0046-an-hourly-release-train-versions-unfold-from-a-checked-development-head.md)), and only when an application has commits since its last tag. Enabling the variable does not start them; a push or a manual source-change run does not either. Merge the reviewed release-worthy change, then wait for the next train or dispatch **[Workflow] On Release Train** on `development`. The train releases only the tip its checks passed, so keep `development` quiet until its `release` job ends. Retain the train's run link.

The release job tags `unfold-v…`, files a draft GitHub release and dispatches **[Workflow] On Release Published** at the tag, which publishes Unfold's artifacts and then takes the release out of draft. Follow that run through completion; source checks, tag creation and the release page are not the completion criterion.

Inspect [Unfold releases](https://github.com/unfold-hq/unfold/releases). Record the full tag and its resolved commit. A release commits nothing, so the tag resolves to the tip the train's checks passed. The version must be a zero-major release candidate, and prereleases must not move `latest`.

Do not open the gate if the preparation table remains incomplete. Publishing into real registries is the first irreversible distribution step; the procedure below recovers partial publication without deleting or recycling a version.

## 6. Verify every required artifact

The [release publication workflow](../../.github/workflows/on_release_published.yml) owns Unfold's destinations. The table records the current intended set; recheck it when that workflow changes.

| Artifact | Required evidence for the first release |
| --- | --- |
| Unfold workbench image | `ghcr.io/unfold-hq/unfold`: AMD64 and ARM64 manifests, correct version and source labels, keyless signature and attested SBOM verification. |
| Unfold agent image | `ghcr.io/unfold-hq/unfold-agent`: the same checks. |
| Unfold chart | `oci://ghcr.io/unfold-hq/charts/unfold`: pull the selected version, check `version`/`appVersion`, the vendored Ploeg chart and rendered image references, and its keyless signature. |
| Unfold extension | VSIX, checksum and sigstore bundle attached to the GitHub release; package verification succeeds; install that exact VSIX in the editor. Require the Open VSX `unfold-hq.unfold` download to match the attached VSIX byte for byte. Marketplace is intentionally excluded for these prerelease versions. |
| npm and Composer | No publishable package is currently configured. Both application npm manifests are private; no Composer manifest was found. Record these as out of scope. Adding an SDK or PHP package requires its own package identity, version policy, publisher and install test. |
| Documentation | Follow the [documentation publishing guide](docs-publishing.md). Check the Zensical home page, both applications, raw Markdown, LLM indexes and source revision. Documentation publication has a separate gate; a successful docs deployment does not authorize application releases. |

For OCI images, an example read-only digest inspection is:

```sh
mise exec -- docker buildx imagetools inspect "$CUTOVER_IMAGE" \
  --format '{{ .Manifest.Digest }}'
mise exec -- docker buildx imagetools inspect "$CUTOVER_IMAGE" --raw
```

Set `CUTOVER_IMAGE` to a recorded image reference; authenticate through the existing credential procedure where needed. Verify signatures against the keyless identity in [Source mirrors and release artifacts](artifacts.md#published-identities). A signature object merely existing is not cryptographic verification. Check intended public destinations from a clean client without publisher credentials as well.

Install and exercise the published binaries on the architecture selected for the pilot. AMD64 cache builds do not qualify ARM64 runtime behavior. If ARM64 is advertised but untested, record that gap and keep it out of the first deployment claim.

Record destination failures individually. Stop before rollout if a required artifact, signature, package export or install check is missing, even if the overall publisher is green.

## 7. Change the pilot through GitOps

Prepare and review the desired-state change in the environment's GitOps repository. Pin the qualified artifacts together:

| Application | Values that must agree |
| --- | --- |
| Ploeg | Runs inside the Unfold release: the `ploeg` values of the Unfold HelmRelease below, at the version the Unfold chart carries. |
| Unfold | The OCIRepository's chart tag and digest; the HelmRelease's workbench image tag/digest and workspace image tag/digest. |

Use the [published artifact paths](artifacts.md#published-identities). Run that repository's render/validation gate and inspect the rendered deployment before committing. Let Flux reconcile; do not use an imperative Helm upgrade or overwrite the deployment with `kubectl`.

Also review application work targets. Existing front-end repository URLs and Ploeg tracker routes still point at the old repositories. For a pilot targeting Unfold, register the Unfold URL and `development` branch explicitly, update the matching Ploeg target, and run verification from the correct application directory or Unfold root. The old front-end command `node --test examples/order-service/test/order.test.js` needs the `apps/unfold/` path when run from Unfold. Do not silently retarget existing queued work or assume changing the image changes its work repository.

For an existing-installation upgrade, qualify the intermediate pair before sequencing one application ahead of the other. If compatibility with the old peer is not demonstrated, keep admission closed while upgrading the pair and open it only after both are ready. Unattended executors and tracker-driven dispatch stay paused for the interactive pilot.

Use read-only rollout observations:

```sh
mise exec -- kubectl -n ploeg get helmrelease,ocirepository
mise exec -- kubectl -n ploeg rollout status deployment/ploeg --timeout=180s
mise exec -- kubectl -n ploeg rollout status deployment/unfold --timeout=180s
mise exec -- kubectl -n ploeg get deployment unfold ploeg \
  -o 'custom-columns=NAME:.metadata.name,READY:.status.availableReplicas,IMAGE:.spec.template.spec.containers[*].image'
```

For an isolated pilot, substitute its namespace and deployment names. Compare observed image digests and reconciled GitOps revision with the record. A ready HelmRelease with the old image still running fails the test.

## 8. Run the first real work session

Follow [managed setup and recovery](../workflows/managed-execution.md) and the [live operation guide](../../apps/unfold/docs/operations/live.md). Keep the first task small: one intentional fixture change, one real verification command, no automatic merge or publication.

| Check | Pass condition |
| --- | --- |
| Identity and readiness | The intended user signs in through the real login flow. Registered repository, model, Team and spending limit are correct. Authenticated health passes; public `/healthz` alone does not prove provider access. |
| Standalone refusal | Standalone live mode is retired. Started with no Ploeg connection or execution binding, a separate live configuration refuses to start and names the settings it needs. Never test this by removing authority from a managed session. |
| Managed authority | Starting the managed session creates exactly one corresponding Ploeg Work Item/Shift/Run. The repository, actor, team and budget match. |
| Actual execution | The workspace clones the intended Unfold or fixture revision, the configured model is called, and the recorded verification command really runs. Evidence identifies the candidate and the test output. |
| Disconnect and resume | Close and reopen the browser while the session runs; the same session and durable events remain. There is no second start or duplicate paid execution. |
| Pause and cancel | Exercise pause/resume and cancellation in separately budgeted small sessions. Verify acknowledged stop intent, remote state and settlement; a button changing state is not proof that an in-flight request ended. |
| Authority loss | In the isolated pilot, test a temporary Ploeg connectivity failure through the approved environment controls. Managed execution must not silently become standalone or retry uncertain paid work. |
| Restart recovery | In the isolated pilot, perform the reviewed restart drill. The session retains evidence and requires explicit recovery where execution is uncertain. Do not restart the existing installation during paid work merely to test this. |
| Accounting and cleanup | Gateway usage and Ploeg/Unfold records reconcile after settlement. No unexpected active workspaces, usable abandoned credentials or duplicate Runs remain. Retained evidence is readable. |
| Editor and review | Install the exact released extension, connect as the intended user, and inspect the same session and candidate. Review does not imply that a change was published. |

Give each paid session its own approved limit and record the total allowance before starting. Zero-cost fixtures from `mise run verify` remain useful evidence, but are labelled deterministic and cannot satisfy the live model checks. The delegated candidate path currently has no enabled live publisher executor; do not make automatic PR creation part of its acceptance criterion.

## 9. Stop or roll back

| Failure | Response |
| --- | --- |
| Preview, source checks or prerequisite fails | Keep Unfold publishing disabled. Correct the issue, rerun the affected qualification and capture a fresh preview. |
| One application publishes and the other fails | Leave the successful artifacts intact. Keep admission closed and complete the failed application or return to the baseline pair. Do not assume the pair was released atomically. |
| An image exists but a mirror, signature or extension upload fails | Use the corresponding publication workflow's manual dispatch with the existing full tag selected as both workflow ref and `tag` input. Inspect existing artifacts first; verify their contents before any skip-existing path. Rerun the same version only. |
| A published version has wrong contents | Stop deployment, close release automation and document the defective version. Fix forward with a new version; do not move the tag or overwrite immutable packages. |
| Pilot rollout or work fails | Stop new admission, explicitly stop active work and settle or retain uncertain authorizations. Revert the scoped GitOps rollout to the recorded chart/image/configuration pins and let Flux reconcile. Verify observed digests and health. |
| Old binaries cannot read migrated state | Use the tested coordinated database/volume restore procedure with admission closed, or fix forward. A Git revert is not a database rollback. Do not restore one service's state while leaving inconsistent peer state active. |

Setting `UNFOLD_RELEASES_ENABLED=false` prevents future eligible jobs; it does not cancel an already running job, retract artifacts, roll back a deployment or stop a paid session. Inspect [Actions](https://github.com/unfold-hq/unfold/actions) and stop the relevant active publication runs if needed. Do not re-enable the old release authorities after an Unfold publication without reconciling versions, source and channel history first.

## 10. Close the test

The execution record must contain the exact source/release/export revisions, workflow links, required artifact outcomes and digests, GitOps before/after commits, recovery evidence, session IDs, actual spend and the operator's result. Use `passed`, `failed`, `not_run` or `excluded` with a reason; never translate a missing observation into a pass.

Keep unattended work disabled until its separate admission, worker, accounting and delivery tests pass. Keep compatibility mirrors as distribution outputs and direct new source changes to Unfold. Update the [migration record](../migration.md) only when the release authority has actually changed. Record any follow-up work in the tracker rather than leaving an undocumented exception in this playbook.

<a id="move-the-home-to-github-proposed"></a>

## Move the home to GitHub

The cutover day of [ADR-0055](../adr/adr-0055-github-unfold-hq-is-the-project-home.md), 2026-11-16. The owner ran every step that changed a forge, a registry or a shared remote; agents prepared the pull requests and checked the results. [Source mirrors and release artifacts](artifacts.md) lists where the pre-move versions stay.

### Before the day

1. The `unfold-hq` namespace was claimed on Open VSX, so the last Forgejo release could publish `unfold-hq.unfold` for the first time, which Trusted Publishing needs.
2. The `unfold-hq-bot` GitHub App was created in the `unfold-hq` organisation with contents and pull-request write access, so Ploeg's `consumers` job opens its pin pull request there.
3. The Cloudflare tokens were created: one that deploys the site Worker, and one that only reads the `unfoldhq.dev` zone.
4. `ovsx` in `apps/unfold/extensions/vscode/package.json` moved to 1.4.0 or newer; the GitHub publisher refuses an older one.
5. Every open pull request on Forgejo was merged or closed; they did not move.

### On the day

1. `development` was frozen on Forgejo until the last Forgejo release was fully published.
2. The GitHub mirror was checked against Forgejo: the same `development`, `main` and tags.
3. Every `refs/notes/*` ref was pushed to GitHub once, from a checkout that had fetched them all. Without them the version would have restarted and `verify-import.py` would fail.
4. Forgejo's push mirror was turned off and the GitHub repository was transferred to `unfold-hq`.
5. `unfold-hq/unfold` was configured: Actions on; the secrets and variables in [CI and release workflows](ci.md#settings-secrets-and-variables), with `UNFOLD_RELEASES_ENABLED` unset at first; auto-merge allowed; a ruleset on `development` and `main` that requires the `gate` check; private vulnerability reporting on; Open VSX Trusted Publishing for `unfold-hq/unfold` and `on_release_published.yml`; Ploeg's `RELEASE_CONSUMERS` entry pointing at `unfold-hq/unfold` with the App.
6. The Forgejo repository was archived under a new name, and a one-way pull mirror of `https://github.com/unfold-hq/unfold` with Actions off took its place.
7. Every checkout was pointed at GitHub: `git remote set-url origin git@github.com:unfold-hq/unfold.git`.
8. [The release preview](../../.github/workflows/on_release_preview.yml) ran on `development`, and its preflight passed before `UNFOLD_RELEASES_ENABLED` became `true`.
9. The first pull request on GitHub deleted `.forgejo/`, `scripts/workflow-policy.test.cjs` and the Forgejo branches of the release scripts, and made the documentation describe GitHub as the only forge.

### The first release from GitHub

`unfold-v0.4.0-rc.132` is the first release published from GitHub. On 2026-11-16 its GitHub release was out of draft with the VSIX, its checksum, its sigstore bundle and `release-artifacts-unfold.json`; `ghcr.io/unfold-hq/unfold`, `ghcr.io/unfold-hq/unfold-agent` and `oci://ghcr.io/unfold-hq/charts/unfold` pulled anonymously at `0.4.0-rc.132`; and Open VSX served `unfold-hq.unfold` at that version. For a later first release, check the same and that `cosign verify` against the keyless identity in [Source mirrors and release artifacts](artifacts.md#published-identities) passes for both images and the chart, and that staging serves the site from the candidate.

The pre-move extension on Open VSX stays at `0.4.0-rc.130` and does not move on its own. A last note on it, or a README line, that points people to `unfold-hq.unfold` is still open.
