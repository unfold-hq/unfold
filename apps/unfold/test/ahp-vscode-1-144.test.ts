import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { application, configuration, login, request } from './api-support.ts';
import { action, connect, defaultChatOf, vscodeAgentsWindow, type Json } from './ahp-support.ts';
import { authenticateRefusal, repositoriesDirectory } from '../src/ahp/host.ts';
import { acceptSessionConfig, noRepositoryRefusal, repositoryFolderNames, resolveSessionConfig, sessionConfigState, startedConfigChange } from '../src/ahp/session-config.ts';
import { testTimeout } from './timeframes.ts';
import type { AgentRuntime, AppConfig, RuntimeKind, Session } from '../src/types.ts';

const objective = 'Reproduce the rounding regression and fix it with the tests intact.';
const picked = `${repositoriesDirectory}/order-service`;
const inert: AgentRuntime = {
  kind: 'opencode',
  async prepare(session) { return { id: session.id, backend: 'docker', directory: '/workspace/repository' }; },
  async execute() { throw new Error('not executed'); },
  async interrupt() {}, async dispose() {},
};

function approvalOfVscode1144(schema: Json): Json | undefined {
  const property = schema.properties.approvalMode;
  return property?.type === 'string' && Array.isArray(property.enum) && property.enum.includes('manual') && property.enum.every((value: string) => ['manual', 'assisted', 'allow-all'].includes(value)) ? property : undefined;
}

function availableOfVscode1144(resolved: Json): string[] {
  const offered: string[] = approvalOfVscode1144(resolved.schema)?.enum ?? [];
  const report = resolved.schema.properties.availableApprovalModes;
  return report?.type === 'array' && report.readOnly === true && Array.isArray(resolved.values.availableApprovalModes) ? offered.filter(value => resolved.values.availableApprovalModes.includes(value)) : offered;
}

function seedOfVscode1144(resolved: Json, organisationDefault: 'default' | 'autoApprove'): Json {
  const seeded = { ...resolved.values };
  const value = organisationDefault === 'autoApprove' ? 'allow-all' : 'manual';
  if (availableOfVscode1144(resolved).includes(value)) seeded.approvalMode = value;
  else delete seeded.approvalMode;
  delete seeded.availableApprovalModes;
  return seeded;
}

function placements(): AppConfig {
  const config = configuration('/nonexistent', 'live');
  config.runtime = { ...config.runtime, backend: 'docker', backends: ['docker', 'local'] };
  return config;
}

test('an organisation default of automatic approval holds only where the placement offers it, and is refused or reported as manual elsewhere', () => {
  const config = placements();
  const container = resolveSessionConfig(config, {}, 'order-service');
  assert.deepEqual(container.values.availableApprovalModes, ['manual', 'allow-all']);
  assert.deepEqual(container.schema.properties.availableApprovalModes, { type: 'array', title: 'Available approvals', readOnly: true, items: { type: 'string', title: 'Approval' } });
  const seeded = seedOfVscode1144(container, 'autoApprove');
  assert.equal(seeded.approvalMode, 'allow-all', 'VS Code 1.144 seeds the policy into approvalMode');
  assert.equal(resolveSessionConfig(config, seeded, 'order-service').values.approvalMode, 'allow-all');
  assert.equal(acceptSessionConfig(config, seeded, 'order-service').approvalMode, 'allow-all', 'a container is the sandbox automatic approval runs inside');

  const local = resolveSessionConfig(config, { placement: 'local' }, 'order-service');
  assert.deepEqual(local.values.availableApprovalModes, ['manual'], 'the picker is told a local directory offers only manual approval');
  assert.match(local.schema.properties.approvalMode.description, /needs a container or pod placement/);
  assert.equal(seedOfVscode1144(local, 'autoApprove').approvalMode, undefined, 'VS Code drops a mode the host withholds');
  const sent = { ...local.values, approvalMode: 'allow-all' };
  assert.equal(resolveSessionConfig(config, sent, 'order-service').values.approvalMode, 'manual', 'resolution reports the downgrade instead of keeping allow-all');
  assert.throws(() => acceptSessionConfig(config, sent, 'order-service'), /Automatic approval needs a container or pod placement/, 'creation refuses it instead of escalating');
  assert.throws(() => acceptSessionConfig(configuration('/nonexistent', 'demo'), { approvalMode: 'allow-all' }, 'order-service'), /container or pod/, 'the demonstration has no sandbox');

  const running = { repositoryId: 'order-service', teamId: 'delivery', budgetUsd: 1, title: 'Running', placement: 'local', approval: 'manual', status: 'running' } as Session;
  assert.deepEqual(sessionConfigState(config, running).values.availableApprovalModes, ['manual']);
  assert.throws(() => startedConfigChange(running, { approvalMode: 'allow-all' }), /container or pod/, 'a started local session never switches to automatic approval');
  assert.deepEqual(startedConfigChange({ ...running, placement: 'docker' }, { approvalMode: 'allow-all', availableApprovalModes: ['manual'] }), { approval: 'auto' }, 'the read-only report a client echoes is ignored');
});

async function attached(t: { after: (fn: () => unknown) => void }, mode: 'demo' | 'live' = 'demo', configure?: (config: AppConfig) => void) {
  const server = await application(mode, configure, mode === 'live' ? new Map<RuntimeKind, AgentRuntime>([['opencode', inert]]) : undefined);
  t.after(() => server.close());
  const cookie = mode === 'live' ? (await login(server.url)).cookie : undefined;
  const issued = await request(server.url, '/api/agent-host/tokens', { method: 'POST', cookie, body: { label: 'VS Code 1.144' } });
  const client = connect(`${server.url.replace(/^http/, 'ws')}/?tkn=${issued.body.token}`);
  t.after(() => client.close());
  await client.open;
  const clientId = randomUUID();
  await client.rpc('initialize', { channel: 'ahp-root://', protocolVersions: ['1.0.0', '0.10.0', '0.9.0'], clientId, clientInfo: vscodeAgentsWindow, _meta: { 'vscode.ahpSessionUris': true }, initialSubscriptions: ['ahp-root://'] });
  let seq = 0;
  const dispatch = (channel: string, dispatched: Json) => {
    const clientSeq = ++seq;
    client.notify('dispatchAction', { channel, clientSeq, action: dispatched });
    return client.until(message => message.method === 'action' && message.params.origin?.clientSeq === clientSeq);
  };
  return { server, client, dispatch };
}

test('createSession over the wire takes allow-all for a container and refuses it for a local directory', { timeout: testTimeout(60_000) }, async t => {
  const { server, client } = await attached(t, 'live', config => { config.runtime = { kind: 'opencode', backend: 'docker', backends: ['docker', 'local'], timeoutMs: 30_000 }; });
  const container = `ahp-session:/${randomUUID()}`;
  await client.rpc('createSession', { channel: container, provider: 'unfold', workingDirectories: [picked], config: { team: 'delivery', budgetUsd: '1', placement: 'docker', approvalMode: 'allow-all' } });
  const draft = (await client.rpc('subscribe', { channel: container })).snapshot.state.config;
  assert.equal(draft.values.approvalMode, 'allow-all');
  assert.deepEqual(draft.values.availableApprovalModes, ['manual', 'allow-all']);
  await assert.rejects(
    client.rpc('createSession', { channel: `ahp-session:/${randomUUID()}`, provider: 'unfold', workingDirectories: [picked], config: { team: 'delivery', budgetUsd: '1', placement: 'local', approvalMode: 'allow-all' } }),
    (error: Json) => error.code === -32602 && /container or pod placement/.test(error.message),
  );
  assert.deepEqual(server.app.store.listSessions(), [], 'a draft is no session and no Run');
});

test('a folderless quick chat, also as N Compare Models drafts, is refused with how to pick a repository and never starts a Run', { timeout: testTimeout(60_000) }, async t => {
  const { server, client } = await attached(t);
  const resolved = await client.rpc('resolveSessionConfig', { channel: 'ahp-root://', provider: 'unfold' });
  assert.equal(resolved.values.repository, undefined, 'no repository is invented for a session without a folder');
  const refusal = String(resolved.schema.properties.repository.description);
  assert.match(refusal, /^A Team works on a repository: open Workspace ▾ › Folders \(Unfold\) and pick .+\. To ask what is running or waiting instead, start a chat with the agent Unfold$/);
  const refused = (error: Json) => error.code === -32602 && error.message === refusal;
  const drafts = [randomUUID(), randomUUID(), randomUUID()].map(id => `ahp-session:/${id}`);
  for (const session of drafts) await assert.rejects(client.rpc('createSession', { channel: session, provider: 'unfold', config: resolved.values, progressToken: randomUUID() }), refused);
  await assert.rejects(client.rpc('createSession', { channel: `ahp-session:/${randomUUID()}`, provider: 'unfold' }), refused, 'no configuration at all');
  await assert.rejects(client.rpc('createSession', { channel: `ahp-session:/${randomUUID()}`, provider: 'unfold', workingDirectories: [repositoriesDirectory] }), refused, 'the folder above the repositories is no repository');
  for (const session of drafts) {
    await assert.rejects(client.rpc('createChat', { channel: session, chat: defaultChatOf(session), initialMessage: { text: objective } }));
  }
  assert.deepEqual(server.app.store.listSessions(), [], 'no session and so no Run');
  assert.deepEqual((await client.rpc('listSessions', {})).items.filter((item: Json) => drafts.includes(item.resource)), []);

  const session = `ahp-session:/${randomUUID()}`;
  await client.rpc('createSession', { channel: session, provider: 'unfold', workingDirectories: [picked], config: resolved.values });
  assert.equal((await client.rpc('subscribe', { channel: session })).snapshot.state.config.values.repository, 'order-service', 'picking the folder is enough');
});

test('authenticate with an MCP server target is refused because the host advertises no protected resource, and a changeset review carrying nonce and isEditing is taken without a refusal', { timeout: testTimeout(60_000) }, async t => {
  const { client, dispatch } = await attached(t);
  const id = randomUUID();
  const session = `ahp-session:/${id}`;
  const chat = defaultChatOf(session);
  await client.rpc('createSession', { channel: session, provider: 'unfold', workingDirectories: [picked], config: { team: 'delivery', budgetUsd: '1' } });
  await client.rpc('subscribe', { channel: session });
  await client.rpc('subscribe', { channel: chat });
  await assert.rejects(client.rpc('authenticate', { channel: 'ahp-root://', resource: 'https://mcp.example.test', token: 'opaque', target: { kind: 'mcpServer', session, customizationId: 'mcp-1' } }), (error: Json) => error.code === -32602 && error.message === authenticateRefusal);
  const started = await dispatch(chat, { type: 'chat/turnStarted', turnId: randomUUID(), startedAt: new Date().toISOString(), message: { text: objective, origin: { kind: 'user' } } });
  assert.equal(started.params.rejectionReason, undefined, started.params.rejectionReason);
  const changeset = `ahp-changeset:/${id}`;
  await client.rpc('subscribe', { channel: changeset });
  const reviewed = await dispatch(changeset, { type: 'changeset/filesReviewChanged', files: ['src/order.js'], reviewed: true, nonce: 'n-1', isEditing: false });
  assert.equal(reviewed.params.rejectionReason, undefined, reviewed.params.rejectionReason);
  assert.equal(reviewed.params.action.type, 'changeset/filesReviewChanged');
  assert.ok(action(reviewed, changeset, 'changeset/filesReviewChanged'));
});

test('authenticate carrying an ID token and an account is refused, and none of the token, the ID token or the account is logged or stored', { timeout: testTimeout(60_000) }, async t => {
  const { server, client } = await attached(t);
  const secrets = { token: `access-${randomUUID()}`, idToken: `eyJ${randomUUID()}.id-token`, accountId: `account-${randomUUID()}` };
  const logged: string[] = [];
  for (const method of ['log', 'info', 'warn', 'error'] as const) t.mock.method(console, method, (...line: unknown[]) => { logged.push(line.map(String).join(' ')); });
  for (const resource of ['https://mcp.example.test', 'https://unfold.example.test']) {
    await assert.rejects(client.rpc('authenticate', { channel: 'ahp-root://', resource, ...secrets }), (error: Json) => error.code === -32602 && error.message === authenticateRefusal, `${resource} was never advertised`);
  }
  assert.deepEqual(await client.rpc('ping', {}), {}, 'the connection stays open');
  t.mock.restoreAll();
  const stored = await Promise.all((await readdir(server.config.dataDir, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => readFile(join(entry.parentPath, entry.name))));
  for (const [name, value] of Object.entries(secrets)) {
    assert.ok(!logged.some(line => line.includes(value)), `${name} is not logged`);
    assert.ok(!stored.some(content => content.includes(value)), `${name} is not stored`);
  }
});

test('the no-repository refusal names the folders to pick, at most three, and points to the chat when there are none', () => {
  const repository = (id: string) => ({ id, name: id, description: '', url: `https://forge.example/team/${id}.git`, baseBranch: 'main', verify: [] });
  assert.equal(noRepositoryRefusal([repository('orders')]), 'A Team works on a repository: open Workspace ▾ › Folders (Unfold) and pick orders. To ask what is running or waiting instead, start a chat with the agent Unfold');
  const four = ['a', 'b', 'c', 'd'].map(repository);
  assert.deepEqual([...repositoryFolderNames(four).values()], ['a', 'b', 'c', 'd']);
  assert.match(noRepositoryRefusal(four), /pick a, b, c or another\./);
  assert.equal(noRepositoryRefusal([]), 'This workbench offers no repository, so no Team can start. To ask what is running or waiting, start a chat with the agent Unfold');
});
