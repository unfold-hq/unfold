import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedMarkup, usageAmount, usageDetail, usageMarkup } from '../public/views/usage.js';

const money = (fields = {}) => ({ count: 0, usd: 0, final: true, unknown: 0, ...fields });
const linked = (fields = {}) => ({ count: 0, claudeCode: 0, uncosted: 0, estimateUsd: 0, costStatus: 'estimate', tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, telemetry: 'connected', reason: null, truncated: false, ...fields });
const usage = (fields = {}) => ({ period: 'month', since: '2026-11-01T00:00:00.000Z', until: '2026-11-17T09:00:00.000Z', spent: money(), asks: { ...money(), demo: 0, truncated: false }, sessions: { ...money(), budgetUsd: 0, demo: 0, truncated: false }, linkedSessions: linked(), notAttributed: [{ source: 'ploeg_runs', reason: 'Ploeg does not report that spend per person yet.' }], ...fields });

test('an unknown amount reads "Not known yet" and a partial one "At least", never a zero', () => {
  assert.equal(usageAmount(money({ count: 2, usd: null, unknown: 2, final: false })), 'Not known yet');
  assert.match(usageAmount(money({ count: 2, usd: 0.25, unknown: 1, final: false })), /^At least .*0[.,]25/);
  assert.doesNotMatch(usageAmount(money({ count: 1, usd: 1.5 })), /At least/);
  assert.equal(usageDetail(money(), 'Ask'), 'No Asks in this period');
  assert.equal(usageDetail(money({ count: 3, usd: 1, unknown: 1, final: false }), 'Ask'), '3 Asks · 1 not known yet');
  assert.equal(usageDetail(money({ count: 1, usd: 1, final: false }), 'session'), '1 session · not final yet');
});

test('Linked Sessions say when no telemetry is connected instead of a zero estimate, and call the cost an estimate', () => {
  const none = linkedMarkup(linked({ count: 2, claudeCode: 2, estimateUsd: null, tokens: null, telemetry: 'not_configured', reason: 'No metrics store is configured, so the cost and tokens are unknown.' }));
  assert.match(none, /No telemetry connected/);
  assert.doesNotMatch(none, /\$\s?0|US\$\s?0/);
  const down = linkedMarkup(linked({ count: 1, claudeCode: 1, estimateUsd: null, tokens: null, telemetry: 'unreadable', reason: 'The metrics store answered 503.' }));
  assert.match(down, /Not known yet/);
  assert.match(down, /answered 503/);
  const known = linkedMarkup(linked({ count: 1, claudeCode: 1, estimateUsd: 3.5, tokens: { input: 1000, output: 200, cacheRead: 0, cacheCreation: 0 } }));
  assert.match(known, /About .*3[.,]50/);
  assert.match(known, /A Claude plan is not billed this/);
});

test('the page shows spend by source, demo items left out, and what is not attributed yet', () => {
  const page = usageMarkup(usage({ spent: money({ count: 2, usd: 1.75 }), asks: { ...money({ count: 1, usd: 0.25 }), demo: 2, truncated: false }, sessions: { ...money({ count: 1, usd: 1.5 }), budgetUsd: 4, demo: 0, truncated: false } }), '<div class="segmented"></div>');
  for (const heading of ['Spent through Unfold', 'Asks', 'Started in Unfold', 'Your own agent sessions', 'Not attributed to you yet']) assert.match(page, new RegExp(heading));
  assert.match(page, /2 demo items left out/);
  assert.match(page, /Ploeg does not report that spend per person yet/);
  assert.match(page, /class="segmented"/);
});

test('Linked Sessions show the estimate Unfold recorded when the metrics store no longer has it, and say so', () => {
  const html = linkedMarkup(linked({ count: 1, claudeCode: 1, estimateUsd: 4.25, estimateSource: 'recorded', recordedAt: '2026-10-17T10:00:00.000Z', tokens: { input: 1000, output: 0, cacheRead: 0, cacheCreation: 0 }, telemetry: 'unreadable', reason: 'The metrics store answered 503.' }));
  assert.match(html, /About US\$\s4,25/);
  assert.match(html, /as Unfold recorded it \(newest reading 2026-10-17\)/);
  assert.doesNotMatch(html, /Not known yet/);
});
