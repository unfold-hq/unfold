import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentRuntime, AppConfig, ExecutionContext, RuntimeKind, Session } from '../src/types.ts';
import { application, login, request, createInput } from './api-support.ts';

function runtime(): AgentRuntime {
  return {
    kind: 'opencode',
    async prepare(session: Session) { return { id: `w-${session.id}`, backend: 'local', endpoint: 'http://127.0.0.1:1', directory: '/tmp/none' }; },
    async execute(context: ExecutionContext) {
      await new Promise<void>((_, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }));
      return { summary: 'unreachable', costUsd: 0, artifacts: [] };
    },
    async captureCandidate() { return { status: 'unsupported_workspace' } as any; },
  } as unknown as AgentRuntime;
}

const onLinkedForge = (extra?: (config: AppConfig) => void) => (config: AppConfig) => {
  config.runtime = { kind: 'opencode', backend: 'local', timeoutMs: 30_000 };
  config.links = { gitlab: { baseUrl: 'https://gitlab.example', scopes: ['read_repository'] } };
  config.repositories[0].url = 'https://gitlab.example/group/order-service.git';
  extra?.(config);
};

async function startOnForge(t: test.TestContext, configure: (config: AppConfig) => void, link?: Record<string, unknown>) {
  const server = await application('live', configure, new Map<RuntimeKind, AgentRuntime>([['opencode', runtime()]]));
  t.after(() => server.close());
  const { cookie, user } = await login(server.url);
  const minted: string[] = [];
  server.app.engine.broker = { mint: async (session: Session) => { minted.push(session.id); return { key: 'sk-session-fixture-key', alias: 'a', reference: `unfold-${session.id}-x`, budgetUsd: session.budgetUsd }; }, revoke: async () => {}, spend: async () => 0 };
  if (link) server.app.store.setSecret(`link:gitlab:${user.id}`, link);
  const created = await request(server.url, '/api/sessions', { method: 'POST', body: createInput({ runtime: 'opencode' }), cookie, csrf: true });
  const started = await request(server.url, `/api/sessions/${created.body.id}/start`, { method: 'POST', body: {}, cookie, csrf: true });
  return { started, minted };
}

test('a session on a forge the person has not linked is refused before anything is spent, naming the link to add', async t => {
  const { started, minted } = await startOnForge(t, onLinkedForge());
  assert.equal(started.status, 409, JSON.stringify(started.body));
  assert.equal(started.body.error.code, 'link_required');
  assert.match(started.body.error.message, /Order service .*gitlab\.example link.*Linked accounts/);
  assert.deepEqual(minted, [], 'no budget is minted for a session that cannot clone');
});

test('a person with a link to the forge starts as before', async t => {
  const { started } = await startOnForge(t, onLinkedForge(), { accessToken: 'glpat-fixture', method: 'token', login: 'person' });
  assert.equal(started.status, 200, JSON.stringify(started.body));
});

test('a workbench with a shared clone secret does not need the person\'s link', async t => {
  const { started } = await startOnForge(t, onLinkedForge(config => { config.kubernetes = { gitSecretName: 'workspace-git' } as AppConfig['kubernetes']; }));
  assert.notEqual(started.body?.error?.code, 'link_required', JSON.stringify(started.body));
});

test('a repository outside every linkable forge starts without a link', async t => {
  const { started } = await startOnForge(t, onLinkedForge(config => { config.repositories[0].url = 'https://git.example/order-service.git'; }));
  assert.equal(started.status, 200, JSON.stringify(started.body));
});
