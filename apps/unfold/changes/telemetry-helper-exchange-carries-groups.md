---
type: fixed
---
The plugin's telemetry helper now asks for `openid profile email` when it trades its session for an Unfold token, so the token carries your groups.

Without a requested scope some identity providers answer the exchange with a token that has no groups or email, and Unfold then refuses it as not entitled. `UNFOLD_TELEMETRY_EXCHANGE_SCOPES` sets other scopes.
