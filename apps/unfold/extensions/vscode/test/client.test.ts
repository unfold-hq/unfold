import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { UnfoldClient, ApiError, gatewayFault, gatewayHeaderName, gatewayHeaderValue, gatewayWantsCredential, normalizeServerUrl, storedGatewayHeaders, workbenchFault, type Secrets } from '../src/client.ts';
import { application, createInput, request, sessionUntil } from '../../../test/api-support.ts';
import { signInForEditor, workbench } from '../../../test/oidc-support.ts';
import { browserLogin } from '../src/browser-login.ts';
import { editorLabel, hashPassword } from '../../../src/auth.ts';
import { hostname } from 'node:os';
import { deadlineAfter, testTimeout } from '../../../test/timeframes.ts';
import type { SessionInput } from '../src/types.ts';

class MemorySecrets implements Secrets {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key); }
  async store(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}

test('server origins require HTTPS except loopback and reject credential-bearing or path URLs', () => {
  assert.equal(normalizeServerUrl(' https://unfold.example/ '), 'https://unfold.example');
  assert.equal(normalizeServerUrl('http://127.0.0.1:4080'), 'http://127.0.0.1:4080');
  assert.equal(normalizeServerUrl('http://[::1]:4080'), 'http://[::1]:4080');
  for (const value of ['http://unfold.example', 'https://user:password@unfold.example', 'https://unfold.example/api', 'https://unfold.example?token=secret', 'https://unfold.example/#token', 'file:///etc/passwd', 'http://127.0.0.1.attacker.example']) assert.throws(() => normalizeServerUrl(value));
});

test('the client drives the actual demo server to real checks and independently reviewed evidence', { timeout: testTimeout(30_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const secrets = new MemorySecrets();
  const client = new UnfoldClient(server.url, secrets);
  const bootstrap = await client.bootstrap();
  assert.equal(bootstrap.mode, 'demo');
  assert.equal(bootstrap.repositories[0].id, 'order-service');
  const session = await client.create(createInput() as SessionInput);
  assert.equal(session.status, 'queued');
  await client.message(session.id, 'Keep nonnegative amount validation.');
  const history = await client.history(session.id);
  assert(history.some(event => JSON.stringify(event.data).includes('Keep nonnegative')));
  const after = history.at(-1)!.id;
  await client.action(session.id, 'start');
  await sessionUntil(server.url, session.id, value => ['completed', 'failed'].includes(value.status));
  const completed = await client.session(session.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.spentUsd, 0);
  assert.equal(completed.costStatus, 'demo');
  assert(completed.runs.some(run => run.verdict === 'approve'));
  assert.match(completed.artifacts.find(artifact => artifact.name === 'Baseline checks (expected failure)')!.content, /not ok|fail/i);
  assert.match(completed.artifacts.find(artifact => artifact.name === 'Verification checks')!.content, /pass|ok \d/i);
  assert.match(completed.artifacts.find(artifact => artifact.kind === 'diff')!.content, /^diff --git/m);
  assert((await client.history(session.id, after)).every(event => event.id > after));
  assert.equal((await client.sessions()).length, 1);
  assert.deepEqual(await client.permissions(session.id), []);
  assert.equal(secrets.values.size, 0, 'the demonstration never invents login or API credentials');
  assert.equal(client.dashboard(session.id), `${server.url}/#session/${session.id}`);
});

test('pause, durable instruction, resume and cancel use the real authenticated mutation contract', { timeout: testTimeout(20_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const client = new UnfoldClient(server.url, new MemorySecrets());
  const session = await client.create(createInput() as SessionInput);
  await client.action(session.id, 'start');
  await sessionUntil(server.url, session.id, value => value.status === 'running');
  await client.action(session.id, 'pause');
  await client.message(session.id, 'Preserve the public function signature.');
  assert.equal((await client.session(session.id)).status, 'paused');
  await client.action(session.id, 'resume');
  await client.action(session.id, 'cancel');
  assert.equal((await client.session(session.id)).status, 'cancelled');
  await assert.rejects(client.action(session.id, 'start'), (error: unknown) => error instanceof ApiError && error.status === 409);
});

test('live login stores only the opaque session cookie, restores it, clears expired credentials and logs out', { timeout: testTimeout(20_000) }, async t => {
  const server = await application('live');
  t.after(() => server.close());
  const secrets = new MemorySecrets();
  const client = new UnfoldClient(server.url, secrets);
  await assert.rejects(client.bootstrap(), (error: unknown) => error instanceof ApiError && error.status === 401);
  await assert.rejects(client.login('admin', 'incorrect-password'), (error: unknown) => error instanceof ApiError && error.status === 401);
  assert.equal(secrets.values.size, 0);
  await client.login('admin', 'test-admin-password-314159');
  assert.match(secrets.values.get(client.secretKey)!, /^unfold=[A-Za-z0-9_-]+$/);
  assert(!JSON.stringify([...secrets.values]).includes('test-admin-password'));
  const restored = new UnfoldClient(server.url, secrets);
  assert.equal((await restored.bootstrap()).user.role, 'admin');
  await restored.logout();
  assert.equal(secrets.values.size, 0);
  await assert.rejects(restored.bootstrap(), (error: unknown) => error instanceof ApiError && error.status === 401);
  await secrets.store(restored.secretKey, `unfold=${'a'.repeat(43)}`);
  await assert.rejects(restored.bootstrap(), (error: unknown) => error instanceof ApiError && error.status === 401);
  assert.equal(secrets.values.size, 0);
});

test('the extension signs in through the browser end to end, named after its machine: it shows the code, waits for approval and keeps a revocable editor credential', { timeout: testTimeout(30_000) }, async t => {
  const { server, idp } = await workbench(t);
  const secrets = new MemorySecrets();
  const client = new UnfoldClient(server.url, secrets);
  const shown: string[] = [];
  let browserCookie = '';
  let approvalPage: { userCode?: string; workbench?: string; label?: string } = {};
  const user = await browserLogin(client, {
    showCode: code => { shown.push(code); },
    open: async url => {
      const signedIn = await signInForEditor(url, idp);
      browserCookie = signedIn.cookie;
      const code = decodeURIComponent(signedIn.location.replace('/#editor-sign-in/', ''));
      approvalPage = (await request(server.url, `/api/editor-requests/${code}`, { cookie: browserCookie })).body;
      assert.equal((await request(server.url, `/api/editor-requests/${code}/approve`, { method: 'POST', cookie: browserCookie })).status, 200);
    },
    cancelled: () => false,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }, server.url, 1100);
  assert.deepEqual(user && { name: user.name }, { name: 'person@example.com' });
  assert.equal(shown.length, 1);
  assert.equal(approvalPage.userCode, shown[0]);
  assert.equal(approvalPage.workbench, new URL(server.url).host);
  assert.equal(approvalPage.label, editorLabel('vscode', hostname().split('.')[0]), 'the sign-in names the machine VS Code runs on');
  const stored = secrets.values.get(client.secretKey)!;
  assert.match(stored, /^vle_[A-Za-z0-9_-]{43}$/);
  assert.equal((await client.bootstrap()).user.name, 'person@example.com');
  const [editor] = (await request(server.url, '/api/editor-credentials', { cookie: browserCookie })).body.editors;
  assert.equal((await request(server.url, `/api/editor-credentials/${editor.id}`, { method: 'DELETE', cookie: browserCookie })).status, 200);
  await assert.rejects(client.bootstrap(), (error: unknown) => error instanceof ApiError && error.status === 401);
  assert.equal(secrets.values.size, 0);
});

test('the actual server enforces object ownership for desktop clients', { timeout: testTimeout(20_000) }, async t => {
  const server = await application('live');
  t.after(() => server.close());
  server.app.store.addUser({ id: 'alice', name: 'alice', role: 'operator', passwordHash: hashPassword('alice-password-314159') });
  server.app.store.addUser({ id: 'bob', name: 'bob', role: 'operator', passwordHash: hashPassword('bob-password-314159') });
  const alice = new UnfoldClient(server.url, new MemorySecrets());
  const bob = new UnfoldClient(server.url, new MemorySecrets());
  await alice.login('alice', 'alice-password-314159');
  await bob.login('bob', 'bob-password-314159');
  const session = await alice.create(createInput({ runtime: 'opencode' }) as SessionInput);
  assert.equal((await alice.sessions()).length, 1);
  assert.equal((await bob.sessions()).length, 0);
  for (const request of [() => bob.session(session.id), () => bob.history(session.id), () => bob.permissions(session.id), () => bob.message(session.id, 'Unauthorized change'), () => bob.action(session.id, 'cancel')]) await assert.rejects(request(), (error: unknown) => error instanceof ApiError && error.status === 404);
});

test('redirects never forward a stored control-plane cookie to a different destination', async t => {
  let targetCalls = 0;
  const target = createServer((_request, response) => { targetCalls++; response.end('unexpected'); });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => target.close(() => resolve())));
  const targetAddress = target.address();
  assert(targetAddress && typeof targetAddress !== 'string');
  let originalCookie = '';
  const redirect = createServer((request, response) => { originalCookie = request.headers.cookie || ''; response.writeHead(302, { Location: `http://127.0.0.1:${targetAddress.port}/api/bootstrap` }); response.end(); });
  await new Promise<void>(resolve => redirect.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => redirect.close(() => resolve())));
  const address = redirect.address();
  assert(address && typeof address !== 'string');
  const secrets = new MemorySecrets();
  const client = new UnfoldClient(`http://127.0.0.1:${address.port}`, secrets);
  await secrets.store(client.secretKey, 'unfold=opaque-control-cookie');
  await assert.rejects(client.bootstrap(), (error: unknown) => error instanceof ApiError && error.code === 'redirect');
  assert.equal(originalCookie, 'unfold=opaque-control-cookie');
  assert.equal(targetCalls, 0);
});

function answer(status: number, headers: Record<string, string> = {}) {
  return { status, headers: new Headers(headers) };
}

test('a redirect says where it went and what to do, and never repeats the query of a sign-in page', () => {
  const origin = 'https://unfold.example';
  const moved = gatewayFault(origin, '/api/bootstrap', answer(308, { location: 'https://workbench.example/api/bootstrap' }), false);
  assert.equal(moved?.code, 'redirect');
  assert.match(moved!.message, /^The workbench at unfold\.example redirects to https:\/\/workbench\.example\. If that is your workbench, run Unfold: Connect to Workbench with that origin\./);
  assert.equal(gatewayWantsCredential(moved), false, 'a moved workbench needs its new origin, not a gateway credential');

  const signIn = gatewayFault(origin, '/api/bootstrap', answer(302, { location: 'https://team.gateway.example/login/unfold.example?kid=abc&meta=eyJhbGciOi' }), false);
  assert.equal(signIn?.code, 'gateway_sign_in');
  assert.equal(signIn?.status, 302);
  assert.match(signIn!.message, /something in front of it redirected the request to team\.gateway\.example\. That is usually an access gateway asking for a sign-in the editor cannot complete\. If it accepts a credential in request headers, such as a service token, store it with Unfold: Set Access Gateway Headers\. Credentials are never forwarded\.$/);
  assert.doesNotMatch(signIn!.message, /kid=|meta=|eyJ/);
  assert.equal(gatewayWantsCredential(signIn), true);

  assert.match(gatewayFault(origin, '/api/bootstrap', answer(302, { location: 'https://team.gateway.example/login' }), true)!.message, /It did not accept the access gateway headers stored for this workbench; replace them with Unfold: Set Access Gateway Headers\./);
  assert.match(gatewayFault(origin, '/api/sessions?x=1', answer(302, { location: '/oauth2/sign_in?rd=%2Fapi%2Fsessions' }), false)!.message, /redirected the request to its own path \/oauth2\/sign_in\. /);
  assert.match(gatewayFault(origin, '/api/bootstrap', answer(302), false)!.message, /redirected the request to another address\./);
  assert.match(gatewayFault(origin, '/api/bootstrap', answer(302, { location: 'http://[' }), false)!.message, /redirected the request to another address\./);
});

const gatewayJson = JSON.stringify({ message: 'Unauthorized. You do not have permission to view this.', status_code: 401, aud: 'opaque-audience' });
const workbenchJson = JSON.stringify({ error: { code: 'unauthenticated', message: 'Sign in to your workbench.' } });

test('a 401 or 403 is the workbench\'s own only when it names a fault as the Unfold JSON API does', () => {
  const origin = 'https://unfold.example';
  assert.deepEqual(workbenchFault(workbenchJson), { code: 'unauthenticated', message: 'Sign in to your workbench.' });
  assert.deepEqual(workbenchFault('{"error":{"code":"csrf"}}'), { code: 'csrf', message: '' });
  for (const body of [undefined, '', '<html>Forbidden</html>', gatewayJson, '{"error":"unauthorized"}', '{"error":{"code":""}}', '{"error":{"code":401}}', 'null', '[]']) assert.equal(workbenchFault(body), undefined);

  const bare = gatewayFault(origin, '/api/bootstrap', answer(403, { 'content-type': 'text/html; charset=UTF-8' }), false, '<html>Forbidden</html>');
  assert.equal(bare?.code, 'gateway_refused');
  assert.equal(bare?.status, 0, 'a gateway 401 or 403 is not the workbench saying who may do what');
  assert.match(bare!.message, /^The server at unfold\.example refused the request with 403 and did not return the Unfold JSON API\. Check the server URL\. If an access gateway in front of the workbench accepts a credential in request headers, such as a service token, store it with Unfold: Set Access Gateway Headers\.$/);
  const json = gatewayFault(origin, '/api/bootstrap', answer(401, { 'content-type': 'application/json; charset=utf-8' }), true, gatewayJson);
  assert.equal(json?.code, 'gateway_refused', 'a gateway that refuses in JSON is still not the workbench');
  assert.match(json!.message, /^An access gateway in front of the workbench at unfold\.example refused the request with 401\. The headers stored for it may be wrong, expired or revoked; replace them with Unfold: Set Access Gateway Headers\.$/);
  assert.equal(gatewayFault(origin, '/api/bootstrap', answer(401), true)?.code, 'gateway_refused', 'a refusal without a body is not the workbench either');
  for (const [workbench, body] of [[answer(200, { 'content-type': 'application/json' }), '{}'], [answer(401, { 'content-type': 'application/json; charset=utf-8' }), workbenchJson], [answer(403, { 'content-type': 'application/json' }), '{"error":{"code":"origin","message":"Refused."}}'], [answer(404, { 'content-type': 'text/html' }), 'Not found'], [answer(502, { 'content-type': 'text/html' }), 'Bad gateway']] as const) assert.equal(gatewayFault(origin, '/api/bootstrap', workbench, true, body), undefined);
});

test('access gateway headers are checked as input and can never replace a header the editor sets', async () => {
  assert.equal(gatewayHeaderName(' CF-Access-Client-Id '), 'CF-Access-Client-Id');
  assert.equal(gatewayHeaderValue(' abc.access '), 'abc.access');
  for (const name of ['', 'Two Words', 'Name: value', 'Naïve', 'x'.repeat(65)]) assert.throws(() => gatewayHeaderName(name), /Enter one header name/);
  for (const name of ['Authorization', 'cookie', 'ORIGIN', 'Host', 'Accept', 'Content-Type', 'X-Unfold-Request', 'Transfer-Encoding']) assert.throws(() => gatewayHeaderName(name), /The editor sets .+ itself/);
  for (const value of ['', '   ', 'line\nbreak', 'carriage\rreturn', 'nul\0', 'café', 'x'.repeat(8193)]) assert.throws(() => gatewayHeaderValue(value), /Enter the value on one line/);

  assert.deepEqual(storedGatewayHeaders(undefined), {});
  for (const unreadable of ['not json', '[]', '"text"', 'null']) assert.deepEqual(storedGatewayHeaders(unreadable), {});
  assert.deepEqual(storedGatewayHeaders(JSON.stringify({ Authorization: 'Bearer stolen', 'X-Gateway-Token': 'kept', 'X-Number': 5, 'X-Break': 'a\nb' })), { 'X-Gateway-Token': 'kept' });

  const secrets = new MemorySecrets();
  const client = new UnfoldClient('https://unfold.example', secrets);
  assert.equal(client.gatewayKey, 'unfold.gateway:https://unfold.example');
  await client.setGatewayHeaders({ 'X-Gateway-Id': 'one', 'x-gateway-id': 'two', 'X-Gateway-Secret': ' three ' });
  assert.deepEqual(await client.gatewayHeaders(), { 'x-gateway-id': 'two', 'X-Gateway-Secret': 'three' }, 'a name is one header whatever its case');
  assert.deepEqual(await new UnfoldClient('https://other.example', secrets).gatewayHeaders(), {}, 'headers belong to one origin');
  await assert.rejects(client.setGatewayHeaders({ Cookie: 'unfold=taken' }), /The editor sets Cookie itself/);
  await assert.rejects(client.setGatewayHeaders(Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`X-Header-${index}`, 'v']))), /at most 16 access gateway headers/);
  assert.deepEqual(Object.keys(await client.gatewayHeaders()), ['x-gateway-id', 'X-Gateway-Secret'], 'a refused change keeps what was stored');
  await client.setGatewayHeaders({});
  assert.equal(secrets.values.has(client.gatewayKey), false, 'an empty set forgets the secret');
});

test('behind an access gateway, the stored headers go with API calls, the event stream and downloads, to that workbench only', async t => {
  let elsewhere = 0;
  const loginPage = createServer((_request, response) => { elsewhere++; response.end('sign in'); });
  await new Promise<void>(resolve => loginPage.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => loginPage.close(() => resolve())));
  const loginAddress = loginPage.address();
  assert(loginAddress && typeof loginAddress !== 'string');
  const seen: Array<{ path: string; headers: Record<string, string | string[] | undefined> }> = [];
  const gateway = createServer((request, response) => {
    seen.push({ path: request.url ?? '', headers: request.headers });
    if (request.headers['x-gateway-id'] !== 'editors' || request.headers['x-gateway-secret'] !== 'opaque-gateway-secret') { response.writeHead(302, { Location: `http://127.0.0.1:${loginAddress.port}/login?next=${encodeURIComponent(request.url ?? '')}`, 'Content-Type': 'text/html' }); response.end('<html>sign in</html>'); return; }
    if (request.url === '/api/bootstrap') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ user: { name: 'Ada' }, teams: [] })); return; }
    if (request.url?.startsWith('/api/sessions/session-1/events')) { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end(`data: ${JSON.stringify({ id: 1, sessionId: 'session-1', type: 'session.started' })}\n\n`); return; }
    if (request.url?.startsWith('/api/sessions/session-1/candidate/download')) { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('diff --git a/file b/file\n'); return; }
    response.writeHead(404, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }));
  });
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => gateway.close(() => resolve())));
  const address = gateway.address();
  assert(address && typeof address !== 'string');
  const secrets = new MemorySecrets();
  const client = new UnfoldClient(`http://127.0.0.1:${address.port}`, secrets);
  await secrets.store(client.secretKey, 'unfold=opaque-control-cookie');

  await assert.rejects(client.bootstrap(), (error: unknown) => error instanceof ApiError && error.code === 'gateway_sign_in' && error.message.includes(`redirected the request to 127.0.0.1:${loginAddress.port}.`) && !error.message.includes('next='));
  await assert.rejects(client.stream('session-1', 0, { onEvent: () => undefined }, new AbortController().signal), (error: unknown) => gatewayWantsCredential(error));
  await assert.rejects(client.downloadCandidate('session-1', 'patch'), (error: unknown) => gatewayWantsCredential(error));
  assert.equal(await secrets.get(client.secretKey), 'unfold=opaque-control-cookie', 'a gateway in the way never signs the editor out of the workbench');

  await client.setGatewayHeaders({ 'X-Gateway-Id': 'editors', 'X-Gateway-Secret': 'opaque-gateway-secret' });
  seen.length = 0;
  assert.equal((await client.bootstrap()).user.name, 'Ada');
  const events: number[] = [];
  await client.stream('session-1', 0, { onEvent: event => events.push(event.id) }, new AbortController().signal);
  assert.deepEqual(events, [1]);
  assert.equal(Buffer.from(await client.downloadCandidate('session-1', 'patch')).toString('utf8'), 'diff --git a/file b/file\n');
  assert.deepEqual(seen.map(request => request.path.split('?')[0]), ['/api/bootstrap', '/api/sessions/session-1/events', '/api/sessions/session-1/candidate/download']);
  for (const request of seen) {
    assert.equal(request.headers['x-gateway-secret'], 'opaque-gateway-secret');
    assert.equal(request.headers.cookie, 'unfold=opaque-control-cookie', 'the workbench credential still travels beside the gateway headers');
    assert.equal(request.headers['x-unfold-request'], '1');
    assert.equal(request.headers.origin, client.origin);
  }
  assert.equal(elsewhere, 0, 'neither credential follows a redirect');
});

test('an access gateway that refuses the stored headers keeps the workbench sign-in, and the workbench\'s own 401 still ends it', async t => {
  let mode: 'gateway-json' | 'gateway-html' | 'gateway-large' | 'workbench-forbidden' | 'workbench' = 'gateway-json';
  const server = createServer((_request, response) => {
    if (mode === 'gateway-json') { response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(gatewayJson); return; }
    if (mode === 'gateway-html') { response.writeHead(403, { 'Content-Type': 'text/html' }); response.end('<html>Forbidden</html>'); return; }
    if (mode === 'gateway-large') { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { code: 'unauthenticated', message: 'x'.repeat(70_000) } })); return; }
    if (mode === 'workbench-forbidden') { response.writeHead(403, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { code: 'origin', message: 'Unfold refused this change because it came from another website.' } })); return; }
    response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(workbenchJson);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const secrets = new MemorySecrets();
  const client = new UnfoldClient(`http://127.0.0.1:${address.port}`, secrets);
  await secrets.store(client.secretKey, 'unfold=opaque-control-cookie');
  await client.setGatewayHeaders({ 'X-Gateway-Secret': 'revoked' });
  const refused = (error: unknown) => error instanceof ApiError && error.code === 'gateway_refused' && error.status === 0 && /may be wrong, expired or revoked/.test(error.message);
  for (const gateway of ['gateway-json', 'gateway-html', 'gateway-large'] as const) {
    mode = gateway;
    await assert.rejects(client.bootstrap(), refused, `${gateway} on an API call`);
    await assert.rejects(client.stream('session-1', 0, { onEvent: () => undefined }, new AbortController().signal), refused, `${gateway} on the event stream`);
    await assert.rejects(client.downloadCandidate('session-1', 'patch'), refused, `${gateway} on a download`);
    assert.equal(await secrets.get(client.secretKey), 'unfold=opaque-control-cookie', `${gateway} keeps the workbench sign-in`);
  }
  mode = 'workbench-forbidden';
  await assert.rejects(client.bootstrap(), (error: unknown) => error instanceof ApiError && error.status === 403 && error.code === 'origin' && error.message === 'Unfold refused this change because it came from another website.');
  await assert.rejects(client.stream('session-1', 0, { onEvent: () => undefined }, new AbortController().signal), (error: unknown) => error instanceof ApiError && error.code === 'stream_unavailable');
  await assert.rejects(client.downloadCandidate('session-1', 'patch'), (error: unknown) => error instanceof ApiError && error.code === 'download_failed');
  assert.equal(await secrets.get(client.secretKey), 'unfold=opaque-control-cookie', 'a 403 from the workbench is no sign-out');
  mode = 'workbench';
  await assert.rejects(client.bootstrap(), (error: unknown) => error instanceof ApiError && error.status === 401 && error.code === 'unauthenticated' && error.message === 'Sign in to your workbench.');
  assert.equal(await secrets.get(client.secretKey), undefined, 'the workbench itself ended the session');
  for (const again of [() => client.stream('session-1', 0, { onEvent: () => undefined }, new AbortController().signal), () => client.downloadCandidate('session-1', 'patch')]) {
    await secrets.store(client.secretKey, 'unfold=opaque-control-cookie');
    await assert.rejects(again(), (error: unknown) => error instanceof ApiError && ['unauthenticated', 'download_failed'].includes(error.code));
    assert.equal(await secrets.get(client.secretKey), undefined);
  }
  assert.deepEqual(await client.gatewayHeaders(), { 'X-Gateway-Secret': 'revoked' }, 'signing out of the workbench leaves the access gateway headers');
});

test('invalid route identifiers are rejected before any network action', async () => {
  const client = new UnfoldClient('http://127.0.0.1:1', new MemorySecrets());
  for (const id of ['../login', 'abc/../def', 'session?token=secret', 'https://evil.example']) {
    assert.throws(() => client.session(id));
    assert.throws(() => client.dashboard(id));
  }
});

test('linked demo task import preserves its revision, deduplicates commands and starts only on operator action', { timeout: testTimeout(30_000) }, async t => {
  const server = await application('demo', config => {
    config.taskSources = [{ id: 'demo-tasks', name: 'Demo tasks', provider: 'demo', baseUrl: 'https://example.invalid', project: 'demo', repositoryId: 'order-service', executionOwner: 'interactive' }];
  });
  t.after(() => server.close());
  const client = new UnfoldClient(server.url, new MemorySecrets());
  const sources = await client.taskSources();
  assert.equal(sources[0].provider, 'demo');
  assert.deepEqual((await client.bootstrap()).taskSources, sources);
  const page = await client.tasks('demo-tasks');
  assert.equal(page.tasks[0].id, '1');
  const task = await client.task('demo-tasks', page.tasks[0].id);
  assert.equal(task.revision, page.tasks[0].revision);
  const input = { sourceId: task.sourceId, taskId: task.id, revision: task.revision, teamId: 'delivery', runtime: 'demo', budgetUsd: 3 };
  const [first, repeated] = await Promise.all([client.importTask(input), client.importTask(input)]);
  assert.equal(first.id, repeated.id);
  assert.equal(first.status, 'queued');
  assert(first.runs.every(run => run.status === 'queued'));
  const { descriptionMarkdown, ...snapshot } = task;
  assert.equal(typeof descriptionMarkdown, 'string', 'the preview carries the description as Markdown');
  assert.deepEqual(first.sourceTask, snapshot, 'the stored snapshot is the preview without its Markdown');
  assert.equal((await client.sessions()).length, 1);
  assert.equal((await client.history(first.id)).filter(event => event.type === 'session.created').length, 1);
  await client.action(first.id, 'start');
  await sessionUntil(server.url, first.id, session => ['completed', 'failed'].includes(session.status));
  const completed = await client.session(first.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.costStatus, 'demo');
  assert.equal(completed.candidate?.status, 'ready');
  const manifest = JSON.parse(Buffer.from(await client.downloadCandidate(first.id, 'manifest')).toString('utf8'));
  assert.equal(manifest.sessionId, first.id);
  const patch = Buffer.from(await client.downloadCandidate(first.id, 'patch')).toString('utf8');
  assert.match(patch, /^diff --git/m);
  const bundle = Buffer.from(await client.downloadCandidate(first.id, 'bundle'));
  assert.match(bundle.subarray(0, 80).toString('utf8'), /^# v[23] git bundle\n/);
  assert.equal((await client.importTask(input)).id, first.id, 're-importing a completed revision never starts replacement work');
});

test('a desktop client links Vikunja through the actual authenticated server and refuses stale snapshots and Ploeg execution', { timeout: testTimeout(20_000) }, async t => {
  let title = 'Improve remote task import';
  const requests: { path: string; authorization: string }[] = [];
  const upstream = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    requests.push({ path: url.pathname, authorization: request.headers.authorization ?? '' });
    const task = { id: 42, project_id: 9, title, description: '<script>malicious tracker text</script> Preserve review evidence.', done: false, updated: '2026-09-09T00:00:00Z' };
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/v1/tasks') {
      assert.equal(url.searchParams.get('filter'), 'project_id = 9 && done = false');
      response.end(JSON.stringify([task]));
    } else if (url.pathname === '/api/v1/tasks/42') response.end(JSON.stringify(task));
    else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => upstream.close(() => resolve())));
  const address = upstream.address();
  assert(address && typeof address !== 'string');
  const server = await application('live', config => {
    const source = { id: 'vikunja-work', name: 'Vikunja work', provider: 'vikunja' as const, baseUrl: `http://127.0.0.1:${address.port}/api/v1`, project: '9', repositoryId: 'order-service', token: 'upstream-token-kept-server-side', executionOwner: 'interactive' as const };
    config.taskSources = [source, { ...source, id: 'ploeg-work', project: '10', executionOwner: 'ploeg' }];
  });
  t.after(() => server.close());
  const client = new UnfoldClient(server.url, new MemorySecrets());
  await client.login('admin', 'test-admin-password-314159');
  const bootstrap = await client.bootstrap();
  assert(!JSON.stringify(bootstrap).includes('upstream-token-kept-server-side'));
  assert(!JSON.stringify(bootstrap).includes('/api/v1'));
  const task = (await client.tasks('vikunja-work')).tasks[0];
  assert.equal(task.provider, 'vikunja');
  assert.equal(task.repositoryId, 'order-service');
  assert.match(task.description, /<script>/);
  const input = { sourceId: task.sourceId, taskId: task.id, revision: task.revision, teamId: 'delivery', runtime: 'opencode', budgetUsd: 3 };
  title = 'Task updated after preview';
  await assert.rejects(client.importTask(input), (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'task_changed');
  assert.equal((await client.sessions()).length, 0);
  const fresh = await client.task(task.sourceId, task.id);
  const session = await client.importTask({ ...input, revision: fresh.revision });
  assert.equal(session.status, 'queued');
  assert.equal(session.sourceTask?.title, title);
  assert(session.runs.every(run => run.status === 'queued'));
  await assert.rejects(client.importTask({ ...input, sourceId: 'ploeg-work' }), (error: unknown) => error instanceof ApiError && error.status === 403 && error.code === 'ploeg_owned');
  assert(requests.length >= 4);
  assert(requests.every(request => request.authorization === 'Bearer upstream-token-kept-server-side'));
  assert(requests.every(request => !request.authorization.includes('unfold=')));
});

test('candidate downloads reject redirects and oversized responses without forwarding credentials or retaining a partial file', async t => {
  let targetCalls = 0;
  const target = createServer((_request, response) => { targetCalls++; response.end('unexpected'); });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => target.close(() => resolve())));
  const targetAddress = target.address();
  assert(targetAddress && typeof targetAddress !== 'string');
  let mode = 'redirect';
  const origin = createServer((_request, response) => {
    if (mode === 'redirect') { response.writeHead(302, { Location: `http://127.0.0.1:${targetAddress.port}/artifact` }); response.end(); }
    else { response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': 129 * 1024 * 1024 }); response.end(); }
  });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => origin.close(() => resolve())));
  const address = origin.address();
  assert(address && typeof address !== 'string');
  const secrets = new MemorySecrets();
  const client = new UnfoldClient(`http://127.0.0.1:${address.port}`, secrets);
  await secrets.store(client.secretKey, 'unfold=opaque-download-cookie');
  await assert.rejects(client.downloadCandidate('session-123', 'bundle'), (error: unknown) => error instanceof ApiError && error.code === 'gateway_sign_in');
  assert.equal(targetCalls, 0);
  mode = 'oversized';
  await assert.rejects(client.downloadCandidate('session-123', 'bundle'), (error: unknown) => error instanceof ApiError && error.code === 'response_too_large');
});

async function until(condition: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = deadlineAfter(timeoutMs);
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

test('the live event stream delivers durable events in order, replays after a cursor and stops cleanly on abort', { timeout: testTimeout(30_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const client = new UnfoldClient(server.url, new MemorySecrets());
  const session = await client.create(createInput() as SessionInput);
  const seen: { id: number; type: string }[] = [];
  let opened = false;
  const controller = new AbortController();
  const streaming = client.stream(session.id, 0, { onOpen: () => { opened = true; }, onEvent: event => seen.push({ id: event.id, type: event.type }) }, controller.signal);
  await until(() => opened);
  await client.action(session.id, 'start');
  await sessionUntil(server.url, session.id, value => ['completed', 'failed'].includes(value.status));
  const history = await client.history(session.id);
  await until(() => seen.length >= history.length);
  controller.abort();
  await streaming;
  assert.deepEqual(seen.map(event => event.id), history.map(event => event.id));
  assert(seen.some(event => event.type === 'session.created'));
  assert(seen.some(event => event.type === 'session.completed'));
  assert(seen.every((event, index) => index === 0 || event.id > seen[index - 1].id));
  const cursor = history[2].id;
  const replayed: number[] = [];
  const replay = new AbortController();
  const replaying = client.stream(session.id, cursor, { onEvent: event => replayed.push(event.id) }, replay.signal);
  await until(() => replayed.length >= history.length - 3);
  replay.abort();
  await replaying;
  assert.deepEqual(replayed, history.slice(3).map(event => event.id));
  await assert.rejects(client.stream('../events', 0, { onEvent: () => undefined }, new AbortController().signal));
});

test('the live event stream requires the stored login and never invents one', { timeout: testTimeout(20_000) }, async t => {
  const server = await application('live');
  t.after(() => server.close());
  const secrets = new MemorySecrets();
  const client = new UnfoldClient(server.url, secrets);
  await assert.rejects(client.stream('session-1', 0, { onEvent: () => undefined }, new AbortController().signal), (error: unknown) => error instanceof ApiError && error.status === 401);
  assert.equal(secrets.values.size, 0);
});

test('administrators authorize additional budget through the real mutation contract', { timeout: testTimeout(20_000) }, async t => {
  const server = await application('live');
  t.after(() => server.close());
  const client = new UnfoldClient(server.url, new MemorySecrets());
  await client.login('admin', 'test-admin-password-314159');
  const session = await client.create(createInput({ runtime: 'opencode', budgetUsd: 3 }) as SessionInput);
  assert.throws(() => client.budget(session.id, 0));
  assert.throws(() => client.budget(session.id, -1));
  const increased = await client.budget(session.id, 2);
  assert.equal(increased.budgetUsd, 5);
  assert((await client.history(session.id)).some(event => event.type === 'budget.increased'));
  await assert.rejects(client.budget(session.id, 1000), (error: unknown) => error instanceof ApiError && error.status === 400);
});

test('Ploeg inspection shares workbench identity and opens opaque item links without remote execution', async t => {
  const server = await application();
  t.after(() => server.close());
  const secrets = new MemorySecrets();
  const client = new UnfoldClient(server.url, secrets);
  const overview = await client.ploeg('research', true);
  assert.equal(overview.demo, true);
  assert.equal(overview.selectedTeam, 'research');
  assert.equal(overview.lanes?.queued.items[0].id, '104');
  assert.equal(client.ploegDashboard('9007199254740993'), `${server.url}/#work/9007199254740993`);
  assert.equal(client.ploegDashboard(), `${server.url}/#work`);
  assert.throws(() => client.ploegDashboard('../private'));
  assert.throws(() => client.ploegDashboard('1?token=anything'));
  assert.equal(server.app.store.listSessions().length, 0);
  assert.equal(secrets.values.size, 0);
});

test('Now, a Work Item and its card come from the workbench, scoped to the signed-in identity', async t => {
  const server = await application();
  t.after(() => server.close());
  const client = new UnfoldClient(server.url, new MemorySecrets());
  const now = await client.ploegNow(true);
  assert.equal(now.demo, true);
  assert.ok(now.waiting.length > 0, 'the demo has work waiting on a person');
  assert.ok(now.waiting.every(item => ['awaiting_review', 'needs_human', 'proposed', 'stale'].includes(item.state)));
  const detail = await client.workItem(now.waiting[0].id);
  assert.equal(detail.item.id, now.waiting[0].id);
  assert.ok(Array.isArray(detail.runs) && Array.isArray(detail.shifts));
  const card = await client.workItemCard(now.waiting[0].id);
  assert.ok(card === undefined || card.workItemId === now.waiting[0].id);
  assert.throws(() => client.workItem('../private'));
  assert.equal(server.app.store.listSessions().length, 0);
});

test('a Work Item action from chat lands in the Action Records with the extension as its channel and the agreed confirmation', async t => {
  const server = await application();
  t.after(() => server.close());
  const client = new UnfoldClient(server.url, new MemorySecrets());
  const proposal = (await client.ploegNow(true)).waiting.find(item => item.state === 'proposed');
  assert.ok(proposal, 'the demo has a proposal waiting');
  const confirmation = `vscode-test:${'a'.repeat(64)}`;
  await client.workItemAction(proposal.id, 'approve', {}, { client: 'VS Code chat', confirmation });
  const [record] = server.app.store.actionRecords({ target: { kind: 'work-item', id: proposal.id }, limit: 1 });
  assert.equal(record?.action, 'POST /api/ploeg/work-items/:id/approve');
  assert.match(record?.channel ?? '', /\(VS Code chat\)$/);
  assert.equal(record?.confirmation, confirmation);
  assert.throws(() => client.workItemAction('../private', 'approve', {}, { client: 'VS Code chat', confirmation }));
});

test('the extension sends teamId with crewId beside it and reads the Teams of a workbench older than the rename', async t => {
  const team = { id: 'delivery', name: 'Delivery', description: 'Build then review', roles: [{ name: 'Builder', mode: 'write' }] };
  const bodies: Record<string, unknown>[] = [];
  const older = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/bootstrap') { response.end(JSON.stringify({ user: { id: 'u', name: 'U', role: 'operator' }, mode: 'demo', crews: [team], repositories: [], models: [], runtimes: [], maxBudgetUsd: 25, maxConcurrentSessions: 2 })); return; }
    let text = '';
    request.on('data', chunk => { text += chunk; });
    request.on('end', () => { const body = JSON.parse(text); bodies.push(body); response.statusCode = 201; response.end(JSON.stringify({ id: 's1', crewId: body.crewId })); });
  });
  await new Promise<void>(resolve => older.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => older.close(() => resolve())));
  const address = older.address();
  assert(address && typeof address !== 'string');
  const client = new UnfoldClient(`http://127.0.0.1:${address.port}`, new MemorySecrets());
  assert.deepEqual((await client.bootstrap()).teams, [team]);
  await client.create({ title: 'T', objective: 'O', repositoryId: 'order-service', teamId: 'delivery', runtime: 'demo', budgetUsd: 1 });
  await client.importTask({ sourceId: 'engineering', taskId: '1', revision: 'r', teamId: 'delivery', runtime: 'demo', budgetUsd: 1 });
  assert.deepEqual(bodies.map(body => [body.teamId, body.crewId]), [['delivery', 'delivery'], ['delivery', 'delivery']]);
});
