import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportSettings } from '../src/reports.ts';
import { createIssue, listTasks, readIssueState, validateTaskSources, type FiledIssue, type TaskSourceConfig } from '../src/tasks.ts';
import { widerThanAsked } from '../src/task-providers/github-app.ts';
import type { Repository } from '../src/types.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const keyEnv = 'UNFOLD_TEST_GITHUB_APP_KEY';
process.env[keyEnv] = pem;
const repositories: Repository[] = [{ id: 'orders', name: 'Orders', description: '', url: 'https://github.example/acme/unfold.git', baseBranch: 'main', verify: ['node', '--test'] }];
const asked = { issues: 'write', metadata: 'read', contents: 'read' };

type Call = { method: string; path: string; authorization: string; body: string };
type Answer = { status: number; body: unknown };
type Grant = { token: string; expiresInMs?: number; permissions?: Record<string, string>; selection?: string; repositories?: string[] };

function jwtClaims(authorization: string, key: KeyObject): Record<string, unknown> | undefined {
  const parts = authorization.replace(/^Bearer /, '').split('.');
  if (parts.length !== 3) return undefined;
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (header.alg !== 'RS256' || !verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) return undefined;
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
}

async function fakeGitHub(options: { grants: Grant[]; installation?: Answer; mint?: Answer; repository: (call: Call, token: string) => Answer | undefined; app?: Answer }) {
  const calls: Call[] = [];
  const claims: Record<string, unknown>[] = [];
  const valid = new Set<string>();
  let minted = 0;
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const call = { method: req.method ?? '', path: req.url ?? '', authorization: String(req.headers.authorization ?? ''), body: Buffer.concat(chunks).toString() };
    calls.push(call);
    const answer = ((): Answer => {
      const appRoute = call.path === '/api/v3/app' || call.path.startsWith('/api/v3/app/') || call.path.endsWith('/installation');
      if (appRoute) {
        const claim = jwtClaims(call.authorization, publicKey);
        if (!claim || claim.iss !== 123456) return { status: 401, body: { message: 'A JSON web token could not be decoded' } };
        claims.push(claim);
        if (call.path === '/api/v3/app') return options.app ?? { status: 200, body: { id: 123456, slug: 'unfold-reports' } };
        if (call.path === '/api/v3/repos/acme/unfold/installation') return options.installation ?? { status: 200, body: { id: 42 } };
        if (call.method === 'POST' && call.path === '/api/v3/app/installations/42/access_tokens') {
          if (options.mint) return options.mint;
          const grant = options.grants[Math.min(minted, options.grants.length - 1)];
          minted += 1;
          valid.add(grant.token);
          return { status: 201, body: { token: grant.token, expires_at: new Date(Date.now() + (grant.expiresInMs ?? 3_600_000)).toISOString(), permissions: grant.permissions ?? asked, repository_selection: grant.selection ?? 'selected', repositories: (grant.repositories ?? ['unfold']).map(name => ({ name })) } };
        }
        return { status: 404, body: { message: 'Not Found' } };
      }
      const token = call.authorization.replace(/^Bearer /, '');
      if (!valid.has(token)) return { status: 401, body: { message: 'Bad credentials' } };
      return options.repository(call, token) ?? { status: 404, body: { message: 'Not Found' } };
    })();
    res.writeHead(answer.status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(answer.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}/api/v3`, calls, claims, revoke: (token: string) => valid.delete(token), close: () => new Promise<void>(done => { server.close(() => done()); server.closeIdleConnections(); }) };
}

function appSource(baseUrl: string, app: Partial<NonNullable<TaskSourceConfig['app']>> = {}): TaskSourceConfig {
  return { id: 'gh', name: 'GitHub', provider: 'github', baseUrl, project: 'acme/unfold', repositoryId: 'orders', executionOwner: 'interactive', app: { id: '123456', privateKey: { env: keyEnv }, ...app } };
}

const filing = (call: Call): Answer | undefined => {
  if (call.method === 'GET' && call.path === '/api/v3/repos/acme/unfold/labels/reported-in-app') return { status: 200, body: { name: 'reported-in-app' } };
  if (call.method === 'POST' && call.path === '/api/v3/repos/acme/unfold/issues') return { status: 201, body: { id: 3001, number: 77, html_url: 'https://github.example/acme/unfold/issues/77', labels: [{ name: 'reported-in-app' }] } };
  return undefined;
};

test('a GitHub App source mints an installation token for one repository and named permissions, signs a short JWT and reuses the token until it nears expiry', async t => {
  const github = await fakeGitHub({ grants: [{ token: 'ghs_first' }], repository: filing });
  t.after(() => github.close());
  const source = appSource(github.url);

  await createIssue(source, 'acme/unfold', 'Broken', 'body');
  await createIssue(source, 'acme/unfold', 'Broken again', 'body');

  const mints = github.calls.filter(call => call.path.endsWith('/access_tokens'));
  assert.equal(mints.length, 1, 'the second report reuses the cached token');
  assert.deepEqual(JSON.parse(mints[0].body), { repositories: ['unfold'], permissions: asked });
  assert.deepEqual(github.calls.filter(call => call.path.endsWith('/installation')).length, 1, 'the installation is looked up from the repository once');
  assert(github.calls.filter(call => call.path.startsWith('/api/v3/repos/acme/unfold/') && !call.path.endsWith('/installation')).every(call => call.authorization === 'Bearer ghs_first'));
  const now = Math.floor(Date.now() / 1000);
  for (const claim of github.claims) {
    assert.equal(claim.iss, 123456);
    assert(Number(claim.iat) <= now - 59, 'iat is back-dated against clock drift');
    assert(Number(claim.exp) - Number(claim.iat) <= 600, 'a JWT lives at most ten minutes');
  }
});

test('a token within five minutes of its expiry is minted again, and a configured installation skips the lookup', async t => {
  const github = await fakeGitHub({ grants: [{ token: 'ghs_short', expiresInMs: 4 * 60_000 }, { token: 'ghs_next' }], repository: filing });
  t.after(() => github.close());
  const source = appSource(github.url, { installationId: '42' });

  await createIssue(source, 'acme/unfold', 'One', 'body');
  await createIssue(source, 'acme/unfold', 'Two', 'body');
  await createIssue(source, 'acme/unfold', 'Three', 'body');

  assert.equal(github.calls.filter(call => call.path.endsWith('/access_tokens')).length, 2);
  assert.equal(github.calls.filter(call => call.path.endsWith('/installation')).length, 0);
  assert.equal(github.calls.filter(call => call.path.endsWith('/issues')).at(-1)!.authorization, 'Bearer ghs_next');
});

test('a cached token GitHub answers 401 for is minted once more and the request repeated', async t => {
  const github = await fakeGitHub({ grants: [{ token: 'ghs_revoked' }, { token: 'ghs_fresh' }], repository: (call, token) => {
    if (call.path.startsWith('/api/v3/repos/acme/unfold/issues?')) return { status: 200, body: [{ number: 5, title: 'Read with the fresh token', body: '', state: 'open', updated_at: '2026-11-01T00:00:00Z', labels: [{ name: token }] }] };
    return filing(call);
  } });
  t.after(() => github.close());
  const source = appSource(github.url);

  await createIssue(source, 'acme/unfold', 'Mint', 'body');
  github.revoke('ghs_revoked');
  const page = await listTasks(source);

  assert.deepEqual(page.tasks.map(task => task.title), ['Read with the fresh token']);
  assert.equal(github.calls.filter(call => call.path.endsWith('/access_tokens')).length, 2);
  assert.deepEqual(page.tasks[0].labels?.map(label => label.name), ['[redacted]'], 'the app token is redacted like a configured token');
});

test('a grant wider than asked is refused and never used', async t => {
  for (const grant of [{ token: 'ghs_admin', permissions: { ...asked, administration: 'write' } }, { token: 'ghs_issues_admin', permissions: { ...asked, issues: 'admin' } }, { token: 'ghs_all', selection: 'all' }, { token: 'ghs_two', repositories: ['unfold', 'secrets'] }]) {
    const github = await fakeGitHub({ grants: [grant], repository: filing });
    t.after(() => github.close());
    await assert.rejects(createIssue(appSource(github.url), 'acme/unfold', 'Broken', 'body'), { code: 'github_app_grant_too_wide' }, grant.token);
    assert(!github.calls.some(call => call.authorization === `Bearer ${grant.token}`), `${grant.token} was never sent`);
  }
  assert.deepEqual(widerThanAsked({ permissions: { issues: 'read', metadata: 'read' }, repository_selection: 'selected', repositories: [{ name: 'Unfold' }] }, 'unfold'), [], 'a narrower grant is accepted');
});

test('GitHub App refusals name the fix: not installed, a permission missing, a key GitHub does not accept', async t => {
  const missing = await fakeGitHub({ grants: [], installation: { status: 404, body: { message: 'Not Found' } }, repository: filing });
  t.after(() => missing.close());
  await assert.rejects(createIssue(appSource(missing.url), 'acme/unfold', 'x', 'y'), { code: 'github_app_not_installed' });
  const narrow = await fakeGitHub({ grants: [], mint: { status: 422, body: { message: 'The permissions requested are not granted to this installation.' } }, repository: filing });
  t.after(() => narrow.close());
  await assert.rejects(createIssue(appSource(narrow.url), 'acme/unfold', 'x', 'y'), { code: 'github_app_permissions_missing' });
  const wrongApp = await fakeGitHub({ grants: [], repository: filing });
  t.after(() => wrongApp.close());
  await assert.rejects(createIssue(appSource(wrongApp.url, { id: '999' }), 'acme/unfold', 'x', 'y'), { code: 'github_app_rejected' });
  await assert.rejects(createIssue(appSource(wrongApp.url, { privateKey: { env: 'UNFOLD_TEST_GITHUB_APP_KEY_UNSET' } }), 'acme/unfold', 'x', 'y'), { code: 'github_app_key_unreadable' });
});

test('the label is added after creation when GitHub dropped it from the new issue', async t => {
  const github = await fakeGitHub({ grants: [{ token: 'ghs_label' }], repository: call => {
    if (call.method === 'POST' && call.path === '/api/v3/repos/acme/unfold/issues') return { status: 201, body: { id: 3002, number: 78, html_url: 'https://github.example/acme/unfold/issues/78', labels: [] } };
    if (call.method === 'POST' && call.path === '/api/v3/repos/acme/unfold/issues/78/labels') return { status: 200, body: [{ name: 'reported-in-app' }] };
    return filing(call);
  } });
  t.after(() => github.close());
  await createIssue(appSource(github.url), 'acme/unfold', 'Unlabelled', 'body');
  assert.deepEqual(JSON.parse(github.calls.find(call => call.path.endsWith('/issues/78/labels'))!.body), { labels: ['reported-in-app'] });
});

test('with a GitHub App the comments Unfold wrote are recognised by the App slug, not GET /user', async t => {
  const github = await fakeGitHub({ grants: [{ token: 'ghs_follow' }], repository: call => {
    if (call.path === '/api/v3/repos/acme/unfold/issues/77') return { status: 200, body: { number: 77, state: 'open', labels: [], assignees: [] } };
    if (call.path === '/api/v3/repos/acme/unfold/issues/77/timeline?per_page=100') return { status: 200, body: [
      { id: 1, event: 'commented', body: 'Looking.', user: { login: 'ada' }, created_at: '2026-11-01T10:00:00Z' },
      { id: 2, event: 'commented', body: '**Someone** adds, from Unfold', user: { login: 'unfold-reports[bot]' }, created_at: '2026-11-01T11:00:00Z' },
    ] };
    return undefined;
  } });
  t.after(() => github.close());
  const issue: FiledIssue = { id: '3001', number: '77', url: 'https://github.example/acme/unfold/issues/77' };
  const state = await readIssueState(appSource(github.url), 'acme/unfold', issue, '0.0.0');
  assert.deepEqual(state.comments.map(comment => [comment.author, comment.mine]), [['ada', false], ['unfold-reports[bot]', true]]);
  assert(!github.calls.some(call => call.path === '/api/v3/user'), 'an installation token cannot read GET /user');
  assert(github.calls.some(call => call.path === '/api/v3/app'));
});

test('a GitHub source takes exactly one credential, and only GitHub takes githubApp', t => {
  process.env.UNFOLD_TEST_GITHUB_TOKEN = 'github-token';
  t.after(() => { delete process.env.UNFOLD_TEST_GITHUB_TOKEN; });
  const source = (extra: Record<string, unknown>, provider = 'github') => [{ id: 'gh', name: 'GitHub', provider, baseUrl: provider === 'github' ? 'https://api.github.com' : 'https://forge.example/api/v1', project: 'acme/unfold', repositoryId: 'orders', executionOwner: 'interactive', ...extra }];
  const app = { appId: 123456, privateKeyEnv: keyEnv };
  const [configured] = validateTaskSources(source({ githubApp: app }), repositories, 'live');
  assert.deepEqual(configured.app, { id: '123456', privateKey: { env: keyEnv } });
  assert.equal(configured.token, undefined);
  assert.throws(() => validateTaskSources(source({ githubApp: app, tokenEnv: 'UNFOLD_TEST_GITHUB_TOKEN' }), repositories, 'live'), /sets both tokenEnv and githubApp; use exactly one credential/);
  assert.throws(() => validateTaskSources(source({ githubApp: app }, 'forgejo'), repositories, 'live'), /sets githubApp, which Forgejo sources do not take/);
  assert.throws(() => validateTaskSources(source({ githubApp: { appId: 123456 } }), repositories, 'live'), /exactly one of privateKeyEnv and privateKeyFile/);
  assert.throws(() => validateTaskSources(source({ githubApp: { ...app, privateKeyFile: '/run/key.pem' } }), repositories, 'live'), /exactly one of privateKeyEnv and privateKeyFile/);
  assert.throws(() => validateTaskSources(source({ githubApp: { ...app, appId: 'acme' } }), repositories, 'live'), /numeric App ID or its Client ID/);
  assert.throws(() => validateTaskSources(source({ githubApp: { appId: 1, privateKeyEnv: 'UNFOLD_TEST_GITHUB_APP_KEY_UNSET' } }), repositories, 'live'), /private key is missing/);
  const dir = mkdtempSync(join(tmpdir(), 'unfold-app-key-'));
  writeFileSync(join(dir, 'key.pem'), pem);
  writeFileSync(join(dir, 'bad.pem'), 'not a key');
  assert.deepEqual(validateTaskSources(source({ githubApp: { appId: 'Iv23liAbCdEf', installationId: 42, privateKeyFile: join(dir, 'key.pem') } }), repositories, 'live')[0].app, { id: 'Iv23liAbCdEf', installationId: '42', privateKey: { file: join(dir, 'key.pem') } });
  assert.throws(() => validateTaskSources(source({ githubApp: { appId: 1, privateKeyFile: join(dir, 'bad.pem') } }), repositories, 'live'), /not a PEM RSA private key/);
});

test('reports take tokenEnv or githubApp, never both or neither, and a source that is an App files with a token for the report project', t => {
  process.env.UNFOLD_TEST_REPORTS_TOKEN = 'reports-token';
  t.after(() => { delete process.env.UNFOLD_TEST_REPORTS_TOKEN; });
  const own = { provider: 'github', baseUrl: 'https://github.example/api/v3', project: 'Acme/Unfold' };
  const app = { appId: 123456, privateKeyEnv: keyEnv };
  const target = reportSettings({ ...own, githubApp: app }, [], 'live');
  assert.deepEqual({ project: target?.project, sourceProject: target?.source.project, app: target?.source.app, token: target?.source.token }, { project: 'acme/unfold', sourceProject: 'acme/unfold', app: { id: '123456', privateKey: { env: keyEnv } }, token: undefined });
  assert.throws(() => reportSettings({ ...own, githubApp: app, tokenEnv: 'UNFOLD_TEST_REPORTS_TOKEN' }, [], 'live'), /both tokenEnv and githubApp/);
  assert.throws(() => reportSettings(own, [], 'live'), /reports.tokenEnv must name an environment variable, or reports.githubApp must name the app Unfold files as/);
  assert.throws(() => reportSettings({ ...own, provider: 'forgejo', baseUrl: 'https://forge.example/api/v1', githubApp: app }, [], 'live'), /sets githubApp, which Forgejo sources do not take/);
  const warned: string[] = [];
  const error = console.error;
  console.error = (line: string) => { warned.push(line); };
  try { assert.equal(reportSettings({ ...own, githubApp: { appId: 1, privateKeyEnv: 'UNFOLD_TEST_GITHUB_APP_KEY_UNSET' } }, [], 'live'), null); } finally { console.error = error; }
  assert.match(warned.join('\n'), /reports\.app_key_missing/);

  const source: TaskSourceConfig = { ...appSource('https://github.example/api/v3'), executionOwner: 'ploeg' };
  const elsewhere = reportSettings({ source: 'gh', project: 'acme/feedback' }, [source], 'live');
  assert.deepEqual({ project: elsewhere?.project, sourceProject: elsewhere?.source.project }, { project: 'acme/feedback', sourceProject: 'acme/feedback' }, 'the App token is minted for the repository reports go to');
});
