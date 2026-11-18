---
type: security
highlight: false
---
The agent image carries a reviewed OpenVEX statement for picomatch's CVE-2026-112366, which no picomatch release fixes yet.

Scanners that read the image's OpenVEX attestation report it as not affected: the only copy is node-gyp's, and node-gyp globs fixed patterns, so no outside input reaches picomatch as a pattern. The image build fails if that stops being true, and the statement expires on 2026-12-18.
