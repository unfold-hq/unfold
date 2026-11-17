---
description: Sign this machine in to Unfold through your browser, or show whether it is signed in
argument-hint: "[status]"
allowed-tools: Bash(node:*)
---

Run exactly this command once and show the person its output, nothing more:

```
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/scripts/unfold-login.mjs" $ARGUMENTS
```

Without an argument it starts Unfold's sign-in, opens the browser and returns at once; the plugin keeps the credential when the person approves. With `status` it says whether this machine is signed in and until when.

Never ask the person for a token, and never print or store one yourself.
