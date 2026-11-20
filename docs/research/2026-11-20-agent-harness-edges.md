# Agent files × harnesses: where APM, Ploeg and the agents meet

Date: 20 November 2026, against `origin/development` at `50a1ca4d` plus pull requests #205 and #206, with Ploeg pinned at `0.2.0-rc.134` (commit [`1ba5d0e`](https://github.com/ploeg-hq/ploeg/tree/1ba5d0e19e705f4df752226c86a66788cf6d6aa4)) and APM at 0.35.0 (0.36.1 is the latest release). This is a record. It changes no decision by itself. [Agent instructions](../contributing/agent-instructions.md) is the current description of the pipeline. The work it proposes is in [section 7](#7-proposed-work).

> **Method.** Three research agents ran in parallel: one read the harness adapters in the pinned Ploeg source, one read the OpenHands software-agent-sdk at v1.63.1 and the OpenHands CLI at 1.16.0, and one generated a project with APM 0.35.0 and 0.36.1 in a lab and read each harness's documentation. I checked these first-hand: the Claude Code flags in `claudecode.go`, the hook set-aside in `openhands/hooks.go`, `OPENCODE_DISABLE_PROJECT_CONFIG` in `acp/profiles.go`, the instruction set in `work/instructions.go`, the writer brief in `taskprompt/prompt.go`, ADR-0139's sentence about `.agents/skills`, and the state of APM issues #3939, #4005, #4033 and #3047. Five probes ran on this machine (see [section 6](#6-probes)). Nothing ran in Codex, opencode, OpenHands or Copilot. Statements about those come from source or documentation and are marked.

## Verdict

**APM is the right single source for everything Claude Code, Codex and opencode read from a file, and since #205 it also writes the hooks. The real gaps are not in APM. They come from the context an agent runs in. Interactive sessions load nearly everything. Ploeg deliberately switches most repository configuration off. OpenHands, the Team's harness today, reads a different set of files than any APM target writes.** A rule that must reach every agent belongs in `AGENTS.md` or an `.apm/instructions` file without `applyTo`. A skill belongs in `.apm/skills` (it lands in `.agents/skills`, which Codex, opencode and OpenHands all read). A guard belongs in CI, because no hook runs inside a Ploeg Run.

Summary:

1. **Under Ploeg no repository hook runs.** Claude Code starts with `disableAllHooks` or without project settings. OpenHands has `.openhands/hooks.json` removed from its clone. opencode has project configuration switched off. Hooks protect people's own sessions only.
2. **With Team plugins, a Claude Code Run loads the repository's rules but none of its skills or commands** (probe). ADR-0139 assumes the Run is pointed at `.agents/skills`, but no Ploeg code does this.
3. **OpenHands reads `AGENTS.md`, `.agents/skills` and `.openhands/skills`, never `.claude/`.** APM has no OpenHands target, and the request for one is deferred. The always-on Team Silver skill and the OpenHands hook stay hand-written.
4. **APM 0.38 may break Unfold's Claude setup.** Open pull request microsoft/apm#4005 moves directory rules from `.claude/rules` into `AGENTS.md` and writes a `CLAUDE.md` that imports it. Unfold's `CLAUDE.md` is hand-written and does not import `AGENTS.md`, and Claude Code ignores `AGENTS.md` while a `CLAUDE.md` exists.
5. **Two APM gaps in Unfold's pipeline are closed in #205:** hooks APM did not write, and a nested `AGENTS.md` left behind when its rules are removed.

## 1. What each agent reads, by context

"Interactive" means a person's own session in a clone. "Under Ploeg" means a Run in the pinned release.

| | Root `AGENTS.md` | Nested `AGENTS.md` | `.claude/rules` | Skills | Commands | Hooks | Repository MCP |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code, interactive | not while `CLAUDE.md` exists [docs] | no | yes [probe] | `.claude/skills` [probe] | `.claude/commands` [probe] | `.claude/settings.json` [probe] | `.mcp.json` (none ships) |
| Claude Code under Ploeg, no plugins | through the brief | through the brief | yes [inferred] | `.claude/skills` [inferred] | yes [inferred] | none: `--settings '{"disableAllHooks":true}'` [code] | none: `--strict-mcp-config` [code] |
| Claude Code under Ploeg, Team plugins | through the brief | through the brief | yes [probe] | **none of the repository's** [probe] | **none** [probe] | none: `--setting-sources user` [code] | none [code] |
| Codex, interactive | yes, root to working directory, 32 KiB [docs] | only at or above the working directory [docs] | no | `.agents/skills` [docs] | none: `.apm/prompts` does not reach Codex [lab] | `.codex/hooks.json` once trusted [docs] | `.codex/config.toml` (none ships) |
| Codex under Ploeg | only through a `custom` ACP profile, which none ships; nothing is neutralised [code] | | | | | | |
| opencode, interactive | yes [docs] | lazily, walking up from a file [docs] | no | `.claude/skills` **and** `.agents/skills`, so each skill twice [docs] | `.opencode/commands` [docs] | `.opencode/plugins`, hand-written | `opencode.json` (none ships) |
| opencode under Ploeg | yes [Ploeg docs] | | no | Ploeg's skills only | none: `OPENCODE_DISABLE_PROJECT_CONFIG=true` [code] | none [code] | none [code] |
| OpenHands, standalone | yes, from the working directory and the git root [code] | from the working directory down, through `git ls-files` [code] | no [code] | `.agents/skills`, `.openhands/skills` [code] | none from files; a legacy skill with `inputs:` gets `/name` [code] | `.openhands/hooks.json` when the host loads it [code] | none at repository level [code] |
| OpenHands under Ploeg | yes | yes | no | as standalone, plus Ploeg's in `~/.openhands/skills/installed` [code] | none | none: the file is removed from the clone and a push that changes it is refused [code] | the gateway only [code] |

Tags: [probe] observed on this machine (section 6); [code] read in the pinned Ploeg source or OpenHands SDK v1.63.1; [lab] generated with APM; [docs] the harness's own documentation; [inferred] follows from the above but nobody observed it.

Every harness under Ploeg starts in the clone root with a fresh `HOME`, so nothing from a person's `~/.claude` or `~/.codex` reaches a Run ([worker.go#L503-L510](https://github.com/ploeg-hq/ploeg/blob/1ba5d0e19e705f4df752226c86a66788cf6d6aa4/pkg/worker/worker.go#L503-L510)). Ploeg sets neither `CLAUDE_PROJECT_DIR` nor `OPENHANDS_PROJECT_DIR`.

## 2. Claude Code

1. **The one-line `CLAUDE.md` is load-bearing.** Claude Code reads `AGENTS.md` only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in the working directory or above it ([memory docs](https://code.claude.com/docs/en/memory#agents-md)). That is what stops a double load of `AGENTS.md` plus `.claude/rules`. A person who adds a `CLAUDE.local.md` does not change this. Deleting `CLAUDE.md` would make Claude Code load every rule twice.
2. **`applyTo: "**"` is not always-on.** APM turns it into `paths: ["**"]`, which loads on the first file read, not at session start [lab]. An always-on rule has no `applyTo`.
3. **A session started in a subdirectory loads no root project settings.** With Claude Code started in `apps/unfold`, the debug log looked for `apps/unfold/.claude/settings.json`, and `git add -A` went through [probe]. The rules still arrive through the `CLAUDE.md` walk up [inferred]. This is Claude Code's behaviour and #205 does not change it.
4. **Plugin mode drops repository skills and commands** (probe 4). [ADR-0139](https://github.com/ploeg-hq/ploeg/blob/1ba5d0e19e705f4df752226c86a66788cf6d6aa4/docs/adrs/0139-a-team-declares-claude-code-plugins-pinned-to-a-commit-whose-hooks-run-guarded-with-only-their-declared-environment.md) accepts this because "ADR-0083 already points the Run at the repository's `.agents/skills`". The brief lists only Ploeg's own skills ([verify.go#L363-L366](https://github.com/ploeg-hq/ploeg/blob/1ba5d0e19e705f4df752226c86a66788cf6d6aa4/pkg/worker/verify.go#L363-L366)), and Claude Code does not scan `.agents/skills`.
5. **APM 0.38 convergence.** [microsoft/apm#3939](https://github.com/microsoft/apm/issues/3939) (milestone 0.38.0) and [pull request #4005](https://github.com/microsoft/apm/pull/4005) (open) move `**` and directory-prefix rules such as `apps/unfold/**` into `AGENTS.md` and generate a `CLAUDE.md` with `@AGENTS.md`. Unfold's rules would then reach Claude Code only if `CLAUDE.md` imports `AGENTS.md`. Renovate's APM bump recompiles in its own pull request, so `agents-check` shows the change there. It does not judge whether Claude Code still loads the rules.

## 3. Codex and opencode

1. **Codex gets no commands.** `.apm/prompts/unfold-review.prompt.md` becomes a Claude Code and an opencode command only. Codex has deprecated repository prompts in favour of skills ([custom prompts](https://developers.openai.com/codex/custom-prompts)). A procedure Codex needs is a skill.
2. **Codex trusts each hook by its hash.** A changed hook is skipped until the person trusts it again ([hooks docs](https://learn.chatgpt.com/docs/hooks)). Codex runs hooks in the session's working directory, which is why the command in #205 resolves the repository through `git rev-parse`.
3. **Codex reads nested `AGENTS.md` only from the root down to where it started.** `apps/unfold/AGENTS.md` and `.github/AGENTS.md` reach Codex only when it starts in that directory ([AGENTS.md docs](https://learn.chatgpt.com/docs/agent-configuration/agents-md)). The longest chain is about 8.8 KB, well under the 32 KiB limit.
4. **Ploeg has no Codex profile.** Codex reaches a Run only through a `custom` ACP profile, and Ploeg neither sets aside `.codex/hooks.json` nor scans `.codex/` ([acp-profiles.md](https://github.com/ploeg-hq/ploeg/blob/1ba5d0e19e705f4df752226c86a66788cf6d6aa4/docs/contracts/acp-profiles.md)). A future Codex profile has to decide what it does with `.codex/`.
5. **opencode lists each skill twice.** It reads `.opencode/skills`, `.claude/skills` and `.agents/skills`, and APM writes every skill to the last two ([skills docs](https://opencode.ai/docs/skills/)).
6. **opencode commands carry Claude Code frontmatter.** APM copies `allowed-tools` and `argument-hint` unchanged [lab]. opencode documents `description`, `agent`, `model` and `subagent` ([commands docs](https://opencode.ai/docs/commands/)). Unfold's one prompt sets only `description`, so nothing breaks today.
7. **Under Ploeg, opencode ignores everything under `.opencode/`**, the staging plugin included ([profiles.go#L144-L153](https://github.com/ploeg-hq/ploeg/blob/1ba5d0e19e705f4df752226c86a66788cf6d6aa4/pkg/harness/adapters/acp/profiles.go#L144-L153)).

## 4. OpenHands

1. **No APM target, and none planned.** APM 0.36.1 has no OpenHands target, and [microsoft/apm#3047](https://github.com/microsoft/apm/issues/3047) deferred new harnesses. Unfold's build still covers most of what OpenHands reads: root and nested `AGENTS.md`, and skills in `.agents/skills`.
2. **Always-on context needs the legacy format.** A plain `.openhands/skills/<name>/<name>.md` without `triggers` is injected into every Run. It still is in SDK v1.63.1, so `team-silver.md` keeps its name and format (#206). No APM primitive writes that file.
3. **OpenHands never reads `.claude/`.** Path rules in `.claude/rules` do not reach it. A rule for OpenHands lives in an `AGENTS.md`, which the nested `AGENTS.md` placement already gives it. Nested files are found from the working directory down only.
4. **`CLAUDE.md` is read only for Claude and Gemini models.** OpenHands skips the one-line `CLAUDE.md` for the Team's DeepSeek and GLM models, which is harmless.
5. **The hook under Ploeg.** The pinned Ploeg removes `.openhands/hooks.json` from the clone before the Run, restores it afterwards, and refuses a push that changes `.openhands/` ([hooks.go#L55-L82](https://github.com/ploeg-hq/ploeg/blob/1ba5d0e19e705f4df752226c86a66788cf6d6aa4/pkg/harness/adapters/openhands/hooks.go#L55-L82)). The 2026-10-11 probe in [Agent instructions](../contributing/agent-instructions.md#what-each-agent-reads) saw the hook run, but it ran OpenHands with Ploeg's brief outside Ploeg, so it shows standalone OpenHands, where the file still guards.
6. **Hooks have their own dialect.** OpenHands names its shell tool `terminal`, not `Bash`. It sets `OPENHANDS_PROJECT_DIR`, and only exit 2 blocks ([executor.py](https://github.com/OpenHands/software-agent-sdk/blob/722e5d403cf75d4e032b79296cfaf178f8678a93/openhands-sdk/openhands/sdk/hooks/executor.py#L30-L43)). It accepts Claude Code's `{"hooks":{"PreToolUse":…}}` wrapper, but a `Bash` matcher would never match. Unfold's file uses `*`.
7. **The CLI is frozen.** OpenHands CLI 1.16.0 is the last release and its README says it is no longer maintained. The SDK is at v1.63.1. A Team that moves to the SDK or Agent Canvas must switch on `load_project_skills`, because it defaults to `False`, and must call `load_hooks` itself ([agent_context.py#L121](https://github.com/OpenHands/software-agent-sdk/blob/722e5d403cf75d4e032b79296cfaf178f8678a93/openhands-sdk/openhands/sdk/context/agent_context.py#L121)).
8. **A possible single source later: plugins.** OpenHands loads Claude Code plugin layouts from `.agents/plugins/<name>/`: skills, commands as `/<plugin>:<command>`, `hooks/hooks.json` and `.mcp.json`. This was not tested end to end.

## 5. APM itself

| Edge | Status in Unfold |
| --- | --- |
| A hook entry APM did not write survives `install --force`, and `apm audit` passes ([#4033](https://github.com/microsoft/apm/issues/4033) is related) | Closed in #205: the `hooks` check in `scripts/agents-files.py` |
| Removing a hook source leaves the merged hook | Documented in #205. The `hooks` check confirms the files agree after a manual delete |
| Removing the last `applyTo` rule for a directory leaves its `AGENTS.md` behind | Closed in #205: `apm compile --clean` |
| `apm audit` does not hash `AGENTS.md` | Covered: `agents-check` recompiles and diffs |
| A lost executable bit on a skill script is neither restored nor reported | Git's file mode is the only guard. No Unfold skill script depends on it today |
| Relative links in `AGENTS.md` are copied unchanged to every depth | Avoided: rules link with absolute URLs |
| One hook command goes to every target | Handled in #205: the command finds the repository itself |
| Adding the `copilot` target would write `.github/instructions` next to `AGENTS.md`, giving a double load, and a hook in Claude Code's nested shape that Copilot probably never matches. Copilot also reads `.claude/settings.json` | Not adopted |

## 6. Probes

All five probes ran on 20 November 2026 with Claude Code and `--model haiku`, in a worktree of #205.

1. **Generated hook, root session:** `claude -p` started in the worktree root and asked to run `git add -A`. The session was blocked with `PreToolUse:Bash hook error: … Blocked: 'git add -A' stages the whole tree`.
2. **Subdirectory session:** the same request started in `apps/unfold`. `git add -A` went through. The debug log shows Claude Code looking for `apps/unfold/.claude/settings.json`.
3. **Rules, default and plugin mode:** with tools switched off, the session was asked to quote any instruction about `git add -A`. Both a default session and one started with Ploeg's plugin-mode flags (`--setting-sources user --add-dir <clone>`, `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`) quoted `.claude/rules/conventions.md`.
4. **Skills and commands, default and plugin mode:** the session was asked to list the available skills and commands matching `dependency`, `unfold-review` or `investigate`. The default session listed `explain-a-dependency-update`, `unfold-review` and `investigate-session`. The plugin-mode session listed none of the repository's, only a skill from the person's own home directory.
5. **Codex command shape:** the generated command, run with `sh -c` from `apps/` without `CLAUDE_PROJECT_DIR`, exited 2 with the block message. The relative form APM would otherwise write exited 2 because the script was missing, which in Codex blocks every call. This is a unit test in `scripts/stage-explicit-paths.test.py`.

## 7. Proposed work

Upstream in ploeg-hq/ploeg, which Unfold does not edit:

1. **Point a plugin-mode Claude Code Run at the repository's skills**, as ADR-0139 assumes. One way is to copy `.agents/skills` into the Run's `~/.claude/skills`. The other is to correct ADR-0139.
2. **Add `.codex/`, `.opencode/`, `opencode.json`, `.cursor/` and `.apm/` to the instruction set** in `work/instructions.go`, so they are scanned for hidden Unicode and pinned to the base branch for a reviewer.
3. **Name `.apm/` in the writer brief's out-of-scope list** next to `.claude/` and `.agents/`. Changing it regenerates the files the brief already protects.

In this repository:

4. **Correct the OpenHands row of [Agent instructions](../contributing/agent-instructions.md#what-each-agent-reads)** for the pinned Ploeg. This change does it.
5. **Re-check Claude Code loading when Renovate offers APM 0.38**, against microsoft/apm#4005: a headless probe like probe 3, from the root and with plugin flags.
6. **Decide where review-only procedures live for Codex.** `unfold-review` reaches Claude Code and opencode only. Make it a skill if Codex users need it.
7. **Consider OpenHands plugins** in `.agents/plugins/` only when a Team moves off the frozen CLI. Probe it first.

## Not verified

* Nothing ran in Codex, opencode, OpenHands or Copilot. Their rows come from source or documentation.
* Whether Claude Code under Ploeg without plugins loads `.claude/skills` and `.claude/commands`. It is inferred from the default session, which does.
* The text of Ploeg's embedded skills and of the OpenHands image's `docker-entrypoint.sh`. Neither is in the contract bundle.
* What APM 0.38 will write. Pull request #4005 is open and its code was not read.
