import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/auth.ts';
import { githubRefusalTable } from '../src/forge-connections.ts';
import { errorCatalogue } from '../src/error-catalogue.ts';
import { application, login, request } from './api-support.ts';

const manifestCode = `mc${randomBytes(12).toString('hex')}`;
const installationId = '918273645546372819';
const firstState = `st1${randomBytes(16).toString('hex')}`;
const secondState = `st2${randomBytes(16).toString('hex')}`;
const appKey = `app-key-${randomBytes(12).toString('hex')}`;
const secrets = [manifestCode, installationId, firstState, secondState, appKey];

type Call = { method: string; url: string; body: Record<string, unknown> };
type FakeOptions = { served?: boolean; otherForge?: boolean; refuseFlow?: string; refuseTarget?: string; failCompleteOnce?: boolean; completeDelayMs?: number; connectionsFail?: boolean; refuseRead?: string; connectionState?: string };

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
    const refuse = (status: number, code: string, extra: object = {}) => send(status, { error: { code, message: `refused: ${code}`, ...extra } });
    if (req.method === 'GET' && path === 'teams') return send(200, { teams: [{ id: 'bronze', paused: false, queueDepth: 0, roles: [], assignees: [], pinnedScopes: [] }] });
    if (req.method === 'GET' && path === 'connections' && options.connectionsFail) return res.writeHead(500).end();
    if (req.method === 'GET' && path === 'forge-connections' && options.refuseRead) return refuse(403, options.refuseRead);
    if (req.method === 'GET' && path === 'connections') return send(200, { checkedAt: null, eventWindowDays: 30, boards: [], repositories: options.otherForge ? [{ key: 'site', label: 'site', forge: 'forgejo', owner: 'acme', repo: 'site', baseBranch: 'main', readiness: 'ready', reason: '', lastForgeEventAt: null, boards: [] }] : [] });
    if (options.served === false && (path === 'forge-connections' || path === 'targets')) return res.writeHead(404).end();
    if (req.method === 'GET' && path === 'forge-connections') return send(200, { connections: calls.some(call => call.body.installationId) ? [{ id: 'github-acme', kind: 'github', instance: 'github', method: 'github_app_installation', source: 'runtime', state: options.connectionState ?? 'active', invalidReason: null, account: { id: 4242, login: 'acme', installationId: Number(installationId) } }] : [] });
    if (req.method === 'GET' && path === 'targets') return send(200, { targets: [] });
    if (req.method === 'GET' && path === 'connection-apps') return send(200, { apps: calls.some(call => call.body.code) ? [{ id: 'app-1', slug: 'ploeg-acme', owner: 'acme' }] : [] });
    if (req.method === 'POST' && path === 'connection-flows') {
      if (options.refuseFlow) return refuse(422, options.refuseFlow);
      const manifest = body.method === 'github_app_manifest';
      return send(201, { flow: { id: manifest ? 'flow-1' : 'flow-2', method: body.method, expiresAt: '2026-11-18T12:15:00Z', state: manifest ? firstState : secondState }, next: manifest ? { manifest: { name: 'Ploeg acme', url: 'https://ploeg.example', redirect_url: body.redirectUri, setup_url: body.redirectUri, public: false }, postUrl: `https://github.com/settings/apps/new?state=${firstState}` } : { installUrl: `https://github.com/apps/ploeg-acme/installations/new?state=${secondState}` } });
    }
    if (req.method === 'POST' && path === 'connection-flows/complete') {
      if (options.failCompleteOnce && body.installationId && calls.filter(call => call.body.installationId).length === 1) return res.writeHead(503).end();
      if (options.completeDelayMs && body.installationId) await new Promise(resolve => setTimeout(resolve, options.completeDelayMs));
      if (body.code === manifestCode && body.state === firstState) return send(200, { app: { id: 'app-1', slug: 'ploeg-acme', privateKey: { store: 'kv', path: 'apps/app-1', version: 1 } }, flow: { id: 'flow-2', method: 'github_app_installation', state: secondState }, next: { installUrl: `https://github.com/apps/ploeg-acme/installations/new?state=${secondState}` } });
      if (body.installationId === installationId && body.state === secondState) return send(200, { connection: { id: 'github-acme', kind: 'github', instance: 'github', method: 'github_app_installation', source: 'runtime', state: 'active', account: { id: 4242, login: 'acme', installationId: Number(installationId) } } });
      return refuse(404, 'unknown_flow');
    }
    if (req.method === 'GET' && path === 'forge-connections/github-acme/repositories') return send(200, { repositories: [{ repository: 'acme/shop', registered: false, key: null }, { repository: 'acme/site', registered: true, key: 'site', source: 'static' }] });
    if (req.method === 'POST' && path === 'targets') {
      if (options.refuseTarget) return refuse(422, options.refuseTarget, { checks: [{ check: 'not_archived', passed: false, message: 'The repository is archived.' }] });
      const target = { key: body.key, repository: body.repository, branch: 'main', state: url.searchParams.get('dryRun') ? 'not_registered' : 'active', readiness: { state: 'not_ready', reasons: [{ code: 'instruction_file_missing' }], prepareAvailable: true } };
      return send(url.searchParams.get('dryRun') ? 200 : 201, { target, checks: [{ check: 'granted', passed: true }, { check: 'agents_md', passed: false, message: 'No AGENTS.md on main.' }] });
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
  const env = `UNFOLD_CONNECT_GITHUB_${randomBytes(6).toString('hex').toUpperCase()}`;
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

const navigate = (url: string, path: string, cookie: string) => fetch(`${url}${path}`, { headers: { cookie }, redirect: 'manual' });

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

test('an Admin creates the App, installs it and registers a repository; Ploeg gets every code and Unfold keeps none', async t => {
  const output = captureOutput(t);
  const { api, ploeg, cookie } = await live(t);
  const responses: string[] = [];

  const overview = await request(api.url, '/api/onboarding/github', { cookie });
  assert.equal(overview.status, 200, overview.text);
  assert.deepEqual(overview.body.served, { connect: true, register: true });
  assert.equal(overview.body.callbackUrl, 'http://127.0.0.1/api/onboarding/github/callback');

  const started = await request(api.url, '/api/onboarding/github/flows', { method: 'POST', cookie, body: { method: 'manifest', owner: 'acme' } });
  assert.equal(started.status, 201, started.text);
  responses.push(started.text);
  assert.equal(started.body.flow.method, 'github_app_manifest');
  const start = ploeg.writes()[0];
  assert.deepEqual(start.body, { port: 'forge', kind: 'github', instance: 'github', method: 'github_app_manifest', redirectUri: 'http://127.0.0.1/api/onboarding/github/callback', owner: 'acme' });

  const page = await navigate(api.url, started.body.continue, cookie);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy')!, /form-action https:\/\/github\.com$/);
  const html = await page.text();
  assert.match(html, /action="https:\/\/github\.com\/settings\/apps\/new\?state=/);
  assert.match(html, /name="manifest" value="\{&quot;name&quot;:&quot;Ploeg acme&quot;/);
  assert.equal((await navigate(api.url, started.body.continue, cookie)).status, 404, 'the step to GitHub is used once');

  const created = await navigate(api.url, `/api/onboarding/github/callback?code=${manifestCode}&state=${firstState}`, cookie);
  assert.equal(created.status, 303);
  assert.equal(created.headers.get('location'), `https://github.com/apps/ploeg-acme/installations/new?state=${secondState}`, 'after the App is created the person goes straight on to install it');
  assert.equal(created.headers.get('referrer-policy'), 'no-referrer');

  const installed = await navigate(api.url, `/api/onboarding/github/callback?installation_id=${installationId}&setup_action=install&state=${secondState}`, cookie);
  assert.equal(installed.status, 303);
  assert.equal(installed.headers.get('location'), '/?github=connected#settings/connections/github');

  const completes = ploeg.writes().filter(call => call.url.startsWith('/api/v1/operator/connection-flows/complete'));
  assert.deepEqual(completes.map(call => call.body), [{ state: firstState, code: manifestCode }, { state: secondState, installationId, setupAction: 'install' }], 'each code is relayed once, in a request body');
  assert(ploeg.calls.every(call => secrets.every(secret => !call.url.includes(secret))), 'no code, state or installation id travels in a path or query to Ploeg');

  const after = await request(api.url, '/api/onboarding/github', { cookie });
  responses.push(after.text);
  assert.deepEqual(after.body.accounts.map((entry: { connection: string; account: string; state: string }) => [entry.connection, entry.account, entry.state]), [['github-acme', 'acme', 'active']]);
  assert.deepEqual(after.body.apps, [{ id: 'app-1', slug: 'ploeg-acme', owner: 'acme' }]);

  const granted = await request(api.url, '/api/onboarding/github/connections/github-acme/repositories', { cookie });
  responses.push(granted.text);
  assert.deepEqual(granted.body.repositories.map((entry: { repository: string; registered: boolean }) => [entry.repository, entry.registered]), [['acme/shop', false], ['acme/site', true]]);

  const upper = await request(api.url, '/api/onboarding/github/targets', { method: 'POST', cookie, body: { connection: 'github-acme', repository: 'acme/shop', key: 'Acme-Shop' } });
  assert.equal(upper.status, 400, 'the key is explicit and lower case');
  const dry = await request(api.url, '/api/onboarding/github/targets', { method: 'POST', cookie, body: { connection: 'github-acme', repository: 'acme/shop', key: 'acme-shop' } });
  assert.equal(dry.status, 200, dry.text);
  responses.push(dry.text);
  assert.equal(dry.body.outcome, 'accepted');
  assert.equal(dry.body.prepareAvailable, true);
  assert.deepEqual(dry.body.checks.map((check: { name: string; passed: boolean }) => [check.name, check.passed]), [['granted', true], ['agents_md', false]]);
  assert.equal(ploeg.writes().filter(call => call.url.startsWith('/api/v1/operator/targets')).length, 1, 'a dry run sends only the dry run');

  const registered = await request(api.url, '/api/onboarding/github/targets', { method: 'POST', cookie, body: { connection: 'github-acme', repository: 'acme/shop', key: 'acme-shop', dryRun: false } });
  assert.equal(registered.status, 201, registered.text);
  responses.push(registered.text);
  assert.deepEqual(ploeg.writes().filter(call => call.url.startsWith('/api/v1/operator/targets')).map(call => call.url), ['/api/v1/operator/targets?dryRun=true', '/api/v1/operator/targets?dryRun=true', '/api/v1/operator/targets'], 'registration runs the dry run first');
  assert.equal(registered.body.repository.key, 'github.com/acme/shop');
  assert.equal(registered.body.repository.ploeg.target, 'acme-shop');
  assert.equal(registered.body.repository.ploeg.prepareAvailable, true);
  assert.equal(registered.body.repository.state, 'active', 'a repository Ploeg registered is in use although the configuration names no GitHub host');
  assert.deepEqual(registered.body.repository.grants.map((grant: { name: string }) => grant.name), ['Own work']);

  const checklist = await request(api.url, '/api/onboarding', { cookie });
  const stage = (id: string) => checklist.body.stages.find((entry: { id: string }) => entry.id === id);
  assert.equal(stage('connect-github').status, 'ok');
  assert.equal(stage('register-repositories').status, 'ok');
  assert.match(stage('register-repositories').text, /acme\/shop/);

  const rows = everyRow(api.app.store.db);
  for (const secret of secrets) {
    assert(!rows.includes(secret), `no table holds ${secret.slice(0, 6)}…`);
    assert(!output().includes(secret), `no log line holds ${secret.slice(0, 6)}…`);
    assert(responses.every(text => !text.includes(secret)), `no response holds ${secret.slice(0, 6)}…`);
  }
  assert(!rows.includes('apps/app-1'), 'not even the reference to the App key is kept');
  const account = api.app.store.db.prepare("SELECT account_id, body FROM integration_accounts WHERE role='forge'").get() as { account_id: string; body: string };
  assert.equal(account.account_id, 'github-acme', 'the Integration Account is keyed with the Ploeg connection id');
  const audit = api.app.store.db.prepare("SELECT * FROM audit_records").all();
  assert(JSON.stringify(audit).includes('Integration Account'), 'the Integration Account is audited');
});

test('a callback Unfold did not tie to this sign-in, or one already used, answers 400 and relays nothing', async t => {
  const { api, ploeg, cookie } = await live(t);
  const started = await request(api.url, '/api/onboarding/github/flows', { method: 'POST', cookie, body: {} });
  assert.equal(started.status, 201, started.text);
  const { cookie: other } = await login(api.url);
  const forged = await navigate(api.url, `/api/onboarding/github/callback?code=${manifestCode}&state=${firstState}`, other);
  assert.equal(forged.status, 400, 'another sign-in of the same person cannot use the state');
  assert.match(await forged.text(), /onboarding_state_invalid/);
  const unknown = await navigate(api.url, `/api/onboarding/github/callback?code=${manifestCode}&state=nope`, cookie);
  assert.equal(unknown.status, 400);
  const signedOut = await fetch(`${api.url}/api/onboarding/github/callback?code=${manifestCode}&state=${firstState}`, { redirect: 'manual' });
  assert.equal(signedOut.status, 400);
  assert(!ploeg.calls.some(call => call.url.includes('complete')), 'nothing was relayed');

  const again = await request(api.url, '/api/onboarding/github/flows', { method: 'POST', cookie, body: {} });
  assert.equal(again.status, 201);
  assert.equal((await navigate(api.url, `/api/onboarding/github/callback?code=${manifestCode}&state=${firstState}`, cookie)).status, 303);
  assert.equal((await navigate(api.url, `/api/onboarding/github/callback?code=${manifestCode}&state=${firstState}`, cookie)).status, 400, 'a state is accepted once');
  assert.equal(ploeg.calls.filter(call => call.url.includes('complete')).length, 1);
});

test('until Ploeg serves the connection routes, Connect GitHub is refused with ploeg_step_unavailable and nothing is written', async t => {
  const { api, ploeg, cookie } = await live(t, { served: false });
  const overview = await request(api.url, '/api/onboarding/github', { cookie });
  assert.deepEqual(overview.body.served, { connect: false, register: false });
  const started = await request(api.url, '/api/onboarding/github/flows', { method: 'POST', cookie, body: {} });
  assert.equal(started.status, 503);
  assert.equal(started.body.error.code, 'ploeg_step_unavailable');
  const registered = await request(api.url, '/api/onboarding/github/targets', { method: 'POST', cookie, body: { connection: 'github-acme', repository: 'acme/shop', key: 'acme-shop' } });
  assert.equal(registered.body.error.code, 'ploeg_step_unavailable');
  assert.deepEqual(ploeg.writes(), []);
  const checklist = await request(api.url, '/api/onboarding', { cookie });
  assert.equal(checklist.body.stages.find((entry: { id: string }) => entry.id === 'connect-github').reason, 'ploeg_step_unavailable');
});

test('an installation that already pushes to another forge waits for Ploeg ADR-0192 and sends no connection request', async t => {
  const { api, ploeg, cookie } = await live(t, { otherForge: true });
  const overview = await request(api.url, '/api/onboarding/github', { cookie });
  assert.deepEqual(overview.body.secondForge.forges, ['forgejo']);
  const started = await request(api.url, '/api/onboarding/github/flows', { method: 'POST', cookie, body: {} });
  assert.equal(started.status, 409);
  assert.equal(started.body.error.code, 'second_forge_unsupported');
  assert.deepEqual(ploeg.writes(), []);
  const checklist = await request(api.url, '/api/onboarding', { cookie });
  const line = checklist.body.stages.find((entry: { id: string }) => entry.id === 'connect-github');
  assert.equal(line.reason, 'second_forge_unsupported');
  assert.equal(line.waitsFor.record, 'Ploeg ADR-0192');
});

test('an installation that has not opted in turns its install line red, and a refused registration stores nothing', async t => {
  const { api, cookie } = await live(t, { refuseFlow: 'connections_not_accepted', refuseTarget: 'target_not_ready' });
  const started = await request(api.url, '/api/onboarding/github/flows', { method: 'POST', cookie, body: {} });
  assert.equal(started.status, 422);
  assert.equal(started.body.error.code, 'connections_not_accepted');
  assert.match(started.body.error.message, /connections\.enabled/);
  const checklist = await request(api.url, '/api/onboarding', { cookie });
  const install = checklist.body.stages.flatMap((entry: { checks?: unknown[] }) => [entry, ...(entry.checks ?? [])]).find((entry: { id: string }) => entry.id === 'install-connections');
  assert.equal(install.status, 'problem');
  const dry = await request(api.url, '/api/onboarding/github/targets', { method: 'POST', cookie, body: { connection: 'github-acme', repository: 'acme/shop', key: 'acme-shop', dryRun: false } });
  assert.equal(dry.status, 200, 'a refused dry run answers its checks and registers nothing');
  assert.equal(dry.body.outcome, 'refused');
  assert.equal(dry.body.reason, 'target_not_ready');
  assert.deepEqual(dry.body.checks, [{ name: 'not_archived', passed: false, text: 'The repository is archived.' }]);
  assert.equal(dry.body.prepareAvailable, false);
  assert.equal((api.app.store.db.prepare('SELECT count(*) AS n FROM repositories').get() as { n: number }).n, 0);
});

test('only an Admin connects GitHub or registers a repository', async t => {
  const { api, ploeg } = await live(t);
  api.app.store.addUser({ id: 'dev', name: 'dev', role: 'operator', passwordHash: hashPassword('dev-password-271828') });
  const { cookie } = await login(api.url, 'dev', 'dev-password-271828');
  const started = await request(api.url, '/api/onboarding/github/flows', { method: 'POST', cookie, body: {} });
  assert.equal(started.status, 403);
  const registered = await request(api.url, '/api/onboarding/github/targets', { method: 'POST', cookie, body: { connection: 'github-acme', repository: 'acme/shop', key: 'acme-shop' } });
  assert.equal(registered.status, 403);
  assert.deepEqual(ploeg.writes(), []);
});

test('every code Connect GitHub answers with is in the error catalogue', () => {
  for (const { code, status } of githubRefusalTable) {
    assert(Object.hasOwn(errorCatalogue, code), `${code} is in the catalogue`);
    assert(errorCatalogue[code].status.includes(status), `${code} lists ${status}`);
  }
});

async function connect(api: { url: string }, cookie: string) {
  const started = await request(api.url, '/api/onboarding/github/flows', { method: 'POST', cookie, body: {} });
  assert.equal(started.status, 201, started.text);
  assert.equal((await navigate(api.url, `/api/onboarding/github/callback?code=${manifestCode}&state=${firstState}`, cookie)).status, 303);
  return navigate(api.url, `/api/onboarding/github/callback?installation_id=${installationId}&setup_action=install&state=${secondState}`, cookie);
}

test('a completion Ploeg could not answer keeps the state, so reloading the callback gets Ploeg’s answer', async t => {
  const { api, ploeg, cookie } = await live(t, { failCompleteOnce: true });
  const first = await connect(api, cookie);
  assert.equal(first.status, 303);
  assert.match(first.headers.get('location')!, /github_error=/);
  const again = await navigate(api.url, `/api/onboarding/github/callback?installation_id=${installationId}&setup_action=install&state=${secondState}`, cookie);
  assert.equal(again.headers.get('location'), '/?github=connected#settings/connections/github');
  assert.equal(ploeg.calls.filter(call => call.body.installationId).length, 2, 'the retry reached Ploeg, which answers a repeat with replayed');
  assert.equal((await navigate(api.url, `/api/onboarding/github/callback?installation_id=${installationId}&setup_action=install&state=${secondState}`, cookie)).status, 400, 'after Ploeg completed it the state is used up');
});

test('a completion that takes Ploeg longer than five seconds still completes', { timeout: 30_000 }, async t => {
  const { api, cookie } = await live(t, { completeDelayMs: 5_500 });
  const done = await connect(api, cookie);
  assert.equal(done.headers.get('location'), '/?github=connected#settings/connections/github');
});

test('a repository the Tenant already has is refused before Ploeg is asked to check or register it', async t => {
  const { api, ploeg, cookie } = await live(t);
  await connect(api, cookie);
  const body = { connection: 'github-acme', repository: 'acme/shop', key: 'acme-shop', dryRun: false };
  assert.equal((await request(api.url, '/api/onboarding/github/targets', { method: 'POST', cookie, body })).status, 201);
  const before = ploeg.writes().length;
  const again = await request(api.url, '/api/onboarding/github/targets', { method: 'POST', cookie, body: { ...body, key: 'acme-shop-2' } });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'repository_exists');
  const dry = await request(api.url, '/api/onboarding/github/targets', { method: 'POST', cookie, body: { ...body, dryRun: true } });
  assert.equal(dry.status, 409);
  assert.equal(ploeg.writes().length, before, 'Ploeg was asked nothing');
});

test('when Ploeg’s connections read fails, Unfold cannot rule out a second forge and starts no connection', async t => {
  const { api, ploeg, cookie } = await live(t, { connectionsFail: true });
  const started = await request(api.url, '/api/onboarding/github/flows', { method: 'POST', cookie, body: {} });
  assert.equal(started.status, 503);
  assert.equal(started.body.error.code, 'ploeg_unavailable');
  assert.deepEqual(ploeg.writes(), []);
  const overview = await request(api.url, '/api/onboarding/github', { cookie });
  assert.equal(overview.body.secondForge.unread, true);
});

test('a refused forge connections read shows what to set instead of failing the page', async t => {
  const { api, cookie } = await live(t, { refuseRead: 'permission_required' });
  const overview = await request(api.url, '/api/onboarding/github', { cookie });
  assert.equal(overview.status, 200, overview.text);
  assert.equal(overview.body.refused.code, 'permission_required');
  assert.match(overview.body.refused.install, /registerTargets/);
});

test('reading the page shows Ploeg’s live connection state and writes nothing', async t => {
  const options: FakeOptions = {};
  const { api, cookie } = await live(t, options);
  await connect(api, cookie);
  const rows = () => everyRow(api.app.store.db).replace(/"last_seen_at":"[^"]*"|"expires_at":"[^"]*"/g, '');
  const before = rows();
  options.connectionState = 'invalid';
  const overview = await request(api.url, '/api/onboarding/github', { cookie });
  assert.equal(overview.body.accounts[0].state, 'invalid');
  assert.equal(JSON.parse((api.app.store.db.prepare("SELECT body FROM integration_accounts WHERE role='forge'").get() as { body: string }).body).state, 'active', 'the stored account is unchanged');
  assert.equal(rows(), before, 'no row changed');
});

test('the step to GitHub is only for the sign-in that started it', async t => {
  const { api, cookie } = await live(t);
  const started = await request(api.url, '/api/onboarding/github/flows', { method: 'POST', cookie, body: {} });
  const { cookie: other } = await login(api.url);
  assert.equal((await navigate(api.url, started.body.continue, other)).status, 404);
  assert.equal((await navigate(api.url, started.body.continue, cookie)).status, 200, 'the one-time step is still there for the right sign-in');
});

test('a state tied to one person is refused for another person, even with the same sign-in id', async () => {
  const secrets = new Map<string, unknown>();
  const completes: string[] = [];
  const { GithubConnections } = await import('../src/forge-connections.ts');
  const { ploegSteps } = await import('../src/onboarding.ts');
  const github = new GithubConnections({
    db: { prepare: () => ({ all: () => [], get: () => undefined, run: () => ({}) }) } as never,
    store: { getSecret: <T>(id: string) => secrets.get(id) as T, setSecret: (id: string, value: unknown) => { secrets.set(id, value); } },
    ploeg: { isDemo: false, connections: async () => ({ demo: false, supported: true, checkedAt: null, eventWindowDays: 30, repositories: [], boards: [], unrouted: [], fetchedAt: '' }), operatorCall: async (_user, path) => { if (path.includes('complete')) completes.push(path); return { flow: { id: 'flow-1', state: firstState }, next: { manifest: '{}', postUrl: 'https://github.com/settings/apps/new' } }; } },
    steps: { manages: () => true, admit: async () => undefined, available: async () => ({ served: true }), notOptedIn: () => undefined },
    repositories: { admitRegistration: () => undefined, register: () => { throw new Error('unused'); }, repositories: () => [] },
    stored: async () => true, audit: () => undefined, baseUrl: 'https://unfold.example', pinned: 'unknown', plan: ploegSteps,
  });
  const owner = { id: 'admin-1', name: 'One', role: 'admin' as const };
  const intruder = { id: 'admin-2', name: 'Two', role: 'admin' as const };
  const started = await github.start(owner, 'sign-in-1', {});
  const handoff = started.continue.split('/').at(-1)!;
  assert.equal(github.continue(intruder, 'sign-in-1', handoff).status, 404);
  const answer = await github.callback(intruder, 'sign-in-1', new URLSearchParams({ code: manifestCode, state: firstState }));
  assert.equal(answer.status, 400);
  assert.deepEqual(completes, []);
});
