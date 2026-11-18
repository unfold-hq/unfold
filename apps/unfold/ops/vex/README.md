# OpenVEX statements

Reviewed exploitability statements for findings the release gate should not count. Each statement is scoped to one image at one digest, carries a status and a justification from the OpenVEX vocabulary, and is attested onto the image by the signing step. Harbor's project allowlist stays empty; a suppression without a statement here does not exist.

Both images have a budget of zero critical and zero high findings in `enforce` mode, as recorded in [ops/security/cve-budgets.yaml](../security/cve-budgets.yaml).

One statement is in force, until 2026-12-18 at the latest. On 2026-11-18 the gate found CVE-2026-112366 (GHSA-fc5q-39xc-vjpf, High, a ReDoS through attacker-supplied extglob patterns) in picomatch 4.0.7, which Wolfi's node-gyp ships and npm depends on. No fixed picomatch exists. The only caller is node-gyp's build step, which globs the fixed patterns `build/*.sln` and `build/*.mk`, so [unfold-agent.openvex.json](statements/unfold-agent.openvex.json) records the finding as `not_affected` under both ids. [check-picomatch-users.mjs](../agent/check-picomatch-users.mjs) fails the image build if another copy, another importer or another pattern appears. Remove the statement and the check once Wolfi's node-gyp ships a fixed picomatch, and review it again by 2026-12-18 if it has not.

Both images build on Wolfi and take the newest Wolfi package at build time ([ADR-0056](../../../../docs/adr/adr-0056-unfold-images-build-on-wolfi-and-ci-needs-no-docker-hub-account.md)), so a fixed package reaches the image with the next build. Add a statement only when a rebuild cannot remove the finding and the vulnerable code is unreachable in the image, and follow the infrastructure VEX guide for the file shape.
