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
  CREATE TABLE IF NOT EXISTS tracker_connection_sources (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES integration_accounts(id), tenant TEXT NOT NULL, client TEXT, client_project_id TEXT REFERENCES client_projects(id), created_at TEXT NOT NULL, body TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS tracker_connection_sources_connection ON tracker_connection_sources(connection_id);
  CREATE TABLE IF NOT EXISTS repositories (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, key TEXT NOT NULL UNIQUE, integration_account_id TEXT REFERENCES integration_accounts(id), created_at TEXT NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS repository_grants (client_project_id TEXT NOT NULL REFERENCES client_projects(id), repository_id TEXT NOT NULL REFERENCES repositories(id), granted_at TEXT NOT NULL, granted_by TEXT NOT NULL, PRIMARY KEY (client_project_id, repository_id));
  CREATE INDEX IF NOT EXISTS repository_grants_repository ON repository_grants(repository_id);
`;

const exists = (db: DatabaseSync, table: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));

function insertOwnWork(db: DatabaseSync, tenant: string, by: string, at: string): ClientProject {
  const project: ClientProject = { id: `cp-${randomBytes(6).toString('hex')}`, tenant, slug: ownWorkSlug, name: ownWorkName, isDefault: true, createdAt: at, createdBy: by };
  db.prepare('INSERT INTO client_projects(id,tenant,client,slug,is_default,created_at,body) VALUES(?,?,NULL,?,1,?,?)').run(project.id, tenant, project.slug, at, JSON.stringify(project));
  return project;
}

const defaultProject = (db: DatabaseSync, tenant: string) => db.prepare('SELECT body FROM client_projects WHERE tenant=? AND is_default=1').get(tenant) as { body: string } | undefined;

/**
 * Moves the store of ADR-0064 to the Integration Account model of system ADR-0048: `tracker_connections` becomes
 * `integration_accounts` with `role` `tracker`, and each saved source without a Client joins its Tenant's Own work.
 * Ids and bodies are copied unchanged, so each token stays sealed in `internal_state` under the same id.
 */
function migrateTrackerConnections(db: DatabaseSync, at: string): void {
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('ALTER TABLE tracker_connection_sources RENAME TO tracker_connection_sources_before');
    db.exec('DROP INDEX IF EXISTS tracker_connection_sources_connection');
    db.exec(tables);
    db.exec("INSERT INTO integration_accounts(id,tenant,role,provider,base_url,account_id,created_at,body) SELECT id, tenant, 'tracker', provider, base_url, '', created_at, body FROM tracker_connections");
    const sources = db.prepare('SELECT id, connection_id, tenant, client, created_at, body FROM tracker_connection_sources_before ORDER BY created_at, id').all() as { id: string; connection_id: string; tenant: string; client: string | null; created_at: string; body: string }[];
    const insert = db.prepare('INSERT INTO tracker_connection_sources(id,connection_id,tenant,client,client_project_id,created_at,body) VALUES(?,?,?,?,?,?,?)');
    const ownWork = (tenant: string): string => { const found = defaultProject(db, tenant); return found ? (JSON.parse(found.body) as ClientProject).id : insertOwnWork(db, tenant, migrationActor, at).id; };
    for (const source of sources) insert.run(source.id, source.connection_id, source.tenant, source.client, source.client === null ? ownWork(source.tenant) : null, source.created_at, source.body);
    db.exec('DROP TABLE tracker_connection_sources_before');
    db.exec('DROP TABLE tracker_connections');
    const broken = db.prepare('PRAGMA foreign_key_check(tracker_connection_sources)').all();
    if (broken.length) throw new Error(`The tracker connection migration left ${broken.length} rows without the row they refer to`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; } finally { db.exec('PRAGMA foreign_keys=ON'); }
}

/** Creates the tables of Integration Accounts, saved sources, repositories, Repository Grants and Client Projects, migrating an older store first. */
export function ensureIntegrationSchema(db: DatabaseSync, at: string): void {
  if (exists(db, 'tracker_connections') && !exists(db, 'integration_accounts')) migrateTrackerConnections(db, at);
  else db.exec(tables);
}

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
