---
type: reference
audience: [owner, operator, integrator]
owner: unfold
last_verified: 2026-11-16
verified_by: "Generated from docs/integrations.yml; scripts/docs.py checks every entry against the provider names in the pinned Ploeg bundle (apps/ploeg/pkg/provider) and the branch and reference forms in apps/ploeg/pkg/work/branch.go"
---

# Integrations

Unfold works with the issue tracker and forge you already use. This page lists the ones Ploeg has a provider for and what each one changes in what you see. The other pages say "your issue tracker" or "your forge" and show these values when you hover them. Pick yours under **Shown for** and every page shows your values. To send someone a page that already shows a setup, add it to the link, for example `?tracker=clickup&forge=gitlab`.

<div data-unfold-setup></div>

## Issue tracker { #tracker }

Where people write and assign the work. Ploeg reads a task from it, and the task gets a comment with the pull request link. Ploeg names the agent's branch after the tracker and the task, and the prompt asks the agent to end each commit with the commit reference.

{{ tracker.table }}

## Forge { #forge }

Where the code lives. The agent pushes its branch there and opens the change for review.

{{ forge.table }}
