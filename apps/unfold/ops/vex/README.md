# OpenVEX statements

Reviewed exploitability statements for findings the release gate should not count. Each statement is scoped to one image at one digest, carries a status and a justification from the OpenVEX vocabulary, and is attested onto the image by the signing step. Harbor's project allowlist stays empty; a suppression without a statement here does not exist.

Both images have a budget of zero critical and zero high findings in `enforce` mode, as recorded in [ops/security/cve-budgets.yaml](../security/cve-budgets.yaml).

No statements are in force.

The only statement so far, for picomatch's CVE-2026-112366 (GHSA-fc5q-39xc-vjpf, a ReDoS through attacker-supplied extglob patterns, no fixed release), was retired on 2026-11-18 because the agent image stopped shipping the copy it covered: Wolfi's node-gyp, which npm-12 depends on and which can build nothing in an image without a compiler, is removed in the [agent Dockerfile](../agent/Dockerfile).

One copy remains that no scanner reports. The OpenCode binary is a single compiled file that bundles its JavaScript, and OpenCode 1.19.5 carries picomatch 2.3 through `@parcel/watcher` and `micromatch`. The watcher turns ignore patterns into regular expressions with `micromatch.makeRe`. The watcher on the workspace, which reads `watcher.ignore` from a repository's `opencode.json`, runs only with `OPENCODE_EXPERIMENTAL_FILEWATCHER`, which Unfold never sets. The watcher on `.git` takes the names of the entries in `.git` as its patterns; only git and processes inside the session's container write those, and the agent there already runs any command. A pattern that triggered the ReDoS would stall that session's OpenCode process and nothing else. Check this again when OpenCode moves to a new `@parcel/watcher` or Unfold sets an OpenCode experimental flag.

Both images build on Wolfi and take the newest Wolfi package at build time ([ADR-0056](../../../../docs/adr/adr-0056-unfold-images-build-on-wolfi-and-ci-needs-no-docker-hub-account.md)), so a fixed package reaches the image with the next build. Add a statement only when a rebuild cannot remove the finding and the vulnerable code is unreachable in the image, and follow the infrastructure VEX guide for the file shape.
