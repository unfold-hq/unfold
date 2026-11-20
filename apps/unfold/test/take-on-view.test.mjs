import './trackers-support.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handBackDialogMarkup, mayTakeOn, proposalCost, takeOnLists, takeOnMarkup } from '../public/take-on.js';

const now = Date.parse('2026-11-20T10:00:00Z');
const target = { forge: 'forgejo', owner: 'acme', repo: 'shop', baseBranch: 'main' };
const operator = { id: 'ryan', role: 'operator' };
const viewer = { id: 'sam', role: 'viewer' };

function data(extra = {}) {
  return {
    demo: false,
    teams: ['delivery', 'research'],
    errors: {},
    waiting: [
      { id: '105', team: 'delivery', state: 'awaiting_review', title: 'Round half-cent totals', createdAt: '2026-11-20T07:00:00Z', updatedAt: '2026-11-20T09:00:00Z', provider: 'vikunja', externalId: 'VIK-105', target, closeReason: 'plan_exhausted', latestShift: null, spentUsd: 1.5, pullRequestUrl: '' },
      { id: '110', team: 'delivery', state: 'needs_human', title: 'Finish the VAT rounding by hand', createdAt: '2026-11-20T07:00:00Z', updatedAt: '2026-11-20T09:30:00Z', provider: 'vikunja', externalId: 'VIK-110', target, closeReason: 'taken_over', latestShift: { round: 2, closeReason: 'taken_over', budgetUsd: 3, spentUsd: 1.25, reservedUsd: 0, closedAt: '2026-11-20T09:30:00Z' }, spentUsd: 1.25, pullRequestUrl: '' },
      { id: '108', team: 'delivery', state: 'needs_human', title: 'Show VAT per line', createdAt: '2026-11-20T07:00:00Z', updatedAt: '2026-11-20T09:30:00Z', provider: 'vikunja', externalId: 'VIK-108', target, closeReason: 'plan_exhausted', latestShift: null, spentUsd: 0, pullRequestUrl: '' },
      { id: '107', team: 'research', state: 'proposed', title: 'Clarify the research markets with a very long title that must wrap on a phone rather than be cut off', createdAt: '2026-11-20T09:50:00Z', updatedAt: '2026-11-20T09:50:00Z', provider: 'ploeg', externalId: 'run-46-1', target: null, closeReason: null, latestShift: null, spentUsd: null, pullRequestUrl: '', sourceWorkItemId: '104', sourceTitle: 'Define the research brief', createdKind: 'clarify', ready: false },
    ],
    active: [
      { id: '102', team: 'delivery', state: 'leased', title: 'Prepare a regression investigation', createdAt: '2026-11-20T08:00:00Z', updatedAt: '2026-11-20T09:55:00Z', provider: 'vikunja', externalId: 'VIK-102', target, closeReason: null, latestShift: { round: 1, closeReason: null, budgetUsd: 2.5, spentUsd: 0.4, reservedUsd: 0.1, closedAt: null }, spentUsd: 0.4, pullRequestUrl: '' },
      { id: '103', team: 'delivery', state: 'queued', title: 'Document the order verification workflow', createdAt: '2026-11-20T08:00:00Z', updatedAt: '2026-11-20T09:58:00Z', provider: 'vikunja', externalId: 'VIK-103', target, closeReason: null, latestShift: null, spentUsd: null, pullRequestUrl: '' },
    ],
    running: [],
    recent: [],
    refused: [],
    ...extra,
  };
}

test('Take on lists proposals to approve, taken-over work to hand back and running or queued work to stop, nothing else', () => {
  const lists = takeOnLists(data());
  assert.deepEqual(lists.approve.map(item => item.id), ['107']);
  assert.deepEqual(lists.handBack.map(item => item.id), ['110']);
  assert.deepEqual(lists.stop.map(item => item.id), ['102', '103']);
  assert.deepEqual(takeOnLists(null), { approve: [], handBack: [], stop: [] });
});

test('each row names its Team, what it is and its cost, with one full-width action wired to the existing confirmations', () => {
  const html = takeOnMarkup({ data: data(), error: null }, operator, now);
  assert.match(html, /Team research/);
  assert.match(html, /Team delivery/);
  assert.match(html, /Found while working on Define the research brief/);
  assert.match(html, /Needs refinement/);
  assert.match(html, /Spends from the research Team’s budget once approved\. Ploeg does not report that budget to Unfold yet, so no amount is shown\./);
  assert.match(html, /id="take-on-approve-107" data-action="take-on-approve" data-id="107" aria-describedby="take-on-107-title take-on-107-cost"/);
  assert.match(html, /id="take-on-hand-back-110" data-action="take-on-hand-back" data-id="110"/);
  assert.match(html, /id="take-on-stop-102" data-action="take-on-stop" data-id="102"/);
  assert.match(html, /id="take-on-stop-103" data-action="take-on-stop" data-id="103"/);
  assert.match(html, /aria-valuetext="US\$\s0,40 settled of US\$\s2,50 authorized, US\$\s0,10 held"/);
  assert.match(html, /data-unknown><div class="meter-label"><span class="meter-text"><span class="meter-caption">Spend<\/span> <span class="meter-value">Not reported<\/span>/, 'a queued row without a Shift reads Not reported, never zero');
  assert.doesNotMatch(html, /take-on-[a-z-]+-105|take-on-[a-z-]+-108/, 'review and other Needs you rows are not work to take on here');
  assert.match(html, /<a href="#work\/107">/);
  assert.match(html, /4 Work Items you can act on/);
});

test('a viewer reads the list without buttons and is told who decides', () => {
  const html = takeOnMarkup({ data: data(), error: null }, viewer, now);
  assert.doesNotMatch(html, /data-action="take-on-/);
  assert.match(html, /An operator or administrator approves, hands back or stops it\./);
  assert.equal(mayTakeOn(viewer), false);
  assert.equal(mayTakeOn({ role: 'admin' }), true);
  assert.equal(mayTakeOn(null), false);
});

test('the demo says it is one and shows no spend', () => {
  const html = takeOnMarkup({ data: data({ demo: true }), error: null }, operator, now);
  assert.match(html, /class="demo-note"/);
  assert.match(html, /Nothing is dispatched and nothing is spent\./);
  assert.match(html, /Demo · no model calls/);
  assert.doesNotMatch(html, /US\$\s0,40/);
  assert.equal(proposalCost({ team: 'delivery' }, true), 'Demo · nothing is dispatched and nothing is spent.');
});

test('nothing to take on, a failed first read and a failed part each say so', () => {
  assert.match(takeOnMarkup({ data: data({ waiting: [], active: [] }), error: null }, operator, now), /Nothing to take on/);
  const failed = takeOnMarkup({ data: null, error: { message: 'Ploeg did not answer.' } }, operator, now);
  assert.match(failed, /Could not load the work you can take on/);
  assert.match(failed, /data-action="ploeg-reload"/);
  const partial = takeOnMarkup({ data: data({ active: [], errors: { active: 'Ploeg timed out.' } }), error: null }, operator, now);
  assert.match(partial, /Could not read this part: Ploeg timed out\./);
  assert.match(takeOnMarkup({ data: null, error: null }, operator, now), /aria-busy="true"/);
});

test('labels are escaped and never clipped', () => {
  const hostile = data({ waiting: [{ ...data().waiting[3], title: '<img src=x onerror=alert(1)>', team: '<b>x</b>' }], active: [] });
  const html = takeOnMarkup({ data: hostile, error: null }, operator, now);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.doesNotMatch(html, /text-overflow|ellipsis|…<\//);
});

test('the hand-back dialog says what resumes and on which budget, and refuses without a live button when Ploeg would', () => {
  const detail = { demo: false, item: { id: '110', title: 'Finish the VAT rounding by hand', provider: 'vikunja', externalId: 'VIK-110', latestShift: { budgetUsd: 3, spentUsd: 1.25, reservedUsd: 0 } }, shifts: [] };
  const open = handBackDialogMarkup(detail, { enabled: true, reason: '', actFor: null });
  assert.match(open, /data-form="take-on-hand-back" data-id="110"/);
  assert.match(open, /Ploeg resumes the Round that stopped on the same branch, from your latest commit, with the budget the attempt had left\./);
  assert.match(open, /Spend so far/);
  assert.match(open, /<button type="submit" class="button primary">/);
  const refused = handBackDialogMarkup(detail, { enabled: false, reason: 'sam took this over.', actFor: null });
  assert.match(refused, /You cannot hand this back/);
  assert.match(refused, /sam took this over\./);
  assert.match(refused, /<button type="submit" class="button primary" disabled>/);
  const demo = handBackDialogMarkup({ ...detail, demo: true }, { enabled: false, reason: 'The demo restarts nothing.', actFor: null });
  assert.match(demo, /Not available in the demo/);
  assert.match(demo, /Demo · no model calls/);
  assert.match(handBackDialogMarkup(detail, { enabled: true, reason: '', actFor: 'sam' }), /Hand back for sam\?/);
});
