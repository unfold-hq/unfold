import type { IncomingMessage } from 'node:http';
import type { KubernetesClient } from './runtime/kubernetes.ts';
import { poolTokenAudience } from './runtime/sandbox.ts';
import { validTenancyId, type Ownership } from './tenancy.ts';
import type { AppConfig, User } from './types.ts';

/**
 * A machine that reads the FOCUS cost export with its own Kubernetes service account token (ADR 0071): the service
 * account as `<namespace>/<name>`, the audience its projected token must carry, and the one Tenant and the Teams
 * whose cost it reads.
 */
export type CostExportReader = { id: string; serviceAccount: string; audience: string; tenant: string; teams: string[] };

/** What a TokenReview proved about a token: the Kubernetes user it belongs to and the audiences it was accepted for. */
export type ReviewedToken = { username: string; audiences: string[] };
/** Asks the API server who a token belongs to, accepting it only for one of `audiences`. Undefined when it proves nothing. */
export type TokenReviewer = (token: string, audiences: string[]) => Promise<ReviewedToken | undefined>;

/** The only method and path pairs a cost export reader reaches. */
export const readerRoutes: ReadonlyArray<readonly [string, RegExp]> = [['GET', /^\/api\/ploeg\/cost-export$/]];

/** Whether a cost export reader may call `method` on `path`. */
export function readerRoute(method: string, path: string): boolean {
  return readerRoutes.some(([allowed, pattern]) => allowed === method && pattern.test(path));
}

const maxReaders = 20;
const readerId = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const serviceAccount = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const audience = /^[!-~]{1,253}$/;
const jwt = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const maxTokenLength = 16_384;
const readerKeys = ['id', 'serviceAccount', 'audience', 'tenant', 'teams'];

/**
 * Reads the optional top-level `costExportReaders` list. Each entry names a unique reader `id`, a unique
 * `serviceAccount` as `<namespace>/<name>`, the token `audience` (never the warm pool's), its `tenant` and one to fifty
 * Ploeg `teams`. A reader reads cost from Ploeg, so the list needs live mode and a Ploeg connection, and its Teams must
 * lie within `ploeg.teams` when that is set.
 */
export function costExportReaderSettings(raw: unknown, config: Pick<AppConfig, 'mode' | 'ploeg'>): CostExportReader[] {
  if (!Array.isArray(raw) || raw.length > maxReaders) throw new Error(`costExportReaders must list at most ${maxReaders} readers`);
  if (raw.length && config.mode !== 'live') throw new Error('costExportReaders needs mode live: the demo has no cost to read');
  if (raw.length && (!config.ploeg || config.ploeg.demo)) throw new Error('costExportReaders needs a real Ploeg connection: the export reads cost from Ploeg');
  const readers = raw.map((entry, index): CostExportReader => {
    const label = `costExportReaders[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !readerKeys.includes(key))) throw new Error(`${label} takes only ${readerKeys.join(', ')}`);
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !readerId.test(item.id)) throw new Error(`${label}.id must be lower-case letters, digits and inner hyphens, at most 63 characters`);
    if (typeof item.serviceAccount !== 'string' || !serviceAccount.test(item.serviceAccount)) throw new Error(`${label}.serviceAccount must be <namespace>/<name> of a Kubernetes service account`);
    if (typeof item.audience !== 'string' || !audience.test(item.audience)) throw new Error(`${label}.audience must be the audience of the reader's projected token, without spaces`);
    if (item.audience === poolTokenAudience) throw new Error(`${label}.audience must not be ${poolTokenAudience}, the audience of warm pool tokens`);
    if (!validTenancyId(item.tenant)) throw new Error(`${label}.tenant must be a Tenant id`);
    const teams = item.teams;
    if (!Array.isArray(teams) || !teams.length || teams.length > 50 || teams.some(team => typeof team !== 'string' || !team.trim() || team.length > 100 || /[\u0000-\u001f\u007f]/.test(team))) throw new Error(`${label}.teams must list one to 50 Ploeg team names`);
    const outside = config.ploeg?.teams ? teams.find(team => !config.ploeg!.teams!.includes(team)) : undefined;
    if (outside !== undefined) throw new Error(`${label}.teams names ${outside}, which is outside ploeg.teams`);
    return { id: item.id, serviceAccount: item.serviceAccount, audience: item.audience, tenant: item.tenant, teams: [...new Set(teams as string[])] };
  });
  for (const key of ['id', 'serviceAccount'] as const) {
    const repeated = readers.find((reader, index) => readers.findIndex(other => other[key] === reader[key]) !== index);
    if (repeated) throw new Error(`costExportReaders names ${key} ${repeated[key]} twice`);
  }
  return readers;
}

/** The Kubernetes user name the API server gives a token of `reader`'s service account. */
export function readerUsername(reader: Pick<CostExportReader, 'serviceAccount'>): string {
  const [namespace, name] = reader.serviceAccount.split('/');
  return `system:serviceaccount:${namespace}:${name}`;
}

/** The principal a reader acts as: no person, read-only, a Viewer of its own Tenant only. */
export function readerPrincipal(reader: Pick<CostExportReader, 'id' | 'tenant'>): User {
  return { id: `reader:${reader.id}`, name: `reader:${reader.id}`, role: 'viewer', memberships: [{ kind: 'tenant', tenant: reader.tenant, role: 'viewer' }] };
}

/** `config` with each reader's Teams granted to its principal in Ploeg, so every Ploeg read is limited to them. */
export function withReaderTeams(config: AppConfig): AppConfig {
  if (!config.ploeg || !config.costExportReaders?.length) return config;
  const readerTeams = Object.fromEntries(config.costExportReaders.map(reader => [readerPrincipal(reader).id, [...reader.teams]]));
  return { ...config, ploeg: { ...config.ploeg, userTeams: { ...config.ploeg.userTeams, ...readerTeams } } };
}

/** Reviews tokens with the API server's TokenReview, as the workbench's own service account. */
export function kubernetesTokenReviewer(client: Pick<KubernetesClient, 'request'>): TokenReviewer {
  return async (token, audiences) => {
    const review = await client.request('/apis/authentication.k8s.io/v1/tokenreviews', 'POST', { apiVersion: 'authentication.k8s.io/v1', kind: 'TokenReview', spec: { token, audiences } });
    const status = review?.status;
    if (status?.authenticated !== true || !Array.isArray(status.audiences) || typeof status.user?.username !== 'string') return undefined;
    return { username: status.user.username, audiences: status.audiences.filter((entry: unknown): entry is string => typeof entry === 'string') };
  };
}

/**
 * Proves cost export readers by their projected service account token. A request is a reader's only when the API
 * server accepts its token for that reader's audience and names exactly that reader's service account. Each proven
 * request keeps its principal until it ends, so the handler, the rate limit and the audit see the same reader.
 */
export class CostExportReaders {
  private readonly readers: readonly CostExportReader[];
  private readonly review: TokenReviewer;
  private readonly principals = new Map<string, User>();
  private readonly owners = new WeakMap<User, CostExportReader>();
  private readonly proven = new WeakMap<IncomingMessage, User>();

  constructor(readers: readonly CostExportReader[], review: TokenReviewer) {
    this.readers = readers;
    this.review = review;
    for (const reader of readers) {
      const principal = readerPrincipal(reader);
      this.principals.set(reader.id, principal);
      this.owners.set(principal, reader);
    }
  }

  /** The reader `req` proves with its bearer token, or undefined when it carries none or the token proves no reader. */
  async authenticate(req: IncomingMessage): Promise<User | undefined> {
    if (!this.readers.length) return undefined;
    const token = jwt.exec(req.headers.authorization ?? '')?.[1];
    if (!token || token.length > maxTokenLength) return undefined;
    let reviewed: ReviewedToken | undefined;
    try { reviewed = await this.review(token, [...new Set(this.readers.map(reader => reader.audience))]); }
    catch (error) {
      console.error(JSON.stringify({ level: 'warn', event: 'cost_export_reader.review_failed', message: String((error as Error)?.message ?? error).slice(0, 200) }));
      return undefined;
    }
    const reader = reviewed && this.readers.find(entry => reviewed.username === readerUsername(entry) && reviewed.audiences.includes(entry.audience));
    if (!reader) return undefined;
    const principal = this.principals.get(reader.id)!;
    this.proven.set(req, principal);
    return principal;
  }

  /** Whether a reader may call `method` on `path`. */
  allows(method: string, path: string): boolean { return readerRoute(method, path); }

  /** The reader `req` proved earlier in this request, if any. */
  principal(req: IncomingMessage): User | undefined { return this.proven.get(req); }

  /** The reader whose principal `user` is; undefined for a person, whatever their id says. */
  readerOf(user: User): CostExportReader | undefined { return this.owners.get(user); }
}

/** Whether `reader` reaches what `owner` owns: anything in its own Tenant, whether or not `tenancy.enforce` is on. */
export function readerReaches(reader: Pick<CostExportReader, 'tenant'>, owner: Ownership | undefined): boolean {
  return owner !== undefined && owner.tenant === reader.tenant;
}
