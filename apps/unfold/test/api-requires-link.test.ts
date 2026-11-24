import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentRuntime, ExecutionContext, RuntimeKind, Session } from '../src/types.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { application, login, request, createInput, sessionUntil } from './api-support.ts';

test('a repository that requires a link refuses to start a session until its owner linked the forge', async t => {
  let prepared = 0;
  const runtime: AgentRuntime = {
    kind: 'opencode',
    async prepare(session: Session) { prepared += 1; return { id: `w-${session.id}`, backend: 'local', endpoint: 'http://127.0.0.1:1', directory: '/tmp/none' }; },
    async execute(context: ExecutionContext) { return { summary: 'done', costUsd: 0.01, artifacts: [], verdict: context.role.mode === 'read' ? 'approve' : undefined }; },
    async captureCandidate() { return { status: 'unsupported_workspace' } as any; },
    async dispose() {},
  } as unknown as AgentRuntime;
  const server = await application('live', config => {
    config.runtime = { kind: 'opencode', backend: 'local', timeoutMs: 30_000 };
    config.repositories[0].url = 'https://gitlab.example/group/order-service.git';
    config.repositories[0].requiresLink = true;
    config.links = { gitlab: { baseUrl: 'https://gitlab.example', clientId: 'application-id-1234', scopes: ['read_api'] } };
  }, new Map<RuntimeKind, AgentRuntime>([['opencode', runtime]]));
  t.after(() => server.close());
  const { cookie } = await login(server.url);
  server.app.engine.broker = { mint: async (session: Session) => ({ key: 'sk-session-fixture-key', alias: 'a', reference: `unfold-${session.id}`, budgetUsd: session.budgetUsd }), revoke: async () => {}, spend: async () => 0 };
  const created = await request(server.url, '/api/sessions', { method: 'POST', body: createInput({ runtime: 'opencode' }), cookie, csrf: true });
  const refused = await request(server.url, `/api/sessions/${created.body.id}/start`, { method: 'POST', body: {}, cookie, csrf: true });
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, 'link_required');
  assert.match(refused.body.error.message, /link gitlab\.example/);
  assert.equal(prepared, 0, 'no workspace is prepared for a refused start');
  const queued = await request(server.url, `/api/sessions/${created.body.id}`, { cookie });
  assert.equal(queued.body.status, 'queued');
  const links = (server.app.engine as unknown as { links: { describeFor: (userId: string, url: string) => unknown } }).links;
  links.describeFor = () => ({ provider: 'gitlab', host: 'gitlab.example', configured: true, oauth: true, linked: true });
  const started = await request(server.url, `/api/sessions/${created.body.id}/start`, { method: 'POST', body: {}, cookie, csrf: true });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  await sessionUntil(server.url, created.body.id, session => ['completed', 'failed'].includes(session.status), cookie);
  assert.equal(prepared, 1);
});

test('requiresLink must be a boolean', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-requires-link-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'config.json');
  await writeFile(file, JSON.stringify({ mode: 'live', dataDir: join(directory, 'data'), models: [{ id: 'coding', name: 'Coding', providerId: 'gateway', modelId: 'coding' }], repositories: [{ id: 'one', name: 'One', url: 'https://gitlab.example/one.git', baseBranch: 'main', verify: [], requiresLink: 'yes' }] }));
  assert.throws(() => loadConfig(['--config', file]), /requiresLink/);
});
