import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/auth.ts';
import { ClaudeRoutines, routineRefusalTable } from '../src/claude-routines.ts';
import { errorCatalogue } from '../src/error-catalogue.ts';
import { Onboarding } from '../src/onboarding.ts';
import { claimFailures } from '../src/ploeg.ts';
import { ploegDemo } from '../src/ploeg-demo.ts';
import type { User } from '../src/types.ts';
import { linkedWorkMarkup } from '../public/core/linked-handoff.js';
import { teamMarkup } from '../public/core/connect-claude.js';
import { application, login, request } from './api-support.ts';

const fireUrl = 'https://api.anthropic.com/v1/claude_code/routines/trig_01AbCdEf/fire';
type Call = { method: string; path: string; actor?: string; body: Record<string, unknown> | null; raw: string };
type Refusal = { status: number; code: string };
type FakeOptions = { list?: Refusal; put?: Refusal; remove?: Refusal; fire?: Refusal };

async function fakePloeg(t: TestContext, options: FakeOptions = {}) {
  const env = `UNFOLD_CONNECT_CLAUDE_${randomBytes(6).toString('hex').toUpperCase()}`;
  const bearer = randomBytes(24).toString('hex');
  process.env[env] = bearer;
  const details = structuredClone(ploegDemo.details) as Record<string, any>;
  details['109'].item.waitingForClient = { reason: 'start_from_claude_code', message: 'Start this from your Claude, op.', actsFor: 'op', handedBy: null, runId: '9001', role: 'implementer', round: 1, writes: true };
  const routines = new Map<string, { team: string; fireUrl: string; creatorPinned: boolean; registeredAt: string; updatedAt: string }>();
  const calls: Call[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url!, 'http://ploeg.invalid');
    const path = url.pathname.replace('/api/v1/operator/', '');
    calls.push({ method: req.method!, path, actor: req.headers['x-ploeg-actor'] as string | undefined, body: raw ? JSON.parse(raw) : null, raw });
    const send = (status: number, value: object) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ schemaVersion: '1.0', ...value }));
    const refuse = (refusal: Refusal) => send(refusal.status, { error: { code: refusal.code, message: `Ploeg says ${refusal.code}.` } });
    if (req.headers.authorization !== `Bearer ${bearer}`) return res.writeHead(401).end();
    if (path === 'teams') return send(200, { teams: ploegDemo.teams });
    if (path === 'connections') return send(200, { checkedAt: null, eventWindowDays: 30, boards: [], repositories: [] });
    if (path === 'claude-routines' && req.method === 'GET') return options.list ? refuse(options.list) : send(200, { routines: [...routines.values()] });
    const routine = /^claude-routines\/([^/]+)$/.exec(path);
    if (routine && req.method === 'PUT') {
      if (options.put) return refuse(options.put);
      const body = JSON.parse(raw) as { fireUrl: string; token: string };
      const saved = { team: routine[1], fireUrl: body.fireUrl, creatorPinned: false, registeredAt: '2026-11-18T19:00:00Z', updatedAt: '2026-11-18T19:00:00Z' };
      routines.set(routine[1], saved);
      return send(200, { routine: saved });
    }
    if (routine && req.method === 'DELETE') {
      if (options.remove) return refuse(options.remove);
      const saved = routines.get(routine[1]);
      if (!saved) return refuse({ status: 404, code: 'routine_not_registered' });
      routines.delete(routine[1]);
      return send(200, { routine: saved });
    }
    const fire = /^work-items\/(\d+)\/fire-routine$/.exec(path);
    if (fire && req.method === 'POST') {
      if (options.fire) return refuse(options.fire);
      return send(200, { run: { id: '9001', workItemId: fire[1], shiftId: '12', team: 'delivery', role: 'implementer', round: 1, writes: true, actsFor: 'op' }, environmentId: 'env_01', session: { id: 'session_01Fired', url: 'https://claude.ai/code/session_01Fired' } });
    }
    const item = /^work-items\/(\d+)$/.exec(path);
    if (item && details[item[1]]) return send(200, details[item[1]]);
    return res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); delete process.env[env]; });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { calls, routines, config: { url: `http://127.0.0.1:${address.port}`, tokenEnv: env }, routineCalls: () => calls.filter(call => call.path.startsWith('claude-routines') || call.path.endsWith('/fire-routine')) };
}

async function people(t: TestContext, options: FakeOptions = {}) {
  const ploeg = await fakePloeg(t, options);
  const server = await application('live', config => { config.ploeg = { ...ploeg.config, userTeams: { op: ['delivery'], watcher: ['delivery'] } }; });
  t.after(() => server.close());
  const password = randomBytes(24).toString('hex');
  for (const [id, role] of [['op', 'operator'], ['watcher', 'viewer']] as const) server.app.store.addUser({ id, name: id, role, passwordHash: await hashPassword(password) });
  return { ploeg, server, op: await login(server.url, 'op', password), watcher: await login(server.url, 'watcher', password) };
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

test('a person connects their routine, starts a Work Item with it and removes it; the token reaches Ploeg and nothing else', async t => {
  const output = captureOutput(t);
  const { ploeg, server, op } = await people(t);
  const token = `rtt_${randomBytes(20).toString('hex')}`;
  const answers: string[] = [];

  const before = await request(server.url, '/api/claude-routines', op);
  assert.equal(before.status, 200, before.text);
  assert.equal(before.body.served, true, 'the pinned Ploeg serves the step');
  assert.deepEqual(before.body.teams, [{ team: 'delivery', routine: null }]);
  assert.equal(ploeg.calls.find(call => call.path === 'claude-routines')?.actor, 'op', 'Ploeg is asked as the person, so it answers their routines only');

  const connected = await request(server.url, '/api/claude-routines/delivery', { method: 'PUT', cookie: op.cookie, body: { fireUrl, token } });
  answers.push(connected.text);
  assert.equal(connected.status, 200, connected.text);
  assert.deepEqual(connected.body, { routine: { team: 'delivery', fireUrl, creatorPinned: false, registeredAt: '2026-11-18T19:00:00Z', updatedAt: '2026-11-18T19:00:00Z' } });
  const put = ploeg.calls.find(call => call.method === 'PUT')!;
  assert.equal(put.path, 'claude-routines/delivery');
  assert.deepEqual(put.body, { fireUrl, token }, 'Ploeg gets the fire URL and the token, and nothing else');
  assert.equal(put.actor, 'op');

  const after = await request(server.url, '/api/claude-routines', op);
  answers.push(after.text);
  assert.equal(after.body.teams[0].routine.fireUrl, fireUrl);
  const checklist = await request(server.url, '/api/onboarding', op);
  answers.push(checklist.text);
  const line = checklist.body.stages.find((entry: { id: string }) => entry.id === 'connect-claude');
  assert.equal(line.status, 'ok', checklist.text);
  assert.match(line.text, /connected for delivery/);
  assert.equal(line.action.href, '#settings/claude');

  const fired = await request(server.url, '/api/ploeg/work-items/109/fire-routine', { method: 'POST', cookie: op.cookie });
  answers.push(fired.text);
  assert.equal(fired.status, 200, fired.text);
  assert.deepEqual(fired.body, { run: { id: '9001', workItemId: '109', team: 'delivery', role: 'implementer', round: 1 }, session: { id: 'session_01Fired', url: 'https://claude.ai/code/session_01Fired' } });
  const fire = ploeg.calls.find(call => call.path === 'work-items/109/fire-routine')!;
  assert.equal(fire.method, 'POST');
  assert.equal(fire.actor, 'op');
  assert(!fire.raw.includes(token), 'firing sends no token: Ploeg reads its own copy');

  const removed = await request(server.url, '/api/claude-routines/delivery', { method: 'DELETE', cookie: op.cookie });
  answers.push(removed.text);
  assert.equal(removed.status, 200, removed.text);
  assert.equal(removed.body.routine.team, 'delivery');
  assert.equal(ploeg.routines.size, 0);
  const gone = await request(server.url, '/api/claude-routines', op);
  assert.deepEqual(gone.body.teams, [{ team: 'delivery', routine: null }]);

  for (const answer of answers) assert(!answer.includes(token), 'no Unfold answer carries the token');
  assert(!output().includes(token), 'no log line carries the token');
  const rows = everyRow(server.app.store.db);
  assert(!rows.includes(token), 'no database row carries the token');
  assert(!rows.includes(token.slice(4, 24)), 'no database row carries part of the token');
  assert.match(rows, /\[redacted\]/, 'the action log records the token field as redacted');
});

test('every refusal of firing the routine comes back in Ploeg’s status and code with Unfold’s plain sentence', async t => {
  const refusals: (Refusal & { words: string })[] = [
    ...routineRefusalTable.filter(entry => !['invalid_fire_url', 'invalid_token', 'no_routine_team'].includes(entry.code)).map(entry => ({ status: entry.status, code: entry.code, words: entry.words })),
    ...Object.entries(claimFailures).map(([code, words]) => ({ status: 409, code, words })),
  ];
  for (const refusal of refusals) {
    await t.test(refusal.code, async t => {
      const { server, op } = await people(t, { fire: refusal });
      const answer = await request(server.url, '/api/ploeg/work-items/109/fire-routine', { method: 'POST', cookie: op.cookie });
      assert.equal(answer.status, refusal.status, answer.text);
      assert.equal(answer.body.error.code, refusal.code);
      assert.equal(answer.body.error.message, refusal.words);
      assert(!answer.text.includes('Ploeg says'), 'Ploeg’s raw message is replaced by the plain sentence');
    });
  }
});

test('connecting refuses a malformed fire URL or token before sending it, and words Ploeg’s refusals of the connection', async t => {
  const { ploeg, server, op } = await people(t, { put: { status: 409, code: 'no_routine_team' } });
  const badUrl = await request(server.url, '/api/claude-routines/delivery', { method: 'PUT', cookie: op.cookie, body: { fireUrl: 'http://api.anthropic.com/fire', token: 'x'.repeat(20) } });
  assert.equal(badUrl.status, 400);
  assert.equal(badUrl.body.error.code, 'invalid_fire_url');
  const badToken = await request(server.url, '/api/claude-routines/delivery', { method: 'PUT', cookie: op.cookie, body: { fireUrl, token: 'short' } });
  assert.equal(badToken.status, 400);
  assert.equal(badToken.body.error.code, 'invalid_token');
  assert(!badToken.text.includes('short'), 'the refusal does not echo the token');
  assert.equal(ploeg.routineCalls().filter(call => call.method === 'PUT').length, 0, 'nothing malformed is sent to Ploeg');
  const team = await request(server.url, '/api/claude-routines/delivery', { method: 'PUT', cookie: op.cookie, body: { fireUrl, token: 'y'.repeat(32) } });
  assert.equal(team.status, 409);
  assert.equal(team.body.error.code, 'no_routine_team');
  assert.match(team.body.error.message, /No Role of this Team starts its Runs through a Claude routine/);
  const missing = await request(server.url, '/api/claude-routines/delivery', { method: 'DELETE', cookie: op.cookie });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'routine_not_registered');
});

test('an installation that does not accept routines shows why on Connect Claude instead of failing the page', async t => {
  const { server, op } = await people(t, { list: { status: 422, code: 'routines_not_accepted' } });
  const overview = await request(server.url, '/api/claude-routines', op);
  assert.equal(overview.status, 200, overview.text);
  assert.equal(overview.body.refused.code, 'routines_not_accepted');
  assert.match(overview.body.refused.message, /PLOEG_CLAUDE_ROUTINES/);
});

test('a viewer connects and starts nothing, and nothing is sent to Ploeg', async t => {
  const { ploeg, server, watcher } = await people(t);
  const connect = await request(server.url, '/api/claude-routines/delivery', { method: 'PUT', cookie: watcher.cookie, body: { fireUrl, token: 'z'.repeat(32) } });
  assert.equal(connect.status, 403);
  const fire = await request(server.url, '/api/ploeg/work-items/109/fire-routine', { method: 'POST', cookie: watcher.cookie });
  assert.equal(fire.status, 403);
  assert.equal(ploeg.routineCalls().filter(call => call.method !== 'GET').length, 0);
});

test('a Ploeg pinned before the routine routes refuses every write with ploeg_step_unavailable and sends nothing', async () => {
  const user: User = { id: 'op', name: 'op', role: 'operator' };
  const held = new Map<string, unknown>();
  const store = { getSecret: <T>(id: string) => held.get(id) as T | undefined, setSecret: (id: string, value: unknown) => { held.set(id, value); } };
  const onboarding = new Onboarding({ pinned: '0.2.0-rc.127', store, config: { repositories: [] }, ploeg: { connections: async () => { throw new Error('unused'); }, routing: async () => ({ all: [] }), serves: async () => true } });
  const sent: string[] = [];
  const routines = new ClaudeRoutines({ store, steps: onboarding, ploeg: { isDemo: false, operatorCall: async (_user, path) => { sent.push(path); return {}; }, teams: async () => [], detail: async () => ({}) } });
  for (const attempt of [() => routines.connect(user, 'delivery', { fireUrl, token: 'q'.repeat(32) }), () => routines.remove(user, 'delivery'), () => routines.fire(user, '109')]) {
    await assert.rejects(attempt(), (error: { status: number; code: string; message: string }) => error.status === 503 && error.code === 'ploeg_step_unavailable' && /Ploeg 0\.2\.0-rc\.128 adds it/.test(error.message));
  }
  assert.deepEqual(sent, []);
  const overview = await routines.overview(user);
  assert.equal(overview.served, false);
  assert.deepEqual(overview.waitsFor, { record: 'Ploeg ADR-0197', release: '0.2.0-rc.128' });
});

test('every routine refusal Unfold words is in the error catalogue with its status', () => {
  for (const { code, status } of routineRefusalTable) {
    assert(errorCatalogue[code], `${code} is in src/error-catalogue.ts`);
    assert(errorCatalogue[code].status.includes(status), `${code} lists ${status}`);
  }
});

test('the Work Item offers Start with my Claude only to its person, once their routine for the Team is connected', () => {
  const detail = { item: { id: '109', team: 'delivery', state: 'needs_human', target: { owner: 'example', repo: 'order-service' }, latestShift: null, waitingForClient: { reason: 'start_from_claude_code', message: 'Start this, op.', actsFor: 'op', runId: '9001', role: 'implementer', round: 1, writes: true } }, shifts: [], runs: [] };
  const connected = linkedWorkMarkup(detail, { userId: 'op', claudeRoutines: ['delivery'] });
  assert.match(connected, /Start with my Claude/);
  assert.match(connected, /data-action="work-fire-routine"/);
  assert.doesNotMatch(connected, /\/unfold:start 109/, 'a routine Team does not offer the Claude Code command');
  const notConnected = linkedWorkMarkup(detail, { userId: 'op', claudeRoutines: [] });
  assert.doesNotMatch(notConnected, /work-fire-routine/);
  assert.match(notConnected, /#settings\/claude/, 'the person is pointed to Connect Claude');
  assert.doesNotMatch(linkedWorkMarkup(detail, { userId: 'someone-else', claudeRoutines: ['delivery'] }), /work-fire-routine/, 'nobody starts a colleague’s Run');
  const refused = linkedWorkMarkup(detail, { userId: 'op', claudeRoutines: ['delivery'], routineFire: { id: '109', error: 'Your routine was started as often this hour as Anthropic allows.', code: 'routine_rate_limited' } });
  assert.match(refused, /as often this hour[^<]*\(routine_rate_limited\)/);
});

test('the Connect Claude form never puts a token back on the page', () => {
  const html = teamMarkup({ team: 'delivery', routine: { fireUrl, creatorPinned: true, registeredAt: '2026-11-18T19:00:00Z', updatedAt: '2026-11-18T19:00:00Z' } });
  assert.match(html, /name="token" type="password"[^>]*autocomplete="off"/);
  assert.doesNotMatch(html, /name="token"[^>]*value=/, 'the token field has no value');
  assert.match(html, /Connected/);
  assert.match(html, /Remove/);
  assert.match(teamMarkup({ team: 'delivery', routine: null }), /Not connected/);
});
