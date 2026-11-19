---
type: how-to
audience: [owner, operator]
owner: unfold
last_verified: 2026-11-19
verified_by: "Read apps/unfold/src/clickup-onboarding.ts, src/ploeg-connection-api.ts, src/ploeg-steps.json, src/task-providers/clickup.ts (the member guide) and public/views/connect-clickup.js; read the pinned Ploeg's pkg/connection/config.go, pkg/connection/service.go (the handOverAgent refusal), pkg/provider/clickup/connect.go and docs/how-to/let-operators-connect-trackers-and-forges.md. Not run against a live ClickUp Workspace or a deployed Ploeg."
---

# Connect ClickUp

Use this when your agency plans its work in ClickUp and you want Ploeg to take tasks from it. Result: Ploeg holds the token of a ClickUp member called Unfold, and the ClickUp Lists you bind send their tasks to a Team. Unfold keeps no ClickUp credential: it relays the token to Ploeg once ([ADR-0060](../adr/adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md)).

!!! warning "Refused by the pinned Ploeg until it allows `handOverAgent`"
    Unfold starts the connection with `handOverAgent: true`, so that assigning a task to the Unfold member hands it over. The Ploeg release Unfold is pinned to refuses that flag with `capability_missing` ("No adapter recognises an assignment to a per-connection agent yet"). Accepting it is planned upstream in Ploeg. Until a Ploeg release serves it, the paste in step 3 is refused with that message, and the way to connect ClickUp is Ploeg's own configuration: see [Configure ClickUp in Ploeg instead](#configure-clickup-in-ploeg-instead).

## Before you start

- You are an administrator of the Tenant in Unfold.
- Ploeg's operator lets Unfold connect ClickUp at runtime. In Ploeg's configuration, `connections.enabled` is on, `connections.allow` has an entry with `port: tracker`, `kind: clickup`, `instance: clickup` and `methods: [token]`, a connection secret store is configured, and Unfold's consumer may read tracker connections. [Let operators connect trackers and forges](../../apps/ploeg/docs/how-to/let-operators-connect-trackers-and-forges.md) explains each part.
- The `clickup` instance has no OAuth application. With one, Ploeg refuses a pasted token (`oauth_required`); use **Sign in to ClickUp as the Unfold member** instead, which sends you to ClickUp and relays the code to Ploeg.

## 1. Open Connect ClickUp

In Unfold, open **Settings › Connections**. Its **Connect ClickUp** line opens the page (the address is `#settings/connect-clickup`). The page says whether this Ploeg serves each step; a step it does not serve says which Ploeg record it waits for.

## 2. Create the member Unfold works as

ClickUp has no bot accounts, and a token always acts as the person who created it. Unfold therefore works in ClickUp as a normal member called Unfold, which takes one seat on a paid plan. Using your own account would make Unfold's comments look like yours and stop its webhook when you leave.

1. Invite an address your agency controls, such as `unfold@your-agency.example`, to your ClickUp Workspace as a Member, not a guest or an admin, and give it the Spaces or Lists Unfold should work in.
2. Open the invitation in a private browser window and finish signing up as that member.
3. In that window, open the avatar menu, then **Settings › Apps**, choose **Generate** under **API Token** and copy the token. It starts with `pk_`.

## 3. Paste the bot account's token

Paste the token into **API token of that ClickUp user** and choose **Hand the token to Ploeg**. Unfold checks that it looks like a ClickUp token, starts Ploeg's `token` connection flow and hands the token to Ploeg once. Ploeg checks it with ClickUp, stores it in its own secret store and reports the account and the Lists it can see. Unfold shows "Ploeg holds the member's token now. Unfold kept no copy."

## 4. Bind Lists to a Team

Choose **Choose a List to bind**, pick a List, the Team that should work on it and the ready repository its tasks go to, and choose **Dry run** first. The checks say what Ploeg would refuse. Choose **Bind** when they pass; its line on the page shows whether Ploeg reports the binding active.

## Configure ClickUp in Ploeg instead

An installation that sets ClickUp in Ploeg's configuration needs no step in Unfold. Ploeg reads `trackers.clickup` with the Unfold member's token from the environment and the member in `trackers.clickup.agents`; in Ploeg's chart the same settings are `tracker.clickup`, with the token in `tracker.clickup.tokenSecret`. The [configuration reference](../../apps/ploeg/docs/reference/configuration.md) lists every key. Unfold's checklist then shows **Connect ClickUp** as configured by the installation, and the connection cannot be removed from Unfold.

## Related

- [Integrations](../reference/integrations.md#port-trackers): what Ploeg and Unfold do with ClickUp, and how it connects.
- [Connect GitLab](connect-gitlab.md), the same pattern for a forge.
