---
status: accepted
date: 2026-11-17
decision-makers: Ryan Grippeling
review-by: 2027-01-03
---

# An editor signs in only after its person approves it, and gets its own credential

## Context and Problem Statement

The VS Code extension signs in through the browser ([ADR-0016](0016-sign-in-and-link-your-own-accounts.md), [ADR-0007](0007-thin-editor-client.md)). Until this decision, anyone could call `POST /api/auth/editor` without signing in and receive a ticket `code`, a `secret` and a sign-in URL. Whoever opened that URL and signed in with the identity provider completed the ticket: the OIDC callback minted a second browser session for that person and bound it to the ticket, and the caller who held the secret collected it by polling. Nobody was asked to approve anything.

That is a phishing kit. An attacker starts a ticket, sends the URL to a colleague ("can you look at this Work Item?"), the colleague signs in as they do every day, and the attacker's poll returns a full workbench session with the colleague's role, an administrator's included. The browser binding added in pull request #143 stops a stolen OIDC callback from being completed in another browser; it does nothing here, because the victim completes the flow in their own browser.

The OAuth 2.0 Device Authorization Grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)) has the same shape (a device starts, a person signs in elsewhere, the device polls) and its security considerations describe this attack as remote phishing (section 5.4). Its mitigations are to show the person what is asking, to make them compare a short code the device also displays, and to ask them to confirm. How should Unfold's editor sign-in apply them, and what should the editor receive once it is approved?

## Decision Drivers

* Signing in to the identity provider proves who the person is, not that they want a particular editor to act as them.
* The person must be able to tell their own request from someone else's, in plain words and without reading a URL.
* What the editor holds must not be a browser session: it needs its own lifetime, its own limits, and a way for the person to see and end it.
* Every mutation needs an authenticated identity and object authorization ([AGENTS.md](../../AGENTS.md)).
* No new runtime dependency; Unfold runs on Node's standard library and SQLite.
* The ticket endpoints are public, so starting and polling must be rate-limited.

## Considered Options

* Approval page with a shared code, and a separate editor credential (chosen)
* The person types the editor's code into the workbench (RFC 8628's plain `verification_uri` flow)
* Keep the flow, but show a "you are signing in an editor" notice after sign-in
* A loopback redirect to the editor (`http://127.0.0.1:<port>/callback`), as desktop OAuth clients do
* Approval, but keep handing the editor a copy of a browser session cookie

## Decision Outcome

Chosen option: **an approval page with a shared code, and a separate editor credential**, because it stops the phishing flow without adding a step for the person whose own editor is asking, and it gives them a credential they can see and revoke.

### The approval step

1. `POST /api/auth/editor` returns the ticket `code` (the opaque id in the URL), the `secret` only the editor holds, a short `userCode` such as `BCDF-GHJK` (eight letters from RFC 8628's consonant alphabet), the sign-in `url`, `expiresIn` (600 seconds) and the polling `interval` (2 seconds). The extension shows the code in its progress notification ("Approve only if your browser shows BCDF-GHJK.") before it opens the browser.
2. The person signs in with the identity provider as before. The callback now only records who signed in for the ticket; the first sign-in claims it, and a second one is refused. It sends the browser to the approval page, `#editor-sign-in/<code>`.
3. The page says "A VS Code editor is asking to sign in to <workbench> as you.", shows the code, the role the editor would act with, when the request started and expires, and what approving gives. It tells the person to approve only if they started the sign-in in their own VS Code and it shows the same code, and to deny it if someone sent them the link. It offers **Approve** and **Deny**.
4. Approve and Deny are `POST /api/editor-requests/<code>/approve|deny`. They need a browser session, the mutation header and same-origin checks, and the same person who signed in for the ticket. A ticket takes one decision.
5. The editor polls `POST /api/auth/editor/<code>` with its secret. Until approval, signed in or not, the answer is 202 `pending`. After a denial the next poll answers 403 `editor_login_denied` and the ticket is gone. After approval the next poll answers 200 once with the new credential, and later polls answer 404.

Signing in alone never makes a ticket collectable. The attacker in the phishing flow sees `pending` until the victim denies or the ticket expires, and the victim sees a code that does not match anything on their screen.

### The editor credential

* **What it is.** A random 256-bit token with the prefix `vle_`, issued at the poll after approval, returned once, and sent by the extension as `Authorization: Bearer vle_…`. It is never an `unfold` cookie, and a request that carries a malformed or unknown bearer token is unauthenticated even if it also carries a cookie.
* **Storage.** Unfold stores only the SHA-256 hash of the token, in the `editor_credentials` table with an id, the user, a label (`VS Code`), the scope, the creation, expiry and last-use times. The extension keeps the token in VS Code SecretStorage, where it kept the cookie before. The ticket itself lives in memory for ten minutes and never holds a token: the credential is minted at collection, so an approved ticket that nobody collects leaves nothing behind.
* **Scope `editor`.** The credential acts as its person with their current role on every API route the extension uses, including issuing Agent Host Protocol connection tokens. It cannot approve or deny editor sign-ins, or list or revoke editor credentials: those routes answer 403 `browser_only`, so a stolen editor credential cannot mint more editors.
* **Lifetime.** Thirty days from approval or rotation: use records `lastUsedAt` but never extends the expiry. Rotation (below) replaces the credential within a family that ends ninety days after the approval. The browser session keeps `auth.sessionHours`.
* **Revocation.** **Settings › Signed-in editors** (`#settings/editors`) lists the person's live editor credentials (when approved, last used, when they end) and signs one out with `DELETE /api/editor-credentials/<id>`. Signing out from the extension (`POST /api/logout` with the bearer token) deletes that credential only. Either way, the Agent Host Protocol connection tokens the credential issued are revoked with it and their connections closed. The browser session is untouched.

### Rotation

Amended on 2026-11-17 so that one browser approval lasts ninety days instead of thirty.

* **What it does.** `POST /api/auth/editor/rotate`, with a live editor credential as bearer token, returns a new credential for the same person with the same name and marks the presented one rotated. The new one lasts thirty days, but never past its family's end.
* **The family.** Every credential descends from one approval, or from one token exchange ([ADR 0070](0070-an-editor-trades-an-identity-provider-token-for-its-credential.md)). The family ends ninety days after it, and rotation never moves that end. `familyExpiresAt` is in every answer that issues a credential and in **Settings › Signed-in editors**. A credential approved before this amendment is its own family, ending ninety days after its approval.
* **Idle expiry stays.** A credential unused for fourteen days still signs out, and rotation cannot revive it, because rotation needs a live credential.
* **Grace.** The rotated credential keeps working for two minutes, so requests already on their way with it still succeed. Several hook processes of the Claude Code plugin can hold the old token at the same time.
* **Reuse detection.** Presenting a rotated credential to the rotation route, or using it for anything once its two minutes are over, signs out every credential of its family, rotated or not, and ends the Agent Host tokens they issued. Unfold logs `editor.family_revoked`. Either the holder lost a race to a copy of its token, or a copy is in use after the holder moved on, and Unfold cannot tell which.
* **Who rotates.** The Claude Code plugin rotates its stored credential in the background once it is a week old. Near the family's end it asks for one browser approval again, or trades an identity-provider token if the installation allows it ([ADR 0070](0070-an-editor-trades-an-identity-provider-token-for-its-credential.md)). The VS Code extension does not rotate yet.

### Limits

* Starting: 20 tickets per client address per ten minutes, and 1000 waiting tickets in total; more answers 429 `rate_limited`.
* Polling: a poll sooner than one second after the previous one answers 429 `slow_down`, after which the extension adds a second to its interval, as RFC 8628 section 3.5 asks.
* Five polls with a wrong secret end the ticket.
* Rotation and token exchange count against the per-address sign-in limit (`rateLimits.signIn`).

### Threat model

| Threat | Before | After |
| --- | --- | --- |
| Remote phishing: an attacker starts a ticket and sends the URL to a victim who signs in | The attacker collects the victim's session | The ticket stays pending; the victim sees a request and a code they did not start and can deny it. Approval is the remaining human factor, which the page's wording targets |
| Someone else's browser approves | Not applicable | Only the person who signed in for the ticket sees or decides it; others get 404 |
| A cross-site request approves in the victim's browser | Not applicable | Approve and Deny need the mutation header and same-origin checks |
| The attacker guesses the secret or code | 256-bit secret; unlimited polls | The same, and five wrong secrets end the ticket |
| A leaked editor token | A browser session: full scope until `sessionHours` | `editor` scope, thirty days, visible in Settings and revocable at once, with its Agent Host tokens |
| A leaked editor token, after rotation (2026-11-17) | Usable for at most thirty days | A thief who rotates it first can keep rotating until the family's end, ninety days after the approval, unless the person revokes it in Settings. Once the real holder uses its copy after the two-minute grace, or the thief uses theirs after the holder rotated, the whole family is signed out |
| Ticket flooding | 1000 waiting tickets, no per-address limit | 20 per address per ten minutes, 1000 in total, polling by interval |

Rotation trades a longer worst case for fewer approvals: a stolen credential stays usable until the family deadline unless it is revoked or reuse gives it away. Reuse detection usually gives it away within a week, because the plugin rotates weekly; a machine that stops using its credential never presents the old copy, so on that machine nothing gives the thief away.

Out of scope: a person who approves a request they did not start despite the warning, and a compromised identity provider or browser. Behind a reverse proxy every client shares the proxy's address, so the per-address start limit becomes a workbench-wide limit; the login rate limit has the same property today.

### Consequences

* Good, because following a phishing link and signing in no longer hands anything over.
* Good, because the person sees and controls each editor that acts as them, apart from their browser session.
* Good, because the credential has its own scope and lifetime, and revoking it also ends what it issued.
* Bad, because signing in an editor takes one more click (Approve) in the browser.
* Good, because with rotation a person who uses the Claude Code plugin approves it once every ninety days instead of every thirty, and never when the installation allows token exchange.
* Bad, because a stolen credential that its thief keeps rotating lives up to ninety days instead of thirty, and two processes that rotate the same credential at once sign out their own family; the plugin rotates under a lock to avoid that.
* Bad, because an extension built before this change cannot complete a browser sign-in against a workbench with it: the server no longer returns a `cookie`, so the old extension waits until its ten minutes run out. The extension and the server ship in the same release train.
* Neutral: the waiting tickets stay in memory, as before, so a restart cancels sign-ins in progress. Issued credentials are in SQLite and survive restarts.
* Neutral: the local password sign-in in the extension still stores a session cookie. It is not part of this flow; the person types their own password into their own editor.

### Confirmation

* [`test/api-editor-sign-in.test.ts`](../../test/api-editor-sign-in.test.ts) runs the original phishing flow and shows the attacker's polls stay pending and then fail after a denial; it covers approval, single collection, bearer use, the `browser_only` scope, revocation from Settings including the Agent Host token, sign-out from the editor, other people and second sign-ins, and the rate limits.
* [`test/editor-sign-in.test.ts`](../../test/editor-sign-in.test.ts) covers expired, denied, consumed and mismatched tickets and the credential's lifetime with a mocked clock.
* [`test/editor-sign-in.test.ts`](../../test/editor-sign-in.test.ts) also covers rotation: thirty days within the family, a family deadline weekly rotation never moves, the two-minute grace, reuse at the route and after the grace revoking the family and its Agent Host tokens, idle expiry still applying, and a credential from before rotation. [`test/api-editor-exchange.test.ts`](../../test/api-editor-exchange.test.ts) rotates and replays over HTTP. Mutating the family cap, the deadline, either reuse check, the grace or the idle filter fails these tests.
* [`extensions/vscode/test/browser-login.test.ts`](../../extensions/vscode/test/browser-login.test.ts) and the end-to-end test in [`extensions/vscode/test/client.test.ts`](../../extensions/vscode/test/client.test.ts) show the extension displays the code, waits for approval against the real server, keeps the bearer credential and loses it when it is revoked.

## Pros and Cons of the Options

### The person types the editor's code into the workbench

* Good, because the person must read the code off their own editor, which is RFC 8628's strongest form.
* Bad, because it adds typing to every sign-in, and the extension already opens the right page, which RFC 8628 allows with `verification_uri_complete` when the code is shown for comparison.

### A notice after sign-in, no approval

* Good, because it costs the person nothing.
* Bad, because the credential is already issued by the time the person reads the notice.

### A loopback redirect to the editor

* Good, because the browser hands the result straight to the process that asked.
* Bad, because VS Code often runs remotely (Remote SSH, Codespaces, the Agent Host), where `127.0.0.1` is not the person's machine, and it does not stop phishing: the attacker's loopback listener is the attacker's.

### Approval, with a copy of the browser session

* Good, because the extension would not change.
* Bad, because the editor would hold a credential the person cannot see or end apart from their browser session, with the browser's scope and no lifetime of its own.

## More Information

* Ticket: VIK-1718. The owner approved this approach on 2026-10-03.
* [HTTP contract: single sign-on](../contracts/api.md#single-sign-on) documents the routes.
* RFC 8628, sections 3.3 (user interaction), 3.5 (`slow_down`) and 5.4 (remote phishing).

### History

* 2026-10-03: accepted with the implementation. The owner approved the ticket's approach (approval page with a shared code, a separate revocable editor credential) on 2026-10-03, so the record starts as accepted.
* 2026-11-17 — Owner decided: an editor credential can be rotated silently within a family that ends ninety days after its approval and is never extended; the idle expiry stays; presenting a rotated credential revokes the whole family. The Claude Code plugin rotates in the background and asks for a browser approval only after the family ends. Amended with the implementation.
* 2026-10-17 — Owner decided: an editor credential left unused for fourteen days (from its last use, or from approval when never used) signs out on its own, exactly like an expired one, ending its Agent Host connections too; the thirty-day lifetime stays. A VS Code sign-in is named after its machine, `VS Code on <host>`, built by Unfold from the host the extension sends, and Signed-in editors shows dates with the month named and how far away they are, plus when an unused editor will be signed out.
