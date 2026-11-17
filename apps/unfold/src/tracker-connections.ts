import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig, User } from './types.ts';
import type { ServiceAccountGuide, TaskProviderAdapter } from './task-providers/index.ts';
import { request, TaskError } from './task-providers/shared.ts';
import type { PloegRoute } from './ploeg.ts';
import { canHandOff, validateTaskSources, type TaskSourceConfig, type TaskTarget } from './tasks.ts';
import { setupTarget } from './task-setup.ts';
import { defaultTenant, validTenancyId } from './tenancy.ts';
import { reaches } from './tenant-scope.ts';
import { ClientProjects, ensureIntegrationSchema, mirrorTrackerConnection, unmirrorTrackerConnection } from './integration-store.ts';
import { StoredRepositories } from './stored-repositories.ts';

/** A tracker account Unfold acts as on one tracker origin for one Tenant: an ADR-0048 Integration Account with role `tracker`. Its token is kept apart, encrypted. */
export type TrackerConnection = { id: string; provider: string; baseUrl: string; tenant: string; account?: string; tokenSetAt?: string; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string };
/** A task source a person added from the screen. It reads and hands off with its connection's token. Without a Client it belongs to its Tenant's Own work. */
export type ConnectionSource = { id: string; connection: string; name: string; project: string; repositoryId: string; executionOwner: 'interactive' | 'ploeg'; tenant: string; client?: string; clientProject?: string; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string };
/** Why a saved source is not in use: the server configuration already reads its project or uses its id, or its repository is no longer registered. */
export type SourceState = 'active' | 'shadowed' | 'repository_missing';
/** A connection as people see it: never its token, only whether one is stored. */
export type PublicConnection = TrackerConnection & { label: string; noun: string; token: 'set' | 'missing'; manage: boolean; sources: (ConnectionSource & { state: SourceState })[] };
/** The result of checking a connection's own token: one `service` check, as on the setup page. */
export type ConnectionCheck = { ok: boolean; account?: string; checks: { id: 'service'; status: 'ok' | 'problem'; title: string; text: string; fix?: string; code?: string }[] };

type SecretStore = { db: DatabaseSync; setSecret(id: string, value: unknown): void; getSecret<T>(id: string): T | undefined; deleteSecret(id: string): void };
type Credential = { token: string; tokenType?: 'bearer' };
type Options = { enforced: boolean; now?: () => Date; log?: (line: string) => void };

const secretId = (id: string) => `tracker-connection:${id}`;
const connectionId = /^tc-[a-f0-9]{12}$/;
const sourceSlug = /^[a-z0-9][a-z0-9-]{0,63}$/;
const maxSources = 200;

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new TaskError(400, 'connection_invalid', `${label} must be text of 1 to ${max} characters.`);
  return value.trim();
}

function slug(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'tasks';
  if (!taken.has(base)) return base;
  for (let index = 2; ; index++) if (!taken.has(`${base}-${index}`)) return `${base}-${index}`;
}

/**
 * Tracker connections people add from the screen (Unfold ADR-0064). Connections and their sources live in the
 * workbench database and each token in its encrypted internal state; {@link TrackerConnections.sync} puts the
 * sources into `config.taskSources` next to the configured ones, which win on the same id or project.
 */
export class TrackerConnections {
  private readonly store: SecretStore;
  private readonly config: AppConfig;
  private readonly options: Options;
  private readonly listeners: ((secret: string) => void)[] = [];
  private routes: PloegRoute[] = [];
  private readRoutes: (() => Promise<PloegRoute[]>) | undefined;
  /** Each Tenant's Client Projects, Own work among them. */
  readonly projects: ClientProjects;
  /** The repositories Admins added from the screen. */
  readonly repositories: StoredRepositories;

  constructor(store: SecretStore, config: AppConfig, options: Options) {
    this.store = store;
    this.config = config;
    this.options = options;
    const reconciled = ensureIntegrationSchema(store.db, this.now());
    if (reconciled.toIntegrationAccounts || reconciled.toTrackerConnections || reconciled.refreshed) this.log('tracker_connections.reconciled', reconciled);
    this.projects = new ClientProjects(store.db, config);
    this.repositories = new StoredRepositories(store.db, config, this.projects, { enforced: options.enforced, manages: (user, tenant) => this.manages(user, tenant), sees: (user, tenant) => this.sees(user, tenant), now: () => this.now(), log: (event, fields) => this.log(event, fields) });
  }

  private get db() { return this.store.db; }
  private now(): string { return (this.options.now?.() ?? new Date()).toISOString(); }
  private log(event: string, fields: Record<string, unknown>): void { (this.options.log ?? console.error)(JSON.stringify({ level: 'warn', event, ...fields })); }

  /** Calls `listener` with every token Unfold holds now and each one stored later, so redaction knows them. */
  onSecret(listener: (secret: string) => void): void {
    this.listeners.push(listener);
    for (const connection of this.connections()) { const held = this.credential(connection.id); if (held) listener(held.token); }
  }

  /** Every stored connection, oldest first. */
  connections(): TrackerConnection[] { return (this.db.prepare("SELECT body FROM integration_accounts WHERE role='tracker' ORDER BY created_at, id").all() as { body: string }[]).map(row => JSON.parse(row.body)); }
  /** One stored connection, or undefined. */
  connection(id: string): TrackerConnection | undefined {
    const row = this.db.prepare("SELECT body FROM integration_accounts WHERE id=? AND role='tracker'").get(id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  /** Every saved source, oldest first. */
  sources(): ConnectionSource[] {
    return (this.db.prepare('SELECT body, client_project_id FROM tracker_connection_sources ORDER BY created_at, id').all() as { body: string; client_project_id: string | null }[]).map(row => ({ ...JSON.parse(row.body), ...(row.client_project_id ? { clientProject: row.client_project_id } : {}) }));
  }
  private credential(id: string): Credential | undefined { return this.store.getSecret<Credential>(secretId(id)); }

  /** The Tenant of the connection or stored repository a `/api/tracker-connections/{id}…` or `/api/repositories/{id}` path names, read before a request changes it, for the audit chain. */
  ownerOf(path: string): string | undefined {
    const connection = /^\/api\/tracker-connections\/([^/]+)/.exec(path);
    if (connection) return this.connection(connection[1])?.tenant;
    const repository = /^\/api\/repositories\/([^/]+)$/.exec(path);
    return repository ? this.repositories.repository(repository[1])?.tenant : undefined;
  }

  /** Whether `user` adds, changes and removes connections of `tenant`: an administrator, and while tenancy is enforced an Admin of that Tenant. */
  manages(user: User, tenant: string): boolean {
    if (user.role !== 'admin') return false;
    return !this.options.enforced || (user.memberships ?? []).some(held => held.kind === 'tenant' && held.tenant === tenant && held.role === 'admin');
  }
  /** The Tenants whose connections `user` manages. */
  managedTenants(user: User): string[] {
    if (user.role !== 'admin') return [];
    if (!this.options.enforced) return [defaultTenant];
    return [...new Set((user.memberships ?? []).flatMap(held => held.kind === 'tenant' && held.role === 'admin' ? [held.tenant] : []))];
  }
  /** The Tenants whose connections, repositories and Client Projects `user` reaches: every Tenant Unfold holds something for while tenancy is not enforced. */
  reachedTenants(user: User): string[] {
    if (this.options.enforced) return [...new Set((user.memberships ?? []).flatMap(held => held.kind === 'tenant' ? [held.tenant] : []))].sort();
    const held = this.db.prepare('SELECT tenant FROM integration_accounts UNION SELECT tenant FROM repositories UNION SELECT tenant FROM client_projects').all() as { tenant: string }[];
    return [...new Set([defaultTenant, ...held.map(row => row.tenant)])].sort();
  }
  /** Whether `user` reaches what `tenant` owns. */
  sees(user: User, tenant: string): boolean { return !this.options.enforced || reaches(user, { tenant }); }

  private shadowing(source: ConnectionSource, connection: TrackerConnection): TaskSourceConfig | undefined {
    return (this.config.taskSources ?? []).find(entry => !entry.connection && (entry.id === source.id || (entry.provider === connection.provider && entry.baseUrl === connection.baseUrl && entry.project === source.project)));
  }
  private state(source: ConnectionSource, connection: TrackerConnection): SourceState {
    if (this.shadowing(source, connection)) return 'shadowed';
    return this.config.repositories.some(repository => repository.id === source.repositoryId) ? 'active' : 'repository_missing';
  }

  /** Lets stored repositories join `config.repositories`, or takes them out, and syncs when that changes. */
  joinStoredRepositories(on: boolean): void { if (this.repositories.join(on)) this.sync(); }

  /** Reads Ploeg's static routes with `read` from now on, so {@link TrackerConnections.refreshRoutes} can give saved sources their Ploeg target. */
  useRoutes(read: () => Promise<PloegRoute[]>): void { this.readRoutes = read; }
  /** Reads Ploeg's routes again and syncs, only while a saved source hands its work to Ploeg. When Ploeg cannot be read, the routes read before stay. */
  async refreshRoutes(): Promise<void> {
    if (!this.readRoutes || !this.sources().some(source => source.executionOwner === 'ploeg')) return;
    try {
      this.routes = await this.readRoutes();
      this.sync();
    } catch (error) { this.log('tracker_connections.routes_unread', { message: String((error as Error)?.message ?? error).slice(0, 200) }); }
  }

  private routedTarget(source: ConnectionSource, connection: TrackerConnection): TaskTarget | undefined {
    if (source.executionOwner !== 'ploeg' || !canHandOff(connection.provider)) return undefined;
    const repository = this.config.repositories.find(entry => entry.id === source.repositoryId);
    const path = repository ? (() => { try { return new URL(repository.url).pathname.replace(/^\//, '').replace(/\.git$/, ''); } catch { return undefined; } })() : undefined;
    if (!repository || !path) return undefined;
    const route = this.routes.find(entry => entry.tracker === connection.provider && entry.project === source.project);
    const target = route?.targets.find(entry => `${entry.owner}/${entry.repo}` === path && entry.baseBranch === repository.baseBranch);
    return target ? { forge: target.forge, owner: target.owner, repo: target.repo, baseBranch: target.baseBranch } : undefined;
  }

  /** Puts the stored repositories into `config.repositories` and the saved sources into `config.taskSources`, each after the configured ones, replacing what an earlier sync put there. */
  sync(): void {
    this.repositories.sync();
    const list = this.config.taskSources ??= [];
    for (let index = list.length - 1; index >= 0; index--) if (list[index].connection) list.splice(index, 1);
    const connections = new Map(this.connections().map(connection => [connection.id, connection]));
    for (const source of this.sources()) {
      const connection = connections.get(source.connection);
      if (!connection) continue;
      const state = this.state(source, connection);
      if (state !== 'active') { this.log('tracker_connections.source_unused', { source: source.id, reason: state }); continue; }
      const held = this.credential(connection.id);
      const target = this.routedTarget(source, connection);
      list.push({
        id: source.id, name: source.name, provider: connection.provider, baseUrl: connection.baseUrl, project: source.project, repositoryId: source.repositoryId, executionOwner: source.executionOwner,
        ...(held ? { token: held.token, ...(held.tokenType ? { tokenType: held.tokenType } : {}) } : {}),
        ...(target ? { ploeg: { target } } : {}), tenant: source.tenant, ...(source.client ? { client: source.client } : {}), connection: connection.id,
      });
    }
  }

  private guide(provider: string): { adapter: TaskProviderAdapter; guide: ServiceAccountGuide; root: string } {
    const { adapter, root } = setupTarget(this.config, provider);
    const guide = adapter.setup?.serviceAccount;
    if (!guide) throw new TaskError(404, 'setup_unsupported', `People cannot add ${adapter.label} connections from the screen here. An administrator adds them to the server configuration instead.`);
    return { adapter, guide, root };
  }

  private async verify(provider: string, root: string, token: unknown): Promise<{ credential: Credential; account?: string }> {
    const { adapter, guide } = this.guide(provider);
    if (typeof token !== 'string' || token.length > 4096 || /[^\x21-\x7e]/.test(token) || !guide.tokenPattern.test(token)) throw new TaskError(400, 'connection_token_invalid', `That is not ${guide.tokenShape}. Copy the whole token again from ${adapter.label}.`);
    const credential: Credential = { token, ...(guide.tokenType ? { tokenType: guide.tokenType } : {}) };
    const source: TaskSourceConfig = { id: 'connection', name: adapter.label, provider: adapter.name, baseUrl: root, project: '', repositoryId: '', executionOwner: 'ploeg', ...credential };
    try {
      return { credential, account: await adapter.setup!.account((path, query) => request(source, path, query)) };
    } catch (error) {
      if (error instanceof TaskError && error.code === 'task_credentials_rejected') throw new TaskError(400, 'connection_token_rejected', `${adapter.label} refused this token. Generate it again while signed in as the ${guide.noun} Unfold acts as, then paste it here.`);
      throw error;
    }
  }

  private owned(user: User, id: string): TrackerConnection {
    const connection = connectionId.test(id) ? this.connection(id) : undefined;
    if (!connection || !this.sees(user, connection.tenant)) throw new TaskError(404, 'connection_not_found', 'There is no such tracker connection. Reload Connect a tracker to see the ones there are.');
    if (!this.manages(user, connection.tenant)) throw new TaskError(403, 'forbidden', `Only an administrator${this.options.enforced ? ` of Tenant ${connection.tenant}` : ''} changes tracker connections.`);
    return connection;
  }

  private publicConnection(user: User, connection: TrackerConnection): PublicConnection {
    const { adapter, guide } = (() => { try { return this.guide(connection.provider); } catch { return { adapter: undefined, guide: undefined }; } })();
    const sources = this.sources().filter(source => source.connection === connection.id).map(source => ({ ...source, state: this.state(source, connection) }));
    return { ...connection, label: adapter?.label ?? connection.provider, noun: guide?.noun ?? 'account', token: this.credential(connection.id) ? 'set' : 'missing', manage: this.manages(user, connection.tenant), sources };
  }

  /** The connections `user` reaches, with their sources and whether `user` may change them. Never a token. */
  list(user: User): PublicConnection[] { return this.connections().filter(connection => this.sees(user, connection.tenant)).map(connection => this.publicConnection(user, connection)); }

  /** The connection `user` reaches for a tracker origin: theirs to hand off with, when there is one. */
  forOrigin(user: User, provider: string, baseUrl: string): (TrackerConnection & { credential?: Credential }) | undefined {
    const found = this.connections().find(connection => connection.provider === provider && connection.baseUrl === baseUrl && this.sees(user, connection.tenant));
    if (!found) return undefined;
    const held = this.credential(found.id);
    return { ...found, ...(held ? { credential: held } : {}) };
  }

  /** Adds a connection for `provider` in `tenant` after the tracker accepted `token`, which is then stored encrypted. */
  async create(user: User, input: Record<string, unknown>): Promise<PublicConnection> {
    const provider = text(input.provider, 'Tracker', 64);
    const tenant = input.tenant === undefined || input.tenant === null || input.tenant === '' ? defaultTenant : input.tenant;
    if (!validTenancyId(tenant)) throw new TaskError(400, 'connection_invalid', 'Tenant must be a Tenant id: lower-case letters, digits and inner hyphens.');
    if (!this.manages(user, tenant)) throw new TaskError(403, 'forbidden', `Only an administrator${this.options.enforced ? ` of Tenant ${tenant}` : ''} adds tracker connections.`);
    const { adapter, root } = this.guide(provider);
    const existing = this.connections().find(connection => connection.tenant === tenant && connection.provider === adapter.name && connection.baseUrl === root);
    if (existing) throw new TaskError(409, 'connection_exists', `This Tenant already has a ${adapter.label} connection. Replace its token instead of adding a second one.`);
    const { credential, account } = await this.verify(adapter.name, root, input.token);
    const at = this.now();
    const connection: TrackerConnection = { id: `tc-${randomBytes(6).toString('hex')}`, provider: adapter.name, baseUrl: root, tenant, ...(account ? { account } : {}), tokenSetAt: at, createdAt: at, createdBy: user.name, updatedAt: at, updatedBy: user.name };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("INSERT INTO integration_accounts(id,tenant,role,provider,base_url,account_id,created_at,body) VALUES(?,?,'tracker',?,?,'',?,?)").run(connection.id, tenant, connection.provider, root, at, JSON.stringify(connection));
      mirrorTrackerConnection(this.db, connection, JSON.stringify(connection));
      this.store.setSecret(secretId(connection.id), credential);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    for (const listener of this.listeners) listener(credential.token);
    return this.publicConnection(user, connection);
  }

  /** Replaces a connection's token after the tracker accepted the new one. The old one is forgotten at once. */
  async replaceToken(user: User, id: string, input: Record<string, unknown>): Promise<PublicConnection> {
    const connection = this.owned(user, id);
    const { credential, account } = await this.verify(connection.provider, connection.baseUrl, input.token);
    const at = this.now();
    const updated: TrackerConnection = { ...connection, ...(account ? { account } : {}), tokenSetAt: at, updatedAt: at, updatedBy: user.name };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE integration_accounts SET body=? WHERE id=?').run(JSON.stringify(updated), id);
      mirrorTrackerConnection(this.db, updated, JSON.stringify(updated));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.store.setSecret(secretId(id), credential);
    for (const listener of this.listeners) listener(credential.token);
    this.sync();
    return this.publicConnection(user, updated);
  }

  /** Removes a connection and forgets its token. Refused while sources still use it. */
  remove(user: User, id: string): void {
    const connection = this.owned(user, id);
    const using = this.sources().filter(source => source.connection === connection.id);
    if (using.length) throw new TaskError(409, 'connection_in_use', `Remove ${using.map(source => source.name).join(', ')} first; ${using.length === 1 ? 'it reads' : 'they read'} with this connection.`);
    this.store.deleteSecret(secretId(id));
    this.db.prepare('DELETE FROM integration_accounts WHERE id=?').run(id);
    unmirrorTrackerConnection(this.db, id);
  }

  /** Checks the connection's own token with one cheap read and changes nothing. A refusal is a `problem`, not an error. */
  async check(user: User, id: string): Promise<ConnectionCheck> {
    const connection = connectionId.test(id) ? this.connection(id) : undefined;
    if (!connection || !this.sees(user, connection.tenant)) throw new TaskError(404, 'connection_not_found', 'There is no such tracker connection. Reload Connect a tracker to see the ones there are.');
    const { adapter, guide } = this.guide(connection.provider);
    const title = `Unfold's ${guide.noun}`;
    const held = this.credential(id);
    if (!held) return { ok: false, checks: [{ id: 'service', status: 'problem', title, text: 'No token is stored for this connection, so Unfold cannot hand tasks off with it.', fix: 'An administrator pastes the token again under Replace token.', code: 'connection_token_missing' }] };
    const source: TaskSourceConfig = { id: 'connection', name: adapter.label, provider: adapter.name, baseUrl: connection.baseUrl, project: '', repositoryId: '', executionOwner: 'ploeg', ...held };
    try {
      const account = await adapter.setup!.account((path, query) => request(source, path, query));
      return { ok: true, ...(account ? { account } : {}), checks: [{ id: 'service', status: 'ok', title, text: account ? `${adapter.label} accepts the token of ${account}.` : `${adapter.label} accepts the token.` }] };
    } catch (error) {
      if (!(error instanceof TaskError)) throw error;
      return { ok: false, checks: [{ id: 'service', status: 'problem', title, text: error.message, fix: error.code === 'task_credentials_rejected' ? `Generate a new token as the ${guide.noun} and paste it under Replace token.` : 'Try again in a minute.', code: error.code }] };
    }
  }

  private sourceInput(user: User, connection: TrackerConnection, input: Record<string, unknown>, id: string, previous?: ConnectionSource): ConnectionSource {
    const project = previous?.project ?? text(input.project, 'Project', 512);
    const name = input.name === undefined && previous ? previous.name : text(input.name, 'Name', 100);
    const repositoryId = input.repositoryId === undefined && previous ? previous.repositoryId : text(input.repositoryId, 'Repository', 64);
    const executionOwner = input.executionOwner === undefined ? previous?.executionOwner ?? 'ploeg' : input.executionOwner;
    if (executionOwner !== 'ploeg' && executionOwner !== 'interactive') throw new TaskError(400, 'connection_invalid', 'executionOwner is ploeg or interactive.');
    const client = input.client === undefined ? previous?.client : input.client === null || input.client === '' ? undefined : input.client;
    if (client !== undefined && !validTenancyId(client)) throw new TaskError(400, 'connection_invalid', 'Client must be a Client id: lower-case letters, digits and inner hyphens.');
    let checked: TaskSourceConfig;
    try {
      [checked] = validateTaskSources([{ id, name, provider: connection.provider, baseUrl: connection.baseUrl, project, repositoryId, executionOwner, tenant: connection.tenant, ...(client ? { client } : {}) }], this.config.repositories, this.config.mode);
    } catch (error) { throw new TaskError(400, 'connection_invalid', String((error as Error).message).replace(/^taskSources\[0\] \([^)]*\) /, 'This task source ')); }
    const at = this.now();
    return { id, connection: connection.id, name: checked.name, project: checked.project, repositoryId: checked.repositoryId, executionOwner: checked.executionOwner, tenant: connection.tenant, ...(client ? { client } : {}), createdAt: previous?.createdAt ?? at, createdBy: previous?.createdBy ?? user.name, updatedAt: at, updatedBy: user.name };
  }

  /** Adds a task source that reads `project` with the connection's token, after the same checks a configured source passes at start-up. */
  addSource(user: User, id: string, input: Record<string, unknown>): ConnectionSource {
    const connection = this.owned(user, id);
    const all = this.config.taskSources ?? [];
    const saved = this.sources();
    if (saved.length >= maxSources) throw new TaskError(409, 'connection_invalid', `Unfold keeps at most ${maxSources} task sources added from the screen. Remove one first.`);
    const draft = this.sourceInput(user, connection, input, 'draft');
    const same = all.find(entry => entry.provider === connection.provider && entry.baseUrl === connection.baseUrl && entry.project === draft.project);
    if (same) throw new TaskError(409, 'source_exists', `${same.name} already reads it. Use that one, or remove it first.`);
    const source = { ...draft, id: slug(draft.name, new Set([...all.map(entry => entry.id), ...saved.map(entry => entry.id)])) };
    if (!sourceSlug.test(source.id)) throw new TaskError(400, 'connection_invalid', 'Give the source a name with letters or digits in it.');
    const clientProject = source.client ? undefined : this.projects.ownWork(source.tenant, user, source.createdAt).id;
    this.db.prepare('INSERT INTO tracker_connection_sources(id,connection_id,tenant,client,client_project_id,created_at,body) VALUES(?,?,?,?,?,?,?)').run(source.id, connection.id, source.tenant, source.client ?? null, clientProject ?? null, source.createdAt, JSON.stringify(source));
    this.sync();
    return { ...source, ...(clientProject ? { clientProject } : {}) };
  }

  private savedSource(connection: TrackerConnection, sourceId: string): ConnectionSource {
    const source = this.sources().find(entry => entry.id === sourceId && entry.connection === connection.id);
    if (source) return source;
    if ((this.config.taskSources ?? []).some(entry => entry.id === sourceId && !entry.connection)) throw new TaskError(409, 'source_read_only', 'This task source is in the server configuration, so it is changed there and not here.');
    throw new TaskError(404, 'source_not_found', 'There is no such task connection. Choose one from the Tasks page.');
  }

  /** Renames a saved source, points it at another repository or changes who executes its work. Its project stays. */
  updateSource(user: User, id: string, sourceId: string, input: Record<string, unknown>): ConnectionSource {
    const connection = this.owned(user, id);
    const previous = this.savedSource(connection, sourceId);
    const source = this.sourceInput(user, connection, input, previous.id, previous);
    const clientProject = source.client ? undefined : previous.client || !previous.clientProject ? this.projects.ownWork(source.tenant, user, source.updatedAt).id : previous.clientProject;
    this.db.prepare('UPDATE tracker_connection_sources SET client=?, client_project_id=?, body=? WHERE id=?').run(source.client ?? null, clientProject ?? null, JSON.stringify(source), source.id);
    this.sync();
    return { ...source, ...(clientProject ? { clientProject } : {}) };
  }

  /** Removes a saved source. Work Items it started stay in Ploeg; its tasks stop showing here. */
  removeSource(user: User, id: string, sourceId: string): void {
    const connection = this.owned(user, id);
    const source = this.savedSource(connection, sourceId);
    this.db.prepare('DELETE FROM tracker_connection_sources WHERE id=?').run(source.id);
    this.sync();
  }
}
