import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Auth, editorCredentialDays, editorFamilyDays, editorIdleDays, editorLabel, editorRotationGraceMs } from '../src/auth.ts';
import { Store } from '../src/store.ts';
import { configuration } from './api-support.ts';
import type { User } from '../src/types.ts';

const person: User = { id: 'person-1', name: 'person@example.com', role: 'operator' };
const other: User = { id: 'person-2', name: 'other@example.com', role: 'admin' };

function setup(t: test.TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T10:00:00Z') });
  const store = new Store(':memory:');
  t.after(() => store.close());
  for (const user of [person, other]) store.addUser({ ...user, passwordHash: '' });
  const auth = new Auth(store, { ...configuration('/tmp/unused', 'live'), auth: { secureCookies: false, sessionHours: 1, bootstrapName: 'admin' } });
  const tick = (ms: number) => t.mock.timers.tick(ms);
  return { store, auth, tick };
}

const withBearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as unknown as IncomingMessage;
const code = (error: unknown) => (error as { code?: string }).code;

test('signing in alone never makes a ticket collectable; only its own approval does, once', t => {
  const { auth, tick } = setup(t);
  const started = auth.beginEditor('192.0.2.1');
  assert.equal(auth.claimEditor(started.code, person), true);
  assert.equal(auth.claimEditor(started.code, other), false);
  assert.equal(auth.editorPending(started.code), false);
  tick(1000);
  assert.deepEqual(auth.collectEditor(started.code, started.secret), { status: 'pending' });
  assert.equal(auth.editorRequest(started.code, other), undefined);
  assert.throws(() => auth.decideEditor(started.code, other, 'approved'), error => code(error) === 'editor_login_unknown');
  assert.equal(auth.decideEditor(started.code, person, 'approved').status, 'approved');
  tick(1000);
  const ready = auth.collectEditor(started.code, started.secret);
  assert.equal(ready.status, 'ready');
  if (ready.status !== 'ready') return;
  assert.deepEqual(ready.user, person);
  assert.equal(ready.expiresAt, new Date(Date.now() + editorCredentialDays * 86_400_000).toISOString());
  assert.deepEqual(auth.user(withBearer(ready.token)), person);
  assert.equal(auth.scope(withBearer(ready.token)), 'editor');
  tick(1000);
  assert.throws(() => auth.collectEditor(started.code, started.secret), error => code(error) === 'editor_login_unknown');
});

test('an expired request yields no credential, even when it was approved', t => {
  const { auth, store, tick } = setup(t);
  const approved = auth.beginEditor('192.0.2.1');
  auth.claimEditor(approved.code, person);
  auth.decideEditor(approved.code, person, 'approved');
  const unclaimed = auth.beginEditor('192.0.2.1');
  tick(600_001);
  assert.throws(() => auth.collectEditor(approved.code, approved.secret), error => code(error) === 'editor_login_unknown');
  assert.equal(auth.claimEditor(unclaimed.code, person), false);
  assert.equal(auth.editorPending(unclaimed.code), false);
  assert.throws(() => auth.decideEditor(unclaimed.code, person, 'approved'), error => code(error) === 'editor_login_unknown');
  assert.deepEqual(store.editorCredentials(person.id), []);
});

test('a denied request yields no credential and is gone after the editor learns it', t => {
  const { auth, store, tick } = setup(t);
  const started = auth.beginEditor('192.0.2.1');
  auth.claimEditor(started.code, person);
  auth.decideEditor(started.code, person, 'denied');
  assert.throws(() => auth.decideEditor(started.code, person, 'approved'), error => code(error) === 'editor_login_decided');
  assert.throws(() => auth.collectEditor(started.code, started.secret), error => code(error) === 'editor_login_denied');
  tick(1000);
  assert.throws(() => auth.collectEditor(started.code, started.secret), error => code(error) === 'editor_login_unknown');
  assert.deepEqual(store.editorCredentials(person.id), []);
});

test('five wrong secrets end a ticket, so a mismatched poll can never collect it', t => {
  const { auth, tick } = setup(t);
  const started = auth.beginEditor('192.0.2.1');
  auth.claimEditor(started.code, person);
  auth.decideEditor(started.code, person, 'approved');
  for (let attempt = 0; attempt < 5; attempt++) assert.throws(() => auth.collectEditor(started.code, `wrong-${attempt}`), error => code(error) === 'editor_login_unknown');
  tick(1000);
  assert.throws(() => auth.collectEditor(started.code, started.secret), error => code(error) === 'editor_login_unknown');
});

test('starting is limited per address and polling by interval', t => {
  const { auth, tick } = setup(t);
  for (let index = 0; index < 20; index++) auth.beginEditor('192.0.2.1');
  assert.throws(() => auth.beginEditor('192.0.2.1'), error => code(error) === 'rate_limited');
  const elsewhere = auth.beginEditor('192.0.2.2');
  assert.deepEqual(auth.collectEditor(elsewhere.code, elsewhere.secret), { status: 'pending' });
  assert.throws(() => auth.collectEditor(elsewhere.code, elsewhere.secret), error => code(error) === 'slow_down');
  tick(1000);
  assert.deepEqual(auth.collectEditor(elsewhere.code, elsewhere.secret), { status: 'pending' });
  tick(600_001);
  assert.ok(auth.beginEditor('192.0.2.1').code);
});

test('an editor credential expires after its lifetime, is listed without its token and ends its sign-in when revoked', t => {
  const { auth, store, tick } = setup(t);
  const issue = () => {
    const started = auth.beginEditor('192.0.2.1');
    auth.claimEditor(started.code, person);
    auth.decideEditor(started.code, person, 'approved');
    const ready = auth.collectEditor(started.code, started.secret);
    assert.equal(ready.status, 'ready');
    return ready.status === 'ready' ? ready.token : '';
  };
  const first = issue();
  const second = issue();
  const listed = auth.editorCredentials(person);
  assert.equal(listed.length, 2);
  assert.ok(listed.every(item => !('tokenHash' in item) && item.scope === 'editor' && item.label === 'VS Code'));
  const signIn = createHash('sha256').update(first).digest('hex');
  assert.equal(store.liveSignIn(signIn), true);
  const firstId = store.getEditorCredential(signIn)!.id;
  assert.throws(() => auth.revokeEditorCredential(other, firstId), error => code(error) === 'not_found');
  assert.equal(auth.revokeEditorCredential(person, firstId), signIn);
  assert.equal(store.liveSignIn(signIn), false);
  assert.equal(auth.user(withBearer(first)), undefined);
  assert.deepEqual(auth.user(withBearer(second)), person);
  tick(editorCredentialDays * 86_400_000 + 1);
  assert.equal(auth.user(withBearer(second)), undefined);
  assert.deepEqual(auth.editorCredentials(person), []);
});

test('a sign-in started by unfold-mcp is named after its host on the approval page and on its credential', t => {
  const { auth, tick } = setup(t);
  assert.equal(editorLabel(undefined, undefined), 'VS Code');
  assert.equal(editorLabel('mcp', 'ryan-laptop'), 'unfold-mcp on ryan-laptop');
  assert.equal(editorLabel('acp', 'ryan-laptop'), 'unfold-acp-agent on ryan-laptop');
  assert.equal(editorLabel('acp', 'evil host'), 'unfold-acp-agent');
  assert.equal(editorLabel('claude-code', 'ryan-laptop'), 'Claude Code on ryan-laptop');
  assert.equal(editorLabel('claude-code', 'evil host'), 'Claude Code');
  assert.equal(editorLabel('constructor', 'ryan-laptop'), 'VS Code', 'only a known client gets a host on its name');
  for (const host of ['', 'evil host', '<script>', 'a'.repeat(64), 42]) assert.equal(editorLabel('mcp', host), 'unfold-mcp', String(host));
  const started = auth.beginEditor('192.0.2.1', editorLabel('mcp', 'ryan-laptop'));
  assert.equal(auth.claimEditor(started.code, person), true);
  assert.equal(auth.editorRequest(started.code, person)?.label, 'unfold-mcp on ryan-laptop');
  auth.decideEditor(started.code, person, 'approved');
  tick(1000);
  const ready = auth.collectEditor(started.code, started.secret);
  assert.equal(ready.status, 'ready');
  assert.deepEqual(auth.editorCredentials(person).map(item => item.label), ['unfold-mcp on ryan-laptop']);
});

test('a VS Code sign-in is named after the machine it names, and falls back to VS Code for an old or invalid client', () => {
  assert.equal(editorLabel('vscode', 'ryan-laptop'), 'VS Code on ryan-laptop');
  assert.equal(editorLabel('vscode', 'build.example.internal'), 'VS Code on build.example.internal');
  assert.equal(editorLabel('vscode', undefined), 'VS Code');
  assert.equal(editorLabel(undefined, 'ryan-laptop'), 'VS Code', 'an editor that does not say it is VS Code never gets a host on its name');
  assert.equal(editorLabel('Approve me', 'ryan-laptop'), 'VS Code');
  for (const host of ['', 'evil host', '<script>', '-leading', 'a'.repeat(64), 42]) assert.equal(editorLabel('vscode', host), 'VS Code', String(host));
});

test(`an editor credential unused for ${editorIdleDays} days stops working, drops off the list and ends its sign-in`, t => {
  const { auth, store, tick } = setup(t);
  const issue = () => {
    const started = auth.beginEditor('192.0.2.1');
    auth.claimEditor(started.code, person);
    auth.decideEditor(started.code, person, 'approved');
    const ready = auth.collectEditor(started.code, started.secret);
    assert.equal(ready.status, 'ready');
    return ready.status === 'ready' ? ready.token : '';
  };
  const day = 86_400_000;
  const idle = issue();
  const used = issue();
  const idleSignIn = createHash('sha256').update(idle).digest('hex');
  const usedSignIn = createHash('sha256').update(used).digest('hex');
  assert.deepEqual(auth.editorCredentials(person).map(item => item.idleExpiresAt), [new Date(Date.now() + editorIdleDays * day).toISOString(), new Date(Date.now() + editorIdleDays * day).toISOString()]);
  tick(10 * day);
  assert.deepEqual(auth.user(withBearer(used)), person);
  const usedAt = Date.now();
  assert.equal(auth.editorCredentials(person).find(item => item.lastUsedAt)?.idleExpiresAt, new Date(usedAt + editorIdleDays * day).toISOString());
  tick(4 * day + 1);
  assert.equal(store.liveSignIn(idleSignIn), false, 'never used within the window counts from approval');
  assert.equal(store.getEditorCredential(idleSignIn), undefined);
  assert.equal(auth.user(withBearer(idle)), undefined);
  assert.equal(store.liveSignIn(usedSignIn), true);
  assert.deepEqual(auth.editorCredentials(person).map(item => item.lastUsedAt), [new Date(usedAt).toISOString()]);
  tick(editorIdleDays * day - 4 * day);
  assert.equal(store.liveSignIn(usedSignIn), false, 'idle counts from the last use');
  assert.equal(auth.user(withBearer(used)), undefined);
  assert.deepEqual(auth.editorCredentials(person), []);
});

test('using an editor credential keeps it alive, written at most once a minute', t => {
  const { auth, store, tick } = setup(t);
  const started = auth.beginEditor('192.0.2.1');
  auth.claimEditor(started.code, person);
  auth.decideEditor(started.code, person, 'approved');
  const ready = auth.collectEditor(started.code, started.secret);
  if (ready.status !== 'ready') return assert.fail('no credential');
  const signIn = createHash('sha256').update(ready.token).digest('hex');
  for (let week = 0; week < 3; week++) { tick(7 * 86_400_000); assert.deepEqual(auth.user(withBearer(ready.token)), person); }
  const touched = store.getEditorCredential(signIn)!.lastUsedAt;
  tick(30_000);
  auth.user(withBearer(ready.token));
  assert.equal(store.getEditorCredential(signIn)!.lastUsedAt, touched);
  store.touchEditorSignIn(signIn, new Date(Date.now()).toISOString());
  assert.notEqual(store.getEditorCredential(signIn)!.lastUsedAt, touched);
});

function approvedToken(auth: Auth, user: User = person): string {
  const started = auth.beginEditor('192.0.2.1', editorLabel('claude-code', 'ada-laptop'));
  auth.claimEditor(started.code, user);
  auth.decideEditor(started.code, user, 'approved');
  const ready = auth.collectEditor(started.code, started.secret);
  if (ready.status !== 'ready') throw new Error('no credential');
  return ready.token;
}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

test('a rotated credential gets thirty days within its family, keeps its name, and the old one works only for the grace period', t => {
  const { auth, store, tick } = setup(t);
  const approvedAt = Date.now();
  const first = approvedToken(auth);
  const familyEnds = new Date(approvedAt + editorFamilyDays * 86_400_000).toISOString();
  assert.equal(store.getEditorCredential(hashOf(first))!.familyExpiresAt, familyEnds);
  tick(7 * 86_400_000);
  const rotated = auth.rotateEditor(first);
  assert.match(rotated.token, /^vle_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(rotated.token, first);
  assert.deepEqual(rotated.user, person);
  assert.equal(rotated.expiresAt, new Date(Date.now() + editorCredentialDays * 86_400_000).toISOString());
  assert.equal(rotated.familyExpiresAt, familyEnds, 'rotation never moves the family deadline');
  assert.deepEqual(auth.editorCredentials(person).map(item => [item.label, item.familyExpiresAt]), [['Claude Code on ada-laptop', familyEnds]], 'the list shows the new credential only');
  assert.deepEqual(auth.user(withBearer(first)), person, 'a request already on its way with the old token still succeeds');
  tick(editorRotationGraceMs + 1);
  assert.equal(store.liveSignIn(hashOf(first)), false, 'after the grace period the old token is no sign-in');
  assert.deepEqual(auth.user(withBearer(rotated.token)), person);
});

test('rotating every week never reaches past ninety days from the approval', t => {
  const { auth, tick } = setup(t);
  const approvedAt = Date.now();
  const familyEnds = approvedAt + editorFamilyDays * 86_400_000;
  let token = approvedToken(auth);
  let expiresAt = '';
  for (let week = 1; week <= 12; week++) {
    tick(7 * 86_400_000);
    const rotated = auth.rotateEditor(token);
    assert.equal(rotated.familyExpiresAt, new Date(familyEnds).toISOString(), `week ${week}`);
    assert.ok(Date.parse(rotated.expiresAt) <= familyEnds, `week ${week} ends ${rotated.expiresAt}, after the family`);
    token = rotated.token;
    expiresAt = rotated.expiresAt;
  }
  assert.equal(expiresAt, new Date(familyEnds).toISOString());
  tick(familyEnds - Date.now());
  assert.equal(auth.user(withBearer(token)), undefined, 'the family ends on its deadline');
  assert.throws(() => auth.rotateEditor(token), error => code(error) === 'unauthenticated');
});

test('presenting a credential that was already rotated signs out its whole family and ends what it issued', t => {
  const { auth, store, tick } = setup(t);
  const revoked: string[][] = [];
  auth.onFamilyRevoked = hashes => revoked.push(hashes);
  const first = approvedToken(auth);
  const unrelated = approvedToken(auth);
  tick(86_400_000);
  const second = auth.rotateEditor(first);
  assert.throws(() => auth.rotateEditor(first), error => code(error) === 'editor_credential_reused');
  assert.equal(auth.user(withBearer(second.token)), undefined, 'the credential the thief or the holder got is gone too');
  assert.equal(store.anyEditorCredential(hashOf(first)), undefined);
  assert.deepEqual(revoked.map(hashes => hashes.sort()), [[hashOf(first), hashOf(second.token)].sort()]);
  assert.deepEqual(auth.user(withBearer(unrelated)), person, 'another approval of the same person is not touched');
});

test('using a rotated credential after its grace period revokes the family, and within it does not', t => {
  const { auth, tick } = setup(t);
  const first = approvedToken(auth);
  const second = auth.rotateEditor(first);
  tick(editorRotationGraceMs - 1000);
  assert.deepEqual(auth.user(withBearer(first)), person);
  assert.deepEqual(auth.user(withBearer(second.token)), person);
  tick(2000);
  assert.equal(auth.user(withBearer(first)), undefined);
  assert.equal(auth.user(withBearer(second.token)), undefined, 'a copy used after the holder moved on ends the family');
});

test(`rotation does not revive a credential left unused for ${editorIdleDays} days, nor an unknown or revoked one`, t => {
  const { auth, store, tick } = setup(t);
  const idle = approvedToken(auth);
  tick(editorIdleDays * 86_400_000 + 1);
  assert.throws(() => auth.rotateEditor(idle), error => code(error) === 'unauthenticated');
  assert.throws(() => auth.rotateEditor(`vle_${'z'.repeat(43)}`), error => code(error) === 'unauthenticated');
  assert.throws(() => auth.rotateEditor(undefined), error => code(error) === 'unauthenticated');
  const revoked = approvedToken(auth);
  auth.revokeEditorCredential(person, store.getEditorCredential(hashOf(revoked))!.id);
  assert.throws(() => auth.rotateEditor(revoked), error => code(error) === 'unauthenticated');
});

test('a credential approved before rotation existed is its own family, ending ninety days after its approval', t => {
  const { auth, store, tick } = setup(t);
  const token = `vle_${'l'.repeat(43)}`;
  const approvedAt = Date.now();
  store.createEditorCredential({ id: 'a'.repeat(24), tokenHash: hashOf(token), userId: person.id, label: 'Claude Code', scope: 'editor', createdAt: new Date(approvedAt).toISOString(), expiresAt: new Date(approvedAt + editorCredentialDays * 86_400_000).toISOString() });
  tick(86_400_000);
  const rotated = auth.rotateEditor(token);
  assert.equal(rotated.familyExpiresAt, new Date(approvedAt + editorFamilyDays * 86_400_000).toISOString());
  assert.throws(() => auth.rotateEditor(token), error => code(error) === 'editor_credential_reused');
  assert.equal(auth.user(withBearer(rotated.token)), undefined);
});

test('an exchanged credential is a new family of an existing account, and nobody without an account gets one', t => {
  const { auth, store } = setup(t);
  const issued = auth.exchangeEditor(person.id, editorLabel('claude-code', 'ada-laptop'));
  assert.deepEqual(auth.user(withBearer(issued.token)), person);
  assert.equal(issued.familyExpiresAt, new Date(Date.now() + editorFamilyDays * 86_400_000).toISOString());
  assert.equal(store.getEditorCredential(hashOf(issued.token))!.label, 'Claude Code on ada-laptop');
  assert.throws(() => auth.exchangeEditor('oidc-unknown', 'Claude Code'), error => code(error) === 'exchange_unknown_person');
});
