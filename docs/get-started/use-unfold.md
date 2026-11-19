---
type: how-to
audience: [owner]
owner: unfold
last_verified: 2026-11-19
verified_by: "Read docs/how-to/assign-work-to-an-agent.md, review-an-agent-pr.md, follow-handed-off-work.md, ask-from-an-ai-client.md, install-the-unfold-plugin.md, docs/how-to/self-host-the-whole-stack.md step 5, apps/unfold/docs/operations/task-connections.md (hand-off and Report a problem) and apps/unfold/docs/operations/working-from-clickup.md headings. Not walked on an installation for this page."
---

# Use Unfold day to day

To hand work to agents and review what they deliver, use the installation your organisation runs. You hand over a task, follow it while agents work, and decide on the pull request. Unfold never merges: you do, on your forge.

## What you get

* One page, **Now**, that lists what waits for you, with the reason and the fix.
* Agent pull requests that arrive with an agent review, the checks and the spend against the budget.
* The same work in the browser, in VS Code and in MCP clients such as Claude Code.

## Before you start

* An account at your installation's sign-in. The person who runs the installation adds you to a role group and gives you the [Teams](../reference/glossary.md#team) you may use; without a Team you cannot hand work over ([Set up sign-in](../how-to/self-host-the-whole-stack.md#5-set-up-sign-in)).
* Access to the tracker and the forge your installation connected.
* A repository that is [prepared for agents](../how-to/prepare-a-repository.md). Ask the person who runs the installation if you are not sure.

## Steps

1. **Write the task as the whole brief.** The agents receive the task's title and description and nothing else, so put the [Acceptance Conditions](../reference/glossary.md#acceptance-conditions) there ([Assign the ticket](../how-to/assign-work-to-an-agent.md#assign-the-ticket)).
2. **Hand it over.** Assign the Team's tracker user in your tracker, or choose **Hand to Ploeg** on the Tasks page, or **Hand to** on Now once **The loop on Now** is on under Settings › Labs ([Hand it off from Now](../how-to/assign-work-to-an-agent.md#hand-it-off-from-now)). Unfold hands over from ClickUp and Vikunja; on GitHub Issues you use the label or assignee your installation set up ([Hand a task to Ploeg](../../apps/unfold/docs/operations/task-connections.md#hand-a-task-to-ploeg)). On ClickUp, follow [Working with Unfold from ClickUp](../../apps/unfold/docs/operations/working-from-clickup.md).
3. **Follow it.** Open **Now** to see what you handed off and what needs you. Turn on phone notices if you want them ([Follow the work you handed off](../how-to/follow-handed-off-work.md)). To stop work, see [Stop it](../how-to/assign-work-to-an-agent.md#stop-it).
4. **Review the pull request.** Under **Ready for your review**, read **Problem and solution**, then check it against the diff and the evidence ([Review an agent pull request](../how-to/review-an-agent-pr.md)). The agent reviewer's verdict is input, never a human review.
5. **Decide.** Merge on the forge, or send it back with a review that requests changes or a new assignment ([Send it back](../how-to/review-an-agent-pr.md#send-it-back)).
6. **Work from your own tools, if you like.** Connect an MCP client ([Ask Unfold and Ploeg from an AI client](../how-to/ask-from-an-ai-client.md)), install the plugin in Codex, Cursor, Copilot or VS Code ([Install the Unfold plugin](../how-to/install-the-unfold-plugin.md)), or use an ACP editor such as PhpStorm ([Use Unfold from an ACP editor](../how-to/use-unfold-from-an-acp-editor.md)).

## When something is wrong

* **Something in your installation misbehaves,** such as a page that errors or a hand-off that does nothing: use **Report a problem** in the application. It goes to the tracker your installation chose, so the people who run it see it.
* **Unfold itself has a bug** you can reproduce on any installation: open an issue at [github.com/unfold-hq/unfold/issues/new](https://github.com/unfold-hq/unfold/issues/new) with your own GitHub account. Leave out your repositories' data. A link in the application that opens this issue prefilled is proposed, not built.

## How you know it works

* After you hand a task over from Unfold, it shows on **Now** under what you handed off, and the task gets a comment that names the Team.
* When the agents finish, the Work Item reads `awaiting_review`, the task gets Ploeg's comment that ends in "Please review and merge", and **Ready for your review** on Now lists it ([What "ready for review" means today](../how-to/review-an-agent-pr.md#what-ready-for-review-means-today)).
* When you merge, the Work Item is `done` and the task gets a comment saying so. The task itself stays open unless your installation marks it done on merge ([After you merge or close](../how-to/review-an-agent-pr.md#after-you-merge-or-close)).
