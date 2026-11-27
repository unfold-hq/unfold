import { randomBytes } from 'node:crypto';
import type { Store } from '../store.ts';
import type { User } from '../types.ts';
import { accessRoles, defaultTenant, validTenancyId, type AccessRole } from '../tenancy.ts';
import type { GroupMapping, IdentityAccounts, ScimTokenRecord } from './accounts.ts';
import { reconciledMemberships, scimTokenHash } from './scim.ts';

/** The prefix of a Tenant's SCIM token, so a leaked one is recognisable. */
export const scimTokenPrefix = 'unfold_scim_';

const maxMappings = 200;
const maxClientsPerMapping = 50;
const maxGroupValue = 256;

const routes = {
  overview: /^\/api\/admin\/scim$/,
  token: /^\/api\/admin\/scim\/tenants\/([a-z0-9-]{1,63})\/token$/,
  mappings: /^\/api\/admin\/scim\/tenants\/([a-z0-9-]{1,63})\/group-mappings$/,
};

/** A failed SCIM administration request, with the HTTP status and code the API answers. */
export class ScimAdminError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

const fail = (status: number, code: string, message: string): never => { throw new ScimAdminError(status, code, message); };

/** What SCIM administration needs from the application. */
export type ScimAdminOptions = {
  accounts: IdentityAccounts;
  store: Store;
  /** Whether `identity.scim` is configured, so tokens can reach `/scim/v2` at all. */
  configured: boolean;
  /** Whether the installation-wide token `identity.scim.tokenEnv` names is set. */
  installationToken: boolean;
  /** The sign-in claim that carries the customer identity provider's user id, when configured. */
  userIdClaim?: string;
  /** Whether Tenant checks are enforced (`tenancy.enforce`). While they are not, the default Tenant is the only one. */
  enforced: boolean;
  /** Whether the `identity.scim` flag is on for a Tenant. */
  enabled(tenant: string): Promise<boolean>;
  /** The absolute URL the SCIM base is served at. */
  location: string;
};

/** Whether `path` is one of the SCIM administration routes. */
export function isScimAdminRoute(path: string): boolean {
  return path === '/api/admin/scim' || path.startsWith('/api/admin/scim/');
}

/**
 * SCIM per Tenant, as a Tenant administrator manages it: the Tenant's own SCIM bearer token, issued and rotated here
 * and shown once, and the mapping of the customer's group names to Access Roles and Client memberships in the Tenant.
 * Every route needs a browser sign-in of an administrator who, while Tenant checks are enforced, is an Admin of the
 * Tenant.
 */
export class ScimAdministration {
  private readonly options: ScimAdminOptions;
  constructor(options: ScimAdminOptions) { this.options = options; }

  private tenantsOf(user: User): string[] {
    if (!this.options.enforced) return [defaultTenant];
    return [...new Set((user.memberships ?? []).flatMap(held => held.kind === 'tenant' && held.role === 'admin' ? [held.tenant] : []))].sort();
  }

  private administered(user: User, tenant: string): string {
    if (!validTenancyId(tenant)) fail(400, 'tenant', 'A Tenant id is lower-case letters, digits and inner hyphens.');
    if (!this.options.enforced && tenant !== defaultTenant) fail(404, 'tenant_not_found', `Tenant checks are off, so this installation is the one Tenant ${defaultTenant}.`);
    if (!this.tenantsOf(user).includes(tenant)) fail(404, 'tenant_not_found', 'You are not an Admin of this Tenant.');
    return tenant;
  }

  private view(tenant: string, enabled: boolean) {
    const token = this.options.accounts.token(tenant);
    return { tenant, enabled, token: token ? { issuedAt: token.issuedAt, issuedBy: token.issuedBy } : null, mappings: this.options.accounts.mappings(tenant) };
  }

  /** The answer to `GET /api/admin/scim`: every Tenant the caller administers, with its token state and mappings. */
  async overview(user: User): Promise<Record<string, unknown>> {
    const tenants = await Promise.all(this.tenantsOf(user).map(async tenant => this.view(tenant, await this.options.enabled(tenant).catch(() => false))));
    return { configured: this.options.configured, scimUrl: this.options.location, installationToken: this.options.installationToken, userIdClaim: this.options.userIdClaim ?? null, tenants };
  }

  /**
   * Issues `tenant` a new SCIM token and answers it this once. The previous token, if any, stops working at once:
   * paste the new one into the identity provider before its next push.
   */
  issue(user: User, tenant: string): { tenant: string; token: string; issued: ScimTokenRecord; replaced: boolean } {
    this.administered(user, tenant);
    if (!this.options.configured) fail(409, 'scim_unconfigured', 'SCIM is not configured on this workbench. The operator adds an identity.scim block to the configuration.');
    const token = `${scimTokenPrefix}${randomBytes(32).toString('base64url')}`;
    const replaced = this.options.accounts.token(tenant) !== undefined;
    const issued = this.options.accounts.setToken(tenant, scimTokenHash(token), user.id);
    console.log(JSON.stringify({ level: 'info', event: replaced ? 'scim.token_rotated' : 'scim.token_issued', actor: user.id, tenant }));
    return { tenant, token, issued, replaced };
  }

  /** Withdraws `tenant`'s SCIM token, so its identity provider can no longer push. */
  withdraw(user: User, tenant: string): { tenant: string; deleted: boolean } {
    this.administered(user, tenant);
    const deleted = this.options.accounts.deleteToken(tenant);
    if (!deleted) fail(404, 'scim_token_not_found', 'This Tenant has no SCIM token.');
    console.log(JSON.stringify({ level: 'info', event: 'scim.token_withdrawn', actor: user.id, tenant }));
    return { tenant, deleted };
  }

  /** Replaces `tenant`'s group mappings and applies them at once to every person the Tenant's SCIM Users name. */
  map(user: User, tenant: string, raw: unknown): { tenant: string; mappings: GroupMapping[]; applied: number } {
    this.administered(user, tenant);
    const mappings = parseMappings(raw);
    this.options.accounts.setMappings(tenant, mappings);
    const people = new Set(this.options.accounts.users(tenant, undefined, 0, 100_000).items.flatMap(record => record.userId ? [record.userId] : []));
    for (const userId of people) {
      const stored = this.options.store.getUser(userId);
      if (stored) this.options.store.setMemberships(userId, reconciledMemberships(this.options.accounts, userId, stored.memberships ?? [], tenant));
    }
    console.log(JSON.stringify({ level: 'info', event: 'scim.mappings_set', actor: user.id, tenant, mappings: mappings.length, applied: people.size }));
    return { tenant, mappings: this.options.accounts.mappings(tenant), applied: people.size };
  }
}

/** Reads `{mappings: [{match, value, role, clients}]}`: distinct groups, each granting a role, Clients or both. */
export function parseMappings(raw: unknown): GroupMapping[] {
  const list = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { mappings?: unknown }).mappings : undefined;
  if (!Array.isArray(list) || list.length > maxMappings) return fail(400, 'scim_mappings', `Send mappings as a list of at most ${maxMappings}.`);
  const seen = new Set<string>();
  return list.map((entry, index): GroupMapping => {
    const label = `mappings[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(400, 'scim_mappings', `${label} must be an object.`);
    const item = entry as Record<string, unknown>;
    for (const key of Object.keys(item)) if (!['match', 'value', 'role', 'clients'].includes(key)) fail(400, 'scim_mappings', `${label}.${key} is not a mapping field.`);
    const match = item.match ?? 'displayName';
    if (match !== 'displayName' && match !== 'externalId') fail(400, 'scim_mappings', `${label}.match is displayName or externalId.`);
    if (typeof item.value !== 'string' || !item.value.trim() || item.value.length > maxGroupValue || /[\u0000-\u001f\u007f]/.test(item.value)) fail(400, 'scim_mappings', `${label}.value is the group's ${match}, at most ${maxGroupValue} characters.`);
    const role = item.role ?? null;
    if (role !== null && !accessRoles.includes(role as AccessRole)) fail(400, 'scim_mappings', `${label}.role is viewer, developer or admin.`);
    const clients = item.clients ?? [];
    if (!Array.isArray(clients) || clients.length > maxClientsPerMapping || !clients.every(validTenancyId)) fail(400, 'scim_mappings', `${label}.clients lists at most ${maxClientsPerMapping} Client ids.`);
    if (role === null && !(clients as string[]).length) fail(400, 'scim_mappings', `${label} grants nothing: give it a role, Clients or both.`);
    const value = (item.value as string).trim();
    const key = `${match}:${match === 'displayName' ? value.toLowerCase() : value}`;
    if (seen.has(key)) fail(400, 'scim_mappings', `${label} maps a group another mapping already maps.`);
    seen.add(key);
    return { match: match as GroupMapping['match'], value, role: role as GroupMapping['role'], clients: [...new Set(clients as string[])].sort() };
  });
}

/** What a SCIM administration route needs from the request. */
export type ScimAdminRequest = { method: string; path: string; user: User; scope: string | undefined; body: () => Promise<Record<string, unknown>> };

/**
 * Serves the SCIM administration routes under `/api/admin/scim`. Answers the status and JSON body, or throws a
 * {@link ScimAdminError}. Every route takes a browser sign-in of an administrator: an editor or MCP credential cannot
 * issue a token.
 */
export async function scimAdminRoute(service: ScimAdministration, request: ScimAdminRequest): Promise<{ status: number; body: unknown }> {
  const { method, path, user } = request;
  if (user.role !== 'admin') fail(403, 'forbidden', 'Only administrators manage SCIM provisioning.');
  if (request.scope !== 'browser') fail(403, 'browser_only', 'Manage SCIM provisioning from the workbench in your browser.');
  let match: RegExpExecArray | null;
  if (routes.overview.test(path)) {
    if (method === 'GET') return { status: 200, body: await service.overview(user) };
    fail(405, 'method', 'Read SCIM provisioning with GET.');
  }
  if ((match = routes.token.exec(path))) {
    if (method === 'POST') { const issued = service.issue(user, match[1]); return { status: issued.replaced ? 200 : 201, body: issued }; }
    if (method === 'DELETE') return { status: 200, body: service.withdraw(user, match[1]) };
    fail(405, 'method', 'Issue or rotate a Tenant\'s SCIM token with POST, or withdraw it with DELETE.');
  }
  if ((match = routes.mappings.exec(path))) {
    if (method === 'PUT') return { status: 200, body: service.map(user, match[1], await request.body()) };
    fail(405, 'method', 'Replace a Tenant\'s group mappings with PUT.');
  }
  return fail(404, 'not_found', 'The API has no such address. The API reference at /api/openapi.yaml lists the addresses it has.');
}
