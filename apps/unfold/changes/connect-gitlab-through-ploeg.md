---
type: added
highlight: true
---
Connect GitLab from Settings → Connections: paste a temporary Owner token and a group, and Ploeg sets up its own service account and revokes your token.

If you already made a GitLab service account, paste its token instead. Then pick the projects agents may work in and register them. Unfold keeps no GitLab token; Ploeg holds the service account's token and gives each Run its own short-lived token for one project. Creating the service account needs a Ploeg release that includes it; until then the page says which release you need.
