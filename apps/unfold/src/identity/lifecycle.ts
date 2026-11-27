import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Auth } from '../auth.ts';
import type { Store } from '../store.ts';
import type { PersonProof } from '../person-proof.ts';
import type { AppConfig } from '../types.ts';
import { recordedInputs, type ActionTarget } from '../action-records.ts';
import { subjectUserId } from '../oidc.ts';
import { defaultTenant, membershipsFromGroups, type Membership } from '../tenancy.ts';
import { identityAccounts, type IdentityAccounts, type ScimScope, type ScimUserRecord } from './accounts.ts';
import { Revocation, type AgentsWindowTokens, type RevocationCounts } from './revocation.ts';
import { ScimService, disabledBy, scimBase, signInMemberships, type ScimEffect, type ScimTarget } from './scim.ts';
import { SetError, SetVerifier, eventName, readSet, refuseSet, sharedSignalsPath, type Subject, type VerifiedEvent, type VerifiedSet } from './shared-signals.ts';
import { normalIssuer } from './settings.ts';

/** What the lifecycle needs from the rest of the server. */
export type LifecycleDependencies = {
  config: AppConfig;
  store: Store;
  auth: Auth;
  agentHost?: AgentsWindowTokens;
  proof?: PersonProof;
  /**
   * Whether a flag is on for a Tenant, the default Tenant when none is named: `identity.scim` and
   * `identity.shared-signals` turn each part on, both off by default. A Tenant's SCIM token asks for its own Tenant.
   */
  enabled(flag: string, tenant?: string): Promise<boolean>;
  fetch?: typeof fetch;
};

/** Who signed in, as the lifecycle needs it: the account, the email, the customer identity provider's user id and the sign-in's memberships. */
export type SigningIn = { id: string; email?: string; idpUserId?: string; memberships?: readonly Membership[] };

type Actor = { id: string; name: string; channel: string };

const scimActor = (scope: ScimScope): Actor => scope === null ? { id: 'scim', name: 'SCIM provisioning', channel: 'scim' } : { id: `scim:${scope}`, name: `SCIM provisioning: ${scope}`, channel: 'scim' };

/**
 * Provisioning and deprovisioning from the identity provider: the SCIM service provider at `/scim/v2`, the Shared
 * Signals push receiver at `/ssf/events`, sign-out, and the sign-in check that refuses an account the provider turned
 * off. Every change and every revocation is an Action Record and a log line.
 */
export class IdentityLifecycle {
  readonly revocation: Revocation;
  private readonly deps: LifecycleDependencies;
  private readonly accounts: IdentityAccounts;
  private readonly scim: ScimService | undefined;
  private readonly verifier: SetVerifier | undefined;

  constructor(deps: LifecycleDependencies) {
    this.deps = deps;
    this.accounts = identityAccounts(deps.store.db);
    this.revocation = new Revocation(deps.store, deps.auth, deps.agentHost, deps.proof);
    const { identity, auth, baseUrl } = deps.config;
    this.scim = identity?.scim && auth.oidc ? new ScimService({
      accounts: this.accounts,
      store: deps.store,
      oidc: auth.oidc,
      settings: identity.scim,
      revoke: (userId, cause, scope) => this.revoke(userId, cause, scimActor(scope)),
      effect: effect => this.provisioned(effect),
      location: `${(baseUrl ?? '').replace(/\/+$/, '')}${scimBase}`,
    }) : undefined;
    this.verifier = identity?.sharedSignals && auth.oidc ? new SetVerifier(identity.sharedSignals, { fetch: deps.fetch }) : undefined;
  }

  /** Whether `path` is one this module serves. */
  handles(path: string): boolean { return path === scimBase || path.startsWith(`${scimBase}/`) || path === sharedSignalsPath; }

  /** Serves a SCIM or Shared Signals request. Either part answers 404 while it is unconfigured or its flag is off. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (url.pathname === sharedSignalsPath) return this.receive(req, res);
    if (!this.scim) return notFound(res, 'application/scim+json');
    const caller = this.scim.authenticate(req);
    if (!await this.deps.enabled('identity.scim', caller?.tenant ?? defaultTenant)) return notFound(res, 'application/scim+json');
    let target: ScimTarget | undefined;
    res.once('finish', () => this.record(scimActor(caller?.tenant ?? null), `${req.method ?? 'GET'} ${scimBase}${routeShape(url.pathname.slice(scimBase.length))}`, req.method ?? 'GET', target ? { kind: target.kind, id: target.id } : null, { ...(url.search ? { query: Object.fromEntries(url.searchParams) } : {}) }, res.statusCode, req.method !== 'GET'));
    await this.scim.handle(req, res, url, caller, value => { target = value; });
  }

  /**
   * The memberships a person signs in with: what the sign-in's groups grant, and what every Tenant's SCIM Users of the
   * person grant, so a Tenant's provisioning survives a sign-in whose groups do not name that Tenant.
   */
  signInMemberships(userId: string, claimed: readonly Membership[]): Membership[] {
    return signInMemberships(this.accounts, userId, claimed);
  }

  /** Ends one sign-in, for sign-out: its session or editor credential, its Agents-window tokens and kept sign-in tokens. */
  signOut(signIn: string, userId: string | undefined): RevocationCounts {
    const counts = this.revocation.signIn(signIn);
    console.log(JSON.stringify({ level: 'info', event: 'identity.signed_out', user: userId ?? null, ...counts }));
    return counts;
  }

  /**
   * Whether a person who just signed in with single sign-on may have a session: false when the provider turned their
   * account off. A SCIM User of the installation token waiting to be linked by email is linked to them first, with its
   * state and Groups. So is each Tenant's waiting SCIM User whose externalId is the customer identity provider's user
   * id the sign-in carries, or else whose email is the sign-in's, one per Tenant.
   */
  admit(identity: SigningIn): boolean {
    if (identity.idpUserId) this.accounts.rememberIdpUserId(identity.id, identity.idpUserId);
    this.linkTenantUsers(identity);
    if (identity.email) {
      const waiting = this.accounts.users(null, { field: 'email', value: identity.email }, 0, 5).items.find(user => user.userId === null) ?? this.accounts.users(null, { field: 'userName', value: identity.email }, 0, 1).items.find(user => user.userId === null);
      if (waiting && !this.accounts.usersOf(identity.id).some(record => record.tenant === null)) {
        const linked = this.accounts.saveUser({ ...waiting, userId: identity.id });
        if (!linked.active) this.accounts.disable(identity.id, 'scim', 'SCIM set active to false');
        const names = this.accounts.groupNamesOf(linked.id);
        if (names.length && this.deps.store.getUser(identity.id)) this.deps.store.setMemberships(identity.id, membershipsFromGroups(names));
        this.provisioned({ userId: identity.id, change: 'updated', detail: { linkedBy: 'email' } });
      }
    }
    const off = this.accounts.disabled(identity.id);
    if (off) console.error(JSON.stringify({ level: 'warn', event: 'login.refused', user: identity.id, disabledBy: off.by }));
    return !off;
  }

  private linkTenantUsers(identity: SigningIn): void {
    const waiting = (records: ScimUserRecord[]) => records.filter(record => record.tenant !== null && record.userId === null);
    const byIdp = identity.idpUserId ? waiting(this.accounts.users(undefined, { field: 'externalId', value: identity.idpUserId }, 0, 50).items) : [];
    const byEmail = identity.email ? waiting([...this.accounts.users(undefined, { field: 'email', value: identity.email }, 0, 50).items, ...this.accounts.users(undefined, { field: 'userName', value: identity.email }, 0, 50).items]) : [];
    const linkedTenants = new Set(this.accounts.usersOf(identity.id).map(record => record.tenant));
    for (const [record, linkedBy] of [...byIdp.map(item => [item, 'idpUserId'] as const), ...byEmail.map(item => [item, 'email'] as const)]) {
      if (linkedTenants.has(record.tenant)) continue;
      linkedTenants.add(record.tenant);
      const tenant = record.tenant!;
      const linked = this.accounts.saveUser({ ...record, userId: identity.id });
      const elsewhere = signInMemberships(this.accounts, identity.id, identity.memberships ?? []).some(entry => entry.tenant !== tenant);
      if (!linked.active && linkedBy === 'idpUserId' && !elsewhere && !this.accounts.disabled(identity.id)) this.accounts.disable(identity.id, disabledBy(tenant), `SCIM of Tenant ${tenant} set active to false`);
      this.provisioned({ userId: identity.id, change: 'updated', detail: { tenant, linkedBy } });
    }
  }

  /** Ends every credential `userId` holds and records it. */
  private revoke(userId: string, cause: string, actor: Actor): RevocationCounts {
    const counts = this.revocation.person(userId);
    console.log(JSON.stringify({ level: 'info', event: 'identity.revoked', user: userId, cause, by: actor.id, ...counts }));
    this.record(actor, `REVOKE ${cause}`, 'REVOKE', { kind: 'person', id: userId }, { cause, ended: { browserSessions: counts.browserSessions, editors: counts.editorCredentials, agentsWindow: counts.agentsWindowTokens, delegated: counts.delegatedCredentials, keptSignIns: counts.personGrants } }, 200, true);
    return counts;
  }

  private provisioned(effect: ScimEffect): void {
    console.log(JSON.stringify({ level: 'info', event: `identity.${effect.change}`, user: effect.userId, by: 'scim', ...(effect.detail ? { detail: effect.detail } : {}) }));
  }

  private async receive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.verifier || !await this.deps.enabled('identity.shared-signals')) return notFound(res, 'application/json');
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
    let verified: VerifiedSet;
    try {
      verified = await this.verifier.verify(await readSet(req));
      if (!this.verifier.authorized(req, verified.transmitter)) throw new SetError('authentication_failed', 'The push carries no valid Authorization header for this transmitter.');
    } catch (error) {
      const refused = error instanceof SetError ? error : new SetError('invalid_request', 'The SET could not be read.');
      console.error(JSON.stringify({ level: 'warn', event: 'ssf.refused', err: refused.err, description: refused.message }));
      return refuseSet(res, refused, refused.err === 'authentication_failed' ? 401 : 400);
    }
    const actor: Actor = { id: `ssf:${verified.transmitter.name}`, name: `Shared Signals: ${verified.transmitter.name}`, channel: 'ssf' };
    const settings = this.deps.config.identity!.sharedSignals!;
    const first = this.accounts.firstDelivery(normalIssuer(verified.transmitter.issuer), verified.jti, new Date(Date.now() - settings.maxAgeHours * 2 * 3_600_000).toISOString());
    if (!first) {
      console.log(JSON.stringify({ level: 'info', event: 'ssf.duplicate', transmitter: verified.transmitter.name, jti: verified.jti }));
      res.writeHead(202); res.end();
      return;
    }
    for (const event of verified.events) this.act(verified, event, actor);
    res.writeHead(202); res.end();
  }

  private act(set: VerifiedSet, event: VerifiedEvent, actor: Actor): void {
    const name = eventName(event.type);
    const people = event.action === 'acknowledge' || event.action === 'ignore' ? [] : this.people(event.subject);
    const base = { level: 'info', transmitter: set.transmitter.name, jti: set.jti, eventType: name };
    if (event.action === 'acknowledge' || event.action === 'ignore') {
      console.log(JSON.stringify({ ...base, event: event.action === 'ignore' ? 'ssf.event_ignored' : 'ssf.event_acknowledged' }));
      this.record(actor, `SSF ${name}`, 'POST', null, { jti: set.jti, outcome: event.action }, 202, false);
      return;
    }
    if (!people.length) {
      console.log(JSON.stringify({ ...base, event: 'ssf.subject_unknown', subjectFormat: typeof event.subject?.format === 'string' ? event.subject.format : null }));
      this.record(actor, `SSF ${name}`, 'POST', null, { jti: set.jti, outcome: 'subject_unknown' }, 202, false);
      return;
    }
    for (const userId of people) {
      console.log(JSON.stringify({ ...base, event: 'ssf.event', user: userId, action: event.action }));
      this.record(actor, `SSF ${name}`, 'POST', { kind: 'person', id: userId }, { jti: set.jti, action: event.action }, 202, true);
      if (event.action === 'disable') {
        this.accounts.disable(userId, 'ssf', `${name} from ${set.transmitter.name}`);
        this.revoke(userId, `ssf.${name}`, actor);
      } else if (event.action === 'enable') {
        if (this.accounts.enable(userId, 'ssf')) console.log(JSON.stringify({ ...base, event: 'identity.reactivated', user: userId, by: actor.id }));
      } else this.revoke(userId, `ssf.${name}`, actor);
    }
  }

  /** The Unfold accounts a SET subject names: by issuer and subject, email, or a SCIM User's externalId or userName. */
  private people(subject: Subject | undefined, depth = 0): string[] {
    if (!subject || depth > 2) return [];
    const oidc = this.deps.config.auth.oidc!;
    const found = new Set<string>();
    const text = (value: unknown) => typeof value === 'string' && value.length <= 512 ? value : undefined;
    const known = (id: string) => { if (this.deps.store.getUser(id)) found.add(id); };
    const byEmail = (email: string) => {
      const user = this.deps.store.getUserByName(email);
      if (user) found.add(user.id);
      for (const record of this.accounts.users(undefined, { field: 'email', value: email }, 0, 10).items) if (record.userId) found.add(record.userId);
    };
    const format = subject.format;
    if (format === 'iss_sub') {
      const iss = text(subject.iss);
      const sub = text(subject.sub);
      if (iss && sub && normalIssuer(iss) === normalIssuer(oidc.issuer)) known(subjectUserId(oidc.subjectNamespace ?? oidc.issuer, sub));
    } else if (format === 'email') {
      const email = text(subject.email);
      if (email) byEmail(email.toLowerCase());
    } else if (format === 'complex') {
      for (const id of this.people(subject.user as Subject | undefined, depth + 1)) found.add(id);
    } else if (format === 'aliases' && Array.isArray(subject.identifiers)) {
      for (const item of subject.identifiers.slice(0, 10)) for (const id of this.people(item as Subject, depth + 1)) found.add(id);
    } else if (format === 'scim') {
      const externalId = text(subject.externalId);
      const userName = text(subject.userName);
      for (const record of [...(externalId ? this.accounts.users(undefined, { field: 'externalId', value: externalId }, 0, 5).items : []), ...(userName ? this.accounts.users(undefined, { field: 'userName', value: userName }, 0, 5).items : [])]) if (record.userId) found.add(record.userId);
      const emails = Array.isArray(subject.emails) ? subject.emails : [];
      for (const entry of emails.slice(0, 5)) { const email = text(typeof entry === 'string' ? entry : (entry as { value?: unknown })?.value); if (email) byEmail(email.toLowerCase()); }
    }
    return [...found];
  }

  private record(actor: Actor, action: string, method: string, target: { kind: string; id: string } | null, inputs: Record<string, unknown>, status: number, changed: boolean): void {
    if (!changed && status < 400 && method === 'GET') return;
    try {
      this.deps.store.recordAction({ at: new Date().toISOString(), userId: actor.id, userName: actor.name, role: 'system', channel: actor.channel, action, method, target: target as ActionTarget | null, inputs: recordedInputs(inputs) as Record<string, unknown>, confirmation: null, status, outcome: status >= 200 && status < 300 ? 'done' : status >= 400 && status < 500 ? 'refused' : 'failed' });
    } catch (error) { console.error(JSON.stringify({ level: 'error', event: 'action_record.failed', action, message: String((error as Error).message).slice(0, 300) })); }
  }
}

function notFound(res: ServerResponse, type: string): void {
  res.writeHead(404, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(type === 'application/scim+json' ? { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '404', detail: 'SCIM provisioning is off on this workbench.' } : { err: 'access_denied', description: 'The Shared Signals receiver is off on this workbench.' }));
}

function routeShape(path: string): string { return path.replace(/\/(Users|Groups)\/[A-Za-z0-9-]{1,64}/, '/$1/:id'); }
