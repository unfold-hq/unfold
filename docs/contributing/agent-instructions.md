---
type: reference
audience: [contributor, agent]
owner: unfold
last_verified: 2026-11-20
verified_by: "OpenHands row measured with 18 headless OpenHands 1.16.0 runs on 2026-10-11; the hook outcome reproduced with and without a mise shim under a fresh home. Load matrix from Ploeg's adapters (apps/ploeg/pkg/harness/adapters, pkg/worker/adapters.go, task.go) and the staging cluster Team configuration; Claude Code rows measured with headless probes on 2.1.296 (PR #308). OpenHands, opencode and Codex rows marked inferred were read from their sources and docs, not measured. Codex app import: source-command-* folders written by the openai.chatgpt extension with external-agent-import-sync-enabled = true, checked 2026-10-17 (they stopped after setting it to false). The generation and check pipeline was run with APM 0.35.0 on 2026-11-16, and agents-check was seen failing on a hand-edited apps/unfold/AGENTS.md. The hooks pipeline was run with APM 0.35.0 on 2026-11-20: agents-check failed on a hand-edited .codex/hooks.json, agents-files.py failed on a hand-added hook in .claude/settings.json, and the generated command blocked git add -A with exit 2 when run from apps/ without CLAUDE_PROJECT_DIR. Codex hook behaviour (session cwd, trust before a project hook runs) read from learn.chatgpt.com/docs/hooks, not observed in a Codex session."
---

# Agent instructions

Where each kind of knowledge about working on Unfold lives, and what each agent reads. One kind of rule has one home; a second copy is replaced with a link.

## Where each thing goes

| Content | Home |
| --- | --- |
| Commands an agent cannot guess, repository-wide traps, pointers to docs | [`.apm/instructions/repo.instructions.md`](https://github.com/unfold-hq/unfold/blob/development/.apm/instructions/repo.instructions.md), no `applyTo` |
| Conventions for every change (commits, secrets, comments, shared working tree) | [`.apm/instructions/conventions.instructions.md`](https://github.com/unfold-hq/unfold/blob/development/.apm/instructions/conventions.instructions.md), no `applyTo` |
| Rules for one application or directory | `.apm/instructions/<name>.instructions.md` with an `applyTo` glob, for example `apps-unfold`, `apps-site`, `github` |
| Anything that must hold every time | a test, a CI job or a hook; the file may point at it |
| A guard that runs before an agent's tool call | a hook in `.apm/hooks/<name>.json`, which `mise run agents-install` merges into `.claude/settings.json` and `.codex/hooks.json`; the opencode and OpenHands twins are written by hand, see below |
| Product knowledge, flows, reasons | `docs/` and the application's `docs/`, linked from the rules with absolute forge links |
| Decisions | ADRs ([System decisions](../adr/index.md)) |
| Requirements for a change | an OpenSpec change under `openspec/changes/` |
| Terms | the product model, [`docs/domain/model.yaml`](../domain/model.yaml), generated into the [glossary](../reference/glossary.md) |
| A procedure needed sometimes | a skill in `.apm/skills/<name>/`; OpenSpec installs its own `openspec-*` skills |
| A procedure a person starts | a prompt in `.apm/prompts/<name>.prompt.md`, which `mise run agents-install` writes as the `/<name>` command for Claude Code and opencode; the `/opsx:*` commands are OpenSpec's own |
| Review criteria | the [review guide](review.md) |
| Facts and pitfalls Ploeg packs into a Run's brief when they match the Work Item | `knowledge/` (OKF): a short concept with tags a Work Item would use and a link to the page that owns it, never a copy of a rule |
| One person's preferences | that person's tool configuration (`~/.claude/`, `~/.codex/`), never this repository |
| Open work | a ticket |

Everything above is a source; `mise run agents-install` generates what agents read. Claude Code reads `.claude/rules` (a rule with `applyTo` loads when Claude reads a matching file) and the skills in `.claude/skills`; `CLAUDE.md` is the one line that points there and imports nothing, which also stops Claude Code from reading `AGENTS.md` and loading every rule twice. Codex, opencode, Ploeg and OpenHands read the generated `AGENTS.md`, nested where a rule concerns one directory. Rules for `.github/` land in `.github/AGENTS.md`. APM puts a rule at the root once its `applyTo` matches most folders that hold files, and `apps/unfold` holds most of this repository's folders, so `apm.yml` excludes every folder below an application's top folder from that count; each application's rules then stay in its own `AGENTS.md`. Never edit a generated file.

## How the files are generated

Unfold owns every rule, skill and prompt it gives agents; none comes from another repository ([ADR-0057](../adr/adr-0057-unfold-owns-its-agent-instructions.md)). [Microsoft APM](https://github.com/microsoft/apm) (`apm-cli`, pinned in `mise.toml`) turns `.apm/` into the files agents read. [`apm.yml`](https://github.com/unfold-hq/unfold/blob/development/apm.yml) names the targets and has no dependencies, and `apm.lock.yaml` records the hash of every file APM deployed. The lockfile and every generated file are committed, so Ploeg and OpenHands see them without running APM.

- Edit `.apm/`, then run `mise run agents-install` (`apm install --force --no-policy`, then `apm compile --clean`, which also deletes an `AGENTS.md` whose rules are gone) and commit what it writes. Never edit a generated file.
- Link to repository files with absolute links to `https://github.com/unfold-hq/unfold/blob/development/`: APM copies a rule to `.claude/rules` and to `AGENTS.md` files at different depths, so a relative link breaks in one of them. A skill may link relative to its own folder.
- `mise run agents-check` runs `apm audit --ci --no-policy`, which fails on hidden Unicode or a deployed file whose hash differs from `apm.lock.yaml`, then compiles `.apm` again and fails when a generated file (`AGENTS.md` at any depth, `apm.lock.yaml`, `.agents/`, `.claude/`, `.codex/`, `.opencode/`) differs from what it was before, printing the diff. It compares against the files on disk, not the last commit, so it passes on uncommitted work that is already regenerated. It runs in the `agents-check` job of every pull request, and the `gate` job requires it.
- `--no-policy` skips APM's search for an organisation policy: Unfold has none, and the repository's own rules are the policy.
- Hooks come from `.apm/hooks/`. APM merges each into `.claude/settings.json` and `.codex/hooks.json` and lists what it wrote in `.claude/apm-hooks.json` and `.codex/apm-hooks.json`; a hook in either file that APM did not write fails [`scripts/agents-files.py`](https://github.com/unfold-hq/unfold/blob/development/scripts/agents-files.py), because APM keeps it on every install and nothing else would remove it. APM sends one command to every target, and Codex runs it in the session's working directory with no project variable, so a command finds the repository with `${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}` and never with a relative path: a missing script exits 2, which blocks every call. APM has no opencode or OpenHands hook target, so `.opencode/plugins/stage-explicit-paths.js` and `.openhands/hooks.json` stay written by hand and call the same [`scripts/stage-explicit-paths.py`](https://github.com/unfold-hq/unfold/blob/development/scripts/stage-explicit-paths.py). Ploeg starts Claude Code with `disableAllHooks`, so hooks protect interactive sessions only.
- Removing a hook from `.apm/hooks/` does not remove what APM 0.35 merged; delete its entry from both deployed files and both `apm-hooks.json` files in the same commit, and `agents-files.py` confirms they agree.
- No MCP server is configured for the repository. Add one to `apm.yml` under `dependencies.mcp`, with any key read from the environment, so APM writes it for every agent.

## Who owns a term

Ploeg owns a term when Ploeg stores it or its API names it, such as Run, Shift, Verdict and every state and code the operator API sends. Unfold owns presentation, product, billing and card terms. Unfold imports a Ploeg term in [`model.yaml`](../domain/model.yaml) instead of defining it again, and moves any product-only clause into one of its own terms, as Tenant and Client did in pull request #339 on the previous forge. What the screen calls each Ploeg value is in [Ploeg words and screen words](../reference/ploeg-words.md), which `apps/unfold/test/ploeg-contract.test.ts` checks against Ploeg's published schemas.

## What each agent reads

| Agent | Root `AGENTS.md` | Nested `AGENTS.md` | `.agents/skills` | Repository hooks |
| --- | --- | --- | --- | --- |
| Claude Code, interactive | yes | when it reads a file under that directory | yes, through the link | `.claude/settings.json`, generated from `.apm/hooks/`, runs |
| Claude Code under Ploeg | yes | as above | yes | none: Ploeg starts it with `disableAllHooks` |
| OpenHands under Ploeg (Unfold's Team today) | yes (probe: 6 of 6 quoted it without opening a file) | when Ploeg's brief says to read the nearest one (probe: 6 of 6 read `.forgejo/AGENTS.md` before editing a workflow) | yes, plus `.openhands/skills` (probe: 6 of 6 saw a repository skill's description) | `.openhands/hooks.json` runs before every tool call (seen in every probe run); it blocks only when the hook's `python3` starts, see below |
| opencode | yes | when it walks up from a file (inferred) | yes (inferred) | `.opencode/plugins/` run (inferred; not yet observed) |
| Codex | yes | only from the root down to the working directory | yes (inferred) | `.codex/hooks.json`, generated from `.apm/hooks/`, runs once the person trusts it in Codex; not observed to run |

Ploeg starts every agent with a fresh home directory, so nothing from a person's `~/.claude` or `~/.codex` reaches a Run. It installs its own skills, `ploeg-verify-before-handoff` and `ploeg-review-against-work-item`, outside the clone.

The Codex app's external agent import (`external-agent-import-sync-enabled` under `[desktop]` in `~/.codex/config.toml`) copies each `.claude/commands/*.md` into `.agents/skills/source-command-<name>/`, and through the `.claude/skills` link Claude Code then lists every command twice. Codex reads `.agents/skills` itself and OpenSpec installs Codex's own `openspec-*` skills, so the copies are never needed: `.gitignore` keeps them out of commits, and setting the option to `false` stops them appearing.

The OpenHands row was measured on 2026-10-11 with OpenHands 1.16.0, team silver's models (DeepSeek V4.1 Flash and GLM 5.3 Flash through LiteLLM), a fresh home directory and Ploeg's own brief wording, three runs per model. A hook only blocks with exit code 2; any other failure lets the call through. In the probe the hook's `python3` resolved to a mise shim, which refuses to run without a trusted configuration under a fresh home, so the hook exited 1 and `git add -A` went through in all six runs. With the runner image's own Python (it has no mise) the same hook exits 2 and blocks. When a guard matters, run its command once in the harness's real environment, home directory and `PATH` included.

## Adding a line

Add a rule only after the same mistake happened twice, and only when no test, hook or check can enforce it. Put it in the narrowest `.apm/instructions` file that covers it, with the narrowest `applyTo`, and its reason in one clause. `mise run agents-check` checks the generated files; `mise run docs-check` runs [`scripts/agents-files.py`](https://github.com/unfold-hq/unfold/blob/development/scripts/agents-files.py), which checks the Codex size limit, links, named commands, hidden Unicode, sentences repeated from the root file, hooks that APM did not write, and the `knowledge/` bundle (fields, resources, index, no copied rules). `go run ./cmd/ploeg-okf pack -title "<Work Item title>" ../../knowledge` from `apps/ploeg` shows which concepts a Work Item would receive.

A rule earns its place by changing what an agent does. Probe it before and after with headless runs on the cheapest model that shows the mistake; a rule no probe needs is removed. On 2026-10-11 the Forgejo `enabled` rule took a small model from 4 of 10 correct to 10 of 10, while a mise lockfile rule changed nothing and was dropped.
