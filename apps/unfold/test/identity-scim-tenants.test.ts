import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { request } from './api-support.ts';
import { signIn } from './oidc-support.ts';
import { identityBench, scim, scimToken } from './identity-support.ts';
import { identityAccounts } from '../src/identity/accounts.ts';
import { scimTokenHash } from '../src/identity/scim.ts';
import { subjectUserId } from '../src/oidc.ts';
import type { AppConfig } from '../src/types.ts';

const userSchema = 'urn:ietf:params:scim:schemas:core:2.0:User';
const groupSchema = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const patchSchema = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const acmeToken = 'unfold_scim_acme-test-token-0123456789abcdef0123';
const globexToken = 'unfold_scim_globex-test-token-0123456789abcdef01';
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
const enforced = (config: AppConfig) => { config.tenancy = { enforce: true }; };

async function tenantBench(t: test.TestContext, options: Parameters<typeof identityBench>[1] = {}) {
  const bench = await identityBench(t, { linkBy: 'email', configure: enforced, ...options });
  const accounts = identityAccounts(bench.server.app.store.db);
  accounts.setToken('acme', scimTokenHash(acmeToken), 'test');
  accounts.setToken('globex', scimTokenHash(globexToken), 'test');
  const personId = subjectUserId(bench.server.config.auth.oidc!.issuer, 'person@example.com');
  return { ...bench, accounts, personId };
}

test('a database from before SCIM per Tenant keeps its SCIM Users as the installation token\'s, unique per scope', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scim_users (id TEXT PRIMARY KEY, user_id TEXT, user_name TEXT NOT NULL, external_id TEXT, display_name TEXT, emails TEXT NOT NULL, active INTEGER NOT NULL, scim_role TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL);
    CREATE UNIQUE INDEX scim_users_user_name ON scim_users(user_name COLLATE NOCASE);
    CREATE TABLE scim_groups (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, external_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL);
    CREATE UNIQUE INDEX scim_groups_display_name ON scim_groups(display_name COLLATE NOCASE);
    INSERT INTO scim_users VALUES ('u-1', 'oidc-1', 'pat', NULL, NULL, '[]', 1, NULL, '2026-11-01', '2026-11-01', 1);`);
  const accounts = identityAccounts(db);
  assert.equal(accounts.user(null, 'u-1')?.userName, 'pat', 'an existing User belongs to the installation token');
  assert.equal(accounts.user('acme', 'u-1'), undefined);
  const twin = accounts.saveUser({ tenant: 'acme', userId: null, userName: 'PAT', externalId: null, displayName: null, emails: [], active: true, scimRole: null });
  assert.equal(twin.tenant, 'acme');
  assert.throws(() => accounts.saveUser({ tenant: null, userId: null, userName: 'Pat', externalId: null, displayName: null, emails: [], active: true, scimRole: null }), /UNIQUE/);
});

test('a Tenant administrator issues, rotates and withdraws the Tenant\'s SCIM token, which is shown once and kept only as a hash', async t => {
  const { server, idp } = await identityBench(t, { groups: ['unfold-admins', 'unfold/acme/admin', 'unfold/globex/viewer'], configure: enforced });
  const cookie = cookieOf((await signIn(server, idp)).callback);
  const overview = await request(server.url, '/api/admin/scim', { cookie });
  assert.equal(overview.status, 200, overview.text);
  assert.equal(overview.body.configured, true);
  assert.equal(overview.body.installationToken, true);
  assert.deepEqual(overview.body.tenants.map((entry: { tenant: string }) => entry.tenant), ['acme'], 'only the Tenants the person is an Admin of');
  assert.equal(overview.body.tenants[0].token, null);

  const issued = await request(server.url, '/api/admin/scim/tenants/acme/token', { method: 'POST', cookie });
  assert.equal(issued.status, 201, issued.text);
  const first = issued.body.token as string;
  assert.match(first, /^unfold_scim_[A-Za-z0-9_-]{43}$/);
  const rows = server.app.store.db.prepare('SELECT * FROM scim_tokens').all() as Record<string, string>[];
  assert.deepEqual(rows.map(row => [row.tenant, row.token_hash]), [['acme', createHash('sha256').update(first).digest('hex')]]);
  assert.ok(!JSON.stringify(rows).includes(first), 'the plain token is never stored');
  const listed = await request(server.url, '/api/admin/scim', { cookie });
  assert.ok(!listed.text.includes(first), 'the token is never shown again');
  assert.equal(typeof listed.body.tenants[0].token.issuedAt, 'string');
  assert.equal((await scim(server.url, '/Users', { token: first })).status, 200);

  const rotated = await request(server.url, '/api/admin/scim/tenants/acme/token', { method: 'POST', cookie });
  assert.equal(rotated.status, 200, rotated.text);
  assert.equal(rotated.body.replaced, true);
  const second = rotated.body.token as string;
  assert.notEqual(second, first);
  const stale = await scim(server.url, '/Users', { token: first });
  assert.equal(stale.status, 401, 'a rotated-out token stops working at once');
  assert.equal(stale.headers.get('www-authenticate'), 'Bearer realm="scim"');
  assert.equal((await scim(server.url, '/Users', { token: second })).status, 200);
  assert.equal((await scim(server.url, '/Users', { token: 'unfold_scim_not-a-token-0123456789abcdef0123456789' })).status, 401, 'a wrong token is refused');
  assert.equal((await scim(server.url, '/Users')).status, 200, 'the installation token keeps working');

  assert.equal((await request(server.url, '/api/admin/scim/tenants/globex/token', { method: 'POST', cookie })).status, 404, 'a viewer of a Tenant issues it no token');
  assert.equal((await request(server.url, '/api/admin/scim/tenants/initech/token', { method: 'POST', cookie })).status, 404);
  assert.equal((await request(server.url, '/api/admin/scim/tenants/acme/token', { method: 'POST', cookie, csrf: false })).status, 403, 'a mutation needs X-Unfold-Request');

  const records = server.app.store.actionRecords({ limit: 50 }).filter(record => record.action.startsWith('POST /api/admin/scim/tenants/'));
  assert.ok(records.length >= 2, 'issuing and rotating are Action Records');
  assert.ok(!JSON.stringify(server.app.store.actionRecords({ limit: 200 })).includes(second), 'no Action Record holds the token');

  assert.equal((await request(server.url, '/api/admin/scim/tenants/acme/token', { method: 'DELETE', cookie })).status, 200);
  assert.equal((await scim(server.url, '/Users', { token: second })).status, 401, 'a withdrawn token stops working');
  assert.equal((await request(server.url, '/api/admin/scim/tenants/acme/token', { method: 'DELETE', cookie })).status, 404);
});

test('only an administrator\'s browser session manages a Tenant\'s SCIM', async t => {
  const { server, idp } = await identityBench(t, { groups: ['unfold-operators', 'unfold/acme/admin'], configure: enforced });
  const cookie = cookieOf((await signIn(server, idp)).callback);
  const refused = await request(server.url, '/api/admin/scim/tenants/acme/token', { method: 'POST', cookie });
  assert.equal(refused.status, 403, 'an operator is no administrator, whatever their Tenant role');
  assert.equal((await request(server.url, '/api/admin/scim', { cookie })).status, 403);
});

test('a Tenant\'s SCIM token reaches only that Tenant: it never reads, changes or grants anything of another Tenant', async t => {
  const { server, idp, accounts, personId } = await tenantBench(t);
  await signIn(server, idp);
  const created = await scim(server.url, '/Users', { method: 'POST', token: acmeToken, body: { schemas: [userSchema], userName: 'pat', emails: [{ value: 'person@example.com', primary: true }] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const acmeUser = created.body.id as string;
  assert.equal(accounts.user('acme', acmeUser)?.userId, personId, 'the Tenant\'s User links to the existing account by email');
  const smuggled = await scim(server.url, '/Groups', { method: 'POST', token: acmeToken, body: { schemas: [groupSchema], displayName: 'unfold/globex/admin', members: [{ value: acmeUser }] } });
  assert.equal(smuggled.status, 201, JSON.stringify(smuggled.body));
  const own = await scim(server.url, '/Groups', { method: 'POST', token: acmeToken, body: { schemas: [groupSchema], displayName: 'unfold/acme/member', members: [{ value: acmeUser }] } });
  assert.equal(own.status, 201);
  const promote = await scim(server.url, '/Groups', { method: 'POST', token: acmeToken, body: { schemas: [groupSchema], displayName: 'unfold-admins', members: [{ value: acmeUser }] } });
  assert.equal(promote.status, 201);
  const stored = server.app.store.getUser(personId)!;
  assert.deepEqual(stored.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'developer' }], 'a Group naming another Tenant grants nothing there');
  assert.equal(stored.role, 'operator', 'a Tenant\'s SCIM never sets the installation-wide account role');

  const globexList = await scim(server.url, '/Users', { token: globexToken });
  assert.equal(globexList.body.totalResults, 0, 'another Tenant lists none of these Users');
  assert.equal((await scim(server.url, `/Users?filter=${encodeURIComponent('userName eq "pat"')}`, { token: globexToken })).body.totalResults, 0);
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const body = method === 'PUT' ? { schemas: [userSchema], userName: 'pat', active: false } : method === 'PATCH' ? { schemas: [patchSchema], Operations: [{ op: 'replace', path: 'active', value: false }] } : undefined;
    assert.equal((await scim(server.url, `/Users/${acmeUser}`, { method, token: globexToken, ...(body ? { body } : {}) })).status, 404, `${method} of another Tenant's User`);
    const groupBody = method === 'PUT' ? { schemas: [groupSchema], displayName: 'unfold/acme/member', members: [] } : method === 'PATCH' ? { schemas: [patchSchema], Operations: [{ op: 'remove', path: 'members' }] } : undefined;
    assert.equal((await scim(server.url, `/Groups/${own.body.id}`, { method, token: globexToken, ...(groupBody ? { body: groupBody } : {}) })).status, 404, `${method} of another Tenant's Group`);
  }
  const borrowed = await scim(server.url, '/Groups', { method: 'POST', token: globexToken, body: { schemas: [groupSchema], displayName: 'unfold/acme/admin', members: [{ value: acmeUser }] } });
  assert.equal(borrowed.status, 201);
  assert.deepEqual(borrowed.body.members, [], 'a Group never takes another Tenant\'s User as a member');
  assert.equal(accounts.user('acme', acmeUser)?.active, true, 'another Tenant changed nothing');
  assert.deepEqual(server.app.store.getUser(personId)!.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'developer' }]);
  assert.equal((await scim(server.url, '/Users', { token: scimToken })).body.totalResults, 0, 'the installation token keeps its own Users');

  const twin = await scim(server.url, '/Users', { method: 'POST', token: globexToken, body: { schemas: [userSchema], userName: 'pat', emails: [{ value: 'person@example.com', primary: true }] } });
  assert.equal(twin.status, 201, 'a userName is unique within one Tenant only');
  await scim(server.url, `/Groups/${borrowed.body.id}`, { method: 'PATCH', token: globexToken, body: { schemas: [patchSchema], Operations: [{ op: 'add', path: 'members', value: [{ value: twin.body.id }] }] } });
  assert.deepEqual(server.app.store.getUser(personId)!.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'developer' }], 'globex\'s unfold/acme/admin Group cannot raise the acme membership');
  const refusal = server.app.store.actionRecords({ channel: 'scim', limit: 50 }).find(record => record.userId === 'scim:globex' && record.status === 404);
  assert.ok(refusal, 'each refused cross-Tenant request is an Action Record of that Tenant\'s SCIM');
});

test('deactivating a Tenant\'s SCIM User linked by the identity provider\'s user id ends every credential of a person in no other Tenant, and otherwise only that Tenant\'s memberships', async t => {
  const { server, idp, accounts, personId } = await tenantBench(t, { userIdClaim: 'idp_user_id', claims: { idp_user_id: 'entra-oid-42' } });
  const cookie = cookieOf((await signIn(server, idp)).callback);
  const user = (await scim(server.url, '/Users', { method: 'POST', token: acmeToken, body: { schemas: [userSchema], userName: 'pat', externalId: 'entra-oid-42', emails: [{ value: 'pat@corp.example', primary: true }] } })).body;
  assert.equal(accounts.user('acme', user.id)?.userId, personId, 'linked by the identity provider\'s user id');
  await scim(server.url, '/Groups', { method: 'POST', token: acmeToken, body: { schemas: [groupSchema], displayName: 'unfold/acme/member', members: [{ value: user.id }] } });
  assert.deepEqual((await request(server.url, '/api/bootstrap', { cookie })).body.user.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'developer' }]);

  const off = await scim(server.url, `/Users/${user.id}`, { method: 'PATCH', token: acmeToken, body: { schemas: [patchSchema], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal((await request(server.url, '/api/bootstrap', { cookie })).status, 401, 'the browser session is gone');
  assert.equal(accounts.disabled(personId)?.by, 'scim:acme');
  assert.equal((await signIn(server, idp)).callback.headers.get('location'), '/?login_error=account_disabled');
  const revoked = server.app.store.actionRecords({ channel: 'scim', limit: 30 }).find(record => record.action === 'REVOKE scim.user_deactivated');
  assert.equal(revoked?.userId, 'scim:acme', 'the revocation is recorded as the Tenant\'s SCIM');
  assert.equal(accounts.enable(personId, 'scim'), false, 'the installation token cannot undo a Tenant\'s deactivation');

  await scim(server.url, `/Users/${user.id}`, { method: 'PATCH', token: acmeToken, body: { schemas: [patchSchema], Operations: [{ op: 'replace', value: { active: true } }] } });
  const back = await signIn(server, idp);
  assert.equal(back.callback.headers.get('location'), '/', 'reactivating admits the next sign-in');
  const again = cookieOf(back.callback);
  assert.deepEqual((await request(server.url, '/api/bootstrap', { cookie: again })).body.user.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'developer' }], 'the Tenant\'s memberships survive a sign-in whose groups do not name it');

  const twin = (await scim(server.url, '/Users', { method: 'POST', token: globexToken, body: { schemas: [userSchema], userName: 'pat', emails: [{ value: 'person@example.com', primary: true }] } })).body;
  await scim(server.url, '/Groups', { method: 'POST', token: globexToken, body: { schemas: [groupSchema], displayName: 'unfold/globex/viewer', members: [{ value: twin.id }] } });
  assert.equal((await scim(server.url, `/Users/${user.id}`, { method: 'DELETE', token: acmeToken })).status, 204);
  const kept = await request(server.url, '/api/bootstrap', { cookie: again });
  assert.equal(kept.status, 200, 'globex still vouches for the person, so acme cannot sign them out');
  assert.deepEqual(kept.body.user.memberships, [{ kind: 'tenant', tenant: 'globex', role: 'viewer' }], 'only acme\'s membership went');
  assert.equal(accounts.disabled(personId), undefined);
});

test('a Tenant\'s User linked only by email never turns the account off: deactivating or deleting it removes only that Tenant\'s membership', async t => {
  const { server, idp, accounts, personId } = await tenantBench(t);
  const cookie = cookieOf((await signIn(server, idp)).callback);
  assert.deepEqual(server.app.store.getUser(personId)!.memberships, [], 'the person holds no other membership');
  const user = (await scim(server.url, '/Users', { method: 'POST', token: acmeToken, body: { schemas: [userSchema], userName: 'pat', emails: [{ value: 'person@example.com', primary: true }] } })).body;
  assert.equal(accounts.user('acme', user.id)?.userId, personId, 'linked by email');
  await scim(server.url, '/Groups', { method: 'POST', token: acmeToken, body: { schemas: [groupSchema], displayName: 'unfold/acme/member', members: [{ value: user.id }] } });
  assert.deepEqual(server.app.store.getUser(personId)!.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'developer' }]);

  const off = await scim(server.url, `/Users/${user.id}`, { method: 'PATCH', token: acmeToken, body: { schemas: [patchSchema], Operations: [{ op: 'replace', path: 'active', value: false }] } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(accounts.disabled(personId), undefined, 'the account stays on');
  const kept = await request(server.url, '/api/bootstrap', { cookie });
  assert.equal(kept.status, 200, 'the browser session survives');
  assert.deepEqual(kept.body.user.memberships, [], 'only acme\'s membership is gone');
  assert.equal((await signIn(server, idp)).callback.headers.get('location'), '/', 'sign-in still works');
  assert.equal(server.app.store.actionRecords({ channel: 'scim', limit: 50 }).some(record => record.action.startsWith('REVOKE')), false, 'nothing was revoked');

  await scim(server.url, `/Users/${user.id}`, { method: 'PATCH', token: acmeToken, body: { schemas: [patchSchema], Operations: [{ op: 'replace', path: 'active', value: true }] } });
  assert.deepEqual(server.app.store.getUser(personId)!.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'developer' }], 'reactivating gives the membership back');
  assert.equal((await scim(server.url, `/Users/${user.id}`, { method: 'DELETE', token: acmeToken })).status, 204);
  assert.equal(accounts.disabled(personId), undefined, 'a delete does not turn the account off either');
  assert.equal((await request(server.url, '/api/bootstrap', { cookie })).status, 200);
  assert.deepEqual(server.app.store.getUser(personId)!.memberships, []);
});

test('a Tenant with its own SCIM token takes its memberships from SCIM only, so a removal stays removed at the next sign-in', async t => {
  const { server, idp, accounts, personId } = await tenantBench(t, { groups: ['unfold-operators', 'unfold/acme/admin', 'unfold/initech/viewer'] });
  await signIn(server, idp);
  assert.deepEqual(server.app.store.getUser(personId)!.memberships, [{ kind: 'tenant', tenant: 'initech', role: 'viewer' }], 'acme has a SCIM token, so the sign-in\'s acme group grants nothing');
  const user = (await scim(server.url, '/Users', { method: 'POST', token: acmeToken, body: { schemas: [userSchema], userName: 'pat', emails: [{ value: 'person@example.com', primary: true }] } })).body;
  const group = (await scim(server.url, '/Groups', { method: 'POST', token: acmeToken, body: { schemas: [groupSchema], displayName: 'unfold/acme/member', members: [{ value: user.id }] } })).body;
  assert.deepEqual(server.app.store.getUser(personId)!.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'developer' }, { kind: 'tenant', tenant: 'initech', role: 'viewer' }]);
  await scim(server.url, `/Groups/${group.id}`, { method: 'PATCH', token: acmeToken, body: { schemas: [patchSchema], Operations: [{ op: 'remove', path: `members[value eq "${user.id}"]` }] } });
  assert.deepEqual(server.app.store.getUser(personId)!.memberships, [{ kind: 'tenant', tenant: 'initech', role: 'viewer' }]);

  const again = await signIn(server, idp);
  assert.equal(again.callback.headers.get('location'), '/');
  const bootstrap = await request(server.url, '/api/bootstrap', { cookie: cookieOf(again.callback) });
  assert.deepEqual(bootstrap.body.user.memberships, [{ kind: 'tenant', tenant: 'initech', role: 'viewer' }], 'the acme membership SCIM removed stays removed though the sign-in names acme; initech, without a token, keeps its sign-in group');

  accounts.deleteToken('acme');
  const handedBack = await signIn(server, idp);
  assert.deepEqual((await request(server.url, '/api/bootstrap', { cookie: cookieOf(handedBack.callback) })).body.user.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'admin' }, { kind: 'tenant', tenant: 'initech', role: 'viewer' }], 'withdrawing the token hands acme back to the sign-in groups');
});

test('a person a Tenant\'s SCIM token provisioned signs in as viewer when the sign-in entitles no role, and reaches only that Tenant', async t => {
  const { server, idp, accounts, personId } = await tenantBench(t, { groups: [], configure: config => {
    enforced(config);
    config.repositories = [...config.repositories, { id: 'acme-site', name: 'Acme site', description: 'Owned by Tenant acme', url: 'https://forge.example/acme/site.git', baseBranch: 'main', verify: [], tenant: 'acme' }, { id: 'globex-site', name: 'Globex site', description: 'Owned by Tenant globex', url: 'https://forge.example/globex/site.git', baseBranch: 'main', verify: [], tenant: 'globex' }];
  } });
  assert.equal((await signIn(server, idp)).callback.headers.get('location'), '/?login_error=oidc_not_entitled', 'without provisioning the sign-in entitles nothing');
  const user = (await scim(server.url, '/Users', { method: 'POST', token: acmeToken, body: { schemas: [userSchema], userName: 'pat', emails: [{ value: 'person@example.com', primary: true }] } })).body;
  await scim(server.url, '/Groups', { method: 'POST', token: acmeToken, body: { schemas: [groupSchema], displayName: 'unfold/acme/admin', members: [{ value: user.id }] } });
  const admitted = await signIn(server, idp);
  assert.equal(admitted.callback.headers.get('location'), '/', 'a provisioned person is admitted');
  assert.equal(accounts.user('acme', user.id)?.userId, personId);
  const bootstrap = await request(server.url, '/api/bootstrap', { cookie: cookieOf(admitted.callback) });
  assert.equal(bootstrap.body.user.role, 'viewer', 'the installation-wide role is viewer, never admin, though the Tenant made them its Admin');
  assert.deepEqual(bootstrap.body.user.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'admin' }]);
  assert.deepEqual(bootstrap.body.repositories.map((repository: { id: string }) => repository.id), ['acme-site'], 'they reach nothing outside their Tenant');
  assert.equal((await request(server.url, '/api/admin/scim', { cookie: cookieOf(admitted.callback) })).status, 403, 'a viewer manages no installation-wide or Tenant administration');

  await scim(server.url, `/Users/${user.id}`, { method: 'PATCH', token: acmeToken, body: { schemas: [patchSchema], Operations: [{ op: 'replace', path: 'active', value: false }] } });
  assert.equal((await signIn(server, idp)).callback.headers.get('location'), '/?login_error=oidc_not_entitled', 'a deactivated User entitles nothing');
});

test('the viewer fallback never lowers or raises a role the sign-in entitles', async t => {
  const { server, idp, personId } = await tenantBench(t, { groups: ['unfold-operators'] });
  const user = (await scim(server.url, '/Users', { method: 'POST', token: acmeToken, body: { schemas: [userSchema], userName: 'pat', emails: [{ value: 'person@example.com', primary: true }] } })).body;
  assert.equal(user.active, true);
  await signIn(server, idp);
  assert.equal(server.app.store.getUser(personId)!.role, 'operator');
});

test('a Tenant maps its own group names to Access Roles and Client memberships, and unfold/ names keep working', async t => {
  const { server, idp, accounts } = await tenantBench(t, { groups: ['unfold-admins'] });
  const cookie = cookieOf((await signIn(server, idp)).callback);
  const admin = (await scim(server.url, '/Users', { method: 'POST', token: acmeToken, body: { schemas: [userSchema], userName: 'person@example.com' } })).body;
  await scim(server.url, '/Groups', { method: 'POST', token: acmeToken, body: { schemas: [groupSchema], displayName: 'unfold/acme/admin', members: [{ value: admin.id }] } });
  server.app.store.upsertUser({ id: 'oidc-other', name: 'other@corp.example', role: 'operator', passwordHash: '' });
  const other = (await scim(server.url, '/Users', { method: 'POST', token: acmeToken, body: { schemas: [userSchema], userName: 'other@corp.example' } })).body;
  assert.equal(accounts.user('acme', other.id)?.userId, 'oidc-other');
  const group = await scim(server.url, '/Groups', { method: 'POST', token: acmeToken, body: { schemas: [groupSchema], displayName: 'Engineering', externalId: 'grp-0042', members: [{ value: other.id }] } });
  assert.equal(group.status, 201);
  assert.deepEqual(server.app.store.getUser('oidc-other')!.memberships, [], 'an unmapped group grants nothing');

  const mapped = await request(server.url, '/api/admin/scim/tenants/acme/group-mappings', { method: 'PUT', cookie, body: { mappings: [{ match: 'displayName', value: 'engineering', role: 'developer', clients: ['shop'] }] } });
  assert.equal(mapped.status, 200, mapped.text);
  assert.equal(mapped.body.applied, 2, 'the administrator and the other person');
  assert.deepEqual(server.app.store.getUser('oidc-other')!.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'developer' }, { kind: 'client', tenant: 'acme', client: 'shop' }], 'a mapping applies at once, matched without regard to case');

  await request(server.url, '/api/admin/scim/tenants/acme/group-mappings', { method: 'PUT', cookie, body: { mappings: [{ match: 'externalId', value: 'grp-0042', role: 'admin' }] } });
  assert.deepEqual(server.app.store.getUser('oidc-other')!.memberships, [{ kind: 'tenant', tenant: 'acme', role: 'admin' }], 'a mapping by externalId replaces the earlier one');
  assert.deepEqual((await request(server.url, '/api/admin/scim', { cookie })).body.tenants[0].mappings, [{ match: 'externalId', value: 'grp-0042', role: 'admin', clients: [] }]);

  await request(server.url, '/api/admin/scim/tenants/acme/group-mappings', { method: 'PUT', cookie, body: { mappings: [] } });
  assert.deepEqual(server.app.store.getUser('oidc-other')!.memberships, []);
  await scim(server.url, '/Groups', { method: 'POST', token: acmeToken, body: { schemas: [groupSchema], displayName: 'unfold/acme/client/shop', members: [{ value: other.id }] } });
  assert.deepEqual(server.app.store.getUser('oidc-other')!.memberships, [{ kind: 'client', tenant: 'acme', client: 'shop' }], 'unfold/<tenant>/… naming works without a mapping');

  for (const mappings of [[{ value: 'x' }], [{ value: 'x', role: 'owner' }], [{ value: 'x', role: 'viewer' }, { value: 'X', role: 'admin' }], [{ match: 'title', value: 'x', role: 'viewer' }], 'x']) {
    const bad = await request(server.url, '/api/admin/scim/tenants/acme/group-mappings', { method: 'PUT', cookie, body: { mappings } });
    assert.equal(bad.status, 400, JSON.stringify(mappings));
    assert.equal(bad.body.error.code, 'scim_mappings');
  }
  assert.equal((await request(server.url, '/api/admin/scim/tenants/globex/group-mappings', { method: 'PUT', cookie, body: { mappings: [] } })).status, 404, 'an Admin of acme maps nothing for globex');
});

test('a Tenant\'s SCIM User links by the customer identity provider\'s user id a sign-in carries, else by email', async t => {
  const { server, idp, accounts, personId } = await tenantBench(t, { userIdClaim: 'idp_user_id', claims: { idp_user_id: 'entra-oid-42' } });
  const waiting = (await scim(server.url, '/Users', { method: 'POST', token: acmeToken, body: { schemas: [userSchema], userName: 'pat@corp.example', externalId: 'entra-oid-42', emails: [{ value: 'pat@corp.example', primary: true }] } })).body;
  assert.equal(accounts.user('acme', waiting.id)?.userId, null, 'nobody signed in with that id yet');
  assert.equal(server.app.store.getUser(personId), undefined, 'a Tenant\'s token creates no account');
  assert.equal((await signIn(server, idp)).callback.headers.get('location'), '/');
  assert.equal(accounts.user('acme', waiting.id)?.userId, personId, 'the sign-in carrying the id links the waiting User, though the emails differ');

  const later = (await scim(server.url, '/Users', { method: 'POST', token: globexToken, body: { schemas: [userSchema], userName: 'p.person', externalId: 'entra-oid-42', emails: [{ value: 'someone-else@corp.example', primary: true }] } })).body;
  assert.equal(accounts.user('globex', later.id)?.userId, personId, 'a User pushed after the sign-in links by the remembered id at once');

  accounts.setToken('initech', scimTokenHash('unfold_scim_initech-test-token-0123456789abcdef'), 'test');
  const byEmail = (await scim(server.url, '/Users', { method: 'POST', token: 'unfold_scim_initech-test-token-0123456789abcdef', body: { schemas: [userSchema], userName: 'pp', externalId: 'okta-00u1', emails: [{ value: 'person@example.com', primary: true }] } })).body;
  assert.equal(accounts.user('initech', byEmail.id)?.userId, personId, 'without a matching id it falls back to the email');

  const unlinked = (await scim(server.url, '/Users', { method: 'POST', token: acmeToken, body: { schemas: [userSchema], userName: 'nobody', externalId: 'entra-oid-99', emails: [{ value: 'nobody@corp.example', primary: true }] } })).body;
  assert.equal(accounts.user('acme', unlinked.id)?.userId, null, 'a User that names nobody waits');
});
