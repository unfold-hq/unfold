import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askAgainAfterMs, configuration, deviceFlow, fileStore, keychainService, keychainStore, mayAsk, readState, redacted, stateFile, telemetryStore } from '../extensions/claude-code/scripts/otel-headers.mjs';
import { idpTokenCommand } from '../extensions/claude-code/scripts/sign-in.mjs';

const helper = fileURLToPath(new URL('../extensions/claude-code/scripts/otel-headers.mjs', import.meta.url));
const hook = fileURLToPath(new URL('../extensions/claude-code/scripts/unfold-hook.mjs', import.meta.url));
const clientId = 'claude-code-telemetry';

function jwt(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256', kid: 'test' })}.${part(claims)}.c2lnbmF0dXJl`;
}

async function scratch(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'unfold-telemetry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

type Issuer = { url: string; requests: { path: string; form: Record<string, string> }[]; decision: 'approve' | 'deny'; pendingPolls: number; slowDownPolls: number; access: string[]; refresh: string[]; exchanged: string; close: () => Promise<void> };

async function fakeIssuer(): Promise<Issuer> {
  const issuer = {} as Issuer;
  issuer.requests = [];
  issuer.decision = 'approve';
  issuer.pendingPolls = 1;
  issuer.slowDownPolls = 0;
  let polls = 0;
  let issued = 0;
  const now = () => Math.floor(Date.now() / 1000);
  const tokens = () => {
    issued += 1;
    const access = jwt({ iss: issuer.url, sub: 'ada', aud: clientId, iat: now(), exp: now() + 3600, n: issued });
    const refreshToken = `refresh-${issued}-${'r'.repeat(30)}`;
    issuer.access.push(access);
    issuer.refresh.push(refreshToken);
    return { access_token: access, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600, scope: 'openid offline_access', id_token: jwt({ iss: issuer.url, sub: 'ada', aud: clientId, email: 'ada@example.org', email_verified: true }) };
  };
  issuer.access = [];
  issuer.refresh = [];
  issuer.exchanged = jwt({ iss: 'issuer', sub: 'ada', aud: 'unfold', iat: now(), exp: now() + 300 });
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
      issuer.requests.push({ path: String(req.url), form });
      const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.url === '/.well-known/openid-configuration') return send(200, { issuer: issuer.url, token_endpoint: `${issuer.url}/token`, device_authorization_endpoint: `${issuer.url}/device`, jwks_uri: `${issuer.url}/jwks` });
      if (req.url === '/device') return send(200, { device_code: 'device-code-1', user_code: 'BCDF-GHJK', verification_uri: `${issuer.url}/activate`, verification_uri_complete: `${issuer.url}/activate?user_code=BCDF-GHJK`, expires_in: 60, interval: 1 });
      if (req.url !== '/token') return send(404, {});
      if (form.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
        if (form.device_code !== 'device-code-1' || form.client_id !== clientId) return send(400, { error: 'invalid_grant' });
        polls += 1;
        if (polls <= issuer.pendingPolls) return send(400, { error: 'authorization_pending' });
        if (polls <= issuer.pendingPolls + issuer.slowDownPolls) return send(400, { error: 'slow_down' });
        if (issuer.decision === 'deny') return send(400, { error: 'access_denied' });
        return send(200, tokens());
      }
      if (form.grant_type === 'refresh_token') {
        if (form.refresh_token !== issuer.refresh.at(-1) || form.client_id !== clientId) return send(400, { error: 'invalid_grant' });
        return send(200, tokens());
      }
      if (form.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange') {
        const subjectIsCurrent = form.subject_token === issuer.access.at(-1) && form.subject_token_type === 'urn:ietf:params:oauth:token-type:access_token';
        if (!subjectIsCurrent || form.audience !== 'unfold' || form.client_id !== clientId) return send(400, { error: 'invalid_grant' });
        return send(200, { access_token: issuer.exchanged, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 300 });
      }
      return send(400, { error: 'unsupported_grant_type' });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  issuer.url = `http://127.0.0.1:${address.port}`;
  issuer.close = () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); });
  return issuer;
}

function run(args: string[], env: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number | null; ms: number }> {
  const began = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper, ...args], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ stdout, stderr, code, ms: Date.now() - began }));
  });
}

async function eventually<T>(read: () => Promise<T | undefined>, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise(done => setTimeout(done, 100));
  }
}

async function environment(t: { after: (fn: () => Promise<void>) => void }, issuer: string, extra: Record<string, string> = {}) {
  const dir = await scratch(t);
  const browser = join(dir, 'browser.sh');
  await writeFile(browser, `#!/bin/sh\nprintf '%s' "$1" > '${join(dir, 'opened.txt')}'\n`);
  await chmod(browser, 0o755);
  const config = join(dir, 'config');
  return { dir, config, env: { HOME: dir, CLAUDE_CONFIG_DIR: config, UNFOLD_TELEMETRY_STORE: 'file', UNFOLD_TELEMETRY_NOTIFY: '0', UNFOLD_TELEMETRY_ISSUER: issuer, UNFOLD_TELEMETRY_CLIENT_ID: clientId, BROWSER: browser, ...extra } };
}

const sessions = (config: string) => readFile(join(config, 'plugins', 'data', 'unfold', 'telemetry.json'), 'utf8').then(text => JSON.parse(text) as Record<string, { accessToken: string; refreshToken: string; expiresAt: string; user: string }>);

test('the configuration comes from the environment only, with generic defaults, and a token never reaches a log line', () => {
  assert.deepEqual(configuration({}), { issuer: '', clientId: '', scopes: 'openid offline_access', audience: '', header: 'Authorization', exchangeAudience: 'unfold', notify: true, debug: false });
  const set = configuration({ UNFOLD_TELEMETRY_ISSUER: ' https://idp.example.org/realms/people/ ', UNFOLD_TELEMETRY_CLIENT_ID: clientId, UNFOLD_TELEMETRY_SCOPES: 'openid profile', UNFOLD_TELEMETRY_AUDIENCE: 'telemetry', UNFOLD_TELEMETRY_HEADER: 'X-Scope-OrgID', UNFOLD_TELEMETRY_EXCHANGE_AUDIENCE: 'unfold-staging', UNFOLD_TELEMETRY_NOTIFY: '0', UNFOLD_TELEMETRY_DEBUG: '1' });
  assert.deepEqual(set, { issuer: 'https://idp.example.org/realms/people', clientId, scopes: 'openid profile', audience: 'telemetry', header: 'X-Scope-OrgID', exchangeAudience: 'unfold-staging', notify: false, debug: true });
  assert.equal(configuration({ UNFOLD_TELEMETRY_ISSUER: 'ftp://idp.example.org' }).issuer, '', 'only http(s) issuers');
  assert.equal(redacted('Bearer abc.def.ghi and "access_token":"secret-value" and refresh_token=another'), 'Bearer [redacted] and "access_token":"[redacted]" and refresh_token=[redacted]');
});

test('a device flow is asked at most once every four hours when the person did not approve, and never while one waits', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(mayAsk({}, now), true);
  assert.equal(mayAsk({ status: 'waiting', expiresAt: new Date(now + 60_000).toISOString() }, now), false);
  assert.equal(mayAsk({ status: 'waiting', expiresAt: new Date(now - 1).toISOString() }, now), true);
  assert.equal(mayAsk({ status: 'starting', expiresAt: new Date(now + 60_000).toISOString() }, now), false);
  assert.equal(mayAsk({ status: 'approved', endedAt: new Date(now).toISOString() }, now), true);
  assert.equal(mayAsk({ status: 'denied', endedAt: new Date(now - askAgainAfterMs + 60_000).toISOString() }, now), false);
  assert.equal(mayAsk({ status: 'expired', endedAt: new Date(now - askAgainAfterMs - 1).toISOString() }, now), true);
  assert.equal(mayAsk({ status: 'unavailable', askedAt: new Date(now - 60_000).toISOString() }, now), false);
  assert.equal(askAgainAfterMs, 4 * 3600_000);
});

test('the Keychain store hands the tokens to security on standard input, never as an argument, and a missing Keychain falls back to the file', async t => {
  const dir = await scratch(t);
  const items = new Map<string, string>();
  const calls: { args: string[]; input?: string }[] = [];
  const security = (command: string, args: string[], options: { input?: string }) => {
    assert.equal(command, 'security');
    calls.push({ args, input: options.input });
    if (args[0] === '-i') { const [, , , service, , account, , value] = String(options.input).trim().split(' '); items.set(`${service}|${account}`, value); return ''; }
    if (args[0] === 'find-generic-password') { const value = items.get(`${args[2]}|${args[4]}`); if (!value) throw new Error('not found'); return `${value}\n`; }
    if (args[0] === 'delete-generic-password') { items.delete(`${args[2]}|${args[4]}`); return ''; }
    throw new Error(`unexpected ${args[0]}`);
  };
  const entry = { issuer: 'https://idp.example.org', clientId, accessToken: 'access-token-value', refreshToken: 'refresh-token-value', expiresAt: '2030-01-01T00:00:00Z', user: 'ada@example.org', scope: 'openid' };
  const keychain = keychainStore(security as never);
  keychain.write('https://idp.example.org', entry);
  assert.deepEqual(keychain.read('https://idp.example.org'), entry);
  assert.ok(calls.every(call => !call.args.join(' ').includes('token-value')), 'no token appears in an argument list');
  assert.match(String(calls[0].input), new RegExp(`^add-generic-password -U -s ${keychainService} -a https://idp.example.org -w [A-Za-z0-9_-]+\\n$`));
  keychain.forget('https://idp.example.org');
  assert.equal(keychain.read('https://idp.example.org'), null);

  const env = { CLAUDE_CONFIG_DIR: dir, UNFOLD_TELEMETRY_STORE: 'keychain' };
  const locked = telemetryStore(env, 'darwin', (() => { throw new Error('User interaction is not allowed.'); }) as never);
  assert.deepEqual(locked.write('https://idp.example.org', entry), { where: join(dir, 'plugins', 'data', 'unfold', 'telemetry.json'), fallback: true });
  assert.deepEqual(locked.read('https://idp.example.org'), { entry, where: join(dir, 'plugins', 'data', 'unfold', 'telemetry.json'), fallback: true });
  assert.equal((await stat(join(dir, 'plugins', 'data', 'unfold', 'telemetry.json'))).mode & 0o777, 0o600);
  const working = telemetryStore(env, 'darwin', security as never);
  assert.deepEqual(working.write('https://idp.example.org', entry), { where: 'the macOS Keychain', fallback: false });
  assert.deepEqual(fileStore(join(dir, 'plugins', 'data', 'unfold')).read('https://idp.example.org'), null, 'a session the Keychain kept is removed from the fallback file');
  working.forget('https://idp.example.org');
  assert.equal(working.read('https://idp.example.org').entry, null);
  assert.equal(telemetryStore({ CLAUDE_CONFIG_DIR: dir }, 'linux').kind, 'file');
});

test('the device flow opens the verification page, shows the code, slows down when told, and keeps the session once approved', async t => {
  const issuer = await fakeIssuer();
  t.after(() => issuer.close());
  issuer.slowDownPolls = 1;
  const { config, env } = await environment(t, issuer.url);
  const store = telemetryStore(env);
  const opened: string[] = [];
  const shown: string[] = [];
  const slept: number[] = [];
  const reported: string[] = [];
  let time = Date.parse('2026-11-18T12:00:00Z');
  const status = await deviceFlow(configuration(env), { env, store, clock: () => time, sleep: async ms => { slept.push(ms); time += ms; }, open: page => { opened.push(page); }, show: code => { shown.push(code); }, report: line => { reported.push(line); } });
  assert.equal(status, 'approved');
  assert.deepEqual(opened, [`${issuer.url}/activate?user_code=BCDF-GHJK`]);
  assert.deepEqual(shown, ['BCDF-GHJK']);
  assert.deepEqual(slept, [1000, 1000, 6000], 'slow_down adds five seconds to the interval');
  assert.deepEqual(issuer.requests.find(request => request.path === '/device')?.form, { client_id: clientId, scope: 'openid offline_access' });
  const kept = store.read(issuer.url).entry;
  assert.equal(kept?.accessToken, issuer.access[0]);
  assert.equal(kept?.refreshToken, issuer.refresh[0]);
  assert.equal(kept?.user, 'ada@example.org');
  assert.equal(readState(issuer.url, env).status, 'approved');
  assert.doesNotMatch(await readFile(stateFile(env), 'utf8'), /device-code-1|refresh-|eyJ/, 'the state file holds no device code and no token');
  assert.ok(reported.some(line => line.includes('BCDF-GHJK')) && reported.every(line => !line.includes(issuer.access[0])), 'progress names the code and never a token');
  assert.equal((await stat(join(config, 'plugins', 'data', 'unfold', 'telemetry.json'))).mode & 0o777, 0o600);
});

test('Claude Code gets {} at once and a background sign-in; then the header, a silent refresh, an exchanged token for Unfold, and logout clears it', async t => {
  const issuer = await fakeIssuer();
  t.after(() => issuer.close());
  const { dir, config, env } = await environment(t, issuer.url);

  const first = await run([], env);
  assert.deepEqual([first.code, first.stdout.trim()], [0, '{}']);
  assert.ok(first.ms < 5000, `the helper returned in ${first.ms} ms without waiting for the person`);
  assert.match(await eventually(async () => (await readFile(join(dir, 'opened.txt'), 'utf8')) || undefined), /\/activate\?user_code=BCDF-GHJK$/);
  const stored = await eventually(async () => (await sessions(config))[issuer.url]);
  assert.equal(stored.accessToken, issuer.access[0]);
  assert.equal(stored.user, 'ada@example.org');
  assert.equal(issuer.requests.filter(request => request.path === '/device').length, 1);

  const second = await run([], env);
  assert.deepEqual(JSON.parse(second.stdout), { Authorization: `Bearer ${issuer.access[0]}` });
  const named = await run([], { ...env, UNFOLD_TELEMETRY_HEADER: 'X-Scope-OrgID' });
  assert.deepEqual(JSON.parse(named.stdout), { 'X-Scope-OrgID': `Bearer ${issuer.access[0]}` });
  assert.equal(issuer.requests.filter(request => request.path === '/token').length, 2, 'a valid access token is printed without asking the issuer');

  const status = await run(['status'], env);
  assert.match(status.stdout, /Signed in to .* as ada@example\.org\. The access token is valid until .*; the helper refreshes it by itself\. Kept in .*telemetry\.json/);
  assert.doesNotMatch(status.stdout, /eyJ|refresh-/);

  const file = join(config, 'plugins', 'data', 'unfold', 'telemetry.json');
  const aged = JSON.parse(await readFile(file, 'utf8'));
  aged[issuer.url].expiresAt = new Date(Date.now() - 1000).toISOString();
  await writeFile(file, JSON.stringify(aged));
  const refreshed = await run([], env);
  assert.deepEqual(JSON.parse(refreshed.stdout), { Authorization: `Bearer ${issuer.access[1]}` });
  assert.deepEqual(issuer.requests.at(-1)?.form, { grant_type: 'refresh_token', refresh_token: issuer.refresh[0], client_id: clientId, scope: 'openid offline_access' });
  assert.equal((await sessions(config))[issuer.url].refreshToken, issuer.refresh[1], 'a rotated refresh token replaces the old one');

  const token = await run(['token'], env);
  assert.deepEqual([token.code, token.stdout], [0, `${issuer.exchanged}\n`]);
  assert.deepEqual(issuer.requests.at(-1)?.form, { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', client_id: clientId, subject_token: issuer.access[1], subject_token_type: 'urn:ietf:params:oauth:token-type:access_token', audience: 'unfold' });
  assert.equal(issuer.requests.filter(request => request.path === '/device').length, 1, 'token never starts a sign-in');

  const out = await run(['logout'], env);
  assert.match(out.stdout, /Forgot the telemetry session/);
  assert.deepEqual(await sessions(config), {});
  const afterwards = await run(['token'], env);
  assert.deepEqual([afterwards.code, afterwards.stdout], [1, '']);
  assert.match((await run(['status'], env)).stdout, /Not signed in/);
  assert.equal(issuer.requests.filter(request => request.path === '/device').length, 1, 'neither logout nor token starts a sign-in');
});

test('a refused refresh token forgets the session and asks again; a denied sign-in is not asked again for four hours', async t => {
  const issuer = await fakeIssuer();
  t.after(() => issuer.close());
  issuer.decision = 'deny';
  const { config, env } = await environment(t, issuer.url);
  const store = telemetryStore(env);
  store.write(issuer.url, { issuer: issuer.url, clientId, accessToken: 'stale', refreshToken: 'revoked', expiresAt: new Date(Date.now() - 1000).toISOString(), user: '', scope: '' });

  const first = await run([], env);
  assert.deepEqual([first.code, first.stdout.trim()], [0, '{}']);
  assert.equal(await eventually(async () => (await sessions(config))[issuer.url] === undefined ? true : undefined), true, 'the session the issuer refused is forgotten');
  const state = await eventually(async () => { const kept = readState(issuer.url, env); return kept.status === 'denied' ? kept : undefined; });
  assert.ok(state.endedAt);
  assert.equal(issuer.requests.filter(request => request.path === '/device').length, 1);

  const again = await run([], env);
  assert.deepEqual([again.code, again.stdout.trim()], [0, '{}']);
  await new Promise(done => setTimeout(done, 300));
  assert.equal(issuer.requests.filter(request => request.path === '/device').length, 1, 'not asked again within four hours');
  assert.match((await run(['status'], env)).stdout, /The last sign-in ended denied/);

  const login = await run(['login'], env);
  assert.equal(login.code, 1);
  assert.match(login.stdout, /BCDF-GHJK[\s\S]*You denied the sign-in/);
  assert.equal(issuer.requests.filter(request => request.path === '/device').length, 2, 'login asks at once');
});

test('without configuration or with an issuer that does not answer, the helper prints {} and exits 0 at once', async t => {
  const { env } = await environment(t, 'http://127.0.0.1:9', {});
  const down = await run([], env);
  assert.deepEqual([down.code, down.stdout.trim()], [0, '{}']);
  assert.ok(down.ms < 5000, `gave up after ${down.ms} ms`);
  assert.equal(down.stderr, '', 'quiet unless UNFOLD_TELEMETRY_DEBUG=1');
  const unconfigured = await run([], { HOME: env.HOME, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR });
  assert.deepEqual([unconfigured.code, unconfigured.stdout.trim()], [0, '{}']);
  const token = await run(['token'], { HOME: env.HOME, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR });
  assert.deepEqual([token.code, token.stdout], [2, '']);
  const login = await run(['login'], { HOME: env.HOME, CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR });
  assert.equal(login.code, 2);
  assert.match(login.stdout, /UNFOLD_TELEMETRY_ISSUER and UNFOLD_TELEMETRY_CLIENT_ID are not set/);
});

async function fakeUnfold(accepts: string) {
  const received: { path: string; auth: string; body: Record<string, unknown> }[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      received.push({ path: String(req.url), auth: String(req.headers.authorization ?? ''), body });
      const send = (status: number, answer: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer)); };
      if (req.url === '/api/auth/editor/exchange') return body.subject_token === accepts ? send(200, { access_token: `vle_${'c'.repeat(43)}`, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 2_592_000, expiresAt: '2099-01-01T00:00:00Z', familyExpiresAt: '2099-03-01T00:00:00Z', user: { name: 'ada' } }) : send(400, { error: { code: 'invalid_grant' } });
      if (req.url === '/api/auth/editor') return send(404, {});
      if (req.url === '/api/linked-sessions/events') return send(200, { session: { link: 'http://unfold.test/#linked-session/telemetry-session-1', workItems: [] }, context: 'Unfold records this Claude Code session.' });
      return send(200, {});
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}`, received, close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }) };
}

test('with a telemetry session and no UNFOLD_IDP_TOKEN_COMMAND, the plugin signs in through the helper’s exchanged token: no browser, no notice', async t => {
  const issuer = await fakeIssuer();
  const unfold = await fakeUnfold(issuer.exchanged);
  t.after(async () => { await issuer.close(); await unfold.close(); });
  const { dir, env } = await environment(t, issuer.url);
  assert.equal(idpTokenCommand({ UNFOLD_TELEMETRY_ISSUER: issuer.url }), `'${process.execPath}' '${helper}' token`);
  assert.equal(idpTokenCommand({ UNFOLD_TELEMETRY_ISSUER: issuer.url, UNFOLD_IDP_TOKEN_COMMAND: 'helper' }), 'helper', 'an explicit command wins');
  assert.equal(idpTokenCommand({}), '');
  const login = await run(['login'], env);
  assert.equal(login.code, 0, login.stdout);
  assert.match(login.stdout, /Signed in to .* as ada@example\.org/);

  const started = await new Promise<{ stdout: string; code: number | null }>((resolve, reject) => {
    const child = spawn(process.execPath, [hook], { env: { PATH: process.env.PATH ?? '', ...env, UNFOLD_URL: unfold.url, UNFOLD_CREDENTIAL_STORE: 'file', CLAUDE_PLUGIN_DATA: join(dir, 'plugin-data'), UNFOLD_HOOK_TIMEOUT_MS: '5000' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ stdout, code }));
    child.stdin.end(JSON.stringify({ session_id: 'telemetry-session-1', cwd: dir, hook_event_name: 'SessionStart', source: 'startup' }));
  });
  assert.equal(started.code, 0);
  assert.doesNotMatch(started.stdout, /systemMessage/);
  assert.ok(!unfold.received.some(request => request.path === '/api/auth/editor'), 'no browser sign-in was started');
  const exchange = unfold.received.find(request => request.path === '/api/auth/editor/exchange');
  assert.deepEqual([exchange?.body.grant_type, exchange?.body.subject_token, exchange?.body.subject_token_type], ['urn:ietf:params:oauth:grant-type:token-exchange', issuer.exchanged, 'urn:ietf:params:oauth:token-type:jwt']);
  assert.deepEqual(unfold.received.filter(request => request.path === '/api/linked-sessions/events').map(request => request.auth), [`Bearer vle_${'c'.repeat(43)}`]);
  assert.equal(JSON.parse(await readFile(join(dir, 'plugin-data', 'credentials.json'), 'utf8'))[unfold.url].user, 'ada');
});
