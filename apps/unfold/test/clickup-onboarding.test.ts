import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig, User } from '../src/types.ts';
import { Store } from '../src/store.ts';
import { PloegClient, PloegError, type PloegConnections, type PloegTeam } from '../src/ploeg.ts';
import { Onboarding } from '../src/onboarding.ts';
import { TrackerConnections } from '../src/tracker-connections.ts';
import { ClickUpOnboarding, sourceLine, type ClickUpChange } from '../src/clickup-onboarding.ts';
import { clickUpRoute } from '../src/clickup-onboarding-http.ts';
import { HttpPloegConnectionApi } from '../src/ploeg-connection-api.ts';
import { configuration } from './api-support.ts';

const admin: User = { id: 'admin-1', name: 'ada@agency.example', role: 'admin' };
const developer: User = { id: 'dev-1', name: 'Dev', role: 'operator' };
const memberToken = 'pk_9001_UNFOLDMEMBERTOKEN';
const adaToken = 'pk_8812_ADASOWNTOKENVALUE';
const clock = () => new Date('2026-11-18T10:00:00.000Z');
const capped = (id: string, spendCap: PloegTeam['spendCap']): PloegTeam => ({ id, paused: false, queueDepth: 0, roles: [], assignees: [], pinnedScopes: [], spendCap });
const repository = (key: string, repo: string, readiness: 'ready' | 'not_ready') => ({ key, label: null, forge: 'github', owner: 'acme', repo, baseBranch: 'main', readiness, reason: '', lastForgeEventAt: null, boards: [] });
const wiring = (): PloegConnections => ({ demo: false, supported: true, checkedAt: null, eventWindowDays: 30, repositories: [repository('shop', 'shop', 'ready'), repository('docs', 'docs', 'not_ready')], boards: [], unrouted: [], fetchedAt: clock().toISOString() });

type Seen = { method: string; path: string; body: Record<string, unknown> | null };
type Fake = { seen: Seen[]; states: string[]; answers: Map<string, { status: number; body?: unknown }>; bindings: Record<string, unknown>[]; config: { url: string; tokenEnv: string } };

/** A fake Ploeg serving the connection and binding routes of Ploeg ADR-0195 and ADR-0186; `answers` overrides one `METHOD path` with a status and body. */
async function fakePloeg(t: TestContext): Promise<Fake> {
  const env = `UNFOLD_CLICKUP_TEST_${randomBytes(6).toString('hex').toUpperCase()}`;
  process.env[env] = randomBytes(24).toString('hex');
  const fake: Fake = { seen: [], states: [], answers: new Map(), bindings: [], config: { url: '', tokenEnv: env } };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url!, 'http://ploeg.invalid');
    const path = `${url.pathname.replace('/api/v1/operator/', '')}${url.search}`;
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    fake.seen.push({ method: req.method!, path, body });
    const reply = (status: number, value?: unknown) => { if (value === undefined) { res.writeHead(status).end(); return; } res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value)); };
    const override = fake.answers.get(`${req.method} ${path}`);
    if (override) return reply(override.status, override.body);
    if (req.method === 'POST' && path === 'connection-flows') { fake.states.push(`state-${randomBytes(12).toString('hex')}`); return reply(201, { flow: { id: 'flow-1', method: body?.method, expiresAt: '2026-11-18T10:15:00Z', state: fake.states.at(-1) }, next: body?.method === 'oauth' ? { authorizeUrl: 'https://app.clickup.com/api?client_id=x&state=s' } : {} }); }
    if (req.method === 'POST' && path === 'connection-flows/complete') {
      const own = body?.token === adaToken;
      return reply(201, { connection: { id: own ? 'clickup-ada' : 'clickup-unfold', kind: 'clickup', instance: 'clickup', method: body?.token ? 'token' : 'oauth', source: 'runtime', state: 'active', account: own ? { id: '7', login: 'Ada', email: 'ada@agency.example' } : { id: '42', login: 'unfold', email: 'unfold@agency.example' }, handOverAgent: true } });
    }
    if (req.method === 'GET' && path.startsWith('tracker-connections?')) return reply(200, { connections: [{ id: 'clickup-unfold', kind: 'clickup', state: 'active', source: 'runtime', account: { id: '42', login: 'unfold' } }] });
    if (req.method === 'DELETE' && path.startsWith('tracker-connections/')) return reply(204);
    if (req.method === 'GET' && path === 'tracker-bindings') return reply(200, { bindings: fake.bindings });
    if (req.method === 'POST' && path === 'teams/delivery/tracker-bindings?dryRun=true') return reply(200, { binding: { team: 'delivery', connection: 'clickup-unfold', scope: { id: '777', name: 'Sprint 12' }, default: 'shop', allow: [] }, checks: [{ id: 'scope_readable', status: 'ok' }, { id: 'target_ready', status: 'ok' }] });
    if (req.method === 'POST' && path === 'teams/delivery/tracker-bindings') {
      const existing = fake.bindings.find(entry => entry.id === 'b-1');
      if (existing) return reply(200, { binding: existing, created: false });
      const made = { id: 'b-1', team: 'delivery', connection: 'clickup-unfold', scope: { id: '777', name: 'Sprint 12' }, default: 'shop', allow: [], state: 'awaiting_webhook', webhookReason: 'ClickUp has no webhook for this List yet', source: 'runtime', revision: 1 };
      fake.bindings.push(made);
      return reply(201, { binding: made, created: true });
    }
    if (req.method === 'DELETE' && path.startsWith('teams/delivery/tracker-bindings/')) { fake.bindings = fake.bindings.filter(entry => entry.id !== path.split('/').at(-1)); return reply(204); }
    reply(404, { error: { code: 'not_found', message: 'No such route.' } });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); delete process.env[env]; });
  const address = server.address();
  assert(address && typeof address !== 'string');
  fake.config.url = `http://127.0.0.1:${address.port}`;
  return fake;
}

async function setup(t: TestContext, options: { served?: Record<string, boolean>; teams?: PloegTeam[] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-clickup-'));
  const file = join(directory, 'clickup.sqlite');
  const store = new Store(file);
  t.after(async () => { try { store.close(); } catch {} await rm(directory, { recursive: true, force: true }); });
  const fake = await fakePloeg(t);
  const config: AppConfig = { ...configuration(directory, 'live'), baseUrl: 'https://unfold.example', ploeg: fake.config };
  config.repositories.push({ id: 'shop', name: 'Shop', description: 'The webshop', url: 'https://github.com/acme/shop.git', baseBranch: 'main', verify: ['true'] }, { id: 'docs', name: 'Docs', description: 'The docs', url: 'https://github.com/acme/docs.git', baseBranch: 'main', verify: ['true'] });
  const served = { 'tracker-connections': true, 'tracker-bindings': true, ...options.served };
  const teams = options.teams ?? [capped('delivery', { usd: 20, period: 'day', periodEnd: '2026-11-19T00:00:00Z', remainingUsd: 20 })];
  const reads = { connections: async () => wiring(), routing: async () => ({ all: teams }), serves: async (_user: User, route: string) => served[route as keyof typeof served] ?? false };
  const onboarding = new Onboarding({ store, ploeg: reads, now: clock, pinned: '0.2.0-rc.110', config: { repositories: config.repositories, taskSources: [] } });
  const connections = new TrackerConnections(store, config, { enforced: false, now: clock, log: () => undefined });
  const client = new PloegClient(config);
  const changes: ClickUpChange[] = [];
  const clickup = new ClickUpOnboarding({ steps: onboarding, api: new HttpPloegConnectionApi((user, path, call) => client.operatorCall(user, path, call)), reads, connections, config, store, now: clock, pinned: '0.2.0-rc.110', audit: change => changes.push(change) });
  onboarding.useStepLines(manage => clickup.lines(manage));
  return { store, file, fake, config, onboarding, connections, clickup, changes };
}

const rejects = (code: string, status?: number) => (error: unknown) => error instanceof PloegError && error.code === code && (status === undefined || error.status === status);
const writes = (fake: Fake) => fake.seen.filter(entry => entry.method !== 'GET');

test('a malformed token is refused before any request leaves Unfold, and someone who is not an Admin connects nothing', async t => {
  const { clickup, fake } = await setup(t);
  await assert.rejects(clickup.connectWithToken(admin, { token: 'not-a-clickup-token' }), rejects('connection_token_invalid', 400));
  await assert.rejects(clickup.connectWithToken(developer, { token: memberToken }), rejects('forbidden', 403));
  assert.deepEqual(fake.seen, [], 'Ploeg was asked nothing');
});

test('while Ploeg does not serve the connection step, connecting is refused with ploeg_step_unavailable and no write is sent', async t => {
  const { clickup, fake } = await setup(t, { served: { 'tracker-connections': false } });
  await assert.rejects(clickup.connectWithToken(admin, { token: memberToken }), rejects('ploeg_step_unavailable', 503));
  await assert.rejects(clickup.lists(admin, 'tc-000000000000'), rejects('connection_not_found', 404));
  assert.deepEqual(writes(fake), []);
});

test('the member token goes to Ploeg’s token flow once, and Unfold keeps the connection id and never the token', async t => {
  const { clickup, fake, connections, store, file, changes } = await setup(t);
  const kept = await clickup.connectWithToken(admin, { token: memberToken });
  assert.deepEqual(writes(fake).map(entry => `${entry.method} ${entry.path}`), ['POST connection-flows', 'POST connection-flows/complete']);
  assert.deepEqual({ ...writes(fake)[0].body }, { port: 'tracker', kind: 'clickup', instance: 'clickup', method: 'token', label: 'Unfold member', handOverAgent: true });
  assert.equal(writes(fake)[1].body?.token, memberToken, 'the token reached Ploeg');
  assert.deepEqual(kept.ploeg, { connection: 'clickup-unfold', method: 'token', accountId: '42' });
  assert.equal(kept.account, 'unfold');
  assert.equal(connections.list(admin)[0].token, 'held_by_ploeg');
  assert.equal(store.getSecret(`tracker-connection:${kept.id}`), undefined, 'no sealed token');
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  assert(!readFileSync(file).includes(memberToken), 'the token is nowhere in Unfold’s database file');
  assert(!JSON.stringify(changes).includes(memberToken), 'nor in the audit change');
  await assert.rejects(connections.replaceToken(admin, kept.id, { token: memberToken }), (error: unknown) => (error as { code?: string }).code === 'connection_held_by_ploeg', 'the ADR-0064 replace route never writes a token for it');
  assert.equal(clickup.lines(true)['connect-clickup']?.status, 'ok');
});

test('the Admin’s own token is removed from Ploeg again and refused with connection_token_personal', async t => {
  const { clickup, fake, connections } = await setup(t);
  await assert.rejects(clickup.connectWithToken(admin, { token: adaToken }), rejects('connection_token_personal', 400));
  assert.deepEqual(writes(fake).at(-1), { method: 'DELETE', path: 'tracker-connections/clickup-ada', body: {} });
  assert.deepEqual(connections.connections(), []);
});

test('an OAuth code is relayed only for the person and browser sign-in that started it, once', async t => {
  const { clickup, fake } = await setup(t);
  const { authorizeUrl } = await clickup.startOAuth(admin, 'sign-in-1');
  assert.match(authorizeUrl, /^https:\/\/app\.clickup\.com\//);
  assert.equal(writes(fake)[0].body?.redirectUri, 'https://unfold.example/api/onboarding/clickup/callback');
  const first = fake.states.at(-1)!;
  await assert.rejects(clickup.completeOAuth(admin, 'sign-in-2', 'code-1', first), rejects('onboarding_state_invalid', 400), 'another browser sign-in is refused');
  await assert.rejects(clickup.completeOAuth(admin, 'sign-in-1', 'code-1', first), rejects('onboarding_state_invalid', 400), 'and the state is forgotten on first use');
  await assert.rejects(clickup.completeOAuth(admin, 'sign-in-1', 'code-1', 'state-never-issued-by-ploeg'), rejects('onboarding_state_invalid', 400));
  assert.equal(writes(fake).filter(entry => entry.path === 'connection-flows/complete').length, 0, 'nothing was relayed');
  await clickup.startOAuth(admin, 'sign-in-1');
  const second = fake.states.at(-1)!;
  const kept = await clickup.completeOAuth(admin, 'sign-in-1', 'code-2', second);
  assert.deepEqual(writes(fake).at(-1), { method: 'POST', path: 'connection-flows/complete', body: { state: second, code: 'code-2' } });
  assert.equal(kept.ploeg?.method, 'oauth');
  await assert.rejects(clickup.completeOAuth(admin, 'sign-in-1', 'code-2', second), rejects('onboarding_state_invalid', 400), 'a replayed callback relays nothing');
});

test('binding a List runs the dry run first, offers only ready repositories, and a retried create leaves one binding', async t => {
  const { clickup, fake, connections, config, changes } = await setup(t);
  const kept = await clickup.connectWithToken(admin, { token: memberToken });
  const options = await clickup.mapOptions(admin);
  assert.deepEqual(options.repositories.map(entry => entry.key), ['shop']);
  assert.deepEqual(options.waiting, ['acme/docs']);
  const before = writes(fake).length;
  await assert.rejects(clickup.bind(admin, { connection: kept.id, list: { id: '777' }, team: 'delivery', default: 'docs' }), rejects('repository_not_ready', 409));
  assert.equal(writes(fake).length, before, 'a repository that is not ready sends Ploeg nothing');
  const dry = await clickup.bind(admin, { connection: kept.id, list: { id: '777' }, team: 'delivery', default: 'shop', dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.checks.map(check => check.status), ['ok', 'ok']);
  const made = await clickup.bind(admin, { connection: kept.id, list: { id: '777' }, team: 'delivery', default: 'shop' });
  assert.deepEqual(writes(fake).slice(-2).map(entry => entry.path), ['teams/delivery/tracker-bindings?dryRun=true', 'teams/delivery/tracker-bindings']);
  assert.deepEqual(writes(fake).at(-1)?.body, { connection: 'clickup-unfold', scope: { id: '777' }, default: 'shop', allow: [] });
  assert.equal(made.binding?.state, 'awaiting_webhook');
  assert.equal(made.source?.name, 'Sprint 12');
  const synced = config.taskSources?.find(source => source.id === made.source?.id);
  assert.deepEqual(synced?.ploeg, { target: { forge: 'github', owner: 'acme', repo: 'shop', baseBranch: 'main' } }, 'the saved source takes the binding’s target');
  assert.equal(synced?.token, undefined, 'and carries no token');
  const line = clickup.lines(true)['bind-lists']!;
  assert.equal(line.status, 'warning', 'awaiting_webhook is not done');
  assert.equal(sourceLine(connections.sources()[0], true).action?.label, 'Check again');
  assert.equal(line.checks, undefined, 'no List name reaches the checklist events');
  const again = await clickup.bind(admin, { connection: kept.id, list: { id: '777' }, team: 'delivery', default: 'shop' });
  assert.equal(again.created, false);
  assert.equal(connections.sources().length, 1, 'one saved source');
  assert.equal(fake.bindings.length, 1, 'one binding in Ploeg');
  assert.equal(changes.filter(change => change.entity === 'Tracker binding' && change.action === 'create').length, 1);
  fake.bindings[0].state = 'active';
  await clickup.check(admin, made.source!.id);
  assert.equal(clickup.lines(true)['bind-lists']?.status, 'ok', 'done only once Ploeg reports it active');
});

test('a List the configuration routes is shown as configured and nothing is stored', async t => {
  const { clickup, fake, connections } = await setup(t);
  const kept = await clickup.connectWithToken(admin, { token: memberToken });
  fake.answers.set('POST teams/delivery/tracker-bindings?dryRun=true', { status: 409, body: { error: { code: 'conflicts_with_static', message: 'A static route decides this Scope.', staticEntry: 'trackers.clickup.projects[3]' } } });
  const result = await clickUpRoute(clickup, { method: 'POST', path: '/api/onboarding/clickup/bindings', user: admin, signIn: undefined, query: new URLSearchParams(), body: async () => ({ connection: kept.id, list: { id: '777' }, team: 'delivery', default: 'shop' }) });
  assert(result && 'status' in result);
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { error: { code: 'conflicts_with_static', message: 'A static route decides this Scope.', staticEntry: 'trackers.clickup.projects[3]' } });
  assert.deepEqual(connections.sources(), []);
  assert.equal(writes(fake).filter(entry => entry.path === 'teams/delivery/tracker-bindings').length, 0, 'no create after a refused dry run');
});

test('a Team that does not accept bindings turns its installation line red, and a Team without a spend cap is refused first', async t => {
  const { clickup, fake, onboarding } = await setup(t, { teams: [capped('delivery', { usd: 20, period: 'day', periodEnd: '2026-11-19T00:00:00Z', remainingUsd: 20 }), capped('uncapped', null)] });
  const kept = await clickup.connectWithToken(admin, { token: memberToken });
  const sent = writes(fake).length;
  await assert.rejects(clickup.bind(admin, { connection: kept.id, list: { id: '777' }, team: 'uncapped', default: 'shop' }), rejects('budget_missing', 409));
  assert.equal(writes(fake).length, sent);
  fake.answers.set('POST teams/delivery/tracker-bindings?dryRun=true', { status: 422, body: { error: { code: 'bindings_not_accepted', message: 'Team delivery accepts no runtime bindings.' } } });
  await assert.rejects(clickup.bind(admin, { connection: kept.id, list: { id: '777' }, team: 'delivery', default: 'shop' }), rejects('bindings_not_accepted', 422));
  const checklist = await onboarding.checklist(admin);
  const install = checklist.stages.flatMap(line => line.checks ?? []).find(line => line.id === 'install-bindings');
  assert.equal(install?.status, 'problem');
});

test('removing a binding twice succeeds twice with one delete record, the source loses its target, and a connection in use is not removed', async t => {
  const { clickup, fake, connections, config, changes } = await setup(t);
  const kept = await clickup.connectWithToken(admin, { token: memberToken });
  const made = await clickup.bind(admin, { connection: kept.id, list: { id: '777' }, team: 'delivery', default: 'shop' });
  await assert.rejects(clickup.removeConnection(admin, kept.id), rejects('connection_in_use', 409));
  assert.deepEqual(await clickup.unbind(admin, made.source!.id), { removed: 'b-1' });
  assert.deepEqual(await clickup.unbind(admin, made.source!.id), { removed: null });
  assert.equal(changes.filter(change => change.entity === 'Tracker binding' && change.action === 'delete').length, 1);
  assert.equal(config.taskSources?.find(source => source.id === made.source?.id)?.ploeg, undefined);
  assert.equal(fake.bindings.length, 0);
});

test('a binding Ploeg no longer holds turns the List red with Bind again on the next check', async t => {
  const { clickup, fake, config, connections } = await setup(t);
  const kept = await clickup.connectWithToken(admin, { token: memberToken });
  const made = await clickup.bind(admin, { connection: kept.id, list: { id: '777' }, team: 'delivery', default: 'shop' });
  fake.bindings = [];
  await clickup.check(admin, made.source!.id);
  const line = clickup.lines(true)['bind-lists']!;
  assert.equal(line.status, 'problem');
  assert.equal(sourceLine(connections.sources()[0], true).action?.label, 'Bind again');
  assert.equal(config.taskSources?.find(source => source.id === made.source?.id)?.ploeg, undefined, 'the next sync drops the target');
});

test('the List read waits for a Ploeg release that serves it and never asks ClickUp', async t => {
  const { clickup, fake } = await setup(t);
  const kept = await clickup.connectWithToken(admin, { token: memberToken });
  await assert.rejects(clickup.lists(admin, kept.id), (error: unknown) => error instanceof PloegError && error.code === 'ploeg_step_unavailable' && /list a tracker connection’s Lists/.test(error.message));
  assert.equal(fake.seen.filter(entry => entry.path.includes('/scopes')).length, 0);
});

test('the member guide comes from the ClickUp adapter in plain words', async t => {
  const { clickup } = await setup(t);
  const guide = clickup.guide();
  assert.match(guide!.why, /ClickUp has no bot accounts/);
  assert.equal(guide!.steps.length, 4);
  assert.match(guide!.steps.at(-1)!, /keeps no copy/);
});
