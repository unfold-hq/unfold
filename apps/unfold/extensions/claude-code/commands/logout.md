---
description: Sign this machine out of Unfold and forget the credential the plugin kept
allowed-tools: Bash(node:*)
---

Run exactly this command once and show the person its output, nothing more:

```
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/scripts/unfold-login.mjs" logout
```

It signs the plugin's credential out of Unfold and removes it from this machine. Sessions stop reporting to Unfold until the person runs `/unfold:login` again.
