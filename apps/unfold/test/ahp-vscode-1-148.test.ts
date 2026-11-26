import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { application, request } from './api-support.ts';
import { action, connect, defaultChatOf, type Json } from './ahp-support.ts';
import { DemoRuntime } from '../src/runtime/demo.ts';
import { testTimeout } from './timeframes.ts';
import type { AgentRuntime, ExecutionContext, ExecutionResult, RuntimeKind } from '../src/types.ts';

type Server = Awaited<ReturnType<typeof application>>;

const vscode1148Offer = ['1.0.0', '0.10.0', '0.9.0'];
const vscodeEditorWindow = { name: 'vscode-editor-window', title: 'VS Code' };
const config = { repository: 'order-service', team: 'delivery', budgetUsd: 1 };
const remoteSessionTools = ['create_dev_container', 'create_remote_session', 'send_remote_message', 'list_agent_hosts', 'get_remote_session'];
const unadvertised = ['vscode.remoteSessions', 'vscode.upgradeMethod', 'vscode.build', 'vscode.devContainers', 'vscode.devContainerEnvironments', 'vscode.worktreeCleanup', 'tcpConnections', 'multipleChatProviders'];

function vscode1148Meta(machineId: string = randomUUID(), deviceId: string = randomUUID()): Json {
  return {
    'vscode.telemetryLevel': 'all',
    'vscode.clientConnectionKind': 'local',
    'vscode.clientMachineId': machineId,
    'vscode.clientDevDeviceId': deviceId,
    'vscode.ahpSessionUris': true,
    'vscode.ahpChatUris': true,
  };
}

class CapturingRuntime extends DemoRuntime {
  readonly contexts: string[] = [];
  private resolveStarted!: () => void;
  readonly started = new Promise<void>(resolve => { this.resolveStarted = resolve; });
  override async execute(context: ExecutionContext): Promise<ExecutionResult> {
    this.contexts.push(JSON.stringify({ ...context, signal: undefined, emit: undefined }));
    this.resolveStarted();
    return super.execute(context);
  }
}

async function window(t: TestContext, server: Server, token: string, meta: Json = vscode1148Meta()) {
  const client = connect(`${server.url.replace(/^http/, 'ws')}/?tkn=${token}`);
  t.after(() => client.close());
  await client.open;
  const clientId = randomUUID();
  const initialized = await client.rpc('initialize', { channel: 'ahp-root://', protocolVersions: vscode1148Offer, clientId, clientInfo: vscodeEditorWindow, _meta: meta, initialSubscriptions: ['ahp-root://'] });
  let seq = 0;
  const dispatch = (channel: string, dispatched: Json) => {
    const clientSeq = ++seq;
    client.notify('dispatchAction', { channel, clientSeq, action: dispatched });
    return client.until(message => message.method === 'action' && message.params.origin?.clientId === clientId && message.params.origin?.clientSeq === clientSeq);
  };
  return { client, clientId, initialized, dispatch };
}

async function host(t: TestContext, runtime?: AgentRuntime) {
  const server = await application('demo', undefined, runtime ? new Map<RuntimeKind, AgentRuntime>([['demo', runtime]]) : undefined);
  t.after(() => server.close());
  const issued = await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'VS Code 1.148' } });
  return { server, token: issued.body.token as string };
}

async function attached(t: TestContext, runtime?: AgentRuntime) {
  const { server, token } = await host(t, runtime);
  return { server, token, ...await window(t, server, token) };
}

function capturedLogs(t: TestContext): string[] {
  const logged: string[] = [];
  for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) t.mock.method(console, method, (...args: unknown[]) => { logged.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')); });
  return logged;
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

async function provisional(client: Awaited<ReturnType<typeof window>>['client'], title = 'VS Code 1.148'): Promise<string> {
  const session = `ahp-session:/${randomUUID()}`;
  await client.rpc('createSession', { channel: session, provider: 'unfold', config: { ...config, title } });
  return session;
}

test('the three settings VS Code 1.148 mirrors in root/configChanged come back to the sending window only and are not stored', { timeout: testTimeout(60_000) }, async t => {
  const { server, token, dispatch } = await attached(t);
  const other = await window(t, server, token);
  const mirrored = { keepAwakeWhileWorking: 'whenPluggedIn', hooksEnabled: true, sessionModelOptions: 'off' };
  const echoed = await dispatch('ahp-root://', { type: 'root/configChanged', config: mirrored });
  assert.equal(echoed.params.rejectionReason, undefined, echoed.params.rejectionReason);
  assert.deepEqual(echoed.params.action, { type: 'root/configChanged', config: mirrored }, 'the sender gets its own settings back');
  assert.deepEqual(await other.client.rpc('ping', {}), {});
  assert.equal(other.client.inbox.some(message => action(message, 'ahp-root://', 'root/configChanged')), false, 'another window of the same person never receives them');
  const later = await window(t, server, token);
  const root = JSON.stringify(later.initialized.snapshots.find((entry: Json) => entry.resource === 'ahp-root://').state);
  for (const key of Object.keys(mirrored)) assert.equal(root.includes(key), false, `a later window's root snapshot has no ${key}`);
  const stored = await everythingStored(server);
  for (const key of Object.keys(mirrored)) assert.equal(stored.includes(key), false, `no table, secret or file holds ${key}`);
});

test('the unsent composer text a 1.148 editor window sends on a provisional session\'s chat is echoed to the sender, reaches no other person, and is neither stored nor logged', { timeout: testTimeout(60_000) }, async t => {
  const { server, client, dispatch } = await attached(t);
  server.app.store.addUser({ id: 'bob-draft', name: 'bob-draft', role: 'operator', passwordHash: 'unused' });
  const bob = await window(t, server, server.app.agentHost.issueToken({ id: 'bob-draft', name: 'bob-draft', role: 'operator' }));
  const session = await provisional(client, 'Composing');
  const chat = defaultChatOf(session);
  await client.rpc('subscribe', { channel: session });
  await client.rpc('subscribe', { channel: chat });
  await bob.client.rpc('subscribe', { channel: chat }).catch(() => undefined);
  const logged = capturedLogs(t);
  const text = `Fix the rounding in the invoice total, keep the helper signature ${randomUUID()}`;
  for (const typed of [text.slice(0, 20), text]) {
    const echoed = await dispatch(chat, { type: 'chat/draftChanged', draft: { text: typed, origin: { kind: 'user' } } });
    assert.equal(echoed.params.rejectionReason, undefined, echoed.params.rejectionReason);
    assert.equal(echoed.params.action.draft.text, typed, 'the sender gets its draft back');
  }
  assert.deepEqual(await bob.client.rpc('ping', {}), {});
  assert.equal(JSON.stringify(bob.client.inbox).includes(text.slice(0, 20)), false, 'another person never sees the draft');
  assert.deepEqual(logged.filter(line => line.includes(text.slice(0, 20))), [], 'no log line carries it');
  assert.equal((await everythingStored(server)).includes(text.slice(0, 20)), false, 'no table, secret or file in the data directory holds it');
  assert.deepEqual(server.app.store.listSessions(), [], 'a draft starts nothing');
});

test('four session/isArchivedChanged dispatched back to back on four sessions are each echoed and each change the session\'s summary', { timeout: testTimeout(60_000) }, async t => {
  const { client, dispatch } = await attached(t);
  const sessions: string[] = [];
  for (let index = 0; index < 4; index++) sessions.push(await provisional(client, `Archive ${index}`));
  const archived = 64;
  const echoes = await Promise.all(sessions.map(session => dispatch(session, { type: 'session/isArchivedChanged', isArchived: true })));
  for (const [index, echoed] of echoes.entries()) {
    assert.equal(echoed.params.rejectionReason, undefined, echoed.params.rejectionReason);
    assert.equal(echoed.params.channel, sessions[index]);
  }
  for (const session of sessions) {
    const changed = await client.until(message => message.method === 'root/sessionSummaryChanged' && message.params.session === session);
    assert.equal(changed.params.changes.status & archived, archived, `${session} is archived in its summary`);
    assert.equal((await client.rpc('subscribe', { channel: session })).snapshot.state.status & archived, archived, `${session} is archived in a fresh snapshot`);
  }
});

test('a client\'s published remote-session and Dev Container tools are stored as its active client and never offered to a Team', { timeout: testTimeout(60_000) }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'unfold-ahp-1-148-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const runtime = new CapturingRuntime({ dataDir, delayMs: 5 });
  const { client, clientId, dispatch } = await attached(t, runtime);
  const session = await provisional(client, 'Published tools');
  const chat = defaultChatOf(session);
  await client.rpc('subscribe', { channel: session });
  await client.rpc('subscribe', { channel: chat });
  const tools = remoteSessionTools.map(name => ({ name, description: `VS Code's ${name}`, inputSchema: { type: 'object', properties: {} } }));
  const activeClient = { clientId, displayName: 'VS Code', tools };
  const set = await dispatch(session, { type: 'session/activeClientSet', activeClient });
  assert.equal(set.params.rejectionReason, undefined, set.params.rejectionReason);
  const state = (await client.rpc('subscribe', { channel: session })).snapshot.state;
  assert.deepEqual(state.activeClients, [activeClient], 'the client is stored as the active client with the tools it published');
  for (const name of remoteSessionTools) assert.equal(JSON.stringify(state.customizations).includes(name), false, `${name} is not among the session's customizations`);
  const started = await dispatch(chat, { type: 'chat/turnStarted', turnId: randomUUID(), startedAt: new Date().toISOString(), message: { text: 'Reproduce the rounding regression and fix it with the tests intact.', origin: { kind: 'user' } } });
  assert.equal(started.params.rejectionReason, undefined, started.params.rejectionReason);
  await runtime.started;
  for (const context of runtime.contexts) for (const name of remoteSessionTools) assert.equal(context.includes(name), false, `the Team's Run is not given ${name}`);
});

test('moveChat and createTcpConnection are refused as unknown methods and change nothing', { timeout: testTimeout(60_000) }, async t => {
  const { client } = await attached(t);
  const session = await provisional(client, 'Stays put');
  const target = await provisional(client, 'Target');
  const chat = defaultChatOf(session);
  const before = { listed: (await client.rpc('listSessions', {})).items, session: (await client.rpc('subscribe', { channel: session })).snapshot.state, target: (await client.rpc('subscribe', { channel: target })).snapshot.state };
  await assert.rejects(client.rpc('moveChat', { chat, session: target }), (error: any) => error.code === -32601, 'moveChat');
  await assert.rejects(client.rpc('createTcpConnection', { channel: 'ahp-root://', host: '127.0.0.1', port: 22 }), (error: any) => error.code === -32601, 'createTcpConnection');
  assert.deepEqual((await client.rpc('listSessions', {})).items, before.listed);
  assert.deepEqual((await client.rpc('subscribe', { channel: session })).snapshot.state, before.session, 'the chat stays in its session');
  assert.deepEqual((await client.rpc('subscribe', { channel: target })).snapshot.state, before.target, 'the target session gains no chat');
});

test('initialize advertises no remote sessions, upgrade method, build, Dev Containers, worktree cleanup, TCP connections or multiple chat providers, and the root state has no config', { timeout: testTimeout(60_000) }, async t => {
  const { initialized } = await attached(t);
  const answered = JSON.stringify(initialized);
  for (const name of unadvertised) assert.equal(answered.includes(name), false, `${name} is not advertised`);
  const root = initialized.snapshots.find((entry: Json) => entry.resource === 'ahp-root://').state;
  assert.equal(root.config, undefined, 'no root config, so no sandbox profile can be written to the host');
  assert.equal(root._meta?.['vscode.remoteSessions'], undefined);
});

test('initialize with VS Code 1.148\'s _meta and editor-window clientInfo succeeds, and the machine and device ids are neither stored nor logged', { timeout: testTimeout(60_000) }, async t => {
  const { server, token } = await host(t);
  const logged = capturedLogs(t);
  const machineId = `machine-${randomUUID()}`;
  const deviceId = `device-${randomUUID()}`;
  const { client, initialized } = await window(t, server, token, vscode1148Meta(machineId, deviceId));
  assert.equal(initialized.protocolVersion, '1.0.0');
  assert.equal(initialized.serverInfo.name, 'unfold');
  assert.deepEqual(await client.rpc('ping', {}), {});
  assert.deepEqual(logged.filter(line => line.includes(machineId) || line.includes(deviceId)), [], 'no log line carries them');
  const stored = await everythingStored(server);
  assert.equal(stored.includes(machineId), false, 'the machine id is not stored');
  assert.equal(stored.includes(deviceId), false, 'the device id is not stored');
});

test('a subscribe with the released windowed-delivery offer gets an ordinary snapshot', { timeout: testTimeout(60_000) }, async t => {
  const { client } = await attached(t);
  const session = await provisional(client, 'Windowed delivery');
  const plain = await client.rpc('subscribe', { channel: session });
  const offered = await client.rpc('subscribe', { channel: session, flowControl: { receive: { windowBytes: 1048576, maxFrameBytes: 262144 } } });
  assert.equal(offered.flowControl, undefined, 'the host takes no windowed delivery');
  assert.equal(offered.snapshot.resource, session);
  assert.deepEqual(offered.snapshot.state, plain.snapshot.state, 'the same snapshot as without the offer');
});
