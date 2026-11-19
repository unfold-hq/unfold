---
status: proposed
date: 2026-11-19
decision-makers: Ryan Grippeling
---

# Hosted Unfold reaches GitHub through one public App the customer installs, and other forges through a bot account the customer creates

## Context and Problem Statement

Today every installation of Unfold brings its own forge and tracker credentials: its own GitHub App, a Forgejo bot user, a GitLab token, its own tracker tokens ([Run your own installation](../get-started/self-host.md), [Task connections](../../apps/unfold/docs/operations/task-connections.md)). That works because the person who installs Unfold also owns the forge. Hosted Unfold, phase 2 of [Who Unfold is for](../concepts/who-unfold-is-for.md), is not built; in it the Unfold project runs the service and each [Agency](../reference/glossary.md#agency) keeps its own forge, tracker and repositories ([ADR-0005](adr-0005-unfold-is-offered-to-agencies.md), [ADR-0009](adr-0009-one-tenant-per-agency.md)). The page [Hosted Unfold for agencies](../get-started/agency.md) names the direction for GitHub but no record decides it.

What Ploeg already decides, at the pinned contract bundle 0.2.0-rc.130:

* **GitHub.** With a GitHub App, ploegd mints an installation token per writing Run, limited to the Run's repository and to `contents:write`, `pull_requests:write`, `checks:read`, `statuses:read` and `metadata:read`, and revokes it when the Run settles; without an App, a fine-grained personal access token is a clearly weaker fallback ([Ploeg ADR-0086](../../apps/ploeg/docs/adrs/0086-github-is-a-forge-and-a-run-pushes-with-its-own-github-app-installation-token.md), proposed). Reading Runs get a read-only installation token too ([Ploeg ADR-0192](../../apps/ploeg/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md) section 2, proposed).
* **Forgejo.** ploegd signs in as the bot with its password and mints a token per Run restricted to the Run's repository ([Ploeg ADR-0013](../../apps/ploeg/docs/adrs/0013-push-rights-are-minted-per-run.md), accepted; [Ploeg ADR-0172](../../apps/ploeg/docs/adrs/0172-the-forgejo-broker-runs-only-on-forgejo-15-and-refuses-a-token-the-forge-did-not-restrict-to-the-runs-repository.md), proposed, which requires Forgejo 15).
* **GitLab.** No per-Run minting; one shared token, so GitLab can only be the sole forge of its release (Ploeg ADR-0192 section 3, [Ploeg ADR-0023](../../apps/ploeg/docs/adrs/0023-the-forge-dialect-travels-on-the-work-item.md)).
* **Several forges in one release** refuse to start unless every active forge can mint per-Run credentials (Ploeg ADR-0192 section 3).
* **Connection secrets** go into a secret store Ploeg writes itself, and no person handles them ([Ploeg ADR-0184](../../apps/ploeg/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md), proposed). Connections are made through flows Ploeg starts and a consumer only relays ([Ploeg ADR-0195](../../apps/ploeg/docs/adrs/0195-a-proven-operator-makes-and-manages-a-tracker-or-forge-connection-through-a-flow-ploeg-starts-and-the-consumer-only-relays-codes.md), proposed). ADR-0195 creates every GitHub App from a manifest with `public: false`, and names "a public GitHub App is to be allowed" as a re-evaluation trigger, because a setup redirect's `installationId` then needs proof through a GitHub user authorization.
* **Unfold holds no forge or tracker credential**; Ploeg owns every connection ([ADR-0060](adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md), accepted).

How does the hosted service get access to a customer's repositories, with the customer's consent, scoped to the repositories agents may work in, and with the per-Run least privilege Ploeg already gives self-hosted installations?

## Decision Drivers

* The customer's consent and the scope of access are given at the forge, by the customer, and can be withdrawn there.
* Per-Run least privilege stays as Ploeg ADR-0086, ADR-0013 and ADR-0192 define it: a Run holds a credential for its own repository only, which dies with the Run.
* One Tenant can never reach another Tenant's repositories ([ADR-0009](adr-0009-one-tenant-per-agency.md)).
* Connecting is something an Admin finishes alone, without the Unfold project ([ADR-0059](adr-0059-an-organisation-connects-its-forge-and-tracker-from-unfold-and-ploeg-learns-its-repositories-and-boards-at-runtime.md)), and no person handles a secret the vendor lets us avoid (Ploeg ADR-0184).
* Self-hosting needs nothing from the Unfold project, and the hosted service runs the same open-source code ([ADR-0050](adr-0050-unfold-integrates-through-open-standards-and-registries-and-never-locks-a-customer-in.md)).
* The fewer long-lived private keys the project keeps, the smaller what a breach of the hosted service reaches.

## Considered Options

* A. One public GitHub App per hosted service, installed by each customer; a bot account the customer creates on Forgejo and GitLab
* B. Each customer creates its own GitHub App and uploads its private key
* C. OAuth user tokens: a person at the customer signs in and Ploeg acts as them
* D. Personal access tokens the customer pastes

## Decision Outcome

Chosen option: "**A. One public GitHub App per hosted service, installed by each customer; a bot account the customer creates on Forgejo and GitLab**", because it is the only option in which the customer's consent and scope live at the forge, the project keeps one private key instead of one per customer, and Ploeg's per-Run installation tokens work unchanged.

Proposed, not built. Each rule states what the hosted service must do once phase 2 starts.

1. **GitHub: one public App, owned by the Unfold project.** The hosted service is one public GitHub App owned by the project's GitHub organisation ([ADR-0055](adr-0055-github-unfold-hq-is-the-project-home.md)). A customer installs it on its organisation and chooses the repositories agents may work in, as people install Renovate or Codecov. The installation is the customer's consent and its scope: Ploeg registers a Work Target only for a repository the installation was granted ([Ploeg ADR-0193](../../apps/ploeg/docs/adrs/0193-a-proven-operator-registers-a-work-target-at-runtime-only-for-a-repository-ploegs-forge-connection-was-granted.md)), and a repository the customer removes from the installation stops being reachable.
2. **Ploeg mints per-Run installation tokens from it exactly as Ploeg ADR-0086 does.** The App's permissions are the set the GitHub adapter declares for a self-hosted manifest App (Ploeg ADR-0195 section 3, the proposed `AppManifest` capability), and no more: no `workflows` and no administration. A Run's token stays limited to its repository and to the permissions ADR-0086 names.
3. **The installation id keeps Tenants apart.** Connect GitHub in Unfold relays Ploeg's `github_app_installation` flow (ADR-0060 rule 3, Ploeg ADR-0195 section 3). Because the App is public, anyone can install it and a setup redirect's `installation_id` can be spoofed ([GitHub: About the setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)). Ploeg therefore accepts an installation only after a GitHub user authorization shows that the proven person can reach that installation, and refuses an installation that is already a live connection in any Tenant. One installation belongs to one Tenant; a webhook delivery is routed to the Tenant whose connection holds its installation id, and a delivery for an installation no live connection holds is dropped. This is the case Ploeg ADR-0195 names as a re-evaluation trigger, and it is an upstream ask: *Ploeg accepts a statically configured public connection app, and proves an installation id through a GitHub user authorization before it becomes a connection*.
4. **The private key stays in Ploeg's secret store.** The App's private key, webhook secret and client secret live only in the secret store of the Ploeg that serves the hosted Tenants (Ploeg ADR-0184). Unfold never reads them (ADR-0060). No person keeps a copy on a laptop or in a password manager after the key is generated.
5. **Forgejo and GitLab: a bot account the customer creates.** Neither forge has an app-installation model. The customer creates a dedicated account that is a member only of the repositories agents may work in (Ploeg ADR-0184 rule 4): on Forgejo a bot user, on GitLab a project or group access token, which GitLab backs with a bot user. The customer hands the credential over once through Unfold's connection flow, which relays it to Ploeg (ADR-0060 rule 3); where the hosted service has registered an OAuth application for that forge instance, the bot account consents through OAuth instead of a paste (Ploeg ADR-0184 rule 1). Ploeg stores it in its own secret store and no person handles it again.
6. **Per-Run least privilege on Forgejo and GitLab follows what Ploeg can mint.** On Forgejo, per-Run tokens need the bot's password and Forgejo 15 (Ploeg ADR-0013, ADR-0172), so the hosted Forgejo connection carries what Ploeg needs to mint, not a token every Run shares. On GitLab Ploeg cannot mint, and the hosted service serves several forges at once, which Ploeg ADR-0192 refuses for a forge that cannot mint. Hosted GitLab is therefore not offered until Ploeg mints per-Run GitLab credentials (the trigger Ploeg ADR-0023 names) or the hosted service runs a Ploeg release per Tenant with GitLab as its only forge; which of the two is to be decided.
7. **Self-hosting never needs the public App.** A self-hosted installation keeps creating its own GitHub App (Ploeg ADR-0195's manifest flow) and its own bot accounts. The chart, the docs and the code never default to the public App, and a self-hosted installation cannot use it, because its key is not shared.
8. **The public App is created when phase 2 starts, not before.** Until then it does not exist, and nothing in Unfold or Ploeg refers to its id or slug.

### Consequences

* Good, because the customer gives and withdraws access at its own forge, in the screen GitHub already shows for every App it installs.
* Good, because the project holds one GitHub private key for all customers instead of one per customer.
* Good, because Ploeg's per-Run installation tokens, the Run's repository limit and revocation work as they do for self-hosted installations.
* Good, because each installation has its own GitHub rate limit, so one Tenant's Runs do not spend another's API budget.
* Good, because self-hosting stays independent of the project.
* Bad, because the project becomes responsible for an App installed on other people's code. A leaked private key reaches every customer's selected repositories until the key is revoked, so key custody, rotation (GitHub allows a second key during rotation), who may manage the App in the project's organisation, and an incident runbook that tells customers what was reachable are needed before the first customer installs it. Their exact form is to be decided.
* Bad, because one webhook URL serves every installation. If Ploeg's public webhook endpoint is down, every Tenant misses pull request, review and CI events, and GitHub does not redeliver a failed delivery on its own. Ploeg's hourly connection probe (Ploeg ADR-0195 section 5) catches an installation's state, not missed pull request events; how missed deliveries are recovered is to be decided.
* Bad, because a change to the App's permissions must be accepted by every customer's organisation owner before it applies to their installation, so a new permission rolls out at each customer's pace.
* Bad, because the public App does not reach GitHub Enterprise Server: a customer on its own GitHub Enterprise Server needs option B or self-hosting.
* Bad, because Ploeg ADR-0195 accepts a connection `instance` only from static configuration, never from a request, so hosted Forgejo and GitLab reach only forge instances the hosted service has configured. Whether the hosted service offers a fixed list of public instances or adds a customer's own instance on request is to be decided.
* Bad, because hosted GitLab waits for an upstream Ploeg change or a per-Tenant Ploeg release (rule 6).
* Neutral, because a GitHub Marketplace listing and GitHub's publisher verification are not needed to make an App public or to install it; whether hosted Unfold lists in the Marketplace and bills through it is to be decided with the pricing of [ADR-0006](adr-0006-the-ticket-is-the-billing-unit.md).
* Neutral, because the App's name is unique on GitHub and is not reserved before phase 2 starts (rule 8); if it is taken by then, the App gets another name.

**When a customer uninstalls.** GitHub sends `installation` `deleted` (or `suspend`); Ploeg marks the connection `invalid` with `installation_deleted` or `installation_suspended`, its runtime Work Targets become `invalid` with `connection_unusable`, and no new Run can be minted a token for those repositories (Ploeg ADR-0195 section 5, ADR-0193). A Run in flight is expected to lose its token with the installation; a test must show it (Confirmation). Nothing is deleted: the Tenant's Work Items, Shifts and pull request history stay, and reinstalling and reconnecting restores the targets. Removing the connection from Unfold uninstalls the App from the customer's organisation, because a disconnect leaves nothing behind (Ploeg ADR-0195 section 8). An Agency that leaves the hosted service has its code, prompts and logs deleted under ADR-0009; uninstalling alone is not leaving.

### Confirmation

Proposed, none of these exist yet. Before the first customer installs the public App:

* A Ploeg test with an `httptest` fake of GitHub: a `github_app_installation` completion for the public App whose `installationId` the proven person's user authorization does not list is refused; one that is already a live connection in another Tenant is refused; one that passes both becomes a connection in the person's Tenant only.
* A Ploeg test that a webhook delivery is processed only under the Tenant whose live connection holds its installation id, and that a delivery for an unknown installation is dropped without touching any Tenant.
* A scheduled check that reads the public App with its JWT (`GET /app`) and fails when its permissions or events differ from the GitHub adapter's declared manifest permissions.
* Ploeg ADR-0086's per-Run token tests, run against the public App's configuration: the token names exactly the Run's repository and the permissions ADR-0086 lists, and is revoked when the Run settles.
* A Ploeg test that an `installation` `deleted` delivery marks the connection `invalid` with `installation_deleted`, marks its runtime targets `connection_unusable`, that the next claim on such a target mints nothing, and that a Run in flight on it settles without pushing again.
* An Unfold test that Connect GitHub relays only the flow's state and installation id to Ploeg and stores nothing else (the test ADR-0060 already names).
* A chart test that the default values and the self-host guide name no public App id, slug or key reference.

## Pros and Cons of the Options

### A. One public GitHub App per hosted service

* Good, because consent and scope are the customer's installation, changed and revoked in GitHub's own screens.
* Good, because one App key serves every customer, and per-Run installation tokens need no change in Ploeg.
* Bad, because the project carries the security, availability and permission-change duties of an App installed on other people's code.
* Bad, because Ploeg must prove each installation through a GitHub user authorization, which it does not do yet (Ploeg ADR-0195 re-evaluation triggers).

### B. Each customer creates its own GitHub App and uploads its key

* Good, because a leaked key reaches one customer only, and the customer owns the App's permissions.
* Good, because it is what self-hosted installations already do, and it works on GitHub Enterprise Server.
* Bad, because every customer must create an App, choose permissions and handle a private key, which is the setup work hosted Unfold exists to remove, and the manifest flow's App is `public: false` under the customer's account, so Ploeg would hold one key per customer.
* Bad, because the project then keeps many long-lived private keys instead of one.

### C. OAuth user tokens

* Good, because signing in with GitHub is familiar and needs no App installation.
* Bad, because the token acts as a person: it reaches every repository that person can reach, not the ones chosen for agents, and its scopes are wide (`repo` for private repositories).
* Bad, because Ploeg cannot mint a per-Run token restricted to one repository from it, which breaks Ploeg ADR-0086's per-Run least privilege, and the access ends when that person leaves the customer.

### D. Personal access tokens

* Good, because it is the simplest thing to set up.
* Bad, for the reasons Ploeg ADR-0086 rejected it as anything but a fallback: one shared token, no per-Run scope, no revocation by Ploeg, and a person's name on every push.
* Bad, because a person would paste a long-lived token, the handling Ploeg ADR-0184 exists to avoid.

## More Information

* Technical story: [Hosted Unfold for agencies](../get-started/agency.md), which named the public App as the owner's direction before this record.
* 2026-11-19 — Proposed by the owner, Ryan Grippeling. Facts about Ploeg checked against the pinned contract bundle 0.2.0-rc.130.
* Builds on [ADR-0009](adr-0009-one-tenant-per-agency.md), [ADR-0059](adr-0059-an-organisation-connects-its-forge-and-tracker-from-unfold-and-ploeg-learns-its-repositories-and-boards-at-runtime.md) and [ADR-0060](adr-0060-ploeg-owns-every-tracker-and-forge-connection-and-unfold-holds-none.md).
* Supported by Ploeg [ADR-0013](../../apps/ploeg/docs/adrs/0013-push-rights-are-minted-per-run.md), [ADR-0086](../../apps/ploeg/docs/adrs/0086-github-is-a-forge-and-a-run-pushes-with-its-own-github-app-installation-token.md), [ADR-0172](../../apps/ploeg/docs/adrs/0172-the-forgejo-broker-runs-only-on-forgejo-15-and-refuses-a-token-the-forge-did-not-restrict-to-the-runs-repository.md), [ADR-0184](../../apps/ploeg/docs/adrs/0184-tracker-and-forge-connection-secrets-live-in-a-secret-store-ploeg-writes-itself-and-no-person-handles-them.md), [ADR-0192](../../apps/ploeg/docs/adrs/0192-a-runs-forge-is-resolved-from-its-work-target-and-the-claim-carries-the-forge-and-a-credential-minted-for-that-run.md) and [ADR-0195](../../apps/ploeg/docs/adrs/0195-a-proven-operator-makes-and-manages-a-tracker-or-forge-connection-through-a-flow-ploeg-starts-and-the-consumer-only-relays-codes.md). Upstream ask to ploeg-hq/ploeg: rule 3.

### Re-evaluation triggers

* The hosted service runs one Ploeg release per Tenant instead of one Ploeg for all hosted Tenants: one App key would then be needed in every Tenant's Ploeg, or one component would mint for all of them.
* The App's private key leaks, or GitHub changes how an App's installations, permissions or tokens work.
* Forgejo or GitLab gains an app-installation model, or Ploeg gains per-Run GitLab minting.
* Customers on GitHub Enterprise Server ask for the hosted service.
* A customer's security review refuses an App the project owns and asks to bring its own (option B).
