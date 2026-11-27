# Zitadel identity spike (W0)

Date: 27 November 2026, against `origin/development` at `c284b7be`. This is a record of a throwaway local spike. It changes no decision by itself. It supports [ADR-0058](../adr/adr-0058-people-sign-in-through-one-zitadel-broker-with-an-organisation-per-tenant.md), which chose one Zitadel broker with an organisation per Tenant.

## Verdict

**Confirm Zitadel.** All seven points passed against Zitadel v4.20.6 with Login V2, including the three that decide (a, c and d). The decision rule was: if (a), (c) or (d) fails, move to Keycloak 26.8; otherwise confirm Zitadel. Two findings constrain how Unfold uses it:

- Token lifetime is configured **per instance, not per application**.
- Zitadel's outbound HTTP deny list blocks private addresses by default, so an in-cluster Actions target needs an explicit exception.

> **Method.** One Docker Compose stack on a laptop, with one container per component:
>
> - `ghcr.io/zitadel/zitadel:v4.20.6`, run with `start-from-init`;
> - `ghcr.io/zitadel/zitadel-login:v4.20.6`, the Login V2 image named in Zitadel's [compose guide](https://zitadel.com/docs/self-hosting/deploy/compose);
> - `postgres:17`.
>
> The guide's Traefik proxy was left out. The API is published on `localhost:8080` and Login V2 on `localhost:3000`.
>
> Every step ran through the HTTP APIs with a short Python script. The script used Zitadel's custom-login APIs (Session API v2, `POST /v2/oidc/auth_requests/{id}`, the IdP intent API and the device authorization API) in place of clicking through Login V2. No browser was used. Tokens were decoded from the real responses.
>
> Point (c) fed the decoded `groups` claim to Unfold's real parser, [`membershipsFromGroups`](../../apps/unfold/src/tenancy.ts#L41), through `mise exec -- npx tsx`. Secrets, codes and tokens are redacted below.
>
> **Stand-in.** Real Google Workspace and Entra ID were not available. A second organisation in the same Zitadel instance acted as the customer's corporate OIDC provider (`upstream-idp`, with a confidential OIDC client and a password user). This **substitutes for Entra or Google**: the federation path is the same generic OIDC one, but the provider-specific templates were not exercised.

## Results

| Point | Result | Evidence (abridged) |
|---|---|---|
| (a) Organisation, three project role grants and a first-admin invitation, purely through the API | **Pass** | `POST /v2/organizations {"name":"acme"}` returned 201 with an `organizationId`. `POST /management/v1/projects/{unfold}/grants {"grantedOrgId":…, "roleKeys":["viewer","member","admin"]}` returned 200 with a `grantId`. `POST /v2/users/human` (in acme, no password, `email.returnCode`) returned 200. `POST /management/v1/orgs/me/members {"roles":["ORG_OWNER"]}` with `x-zitadel-orgid` returned 200. `POST /management/v1/users/{id}/grants {"roleKeys":["admin"], "projectGrantId":…}` returned 200. `POST /v2/users/{id}/invite_code {"returnCode":{}}` returned 200 with an `inviteCode`. Redeeming it with `POST /v2/users/{id}/invite_code/verify` returned 200 and the email became verified. |
| (b) External IdP per organisation, plus email-domain discovery routing to it | **Pass, through the API path; Login V2 screens not driven** | The org domain `acme.example` was added. The org-level generic OIDC IdP was added with `POST /management/v1/idps/generic_oidc` (auto-creation, auto-linking by email). The org login policy was set to IdP only with `allowDomainDiscovery: true`. Discovery for `pat@acme.example` then ran the same calls Login V2 v4.20.6 makes in its login-name action, read from the image's bundle: `POST /v2/organizations/_search` with `domainQuery` returned exactly acme; `GET /v2/settings/login?ctx.orgId=acme` returned `allowDomainDiscovery: true`; `GET /v2/settings/login/idps?ctx.orgId=acme` returned one IdP. `POST /v2/idp_intents` returned an `authUrl` to the upstream. The script then followed the upstream authorize, the upstream login and Zitadel's `/idps/callback`, which redirected to the success URL with the intent id and token. `POST /v2/idp_intents/{id}` returned the upstream `sub`. A federated user was created in acme with an `idpLinks` entry, and a session was checked by `idpIntent`. |
| (c) An Actions v2 claim `groups = unfold/<tenant>/<role>` for one person in two organisations, plus `idp_user_id`; Unfold's parser returns exactly two memberships | **Pass** | The person is a user of acme and holds grants in two organisations: `admin` through acme's project grant and `member` through globex's. Globex granted a role to a user of another organisation with `POST /management/v1/users/{id}/grants` and `x-zitadel-orgid: globex`, which returned 200. A target (`POST /v2/actions/targets`, `restCall`, `interruptOnError`) was attached with `PUT /v2/actions/executions` to the functions `preaccesstoken` and `preuserinfo`. The target answered with `{"append_claims":[{"key":"groups",…},{"key":"idp_user_id",…}]}`. Decoded ID token, access token and userinfo: `"groups":["unfold/acme/admin","unfold/globex/member"]` and `"idp_user_id":"401443788855181315"`, which is the upstream IdP's `sub`. The parser printed `[{"kind":"tenant","tenant":"acme","role":"admin"},{"kind":"tenant","tenant":"globex","role":"developer"}]`. The target checked the `ZITADEL-Signature` header with the target's signing key, and it was valid on every call. |
| (d) RFC 8693 token exchange to a `ploeg` audience: same `sub`, at most 5 minutes, groups present; `act` with a machine actor | **Pass** | The browser login requested `urn:zitadel:iam:org:project:id:{ploeg}:aud`. The exchange call was `grant_type=…token-exchange`, `subject_token_type=…access_token`, `audience={ploeg project id}`, `requested_token_type=…jwt`, authenticated with the confidential unfold-web client. Decoded result: `aud:["<ploeg project id>"]` (narrowed to Ploeg only), the same `sub` as the browser login, `exp-iat = 300`, `expires_in: 299`, and the same `groups` and `idp_user_id`. With a machine user as `actor_token`, the result carried `"act":{"iss":"http://localhost:8080","sub":"<machine user id>"}` with the same `sub`, `aud` and `groups`. Actions v2 received an `actor` object in the `preaccesstoken` payload. |
| (e) Pre-registered public client (PKCE) for unfold-mcp, same `sub` as the browser | **Pass** | A native app with `authMethodType: NONE` and a loopback redirect `http://127.0.0.1:33418/callback`. Authorization code with S256 PKCE, no secret. Decoded `sub` equals the browser login's `sub`, and `groups` and `idp_user_id` are present. |
| (f) Device authorization grant (RFC 8628) | **Pass** | `POST /oauth/v2/device_authorization` on the public client returned `user_code`, `verification_uri: http://localhost:8080/device` and `interval: 5`. A poll before approval returned `authorization_pending`. `GET /v2/oidc/device_authorization/{user_code}`, then `POST /v2/oidc/device_authorization/{id}` with the person's session, approved it. The next poll returned 200 with an access, refresh and ID token, all with the same `sub` and `groups`. |
| (g) `offline_access` refresh | **Pass** | The `offline_access` scope yielded a `refresh_token` on unfold-web, unfold-mcp and the device flow. `grant_type=refresh_token` returned 200 with new access, ID and refresh tokens on both the confidential and the public client. The claims kept the same `sub` and `groups`. |
| Org self-registration (`/ui/login/register/org`) can be turned off through the API | **Yes** | `GET /ui/login/register/org` returned 200. After `PUT /admin/v1/restrictions {"disallowPublicOrgRegistration": true}` it returned 404. |
| Memory | **About 350 MiB in total** | `docker stats --no-stream` while idle, right after the run: zitadel 156 MiB, login 80 MiB, postgres 114 MiB. |

Two details in the evidence matter for the next steps:

- **The actor token needs the exchanging client's audience.** An actor token from `client_credentials` with only `scope=openid` has `aud:["unfold-agent"]` and was refused with `invalid_request: actor_token invalid`; the server log reads `token is not valid for this client`. The exchange succeeded once the actor token requested `urn:zitadel:iam:org:project:id:{unfold project}:aud`. The actor needed `IAM_END_USER_IMPERSONATOR`, and the instance needed `enableImpersonation: true` (`PUT /admin/v1/policies/security`).
- **`audience` only narrows.** Without `audience`, the exchanged token kept every audience of the subject token. With `audience={ploeg}` it kept only Ploeg's. `resource` is not supported, and the [docs](https://zitadel.com/docs/guides/integrate/token-exchange) say it returns `invalid_target`.

## Configuration notes for the next steps

The plan document could not be opened from this run. The notes below follow the step order of the research report's migration path (Ploeg person tokens, the `Tenant` operator, self sign-up, then SCIM and revocation) and assume that W4 to W7 are those steps.

- **Token lifetime is per instance.** `accessTokenLifetime` and `idTokenLifetime` are set in the instance OIDC settings (`PUT /admin/v1/settings/oidc`). The OIDC application config has no lifetime field: its keys are `accessTokenRoleAssertion`, `accessTokenType`, `allowedOrigins`, `clockSkew`, `devMode`, `grantTypes`, `idTokenRoleAssertion`, `idTokenUserinfoAssertion`, `redirectUris`, `responseTypes` and others. A 5-minute Ploeg token therefore means 5-minute browser and MCP access tokens too, with `offline_access` refresh doing the work.
- **Token exchange is on by default in v4.20.6.** `GET /v2/features/instance` reported `oidcTokenExchange` enabled with source `SOURCE_SYSTEM`. Setting it per instance returned "No changes". Impersonation still has to be allowed in the instance security policy.
- **Ploeg person tokens.**
  - Unfold's login must request `urn:zitadel:iam:org:project:id:<ploeg project>:aud` up front; exchange cannot widen the audience.
  - Ploeg's expected audience is the Ploeg **project id**. The project's API app client id was not in `aud`.
  - Ploeg's `requireClaims` can rely on `groups`, which Actions v2 adds to the exchanged token too.
  - Each machine actor needs an impersonator role and an actor token that includes Unfold's project audience.
- **Actions v2 target.**
  - The `preaccesstoken` and `preuserinfo` payloads already contain `user_grants`, each with `org_name`, `org_primary_domain`, `project_id` and `roles`, and `org` and `user`. The target can build `groups` without calling back into Zitadel. (The spike's target did call back; the payload makes that unnecessary.)
  - The Tenant slug should come from something stable, such as org metadata or a naming rule enforced by the `Tenant` operator, not from the free-text org name the spike used.
  - The upstream IdP user id comes from `POST /v2/users/{id}/links/_search`.
  - Zitadel signs each call (`ZITADEL-Signature`, HMAC-SHA256 with the target's `signingKey`).
- **Outbound deny list.**
  - `HTTPClient.DenyList` (`ZITADEL_HTTPCLIENT_DENYLIST`) blocks `localhost`, loopback and all RFC 1918 and ULA ranges by default. This applies to IdP discovery and Actions targets.
  - The spike narrowed it to `0.0.0.0/8,169.254.0.0/16`, because the upstream IdP was on loopback and the target was on the Docker host.
  - In a cluster, real Google and Entra are public, but an Actions target that is a cluster Service is on a private range. Production needs either a narrow exception for that one CIDR or a target reached through a public route. Do not empty the list.
- **The `Tenant` operator** can do the whole organisation bootstrap through the API, in the order recorded in (a):
  1. `POST /v2/organizations`;
  2. a project grant of the Unfold project with `viewer`, `member` and `admin`;
  3. the org domain, plus an org domain policy override if DNS validation is skipped;
  4. the org IdP (`/management/v1/idps/generic_oidc`; Google and Entra have their own templates, not tried);
  5. the org login policy with `allowDomainDiscovery` and the IdP attached;
  6. the first admin as a user without a password, `ORG_OWNER` membership, a user grant, and `invite_code` with `returnCode`, so that Unfold sends the invitation itself.

  Without SMTP configured, `returnCode` is what makes this work.
- **One person in several Tenants** works through cross-organisation user grants. The person has one home organisation (the one whose IdP they signed in with), and the other organisation grants a role on its project grant. Zitadel's built-in `urn:zitadel:iam:org:project:roles` claim already maps role to org id, but Unfold's parser needs the `groups` form, so the Action is needed.
- **Login V2 discovery** routes only if the domain matches exactly one organisation, that organisation's login settings have `allowDomainDiscovery`, and it has exactly one active IdP with creation allowed. The source is the v4.20.6 login-name action read from the image. A Tenant with both Google and Entra will see a choice, not an automatic redirect.
- **Self sign-up:** `PUT /admin/v1/restrictions {"disallowPublicOrgRegistration": true}` closes Zitadel's own organisation registration ([SetRestrictions](https://zitadel.com/docs/apis/resources/admin/admin-service-set-restrictions)).

## Not verified

- Real Google Workspace and Microsoft Entra ID, and their IdP templates; only generic OIDC was run.
- The Login V2 screens themselves: discovery, the IdP redirect, the device page and the invite page were exercised through the APIs Login V2 calls, not through its UI.
- Whether an `ORG_OWNER` can manage its own organisation's IdPs in Login V2 or Console v4. The first admin was created but did not act.
- SCIM, Actions v2 events for deactivation towards Unfold's `Revocation`, and back-channel logout.
- Behaviour under TLS, behind a proxy, with several replicas, or with Redis caching.
- A real Unfold or Ploeg installation consuming these tokens. Only `membershipsFromGroups` was run, and Ploeg's `requireClaims` was not.
- Memory under load. The figure is one idle sample after the run.

## Sources

- Self-hosting with Compose: https://zitadel.com/docs/self-hosting/deploy/compose and the compose file it links, https://raw.githubusercontent.com/zitadel/zitadel/main/deploy/compose/docker-compose.yml
- Token exchange and impersonation: https://zitadel.com/docs/guides/integrate/token-exchange
- Actions v2: https://zitadel.com/docs/concepts/features/actions_v2, https://zitadel.com/docs/guides/integrate/actions/testing-function and https://zitadel.com/docs/guides/integrate/actions/testing-function-manipulation
- Domain discovery: https://zitadel.com/docs/guides/solution-scenarios/domain-discovery
- Generic OIDC IdP: https://zitadel.com/docs/guides/integrate/identity-providers/generic-oidc
- Custom login through the session and auth-request APIs: https://zitadel.com/docs/guides/integrate/login-ui/oidc-standard and https://zitadel.com/docs/guides/integrate/login-ui/external-login
- Device authorization: https://zitadel.com/docs/guides/integrate/login/oidc/device-authorization
- B2B onboarding: https://zitadel.com/docs/guides/integrate/onboarding/b2b
- Restrictions: https://zitadel.com/docs/apis/resources/admin/admin-service-set-restrictions
- Runtime configuration, including `HTTPClient.DenyList`: https://zitadel.com/docs/self-hosting/manage/configure; the default list was read from the defaults embedded in the v4.20.6 binary.

The API reference pages above were not all read in full. Each endpoint shape in this record is confirmed by the live response it got.
