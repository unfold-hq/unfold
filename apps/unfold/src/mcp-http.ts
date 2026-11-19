import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccessTokenVerifier, KeysUnavailable, TokenRefused, challenge, metadataPath, resourceMetadata, type AccessToken, type McpHttpSettings } from './mcp-auth.ts';
import { confirmationLedger, createMcpServer, mcpModernProtocolVersions, mcpProtocolVersions, type McpOutbound } from './mcp.ts';
import type { McpTasks, TaskKeyRing } from './mcp-tasks.ts';
import { lowerRole, subjectUserId } from './oidc.ts';
import { narrowedMemberships, type Membership } from './tenancy.ts';
import type { DelegatedProof } from './person-proof.ts';
import type { User, UserRole } from './types.ts';
import type { McpAuditEntry } from './audit/service.ts';
import { clientAddress } from './client-address.ts';
import type { McpEventsHandler } from './mcp-events.ts';
import { unfoldMcpIcons } from './mcp-icons.ts';

/** What the MCP endpoint inside the Unfold server needs from the rest of it. */
export type McpHttpOptions = {
  settings: McpHttpSettings;
  /** The namespace browser sign-in derives account ids from: `auth.oidc.subjectNamespace`, or its issuer. */
  subjectNamespace: string;
  findUser(id: string): User | undefined;
  /** The role verified claims entitle, by the same rule as browser sign-in; undefined when they entitle none. */
  entitle(claims: Record<string, unknown>): UserRole | undefined;
  /** The Tenant and Client memberships verified claims grant, by the same rule as browser sign-in; none when absent. */
  memberships?(claims: Record<string, unknown>): Membership[];
  /** A credential acting as `user` for one request, carrying `proof` for the Ploeg changes it makes. */
  delegate(user: User, ttlMs: number, proof: DelegatedProof): { token: string; revoke(): void };
  /** Where this process's own API answers, such as its loopback address. */
  apiUrl(): string;
  /** Where links in tool results point: the Unfold people open in a browser. */
  linkUrl: string;
  version: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** The reverse proxies whose `X-Forwarded-For` names the caller's address in the security audit. */
  trustedProxies?: readonly string[];
  /** Receives each authenticated request, and each refused token or account, for the security audit. */
  audit?(entry: McpAuditEntry): void;
  /**
   * Lets a 2026-07-28 client that declares the Tasks extension follow a hand-off as a task: `enabled` evaluates the
   * `mcp.tasks` flag for a person, `keys` reads the task id key ring, and `tenantOf` names the Tenant owning a task
   * connection the person reaches.
   */
  tasks?: { enabled(user: User): Promise<boolean>; keys(): TaskKeyRing; tenantOf(user: User, source: string): string | undefined };
  /** MCP Events for a 2026-07-28 client: whether the person may use them, and their `events/*` handler. */
  events?: { enabled(user: User): Promise<boolean>; handler(user: User): McpEventsHandler };
};

const maxBodyBytes = 1_048_576;
const delegationMs = 120_000;
const appsMemoryMs = 86_400_000;
const appsMemoryEntries = 10_000;
const confirmationWaitMs = 120_000;
const tokenMarginMs = 5_000;
const streamHeartbeatMs = 15_000;
const knownVersions: readonly string[] = [...mcpModernProtocolVersions, ...mcpProtocolVersions];

function send(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

function problem(res: ServerResponse, status: number, code: string, message: string, headers: Record<string, string> = {}): void {
  send(res, status, { error: { code, message } }, headers);
}

function rpcError(res: ServerResponse, status: number, id: unknown, code: number, message: string, data?: unknown): void {
  send(res, status, { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

function acceptsStream(req: IncomingMessage): boolean {
  return (header(req, 'accept') ?? '').split(',').some(type => type.split(';')[0].trim().toLowerCase() === 'text/event-stream');
}

function streamEvent(res: ServerResponse, value: unknown): void {
  if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  res.write(`event: message\ndata: ${JSON.stringify(value)}\n\n`);
}

type Waiting = { resolve(value: Record<string, any>): void; reject(error: Error): void };

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(',') : value;
}

function decodeHeader(value: string): string | undefined {
  const encoded = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  if (!encoded) return /^[\x20-\x7e\t]*$/.test(value) ? value : undefined;
  try { return Buffer.from(encoded[1], 'base64').toString('utf8'); } catch { return undefined; }
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBodyBytes) return undefined;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Serves `unfold-mcp` as stateless Streamable HTTP with JSON responses, behind an OAuth 2.1 resource-server check.
 * A 2025 client that declared form elicitation and accepts `text/event-stream` gets its confirming `tools/call` as a
 * stream instead: the confirmation goes out on it as `elicitation/create`, the client's answer comes back as its own
 * POST, matched here by the person, the client and an unguessable request id, and the stream closes with the result.
 * Only this process can match the answer; anything else is refused, and the call ends without acting.
 * Each request's access token is verified, its subject is mapped to an Unfold account, and the tools then call
 * Unfold's API as that account with a short-lived credential of this process. The caller's token goes no further
 * than that credential: a Ploeg change made with it exchanges the token for a person token and never forwards it.
 */
export function createMcpHttp(options: McpHttpOptions) {
  const { settings } = options;
  const resource = new URL(settings.resource);
  const endpoint = resource.pathname;
  const metadataPaths = new Set(['/.well-known/oauth-protected-resource', metadataPath(endpoint)]);
  const verifier = new AccessTokenVerifier(settings, { ...(options.fetch ? { fetch: options.fetch } : {}), ...(options.now ? { now: options.now } : {}) });
  const confirmations = confirmationLedger();
  const icons = unfoldMcpIcons(resource.origin);
  const taskCache: McpTasks['cache'] = new Map();
  const metadata = resourceMetadata(settings);
  const appClients = new Map<string, { until: number; apps: boolean; elicitation: boolean }>();
  const waiting = new Map<string, Waiting>();
  const now = () => options.now?.() ?? Date.now();
  const rememberedClient = (key: string) => { const entry = appClients.get(key); if (entry !== undefined && entry.until <= now()) appClients.delete(key); return entry !== undefined && entry.until > now() ? entry : undefined; };
  const rememberClient = (key: string, apps: boolean, elicitation: boolean) => {
    appClients.delete(key);
    if (!apps && !elicitation) return;
    if (appClients.size >= appsMemoryEntries) appClients.delete(appClients.keys().next().value!);
    appClients.set(key, { until: now() + appsMemoryMs, apps, elicitation });
  };
  if (settings.audience === 'client-id') console.error(JSON.stringify({ level: 'warn', event: 'mcp.client_audience', message: 'UNFOLD_MCP_TOKEN_AUDIENCE=client-id: a token whose aud names a client id in UNFOLD_MCP_CLIENT_IDS is accepted instead of one for UNFOLD_MCP_RESOURCE, so a token that client got for another resource is accepted too' }));

  async function serveEndpoint(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const caller = { ...(req.socket.remoteAddress ? { ip: clientAddress(req, options.trustedProxies) } : {}), ...(header(req, 'user-agent') ? { userAgent: header(req, 'user-agent') } : {}), issuer: settings.issuer };
    const refused = (status: number, reason: string, user?: User, client?: string) => options.audit?.({ ...caller, status, outcome: 'failure', reason, ...(user ? { user } : {}), ...(client ? { client } : {}) });
    const authorization = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)\s*$/i.exec(header(req, 'authorization') ?? '');
    if (!authorization) return problem(res, 401, 'unauthorized', 'Sign in to use this MCP server.', { 'WWW-Authenticate': challenge(settings) });
    let token: AccessToken;
    try { token = await verifier.verify(authorization[1]); }
    catch (error) {
      if (error instanceof TokenRefused) { refused(401, `token_refused: ${error.reason}`.slice(0, 120)); return problem(res, 401, 'unauthorized', `The access token was refused: ${error.reason}.`, { 'WWW-Authenticate': challenge(settings, { code: 'invalid_token', description: error.reason }) }); }
      if (error instanceof KeysUnavailable) return problem(res, 503, 'service_unavailable', 'The identity provider\'s signing keys are unavailable; try again shortly.');
      throw error;
    }
    if (!token.scopes.includes(settings.scope)) { refused(403, 'insufficient_scope', undefined, token.client); return problem(res, 403, 'forbidden', `The access token lacks the scope ${settings.scope}; sign in again and grant it.`, { 'WWW-Authenticate': challenge(settings, { code: 'insufficient_scope', description: `requires ${settings.scope}` }) }); }
    const origin = header(req, 'origin');
    if (origin !== undefined && origin !== resource.origin) return problem(res, 403, 'forbidden', 'This request came from another origin.');
    if (req.method !== 'POST') return problem(res, 405, 'method_not_allowed', 'This MCP endpoint is stateless and accepts only POST.', { Allow: 'POST' });
    const who = token.email ?? token.username ?? token.subject;
    const account = options.findUser(subjectUserId(options.subjectNamespace, token.subject));
    if (!account) {
      console.error(JSON.stringify({ level: 'warn', event: 'mcp.unmapped', client: token.client }));
      refused(403, 'unmapped', undefined, token.client);
      return problem(res, 403, 'forbidden', `Signed in as ${who}, but no Unfold account belongs to this identity. Sign in to Unfold in the browser once with the same account, then connect again.`);
    }
    const entitled = options.entitle(token.claims);
    if (!entitled) {
      console.error(JSON.stringify({ level: 'warn', event: 'mcp.not_entitled', actor: account.id }));
      refused(403, 'not_entitled', account, token.client);
      return problem(res, 403, 'forbidden', `Signed in as ${who}, but the token holds none of the groups this workbench admits.`);
    }
    const role = lowerRole(account.role, entitled);
    const user: User = { ...account, role, memberships: narrowedMemberships(account.memberships ?? [], options.memberships?.(token.claims) ?? [], role) };
    if (!header(req, 'content-type')?.toLowerCase().startsWith('application/json')) return problem(res, 415, 'unsupported_media_type', 'Send one JSON-RPC message as application/json.');
    const raw = await readBody(req);
    if (!raw) return rpcError(res, 413, null, -32600, 'Message exceeds 1 MiB.');
    let message: any;
    try { message = JSON.parse(raw.toString('utf8')); } catch { return rpcError(res, 400, null, -32700, 'Parse error.'); }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return rpcError(res, 400, null, -32600, 'Expected one JSON-RPC request object.');
    if (message.id === undefined) { res.writeHead(202, { 'Cache-Control': 'no-store' }); res.end(); return; }
    if (message.method === undefined && ('result' in message || 'error' in message)) {
      const key = JSON.stringify([user.id, token.client ?? '', message.id]);
      const pending = typeof message.id === 'string' ? waiting.get(key) : undefined;
      options.audit?.({ ...caller, user, ...(token.client ? { client: token.client } : {}), method: 'response', status: pending ? 202 : 400, outcome: pending ? 'success' : 'failure' });
      if (!pending) return problem(res, 400, 'unknown_response', 'No call of this server waits for this answer, so nothing was done. Call the tool again to be asked again.');
      if (message.error !== undefined) pending.reject(new Error('The client refused the request.')); else pending.resolve(message.result && typeof message.result === 'object' && !Array.isArray(message.result) ? message.result : {});
      res.writeHead(202, { 'Cache-Control': 'no-store' }); res.end(); return;
    }
    const { id, method, params } = message;
    const versionHeader = header(req, 'mcp-protocol-version');
    const declared = params?._meta?.['io.modelcontextprotocol/protocolVersion'];
    if (versionHeader !== undefined && !knownVersions.includes(versionHeader)) return rpcError(res, 400, id, -32022, 'Unsupported protocol version', { supported: knownVersions, requested: versionHeader });
    const modern = versionHeader !== undefined && (mcpModernProtocolVersions as readonly string[]).includes(versionHeader);
    if (modern || declared !== undefined) {
      if (declared !== versionHeader) return rpcError(res, 400, id, -32020, `Header mismatch: MCP-Protocol-Version ${JSON.stringify(versionHeader ?? null)} does not match _meta ${JSON.stringify(declared ?? null)}.`);
      if (header(req, 'mcp-method') !== method) return rpcError(res, 400, id, -32020, 'Header mismatch: Mcp-Method is missing or does not match the method.');
      if (method === 'tools/call' || method === 'resources/read') {
        const name = header(req, 'mcp-name');
        const named = method === 'tools/call' ? params?.name : params?.uri;
        if (name === undefined || decodeHeader(name) !== named) return rpcError(res, 400, id, -32020, `Header mismatch: Mcp-Name is missing or does not match the ${method === 'tools/call' ? 'tool name' : 'resource URI'}.`);
      }
      const named = typeof method === 'string' ? method.startsWith('tasks/') ? { value: params?.taskId, what: 'task id' } : method.startsWith('events/') ? { value: params?.name, what: 'event name' } : undefined : undefined;
      const sentName = named ? header(req, 'mcp-name') : undefined;
      if (named && sentName !== undefined && decodeHeader(sentName) !== named.value) return rpcError(res, 400, id, -32020, `Header mismatch: Mcp-Name does not match the ${named.what}.`);
    }
    const appsKey = JSON.stringify([user.id, token.client ?? '', header(req, 'user-agent') ?? '']);
    const remembered = modern ? undefined : rememberedClient(appsKey);
    const waitMs = Math.min(confirmationWaitMs, token.expiresAt - tokenMarginMs - now());
    const streamable = !modern && method === 'tools/call' && remembered?.elicitation === true && acceptsStream(req) && waitMs > 0;
    const delegated = options.delegate(user, delegationMs + (streamable ? waitMs : 0), { source: 'request', userId: user.id, accessToken: authorization[1], subject: token.subject, expiresAt: token.expiresAt });
    let answer: any;
    try {
      const follow = options.tasks;
      const tasks: McpTasks | undefined = follow ? { enabled: () => follow.enabled(user), keys: () => follow.keys(), tenantOf: source => follow.tenantOf(user, source), cache: taskCache } : undefined;
      const events = modern && options.events && await options.events.enabled(user).catch(() => false) ? options.events.handler(user) : undefined;
      const server = createMcpServer({ url: options.linkUrl, apiUrl: options.apiUrl(), token: delegated.token, version: options.version, principal: user.id, role: user.role, confirmations, icons, ...(remembered?.apps ? { mcpApps: true } : {}), ...(streamable ? { elicitation: true } : {}), ...(tasks ? { tasks } : {}), ...(events ? { events } : {}) });
      if (streamable && server.confirmsFirst(String(params?.name))) server.connect(askOnStream(res, user.id, token.client ?? '', waitMs));
      answer = await server.handle(message);
      if (!modern && method === 'initialize' && answer?.result) rememberClient(appsKey, server.declaredMcpApps(), server.declaredFormElicitation());
    } finally { delegated.revoke(); }
    console.log(JSON.stringify({ level: 'info', event: 'mcp.request', actor: user.id, method: String(method).slice(0, 64), ...(method === 'tools/call' ? { tool: String(params?.name ?? '').slice(0, 64) } : {}), protocol: modern ? 'stateless' : 'legacy', ...(token.audience === 'client' ? { audience: 'client' } : {}) }));
    const code = answer?.error?.code;
    const status = code === undefined ? 200 : modern && code === -32601 ? 404 : modern || [-32020, -32021, -32022].includes(code) ? 400 : 200;
    options.audit?.({ ...caller, user, ...(token.client ? { client: token.client } : {}), method: String(method).slice(0, 64), ...(method === 'tools/call' ? { tool: String(params?.name ?? '').slice(0, 64) } : {}), status, outcome: status === 200 && answer?.error === undefined && answer?.result?.isError !== true ? 'success' : 'failure', delegation: delegated.token });
    if (res.headersSent) { if (!res.writableEnded && !res.destroyed) { streamEvent(res, answer); res.end(); } return; }
    send(res, status, answer);
  }

  function askOnStream(res: ServerResponse, principal: string, client: string, waitMs: number): McpOutbound {
    return (method, params) => new Promise((resolve, reject) => {
      const id = `unfold-${randomBytes(18).toString('base64url')}`;
      const key = JSON.stringify([principal, client, id]);
      const settle = (finish: () => void) => { if (waiting.get(key) !== entry) return; waiting.delete(key); clearTimeout(timer); clearInterval(heartbeat); res.off('close', closed); finish(); };
      const entry: Waiting = { resolve: value => settle(() => resolve(value)), reject: error => settle(() => reject(error)) };
      const closed = () => entry.reject(new Error('The client closed the stream.'));
      const timer = setTimeout(() => entry.reject(new Error('The client did not answer in time.')), waitMs);
      const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': waiting for the person\n\n'); }, streamHeartbeatMs);
      if (res.destroyed || res.writableEnded) { clearTimeout(timer); clearInterval(heartbeat); return reject(new Error('The client closed the stream.')); }
      waiting.set(key, entry);
      res.once('close', closed);
      streamEvent(res, { jsonrpc: '2.0', id, method, params });
    });
  }

  return {
    /** Ends every call that waits for a confirmation without acting, as when the process shuts down. */
    close(): void { for (const pending of [...waiting.values()]) pending.reject(new Error('Unfold is shutting down.')); },
    /** Whether a request path is the MCP endpoint or its protected resource metadata. */
    handles(path: string): boolean { return path === endpoint || metadataPaths.has(path); },
    async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
      if (path !== endpoint) {
        const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'MCP-Protocol-Version' };
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        if (req.method !== 'GET' && req.method !== 'HEAD') return problem(res, 405, 'method_not_allowed', 'Read the metadata with GET.', { Allow: 'GET, HEAD, OPTIONS' });
        return send(res, 200, metadata, { ...cors, 'Cache-Control': 'public, max-age=300' });
      }
      return serveEndpoint(req, res);
    },
  };
}
