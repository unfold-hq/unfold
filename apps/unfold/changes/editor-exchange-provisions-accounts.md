---
type: added
---
An administrator can let the editor token exchange create a person's account on their first exchange, so Claude Code signs in without one browser visit.

Set `auth.oidc.exchange.provision` to `true` with `match: subject`. The account is created the way browser sign-in creates it, with the role the token's claims entitle; it stays off by default.
