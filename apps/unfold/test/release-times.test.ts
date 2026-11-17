import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationStartedAt, releasedAt } from '../src/http.ts';

test('a release instant is kept and normalised to UTC', () => {
  assert.equal(releasedAt('2026-11-17T09:30:00Z'), '2026-11-17T09:30:00.000Z');
  assert.equal(releasedAt('2026-11-17T10:30:00+01:00'), '2026-11-17T09:30:00.000Z');
});

test('a missing, unparseable or placeholder release instant counts as unknown', () => {
  assert.equal(releasedAt(undefined), null);
  assert.equal(releasedAt(''), null);
  assert.equal(releasedAt('soon'), null);
  assert.equal(releasedAt('1970-01-01T00:00:00Z'), null);
});

test('the server records when it started', () => {
  assert.ok(Number.isFinite(Date.parse(applicationStartedAt)));
  assert.ok(Date.parse(applicationStartedAt) <= Date.now());
});
