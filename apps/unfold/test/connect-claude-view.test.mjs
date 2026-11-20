import test from 'node:test';
import assert from 'node:assert/strict';
import { routinesMarkup } from '../public/views/connect-claude.js';

const overview = (fields = {}) => ({ demo: false, served: true, waitsFor: null, refused: null, teams: [{ team: 'delivery', routine: null }], ...fields });

test('an installation that does not accept routines reads as not turned on, with no steps to connect', () => {
  const page = routinesMarkup(overview({ refused: { code: 'routines_not_accepted', message: 'This installation does not start Runs through a person’s own Claude routine.' }, teams: [] }), 'operator');
  assert.match(page, /Not turned on in this installation/);
  assert.match(page, /does not start Runs through a person’s own Claude routine/);
  assert.doesNotMatch(page, /data-tone="danger"|Ploeg refused/);
  assert.doesNotMatch(page, /Connect once, per Team/);
});

test('any other refusal still reads as Ploeg refused, with its code', () => {
  const page = routinesMarkup(overview({ refused: { code: 'secret_store_unavailable', message: 'Ploeg’s secret store did not answer.' }, teams: [] }), 'operator');
  assert.match(page, /Ploeg refused/);
  assert.match(page, /\(secret_store_unavailable\)/);
});

test('a served installation shows the steps and the person’s Teams', () => {
  const page = routinesMarkup(overview(), 'operator');
  assert.match(page, /Connect once, per Team/);
  assert.match(page, /Your Teams/);
  assert.match(page, /delivery/);
});
