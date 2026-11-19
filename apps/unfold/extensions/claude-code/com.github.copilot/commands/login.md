---
description: Sign this machine in to Unfold; in a Copilot session it names the Claude Code route
argument-hint: "[status]"
---

This command runs the Unfold plugin's `scripts/unfold-login.mjs`. VS Code gives a Copilot session no path to the plugin's scripts, so this session cannot run it.

Tell the person exactly that, in one or two sentences, and name both routes: a Copilot session with the plugin starts Unfold's sign-in by itself when it starts without a credential, as long as `UNFOLD_URL` is set in the environment VS Code was started from; or open Claude Code and run `/unfold:login` with the same arguments.

Do not search for the script, do not run any command, never ask the person for a token, and do not try to do its work another way.
