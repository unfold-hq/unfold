---
type: added
---
In VS Code 1.147's Agents window, each finished Round of a Work Item shows the tokens its Runs used in the turn's usage hover.

The hover adds cache-read tokens when Ploeg recorded them for every Run of the Round, and names the model when every Run reported the same single one. A Round still running, a Round with a Run whose usage Ploeg has not recorded, and the demo show no usage rather than zero.
