import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { application, login, request } from './api-support.ts';
import { Store } from '../src/store.ts';
import { TrackerConnections } from '../src/tracker-connections.ts';
import type { AppConfig } from '../src/types.ts';

const previousImageSchema = `
  CREATE TABLE IF NOT EXISTS tracker_connections (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL, UNIQUE (tenant, provider, base_url));
  CREATE TABLE IF NOT EXISTS tracker_connection_sources (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES tracker_connections(id), tenant TEXT NOT NULL, client TEXT, created_at TEXT NOT NULL, body TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS tracker_connection_sources_connection ON tracker_connection_sources(connection_id);
`;

const destructiveMigrationSchema = `
  CREATE TABLE client_projects (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, client TEXT, slug TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, body TEXT NOT NULL);
  CREATE TABLE integration_accounts (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('tracker', 'forge')), provider TEXT NOT NULL, base_url TEXT NOT NULL, account_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, body TEXT NOT NULL, UNIQUE (tenant, provider, base_url, account_id));
  CREATE TABLE tracker_connection_sources (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES integration_accounts(id), tenant TEXT NOT NULL, client TEXT, client_project_id TEXT REFERENCES client_projects(id), created_at TEXT NOT NULL, body TEXT NOT NULL);
  CREATE INDEX tracker_connection_sources_connection ON tracker_connection_sources(connection_id);
`;

const at = '2026-10-31T00:00:00.000Z';
const clickup = 'https://api.clickup.com/api/v2';
const fakeToken = (name: string) => ['pk', '9001', name].join('_');
const connection = (id: string, tenant: string, updatedAt = at) => ({ id, provider: 'clickup', baseUrl: clickup, tenant, account: `${tenant} bot`, tokenSetAt: updatedAt, createdAt: at, createdBy: 'olga', updatedAt, updatedBy: 'olga' });
const source = (id: string, connectionId: string, tenant: string) => ({ id, connection: connectionId, name: id, project: id.replace(/\D/g, '') || '1', repositoryId: 'shop', executionOwner: 'ploeg', tenant, createdAt: at, createdBy: 'olga', updatedAt: at, updatedBy: 'olga' });

function configFor(dataDir: string): AppConfig {
  return {
    mode: 'live', host: '127.0.0.1', port: 0, dataDir, publicDir: dataDir, teams: [], models: [], taskSources: [], tenancy: { enforce: true },
    repositories: [{ id: 'shop', name: 'Shop', description: '', url: 'https://forge.example.test/acme/shop.git', baseBranch: 'main', verify: [], tenant: 'acme' }],
  } as unknown as AppConfig;
}

const previousImage = (store: Store) => ({
  start: () => store.db.exec(previousImageSchema),
  connections: () => (store.db.prepare('SELECT body FROM tracker_connections ORDER BY created_at, id').all() as { body: string }[]).map(row => JSON.parse(row.body)),
  sources: () => (store.db.prepare('SELECT body FROM tracker_connection_sources ORDER BY created_at, id').all() as { body: string }[]).map(row => JSON.parse(row.body)),
  addConnection: (entry: ReturnType<typeof connection>, token: string) => {
    store.db.prepare('INSERT INTO tracker_connections(id,tenant,provider,base_url,created_at,body) VALUES(?,?,?,?,?,?)').run(entry.id, entry.tenant, entry.provider, entry.baseUrl, entry.createdAt, JSON.stringify(entry));
    store.setSecret(`tracker-connection:${entry.id}`, { token });
  },
  replaceToken: (entry: ReturnType<typeof connection>, token: string) => {
    store.db.prepare('UPDATE tracker_connections SET body=? WHERE id=?').run(JSON.stringify(entry), entry.id);
    store.setSecret(`tracker-connection:${entry.id}`, { token });
  },
  addSource: (entry: ReturnType<typeof source>) => store.db.prepare('INSERT INTO tracker_connection_sources(id,connection_id,tenant,client,created_at,body) VALUES(?,?,?,?,?,?)').run(entry.id, entry.connection, entry.tenant, null, entry.createdAt, JSON.stringify(entry)),
});

test('roll forward, roll back to the image before Integration Accounts, add a connection and a source there, roll forward again: nothing is lost', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'unfold-rollback-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'unfold.sqlite');
  const key = randomBytes(32);
  const first = connection('tc-0123456789ab', 'acme');

  const before = new Store(path, { key });
  previousImage(before).start();
  previousImage(before).addConnection(first, fakeToken('FIRST'));
  previousImage(before).addSource(source('sprint-1', first.id, 'acme'));
  before.close();

  const forward = new Store(path, { key });
  const upgraded = new TrackerConnections(forward, configFor(dir), { enforced: true, log: () => undefined });
  assert.deepEqual(upgraded.connections().map(entry => entry.id), [first.id]);
  forward.close();

  const back = new Store(path, { key });
  const old = previousImage(back);
  old.start();
  assert.deepEqual(old.connections(), [first], 'the previous image still sees its connection after the upgrade');
  assert.deepEqual(old.sources().map(entry => entry.id), ['sprint-1'], 'and its source');
  const second = connection('tc-ba9876543210', 'globex');
  old.addConnection(second, fakeToken('SECOND'));
  old.addSource(source('sprint-2', second.id, 'globex'));
  const renewed = { ...first, tokenSetAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
  old.replaceToken(renewed, fakeToken('RENEWED'));
  back.close();

  const again = new Store(path, { key });
  t.after(() => again.close());
  const lines: string[] = [];
  const config = configFor(dir);
  const rolledForward = new TrackerConnections(again, config, { enforced: true, log: line => lines.push(line) });
  assert.deepEqual(rolledForward.connections(), [renewed, second], 'the connection added and the token replaced while rolled back are both there');
  assert.deepEqual(rolledForward.sources().map(entry => [entry.id, entry.connection, Boolean(entry.clientProject)]), [['sprint-1', first.id, true], ['sprint-2', second.id, true]], 'the source added while rolled back is there and joins Own work');
  assert.deepEqual(again.getSecret(`tracker-connection:${first.id}`), { token: fakeToken('RENEWED') });
  assert.deepEqual(again.getSecret(`tracker-connection:${second.id}`), { token: fakeToken('SECOND') });
  assert.ok(lines.some(line => line.includes('tracker_connections.reconciled')), 'the reconcile is logged');
  rolledForward.sync();
  assert.deepEqual(config.taskSources!.map(entry => [entry.id, entry.token]), [['sprint-1', fakeToken('RENEWED')]], 'the source reads with the renewed token; the one whose repository belongs to another Tenant is not used');
  assert.equal(new TrackerConnections(again, configFor(dir), { enforced: true, log: line => lines.push(line) }).connections().length, 2, 'a second start changes nothing');
});

test('a connection added after the upgrade is written to the old table too, so the previous image sees it after a rollback', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'unfold-rollback-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'unfold.sqlite'), { key: randomBytes(32) });
  t.after(() => store.close());
  new TrackerConnections(store, configFor(dir), { enforced: true });
  const added = connection('tc-0123456789ab', 'acme');
  store.db.prepare("INSERT INTO integration_accounts(id,tenant,role,provider,base_url,account_id,created_at,body) VALUES(?,?,'tracker',?,?,'',?,?)").run(added.id, added.tenant, added.provider, added.baseUrl, added.createdAt, JSON.stringify(added));
  new TrackerConnections(store, configFor(dir), { enforced: true, log: () => undefined });
  const old = previousImage(store);
  old.start();
  assert.deepEqual(old.connections(), [added]);
  old.addSource(source('sprint-1', added.id, 'acme'));
  assert.deepEqual(old.sources().map(entry => entry.id), ['sprint-1'], 'the previous image adds a source under it with foreign keys on');
});

test('a store the destructive migration already ran on gets its old table back and loses its foreign key on the connection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'unfold-rollback-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'unfold.sqlite'), { key: randomBytes(32) });
  t.after(() => store.close());
  store.db.exec(destructiveMigrationSchema);
  const kept = connection('tc-0123456789ab', 'acme');
  store.db.prepare("INSERT INTO integration_accounts(id,tenant,role,provider,base_url,account_id,created_at,body) VALUES(?,?,'tracker',?,?,'',?,?)").run(kept.id, kept.tenant, kept.provider, kept.baseUrl, kept.createdAt, JSON.stringify(kept));
  const sourceRow = source('sprint-1', kept.id, 'acme');
  store.db.prepare('INSERT INTO tracker_connection_sources(id,connection_id,tenant,client,client_project_id,created_at,body) VALUES(?,?,?,?,?,?,?)').run(sourceRow.id, kept.id, 'acme', null, null, at, JSON.stringify(sourceRow));

  const connections = new TrackerConnections(store, configFor(dir), { enforced: true, log: () => undefined });
  assert.deepEqual(connections.connections(), [kept]);
  assert.deepEqual(previousImage(store).connections(), [kept], 'the old table is back with every connection');
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_list(tracker_connection_sources)').all().map((entry: any) => entry.from), ['client_project_id']);
  assert.deepEqual(connections.sources().map(entry => [entry.id, Boolean(entry.clientProject)]), [['sprint-1', true]]);
});

test('while repositories.stored is off, the write routes answer 404 and a stored repository joins nothing', async t => {
  const app = await application('live');
  t.after(() => app.close());
  const { cookie } = await login(app.url);
  const stored = { id: 'shop', key: 'forge.example.test/acme/shop', url: 'https://forge.example.test/acme/shop', name: 'acme/shop', description: '', baseBranch: 'main', tenant: 'default', createdAt: at, createdBy: 'admin', updatedAt: at, updatedBy: 'admin' };
  app.app.store.db.prepare('INSERT INTO repositories(id,tenant,key,integration_account_id,created_at,body) VALUES(?,?,?,NULL,?,?)').run(stored.id, stored.tenant, stored.key, at, JSON.stringify(stored));
  app.app.connections.sync();

  for (const [method, path] of [['POST', '/api/repositories'], ['PATCH', '/api/repositories/shop'], ['DELETE', '/api/repositories/shop']] as const) {
    const refused = await request(app.url, path, { method, cookie, body: { url: 'https://forge.example.test/acme/web', name: 'x' } });
    assert.equal(refused.status, 404, `${method} ${path}`);
    assert.equal(refused.body.error.code, 'repositories_off');
  }
  assert.equal((app.app.store.db.prepare('SELECT count(*) AS n FROM repositories').get() as { n: number }).n, 1, 'nothing was written or removed');
  const listed = await request(app.url, '/api/repositories', { cookie });
  assert.deepEqual(listed.body.repositories.map((entry: any) => [entry.id, entry.state]), [['shop', 'off']]);
  assert.deepEqual(app.config.repositories.map(entry => entry.id), ['order-service'], 'the stored repository is not among the repositories the workbench, its Tenant checks and its sources use');

  app.app.store.db.prepare("INSERT INTO integration_accounts(id,tenant,role,provider,base_url,created_at,body) VALUES(?,?,'tracker',?,?,?,?)").run('tc-0123456789ab', 'default', 'clickup', clickup, at, JSON.stringify(connection('tc-0123456789ab', 'default')));
  app.app.store.db.prepare('INSERT INTO tracker_connection_sources(id,connection_id,tenant,client,created_at,body) VALUES(?,?,?,?,?,?)').run('sprint-12', 'tc-0123456789ab', 'default', null, at, JSON.stringify({ ...source('sprint-12', 'tc-0123456789ab', 'default'), repositoryId: 'shop' }));
  app.app.connections.sync();
  assert.ok(!(app.config.taskSources ?? []).some(entry => entry.id === 'sprint-12'), 'a saved source on a stored repository is not resolved');
  const connections = await request(app.url, '/api/tracker-connections', { cookie });
  assert.deepEqual(connections.body.connections[0].sources.map((entry: any) => [entry.id, entry.state]), [['sprint-12', 'repository_missing']]);
});
