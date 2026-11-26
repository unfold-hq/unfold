import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { application, request } from './api-support.ts';
import { action, closed, connect, defaultChatOf, vscodeAgentsWindow, type Json } from './ahp-support.ts';
import { testTimeout } from './timeframes.ts';
import { Heartbeats, IdleSessions, ServerSequence, heartbeatCheckMs, idleSessionMs } from '../src/ahp/continuity.ts';
import type { Event, Session } from '../src/types.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/session-059675b9.json', import.meta.url), 'utf8'));
const objective = 'Reproduce the rounding regression and fix it with the tests intact.';
const initialize = (clientId: string, extra: Json = {}) => ({ channel: 'ahp-root://', protocolVersions: ['0.9.0'], clientId, clientInfo: vscodeAgentsWindow, _meta: { 'vscode.ahpSessionUris': true }, initialSubscriptions: ['ahp-root://'], ...extra });
const lastSeq = (client: { inbox: Json[] }) => Math.max(0, ...client.inbox.filter(message => message.method === 'action').map(message => message.params.serverSeq));

async function attach(server: Awaited<ReturnType<typeof application>>, t: { after: (fn: () => unknown) => void }, token: string) {
  const client = connect(`${server.url.replace(/^http/, 'ws')}/?tkn=${token}`);
  t.after(() => client.close());
  await client.open;
  return client;
}

test('the sequence reserves numbers in the store and resumes after the reservation, never below a number it gave out', { timeout: testTimeout(30_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const first = new ServerSequence(server.app.store, 3);
  const given: number[] = [];
  for (let index = 0; index < 5; index++) { first.advanceTo(first.current + 1); given.push(first.current); }
  first.advanceTo(2);
  assert.equal(first.current, 5, 'a lower value never moves it back');
  const second = new ServerSequence(server.app.store, 3);
  assert.ok(second.current >= Math.max(...given), 'a new process starts at or after every number the old one gave out');
  second.advanceTo(second.current + 1);
  assert.ok(new ServerSequence(server.app.store, 3).current >= second.current);
});

test('idle sessions are evicted only after the idle period in a row, and a session that stops being evictable starts over', () => {
  const idle = new IdleSessions(100);
  let evictable = true;
  assert.deepEqual(idle.sweep(['a'], () => evictable, 0), []);
  assert.deepEqual(idle.sweep(['a'], () => evictable, 99), []);
  evictable = false;
  assert.deepEqual(idle.sweep(['a'], () => evictable, 150), []);
  evictable = true;
  assert.deepEqual(idle.sweep(['a'], () => evictable, 200), []);
  assert.deepEqual(idle.sweep(['a'], () => evictable, 299), []);
  assert.deepEqual(idle.sweep(['a', 'a'], () => evictable, 300), ['a']);
});

test('across a restart serverSeq keeps rising, a client reconnects with its pre-restart lastSeenServerSeq and gets snapshots, and its active-client place is kept', { timeout: testTimeout(90_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const token = (await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'continuity' } })).body.token;
  const clientId = randomUUID();
  const activeClient = { clientId, tools: [] };
  const first = await attach(server, t, token);
  await first.rpc('initialize', initialize(clientId));
  const session = `ahp-session:/${randomUUID()}`;
  const chat = defaultChatOf(session);
  await first.rpc('createSession', { channel: session, provider: 'unfold', config: { repository: 'order-service', team: 'delivery', budgetUsd: 1, title: 'Continuity' }, activeClient });
  await first.rpc('subscribe', { channel: chat });
  first.notify('dispatchAction', { channel: chat, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 'continuity-turn', startedAt: new Date().toISOString(), message: { text: objective, origin: { kind: 'user' } } } });
  await first.until(message => action(message, chat, 'chat/turnComplete') && message.params.action.turnId === 'continuity-turn');
  const lastSeen = Math.max(lastSeq(first), server.app.agentHost.serverSeq);
  first.close();

  await server.restart();
  assert.ok(server.app.agentHost.serverSeq >= lastSeen, 'the sequence never moves backwards across a restart');
  const resumed = await attach(server, t, token);
  const result = await resumed.rpc('reconnect', { channel: 'ahp-root://', clientId, lastSeenServerSeq: lastSeen, subscriptions: ['ahp-root://', session, chat], _meta: { 'vscode.ahpSessionUris': true } });
  assert.equal(result.type, 'snapshot', 'a reconnect after a restart never replays');
  assert.deepEqual(result.snapshots.map((snapshot: Json) => snapshot.resource), ['ahp-root://', session, chat]);
  for (const snapshot of result.snapshots) assert.ok(snapshot.fromSeq >= lastSeen, `${snapshot.resource} starts at or after what the client last saw`);
  assert.deepEqual(result.snapshots[1].state.activeClients, [activeClient], 'the active client survives the restart');
  assert.equal(result.snapshots[2].state.turns.at(-1).id, 'continuity-turn');

  resumed.notify('dispatchAction', { channel: session, clientSeq: 2, action: { type: 'session/isReadChanged', isRead: true } });
  const echoed = await resumed.until(message => message.method === 'action' && message.params.origin?.clientSeq === 2);
  assert.equal(echoed.params.rejectionReason, undefined);
  assert.ok(echoed.params.serverSeq > lastSeen, 'the first action after the restart is numbered after every action before it');

  resumed.close();
  await server.restart();
  assert.deepEqual(server.app.agentHost.evictIdleSessions(), [], 'nothing is cached before anyone subscribes');
  const watching = await attach(server, t, token);
  await watching.rpc('initialize', initialize(randomUUID(), { initialSubscriptions: [session] }));
  const elsewhere = await attach(server, t, token);
  await elsewhere.rpc('reconnect', { channel: 'ahp-root://', clientId, lastSeenServerSeq: echoed.params.serverSeq, subscriptions: ['ahp-root://'] });
  const removed = await watching.until(message => action(message, session, 'session/activeClientRemoved'));
  assert.deepEqual(removed.params.action, { type: 'session/activeClientRemoved', clientId }, 'a restored client that comes back without the session gives its place up at once');
  assert.ok(removed.params.serverSeq > echoed.params.serverSeq);
  await server.restart();
  const after = await attach(server, t, token);
  const state = (await after.rpc('initialize', initialize(randomUUID(), { initialSubscriptions: [session] }))).snapshots[0].state;
  assert.deepEqual(state.activeClients, [], 'the removal is kept across the next restart');
});

test('a reconnect or initialize after a restart that names a provisional session the host lost answers with the other snapshots and tells the client the session is gone', { timeout: testTimeout(90_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const token = (await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'lost channel' } })).body.token;
  const clientId = randomUUID();
  const first = await attach(server, t, token);
  await first.rpc('initialize', initialize(clientId));
  const session = `ahp-session:/${randomUUID()}`;
  const chat = defaultChatOf(session);
  await first.rpc('createSession', { channel: session, provider: 'unfold', config: { repository: 'order-service', team: 'delivery', budgetUsd: 1, title: 'Composing' } });
  await first.rpc('subscribe', { channel: session });
  await first.rpc('subscribe', { channel: chat });
  first.close();
  await server.restart();

  const logged: string[] = [];
  const log = t.mock.method(console, 'error', (line: unknown) => { logged.push(String(line)); });
  const resumed = await attach(server, t, token);
  const result = await resumed.rpc('reconnect', { channel: 'ahp-root://', clientId, lastSeenServerSeq: 0, subscriptions: ['ahp-root://', session, chat], _meta: { 'vscode.ahpSessionUris': true } });
  assert.equal(result.type, 'snapshot');
  assert.deepEqual(result.snapshots.map((snapshot: Json) => snapshot.resource), ['ahp-root://'], 'the lost channels are left out of the snapshots');
  const notices = async (client: Awaited<ReturnType<typeof attach>>) => { await client.rpc('ping', {}); return client.inbox.filter(message => message.method === 'root/sessionRemoved').map(message => message.params); };
  assert.deepEqual(await notices(resumed), [{ channel: 'ahp-root://', session }], 'the client hears once that the session is gone');
  await assert.rejects(resumed.rpc('subscribe', { channel: session }), (error: any) => error.code === -32001, 'the lost session stays lost');

  const fresh = await attach(server, t, token);
  const initialized = await fresh.rpc('initialize', initialize(randomUUID(), { initialSubscriptions: ['ahp-root://', session, chat] }));
  assert.deepEqual(initialized.snapshots.map((snapshot: Json) => snapshot.resource), ['ahp-root://']);
  assert.deepEqual(await notices(fresh), [{ channel: 'ahp-root://', session }]);
  log.mock.restore();
  const unanswered = logged.map(line => { try { return JSON.parse(line); } catch { return undefined; } }).filter(entry => entry?.event === 'agent_host.unanswered_request');
  assert.deepEqual(unanswered.filter(entry => entry.method === 'reconnect').map(entry => entry.path), [session, chat], 'each dropped channel is logged by its path');
  assert.ok(!logged.some(line => line.includes(token)), 'no token is logged');

  server.app.store.addUser({ id: 'bob-lost', name: 'bob-lost', role: 'operator', passwordHash: 'unused' });
  const owned = `ahp-session:/${randomUUID()}`;
  await fresh.rpc('createSession', { channel: owned, provider: 'unfold', config: { repository: 'order-service', team: 'delivery', budgetUsd: 1, title: 'Not Bob\'s' } });
  const bob = connect(`${server.url.replace(/^http/, 'ws')}/?tkn=${server.app.agentHost.issueToken({ id: 'bob-lost', name: 'bob-lost', role: 'operator' })}`);
  t.after(() => bob.close());
  await bob.open;
  const bobs = await bob.rpc('initialize', initialize(randomUUID(), { initialSubscriptions: ['ahp-root://', owned, defaultChatOf(owned)] }));
  assert.deepEqual(bobs.snapshots.map((snapshot: Json) => snapshot.resource), ['ahp-root://'], 'another person\'s session never produces a snapshot');
  assert.ok(!JSON.stringify(bobs).includes('Not Bob'), 'nor any of its state');
  assert.deepEqual(await notices(bob), [{ channel: 'ahp-root://', session: owned }], 'he hears only what an error would have told him');
  await assert.rejects(bob.rpc('subscribe', { channel: owned }), (error: any) => error.code === -32001);
});

test('disposing a session drops its projection, summary and active clients', { timeout: testTimeout(60_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const token = (await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'dispose' } })).body.token;
  const client = await attach(server, t, token);
  const clientId = randomUUID();
  await client.rpc('initialize', initialize(clientId));
  const session = `ahp-session:/${randomUUID()}`;
  const chat = defaultChatOf(session);
  await client.rpc('createSession', { channel: session, provider: 'unfold', config: { repository: 'order-service', team: 'delivery', budgetUsd: 1 }, activeClient: { clientId, tools: [] } });
  await client.rpc('subscribe', { channel: chat });
  client.notify('dispatchAction', { channel: chat, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 'dispose-turn', startedAt: new Date().toISOString(), message: { text: objective, origin: { kind: 'user' } } } });
  await client.until(message => action(message, chat, 'chat/turnComplete'));
  const id = server.app.store.listSessions()[0].id;
  assert.ok(server.app.agentHost.cachedSessions().includes(id));
  await client.rpc('disposeSession', { channel: session });
  assert.ok(!server.app.agentHost.cachedSessions().includes(id), 'the projection and summary are gone');
  await server.restart();
  const again = await attach(server, t, token);
  const state = (await again.rpc('initialize', initialize(randomUUID(), { initialSubscriptions: [session] }))).snapshots[0].state;
  assert.deepEqual(state.activeClients, [], 'a disposed session keeps no active clients');
});

test('an ended session nobody subscribes to is evicted after the idle period and rebuilt to the same snapshot on subscribe; a subscribed or running one is kept', { timeout: testTimeout(60_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const operator = { id: 'demo-operator', name: 'Demo operator', role: 'operator' as const };
  const created = server.app.engine.create({ title: fixture.session.title, objective: fixture.session.objective, repositoryId: 'order-service', teamId: 'delivery', runtime: 'demo', budgetUsd: 1 }, operator);
  const ended: Session = { ...created, ...fixture.session, status: 'cancelled', placement: undefined, approval: undefined, id: created.id, repositoryId: 'order-service', teamId: 'delivery', runtime: 'demo', ownerId: created.ownerId, ownerName: created.ownerName, runs: fixture.session.runs.map((run: Json) => ({ ...run, sessionId: created.id })) };
  server.app.store.saveSession(ended);
  for (const event of fixture.events as Event[]) server.app.store.appendEvent(created.id, event.type, event.actor, event.data, event.runId);
  const queued = server.app.engine.create({ title: 'Still queued', objective, repositoryId: 'order-service', teamId: 'delivery', runtime: 'demo', budgetUsd: 1 }, operator);
  const host = server.app.agentHost;
  const token = (await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'idle' } })).body.token;
  const client = await attach(server, t, token);
  await client.rpc('initialize', initialize('idle'));
  const session = `ahp-session:/${created.id}`;
  const chat = defaultChatOf(session);
  const before = await Promise.all([session, chat].map(async channel => (await client.rpc('subscribe', { channel })).snapshot.state));
  await client.rpc('subscribe', { channel: `ahp-session:/${queued.id}` });
  const now = Date.now();
  assert.deepEqual(host.evictIdleSessions(now), []);
  assert.deepEqual(host.evictIdleSessions(now + idleSessionMs), [], 'a subscribed session is never evicted');

  for (const channel of [session, chat, `ahp-session:/${queued.id}`]) client.notify('unsubscribe', { channel });
  await client.rpc('ping', {});
  assert.deepEqual(host.evictIdleSessions(now + idleSessionMs), [], 'the idle period starts when nobody subscribes');
  assert.deepEqual(host.evictIdleSessions(now + 2 * idleSessionMs - 1), []);
  assert.deepEqual(host.evictIdleSessions(now + 2 * idleSessionMs), [created.id], 'only the ended session goes; the queued one may still run');
  assert.ok(!host.cachedSessions().includes(created.id));
  assert.ok(host.cachedSessions().includes(queued.id));

  const after = await Promise.all([session, chat].map(async channel => (await client.rpc('subscribe', { channel })).snapshot.state));
  assert.deepEqual(after, before, 'the rebuilt projection gives the same snapshot');
  const kinds = after[1].turns.flatMap((turn: Json) => turn.responseParts.map((part: Json) => part.kind));
  assert.ok(['systemNotification', 'toolCall', 'markdown'].every(kind => kinds.includes(kind)), 'the worst-case history is rebuilt in full');
});

test('a chat snapshot longer than 200 turns tells the client there are older turns and one of 200 does not', { timeout: testTimeout(60_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const operator = { id: 'demo-operator', name: 'Demo operator', role: 'operator' as const };
  const withTurns = (count: number) => {
    const created = server.app.engine.create({ title: `${count} turns`, objective, repositoryId: 'order-service', teamId: 'delivery', runtime: 'demo', budgetUsd: 1 }, operator);
    server.app.store.saveSession({ ...created, status: 'cancelled', placement: undefined, approval: undefined });
    for (let index = 1; index < count; index++) server.app.store.appendEvent(created.id, 'message', 'demo-operator', { role: 'operator', text: `Message ${index}`, turnId: `turn-${index}` });
    return defaultChatOf(`ahp-session:/${created.id}`);
  };
  const token = (await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'history' } })).body.token;
  const client = await attach(server, t, token);
  await client.rpc('initialize', initialize('history'));

  const cut = (await client.rpc('subscribe', { channel: withTurns(201) })).snapshot.state;
  assert.equal(cut.turns.length, 200);
  assert.equal(cut.turns[0].id, 'turn-1', 'the first turn, the objective, is the one left out');
  assert.equal(cut.turnsNextCursor, 'turn-1', 'the client learns there are turns before the first one it holds');
  const whole = (await client.rpc('subscribe', { channel: withTurns(200) })).snapshot.state;
  assert.equal(whole.turns.length, 200);
  assert.equal('turnsNextCursor' in whole, false, 'a whole history names no older turns');
});

test('fetchTurns pages a cut chat back to its first turn before it answers, and refuses a cursor it never gave and another person\'s chat', { timeout: testTimeout(60_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const operator = { id: 'demo-operator', name: 'Demo operator', role: 'operator' as const };
  const created = server.app.engine.create({ title: '450 turns', objective, repositoryId: 'order-service', teamId: 'delivery', runtime: 'demo', budgetUsd: 1 }, operator);
  server.app.store.saveSession({ ...created, status: 'cancelled', placement: undefined, approval: undefined });
  for (let index = 1; index < 450; index++) server.app.store.appendEvent(created.id, 'message', 'demo-operator', { role: 'operator', text: `Message ${index}`, turnId: `turn-${index}` });
  const channel = defaultChatOf(`ahp-session:/${created.id}`);
  const token = (await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'paging' } })).body.token;
  const client = await attach(server, t, token);
  await client.rpc('initialize', initialize('paging'));

  const snapshot = (await client.rpc('subscribe', { channel })).snapshot.state;
  let turns: Json[] = snapshot.turns;
  let cursor: string | undefined = snapshot.turnsNextCursor;
  const pages: number[] = [];
  while (cursor !== undefined) {
    const before = client.inbox.length;
    assert.deepEqual(await client.rpc('fetchTurns', { channel, cursor }), {});
    const loaded = client.inbox.slice(before).filter(message => message.method === 'action' && message.params.action.type === 'chat/turnsLoaded');
    assert.equal(loaded.length, 1, 'the page reaches the client before the answer');
    assert.equal(loaded[0].params.channel, channel);
    const { turns: older, turnsNextCursor } = loaded[0].params.action;
    const held = new Set(turns.map(turn => turn.id));
    assert.ok(older.every((turn: Json) => !held.has(turn.id)), 'a page repeats no turn the client holds');
    pages.push(older.length);
    turns = [...older, ...turns];
    cursor = turnsNextCursor;
    assert.ok(pages.length <= 3, 'the cursor clears at the start of the transcript');
  }
  assert.deepEqual(pages, [200, 50]);
  assert.equal(turns.length, 450);
  assert.equal(new Set(turns.map(turn => turn.id)).size, 450);
  assert.deepEqual(turns.slice(1).map(turn => turn.id), Array.from({ length: 449 }, (_, index) => `turn-${index + 1}`), 'the whole history arrives in order');
  assert.match(JSON.stringify(turns[0]), /rounding regression/, 'the objective is the first turn');

  const before = client.inbox.length;
  await client.rpc('fetchTurns', { channel, cursor: snapshot.turnsNextCursor, limit: 10 });
  const limited = client.inbox.slice(before).find(message => message.params?.action?.type === 'chat/turnsLoaded')!.params.action;
  assert.deepEqual(limited.turns.map((turn: Json) => turn.id), Array.from({ length: 10 }, (_, index) => `turn-${index + 240}`), 'a smaller limit gives a smaller page');
  assert.equal(limited.turnsNextCursor, 'turn-240');

  await assert.rejects(client.rpc('fetchTurns', { channel, cursor: 'turn-never-given' }), (error: Json) => error.code === -32602, 'a cursor the host never gave is invalid');
  await assert.rejects(client.rpc('fetchTurns', { channel: `ahp-session:/${created.id}`, cursor: snapshot.turnsNextCursor }), (error: Json) => error.code === -32602, 'only a chat has turns');
  assert.deepEqual(await client.rpc('fetchTurns', { channel }), {}, 'without a cursor there is nothing this host loads on its own');

  server.app.store.addUser({ id: 'bob-paging', name: 'bob-paging', role: 'operator', passwordHash: 'unused' });
  const bob = await attach(server, t, server.app.agentHost.issueToken({ id: 'bob-paging', name: 'bob-paging', role: 'operator' }));
  await bob.rpc('initialize', initialize('bob-paging'));
  const refused = await bob.rpc('fetchTurns', { channel, cursor: snapshot.turnsNextCursor }).catch((error: Json) => error);
  const missing = await bob.rpc('fetchTurns', { channel: defaultChatOf(`ahp-session:/${randomUUID()}`), cursor: snapshot.turnsNextCursor }).catch((error: Json) => error);
  assert.equal(refused.code, -32001, 'another person\'s chat is refused');
  assert.deepEqual([refused.code, refused.message], [missing.code, missing.message], 'the refusal does not tell another person the chat exists');
  assert.ok(!bob.inbox.some(message => message.params?.action?.type === 'chat/turnsLoaded'), 'another person receives no turns');
});

test('a peer that stops answering is silent within 90 seconds of its last answer, an answering one is pinged at most every 30 seconds for an hour', () => {
  const beats = new Heartbeats<string>();
  const sent = new Map<string, number[]>([['alive', []], ['dead', []]]);
  const stopsAnsweringAt = 120_000;
  let lastAnswer = 0;
  let silentAt: number | undefined;
  for (let now = 0; now <= 3_600_000; now += heartbeatCheckMs) {
    const { ping, silent } = beats.check(silentAt === undefined ? ['alive', 'dead'] : ['alive'], now);
    for (const { peer, id } of ping) {
      sent.get(peer)!.push(now);
      if (peer === 'alive') assert.ok(beats.answered(peer, id));
      else if (now < stopsAnsweringAt) { assert.ok(beats.answered(peer, id)); lastAnswer = now; }
    }
    assert.ok(!silent.includes('alive'), `the answering peer is never silent (at ${now} ms)`);
    if (silent.includes('dead')) silentAt = now;
  }
  assert.ok(silentAt !== undefined, 'the peer that stopped answering is found');
  assert.ok(silentAt - lastAnswer <= 90_000, `found ${silentAt - lastAnswer} ms after its last answer`);
  for (const [peer, times] of sent) for (let index = 1; index < times.length; index++) assert.ok(times[index] - times[index - 1] >= 30_000, `${peer} is pinged at most every 30 seconds`);
  assert.equal(sent.get('alive')!.length, 3_600_000 / 30_000 + 1);
});

test('an answer only clears the ping it answers', () => {
  const beats = new Heartbeats<string>(30_000, 30_000);
  const [{ id }] = beats.check(['a'], 0).ping;
  assert.equal(beats.answered('a', id + 1), false);
  assert.equal(beats.answered('b', id), false);
  assert.deepEqual(beats.check(['a'], 30_000), { ping: [], silent: ['a'] });
});

test('the host pings initialized clients, keeps one that answers for an idle hour, and closes one that stops answering like a client-side close', { timeout: testTimeout(90_000) }, async t => {
  const server = await application();
  t.after(() => server.close());
  const host = server.app.agentHost;
  host.activeClientGraceMs = 0;
  let now = 1_000_000;
  host.clock = () => now;
  const token = (await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'heartbeat' } })).body.token;
  const attached = async () => (await request(server.url, '/api/agent-host')).body;

  const handshaking = await attach(server, t, token);
  const answering = await attach(server, t, token);
  await answering.rpc('initialize', initialize(randomUUID()));
  for (let tick = 0; tick < 3; tick++, now += heartbeatCheckMs) host.checkHeartbeats();
  await handshaking.rpc('ping', {});
  assert.equal(handshaking.pings.length, 0, 'a client still in its handshake is not pinged');
  assert.equal(handshaking.socket.readyState, WebSocket.OPEN);
  const handshake = await handshaking.rpc('initialize', initialize(randomUUID()));
  assert.deepEqual(handshake.snapshots.map((snapshot: Json) => snapshot.resource), ['ahp-root://'], 'its handshake behaves as before');

  const silentId = randomUUID();
  const silent = await attach(server, t, token);
  await silent.rpc('initialize', initialize(silentId));
  silent.stopAnsweringPings();
  const session = `ahp-session:/${randomUUID()}`;
  await silent.rpc('createSession', { channel: session, provider: 'unfold', config: { repository: 'order-service', team: 'delivery', budgetUsd: 1, title: 'Heartbeat' }, activeClient: { clientId: silentId, tools: [] } });
  await answering.rpc('subscribe', { channel: session });
  const silentClosed = closed(silent.socket);
  host.checkHeartbeats();
  await silent.rpc('ping', {});
  assert.equal(silent.pings.length, 1);
  let closedAt: number | undefined;
  const pingedAt = now;
  for (const start = now; now - start <= 3_600_000; now += heartbeatCheckMs) {
    const before = answering.pings.length;
    host.checkHeartbeats();
    await answering.rpc('ping', {});
    await answering.rpc('ping', {});
    assert.ok(answering.pings.length - before <= 1, 'at most one ping per check');
    if (closedAt === undefined && silent.socket.readyState !== WebSocket.OPEN) closedAt = now;
  }
  assert.ok(closedAt !== undefined && closedAt - pingedAt <= 90_000, 'the silent client is closed within 90 seconds');
  assert.equal(await silentClosed, 1001);
  assert.equal(answering.socket.readyState, WebSocket.OPEN, 'the answering client stays connected through an idle hour');
  assert.ok(answering.pings.length >= 120 && answering.pings.length <= 122, `one ping every 30 seconds (${answering.pings.length})`);

  const removed = await answering.until(message => action(message, session, 'session/activeClientRemoved'));
  assert.deepEqual(removed.params.action, { type: 'session/activeClientRemoved', clientId: silentId }, 'its active-client mark goes as on a client-side close');
  assert.ok(!host.isDeparting(silentId));
  assert.equal((await attached()).clients, 2, 'only the two answering connections remain');
});
