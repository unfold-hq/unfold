import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialKey, fileStore, keychainService, keychainStore, redacted, resolveCredential } from '../extensions/claude-code/scripts/credentials.mjs';
import { idpToken, mayCarryIdpToken, mayStart, readSignIn, renewSilently, renewWithinMs, retryAfterMs, rotateWithinMs, rotationDue, signInFile, signInNotice, signInReason, silentRetryMs, startSignIn, waitForApproval } from '../extensions/claude-code/scripts/sign-in.mjs';

const hook = fileURLToPath(new URL('../extensions/claude-code/scripts/unfold-hook.mjs', import.meta.url));
const tokenA = `vle_${'a'.repeat(43)}`;
const tokenB = `vle_${'b'.repeat(43)}`;
const day = 24 * 3600_000;
const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhZGEifQ.c2lnbmF0dXJl';

async function scratch(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'unfold-sign-in-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a credential is kept per Unfold address, readable by the person only, and an address differs only by its trailing slash or case of host', async t => {
  const dir = await scratch(t);
  const store = fileStore(join(dir, 'data'));
  assert.equal(credentialKey('https://Unfold.Example.org/'), 'https://unfold.example.org');
  assert.equal(credentialKey('https://example.org/unfold//'), 'https://example.org/unfold');
  assert.equal(credentialKey('file:///etc/passwd'), '');
  assert.equal(credentialKey(''), '');
  store.write(credentialKey('https://one.example.org'), { token: tokenA, expiresAt: '2030-01-01T00:00:00Z', user: 'ada' });
  store.write(credentialKey('https://two.example.org'), { token: tokenB, expiresAt: '2030-01-01T00:00:00Z', user: 'ada' });
  assert.equal(store.read(credentialKey('https://one.example.org/'))?.token, tokenA);
  assert.equal(store.read(credentialKey('https://two.example.org'))?.token, tokenB);
  assert.equal(store.read(credentialKey('https://three.example.org')), null);
  assert.equal(store.read('__proto__'), null);
  assert.equal((await stat(join(dir, 'data', 'credentials.json'))).mode & 0o777, 0o600);
  assert.throws(() => store.write(credentialKey('https://one.example.org'), { token: 'not-a-credential' }), /malformed/);
  store.forget(credentialKey('https://one.example.org'));
  assert.equal(store.read(credentialKey('https://one.example.org')), null);
  assert.equal(store.read(credentialKey('https://two.example.org'))?.token, tokenB, 'forgetting one address keeps the other');
});

test('the Keychain store hands the token to security on standard input, never as an argument, and checks it was kept', () => {
  const items = new Map<string, string>();
  const calls: { args: string[]; input?: string }[] = [];
  const run = (command: string, args: string[], options: { input?: string }) => {
    assert.equal(command, 'security');
    calls.push({ args, input: options.input });
    if (args[0] === '-i') { const [, , , service, , account, , value] = String(options.input).trim().split(' '); items.set(`${service}|${account}`, value); return ''; }
    if (args[0] === 'find-generic-password') { const value = items.get(`${args[2]}|${args[4]}`); if (!value) throw new Error('not found'); return `${value}\n`; }
    if (args[0] === 'delete-generic-password') { items.delete(`${args[2]}|${args[4]}`); return ''; }
    throw new Error(`unexpected ${args[0]}`);
  };
  const store = keychainStore(run as never);
  store.write('https://unfold.example.org', { token: tokenA, expiresAt: '2030-01-01T00:00:00Z', user: 'ada' });
  assert.deepEqual(store.read('https://unfold.example.org'), { token: tokenA, expiresAt: '2030-01-01T00:00:00Z', user: 'ada' });
  assert.ok(calls.every(call => !call.args.join(' ').includes(tokenA)), 'the token never appears in an argument list');
  assert.match(String(calls[0].input), new RegExp(`^add-generic-password -U -s ${keychainService} -a https://unfold.example.org -w [A-Za-z0-9_-]+\\n$`));
  store.forget('https://unfold.example.org');
  assert.equal(store.read('https://unfold.example.org'), null);
  const forgetful = keychainStore(((command: string, args: string[]) => { if (args[0] === 'find-generic-password') throw new Error('not found'); return ''; }) as never);
  assert.throws(() => forgetful.write('https://unfold.example.org', { token: tokenA }), /did not keep/);
});

test('UNFOLD_TOKEN wins over a stored credential, an expired stored credential counts as none, and a credential never reaches a log line', async t => {
  const dir = await scratch(t);
  const store = fileStore(dir);
  const url = 'https://unfold.example.org';
  const now = Date.parse('2026-11-17T12:00:00Z');
  store.write(credentialKey(url), { token: tokenA, expiresAt: '2026-12-01T00:00:00Z', user: 'ada' });
  assert.deepEqual(resolveCredential(url, { env: { UNFOLD_TOKEN: ` ${tokenB} ` }, store, now }), { token: tokenB, source: 'env', expiresAt: '', user: '' });
  assert.equal(resolveCredential(url, { env: {}, store, now }).token, tokenA);
  assert.equal(resolveCredential(`${url}/`, { env: {}, store, now }).source, 'stored');
  assert.equal(resolveCredential('https://other.example.org', { env: {}, store, now }).source, 'none');
  assert.equal(resolveCredential(url, { env: {}, store, now: Date.parse('2026-12-01T00:00:00Z') }).source, 'none');
  assert.equal(redacted(`Unfold answered 401 for ${tokenA} with Bearer ${tokenB}`), 'Unfold answered 401 for vle_[redacted] with Bearer [redacted]');
});

test('a stored credential is renewed a week and a day before it ends, UNFOLD_TOKEN never is, and a refused sign-in waits an hour', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const ends = (ms: number) => ({ token: tokenA, source: 'stored', expiresAt: new Date(now + ms).toISOString(), user: '' });
  assert.equal(signInReason({ token: '', source: 'none', expiresAt: '', user: '' }, now), 'sign-in');
  assert.equal(signInReason(ends(renewWithinMs), now), 'renew');
  assert.equal(signInReason(ends(renewWithinMs + 60_000), now), null);
  assert.equal(signInReason({ ...ends(day), source: 'env' }, now), null);
  assert.equal(renewWithinMs > 7 * day, true, 'renewal starts before Unfold warns about the credential');
  assert.equal(mayStart(null, now), true);
  assert.equal(mayStart({ status: 'waiting', expiresAt: new Date(now + 60_000).toISOString() }, now), false);
  assert.equal(mayStart({ status: 'waiting', expiresAt: new Date(now - 1).toISOString() }, now), true);
  assert.equal(mayStart({ status: 'denied', endedAt: new Date(now - retryAfterMs + 60_000).toISOString() }, now), false);
  assert.equal(mayStart({ status: 'expired', endedAt: new Date(now - retryAfterMs - 1).toISOString() }, now), true);
  assert.equal(mayStart({ status: 'approved', endedAt: new Date(now).toISOString() }, now), true);
});

test('a sign-in starts as Claude Code on its host, hands its secret only to a 0600 file, and the waiter stores the credential and signs the old one out', async t => {
  const dir = await scratch(t);
  const env = { CLAUDE_PLUGIN_DATA: dir };
  const url = 'https://unfold.example.org';
  const store = fileStore(dir);
  store.write(credentialKey(url), { token: tokenA, expiresAt: '2026-11-20T00:00:00Z', user: 'ada' });
  const requests: { url: string; body: any; auth: string }[] = [];
  let polls = 0;
  const fetcher = async (target: string, init: RequestInit) => {
    requests.push({ url: target, body: JSON.parse(String(init.body ?? '{}')), auth: String((init.headers as Record<string, string>).authorization ?? '') });
    if (target.endsWith('/api/auth/editor')) return answer(200, { code: 'ticket-code-1', secret: 'ticket-secret', userCode: 'BCDF-GHJK', expiresIn: 600, interval: 1, url: `${url}/api/auth/oidc?editor=ticket-code-1` });
    if (target.endsWith('/api/auth/editor/ticket-code-1')) return ++polls < 3 ? answer(polls === 1 ? 202 : 429, { status: 'pending' }) : answer(200, { status: 'ready', token: tokenB, expiresAt: '2026-12-17T12:00:00Z', user: { name: 'ada' } });
    if (target.endsWith('/api/logout')) return answer(200, { ok: true });
    throw new Error(`unexpected ${target}`);
  };
  const waiters: string[] = [];
  const now = Date.parse('2026-11-17T12:00:00Z');
  const started = await startSignIn({ url, env, fetcher: fetcher as never, now, host: 'ada-laptop', startWaiter: (file: string) => waiters.push(file) });
  assert.deepEqual(started, { userCode: 'BCDF-GHJK', page: `${url}/api/auth/oidc?editor=ticket-code-1`, reused: false });
  assert.deepEqual(requests[0].body, { client: 'claude-code', host: 'ada-laptop' });
  assert.deepEqual(waiters, [signInFile(url, env)]);
  assert.equal((await stat(waiters[0])).mode & 0o777, 0o600);
  assert.equal(await startSignIn({ url, env, fetcher: fetcher as never, now: now + 1000, startWaiter: () => assert.fail('a second sign-in starts while one waits') }), null);

  const opened: string[] = [];
  const slept: number[] = [];
  const status = await waitForApproval({ file: waiters[0], env, fetcher: fetcher as never, store, open: (page: string) => opened.push(page), sleep: async (ms: number) => { slept.push(ms); }, clock: () => now });
  assert.equal(status, 'approved');
  assert.deepEqual(opened, [`${url}/api/auth/oidc?editor=ticket-code-1`]);
  assert.deepEqual(slept, [1000, 1000, 2000], 'a slow_down adds a second to the interval');
  assert.deepEqual(store.read(credentialKey(url)), { token: tokenB, expiresAt: '2026-12-17T12:00:00Z', user: 'ada' });
  const logout = requests.find(request => request.url.endsWith('/api/logout'));
  assert.equal(logout?.auth, `Bearer ${tokenA}`, 'the replaced credential is signed out of Unfold');
  const kept = await readFile(waiters[0], 'utf8');
  assert.doesNotMatch(kept, /ticket-secret|vle_/, 'a finished sign-in keeps neither the ticket secret nor the credential');
  assert.equal(readSignIn(url, env).status, 'approved');
});

test('a denied or expired sign-in stores nothing, and Unfold without single sign-on is not asked again within the hour', async t => {
  const dir = await scratch(t);
  const env = { CLAUDE_PLUGIN_DATA: dir };
  const url = 'https://unfold.example.org';
  const store = fileStore(dir);
  const now = Date.parse('2026-11-17T12:00:00Z');
  const ticket = answer(200, { code: 'ticket-code-2', secret: 'ticket-secret', userCode: 'BCDF-GHJK', expiresIn: 600, interval: 1, url: `${url}/api/auth/oidc?editor=ticket-code-2` });
  await startSignIn({ url, env, fetcher: (async () => ticket) as never, now, startWaiter: () => undefined });
  const denied = await waitForApproval({ file: signInFile(url, env), env, fetcher: (async () => answer(403, { error: { code: 'editor_login_denied', message: 'You denied it.' } })) as never, store, open: () => undefined, sleep: async () => undefined, clock: () => now });
  assert.equal(denied, 'denied');
  assert.equal(store.read(credentialKey(url)), null);
  assert.equal(await startSignIn({ url, env, fetcher: (async () => assert.fail('asked again within the hour')) as never, now: now + 60_000, startWaiter: () => undefined }), null);

  const other = 'https://other.example.org';
  await startSignIn({ url: other, env, fetcher: (async () => answer(200, { code: 'ticket-code-3', secret: 's', userCode: 'X', expiresIn: 1, interval: 1, url: `${other}/x` })) as never, now, startWaiter: () => undefined });
  let time = now;
  assert.equal(await waitForApproval({ file: signInFile(other, env), env, fetcher: (async () => answer(202, {})) as never, store, open: () => undefined, sleep: async (ms: number) => { time += ms; }, clock: () => time }), 'expired');

  const third = 'https://no-sso.example.org';
  let starts = 0;
  const notFound = (async () => { starts += 1; return answer(404, {}); }) as never;
  assert.equal(await startSignIn({ url: third, env, fetcher: notFound, now, startWaiter: () => undefined }), null);
  assert.equal(await startSignIn({ url: third, env, fetcher: notFound, now: now + 60_000, startWaiter: () => undefined }), null);
  assert.equal(starts, 1);
  assert.equal(readSignIn(third, env).status, 'unavailable');
});

test('the notice tells the person the code and page once, renewal names the end date, and an existing UNFOLD_TOKEN asks for nothing', async t => {
  const dir = await scratch(t);
  const env = { CLAUDE_PLUGIN_DATA: dir };
  const url = 'https://unfold.example.org';
  const now = Date.parse('2026-11-17T12:00:00Z');
  const fetcher = (async () => answer(200, { code: 'ticket-code-4', secret: 's', userCode: 'BCDF-GHJK', expiresIn: 600, interval: 2, url: `${url}/api/auth/oidc?editor=ticket-code-4` })) as never;
  const none = { token: '', source: 'none', expiresAt: '', user: '' };
  const first = await signInNotice({ url, credential: none, event: 'SessionStart', env, fetcher, now, startWaiter: () => undefined });
  assert.match(first!.systemMessage, /approve the sign-in in your browser.*BCDF-GHJK.*https:\/\/unfold\.example\.org\/api\/auth\/oidc\?editor=ticket-code-4/);
  assert.match(first!.context, /Do not ask them for a token/);
  const again = await signInNotice({ url, credential: none, event: 'SessionStart', env, fetcher, now: now + 1000, startWaiter: () => undefined });
  assert.match(again!.systemMessage, /a sign-in waits for your approval/);
  assert.equal(await signInNotice({ url, credential: none, event: 'UserPromptSubmit', env, fetcher, now: now + 1000, startWaiter: () => undefined }), null, 'a prompt is not nagged while a sign-in waits');
  assert.equal(await signInNotice({ url, credential: { token: tokenA, source: 'env', expiresAt: '', user: '' }, event: 'SessionStart', env, fetcher: (async () => assert.fail('UNFOLD_TOKEN starts no sign-in')) as never, now }), null);
  const renewing = await signInNotice({ url: 'https://renew.example.org', credential: { token: tokenA, source: 'stored', expiresAt: '2026-11-20T12:00:00Z', user: '' }, event: 'SessionStart', env, fetcher, now, startWaiter: () => undefined });
  assert.match(renewing!.systemMessage, /your sign-in ends 2026-11-20\. Approve the renewal/);
});

type Ticketing = { received: { path: string; auth: string; body: any }[]; url: string; close: () => Promise<void>; refuse: Set<string> };

async function fakeUnfold(options: { hangStart?: boolean } = {}): Promise<Ticketing> {
  const received: Ticketing['received'] = [];
  const refuse = new Set<string>();
  let polls = 0;
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const auth = String(req.headers.authorization ?? '');
      received.push({ path: String(req.url), auth, body });
      if (req.url === '/api/auth/editor') {
        if (options.hangStart) return;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 'hook-ticket-1', secret: 'hook-secret', userCode: 'BCDF-GHJK', expiresIn: 60, interval: 1, url: `http://${req.headers.host}/api/auth/oidc?editor=hook-ticket-1` }));
        return;
      }
      if (req.url === '/api/auth/editor/exchange') {
        res.writeHead(body.subject_token === jwt ? 200 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body.subject_token === jwt ? { access_token: tokenB, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 2_592_000, expiresAt: '2099-01-01T00:00:00Z', familyExpiresAt: '2099-03-01T00:00:00Z', user: { name: 'ada' } } : { error: { code: 'invalid_grant' } }));
        return;
      }
      if (req.url === '/api/auth/editor/hook-ticket-1') {
        polls += 1;
        res.writeHead(polls < 2 ? 202 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(polls < 2 ? { status: 'pending' } : { status: 'ready', token: tokenA, expiresAt: '2099-01-01T00:00:00Z', user: { name: 'ada' } }));
        return;
      }
      if (refuse.has(auth)) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'unauthenticated' } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/api/linked-sessions/events') res.end(JSON.stringify({ session: { link: 'http://unfold.test/#linked-session/sign-in-session-1', workItems: [] }, context: 'Unfold records this Claude Code session.' }));
      else res.end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}`, received, refuse, close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }) };
}

function runHook(payload: Record<string, unknown>, env: Record<string, string>): Promise<{ stdout: string; code: number | null; ms: number }> {
  const began = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ stdout, code, ms: Date.now() - began }));
    child.stdin.end(JSON.stringify(payload));
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

test('a first session without a token opens the browser, exits at once, and the next hook reports with the credential the background waiter stored; a refused credential is forgotten', async t => {
  const unfold = await fakeUnfold();
  const dir = await scratch(t);
  t.after(() => unfold.close());
  const opened = join(dir, 'opened.txt');
  const browser = join(dir, 'browser.sh');
  await writeFile(browser, `#!/bin/sh\nprintf '%s' "$1" > '${opened}'\n`);
  await chmod(browser, 0o755);
  const env = { HOME: dir, UNFOLD_URL: unfold.url, UNFOLD_CREDENTIAL_STORE: 'file', CLAUDE_PLUGIN_DATA: join(dir, 'data'), BROWSER: browser };
  const base = { session_id: 'sign-in-session-1', cwd: dir };

  const started = await runHook({ ...base, hook_event_name: 'SessionStart', source: 'startup' }, env);
  assert.equal(started.code, 0);
  assert.ok(started.ms < 5000, `the hook returned in ${started.ms} ms without waiting for the person`);
  const output = JSON.parse(started.stdout);
  assert.match(output.systemMessage, /BCDF-GHJK/);
  assert.match(output.hookSpecificOutput.additionalContext, /Do not ask them for a token/);
  assert.equal(unfold.received.find(request => request.path === '/api/auth/editor')?.body.client, 'claude-code');
  assert.ok(!unfold.received.some(request => request.path === '/api/linked-sessions/events'), 'nothing is reported before the person approves');

  assert.match(await eventually(async () => (await readFile(opened, 'utf8')) || undefined), /\/api\/auth\/oidc\?editor=hook-ticket-1$/);
  const stored = await eventually(async () => { const all = JSON.parse(await readFile(join(dir, 'data', 'credentials.json'), 'utf8')); return all[unfold.url]; });
  assert.equal(stored.token, tokenA);

  const prompted = await runHook({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'hello' }, env);
  assert.equal(prompted.code, 0);
  const events = unfold.received.filter(request => request.path === '/api/linked-sessions/events');
  assert.deepEqual(events.map(request => [request.body.event, request.auth]), [['start', `Bearer ${tokenA}`], ['prompt', `Bearer ${tokenA}`]], 'the first prompt after approval starts the session it missed');
  assert.match(JSON.parse(prompted.stdout).hookSpecificOutput.additionalContext, /Unfold records this Claude Code session/);

  unfold.refuse.add(`Bearer ${tokenA}`);
  const refused = await runHook({ ...base, hook_event_name: 'Stop' }, env);
  assert.equal(refused.code, 0);
  assert.equal(refused.stdout, '');
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'data', 'credentials.json'), 'utf8')), {}, 'a credential Unfold refuses is forgotten');
  assert.doesNotMatch(await readFile(signInFile(unfold.url, { CLAUDE_PLUGIN_DATA: join(dir, 'data') }), 'utf8'), /hook-secret|vle_/);
});

test('a hook never waits on a sign-in Unfold does not answer, and UNFOLD_TOKEN reports without a sign-in', async t => {
  const unfold = await fakeUnfold({ hangStart: true });
  const dir = await scratch(t);
  t.after(() => unfold.close());
  const env = { HOME: dir, UNFOLD_URL: unfold.url, UNFOLD_CREDENTIAL_STORE: 'file', CLAUDE_PLUGIN_DATA: join(dir, 'data'), UNFOLD_HOOK_TIMEOUT_MS: '500', BROWSER: '/bin/false' };
  const hung = await runHook({ session_id: 'sign-in-session-2', cwd: dir, hook_event_name: 'SessionStart', source: 'startup' }, env);
  assert.deepEqual([hung.code, hung.stdout], [0, '']);
  assert.ok(hung.ms < 5000, `the hook gave up after ${hung.ms} ms`);
  for (const event of ['UserPromptSubmit', 'Stop', 'SessionEnd', 'Notification']) {
    const quiet = await runHook({ session_id: 'sign-in-session-2', cwd: dir, hook_event_name: event, prompt: 'x', notification_type: 'idle_prompt' }, env);
    assert.deepEqual([quiet.code, quiet.stdout], [0, ''], event);
  }
  assert.equal(unfold.received.filter(request => request.path === '/api/auth/editor').length, 1, 'an unanswered start is not retried by every hook');

  const reported = await runHook({ session_id: 'sign-in-session-3', cwd: dir, hook_event_name: 'SessionStart', source: 'startup' }, { ...env, UNFOLD_TOKEN: tokenB, UNFOLD_HOOK_TIMEOUT_MS: '5000' });
  assert.equal(reported.code, 0);
  assert.doesNotMatch(reported.stdout, /systemMessage/);
  assert.equal(unfold.received.at(-1)?.auth, `Bearer ${tokenB}`);
});


test('a stored credential rotates once it is a week old, until its family deadline, and UNFOLD_TOKEN never does', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const stored = (left: number, family?: number) => ({ token: tokenA, source: 'stored', expiresAt: new Date(now + left).toISOString(), user: '', ...(family === undefined ? {} : { familyExpiresAt: new Date(now + family).toISOString() }) });
  assert.equal(rotationDue(stored(rotateWithinMs + 60_000), now), false, 'a fresh credential is left alone');
  assert.equal(rotationDue(stored(rotateWithinMs), now), true);
  assert.equal(rotationDue(stored(rotateWithinMs, 60 * day), now), true);
  assert.equal(rotationDue(stored(5 * day, 5 * day), now), false, 'a credential that already ends with its family cannot be extended');
  assert.equal(rotationDue({ ...stored(day), source: 'env' }, now), false);
  assert.equal(rotationDue({ token: '', source: 'none', expiresAt: '', user: '' }, now), false);
  assert.equal(signInReason(stored(5 * day, 5 * day), now), 'renew', 'at the family deadline the browser or the identity provider takes over');
});

test('the token command prints a JWT within its time, and an identity-provider token only travels over HTTPS or to this machine', () => {
  assert.equal(idpToken({}), '');
  assert.equal(idpToken({ UNFOLD_IDP_TOKEN_COMMAND: 'helper' }, (() => `\n ${jwt} \nmore\n`) as never), jwt);
  assert.equal(idpToken({ UNFOLD_IDP_TOKEN_COMMAND: 'helper' }, (() => 'not a token') as never), '');
  assert.equal(idpToken({ UNFOLD_IDP_TOKEN_COMMAND: 'helper' }, (() => { throw new Error('timed out'); }) as never), '');
  assert.equal(idpToken({ UNFOLD_IDP_TOKEN_COMMAND: `printf '%s' ${jwt}` }), jwt, 'runs through the shell');
  assert.equal(mayCarryIdpToken('https://unfold.example.org'), true);
  assert.equal(mayCarryIdpToken('http://127.0.0.1:8080'), true);
  assert.equal(mayCarryIdpToken('http://localhost:8080'), true);
  assert.equal(mayCarryIdpToken('http://unfold.example.org'), false);
});

test('a week-old credential is rotated silently, once per hook burst, and the new one is kept with its family deadline', async t => {
  const dir = await scratch(t);
  const env = { CLAUDE_PLUGIN_DATA: dir };
  const url = 'https://unfold.example.org';
  const store = fileStore(dir);
  const now = Date.parse('2026-11-17T12:00:00Z');
  const old = { token: tokenA, expiresAt: new Date(now + 20 * day).toISOString(), user: 'ada' };
  store.write(credentialKey(url), old);
  const calls: { url: string; auth: string }[] = [];
  const fetcher = async (target: string, init: RequestInit) => {
    calls.push({ url: target, auth: String((init.headers as Record<string, string>).authorization ?? '') });
    return answer(200, { token: tokenB, expiresAt: '2026-12-17T12:00:00Z', familyExpiresAt: '2027-02-01T12:00:00Z', user: { name: 'ada' } });
  };
  const fresh = await renewSilently({ url, credential: { ...old, source: 'stored' }, env, fetcher: fetcher as never, now, store });
  assert.deepEqual(fresh, { token: tokenB, expiresAt: '2026-12-17T12:00:00Z', user: 'ada', familyExpiresAt: '2027-02-01T12:00:00Z', source: 'stored' });
  assert.deepEqual(calls, [{ url: `${url}/api/auth/editor/rotate`, auth: `Bearer ${tokenA}` }]);
  assert.deepEqual(store.read(credentialKey(url)), { token: tokenB, expiresAt: '2026-12-17T12:00:00Z', user: 'ada', familyExpiresAt: '2027-02-01T12:00:00Z' });
  const raced = await renewSilently({ url, credential: { ...old, source: 'stored' }, env, fetcher: (async () => assert.fail('a second hook rotates again')) as never, now: now + 1000, store });
  assert.equal(raced.token, tokenA, 'within the retry pause a hook that still holds the old token uses it');
  const later = await renewSilently({ url, credential: { ...old, source: 'stored' }, env, fetcher: (async () => assert.fail('the store already holds the rotated credential')) as never, now: now + silentRetryMs, store });
  assert.equal(later.token, tokenB, 'a hook that read the old token takes the rotated one from the store instead of rotating it again');
});

test('a credential Unfold refuses to rotate is forgotten, and the identity-provider token signs the machine in again without the browser', async t => {
  const dir = await scratch(t);
  const env = { CLAUDE_PLUGIN_DATA: dir, UNFOLD_IDP_TOKEN_COMMAND: 'helper' };
  const url = 'https://unfold.example.org';
  const store = fileStore(dir);
  const now = Date.parse('2026-11-17T12:00:00Z');
  const old = { token: tokenA, expiresAt: new Date(now + 20 * day).toISOString(), user: 'ada' };
  store.write(credentialKey(url), old);
  const requests: { url: string; body: any }[] = [];
  const fetcher = async (target: string, init: RequestInit) => {
    requests.push({ url: target, body: JSON.parse(String(init.body ?? '{}')) });
    if (target.endsWith('/rotate')) return answer(401, { error: { code: 'editor_credential_reused' } });
    return answer(200, { access_token: tokenB, issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 2_592_000, expiresAt: '2026-12-17T12:00:00Z', familyExpiresAt: '2027-02-15T12:00:00Z', user: { name: 'ada' } });
  };
  const fresh = await renewSilently({ url, credential: { ...old, source: 'stored' }, env, fetcher: fetcher as never, now, store, run: (() => `${jwt}\n`) as never, host: 'ada-laptop' });
  assert.equal(fresh.token, tokenB);
  assert.deepEqual(requests.map(request => request.url), [`${url}/api/auth/editor/rotate`, `${url}/api/auth/editor/exchange`]);
  assert.deepEqual(requests[1].body, { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: jwt, subject_token_type: 'urn:ietf:params:oauth:token-type:jwt', client: 'claude-code', host: 'ada-laptop' });
  assert.equal(store.read(credentialKey(url))?.familyExpiresAt, '2027-02-15T12:00:00Z');

  const plain = 'http://unfold.example.org';
  const untouched = await renewSilently({ url: plain, credential: { token: '', source: 'none', expiresAt: '', user: '' }, env, fetcher: (async () => assert.fail('an identity-provider token is never sent over plain HTTP')) as never, now, store, run: (() => jwt) as never });
  assert.equal(untouched.token, '');
  const failing = 'https://failing.example.org';
  let exchanges = 0;
  const refusing = (async () => { exchanges += 1; return answer(403, { error: { code: 'exchange_unknown_person' } }); }) as never;
  assert.equal((await renewSilently({ url: failing, credential: { token: '', source: 'none', expiresAt: '', user: '' }, env, fetcher: refusing, now, store, run: (() => jwt) as never })).token, '');
  assert.equal((await renewSilently({ url: failing, credential: { token: '', source: 'none', expiresAt: '', user: '' }, env, fetcher: refusing, now: now + 60_000, store, run: (() => jwt) as never })).token, '');
  assert.equal(exchanges, 1, 'a refused exchange is not retried by every hook');
});

test('with a token command, the first session signs in through the identity provider: no browser, no notice, and it reports at once', async t => {
  const unfold = await fakeUnfold();
  const dir = await scratch(t);
  t.after(() => unfold.close());
  const env = { HOME: dir, UNFOLD_URL: unfold.url, UNFOLD_CREDENTIAL_STORE: 'file', CLAUDE_PLUGIN_DATA: join(dir, 'data'), BROWSER: '/bin/false', UNFOLD_IDP_TOKEN_COMMAND: `printf '%s\\n' ${jwt}`, UNFOLD_HOOK_TIMEOUT_MS: '5000' };
  const started = await runHook({ session_id: 'sign-in-session-4', cwd: dir, hook_event_name: 'SessionStart', source: 'startup' }, env);
  assert.equal(started.code, 0);
  assert.doesNotMatch(started.stdout, /systemMessage/);
  assert.ok(!unfold.received.some(request => request.path === '/api/auth/editor'), 'no browser sign-in was started');
  assert.deepEqual(unfold.received.map(request => [request.path, request.auth]).filter(([path]) => path !== '/api/auth/editor/exchange'), [['/api/linked-sessions/events', `Bearer ${tokenB}`]]);
  const stored = JSON.parse(await readFile(join(dir, 'data', 'credentials.json'), 'utf8'))[unfold.url];
  assert.deepEqual(stored, { token: tokenB, expiresAt: '2099-01-01T00:00:00Z', user: 'ada', familyExpiresAt: '2099-03-01T00:00:00Z' });
});
