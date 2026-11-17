import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig, Repository, User } from './types.ts';
import { TaskError } from './task-providers/shared.ts';
import { defaultTenant, repositoryKey, validTenancyId } from './tenancy.ts';
import type { ClientProject, ClientProjects } from './integration-store.ts';

/** A repository an Admin added from the screen (system ADR-0048): owned by the Tenant, keyed by forge host and `owner/name`. */
export type StoredRepository = { id: string; key: string; url: string; name: string; description: string; baseBranch: string; tenant: string; integrationAccount?: string; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string };
/** Whether a stored repository is in use, hidden by a configured one with the same key or id, or unused while the `repositories.stored` flag is off. */
export type RepositoryState = 'active' | 'shadowed' | 'off';
/** A Client Project's permission to route work to a repository. */
export type RepositoryGrant = { clientProject: string; name: string; grantedAt: string; grantedBy: string };
/** A stored repository as people see it. */
export type PublicRepository = StoredRepository & { state: RepositoryState; manage: boolean; grants: RepositoryGrant[] };
/** A Repository Grant added or removed, for the audit trail. */
export type GrantChange = { action: 'create' | 'delete'; repository: StoredRepository; project: ClientProject; user: User };

type Access = { enforced: boolean; manages(user: User, tenant: string): boolean; sees(user: User, tenant: string): boolean; now(): string; log(event: string, fields: Record<string, unknown>): void };

const repositoryId = /^[a-z0-9][a-z0-9-]{0,63}$/;
const branch = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]{1,255}$/;
const maxRepositories = 500;

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new TaskError(400, 'repository_invalid', `${label} must be text of 1 to ${max} characters.`);
  return value.trim();
}

function forgeUrl(value: unknown): { url: string; key: string } {
  const url = text(value, 'Repository URL', 2048);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new TaskError(400, 'repository_invalid', 'Repository URL must be an HTTPS address such as https://github.com/acme/shop.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new TaskError(400, 'repository_invalid', 'Repository URL must be an HTTPS address without a user name, password, query or fragment.');
  const key = repositoryKey(url);
  if (key.split('/').length < 3) throw new TaskError(400, 'repository_invalid', 'Repository URL must name the owner and the repository, such as https://github.com/acme/shop.');
  return { url: url.replace(/\/+$/, ''), key };
}

function slug(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'repository';
  if (!taken.has(base)) return base;
  for (let index = 2; ; index++) if (!taken.has(`${base}-${index}`)) return `${base}-${index}`;
}

/**
 * Repositories Admins add from the screen and their Repository Grants. Each one is granted to its Tenant's Own work
 * when added. {@link StoredRepositories.sync} puts them into `config.repositories` after the configured ones; a
 * configured repository with the same key or id wins, and the stored one is `shadowed`, kept and never deleted.
 */
export class StoredRepositories {
  private readonly db: DatabaseSync;
  private readonly config: AppConfig;
  private readonly projects: ClientProjects;
  private readonly access: Access;
  private readonly listeners: ((change: GrantChange) => void)[] = [];
  private joined = false;

  constructor(db: DatabaseSync, config: AppConfig, projects: ClientProjects, access: Access) {
    this.db = db;
    this.config = config;
    this.projects = projects;
    this.access = access;
  }

  /** Calls `listener` after each Repository Grant added or removed, so the change is audited. */
  onGrant(listener: (change: GrantChange) => void): void { this.listeners.push(listener); }

  /** Every stored repository, oldest first. */
  repositories(): StoredRepository[] { return (this.db.prepare('SELECT body FROM repositories ORDER BY created_at, id').all() as { body: string }[]).map(row => JSON.parse(row.body)); }
  /** One stored repository, or undefined. */
  repository(id: string): StoredRepository | undefined {
    const row = repositoryId.test(id) ? this.db.prepare('SELECT body FROM repositories WHERE id=?').get(id) as { body: string } | undefined : undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  /** The Repository Grants of a stored repository, oldest first. */
  grants(id: string): RepositoryGrant[] {
    return (this.db.prepare('SELECT g.client_project_id, g.granted_at, g.granted_by, p.body FROM repository_grants g JOIN client_projects p ON p.id = g.client_project_id WHERE g.repository_id=? ORDER BY g.granted_at, g.client_project_id').all(id) as { client_project_id: string; granted_at: string; granted_by: string; body: string }[])
      .map(row => ({ clientProject: row.client_project_id, name: (JSON.parse(row.body) as ClientProject).name, grantedAt: row.granted_at, grantedBy: row.granted_by }));
  }

  private configured(): Repository[] { return this.config.repositories.filter(entry => !entry.stored); }

  /** Whether `repository` is in use: `shadowed` when a configured repository has its key or its id. */
  state(repository: StoredRepository): RepositoryState {
    if (!this.joined) return 'off';
    return this.configured().some(entry => entry.id === repository.id || repositoryKey(entry.url) === repository.key) ? 'shadowed' : 'active';
  }

  /** Whether stored repositories join `config.repositories`: only while the `repositories.stored` flag is on. Answers whether that changed. */
  join(on: boolean): boolean {
    if (this.joined === on) return false;
    this.joined = on;
    return true;
  }

  /** Puts the stored repositories into `config.repositories` after the configured ones, replacing what an earlier sync put there. While they may not join, it only takes them out. */
  sync(): void {
    const list = this.config.repositories;
    for (let index = list.length - 1; index >= 0; index--) if (list[index].stored) list.splice(index, 1);
    if (!this.joined) return;
    for (const repository of this.repositories()) {
      if (this.state(repository) !== 'active') { this.access.log('repositories.shadowed', { repository: repository.id, key: repository.key }); continue; }
      list.push({ id: repository.id, name: repository.name, description: repository.description, url: repository.url, baseBranch: repository.baseBranch, verify: [], tenant: repository.tenant, stored: true });
    }
  }

  private publicRepository(user: User, repository: StoredRepository): PublicRepository {
    return { ...repository, state: this.state(repository), manage: this.access.manages(user, repository.tenant), grants: this.grants(repository.id) };
  }

  /** The stored repositories of the Tenants `user` reaches. */
  list(user: User): PublicRepository[] { return this.repositories().filter(repository => this.access.sees(user, repository.tenant)).map(repository => this.publicRepository(user, repository)); }

  private owned(user: User, id: string): StoredRepository {
    const repository = this.repository(id);
    if (!repository || !this.access.sees(user, repository.tenant)) {
      if (!repository && this.configured().some(entry => entry.id === id)) throw new TaskError(409, 'repository_read_only', 'This repository is in the server configuration, so it is changed there and not here.');
      throw new TaskError(404, 'repository_not_found', 'There is no such repository. Reload the page to see the ones there are.');
    }
    if (!this.access.manages(user, repository.tenant)) throw new TaskError(403, 'forbidden', `Only an administrator${this.access.enforced ? ` of Tenant ${repository.tenant}` : ''} changes repositories.`);
    return repository;
  }

  private forgeAccount(value: unknown, tenant: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const row = typeof value === 'string' ? this.db.prepare('SELECT tenant, role FROM integration_accounts WHERE id=?').get(value) as { tenant: string; role: string } | undefined : undefined;
    if (!row || row.tenant !== tenant || row.role !== 'forge') throw new TaskError(400, 'repository_invalid', 'integrationAccount must be a forge account of the same Tenant.');
    return value as string;
  }

  private baseBranch(value: unknown, previous?: string): string {
    if (value === undefined && previous) return previous;
    const name = value === undefined ? 'main' : text(value, 'Base branch', 255);
    if (!branch.test(name)) throw new TaskError(400, 'repository_invalid', 'Base branch must be a branch name such as main.');
    return name;
  }

  /** Stores a repository for `tenant` and grants it to the Tenant's Own work, which is created when it does not exist yet. */
  create(user: User, input: Record<string, unknown>): PublicRepository {
    const tenant = input.tenant === undefined || input.tenant === null || input.tenant === '' ? defaultTenant : input.tenant;
    if (!validTenancyId(tenant)) throw new TaskError(400, 'repository_invalid', 'Tenant must be a Tenant id: lower-case letters, digits and inner hyphens.');
    if (!this.access.manages(user, tenant)) throw new TaskError(403, 'forbidden', `Only an administrator${this.access.enforced ? ` of Tenant ${tenant}` : ''} adds repositories.`);
    const { url, key } = forgeUrl(input.url);
    const stored = this.repositories();
    if (stored.length >= maxRepositories) throw new TaskError(409, 'repository_invalid', `Unfold keeps at most ${maxRepositories} repositories added from the screen. Remove one first.`);
    if (stored.some(entry => entry.key === key) || this.configured().some(entry => repositoryKey(entry.url) === key)) throw new TaskError(409, 'repository_exists', `Unfold already has ${key}.`);
    const name = input.name === undefined ? key.split('/').slice(1).join('/') : text(input.name, 'Name', 100);
    const description = input.description === undefined || input.description === '' ? '' : text(input.description, 'Description', 500);
    const baseBranch = this.baseBranch(input.baseBranch);
    const integrationAccount = this.forgeAccount(input.integrationAccount, tenant);
    const id = slug(key.split('/').at(-1)!, new Set([...this.config.repositories.map(entry => entry.id), ...stored.map(entry => entry.id)]));
    const at = this.access.now();
    const repository: StoredRepository = { id, key, url, name, description, baseBranch, tenant, ...(integrationAccount ? { integrationAccount } : {}), createdAt: at, createdBy: user.name, updatedAt: at, updatedBy: user.name };
    let project: ClientProject;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      project = this.projects.ownWork(tenant, user, at);
      this.db.prepare('INSERT INTO repositories(id,tenant,key,integration_account_id,created_at,body) VALUES(?,?,?,?,?,?)').run(id, tenant, key, integrationAccount ?? null, at, JSON.stringify(repository));
      this.db.prepare('INSERT INTO repository_grants(client_project_id,repository_id,granted_at,granted_by) VALUES(?,?,?,?)').run(project.id, id, at, user.name);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    for (const listener of this.listeners) listener({ action: 'create', repository, project, user });
    return this.publicRepository(user, repository);
  }

  /** Changes a stored repository's name, description or base branch. Its URL and key stay. */
  update(user: User, id: string, input: Record<string, unknown>): PublicRepository {
    const previous = this.owned(user, id);
    const repository: StoredRepository = {
      ...previous,
      name: input.name === undefined ? previous.name : text(input.name, 'Name', 100),
      description: input.description === undefined ? previous.description : input.description === '' ? '' : text(input.description, 'Description', 500),
      baseBranch: this.baseBranch(input.baseBranch, previous.baseBranch),
      updatedAt: this.access.now(), updatedBy: user.name,
    };
    this.db.prepare('UPDATE repositories SET body=? WHERE id=?').run(JSON.stringify(repository), id);
    return this.publicRepository(user, repository);
  }

  /** Removes a stored repository and its Repository Grants. Refused while `usedBy` names something that still uses it. */
  remove(user: User, id: string, usedBy: (id: string) => string[]): void {
    const repository = this.owned(user, id);
    const using = usedBy(id);
    if (using.length) throw new TaskError(409, 'repository_in_use', `Remove ${using.join(', ')} first; ${using.length === 1 ? 'it uses' : 'they use'} this repository.`);
    const grants = this.grants(id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM repository_grants WHERE repository_id=?').run(id);
      this.db.prepare('DELETE FROM repositories WHERE id=?').run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    for (const grant of grants) {
      const project = this.projects.project(grant.clientProject);
      if (project) for (const listener of this.listeners) listener({ action: 'delete', repository, project, user });
    }
  }
}
