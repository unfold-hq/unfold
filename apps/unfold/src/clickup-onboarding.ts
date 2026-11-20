import { createHash } from 'node:crypto';
import { PloegError, PloegOperatorRefusal, type PloegConnections, type PloegTeam } from './ploeg.ts';
import type { PloegBinding, PloegBindingCheck, PloegConnectionApi, PloegScopeLevel, PloegTrackerConnection } from './ploeg-connection-api.ts';
import { optInRefusals, pinnedRelease, ploegSteps, unavailableText, type ChecklistLine, type OptInRefusal, type PloegStep, type StepId } from './onboarding.ts';
import { findTaskProvider, type ServiceAccountGuide } from './task-providers/index.ts';
import { apiRoot, type TaskTarget } from './tasks.ts';
import { defaultTenant } from './tenancy.ts';
import type { ConnectionSource, SourceBinding, TrackerConnection, TrackerConnections } from './tracker-connections.ts';
import type { AppConfig, User } from './types.ts';

/** What the onboarding needs from the checklist backbone (slice S1) and the spend-cap gate (slice S6). */
type Steps = { manages(user: User): boolean; admit(user: User, id: StepId, team?: string): Promise<void>; notOptedIn(user: User, step: StepId, code: OptInRefusal): void; available(user: User, id: StepId, fresh?: boolean): Promise<{ step: PloegStep; served: boolean | null }> };
type Reads = { connections(user: User, fresh?: boolean): Promise<PloegConnections>; routing(user: User, fresh?: boolean): Promise<{ all: PloegTeam[] }> };
type Pending = { user: string; signIn: string; at: string };
/** What identifies the signed-in Admin's own ClickUp account: its immutable user ids where Unfold knows them, and the names and email addresses it goes by. */
export type Personal = { ids: string[]; names: string[] };
/** One change the onboarding made, for the Tenant's audit chain. Never a token, code or `state`. */
export type ClickUpChange = { user: User; tenant: string; entity: 'Tracker connection' | 'Tracker binding'; action: 'create' | 'delete'; uid: string; name: string; data: Record<string, string> };
type Options = {
  steps: Steps; api: PloegConnectionApi; reads: Reads; connections: TrackerConnections; config: Pick<AppConfig, 'baseUrl' | 'links'>;
  store: { getSecret<T>(id: string): T | undefined; setSecret(id: string, value: unknown): void; deleteSecret(id: string): void };
  personal?: (user: User) => Personal; now?: () => Date; audit?: (change: ClickUpChange) => void; demo?: boolean; pinned?: string;
};

/** A repository the map step offers: a Work Target Ploeg reports ready, and the Unfold repository with the same owner/name and base branch. */
export type BindableRepository = { key: string; repositoryId: string; name: string; target: TaskTarget };
/** A Team the map step offers, and whether a List may be bound to it during onboarding (its spend cap is not null). */
export type BindableTeam = { id: string; bindable: boolean };
/** A check of the map step as the page shows it. */
export type ShownCheck = PloegBindingCheck;
/** What Connect ClickUp shows: the member guide, which steps this Ploeg serves, the connections Ploeg holds and the Lists bound through them. */
export type ClickUpView = {
  manage: boolean; demo: boolean; guide: { why: string; steps: string[]; docs: string; tokenLabel: string; tokenShape: string } | null;
  steps: { connect: boolean | null; lists: boolean | null; bind: boolean | null };
  connections: { id: string; account: string; method: string; setAt: string | null; ploeg: { id: string; state: string; invalidReason: string | null } | null; sources: (ConnectionSource & { line: ChecklistLine })[] }[];
  unrecorded: { id: string; account: string; state: string }[];
};

const provider = 'clickup';
const pendingId = (state: string) => `clickup-flow:${createHash('sha256').update(state).digest('hex')}`;
const pendingMinutes = 10;
const listId = /^[A-Za-z0-9_-]{1,64}$/;
const scopeRef = /^[a-z][a-z_]{0,31}:[\x21-\x7e]{1,256}$/;
const targetKey = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const repositoryPath = (url: string) => { try { return new URL(url).pathname.replace(/^\//, '').replace(/\.git$/, '').toLowerCase(); } catch { return ''; } };
const fail = (status: number, code: string, message: string) => new PloegError(status, code, message);

/**
 * Connect ClickUp and bind Lists (OpenSpec change `self-serve-onboarding`, slice S5; system ADR-0060): the member's
 * token or an OAuth code goes once to Ploeg's connection flow (Ploeg ADR-0195) and Unfold keeps only the connection
 * id; Lists come from Ploeg's Scope read; a List is bound to a Team and ready repositories through Ploeg ADR-0186,
 * dry run first. Every step is admitted through the checklist backbone, so nothing reaches a Ploeg that does not
 * serve it, and binding passes the spend-cap gate.
 */
export class ClickUpOnboarding {
  private readonly options: Options;
  constructor(options: Options) { this.options = options; }

  private get connections(): TrackerConnections { return this.options.connections; }
  private now(): Date { return this.options.now?.() ?? new Date(); }
  private manage(user: User): void { if (!this.options.steps.manages(user)) throw fail(403, 'forbidden', 'Only an administrator connects ClickUp and binds Lists.'); }

  /** The member guide of the ClickUp adapter's setup capability, in plain words. */
  guide(): ClickUpView['guide'] {
    const guide: ServiceAccountGuide | undefined = findTaskProvider(provider)?.setup?.serviceAccount;
    if (!guide?.member) return null;
    return { why: guide.member.why, steps: [...guide.member.steps], docs: guide.docs, tokenLabel: guide.tokenLabel, tokenShape: guide.tokenShape };
  }

  /** What Connect ClickUp shows to `user`, with each bound List's state read from Ploeg again when Ploeg serves the binding read. */
  async view(user: User): Promise<ClickUpView> {
    const manage = this.options.steps.manages(user);
    const served = async (id: StepId) => { try { return (await this.options.steps.available(user, id, true)).served; } catch { return null; } };
    const [connect, lists, bind] = await Promise.all([served('connect-clickup'), served('read-scopes'), served('bind-lists')]);
    const held = connect ? await this.options.api.trackerConnections(user).catch(() => null) : null;
    if (bind && manage) await this.refresh(user).catch(() => undefined);
    const recorded = new Set(this.held().map(connection => connection.ploeg.connection));
    const sources = this.connections.sources();
    return {
      manage, demo: this.options.demo === true, guide: this.guide(), steps: { connect, lists, bind },
      connections: this.held().map(connection => {
        const found = held?.find(entry => entry.id === connection.ploeg!.connection);
        return { id: connection.id, account: connection.account ?? '', method: connection.ploeg!.method, setAt: connection.tokenSetAt ?? null, ploeg: found ? { id: found.id, state: found.state, invalidReason: found.invalidReason } : null, sources: sources.filter(source => source.connection === connection.id).map(source => ({ ...source, line: sourceLine(source, manage) })) };
      }),
      unrecorded: manage ? (held ?? []).filter(entry => entry.kind === provider && entry.source === 'runtime' && !recorded.has(entry.id)).map(entry => ({ id: entry.id, account: entry.account?.login || entry.account?.email || '', state: entry.state })) : [],
    };
  }

  /** The checklist lines of Connect ClickUp and Bind Lists, from what Unfold holds, for a Ploeg that serves the steps. */
  lines(manage: boolean): Partial<Record<StepId, ChecklistLine>> {
    const held = this.held();
    const action = (label: string) => manage ? { action: { label, href: '#settings/connect-clickup', kind: 'link' as const } } : { fix: 'Ask an administrator to connect this.' };
    const connect: ChecklistLine = held.length
      ? { id: 'connect-clickup', stage: 4, title: 'Connect ClickUp', status: 'ok', text: `Ploeg holds the ClickUp connection of ${held.map(connection => connection.account || connection.ploeg!.connection).join(' and ')}; Unfold keeps no token.`, ...(manage ? { action: { label: 'Open Connect ClickUp', href: '#settings/connect-clickup', kind: 'link' as const } } : {}) }
      : { id: 'connect-clickup', stage: 4, title: 'Connect ClickUp', status: 'pending', text: 'Create the ClickUp member Unfold works as, then hand its token to Ploeg once.', ...action('Connect ClickUp') };
    const bound = this.connections.sources().filter(source => held.some(connection => connection.id === source.connection));
    const lines = bound.map(source => sourceLine(source, manage));
    const status = !lines.length ? 'pending' : lines.some(line => line.status === 'problem') ? 'problem' : lines.some(line => line.status !== 'ok') ? 'warning' : 'ok';
    const bind: ChecklistLine = { id: 'bind-lists', stage: 9, title: 'Bind Lists', status, text: lines.length ? `${lines.filter(line => line.status === 'ok').length} of ${lines.length} Lists are bound and active.` : 'No List is bound to a Team yet.', ...(status === 'ok' ? {} : action(lines.length ? 'Check the Lists' : 'Bind a List')) };
    return { 'connect-clickup': connect, 'bind-lists': bind };
  }

  private held(): (TrackerConnection & { ploeg: NonNullable<TrackerConnection['ploeg']> })[] {
    return this.connections.connections().filter((connection): connection is TrackerConnection & { ploeg: NonNullable<TrackerConnection['ploeg']> } => connection.provider === provider && Boolean(connection.ploeg) && connection.tenant === defaultTenant);
  }

  /** Whether `url` is a page on ClickUp's own HTTPS origin, the only place Unfold sends a person to sign in. */
  private clickUpPage(url: string): boolean {
    try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.origin === new URL(this.options.config.links?.clickup?.appUrl ?? 'https://app.clickup.com').origin && !parsed.username && !parsed.password; }
    catch { return false; }
  }

  private root(): string { return apiRoot(`${(this.options.config.links?.clickup?.apiUrl ?? 'https://api.clickup.com').replace(/\/+$/, '')}/api/v2`, provider); }

  /**
   * Hands a pasted member token to Ploeg's token flow and keeps nothing: `400 connection_token_invalid` before any
   * request when it does not have ClickUp's token shape, and `400 connection_token_personal`, after asking Ploeg to
   * remove the connection again, when the account Ploeg names is the signed-in Admin's own. That check is best effort:
   * it matches the account's immutable id against the Admin's linked ClickUp account where Unfold knows that id, and
   * otherwise only names and email addresses, so a member that shares none of them passes.
   */
  async connectWithToken(user: User, input: Record<string, unknown>): Promise<TrackerConnection> {
    this.manage(user);
    const guide = findTaskProvider(provider)?.setup?.serviceAccount;
    const token = input.token;
    if (typeof token !== 'string' || token.length > 4096 || /[^\x21-\x7e]/.test(token) || !guide?.tokenPattern.test(token)) throw fail(400, 'connection_token_invalid', `That is not ${guide?.tokenShape ?? 'a ClickUp token'}. Copy the whole token again from ClickUp.`);
    await this.options.steps.admit(user, 'connect-clickup');
    const flow = await this.ploeg(user, 'connect-clickup', () => this.options.api.startFlow(user, { kind: provider, instance: ploegSteps.pair.tracker, method: 'token', label: 'Unfold member' }));
    const done = await this.complete(user, { state: flow.flow.state, token });
    return this.keep(user, done, 'token');
  }

  /** Starts Ploeg's OAuth flow for the installation's ClickUp OAuth application and remembers its `state` for this person's sign-in only, as a hash, for ten minutes. */
  async startOAuth(user: User, signIn: string | undefined): Promise<{ authorizeUrl: string }> {
    this.manage(user);
    if (!signIn) throw fail(403, 'browser_only', 'Sign in to ClickUp from the workbench in your browser.');
    if (!this.options.config.baseUrl) throw fail(409, 'onboarding_base_url_missing', 'Unfold does not know its own public address, so ClickUp could not send you back. Set baseUrl in the server configuration.');
    await this.options.steps.admit(user, 'connect-clickup');
    const redirectUri = `${this.options.config.baseUrl.replace(/\/+$/, '')}/api/onboarding/clickup/callback`;
    const flow = await this.ploeg(user, 'connect-clickup', () => this.options.api.startFlow(user, { kind: provider, instance: ploegSteps.pair.tracker, method: 'oauth', label: 'Unfold member', redirectUri }));
    if (!flow.authorizeUrl || !this.clickUpPage(flow.authorizeUrl)) throw fail(502, 'ploeg_response', 'Ploeg started the ClickUp sign-in without an address to send you to.');
    this.options.store.setSecret(pendingId(flow.flow.state), { user: user.id, signIn, at: this.now().toISOString() } satisfies Pending);
    return { authorizeUrl: flow.authorizeUrl };
  }

  /**
   * Relays the code ClickUp sent back to Ploeg: only for the same signed-in person within ten minutes of the start,
   * else `400 onboarding_state_invalid` and nothing is relayed. The `state` is kept until Ploeg completes the flow or
   * refuses it for good, so a callback retried after a lost answer gets Ploeg's `replayed` outcome (ADR-0195 section
   * 11) instead of a refusal; Ploeg exchanges the code at most once.
   */
  async completeOAuth(user: User, signIn: string | undefined, code: string, state: string): Promise<TrackerConnection> {
    this.manage(user);
    const id = /^[\x21-\x7e]{16,512}$/.test(state) ? pendingId(state) : '';
    const pending = id ? this.options.store.getSecret<Pending>(id) : undefined;
    const fresh = pending && Date.parse(pending.at) > this.now().getTime() - pendingMinutes * 60_000;
    if (!pending || !fresh || pending.user !== user.id || !signIn || pending.signIn !== signIn) throw fail(400, 'onboarding_state_invalid', 'This ClickUp sign-in was not started by you in this browser in the last ten minutes, so Unfold relayed nothing. Start it again.');
    if (!/^[\x21-\x7e]{1,1024}$/.test(code)) { this.options.store.deleteSecret(id); throw fail(400, 'onboarding_code_invalid', 'ClickUp sent back no usable code. Start the sign-in again.'); }
    let done: PloegTrackerConnection;
    try { done = await this.complete(user, { state, code }); }
    catch (error) {
      if (error instanceof PloegError && error.status >= 400 && error.status < 500 && error.code !== 'flow_in_progress') this.options.store.deleteSecret(id);
      throw error;
    }
    this.options.store.deleteSecret(id);
    return this.keep(user, done, 'oauth');
  }

  /** Completes a flow; `409 already_connected` names the live connection Ploeg already holds for that account, which is adopted instead. */
  private async complete(user: User, input: { state: string; token: string } | { state: string; code: string }): Promise<PloegTrackerConnection> {
    try { return (await this.ploeg(user, 'connect-clickup', () => this.options.api.completeFlow(user, input))).connection; }
    catch (error) {
      const named = error instanceof PloegOperatorRefusal && error.code === 'already_connected' ? existingId(error.detail.connection) : '';
      if (!named) throw error;
      const found = (await this.options.api.trackerConnections(user)).find(entry => entry.id === named);
      if (!found) throw error;
      return found;
    }
  }

  /**
   * Adopts a ClickUp connection Ploeg holds that Unfold has not recorded, such as one whose answer was lost: the same
   * own-account check as connecting, then recorded. `404 connection_not_found` for an id Ploeg does not report.
   */
  async adopt(user: User, ploegId: string): Promise<TrackerConnection> {
    this.manage(user);
    await this.options.steps.admit(user, 'connect-clickup');
    const found = (await this.ploeg(user, 'connect-clickup', () => this.options.api.trackerConnections(user))).find(entry => entry.id === ploegId && entry.kind === provider && entry.source === 'runtime');
    if (!found) throw fail(404, 'connection_not_found', 'Ploeg reports no ClickUp connection by this id. Reload Connect ClickUp to see the ones there are.');
    return this.keep(user, found, found.method || 'token');
  }

  /** Removes a ClickUp connection Ploeg holds that Unfold has not recorded. One Unfold has recorded is removed with {@link removeConnection}. */
  async removeUnrecorded(user: User, ploegId: string): Promise<{ removed: string }> {
    this.manage(user);
    if (this.held().some(connection => connection.ploeg.connection === ploegId)) throw fail(409, 'connection_recorded', 'Unfold has recorded this connection. Remove it from its own line, which checks the Lists that use it first.');
    await this.options.steps.admit(user, 'connect-clickup');
    await this.ploeg(user, 'connect-clickup', () => this.options.api.removeConnection(user, ploegId)).catch(error => { if (!(error instanceof PloegOperatorRefusal && error.status === 404)) throw error; });
    this.options.audit?.({ user, tenant: defaultTenant, entity: 'Tracker connection', action: 'delete', uid: ploegId, name: ploegId, data: { ploeg_connection: ploegId, change: 'unrecorded' } });
    return { removed: ploegId };
  }

  private async keep(user: User, connection: PloegTrackerConnection, method: string): Promise<TrackerConnection> {
    const personal = this.options.personal?.(user) ?? { ids: [], names: [user.name] };
    const own = new Set(personal.names.map(name => name.trim().toLowerCase()).filter(Boolean));
    const names = [connection.account?.email, connection.account?.login].filter((name): name is string => Boolean(name)).map(name => name.trim().toLowerCase());
    const sameId = Boolean(connection.account?.id) && personal.ids.includes(connection.account!.id);
    if (sameId || names.some(name => own.has(name))) {
      await this.options.api.removeConnection(user, connection.id).catch(error => { if (!(error instanceof PloegOperatorRefusal && error.status === 404)) throw error; });
      throw fail(400, 'connection_token_personal', 'That token belongs to your own ClickUp account, so Ploeg removed the connection again. Unfold needs a separate member: a token acts as the person who made it, so Unfold’s comments would look like yours, and ClickUp stops its webhooks when you leave. Create the member called Unfold and paste its token.');
    }
    const kept = this.connections.recordPloegConnection(user, { provider, baseUrl: this.root(), tenant: defaultTenant, account: connection.account?.login || connection.account?.email || connection.id, ploeg: { connection: connection.id, method, accountId: connection.account?.id ?? '' } });
    this.options.audit?.({ user, tenant: kept.tenant, entity: 'Tracker connection', action: 'create', uid: kept.id, name: kept.account ?? kept.id, data: { change: 'connected_through_ploeg', ploeg_connection: connection.id, method } });
    return kept;
  }

  /** Removes a connection Ploeg holds: refused with `409 connection_in_use` while a saved source uses it, then removed in Ploeg and forgotten here. Removing it twice succeeds twice. */
  async removeConnection(user: User, id: string): Promise<{ removed: string }> {
    this.manage(user);
    const connection = this.held().find(entry => entry.id === id);
    if (!connection) return { removed: id };
    const using = this.connections.sources().filter(source => source.connection === id);
    if (using.length) throw fail(409, 'connection_in_use', `Remove ${using.map(source => source.name).join(', ')} first; ${using.length === 1 ? 'it uses' : 'they use'} this connection.`);
    await this.options.steps.admit(user, 'connect-clickup');
    await this.ploeg(user, 'connect-clickup', () => this.options.api.removeConnection(user, connection.ploeg.connection)).catch(error => { if (!(error instanceof PloegOperatorRefusal && error.status === 404)) throw error; });
    this.connections.forgetPloegConnection(user, id);
    this.options.audit?.({ user, tenant: connection.tenant, entity: 'Tracker connection', action: 'delete', uid: id, name: connection.account ?? id, data: { ploeg_connection: connection.ploeg.connection } });
    return { removed: id };
  }

  /**
   * One level of the containers a connection Ploeg holds reaches, read through Ploeg's Scope read (Ploeg ADR-0196):
   * the top level without `parent`, else the level under the `ref` of a browsable Scope. Only a bindable Scope (a
   * ClickUp List) can be bound. Refused with `503 ploeg_step_unavailable` until the pinned Ploeg serves the read.
   */
  async lists(user: User, id: string, parent?: string, after?: string): Promise<PloegScopeLevel> {
    this.manage(user);
    const connection = this.connection(id);
    if (parent !== undefined && !scopeRef.test(parent)) throw fail(400, 'invalid_input', 'Open a level from the list Unfold showed; its reference is kind:id.');
    await this.options.steps.admit(user, 'read-scopes');
    return this.ploeg(user, 'read-scopes', () => this.options.api.scopes(user, connection.ploeg.connection, parent, after && /^[\x21-\x7e]{1,512}$/.test(after) ? after : undefined));
  }

  /** What the map step offers: Teams, each with whether a List may be bound to it now, and only the repositories Ploeg reports ready. */
  async mapOptions(user: User): Promise<{ teams: BindableTeam[]; repositories: BindableRepository[]; waiting: string[] }> {
    this.manage(user);
    const [connections, teams] = await Promise.all([this.options.reads.connections(user, true), this.options.reads.routing(user, true)]);
    const { ready, waiting } = this.bindable(connections);
    return { teams: teams.all.map(team => ({ id: team.id, bindable: team.spendCap !== null })), repositories: ready, waiting };
  }

  private bindable(connections: PloegConnections): { ready: BindableRepository[]; waiting: string[] } {
    const repositories = this.connections.repositoriesOf(defaultTenant);
    const ready: BindableRepository[] = [];
    const waiting: string[] = [];
    for (const target of connections.repositories) {
      const path = `${target.owner}/${target.repo}`.toLowerCase();
      const own = repositories.find(repository => repositoryPath(repository.url) === path && repository.baseBranch === target.baseBranch);
      if (!own) continue;
      if (target.readiness !== 'ready') { waiting.push(`${target.owner}/${target.repo}`); continue; }
      ready.push({ key: target.key, repositoryId: own.id, name: own.name, target: { forge: target.forge, owner: target.owner, repo: target.repo, baseBranch: target.baseBranch } });
    }
    return { ready, waiting };
  }

  /**
   * Binds one List to a Team and ready repositories through Ploeg ADR-0186: the dry run always runs first, and with
   * `dryRun` it is all that runs. A repository that is not ready is refused before anything is sent. A create that
   * Ploeg answers with the binding that already exists stores that one, so a retried create leaves one binding.
   * `409 conflicts_with_static` means the installation's configuration routes the List; nothing is stored then.
   */
  async bind(user: User, input: Record<string, unknown>): Promise<{ dryRun: boolean; checks: ShownCheck[]; binding: PloegBinding | null; source?: ConnectionSource; created: boolean }> {
    this.manage(user);
    const connection = this.connection(typeof input.connection === 'string' ? input.connection : '');
    const list = input.list && typeof input.list === 'object' && !Array.isArray(input.list) ? input.list as Record<string, unknown> : {};
    const scope = typeof list.id === 'string' ? list.id.trim() : '';
    const team = typeof input.team === 'string' ? input.team.trim() : '';
    const defaultKey = typeof input.default === 'string' ? input.default : '';
    const allow = Array.isArray(input.allow) ? [...new Set(input.allow.filter((key): key is string => typeof key === 'string'))] : [];
    if (!listId.test(scope) || !team || team.length > 128 || !targetKey.test(defaultKey) || allow.length > 20 || allow.some(key => !targetKey.test(key))) throw fail(400, 'invalid_input', 'Send the connection, the List id, the Team, the default repository key and at most 20 further repository keys.');
    await this.options.steps.admit(user, 'bind-lists', team);
    const { ready, waiting } = this.bindable(await this.options.reads.connections(user, true));
    const chosen = [defaultKey, ...allow].map(key => ready.find(repository => repository.key === key));
    if (chosen.some(found => !found)) throw fail(409, 'repository_not_ready', `Unfold binds a List only to repositories Ploeg reports ready${waiting.length ? `; ${waiting.join(', ')} ${waiting.length === 1 ? 'waits' : 'wait'} for its readiness pull request to be merged` : ''}. Nothing was sent to Ploeg.`);
    const name = typeof list.name === 'string' && list.name.trim() ? list.name.trim().slice(0, 100) : '';
    const body = { connection: connection.ploeg.connection, scope: { id: scope }, default: defaultKey, allow: allow.filter(key => key !== defaultKey), ...(name ? { label: name } : {}) };
    const dry = await this.ploeg(user, 'bind-lists', () => this.options.api.bind(user, team, body, true));
    if (input.dryRun === true || dry.checks.some(check => check.status === 'problem')) return { dryRun: true, checks: dry.checks, binding: dry.binding, created: false };
    let made: Awaited<ReturnType<PloegConnectionApi['bind']>>;
    try { made = await this.ploeg(user, 'bind-lists', () => this.options.api.bind(user, team, body, false)); }
    catch (error) {
      if (!(error instanceof PloegOperatorRefusal && error.code === 'binding_exists')) throw error;
      throw new PloegOperatorRefusal(409, 'binding_exists', 'Ploeg already holds a different binding for this List and Team. Remove it first, or bind with the same repositories.', error.detail);
    }
    if (!made.binding?.id) throw fail(502, 'ploeg_response', 'Ploeg answered the binding without its id.');
    const repository = chosen[0]!;
    const source = this.saveSource(user, connection, scope, name || made.binding.scopeName || dry.binding?.scopeName || `List ${scope}`, repository, team, made.binding);
    if (made.created) this.options.audit?.({ user, tenant: connection.tenant, entity: 'Tracker binding', action: 'create', uid: made.binding.id, name: source.name, data: { team, list: scope, default: defaultKey, state: made.binding.state } });
    return { dryRun: false, checks: dry.checks, binding: made.binding, source, created: made.created };
  }

  private saveSource(user: User, connection: TrackerConnection, scope: string, name: string, repository: BindableRepository, team: string, binding: PloegBinding): ConnectionSource {
    const existing = this.connections.sources().find(source => source.connection === connection.id && source.project === scope);
    const source = existing && existing.repositoryId === repository.repositoryId ? existing
      : existing ? this.connections.updateSource(user, connection.id, existing.id, { repositoryId: repository.repositoryId, executionOwner: 'ploeg' })
        : this.connections.addSource(user, connection.id, { project: scope, name, repositoryId: repository.repositoryId, executionOwner: 'ploeg' });
    const held: SourceBinding = { id: binding.id, team, state: binding.state === 'unknown' ? 'unknown' : binding.state, reason: binding.reason ?? binding.invalidReason, default: binding.default || repository.key, allow: binding.allow, target: repository.target, checkedAt: this.now().toISOString() };
    return this.connections.setBinding(source.id, held);
  }

  /** Reads every bound List's state from Ploeg again (**Check again**): a binding Ploeg no longer has is `removed`, and its source loses its target. */
  async refresh(user: User): Promise<ConnectionSource[]> {
    const held = new Set(this.held().map(connection => connection.id));
    const bound = this.connections.sources().filter(source => source.binding && held.has(source.connection));
    if (!bound.length) return [];
    const bindings = await this.options.api.bindings(user);
    return bound.map(source => {
      const found = bindings.find(entry => entry.id === source.binding!.id);
      const state: SourceBinding['state'] = found ? found.state : 'removed';
      const reason = found ? found.reason ?? found.invalidReason : null;
      if (state === source.binding!.state && reason === source.binding!.reason) return source;
      return this.connections.setBinding(source.id, { ...source.binding!, state, reason, checkedAt: this.now().toISOString() });
    });
  }

  /** **Check again** for one bound List. */
  async check(user: User, sourceId: string): Promise<ConnectionSource> {
    this.manage(user);
    const source = this.boundSource(sourceId);
    await this.serving(user, 'bind-lists');
    return (await this.ploeg(user, 'bind-lists', () => this.refresh(user))).find(entry => entry.id === source.id) ?? source;
  }

  /** Removes a List's binding in Ploeg and drops it from the saved source. Ploeg answers an already removed binding with success, so a retry succeeds and records nothing twice. */
  async unbind(user: User, sourceId: string): Promise<{ removed: string | null }> {
    this.manage(user);
    const source = this.heldSource(sourceId);
    if (!source) throw fail(404, 'source_not_found', 'There is no such List. Reload Connect ClickUp to see the ones there are.');
    if (!source.binding) return { removed: null };
    const { id, team } = source.binding;
    await this.serving(user, 'bind-lists');
    await this.ploeg(user, 'bind-lists', () => this.options.api.unbind(user, team, id)).catch(error => { if (!(error instanceof PloegOperatorRefusal && error.status === 404)) throw error; });
    this.connections.setBinding(source.id, null);
    this.options.audit?.({ user, tenant: source.tenant, entity: 'Tracker binding', action: 'delete', uid: id, name: source.name, data: { team, list: source.project } });
    return { removed: id };
  }

  /** Whether `user` connects ClickUp, binds Lists and removes a binding: a Tenant admin. */
  manages(user: User): boolean { return this.options.steps.manages(user); }

  /** The Lists bound to a Team through this Tenant's Ploeg-held ClickUp connections, for the agent host's automation catalogue. A binding Ploeg no longer holds is left out. */
  boundLists(): { id: string; name: string; list: string; repositoryId: string; team: string; state: string; account: string }[] {
    const held = new Map(this.held().map(connection => [connection.id, connection]));
    return this.connections.sources().flatMap(source => {
      const connection = held.get(source.connection);
      if (!connection || !source.binding || source.binding.state === 'removed') return [];
      return [{ id: source.id, name: source.name, list: source.project, repositoryId: source.repositoryId, team: source.binding.team, state: source.binding.state, account: connection.account ?? '' }];
    });
  }

  /** Admits a step that only reads or undoes, without the spend-cap gate: `503 ploeg_step_unavailable` while this Ploeg does not serve it. */
  private async serving(user: User, id: StepId): Promise<void> {
    const { step, served } = await this.options.steps.available(user, id, true);
    if (served === true) return;
    if (served === null) throw fail(503, 'ploeg_unavailable', 'Ploeg could not be reached to check this step. Try again in a minute.');
    throw fail(503, 'ploeg_step_unavailable', unavailableText(step, this.options.pinned ?? pinnedRelease()));
  }

  /** A saved source of a connection this Tenant's Ploeg-held ClickUp connections include; any other source is absent. */
  private heldSource(sourceId: string): ConnectionSource | undefined {
    const held = new Set(this.held().map(connection => connection.id));
    return this.connections.sources().find(entry => entry.id === sourceId && held.has(entry.connection));
  }

  private boundSource(sourceId: string): ConnectionSource {
    const source = this.heldSource(sourceId);
    if (!source?.binding) throw fail(404, 'binding_not_found', 'This List is not bound. Bind it first.');
    return source;
  }

  private connection(id: string): TrackerConnection & { ploeg: NonNullable<TrackerConnection['ploeg']> } {
    const found = this.held().find(entry => entry.id === id);
    if (!found) throw fail(404, 'connection_not_found', 'There is no such ClickUp connection held by Ploeg. Reload Connect ClickUp to see the ones there are.');
    return found;
  }

  /** Runs one Ploeg call and turns an opt-in refusal into the installation line that names its install value. */
  private async ploeg<T>(user: User, step: StepId, call: () => Promise<T>): Promise<T> {
    try { return await call(); }
    catch (error) {
      if (error instanceof PloegOperatorRefusal && Object.hasOwn(optInRefusals, error.code)) {
        this.options.steps.notOptedIn(user, step, error.code as OptInRefusal);
        throw new PloegOperatorRefusal(error.status, error.code, `Ploeg serves this step, but the installation has not opted in (${error.code}). The person who installed Ploeg sets: ${optInRefusals[error.code as OptInRefusal].value}.`, error.detail);
      }
      if (error instanceof PloegOperatorRefusal && error.code === 'oauth_required') throw new PloegOperatorRefusal(409, 'oauth_required', 'This installation has a ClickUp OAuth application, so Ploeg takes no pasted token. Use Sign in to ClickUp as the Unfold member instead.', {});
      if (error instanceof PloegOperatorRefusal && error.code === 'method_not_allowed') throw new PloegOperatorRefusal(409, 'method_not_allowed', 'This installation does not allow this way of connecting ClickUp. Paste the member’s token instead, or ask the person who installed Ploeg which method it allows.', {});
      throw error;
    }
  }
}

const existingId = (value: unknown): string => typeof value === 'string' ? value : value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' ? (value as { id: string }).id : '';

/** A bound List's line: green only when Ploeg reports the binding `active`; `awaiting_webhook` amber with **Check again**; removed or invalid red with **Bind again**. */
export function sourceLine(source: ConnectionSource, manage: boolean): ChecklistLine {
  const base = { id: `bind-${source.id}`, stage: 9, title: source.name };
  const fix = (text: string, label: string, kind: 'refresh' | 'link') => manage ? { fix: text, action: kind === 'refresh' ? { label, kind } : { label, href: '#settings/connect-clickup', kind } } : { fix: 'Ask an administrator to connect this.' };
  const binding = source.binding;
  if (!binding) return { ...base, status: 'pending', text: 'Not bound to a Team yet.', ...fix('Map it to a Team and a ready repository.', 'Bind this List', 'link') };
  if (binding.state === 'active') return { ...base, status: 'ok', text: `Bound to Team ${binding.team}; Ploeg takes in tasks assigned to the Unfold member.` };
  if (binding.state === 'awaiting_webhook') return { ...base, status: 'warning', reason: 'awaiting_webhook', text: `Ploeg holds the binding but ClickUp sends it nothing yet${binding.reason ? `: ${binding.reason}` : ''}. Ploeg does not poll ClickUp, so no task arrives until a webhook delivers.`, ...fix('Check again once the webhook is in place.', 'Check again', 'refresh') };
  if (binding.state === 'shadowed') return { ...base, status: 'ok', configured: true, text: `Configured by the installation${binding.reason ? `: ${binding.reason}` : ''}. The configuration routes this List, so Unfold’s binding is not used.` };
  if (binding.state === 'removed') return { ...base, status: 'problem', reason: 'binding_removed', text: 'Ploeg no longer holds this binding, so tasks in this List reach nobody.', ...fix('Bind it again.', 'Bind again', 'link') };
  return { ...base, status: 'problem', reason: binding.reason ?? binding.state, text: `Ploeg reports the binding ${binding.state}${binding.reason ? ` (${binding.reason})` : ''}.`, ...fix('Bind it again, or remove it.', 'Bind again', 'link') };
}
