---
type: added
---
The VS Code extension reaches a workbench behind an access gateway such as Cloudflare Access, with headers you store once per workbench.

Run **Unfold: Set Access Gateway Headers** and add the headers the gateway accepts, for example the two halves of a service token. They are kept in VS Code SecretStorage and sent to that workbench only. When a gateway is in the way, the extension now says so and names where the request was sent, instead of asking for a different server address.
