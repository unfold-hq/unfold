import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { application, request } from './api-support.ts';
import { Auth } from '../src/auth.ts';
import { Store } from '../src/store.ts';
import { TrackerConnections } from '../src/tracker-connections.ts';
import { TenantScope } from '../src/tenant-scope.ts';
import { flagSettings, loadRegistry } from '../src/flags.ts';
import { workspaceManifests } from '../src/runtime/kubernetes.ts';
import { managedConfig } from '../src/runtime/workspace.ts';
import type { Membership } from '../src/tenancy.ts';
import type { AppConfig, Repository, Session, User } from '../src/types.ts';

const at = '2026-11-17T00:00:00.000Z';
const clickup = 'https://api.clickup.com/api/v2';
const agencyHome: Repository = { id: 'agency-home', name: 'Agency home', description: '', url: 'https://forge.example.test/agency/home.git', baseBranch: 'main', verify: [], tenant: 'agency' };
const otherShop: Repository = { id: 'other-shop', name: 'Other shop', description: '', url: 'https://forge.example.test/acme/shop.git', baseBranch: 'main', verify: [], tenant: 'other' };

function enforcedWithStoredRepositories(config: AppConfig): void {
  config.flags = flagSettings({ flags: { 'repositories.stored': { defaultVariant: 'on' } } }, loadRegistry(), {});
  config.tenancy = { enforce: true };
  config.repositories.push(agencyHome, otherShop);
}

async function signIn(app: Awaited<ReturnType<typeof application>>, id: string, memberships: Membership[]) {
  if (!app.app.store.getUser(id)) app.app.store.addUser({ id, name: id, role: 'admin', passwordHash: '', memberships });
  return new Auth(app.app.store, app.config).issue({ id, name: id, role: 'admin' }).cookie.split(';')[0];
}

const admin = (tenant: string): Membership[] => [{ kind: 'tenant', tenant, role: 'admin' }];

test('a stored repository may only name a public forge host the configuration uses', async t => {
  const app = await application('live', enforcedWithStoredRepositories);
  t.after(() => app.close());
  const olga = await signIn(app, 'olga', admin('agency'));
  for (const url of ['https://attacker.example.net/agency/site', 'https://10.0.0.7/agency/site', 'https://[::1]/agency/site', 'https://localhost/agency/site', 'https://gitea.forge.svc.cluster.local/agency/site', 'https://forge/agency/site', 'https://forge.example.test:8443/agency/site']) {
    const refused = await request(app.url, '/api/repositories', { method: 'POST', cookie: olga, body: { tenant: 'agency', url } });
    assert.equal(refused.status, 400, url);
    assert.equal(refused.body.error.code, 'repository_invalid', url);
  }
  assert.equal((await request(app.url, '/api/repositories', { method: 'POST', cookie: olga, body: { tenant: 'agency', url: 'https://forge.example.test/agency/site' } })).status, 201);
});

test('a stored repository is cloned without the shared git secret, a configured one still with it', () => {
  const config = { mode: 'live', dataDir: '/data', repositories: [], models: [{ id: 'code', name: 'Coding', providerId: 'gateway', modelId: 'coding' }], runtime: { kind: 'opencode', backend: 'kubernetes', timeoutMs: 20_000 }, litellm: { baseUrl: 'https://gateway.example/v1', adminUrl: 'https://gateway.example', masterKey: 'm', models: ['coding'], ttl: '4h' }, kubernetes: { namespace: 'workspaces', image: 'registry.example/agent:1', storageSize: '4Gi', cpu: '1', memory: '1Gi', gitSecretName: 'cluster-git' } } as unknown as AppConfig;
  const session = { id: 'abc123', branch: 'unfold/abc123', ownerId: 'alice' } as Session;
  const clone = (repository: Repository) => workspaceManifests(config, session, repository, { key: 'sk', alias: 'a', reference: 'a', budgetUsd: 1 }, { username: 'o', password: 'p' }, managedConfig(config)).find(item => item.kind === 'Pod')!.spec.initContainers[0].env as { name: string; valueFrom?: { secretKeyRef?: { name: string } } }[];
  const configured: Repository = { id: 'shop', name: 'Shop', description: '', url: 'https://forge.example.test/acme/shop.git', baseBranch: 'main', verify: [] };
  assert.ok(clone(configured).some(entry => entry.valueFrom?.secretKeyRef?.name === 'cluster-git'), 'a configured repository uses the shared secret');
  const stored = clone({ ...configured, id: 'r-shop', url: 'https://attacker.example.net/acme/shop', stored: true });
  assert.ok(!stored.some(entry => entry.valueFrom?.secretKeyRef?.name === 'cluster-git'), 'a stored repository never gets the shared secret');
  assert.ok(!stored.some(entry => entry.name === 'GIT_ASKPASS'), 'and clones anonymously');
});

test('a Tenant cannot take over another Tenant\'s owner/name, and a stored repository is owned as soon as it syncs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'unfold-scope-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'unfold.sqlite'), { key: randomBytes(32) });
  t.after(() => store.close());
  const config = { mode: 'live', dataDir: dir, taskSources: [], tenancy: { enforce: true }, repositories: [{ ...otherShop }, { ...agencyHome }] } as unknown as AppConfig;
  const connections = new TrackerConnections(store, config, { enforced: true, log: () => undefined });
  const scope = new TenantScope(config);
  connections.onSync(() => scope.rebuild());
  connections.joinStoredRepositories(true);
  const olga: User = { id: 'olga', name: 'olga', role: 'admin', memberships: admin('agency') };

  const hijack = connections.repositories.create(olga, { tenant: 'agency', url: 'https://forge.example.test/acme/shop-copy' });
  store.db.prepare('UPDATE repositories SET key=?, body=? WHERE id=?').run('github.com/acme/shop', JSON.stringify({ ...hijack, key: 'github.com/acme/shop', url: 'https://github.com/acme/shop' }), hijack.id);
  const own = connections.repositories.create(olga, { tenant: 'agency', url: 'https://forge.example.test/agency/new-site' });
  connections.sync();
  assert.equal(connections.repositories.list(olga).find(entry => entry.id === hijack.id)?.state, 'shadowed', 'another Tenant\'s owner/name on another host is shadowed');
  assert.deepEqual(scope.workItemOwner({ forge: 'forgejo', owner: 'acme', repo: 'shop' }), { tenant: 'other' }, 'the Work Items of acme/shop stay with their Tenant');
  assert.equal(own.id.startsWith('r-'), true);
  assert.deepEqual(scope.workItemOwner({ forge: 'forgejo', owner: 'agency', repo: 'new-site' }), { tenant: 'agency' }, 'TenantScope sees the stored repository after the sync');
});

test('a configured repository with a stored repository\'s id, or another Tenant\'s repository, never takes over a saved source', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'unfold-source-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'unfold.sqlite');
  const key = randomBytes(32);
  const store = new Store(path, { key });
  const config = { mode: 'live', dataDir: dir, taskSources: [], tenancy: { enforce: true }, repositories: [{ ...agencyHome }] } as unknown as AppConfig;
  const connections = new TrackerConnections(store, config, { enforced: true, log: () => undefined });
  connections.joinStoredRepositories(true);
  const olga: User = { id: 'olga', name: 'olga', role: 'admin', memberships: admin('agency') };
  const stored = connections.repositories.create(olga, { tenant: 'agency', url: 'https://forge.example.test/agency/site' });
  connections.sync();
  const connection = { id: 'tc-0123456789ab', provider: 'clickup', baseUrl: clickup, tenant: 'agency', tokenSetAt: at, createdAt: at, createdBy: 'olga', updatedAt: at, updatedBy: 'olga' };
  store.db.prepare("INSERT INTO integration_accounts(id,tenant,role,provider,base_url,created_at,body) VALUES(?,?,'tracker',?,?,?,?)").run(connection.id, 'agency', 'clickup', clickup, at, JSON.stringify(connection));
  const saved = connections.addSource(olga, connection.id, { project: '12', name: 'Sprint 12', repositoryId: stored.id });
  const state = () => connections.list(olga)[0].sources.find(entry => entry.id === saved.id)!.state;
  assert.equal(state(), 'active');

  config.repositories.splice(0, config.repositories.length, { ...agencyHome }, { id: stored.id, name: 'Taken', description: '', url: 'https://forge.example.test/other/taken.git', baseBranch: 'main', verify: [], tenant: 'other' });
  connections.sync();
  assert.equal(state(), 'repository_missing', 'a configured id equal to the stored one does not take the source');
  assert.ok(!(config.taskSources ?? []).some(entry => entry.id === saved.id), 'and the source is not used');

  store.db.prepare('UPDATE tracker_connection_sources SET body=? WHERE id=?').run(JSON.stringify({ ...saved, repositoryId: 'foreign' }), saved.id);
  config.repositories.splice(0, config.repositories.length, { ...agencyHome }, { id: 'foreign', name: 'Foreign', description: '', url: 'https://forge.example.test/other/foreign.git', baseBranch: 'main', verify: [], tenant: 'other' });
  connections.sync();
  assert.equal(state(), 'repository_missing', 'a repository of another Tenant is missing to the source');
  store.close();
});

test('stored repositories saved with plain ids get the r- prefix, and their grants and same-Tenant sources follow', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'unfold-prefix-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'unfold.sqlite');
  const key = randomBytes(32);
  const config = () => ({ mode: 'live', dataDir: dir, taskSources: [], tenancy: { enforce: true }, repositories: [{ ...agencyHome }] } as unknown as AppConfig);
  const first = new Store(path, { key });
  new TrackerConnections(first, config(), { enforced: true });
  first.db.exec('DROP TABLE repository_grants; DROP TABLE repositories;');
  first.db.exec("CREATE TABLE repositories (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, key TEXT NOT NULL UNIQUE, integration_account_id TEXT REFERENCES integration_accounts(id), created_at TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE repository_grants (client_project_id TEXT NOT NULL REFERENCES client_projects(id), repository_id TEXT NOT NULL REFERENCES repositories(id), granted_at TEXT NOT NULL, granted_by TEXT NOT NULL, PRIMARY KEY (client_project_id, repository_id));");
  const body = { id: 'site', key: 'forge.example.test/agency/site', url: 'https://forge.example.test/agency/site', name: 'agency/site', description: '', baseBranch: 'main', tenant: 'agency', createdAt: at, createdBy: 'olga', updatedAt: at, updatedBy: 'olga' };
  first.db.prepare('INSERT INTO repositories(id,tenant,key,integration_account_id,created_at,body) VALUES(?,?,?,NULL,?,?)').run('site', 'agency', body.key, at, JSON.stringify(body));
  first.db.prepare("INSERT INTO client_projects(id,tenant,client,slug,is_default,created_at,body) VALUES('cp-1','agency',NULL,'own-work',1,?,'{\"id\":\"cp-1\",\"name\":\"Own work\"}')").run(at);
  first.db.prepare("INSERT INTO repository_grants VALUES('cp-1','site',?,'olga')").run(at);
  const source = (id: string, tenant: string) => ({ id, connection: 'tc-0123456789ab', name: id, project: id, repositoryId: 'site', executionOwner: 'ploeg', tenant, createdAt: at, createdBy: 'olga', updatedAt: at, updatedBy: 'olga' });
  for (const entry of [source('mine', 'agency'), source('theirs', 'other')]) first.db.prepare('INSERT INTO tracker_connection_sources(id,connection_id,tenant,client,client_project_id,created_at,body) VALUES(?,?,?,NULL,NULL,?,?)').run(entry.id, entry.connection, entry.tenant, at, JSON.stringify(entry));
  first.close();

  const store = new Store(path, { key });
  t.after(() => store.close());
  const connections = new TrackerConnections(store, config(), { enforced: true, log: () => undefined });
  assert.deepEqual(connections.repositories.repositories().map(entry => entry.id), ['r-site']);
  assert.deepEqual(store.db.prepare('SELECT repository_id FROM repository_grants').all().map((row: any) => row.repository_id), ['r-site']);
  assert.deepEqual(connections.sources().map(entry => [entry.id, entry.repositoryId]), [['mine', 'r-site'], ['theirs', 'site']], 'only the same Tenant\'s source follows');
  store.db.prepare('INSERT INTO repositories(id,tenant,key,integration_account_id,created_at,body) VALUES(?,?,?,NULL,?,?)').run('r-copy', 'other', body.key, at, JSON.stringify({ ...body, id: 'r-copy', tenant: 'other' }));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM repositories').get()!.n, 2, 'a key is unique per Tenant, not across Unfold');
});

test('another Tenant learns nothing from keys or ids, and records land in the owner\'s chain with only that Tenant\'s memberships and the new id', async t => {
  const app = await application('live', enforcedWithStoredRepositories);
  t.after(() => app.close());
  const olga = await signIn(app, 'olga', [...admin('agency'), ...admin('secret-tenant')]);
  const otto = await signIn(app, 'otto', admin('other'));

  const created = await request(app.url, '/api/repositories', { method: 'POST', cookie: olga, body: { tenant: 'agency', url: 'https://forge.example.test/agency/site' } });
  assert.equal(created.status, 201);
  const sameKey = await request(app.url, '/api/repositories', { method: 'POST', cookie: otto, body: { tenant: 'other', url: 'https://forge.example.test/agency/site' } });
  assert.equal(sameKey.status, 201, 'another Tenant may store the same key: nothing tells it the key is taken');
  const again = await request(app.url, '/api/repositories', { method: 'POST', cookie: olga, body: { tenant: 'agency', url: 'https://forge.example.test/agency/site' } });
  assert.equal(again.status, 409, 'within the Tenant a key is unique');
  const listed = (cookie: string) => request(app.url, '/api/repositories', { cookie }).then(response => response.body.repositories.map((entry: any) => entry.state));
  assert.deepEqual(await listed(olga), ['shadowed'], 'the same owner/name in two Tenants is used by neither');
  assert.deepEqual(await listed(otto), ['shadowed']);

  for (const id of [created.body.repository.id, 'agency-home']) for (const method of ['PATCH', 'DELETE']) {
    const probed = await request(app.url, `/api/repositories/${id}`, { method, cookie: otto, body: { name: 'x' } });
    assert.equal(probed.status, 404, `${method} ${id}`);
    assert.equal(probed.body.error.code, 'repository_not_found', `${method} ${id} says the same as an id that does not exist`);
  }
  assert.equal((await request(app.url, '/api/repositories/agency-home', { method: 'PATCH', cookie: olga, body: { name: 'x' } })).body.error.code, 'repository_read_only', 'the owner still hears it is configured');

  const records = (app.app.store.db.prepare("SELECT tenant_id, event FROM audit_records WHERE tenant_id='agency'").all() as { tenant_id: string; event: string }[]);
  const creates = records.map(row => JSON.parse(row.event)).filter(event => event.entity?.type === 'Repository' && event.activity_name === 'Create' && event.status === 'Success');
  assert.deepEqual(creates.map(event => event.entity.uid), [created.body.repository.id], 'the created id is the record\'s uid');
  assert.ok(records.every(row => !row.event.includes('secret-tenant')), 'no other Tenant of the actor appears in the chain');
});
