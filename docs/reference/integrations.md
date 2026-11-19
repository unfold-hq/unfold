---
type: reference
audience: [owner, operator, integrator]
owner: unfold
last_verified: 2026-11-19
verified_by: "Generated from docs/integrations.yml, which also generates the site's integrations page (apps/site/src/data/integrations.json). scripts/docs.py checks every Ploeg-owned adapter against the pinned Ploeg bundle: provider names in apps/ploeg/pkg/provider, connection methods in pkg/connection/config.go, runtime connectors in cmd/ploegd/runtime_connections.go, and branch and reference forms in pkg/work/branch.go and cmd/ploegd/references.go. Statuses of Unfold-owned adapters were read against apps/unfold/docs/product/at-a-glance.md and apps/unfold/src on 2026-11-19."
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

## Every port { #ports }

Unfold and Ploeg reach outside tools through ports: small interfaces with an adapter per tool behind them ([ADR-0050](../adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md)). Each table lists a port's adapters, who owns each one, what it does, how you connect it and what it speaks on the wire. **Configuration** means the installation sets it in Ploeg's or Unfold's configuration. **At runtime** names the methods Ploeg's connection flows accept, so an administrator can connect it from Unfold's **Settings › Connections** where Unfold offers that step ([ADR-0060](../adr/adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md)). The statuses mean what they mean on the site: Available is built and on once configured, In Labs is behind a feature flag that is off by default, Experimental is built but not yet proven against the real tool, and Planned is decided and not built.

The marketing site's integrations page is generated from the same file, so a change here changes it too: edit [`docs/integrations.yml`](../integrations.yml), then run `mise run integrations`.

{{ catalogue.ports }}
