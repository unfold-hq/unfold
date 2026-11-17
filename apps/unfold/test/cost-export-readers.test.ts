import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FactsRun, WorkItemFacts } from '../src/cards/facts.ts';
import { CostExportReaders, costExportReaderSettings, kubernetesTokenReviewer, readerPrincipal, readerRoute, type CostExportReader, type TokenReviewer } from '../src/cost-export-readers.ts';
import { ploegDemo } from '../src/ploeg-demo.ts';
import { application, login, request } from './api-support.ts';

const reader: CostExportReader = { id: 'billing', serviceAccount: 'billing/focus-reader', audience: 'unfold-cost-export', tenant: 'default', teams: ['delivery'] };
const username = 'system:serviceaccount:billing:focus-reader';
const live = { mode: 'live' as const, ploeg: { url: 'http://ploeg.invalid', tokenEnv: 'PLOEG_TOKEN' } };
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as IncomingMessage;
const jwt = (name: string) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(name).toString('base64url')}.c2lnbmF0dXJl`;

test('costExportReaders accepts a reader for one service account, audience, Tenant and Teams, and refuses anything looser', () => {
  assert.deepEqual(costExportReaderSettings([reader], live), [reader]);
  assert.deepEqual(costExportReaderSettings([], { mode: 'demo' }), []);
  const refused = (entry: Record<string, unknown>, config: Parameters<typeof costExportReaderSettings>[1] = live) => assert.throws(() => costExportReaderSettings([{ ...reader, ...entry }], config));
  refused({ serviceAccount: 'focus-reader' });
  refused({ serviceAccount: 'Billing/focus-reader' });
  refused({ audience: 'unfold-relay' });
  refused({ audience: 'has space' });
  refused({ tenant: 'Not A Tenant' });
  refused({ teams: [] });
  refused({ role: 'admin' });
  refused({}, { mode: 'demo' });
  refused({}, { mode: 'live' });
  refused({}, { mode: 'live', ploeg: { ...live.ploeg, teams: ['research'] } });
  assert.throws(() => costExportReaderSettings([reader, { ...reader, id: 'other' }], live), /serviceAccount billing\/focus-reader twice/);
  assert.throws(() => costExportReaderSettings([reader, { ...reader, serviceAccount: 'billing/other' }], live), /id billing twice/);
});

test('a reader is proven only by a token the API server accepts for its audience and its exact service account', async () => {
  const asked: string[][] = [];
  const answers: Record<string, Awaited<ReturnType<TokenReviewer>>> = {
    valid: { username, audiences: ['unfold-cost-export'] },
    otherAudience: { username, audiences: ['https://kubernetes.default.svc'] },
    otherAccount: { username: 'system:serviceaccount:billing:focus-reader-2', audiences: ['unfold-cost-export'] },
    otherNamespace: { username: 'system:serviceaccount:other:focus-reader', audiences: ['unfold-cost-export'] },
    expired: undefined,
  };
  const review: TokenReviewer = async (token, audiences) => { asked.push(audiences); return answers[Buffer.from(token.split('.')[1]!, 'base64url').toString()]; };
  const readers = new CostExportReaders([reader, { ...reader, id: 'second', serviceAccount: 'billing/second', audience: 'second-audience' }], review);
  const proven = bearer(jwt('valid'));
  const principal = await readers.authenticate(proven);
  assert.deepEqual(principal, readerPrincipal(reader));
  assert.equal(readers.principal(proven), principal);
  assert.equal(readers.readerOf(principal!), readers.readerOf(principal!));
  assert.equal(readers.readerOf(principal!)?.id, 'billing');
  assert.equal(readers.readerOf({ ...principal! }), undefined, 'a person whose id looks like a reader is no reader');
  assert.deepEqual(asked[0], ['unfold-cost-export', 'second-audience']);
  for (const name of ['otherAudience', 'otherAccount', 'otherNamespace', 'expired']) {
    const req = bearer(jwt(name));
    assert.equal(await readers.authenticate(req), undefined, name);
    assert.equal(readers.principal(req), undefined, name);
  }
  const reviews = asked.length;
  for (const req of [bearer('vle_not-a-jwt'), bearer(`${jwt('valid')}.extra`), { headers: {} } as IncomingMessage, { headers: { authorization: `Basic ${jwt('valid')}` } } as IncomingMessage]) assert.equal(await readers.authenticate(req), undefined);
  assert.equal(asked.length, reviews, 'only a bearer JWT is sent to the API server');
  const failing = new CostExportReaders([reader], async () => { throw new Error('tokenreviews is forbidden'); });
  assert.equal(await failing.authenticate(bearer(jwt('valid'))), undefined, 'a review that fails proves nothing');
  assert.equal(await new CostExportReaders([], review).authenticate(bearer(jwt('valid'))), undefined, 'no readers, no review');
});

test('the TokenReview answer counts only when the API server authenticated the token', async () => {
  let sent: any;
  const reviewer = (status: unknown) => kubernetesTokenReviewer({ request: async (_path: string, _method?: string, body?: unknown) => { sent = body; return { status }; } } as any);
  assert.deepEqual(await reviewer({ authenticated: true, user: { username }, audiences: ['unfold-cost-export'] })('t', ['unfold-cost-export']), { username, audiences: ['unfold-cost-export'] });
  assert.deepEqual(sent, { apiVersion: 'authentication.k8s.io/v1', kind: 'TokenReview', spec: { token: 't', audiences: ['unfold-cost-export'] } });
  assert.equal(await reviewer({ authenticated: false, error: 'token has expired', user: { username }, audiences: ['unfold-cost-export'] })('t', ['unfold-cost-export']), undefined);
  assert.equal(await reviewer({ authenticated: true, user: { username } })('t', ['unfold-cost-export']), undefined);
});

test('only GET /api/ploeg/cost-export is a reader route', () => {
  assert.equal(readerRoute('GET', '/api/ploeg/cost-export'), true);
  for (const [method, path] of [['POST', '/api/ploeg/cost-export'], ['GET', '/api/ploeg/cost-export/x'], ['GET', '/api/ploeg/deliveries'], ['GET', '/api/ploeg/now']]) assert.equal(readerRoute(method!, path!), false, `${method} ${path}`);
});

const iso = (ms: number) => new Date(ms).toISOString();

function run(id: string, finished: number): FactsRun {
  return { id, shiftId: '1', role: 'builder', round: 1, writes: true, state: 'finished', startedAt: iso(finished - 600_000), finishedAt: iso(finished), outcome: 'pr_opened', links: [], authorizedUsd: 5, usage: { costUsd: 0.75 } };
}

function facts(id: string, team: string, target: [string, string] | null, finished: number): WorkItemFacts {
  return {
    workItem: { id, provider: 'vikunja', externalId: id, externalRef: `VIK-${id}`, url: '', title: `Work Item ${id}`, state: 'done', team, createdAt: iso(finished - 86_400_000), updatedAt: iso(finished), trackerCreatedAt: null, estimateSeconds: null, target: target ? { forge: 'forgejo', owner: target[0], repo: target[1], baseBranch: 'main' } : null, epics: [], withdrawals: [] },
    activityAt: iso(finished), shifts: [], runs: [run(`${id}0`, finished)], liveUsage: [], pullRequests: [], statusTransitions: [], gateTransitions: [], deployEnvironments: [], roster: [], botLogins: [],
    truncated: { shifts: false, runs: false, pullRequests: false, statusTransitions: false, gateTransitions: false },
  };
}

test('a billing job reads the FOCUS export with its service account token: its Tenant and Teams only, that route only, audited as the reader', async t => {
  const env = `UNFOLD_PLOEG_TEST_${randomBytes(8).toString('hex').toUpperCase()}`;
  const ploegToken = randomBytes(24).toString('hex');
  process.env[env] = ploegToken;
  const finished = Date.now() - 3_600_000;
  const all = [facts('41', 'delivery', null, finished), facts('42', 'research', null, finished), facts('43', 'delivery', ['agency', 'site'], finished)];
  const ploeg = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${ploegToken}`) { res.writeHead(401).end(); return; }
    const send = (data: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ schemaVersion: '1.0', ...data }));
    if (req.url!.includes('/teams')) return send({ teams: ploegDemo.teams });
    if (req.url!.includes('/facts?')) return send({ facts: all, nextBefore: null });
    res.writeHead(404).end();
  });
  const reviews: { token: string; audiences: string[] }[] = [];
  const statuses: Record<string, object> = {
    valid: { authenticated: true, user: { username }, audiences: ['unfold-cost-export'] },
    otherAccount: { authenticated: true, user: { username: 'system:serviceaccount:billing:someone-else' }, audiences: ['unfold-cost-export'] },
    otherAudience: { authenticated: false, error: 'token audiences ["https://kubernetes.default.svc"] is invalid for the target audiences ["unfold-cost-export"]' },
    expired: { authenticated: false, error: 'service account token has expired' },
  };
  const kubernetes = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/apis/authentication.k8s.io/v1/tokenreviews' || req.headers.authorization !== 'Bearer workbench-token') { res.writeHead(403).end(); return; }
      const spec = JSON.parse(Buffer.concat(chunks).toString()).spec;
      reviews.push(spec);
      const name = Buffer.from(String(spec.token).split('.')[1] ?? '', 'base64url').toString();
      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ kind: 'TokenReview', status: statuses[name] ?? { authenticated: false } }));
    });
  });
  const directory = await mkdtemp(join(tmpdir(), 'unfold-reader-'));
  await writeFile(join(directory, 'token'), 'workbench-token');
  await writeFile(join(directory, 'ca.crt'), 'unused-by-plain-http-fixture');
  const originalRequest = https.request;
  t.mock.method(https, 'request', (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const target = new URL(url);
    target.protocol = 'http:';
    return httpRequest(target, options, callback);
  });
  syncBuiltinESMExports();
  for (const server of [ploeg, kubernetes]) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  t.after(async () => {
    https.request = originalRequest;
    syncBuiltinESMExports();
    for (const server of [ploeg, kubernetes]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    await rm(directory, { recursive: true, force: true });
    delete process.env[env];
  });
  const port = (server: typeof ploeg) => (server.address() as { port: number }).port;
  const app = await application('live', config => {
    config.ploeg = { url: `http://127.0.0.1:${port(ploeg)}`, tokenEnv: env };
    config.repositories.push({ id: 'agency-site', name: 'Agency site', description: 'Owned by another Tenant', url: 'https://forge.example/agency/site', baseBranch: 'main', verify: [], tenant: 'agency' });
    config.kubernetes = { namespace: 'unfold-workspaces', image: 'unused', storageSize: '1Gi', cpu: '1', memory: '1Gi', apiUrl: `https://127.0.0.1:${port(kubernetes)}`, tokenFile: join(directory, 'token'), caFile: join(directory, 'ca.crt'), workspaceRetentionDays: 0 };
    config.costExportReaders = [reader];
    config.flags = { document: { flags: { 'audit.export': { defaultVariant: 'on' } } }, unknown: [] };
  });
  t.after(() => app.close());
  const as = (name: string) => ({ headers: { authorization: `Bearer ${jwt(name)}` }, csrf: false });
  const resources = (text: string) => text.split('\r\n').slice(1).filter(Boolean).map(line => line.split(',').find(cell => cell.startsWith('unfold:run:'))).sort();

  const read = await request(app.url, '/api/ploeg/cost-export', as('valid'));
  assert.equal(read.status, 200, read.text);
  assert.deepEqual(resources(read.text), ['unfold:run:410'], 'only its Tenant and its Teams');
  assert.deepEqual(reviews.at(-1)?.audiences, ['unfold-cost-export']);
  const admin = await login(app.url);
  assert.deepEqual(resources((await request(app.url, '/api/ploeg/cost-export', { cookie: admin.cookie })).text), ['unfold:run:410', 'unfold:run:420', 'unfold:run:430'], 'an administrator still reads every Team and Tenant');
  assert.equal((await request(app.url, '/api/ploeg/cost-export?tenant=agency', as('valid'))).text.split('\r\n').filter(Boolean).length, 1, 'asking for another Tenant gives no rows');

  for (const name of ['otherAccount', 'otherAudience', 'expired', 'unknown']) {
    const refused = await request(app.url, '/api/ploeg/cost-export', as(name));
    assert.deepEqual([refused.status, refused.body?.error?.code], [401, 'unauthenticated'], name);
  }
  for (const [method, path] of [['GET', '/api/ploeg/now'], ['GET', '/api/ploeg/deliveries'], ['GET', '/api/me'], ['POST', '/api/ploeg/work-items/41/notes'], ['GET', '/api/no-such-route']] as const) {
    const response = await fetch(`${app.url}${path}`, { method, headers: { authorization: `Bearer ${jwt('valid')}`, 'x-unfold-request': '1', 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.deepEqual([response.status, (await response.json()).error.code], [403, 'reader_route'], `${method} ${path}`);
  }

  let audited: string[] = [];
  for (let attempt = 0; attempt < 50 && !audited.some(event => event.includes('FOCUS cost export') && event.includes('reader:billing')); attempt++) {
    audited = (await request(app.url, '/api/admin/audit', { cookie: admin.cookie })).text.split('\n').filter(Boolean);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const download = audited.map(line => JSON.parse(line)).find(event => JSON.stringify(event).includes('reader:billing'));
  assert.ok(download, 'the audit records the reader');
  assert.match(JSON.stringify(download), /FOCUS cost export/);
});

test('the chart lets the workbench create TokenReviews for readers only when costExportReaders lists one', { skip: spawnSync('helm', ['version'], { stdio: 'ignore' }).status !== 0 && 'helm is unavailable' }, () => {
  const chart = fileURLToPath(new URL('../ops/helm/unfold', import.meta.url));
  const render = (...extra: string[]) => spawnSync('helm', ['template', 'unfold', chart, '--set', 'ploeg.enabled=false', '--set', 'mode=live', '--set', 'workspacePodRuntimeClassName=kata', ...extra], { encoding: 'utf8' });
  const configured = render('--set-json', `config.costExportReaders=${JSON.stringify([reader])}`);
  assert.equal(configured.status, 0, configured.stderr);
  assert.match(configured.stdout, /kind: ClusterRole\nmetadata:\n\s+name: default-unfold-reader-tokens\nrules:\n\s+- apiGroups: \[authentication\.k8s\.io\]\n\s+resources: \[tokenreviews\]\n\s+verbs: \[create\]/);
  assert.match(configured.stdout, /kind: ClusterRoleBinding\nmetadata:\n\s+name: default-unfold-reader-tokens\nsubjects:\n\s+- kind: ServiceAccount\n\s+name: unfold\n/);
  for (const none of [render(), render('--set-json', 'config.costExportReaders=[]')]) {
    assert.equal(none.status, 0, none.stderr);
    assert.doesNotMatch(none.stdout, /tokenreviews|reader-tokens/);
  }
  const demo = render('--set', 'mode=demo', '--set-json', `config.costExportReaders=${JSON.stringify([reader])}`);
  assert.notEqual(demo.status, 0);
  assert.match(demo.stderr, /costExportReaders needs mode live/);
});
