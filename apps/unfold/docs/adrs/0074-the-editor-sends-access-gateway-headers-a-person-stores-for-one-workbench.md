---
status: proposed
date: 2026-11-18
decision-makers: Ryan Grippeling
review-by: 2027-02-18
---

# The editor sends access gateway headers a person stores for one workbench

## Context and Problem Statement

Some self-hosted installations put an access gateway in front of the workbench: an identity-aware proxy that sends a browser to a sign-in page before any request reaches Unfold. A browser passes the gateway and then signs in to Unfold. The VS Code extension does not: it is no browser, and it refuses every redirect so that a credential can never follow one ([ADR 0007](0007-thin-editor-client.md)). Behind such a gateway every call ended in "The API redirected the request. Configure the final workbench origin", which sent the person looking for a different address when the address was right. The extension's guide called this "browser-only SSO interception" and left it unsupported.

How does a developer use the extension against a workbench behind an access gateway, without the extension learning any one gateway's sign-in and without weakening the rule that credentials go to one origin only?

## Decision Drivers

* The audience is developers. They know request headers and service tokens, and they will be given exactly that by whoever runs the gateway.
* No gateway vendor in the code. Unfold integrates through standards ([system ADR-0050](../../../../docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md)); the gateways people run differ, and each has its own sign-in.
* The gateway's credential is a second credential. It gets the care the first one gets: SecretStorage, one origin, never a setting, never the webview ([ADR 0007](0007-thin-editor-client.md), [ADR 0037](0037-an-editor-signs-in-only-after-its-person-approves-it-and-gets-its-own-credential.md)).
* A gateway in the way must never look like a wrong address or an expired Unfold sign-in.
* The smallest thing that works. The extension keeps zero runtime dependencies and starts no process.

## Considered Options

* **The extension sends request headers a person stores for one workbench origin** (chosen)
* The extension runs a helper command that prints the headers
* The extension performs one gateway's sign-in itself
* Exempt the API from the gateway
* Leave it unsupported and reach such a workbench another way

## Decision Outcome

Chosen option: **the extension sends request headers a person stores for one workbench origin**, because a fixed credential in a request header is the one thing access gateways have in common, and it needs no code that knows a gateway.

### The headers

**Unfold: Set Access Gateway Headers** lists the headers stored for the connected workbench by name and lets the person add, replace and remove them. A value is typed into a masked box and never shown again. The set is one JSON object in VS Code SecretStorage under `unfold.gateway:<origin>`, beside the sign-in under `unfold.session:<origin>` ([`client.ts`](../../extensions/vscode/src/client.ts), [`gateway.ts`](../../extensions/vscode/src/gateway.ts)).

The client reads the set before every request and sends it with API calls, the event stream and candidate downloads. Three limits keep it from becoming a way around the rest of the design:

* A header the client sets itself or that frames the request is refused as input and dropped when read back: `Accept`, `Authorization`, `Connection`, `Content-Length`, `Content-Type`, `Cookie`, `Expect`, `Host`, `Keep-Alive`, `Origin`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade` and `X-Unfold-Request`. So a stored header can neither replace the Unfold credential nor defeat the cross-site check.
* A name is an HTTP token of at most 64 characters and a value one line of printable ASCII of at most 8192; a workbench takes at most 16. A name is one header whatever its case.
* The headers go to the origin they were stored for and nowhere else. The client still follows no redirect.

**Sign Out** leaves the headers in place, because they admit the editor to the gateway and say nothing about who is signed in to Unfold. The same command removes them.

### Naming what answered

The workbench never redirects a route the editor calls, and since its first release it has named every refusal as `{ "error": { "code", "message" } }`. The client uses that to tell who answered ([`gatewayFault`](../../extensions/vscode/src/client.ts)):

* A redirect to the same path on another origin is a moved workbench: `redirect`, and the message names the origin to connect to.
* Any other redirect is something in front of the workbench: `gateway_sign_in`. The message names the host, or the path on the same host, that the request was sent to, never its query, which carries the gateway's state.
* A 401 or 403 whose body does not name a fault that way is the gateway refusing: `gateway_refused`. The content type does not decide it, because a gateway may refuse in JSON too: Cloudflare Access answers an unknown service token with a JSON 401 of its own shape. The fault carries no HTTP status, so the code that handles an expired Unfold sign-in does not run, and the stored Unfold credential is kept. Before this decision any 401 deleted it.

Both gateway faults offer **Set Access Gateway Headers** on the error, the status bar reads **Unfold: access gateway**, and the tools for agents in VS Code chat name the command. The messages differ by whether headers are stored: without them they say what to store, with them that the gateway did not accept what is stored.

### What it does not cover

The headers are fixed. A gateway whose credential lives minutes, or that takes it only in `Authorization` or a cookie, is not served. VS Code's Agents window dials the workbench's WebSocket address itself and takes no headers, and the Ploeg server the extension provides to VS Code chat is a URL only; neither passes a gateway through this decision.

### Consequences

* Good, because a developer behind any gateway that takes a header credential connects with one command, and the operator's side is a credential and a policy that admits it.
* Good, because the extension gained no dependency, no process and no vendor name in its code.
* Good, because a gateway in the way now reads as one, and no longer signs the editor out of the workbench.
* Bad, because a service token is one secret on every laptop that holds it: it names no person at the gateway, and it has to be rotated when someone leaves. Unfold's own sign-in still names the person on every request.
* Bad, because a credential that expires has to be replaced by hand.
* Bad, because the Agents window stays unreachable behind a gateway until the gateway exempts its address or VS Code lets a host entry carry headers.
* Neutral: the gateway sees the editor's requests with its own credential and Unfold's. That was already true of the browser.

### Confirmation

* [`test/client.test.ts`](../../extensions/vscode/test/client.test.ts) runs the client against a local server that redirects to a sign-in page until it sees the stored headers: the three request kinds fail as `gateway_sign_in` without them and succeed with them, the Unfold cookie and `X-Unfold-Request` travel beside them, the sign-in page is never called, and the Unfold credential survives. A gateway's refusal in JSON, in HTML or in a body too large to be a fault leaves the Unfold credential on all three request kinds, a 403 from the workbench leaves it too, and the workbench's own 401 removes it. The input rules, the per-origin key and each message are pinned.
* [`test/gateway.test.ts`](../../extensions/vscode/test/gateway.test.ts) drives the command's list with a scripted person: add, replace by another case, remove, remove all, leave a prompt, and that no value appears in anything shown.
* Removing the headers from the request, the reserved-name check, the fault-shape test on a refusal or the host-only destination each fails these tests.
* Checked by hand on 2026-11-18 with this client against an installation behind Cloudflare Access: without headers the call fails as `gateway_sign_in` and names the gateway's sign-in host; with a service token Access does not know it fails as `gateway_refused`.
* Not checked: a service token the gateway admits, a desktop VS Code, and platform SecretStorage.

## Pros and Cons of the Options

### The extension runs a helper command that prints the headers

A setting names a command; the extension runs it and sends the JSON object it prints, as Claude Code does for telemetry ([ADR 0073](0073-the-plugin-carries-the-opentelemetry-headers-helper-that-signs-usage-metrics-with-the-identity-provider.md)).

* Good, because a short-lived credential per person works, with no shared secret at rest.
* Bad, because the extension would start a process on every refresh or keep a cache with its own expiry rules, and a setting that names a command is a way to run code that has to be kept out of workspace scope.
* Neutral: it can be added beside stored headers later, without changing them.

### The extension performs one gateway's sign-in itself

* Good, because the person signs in as themselves and pastes nothing.
* Bad, because every gateway signs in its own way, so the extension would carry one vendor's flow or binary and still not serve the others.

### Exempt the API from the gateway

* Good, because every client works at once and the extension needs no change.
* Bad, because the browser uses the same API, so the gateway would guard only the static page; whoever put the gateway there wanted two controls.
* Neutral: it remains the operator's choice, and nothing here prevents it.

### Leave it unsupported and reach such a workbench another way

* Good, because nothing is built.
* Bad, because a workbench that knows its public address refuses a change whose `Origin` is another, so a tunnel under another name does not work, and a developer on a gated installation has no editor client at all.

## More Information

* The [extension guide](../../extensions/vscode/README.md#connect-through-an-access-gateway) has the steps for a person; [Live operation](../operations/live.md#behind-an-access-gateway) says what each client needs from the gateway's operator.
* HTTP field names and values: [RFC 9110, section 5](https://www.rfc-editor.org/rfc/rfc9110#section-5).
* Amends [ADR 0007](0007-thin-editor-client.md): the editor still rejects redirects and still binds credentials to one validated origin; it now holds a second credential for that origin.

### History

* 2026-11-18: proposed with its implementation.
