import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig, User } from './types.ts';
import { defaultTenant } from './tenancy.ts';

/** What an Integration Account is used for (system ADR-0048): reading a tracker or pushing to a forge. */
export type IntegrationRole = 'tracker' | 'forge';
/** A Client Project (system ADR-0048): a grouping inside one Client, or inside the Tenant's own work when it has no Client. */
export type ClientProject = { id: string; tenant: string; client?: string; slug: string; name: string; isDefault: boolean; createdAt: string; createdBy: string };

/** The name of each Tenant's default Client Project, the one without a Client. */
export const ownWorkName = 'Own work';
const ownWorkSlug = 'own-work';
const migrationActor = 'migration';

const tables = `
  CREATE TABLE IF NOT EXISTS client_projects (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, client TEXT, slug TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, body TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS client_projects_key ON client_projects(tenant, ifnull(client, ''), slug);
  CREATE UNIQUE INDEX IF NOT EXISTS client_projects_default ON client_projects(tenant) WHERE is_default = 1;
  CREATE TABLE IF NOT EXISTS integration_accounts (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('tracker', 'forge')), provider TEXT NOT NULL, base_url TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, body TEXT NOT NULL, UNIQUE (tenant, provider, base_url, account_id));
  CREATE TABLE IF NOT EXISTS tracker_connections (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL, UNIQUE (tenant, provider, base_url));
  CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, key TEXT NOT NULL UNIQUE, integration_account_id TEXT REFERENCES integration_accounts(id), created_at TEXT NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS repository_grants (client_project_id TEXT NOT NULL REFERENCES client_projects(id), repository_id TEXT NOT NULL REFERENCES repositories(id), granted_at TEXT NOT NULL, granted_by TEXT NOT NULL, PRIMARY KEY (client_project_id, repository_id));
  CREATE INDEX IF NOT EXISTS repository_grants_repository ON repository_grants(repository_id);
`;
const sourcesTable = 'CREATE TABLE tracker_connection_sources (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, tenant TEXT NOT NULL, client TEXT, client_project_id TEXT REFERENCES client_projects(id), created_at TEXT NOT NULL, body TEXT NOT NULL)';
const sourcesIndex = 'CREATE INDEX IF NOT EXISTS tracker_connection_sources_connection ON tracker_connection_sources(connection_id)';

const exists = (db: DatabaseSync, table: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));

function insertOwnWork(db: DatabaseSync, tenant: string, by: string, at: string): ClientProject {
  const project: ClientProject = { id: `cp-${randomBytes(6).toString('hex')}`, tenant, slug: ownWorkSlug, name: ownWorkName, isDefault: true, createdAt: at, createdBy: by };
  db.prepare('INSERT INTO client_projects(id,tenant,client,slug,is_default,created_at,body) VALUES(?,?,NULL,?,1,?,?)').run(project.id, tenant, project.slug, at, JSON.stringify(project));
  return project;
}

const defaultProject = (db: DatabaseSync, tenant: string) => db.prepare('SELECT body FROM client_projects WHERE tenant=? AND is_default=1').get(tenant) as { body: string } | undefined;

function transaction(db: DatabaseSync, work: () => void, foreignKeysOff = false): void {
  if (foreignKeysOff) db.exec('PRAGMA foreign_keys=OFF');
  db.exec('BEGIN IMMEDIATE');
  try { work(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } finally { if (foreignKeysOff) db.exec('PRAGMA foreign_keys=ON'); }
}

/**
 * Gives `tracker_connection_sources` the shape every Unfold since ADR-0064 can write: `client_project_id` added, and no
 * foreign key on `connection_id`, so an image from before the Integration Accounts, which writes `tracker_connections`,
 * and one that writes only `integration_accounts` can both add a source after a rollback. Rows are copied unchanged.
 */
function reshapeSources(db: DatabaseSync): void {
  if (!exists(db, 'tracker_connection_sources')) { db.exec(sourcesTable); db.exec(sourcesIndex); return; }
  const columns = (db.prepare('PRAGMA table_info(tracker_connection_sources)').all() as { name: string }[]).map(column => column.name);
  const keyed = (db.prepare('PRAGMA foreign_key_list(tracker_connection_sources)').all() as { from: string }[]).some(key => key.from === 'connection_id');
  if (columns.includes('client_project_id') && !keyed) { db.exec(sourcesIndex); return; }
  transaction(db, () => {
    db.exec('ALTER TABLE tracker_connection_sources RENAME TO tracker_connection_sources_before');
    db.exec('DROP INDEX IF EXISTS tracker_connection_sources_connection');
    db.exec(sourcesTable);
    db.exec(`INSERT INTO tracker_connection_sources(id,connection_id,tenant,client,client_project_id,created_at,body) SELECT id, connection_id, tenant, client, ${columns.includes('client_project_id') ? 'client_project_id' : 'NULL'}, created_at, body FROM tracker_connection_sources_before`);
    db.exec('DROP TABLE tracker_connection_sources_before');
    db.exec(sourcesIndex);
    const broken = db.prepare('PRAGMA foreign_key_check(tracker_connection_sources)').all();
    if (broken.length) throw new Error(`Reshaping the saved task sources left ${broken.length} rows without the Client Project they refer to`);
  }, true);
}

type ConnectionRow = { id: string; tenant: string; provider: string; base_url: string; created_at: string; body: string };
const updatedAt = (body: string): string => { try { return String((JSON.parse(body) as { updatedAt?: unknown }).updatedAt ?? ''); } catch { return ''; } };

/** What {@link reconcileTrackerConnections} changed: rows copied into each table, and bodies brought up to the newer copy. */
export type ConnectionReconcile = { toIntegrationAccounts: number; toTrackerConnections: number; refreshed: number };

/**
 * Keeps `tracker_connections` and the `tracker` rows of `integration_accounts` equal, so an image from before the
 * Integration Accounts still sees every connection after a rollback, and what it added or changed there is back after a
 * roll-forward. A row only one table has is copied to the other with its id and body; a row both have takes the body
 * with the later `updatedAt`. Nothing is deleted, and each token stays sealed under the connection id.
 */
export function reconcileTrackerConnections(db: DatabaseSync): ConnectionReconcile {
  const result: ConnectionReconcile = { toIntegrationAccounts: 0, toTrackerConnections: 0, refreshed: 0 };
  transaction(db, () => {
    const old = new Map((db.prepare('SELECT id, tenant, provider, base_url, created_at, body FROM tracker_connections').all() as ConnectionRow[]).map(row => [row.id, row]));
    const current = new Map((db.prepare("SELECT id, tenant, provider, base_url, created_at, body FROM integration_accounts WHERE role='tracker'").all() as ConnectionRow[]).map(row => [row.id, row]));
    const intoAccounts = db.prepare("INSERT OR IGNORE INTO integration_accounts(id,tenant,role,provider,base_url,account_id,created_at,body) VALUES(?,?,'tracker',?,?,'',?,?)");
    const intoOld = db.prepare('INSERT OR IGNORE INTO tracker_connections(id,tenant,provider,base_url,created_at,body) VALUES(?,?,?,?,?,?)');
    for (const [id, row] of old) {
      const found = current.get(id);
      if (!found) { result.toIntegrationAccounts += Number(intoAccounts.run(id, row.tenant, row.provider, row.base_url, row.created_at, row.body).changes); continue; }
      if (found.body === row.body) continue;
      if (updatedAt(row.body) > updatedAt(found.body)) db.prepare("UPDATE integration_accounts SET body=? WHERE id=? AND role='tracker'").run(row.body, id);
      else db.prepare('UPDATE tracker_connections SET body=? WHERE id=?').run(found.body, id);
      result.refreshed++;
    }
    for (const [id, row] of current) if (!old.has(id)) result.toTrackerConnections += Number(intoOld.run(id, row.tenant, row.provider, row.base_url, row.created_at, row.body).changes);
  });
  return result;
}

/** Puts each saved source without a Client and without a Client Project into its Tenant's Own work, made when missing. */
function placeInOwnWork(db: DatabaseSync, at: string): void {
  const loose = db.prepare('SELECT id, tenant FROM tracker_connection_sources WHERE client IS NULL AND client_project_id IS NULL ORDER BY created_at, id').all() as { id: string; tenant: string }[];
  if (!loose.length) return;
  transaction(db, () => {
    const ownWork = (tenant: string): string => { const found = defaultProject(db, tenant); return found ? (JSON.parse(found.body) as ClientProject).id : insertOwnWork(db, tenant, migrationActor, at).id; };
    for (const source of loose) db.prepare('UPDATE tracker_connection_sources SET client_project_id=? WHERE id=?').run(ownWork(source.tenant), source.id);
  });
}

/**
 * Creates the tables of Integration Accounts, saved sources, repositories, Repository Grants and Client Projects next
 * to the ADR-0064 `tracker_connections` table, which stays so an older image can be rolled back to. Each start
 * reconciles the two connection tables and places saved sources in Own work. Nothing is dropped.
 */
export function ensureIntegrationSchema(db: DatabaseSync, at: string): ConnectionReconcile {
  db.exec(tables);
  const reconciled = reconcileTrackerConnections(db);
  reshapeSources(db);
  placeInOwnWork(db, at);
  return reconciled;
}

/** Writes a tracker connection to `tracker_connections` as well, the table an image from before the Integration Accounts reads. */
export function mirrorTrackerConnection(db: DatabaseSync, connection: { id: string; tenant: string; provider: string; baseUrl: string; createdAt: string }, body: string): void {
  db.prepare('INSERT INTO tracker_connections(id,tenant,provider,base_url,created_at,body) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(connection.id, connection.tenant, connection.provider, connection.baseUrl, connection.createdAt, body);
}

/** Removes a tracker connection from `tracker_connections` too. */
export function unmirrorTrackerConnection(db: DatabaseSync, id: string): void { db.prepare('DELETE FROM tracker_connections WHERE id=?').run(id); }

/**
 * Each Tenant's Client Projects. Own work, the one without a Client, is made the first time something needs it.
 * The screens show Client Projects only once the Tenant has a Client.
 */
export class ClientProjects {
  private readonly db: DatabaseSync;
  private readonly config: AppConfig;
  private readonly listeners: ((project: ClientProject, user: User) => void)[] = [];

  constructor(db: DatabaseSync, config: AppConfig) {
    this.db = db;
    this.config = config;
  }

  /** Calls `listener` after each Client Project Unfold creates for a person, so the change is audited. */
  onCreate(listener: (project: ClientProject, user: User) => void): void { this.listeners.push(listener); }

  /** The Client Projects of `tenant`, Own work first. */
  list(tenant: string): ClientProject[] {
    return (this.db.prepare('SELECT body FROM client_projects WHERE tenant=? ORDER BY is_default DESC, created_at, id').all(tenant) as { body: string }[]).map(row => JSON.parse(row.body));
  }

  /** One Client Project, or undefined. */
  project(id: string): ClientProject | undefined {
    const row = this.db.prepare('SELECT body FROM client_projects WHERE id=?').get(id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  /** The Tenant's Own work, created for `user` at `at` when it does not exist yet. */
  ownWork(tenant: string, user: User, at: string): ClientProject {
    const found = defaultProject(this.db, tenant);
    if (found) return JSON.parse(found.body);
    const project = insertOwnWork(this.db, tenant, user.name, at);
    for (const listener of this.listeners) listener(project, user);
    return project;
  }

  /** The Clients `tenant` has: those its configured repositories and task sources, its saved sources and its Client Projects name. */
  clients(tenant: string): string[] {
    const named = [...this.config.repositories, ...(this.config.taskSources ?? [])].filter(entry => (entry.tenant ?? defaultTenant) === tenant).map(entry => entry.client);
    const stored = (this.db.prepare('SELECT client FROM tracker_connection_sources WHERE tenant=? AND client IS NOT NULL UNION SELECT client FROM client_projects WHERE tenant=? AND client IS NOT NULL').all(tenant, tenant) as { client: string }[]).map(row => row.client);
    return [...new Set([...named, ...stored].filter((client): client is string => typeof client === 'string'))].sort();
  }

  /** Whether the screens show Client Projects for `tenant`: only once it has a Client. */
  visible(tenant: string): boolean { return this.clients(tenant).length > 0; }
}
