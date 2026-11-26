import test from 'node:test';
import assert from 'node:assert/strict';
import { ForgeConnection } from '../src/delivery-publishers/shared.ts';

const connection = () => new ForgeConnection({ kind: 'forgejo', apiUrl: 'https://forge.example/api/v1', tokenEnv: 'UNUSED' });

test('a forge call that times out is publication_forge_unavailable, not a TypeError', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); });
  await assert.rejects(connection().fetchJson('https://forge.example/api/v1/repos', () => ({})), { code: 'publication_forge_unavailable' });
});

test('a forge call refused by the network is publication_forge_unavailable', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); });
  await assert.rejects(connection().fetchJson('https://forge.example/api/v1/repos', () => ({})), { code: 'publication_forge_unavailable' });
});
