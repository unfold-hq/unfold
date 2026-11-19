import { hostname } from 'node:os';
import type { RunCard, PloegDetail, PloegNow, PloegOverview } from './ploeg-types.js';
import type { AccountLink, Approval, Bootstrap, Session, SessionEvent, SessionInput, Permission, Decision, TaskSource, TaskPreview, TaskPage, TaskImportInput, TaskPloegStatus, CandidateFormat, Investigation, Recovery, RecoveryAction, DeliveryView, PublicationBinding } from './types.js';
import type { BrowserLoginStart } from './browser-login.js';
import type { HandOffList } from './handoffs.js';

export type StreamHandlers = { onOpen?: () => void; onEvent: (event: SessionEvent) => void };

export interface Secrets {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function normalizeServerUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete HTTPS workbench URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Use HTTPS for a remote server. HTTP is supported only on localhost.');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the server origin without credentials, path, query or fragment.');
  return url.origin;
}

/** A failure worth one automatic retry of an idempotent read: no answer, or a gateway that could not reach the workbench. */
export function transient(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'unreachable' || error.code === 'gateway_unavailable');
}

function workItemId(value: string): string {
  if (!/^[1-9][0-9]{0,19}$/.test(value)) throw new Error('A Ploeg Work Item identifier is a whole number from 1, such as 42.');
  return value;
}

function identifier(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Invalid remote session or request identifier.');
  return value;
}

function questionText(value: string): string {
  if (!/^[A-Za-z0-9_:-]{1,128}$/.test(value)) throw new Error('Invalid question identifier.');
  return value;
}

/** A session request with the retired `crewId` beside `teamId`, so a workbench older than system ADR-0036 still accepts it. */
export function withRetiredTeamKey<T extends { teamId: string }>(input: T): T & { crewId: string } {
  return { ...input, crewId: input.teamId };
}

const editorCredential = /^vle_[A-Za-z0-9_-]{43}$/;

/** The request headers that carry a stored credential: an editor credential as a bearer token, a password sign-in as its session cookie. */
export function credentialHeaders(stored: string | undefined): Record<string, string> {
  if (!stored) return {};
  return editorCredential.test(stored) ? { Authorization: `Bearer ${stored}` } : { Cookie: stored };
}

/** Extra request headers a person stores for one workbench, for an access gateway in front of it that wants its own credential. */
export type GatewayHeaders = Record<string, string>;

export const gatewayHeaderLimit = 16;
const gatewayHeaderToken = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
const gatewayHeaderText = /^[\x20-\x7e]{1,8192}$/;
const ownedHeaders = new Set(['accept', 'authorization', 'connection', 'content-length', 'content-type', 'cookie', 'expect', 'host', 'keep-alive', 'origin', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'x-unfold-request']);

/** A gateway header's name as it will be sent; throws for a name that is no header name or that the editor sets itself. */
export function gatewayHeaderName(value: string): string {
  const name = value.trim();
  if (!gatewayHeaderToken.test(name)) throw new Error('Enter one header name of at most 64 characters, without a colon or spaces.');
  if (ownedHeaders.has(name.toLowerCase())) throw new Error(`The editor sets ${name} itself, so an access gateway header cannot replace it.`);
  return name;
}

/** A gateway header's value as it will be sent; throws for an empty, multi-line, non-ASCII or oversized value. */
export function gatewayHeaderValue(value: string): string {
  const text = value.trim();
  if (!gatewayHeaderText.test(text)) throw new Error('Enter the value on one line, in printable ASCII, at most 8192 characters.');
  return text;
}

/** The headers a stored secret holds; an unreadable secret or an entry that would not pass as input counts as absent. */
export function storedGatewayHeaders(stored: string | undefined): GatewayHeaders {
  if (!stored) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(stored); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const headers: GatewayHeaders = {};
  for (const [name, value] of Object.entries(parsed).slice(0, gatewayHeaderLimit)) {
    if (typeof value !== 'string') continue;
    try { headers[gatewayHeaderName(name)] = gatewayHeaderValue(value); } catch { continue; }
  }
  return headers;
}

type Answer = { status: number; headers: { get(name: string): string | null } };

export type WorkbenchFault = { code: string; message: string };

/** The fault a body names the way the Unfold JSON API names every refusal, `{ error: { code, message } }`, or undefined for any other body. */
export function workbenchFault(body: string | undefined): WorkbenchFault | undefined {
  let data: { error?: { code?: unknown; message?: unknown } } | undefined;
  try { data = JSON.parse(body ?? ''); } catch { return undefined; }
  const code = data?.error?.code;
  if (typeof code !== 'string' || !code) return undefined;
  return { code, message: typeof data?.error?.message === 'string' ? data.error.message : '' };
}

const refusalBodyLimit = 65_536;

async function boundedText(response: Response, limit: number): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= limit) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      chunks.push(chunk.value);
    }
  } catch { return undefined; }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return size > limit ? undefined : Buffer.concat(chunks).toString('utf8');
}

function redirectTarget(origin: string, location: string | null): URL | undefined {
  if (!location) return undefined;
  try { return new URL(location, origin); } catch { return undefined; }
}

/**
 * The fault when something in front of the workbench answered in its place: a redirect, which the workbench never sends
 * on a route this client calls, or a 401 or 403 whose `body` does not name a fault as the Unfold JSON API does. Undefined
 * when the workbench may have answered.
 */
export function gatewayFault(origin: string, path: string, answer: Answer, gatewayHeadersStored: boolean, body?: string): ApiError | undefined {
  const host = new URL(origin).host;
  if (answer.status >= 300 && answer.status < 400) {
    const target = redirectTarget(origin, answer.headers.get('location'));
    if (target && target.origin !== origin && target.pathname === new URL(path, origin).pathname) return new ApiError(answer.status, 'redirect', `The workbench at ${host} redirects to ${target.origin}. If that is your workbench, run Unfold: Connect to Workbench with that origin. Credentials are never forwarded.`);
    const destination = !target ? 'another address' : target.origin === origin ? `its own path ${target.pathname}` : target.host;
    const remedy = gatewayHeadersStored
      ? 'It did not accept the access gateway headers stored for this workbench; replace them with Unfold: Set Access Gateway Headers.'
      : 'If it accepts a credential in request headers, such as a service token, store it with Unfold: Set Access Gateway Headers.';
    return new ApiError(answer.status, 'gateway_sign_in', `The workbench at ${host} did not answer: something in front of it redirected the request to ${destination}. That is usually an access gateway asking for a sign-in the editor cannot complete. ${remedy} Credentials are never forwarded.`);
  }
  if ((answer.status === 401 || answer.status === 403) && !workbenchFault(body)) {
    return new ApiError(0, 'gateway_refused', gatewayHeadersStored
      ? `An access gateway in front of the workbench at ${host} refused the request with ${answer.status}. The headers stored for it may be wrong, expired or revoked; replace them with Unfold: Set Access Gateway Headers.`
      : `The server at ${host} refused the request with ${answer.status} and did not return the Unfold JSON API. Check the server URL. If an access gateway in front of the workbench accepts a credential in request headers, such as a service token, store it with Unfold: Set Access Gateway Headers.`);
  }
  return undefined;
}

/** Whether a failure is an access gateway in front of the workbench asking for a credential the editor did not send or that it refused. */
export function gatewayWantsCredential(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'gateway_sign_in' || error.code === 'gateway_refused');
}

export class UnfoldClient {
  readonly origin: string;
  readonly secretKey: string;
  readonly gatewayKey: string;
  private readonly secrets: Secrets;
  private readonly requestTimeout: number;
  private readonly retryDelay: number;
  constructor(origin: string, secrets: Secrets, requestTimeout = 15_000, retryDelay = 750) {
    this.origin = normalizeServerUrl(origin);
    this.secretKey = `unfold.session:${this.origin}`;
    this.gatewayKey = `unfold.gateway:${this.origin}`;
    this.secrets = secrets;
    this.requestTimeout = requestTimeout;
    this.retryDelay = retryDelay;
  }
  async gatewayHeaders(): Promise<GatewayHeaders> { return storedGatewayHeaders(await this.secrets.get(this.gatewayKey)); }
  /** Replaces the access gateway headers of this workbench; an empty set forgets them. A name is one header whatever its case, and the last entry wins. */
  async setGatewayHeaders(headers: GatewayHeaders): Promise<void> {
    const checked = new Map<string, [string, string]>();
    for (const [name, value] of Object.entries(headers)) checked.set(name.trim().toLowerCase(), [gatewayHeaderName(name), gatewayHeaderValue(value)]);
    if (checked.size > gatewayHeaderLimit) throw new Error(`A workbench takes at most ${gatewayHeaderLimit} access gateway headers.`);
    if (!checked.size) { await this.secrets.delete(this.gatewayKey); return; }
    await this.secrets.store(this.gatewayKey, JSON.stringify(Object.fromEntries(checked.values())));
  }
  private async outgoing(accept: string): Promise<{ headers: Record<string, string>; gatewayHeadersStored: boolean }> {
    const gateway = await this.gatewayHeaders();
    const stored = await this.secrets.get(this.secretKey);
    return { headers: { ...gateway, Accept: accept, Origin: this.origin, 'X-Unfold-Request': '1', ...credentialHeaders(stored) }, gatewayHeadersStored: Object.keys(gateway).length > 0 };
  }
  /** Throws when something in front of the workbench answered in its place; answers the workbench's own 401 or 403, whose body it has then read. */
  private async refusal(path: string, response: Response, gatewayHeadersStored: boolean): Promise<WorkbenchFault | undefined> {
    const refused = response.status === 401 || response.status === 403;
    const body = refused ? await boundedText(response, refusalBodyLimit) : undefined;
    const fault = gatewayFault(this.origin, path, response, gatewayHeadersStored, body);
    if (fault) { await response.body?.cancel().catch(() => undefined); throw fault; }
    return workbenchFault(body);
  }
  async request<T>(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    if (!path.startsWith('/api/') || path.includes('://') || path.includes('..')) throw new Error('Invalid API route.');
    try { return await this.attempt<T>(path, method, body, extra); }
    catch (error) {
      if (method !== 'GET' || !transient(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      return this.attempt<T>(path, method, body, extra);
    }
  }
  private async attempt<T>(path: string, method: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const { headers, gatewayHeadersStored } = await this.outgoing('application/json');
    Object.assign(headers, extra);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(`${this.origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(this.requestTimeout), redirect: 'manual' });
    } catch {
      throw new ApiError(0, 'unreachable', method === 'GET' ? 'The workbench could not be reached. Check the server URL, network and certificate.' : 'The request outcome could not be confirmed. Refresh the session before repeating the action; check the network and server connection.');
    }
    const refused = await this.refusal(path, response, gatewayHeadersStored);
    if (refused) {
      if (response.status === 401) await this.secrets.delete(this.secretKey);
      throw new ApiError(response.status, refused.code, refused.message || `Request failed (${response.status}).`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 500) throw new ApiError(response.status, 'gateway_unavailable', `The gateway in front of the workbench answered ${response.status} instead of the Unfold API. The workbench may be restarting or unreachable from its gateway.`);
      throw new ApiError(response.status, 'invalid_response', 'The server did not return the Unfold JSON API. Check the server URL or reverse proxy.');
    }
    if (Number(response.headers.get('content-length')) > 16_777_216) throw new ApiError(0, 'response_too_large', 'This response is too large for the editor. Open the web dashboard.');
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError(0, 'invalid_response', 'The workbench returned an empty response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16_777_216) { await reader.cancel(); throw new ApiError(0, 'response_too_large', 'This response is too large for the editor. Open the web dashboard.'); }
      chunks.push(chunk.value);
    }
    let data: any;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(0, 'invalid_response', 'The workbench returned invalid JSON.'); }
    if (!response.ok) throw new ApiError(response.status, String(data?.error?.code || 'request_failed'), String(data?.error?.message || `Request failed (${response.status}).`));
    if (path === '/api/login') {
      const cookieHeader = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') || ''];
      const authenticated = cookieHeader.map(value => value.split(';')[0]).find(value => /^(?:__Host-)?unfold=[A-Za-z0-9_-]{32,200}$/.test(value));
      if (!authenticated) throw new ApiError(0, 'invalid_cookie', 'Login did not return a valid workbench session.');
      await this.secrets.store(this.secretKey, authenticated);
    }
    return data as T;
  }
  ploeg(team?: string, fresh = false): Promise<PloegOverview> { const query = new URLSearchParams(); if (team) query.set('team', team); if (fresh) query.set('refresh', '1'); return this.request(`/api/ploeg?${query}`); }
  ploegNow(fresh = false): Promise<PloegNow> { return this.request(`/api/ploeg/now${fresh ? '?refresh=1' : ''}`); }
  workItem(id: string, fresh = false): Promise<PloegDetail> { return this.request(`/api/ploeg/work-items/${workItemId(id)}${fresh ? '?refresh=1' : ''}`); }
  /** The signed-in person's own hand-offs from any client, newest first, each with the Work Item it became. */
  handOffs(fresh = false): Promise<HandOffList> { return this.request(`/api/handoffs${fresh ? '?refresh=1' : ''}`); }
  /** Stores a person's answer to one question a Work Item waits on, as the browser's Answer does. */
  answerQuestion(id: string, questionId: string, body: { commandId: string; answer: string }): Promise<unknown> { return this.request(`/api/ploeg/work-items/${workItemId(id)}/questions/${encodeURIComponent(questionText(questionId))}/answer`, 'POST', body); }
  /** Restarts or resumes a Work Item that waits on a person, with an optional note for its next Run. */
  requeue(id: string, body: { commandId: string; expectedState: 'needs_human'; note?: string; resume?: true }): Promise<{ demo?: boolean; resumed?: boolean; fromRound?: number }> { return this.request(`/api/ploeg/work-items/${workItemId(id)}/requeue`, 'POST', body); }
  /** Approves, rejects, restarts or hands back a Work Item through the browser's routes, naming the channel and the agreed confirmation so its Action Record carries both. */
  workItemAction(id: string, action: 'approve' | 'reject' | 'requeue' | 'hand-back', body: Record<string, unknown>, via: { client: string; confirmation: string }): Promise<Record<string, unknown>> {
    return this.request(`/api/ploeg/work-items/${workItemId(id)}/${action}`, 'POST', body, { 'X-Unfold-Client': via.client, 'X-Unfold-Confirmation': via.confirmation });
  }
  async workItemCard(id: string): Promise<RunCard | undefined> {
    try { return (await this.request<{ card?: RunCard }>(`/api/ploeg/work-items/${workItemId(id)}/card`)).card; }
    catch (error) { if (error instanceof ApiError && error.status === 404) return undefined; throw error; }
  }
  ploegDashboard(id?: string): string { return `${this.origin}/#work${id ? `/${workItemId(id)}` : ''}`; }
  async bootstrap(): Promise<Bootstrap> {
    const data = await this.request<Bootstrap & { crews?: Bootstrap['teams'] }>('/api/bootstrap');
    const { crews, ...bootstrap } = data;
    return { ...bootstrap, teams: data.teams ?? crews ?? [] };
  }
  async login(name: string, password: string): Promise<void> { await this.request('/api/login', 'POST', { name, password }); }
  async authMethods(): Promise<{ local: boolean; oidc: { name: string; issuer: string } | null }> {
    const result = await this.request<{ local?: boolean; oidc?: { name: string; issuer: string } | null }>('/api/auth/methods');
    return { local: result?.local !== false, oidc: result?.oidc && typeof result.oidc.name === 'string' ? result.oidc : null };
  }
  async beginBrowserLogin(): Promise<BrowserLoginStart> {
    const result = await this.request<{ code?: string; secret?: string; userCode?: string; url?: string; expiresIn?: number; interval?: number }>('/api/auth/editor', 'POST', { client: 'vscode', host: hostname().split('.')[0] });
    if (typeof result?.code !== 'string' || typeof result?.secret !== 'string' || typeof result?.url !== 'string' || typeof result?.userCode !== 'string' || !/^[A-Z]{4}-[A-Z]{4}$/.test(result.userCode)) throw new ApiError(0, 'invalid_response', 'The workbench did not start a browser sign-in with a code to approve. It may need an update.');
    return { code: result.code, secret: result.secret, userCode: result.userCode, url: result.url, expiresIn: typeof result.expiresIn === 'number' ? result.expiresIn : 600, interval: typeof result.interval === 'number' && result.interval > 0 && result.interval <= 30 ? result.interval : 2 };
  }
  async collectBrowserLogin(code: string, secret: string): Promise<{ status: 'pending' } | { status: 'ready'; token: string; user: { name: string } }> {
    const result = await this.request<{ status?: string; token?: string; user?: { name: string } }>(`/api/auth/editor/${encodeURIComponent(code)}`, 'POST', { secret });
    if (result?.status === 'ready' && typeof result.token === 'string' && result.user) return { status: 'ready', token: result.token, user: result.user };
    return { status: 'pending' };
  }
  async acceptCredential(token: string): Promise<void> {
    if (!editorCredential.test(token)) throw new ApiError(0, 'invalid_credential', 'The browser sign-in did not return a valid editor credential.');
    await this.secrets.store(this.secretKey, token);
  }
  async logout(): Promise<void> { try { await this.request('/api/logout', 'POST', {}); } finally { await this.secrets.delete(this.secretKey); } }
  async models(): Promise<Array<{ id: string; name: string; modelId: string; providerId: string; provider?: string; providers?: string[]; tiers?: Record<string, string> }>> {
    const result = await this.request<{ models?: Array<{ id: string; name: string; modelId: string; providerId: string; provider?: string; providers?: string[]; tiers?: Record<string, string> }> }>('/api/models');
    return Array.isArray(result?.models) ? result.models : [];
  }
  sessions(): Promise<Session[]> { return this.request('/api/sessions'); }
  session(id: string): Promise<Session> { return this.request(`/api/sessions/${identifier(id)}`); }
  history(id: string, after = 0): Promise<SessionEvent[]> { return this.request(`/api/sessions/${identifier(id)}/history?after=${Math.max(0, Math.floor(after))}`); }
  investigation(id: string): Promise<Investigation> { return this.request(`/api/sessions/${identifier(id)}/investigation`); }
  recovery(id: string): Promise<Recovery> { return this.request(`/api/sessions/${identifier(id)}/recovery`); }
  capture(id: string): Promise<Session> { return this.request(`/api/sessions/${identifier(id)}/capture`, 'POST', {}); }
  recover(id: string, action: RecoveryAction): Promise<Session> { return this.request(`/api/sessions/${identifier(id)}/${action === 'deliver' ? 'deliver' : 'run-again'}`, 'POST', {}); }
  permissions(id: string): Promise<Permission[]> { return this.request(`/api/sessions/${identifier(id)}/permissions`); }
  create(input: SessionInput): Promise<Session> { return this.request('/api/sessions', 'POST', withRetiredTeamKey(input)); }
  action(id: string, action: 'start' | 'pause' | 'resume' | 'cancel' | 'retry'): Promise<Session> { return this.request(`/api/sessions/${identifier(id)}/${action}`, 'POST', {}); }
  delivery(id: string): Promise<DeliveryView> { return this.request(`/api/sessions/${identifier(id)}/delivery`); }
  publish(id: string, binding: PublicationBinding): Promise<DeliveryView> { return this.request(`/api/sessions/${identifier(id)}/delivery/publish`, 'POST', { candidateId: binding.candidateId, receiptId: binding.receiptId, policySha256: binding.policySha256 }); }
  review(id: string, decision: 'accepted' | 'rejected', note?: string): Promise<Session> { return this.request(`/api/sessions/${identifier(id)}/review`, 'POST', { decision, ...(note ? { note } : {}) }); }
  message(id: string, text: string): Promise<Session> { return this.request(`/api/sessions/${identifier(id)}/messages`, 'POST', { text }); }
  respond(id: string, requestId: string, answer: Decision): Promise<Session> {
    return this.request(`/api/sessions/${identifier(id)}/permissions/${identifier(requestId)}`, 'POST', answer);
  }
  setApproval(id: string, approval: Approval): Promise<Session> {
    if (approval !== 'manual' && approval !== 'auto') throw new Error('Approval is manual or auto.');
    return this.request(`/api/sessions/${identifier(id)}/approval`, 'POST', { approval });
  }
  async links(): Promise<AccountLink[]> {
    const result = await this.request<{ links?: AccountLink[] }>('/api/links');
    return Array.isArray(result?.links) ? result.links : [];
  }
  async link(provider: string): Promise<string> {
    const result = await this.request<{ url?: string }>(`/api/links/${encodeURIComponent(provider)}`, 'POST', {});
    if (typeof result?.url !== 'string' || !/^https?:\/\//.test(result.url)) throw new ApiError(0, 'invalid_response', 'The workbench did not return an authorization URL.');
    return result.url;
  }
  async unlink(provider: string): Promise<void> { await this.request(`/api/links/${encodeURIComponent(provider)}`, 'DELETE'); }
  async paste(provider: string, token: string): Promise<void> { await this.request(`/api/links/${encodeURIComponent(provider)}`, 'PUT', { token }); }
  linkGitlab(): Promise<string> { return this.link('gitlab'); }
  unlinkGitlab(): Promise<void> { return this.unlink('gitlab'); }
  budget(id: string, amountUsd: number): Promise<Session> {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Additional budget must be a positive amount.');
    return this.request(`/api/sessions/${identifier(id)}/budget`, 'POST', { amountUsd });
  }
  async stream(id: string, after: number, handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
    const path = `/api/sessions/${identifier(id)}/events?after=${Math.max(0, Math.floor(after))}`;
    const { headers, gatewayHeadersStored } = await this.outgoing('text/event-stream');
    let response: Response;
    try { response = await fetch(`${this.origin}${path}`, { headers, signal, redirect: 'manual' }); }
    catch (error) { if (signal.aborted) return; throw new ApiError(0, 'unreachable', 'The live event stream could not be opened.'); }
    await this.refusal(path, response, gatewayHeadersStored);
    if (response.status === 401) { await this.secrets.delete(this.secretKey); throw new ApiError(401, 'unauthenticated', 'Sign in to your workbench.'); }
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/event-stream') || !response.body) { await response.body?.cancel(); throw new ApiError(response.status, 'stream_unavailable', 'The workbench did not offer a live event stream.'); }
    handlers.onOpen?.();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const dispatch = (block: string) => {
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      if (!data) return;
      let event: SessionEvent;
      try { event = JSON.parse(data); } catch { return; }
      if (event && typeof event.id === 'number' && event.sessionId === id && typeof event.type === 'string') handlers.onEvent(event);
    };
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 4_194_304) throw new ApiError(0, 'stream_overflow', 'The live event stream sent an oversized message.');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) { dispatch(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); boundary = buffer.indexOf('\n\n'); }
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, 'stream_closed', 'The live event stream closed.');
    } finally { await reader.cancel().catch(() => undefined); }
  }
  taskSources(): Promise<TaskSource[]> { return this.request('/api/task-sources'); }
  tasks(sourceId: string, page = 1): Promise<TaskPage> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new Error('Invalid task page.');
    return this.request(`/api/task-sources/${identifier(sourceId)}/tasks?page=${page}`);
  }
  task(sourceId: string, taskId: string, truncate = false): Promise<TaskPreview> { return this.request(`/api/task-sources/${identifier(sourceId)}/tasks/${identifier(taskId)}${truncate ? '?truncate=1' : ''}`); }
  importTask(input: TaskImportInput): Promise<Session> { return this.request('/api/task-imports', 'POST', withRetiredTeamKey(input)); }
  taskPloeg(sourceId: string, taskId: string, fresh = false): Promise<TaskPloegStatus> { return this.request(`/api/task-sources/${identifier(sourceId)}/tasks/${identifier(taskId)}/ploeg${fresh ? '?refresh=1' : ''}`); }
  handoff(sourceId: string, taskId: string, team: string, revision: string): Promise<TaskPloegStatus> { return this.request(`/api/task-sources/${identifier(sourceId)}/tasks/${identifier(taskId)}/handoff`, 'POST', { team: identifier(team), revision }); }
  takeBack(sourceId: string, taskId: string, team: string): Promise<TaskPloegStatus> { return this.request(`/api/task-sources/${identifier(sourceId)}/tasks/${identifier(taskId)}/handoff?team=${encodeURIComponent(identifier(team))}`, 'DELETE'); }
  async lookupTask(provider: string, id: string): Promise<string | undefined> {
    try { return (await this.request<{ sourceId?: string }>(`/api/tasks/lookup?${new URLSearchParams({ provider: identifier(provider), id: identifier(id) })}`)).sourceId; }
    catch (error) { if (error instanceof ApiError && error.status === 404) return undefined; throw error; }
  }
  async downloadCandidate(id: string, format: CandidateFormat): Promise<Uint8Array> {
    if (!['bundle', 'patch', 'manifest', 'attestation', 'trace'].includes(format)) throw new Error('Invalid candidate format.');
    const path = `/api/sessions/${identifier(id)}/candidate/download?format=${format}`;
    const { headers, gatewayHeadersStored } = await this.outgoing('*/*');
    let response: Response;
    try { response = await fetch(`${this.origin}${path}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) }); }
    catch { throw new ApiError(0, 'unreachable', 'The candidate could not be downloaded. Check the workbench connection.'); }
    await this.refusal(path, response, gatewayHeadersStored);
    if (response.status === 401) await this.secrets.delete(this.secretKey);
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(response.status, 'download_failed', response.status === 404 ? 'This candidate is not available to your account. Refresh the session.' : 'The candidate download is unavailable. Refresh the session and inspect its export status.');
    }
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    const allowed = format === 'manifest' ? ['application/json'] : format === 'patch' ? ['text/plain', 'text/x-diff', 'application/octet-stream'] : ['application/octet-stream', 'application/x-git-bundle'];
    if (!allowed.includes(contentType)) { await response.body?.cancel(); throw new ApiError(0, 'invalid_response', 'The workbench returned an unexpected candidate file type.'); }
    const limit = 128 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new ApiError(0, 'response_too_large', 'This candidate exceeds the editor download limit of 128 MiB.'); }
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError(0, 'invalid_response', 'The workbench returned an empty candidate response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { await reader.cancel(); throw new ApiError(0, 'response_too_large', 'This candidate exceeds the editor download limit of 128 MiB.'); }
        chunks.push(chunk.value);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, 'incomplete_download', 'The candidate download was interrupted. No file has been saved; download it again when connected.');
    }
    if (!size && format !== 'patch') throw new ApiError(0, 'invalid_response', 'The workbench returned an empty candidate file.');
    return Buffer.concat(chunks, size);
  }
  dashboard(id?: string): string { return `${this.origin}/#${id ? `session/${identifier(id)}` : 'sessions'}`; }
}

/** What a `vscode://unfold-hq.unfold-workbench/<path>?<query>` link from the workbench asks the extension to do. */
export type UnfoldLink =
  | { kind: 'checkout'; workItem?: string; origin?: string }
  | { kind: 'work-item' | 'session'; id: string; origin?: string }
  | { kind: 'connect-agents-window'; origin?: string };

/** Reads a link's path and query; throws for a path the extension does not handle or an origin that is not a workbench address. */
export function parseUnfoldLink(path: string, query: string): UnfoldLink {
  const params = new URLSearchParams(query);
  const raw = params.get('origin');
  let origin: string | undefined;
  if (raw) {
    try { origin = normalizeServerUrl(raw); } catch { throw new Error('This link names an invalid workbench.'); }
  }
  if (path === '/checkout') return { kind: 'checkout', workItem: params.get('workItem') ?? undefined, ...(origin ? { origin } : {}) };
  if (path === '/connect-agents-window') return { kind: 'connect-agents-window', ...(origin ? { origin } : {}) };
  if (path === '/work-item' || path === '/session') {
    const id = params.get('id') ?? '';
    if (!(path === '/work-item' ? /^[1-9][0-9]{0,19}$/ : /^[A-Za-z0-9_-]{1,80}$/).test(id)) throw new Error(`This link names no ${path === '/work-item' ? 'Work Item' : 'session'}.`);
    return { kind: path === '/work-item' ? 'work-item' : 'session', id, ...(origin ? { origin } : {}) };
  }
  throw new Error(`Unfold does not handle ${path || 'this link'}.`);
}
