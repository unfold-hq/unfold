import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { PloegError, PloegOperatorRefusal, type PloegConnections } from './ploeg.ts';
import { optInRefusals, secondForgeOpen, type ChecklistLine, type OptInRefusal, type PloegSteps, type StepId } from './onboarding.ts';
import type { PloegRegistration, PublicRepository } from './stored-repositories.ts';
import { defaultTenant, repositoryKey } from './tenancy.ts';
import type { User } from './types.ts';

/** How Unfold sends a person on to GitHub: a form they post with the App manifest, or a page they open to install the App. */
export type FlowMethod = 'github_app_manifest' | 'github_app_installation';
/** A connection app Ploeg holds (Ploeg ADR-0195 section 1): a GitHub App it created from a manifest. Never a secret. */
export type ConnectionApp = { id: string; slug: string; owner: string | null };
/** A forge connection as Ploeg reports it, with the vendor account by its display login only. */
export type ForgeConnection = { id: string; kind: string; instance: string; method: string; source: 'runtime' | 'static'; state: string; invalidReason: string | null; account: string | null };
/** One repository a forge connection's grant reaches (Ploeg ADR-0193 section 3), and whether Ploeg already registered it. */
export type GrantedRepository = { repository: string; private: boolean; canWrite: boolean; registered: boolean; key: string | null; stored: boolean };
/** One check of a dry run or a registration, as Ploeg reported it. */
export type TargetCheck = { name: string; result: 'pass' | 'fail' | 'unknown'; text: string };
/** What a dry run or a registration came to: accepted with the target Ploeg would store, or refused with Ploeg's reason. */
export type TargetOutcome = {
  dryRun: boolean; outcome: 'accepted' | 'refused'; reason: string | null; message: string;
  checks: TargetCheck[]; target: { key: string; repository: string; branch: string; state: string } | null;
  readiness: PloegRegistration['readiness']; reasons: string[]; prepareAvailable: boolean; repository?: PublicRepository;
};
/** `GET /api/onboarding/github`: whether this Ploeg serves the steps, the apps and connections it holds, and what Unfold stored. */
export type GithubOverview = {
  demo: boolean; manage: boolean; served: { connect: boolean | null; register: boolean | null };
  secondForge: { forges: string[]; unread: boolean; waitsFor: { record: string; release: string | null } } | null;
  refused: { code: string; message: string; install: string | null } | null;
  callbackUrl: string | null; apps: ConnectionApp[]; connections: ForgeConnection[];
  accounts: { id: string; connection: string; account: string | null; state: string; createdAt: string; createdBy: string }[];
};

type PloegCalls = {
  operatorCall(user: User, path: string, options?: { method?: 'GET' | 'POST'; body?: unknown; slow?: boolean }): Promise<Record<string, unknown> | null>;
  connections(user: User, fresh?: boolean): Promise<PloegConnections>;
  isDemo: boolean;
};
type Steps = {
  manages(user: User): boolean;
  admit(user: User, id: StepId): Promise<void>;
  available(user: User, id: StepId, fresh?: boolean): Promise<{ served: boolean | null }>;
  notOptedIn(user: User, step: StepId, code: OptInRefusal): void;
};
type Repositories = {
  admitRegistration(user: User, url: string): void;
  register(user: User, input: { url: string; baseBranch: string; integrationAccount?: string }, registration: PloegRegistration): PublicRepository;
  repositories(): { key: string; tenant: string; name: string; ploeg?: PloegRegistration }[];
};
type StateStore = { getSecret<T>(id: string): T | undefined; setSecret(id: string, value: unknown): void };
type EntityFact = { action: 'create' | 'update'; type: string; uid: string; name: string; data?: Record<string, unknown> };
type Options = {
  db: DatabaseSync; store: StateStore; ploeg: PloegCalls; steps: Steps; repositories: Repositories;
  stored: () => Promise<boolean>; audit: (user: User, fact: EntityFact) => void;
  baseUrl: string | undefined; pinned: string; plan: PloegSteps; now?: () => Date;
};

type Tie = { user: string; signIn: string; at: string; flow: string; method: FlowMethod };
type Handoff = { user: string; signIn: string; expires: number; next: { kind: 'post'; url: string; manifest: string } | { kind: 'redirect'; url: string } };
/** Where the browser goes after Unfold relayed what GitHub handed back: a GitHub page, or the Connect GitHub page with the outcome. */
export type CallbackAnswer = { status: 303; location: string } | { status: 400; code: 'onboarding_state_invalid' };
/** The form a person posts to GitHub to create the App, served by Unfold because its pages may post forms only to itself. */
export type ManifestPage = { status: 200; action: string; manifest: string } | { status: 303; location: string } | { status: 404 };

/** The path GitHub sends a person back to after creating or installing the App; its query is never logged or stored. */
export const callbackPath = '/api/onboarding/github/callback';
const continuePath = '/api/onboarding/github/continue/';
const tieTtlMs = 10 * 60_000;
const connectGithubHref = '#settings/connections/github';
const tiesId = 'onboarding:github-flows';
const keyPattern = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const connectionId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const branchPattern = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]{1,255}$/;
const githubOrigin = 'https://github.com';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const short = (value: unknown, max = 200): string => typeof value === 'string' ? value.slice(0, max) : '';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const items = (value: unknown, max: number): Record<string, unknown>[] => Array.isArray(value) ? value.slice(0, max).map(object) : [];

/** The Unfold codes a refusal from Ploeg's connection or registration routes comes back as, with their HTTP status. */
export const githubRefusalTable = [
  { status: 400, code: 'onboarding_state_invalid' },
  { status: 409, code: 'second_forge_unsupported' },
  { status: 409, code: 'onboarding_base_url_missing' },
  { status: 422, code: 'connections_not_accepted' },
  { status: 422, code: 'registration_not_accepted' },
  { status: 403, code: 'permission_required' },
  { status: 403, code: 'person_claim_required' },
  { status: 409, code: 'github_flow_refused' },
  { status: 503, code: 'connection_unavailable' },
  { status: 422, code: 'target_refused' },
] as const;
const githubRefusals = Object.fromEntries(githubRefusalTable.map(entry => [entry.code, entry.status])) as Record<typeof githubRefusalTable[number]['code'], number>;

const optIn: ReadonlySet<string> = new Set(Object.keys(optInRefusals));
const flowWords: Record<string, string> = {
  unknown_flow: 'Ploeg does not know this connection attempt any more. Start Connect GitHub again.',
  flow_expired: 'The connection attempt expired before GitHub sent you back. Start Connect GitHub again.',
  flow_in_progress: 'Ploeg is already completing this connection. Reload the page in a moment.',
  flow_limit: 'Too many connection attempts are open. Wait 15 minutes for them to expire, then start again.',
  account_mismatch: 'GitHub answered for another account than the connection was made with, so Ploeg changed nothing.',
  already_connected: 'Ploeg already holds a live connection for this installation.',
  id_taken: 'Ploeg already uses this connection name, now or before. Pick another one.',
  connection_limit: 'Ploeg holds as many runtime connections as the installation allows (connections.max).',
  kind_not_allowed: 'The installation does not allow GitHub connections from the screen: connections.allow names no GitHub forge.',
  method_not_allowed: 'The installation does not allow this way of connecting GitHub: connections.allow does not list it.',
  redirect_uri_not_allowed: 'Ploeg does not list Unfold’s callback among the consumer’s connectionRedirectUris.',
  webhook_base_missing: 'Ploeg has no PLOEG_PUBLIC_WEBHOOK_BASE, so GitHub could not reach it with events.',
  capability_missing: 'This Ploeg’s GitHub adapter cannot make connections from the screen yet.',
  probe_failed: 'Ploeg checked the new connection and it did not work, so Ploeg stored nothing.',
  unknown_app: 'Ploeg holds no such GitHub App.',
};
const targetWords: Record<string, string> = {
  not_granted: 'The GitHub App is not installed on this repository. Add it to the installation on GitHub first.',
  grant_insufficient: 'The installation may only read this repository; Ploeg needs to push branches and open pull requests.',
  repository_not_found: 'GitHub has no such repository, or the App cannot see it.',
  probe_failed: 'A check failed; the checks below say which.',
  target_not_ready: 'Ploeg refuses this repository as it is; the checks below say why.',
  conflicts_with_static: 'The installation’s configuration already names this repository or key, and the configuration wins.',
  key_taken: 'Another repository already has this key. Pick another one.',
  target_exists: 'Ploeg already registered this repository with other settings.',
  target_limit: 'Ploeg holds as many runtime repositories as the installation allows (targetRegistration.max).',
  connection_unusable: 'The GitHub connection does not work right now. Reinstall the App or check it on GitHub.',
  unknown_connection: 'Ploeg holds no such GitHub connection.',
  capability_missing: 'This Ploeg’s GitHub adapter cannot register repositories at runtime yet.',
};

function checksOf(value: unknown): TargetCheck[] {
  return items(value, 50).map(entry => {
    const result = short(entry.result, 16);
    return { name: short(entry.name, 100) || 'check', result: result === 'pass' || result === 'fail' ? result : 'unknown', text: short(entry.detail, 500) };
  });
}

function readinessOf(...sources: Record<string, unknown>[]): { readiness: PloegRegistration['readiness']; reasons: string[]; prepareAvailable: boolean } {
  let readiness: PloegRegistration['readiness'] = 'unknown';
  const reasons: string[] = [];
  let prepareAvailable = false;
  for (const source of sources) {
    const nested = object(source.readiness);
    const verdict = typeof source.readiness === 'string' ? source.readiness : nested.state ?? nested.verdict ?? (typeof nested.ready === 'boolean' ? (nested.ready ? 'ready' : 'not_ready') : undefined);
    if (verdict === 'ready' || verdict === 'not_ready') readiness = verdict;
    for (const reason of [...items(nested.reasons, 20), ...items(source.reasons, 20)]) { const code = short(reason.code ?? reason.reason, 64); if (code && !reasons.includes(code)) reasons.push(code); }
    for (const reason of [...(Array.isArray(nested.reasons) ? nested.reasons : []), ...(Array.isArray(source.reasons) ? source.reasons : [])]) if (typeof reason === 'string' && !reasons.includes(reason.slice(0, 64))) reasons.push(reason.slice(0, 64));
    if (source.prepareAvailable === true || nested.prepareAvailable === true) prepareAvailable = true;
  }
  return { readiness, reasons, prepareAvailable };
}

function githubUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === githubOrigin && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}

function forgeConnection(entry: Record<string, unknown>): ForgeConnection {
  const account = object(entry.account);
  return { id: short(entry.id, 128), kind: short(entry.kind, 64), instance: short(entry.instance, 128), method: short(entry.method, 64), source: entry.source === 'static' ? 'static' : 'runtime', state: short(entry.state, 64) || 'unknown', invalidReason: short(entry.invalidReason, 64) || null, account: short(account.login, 200) || null };
}

/**
 * Connect GitHub and register repositories from Settings → Connections (OpenSpec change `self-serve-onboarding`,
 * slice S4; system ADR-0060). Ploeg owns the connection: it starts each flow and issues its `state` (Ploeg ADR-0195),
 * converts the manifest code, holds every key and registers each repository (Ploeg ADR-0193). Unfold ties each
 * `state` to the person's sign-in, sends the person to GitHub, relays the code or installation id once without keeping
 * it, and stores only the Ploeg connection id and the repositories Ploeg registered, granted to Own work. The
 * one-time step from Unfold to GitHub lives in this process's memory, so it assumes one Unfold replica, as its SQLite
 * store does; a restart between starting and continuing only means starting again.
 */
export class GithubConnections {
  private readonly options: Options;
  private readonly now: () => Date;
  private readonly handoffs = new Map<string, Handoff>();

  constructor(options: Options) { this.options = options; this.now = options.now ?? (() => new Date()); }

  /** Unfold's callback for GitHub's `redirect_url` and `setup_url`, or null without a `baseUrl`. */
  callbackUrl(): string | null { return this.options.baseUrl ? `${this.options.baseUrl.replace(/\/+$/, '')}${callbackPath}` : null; }

  private refuse(user: User, step: StepId, error: unknown, words: Record<string, string>, fallback: keyof typeof githubRefusals): never {
    if (!(error instanceof PloegOperatorRefusal)) throw error;
    if (optIn.has(error.code)) {
      this.options.steps.notOptedIn(user, step, error.code as OptInRefusal);
      throw new PloegError(githubRefusals[error.code as keyof typeof githubRefusals] ?? 422, error.code, `Ploeg serves this step, but the installation has not opted in (${error.code}). The person who installed Ploeg sets: ${optInRefusals[error.code as OptInRefusal].value}.`);
    }
    if (error.code === 'secret_store_unavailable' || error.code === 'vendor_unavailable') throw new PloegError(503, 'connection_unavailable', error.code === 'secret_store_unavailable' ? 'Ploeg’s secret store did not answer, so Ploeg stored nothing. The person who installed Ploeg checks its SecretStore; then try again.' : 'GitHub did not answer Ploeg. Try again in a minute.');
    if (['person_token_required', 'ploeg_person_unproven'].includes(error.code)) throw new PloegError(403, 'person_claim_required', 'Ploeg makes this change only for a person it can prove. Sign out and in again so Unfold can exchange your sign-in for Ploeg.');
    throw new PloegError(githubRefusals[fallback], fallback, `${words[error.code] ?? (error.message || 'Ploeg refused it.')} (Ploeg: ${error.code})`);
  }

  private async call(user: User, path: string, body?: Record<string, unknown>, slow = false): Promise<Record<string, unknown>> {
    return object(await this.options.ploeg.operatorCall(user, path, body === undefined ? {} : { method: 'POST', body, ...(slow ? { slow } : {}) }));
  }

  private async pages(user: User, path: string, field: string, max: number): Promise<Record<string, unknown>[]> {
    const found: Record<string, unknown>[] = [];
    let after: string | null = null;
    do {
      const data = await this.call(user, `${path}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      found.push(...items(data[field], 100));
      after = typeof data.nextCursor === 'string' && data.nextCursor && data.nextCursor !== after ? data.nextCursor : null;
    } while (after && found.length < max);
    return found.slice(0, max);
  }

  private ties(): Record<string, Tie> {
    const cutoff = this.now().getTime() - tieTtlMs;
    return Object.fromEntries(Object.entries(this.options.store.getSecret<Record<string, Tie>>(tiesId) ?? {}).filter(([, tie]) => Date.parse(tie.at) > cutoff));
  }

  private tie(user: User, signIn: string, state: string, flow: string, method: FlowMethod): void {
    this.options.store.setSecret(tiesId, { ...this.ties(), [hash(state)]: { user: user.id, signIn: hash(signIn), at: this.now().toISOString(), flow, method } });
  }

  private tied(state: string): Tie | undefined { return this.ties()[hash(state)]; }

  private untie(state: string): void {
    const ties = this.ties();
    delete ties[hash(state)];
    this.options.store.setSecret(tiesId, ties);
  }

  private async secondForge(user: User): Promise<GithubOverview['secondForge']> {
    const { pair, secondForge } = this.options.plan;
    const waitsFor = { record: secondForge.record, release: secondForge.release };
    if (secondForgeOpen(this.options.plan, this.options.pinned)) return null;
    const read = await this.options.ploeg.connections(user, true).catch(() => null);
    if (!read || !read.supported) return { forges: [], unread: true, waitsFor };
    const forges = [...new Set(read.repositories.map(repository => repository.forge))].filter(forge => forge !== pair.forge);
    return forges.length ? { forges, unread: false, waitsFor } : null;
  }

  /**
   * What the Connect GitHub page shows. It asks Ploeg only reads and writes nothing: a refused read is shown with the
   * install value that opts the installation in, and each connection's state is Ploeg's live one.
   */
  async overview(user: User): Promise<GithubOverview> {
    const manage = this.options.steps.manages(user);
    const base = { manage, callbackUrl: manage ? this.callbackUrl() : null, accounts: this.accounts(), refused: null };
    if (this.options.ploeg.isDemo) return { demo: true, served: { connect: false, register: false }, secondForge: null, apps: [], connections: [], ...base };
    const [connect, register] = await Promise.all([this.options.steps.available(user, 'connect-github', true), this.options.steps.available(user, 'register-repositories', true)]);
    const served = { connect: connect.served, register: register.served };
    if (served.connect === false) return { demo: false, served, secondForge: null, apps: [], connections: [], ...base };
    let connections: ForgeConnection[];
    try { connections = (await this.pages(user, 'forge-connections', 'connections', 200)).map(forgeConnection).filter(entry => entry.kind === this.options.plan.pair.forge); }
    catch (error) {
      if (!(error instanceof PloegOperatorRefusal) || error.status >= 500) return { demo: false, served: { ...served, connect: served.connect === true ? true : null }, secondForge: null, apps: [], connections: [], ...base };
      if (error.status === 404 && error.code === 'not_found') return { demo: false, served: { ...served, connect: false }, secondForge: null, apps: [], connections: [], ...base };
      const install = optIn.has(error.code) ? optInRefusals[error.code as OptInRefusal].value : null;
      return { demo: false, served: { ...served, connect: true }, secondForge: null, apps: [], connections: [], ...base, refused: { code: error.code, message: install ? `Ploeg serves this step, but the installation has not opted in (${error.code}).` : error.message, install } };
    }
    const [apps, secondForge] = await Promise.all([
      this.call(user, 'connection-apps').then(data => items(data.connectionApps, 50).filter(entry => entry.kind === this.options.plan.pair.forge).map(entry => ({ id: short(entry.id, 128), slug: short(entry.slug, 100), owner: short(object(entry.owner).login, 100) || null }))).catch(() => []),
      this.secondForge(user),
    ]);
    const live = new Map(connections.map(entry => [entry.id, entry]));
    const accounts = base.accounts.map(entry => { const found = live.get(entry.connection); return { ...entry, state: found ? found.state : 'removed', account: found?.account ?? entry.account }; });
    return { demo: false, served: { ...served, connect: true }, secondForge, apps, connections, ...base, accounts };
  }

  /**
   * The Connect GitHub and Register repositories lines of the onboarding checklist, once Ploeg serves the steps: the
   * second-forge state, then green from the connections and repositories made on this screen.
   */
  lines(manage: boolean, context: { otherForges: string[] }): Partial<Record<StepId, ChecklistLine>> {
    const { pair, secondForge } = this.options.plan;
    const ask = manage ? {} : { fix: 'Ask an administrator to connect this.' };
    const link = (label: string) => manage ? { action: { label, href: connectGithubHref, kind: 'link' as const } } : {};
    const list = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    const registered = this.options.repositories.repositories().filter(entry => entry.tenant === defaultTenant && entry.ploeg);
    const blocked = context.otherForges.length > 0 && !secondForgeOpen(this.options.plan, this.options.pinned);
    return {
      'connect-github': blocked
        ? { id: 'connect-github', stage: 2, title: 'Connect GitHub', status: 'unavailable', reason: 'second_forge_unsupported', text: `This installation pushes to ${list(context.otherForges)}. Adding ${pair.forgeName} needs Ploeg ${secondForge.release ?? `with ${secondForge.record}, not released yet`}.`, waitsFor: { record: secondForge.record, release: secondForge.release }, ...ask }
        : this.usable() > 0
          ? { id: 'connect-github', stage: 2, title: 'Connect GitHub', status: 'ok', text: `Ploeg holds a ${pair.forgeName} connection made from this screen.`, ...link('Add another installation') }
          : { id: 'connect-github', stage: 2, title: 'Connect GitHub', status: 'pending', text: `Create the ${pair.forgeName} App with ${pair.forgeName}’s App manifest flow, or install the App Ploeg already holds, on the repositories agents may work on. Ploeg keeps every key; Unfold keeps none.`, ...ask, ...link('Connect GitHub') },
      'register-repositories': registered.length
        ? { id: 'register-repositories', stage: 3, title: 'Register repositories', status: 'ok', text: `Ploeg registered ${registered.length === 1 ? '1 repository' : `${registered.length} repositories`} from this screen: ${list(registered.map(entry => entry.name))}.`, ...link('Register more') }
        : { id: 'register-repositories', stage: 3, title: 'Register repositories', status: 'pending', text: 'Pick repositories the GitHub App reaches. Ploeg checks each one in a dry run before it registers it.', ...ask, ...link('Pick repositories') },
    };
  }

  /**
   * Starts a Ploeg flow for `user`: the App manifest flow, or installing an App Ploeg already holds. Ploeg issues the
   * `state`; Unfold ties its hash to this sign-in for ten minutes and answers a one-time address on Unfold that sends
   * the person on to GitHub. Refused before anything is sent for someone who is not an Admin, a Ploeg that does not
   * serve the step, an installation that serves another forge, or an Unfold without a `baseUrl`.
   */
  async start(user: User, signIn: string | undefined, input: unknown): Promise<{ flow: { id: string; method: FlowMethod; expiresAt: string }; continue: string }> {
    await this.options.steps.admit(user, 'connect-github');
    if (!signIn) throw new PloegError(403, 'browser_only', 'Connect GitHub from Unfold in your browser.');
    const data = object(input);
    const method: FlowMethod = data.method === 'install' ? 'github_app_installation' : 'github_app_manifest';
    const app = typeof data.app === 'string' && connectionId.test(data.app) ? data.app : undefined;
    const owner = typeof data.owner === 'string' && data.owner !== '' ? data.owner : undefined;
    if (method === 'github_app_installation' && !app) throw new PloegError(400, 'invalid_input', 'Name the GitHub App Ploeg holds to install it: {method: "install", app}.');
    if (owner !== undefined && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) throw new PloegError(400, 'invalid_input', 'owner must be a GitHub organisation login, or left out for your own account.');
    const callback = this.callbackUrl();
    if (!callback) throw new PloegError(409, 'onboarding_base_url_missing', 'Unfold has no baseUrl, so GitHub could not send you back. The person who installed Unfold sets baseUrl to its public address.');
    const secondForge = await this.secondForge(user);
    if (secondForge?.unread) throw new PloegError(503, 'ploeg_unavailable', 'Unfold could not read which forges this installation pushes to, so it started no GitHub connection and sent Ploeg nothing. Try again in a minute.');
    if (secondForge) throw new PloegError(409, 'second_forge_unsupported', `This installation pushes to ${secondForge.forges.join(', ')}. Adding GitHub needs Ploeg ${secondForge.waitsFor.release ?? `with ${secondForge.waitsFor.record}, not released yet`}, so Unfold sent Ploeg nothing.`);
    let answer: Record<string, unknown>;
    try { answer = await this.call(user, 'connection-flows', { port: 'forge', kind: this.options.plan.pair.forge, instance: this.options.plan.pair.forge, method, redirectUri: callback, ...(app && method === 'github_app_installation' ? { app } : {}), ...(owner && method === 'github_app_manifest' ? { owner } : {}) }); }
    catch (error) { return this.refuse(user, 'connect-github', error, flowWords, 'github_flow_refused'); }
    const flow = object(answer.flow);
    const state = short(flow.state, 512);
    const next = this.nextOf(method, object(answer.next));
    if (!state || !next || !short(flow.id, 128)) throw new PloegError(502, 'ploeg_response', 'Ploeg answered the start of the connection in a form this Unfold cannot read.');
    this.tie(user, signIn, state, short(flow.id, 128), method);
    const handoff = randomBytes(24).toString('base64url');
    this.handoffs.set(handoff, { user: user.id, signIn: hash(signIn), expires: this.now().getTime() + tieTtlMs, next });
    return { flow: { id: short(flow.id, 128), method, expiresAt: short(flow.expiresAt, 64) }, continue: `${continuePath}${handoff}` };
  }

  private nextOf(method: FlowMethod, next: Record<string, unknown>): Handoff['next'] | undefined {
    if (method === 'github_app_installation') { const url = githubUrl(next.installUrl); return url ? { kind: 'redirect', url } : undefined; }
    const url = githubUrl(next.postUrl);
    if (typeof next.manifest !== 'string' || next.manifest.length > 65_536) return undefined;
    let manifest: Record<string, unknown>;
    try { manifest = object(JSON.parse(next.manifest)); } catch { return undefined; }
    return url && Object.keys(manifest).length ? { kind: 'post', url, manifest: JSON.stringify(manifest) } : undefined;
  }

  /** The one-time step from Unfold to GitHub for the person who started the flow, in the same sign-in. */
  continue(user: User | undefined, signIn: string | undefined, id: string): ManifestPage {
    for (const [key, entry] of this.handoffs) if (entry.expires < this.now().getTime()) this.handoffs.delete(key);
    const handoff = this.handoffs.get(id);
    if (!handoff || !user || !signIn || handoff.user !== user.id || handoff.signIn !== hash(signIn)) return { status: 404 };
    this.handoffs.delete(id);
    return handoff.next.kind === 'redirect' ? { status: 303, location: handoff.next.url } : { status: 200, action: handoff.next.url, manifest: handoff.next.manifest };
  }

  /**
   * Handles GitHub sending the person back: checks that the `state` is one Unfold tied to this person's sign-in in
   * the last ten minutes, then relays the manifest code or the installation id to Ploeg. It forgets the `state` once
   * Ploeg completed the flow or refused it, and keeps it when Ploeg could not answer, so reloading the page gets Ploeg's
   * `replayed` answer (Ploeg ADR-0195 section 11). Nothing GitHub sent is stored or logged. After the App is created,
   * the person goes straight on to install it.
   */
  async callback(user: User | undefined, signIn: string | undefined, query: URLSearchParams): Promise<CallbackAnswer> {
    const state = query.get('state') ?? '';
    const code = query.get('code');
    const installation = query.get('installation_id');
    const tie = state && state.length <= 512 ? this.tied(state) : undefined;
    const method: FlowMethod | undefined = installation ? 'github_app_installation' : code ? 'github_app_manifest' : undefined;
    if (!tie || !user || !signIn || tie.user !== user.id || tie.signIn !== hash(signIn) || tie.method !== method || !this.options.steps.manages(user)) return { status: 400, code: 'onboarding_state_invalid' };
    const back = (outcome: string, value: string) => ({ status: 303 as const, location: `/?${outcome}=${encodeURIComponent(value)}#settings/connections/github` });
    try {
      if (method === 'github_app_manifest') {
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(code!)) return { status: 400, code: 'onboarding_state_invalid' };
        const answer = await this.call(user, 'connection-flows/complete', { state, code }, true);
        this.untie(state);
        const app = object(answer.connectionApp);
        if (short(app.id, 128)) this.options.audit(user, { action: 'create', type: 'GitHub App', uid: short(app.id, 128), name: `GitHub App ${short(app.slug, 100) || short(app.id, 128)} created through Ploeg`, data: { change: 'created_from_manifest' } });
        const flow = object(answer.flow);
        const next = this.nextOf('github_app_installation', object(answer.next));
        const nextState = short(flow.state, 512);
        if (!next || !nextState || !short(flow.id, 128)) return back('github', 'app_created');
        this.tie(user, signIn, nextState, short(flow.id, 128), 'github_app_installation');
        return { status: 303, location: next.url };
      }
      if (!/^[1-9][0-9]{0,19}$/.test(installation!)) return { status: 400, code: 'onboarding_state_invalid' };
      const setupAction = query.get('setup_action') === 'request' ? 'request' : query.get('setup_action') === 'update' ? 'update' : 'install';
      const answer = await this.call(user, 'connection-flows/complete', { state, installationId: installation, setupAction }, true);
      this.untie(state);
      const connection = forgeConnection(object(answer.connection));
      if (!connection.id) return back('github', 'connected');
      this.saveAccount(user, connection);
      return back('github', connection.state === 'awaiting_consent' ? 'awaiting_consent' : 'connected');
    } catch (error) {
      if (error instanceof PloegOperatorRefusal && error.status < 500) this.untie(state);
      try { this.refuse(user, 'connect-github', error, flowWords, 'github_flow_refused'); }
      catch (refused) { return back('github_error', refused instanceof PloegError ? refused.code : 'connection_unavailable'); }
      return back('github_error', 'connection_unavailable');
    }
  }

  /** The repositories a forge connection's grant reaches, as Ploeg lists them, marked where Unfold already stored one. */
  async granted(user: User, connection: string): Promise<{ connection: string; repositories: GrantedRepository[] }> {
    if (!this.options.steps.manages(user)) throw new PloegError(403, 'forbidden', 'Only an administrator connects accounts and adds repositories and Lists.');
    if (!connectionId.test(connection)) throw new PloegError(400, 'invalid_input', 'Name a GitHub connection Ploeg holds.');
    let listed: Record<string, unknown>[];
    try { listed = await this.pages(user, `forge-connections/${encodeURIComponent(connection)}/repositories`, 'repositories', 1000); }
    catch (error) { return this.refuse(user, 'register-repositories', error, targetWords, 'target_refused'); }
    const stored = new Set(this.options.repositories.repositories().filter(entry => entry.tenant === defaultTenant).map(entry => entry.key));
    const repositories = listed.map(entry => {
      const repository = short(entry.fullName, 300);
      return { repository, private: entry.private === true, canWrite: entry.canWrite === true, registered: entry.registered === true, key: short(entry.key, 128) || null, stored: stored.has(repositoryKey(`${githubOrigin}/${repository}`)) };
    }).filter(entry => repositoryPattern.test(entry.repository));
    return { connection, repositories };
  }

  /**
   * Registers one repository the connection reaches as a runtime Work Target (Ploeg ADR-0193) under an explicit
   * lower-case key: always a dry run first, then, unless `dryRun`, the registration, after which Unfold stores the
   * repository and grants it to Own work. A refused dry run answers its checks; a refused registration stores nothing.
   */
  async register(user: User, input: unknown): Promise<TargetOutcome> {
    const data = object(input);
    const dryRun = data.dryRun !== false;
    const connection = typeof data.connection === 'string' && connectionId.test(data.connection) ? data.connection : '';
    const repository = typeof data.repository === 'string' && repositoryPattern.test(data.repository) ? data.repository : '';
    const key = typeof data.key === 'string' ? data.key : '';
    const branch = data.branch === undefined || data.branch === '' ? undefined : typeof data.branch === 'string' && branchPattern.test(data.branch) ? data.branch : null;
    if (!connection || !repository || branch === null) throw new PloegError(400, 'invalid_input', 'Send {connection, repository: "owner/name", key}, and branch only to name a base branch other than the default.');
    if (!keyPattern.test(key)) throw new PloegError(400, 'invalid_input', 'Name the repository’s key yourself, in lower case: letters, digits and . _ : - only, such as acme-shop. Tasks pick it with the label repo/<key>.');
    if (!dryRun && !await this.options.stored()) throw new PloegError(404, 'repositories_off', 'Adding repositories from the screen is off: turn on the repositories.stored flag.');
    await this.options.steps.admit(user, 'register-repositories');
    this.options.repositories.admitRegistration(user, `${githubOrigin}/${repository}`);
    const body = { connection, repository, key, ...(branch ? { branch } : {}) };
    const trial = await this.attempt(user, 'targets?dryRun=true', body, true);
    if (dryRun || trial.outcome === 'refused') return trial;
    const done = await this.attempt(user, 'targets', body, false);
    if (done.outcome === 'refused') throw new PloegError(422, 'target_refused', `${done.message} (Ploeg: ${done.reason})`);
    const account = this.accountFor(connection);
    const registration: PloegRegistration = { target: done.target?.key || key, connection, readiness: done.readiness, reasons: done.reasons, prepareAvailable: done.prepareAvailable, registeredAt: this.now().toISOString() };
    const stored = this.options.repositories.register(user, { url: `${githubOrigin}/${repository}`, baseBranch: done.target?.branch || branch || 'main', ...(account ? { integrationAccount: account } : {}) }, registration);
    return { ...done, repository: stored };
  }

  private async attempt(user: User, path: string, body: Record<string, unknown>, dryRun: boolean): Promise<TargetOutcome> {
    try {
      const answer = await this.call(user, path, body);
      const target = object(answer.target);
      const { readiness, reasons, prepareAvailable } = readinessOf(answer, target);
      return { dryRun, outcome: 'accepted', reason: null, message: dryRun ? 'Ploeg would register this repository.' : 'Ploeg registered this repository.', checks: checksOf(answer.checks ?? target.checks), target: { key: short(target.key, 128) || String(body.key), repository: short(target.repository, 300) || String(body.repository), branch: short(target.branch, 255), state: short(target.state, 64) || (dryRun ? 'not_registered' : 'active') }, readiness, reasons, prepareAvailable };
    } catch (error) {
      if (!(error instanceof PloegOperatorRefusal) || optIn.has(error.code) || ['secret_store_unavailable', 'vendor_unavailable', 'person_token_required', 'ploeg_person_unproven'].includes(error.code)) return this.refuse(user, 'register-repositories', error, targetWords, 'target_refused');
      const { readiness, reasons, prepareAvailable } = readinessOf(error.detail, object(error.detail.target));
      return { dryRun, outcome: 'refused', reason: error.code, message: targetWords[error.code] ?? (error.message || 'Ploeg refused this repository.'), checks: checksOf(error.detail.checks), target: null, readiness, reasons, prepareAvailable };
    }
  }

  private accounts(): GithubOverview['accounts'] {
    return (this.options.db.prepare("SELECT body FROM integration_accounts WHERE tenant=? AND role='forge' AND provider=? ORDER BY created_at, id").all(defaultTenant, this.options.plan.pair.forge) as { body: string }[])
      .map(row => JSON.parse(row.body) as { id: string; ploegConnection?: string; account?: string | null; state?: string; createdAt: string; createdBy: string })
      .filter(entry => entry.ploegConnection)
      .map(entry => ({ id: entry.id, connection: entry.ploegConnection!, account: entry.account ?? null, state: entry.state ?? 'unknown', createdAt: entry.createdAt, createdBy: entry.createdBy }));
  }

  /** How many GitHub connections made from this screen Ploeg last reported usable. */
  usable(): number { return this.accounts().filter(entry => entry.state === 'active' || entry.state === 'awaiting_consent').length; }

  private accountFor(connection: string): string | undefined { return this.accounts().find(entry => entry.connection === connection)?.id; }

  private saveAccount(user: User, connection: ForgeConnection): void {
    const at = this.now().toISOString();
    const existing = this.accounts().find(entry => entry.connection === connection.id);
    const id = existing?.id ?? `ia-${randomBytes(6).toString('hex')}`;
    const body = { id, tenant: defaultTenant, role: 'forge', provider: this.options.plan.pair.forge, baseUrl: githubOrigin, ploegConnection: connection.id, account: connection.account, state: connection.state, createdAt: existing?.createdAt ?? at, createdBy: existing?.createdBy ?? user.name, updatedAt: at, updatedBy: user.name };
    this.options.db.prepare("INSERT INTO integration_accounts(id,tenant,role,provider,base_url,account_id,created_at,body) VALUES(?,?,'forge',?,?,?,?,?) ON CONFLICT(tenant,provider,base_url,account_id) DO UPDATE SET body=excluded.body").run(id, defaultTenant, body.provider, githubOrigin, connection.id, body.createdAt, JSON.stringify(body));
    this.options.audit(user, { action: existing ? 'update' : 'create', type: 'Integration Account', uid: id, name: `GitHub connection ${connection.id}${connection.account ? ` (${connection.account})` : ''}`, data: { role: 'forge', provider: body.provider, ploegConnection: connection.id, state: connection.state } });
  }
}

/** The page that posts the App manifest to GitHub: one button, no script, its only form target GitHub. */
export function manifestPage(action: string, manifest: string): { html: string; csp: string } {
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Create the GitHub App</title><link rel="stylesheet" href="/styles.css"></head><body><main><h1>Create the GitHub App</h1><p>GitHub opens with the App’s name, permissions and webhook filled in by Ploeg. Check them and create the App; GitHub then sends you back to Unfold to install it.</p><form method="post" action="${escapeHtml(action)}"><input type="hidden" name="manifest" value="${escapeHtml(manifest)}"><button type="submit" class="button">Continue to GitHub</button></form><p><a href="/#settings/connections/github">Back to Connect GitHub</a></p></main></body></html>`;
  return { html, csp: `default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action ${githubOrigin}` };
}

/** The page a callback Unfold cannot match to the person's sign-in answers with: nothing was relayed. */
export function invalidStatePage(): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Start Connect GitHub again</title><link rel="stylesheet" href="/styles.css"></head><body><main><h1>Start Connect GitHub again</h1><p>Unfold could not match this return from GitHub to a connection you started in this sign-in within the last ten minutes, so it sent Ploeg nothing (onboarding_state_invalid).</p><p><a href="/#settings/connections/github">Back to Connect GitHub</a></p></main></body></html>';
}
