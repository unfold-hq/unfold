import { PloegError } from './ploeg.ts';
import type { User } from './types.ts';

/** A tracker connection as Ploeg reports it (Ploeg ADR-0195 sections 1 and 6): references and the account, never a secret. */
export type PloegTrackerConnection = {
  id: string; kind: string; instance: string; method: string; source: 'runtime' | 'static';
  state: 'active' | 'awaiting_consent' | 'invalid' | 'token_missing' | 'unknown'; invalidReason: string | null;
  account: { id: string; login: string; email?: string } | null; handOverAgent: boolean;
};
/** What starting a connection flow returns (Ploeg ADR-0195 section 3): the flow's `state`, kept by Unfold's server only, and where an OAuth flow sends the person. */
export type PloegFlowStart = { flow: { id: string; method: string; expiresAt: string; state: string }; authorizeUrl?: string };
/** One flow start: a pasted-token flow, or an OAuth flow that returns to `redirectUri`. */
export type PloegFlowInput = { kind: string; instance: string; method: 'token' | 'oauth'; label: string; handOverAgent: boolean; redirectUri?: string };
/**
 * One container a tracker connection reaches (Ploeg ADR-0196): ClickUp's Workspace, Space, Folder or List. `ref` is
 * what a deeper read takes as `parent`; only a `bindable` one can be bound. Its name is the tracker's text, kept under
 * `untrusted` so it is only ever shown escaped, never as markup or instructions.
 */
export type PloegTrackerScope = { kind: string; id: string; ref: string; bindable: boolean; browsable: boolean; untrusted: { name: string } };
/** One level of Scopes (Ploeg ADR-0196 `trackerScopesResponse`): the level read, its Scopes, the cursor of the next page and when Ploeg read the tracker. */
export type PloegScopeLevel = { connection: string; parent: { kind: string; id: string } | null; scopes: PloegTrackerScope[]; nextCursor: string | null; fetchedAt: string };
/** One open item of a Scope (Ploeg ADR-0196 `trackerScopeItemsResponse`), its title and status under `untrusted`. */
export type PloegScopeItem = { id: string; url: string; updatedAt: string | null; untrusted: { title: string; status: string } };
/** One page of a Scope's open items. */
export type PloegScopeItems = { items: PloegScopeItem[]; nextCursor: string | null };
/** One item (Ploeg ADR-0196 `trackerItemResponse`): the preview fields, its Scope, whether it is closed, and its text under `untrusted`. */
export type PloegTrackerItem = { id: string; url: string; scope: string; closed: boolean; createdAt: string | null; updatedAt: string | null; untrusted: { title: string; description: string; labels: string[] } };
/** A Scope binding's state (Ploeg ADR-0186 section 4); `unknown` for a state this Unfold does not know yet. */
export type PloegBindingState = 'active' | 'awaiting_webhook' | 'shadowed' | 'invalid' | 'unknown';
/** A Scope binding or static route as Ploeg's binding read reports it (Ploeg ADR-0186 section 2). */
export type PloegBinding = {
  id: string; team: string; connection: string; scopeId: string; scopeName: string; default: string; allow: string[];
  state: PloegBindingState; invalidReason: string | null; source: 'runtime' | 'static'; revision: number | null; reason: string | null;
};
/** One check of a binding probe (Ploeg ADR-0186 section 3), in the order Ploeg ran it. */
export type PloegBindingCheck = { id: string; status: 'ok' | 'problem' | 'unknown'; text: string };
/** A binding create or dry run: the binding Ploeg would store or stored, whether this call made it, and each check. */
export type PloegBindResult = { binding: PloegBinding | null; created: boolean; checks: PloegBindingCheck[] };
/** The binding body Unfold sends: the connection, the List by id, and registered Work Target keys only (rule R11). */
export type PloegBindInput = { connection: string; scope: { id: string }; default: string; allow: string[]; label?: string };

/**
 * Ploeg's connection, Scope read and binding routes, as one interface so the onboarding can be built and tested
 * before Ploeg serves them. The live adapter's routes are those of Ploeg ADR-0195 and ADR-0186; the Scope read is
 * proposed (design.md section 4, ask 6) and its route is illustrative until Ploeg fixes it.
 */
export interface PloegConnectionApi {
  trackerConnections(user: User): Promise<PloegTrackerConnection[]>;
  startFlow(user: User, input: PloegFlowInput): Promise<PloegFlowStart>;
  completeFlow(user: User, input: { state: string; token: string } | { state: string; code: string }): Promise<{ connection: PloegTrackerConnection; replayed: boolean }>;
  removeConnection(user: User, id: string): Promise<void>;
  scopes(user: User, connection: string, parent?: string, after?: string): Promise<PloegScopeLevel>;
  items(user: User, connection: string, scope: string, after?: string): Promise<PloegScopeItems>;
  item(user: User, connection: string, id: string): Promise<PloegTrackerItem>;
  bindings(user: User): Promise<PloegBinding[]>;
  bind(user: User, team: string, input: PloegBindInput, dryRun: boolean): Promise<PloegBindResult>;
  unbind(user: User, team: string, id: string): Promise<void>;
}

/** The one call the live adapter needs: `PloegClient.operatorCall`. */
export type OperatorCall = (user: User, path: string, options?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }) => Promise<Record<string, unknown> | null>;

const invalid = () => new PloegError(502, 'ploeg_response', 'Ploeg returned a connection or binding Unfold could not read.');
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>; };
const text = (value: unknown, max = 512): string => { if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw invalid(); return value; };
const optional = (value: unknown, max = 512): string | null => value === undefined || value === null ? null : text(value, max);
const list = <T>(value: unknown, parse: (entry: unknown) => T, max = 500): T[] => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) throw invalid(); return value.map(parse); };
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : fallback;
const segment = (value: string) => encodeURIComponent(value);

export function trackerConnection(value: unknown): PloegTrackerConnection {
  const data = object(value);
  const account = data.account === undefined || data.account === null ? null : object(data.account);
  return {
    id: text(data.id, 128), kind: text(data.kind, 64), instance: optional(data.instance, 128) ?? '', method: optional(data.method, 64) ?? '',
    source: oneOf(data.source, ['runtime', 'static'] as const, 'runtime'), state: oneOf(data.state, ['active', 'awaiting_consent', 'invalid', 'token_missing'] as const, 'unknown'),
    invalidReason: optional(data.invalidReason, 64),
    account: account ? { id: String(account.id ?? '').slice(0, 128), login: optional(account.login, 255) ?? '', ...(typeof account.email === 'string' ? { email: account.email.slice(0, 255) } : {}) } : null,
    handOverAgent: data.handOverAgent === true,
  };
}

export function binding(value: unknown): PloegBinding {
  const data = object(value);
  const scope = data.scope && typeof data.scope === 'object' ? data.scope as Record<string, unknown> : {};
  const shadowedBy = data.shadowedBy && typeof data.shadowedBy === 'object' ? data.shadowedBy as Record<string, unknown> : null;
  return {
    id: optional(data.id, 128) ?? '', team: text(data.team, 128), connection: optional(data.connection, 128) ?? '',
    scopeId: optional(scope.id ?? data.scopeId, 512) ?? '', scopeName: optional(scope.name ?? data.scopeName ?? data.displayName, 500) ?? '',
    default: optional(data.default, 128) ?? '', allow: list(data.allow, entry => text(entry, 128), 100),
    state: oneOf(data.state, ['active', 'awaiting_webhook', 'shadowed', 'invalid'] as const, 'unknown'), invalidReason: optional(data.invalidReason, 64),
    source: oneOf(data.source, ['runtime', 'static'] as const, 'runtime'), revision: typeof data.revision === 'number' && Number.isSafeInteger(data.revision) ? data.revision : null,
    reason: shadowedBy ? optional(shadowedBy.entry ?? shadowedBy.name, 256) : optional(data.webhookReason ?? data.reason, 1000),
  };
}

const untrusted = (value: Record<string, unknown>) => value.untrusted === undefined || value.untrusted === null ? {} : object(value.untrusted);

/** A Scope as Ploeg ADR-0196 lists it; its name stays under `untrusted`. */
export function scope(value: unknown): PloegTrackerScope {
  const data = object(value);
  return { kind: text(data.kind, 64), id: text(data.id, 256), ref: text(data.ref, 320), bindable: data.bindable === true, browsable: data.browsable === true, untrusted: { name: optional(untrusted(data).name, 4096) ?? '' } };
}

export function bindingCheck(value: unknown): PloegBindingCheck {
  const data = object(value);
  const status = data.status ?? (data.ok === true ? 'ok' : data.ok === false ? 'problem' : undefined);
  return { id: text(data.id ?? data.code ?? data.name, 64), status: oneOf(status, ['ok', 'problem'] as const, 'unknown'), text: optional(data.text ?? data.message ?? data.detail, 2000) ?? '' };
}

/** Ploeg's connection and binding routes over the operator API (Ploeg ADR-0195, ADR-0186). */
export class HttpPloegConnectionApi implements PloegConnectionApi {
  private readonly call: OperatorCall;
  constructor(call: OperatorCall) { this.call = call; }

  async trackerConnections(user: User): Promise<PloegTrackerConnection[]> {
    const connections: PloegTrackerConnection[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      const data = object(await this.call(user, `tracker-connections?${new URLSearchParams({ limit: '200', ...(after ? { after } : {}) })}`));
      connections.push(...list(data.connections ?? data.items, trackerConnection, 200));
      after = optional(data.next ?? data.after, 512);
      if (!after) break;
    }
    return connections;
  }

  async startFlow(user: User, input: PloegFlowInput): Promise<PloegFlowStart> {
    const data = object(await this.call(user, 'connection-flows', { method: 'POST', body: { port: 'tracker', kind: input.kind, instance: input.instance, method: input.method, label: input.label, handOverAgent: input.handOverAgent, ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}) } }));
    const flow = object(data.flow);
    const next = data.next && typeof data.next === 'object' ? data.next as Record<string, unknown> : {};
    return { flow: { id: text(flow.id, 128), method: text(flow.method, 64), expiresAt: text(flow.expiresAt, 64), state: text(flow.state, 512) }, ...(typeof next.authorizeUrl === 'string' ? { authorizeUrl: text(next.authorizeUrl, 4096) } : {}) };
  }

  async completeFlow(user: User, input: { state: string; token: string } | { state: string; code: string }): Promise<{ connection: PloegTrackerConnection; replayed: boolean }> {
    const data = object(await this.call(user, 'connection-flows/complete', { method: 'POST', body: input }));
    return { connection: trackerConnection(data.connection), replayed: data.replayed === true };
  }

  async removeConnection(user: User, id: string): Promise<void> { await this.call(user, `tracker-connections/${segment(id)}`, { method: 'DELETE' }); }

  async scopes(user: User, connection: string, parent?: string, after?: string): Promise<PloegScopeLevel> {
    const data = object(await this.call(user, `tracker-connections/${segment(connection)}/scopes?${new URLSearchParams({ ...(parent ? { parent } : {}), ...(after ? { after } : {}), limit: '200' })}`));
    const level = data.parent === null || data.parent === undefined ? null : object(data.parent);
    return { connection: text(data.connection, 128), parent: level ? { kind: text(level.kind, 64), id: text(level.id, 256) } : null, scopes: list(data.scopes, scope, 200), nextCursor: optional(data.nextCursor, 512), fetchedAt: text(data.fetchedAt, 64) };
  }

  async items(user: User, connection: string, scopeId: string, after?: string): Promise<PloegScopeItems> {
    const data = object(await this.call(user, `tracker-connections/${segment(connection)}/scopes/${segment(scopeId)}/items${after ? `?${new URLSearchParams({ after })}` : ''}`));
    return { items: list(data.items, item => { const entry = object(item); const said = untrusted(entry); return { id: text(entry.id, 256), url: text(entry.url, 2048), updatedAt: optional(entry.updatedAt, 64), untrusted: { title: optional(said.title, 4096) ?? '', status: optional(said.status, 4096) ?? '' } }; }, 100), nextCursor: optional(data.nextCursor, 512) };
  }

  async item(user: User, connection: string, id: string): Promise<PloegTrackerItem> {
    const data = object(await this.call(user, `tracker-connections/${segment(connection)}/items/${segment(id)}`));
    const entry = data.item === undefined ? data : object(data.item);
    const said = untrusted(entry);
    return { id: text(entry.id, 256), url: text(entry.url, 2048), scope: optional(entry.scope, 256) ?? '', closed: entry.closed === true, createdAt: optional(entry.createdAt, 64), updatedAt: optional(entry.updatedAt, 64), untrusted: { title: optional(said.title, 4096) ?? '', description: optional(said.description, 16384) ?? '', labels: list(said.labels, label => text(label, 4096), 100) } };
  }

  async bindings(user: User): Promise<PloegBinding[]> {
    const data = object(await this.call(user, 'tracker-bindings'));
    return list(data.bindings ?? data.items, binding, 1000);
  }

  async bind(user: User, team: string, input: PloegBindInput, dryRun: boolean): Promise<PloegBindResult> {
    const data = object(await this.call(user, `teams/${segment(team)}/tracker-bindings${dryRun ? '?dryRun=true' : ''}`, { method: 'POST', body: input }));
    const found = data.binding ?? (data.id ? data : null);
    return { binding: found ? binding({ team, ...object(found) }) : null, created: data.created !== false && !dryRun, checks: list(data.checks, bindingCheck, 50) };
  }

  async unbind(user: User, team: string, id: string): Promise<void> { await this.call(user, `teams/${segment(team)}/tracker-bindings/${segment(id)}`, { method: 'DELETE' }); }
}
