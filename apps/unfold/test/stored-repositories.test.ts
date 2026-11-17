import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { application, login, request } from './api-support.ts';
import { flagSettings, loadRegistry } from '../src/flags.ts';
import { Auth } from '../src/auth.ts';
import { Store } from '../src/store.ts';
import { TrackerConnections } from '../src/tracker-connections.ts';
import type { Membership } from '../src/tenancy.ts';
import type { AppConfig, User } from '../src/types.ts';

const developmentSchema = `
  CREATE TABLE IF NOT EXISTS tracker_connections (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL, UNIQUE (tenant, provider, base_url));
  CREATE TABLE IF NOT EXISTS tracker_connection_sources (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES tracker_connections(id), tenant TEXT NOT NULL, client TEXT, created_at TEXT NOT NULL, body TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS tracker_connection_sources_connection ON tracker_connection_sources(connection_id);
`;

const at = '2026-10-31T00:00:00.000Z';
const clickup = 'https://api.clickup.com/api/v2';
const fakeToken = (name: string) => ['pk', '9001', name].join('_');
const connection = (id: string, tenant: string, account: string) => ({ id, provider: 'clickup', baseUrl: clickup, tenant, account, tokenSetAt: at, createdAt: at, createdBy: 'olga', updatedAt: at, updatedBy: 'olga' });
const source = (id: string, connectionId: string, tenant: string, repositoryId: string, client?: string) => ({ id, connection: connectionId, name: id, project: id.replace(/\D/g, '') || '1', repositoryId, executionOwner: 'ploeg', tenant, ...(client ? { client } : {}), createdAt: at, createdBy: 'olga', updatedAt: at, updatedBy: 'olga' });
const count = (store: Store, sql: string) => (store.db.prepare(sql).get() as { n: number }).n;

function configFor(dataDir: string): AppConfig {
  return {
    mode: 'live', host: '127.0.0.1', port: 0, dataDir, publicDir: dataDir, teams: [], models: [], taskSources: [], tenancy: { enforce: true },
    repositories: [
      { id: 'shop', name: 'Shop', description: '', url: 'https://forge.example.test/acme/shop.git', baseBranch: 'main', verify: [], tenant: 'acme' },
      { id: 'portal', name: 'Portal', description: '', url: 'https://forge.example.test/globex/portal.git', baseBranch: 'main', verify: [], tenant: 'globex', client: 'initech' },
    ],
  } as unknown as AppConfig;
}

test('a store written by the schema before Integration Accounts is copied without losing a row, keeps its old table, and every token still opens under its id', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'unfold-migration-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'unfold.sqlite');
  const key = randomBytes(32);
  const tokens: Record<string, string> = { 'tc-0123456789ab': fakeToken('ACMESEALED'), 'tc-ba9876543210': fakeToken('GLOBEXSEALED') };
  const connections = [connection('tc-0123456789ab', 'acme', 'Unfold bot'), connection('tc-ba9876543210', 'globex', 'Globex bot'), connection('tc-aaaaaaaaaaaa', 'umbrella', 'Imported, no token')];
  const sources = [source('sprint-12', 'tc-0123456789ab', 'acme', 'shop'), source('sprint-13', 'tc-0123456789ab', 'acme', 'shop'), source('portal-7', 'tc-ba9876543210', 'globex', 'portal', 'initech')];

  const before = new Store(path, { key });
  before.db.exec(developmentSchema);
  for (const entry of connections) before.db.prepare('INSERT INTO tracker_connections(id,tenant,provider,base_url,created_at,body) VALUES(?,?,?,?,?,?)').run(entry.id, entry.tenant, entry.provider, entry.baseUrl, entry.createdAt, JSON.stringify(entry));
  for (const [id, token] of Object.entries(tokens)) before.setSecret(`tracker-connection:${id}`, { token });
  for (const entry of sources) before.db.prepare('INSERT INTO tracker_connection_sources(id,connection_id,tenant,client,created_at,body) VALUES(?,?,?,?,?,?)').run(entry.id, entry.connection, entry.tenant, entry.client ?? null, entry.createdAt, JSON.stringify(entry));
  const sealedBefore = before.db.prepare("SELECT id, ciphertext FROM internal_state WHERE id LIKE 'tracker-connection:%' ORDER BY id").all();
  before.close();

  const store = new Store(path, { key });
  t.after(() => store.close());
  const config = configFor(dir);
  const migrated = new TrackerConnections(store, config, { enforced: true, now: () => new Date('2026-11-17T00:00:00.000Z') });
  const tables = (store.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as { name: string }[]).map(row => row.name);
  assert.ok(!tables.some(name => name.endsWith('_before')), 'the copy made while reshaping is gone');
  assert.equal(count(store, 'SELECT count(*) AS n FROM tracker_connections'), connections.length, 'the old table stays for a rollback');
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_list(tracker_connection_sources)').all().map((key: any) => key.from), ['client_project_id'], 'a source refers to its Client Project, and its connection id is checked by Unfold, so every image can add one');
  for (const table of ['tracker_connections', 'integration_accounts', 'tracker_connection_sources', 'client_projects', 'repositories', 'repository_grants']) assert.ok(tables.includes(table), `${table} exists`);
  assert.ok((store.db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='tracker_connection_sources'").all() as { name: string }[]).some(row => row.name === 'tracker_connection_sources_connection'), 'the source index is on the new table');

  const byId = [...connections].sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(migrated.connections(), byId, 'every connection keeps its id and body');
  assert.deepEqual(store.db.prepare('SELECT DISTINCT role, account_id FROM integration_accounts').all().map(row => ({ ...row })), [{ role: 'tracker', account_id: '' }]);
  assert.deepEqual(store.db.prepare("SELECT id, ciphertext FROM internal_state WHERE id LIKE 'tracker-connection:%' ORDER BY id").all(), sealedBefore, 'the sealed tokens are not touched');
  for (const [id, token] of Object.entries(tokens)) assert.deepEqual(store.getSecret(`tracker-connection:${id}`), { token });

  const ownWork = (tenant: string) => (row => row ? JSON.parse(row.body) as { id: string; name: string } : undefined)(store.db.prepare('SELECT body FROM client_projects WHERE tenant=? AND is_default=1').get(tenant) as { body: string } | undefined);
  assert.equal(ownWork('acme')?.name, 'Own work', 'the Tenant with a source without a Client gets Own work');
  assert.equal(ownWork('globex'), undefined, 'a Tenant whose sources all name a Client does not');
  assert.deepEqual(migrated.sources().map(entry => [entry.id, entry.client ?? null, entry.clientProject ?? null]), [['portal-7', 'initech', null], ['sprint-12', null, ownWork('acme')!.id], ['sprint-13', null, ownWork('acme')!.id]]);
  assert.deepEqual(migrated.sources().map(({ clientProject: _, ...rest }) => rest), [sources[2], sources[0], sources[1]], 'every source keeps its body');

  migrated.sync();
  assert.deepEqual(config.taskSources!.map(entry => [entry.id, entry.token]), [['portal-7', tokens['tc-ba9876543210']], ['sprint-12', tokens['tc-0123456789ab']], ['sprint-13', tokens['tc-0123456789ab']]], 'the running workbench reads with the same tokens');

  const again = new TrackerConnections(store, configFor(dir), { enforced: true });
  assert.deepEqual(again.connections(), byId, 'a second start changes nothing');
  assert.equal(count(store, 'SELECT count(*) AS n FROM client_projects'), 1);

  const forge = store.db.prepare("INSERT INTO integration_accounts(id,tenant,role,provider,base_url,account_id,created_at,body) VALUES(?,'acme','forge','github','https://api.github.com',?,?,'{}')");
  forge.run('ia-1', '1001', at);
  forge.run('ia-2', '1002', at);
  assert.throws(() => forge.run('ia-3', '1002', at), /UNIQUE/, 'one account per Tenant, provider, instance and installation');
  assert.deepEqual(again.connections().map(entry => entry.id), byId.map(entry => entry.id), 'forge accounts are not tracker connections');
});

const storedRepositoriesOn = (config: AppConfig) => { config.flags = flagSettings({ flags: { 'repositories.stored': { defaultVariant: 'on' } } }, loadRegistry(), {}); };

async function signIn(app: Awaited<ReturnType<typeof application>>, id: string, role: User['role'], memberships?: Membership[]) {
  if (!app.app.store.getUser(id)) app.app.store.addUser({ id, name: id, role, passwordHash: '', ...(memberships ? { memberships } : {}) });
  return new Auth(app.app.store, app.config).issue({ id, name: id, role }).cookie.split(';')[0];
}

const auditEntities = (app: Awaited<ReturnType<typeof application>>, types: string[]) => (app.app.store.db.prepare('SELECT tenant_id, event FROM audit_records ORDER BY at, seq').all() as { tenant_id: string; event: string }[])
  .map(row => ({ tenant: row.tenant_id, event: JSON.parse(row.event) }))
  .filter(entry => types.includes(entry.event.entity?.type))
  .map(entry => `${entry.tenant} ${entry.event.entity.type} ${entry.event.activity_name} ${entry.event.status}`);

test('an administrator adds a repository from the screen: Own work is made on first use, holds a grant, and the repository joins the configured ones', async t => {
  const app = await application('live', storedRepositoriesOn);
  t.after(() => app.close());
  const { cookie } = await login(app.url);

  const empty = await request(app.url, '/api/client-projects', { cookie });
  assert.deepEqual(empty.body, { tenants: [{ tenant: 'default', visible: false, projects: [] }] });

  const withCredentials = `https://${['someone', 'hunter2'].join(':')}@forge.example.test/acme/shop`;
  for (const url of ['http://forge.example.test/acme/shop', withCredentials, 'https://forge.example.test/shop', 'not a url']) {
    const refused = await request(app.url, '/api/repositories', { method: 'POST', cookie, body: { url } });
    assert.equal(refused.status, 400, url);
    assert.equal(refused.body.error.code, 'repository_invalid');
  }
  const created = await request(app.url, '/api/repositories', { method: 'POST', cookie, body: { url: 'https://Forge.Example.test/Acme/Shop.git', baseBranch: 'trunk' } });
  assert.equal(created.status, 201, created.text);
  const repository = created.body.repository;
  assert.equal(repository.id, 'shop');
  assert.equal(repository.key, 'forge.example.test/acme/shop');
  assert.equal(repository.name, 'acme/shop');
  assert.equal(repository.baseBranch, 'trunk');
  assert.equal(repository.state, 'active');
  assert.deepEqual(repository.grants.map((grant: any) => grant.name), ['Own work']);
  const twice = await request(app.url, '/api/repositories', { method: 'POST', cookie, body: { url: 'https://forge.example.test/acme/shop/' } });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error.code, 'repository_exists');

  const projects = await request(app.url, '/api/client-projects', { cookie });
  assert.equal(projects.body.tenants[0].visible, false, 'no Client, so the screens show no projects');
  assert.deepEqual(projects.body.tenants[0].projects.map((project: any) => [project.name, project.isDefault, project.id === repository.grants[0].clientProject]), [['Own work', true, true]]);

  assert.deepEqual(app.config.repositories.map(entry => [entry.id, entry.stored ?? false]), [['order-service', false], ['shop', true]], 'stored repositories come after the configured ones');
  const second = await request(app.url, '/api/repositories', { method: 'POST', cookie, body: { url: 'https://forge.example.test/acme/web' } });
  assert.equal(second.status, 201);
  assert.equal(second.body.repository.grants[0].clientProject, repository.grants[0].clientProject, 'Own work is made once');

  const badBranch = await request(app.url, '/api/repositories/shop', { method: 'PATCH', cookie, body: { name: 'Webshop', baseBranch: '../main' } });
  assert.equal(badBranch.status, 400);
  const changed = await request(app.url, '/api/repositories/shop', { method: 'PATCH', cookie, body: { name: 'Webshop' } });
  assert.equal(changed.body.repository.name, 'Webshop');
  assert.equal(changed.body.repository.key, 'forge.example.test/acme/shop');
  assert.equal(app.config.repositories.find(entry => entry.id === 'shop')?.name, 'Webshop');
  const configured = await request(app.url, '/api/repositories/order-service', { method: 'DELETE', cookie });
  assert.equal(configured.status, 409);
  assert.equal(configured.body.error.code, 'repository_read_only');

  app.app.store.db.prepare("INSERT INTO integration_accounts(id,tenant,role,provider,base_url,created_at,body) VALUES(?,?,'tracker',?,?,?,?)").run('tc-0123456789ab', 'default', 'clickup', clickup, at, JSON.stringify(connection('tc-0123456789ab', 'default', 'Unfold bot')));
  const admin = app.app.store.getUserByName('admin')!;
  const saved = app.app.connections.addSource({ id: admin.id, name: admin.name, role: 'admin' }, 'tc-0123456789ab', { project: '777', name: 'Sprint 12', repositoryId: 'shop' });
  assert.equal(saved.clientProject, repository.grants[0].clientProject, 'a source without a Client lands in Own work');
  const inUse = await request(app.url, '/api/repositories/shop', { method: 'DELETE', cookie });
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.error.code, 'repository_in_use');
  assert.equal((await request(app.url, '/api/repositories/web', { method: 'DELETE', cookie })).status, 200);
  assert.equal(count(app.app.store, "SELECT count(*) AS n FROM repository_grants WHERE repository_id='web'"), 0);
  assert.deepEqual(app.config.repositories.map(entry => entry.id), ['order-service', 'shop']);

  assert.deepEqual(auditEntities(app, ['Repository', 'Repository Grant', 'Client Project']), [
    'default Repository Create Failure', 'default Repository Create Failure', 'default Repository Create Failure', 'default Repository Create Failure',
    'default Client Project Create Success', 'default Repository Grant Create Success', 'default Repository Create Success', 'default Repository Create Failure',
    'default Repository Grant Create Success', 'default Repository Create Success',
    'default Repository Update Failure', 'default Repository Update Success', 'default Repository Delete Failure', 'default Repository Delete Failure',
    'default Repository Grant Delete Success', 'default Repository Delete Success',
  ]);
});

test('a repository added to the configuration later wins, and the stored one is shadowed and kept', async t => {
  const app = await application('live', storedRepositoriesOn);
  t.after(() => app.close());
  const { cookie } = await login(app.url);
  assert.equal((await request(app.url, '/api/repositories', { method: 'POST', cookie, body: { url: 'https://forge.example.test/acme/shop' } })).status, 201);

  app.config.repositories = [...app.config.repositories.filter(entry => !entry.stored), { id: 'webshop', name: 'Webshop', description: '', url: 'git@forge.example.test:acme/shop.git', baseBranch: 'main', verify: [] }];
  await app.restart();
  const { cookie: after } = await login(app.url);
  const listed = await request(app.url, '/api/repositories', { cookie: after });
  assert.deepEqual(listed.body.repositories.map((entry: any) => [entry.id, entry.state]), [['shop', 'shadowed']]);
  assert.deepEqual(app.config.repositories.map(entry => entry.id), ['order-service', 'webshop'], 'the configured entry is used');
  assert.equal(count(app.app.store, "SELECT count(*) AS n FROM repositories WHERE id='shop'"), 1, 'and the stored one is not deleted');
});

test('only an Admin of the Tenant adds or changes its repositories; another Tenant cannot tell they exist; projects show once the Tenant has a Client', async t => {
  const app = await application('live', config => { storedRepositoriesOn(config); config.tenancy = { enforce: true }; });
  t.after(() => app.close());
  const owner = await signIn(app, 'olga', 'admin', [{ kind: 'tenant', tenant: 'agency', role: 'admin' }]);
  const outsider = await signIn(app, 'otto', 'admin', [{ kind: 'tenant', tenant: 'other', role: 'admin' }]);
  const developer = await signIn(app, 'dev', 'operator', [{ kind: 'tenant', tenant: 'agency', role: 'developer' }]);

  const byDeveloper = await request(app.url, '/api/repositories', { method: 'POST', cookie: developer, body: { tenant: 'agency', url: 'https://forge.example.test/agency/site' } });
  assert.equal(byDeveloper.status, 403);
  const wrongTenant = await request(app.url, '/api/repositories', { method: 'POST', cookie: outsider, body: { tenant: 'agency', url: 'https://forge.example.test/agency/site' } });
  assert.equal(wrongTenant.status, 403);
  assert.equal(count(app.app.store, 'SELECT count(*) AS n FROM repositories'), 0);

  const unknownAccount = await request(app.url, '/api/repositories', { method: 'POST', cookie: owner, body: { tenant: 'agency', url: 'https://forge.example.test/agency/site', integrationAccount: 'ia-missing' } });
  assert.equal(unknownAccount.status, 400, 'an integration account must be a forge account of the Tenant');
  assert.equal((await request(app.url, '/api/repositories', { method: 'POST', cookie: owner, body: { tenant: 'agency', url: 'https://forge.example.test/agency/site' } })).status, 201);

  assert.deepEqual((await request(app.url, '/api/repositories', { cookie: developer })).body.repositories.map((entry: any) => [entry.id, entry.manage]), [['site', false]]);
  assert.deepEqual((await request(app.url, '/api/repositories', { cookie: outsider })).body.repositories, []);
  for (const method of ['PATCH', 'DELETE']) assert.equal((await request(app.url, '/api/repositories/site', { method, cookie: outsider, body: { name: 'x' } })).status, 404, `${method} from another Tenant`);
  assert.equal((await request(app.url, '/api/repositories/site', { method: 'PATCH', cookie: developer, body: { name: 'x' } })).status, 403);
  assert.deepEqual((await request(app.url, '/api/client-projects', { cookie: outsider })).body.tenants.map((entry: any) => [entry.tenant, entry.projects.length]), [['other', 0]]);

  const agency = async () => (await request(app.url, '/api/client-projects', { cookie: owner })).body.tenants.find((entry: any) => entry.tenant === 'agency');
  assert.equal((await agency()).visible, false);
  app.config.repositories = [...app.config.repositories.filter(entry => !entry.stored), { id: 'client-site', name: 'Client site', description: '', url: 'https://forge.example.test/initech/site', baseBranch: 'main', verify: [], tenant: 'agency', client: 'initech' }];
  await app.restart();
  const projects = await agency();
  assert.equal(projects.visible, true, 'a Client makes the projects visible');
  assert.deepEqual(projects.projects.map((project: any) => project.name), ['Own work'], 'and changes no project or grant');

  assert.deepEqual(auditEntities(app, ['Repository']).filter(entry => entry.startsWith('agency')), [
    'agency Repository Create Failure', 'agency Repository Create Failure', 'agency Repository Create Success',
    'agency Repository Update Failure', 'agency Repository Delete Failure', 'agency Repository Update Failure',
  ], 'refused changes, from another Tenant too, land in the owning Tenant\'s chain');
});
