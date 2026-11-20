import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCore } from '../src/core.ts';
import { ApiError } from '../src/client.ts';
import { artifactActions, artifactDetails, artifactState, artifactView, noAutomation, offeredActions, prepareArtifactAction, pullRequestKey, registerChatArtifacts, resolveArtifact, runArtifactAction, workItemForPullRequest, workItemFromLink, type ArtifactHost, type ArtifactReader } from '../src/chat-artifacts.ts';
import { actionChannel, type ActionContext } from '../src/lm-tools.ts';
import type { PloegDetail, PloegNow, PloegNowItem } from '../src/ploeg-types.ts';
import { ProposalGuard, insidersProposals } from '../src/proposals.ts';

const core = await loadCore(new URL('../media/core/', import.meta.url));
const origin = 'https://unfold.example';
const at = new Date(Date.now() - 3_600_000).toISOString();
const shift = { id: '9', branch: 'agent/vik-1694', round: 2, budgetUsd: 5, spentUsd: 1.25, reservedUsd: 0.5, openedAt: at, closedAt: null, closeReason: '' };
const detail = (extra: Partial<PloegDetail['item']> = {}, more: Partial<PloegDetail> = {}): PloegDetail => ({
  item: { id: '42', title: 'unfold: show one\nprovisional total', provider: 'vikunja', externalId: '1694', team: 'bronze', state: 'awaiting_review', description: '', attempts: 1, target: { owner: 'acme', repo: 'unfold' }, url: 'https://vikunja.example/tasks/1694', priority: 4, infraFailures: 0, createdAt: at, updatedAt: at, latestShift: shift, ...extra },
  shifts: [shift, { ...shift, id: '8', round: 1, spentUsd: 0.75, reservedUsd: 0, closedAt: at, closeReason: 'review_requested_changes' }],
  runs: [], checkpoints: [{ phase: 'pr_opened', branch: 'agent/vik-1694', prUrl: 'https://github.com/acme/unfold/pull/784', createdAt: at }], events: [], ...more,
});
const nowItem = (id: string, pullRequestUrl: string): PloegNowItem => ({ id, team: 'bronze', state: 'awaiting_review', title: 't', url: '', createdAt: at, updatedAt: at, provider: 'vikunja', externalId: id, priority: 1, attempts: 1, infraFailures: 0, target: null, closeReason: null, latestShift: null, spentUsd: 0, pullRequestUrl });
const now: PloegNow = { demo: false, teams: ['bronze'], waiting: [nowItem('42', 'https://github.com/Acme/Unfold/pull/784')], active: [nowItem('51', 'https://forgejo.example/acme/site/pulls/12')], running: [], recent: [], runningTruncated: false, recentTruncated: false, errors: {}, fetchedAt: at };
const icon = (id: string) => ({ id }) as never;

test('a Work Item link of the connected workbench matches in every form the workbench writes', () => {
  assert.equal(workItemFromLink(`${origin}/#work/42`, origin), '42');
  assert.equal(workItemFromLink(`${origin}/#work/42?lane=awaiting_review&team=bronze`, origin), '42');
  assert.equal(workItemFromLink(`${origin}/#work/42?run=7`, origin), '42');
  assert.equal(workItemFromLink(`${origin}#work/42`, origin), '42');
  assert.equal(workItemFromLink(`${origin}/#/work/42`, origin), '42');
  assert.equal(workItemFromLink(`${origin}/#ploeg/42`, origin), '42', 'an old Ploeg link redirects to the Work Item');
  assert.equal(workItemFromLink('https://UNFOLD.example/#work/42', origin), '42', 'the host is compared without case');
});

test('a link on any other origin, or not a Work Item page, never matches', () => {
  for (const link of [
    'https://evil.example/#work/42', 'https://unfold.example.evil.example/#work/42', 'http://unfold.example/#work/42', 'https://unfold.example:8443/#work/42',
    'https://user:pass@unfold.example/#work/42', `${origin}/other/#work/42`, `${origin}/?x=1#work/42`, `${origin}/#work`, `${origin}/#work/0`, `${origin}/#work/42/extra`,
    `${origin}/#session/42`, `${origin}/#work/abc`, 'vscode://unfold-hq.unfold-workbench/work-item?id=42', 'not a link',
  ]) assert.equal(workItemFromLink(link, origin), undefined, link);
});

test('a pull request link is compared by forge, repository and number, without query, fragment, sub-page or case', () => {
  assert.equal(pullRequestKey('https://github.com/Acme/Unfold/pull/784/files?w=1#diff'), 'https://github.com/acme/unfold/pull/784');
  assert.equal(pullRequestKey('https://gitlab.example/acme/site/-/merge_requests/5/'), 'https://gitlab.example/acme/site/-/merge_requests/5');
  assert.equal(pullRequestKey('https://forgejo.example/acme/site/pulls/12'), 'https://forgejo.example/acme/site/pulls/12');
  for (const link of ['https://github.com/acme/unfold/issues/784', 'https://github.com/acme/unfold/pull/', 'ftp://github.com/acme/unfold/pull/1', 'https://u:p@github.com/acme/unfold/pull/1', undefined]) assert.equal(pullRequestKey(link), undefined, String(link));
  assert.equal(workItemForPullRequest('https://github.com/acme/unfold/pull/784/files', now), '42');
  assert.equal(workItemForPullRequest('https://forgejo.example/acme/site/pulls/12', now), '51');
  assert.equal(workItemForPullRequest('https://github.com/acme/unfold/pull/785', now), undefined, 'a pull request of none of the person’s Work Items does not match');
  assert.equal(workItemForPullRequest('https://github.com/acme/unfold/pull/784', undefined), undefined);
});

test('resolving a link sends only requests to the connected workbench, and no other site’s link at all', async () => {
  const requests: string[] = [];
  const reader: ArtifactReader = { origin, async ploegNow() { requests.push('now'); return now; }, async workItem(id) { requests.push(`work ${id}`); return detail(); }, async workItemAction() { throw new Error('never'); } };
  assert.deepEqual(await resolveArtifact(`${origin}/#work/42`, reader), { kind: 'work', id: '42', key: `unfold:${origin}:work:42` });
  assert.deepEqual(requests, [], 'a Work Item link needs no request to match');
  assert.equal(await resolveArtifact('https://evil.example/#work/42', reader), undefined);
  assert.equal(await resolveArtifact('https://example.com/blog/post', reader), undefined);
  assert.deepEqual(requests, [], 'a link that is no pull request is not even looked up');
  assert.deepEqual(await resolveArtifact('https://github.com/acme/unfold/pull/784', reader), { kind: 'pull', id: '42', key: `unfold:${origin}:pull:https://github.com/acme/unfold/pull/784` });
  assert.deepEqual(requests, ['now'], 'a pull request link is compared with what the workbench already lists, never sent to it');
  const source = readFileSync(new URL('../src/chat-artifacts.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(/, 'the module makes no request of its own');
});

test('a Work Item maps to a pill with its state, what it spent and what it waits on, and only the actions its state allows', () => {
  const review = artifactView(core, detail(), origin);
  assert.equal(review.pillLabel, 'Work Item 42');
  assert.equal(review.label, 'Work Item 42: unfold: show one provisional total');
  assert.equal(review.stateLabel, 'Ready for review');
  assert.equal(review.spent, `${core.money(2)} spent, Round 2 may spend up to ${core.money(5)}`);
  assert.equal(review.waitsOn, 'Review the pull request');
  assert.equal(review.description, `Ready for review · ${review.spent} · Waits on: Review the pull request`);
  assert.equal(review.pullRequest, 'https://github.com/acme/unfold/pull/784');
  assert.equal(review.page, `${origin}/#work/42`);
  assert.deepEqual(review.actions, []);
  const state = artifactState(review, icon);
  assert.deepEqual(state.main, { label: review.label, pillLabel: 'Work Item 42', icon: { id: 'git-pull-request' }, description: review.description, detailsId: 'main' });
  assert.deepEqual(state.stateActions, []);
  const details = artifactDetails(review, url => ({ url }) as never, icon);
  assert.deepEqual(details.facts?.map(fact => [fact.label, fact.value]), [['State', 'Ready for review'], ['Waits on', 'Review the pull request'], ['Spent', review.spent], ['Team', 'bronze']]);
  assert.deepEqual(details.items?.map(item => item.resource), [{ url: `${origin}/#work/42` }, { url: 'https://github.com/acme/unfold/pull/784' }]);

  assert.deepEqual(offeredActions(detail({ state: 'proposed' })), ['approve']);
  assert.deepEqual(offeredActions(detail({ state: 'stale' })), ['retry']);
  assert.deepEqual(offeredActions(detail({ state: 'needs_human' })), ['retry']);
  assert.deepEqual(offeredActions(detail({ state: 'needs_human' }, { takeOver: { state: 'taken_over' } } as Partial<PloegDetail>)), ['retry', 'handBack']);
  for (const state of ['queued', 'leased', 'done', 'withdrawn']) assert.deepEqual(offeredActions(detail({ state })), [], state);
  assert.deepEqual(artifactState(artifactView(core, detail({ state: 'proposed' }), origin), icon).stateActions, [{ id: 'approve', enabled: true }]);
  assert.deepEqual(artifactActions.map(action => [action.id, action.label, action.tool]), [['approve', 'Approve', 'unfold_approve_work'], ['retry', 'Try again', 'unfold_retry_work'], ['handBack', 'Hand back', 'unfold_hand_back']]);
});

test('spend says when nothing was spent, and a demo says it is one and shows no spend', () => {
  assert.equal(artifactView(core, detail({ state: 'proposed', latestShift: null }, { shifts: [] }), origin).spent, 'Nothing spent yet: no Shift opened');
  const demo = artifactView(core, detail({}, { demo: true }), origin);
  assert.equal(demo.spent, 'Illustrative demo: no model calls and nothing spent');
  assert.equal(artifactView(core, detail({}, { shifts: [{ ...shift, closedAt: at }] }), origin).spent, `${core.money(1.25)} spent over 1 Shift`);
});

type Acted = { id: string; action: string; body: Record<string, unknown>; via: { client: string; confirmation: string } };
function acting(current: PloegDetail, refuse?: unknown): ActionContext & { acted: Acted[] } {
  const acted: Acted[] = [];
  return { acted, core, signedIn: async () => true, nonce: () => 'n1', actor: { origin, async workItem() { return current; }, async workItemAction(id, action, body, via) { if (refuse) throw refuse; acted.push({ id, action, body, via }); return { state: 'queued' }; } } };
}
const [approve, retry, handBack] = artifactActions as [typeof artifactActions[0], typeof artifactActions[0], typeof artifactActions[0]];

test('an action shows the person the Work Item, the effect and what it may spend, and changes nothing until they confirm', async () => {
  const context = acting(detail({ state: 'proposed' }));
  const asked: string[][] = [];
  const declined = await runArtifactAction(approve, '42', 'manual', context, async (...shown) => { asked.push(shown); return false; });
  assert.deepEqual(declined, { kind: 'skipped', reason: 'You did not confirm, so nothing was changed.' });
  assert.deepEqual(context.acted, []);
  assert.equal(asked[0]![0], 'Approve this Work Item?');
  assert.match(asked[0]![1]!, /^Approve Work Item 42, "unfold: show one provisional total"\? Ploeg queues it for Team bronze, and its Runs spend from Team bronze's budget\.$/);
  assert.equal(asked[0]![2], 'Approve');
  const done = await runArtifactAction(approve, '42', 'manual', context, async () => true);
  assert.equal(done.kind, 'completed');
  assert.deepEqual(context.acted.map(entry => [entry.id, entry.action, entry.via.client]), [['42', 'approve', actionChannel]]);
  assert.match(context.acted[0]!.via.confirmation, /^vscode-n1:[0-9a-f]{64}$/, 'the same confirmation hash the language model tools send');
});

test('Try again and Hand back call the same routes as the language model tools, with the cost in the confirmation', async () => {
  const stuck = acting(detail({ state: 'needs_human' }));
  let shown = '';
  await runArtifactAction(retry, '42', 'manual', stuck, async (_title, message) => { shown = message; return true; });
  assert.ok(shown.includes(`up to ${core.money(5)} like the last attempt`), shown);
  assert.equal(stuck.acted[0]!.action, 'requeue');
  const held = acting(detail({ state: 'needs_human' }, { takeOver: { state: 'taken_over', branch: 'agent/vik-1694' } } as Partial<PloegDetail>));
  await runArtifactAction(handBack, '42', 'manual', held, async (title) => { shown = title; return true; });
  assert.equal(shown, 'Hand this Work Item back to Ploeg?');
  assert.equal(held.acted[0]!.action, 'hand-back');
});

test('an action that no longer applies, an automation, or a refusal changes nothing, and an unknown outcome fails', async () => {
  const review = acting(detail());
  let asked = false;
  const stale = await runArtifactAction(approve, '42', 'manual', review, async () => { asked = true; return true; });
  assert.equal(stale.kind, 'skipped');
  assert.equal(asked, false, 'nobody is asked to confirm what cannot happen');
  assert.deepEqual(await prepareArtifactAction(approve, '42', 'manual', review), { kind: 'skipped', reason: 'Work Item 42 is Ready for review, not proposed, so there is nothing to approve. Nothing was changed.' });
  assert.deepEqual(await prepareArtifactAction(approve, '42', 'manual', acting(detail({ state: 'proposed' }))), { kind: 'ready' });
  const proposedWork = acting(detail({ state: 'proposed' }));
  assert.deepEqual(await prepareArtifactAction(approve, '42', 'automation', proposedWork), { kind: 'skipped', reason: noAutomation });
  assert.deepEqual(await runArtifactAction(approve, '42', 'automation', proposedWork, async () => true), { kind: 'skipped', reason: noAutomation });
  assert.deepEqual(proposedWork.acted, []);
  const refused = await runArtifactAction(approve, '42', 'manual', acting(detail({ state: 'proposed' }), new ApiError(409, 'conflict', 'It changed.')), async () => true);
  assert.deepEqual(refused, { kind: 'skipped', reason: 'Unfold refused: It changed. Nothing was changed.' });
  await assert.rejects(runArtifactAction(approve, '42', 'manual', acting(detail({ state: 'proposed' }), new Error('socket hang up')), async () => true), /could not confirm whether Work Item 42 changed/);
});

test('the provider registers only when VS Code grants chatArtifactIntegrations, and offers no automation', () => {
  const registered: { id: string; provider: { automationOptions?: unknown } }[] = [];
  class Emitter { event = () => ({ dispose() {} }); fire() {} dispose() {} }
  const host = { EventEmitter: Emitter, ThemeIcon: class { id: string; constructor(id: string) { this.id = id; } }, Uri: {}, commands: {}, window: {}, workspace: { onDidChangeConfiguration: () => ({ dispose() {} }) }, chat: { registerArtifactIntegrationProvider: (id: string, provider: never) => { registered.push({ id, provider }); return { dispose() {} }; } } } as unknown as ArtifactHost;
  const deps = { core, reader: () => undefined, configurationError: () => undefined, signedIn: async () => true, secrets: { onDidChange: () => ({ dispose() {} }) } } as never;
  assert.deepEqual(registerChatArtifacts(host, new ProposalGuard({}, {}), deps), [], 'the regular extension registers nothing');
  const all = { enabledApiProposals: [...insidersProposals] };
  assert.deepEqual(registerChatArtifacts(host, new ProposalGuard(all, { enabledApiProposals: [] }), deps), [], 'not granted, nothing is registered');
  assert.equal(registered.length, 0);
  const refusing = { ...host, chat: { registerArtifactIntegrationProvider: () => { throw new Error("Extension 'x' CANNOT use API proposal: chatArtifactIntegrations."); } } } as unknown as ArtifactHost;
  const guard = new ProposalGuard(all, all);
  assert.deepEqual(registerChatArtifacts(refusing, guard, deps), []);
  assert.equal(guard.usable('chatArtifactIntegrations'), false, 'a refusal turns the part off');
  assert.equal(registerChatArtifacts(host, new ProposalGuard(all, all), deps).length, 4);
  assert.equal(registered[0]!.id, 'unfold.workItems');
  assert.equal(registered[0]!.provider.automationOptions, undefined);
});
