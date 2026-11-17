import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { request } from './api-support.ts';
import { signIn, workbench } from './oidc-support.ts';
import { subjectUserId } from '../src/oidc.ts';

const grant = 'urn:ietf:params:oauth:grant-type:token-exchange';
const jwtType = 'urn:ietf:params:oauth:token-type:jwt';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const exchanging = (match?: 'subject' | 'email') => ({ configure: (config: any) => { config.auth.oidc.exchange = { audiences: ['telemetry-helper'], match: match ?? 'subject' }; } });

async function exchange(url: string, subjectToken: string, extra: Record<string, unknown> = {}) {
  return request(url, '/api/auth/editor/exchange', { method: 'POST', body: { grant_type: grant, subject_token: subjectToken, subject_token_type: jwtType, client: 'claude-code', host: 'ada-laptop', ...extra }, csrf: false });
}

function claimsFor(issuer: string, overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: issuer, aud: 'telemetry-helper', sub: 'person@example.com', email: 'person@example.com', email_verified: true, iat: now, exp: now + 600, ...overrides };
}

async function existingAccount(server: { url: string }, idp: Parameters<typeof signIn>[1]) {
  const { callback } = await signIn(server, idp);
  assert.equal(callback.status, 303);
}

test('without auth.oidc.exchange the exchange is not served', async t => {
  const { server, idp } = await workbench(t);
  await existingAccount(server, idp);
  const refused = await exchange(server.url, idp.mint(claimsFor(idp.issuer)));
  assert.equal(refused.status, 404);
  assert.equal(refused.body.error.code, 'exchange_off');
});

test('a token from the configured issuer for an allowed audience becomes an editor credential of the same account the browser signs in to', async t => {
  const { server, idp } = await workbench(t, exchanging());
  await existingAccount(server, idp);
  const traded = await exchange(server.url, idp.mint(claimsFor(idp.issuer)));
  assert.equal(traded.status, 200, traded.text);
  assert.match(traded.body.access_token, /^vle_[A-Za-z0-9_-]{43}$/);
  assert.equal(traded.body.issued_token_type, 'urn:ietf:params:oauth:token-type:access_token');
  assert.equal(traded.body.token_type, 'Bearer');
  assert.equal(traded.body.user.id, subjectUserId(idp.issuer, 'person@example.com'));
  assert.ok(Date.parse(traded.body.familyExpiresAt) > Date.now() + 89 * 86_400_000);
  const bootstrap = await request(server.url, '/api/bootstrap', { headers: bearer(traded.body.access_token) });
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.body.user.name, 'person@example.com');
  assert.deepEqual(server.app.store.editorCredentials(traded.body.user.id).map(item => item.label), ['Claude Code on ada-laptop']);

  const form = await fetch(`${server.url}/api/auth/editor/exchange`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: grant, subject_token: idp.mint(claimsFor(idp.issuer)), subject_token_type: 'urn:ietf:params:oauth:token-type:id_token' }).toString() });
  assert.equal(form.status, 200, 'RFC 8693 clients send a form');
});

test('Unfold refuses a token from another issuer, for another audience, expired, long-lived, forged, or for a person without an account', async t => {
  const { server, idp } = await workbench(t, exchanging());
  await existingAccount(server, idp);
  const now = Math.floor(Date.now() / 1000);
  const { privateKey: stranger } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const refusals: Array<[string, string, number, string]> = [
    ['another issuer', idp.mint(claimsFor('https://idp.example.org'))],
    ['another audience', idp.mint(claimsFor(idp.issuer, { aud: 'unfold-elsewhere' }))],
    ['expired', idp.mint(claimsFor(idp.issuer, { iat: now - 7200, exp: now - 3600 }))],
    ['longer than a day', idp.mint(claimsFor(idp.issuer, { exp: now + 2 * 86_400 }))],
    ['without iat', idp.mint(claimsFor(idp.issuer, { iat: undefined }))],
    ['signed by a stranger', idp.mint(claimsFor(idp.issuer), stranger)],
    ['not a JWT', 'not-a-token'],
  ].map(([name, token]) => [name, token, 400, 'invalid_grant']);
  refusals.push(['a subject without an account', idp.mint(claimsFor(idp.issuer, { sub: 'someone-else@example.com' })), 403, 'exchange_unknown_person']);
  for (const [name, token, status, code] of refusals) {
    const refused = await exchange(server.url, token);
    assert.equal(refused.status, status, `${name}: ${refused.text}`);
    assert.equal(refused.body.error.code, code, name);
    assert.equal(refused.body.access_token, undefined, name);
  }
  const wrongGrant = await exchange(server.url, idp.mint(claimsFor(idp.issuer)), { grant_type: 'refresh_token' });
  assert.equal(wrongGrant.body.error.code, 'unsupported_grant_type');
  const wrongType = await exchange(server.url, idp.mint(claimsFor(idp.issuer)), { subject_token_type: 'urn:ietf:params:oauth:token-type:saml2' });
  assert.equal(wrongType.body.error.code, 'invalid_request');
});

test('under match email a client with its own subjects finds the account by verified email, and an unverified email finds nobody', async t => {
  const { server, idp } = await workbench(t, exchanging('email'));
  await existingAccount(server, idp);
  const pairwise = await exchange(server.url, idp.mint(claimsFor(idp.issuer, { sub: 'pairwise-4711', email: 'Person@Example.com' })));
  assert.equal(pairwise.status, 200, pairwise.text);
  assert.equal(pairwise.body.user.id, subjectUserId(idp.issuer, 'person@example.com'));
  const unverified = await exchange(server.url, idp.mint(claimsFor(idp.issuer, { sub: 'pairwise-4711', email_verified: false })));
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.error.code, 'exchange_unknown_person');
});

test('an editor rotates its credential over HTTP, and replaying the old one signs out the family', async t => {
  const { server, idp } = await workbench(t, exchanging());
  await existingAccount(server, idp);
  const first = (await exchange(server.url, idp.mint(claimsFor(idp.issuer)))).body;
  const rotated = await request(server.url, '/api/auth/editor/rotate', { method: 'POST', headers: bearer(first.access_token) });
  assert.equal(rotated.status, 200, rotated.text);
  assert.notEqual(rotated.body.token, first.access_token);
  assert.equal(rotated.body.familyExpiresAt, first.familyExpiresAt);
  assert.equal((await request(server.url, '/api/bootstrap', { headers: bearer(rotated.body.token) })).status, 200);
  const replayed = await request(server.url, '/api/auth/editor/rotate', { method: 'POST', headers: bearer(first.access_token) });
  assert.equal(replayed.status, 401);
  assert.equal(replayed.body.error.code, 'editor_credential_reused');
  assert.equal((await request(server.url, '/api/bootstrap', { headers: bearer(rotated.body.token) })).status, 401);
  const anonymous = await request(server.url, '/api/auth/editor/rotate', { method: 'POST' });
  assert.equal(anonymous.status, 401);
});
