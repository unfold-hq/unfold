import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../src/auth.ts';
import { GitlabConnections, gitlabRefusalTable, tokenPage } from '../src/gitlab-connections.ts';
import { errorCatalogue } from '../src/error-catalogue.ts';
import { ploegSteps } from '../src/onboarding.ts';
import { PloegOperatorRefusal } from '../src/ploeg.ts';
import { Store } from '../src/store.ts';
import { ensureIntegrationSchema } from '../src/integration-store.ts';
import { application, login, request } from './api-support.ts';

const serviceToken = `glpat-${randomBytes(16).toString('hex')}`;
const ownerToken = `glpat-${randomBytes(16).toString('hex')}`;
const flowState = `st${randomBytes(16).toString('hex')}`;
const secrets = [serviceToken, ownerToken, flowState];

type Call = { method: string; url: string; body: Record<string, unknown> };
type FakeOptions = { served?: boolean; refuseMethod?: string; refuseComplete?: string; mints?: boolean; otherForge?: boolean; refuseTarget?: string; inUse?: boolean };

async function fakePloeg(t: TestContext, options: FakeOptions = {}) {
  const calls: Call[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    calls.push({ method: req.method!, url: req.url!, body });
    const url = new URL(req.url!, 'http://ploeg.invalid');
    const path = url.pathname.replace('/api/v1/operator/', '');
    const send = (status: number, value: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ schemaVersion: '1.0', ...(value as object) }));
    const refuse = (status: number, code: string, message = `refused: ${code}`, extra: object = {}) => send(status, { error: { code, message, ...extra } });
    if (req.method === 'GET' && path === 'teams') return send(200, { teams: [{ id: 'bronze', paused: false, queueDepth: 0, roles: [], assignees: [], pinnedScopes: [] }] });
    if (req.method === 'GET' && path === 'connections') return send(200, { checkedAt: null, eventWindowDays: 30, boards: [], repositories: options.otherForge ? [{ key: 'site', label: 'site', forge: 'github', owner: 'acme', repo: 'site', baseBranch: 'main', readiness: 'ready', reason: '', lastForgeEventAt: null, boards: [] }] : [] });
    if (options.served === false && (path === 'forge-connections' || path === 'targets')) return res.writeHead(404).end();
    const connection = { id: 'gitlab-acme', port: 'forge', kind: 'gitlab', instance: 'gitlab', method: 'token', account: { id: '77', login: 'unfold-bot' }, source: 'runtime', state: 'active', invalidReason: null, canMint: options.mints === true, label: 'Unfold service account', revision: 1, secrets: { token: { store: 'kv', path: 'forge/gitlab-acme', version: 1 } }, lastProbe: null, usedBy: [], createdBy: 'oidc-admin', createdAt: '2026-11-19T10:00:00Z', updatedBy: 'oidc-admin', updatedAt: '2026-11-19T10:00:00Z' };
    if (req.method === 'GET' && path === 'forge-connections') return send(200, { connections: calls.some(call => call.url.endsWith('/complete') && call.body.token === serviceToken) ? [connection] : [], nextCursor: null });
    if (req.method === 'GET' && path === 'targets') return send(200, { targets: [] });
    if (req.method === 'POST' && path === 'connection-flows') {
      if (options.refuseMethod === body.method) return refuse(422, 'method_not_allowed');
      return send(201, { flow: { id: 'flow-1', method: body.method, port: 'forge', kind: 'gitlab', instance: body.instance, status: 'pending', expiresAt: '2026-11-19T10:15:00Z', state: flowState }, next: {} });
    }
    if (req.method === 'POST' && path === 'connection-flows/complete') {
      if (options.refuseComplete) return refuse(422, options.refuseComplete, `GitLab refused ${String(body.token)}`);
      if (body.state === flowState && body.token === serviceToken) return send(200, { connection, replayed: false });
      return refuse(404, 'unknown_flow');
    }
    if (req.method === 'GET' && path === 'forge-connections/gitlab-acme/repositories') return send(200, { repositories: [{ id: '5', fullName: 'acme/web/shop', private: true, canWrite: true, registered: false, key: null }, { id: '6', fullName: 'acme/docs', private: false, canWrite: false, registered: false, key: null }], nextCursor: null });
    if (req.method === 'DELETE' && path === 'forge-connections/gitlab-acme') {
      if (options.inUse) return refuse(409, 'connection_in_use', 'used', { usedBy: [{ kind: 'target', id: 'acme-shop' }] });
      return send(200, { leftAtVendor: [{ kind: 'service_account', id: 'unfold-bot', url: 'https://gitlab.com/groups/acme/-/settings/service_accounts' }] });
    }
    if (req.method === 'POST' && path === 'targets') {
      if (options.refuseTarget) return refuse(422, options.refuseTarget);
      if (!options.mints) return refuse(422, 'capability_missing', 'GitLab connections mint no per-Run credential yet.');
      const target = { key: body.key, repository: body.repository, branch: 'main', state: url.searchParams.get('dryRun') ? 'not_registered' : 'active', readiness: { state: 'ready', reasons: [] } };
      return send(url.searchParams.get('dryRun') ? 200 : 201, { target, checks: [{ name: 'granted', result: 'pass' }] });
    }
    return res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { calls, url: `http://127.0.0.1:${address.port}`, writes: () => calls.filter(call => call.method !== 'GET') };
}

async function live(t: TestContext, options: FakeOptions = {}) {
  const ploeg = await fakePloeg(t, options);
  const env = `UNFOLD_CONNECT_GITLAB_${randomBytes(6).toString('hex').toUpperCase()}`;
  process.env[env] = randomBytes(24).toString('hex');
  const api = await application('live', config => {
    config.ploeg = { url: ploeg.url, tokenEnv: env };
    config.baseUrl = 'http://127.0.0.1';
    config.flags = { document: { flags: { 'repositories.stored': { defaultVariant: 'on' } } }, unknown: [] };
  });
  t.after(async () => { await api.close(); delete process.env[env]; });
  const { cookie } = await login(api.url);
  return { api, ploeg, cookie };
}

function captureOutput(t: TestContext): () => string {
  const lines: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => { lines.push(String(chunk)); return (out as (...args: unknown[]) => boolean)(chunk, ...rest); }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => { lines.push(String(chunk)); return (err as (...args: unknown[]) => boolean)(chunk, ...rest); }) as typeof process.stderr.write;
  t.after(() => { process.stdout.write = out; process.stderr.write = err; });
  return () => lines.join('');
}

function everyRow(db: { prepare(sql: string): { all(...args: unknown[]): unknown[] } }): string {
  const tables = (db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[]).map(row => row.name);
  return JSON.stringify(Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all()])));
}

function assertNowhere(rows: string, output: string, responses: string[]) {
  for (const secret of secrets) {
    assert(!rows.includes(secret), `no table holds ${secret.slice(0, 6)}…`);
    assert(!output.includes(secret), `no log line holds ${secret.slice(0, 6)}…`);
    assert(responses.every(text => !text.includes(secret)), `no response holds ${secret.slice(0, 6)}…`);
  }
}

test('an Admin pastes a service account’s token; Ploeg gets it once and Unfold keeps none of it', async t => {
  const output = captureOutput(t);
  const { api, ploeg, cookie } = await live(t);
  const responses: string[] = [];

  const overview = await request(api.url, '/api/onboarding/gitlab', { cookie });
  assert.equal(overview.status, 200, overview.text);
  assert.deepEqual(overview.body.served, { connect: true, register: true });
  assert.equal(overview.body.tokenPage, 'https://gitlab.com/-/user_settings/personal_access_tokens?name=Unfold%20setup&description=Temporary%3A%20Ploeg%20creates%20its%20service%20account%20with%20it%2C%20then%20revokes%20it.&scopes=api');
  const serviceAccount = overview.body.methods.find((entry: { method: string }) => entry.method === 'gitlab_service_account');
  assert.equal(serviceAccount.served, false, 'the pinned Ploeg does not serve the service-account method');
  assert.match(serviceAccount.text, /does not create a GitLab service account from a temporary Owner token yet/);

  const connected = await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'token', token: serviceToken } });
  assert.equal(connected.status, 201, connected.text);
  responses.push(connected.text);
  assert.deepEqual(connected.body.connection, { id: 'gitlab-acme', account: 'unfold-bot', state: 'active', method: 'token', canMint: false });
  assert.deepEqual(connected.body.warnings, []);
  assert.equal(connected.body.serviceAccount, null);
  assert.equal(connected.body.connection.canMint, false);
  const [start, complete] = ploeg.writes();
  assert.deepEqual(start.body, { port: 'forge', kind: 'gitlab', instance: 'gitlab', method: 'token', label: 'Unfold service account' });
  assert.deepEqual(complete.body, { state: flowState, token: serviceToken }, 'the token is relayed once, in a request body');
  assert(ploeg.calls.every(call => secrets.every(secret => !call.url.includes(secret))), 'no token or state travels in a path or query');

  const after = await request(api.url, '/api/onboarding/gitlab', { cookie });
  responses.push(after.text);
  assert.deepEqual(after.body.accounts.map((entry: { connection: string; account: string; state: string }) => [entry.connection, entry.account, entry.state]), [['gitlab-acme', 'unfold-bot', 'active']]);

  const granted = await request(api.url, '/api/onboarding/gitlab/connections/gitlab-acme/repositories', { cookie });
  responses.push(granted.text);
  assert.deepEqual(granted.body.repositories.map((entry: { repository: string; canWrite: boolean }) => [entry.repository, entry.canWrite]), [['acme/web/shop', true], ['acme/docs', false]], 'subgroup paths are kept');

  const dry = await request(api.url, '/api/onboarding/gitlab/targets', { method: 'POST', cookie, body: { connection: 'gitlab-acme', repository: 'acme/web/shop', key: 'acme-shop', dryRun: false } });
  assert.equal(dry.status, 200, dry.text);
  responses.push(dry.text);
  assert.equal(dry.body.outcome, 'refused');
  assert.equal(dry.body.reason, 'capability_missing');
  assert.match(dry.body.message, /cannot give each Run its own GitLab credential through this connection/);
  assert.match(dry.body.message, /Ploeg says: GitLab connections mint no per-Run credential yet\./, 'Ploeg’s own reason is shown');
  assert.deepEqual(dry.body.waitsFor, ploegSteps.gitlab.mint, 'the refusal names what it waits for');
  assert.equal((api.app.store.db.prepare('SELECT count(*) AS n FROM repositories').get() as { n: number }).n, 0, 'nothing is stored');

  const checklist = await request(api.url, '/api/onboarding', { cookie });
  const stage = checklist.body.stages.find((entry: { id: string }) => entry.id === 'connect-github');
  assert.equal(stage.title, 'Connect GitLab');
  assert.equal(stage.status, 'ok');

  const account = api.app.store.db.prepare("SELECT account_id, base_url, provider FROM integration_accounts WHERE role='forge'").get() as { account_id: string; base_url: string; provider: string };
  assert.deepEqual({ ...account }, { account_id: 'gitlab-acme', base_url: 'https://gitlab.com', provider: 'gitlab' });
  const audit = JSON.stringify(api.app.store.db.prepare('SELECT * FROM audit_records').all());
  assert(audit.includes('GitLab connection gitlab-acme'), 'the Integration Account is audited');
  const rows = everyRow(api.app.store.db);
  assert(!rows.includes('forge/gitlab-acme'), 'not even the reference to the token is kept');
  assertNowhere(rows, output(), responses);
});

test('until the pinned Ploeg serves gitlab_service_account, the Owner token is refused with ploeg_step_unavailable and sent nowhere', async t => {
  const output = captureOutput(t);
  const { api, ploeg, cookie } = await live(t);
  const refused = await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'service_account', token: ownerToken, group: 'acme' } });
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error.code, 'ploeg_step_unavailable');
  assert.match(refused.body.error.message, /waits for the release after 0\.2\.0-rc\.130 that includes ploeg-hq\/ploeg#464, not released yet/);
  assert.deepEqual(ploeg.writes(), []);
  assertNowhere(everyRow(api.app.store.db), output(), [refused.text]);
});

test('a method the installation does not allow is refused with method_not_allowed, and the page says so next time', async t => {
  const output = captureOutput(t);
  const { api, ploeg, cookie } = await live(t, { refuseMethod: 'token' });
  const refused = await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'token', token: serviceToken } });
  assert.equal(refused.status, 409, refused.text);
  assert.equal(refused.body.error.code, 'method_not_allowed');
  assert.match(refused.body.error.message, /connections\.allow does not list token/);
  assert(!ploeg.calls.some(call => call.url.endsWith('/complete')), 'the token never left Unfold');
  const overview = await request(api.url, '/api/onboarding/gitlab', { cookie });
  const token = overview.body.methods.find((entry: { method: string }) => entry.method === 'token');
  assert.equal(token.refused.code, 'method_not_allowed');
  assert.equal(token.refused.instance, 'gitlab');
  assertNowhere(everyRow(api.app.store.db), output(), [refused.text, overview.text]);
});

test('a refusal Ploeg words with the pasted token is answered without it', async t => {
  const output = captureOutput(t);
  const { api, cookie } = await live(t, { refuseComplete: 'weird_failure' });
  const refused = await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'token', token: serviceToken } });
  assert.equal(refused.status, 409, refused.text);
  assert.equal(refused.body.error.code, 'gitlab_flow_refused');
  assert.match(refused.body.error.message, /\[redacted\]/);
  assertNowhere(everyRow(api.app.store.db), output(), [refused.text]);
});

test('a token of the wrong shape, someone who is not an Admin and an installation on another forge are refused before anything is sent', async t => {
  const { api, ploeg, cookie } = await live(t, { otherForge: true });
  const short = await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'token', token: 'short' } });
  assert.equal(short.status, 400);
  assert.equal(short.body.error.code, 'connection_token_invalid');
  const badGroup = await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'service_account', token: ownerToken, group: '../etc' } });
  assert.equal(badGroup.body.error.code, 'invalid_input');
  const second = await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'token', token: serviceToken } });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'second_forge_unsupported');
  api.app.store.addUser({ id: 'dev', name: 'dev', role: 'operator', passwordHash: hashPassword('dev-password-271828') });
  const { cookie: developer } = await login(api.url, 'dev', 'dev-password-271828');
  const forbidden = await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie: developer, body: { method: 'token', token: serviceToken } });
  assert.equal(forbidden.status, 403);
  const target = await request(api.url, '/api/onboarding/gitlab/targets', { method: 'POST', cookie: developer, body: { connection: 'gitlab-acme', repository: 'acme/web/shop', key: 'acme-shop' } });
  assert.equal(target.status, 403);
  assert.deepEqual(ploeg.writes(), []);
});

test('until Ploeg serves the connection routes, Connect GitLab is refused with ploeg_step_unavailable', async t => {
  const { api, ploeg, cookie } = await live(t, { served: false });
  const overview = await request(api.url, '/api/onboarding/gitlab', { cookie });
  assert.deepEqual(overview.body.served, { connect: false, register: false });
  const refused = await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'token', token: serviceToken } });
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error.code, 'ploeg_step_unavailable');
  assert.deepEqual(ploeg.writes(), []);
});

test('a Ploeg that mints GitLab credentials registers the project under its GitLab address', async t => {
  const { api, cookie } = await live(t, { mints: true });
  assert.equal((await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'token', token: serviceToken } })).status, 201);
  const registered = await request(api.url, '/api/onboarding/gitlab/targets', { method: 'POST', cookie, body: { connection: 'gitlab-acme', repository: 'acme/web/shop', key: 'acme-shop', dryRun: false } });
  assert.equal(registered.status, 201, registered.text);
  assert.equal(registered.body.repository.key, 'gitlab.com/acme/web/shop');
  assert.equal(registered.body.repository.ploeg.target, 'acme-shop');
});

test('with a Ploeg that serves gitlab_service_account, the Owner token and group go to Ploeg once and its warning is shown', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-gitlab-'));
  const store = new Store(join(directory, 'gitlab.sqlite'));
  ensureIntegrationSchema(store.db, '2026-11-19T10:00:00.000Z');
  t.after(async () => { try { store.close(); } catch {} await rm(directory, { recursive: true, force: true }); });
  const sent: { path: string; body: unknown }[] = [];
  const facts: unknown[] = [];
  const gitlab = new GitlabConnections({
    db: store.db, store,
    ploeg: {
      isDemo: false,
      connections: async () => ({ demo: false, supported: true, checkedAt: null, eventWindowDays: 30, repositories: [], boards: [], unrouted: [], fetchedAt: '' }),
      operatorCall: async (_user, path, options) => {
        sent.push({ path, body: options?.body });
        if (path === 'connection-flows') return { flow: { id: 'flow-1', method: 'gitlab_service_account', expiresAt: '2026-11-19T10:15:00Z', state: flowState }, next: {} };
        if (path === 'connection-flows/complete') return { connection: { id: 'gitlab-acme', kind: 'gitlab', instance: 'gitlab', method: 'gitlab_service_account', account: { login: 'service_account_group_42' }, source: 'runtime', state: 'active', canMint: true }, serviceAccount: { username: 'service_account_group_42', group: 'acme', topGroup: 'acme', created: true, tokenExpiresAt: '2027-11-19T00:00:00Z' }, warnings: [{ code: 'owner_token_not_revoked', message: `Ploeg could not revoke ${ownerToken}; revoke it in GitLab.` }], replayed: false };
        throw new PloegOperatorRefusal(404, 'not_found', 'not found', {});
      },
    },
    steps: { manages: () => true, admit: async () => undefined, available: async () => ({ served: true }), notOptedIn: () => undefined },
    repositories: { admitRegistration: () => undefined, register: () => { throw new Error('unused'); }, repositories: () => [] },
    stored: async () => true, audit: (_user, fact) => { facts.push(fact); }, pinned: '0.2.0-rc.130', plan: ploegSteps, gitlabUrl: 'https://gitlab.example.com/',
  });
  const admin = { id: 'admin-1', name: 'Admin', role: 'admin' as const };
  const done = await gitlab.connect(admin, { method: 'service_account', token: ownerToken, group: '/acme/' });
  assert.deepEqual(sent.map(entry => entry.path), ['connection-flows', 'connection-flows/complete']);
  assert.deepEqual(sent[0].body, { port: 'forge', kind: 'gitlab', instance: 'gitlab', method: 'gitlab_service_account', label: 'Unfold service account for acme' });
  assert.deepEqual(sent[1].body, { state: flowState, token: ownerToken, group: 'acme' });
  assert.equal(done.connection.method, 'gitlab_service_account');
  assert.deepEqual(done.warnings, [{ code: 'owner_token_not_revoked', message: 'Ploeg could not revoke [redacted]; revoke it in GitLab.' }]);
  assert.deepEqual(done.serviceAccount, { username: 'service_account_group_42', group: 'acme', topGroup: 'acme', created: true, tokenExpiresAt: '2027-11-19T00:00:00Z' });
  assert.equal(done.connection.canMint, true);
  assert.match(JSON.stringify(facts), /"serviceAccount":"service_account_group_42"/);
  assert(!JSON.stringify(facts).includes(ownerToken), 'the audit fact carries no token');
  assert.match(JSON.stringify(facts), /"group":"acme"/);
  assert(!everyRow(store.db).includes(ownerToken));
  assert.equal(tokenPage('https://gitlab.example.com/').split('?')[0], 'https://gitlab.example.com/-/user_settings/personal_access_tokens');
});

test('a GitLab project refused for its webhook or the account’s role is shown with the fix', async t => {
  for (const [code, words] of [['webhook_base_missing', /PLOEG_PUBLIC_WEBHOOK_BASE/], ['webhook_failed', /refused the project webhook/], ['grant_insufficient', /needs the Maintainer role/]] as const) {
    const { api, cookie } = await live(t, { refuseTarget: code });
    assert.equal((await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'token', token: serviceToken } })).status, 201);
    const dry = await request(api.url, '/api/onboarding/gitlab/targets', { method: 'POST', cookie, body: { connection: 'gitlab-acme', repository: 'acme/web/shop', key: 'acme-shop' } });
    assert.equal(dry.body.outcome, 'refused');
    assert.equal(dry.body.reason, code);
    assert.match(dry.body.message, words);
    assert.equal(dry.body.waitsFor, undefined);
  }
});

test('removing a GitLab connection shows what Ploeg left at GitLab and forgets the Integration Account', async t => {
  const { api, ploeg, cookie } = await live(t);
  assert.equal((await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'token', token: serviceToken } })).status, 201);
  const removed = await request(api.url, '/api/onboarding/gitlab/connections/gitlab-acme', { method: 'DELETE', cookie });
  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(removed.body, { removed: 'gitlab-acme', leftAtVendor: [{ kind: 'service_account', id: 'unfold-bot', url: 'https://gitlab.com/groups/acme/-/settings/service_accounts' }] });
  assert.equal(ploeg.calls.filter(call => call.method === 'DELETE').length, 1);
  assert.equal((api.app.store.db.prepare("SELECT count(*) AS n FROM integration_accounts WHERE role='forge'").get() as { n: number }).n, 0);
  assert.match(JSON.stringify(api.app.store.db.prepare('SELECT * FROM audit_records').all()), /delete/i);
});

test('a GitLab connection a registered repository still uses is not removed', async t => {
  const { api, cookie } = await live(t, { inUse: true });
  assert.equal((await request(api.url, '/api/onboarding/gitlab/connections', { method: 'POST', cookie, body: { method: 'token', token: serviceToken } })).status, 201);
  const refused = await request(api.url, '/api/onboarding/gitlab/connections/gitlab-acme', { method: 'DELETE', cookie });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'connection_in_use');
  assert.equal((api.app.store.db.prepare("SELECT count(*) AS n FROM integration_accounts WHERE role='forge'").get() as { n: number }).n, 1);
});

test('every code Connect GitLab answers with is in the error catalogue', () => {
  for (const { code, status } of gitlabRefusalTable) {
    assert(Object.hasOwn(errorCatalogue, code), `${code} is in the catalogue`);
    assert(errorCatalogue[code].status.includes(status), `${code} lists ${status}`);
  }
});

test('listing a connection’s repositories asks Ploeg with the slow timeout, because a group-wide grant pages through many projects', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-gitlab-'));
  const store = new Store(join(directory, 'gitlab.sqlite'));
  ensureIntegrationSchema(store.db, '2026-11-20T10:00:00.000Z');
  t.after(async () => { try { store.close(); } catch {} await rm(directory, { recursive: true, force: true }); });
  const calls: { path: string; slow: boolean | undefined; method: string | undefined }[] = [];
  const gitlab = new GitlabConnections({
    db: store.db, store,
    ploeg: {
      isDemo: false,
      connections: async () => ({ demo: false, supported: true, checkedAt: null, eventWindowDays: 30, repositories: [], boards: [], unrouted: [], fetchedAt: '' }),
      operatorCall: async (_user, path, options) => {
        calls.push({ path, slow: options?.slow, method: options?.method });
        if (path.startsWith('forge-connections/gitlab-acme/repositories')) return { repositories: [{ id: '5', fullName: 'acme/web/shop', private: true, canWrite: true, registered: false, key: null }], nextCursor: null };
        throw new PloegOperatorRefusal(404, 'not_found', 'not found', {});
      },
    },
    steps: { manages: () => true, admit: async () => undefined, available: async () => ({ served: true }), notOptedIn: () => undefined },
    repositories: { admitRegistration: () => undefined, register: () => { throw new Error('unused'); }, repositories: () => [] },
    stored: async () => true, audit: () => undefined, pinned: '0.2.0-rc.130', plan: ploegSteps, gitlabUrl: 'https://gitlab.example.com/',
  });
  const listed = await gitlab.granted({ id: 'admin-1', name: 'Admin', role: 'admin' as const }, 'gitlab-acme');
  assert.deepEqual(listed.repositories.map(entry => entry.repository), ['acme/web/shop']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].slow, true, 'the listing gets the 45 second timeout, not the default 5');
  assert.equal(calls[0].method, undefined, 'the listing stays a GET');
});
