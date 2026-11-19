import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { application, request } from './api-support.ts';
import { action, closed, connect, defaultChatOf, vscode1147ChatModel, vscode1147Truncation, vscodeAgentsWindow, type Json } from './ahp-support.ts';
import { repositoriesDirectory } from '../src/ahp/host.ts';
import { forwardedMessage, messageLimits } from '../src/ahp/attachments.ts';
import { DemoRuntime } from '../src/runtime/demo.ts';
import { testTimeout } from './timeframes.ts';
import type { AgentRuntime, ExecutionContext, ExecutionResult, PermissionRequest, RuntimeKind, Workspace } from '../src/types.ts';

type Server = Awaited<ReturnType<typeof application>>;

const objective = 'Reproduce the rounding regression and fix it with the tests intact.';
const vscode1147Offer = ['1.2.0', '1.1.0', '1.0.0', '0.10.0', '0.9.0'];
const vscode1147Meta = { 'vscode.ahpSessionUris': true, 'vscode.multipleChatProviders': true };

class WaitingRuntime extends DemoRuntime {
  readonly answers: Array<{ decision?: string; answers?: string[][] }> = [];
  private release?: () => void;
  override async execute(context: ExecutionContext): Promise<ExecutionResult> {
    if (context.role.mode === 'read') return { summary: 'Reviewed.', verdict: 'approve', artifacts: [], costUsd: 0 };
    context.emit({ type: 'permission', data: { nativeId: 'native-question-1', kind: 'question', title: 'Agent needs your answer', detail: 'Which rounding rule should money use?', questions: [{ question: 'Which rounding rule should money use?', header: 'Rounding', options: [{ label: 'Half up' }, { label: 'Half even' }], multiple: false }] } });
    await new Promise<void>((resolve, reject) => { this.release = resolve; context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }); });
    return { summary: 'Applied the answer.', artifacts: [], costUsd: 0 };
  }
  async respond(_workspace: Workspace, _request: PermissionRequest, answer: { decision?: 'once' | 'always' | 'reject'; answers?: string[][] }): Promise<void> { this.answers.push(answer); this.release?.(); }
}

async function window(t: TestContext, server: Server, token: string) {
  const client = connect(`${server.url.replace(/^http/, 'ws')}/?tkn=${token}`);
  t.after(() => client.close());
  await client.open;
  const clientId = randomUUID();
  const initialized = await client.rpc('initialize', { channel: 'ahp-root://', protocolVersions: vscode1147Offer, clientId, clientInfo: vscodeAgentsWindow, _meta: vscode1147Meta, initialSubscriptions: ['ahp-root://'] });
  let seq = 0;
  const dispatch = (channel: string, dispatched: Json) => {
    const clientSeq = ++seq;
    client.notify('dispatchAction', { channel, clientSeq, action: dispatched });
    return client.until(message => message.method === 'action' && message.params.origin?.clientId === clientId && message.params.origin?.clientSeq === clientSeq);
  };
  return { client, clientId, initialized, dispatch };
}

async function attached(t: TestContext, runtime?: AgentRuntime) {
  const server = await application('demo', undefined, runtime ? new Map<RuntimeKind, AgentRuntime>([['demo', runtime]]) : undefined);
  t.after(() => server.close());
  const issued = await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'VS Code 1.147' } });
  return { server, token: issued.body.token as string, ...await window(t, server, issued.body.token) };
}

async function waiting(t: TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(), 'unfold-ahp-1-147-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const runtime = new WaitingRuntime({ dataDir, delayMs: 5 });
  const attachedClient = await attached(t, runtime);
  const { client, dispatch } = attachedClient;
  const session = `ahp-session:/${randomUUID()}`;
  const chat = defaultChatOf(session);
  await client.rpc('createSession', { channel: session, provider: 'unfold', workingDirectories: [`${repositoriesDirectory}/order-service`], config: { team: 'delivery', budgetUsd: '1', title: 'VS Code 1.147' } });
  for (const channel of [session, chat]) await client.rpc('subscribe', { channel });
  const started = await dispatch(chat, { type: 'chat/turnStarted', turnId: randomUUID(), startedAt: new Date().toISOString(), message: { text: objective, origin: { kind: 'user' } } });
  assert.equal(started.params.rejectionReason, undefined, started.params.rejectionReason);
  const asked = (await client.until(message => action(message, chat, 'chat/inputRequested'))).params.action.request;
  return { ...attachedClient, runtime, session, chat, asked };
}

async function everythingStored(server: Server): Promise<string> {
  const { store } = server.app;
  const tables = (store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name);
  const rows = tables.map(table => JSON.stringify(store.db.prepare(`SELECT * FROM "${table}"`).all()));
  const secrets = (store.db.prepare('SELECT id FROM internal_state').all() as { id: string }[]).map(row => JSON.stringify(store.getSecret(row.id)));
  const files: string[] = [];
  for (const entry of await readdir(server.config.dataDir, { recursive: true, withFileTypes: true })) if (entry.isFile()) files.push((await readFile(join(entry.parentPath, entry.name))).toString('latin1'));
  return [...rows, ...secrets, ...files].join('\n');
}

test('VS Code 1.147 with the multi-harness setting offers protocol 1.2.0 first: the host answers it, lists sessions, opens one and takes a message', { timeout: testTimeout(60_000) }, async t => {
  const { server, client, initialized, dispatch } = await attached(t);
  assert.equal(initialized.protocolVersion, '1.2.0', 'the highest offer in the 1.x range');
  assert.equal(initialized.serverInfo.name, 'unfold');
  assert.deepEqual((await client.rpc('listSessions', {})).items, []);
  const session = `ahp-session:/${randomUUID()}`;
  const chat = defaultChatOf(session);
  await client.rpc('createSession', { channel: session, provider: 'unfold', workingDirectories: [`${repositoriesDirectory}/order-service`], config: { team: 'delivery', budgetUsd: '1', title: 'Offered 1.2.0' } });
  const opened = (await client.rpc('subscribe', { channel: session })).snapshot.state;
  assert.equal(opened.defaultChat, chat, 'a 1.x client gets the chat catalogue');
  await client.rpc('subscribe', { channel: chat });
  const started = await dispatch(chat, { type: 'chat/turnStarted', turnId: randomUUID(), startedAt: new Date().toISOString(), message: { text: objective, origin: { kind: 'user' } } });
  assert.equal(started.params.rejectionReason, undefined, started.params.rejectionReason);
  assert.equal(server.app.store.listSessions().length, 1, 'the message started the session');
  assert.deepEqual((await client.rpc('listSessions', {})).items.map((item: Json) => item.resource), [session], 'the started session is listed under the URI the client opened');
});

test('Unfold reports its path style at connect, which VS Code 1.147 reads instead of asking for the host\'s platform', { timeout: testTimeout(60_000) }, async t => {
  const { initialized } = await attached(t);
  assert.deepEqual(initialized.environment, { pathStyle: 'posix' });
});

test('a person\'s reviewer instructions in root/configChanged come back to the window that sent them only, and reach no log line and no stored record', { timeout: testTimeout(60_000) }, async t => {
  const { server, token, client, dispatch } = await attached(t);
  const other = await window(t, server, token);
  const instructions = `Never approve a push to production; ask me first. ${randomUUID()}`;
  const logged: string[] = [];
  for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) t.mock.method(console, method, (...args: unknown[]) => { logged.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')); });
  const config = { trustedUris: ['file:///Users/operator/projects'], assistedApprovalInstructions: instructions };
  const echoed = await dispatch('ahp-root://', { type: 'root/configChanged', config });
  assert.equal(echoed.params.rejectionReason, undefined, echoed.params.rejectionReason);
  assert.deepEqual(echoed.params.action, { type: 'root/configChanged', config }, 'the sender gets its own configuration back');
  assert.deepEqual(await other.client.rpc('ping', {}), {});
  assert.equal(JSON.stringify(other.client.inbox).includes(instructions), false, 'another window of the same person never sees them');
  assert.deepEqual(logged.filter(line => line.includes(instructions)), [], 'no log line carries them');
  assert.equal((await everythingStored(server)).includes(instructions), false, 'no table, secret or file in the data directory holds them');
  assert.equal(JSON.stringify(client.inbox.filter(message => message !== echoed)).includes(instructions), false, 'the sender receives them once, in its echo');
});

test('a repeated subscribe, also with a flowControl offer, gets a snapshot, and an unsubscribe for a channel that is not subscribed is ignored', { timeout: testTimeout(60_000) }, async t => {
  const { server, token, client } = await attached(t);
  const session = `ahp-session:/${randomUUID()}`;
  const chat = defaultChatOf(session);
  await client.rpc('createSession', { channel: session, provider: 'unfold', workingDirectories: [`${repositoriesDirectory}/order-service`], config: { team: 'delivery', budgetUsd: '1', title: 'Subscriptions' } });
  const first = await client.rpc('subscribe', { channel: session });
  const again = await client.rpc('subscribe', { channel: session, flowControl: { receive: { maxFrames: 4 } } });
  assert.equal(again.snapshot.resource, session);
  assert.deepEqual(again.snapshot.state, first.snapshot.state, 'the same snapshot, not an error');
  await client.rpc('subscribe', { channel: chat });
  client.notify('unsubscribe', { channel: `ahp-session:/${randomUUID()}` });
  client.notify('unsubscribe', { channel: 'ahp-root://unknown' });
  assert.deepEqual(await client.rpc('ping', {}), {});
  assert.equal(client.inbox.some(message => message.error), false, 'a notification gets no answer, not even an error');
  const other = await window(t, server, token);
  await other.client.rpc('subscribe', { channel: chat });
  const draft = await other.dispatch(chat, { type: 'chat/draftChanged', draft: { text: 'Still subscribed', origin: { kind: 'user' } } });
  assert.equal(draft.params.rejectionReason, undefined, draft.params.rejectionReason);
  const delivered = await client.until(message => action(message, chat, 'chat/draftChanged') && message.params.origin?.clientId === other.clientId);
  assert.equal(delivered.params.action.draft.text, 'Still subscribed', 'the subscriptions the client holds still deliver');
});

test('an answer to a question that carries VS Code 1.147\'s input response source is accepted and reaches the Run as before', { timeout: testTimeout(60_000) }, async t => {
  const { runtime, chat, asked, dispatch } = await waiting(t);
  const answers = { '0': { state: 'submitted', value: { kind: 'selected', value: '1' } } };
  const completed = await dispatch(chat, { type: 'chat/inputCompleted', requestId: asked.id, response: 'accept', answers, _meta: { 'agentHost.inputResponseSource': 'user' } });
  assert.equal(completed.params.rejectionReason, undefined, completed.params.rejectionReason);
  assert.equal(completed.params.action.type, 'chat/inputCompleted');
  assert.deepEqual(runtime.answers, [{ answers: [['Half even']] }], 'the Run receives the chosen label');
});

test('a message with a skill reference, a URL attachment or a claimed non-user origin is the signed-in person\'s text, with the URL passed on as their attachment', { timeout: testTimeout(60_000) }, async t => {
  const { server, client, chat, dispatch } = await waiting(t);
  const sent = [
    { text: 'Use the rounding skill for this.', origin: { kind: 'user' }, attachments: [{ type: 'resource', label: 'rounding', uri: 'file:///workspace/repository/.agents/skills/rounding/SKILL.md', displayKind: 'skill' }] },
    { text: 'Follow the invoice specification.', origin: { kind: 'user' }, attachments: [{ type: 'simple', label: 'https://example.test/invoice-spec', modelRepresentation: 'https://example.test/invoice-spec' }] },
    { text: 'Keep the helper signature.', origin: { kind: 'agent' } },
  ];
  const turnIds: string[] = [];
  for (const message of sent) {
    const turnId = randomUUID();
    turnIds.push(turnId);
    const echoed = await dispatch(chat, { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message });
    assert.equal(echoed.params.rejectionReason, undefined, `${message.text}: ${echoed.params.rejectionReason}`);
  }
  const shown = (await client.rpc('subscribe', { channel: chat })).snapshot.state;
  const turns = [...shown.turns, ...(shown.activeTurn ? [shown.activeTurn] : [])].filter((turn: Json) => turnIds.includes(turn.id));
  const received = sent.map(message => forwardedMessage(message, message.text, repositoriesDirectory, messageLimits.session).text);
  assert.match(received[1], /^Follow the invoice specification\.\n\nThe person attached `https:\/\/example\.test\/invoice-spec`\./);
  assert.deepEqual(turns.map((turn: Json) => [turn.message.text, turn.message.origin]), received.map(text => [text, { kind: 'user' }]), 'the chat shows each as the person\'s own message');
  const session = server.app.store.listSessions()[0];
  const instructions = server.app.store.events(session.id).filter(event => event.type === 'message' && (event.data as Json).role === 'operator');
  assert.deepEqual(instructions.map(event => [event.actor, (event.data as Json).text]), received.map(text => [session.ownerId, text]), 'each is the signed-in person\'s instruction, as typed, with only the URL added as their attachment');
});

test('a message from VS Code 1.147 after its connection slept through a turn of another window is sent, and an edit of an earlier message is still refused and removes nothing', { timeout: testTimeout(60_000) }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'unfold-ahp-1-147-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { server, token, client, clientId, dispatch } = await attached(t, new DemoRuntime({ dataDir, delayMs: 5 }));
  const session = `ahp-session:/${randomUUID()}`;
  const chat = defaultChatOf(session);
  await client.rpc('createSession', { channel: session, provider: 'unfold', workingDirectories: [`${repositoriesDirectory}/order-service`], config: { team: 'delivery', budgetUsd: '1', title: 'Slept through a turn' } });
  await client.rpc('subscribe', { channel: session });
  const opened = (await client.rpc('subscribe', { channel: chat })).snapshot.state;
  const mark = client.inbox.length;
  const first = randomUUID();
  const sentFirst = await dispatch(chat, { type: 'chat/turnStarted', turnId: first, startedAt: new Date().toISOString(), message: { text: 'Hello there', origin: { kind: 'user' } } });
  assert.equal(sentFirst.params.rejectionReason, undefined, sentFirst.params.rejectionReason);
  await client.until(message => action(message, chat, 'chat/error') && message.params.action.turnId === first);
  const before = vscode1147ChatModel(opened, client.inbox, chat, mark, opened.turns.map((turn: Json) => turn.id));
  client.close();
  await closed(client.socket);

  const other = await window(t, server, token);
  await other.client.rpc('subscribe', { channel: session });
  await other.client.rpc('subscribe', { channel: chat });
  const second = randomUUID();
  const sentSecond = await other.dispatch(chat, { type: 'chat/turnStarted', turnId: second, startedAt: new Date().toISOString(), message: { text: 'Anyone there?', origin: { kind: 'user' } } });
  assert.equal(sentSecond.params.rejectionReason, undefined, sentSecond.params.rejectionReason);
  await other.client.until(message => action(message, chat, 'chat/error') && message.params.action.turnId === second);

  const resumed = connect(`${server.url.replace(/^http/, 'ws')}/?tkn=${token}`);
  t.after(() => resumed.close());
  await resumed.open;
  const reconnected = await resumed.rpc('reconnect', { channel: 'ahp-root://', clientId, lastSeenServerSeq: 0, subscriptions: ['ahp-root://', session, chat], _meta: vscode1147Meta });
  assert.equal(reconnected.type, 'snapshot');
  const snapshot = reconnected.snapshots.find((entry: Json) => entry.resource === chat).state;
  assert.deepEqual(snapshot.turns.map((turn: Json) => turn.id), [first, second], 'the snapshot holds the turn the window slept through');
  await resumed.rpc('ping', {});
  const seen = vscode1147ChatModel(snapshot, resumed.inbox, chat, 0, before.known);
  let seq = 1000;
  const send = (dispatched: Json) => {
    const clientSeq = ++seq;
    resumed.notify('dispatchAction', { channel: chat, clientSeq, action: dispatched });
    return resumed.until(message => message.method === 'action' && message.params.origin?.clientId === clientId && message.params.origin?.clientSeq === clientSeq);
  };
  const truncation = vscode1147Truncation(seen.state, seen.known);
  if (truncation) {
    const confirmed = await send(truncation);
    assert.equal(confirmed.params.rejectionReason, undefined, `Chat history could not be restored: ${confirmed.params.rejectionReason}`);
  }
  const third = randomUUID();
  const sentThird = await send({ type: 'chat/turnStarted', turnId: third, startedAt: new Date().toISOString(), message: { text: objective, origin: { kind: 'user' } } });
  assert.equal(sentThird.params.rejectionReason, undefined, sentThird.params.rejectionReason);
  await resumed.until(message => action(message, chat, 'chat/turnComplete') && message.params.action.turnId === third);
  const started = (await resumed.rpc('subscribe', { channel: chat })).snapshot.state.turns.map((turn: Json) => turn.id);
  assert.equal(started.at(-1), third);

  const edited = await send({ type: 'chat/truncated' });
  assert.match(edited.params.rejectionReason ?? '', /keeps a session's history/, 'an edit of an earlier message is refused and says the history is kept');
  assert.deepEqual((await resumed.rpc('subscribe', { channel: chat })).snapshot.state.turns.map((turn: Json) => turn.id), started, 'and removes nothing');
});
