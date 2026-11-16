# OpenVEX statements

Reviewed exploitability statements for findings the release gate should not count. Each statement is scoped to one image at one digest, carries a status and a justification from the OpenVEX vocabulary, and is attested onto the image by the signing step. Harbor's project allowlist stays empty; a suppression without a statement here does not exist.

Both images have a budget of zero critical and zero high findings in `enforce` mode, as recorded in [ops/security/cve-budgets.yaml](../security/cve-budgets.yaml). No statements are in force.

Both images build on Wolfi and take the newest Wolfi package at build time ([ADR-0056](../../../../docs/adr/adr-0056-unfold-images-build-on-wolfi-and-ci-needs-no-docker-hub-account.md)), so a fixed package reaches the image with the next build. Add a statement only when a rebuild cannot remove the finding and the vulnerable code is unreachable in the image, and follow the infrastructure VEX guide for the file shape.
