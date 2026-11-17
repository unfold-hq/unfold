---
status: proposed
date: 2026-11-17
decision-makers: Ryan Grippeling
review-by: 2027-02-17
---

# An editor trades an identity-provider token for its credential

## Context and Problem Statement

The Claude Code plugin signs itself in through the browser: it opens Unfold's editor sign-in, the person approves it, and the plugin keeps an editor credential ([ADR 0037](0037-an-editor-signs-in-only-after-its-person-approves-it-and-gets-its-own-credential.md)). Since 2026-11-17 the plugin rotates that credential silently within a ninety-day family, so the approval comes back once every ninety days.

An organisation that runs Unfold often already signs its people in on their machines through the same identity provider: a command-line helper that keeps an OpenID Connect token in the Keychain for its own tools. A person who signed in there has already proved who they are to the identity provider Unfold trusts. The browser approval proves the same fact a second time.

On 2026-11-17 the owner decided, developer experience first: where an installation's identity provider allows it, the plugin gets its Unfold credential without a second browser approval when the person already holds a valid token from that provider on the machine. How does an editor prove the person with that token, and what may Unfold accept?

## Decision Drivers

* Unfold accepts tokens from its configured issuer only, never from any other.
* The token must have been issued for someone the installation names. A token issued to any client of the issuer is not enough.
* The person a token names must be the same Unfold account browser sign-in would produce, or nobody.
* A standard on the wire, so any organisation's helper can be pointed at it ([ADR 0050](../../../../docs/adr/adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md)).
* Off unless the installation turns it on, and the browser stays the fallback.
* No new runtime dependency.

## Considered Options

* OAuth 2.0 Token Exchange (RFC 8693) at Unfold, issuing an editor credential (chosen)
* Accept the identity provider's tokens as bearer tokens on every API route
* The plugin runs its own OpenID Connect sign-in against the identity provider
* Exchange at the identity provider for a token whose audience is Unfold

## Decision Outcome

Chosen option: **token exchange at Unfold**, because it adds one route, reuses the issuer, keys and account mapping that browser sign-in already trusts, and ends in the same editor credential, with the same scope, revocation and rotation, that a browser approval gives.

### The route

`POST /api/auth/editor/exchange` takes RFC 8693 parameters as JSON or as a form: `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token`, and `subject_token_type`, one of `id_token`, `access_token` or `jwt` under `urn:ietf:params:oauth:token-type:`. The optional `client` and `host` name the credential as an editor sign-in does (`Claude Code on <host>`). The answer is RFC 8693's (`access_token`, `issued_token_type`, `token_type: Bearer`, `expires_in`) plus `expiresAt`, `familyExpiresAt` and `user`. The issued token is an ordinary editor credential that starts a new ninety-day rotation family.

Unfold accepts the subject token only when all of these hold. Any other token answers 400 `invalid_grant`.

* It is a JWT signed with an asymmetric key from the configured `auth.oidc.issuer`'s JWKS. Browser sign-in uses the same discovery and key cache.
* Its `iss` is that issuer.
* Its `aud` names one of `auth.oidc.exchange.audiences`.
* It is unexpired. Its `iat` and `nbf` are not in the future, beyond one minute of clock skew.
* It carries `iat`, and its lifetime, `exp` minus `iat`, is at most 24 hours.
* It names a subject.

### The person

The browser derives the account id from the configured namespace and the ID token's `sub` (`subjectUserId` in `src/oidc.ts`). `auth.oidc.exchange.match` decides how an exchanged token finds its account:

* `subject` (the default) derives the id the same way. It fits identity providers that give one person the same `sub` in every client, such as Authentik, Keycloak, Okta and Google.
* `email` finds the single sign-on account whose name is the token's `email`, and only when `email_verified` is `true`. Browser sign-in names an account after the email address the provider sends. It fits a provider that gives each client its own `sub`, such as Microsoft Entra ID. The constraint is that the email must be the one the person signs in to Unfold with, verified by the provider. A local password account is never matched.

The exchange never creates an account and never changes a role: the account must exist, so the person signed in through the browser once, and must not be turned off (SCIM or Shared Signals, [ADR 0059](0059-the-identity-provider-provisions-and-deprovisions-people-through-scim-and-pushed-shared-signals.md)). The credential acts with the account's stored role and memberships, as every editor credential does. A token for nobody answers 403 `exchange_unknown_person`.

### Configuration

```json
"auth": { "oidc": { "issuer": "…", "clientId": "unfold", "exchange": { "audiences": ["<client id of the organisation's helper>"], "match": "subject" } } }
```

Without `exchange` the route answers 404 `exchange_off`. Starts count against the per-address sign-in limit.

### The plugin

`UNFOLD_IDP_TOKEN_COMMAND` names a command that prints one token on its first line, such as the organisation's Keychain-backed helper. When the plugin has no credential, or its family is about to end, it runs the command through the shell for at most five seconds. It then trades the printed token at the route, and only over HTTPS or to this machine. A failure falls back to the browser approval. A failed exchange is not tried again for ten minutes. The token is never stored or logged; the credential it bought is stored like one from the browser.

### Threat model

| Threat | Outcome |
| --- | --- |
| A token from another issuer, or one signed with a key not in the issuer's JWKS | Refused: the issuer and the signature are checked against the configured issuer only |
| A token for another application of the same issuer | Refused unless the installation listed its audience |
| An expired or long-lived token | Refused: unexpired, and a lifetime of at most 24 hours |
| A stolen subject token | Its thief gets an editor credential until the token expires. That is no more than the token already grants at the application it was issued for |
| A pairwise `sub` that matches the wrong account | `subject` derives only the browser's own id. Use `email` for such a provider; a token without a verified email matches nobody |
| A person removed at the identity provider | Their account is off through SCIM or Shared Signals, and the exchange refuses them. Without either, their existing editor credentials live until revoked or expired, as before |
| Unfold sees a token meant for another application | Unfold verifies it and drops it. It is never stored, logged or forwarded. An installation that would rather not show Unfold such tokens adds Unfold's own client id to the token's audience at the provider and lists only that |
| The token travels to a wrong address | The plugin sends it only to `UNFOLD_URL`, over HTTPS or to this machine |

### Consequences

* Good, because a person whose organisation runs such a helper never approves the plugin in the browser after the first sign-in, not even after ninety days.
* Good, because the result is an ordinary editor credential: visible and revocable in Settings, rotated, and signed out with the person.
* Good, because it is one standard route that any helper can use, not a client for one vendor.
* Bad, because the installation now trusts every token its identity provider issues for the listed audiences, and so trusts the helper's client registration as much as its own.
* Bad, because the first sign-in still needs the browser, since the exchange never creates an account.
* Neutral: there is no audit fact for an exchange yet, only the `editor.exchanged` log line. Rotation is recorded as a credential issue.

### Confirmation

* [`test/api-editor-exchange.test.ts`](../../test/api-editor-exchange.test.ts) runs the route against a test identity provider. An exchange works by subject and by verified email, as JSON and as a form. It refuses a token from another issuer, for another audience, expired, living longer than a day, without `iat`, signed by a stranger's key, or for a subject without an account. It answers 404 while unconfigured.
* [`test/claude-code-sign-in.test.ts`](../../test/claude-code-sign-in.test.ts) runs the plugin's command, falls back after a refused rotation, never sends a token over plain HTTP, waits after a failed exchange, and signs a first session in with no browser.
* Mutating the issuer, audience, expiry or lifetime check, the email verification, the subject namespace or the plugin's HTTPS rule fails these tests.

## Pros and Cons of the Options

### Accept the identity provider's tokens as bearer tokens on every API route

* Good, because no Unfold credential exists at all.
* Bad, because every route would trust tokens with the identity provider's lifetime and revocation, beside Settings, and short tokens would make every hook call the helper.

### The plugin runs its own OpenID Connect sign-in against the identity provider

* Good, because it needs no helper.
* Bad, because it is a second browser sign-in, the very step this decision removes.

### Exchange at the identity provider for a token whose audience is Unfold

* Good, because Unfold would only ever see tokens meant for it.
* Bad, because few providers support RFC 8693 at their token endpoint, and the plugin would still need Unfold's route to turn that token into an editor credential. An installation can still do it: list Unfold's own client id as the audience.

## More Information

* RFC 8693, OAuth 2.0 Token Exchange: <https://www.rfc-editor.org/rfc/rfc8693>.
* [Link your Claude Code sessions](../../../../docs/how-to/link-claude-code-sessions.md) describes the person's side; [live operation](../operations/live.md#one-sign-in-for-editors) the installation's.

### History

* 2026-11-17: proposed with the implementation. The owner decided the goal and the opt-in configuration on 2026-11-17; the mechanism awaits review.
