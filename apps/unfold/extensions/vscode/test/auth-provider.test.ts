import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UnfoldAuthentication, accountLabel, authenticationApi, unfoldAuthenticationId, type SessionsChange } from '../src/auth-provider.ts';
import { browserLogin } from '../src/browser-login.ts';

const origin = 'https://unfold.example.com';
const credential = `vle_${'a'.repeat(43)}`;
const key = `unfold.session:${origin}`;

function fakeApi() {
  const secrets = new Map<string, string>();
  const revoked: string[] = [];
  const calls: string[] = [];
  const live = new Set<string>();
  return {
    secrets, revoked, calls, live,
    issue(token = credential) { live.add(token); secrets.set(key, token); },
    bootstrap() {
      const held = secrets.get(key);
      calls.push('bootstrap');
      if (!held || !live.has(held)) { secrets.delete(key); return { status: 401 as const }; }
      return { status: 200 as const, user: { id: 'u-1', name: 'ryan' } };
    },
    logout() {
      const held = secrets.get(key);
      calls.push('logout');
      if (held) { live.delete(held); revoked.push(held); }
      secrets.delete(key);
    },
  };
}

function harness(api = fakeApi(), signIn: () => Promise<void> = async () => { api.issue(); }) {
  let expired = 0;
  let reachable = true;
  const signOuts: string[] = [];
  const provider = new UnfoldAuthentication({
    origin: () => origin,
    credential: async at => api.secrets.get(`unfold.session:${at}`),
    account: async () => {
      if (!reachable) return 'unreachable';
      const answer = api.bootstrap();
      return answer.status === 401 ? 'signed-out' : answer.user;
    },
    signIn,
    signOut: async () => { signOuts.push('command'); api.logout(); },
    expired: () => { expired += 1; },
  });
  const changes: SessionsChange[] = [];
  provider.onDidChangeSessions(change => changes.push(change));
  return { api, provider, changes, signOuts, expiredCount: () => expired, offline: () => { reachable = false; } };
}

test('a credential stored before the update is the current session, labelled with the account and the Unfold origin', async () => {
  const { api, provider } = harness();
  api.issue();
  const [session, ...rest] = await provider.getSessions();
  assert.equal(rest.length, 0);
  assert.deepEqual(session, { id: origin, accessToken: credential, account: { id: `u-1@${origin}`, label: 'ryan · unfold.example.com' }, scopes: [] });
  assert.equal(accountLabel('ryan', 'http://127.0.0.1:4080'), 'ryan · 127.0.0.1:4080');
});

test('without a stored credential the Accounts menu holds no Unfold session', async () => {
  const { provider } = harness();
  assert.deepEqual(await provider.getSessions(), []);
});

test('signing in from the Accounts menu runs the browser approval with its code and announces the new session', async () => {
  const api = fakeApi();
  const codes: string[] = [];
  const browser = {
    async authMethods() { return { local: true, oidc: { name: 'Authentik', issuer: 'https://auth.example' } }; },
    async beginBrowserLogin() { return { code: 'code-1234', secret: 'secret', userCode: 'BCDF-GHJK', url: `${origin}/api/auth/oidc?editor=code-1234`, expiresIn: 600, interval: 1 }; },
    async collectBrowserLogin() { return { status: 'ready' as const, token: credential, user: { name: 'ryan' } }; },
    async acceptCredential(token: string) { api.issue(token); },
  };
  const { provider, changes } = harness(api, async () => { await browserLogin(browser, { open: async () => undefined, showCode: code => { codes.push(code); }, cancelled: () => false, sleep: async () => undefined }, origin); });
  const session = await provider.createSession();
  assert.deepEqual(codes, ['BCDF-GHJK']);
  assert.equal(session.accessToken, credential);
  assert.deepEqual(changes, [{ added: [session], removed: [], changed: [] }]);
});

test('a cancelled sign-in from the Accounts menu creates no session', async () => {
  const { provider, changes } = harness(fakeApi(), async () => undefined);
  await assert.rejects(provider.createSession(), /did not complete/);
  assert.deepEqual(changes, []);
});

test('signing out from the Accounts menu runs Sign Out, revokes the editor credential at Unfold and removes the session', async () => {
  const { api, provider, changes, signOuts, expiredCount } = harness();
  api.issue();
  await provider.refresh();
  const [session] = await provider.getSessions();
  await provider.removeSession(session.id);
  assert.deepEqual(signOuts, ['command']);
  assert.deepEqual(api.revoked, [credential]);
  assert.equal(api.secrets.has(key), false);
  assert.equal(api.live.has(credential), false);
  assert.deepEqual(changes.at(-1), { added: [], removed: [session], changed: [] });
  assert.deepEqual(await provider.getSessions(), []);
  assert.equal(expiredCount(), 0);
});

test('the Sign Out command and the Accounts menu share one path, so the menu follows the command', async () => {
  const { api, provider, changes, expiredCount } = harness();
  api.issue();
  await provider.refresh();
  await provider.signOut();
  assert.deepEqual(api.revoked, [credential]);
  assert.equal(changes.at(-1)?.removed.length, 1);
  assert.equal(expiredCount(), 0);
});

test('a credential the workbench no longer accepts shows Unfold as signed out and offers sign-in', async () => {
  const { api, provider, changes, expiredCount } = harness();
  api.issue();
  await provider.refresh();
  api.live.clear();
  api.secrets.set(key, `vle_${'b'.repeat(43)}`);
  await provider.refresh();
  assert.deepEqual(await provider.getSessions(), []);
  assert.equal(changes.at(-1)?.removed.length, 1);
  assert.equal(expiredCount(), 1);
});

test('an unreachable workbench keeps the session instead of signing the person out', async () => {
  const { api, provider, offline } = harness();
  api.issue();
  offline();
  const [session] = await provider.getSessions();
  assert.equal(session.accessToken, credential);
  assert.equal(session.account.label, 'Unfold · unfold.example.com');
});

test('the account is asked once per credential, not on every look at the Accounts menu', async () => {
  const { api, provider } = harness();
  api.issue();
  await provider.getSessions();
  await provider.getSessions();
  await provider.refresh();
  assert.deepEqual(api.calls, ['bootstrap']);
});

test('the provider registers only where VS Code offers the authentication API, and offers sign-in without a prompt', async () => {
  assert.equal(authenticationApi({}), undefined);
  assert.equal(authenticationApi({ authentication: { registerAuthenticationProvider: () => undefined } }), undefined);
  const registered: unknown[][] = [];
  const asked: unknown[][] = [];
  const api = authenticationApi({ authentication: { registerAuthenticationProvider: (...args: unknown[]) => { registered.push(args); return { dispose() {} }; }, getSession: async (...args: unknown[]) => { asked.push(args); return undefined; } } });
  assert.ok(api);
  const provider = harness().provider;
  api.register(unfoldAuthenticationId, 'Unfold', provider);
  assert.deepEqual(registered, [['unfold', 'Unfold', provider, { supportsMultipleAccounts: false }]]);
  await api.offerSignIn(unfoldAuthenticationId);
  assert.deepEqual(asked, [['unfold', [], { createIfNone: false }]]);
});

test('the manifest contributes the Unfold authentication provider and activates on its requests', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.contributes.authentication, [{ id: 'unfold', label: 'Unfold' }]);
  assert.ok(manifest.activationEvents.includes('onAuthenticationRequest:unfold'));
  assert.equal(manifest.engines.vscode, '^1.99.0');
});
