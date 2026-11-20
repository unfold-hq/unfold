import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from '../src/core.ts';
import * as rules from '../src/now.ts';
import type { SessionRow } from '../src/now.ts';
import type { PloegNow, PloegNowItem, PloegRunRow } from '../src/ploeg-types.ts';
import { budgetAlarms, budgetWarningShare, chatStatus, decisiveLabel, escapeMarkdown, glanceMessage, percent, spendWords, statusHover, targetCommand, todaySpend, waitingOn, whatWaitsNotice } from '../src/what-waits.ts';

const core = await loadCore(new URL('../media/core/', import.meta.url));
const today = new Date(2026, 10, 20, 15, 0, 0);
const earlier = new Date(2026, 10, 20, 9, 30, 0).toISOString();
const yesterday = new Date(2026, 10, 19, 22, 0, 0).toISOString();
const item = (id: string, state: string, extra: Partial<PloegNowItem> = {}): PloegNowItem => ({ id, team: 'bronze', state, title: `Work Item title ${id}`, url: '', createdAt: earlier, updatedAt: earlier, provider: 'vikunja', externalId: id, priority: 1, attempts: 1, infraFailures: 0, target: null, closeReason: null, latestShift: null, spentUsd: 0, pullRequestUrl: '', ...extra });
const run = (id: string, extra: Partial<PloegRunRow> = {}): PloegRunRow => ({ id, workItemId: `w${id}`, workItemTitle: `Run title ${id}`, externalRef: '', team: 'bronze', role: 'builder', round: 1, writes: true, state: 'running', outcome: '', verdict: '', failureReason: '', startedAt: earlier, finishedAt: null, durationSeconds: null, authorizedUsd: 8, settledUsd: null, observedUsd: null, ...extra });
const now = (extra: Partial<PloegNow> = {}): PloegNow => ({ demo: false, teams: ['bronze'], waiting: [], running: [], recent: [], runningTruncated: false, recentTruncated: false, errors: {}, fetchedAt: earlier, ...extra });
const row = (id: string, group: SessionRow['group'], spend: Partial<SessionRow['progress']['spend']> = {}, workItemId = ''): SessionRow => ({
  session: { id, title: `Session ${id}`, updatedAt: earlier } as SessionRow['session'],
  progress: { workItemId, demo: false, spend: { valueUsd: null, budgetUsd: null, status: 'unknown', text: '', note: '', ...spend } } as SessionRow['progress'],
  group,
});

test('what waits counts needs you and ready for review once each, a session standing in for its Work Item', () => {
  const value = now({ waiting: [item('1', 'needs_human'), item('2', 'awaiting_review'), item('3', 'awaiting_review'), item('4', 'proposed'), item('5', 'needs_human')] });
  const waiting = waitingOn(rules, value, [row('s', 'needs', {}, '5')]);
  assert.equal(waiting.needs, 2);
  assert.equal(waiting.review, 2);
  assert.deepEqual(waiting.firstNeeds, { kind: 'workItem', id: '5', title: 'Session s' });
  assert.deepEqual(waiting.firstReview, { kind: 'workItem', id: '2', title: 'Work Item title 2' });
  assert.deepEqual(waitingOn(rules, undefined, []), { needs: 0, review: 0 });
});

test('the notice says what waits in plain words, warns when someone is needed and only informs for reviews', () => {
  const several = whatWaitsNotice({ needs: 2, review: 3 }, [], false)!;
  assert.equal(several.message, '2 need you · 3 ready for review');
  assert.equal(several.severity, 'warning');
  assert.deepEqual(several.action, { label: 'Open Now', target: { kind: 'now' } });
  assert.equal(several.description, undefined);
  const reviews = whatWaitsNotice({ needs: 0, review: 3 }, [], false)!;
  assert.equal(reviews.severity, 'info');
  assert.equal(reviews.message, '3 ready for review');
  const one = whatWaitsNotice({ needs: 1, review: 0, firstNeeds: { kind: 'workItem', id: '9', title: 'Fix it' } }, [], false)!;
  assert.equal(one.message, '1 needs you');
  assert.deepEqual(one.action, { label: 'Open Work Item', target: { kind: 'workItem', id: '9', title: 'Fix it' } });
  assert.equal(whatWaitsNotice({ needs: 0, review: 1, firstReview: { kind: 'workItem', id: '9', title: 'Fix it' } }, [], false)!.action.label, 'Review Work Item');
  assert.equal(whatWaitsNotice({ needs: 0, review: 0 }, [], false), undefined, 'the notice clears when nothing waits');
});

test('a budget warns from 90 % spent and is an error once spent, and a demo never warns about spend', () => {
  assert.equal(budgetWarningShare, 0.9);
  const rows = [
    row('under', 'running', { valueUsd: 8.99, budgetUsd: 10, status: 'observed' }),
    row('at', 'running', { valueUsd: 9, budgetUsd: 10, status: 'observed' }),
    row('over', 'needs', { valueUsd: 10.5, budgetUsd: 10, status: 'settled' }),
    row('demo', 'running', { valueUsd: 10, budgetUsd: 10, status: 'demo' }),
    row('none', 'running', { valueUsd: 3, budgetUsd: 0, status: 'observed' }),
  ];
  const alarms = budgetAlarms(rows);
  assert.deepEqual(alarms.map(alarm => alarm.title), ['Session over', 'Session at']);
  const one = whatWaitsNotice({ needs: 0, review: 0 }, [alarms[1]], false)!;
  assert.equal(one.message, 'Budget 90 % spent on Session at');
  assert.equal(one.severity, 'warning');
  assert.deepEqual(one.action.target, { kind: 'session', id: 'at', title: 'Session at' });
  const both = whatWaitsNotice({ needs: 0, review: 0 }, alarms, false)!;
  assert.equal(both.message, '2 budgets 90 % spent or more');
  assert.equal(both.severity, 'error');
  assert.equal(percent(0.899), '89 %', 'rounded down, never more than was spent');
});

test('a demo workbench says it is one', () => {
  const notice = whatWaitsNotice({ needs: 1, review: 0 }, [], true)!;
  assert.equal(notice.description, 'Demo workbench: illustrative records, no model calls or spend.');
  assert.deepEqual(todaySpend(now({ demo: true, running: [run('1', { observedUsd: 3 })] }), false, today), { status: 'demo' });
  assert.equal(spendWords(core, todaySpend(now(), true, today)), 'demo, no spend');
  assert.equal(chatStatus(core, { needs: 0, review: 0 }, { status: 'demo' }, true).tooltip, 'Demo workbench: illustrative records, no model calls or spend.');
});

test("today's spend adds what Runs that finished today settled to what running Runs observed, and says when it is a lower bound", () => {
  const value = now({
    recent: [run('a', { state: 'finished', finishedAt: earlier, settledUsd: 1.5 }), run('b', { state: 'finished', finishedAt: yesterday, settledUsd: 100 })],
    running: [run('c', { observedUsd: 2.6 })],
  });
  assert.deepEqual(todaySpend(value, false, today), { status: 'amount', settledUsd: 1.5, observedUsd: 2.6, partial: false });
  assert.equal(spendWords(core, todaySpend(value, false, today)), `${core.money(4.1)} today`);
  assert.equal(todaySpend({ ...value, recentTruncated: true }, false, today).status === 'amount' && spendWords(core, todaySpend({ ...value, recentTruncated: true }, false, today)), `at least ${core.money(4.1)} today`);
  assert.equal((todaySpend(now({ running: [run('d')] }), false, today) as { partial: boolean }).partial, true, 'a running Run without an amount makes the sum a lower bound');
  assert.deepEqual(todaySpend(undefined, false, today), { status: 'unknown' });
  assert.deepEqual(todaySpend(now({ errors: { recent: 'down', running: 'down' } }), false, today), { status: 'unknown' });
  assert.equal(spendWords(core, { status: 'unknown' }), '');
});

test('the line at the top of Now links each count and keeps the line Now already shows', () => {
  const message = glanceMessage(core, { needs: 1, review: 3, firstNeeds: { kind: 'workItem', id: '9', title: 'Fix it' } }, { status: 'amount', settledUsd: 4.1, observedUsd: 0, partial: false }, 'Ryan · unfold.example');
  const [line, existing] = message.split('\n\n');
  assert.ok(line.startsWith('[3 ready for review](command:unfold.openNow) · [1 needs you](command:unfold.openWorkItem?'), line);
  assert.ok(line.includes(encodeURIComponent(JSON.stringify([{ id: '9', title: 'Fix it' }]))));
  assert.ok(line.endsWith(escapeMarkdown(`${core.money(4.1)} today`)));
  assert.equal(existing, 'Ryan · unfold\\.example');
  assert.equal(glanceMessage(core, { needs: 0, review: 0 }, { status: 'unknown' }, ''), 'Nothing waits on you');
});

test('a title cannot add links or emphasis, and only rows that wait on the person are bold', () => {
  assert.equal(escapeMarkdown('[x](command:evil) *b*'), '\\[x\\]\\(command:evil\\) \\*b\\*');
  assert.equal(decisiveLabel('Fix [it]', true), '**Fix \\[it\\]**');
  assert.equal(decisiveLabel('Fix it', false), 'Fix it');
  assert.deepEqual(targetCommand({ kind: 'session', id: 's1', title: 'x' }), { command: 'unfold.open', arguments: ['s1'] });
  assert.deepEqual(targetCommand({ kind: 'now' }), { command: 'unfold.now.focus', arguments: [] });
});

test('the chat status menu says how many need the person and what was spent today', () => {
  const words = chatStatus(core, { needs: 2, review: 3 }, { status: 'amount', settledUsd: 1, observedUsd: 0, partial: false }, false);
  assert.equal(words.description, `2 need you · ${core.money(1)} today`);
  assert.equal(words.detail, '3 ready for review');
  assert.equal(chatStatus(core, { needs: 0, review: 0 }, { status: 'unknown' }, false).description, 'Nothing needs you');
});

test('the status bar hover lists what runs with its cost so far and today\'s spend', () => {
  const hover = statusHover(core, rules, now({ running: [run('1', { observedUsd: 0.34 })], waiting: [item('2', 'needs_human')] }), [], { demo: false, origin: 'https://unfold.example', at: today.getTime() });
  assert.match(hover, /^\*\*1 needs you\*\*/);
  assert.match(hover, /Running now:/);
  assert.ok(hover.includes('**Run title 1**'), hover);
  assert.ok(hover.includes('so far'), hover);
  assert.ok(hover.includes('Spend: '), hover);
  const demo = statusHover(core, rules, now({ demo: true, running: [run('1', { observedUsd: 0.34 })] }), [], { demo: false, origin: 'https://unfold.example', at: today.getTime() });
  assert.ok(!demo.includes('so far'), 'a demo shows no cost');
  assert.ok(demo.includes('demo workbench, no model calls or spend'));
  assert.ok(statusHover(core, rules, now(), [], { demo: false, origin: 'https://unfold.example' }).includes('Nothing runs now.'));
});
