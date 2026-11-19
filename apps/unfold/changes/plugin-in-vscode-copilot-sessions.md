---
type: added
highlight: false
---
The Unfold plugin now works in VS Code's Copilot chat too. Your Copilot sessions show up in Unfold as linked sessions, the Unfold commands and an Unfold agent are offered there, and Copilot treats what Unfold's tools return from trackers and agents as data, not instructions.

`/handback` works in a Copilot session through Unfold's tools. `/handoff`, `/takeover`, `/start`, `/login` and `/logout` need the plugin's scripts, so in Copilot they tell you to run them in Claude Code. A Copilot session is not reported as waiting or ended, and its commits carry no Agent Trace record.
