import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadCore } from '../src/core.ts';
import { ApiError } from '../src/client.ts';
import { describeItem, describeSession, linkedWorkItems, nowGroup, sessionRows } from '../src/now.ts';
import { budgetNotReported, takeOn, takeOnAccept, takeOnChannel, takeOnMessage, takeOnTarget, type ActionContext, type ToolActor } from '../src/lm-tools.ts';
import type { PloegDetail, PloegNow, PloegNowItem } from '../src/ploeg-types.ts';
import type { Session } from '../src/types.ts';
import { noInputReply, workSessionEntries, workSessionRef, workSessionScope, workSessionType, workSessionUri } from '../src/work-sessions.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../test/fixtures/session-059675b9.json', import.meta.url), 'utf8'));
const core = await loadCore(new URL('../media/core/', import.meta.url));
const at = new Date(Date.now() - 3_600_000).toISOString();
const later = new Date(Date.now() - 60_000).toISOString();
const origin = 'https://unfold.example';
const item = (state: string, extra: Partial<PloegNowItem> = {}): PloegNowItem => ({ id: '42', team: 'bronze', state, title: 'unfold: show one provisional total', url: 'https://vikunja.example/tasks/1694', createdAt: at, updatedAt: at, provider: 'vikunja', externalId: '1694', priority: 4, attempts: 1, infraFailures: 0, target: null, closeReason: null, latestShift: null, spentUsd: 0, pullRequestUrl: '', ...extra });
const now = (waiting: PloegNowItem[], demo = false): PloegNow => ({ demo, teams: ['bronze'], waiting, running: [], recent: [], runningTruncated: false, recentTruncated: false, errors: {}, fetchedAt: at });
const waiting = now([
  item('proposed', { id: '50', title: 'unfold: explain the budget', sourceTitle: 'builder Run 12' }),
  item('awaiting_review', { id: '43', pullRequestUrl: 'https://forgejo.example/acme/unfold/pulls/784', updatedAt: later }),
  item('needs_human', { id: '44', latestShift: { round: 2, budgetUsd: 5, spentUsd: 1.25 } }),
  item('stale', { id: '45' }),
  item('needs_human', { id: '184' }),
  item('queued', { id: '46' }),
]);
const asking = { ...(fixture.session as Session), id: 'ask', execution: undefined, status: 'waiting_input', blocker: undefined } as Session;
const someoneElse = { ...asking, id: 'theirs', ownerId: 'alice' } as Session;
const rules = { nowGroup, linkedWorkItems, describeItem, describeSession };
const rows = sessionRows(core, [fixture.session as Session, asking, someoneElse]);

test('by default the Sessions list shows only proposed work, marked as work the person may take on', () => {
  const entries = workSessionEntries(core, rules, { now: waiting, rows, userId: 'ryan', demo: false }, 'take-on');
  assert.deepEqual(entries.map(entry => entry.ref), [{ kind: 'work-item', id: '50' }]);
  const [offer] = entries;
  assert.equal(offer.takeOn, true);
  assert.equal(offer.badge, 'Proposed');
  assert.equal(offer.status, undefined, 'an offer is not a question to the person');
  assert.match(offer.description, /^Proposed · you may take this on · Team bronze · from builder Run 12$/);
  assert.match(offer.tooltip, /You confirm the Team and its budget first; nothing runs until you do/);
  assert.equal(workSessionScope(undefined), 'take-on');
  assert.equal(workSessionScope('nonsense'), 'take-on');
  assert.equal(workSessionScope('all'), 'all');
});

test('with all, the work that needs the person or waits for their review is listed once, with its status, before the offers', () => {
  const entries = workSessionEntries(core, rules, { now: waiting, rows, userId: 'ryan', demo: false }, 'all');
  const ids = entries.map(entry => `${entry.ref.kind}:${entry.ref.id}`);
  assert.equal(ids.includes('work-item:184'), false, 'Work Item 184 is listed as the session that drives it');
  assert.equal(ids.includes('work-item:46'), false, 'queued work waits on nobody');
  assert.equal(ids.includes('session:theirs'), false, 'another person\'s session is theirs');
  assert.equal(ids.at(-1), 'work-item:50', 'offers come last');
  const by = (kind: string, id: string) => entries.find(entry => entry.ref.kind === kind && entry.ref.id === id)!;
  assert.equal(by('work-item', '43').status, 'completed');
  assert.match(by('work-item', '43').description, /PR #784/);
  assert.equal(by('work-item', '44').status, 'needs-input');
  assert.ok(by('work-item', '44').tooltip.endsWith(`Latest Shift, Round 2: ${core.money(1.25)} spent of ${core.money(5)}.`));
  assert.equal(by('work-item', '45').status, 'failed');
  assert.equal(by('session', 'ask').status, 'needs-input', 'a session that asks the person needs input');
  assert.equal(by('session', fixture.session.id).status, 'failed', 'an interrupted session needs the person but asks nothing');
  for (const entry of entries) assert.equal(entry.takeOn, entry.ref.id === '50');
});

test('a session lists the files it changed with their line counts; a Work Item lists none it does not know', () => {
  const entries = workSessionEntries(core, rules, { now: waiting, rows, userId: 'ryan', demo: false }, 'all');
  const session = entries.find(entry => entry.ref.id === fixture.session.id)!;
  assert.deepEqual(session.changes, core.changedFiles(fixture.session).map(change => ({ file: change.file, insertions: change.added, deletions: change.removed })));
  assert.ok(session.changes.length > 0);
  assert.ok(session.changes.every(change => Number.isInteger(change.insertions) && Number.isInteger(change.deletions)));
  assert.deepEqual(entries.find(entry => entry.ref.id === '43')!.changes, []);
});

test('a demo says it is one and shows no spend', () => {
  const entries = workSessionEntries(core, rules, { now: now(waiting.waiting, true), rows: [], demo: false }, 'all');
  assert.match(entries.find(entry => entry.ref.id === '50')!.description, /illustration/);
  assert.doesNotMatch(entries.find(entry => entry.ref.id === '44')!.tooltip, /Latest Shift/);
});

test('an item URI round-trips and nothing else is read as one', () => {
  for (const ref of [{ kind: 'work-item' as const, id: '50' }, { kind: 'session' as const, id: 'ab_12-c' }]) {
    const uri = new URL(workSessionUri(ref));
    assert.equal(uri.protocol, `${workSessionType}:`);
    assert.deepEqual(workSessionRef({ scheme: workSessionType, path: uri.pathname }), ref);
  }
  assert.equal(workSessionRef({ scheme: 'file', path: '/work-item/50' }), undefined);
  assert.equal(workSessionRef({ scheme: workSessionType, path: '/run/50' }), undefined);
  assert.equal(workSessionRef({ scheme: workSessionType, path: '/session/..%2Fx' }), undefined);
});

test('a new session\'s prompt names the Work Item to take on', () => {
  assert.equal(takeOnTarget('184'), '184');
  assert.equal(takeOnTarget(' #184 '), '184');
  assert.equal(takeOnTarget(`${origin}/#work/184`), '184');
  assert.equal(takeOnTarget('fix the login page'), undefined);
  assert.equal(takeOnTarget(undefined), undefined);
});

const proposedDetail = (extra: Partial<PloegDetail['item']> = {}, demo = false): PloegDetail => ({ item: { id: '50', title: 'unfold: explain the budget', provider: 'ploeg', externalId: '50', team: 'bronze', state: 'proposed', description: '', attempts: 0, target: null, url: '', priority: 3, infraFailures: 0, createdAt: at, updatedAt: at, latestShift: null, ...extra }, shifts: [], runs: [], checkpoints: [], events: [], demo });

function setup(details: PloegDetail[], options: { signedIn?: boolean; fail?: unknown } = {}) {
  const calls: { action: string; id: string; body: Record<string, unknown>; via: { client: string; confirmation: string } }[] = [];
  let read = 0;
  const actor: ToolActor = {
    origin,
    workItem: async () => details[Math.min(read++, details.length - 1)],
    workItemAction: async (id, action, body, via) => { if (options.fail) throw options.fail; calls.push({ action, id, body, via }); return { state: 'queued' }; },
  };
  const context: ActionContext = { core, actor, signedIn: async () => options.signedIn ?? true, nonce: () => 'n0nce' };
  const asked: { title: string; message: string; accept: string }[] = [];
  const confirm = (answer: boolean) => async (title: string, message: string, accept: string) => { asked.push({ title, message, accept }); return answer; };
  return { calls, context, asked, confirm };
}

test('taking on proposed work asks the person to confirm the Work Item, its Team and what it may spend, then approves through the browser route', async () => {
  const { calls, context, asked, confirm } = setup([proposedDetail()]);
  const result = await takeOn('50', context, confirm(true));
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, 'Approve this Work Item?');
  assert.equal(asked[0].accept, takeOnAccept);
  assert.match(asked[0].message, /Approve Work Item 50, "unfold: explain the budget"\? Ploeg queues it for Team bronze, and its Runs spend from Team bronze's budget\./);
  assert.ok(asked[0].message.endsWith(budgetNotReported));
  assert.equal(calls.length, 1);
  assert.deepEqual({ action: calls[0].action, id: calls[0].id, body: calls[0].body }, { action: 'approve', id: '50', body: {} });
  assert.equal(calls[0].via.client, takeOnChannel);
  assert.equal(calls[0].via.confirmation, `vscode-n0nce:${createHash('sha256').update(asked[0].message).digest('hex')}`);
  assert.equal(result.done, true);
  assert.match(result.text, /^Approved Work Item 50; it is /);
});

test('nothing is approved when the person declines, the plan changed, the work is not proposed or nobody is signed in', async () => {
  const declined = setup([proposedDetail()]);
  assert.match((await takeOn('50', declined.context, declined.confirm(false))).text, /^Not taken on: Work Item 50 stays proposed\. Nothing was changed\.$/);
  assert.equal(declined.calls.length, 0);

  const changed = setup([proposedDetail(), proposedDetail({ team: 'gold' })]);
  const moved = await takeOn('50', changed.context, changed.confirm(true));
  assert.equal(moved.done, false);
  assert.match(moved.text, /changed since you confirmed/);
  assert.equal(changed.calls.length, 0);

  const queued = setup([proposedDetail({ state: 'queued' })]);
  assert.match((await takeOn('50', queued.context, queued.confirm(true))).text, /not proposed, so there is nothing to approve/);
  assert.equal(queued.asked.length, 0, 'nothing to confirm');
  assert.equal(queued.calls.length, 0);

  const approvedMeanwhile = setup([proposedDetail(), proposedDetail({ state: 'queued' })]);
  assert.match((await takeOn('50', approvedMeanwhile.context, approvedMeanwhile.confirm(true))).text, /not proposed/);
  assert.equal(approvedMeanwhile.calls.length, 0);

  const signedOut = setup([proposedDetail()], { signedIn: false });
  assert.match((await takeOn('50', signedOut.context, signedOut.confirm(true))).text, /not signed in/);
  assert.equal(signedOut.asked.length, 0);
});

test('a refusal from Unfold is told in its words, and a demo take-on says nothing is spent instead of naming a budget', async () => {
  const refused = setup([proposedDetail()], { fail: new ApiError(403, 'forbidden', 'Viewers cannot approve work.') });
  const result = await takeOn('50', refused.context, refused.confirm(true));
  assert.equal(result.done, false);
  assert.match(result.text, /^Unfold refused: Viewers cannot approve work\. Nothing was changed\.$/);

  const demo = setup([proposedDetail({}, true)]);
  await takeOn('50', demo.context, demo.confirm(true));
  assert.match(demo.asked[0].message, /^This is the illustrative demo: nothing real changes and nothing is spent\./);
  assert.ok(!demo.asked[0].message.includes(budgetNotReported));
  assert.equal(takeOnMessage(demo.asked[0].message), demo.asked[0].message);
});

test('a session that takes no input says Unfold runs no model and forwards nothing', () => {
  assert.match(noInputReply, /runs no model/);
  assert.match(noInputReply, /forwards nothing/);
});

test('the Sessions list module never calls a language model and registers only through the proposal guard', () => {
  const source = readFileSync(new URL('../src/sessions-list.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /vscode\.lm\b/);
  assert.match(source, /deps\.proposals\.use\('chatSessionsProvider', \(\) => list\.start\(\)\)/);
  assert.doesNotMatch(readFileSync(new URL('../src/work-sessions.ts', import.meta.url), 'utf8'), /vscode\.lm\b/);
});
