import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

/** Who turned an account off: the installation's SCIM token, one Tenant's SCIM token (`scim:<tenant>`), or a Shared Signals event. */
export type DisabledBy = 'scim' | `scim:${string}` | 'ssf';

/**
 * Whose SCIM records these are: null for the installation-wide token `identity.scim.tokenEnv` names, or the Tenant whose
 * own SCIM token pushed them.
 */
export type ScimScope = string | null;

/** A SCIM User as Unfold keeps it. `userId` is the Unfold account it names, or null until that person first signs in. */
export type ScimUserRecord = { id: string; tenant: ScimScope; userId: string | null; userName: string; externalId: string | null; displayName: string | null; emails: string[]; active: boolean; scimRole: string | null; createdAt: string; updatedAt: string; version: number };

/** A SCIM Group as Unfold keeps it, with the SCIM ids of its member Users. */
export type ScimGroupRecord = { id: string; tenant: ScimScope; displayName: string; externalId: string | null; members: string[]; createdAt: string; updatedAt: string; version: number };

/** Who issued a Tenant's SCIM token and when. The token itself is never kept, only its SHA-256 hash. */
export type ScimTokenRecord = { tenant: string; issuedAt: string; issuedBy: string };

/** Which attribute of a customer's SCIM Group a mapping matches: its display name (without regard to case) or its externalId. */
export type GroupMatch = 'displayName' | 'externalId';

/** One customer group a Tenant maps to an Access Role and Client memberships in that Tenant. */
export type GroupMapping = { match: GroupMatch; value: string; role: 'viewer' | 'developer' | 'admin' | null; clients: string[] };

const schema = `
  CREATE TABLE IF NOT EXISTS account_states (user_id TEXT PRIMARY KEY, disabled_at TEXT NOT NULL, disabled_by TEXT NOT NULL, reason TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scim_users (id TEXT PRIMARY KEY, user_id TEXT, user_name TEXT NOT NULL, external_id TEXT, display_name TEXT, emails TEXT NOT NULL, active INTEGER NOT NULL, scim_role TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL, tenant TEXT);
  CREATE INDEX IF NOT EXISTS scim_users_user ON scim_users(user_id);
  CREATE TABLE IF NOT EXISTS scim_groups (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, external_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL, tenant TEXT);
  CREATE TABLE IF NOT EXISTS scim_group_members (group_id TEXT NOT NULL REFERENCES scim_groups(id) ON DELETE CASCADE, member_id TEXT NOT NULL REFERENCES scim_users(id) ON DELETE CASCADE, PRIMARY KEY (group_id, member_id));
  CREATE INDEX IF NOT EXISTS scim_group_members_member ON scim_group_members(member_id);
  CREATE TABLE IF NOT EXISTS ssf_seen (issuer TEXT NOT NULL, jti TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY (issuer, jti));
  CREATE TABLE IF NOT EXISTS scim_tokens (tenant TEXT PRIMARY KEY, token_hash TEXT NOT NULL, issued_at TEXT NOT NULL, issued_by TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scim_group_mappings (tenant TEXT NOT NULL, match TEXT NOT NULL, value TEXT NOT NULL, role TEXT, clients TEXT NOT NULL, PRIMARY KEY (tenant, match, value));
  CREATE TABLE IF NOT EXISTS idp_user_ids (user_id TEXT PRIMARY KEY, idp_user_id TEXT NOT NULL, seen_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idp_user_ids_value ON idp_user_ids(idp_user_id);
`;

const scopedIndexes = `
  DROP INDEX IF EXISTS scim_users_user_name;
  DROP INDEX IF EXISTS scim_groups_display_name;
  CREATE UNIQUE INDEX IF NOT EXISTS scim_users_scope_user_name ON scim_users(ifnull(tenant, ''), user_name COLLATE NOCASE);
  CREATE UNIQUE INDEX IF NOT EXISTS scim_groups_scope_display_name ON scim_groups(ifnull(tenant, ''), display_name COLLATE NOCASE);
`;

/** The tables `IdentityAccounts` keeps, for the Tenant export's classification. */
export const identityTables = ['account_states', 'scim_users', 'scim_groups', 'scim_group_members', 'ssf_seen', 'scim_tokens', 'scim_group_mappings', 'idp_user_ids'] as const;

const scoped = " ifnull(tenant, '')=?";
const scopeValue = (scope: ScimScope) => scope ?? '';
const tenantOf = (value: unknown): ScimScope => value === null || value === undefined ? null : String(value);

const instances = new WeakMap<DatabaseSync, IdentityAccounts>();

/** The one `IdentityAccounts` of a database, creating its tables on first use. */
export function identityAccounts(db: DatabaseSync): IdentityAccounts {
  let accounts = instances.get(db);
  if (!accounts) { accounts = new IdentityAccounts(db); instances.set(db, accounts); }
  return accounts;
}

/** Whether the identity provider turned the account `userId` off through SCIM or Shared Signals. Every sign-in path asks this. */
export function accountDisabled(db: DatabaseSync, userId: string): boolean { return identityAccounts(db).disabled(userId) !== undefined; }

function userRow(row: Record<string, unknown>): ScimUserRecord {
  return { id: String(row.id), tenant: tenantOf(row.tenant), userId: row.user_id === null ? null : String(row.user_id), userName: String(row.user_name), externalId: row.external_id === null ? null : String(row.external_id), displayName: row.display_name === null ? null : String(row.display_name), emails: JSON.parse(String(row.emails)), active: Number(row.active) === 1, scimRole: row.scim_role === null ? null : String(row.scim_role), createdAt: String(row.created_at), updatedAt: String(row.updated_at), version: Number(row.version) };
}

/**
 * The provisioning state the identity provider pushes: which accounts it turned off, the SCIM Users and Groups it
 * provisioned in each scope, each Tenant's SCIM token hash and group mappings, and the Security Event Token ids already
 * processed. It lives in the workbench's own database.
 */
export class IdentityAccounts {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(schema);
    for (const table of ['scim_users', 'scim_groups']) {
      const columns = (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name);
      if (!columns.includes('tenant')) this.db.exec(`ALTER TABLE ${table} ADD COLUMN tenant TEXT`);
    }
    this.db.exec(scopedIndexes);
  }

  /** Why `userId` is turned off, or undefined while it is on. */
  disabled(userId: string): { at: string; by: DisabledBy; reason: string } | undefined {
    const row = this.db.prepare('SELECT disabled_at, disabled_by, reason FROM account_states WHERE user_id=?').get(userId) as Record<string, string> | undefined;
    return row ? { at: row.disabled_at, by: row.disabled_by as DisabledBy, reason: row.reason } : undefined;
  }

  disable(userId: string, by: DisabledBy, reason: string): void {
    this.db.prepare('INSERT INTO account_states(user_id,disabled_at,disabled_by,reason) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET disabled_at=excluded.disabled_at, disabled_by=excluded.disabled_by, reason=excluded.reason').run(userId, new Date().toISOString(), by, reason.slice(0, 200));
  }

  /** Turns `userId` back on. With `onlyBy`, only an account that source turned off. Returns whether it was off. */
  enable(userId: string, onlyBy?: DisabledBy): boolean {
    const result = onlyBy ? this.db.prepare('DELETE FROM account_states WHERE user_id=? AND disabled_by=?').run(userId, onlyBy) : this.db.prepare('DELETE FROM account_states WHERE user_id=?').run(userId);
    return Number(result.changes) > 0;
  }

  /** The SCIM User `id` when `scope` holds it. */
  user(scope: ScimScope, id: string): ScimUserRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM scim_users WHERE id=? AND${scoped}`).get(id, scopeValue(scope)) as Record<string, unknown> | undefined;
    return row ? userRow(row) : undefined;
  }

  /** The SCIM Users that name the Unfold account `userId`, in every scope. */
  usersOf(userId: string): ScimUserRecord[] {
    return (this.db.prepare('SELECT * FROM scim_users WHERE user_id=? ORDER BY created_at, id').all(userId) as Record<string, unknown>[]).map(userRow);
  }

  /**
   * SCIM Users of `scope` whose `field` equals `value` (`userName` without regard to case), oldest first, from
   * `offset`, at most `limit`, and how many there are. `scope` undefined searches every scope, for sign-in and Shared
   * Signals, which the installation trusts across Tenants.
   */
  users(scope: ScimScope | undefined, filter: { field: 'id' | 'userName' | 'externalId' | 'email'; value: string } | undefined, offset: number, limit: number): { total: number; items: ScimUserRecord[] } {
    const clauses = [
      ...(scope === undefined ? [] : [scoped]),
      ...(!filter ? [] : [filter.field === 'id' ? ' id=?' : filter.field === 'userName' ? ' user_name=? COLLATE NOCASE' : filter.field === 'externalId' ? ' external_id=?' : ' EXISTS (SELECT 1 FROM json_each(scim_users.emails) WHERE lower(json_each.value)=lower(?))']),
    ];
    const where = clauses.length ? ` WHERE${clauses.join(' AND')}` : '';
    const values = [...(scope === undefined ? [] : [scopeValue(scope)]), ...(filter ? [filter.value] : [])];
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS total FROM scim_users${where}`).get(...values) as { total: number }).total);
    const items = (this.db.prepare(`SELECT * FROM scim_users${where} ORDER BY created_at, id LIMIT ? OFFSET ?`).all(...values, limit, offset) as Record<string, unknown>[]).map(userRow);
    return { total, items };
  }

  /** Stores a SCIM User, new or changed, and returns it as stored. A changed one gets the next version and keeps its scope. */
  saveUser(user: Omit<ScimUserRecord, 'id' | 'createdAt' | 'updatedAt' | 'version'> & { id?: string }): ScimUserRecord {
    const now = new Date().toISOString();
    const id = user.id ?? randomUUID();
    this.db.prepare('INSERT INTO scim_users(id,tenant,user_id,user_name,external_id,display_name,emails,active,scim_role,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, user_name=excluded.user_name, external_id=excluded.external_id, display_name=excluded.display_name, emails=excluded.emails, active=excluded.active, scim_role=excluded.scim_role, updated_at=excluded.updated_at, version=scim_users.version+1')
      .run(id, user.tenant, user.userId, user.userName, user.externalId, user.displayName, JSON.stringify(user.emails), user.active ? 1 : 0, user.scimRole, now, now);
    return this.user(user.tenant, id)!;
  }

  deleteUser(id: string): void { this.db.prepare('DELETE FROM scim_users WHERE id=?').run(id); }

  /** The display names of the SCIM Groups the SCIM User `memberId` belongs to. */
  groupNamesOf(memberId: string): string[] {
    return this.groupsOf(memberId).map(group => group.displayName);
  }

  /** The display names and externalIds of the SCIM Groups the SCIM User `memberId` belongs to. */
  groupsOf(memberId: string): { displayName: string; externalId: string | null }[] {
    return (this.db.prepare('SELECT g.display_name, g.external_id FROM scim_groups g JOIN scim_group_members m ON m.group_id=g.id WHERE m.member_id=? ORDER BY g.display_name').all(memberId) as { display_name: string; external_id: string | null }[]).map(row => ({ displayName: row.display_name, externalId: row.external_id }));
  }

  /** The SCIM Group `id` when `scope` holds it. */
  group(scope: ScimScope, id: string): ScimGroupRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM scim_groups WHERE id=? AND${scoped}`).get(id, scopeValue(scope)) as Record<string, unknown> | undefined;
    return row ? this.groupOf(row) : undefined;
  }

  groups(scope: ScimScope, filter: { field: 'id' | 'displayName' | 'externalId'; value: string } | undefined, offset: number, limit: number): { total: number; items: ScimGroupRecord[] } {
    const where = ` WHERE${scoped}${!filter ? '' : filter.field === 'id' ? ' AND id=?' : filter.field === 'displayName' ? ' AND display_name=? COLLATE NOCASE' : ' AND external_id=?'}`;
    const values = [scopeValue(scope), ...(filter ? [filter.value] : [])];
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS total FROM scim_groups${where}`).get(...values) as { total: number }).total);
    const items = (this.db.prepare(`SELECT * FROM scim_groups${where} ORDER BY created_at, id LIMIT ? OFFSET ?`).all(...values, limit, offset) as Record<string, unknown>[]).map(row => this.groupOf(row));
    return { total, items };
  }

  /** Stores a SCIM Group with exactly `members`, which must be SCIM User ids of its own scope, and returns it as stored. */
  saveGroup(group: { id?: string; tenant: ScimScope; displayName: string; externalId: string | null; members: string[] }): ScimGroupRecord {
    const now = new Date().toISOString();
    const id = group.id ?? randomUUID();
    this.db.prepare('INSERT INTO scim_groups(id,tenant,display_name,external_id,created_at,updated_at,version) VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, external_id=excluded.external_id, updated_at=excluded.updated_at, version=scim_groups.version+1').run(id, group.tenant, group.displayName, group.externalId, now, now);
    this.db.prepare('DELETE FROM scim_group_members WHERE group_id=?').run(id);
    const insert = this.db.prepare(`INSERT OR IGNORE INTO scim_group_members(group_id,member_id) SELECT ?, id FROM scim_users WHERE id=? AND${scoped}`);
    for (const member of group.members) insert.run(id, member, scopeValue(group.tenant));
    return this.group(group.tenant, id)!;
  }

  deleteGroup(id: string): void { this.db.prepare('DELETE FROM scim_groups WHERE id=?').run(id); }

  /** Records that the SET `jti` from `issuer` was processed; false when it already was. Forgets ids older than `forgetBefore`. */
  firstDelivery(issuer: string, jti: string, forgetBefore: string): boolean {
    this.db.prepare('DELETE FROM ssf_seen WHERE seen_at<?').run(forgetBefore);
    return Number(this.db.prepare('INSERT OR IGNORE INTO ssf_seen(issuer,jti,seen_at) VALUES(?,?,?)').run(issuer, jti, new Date().toISOString()).changes) === 1;
  }

  /** The SHA-256 hashes of every Tenant's SCIM token, to compare a presented token against. */
  tokenHashes(): { tenant: string; hash: Buffer }[] {
    return (this.db.prepare('SELECT tenant, token_hash FROM scim_tokens ORDER BY tenant').all() as { tenant: string; token_hash: string }[]).map(row => ({ tenant: row.tenant, hash: Buffer.from(row.token_hash, 'hex') }));
  }

  /** Who issued `tenant`'s SCIM token and when, or undefined while it has none. */
  token(tenant: string): ScimTokenRecord | undefined {
    const row = this.db.prepare('SELECT tenant, issued_at, issued_by FROM scim_tokens WHERE tenant=?').get(tenant) as Record<string, string> | undefined;
    return row ? { tenant: row.tenant, issuedAt: row.issued_at, issuedBy: row.issued_by } : undefined;
  }

  /** Replaces `tenant`'s SCIM token with the one whose SHA-256 hash is `hash`; the previous token stops working at once. */
  setToken(tenant: string, hash: string, issuedBy: string): ScimTokenRecord {
    this.db.prepare('INSERT INTO scim_tokens(tenant,token_hash,issued_at,issued_by) VALUES(?,?,?,?) ON CONFLICT(tenant) DO UPDATE SET token_hash=excluded.token_hash, issued_at=excluded.issued_at, issued_by=excluded.issued_by').run(tenant, hash, new Date().toISOString(), issuedBy);
    return this.token(tenant)!;
  }

  /** Removes `tenant`'s SCIM token. Returns whether it had one. */
  deleteToken(tenant: string): boolean { return Number(this.db.prepare('DELETE FROM scim_tokens WHERE tenant=?').run(tenant).changes) > 0; }

  /** The group mappings of `tenant`, by match and value. */
  mappings(tenant: string): GroupMapping[] {
    return (this.db.prepare('SELECT match, value, role, clients FROM scim_group_mappings WHERE tenant=? ORDER BY match, value').all(tenant) as Record<string, string | null>[]).map(row => ({ match: row.match as GroupMatch, value: String(row.value), role: (row.role ?? null) as GroupMapping['role'], clients: JSON.parse(String(row.clients)) }));
  }

  /** Replaces every group mapping of `tenant` at once. */
  setMappings(tenant: string, mappings: readonly GroupMapping[]): void {
    this.db.exec('SAVEPOINT scim_mappings');
    try {
      this.db.prepare('DELETE FROM scim_group_mappings WHERE tenant=?').run(tenant);
      const insert = this.db.prepare('INSERT INTO scim_group_mappings(tenant,match,value,role,clients) VALUES(?,?,?,?,?)');
      for (const mapping of mappings) insert.run(tenant, mapping.match, mapping.value, mapping.role, JSON.stringify(mapping.clients));
      this.db.exec('RELEASE scim_mappings');
    } catch (error) {
      this.db.exec('ROLLBACK TO scim_mappings; RELEASE scim_mappings');
      throw error;
    }
  }

  /** Remembers the customer identity provider's user id the last sign-in of `userId` carried. */
  rememberIdpUserId(userId: string, idpUserId: string): void {
    this.db.prepare('INSERT INTO idp_user_ids(user_id,idp_user_id,seen_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET idp_user_id=excluded.idp_user_id, seen_at=excluded.seen_at').run(userId, idpUserId, new Date().toISOString());
  }

  /** The Unfold account whose last sign-in carried the customer identity provider's user id `idpUserId`, when exactly one did. */
  userByIdpUserId(idpUserId: string): string | undefined {
    const rows = this.db.prepare('SELECT user_id FROM idp_user_ids WHERE idp_user_id=? LIMIT 2').all(idpUserId) as { user_id: string }[];
    return rows.length === 1 ? rows[0].user_id : undefined;
  }

  private groupOf(row: Record<string, unknown>): ScimGroupRecord {
    const members = (this.db.prepare('SELECT member_id FROM scim_group_members WHERE group_id=? ORDER BY member_id').all(String(row.id)) as { member_id: string }[]).map(item => item.member_id);
    return { id: String(row.id), tenant: tenantOf(row.tenant), displayName: String(row.display_name), externalId: row.external_id === null ? null : String(row.external_id), members, createdAt: String(row.created_at), updatedAt: String(row.updated_at), version: Number(row.version) };
  }
}
