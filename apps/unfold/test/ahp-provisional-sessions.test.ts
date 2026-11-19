import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { application, request } from './api-support.ts';
import { action, connect, defaultChatOf, vscodeAgentsWindow, type Json } from './ahp-support.ts';
import { testTimeout } from './timeframes.ts';
import { maxProvisionalSessions, provisionalSessionMs } from '../src/ahp/continuity.ts';

const objective = 'Reproduce the rounding regression and fix it with the tests intact.';
const config = { repository: 'order-service', team: 'delivery', budgetUsd: 1 };
const initialize = (clientId: string) => ({ channel: 'ahp-root://', protocolVersions: ['0.9.0'], clientId, clientInfo: vscodeAgentsWindow, _meta: { 'vscode.ahpSessionUris': true }, initialSubscriptions: ['ahp-root://'] });
const removed = (message: Json, session: string) => message.method === 'root/sessionRemoved' && message.params.session === session;

async function window(server: Awaited<ReturnType<typeof application>>, t: { after: (fn: () => unknown) => void }, token: string) {
  const client = connect(`${server.url.replace(/^http/, 'ws')}/?tkn=${token}`);
  t.after(() => client.close());
  await client.open;
  await client.rpc('initialize', initialize(randomUUID()));
  return client;
}

async function gone(client: Awaited<ReturnType<typeof window>>, session: string): Promise<boolean> {
  try { await client.rpc('subscribe', { channel: session }); return false; } catch (error) { return (error as Json).code !== undefined; }
}

test('a provisional session nobody sent a message in and nobody subscribes to expires after 24 hours and every window drops its row; an open composer and a sent message keep theirs, and nothing runs or is charged', { timeout: testTimeout(90_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const host = server.app.agentHost;
  let now = 1_000_000;
  host.clock = () => now;
  const token = (await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'provisional' } })).body.token;
  const creator = await window(server, t, token);
  const other = await window(server, t, token);
  const abandoned = `ahp-session:/${randomUUID()}`;
  const composing = `ahp-session:/${randomUUID()}`;
  const messaged = `ahp-session:/${randomUUID()}`;
  const refused = `ahp-session:/${randomUUID()}`;
  for (const session of [abandoned, composing, messaged, refused]) await creator.rpc('createSession', { channel: session, provider: 'unfold', config });
  await other.until(message => message.method === 'root/sessionAdded' && message.params.summary.resource === abandoned);
  await other.rpc('subscribe', { channel: composing });
  const chat = defaultChatOf(messaged);
  await creator.rpc('subscribe', { channel: chat });
  creator.notify('dispatchAction', { channel: chat, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 'provisional-turn', startedAt: new Date().toISOString(), message: { text: objective, origin: { kind: 'user' } } } });
  await creator.until(message => action(message, chat, 'chat/turnComplete'));
  const refusedChat = defaultChatOf(refused);
  await creator.rpc('subscribe', { channel: refusedChat });
  creator.notify('dispatchAction', { channel: refusedChat, clientSeq: 2, action: { type: 'chat/turnStarted', turnId: 'refused-turn', startedAt: new Date().toISOString(), message: { text: 'test', origin: { kind: 'user' } } } });
  await creator.until(message => action(message, refusedChat, 'chat/error') && message.params.action.turnId === 'refused-turn');
  for (const session of [abandoned, composing, messaged, chat, refused, refusedChat]) creator.notify('unsubscribe', { channel: session });
  await creator.rpc('ping', {});
  const sessionsBefore = server.app.store.listSessions();
  assert.equal(sessionsBefore.length, 1, 'only the session a message was sent in started');

  assert.deepEqual(host.expireProvisionalSessions(now + provisionalSessionMs - 1), [], 'nothing expires before 24 hours');
  now += provisionalSessionMs;
  host.evictIdleSessions();
  await other.until(message => removed(message, abandoned));
  await creator.until(message => removed(message, abandoned));
  assert.ok(await gone(other, abandoned), 'the abandoned provisional session is gone from Unfold');
  assert.ok(!other.inbox.some(message => removed(message, composing)), 'a composer open in a connected window keeps its session');
  assert.deepEqual(server.app.store.listSessions(), sessionsBefore, 'no Run starts and nothing is charged because of a removal');

  now += 10 * provisionalSessionMs;
  assert.deepEqual(host.expireProvisionalSessions(), [], 'a subscribed provisional session and a started session stay, whatever their age');
  for (const session of [messaged, refused]) assert.ok(!other.inbox.some(message => removed(message, session)), `${session === messaged ? 'a started session' : 'a provisional session whose first message was refused'} is never removed by this rule`);
  other.notify('unsubscribe', { channel: composing });
  await other.rpc('ping', {});
  assert.deepEqual(host.expireProvisionalSessions(), [composing.slice('ahp-session:/'.length)], 'once no connected window subscribes, the expired session goes');
  await other.until(message => removed(message, composing));
  assert.deepEqual(server.app.store.listSessions(), sessionsBefore);
});

test('a person\'s twenty-first provisional session removes their oldest unused one nobody subscribes to', { timeout: testTimeout(90_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const host = server.app.agentHost;
  let now = 1_000_000;
  host.clock = () => now;
  const token = (await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'provisional-limit' } })).body.token;
  const creator = await window(server, t, token);
  const other = await window(server, t, token);
  const sessions = Array.from({ length: maxProvisionalSessions }, () => `ahp-session:/${randomUUID()}`);
  const create = async (session: string) => { now += 1; await creator.rpc('createSession', { channel: session, provider: 'unfold', config }); creator.notify('unsubscribe', { channel: session }); };
  await create(sessions[0]);
  await other.rpc('subscribe', { channel: sessions[0] });
  for (const session of sessions.slice(1)) await create(session);
  now += 1;
  await other.rpc('subscribe', { channel: sessions[1] });
  other.notify('unsubscribe', { channel: sessions[1] });
  await creator.rpc('ping', {});
  await other.rpc('ping', {});
  assert.ok(!other.inbox.some(message => message.method === 'root/sessionRemoved'), 'twenty provisional sessions are kept');

  const twentyFirst = `ahp-session:/${randomUUID()}`;
  now += 1;
  await creator.rpc('createSession', { channel: twentyFirst, provider: 'unfold', config });
  await other.until(message => removed(message, sessions[2]));
  assert.ok(await gone(creator, sessions[2]), 'the oldest unused one nobody subscribes to is gone');
  assert.deepEqual(other.inbox.filter(message => message.method === 'root/sessionRemoved').map(message => message.params.session), [sessions[2]], 'only that one goes: the open composer and the recently used one stay');
  assert.equal(server.app.store.listSessions().length, 0, 'no Run starts because of a removal');
});
