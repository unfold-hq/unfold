---
type: how-to
audience: [operator, developer, product-owner]
owner: unfold
last_verified: 2026-11-24
verified_by: "Read docs/how-to/connect-clickup.md, docs/how-to/assign-work-to-an-agent.md, docs/how-to/follow-handed-off-work.md, docs/how-to/review-an-agent-pr.md (merge row), apps/unfold/docs/operations/working-from-clickup.md, apps/unfold/docs/operations/task-connections.md (Hand a task to Ploeg, Connect ClickUp and bind Lists), apps/unfold/docs/operations/live.md (Linking ClickUp), apps/unfold/src/clickup-onboarding.ts, src/ploeg-connection-api.ts (startFlow), src/ploeg-steps.json, src/task-providers/clickup.ts, src/link-providers/clickup.ts, src/error-catalogue.ts, src/flag-registry.json (now.loop), public/views/connect-clickup.js, public/views/account.js, public/shell.js, public/start.js and public/views/tasks.js. The handOverAgent status was read from the pinned Ploeg bundle (cmd/ploegd/runtime_connections.go, cmd/ploegd/tracker_bindings.go, docs/how-to/let-operators-connect-trackers-and-forges.md) and Unfold PR #195. No test was run and nothing was run against a live installation, ClickUp Workspace or Ploeg."
---

# ClickUp onboarding

Your team keeps planning in ClickUp. A task assigned to the right ClickUp user becomes a Work Item, a Team of agents works on it, and the result is a pull request for a person to review.

**Status.** Connecting ClickUp from **Settings › Connect ClickUp** is what this Unfold offers. Unfold does not yet register the Unfold member as Ploeg's hand-over account (`handOverAgent`): it stopped asking when an older Ploeg refused it ([#195](https://github.com/unfold-hq/unfold/pull/195)), and the pinned Ploeg now supports it ([Hand work over by assigning the connection's own account](../../apps/ploeg/docs/how-to/let-operators-connect-trackers-and-forges.md#hand-work-over-by-assigning-the-connections-own-account)). Until Unfold asks again, which assignee hands a task over follows Ploeg's `trackers.clickup.agents`: with none set, every assignee on a bound List hands work over. This page was not walked on a live installation; the warning on [Connect ClickUp](../how-to/connect-clickup.md) predates the pinned Ploeg. The List picker is not served by any Ploeg release yet, so the page asks for the List id instead.

## Admin: connect ClickUp once

Before you start:

- You are an administrator of the Tenant in Unfold.
- You can invite a member to your ClickUp Workspace. The member Unfold works as takes one seat on a paid plan.
- At least one repository is ready for agents, and each Team you want to bind has a spend cap.

1. Create the ClickUp member Unfold works as: invite an address your agency controls, such as `unfold@your-agency.example`, as a **Member** (not a guest or an admin), and give it the Spaces or Lists Unfold should work in. ClickUp has no bot accounts, and a token always acts as the person who made it, so never use your own account.
2. Open the invitation in a private browser window, finish signing up as that member, then open the avatar menu, **Settings › Apps**, choose **Generate** under **API Token** and copy the token. It starts with `pk_`.
3. Open **Settings › Connect ClickUp**, paste the token into **API token of that ClickUp user** and choose **Hand the token to Ploeg**. If your installation has a ClickUp OAuth application, choose **Sign in to ClickUp as the Unfold member** instead of pasting. Unfold keeps no copy of the token.
4. If the page says Ploeg does not connect ClickUp from the screen, give the token to Ploeg's operator for Ploeg's own configuration instead: `trackers.clickup` with the token from the environment and the hand-over users in `trackers.clickup.agents` (chart: `tracker.clickup`, token in `tracker.clickup.tokenSecret`), as [Assign work to an agent](../how-to/assign-work-to-an-agent.md#configure-the-board-and-team) shows.
5. On the same page, choose **Choose a List to bind**, pick the **List**, the **Team** and the **Default repository**, and choose **Dry run** first. When the checks pass, choose **Bind**.

Done when: each bound List's line says "Bound to Team … ; Ploeg takes in tasks assigned to the Unfold member." (step 5). A List that stays amber waits for its webhook: Ploeg does not poll ClickUp.

Full detail: [Connect ClickUp](../how-to/connect-clickup.md) and [Connect ClickUp and bind Lists](../../apps/unfold/docs/operations/task-connections.md#connect-clickup-and-bind-lists).

## Developer: link your own ClickUp account

Linking your ClickUp account lets Unfold read ClickUp for you, with your own access. Task connections that have no token of their own show nothing to you until you link, and an administrator setting up a List on **Settings › Connect a tracker** picks it with their own link. Your link never hands work over, never goes to an agent workspace, and is never used to comment as you.

1. In ClickUp, open your avatar menu, **Settings › Apps**, and copy your **API Token** (it starts with `pk_`).
2. In Unfold, open **Settings › Linked accounts**. On the **ClickUp** card, paste the token into **Personal token** and choose **Save token**. If the card shows **Link ClickUp**, you may sign in with ClickUp instead.
3. The card now shows **Linked** and **Signed in as** with your ClickUp name.

When it works, the Tasks page shows the ClickUp tasks your account can see, under their ClickUp id, such as `WEB-12`.

When it fails: "ClickUp refused the linked account lookup with HTTP 401." means the token is wrong or was regenerated; copy it again. "ClickUp could not be reached to confirm the linked account." means try again in a minute. To stop using it, choose **Unlink ClickUp**; ClickUp has no way to revoke a token from outside, so also regenerate your token in ClickUp if you want it dead.

More: [Linking ClickUp](../../apps/unfold/docs/operations/live.md#linking-clickup) and [Working with Unfold from ClickUp](../../apps/unfold/docs/operations/working-from-clickup.md).

## Product owner: hand a ClickUp task to agents and follow it

1. Make the task Ready in ClickUp: the title and description are the whole brief the agents get, so write in the description what done means. Labels start nothing.
2. Hand it over by assigning the ClickUp user your administrator named for the Team, such as `unfold-bronze` (see Status for which assignees hand work over). Or hand it over from Unfold: with **The loop on Now** turned on under **Settings › Labs**, open **Now**, choose a task under **Up next**, and choose **Hand to** and the Team. The Tasks page offers the same **Hand to** button. Unfold then assigns the Team's ClickUp user for you and leaves the comment "Handed to Ploeg team … by … from Unfold." on the task.
3. Follow it in Unfold. **Now** shows it under its Team, and under **Handed off by you** when you handed it over from Unfold. Every row has **Open in ClickUp**. When it needs you, the row says why; choose **Answer** or **Try again** on the Work Item page.
4. In ClickUp, Ploeg comments with the outcome and the pull request link when the Team's attempt ends. Unfold writes no other progress back, and the ClickUp status does not change on its own: the task stays open after the merge unless Ploeg's operator set it to move the task to a done status (`PLOEG_TRACKER_DONE_ON_MERGE` with `PLOEG_CLICKUP_DONE_STATUS`).
5. To undo before a worker starts, choose **Take back** on Now or on the Tasks page, or remove the assignee in ClickUp. Once a worker has started, open the Work Item and choose **Cancel Work Item**.

The Work Item shows **Ready for review** with its pull request when the Team is done. You accept or send it back on the pull request; Unfold never merges.

More: [Working with Unfold from ClickUp](../../apps/unfold/docs/operations/working-from-clickup.md), [Follow the work you handed off](../how-to/follow-handed-off-work.md) and [Review an agent's pull request](../how-to/review-an-agent-pr.md).

## When something goes wrong

| What you see | Why | What to do |
| --- | --- | --- |
| "Ploeg cannot list this tracker’s containers." | Unfold shows this for any `capability_missing` from Ploeg | Connect ClickUp in Ploeg's configuration ([how-to](../how-to/connect-clickup.md#configure-clickup-in-ploeg-instead)) |
| "This Ploeg does not connect ClickUp from the screen yet" | The pinned Ploeg does not serve the step | Same: use Ploeg's configuration |
| "That is not a ClickUp personal API token, which starts with pk_. Copy the whole token again from ClickUp." | The pasted value has the wrong shape | Copy the whole token again |
| "That token belongs to your own ClickUp account, so Ploeg removed the connection again." | You pasted your own token, not the Unfold member's | Create the member called Unfold and paste its token |
| "This installation has a ClickUp OAuth application, so Ploeg takes no pasted token." | Ploeg expects a sign-in | Choose **Sign in to ClickUp as the Unfold member** |
| A bound List stays amber: "Ploeg holds the binding but ClickUp sends it nothing yet" | The ClickUp webhook has not delivered; Ploeg does not poll | Check the webhook, then **Check again** |
| "Ploeg no longer holds this binding, so tasks in this List reach nobody." | The binding was removed in Ploeg | **Bind again** |
| `task_write_forbidden` on **Hand to** | The connection's ClickUp user may not edit or comment on the task | An administrator gives that user edit and comment access to the List |
| A task you assigned never shows up in Unfold | The assignee routes to no Team, or the webhook is missing | Ask the administrator to check [If it fails](../how-to/assign-work-to-an-agent.md#if-it-fails) |
