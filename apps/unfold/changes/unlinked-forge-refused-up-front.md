---
type: fixed
---
A session on a repository Unfold clones with your own GitLab link now refuses to start while you have no such link, and says to link it under Linked accounts.

Before, the session started, failed after about half a minute with "The workspace could not be prepared." and did not say why. A workbench with a shared clone secret (`kubernetes.gitSecretName`) is unchanged.
