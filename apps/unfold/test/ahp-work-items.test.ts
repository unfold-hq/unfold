import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PloegClient, cancelShiftChanged, detail as parseDetail, noteFailures, nowItem, type PloegItem } from '../src/ploeg.ts';
import { listReason, waitingGroup } from '../public/core/reasons.js';
import { money } from '../public/core/format.js';
import { agentHostAuthority } from '../public/core/agents-window.js';
import { briefText, isPullRequestBannerPrompt, noAgentMessages, noRunMessages, ploegRunToolName, roundDiagram, sessionArtifactsMetaKey, workItemActivity, workItemArtifacts, workItemBannerReply, workItemChatState, workItemMessageRefusal, workItemRefusals, workItemRunChatState, workItemSessionId, workItemTranscriptActions } from '../src/ahp/work-items.ts';
import { workItemCommandText } from '../src/ahp/work-item-commands.ts';
import { messageLimits, unsentAttachmentsNotice } from '../src/ahp/attachments.ts';
import { liveRunNotice, podLogsToolName } from '../src/ahp/run-live.ts';
import { runChatChannel } from '../src/ahp/runs.ts';
import { condenseTraceback } from '../src/ahp/tracebacks.ts';
import { readOnlyTerminal } from '../src/ahp/terminals.ts';
import { login, request } from './api-support.ts';
import { action, chatAsSeen, closed, connect, defaultChatOf, vscode1147ChatModel, vscode1147Truncation, vscodeChangesetCatalogue, vscodeChangesets, type Json } from './ahp-support.ts';
import { commanding, fixture, minutesAgo, password, picked, runTemplate, workItem, world, type Shape, type World } from './ahp-work-items-support.ts';
import { testTimeout } from './timeframes.ts';

const settled = (...clients: Array<{ rpc(method: string, params: Json): Promise<Json> }>) => Promise.all(clients.map(client => client.rpc('ping', {})));
const workItemsOf = (items: Json[]) => items.filter(item => /^unfold:\/wi-/.test(item.resource));

test('every Ploeg state maps to the Agents window status and activity of ADR 0023', () => {
  const item = (id: string) => world().details.get(id)!.item as PloegItem;
  const runs = world().details.get('202')!.runs;
  const cases: Array<[string, string, string, unknown?]> = [
    ['201', 'idle', 'Queued for delivery'],
    ['202', 'inProgress', `Implementer · Round 1 · ${money(0.5)}/${money(3)}`, runs],
    ['203', 'inputNeeded', 'Waiting for approval'],
    ['204', 'inputNeeded', 'Agent is stuck'],
    ['205', 'inputNeeded', 'Ready for review · PR #42'],
    ['206', 'error', ''],
    ['207', 'idle', 'Merged'],
    ['208', 'idle', 'An operator cancelled it'],
  ];
  for (const [id, status, activity, extra] of cases) {
    const mapped = workItemActivity(item(id), (extra as PloegItem[] | undefined) as never);
    assert.equal(mapped.status, status, `Work Item ${id} (${item(id).state})`);
    if (activity) assert.equal(mapped.activity, activity, `Work Item ${id}`);
  }
  assert.ok(workItemActivity(item('204')).reason?.chip, 'a needs-human stop carries its reason chip');
  assert.ok(workItemActivity(item('206')).reason, 'a stale item carries why');
  assert.equal(workItemActivity({ ...item('201'), state: 'ingested' }).activity, 'Queued for delivery');
  assert.equal(workItemActivity({ ...item('205'), pullRequest: undefined }).activity, 'Ready for review', 'no PR number Ploeg did not report');
  assert.equal(workItemActivity({ ...item('207'), pullRequest: undefined }).activity, 'Done', 'done without a pull request is not called merged');
});

test('a Work Item handed off from any channel joins the list on the next poll, attributed to whoever handed it off, and its chat opens with that brief', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const op = await f.attach('op-1');
  const admin = await f.attach('admin');
  await f.listed(op); await f.listed(admin);
  await f.host.workItems.tick();
  const admitted = workItem('212', { state: 'queued', updated: minutesAgo(0) });
  admitted.item = { ...admitted.item, provider: 'manual', externalId: '', url: '', title: 'Show the delivery window on the order summary' };
  f.state.details.set('212', admitted);
  f.state.events.push({ id: '1004', at: minutesAgo(0), actor: 'operator:unfold:op-1', action: 'operator.work_item.admitted', workItemId: '212', team: 'delivery', detail: {} });
  await f.host.workItems.tick();
  const added = await op.until(message => message.method === 'root/sessionAdded' && message.params.summary.resource === 'unfold:/wi-212');
  assert.equal(added.params.summary.title, '#212 Show the delivery window on the order summary');
  assert.equal(added.params.summary.activity, 'Queued for delivery · handed off by you', 'the person who handed it off reads "you"');
  const seenByAdmin = await admin.until(message => message.method === 'root/sessionAdded' && message.params.summary.resource === 'unfold:/wi-212');
  assert.equal(seenByAdmin.params.summary.activity, 'Queued for delivery · handed off by op-1', 'anyone else reads their name');

  const chat = (await op.rpc('subscribe', { channel: defaultChatOf('unfold:/wi-212') })).snapshot.state;
  assert.equal(chat.activeTurn, undefined);
  assert.deepEqual(chat.turns.map((turn: Json) => [turn.id, turn.message.text, turn.state]), [['wi-212-brief', 'Show the delivery window on the order summary', 'complete']], 'a queued Work Item\'s chat is not empty');
  assert.equal(chat.turns[0].responseParts.at(-1).content, 'Handed off by you. Team delivery runs it.');
  assert.equal(briefText(f.state.details.get('201')!.item as PloegItem), 'From Demo fixture task T-201. Team delivery runs it.', 'tracker work names its task');
  assert.equal(briefText({ ...(f.state.details.get('201')!.item as PloegItem), provider: 'ploeg', sourceWorkItemId: '205' }), 'Proposed by an agent while it worked on #205. Team delivery runs it.');

  f.state.details.set('212', { ...workItem('212', { state: 'leased', updated: minutesAgo(0), runs: [{ id: '312', role: 'implementer', round: 1, state: 'running' }] }), item: { ...admitted.item, state: 'leased', updatedAt: new Date().toISOString(), latestShift: workItem('212', { state: 'leased' }).item.latestShift } });
  f.state.events.push({ id: '1005', at: minutesAgo(0), actor: 'ploegd:dispatch', action: 'lease.granted', workItemId: '212', team: 'delivery', detail: {} });
  await f.host.workItems.tick();
  const running = await op.until(message => message.method === 'root/sessionSummaryChanged' && message.params.session === 'unfold:/wi-212');
  assert.equal(running.params.changes.activity, `Implementer · Round 1 · ${money(0)}/${money(3)}`, 'once it runs, the line shows who works and the spend so far');
  const round = await op.until(message => action(message, defaultChatOf('unfold:/wi-212'), 'chat/turnStarted'));
  assert.equal(round.params.action.message.text, 'Round 1', 'the Round follows the brief live');
});

test('a viewer lists the open and recently finished Work Items of their teams, open first, beside their Unfold sessions', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const op = await f.attach('op-1');
  const items = await f.listed(op);
  assert.ok(items.some(item => item.title === 'An Unfold session'), 'Unfold sessions still list');
  const work = workItemsOf(items);
  assert.deepEqual(work.map(item => item.resource), ['unfold:/wi-202', 'unfold:/wi-205', 'unfold:/wi-206', 'unfold:/wi-204', 'unfold:/wi-203', 'unfold:/wi-201', 'unfold:/wi-207', 'unfold:/wi-208'],
    'open by last change, then finished in the last 14 days; no research item, no operator-owned item, nothing finished 20 days ago');
  const byId = new Map(work.map(item => [item.resource.slice('unfold:/'.length), item]));
  assert.equal(byId.get('wi-205')!.title, '#205 Work Item 205');
  assert.equal(byId.get('wi-205')!.provider, 'unfold');
  assert.equal(byId.get('wi-205')!.status & 24, 24, 'awaiting review needs the person');
  assert.equal(byId.get('wi-205')!.activity, 'Ready for review · PR #42');
  assert.equal(byId.get('wi-202')!.status & 8, 8);
  assert.equal(byId.get('wi-206')!.status & 2, 2);
  assert.equal(byId.get('wi-201')!.status & 1, 1);
  assert.deepEqual(byId.get('wi-205')!._meta['unfold.workItem'].pullRequest, { url: 'https://forge.invalid/pulls/42', number: 42 });
  assert.equal(byId.get('wi-205')!._meta['unfold.workItem'].readOnly, true);

  const admin = await f.attach('admin');
  assert.ok(workItemsOf(await f.listed(admin)).some(item => item.resource === 'unfold:/wi-209'), 'an administrator sees every team');
  const viewer = await f.attach('viewer-1');
  assert.deepEqual(workItemsOf(await f.listed(viewer)), [], 'a viewer without a Ploeg team sees no Work Item');
  await assert.rejects(op.rpc('subscribe', { channel: 'unfold:/wi-209' }), (error: Json) => error.code === -32001, 'another team\'s Work Item is not found');
  await assert.rejects(viewer.rpc('subscribe', { channel: 'unfold:/wi-205' }), (error: Json) => error.code === -32001);
  await assert.rejects(op.rpc('subscribe', { channel: 'unfold:/wi-210' }), (error: Json) => error.code === -32001, 'an operator-owned Work Item is its Unfold session');
});

test('a Work Item session names its pull request and tracker issue under VS Code\'s session artifacts key, with GitHub only for github.com, and offers no merge', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const onGitHub = f.state.details.get('205')!.item;
  Object.assign(onGitHub, { provider: 'github', externalId: 'acme/order-service#7', url: 'https://github.com/acme/order-service/issues/7', pullRequest: { ...onGitHub.pullRequest, url: 'https://github.com/acme/order-service/pull/42' } });
  Object.assign(f.state.details.get('207')!.item, { url: 'https://tracker.invalid/tasks/T-207' });
  const op = await f.attach('op-1');
  const work = new Map(workItemsOf(await f.listed(op)).map(item => [item.resource, item]));
  assert.deepEqual(work.get('unfold:/wi-205')!._meta[sessionArtifactsMetaKey], [
    { id: 'wi-205-issue', type: 'issue', label: 'GitHub task acme/order-service#7', isArtifact: false, link: 'https://github.com/acme/order-service/issues/7', isGitHub: true },
    { id: 'wi-205-pull-request', type: 'pullRequest', label: 'Pull request #42', isArtifact: true, link: 'https://github.com/acme/order-service/pull/42', isGitHub: true },
  ], 'a github.com pull request and issue, which VS Code polls CI for with the person\'s own sign-in');
  assert.deepEqual(work.get('unfold:/wi-207')!._meta[sessionArtifactsMetaKey].map((artifact: Json) => [artifact.type, artifact.link, artifact.isGitHub]), [['issue', 'https://tracker.invalid/tasks/T-207', false], ['pullRequest', 'https://forge.invalid/pulls/41', false]], 'another forge\'s pull request is a plain link, without CI');
  assert.equal(work.get('unfold:/wi-201')!._meta[sessionArtifactsMetaKey], undefined, 'no pull request and no tracker link, no artifacts');
  assert.deepEqual(work.get('unfold:/wi-205')!._meta['unfold.workItem'].pullRequest, { url: 'https://github.com/acme/order-service/pull/42', number: 42 }, 'Unfold\'s own key stays for other clients');
  assert.deepEqual(workItemArtifacts({ ...(onGitHub as PloegItem), provider: 'manual', url: 'https://github.com/acme/order-service/issues/7', pullRequest: undefined }), [], 'a hand-off names no tracker issue');
  assert.deepEqual(workItemArtifacts({ ...(onGitHub as PloegItem), pullRequest: { ...(onGitHub as PloegItem).pullRequest!, url: 'javascript:alert(1)' } }).map(artifact => artifact.type), ['issue'], 'only a web link becomes an artifact');

  const session = (await op.rpc('subscribe', { channel: 'unfold:/wi-205' })).snapshot.state;
  const chat = (await op.rpc('subscribe', { channel: defaultChatOf('unfold:/wi-205') })).snapshot.state;
  assert.equal(session._meta[sessionArtifactsMetaKey].length, 2, 'the subscribed session carries the same artifacts');
  assert.deepEqual([session.changesets, chat.changesets], [[], []], 'no changeset, so no pull-request operation and no Merge in VS Code\'s Inbox');
  assert.equal(work.get('unfold:/wi-205')!.changesets, undefined);

  Object.assign(f.state.details.get('201')!.item, { state: 'awaiting_review', updatedAt: new Date().toISOString(), pullRequest: { url: 'https://github.com/acme/order-service/pull/44', number: 44, mergeState: 'clean', baseBranch: 'main', headSha: 'fed', checkedAt: minutesAgo(0) } });
  f.state.events.push({ id: '1004', at: minutesAgo(0), actor: 'ploegd:writer', action: 'work_item.awaiting_review', workItemId: '201', team: 'delivery', detail: {} });
  await f.host.workItems.tick();
  const opened = await op.until(message => message.method === 'root/sessionSummaryChanged' && message.params.session === 'unfold:/wi-201');
  assert.equal(opened.params.changes._meta[sessionArtifactsMetaKey].at(-1).link, 'https://github.com/acme/order-service/pull/44', 'a pull request that opens later reaches the list without a new listing');
});

test('a Work Item\'s session takes no review comments, so it names no annotations channel', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const op = await f.attach('op-1');
  const items = await f.listed(op);
  const work = workItemsOf(items);
  assert.ok(work.length > 0);
  assert.ok(work.every(item => item.annotations === undefined), 'no Work Item names a channel');
  const listedUnfoldSession = items.find(item => item.title === 'An Unfold session')!;
  assert.equal(listedUnfoldSession.annotations.annotationCount, 0, 'an Unfold session beside them does');
  assert.equal((await op.rpc('subscribe', { channel: 'unfold:/wi-205' })).snapshot.state.annotations, undefined, 'nor in its state');
});

test('a Work Item\'s chat is one turn per Round with each Run a ploeg_run subagent, and no message Ploeg did not record', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const op = await f.attach('op-1');
  const session = (await op.rpc('subscribe', { channel: 'unfold:/wi-205' })).snapshot.state;
  assert.equal(session.defaultChat, defaultChatOf('unfold:/wi-205'));
  assert.deepEqual(session.inputNeeded, []);
  assert.deepEqual(session.changesets, []);
  assert.equal(session.chats.length, 3, 'the default chat and one read-only chat per Run');
  const chat = (await op.rpc('subscribe', { channel: session.defaultChat })).snapshot.state;
  assert.equal(chat.activeTurn, undefined);
  assert.deepEqual(chat.turns.map((turn: Json) => turn.message.text), ['Work Item 205', 'Round 1', 'Round 2'], 'the brief comes first, then one turn per Round');
  assert.ok(chat.turns.every((turn: Json) => turn.message.origin.kind === 'systemNotification' && turn.state === 'complete'));
  assert.deepEqual(chat.turns[0].responseParts.at(-1), { kind: 'markdown', id: 'wi-205-brief-origin', content: briefText(f.state.details.get('205')!.item as PloegItem) });
  const parts = chat.turns.slice(1).flatMap((turn: Json) => turn.responseParts);
  assert.deepEqual(parts.filter((part: Json) => part.kind === 'toolCall').map((part: Json) => [part.toolCall.toolName, part.toolCall.displayName, part.toolCall.status, part.toolCall._meta.toolKind]), [[ploegRunToolName, 'Implementer', 'completed', 'subagent'], [ploegRunToolName, 'Reviewer', 'completed', 'subagent']]);
  assert.deepEqual(parts.filter((part: Json) => part.kind === 'markdown').map((part: Json) => part.content), [
    '**Implementer opened the [pull request #42](https://forge.invalid/pulls/42).** Rounded half up in the order totals. Open Implementer above for the full report.',
    '```mermaid\nflowchart LR\n  r1["Implementer#58; finished #40;pr opened#41;"]\n```',
    '**Reviewer approved.** The change is correct. Open Reviewer above for the full report.',
    '```mermaid\nflowchart LR\n  r1["Reviewer#58; approved"]\n```',
  ], 'each finished Run gets one line of what Ploeg recorded for it, and no agent message is invented');
  assert.deepEqual(parts.filter((part: Json) => part.kind === 'systemNotification').map((part: Json) => part.content), [noAgentMessages]);
  const reviewer = parts.find((part: Json) => part.kind === 'toolCall' && part.toolCall.displayName === 'Reviewer').toolCall;
  assert.equal(reviewer.pastTenseMessage, 'Reviewer approved');
  assert.deepEqual(reviewer.content[1], { type: 'text', text: 'The change is correct.' });
  const runChat = (await op.rpc('subscribe', { channel: reviewer.content[0].resource })).snapshot.state;
  assert.equal(runChat.interactivity, 'read-only');
  assert.equal(runChat.turns[0].responseParts[0].content, noRunMessages);
  assert.match(runChat.turns[0].responseParts[1].content, /The change is correct\./);
});

const chatOf = (detail: Json) => {
  const item = detail.item as PloegItem;
  const entry = { workItemId: item.id, publicId: workItemSessionId(item.id), item, activity: workItemActivity(item, detail.runs), stale: false };
  return workItemChatState(entry, detail as never, { session: `unfold:/wi-${item.id}`, chat: `unfold:/wi-${item.id}/chat` }, { session: 0, chat: 0 });
};
const mermaidBlocks = (parts: Json[]) => parts.filter((part: Json) => part.kind === 'markdown' && part.content.startsWith('```mermaid'));
const labelsOf = (diagram: string) => [...diagram.matchAll(/^ {2}\w+\["([^"\n]*)"\]$/gm)].map(match => match[1].replace(/#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))));

test('a finished Round\'s turn ends with one diagram of its Runs in order, after their Run reports and verdict lines', () => {
  const detail = workItem('220', { state: 'needs_human', closeReason: 'run stuck: reviewer round 1', runs: [{ id: '401', role: 'implementer', round: 1, summary: 'Changed it.' }, { id: '402', role: 'reviewer', round: 1, summary: 'Looks right.' }, { id: '403', role: 'tester', round: 1, outcome: 'stuck' }] });
  const [, turn] = chatOf(detail).turns;
  const diagrams = mermaidBlocks(turn.responseParts);
  assert.equal(diagrams.length, 1, 'one diagram per finished Round');
  assert.equal(turn.responseParts.at(-1), diagrams[0], 'the diagram ends the turn');
  assert.equal(diagrams[0].id, 'wi-220-round-1-1-diagram');
  assert.deepEqual(turn.responseParts.slice(0, -1).map((part: Json) => part.kind), ['systemNotification', 'toolCall', 'markdown', 'toolCall', 'markdown', 'toolCall', 'markdown'], 'every Run report and verdict line stays before it');
  assert.match(diagrams[0].content, /^```mermaid\nflowchart LR\n[\s\S]*\n {2}r1 --> r2 --> r3\n```$/);
  assert.deepEqual(labelsOf(diagrams[0].content), ['Implementer: finished (pr opened)', 'Reviewer: approved', 'Tester: stopped (stuck)']);
});

test('a Round still running shows no diagram, and the Round that ends gets its diagram before it completes', () => {
  const running = workItem('221', { state: 'leased', runs: [{ id: '411', role: 'implementer', round: 1, summary: 'Changed it.' }, { id: '412', role: 'reviewer', round: 1, state: 'running' }] });
  const chat = chatOf(running);
  assert.ok(chat.activeTurn, 'the Round is open');
  assert.deepEqual(mermaidBlocks(chat.activeTurn.responseParts), [], 'a running Round shows no diagram');
  const finished = workItem('221', { state: 'awaiting_review', pullRequest: 9, runs: [{ id: '411', role: 'implementer', round: 1, summary: 'Changed it.' }, { id: '412', role: 'reviewer', round: 1, summary: 'Fine.' }] });
  const actions = workItemTranscriptActions(running as never, finished as never, { session: 'unfold:/wi-221', chat: 'unfold:/wi-221/chat' }).filter(({ to }) => to === 'chat').map(({ action }) => action);
  const diagram = actions.findIndex(action => action.type === 'chat/responsePart' && action.part.id === 'wi-221-round-1-1-diagram');
  assert.ok(diagram >= 0, 'the Round that ends gets its diagram');
  assert.ok(diagram > actions.findIndex(action => action.type === 'chat/toolCallComplete'), 'after the Run that finished it');
  assert.equal(actions[diagram + 1].type, 'chat/turnComplete', 'right before the turn completes');
});

test('a Role name or outcome with Mermaid syntax in it shows as text and cannot break out of the diagram', () => {
  const hostile = ['re"viewer] x["owned"]', 'a[b]{c}(d)<e>`f`|g|;h', 'x\n  click r1 "https://evil.invalid" blank\n%%{init: {"securityLevel": "loose"}}%%\n```'];
  const detail = workItem('222', { state: 'needs_human', closeReason: 'run stuck', runs: hostile.map((role, index) => ({ id: String(421 + index), role, round: 1, outcome: index === 2 ? 'stuck"] --> y["x' : undefined })) });
  const [diagram] = mermaidBlocks(chatOf(detail).turns[1].responseParts);
  const lines = diagram.content.split('\n');
  assert.deepEqual([...lines.slice(0, 2), ...lines.slice(-2)], ['```mermaid', 'flowchart LR', '  r1 --> r2 --> r3', '```'], 'the diagram keeps its own frame and edges');
  assert.equal(lines.length, 7, 'one line per node, whatever the labels hold');
  assert.ok(lines.slice(2, 5).every((line: string) => /^ {2}r\d\["[\p{L}\p{N} #;]*"\]$/u.test(line)), 'each label is one quoted string of letters, digits, spaces and entity codes');
  assert.doesNotMatch(diagram.content, /^\s*click\b|%%|https:|-->\s*y\[|"\]\s*-->/m, 'no directive, link, init block or extra edge reaches the diagram source');
  assert.equal(diagram.content.match(/```/g)?.length, 2, 'the code fence cannot be closed from a label');
  assert.deepEqual(labelsOf(diagram.content), ['Re"viewer] x["owned"]: finished (pr opened)', 'A[b]{c}(d)<e>`f`|g|;h: finished (pr opened)', `X\n  click r1 "https://evil.invalid" blank\n%%{init: {"securityLevel": "loose"}}%%\n\`\`\`: finished (stuck"] --> y["x)`], 'each label still reads as the text Ploeg sent');
});

test('a Round of more than twelve Runs draws the first twelve and a node that counts the rest', () => {
  const runs = Array.from({ length: 15 }, (_, index) => ({ ...structuredClone(runTemplate), id: String(500 + index), role: `role${index + 1}`, state: 'finished', verdict: '', outcome: 'done', failureReason: null })) as never[];
  const diagram = roundDiagram(runs);
  assert.deepEqual(labelsOf(diagram), [...Array.from({ length: 12 }, (_, index) => `Role${index + 1}: finished (done)`), '3 more Runs']);
  assert.match(diagram, /\n {2}r1 --> r2 --> r3 --> r4 --> r5 --> r6 --> r7 --> r8 --> r9 --> r10 --> r11 --> r12 --> more\n```$/);
  assert.equal(labelsOf(roundDiagram(runs.slice(0, 12))).length, 12, 'twelve Runs need no "more" node');
});

test('the fleet poller follows Ploeg\'s events in order from its cursor and tells only the viewers of the Work Item\'s team', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const admin = await f.attach('admin');
  const op = await f.attach('op-1');
  const viewer = await f.attach('viewer-1');
  await f.listed(op); await f.listed(admin); await f.listed(viewer);
  await op.rpc('subscribe', { channel: defaultChatOf('unfold:/wi-202') });
  await f.host.workItems.tick();
  assert.equal(f.host.workItems.eventCursor, '1003', 'seeded at the newest event');

  f.state.details.set('201', workItem('201', { state: 'leased', updated: minutesAgo(0), runs: [{ id: '310', role: 'implementer', round: 1, state: 'running' }] }));
  f.state.details.set('202', workItem('202', { state: 'leased', spent: 1.25, updated: minutesAgo(0), runs: [{ id: '301', role: 'implementer', round: 1 }, { id: '311', role: 'reviewer', round: 2, state: 'running' }] }));
  f.state.details.set('209', workItem('209', { team: 'research', state: 'awaiting_review', pullRequest: 7, updated: minutesAgo(0), runs: [{ id: '305', role: 'analyst', round: 1 }] }));
  f.state.events.push(
    { id: '1004', at: minutesAgo(0), actor: 'ploegd:dispatch', action: 'lease.granted', workItemId: '201', team: 'delivery', detail: {} },
    { id: '1005', at: minutesAgo(0), actor: 'team:delivery', action: 'run.finished', workItemId: '202', team: 'delivery', detail: {} },
    { id: '1006', at: minutesAgo(0), actor: 'team:research', action: 'work_item.awaiting_review', workItemId: '209', team: 'research', detail: {} },
  );
  await f.host.workItems.tick();
  await settled(op, admin, viewer);
  assert.ok(f.state.seen.includes('events?order=asc&limit=200&after=1003'), `follows ascending from the cursor; saw ${f.state.seen.filter(path => path.startsWith('events')).join(', ')}`);
  assert.equal(f.host.workItems.eventCursor, '1006');
  const changes = op.inbox.filter(message => message.method === 'root/sessionSummaryChanged').map(message => message.params.session);
  assert.deepEqual(changes, ['unfold:/wi-201', 'unfold:/wi-202'], 'in the order of their events, and nothing of the research team');
  const leased = op.inbox.find(message => message.method === 'root/sessionSummaryChanged' && message.params.session === 'unfold:/wi-201')!.params.changes;
  assert.equal(leased.status & 8, 8);
  assert.equal(leased.activity, `Implementer · Round 1 · ${money(0)}/${money(3)}`);
  const chat = defaultChatOf('unfold:/wi-202');
  const completed = await op.until(message => action(message, chat, 'chat/toolCallComplete'));
  assert.equal(completed.params.action.toolCallId, 'ploeg-run-301');
  await op.until(message => action(message, chat, 'chat/turnComplete'));
  const started = await op.until(message => action(message, chat, 'chat/turnStarted'));
  assert.equal(started.params.action.message.text, 'Round 2');
  const order = op.inbox.filter(message => message.method === 'action' && message.params.channel === chat).map(message => message.params.action.type);
  assert.ok(order.indexOf('chat/turnComplete') < order.indexOf('chat/turnStarted'), 'Round 1 ends before Round 2 starts');

  assert.ok(admin.inbox.some(message => message.method === 'root/sessionSummaryChanged' && message.params.session === 'unfold:/wi-209'), 'the administrator sees the research item change');
  assert.ok(!viewer.inbox.some(message => /wi-/.test(JSON.stringify(message.params ?? {}))), 'a viewer without a team hears of no Work Item');
  assert.ok(!op.inbox.some(message => /wi-209/.test(JSON.stringify(message.params ?? {}))), 'op-1 never hears of the research item');

  f.state.down = true;
  await f.host.workItems.tick();
  f.state.events.push({ id: '1007', at: minutesAgo(0), actor: 'ploegd:dispatch', action: 'work_item.queued', workItemId: '203', team: 'delivery', detail: {} });
  f.state.details.set('203', workItem('203', { state: 'queued', updated: minutesAgo(0) }));
  f.state.down = false;
  f.state.seen.length = 0;
  await f.host.workItems.tick();
  await settled(op);
  assert.equal(f.state.seen.find(path => path.startsWith('events')), 'events?order=asc&limit=200&after=1006', 'resumes from its cursor after an outage, without seeding again');
  assert.equal(f.host.workItems.eventCursor, '1007');
  assert.ok(op.inbox.some(message => message.method === 'root/sessionSummaryChanged' && message.params.session === 'unfold:/wi-203' && message.params.changes.activity === 'Queued for delivery'));
});

test('a Work Item keeps its modification time while only Ploeg\'s update time moves, so an acknowledged one stays out of the VS Code Inbox, and takes a new one when its state changes', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const op = await f.attach('op-1');
  const first = new Map(workItemsOf(await f.listed(op)).map(item => [item.resource, item.modifiedAt]));
  for (const id of ['201', '202', '205']) assert.equal(first.get(`unfold:/wi-${id}`), f.state.details.get(id)!.item.updatedAt, 'a Work Item listed for the first time shows Ploeg\'s update time');
  await f.host.workItems.tick();

  const reviewed = f.state.details.get('205')!.item.updatedAt;
  f.state.details.get('205')!.item.updatedAt = minutesAgo(0);
  f.state.details.set('202', workItem('202', { state: 'leased', spent: 1.25, round: 2, updated: minutesAgo(0), runs: [{ id: '301', role: 'implementer', round: 1 }, { id: '311', role: 'reviewer', round: 2, state: 'running' }] }));
  f.state.events.push(
    { id: '1004', at: minutesAgo(0), actor: 'ploegd:review', action: 'work_item.checked', workItemId: '205', team: 'delivery', detail: {} },
    { id: '1005', at: minutesAgo(0), actor: 'team:delivery', action: 'run.finished', workItemId: '202', team: 'delivery', detail: {} },
  );
  await f.host.workItems.tick();
  await settled(op);
  const changed = (resource: string, after = 0) => op.inbox.slice(after).filter(message => message.method === 'root/sessionSummaryChanged' && message.params.session === resource && 'modifiedAt' in message.params.changes).at(-1)?.params.changes;
  assert.equal(changed('unfold:/wi-205')?.modifiedAt, reviewed, 'the same state, reason, pull request and question keep the time shown');
  assert.equal(changed('unfold:/wi-202')?.activity, `Reviewer · Round 2 · ${money(1.25)}/${money(3)}`, 'the activity line still follows spend and Round');
  assert.equal(changed('unfold:/wi-202')?.modifiedAt, first.get('unfold:/wi-202'), 'spend and Round alone keep the time shown');
  assert.equal(workItemsOf(await f.listed(op)).find(item => item.resource === 'unfold:/wi-205')!.modifiedAt, reviewed, 'a fresh list keeps it too');

  const mark = op.inbox.length;
  const awaiting = minutesAgo(0);
  f.state.details.set('202', workItem('202', { state: 'awaiting_review', pullRequest: 43, updated: awaiting, runs: [{ id: '301', role: 'implementer', round: 1 }, { id: '311', role: 'reviewer', round: 2 }] }));
  f.state.events.push({ id: '1006', at: awaiting, actor: 'team:delivery', action: 'work_item.awaiting_review', workItemId: '202', team: 'delivery', detail: {} });
  await f.host.workItems.tick();
  await settled(op);
  assert.equal(changed('unfold:/wi-202', mark)?.modifiedAt, awaiting, 'running to ready for review takes Ploeg\'s update time');
});

test('a question to a person keeps its input request id across a reconnect, and a new question gets a new id and a new modification time', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  parkedOnQuestions(f.state);
  const opened = (await f.client.rpc('subscribe', { channel: 'unfold:/wi-204' })).snapshot.state;
  const asked = opened.inputNeeded[0].id;
  await f.host.workItems.tick();

  const again = await f.attach('op-1');
  await f.listed(again);
  const reopened = (await again.rpc('subscribe', { channel: 'unfold:/wi-204' })).snapshot.state;
  assert.equal(reopened.inputNeeded[0].id, asked, 'the same question after a reconnect keeps its id');
  assert.equal(reopened.modifiedAt, opened.modifiedAt);

  const detail = f.state.details.get('204')!;
  const moved = minutesAgo(0);
  detail.item.updatedAt = moved;
  Object.assign(detail.questions[0], { answer: 'Away from zero.', answeredBy: 'op-1', waitingForPerson: false });
  detail.questions.push({ id: 'q302-3', shiftId: '9204', runId: '302', role: 'implementer', round: 1, to: 'person', text: 'Also round the tax lines?', answer: null, answeredBy: null, waitingForPerson: true });
  detail.resume.waitingQuestionIds = ['q302-3'];
  const mark = again.inbox.length;
  f.state.events.push({ id: '1004', at: moved, actor: 'team:delivery', action: 'run.question_asked', workItemId: '204', team: 'delivery', detail: {} });
  await f.host.workItems.tick();
  await settled(again);
  const requested = (await again.until(message => action(message, 'unfold:/wi-204', 'session/inputNeededSet') && again.inbox.indexOf(message) >= mark)).params.action.request;
  assert.notEqual(requested.id, asked, 'a new question gets a new id');
  assert.equal(requested.request.questions[0].message, 'Also round the tax lines?');
  const summary = again.inbox.slice(mark).filter(message => message.method === 'root/sessionSummaryChanged' && message.params.session === 'unfold:/wi-204' && 'modifiedAt' in message.params.changes).at(-1)?.params.changes;
  assert.equal(summary?.modifiedAt, moved, 'a new waiting question takes Ploeg\'s update time');
});

test('a message from VS Code 1.147 after its connection slept through a Round is sent, and the chat keeps every Round', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const watching = await f.attach('op-1');
  await f.listed(watching);
  const operator = { id: 'op-1', name: 'op-1', role: 'operator' as const };
  const url = `${f.server.url.replace(/^http/, 'ws')}/?tkn=${f.host.issueToken(operator)}`;
  const session = 'unfold:/wi-202';
  const chat = defaultChatOf(session);
  const clientId = `vscode-1-147-${randomBytes(3).toString('hex')}`;
  const asleep = connect(url);
  t.after(() => asleep.close());
  await asleep.open;
  await asleep.rpc('initialize', { channel: 'ahp-root://', protocolVersions: ['1.2.0'], clientId, clientInfo: { name: 'vscode-agents-window' }, initialSubscriptions: ['ahp-root://'] });
  await f.listed(asleep);
  await asleep.rpc('subscribe', { channel: session });
  const opened = (await asleep.rpc('subscribe', { channel: chat })).snapshot.state;
  assert.equal(opened.activeTurn?.id, 'wi-202-round-1-1', 'Round 1 runs while the window is open');
  const known = [...opened.turns.map((turn: Json) => turn.id), opened.activeTurn.id];
  asleep.close();
  await closed(asleep.socket);

  const finished = workItem('202', { state: 'needs_human', closeReason: 'run stuck: implementer round 2', spent: 1.5, updated: minutesAgo(0), runs: [{ id: '301', role: 'implementer', round: 1 }, { id: '307', role: 'implementer', round: 2, outcome: 'stuck' }] });
  f.state.details.set('202', finished);
  f.state.events.push({ id: '1004', at: minutesAgo(0), actor: 'team:delivery', action: 'run.finished', workItemId: '202', team: 'delivery', detail: {} });
  await f.host.workItems.tick();
  await settled(watching);

  const awake = connect(url);
  t.after(() => awake.close());
  await awake.open;
  const reconnected = await awake.rpc('reconnect', { channel: 'ahp-root://', clientId, lastSeenServerSeq: 0, subscriptions: ['ahp-root://', session, chat] });
  const snapshot = reconnected.snapshots.find((entry: Json) => entry.resource === chat).state;
  const rounds = snapshot.turns.map((turn: Json) => turn.id);
  assert.equal(snapshot.activeTurn, undefined);
  assert.equal(rounds.length, known.length + 1, 'the snapshot holds the Round the window slept through');
  await settled(awake);
  const seen = vscode1147ChatModel(snapshot, awake.inbox, chat, 0, known);
  let seq = 0;
  const send = (body: Json) => { const clientSeq = ++seq; awake.notify('dispatchAction', { channel: chat, clientSeq, action: body }); return awake.until(message => message.method === 'action' && message.params.origin?.clientId === clientId && message.params.origin?.clientSeq === clientSeq); };
  const truncation = vscode1147Truncation(seen.state, seen.known);
  if (truncation) { const confirmed = await send(truncation); assert.equal(confirmed.params.rejectionReason, undefined, `Chat history could not be restored: ${confirmed.params.rejectionReason}`); }
  const sent = await send({ type: 'chat/turnStarted', turnId: 'note-1', message: { text: 'Use the decimal rounding helper in totals.ts.', origin: { kind: 'user' } } });
  assert.equal(sent.params.rejectionReason, undefined, 'the message is sent');
  await awake.until(message => action(message, chat, 'chat/inputRequested'));
  assert.equal(f.state.writes.length, 0, 'it restarts nothing without a confirmation');
  const kept = (await awake.rpc('subscribe', { channel: chat })).snapshot.state;
  assert.deepEqual([...kept.turns.map((turn: Json) => turn.id), ...(kept.activeTurn ? [kept.activeTurn.id] : [])].filter((id: string) => id !== 'note-1'), rounds, 'every Round is kept');

  const edited = await send({ type: 'chat/truncated', turnId: rounds[1] });
  assert.equal(edited.params.rejectionReason, workItemRefusals.history, 'an edit of an earlier message is refused and says the history is kept');
});

test('Ploeg events page oldest first from an after cursor, scoped to the caller\'s teams',{ timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  f.state.events.push({ id: '1004', at: minutesAgo(0), actor: 'team:research', action: 'run.started', workItemId: '209', team: 'research', detail: {} });
  const ploeg = new PloegClient(f.server.config);
  const page = await ploeg.events({ id: 'op-1', name: 'op-1', role: 'operator' }, { after: '1001' });
  assert.deepEqual(page.events.map(event => event.id), ['1002', '1003'], 'ascending, and the research event is not op-1\'s');
  assert.equal(page.nextCursor, null);
  assert.ok(f.state.seen.includes('events?order=asc&limit=25&after=1001'));
  await assert.rejects(ploeg.events({ id: 'admin', name: 'admin', role: 'admin' }, { after: '1001', before: '1003' }), /valid page cursor/);
  assert.deepEqual((await ploeg.followEvents('1002')).events.map(event => event.id), ['1003', '1004'], 'the fleet follows every team in the consumer\'s scope');
});

test('a Ploeg outage marks Work Item sessions stale while Unfold sessions keep listing', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const op = await f.attach('op-1');
  assert.equal(workItemsOf(await f.listed(op)).length, 8);
  await f.host.workItems.tick();
  f.state.down = true;
  await f.host.workItems.tick();
  await settled(op);
  const stale = op.inbox.filter(message => message.method === 'root/sessionSummaryChanged' && /wi-/.test(message.params.session));
  assert.equal(stale.length, 8, 'each Work Item session is marked');
  assert.ok(stale.every(message => /^Ploeg is unreachable; last known state: /.test(message.params.changes.activity)));
  const items = await f.listed(op);
  assert.ok(items.some(item => item.title === 'An Unfold session'), 'Unfold sessions list');
  assert.equal(workItemsOf(items).length, 8);
  assert.ok(workItemsOf(items).every(item => item._meta['unfold.workItem'].stale === true));
  const subscribed = (await op.rpc('subscribe', { channel: 'ahp-session:/' + f.unfoldSession.id })).snapshot.state;
  assert.equal(subscribed.title, 'An Unfold session', 'an Unfold session still opens');

  f.state.down = false;
  op.inbox.length = 0;
  await f.host.workItems.tick();
  await settled(op);
  const recovered = op.inbox.filter(message => message.method === 'root/sessionSummaryChanged' && /wi-/.test(message.params.session));
  assert.equal(recovered.length, 8, 'recovery reads every list again');
  assert.ok(recovered.every(message => !/unreachable/.test(message.params.changes.activity)));
});

test('every change to a Work Item session is refused with what to do instead, and read and archive stay with the viewer', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const op = await f.attach('op-1');
  const admin = await f.attach('admin');
  await f.listed(op); await f.listed(admin);
  const session = 'unfold:/wi-202';
  const chat = defaultChatOf(session);
  await op.rpc('subscribe', { channel: session });
  await op.rpc('subscribe', { channel: chat });
  f.state.notesRoute = false;
  const dispatch = (channel: string, clientSeq: number, body: Json) => op.notify('dispatchAction', { channel, clientSeq, action: body });
  const answer = (seq: number) => op.until(message => message.method === 'action' && message.params.origin?.clientSeq === seq);
  dispatch(chat, 1, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'Use the other rounding mode', origin: { kind: 'user' } } });
  dispatch(chat, 2, { type: 'chat/pendingMessageSet', kind: 'steering', id: 'p1', message: { text: 'Hurry', origin: { kind: 'user' } } });
  dispatch(chat, 3, { type: 'chat/turnCancelled', turnId: 'wi-202-round-1-1' });
  dispatch(chat, 4, { type: 'chat/turnResume', turnId: 'wi-202-round-1-1' });
  dispatch(session, 5, { type: 'session/titleChanged', title: 'Renamed' });
  dispatch(chat, 6, { type: 'chat/truncated', turnId: 'wi-202-round-1-1' });
  assert.equal((await answer(1)).params.rejectionReason, workItemRefusals.message);
  assert.equal((await answer(2)).params.rejectionReason, workItemRefusals.message);
  assert.equal((await answer(3)).params.rejectionReason, workItemCommandText.confirmStop('202'), 'Stop only asks');
  assert.equal((await answer(4)).params.rejectionReason, workItemRefusals.tryAgain);
  assert.equal((await answer(5)).params.rejectionReason, workItemRefusals.readOnly);
  assert.equal((await answer(6)).params.rejectionReason, workItemRefusals.history);
  await assert.rejects(op.rpc('disposeSession', { channel: session }), (error: Json) => error.code === -32009 && error.message === workItemRefusals.dispose);
  await assert.rejects(op.rpc('createSession', { channel: 'unfold:/wi-999', provider: 'unfold' }), (error: Json) => error.code === -32003, 'no Unfold session takes a Work Item id');

  dispatch(session, 7, { type: 'session/isArchivedChanged', isArchived: true });
  const archived = await answer(7);
  assert.equal(archived.params.rejectionReason, undefined, 'archiving is the viewer\'s own');
  const mine = workItemsOf(await f.listed(op)).find(item => item.resource === session)!;
  assert.equal(mine.status & 64, 64);
  const theirs = workItemsOf(await f.listed(admin)).find(item => item.resource === session)!;
  assert.equal(theirs.status & 64, 0, 'another person\'s view is unchanged');
});


function parkedOnQuestions(state: World): void {
  const detail = workItem('204', { state: 'needs_human', closeReason: 'question_for_person', spent: 0.75, updated: minutesAgo(30), runs: [{ id: '302', role: 'implementer', round: 1, outcome: 'stuck' }] });
  detail.questions = [
    { id: 'q302-1', shiftId: '9204', runId: '302', role: 'implementer', round: 1, to: 'person', text: 'Round half-cent totals up or away from zero?', answer: null, answeredBy: null, waitingForPerson: true },
    { id: 'q302-2', shiftId: '9204', runId: '302', role: 'implementer', round: 1, to: 'reviewer', text: 'Is the invoice rounding in scope?', answer: null, answeredBy: null, waitingForPerson: false },
  ];
  detail.resume = { shiftId: '9204', askedRound: 1, fromRound: 1, roundCapUsd: 1, poolUsd: 2.25, ready: false, waitingQuestionIds: ['q302-1'] };
  state.details.set('204', detail);
}

const answering = (answers: string[], then: string): Json => ({ ...Object.fromEntries(answers.map((answer, index) => [String(index), { state: 'submitted', value: { kind: 'text', value: answer } }])), [String(answers.length)]: { state: 'submitted', value: { kind: 'selected', value: then } } });

test('a question an agent asked a person is an Agents window question; closing it sends nothing, and an answer is sent as that person and resumes the Round', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  parkedOnQuestions(f.state);
  const session = (await f.client.rpc('subscribe', { channel: 'unfold:/wi-204' })).snapshot.state;
  assert.equal(session.status & 24, 24, 'it needs the person');
  assert.equal(session.activity, `Question for you · ${money(0.75)} spent`, 'Now\'s reason, and what the attempt spent');
  const asked = session.inputNeeded[0].request;
  assert.equal(asked.message, workItemCommandText.questionOpening('204', 1));
  assert.deepEqual(asked.questions.map((question: Json) => [question.kind, question.title, question.message ?? '']), [
    ['text', 'Implementer asks in Round 1', 'Round half-cent totals up or away from zero?'],
    ['single-select', 'Then', 'Resuming spends from delivery\'s budget. Saving only runs nothing.'],
  ], 'only the question to a person, then what to do with the answer');
  assert.deepEqual(asked.questions[1].options.map((option: Json) => option.label), ['Answer and resume Round 1', 'Only save my answers']);
  const chat = defaultChatOf('unfold:/wi-204');
  const state = (await f.client.rpc('subscribe', { channel: chat })).snapshot.state;
  assert.ok(state.activeTurn.responseParts.find((part: Json) => part.kind === 'markdown').content.replaceAll('\\', '').includes(`this Round up to ${money(1)}, in total up to ${money(2.25)}, from delivery's budget`), 'what answering spends is said before it is spent');

  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: asked.id, response: 'cancel' });
  await f.replied(chat, /^Not answered/);
  await settled(f.client);
  assert.equal(f.state.writes.length, 0, 'a dismissed question is not an answer: nothing reaches Ploeg');
  assert.equal((await f.listed(f.client)).find(item => item.resource === 'unfold:/wi-204')!.status & 24, 24, 'it still needs the person');

  const again = (await f.client.rpc('subscribe', { channel: 'unfold:/wi-204' })).snapshot.state.inputNeeded[0].request;
  assert.notEqual(again.id, asked.id, 'opening the session asks again');
  const mark = f.client.inbox.length;
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: again.id, response: 'accept', answers: answering([' '], 'send') });
  await f.replied(chat, /^Every question needs an answer/);
  const third = (await f.requested(chat, mark)).params.action.request;
  assert.equal(f.state.writes.length, 0, 'an empty answer sends nothing');

  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: third.id, response: 'accept', answers: answering(['Away from zero, as the invoice does.'], 'send') });
  await f.replied(chat, /Resumed #204 from Round 1\.$/);
  assert.deepEqual(f.state.writes.map(write => [write.path, write.actor, JSON.parse(write.body).answer ?? null, JSON.parse(write.body).resume ?? null]), [
    ['work-items/204/questions/q302-1/answer', 'op-1', 'Away from zero, as the invoice does.', null],
    ['work-items/204/requeue', 'op-1', null, true],
  ], 'the answer is stored as the person, then the Round that asked resumes');
  assert.equal(f.state.details.get('204')!.item.state, 'queued');
});

test('only saving an answer runs nothing, and a question someone else answered first keeps their answer', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  parkedOnQuestions(f.state);
  const asked = (await f.client.rpc('subscribe', { channel: 'unfold:/wi-204' })).snapshot.state.inputNeeded[0].request;
  const chat = defaultChatOf('unfold:/wi-204');
  await f.client.rpc('subscribe', { channel: chat });
  f.state.details.get('204')!.questions[0].answer = 'Up, as the shop always did.';
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: asked.id, response: 'accept', answers: answering(['Away from zero.'], 'save') });
  await f.replied(chat, /Nothing runs until you restart it\.$/);
  const reply = f.client.inbox.filter(message => action(message, chat, 'chat/responsePart')).at(-1)!.params.action.part.content;
  assert.match(reply, /Someone had already answered it, so Ploeg kept their answer\./);
  assert.deepEqual(f.state.writes.map(write => write.path), ['work-items/204/questions/q302-1/answer'], 'no restart');
  assert.equal(f.state.details.get('204')!.item.state, 'needs_human');
});

const failingCi = { state: 'failure', checks: [{ context: 'unit', state: 'failure' }, { context: 'lint', state: 'success' }] };
const approvedItem = (id: string) => workItem(id, { state: 'needs_human', closeReason: 'review_approved', pullRequest: Number(id) - 170, updated: minutesAgo(5) });

test('a waiting Work Item reads Now\'s reason, chip and sentence for CI that did not pass or still runs, and for a pull request the agent reviewers approved', () => {
  const item = (id: string) => (id === '213' ? approvedItem('213') : world().details.get(id)!).item as PloegItem;
  const cases: Array<[string, Json, string]> = [
    ['205', { ci: failingCi }, 'CI did not pass · PR #42'],
    ['205', { ci: { state: 'pending', checks: [] } }, 'CI running · PR #42'],
    ['205', { ci: { state: 'success', checks: [] } }, 'Ready for review · PR #42'],
    ['205', { ci: null }, 'Ready for review · PR #42'],
    ['213', { pullRequestState: 'open' }, 'Approved: merge it'],
    ['213', { pullRequestState: 'merged' }, 'Merged'],
    ['213', { pullRequestState: 'closed' }, 'Pull request closed'],
    ['213', { pullRequestState: null }, 'Pull request closed'],
  ];
  for (const [id, facts, activity] of cases) {
    const mapped = workItemActivity(item(id), [], facts);
    const now = { ...nowItem(item(id)), ...facts };
    const reason = listReason(now);
    assert.equal(mapped.activity, activity, `${id} with ${JSON.stringify(facts)}`);
    assert.deepEqual(mapped.reason, reason ? { code: reason.code, chip: reason.chip, sentence: reason.sentence } : undefined, `${id} carries Now's own reason`);
    assert.equal(mapped.status, 'inputNeeded', `${id} waits on the person, as Now lists it in its ${waitingGroup(now)} group`);
  }
  assert.equal(workItemActivity(item('205'), [], { ci: failingCi }).reason?.sentence, 'CI did not pass on pull request #42, so it is not ready for review. Not passing: unit.');
  assert.equal(workItemActivity(item('213'), [], { pullRequestState: 'open' }).reason?.sentence, 'The agent reviewers approved and the pull request is still open. Ploeg leaves the merge to you.');
  assert.equal(workItemActivity(item('213')).activity, 'Pull request closed', 'without the facts Now reads, the Agents window says what Now says without them');
});

test('the Agents window lists a waiting Work Item with the reason Now gives it, from the same delivery facts read, and follows a pull request that merged', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  f.state.details.set('213', approvedItem('213'));
  const pulls = new Map<string, Json>([
    ['205', { number: 42, url: 'https://forge.invalid/pulls/42', state: 'open', headSha: 'abc', commitStatus: { ...failingCi, headSha: 'abc' } }],
    ['213', { number: 43, url: 'https://forge.invalid/pulls/43', state: 'open', headSha: 'def', commitStatus: null }],
  ]);
  const facts = (id: string) => ({ pullRequests: pulls.has(id) ? [pulls.get(id)] : [] });
  const read: string[] = [];
  Object.assign(f.host.workItems.client, {
    factsSupported: async () => true,
    workItemFacts: async (id: string) => { read.push(id); return facts(id); },
  });
  const op = await f.attach('op-1');
  const work = new Map(workItemsOf(await f.listed(op)).map(item => [item.resource, item]));
  assert.deepEqual([...new Set(read)].sort(), ['205', '213'], 'only the Work Items Now reads facts for: one ready for review and one the agent reviewers approved');
  const failed = work.get('unfold:/wi-205')!;
  assert.equal(failed.activity, 'CI did not pass · PR #42');
  assert.equal(failed.status & 24, 24, 'CI that did not pass needs the person');
  assert.deepEqual(failed._meta['unfold.workItem'].reason, { code: 'ci_failed', chip: 'CI did not pass', sentence: 'CI did not pass on pull request #42, so it is not ready for review. Not passing: unit.' });
  const approved = work.get('unfold:/wi-213')!;
  assert.equal(approved.activity, 'Approved: merge it');
  assert.equal(approved.status & 24, 24);
  assert.equal(approved._meta['unfold.workItem'].reason.code, 'approved_to_merge');

  const ploeg = new PloegClient(f.server.config);
  Object.assign(ploeg, { factsSupported: async () => true, workItemFacts: async (id: string) => facts(id) });
  const now = await ploeg.now({ id: 'op-1', name: 'op-1', role: 'operator' });
  for (const id of ['205', '213']) {
    const row = now.waiting.find(entry => entry.id === id)!;
    assert.equal(work.get(`unfold:/wi-${id}`)!._meta['unfold.workItem'].reason.chip, listReason(row)!.chip, `Now and the Agents window agree on #${id}`);
  }

  pulls.set('213', { ...pulls.get('213'), state: 'merged' });
  f.host.workItems.reconcileMs = 0;
  await f.host.workItems.tick();
  const merged = await op.until(message => message.method === 'root/sessionSummaryChanged' && message.params.session === 'unfold:/wi-213');
  assert.equal(merged.params.changes.activity, 'Merged', 'a merge on the forge reaches the list on the next reconcile, with no Ploeg event');
});

test('a Work Item waiting for review points a message at its pull request, and a stopped or finished one shows what its attempt spent', { timeout: testTimeout(20_000) }, async t => {
  const item = (id: string) => world().details.get(id)!.item as PloegItem;
  const spent = (id: string, amount: number): PloegItem => ({ ...item(id), latestShift: { ...item(id).latestShift!, spentUsd: amount } });
  assert.equal(workItemActivity(spent('205', 1.25)).activity, `Ready for review · PR #42 · ${money(1.25)} spent`);
  assert.equal(workItemActivity(spent('207', 0.5)).activity, `Merged · ${money(0.5)} spent`);
  assert.equal(workItemActivity(spent('208', 0.2)).activity, `An operator cancelled it · ${money(0.2)} spent`);
  assert.equal(workItemActivity(spent('205', 0)).activity, 'Ready for review · PR #42', 'nothing spent, nothing said');
  assert.equal(workItemMessageRefusal(item('205')), 'Review pull request #42 on the forge: merge it, or ask for changes there.');
  assert.equal(workItemMessageRefusal(item('203')), '#203 waits for approval. Answer the question above to approve or reject it.');
  assert.equal(workItemMessageRefusal(item('207')), '#207 is done, so nothing more runs. Hand off a new Work Item for further changes.');
  assert.equal(workItemMessageRefusal(item('202')), workItemRefusals.message);

  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-205');
  await f.client.rpc('subscribe', { channel: 'unfold:/wi-205' });
  await f.client.rpc('subscribe', { channel: chat });
  const sent = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'review-1', message: { text: 'Looks good, ship it', origin: { kind: 'user' } } });
  assert.equal((await f.answered(sent)).params.rejectionReason, workItemMessageRefusal(item('205')));
  assert.equal(f.state.writes.length, 0);
});

test('Fix Checks and Address Comments on a Work Item session start no Run: the reply names a steer or Try Again and what it spends', { timeout: testTimeout(20_000) }, async t => {
  const item = (id: string) => world().details.get(id)!.item as PloegItem;
  assert.ok(isPullRequestBannerPrompt('/fix-ci\nPull request: https://github.com/acme/order-service/pull/42\nFailed CI checks:'));
  assert.ok(isPullRequestBannerPrompt('/act-on-feedback for #42'));
  assert.ok(isPullRequestBannerPrompt('/fix-ci and /act-on-feedback'));
  assert.ok(!isPullRequestBannerPrompt('/fix-cid'), 'only the banner\'s own commands');
  assert.ok(!isPullRequestBannerPrompt('Please fix the checks'));
  assert.equal(workItemBannerReply(item('205')), `Ploeg runs #205, so Fix Checks and Address Comments start nothing here. Ask for changes on pull request #42 on the forge. Ploeg restarts it only once it stops and needs you; then Try Again restarts it from Round 1 once you confirm, and spends from Team delivery's budget, up to ${money(3)} like its last attempt.`);
  assert.equal(workItemBannerReply(item('204')), `Ploeg runs #204, so Fix Checks and Address Comments start nothing here. Try Again restarts it from Round 1 once you confirm, and spends from Team delivery's budget, up to ${money(3)} like its last attempt. Type what it should fix to restart it with that note instead; that asks you first too.`);
  assert.equal(workItemBannerReply(item('202')), `Ploeg runs #202, so Fix Checks and Address Comments start nothing here. Type what it should fix instead: your message is saved as a steer for its next Round, which spends from the attempt already open (${money(0.5)} of ${money(3)} spent), and nothing more.`);
  assert.equal(workItemBannerReply(item('207')), workItemMessageRefusal(item('207')));

  const f = await commanding(t);
  for (const [id, text] of [['205', '/fix-ci\nPull request: https://forge.invalid/pulls/42\nFailed CI checks:\n\nCheck: unit'], ['204', '/act-on-feedback'], ['202', '/fix-ci and /act-on-feedback']] as const) {
    const chat = defaultChatOf(`unfold:/wi-${id}`);
    await f.client.rpc('subscribe', { channel: `unfold:/wi-${id}` });
    await f.client.rpc('subscribe', { channel: chat });
    const mark = f.client.inbox.length;
    const sent = f.dispatch(chat, { type: 'chat/turnStarted', turnId: `banner-${id}`, message: { text, origin: { kind: 'user' } } });
    assert.equal((await f.answered(sent)).params.rejectionReason, workItemBannerReply(item(id)), `#${id} answers the banner`);
    await settled(f.client);
    assert.ok(!f.client.inbox.slice(mark).some(message => action(message, chat, 'chat/inputRequested')), `#${id} asks no restart from the banner's message alone`);
  }
  assert.deepEqual(f.state.writes, [], 'nothing reached Ploeg: no note, no requeue');
});

test('a proposed Work Item asks its operator to approve or reject it, a rejection needs a reason, and an approval queues it as that person', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const session = (await f.client.rpc('subscribe', { channel: 'unfold:/wi-203' })).snapshot.state;
  assert.equal(session.inputNeeded.length, 1);
  const asked = session.inputNeeded[0];
  assert.equal(asked.kind, 'chatInput');
  assert.equal(asked.request.message, workItemCommandText.decideQuestion('203'));
  assert.deepEqual(asked.request.questions[0].options.map((option: Json) => option.id), ['approve', 'reject']);
  const chat = defaultChatOf('unfold:/wi-203');
  const state = (await f.client.rpc('subscribe', { channel: chat })).snapshot.state;
  assert.ok(state.activeTurn.responseParts.some((part: Json) => part.kind === 'inputRequest' && part.request.id === asked.id), 'the question is the open turn of the chat');

  const mark = f.client.inbox.length;
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: asked.id, response: 'accept', answers: picked('reject', ' ') });
  await f.replied(chat, /needs a reason/);
  assert.equal(f.state.writes.length, 0, 'a rejection without a reason calls nothing');
  const again = (await f.requested(chat, mark)).params.action.request;
  assert.notEqual(again.id, asked.id, 'the question is asked again');

  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: again.id, response: 'accept', answers: picked('approve') });
  await f.replied(chat, /^Approved\. #203 is queued for delivery\.$/);
  assert.deepEqual(f.state.writes.map(write => [write.path, write.actor, write.acting]), [['work-items/203/approve', 'op-1', 'op-1']]);
  assert.equal((f.state.writes[0].pending as Json).actingUser, 'op-1', 'the command was recorded before Ploeg was called');
  assert.match((f.state.writes[0].pending as Json).commandId, /^[0-9a-f-]{36}$/);
  await f.client.until(message => message.method === 'root/sessionSummaryChanged' && message.params.session === 'unfold:/wi-203' && message.params.changes.activity === 'Queued for delivery');
  const after = (await f.client.rpc('subscribe', { channel: 'unfold:/wi-203' })).snapshot.state;
  assert.deepEqual(after.inputNeeded, [], 'nothing waits on the person once it is decided');
});

test('rejecting a proposed Work Item sends the reason to Ploeg', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const asked = (await f.client.rpc('subscribe', { channel: 'unfold:/wi-203' })).snapshot.state.inputNeeded[0];
  const chat = defaultChatOf('unfold:/wi-203');
  await f.client.rpc('subscribe', { channel: chat });
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: asked.id, response: 'accept', answers: picked('reject', 'Out of scope for this quarter.') });
  await f.replied(chat, /^Rejected #203: Out of scope for this quarter\.$/);
  assert.deepEqual(f.state.writes.map(write => [write.path, JSON.parse(write.body)]), [['work-items/203/reject', { reason: 'Out of scope for this quarter.' }]]);
});

test('Stop on a running Work Item only asks whether to withdraw it, and nothing happens without a confirmation', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: 'unfold:/wi-202' });
  await f.client.rpc('subscribe', { channel: chat });
  const stop = f.dispatch(chat, { type: 'chat/turnCancelled', turnId: 'wi-202-round-1-1' });
  assert.equal((await f.answered(stop)).params.rejectionReason, workItemCommandText.confirmStop('202'), 'the click is refused, not carried out');
  const question = (await f.requested(chat)).params.action.request;
  assert.equal(question.message, 'Withdraw #202? This stops the running Run, blocks its keys and comments on the tracker. It can\'t be resumed.');
  const part = f.client.inbox.find(message => action(message, chat, 'chat/responsePart'))!.params.action;
  assert.equal(part.turnId, 'wi-202-round-1-1', 'asked in the running Round\'s turn');
  await settled(f.client);
  assert.equal(f.state.writes.length, 0, 'Stop alone calls nothing');

  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: question.id, response: 'cancel' });
  await f.replied(chat, /^Nothing changed\.$/);
  const second = f.dispatch(chat, { type: 'chat/turnCancelled', turnId: 'wi-202-round-1-1' });
  await f.answered(second);
  const keep = (await f.requested(chat, f.client.inbox.findIndex(message => message.params?.origin?.clientSeq === second))).params.action.request;
  assert.notEqual(keep.id, question.id);
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: keep.id, response: 'accept', answers: picked('keep') });
  await settled(f.client);
  await f.client.until(message => action(message, chat, 'chat/responsePart') && message.params.action.part.id === `${keep.id}-reply`);
  assert.equal(f.state.writes.length, 0, 'keeping it running calls nothing');
});

test('while the host asks about a Work Item, its session and chat need input, which VS Code 1.142 shows as "Needs attention"', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const session = 'unfold:/wi-202';
  const chat = defaultChatOf(session);
  assert.notEqual((await f.client.rpc('subscribe', { channel: session })).snapshot.state.status & 24, 24, 'running work needs nobody');
  await f.client.rpc('subscribe', { channel: chat });
  const mark = f.client.inbox.length;
  await f.answered(f.dispatch(chat, { type: 'chat/turnCancelled', turnId: 'wi-202-round-1-1' }));
  const question = (await f.requested(chat)).params.action.request;
  const summary = await f.client.until(message => message.method === 'root/sessionSummaryChanged' && message.params.session === session && f.client.inbox.indexOf(message) >= mark);
  assert.equal(summary.params.changes.status & 24, 24);
  assert.equal((await f.client.until(message => action(message, session, 'session/chatUpdated') && f.client.inbox.indexOf(message) >= mark)).params.action.changes.status & 24, 24);
  const asked = (await f.client.rpc('subscribe', { channel: session })).snapshot.state;
  assert.equal(asked.status & 24, 24);
  assert.equal(asked.chats[0].status & 24, 24);
  assert.equal((await f.client.rpc('subscribe', { channel: chat })).snapshot.state.status & 24, 24);
  assert.equal((await f.listed(f.client)).find(item => item.resource === session)!.status & 24, 24);

  const answered = f.client.inbox.length;
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: question.id, response: 'cancel' });
  const cleared = await f.client.until(message => message.method === 'root/sessionSummaryChanged' && message.params.session === session && f.client.inbox.indexOf(message) >= answered);
  assert.notEqual(cleared.params.changes.status & 24, 24, 'answering clears it');
});

test('confirming Stop withdraws the Work Item once, as the person, with a command recorded first', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  f.dispatch(chat, { type: 'chat/turnCancelled', turnId: 'wi-202-round-1-1' });
  const question = (await f.requested(chat)).params.action.request;
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: question.id, response: 'accept', answers: picked('withdraw') });
  await f.replied(chat, /^Withdrew #202\. Ploeg stopped 1 Run and blocked their keys/);
  assert.equal(f.state.writes.length, 1, 'exactly one cancel');
  const [write] = f.state.writes;
  assert.deepEqual([write.path, write.actor, write.acting], ['work-items/202/cancel', 'op-1', 'op-1']);
  assert.match((write.pending as Json).commandId, /^[0-9a-f-]{36}$/, 'the command id was persisted before the call');
  assert.deepEqual(JSON.parse(write.body), { commandId: (write.pending as Json).commandId, expectedShiftId: '9202' }, 'the cancel names the Shift the person saw');
  assert.equal(f.server.app.store.getSecret('work-item-command:op-1:202'), undefined, 'and forgotten once Ploeg answered');
  await f.client.until(message => message.method === 'root/sessionSummaryChanged' && message.params.session === 'unfold:/wi-202' && message.params.changes.status === 1);
});

test('a viewer of the team is refused every command and asked nothing', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t, 'viewer-2');
  assert.deepEqual((await f.client.rpc('subscribe', { channel: 'unfold:/wi-203' })).snapshot.state.inputNeeded, [], 'no approval question for a viewer');
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  const stop = f.dispatch(chat, { type: 'chat/turnCancelled', turnId: 'wi-202-round-1-1' });
  assert.equal((await f.answered(stop)).params.rejectionReason, workItemCommandText.viewer('delivery'));
  await settled(f.client);
  assert.ok(!f.client.inbox.some(message => message.method === 'action' && message.params.action.type === 'chat/inputRequested'), 'no question is raised');
  assert.equal(f.state.writes.length, 0);
});

test('a message on a Work Item that needs a person restarts it from Round 1 with that note only after a confirmation, and a retry reuses the command', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-204');
  await f.client.rpc('subscribe', { channel: 'unfold:/wi-204' });
  await f.client.rpc('subscribe', { channel: chat });
  const note = 'Use the decimal rounding helper in totals.ts.';
  const sent = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-1', message: { text: note, origin: { kind: 'user' } } });
  const echoed = await f.answered(sent);
  assert.equal(echoed.params.rejectionReason, undefined, 'the message keeps its own turn');
  const question = (await f.requested(chat)).params.action.request;
  assert.equal(question.message, 'Restart from Round 1 with this note? This spends from delivery\'s pool.');
  assert.deepEqual(question.questions[0].options.map((option: Json) => option.id), ['restart', 'keep']);
  await settled(f.client);
  assert.equal(f.state.writes.length, 0, 'the message alone restarts nothing');

  f.state.down = true;
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: question.id, response: 'accept', answers: picked('restart') });
  await f.client.until(message => action(message, chat, 'chat/responsePart') && message.params.action.part.id === `${question.id}-reply`);
  const first = JSON.parse(f.state.writes[0].body);
  assert.ok(f.server.app.store.getSecret('work-item-command:op-1:204'), 'an unanswered command stays recorded');

  f.state.down = false;
  const mark = f.client.inbox.length;
  f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-2', message: { text: note, origin: { kind: 'user' } } });
  const retry = (await f.requested(chat, mark)).params.action.request;
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: retry.id, response: 'accept', answers: picked('restart') });
  await f.replied(chat, /^Restarted #204 from Round 1 with a .+ pool\.$/);
  assert.deepEqual(f.state.writes.map(write => [write.path, write.actor, write.acting]), [['work-items/204/requeue', 'op-1', 'op-1'], ['work-items/204/requeue', 'op-1', 'op-1']]);
  const second = JSON.parse(f.state.writes[1].body);
  assert.deepEqual(second, { commandId: first.commandId, expectedState: 'needs_human', note }, 'the retry reuses the command id, with the note and the state the person saw');
  assert.equal((f.state.writes[1].pending as Json).commandId, second.commandId, 'recorded before the call');
  assert.equal(f.server.app.store.getSecret('work-item-command:op-1:204'), undefined);
});

test('Try Again on a stale Work Item asks the same question without a note and restarts it on confirmation', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-206');
  await f.client.rpc('subscribe', { channel: chat });
  const resume = f.dispatch(chat, { type: 'chat/turnResume', turnId: 'wi-206-round-0-1' });
  assert.equal((await f.answered(resume)).params.rejectionReason, workItemCommandText.confirmTryAgain('206'));
  const question = (await f.requested(chat)).params.action.request;
  assert.equal(question.message, 'Restart from Round 1? This spends from delivery\'s pool.');
  await settled(f.client);
  assert.equal(f.state.writes.length, 0, 'Try Again alone restarts nothing');
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: question.id, response: 'accept', answers: picked('restart') });
  await f.replied(chat, /^Restarted #206 from Round 1/);
  assert.equal(f.state.writes.length, 1);
  const body = JSON.parse(f.state.writes[0].body);
  assert.deepEqual(Object.keys(body).sort(), ['commandId', 'expectedState']);
  assert.equal(body.expectedState, 'stale');
});

test('a withdrawn Work Item is restarted only by assigning its task again', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-208');
  await f.client.rpc('subscribe', { channel: chat });
  const sent = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-1', message: { text: 'Try once more.', origin: { kind: 'user' } } });
  const resume = f.dispatch(chat, { type: 'chat/turnResume', turnId: 'x' });
  assert.equal((await f.answered(sent)).params.rejectionReason, 'Ploeg restarts a withdrawn Work Item only when its task is assigned to the team again.');
  assert.equal((await f.answered(resume)).params.rejectionReason, workItemCommandText.withdrawn);
  await settled(f.client);
  assert.ok(!f.client.inbox.some(message => message.method === 'action' && message.params.action.type === 'chat/inputRequested'));
  assert.equal(f.state.writes.length, 0);
});

test('when the budget ran out a restart offers a raised pool, and a pool above Ploeg\'s limit asks to raise the Team\'s budget', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  f.state.details.set('204', workItem('204', { state: 'needs_human', closeReason: 'budget exhausted', updated: minutesAgo(30), runs: [{ id: '302', role: 'implementer', round: 1, outcome: 'pr_opened' }] }));
  const chat = defaultChatOf('unfold:/wi-204');
  await f.client.rpc('subscribe', { channel: chat });
  f.dispatch(chat, { type: 'chat/turnResume', turnId: 'x' });
  const question = (await f.requested(chat)).params.action.request;
  const max = f.server.config.maxBudgetUsd;
  assert.deepEqual(question.questions[0].options, [{ id: 'restart', label: 'Restart from Round 1' }, { id: 'restart_raised', label: `Restart with a ${money(max)} pool` }, { id: 'keep', label: 'Leave it stopped' }]);
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: question.id, response: 'accept', answers: picked('restart_raised') });
  await f.replied(chat, /^Raise the Team's budget to try again with more\.$/);
  assert.equal(JSON.parse(f.state.writes[0].body).poolUsd, max);
  assert.equal(f.state.details.get('204')!.item.state, 'needs_human', 'nothing restarted');
});

const newAttempt = (state: World, id: string) => {
  const detail = state.details.get(id)!;
  const shift = { ...detail.item.latestShift, id: `99${id}`, openedAt: minutesAgo(1) };
  detail.item.latestShift = shift; detail.shifts = [shift];
  for (const run of detail.runs) run.shiftId = shift.id;
};

test('a message on a running Work Item is saved as a note for the next Round, naming the Shift the person saw and a command recorded first', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  const text = 'Use the decimal rounding helper in totals.ts.';
  const sent = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-1', message: { text, origin: { kind: 'user' } } });
  assert.equal((await f.answered(sent)).params.rejectionReason, undefined, 'the message keeps its own turn');
  await f.replied(chat, /^Saved for the next Round\. The running agent won't see it until then\.$/);
  await f.client.until(message => action(message, chat, 'chat/turnComplete') && message.params.action.turnId === 'note-1');
  assert.deepEqual(f.state.writes.map(write => [write.path, write.actor, write.acting]), [['work-items/202/notes', 'op-1', 'op-1']], 'only a note: nothing is cancelled or restarted');
  const body = JSON.parse(f.state.writes[0].body);
  assert.deepEqual(body, { commandId: body.commandId, text, expectedShiftId: '9202' });
  assert.equal((f.state.writes[0].pending as Json).commandId, body.commandId, 'the command id was persisted before the call');
  assert.equal(f.server.app.store.getSecret('work-item-command:op-1:202'), undefined, 'and forgotten once Ploeg answered');
  assert.ok(!f.client.inbox.some(message => message.method === 'action' && /interrupt/i.test(JSON.stringify(message.params.action))), 'it never claims to interrupt the running Run');
  const state = (await f.client.rpc('subscribe', { channel: chat })).snapshot.state;
  const turn = state.turns.find((entry: Json) => entry.id === 'note-1');
  assert.equal(turn.message.text, text);
  assert.equal(turn.responseParts[0].content, workItemCommandText.noteSaved, 'the saved note stays in the chat');

  const queuedChat = defaultChatOf('unfold:/wi-201');
  await f.client.rpc('subscribe', { channel: queuedChat });
  const pending = f.dispatch(queuedChat, { type: 'chat/pendingMessageSet', kind: 'steering', id: 'p1', message: { text: 'Start with the tests.', origin: { kind: 'user' } } });
  assert.equal((await f.answered(pending)).params.rejectionReason, undefined);
  await f.replied(queuedChat, /^Saved for the next Round/);
  assert.deepEqual(JSON.parse(f.state.writes[1].body), { commandId: JSON.parse(f.state.writes[1].body).commandId, text: 'Start with the tests.' }, 'queued work has no open Shift to name');
});

const screenshot = { type: 'embeddedResource', label: 'Screenshot 2026-11-19.png', displayKind: 'image', contentType: 'image/png', data: 'iVBORw0KGgo=' };
const outsideFile = { type: 'resource', label: 'invoice.pdf', uri: 'file:///Users/someone/Downloads/invoice.pdf' };

test('a note with a screenshot or a file from outside the repositories says in its reply that only the text reaches the Team', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  const text = 'Fix what is circled.';
  const sent = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-shot', message: { text, origin: { kind: 'user' }, attachments: [screenshot, outsideFile] } });
  assert.equal((await f.answered(sent)).params.rejectionReason, undefined);
  const notice = unsentAttachmentsNotice(['Screenshot 2026-11-19.png', 'invoice.pdf']);
  await f.client.until(message => action(message, chat, 'chat/turnComplete') && message.params.action.turnId === 'note-shot');
  const reply = f.client.inbox.find(message => action(message, chat, 'chat/responsePart') && message.params.action.turnId === 'note-shot')!.params.action.part.content;
  assert.equal(reply, `${workItemCommandText.noteSaved}\n\n${notice}`);
  assert.equal(notice, 'Only your text reaches the Team. Unfold cannot pass attachments on yet, so `Screenshot 2026-11-19.png` and `invoice.pdf` stayed in VS Code.');
  assert.deepEqual(f.state.writes.map(write => write.path), ['work-items/202/notes'], 'one note, nothing else started');
  assert.equal(JSON.parse(f.state.writes[0].body).text, text, 'the text reaches Ploeg unchanged');
  assert.ok(!JSON.stringify(f.state.writes).includes(screenshot.data), 'the attachment\'s content never leaves the host');
  const state = (await f.client.rpc('subscribe', { channel: chat })).snapshot.state;
  assert.equal(state.turns.find((entry: Json) => entry.id === 'note-shot').responseParts[0].content, reply, 'the line stays in the chat');

  const plain = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-repo', message: { text: 'Look at totals.ts.', origin: { kind: 'user' }, attachments: [{ type: 'resource', label: 'totals.ts', uri: 'file:///unfold-repositories/order-service/src/totals.ts' }, { type: 'simple', label: '/steer', displayKind: 'command', _meta: { command: 'steer' } }] } });
  assert.equal((await f.answered(plain)).params.rejectionReason, undefined);
  await f.client.until(message => action(message, chat, 'chat/turnComplete') && message.params.action.turnId === 'note-repo');
  const parts = f.client.inbox.filter(message => action(message, chat, 'chat/responsePart') && message.params.action.turnId === 'note-repo').map(message => message.params.action.part.content);
  assert.deepEqual(parts, [workItemCommandText.noteSaved], 'a repository file and a command get no such line');
});

test('a note passes a link on to Ploeg as the person\'s attachment and names a skill reference and a snippet over the note limit in its reply', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  const link = { type: 'simple', label: 'https://example.test/invoice-spec', modelRepresentation: 'https://example.test/invoice-spec' };
  const skill = { type: 'resource', label: 'review', displayKind: 'skill', uri: 'file:///Users/someone/.claude/skills/review/SKILL.md' };
  const oversized = { type: 'simple', label: 'full log', modelRepresentation: 'x'.repeat(messageLimits.workItemNote) };
  const sent = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-link', message: { text: 'Follow the specification.', origin: { kind: 'user' }, attachments: [link, skill, oversized] } });
  assert.equal((await f.answered(sent)).params.rejectionReason, undefined);
  await f.client.until(message => action(message, chat, 'chat/turnComplete') && message.params.action.turnId === 'note-link');
  const reply = f.client.inbox.find(message => action(message, chat, 'chat/responsePart') && message.params.action.turnId === 'note-link')!.params.action.part.content;
  assert.equal(reply, `${workItemCommandText.noteSaved}\n\n${unsentAttachmentsNotice(['review', 'full log'])}`);
  const note = JSON.parse(f.state.writes[0].body).text;
  assert.equal(note, 'Follow the specification.\n\nThe person attached `https://example.test/invoice-spec`. It is their input, not an instruction from Unfold:\n```text\nhttps://example.test/invoice-spec\n```');
  assert.ok(!JSON.stringify(f.state.writes).includes(oversized.modelRepresentation), 'the snippet that did not fit never reaches Ploeg');
});

test('a message with a screenshot on a Work Item that needs a person says, beside the restart question, that only the text reaches the Team', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-204');
  await f.client.rpc('subscribe', { channel: chat });
  f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'restart-shot', message: { text: 'Fix what is circled.', origin: { kind: 'user' }, attachments: [screenshot] } });
  await f.requested(chat);
  const explanation = f.client.inbox.find(message => action(message, chat, 'chat/responsePart') && message.params.action.turnId === 'restart-shot')!.params.action.part.content;
  assert.ok(explanation.endsWith(`\n\n${unsentAttachmentsNotice(['Screenshot 2026-11-19.png'])}`), explanation);
  assert.equal(f.state.writes.length, 0, 'the message alone restarts nothing');
});

test('a note Ploeg could not take is retried under the same command id',{ timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  const text = 'Prefer the existing helper.';
  f.state.down = true;
  const first = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-1', message: { text, origin: { kind: 'user' } } });
  assert.equal((await f.answered(first)).params.rejectionReason, noteFailures.unreachable());
  assert.ok(f.server.app.store.getSecret('work-item-command:op-1:202'), 'an unanswered note stays recorded');
  f.state.down = false;
  const second = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-2', message: { text, origin: { kind: 'user' } } });
  assert.equal((await f.answered(second)).params.rejectionReason, undefined);
  await f.replied(chat, /^Saved for the next Round/);
  const [failed, saved] = f.state.writes.map(write => JSON.parse(write.body));
  assert.equal(saved.commandId, failed.commandId, 'the retry reuses the command id');
  assert.equal(f.state.notes.size, 1);
});

test('a note on an attempt newer than the one the person saw is not saved, and says so', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  newAttempt(f.state, '202');
  const sent = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-1', message: { text: 'Use the helper.', origin: { kind: 'user' } } });
  assert.equal((await f.answered(sent)).params.rejectionReason, noteFailures.shift_changed('202'));
  assert.equal(JSON.parse(f.state.writes[0].body).expectedShiftId, '9202', 'it named the Shift the person saw');
  assert.equal(f.state.notes.size, 0);
});

test('a viewer\'s message on a running Work Item is refused and reaches no Ploeg note', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t, 'viewer-2');
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  const sent = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-1', message: { text: 'Hurry up.', origin: { kind: 'user' } } });
  assert.equal((await f.answered(sent)).params.rejectionReason, workItemCommandText.viewer('delivery'));
  await settled(f.client);
  assert.equal(f.state.writes.length, 0);
});

test('a Ploeg without the notes route refuses instructions for running work, and the process stops asking it', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  f.state.notesRoute = false;
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  const first = f.dispatch(chat, { type: 'chat/turnStarted', turnId: 'note-1', message: { text: 'Use the helper.', origin: { kind: 'user' } } });
  assert.equal((await f.answered(first)).params.rejectionReason, 'Ploeg can\'t take instructions for running work yet. Stop it, or wait until it needs you.');
  const second = f.dispatch(chat, { type: 'chat/pendingMessageSet', kind: 'steering', id: 'p1', message: { text: 'Again.', origin: { kind: 'user' } } });
  assert.equal((await f.answered(second)).params.rejectionReason, workItemRefusals.message);
  assert.deepEqual(f.state.writes.map(write => write.path), ['work-items/202/notes'], 'the missing route is learnt once and nothing else is called');
  assert.equal(f.server.app.store.getSecret('work-item-command:op-1:202'), undefined, 'and no command waits for a retry');
});

test('a confirmed Stop on an attempt newer than the one the person saw withdraws nothing', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  f.dispatch(chat, { type: 'chat/turnCancelled', turnId: 'wi-202-round-1-1' });
  const question = (await f.requested(chat)).params.action.request;
  newAttempt(f.state, '202');
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: question.id, response: 'accept', answers: picked('withdraw') });
  await f.replied(chat, /started a new attempt/);
  const reply = f.client.inbox.find(message => action(message, chat, 'chat/responsePart') && message.params.action.part.id === `${question.id}-reply`)!;
  assert.equal(reply.params.action.part.content, cancelShiftChanged('202'));
  assert.equal(reply.params.action.part.content, '#202 started a new attempt since you looked; nothing was withdrawn. Look again and stop it if you still want to.');
  assert.equal(JSON.parse(f.state.writes[0].body).expectedShiftId, '9202');
  assert.equal(f.state.details.get('202')!.item.state, 'leased', 'nothing was withdrawn');
});

test('a Ploeg that takes no cancel body still withdraws on a confirmed Stop, unguarded', { timeout: testTimeout(20_000) }, async t => {
  const f = await commanding(t);
  f.state.cancelBody = false;
  const chat = defaultChatOf('unfold:/wi-202');
  await f.client.rpc('subscribe', { channel: chat });
  f.dispatch(chat, { type: 'chat/turnCancelled', turnId: 'wi-202-round-1-1' });
  const question = (await f.requested(chat)).params.action.request;
  f.dispatch(chat, { type: 'chat/inputCompleted', requestId: question.id, response: 'accept', answers: picked('withdraw') });
  await f.replied(chat, /^Withdrew #202\./);
  assert.deepEqual(f.state.writes.map(write => write.body === '' ? '' : Object.keys(JSON.parse(write.body)).sort().join()), ['commandId,expectedShiftId', '']);
});

async function refusing(t: TestContext, who: 'op-1' | 'viewer-2', workItemId: string) {
  const f = await commanding(t, who);
  const chat = defaultChatOf(`unfold:/wi-${workItemId}`);
  const snapshot = (await f.client.rpc('subscribe', { channel: chat })).snapshot.state;
  const from = f.client.inbox.length;
  const before = structuredClone(f.state.details.get(workItemId));
  const seen = () => chatAsSeen(snapshot, f.client.inbox, chat, from);
  const turnEnded = (turnId?: string) => f.client.until(message => action(message, chat, 'chat/turnComplete') && f.client.inbox.indexOf(message) >= from && (turnId === undefined || message.params.action.turnId === turnId));
  const untouched = async () => { await settled(f.client); assert.equal(f.state.writes.length, 0, 'Ploeg is not called'); assert.deepEqual(f.state.details.get(workItemId), before, 'the Work Item is unchanged'); };
  return { ...f, chat, snapshot, from, seen, turnEnded, untouched };
}

const replyOf = (turn: Json | undefined) => turn?.responseParts.filter((part: Json) => part.kind === 'markdown').map((part: Json) => part.content);

test('a refused message on a Work Item ends in a finished turn that says why, and still carries the rejectionReason', { timeout: testTimeout(20_000) }, async t => {
  const f = await refusing(t, 'op-1', '208');
  const sent = f.dispatch(f.chat, { type: 'chat/turnStarted', turnId: 'note-1', message: { text: 'note: test, ignore', origin: { kind: 'user' } } });
  assert.equal((await f.answered(sent)).params.rejectionReason, workItemCommandText.withdrawn);
  await f.turnEnded('note-1');
  const turn = f.seen().turns.find((entry: Json) => entry.id === 'note-1');
  assert.equal(turn?.state, 'complete', 'the person\'s message is not left waiting');
  assert.equal(turn.message.text, 'note: test, ignore');
  assert.deepEqual(replyOf(turn), [workItemCommandText.withdrawn]);
  assert.equal(f.seen().activeTurn, undefined);
  await f.untouched();
});

test('a refused queued message on a Work Item says why in the Round still running, or in a finished turn of its own when none runs', { timeout: testTimeout(20_000) }, async t => {
  const running = await refusing(t, 'viewer-2', '202');
  const queued = running.dispatch(running.chat, { type: 'chat/pendingMessageSet', kind: 'queued', id: 'p1', message: { text: 'Hurry up.', origin: { kind: 'user' } } });
  assert.equal((await running.answered(queued)).params.rejectionReason, workItemCommandText.viewer('delivery'));
  await running.replied(running.chat, /^Only an operator/);
  const round = running.seen().activeTurn;
  assert.equal(round?.id, 'wi-202-round-1-1', 'the Round keeps running');
  assert.deepEqual(replyOf(round)?.slice(-1), [workItemCommandText.viewer('delivery')]);
  assert.equal(running.seen().queuedMessages, undefined, 'nothing waits in the queue');
  await running.untouched();

  const idle = await refusing(t, 'op-1', '208');
  const steering = idle.dispatch(idle.chat, { type: 'chat/pendingMessageSet', kind: 'steering', id: 'p2', message: { text: 'Try once more.', origin: { kind: 'user' } } });
  assert.equal((await idle.answered(steering)).params.rejectionReason, workItemCommandText.withdrawn);
  await idle.turnEnded();
  const turn = idle.seen().turns.at(-1);
  assert.equal(turn.state, 'complete');
  assert.equal(turn.message.text, 'Try once more.');
  assert.deepEqual(replyOf(turn), [workItemCommandText.withdrawn]);
  await idle.untouched();
});

test('a refused Stop on a Work Item says why in the Round it tried to stop, or in a finished turn when nothing runs', { timeout: testTimeout(20_000) }, async t => {
  const running = await refusing(t, 'viewer-2', '202');
  const stop = running.dispatch(running.chat, { type: 'chat/turnCancelled', turnId: 'wi-202-round-1-1' });
  assert.equal((await running.answered(stop)).params.rejectionReason, workItemCommandText.viewer('delivery'));
  await running.replied(running.chat, /^Only an operator/);
  const round = running.seen().activeTurn;
  assert.equal(round?.id, 'wi-202-round-1-1');
  assert.deepEqual(replyOf(round)?.slice(-1), [workItemCommandText.viewer('delivery')]);
  await running.untouched();

  const ended = await refusing(t, 'op-1', '208');
  const late = ended.dispatch(ended.chat, { type: 'chat/turnCancelled', turnId: 'wi-208-round-1-1' });
  assert.equal((await ended.answered(late)).params.rejectionReason, workItemCommandText.ended('208'));
  await ended.turnEnded();
  const turn = ended.seen().turns.at(-1);
  assert.deepEqual([turn.state, turn.message.text, turn.message.origin.kind], ['complete', 'Stop', 'systemNotification']);
  assert.deepEqual(replyOf(turn), [workItemCommandText.ended('208')]);
  await ended.untouched();
});

test('a refused answer on a Work Item says why in a finished turn', { timeout: testTimeout(20_000) }, async t => {
  const f = await refusing(t, 'op-1', '208');
  const answer = f.dispatch(f.chat, { type: 'chat/inputCompleted', requestId: 'wi-208-requeue-gone', response: 'accept', answers: picked('restart') });
  assert.equal((await f.answered(answer)).params.rejectionReason, 'Unknown question');
  await f.turnEnded();
  const turn = f.seen().turns.at(-1);
  assert.deepEqual([turn.state, turn.message.text], ['complete', 'Your answer']);
  assert.deepEqual(replyOf(turn), ['Unknown question']);
  await f.untouched();
});

test('a refused Try Again keeps only its rejectionReason, which VS Code 1.142 reports as the failed request it resumes', { timeout: testTimeout(20_000) }, async t => {
  const f = await refusing(t, 'op-1', '208');
  const resume = f.dispatch(f.chat, { type: 'chat/turnResume', turnId: 'wi-208-round-1-1' });
  assert.equal((await f.answered(resume)).params.rejectionReason, workItemCommandText.withdrawn);
  await f.untouched();
  assert.deepEqual(f.seen(), f.snapshot, 'no second reply next to the one VS Code shows');
});

test('a Work Item session\'s Changes view claims no file it does not list: its catalogue is empty, in the session, its chat and each Run\'s chat', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const op = await f.attach('op-1');
  const summaries = workItemsOf(await f.listed(op));
  for (const id of ['202', '205']) {
    const resource = `unfold:/wi-${id}`;
    const summary = summaries.find(item => item.resource === resource)!;
    const session = (await op.rpc('subscribe', { channel: resource })).snapshot.state;
    for (const listed of session.chats as Json[]) {
      const chat = (await op.rpc('subscribe', { channel: listed.resource })).snapshot.state;
      const shown: Json[] = vscodeChangesets(chat, session);
      const listedFiles = shown.flatMap(changeset => changeset.files ?? []).length;
      assert.equal(listedFiles, summary.changes?.files ?? 0, 'the count it shows equals the files it lists');
      assert.deepEqual(shown, [], `#${id} ${listed.title}: no file is counted or listed`);
      assert.deepEqual(vscodeChangesetCatalogue(chat, session), [], `#${id} ${listed.title}: VS Code gets a catalogue, so it stops waiting for one and shows no earlier session's count`);
    }
  }
  assert.equal(summaries.find(item => item.resource === 'unfold:/wi-205')!.activity, 'Ready for review · PR #42', 'the pull request that holds the change is named');
});

test('a Work Item\'s chat opens its panel in the VS Code editor window the person\'s extension registered last, and in no other person\'s', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const op = await login(f.server.url, 'op-1', password);
  const register = (body: Json, cookie = op.cookie) => request(f.server.url, '/api/agent-host/editor-window', { method: 'PUT', cookie, body });
  const lead = async () => {
    const client = await f.attach('op-1');
    const chat = (await client.rpc('subscribe', { channel: defaultChatOf('unfold:/wi-205') })).snapshot.state;
    client.close();
    return chat.turns[0].responseParts.find((part: Json) => part.id === 'wi-205-open-elsewhere');
  };
  const pullRequest = '[Pull request #42 ↗](https://forge.invalid/pulls/42)';
  assert.deepEqual(await lead(), { kind: 'markdown', id: 'wi-205-open-elsewhere', content: `${pullRequest}\n\n` }, 'without a registered window or a public address only the pull request opens elsewhere');

  assert.equal((await register({ protocol: 'vscode', windowId: '3' })).status, 200);
  assert.equal((await register({ protocol: 'vscode', windowId: '7' })).status, 200, 'the window focused last replaces the one before');
  assert.deepEqual(await lead(), { kind: 'markdown', id: 'wi-205-open-elsewhere', content: `[Open the Work Item in VS Code](vscode://unfold-hq.unfold-workbench/work-item?id=205&windowId=7) · ${pullRequest}\n\n` });

  for (const body of [{ protocol: 'javascript', windowId: '7' }, { protocol: 'vscode', windowId: '7&id=1' }, { protocol: 'vscode' }]) {
    const refused = await register(body);
    assert.equal(refused.status, 400, refused.text);
    assert.equal(refused.body.error.code, 'invalid_editor_window');
  }
  const viewer = await login(f.server.url, 'viewer-2', password);
  assert.equal((await register({ protocol: 'vscode', windowId: '9' }, viewer.cookie)).status, 403, 'a viewer has no Agents window to link from');
  const peer = await f.attach('viewer-2');
  const seen = (await peer.rpc('subscribe', { channel: defaultChatOf('unfold:/wi-205') })).snapshot.state;
  assert.ok(!JSON.stringify(seen).includes('unfold-hq.unfold-workbench'), 'another person never gets the owner\'s window');

  const forgotten = await request(f.server.url, '/api/agent-host/editor-window', { method: 'DELETE', cookie: op.cookie });
  assert.deepEqual(forgotten.body, { forgotten: true });
  assert.equal((await lead()).content, `${pullRequest}\n\n`, 'signing out forgets the window');
});

test('a Work Item session\'s Agents window link goes to the people Ploeg lets open it, in their window\'s spelling', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  const op = await login(f.server.url, 'op-1', password);
  const link = async (id: string, cookie = op.cookie) => request(f.server.url, `/api/agent-host/work-items/${id}/link`, { cookie });
  const before = await link('205');
  assert.equal(before.status, 200, before.text);
  assert.equal(before.body.session, 'ahp-session:/wi-205');
  assert.equal(before.body.attached, false);
  assert.equal(before.body.links.stable, `vscode://agents/agent-host-session/ahp-session/wi-205?connectionAuthority=${agentHostAuthority(before.body.address)}`);
  await f.attach('op-1');
  const after = await link('205');
  assert.equal(after.body.attached, true);
  assert.equal(after.body.session, 'unfold:/wi-205', 'the session URI this person\'s 1.141-style Agents window lists');
  assert.ok(after.body.links.insiders.startsWith('vscode-insiders://agents/agent-host-session/unfold/wi-205?connectionAuthority='));
  assert.equal((await link('209')).status, 404, 'another team\'s Work Item has no link for this person');
  assert.equal((await link('210')).status, 404, 'an operator-owned Work Item is its Unfold session, not a Work Item session');
  assert.equal((await link('999')).status, 404);
  assert.equal((await link('wi-205')).status, 404, 'the id is Ploeg\'s Work Item id');
  const viewer = await login(f.server.url, 'viewer-2', password);
  assert.equal((await link('205', viewer.cookie)).status, 403, 'a viewer cannot attach an Agents window, so gets no link');
});

const knownSecret = 'test-admin-password-314159';
const runChatOf = (publicId: string, runId: string) => runChatChannel(`unfold:/${publicId}`, `ploeg-run-${runId}`);
const transcriptReads = (state: World, runId: string) => state.seen.filter(path => path.startsWith(`runs/${runId}/transcript`));

function runningBuilder(state: World): void {
  state.details.get('202')!.runs[0].keyAlias = 'ploeg-abc123';
  state.transcripts.set('301', [
    { seq: 1, at: minutesAgo(3), kind: 'message', text: 'Reading the order totals.' },
    { seq: 2, at: minutesAgo(2), kind: 'tool_call', toolCallId: 'call-1', title: 'Run the tests', toolKind: 'execute', status: 'in_progress', input: '{"command":"npm test"}' },
  ]);
  state.logRows.push(
    { _time: minutesAgo(3), _msg: `starting acp agent trace=ploeg-abc123 echo ${knownSecret}`, pod: 'sbx-ploeg-worker-delivery-builder-abc12-x1y2z', container: 'worker', traced: true },
    { _time: minutesAgo(2.5), _msg: 'sandbox claim ready', pod: 'ploeg-worker-delivery-builder-abc12-x1y2z', container: 'launcher', traced: false },
  );
}

test('a watched running Run shows its transcript and both pod logs in its chat, and a new entry past the cursor reaches the subscriber, redacted', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  runningBuilder(f.state);
  const op = await f.attach('op-1');
  await op.rpc('subscribe', { channel: 'unfold:/wi-202' });
  const channel = runChatOf('wi-202', '301');
  const chat = (await op.rpc('subscribe', { channel })).snapshot.state;
  const parts: Json[] = chat.activeTurn.responseParts;
  assert.equal(parts[0].content, liveRunNotice('Implementer', true), 'the notice says the transcript is live');
  const logs = parts.find(part => part.kind === 'toolCall' && part.toolCall.toolName === podLogsToolName)!.toolCall;
  assert.deepEqual(logs.content, [{ type: 'terminal', resource: 'ahp-terminal:/wi-202/301', title: 'Pod logs', isPty: false }]);
  assert.equal(typeof logs.toolInput, 'string', 'VS Code 1.142 attaches a terminal only to a tool call with a string input');
  assert.deepEqual(parts.filter(part => part.kind === 'markdown').map(part => part.content), ['Reading the order totals.']);
  const tests = parts.find(part => part.kind === 'toolCall' && part.toolCall.displayName === 'Run the tests')!.toolCall;
  assert.equal(tests.status, 'running');
  assert.equal(tests.toolInput, '{"command":"npm test"}');

  const terminal = (await op.rpc('subscribe', { channel: logs.content[0].resource })).snapshot.state;
  const output = terminal.content[0].value as string;
  assert.match(output, /\[sandbox\] starting acp agent/);
  assert.match(output, /\[worker\] sandbox claim ready/, 'the worker pod that claimed the sandbox is found by name');
  assert.ok(!output.includes(knownSecret) && output.includes('[redacted]'), 'a configured secret never reaches a pod-log terminal');
  assert.equal(terminal.lifecycle.status, 'running');

  f.state.transcripts.get('301')!.push(
    { seq: 3, at: minutesAgo(1), kind: 'tool_output', toolCallId: 'call-1', text: `ok 12 tests; printed ${knownSecret}` },
    { seq: 4, at: minutesAgo(1), kind: 'tool_call', toolCallId: 'call-1', title: 'Run the tests', toolKind: 'execute', status: 'completed' },
  );
  f.state.logRows.push({ _time: minutesAgo(0.5), _msg: 'npm test finished', pod: 'sbx-ploeg-worker-delivery-builder-abc12-x1y2z', container: 'worker', traced: true });
  await f.host.runLive.tick('202', '301');
  assert.ok(transcriptReads(f.state, '301').some(path => path.includes('after=2')), 'the poller reads after the cursor it reached');
  const completed = await op.until(message => action(message, channel, 'chat/toolCallComplete'));
  assert.equal(completed.params.action.toolCallId, tests.toolCallId);
  assert.equal(completed.params.action.result.success, true);
  assert.deepEqual(completed.params.action.result.content, [{ type: 'text', text: 'ok 12 tests; printed [redacted]' }]);
  const data = await op.until(message => action(message, 'ahp-terminal:/wi-202/301', 'terminal/data'));
  assert.match(data.params.action.data, /npm test finished\n$/);
  assert.ok(!data.params.action.data.includes('sandbox claim ready'), 'only lines past the log cursor are sent');
  assert.ok(!JSON.stringify(op.inbox).includes(knownSecret));
});

test('nothing polls a Run without a subscriber, one poller serves every viewer, and it stops when the last one leaves or the Run finishes', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  runningBuilder(f.state);
  const op = await f.attach('op-1');
  const viewer = await f.attach('viewer-2');
  await op.rpc('subscribe', { channel: 'unfold:/wi-202' });
  await f.host.workItems.tick();
  assert.equal(f.host.runLive.polling('202', '301'), false);
  assert.deepEqual(transcriptReads(f.state, '301'), [], 'a session subscriber alone reads no transcript');
  const channel = runChatOf('wi-202', '301');
  await op.rpc('subscribe', { channel });
  await viewer.rpc('subscribe', { channel });
  assert.equal(f.host.runLive.polling('202', '301'), true);
  const before = transcriptReads(f.state, '301').length;
  assert.equal(before, 1, 'the second viewer reuses the first one\'s read');
  await f.host.runLive.tick('202', '301');
  assert.equal(transcriptReads(f.state, '301').length, before + 1, 'one read per tick for two viewers');
  for (const client of [op, viewer]) client.notify('unsubscribe', { channel });
  await settled(op, viewer);
  await f.host.runLive.tick('202', '301');
  assert.equal(f.host.runLive.polling('202', '301'), false);
  assert.equal(transcriptReads(f.state, '301').length, before + 1, 'no read once nobody watches');

  await op.rpc('subscribe', { channel });
  await op.rpc('subscribe', { channel: 'ahp-terminal:/wi-202/301' });
  const run = f.state.details.get('202')!.runs[0];
  Object.assign(run, { state: 'finished', finishedAt: minutesAgo(0), outcome: 'pr_opened' });
  await f.host.runLive.tick('202', '301');
  assert.equal(f.host.runLive.polling('202', '301'), false, 'a finished Run is not read again');
  const exited = await op.until(message => action(message, 'ahp-terminal:/wi-202/301', 'terminal/exited'));
  assert.ok(exited);
  const open = await op.until(message => action(message, channel, 'chat/toolCallComplete') && message.params.action.result.success === false);
  assert.match(open.params.action.result.pastTenseMessage, /did not report a result before the Run ended/);
});

test('a Ploeg outage backs a Run\'s poller off and leaves the session list alone', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  runningBuilder(f.state);
  const op = await f.attach('op-1');
  await op.rpc('subscribe', { channel: runChatOf('wi-202', '301') });
  f.state.down = true;
  await f.host.runLive.tick('202', '301');
  assert.equal(f.host.runLive.polling('202', '301'), true, 'it keeps trying, later');
  assert.ok(workItemsOf(await f.listed(op)).length > 0, 'the Work Item sessions still list, stale');
  assert.ok((await f.listed(op)).some(item => item.title === 'An Unfold session'));
});

test('a viewer outside the Run\'s team gets neither its chat, its terminal nor its live output', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  runningBuilder(f.state);
  const op = await f.attach('op-1');
  const outsider = await f.attach('viewer-1');
  const leaving = await f.attach('viewer-2');
  await op.rpc('subscribe', { channel: 'ahp-terminal:/wi-202/301' });
  await assert.rejects(outsider.rpc('subscribe', { channel: 'ahp-terminal:/wi-202/301' }), (error: Json) => error.code === -32008, 'a Run someone of its team already watches stays hidden');
  await assert.rejects(outsider.rpc('subscribe', { channel: runChatOf('wi-202', '301') }), (error: Json) => error.code === -32001);
  await leaving.rpc('subscribe', { channel: 'ahp-terminal:/wi-202/301' });
  f.userTeams['viewer-2'] = [];
  f.state.logRows.push({ _time: minutesAgo(0.5), _msg: 'after the team changed', pod: 'sbx-ploeg-worker-delivery-builder-abc12-x1y2z', container: 'worker', traced: true });
  await f.host.runLive.tick('202', '301');
  await op.until(message => action(message, 'ahp-terminal:/wi-202/301', 'terminal/data'));
  await settled(leaving, outsider);
  assert.ok(!leaving.inbox.some(message => message.params?.channel === 'ahp-terminal:/wi-202/301'), 'a person who left the team gets no more output');
  assert.ok(!outsider.inbox.some(message => JSON.stringify(message).includes('after the team changed')));
});

const richTraceback = [
  'last agent message: Error starting the agent',
  '╭───────────────────── Traceback (most recent call last) ─────────────────────╮',
  '│ /root/.local/share/uv/tools/openhands/lib/python3.12/site-packages/openhands/cli/main.py:88 in run │',
  '│                                                                              │',
  '│ ❱  88 │   config = load_config()                                             │',
  '│ /root/.local/share/uv/tools/openhands/lib/python3.12/site-packages/openhands/sdk/mcp/config.py:41 in load_config │',
  '│ /root/.local/share/uv/tools/openhands/lib/python3.12/site-packages/pydantic/main.py:253 in __init__ │',
  '│ /root/.local/share/uv/tools/openhands/lib/python3.12/site-packages/pydantic/_internal/x.py:12 in validate │',
  '╰──────────────────────────────────────────────────────────────────────────────╯',
  'ValidationError: 6 validation errors for MCPConfig',
  'mcpServers.litellm.TransformingStdioMCPServer',
  "  Value error, At least one of 'tools', 'include_tags', or 'exclude_tags' is required [type=value_error]",
].join('\n');

test('a rich or plain traceback condenses to its exception, message and last frames, and other text is left alone', () => {
  const rich = condenseTraceback(richTraceback);
  assert.equal(rich.condensed, true);
  assert.deepEqual(rich.text.split('\n'), [
    'last agent message: Error starting the agent',
    'ValidationError: 6 validation errors for MCPConfig',
    'mcpServers.litellm.TransformingStdioMCPServer',
    "Value error, At least one of 'tools', 'include_tags', or 'exclude_tags' is required [type=value_error]",
    '',
    'Last frames:',
    '  sdk/mcp/config.py:41 in load_config',
    '  site-packages/pydantic/main.py:253 in __init__',
    '  pydantic/_internal/x.py:12 in validate',
  ]);
  assert.ok(!rich.text.includes('╭'));
  const plain = condenseTraceback('Traceback (most recent call last):\n  File "/app/run.py", line 3, in <module>\n    main()\n  File "/app/run.py", line 1, in main\n    raise KeyError("x")\nKeyError: \'x\'');
  assert.deepEqual(plain.text.split('\n'), ["KeyError: 'x'", '', 'Last frames:', '  /app/run.py:3 in <module>', '  /app/run.py:1 in main']);
  assert.deepEqual(condenseTraceback('acp agent did not start'), { text: 'acp agent did not start', condensed: false });
});

test('a failed Run\'s report shows the condensed traceback first and keeps the full output', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  Object.assign(f.state.details.get('204')!.runs[0], { outcome: 'failed', stuckReason: richTraceback, failureReason: 'agent_error' });
  const op = await f.attach('op-1');
  const chat = (await op.rpc('subscribe', { channel: defaultChatOf('unfold:/wi-204') })).snapshot.state;
  const run = chat.turns.flatMap((turn: Json) => turn.responseParts).find((part: Json) => part.kind === 'toolCall').toolCall;
  assert.match(run.error.message, /^last agent message: Error starting the agent · ValidationError: 6 validation errors for MCPConfig/);
  const report = (await op.rpc('subscribe', { channel: run.content[0].resource })).snapshot.state.turns[0].responseParts.find((part: Json) => part.kind === 'markdown').content as string;
  const condensedAt = report.indexOf('ValidationError: 6 validation errors');
  const fullAt = report.indexOf('**Full output**');
  assert.ok(condensedAt > 0 && fullAt > condensedAt, 'the condensed cause comes before the full output');
  assert.ok(report.slice(0, fullAt).includes('Last frames:') && !report.slice(0, fullAt).includes('╭'), 'no box drawing before the full output');
  assert.ok(report.slice(fullAt).includes('pydantic/_internal/x.py:12 in validate │'), 'the full text is still there');
});

test('every client action on a Run\'s pod-log terminal is refused as read-only, with no chat reply, and a message in the Run\'s chat gets its refusal as a reply', { timeout: testTimeout(20_000) }, async t => {
  const f = await fixture(t);
  runningBuilder(f.state);
  const op = await f.attach('op-1');
  const terminal = 'ahp-terminal:/wi-202/301';
  const channel = runChatOf('wi-202', '301');
  await op.rpc('subscribe', { channel: terminal });
  await op.rpc('subscribe', { channel });
  op.notify('dispatchAction', { channel: terminal, clientSeq: 1, action: { type: 'terminal/input', data: 'rm -rf /\r' } });
  const refused = await op.until(message => action(message, terminal, 'terminal/input'));
  assert.equal(refused.params.rejectionReason, readOnlyTerminal);
  const unwatched = 'ahp-terminal:/wi-209/1';
  op.notify('dispatchAction', { channel: unwatched, clientSeq: 3, action: { type: 'terminal/input', data: 'ls\r' } });
  assert.equal((await op.until(message => action(message, unwatched, 'terminal/input'))).params.rejectionReason, 'Terminal not found', 'a terminal the person does not watch is not confirmed to exist');
  op.notify('dispatchAction', { channel, clientSeq: 2, action: { type: 'chat/turnStarted', turnId: 'mine-1', message: { text: 'go faster', origin: { kind: 'user' } } } });
  const reply = await op.until(message => action(message, channel, 'chat/responsePart'));
  assert.match(reply.params.action.part.content, /read-only/);
  await settled(op);
  assert.ok(!op.inbox.some(message => message.params?.channel === terminal && message.params.action?.type !== 'terminal/input'), 'nothing but the refusal on the terminal');
});

const usageSpelling = { session: 'unfold:/wi-220', chat: 'ahp-chat://unfold/wi-220' };
function usageDetail(usage: Record<string, Json | null>, shape: Partial<Shape> = {}) {
  const raw = workItem('220', { state: 'awaiting_review', pullRequest: 44, runs: [{ id: '311', role: 'implementer', round: 1 }, { id: '312', role: 'reviewer', round: 1 }, { id: '313', role: 'reviewer', round: 2 }], ...shape });
  for (const run of raw.runs) { run.usage = usage[run.id] ?? null; run.costStatus = run.usage?.costUsd === undefined ? 'unknown' : 'observed'; }
  return parseDetail({ schemaVersion: '1.0', ...raw });
}
const roundTurns = (parsed: ReturnType<typeof parseDetail>) => {
  const entry = { workItemId: parsed.item.id, publicId: workItemSessionId(parsed.item.id), item: parsed.item, activity: workItemActivity(parsed.item), stale: false };
  return workItemChatState(entry, parsed, usageSpelling, { session: 0, chat: 0 });
};
const reported = (input: number, output: number, extra: Json = {}) => ({ inputTokens: input, outputTokens: output, costUsd: 0.1, ...extra });

test('a finished Round shows the summed tokens its Runs reported, cache reads and one shared model only when Ploeg reports them, and a Round without reported usage shows none', () => {
  const sonnet = { 'claude-sonnet-4-5': { inputTokens: 1 } };
  const chat = roundTurns(usageDetail({ '311': reported(1200, 300, { cacheReadInputTokens: 5000, modelUsage: sonnet }), '312': reported(800, 100, { cacheReadInputTokens: 2000, modelUsage: sonnet }) }));
  assert.deepEqual(chat.turns.map((turn: Json) => turn.usage), [undefined, { inputTokens: 2000, outputTokens: 400, cacheReadTokens: 7000, model: 'claude-sonnet-4-5' }, undefined], 'Round 2 has a Run whose usage Ploeg has not reported: no usage, not zero');
  const mixed = roundTurns(usageDetail({ '311': reported(1200, 300, { cacheReadInputTokens: 5000, modelUsage: sonnet }), '312': reported(800, 100, { modelUsage: { 'claude-opus-4-1': {} } }) }));
  assert.deepEqual(mixed.turns[1].usage, { inputTokens: 2000, outputTokens: 400 }, 'two models name none, and a Run without cache reads leaves them out');
  const several = roundTurns(usageDetail({ '311': reported(1, 2, { modelUsage: { ...sonnet, 'claude-haiku-4-5': {} } }), '312': reported(3, 4, { modelUsage: sonnet }) }));
  assert.equal(several.turns[1].usage.model, undefined, 'a Run that reports more than one model names none');
  const partial = roundTurns(usageDetail({ '311': reported(1200, 300), '312': { costUsd: 0.1 } }));
  assert.equal(partial.turns[1].usage, undefined, 'a Run without token counts leaves the Round without usage');
});

test('a Ploeg Run\'s own chat names the harness Ploeg reported for it, and no harness when Ploeg reported none', () => {
  const raw = workItem('220', { state: 'awaiting_review', pullRequest: 44, runs: [{ id: '311', role: 'implementer', round: 1 }, { id: '312', role: 'reviewer', round: 1 }, { id: '313', role: 'reviewer', round: 2 }] });
  const run = (id: string) => raw.runs.find((entry: Json) => entry.id === id);
  run('311').harness = 'claude-code';
  run('312').harness = 'Not A Harness!';
  delete run('313').harness;
  const parsed = parseDetail({ schemaVersion: '1.0', ...raw });
  const heading = (runId: string) => workItemRunChatState(parsed, `ploeg-run-${runId}`, usageSpelling)!.turns[0].message.text;
  assert.equal(heading('311'), 'Implementer · Round 1 · harness claude-code');
  assert.equal(heading('312'), 'Reviewer · Round 1', 'a harness value Unfold cannot read names none');
  assert.equal(heading('313'), 'Reviewer · Round 2', 'a Ploeg that reports no harness gets no harness line');
});

test('a Round still running and a deterministic demo Work Item show no usage', () => {
  const running = usageDetail({ '311': reported(1200, 300) }, { state: 'leased', runs: [{ id: '311', role: 'implementer', round: 1 }, { id: '312', role: 'reviewer', round: 1, state: 'running' }] });
  const chat = roundTurns(running);
  assert.equal(chat.activeTurn.usage, undefined);
  const demo = usageDetail({ '311': reported(1200, 300), '312': reported(800, 100), '313': reported(1, 1) });
  assert.ok(roundTurns({ ...demo, demo: true }).turns.every((turn: Json) => turn.usage === undefined), 'no model was called, so no usage is shown');
  assert.ok(!workItemTranscriptActions({ ...running, demo: true }, { ...demo, demo: true }, usageSpelling).some(routed => routed.action.type === 'chat/usage'));
});

test('a Round that finishes between two reads reports its usage before the turn completes', () => {
  const before = usageDetail({ '311': reported(1200, 300) }, { state: 'leased', runs: [{ id: '311', role: 'implementer', round: 1 }, { id: '312', role: 'reviewer', round: 1, state: 'running' }] });
  const after = usageDetail({ '311': reported(1200, 300), '312': reported(800, 100) }, { state: 'leased', runs: [{ id: '311', role: 'implementer', round: 1 }, { id: '312', role: 'reviewer', round: 1 }, { id: '313', role: 'reviewer', round: 2, state: 'running' }] });
  const chat = workItemTranscriptActions(before, after, usageSpelling).filter(routed => routed.to === 'chat').map(routed => routed.action);
  const usage = chat.findIndex(action => action.type === 'chat/usage');
  assert.deepEqual(chat[usage], { type: 'chat/usage', turnId: 'wi-220-round-1-1', usage: { inputTokens: 2000, outputTokens: 400 } });
  assert.equal(chat[usage + 1].type, 'chat/turnComplete');
  assert.equal(chat.filter(action => action.type === 'chat/usage').length, 1, 'the Round still running reports none');
});
