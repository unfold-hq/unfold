---
type: security
---
The agent workspace image no longer ships node-gyp, which carried a picomatch with a high-severity ReDoS (GHSA-fc5q-39xc-vjpf) that has no fix yet.

The image has no compiler, so node-gyp could never build a native module there; an `npm install` that needs one fails as before.
