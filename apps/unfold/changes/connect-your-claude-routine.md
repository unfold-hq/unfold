---
type: added
highlight: false
---
Connect your own Claude routine once per Team, then start a Work Item that waits for you with Start with my Claude.

On Settings → Connect Claude, paste the fire URL and token of a claude.ai routine whose API trigger runs on the installation's self-hosted environment. Unfold sends them straight to Ploeg, which keeps the token; Unfold never stores, logs or shows it. Ploeg's refusals, such as a missing credential gateway, an installation that does not accept routines, the hourly limit or a token Anthropic refused, are shown in plain words. The step needs Ploeg 0.2.0-rc.128 or later; the onboarding checklist says so until then.
