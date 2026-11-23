import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { MyUsageService, askPrice, chatPrice, combinedMoney, sessionPrice, usageMoney, usageWindow } from '../src/my-usage.ts';
import { ChatStore } from '../src/chat/store.ts';
import type { ChatTurn } from '../src/chat/types.ts';
import type { PloegChatRecord } from '../src/ploeg.ts';
import type { AppConfig, User } from '../src/types.ts';
import { digestTokensQuery, readSessionsUsage } from '../src/linked-telemetry.ts';
import { hashPassword } from '../src/auth.ts';
import type { Ask } from '../src/ask/types.ts';
import type { Session } from '../src/types.ts';
import { application, login, request } from './api-support.ts';

test('a period is this UTC calendar month or the last 30 days', () => {
  const now = new Date('2026-11-17T09:30:00Z');
  assert.equal(usageWindow('month', now).since.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(usageWindow('30d', now).since.toISOString(), '2026-10-18T09:30:00.000Z');
  assert.equal(usageWindow('month', now).until, now);
});

test('an unknown cost is never summed as zero, a demo item is left out, and a partial sum keeps its unknown count', () => {
  assert.deepEqual(askPrice({ demo: false, costUsd: 0.42, costStatus: 'settled' }), { demo: false, usd: 0.42, settled: true });
  assert.deepEqual(askPrice({ demo: false, costUsd: 0.1, costStatus: 'unknown' }), { demo: false, usd: null, settled: false }, 'Ploeg’s unknown is unknown even with a number');
  assert.deepEqual(askPrice({ demo: false, costUsd: null, costStatus: 'provisional' }), { demo: false, usd: null, settled: false });
  assert.equal(askPrice({ demo: true, costUsd: null, costStatus: 'demo' }).demo, true);
  assert.deepEqual(sessionPrice({ spentUsd: 1, observedUsd: 1.5, costStatus: 'observed' }), { demo: false, usd: 1.5, settled: false });
  assert.deepEqual(sessionPrice({ spentUsd: 0, costStatus: 'unknown' }), { demo: false, usd: null, settled: false });
  assert.equal(sessionPrice({ spentUsd: 0, costStatus: 'demo' }).demo, true);
  assert.deepEqual(usageMoney([]), { count: 0, usd: 0, final: true, unknown: 0, demo: 0 }, 'nothing at all is a known zero');
  assert.deepEqual(usageMoney([{ demo: false, usd: null, settled: false }]), { count: 1, usd: null, final: false, unknown: 1, demo: 0 }, 'only unknown costs read unknown, not $0');
  assert.deepEqual(usageMoney([{ demo: false, usd: 0.25, settled: true }, { demo: false, usd: null, settled: false }, { demo: true, usd: null, settled: false }]), { count: 2, usd: 0.25, final: false, unknown: 1, demo: 1 });
  assert.deepEqual(combinedMoney([{ count: 1, usd: null, final: false, unknown: 1 }, { count: 0, usd: 0, final: true, unknown: 0 }]), { count: 1, usd: 0, final: false, unknown: 1 });
  assert.deepEqual(combinedMoney([{ count: 1, usd: null, final: false, unknown: 1 }, { count: 2, usd: null, final: false, unknown: 2 }]).usd, null);
  assert.deepEqual(combinedMoney([{ count: 1, usd: 1.1, final: true, unknown: 0 }, { count: 1, usd: 2.2, final: true, unknown: 0 }]), { count: 2, usd: 3.3, final: true, unknown: 0 });
});

test('a chat message costs what Ploeg reports, is final only once settled, and is unknown when Ploeg cannot say', () => {
  assert.deepEqual(chatPrice({}, { costStatus: 'settled', usd: 0.0021 }), { demo: false, usd: 0.0021, settled: true });
  assert.deepEqual(chatPrice({}, { costStatus: 'observed', usd: 0.01 }), { demo: false, usd: 0.01, settled: false });
  assert.deepEqual(chatPrice({}, { costStatus: 'unknown', usd: 0.05 }), { demo: false, usd: null, settled: false }, 'Ploeg’s unknown is unknown even with a number, so the hold is never read as the cost');
  assert.deepEqual(chatPrice({}, null), { demo: false, usd: null, settled: false });
  assert.deepEqual(chatPrice({ settled: { usd: 0.003 } }, null), { demo: false, usd: 0.003, settled: true });
});

test('Your usage counts the person’s own admitted chat messages at Ploeg’s cost and asks Ploeg again only until one settles', async () => {
  const db = new DatabaseSync(':memory:');
  const chats = new ChatStore(db);
  const now = new Date('2026-11-23T12:00:00Z');
  const chat = (id: string, owner: string) => chats.save({ id, owner: { id: owner, name: owner, role: 'operator' }, title: id, team: 'delivery', createdAt: now.toISOString(), updatedAt: now.toISOString(), allowance: null });
  const turn = (chatId: string, id: string, seq: number, startedAt: string, admitted: boolean): void => chats.saveTurn({ chatId, id, seq, startedAt, finishedAt: startedAt, text: 'hi', responseParts: [], state: 'complete', admission: admitted ? { team: 'delivery', chatId: `ploeg-${id}` } : null });
  chat('c-op', 'op'); chat('c-other', 'other');
  turn('c-op', 'settled', 1, '2026-11-20T10:00:00.000Z', true);
  turn('c-op', 'open', 2, '2026-11-21T10:00:00.000Z', true);
  turn('c-op', 'unreadable', 3, '2026-11-22T10:00:00.000Z', true);
  turn('c-op', 'refused', 4, '2026-11-22T11:00:00.000Z', false);
  turn('c-op', 'last-month', 5, '2026-10-30T10:00:00.000Z', true);
  turn('c-other', 'theirs', 1, '2026-11-22T10:00:00.000Z', true);
  const records: Record<string, Pick<PloegChatRecord, 'costStatus' | 'usd'>> = { 'ploeg-settled': { costStatus: 'settled', usd: 0.0021 }, 'ploeg-open': { costStatus: 'observed', usd: 0.004 }, 'ploeg-theirs': { costStatus: 'settled', usd: 9 } };
  const asked: string[] = [];
  const usage = new MyUsageService({
    asksBetween: () => [], sessionSpendSince: () => [], linkedOwned: () => [],
    chatTurns: (...args) => chats.admitted(...args),
    chatRecord: async (_user, _team, chatId) => { asked.push(chatId); const record = records[chatId]; if (!record) throw new Error('Ploeg did not answer'); return { chatId, state: 'finished', ...record }; },
    keepChatSettled: kept => chats.saveTurn(kept),
  }, {} as AppConfig, { now: () => now });
  const op: User = { id: 'op', name: 'op', role: 'operator' } as User;
  const first = await usage.read(op, 'month');
  assert.deepEqual(first.chats, { count: 3, usd: 0.0061, final: false, unknown: 1, truncated: false }, 'a refused message and last month’s are left out, an unreadable one is unknown, never the hold');
  assert.deepEqual(first.spent, { count: 3, usd: 0.0061, final: false, unknown: 1 });
  assert.deepEqual(asked.sort(), ['ploeg-open', 'ploeg-settled', 'ploeg-unreadable'], 'only the caller’s own messages are read from Ploeg');
  assert.deepEqual((chats.turns('c-op').find((entry: ChatTurn) => entry.id === 'settled'))?.settled, { usd: 0.0021 }, 'a settled cost is kept');
  asked.length = 0;
  await usage.read(op, 'month');
  assert.deepEqual(asked.sort(), ['ploeg-open', 'ploeg-unreadable'], 'a settled message is not read from Ploeg again');
  assert.deepEqual(first.notAttributed.map(entry => entry.source), ['ploeg_runs', 'chats']);
  assert.match(first.notAttributed[1].reason, /chats you deleted/);
});

test('the Linked Session usage asks the metrics store for cost and tokens of the named sessions only', async () => {
  assert.equal(digestTokensQuery(['abcd1234-1', 'bad"}|.*'], '600s'), 'sum by (type) (max_over_time({__name__=~"claude_code[._]token[._]usage(_tokens)?(_total)?", session_id=~"abcd1234-1"}[600s])) or sum by (type) (max_over_time({__name__=~"claude_code[._]token[._]usage(_tokens)?(_total)?", "session.id"=~"abcd1234-1"}[600s]))');
  const queries: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const query = new URLSearchParams(String(init.body)).get('query') ?? '';
    queries.push(query);
    const result = query.startsWith('sum by (type)') ? [{ metric: { type: 'input' }, value: [0, '1200'] }, { metric: { type: 'output' }, value: [0, '300.4'] }] : [{ metric: {}, value: [0, '2.71828'] }];
    return new Response(JSON.stringify({ status: 'success', data: { result } }));
  }) as typeof fetch;
  assert.deepEqual(await readSessionsUsage({ metricsUrl: 'http://vm.local' }, ['abcd1234-1'], '600s', { fetch: fetcher }), { costUsd: 2.7183, tokens: { input: 1200, output: 300, cacheRead: 0, cacheCreation: 0 }, reason: null, read: true });
  assert.equal(queries.length, 2);
  const none = await readSessionsUsage(undefined, ['abcd1234-1'], '600s');
  assert.deepEqual([none.costUsd, none.tokens], [null, null]);
  assert.match(String(none.reason), /No metrics store/);
  const down = await readSessionsUsage({ metricsUrl: 'http://vm.local' }, ['abcd1234-1'], '600s', { fetch: (async () => new Response('', { status: 503 })) as typeof fetch });
  assert.deepEqual([down.costUsd, down.reason], [null, 'The metrics store answered 503.']);
});

async function metricsStore(t: TestContext, empty = false) {
  const queries: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const query = new URLSearchParams(body).get('query') ?? '';
      queries.push(query);
      const result = empty ? [] : query.startsWith('sum by (type)') ? [{ metric: { type: 'input' }, value: [0, '5000'] }, { metric: { type: 'output' }, value: [0, '700'] }] : [{ metric: {}, value: [0, '4.5'] }];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: { result } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, queries };
}

const ask = (id: string, askerId: string, fields: Partial<Ask> = {}): Ask => ({ id, workItemId: '101', workItemTitle: 'Fix rounding', askerId, askerName: askerId, audience: 'internal', question: 'Why?', answer: 'Because.', status: 'answered', demo: false, ploegAskId: `p-${id}`, model: 'coding', costUsd: 0.5, costStatus: 'settled', failure: null, source: 'model', intent: null, createdAt: new Date().toISOString(), answeredAt: new Date().toISOString(), ...fields });
const session = (id: string, ownerId: string, fields: Partial<Session> = {}): Session => ({ id, title: id, objective: id, repositoryId: 'order-service', teamId: 'delivery', runtime: 'command', ownerId, ownerName: ownerId, status: 'completed', budgetUsd: 5, spentUsd: 2, costStatus: 'settled', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), branch: 'main', runs: [], artifacts: [], ...fields } as Session);

test('Your usage answers only the signed-in person’s own Asks, sessions and Linked Sessions, an administrator included', async t => {
  const metrics = await metricsStore(t);
  const server = await application('live', config => { config.observability = { metricsUrl: metrics.url }; });
  t.after(() => server.close());
  const password = randomBytes(24).toString('hex');
  for (const [id, role] of [['op', 'operator'], ['other', 'operator'], ['boss', 'admin']] as const) server.app.store.addUser({ id, name: id, role, passwordHash: await hashPassword(password) });
  const [op, other, boss] = [await login(server.url, 'op', password), await login(server.url, 'other', password), await login(server.url, 'boss', password)];
  const store = server.app.store;
  store.saveAsk(ask('a1', 'op', { costUsd: 0.25 }));
  store.saveAsk(ask('a2', 'op', { costUsd: null, costStatus: 'provisional' }));
  store.saveAsk(ask('a3', 'op', { createdAt: '2020-01-01T00:00:00.000Z' }));
  store.saveAsk(ask('x1', 'other', { costUsd: 100 }));
  store.saveSession(session('s-op', 'op', { budgetUsd: 4, spentUsd: 1.5 }));
  store.saveSession(session('s-other', 'other', { budgetUsd: 50, spentUsd: 40 }));
  const linked = (cookie: string, sessionId: string) => request(server.url, '/api/linked-sessions/events', { method: 'POST', cookie, body: { harness: 'claude-code', sessionId, event: 'start', title: 'Fix rounding', branch: 'feat/rounding' } });
  assert.equal((await linked(op.cookie, 'session-op-0001')).status, 200);
  assert.equal((await linked(other.cookie, 'session-other-0002')).status, 200);

  const mine = await request(server.url, '/api/me/usage', op);
  assert.equal(mine.status, 200, mine.text);
  const usage = mine.body.usage;
  assert.equal(usage.period, 'month');
  assert.deepEqual(usage.asks, { count: 2, usd: 0.25, final: false, unknown: 1, demo: 0, truncated: false }, 'the unknown Ask is counted, not summed as zero, and last decade’s Ask is outside the month');
  assert.deepEqual(usage.sessions, { count: 1, usd: 1.5, final: true, unknown: 0, budgetUsd: 4, demo: 0, truncated: false });
  assert.deepEqual(usage.spent, { count: 3, usd: 1.75, final: false, unknown: 1 });
  assert.deepEqual(usage.chats, { count: 0, usd: 0, final: true, unknown: 0, truncated: false }, 'no chat message of theirs was admitted');
  assert.deepEqual([usage.linkedSessions.count, usage.linkedSessions.estimateUsd, usage.linkedSessions.telemetry, usage.linkedSessions.costStatus], [1, 4.5, 'connected', 'estimate']);
  assert.deepEqual(usage.linkedSessions.tokens, { input: 5000, output: 700, cacheRead: 0, cacheCreation: 0 });
  assert.deepEqual(usage.notAttributed.map((entry: { source: string }) => entry.source), ['ploeg_runs', 'chats']);
  assert.ok(metrics.queries.every(query => query.includes('session-op-0001') && !query.includes('session-other-0002')), 'the metrics store is asked about the caller’s own sessions only');
  assert.doesNotMatch(mine.text.replace(/"\d{4}-\d{2}-\d{2}T[\d:.]+Z"/g, '"<time>"'), /\b100\b|\b40\b|\b50\b|session-other/, 'nothing of another person reaches the answer');

  const admin = (await request(server.url, '/api/me/usage?period=30d', boss)).body.usage;
  assert.deepEqual([admin.asks.count, admin.sessions.count, admin.linkedSessions.count, admin.spent.usd], [0, 0, 0, 0], 'an administrator gets their own usage, not everyone’s');
  assert.equal(admin.period, '30d');
  const theirs = (await request(server.url, '/api/me/usage', other)).body.usage;
  assert.deepEqual([theirs.asks.usd, theirs.sessions.usd], [100, 40]);

  assert.equal((await request(server.url, '/api/me/usage?period=1y', op)).body.error.code, 'usage_period');
  assert.equal((await request(server.url, '/api/me/usage')).status, 401);
});

test('Your usage says no telemetry is connected instead of showing a zero estimate', async t => {
  const server = await application('live');
  t.after(() => server.close());
  const password = randomBytes(24).toString('hex');
  server.app.store.addUser({ id: 'op', name: 'op', role: 'viewer', passwordHash: await hashPassword(password) });
  const op = await login(server.url, 'op', password);
  await request(server.url, '/api/linked-sessions/events', { method: 'POST', cookie: op.cookie, body: { harness: 'claude-code', sessionId: 'session-op-0001', event: 'start' } });
  const usage = (await request(server.url, '/api/me/usage', op)).body.usage;
  assert.deepEqual([usage.linkedSessions.count, usage.linkedSessions.estimateUsd, usage.linkedSessions.tokens, usage.linkedSessions.telemetry], [1, null, null, 'not_configured']);
  assert.match(usage.linkedSessions.reason, /No metrics store/);
});

test('Your usage says the estimate is not known yet when the metrics store answers but holds nothing for the sessions', async t => {
  const metrics = await metricsStore(t, true);
  const server = await application('live', config => { config.observability = { metricsUrl: metrics.url }; });
  t.after(() => server.close());
  const password = randomBytes(24).toString('hex');
  server.app.store.addUser({ id: 'op', name: 'op', role: 'viewer', passwordHash: await hashPassword(password) });
  const op = await login(server.url, 'op', password);
  await request(server.url, '/api/linked-sessions/events', { method: 'POST', cookie: op.cookie, body: { harness: 'claude-code', sessionId: 'session-op-0001', event: 'start' } });
  const usage = (await request(server.url, '/api/me/usage', op)).body.usage;
  assert.deepEqual([usage.linkedSessions.count, usage.linkedSessions.estimateUsd, usage.linkedSessions.tokens, usage.linkedSessions.telemetry], [1, null, null, 'connected']);
  assert.match(usage.linkedSessions.reason, /no metrics for these sessions yet/);
});
