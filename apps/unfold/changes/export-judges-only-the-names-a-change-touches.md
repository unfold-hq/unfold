---
type: changed
---
A repository that already tracks a file such as `.env.testing` no longer blocks every session there from delivering its change.

The export is still refused when the change itself adds, edits or deletes a file whose name suggests credentials, and when any file holds a recognizable secret. The Git bundle of a Candidate holds the base as well, so it contains such a tracked file; the patch does not.

The export also takes far less time on a large repository, because it reads each unchanged file for secrets once instead of twice.
