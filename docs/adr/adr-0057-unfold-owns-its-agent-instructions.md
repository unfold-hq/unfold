---
status: accepted
date: 2026-11-16
decision-makers: Ryan Grippeling
---

# Unfold owns its agent instructions, and APM generates them from `.apm/` alone

## Context and Problem Statement

Until now Unfold's agent instructions came partly from a shared standard of the organisation that hosted the project. `apm.yml` pinned three of its packages from that organisation's forge: shared rules, a secrets hook with two secrets skills, and a board package with a tracker MCP server reached through that organisation's gateway and two ticket skills. A wrapper CLI, fetched from the same forge by `mise run agents-install` and `mise run agents-check`, ran APM and checked the result against a policy file on that forge.

Since Unfold moved to `github.com/unfold-hq/unfold` ([ADR-0055](adr-0055-github-unfold-hq-is-the-project-home.md)), that dependency breaks and misleads. A GitHub runner reaches the forge, but the policy URL answers with an HTML page, so `agents-check` failed on every pull request and ran without blocking. The packaged rules told agents about another organisation's secret store, homelab, forge CI and tracker, which a contributor to a public project neither has nor needs. The MCP configuration pointed every agent at a private gateway.

Where do Unfold's agent instructions come from, and what generates and checks the files agents read?

## Decision Drivers

* A contributor can regenerate and check the agent files with only what the repository pins, on any runner.
* Every rule an agent reads is true for Unfold and names no other organisation's hosts, tools or people.
* A generated file that drifts from its source fails a blocking check.
* The least machinery that does this.

## Considered Options

* Unfold owns its sources in `.apm/`, and the APM CLI pinned through mise generates and checks them
* Keep the shared packages and the wrapper, and serve the policy from a URL GitHub can read
* Replace APM with a script in `scripts/` that copies `.apm/` into the generated files

## Decision Outcome

Chosen option: "Unfold owns its sources in `.apm/`, and the APM CLI pinned through mise generates and checks them", because the wrapper only ran `apm install` and `apm compile` and added checks Unfold already has, and APM is already what writes the files.

1. `apm.yml` has no dependencies. The shared rules that hold for Unfold become [`.apm/instructions/conventions.instructions.md`](../../.apm/instructions/conventions.instructions.md), rewritten as Unfold's own: no secret values in files, delivery through a pull request against `development`, explicit staging in a shared working tree, Conventional Commits, Renovate-owned versions, no comments in code, docs that change with the behaviour, and plain reporting of gates.
2. Dropped, because they describe the former host and not Unfold: the forge CI rule, the secret-level and secrets-floor skills with their edit hook, the tracker MCP server, the ticket skills and the board overlay that extended them. `.agentstd.toml` goes with the wrapper.
3. `apm-cli` is a mise tool. `mise run agents-install` runs `apm install --force --no-policy` and `apm compile`. `mise run agents-check` runs `apm audit --ci --no-policy`, compiles again and fails with a diff when a generated file changed. The `agents-check` job blocks the `gate`.
4. Renovate bumps `apm-cli` through the mise manager and recompiles in the same pull request.

### Consequences

* Good, because nothing in the agent pipeline reaches a host outside the repository's pins, and the check blocks again.
* Good, because every rule an agent reads is about Unfold.
* Bad, because a change to a shared convention no longer arrives by a version bump; Unfold edits its own copy.
* Bad, because no hook scans an agent's edit for a plaintext secret any more. Ploeg already started agents with hooks turned off, so this changes interactive sessions only.
* Bad, because the wrapper's session token budget check is gone; `scripts/agents-files.py` still enforces the Codex size limit on every `AGENTS.md`.

### Confirmation

* `mise run agents-check` passes on a clean checkout and fails, printing the diff, after a hand edit to any generated `AGENTS.md` or `.claude/rules` file.
* `git grep -n -i -E 'agent-standards\.git|agentstd' -- apm.yml mise.toml .github` finds nothing.

## Pros and Cons of the Options

### Keep the shared packages and the wrapper

* Good, because shared rules keep arriving by a version bump.
* Bad, because the repository keeps depending on a private forge and on rules written for another organisation.

### A script in `scripts/` instead of APM

* Good, because no third-party tool is involved.
* Bad, because Unfold would rebuild APM's placement of nested `AGENTS.md`, its rule, skill and command targets per harness, and its lockfile, with tests of its own.

## More Information

* 2026-11-16 — Decided by the owner. [Agent instructions](../contributing/agent-instructions.md#how-the-files-are-generated) describes the pipeline.
* 2026-11-20 — Hooks come from `.apm/hooks/` as well: APM merges them into `.claude/settings.json` and `.codex/hooks.json`, and `scripts/agents-files.py` fails on a hook APM did not write. opencode and OpenHands have no APM hook target and keep their hand-written twins ([Agent instructions](../contributing/agent-instructions.md#how-the-files-are-generated)).
* 2026-11-20 — `apm.yml` gains a `pre-install` lifecycle script that generates the `openspec-*` skills into `.apm/skills/` with the OpenSpec version pinned in `mise.toml` and a fixed OpenSpec configuration, so they are sources like Unfold's own skills. `mise run agents-install` trusts the script before it installs; `agents-check` compares `.apm/skills` too.
