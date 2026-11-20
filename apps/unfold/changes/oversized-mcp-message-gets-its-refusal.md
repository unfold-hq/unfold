---
type: fixed
---
A message to unfold-mcp over HTTPS that is larger than 1 MiB is answered with its "Message exceeds 1 MiB." refusal instead of a dropped connection.

Unfold now reads and discards up to 8 MiB more of such a message before it answers and closes the connection; past that it still drops the connection.
