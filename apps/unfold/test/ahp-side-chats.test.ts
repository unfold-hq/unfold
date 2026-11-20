import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PloegError } from '../src/ploeg.ts';
import { sideChatText, sideChatWithoutContextMeta } from '../src/ahp/side-chats.ts';
import type { ChatAskService } from '../src/ahp/asks.ts';
import type { Ask } from '../src/ask/types.ts';
import { money } from '../public/core/format.js';
import { action, connect, defaultChatOf, type Json } from './ahp-support.ts';
import { commanding, picked, type Write } from './ahp-work-items-support.ts';
import { testTimeout } from './timeframes.ts';

const askAllowance = { limitUsd: 5, settledUsd: 0.4, heldUsd: 0.02, remainingUsd: 4.58, resetAt: '2026-12-01T00:00:00Z', askCount: 12, askBudgetUsd: 0.02, asksEnabled: true };
const standingQuestion = 'What did it cost so far?';
const modelAnswer = 'It waits for the Reviewer of Round 2.';

async function sideChatting(t: TestContext, publicId: string) {
  const f = await commanding(t);
  const asked: Array<{ workItemId: string; question: string; request: Json | null }> = [];
  const service: ChatAskService = {
    async ask(user, workItemId, question, _audience, request) {
      asked.push({ workItemId, question: String(question), request: request ?? null });
      const record = question === standingQuestion;
      if (!record && request?.recordOnly) throw new PloegError(409, 'ask_needs_model', 'The record does not answer this question. Asking a model would spend from the Ask Allowance.');
      const ask: Ask = { id: `ask-${asked.length}`, workItemId, workItemTitle: `Work Item ${workItemId}`, askerId: user.id, askerName: user.name, audience: 'internal', question: String(question), answer: record ? 'Nothing was spent on it yet.' : modelAnswer, status: 'answered', demo: false, ploegAskId: record ? null : `p-${asked.length}`, model: record ? null : 'ask-model', costUsd: record ? 0 : 0.0123, costStatus: record ? 'settled' : 'provisional', failure: null, source: record ? 'record' : 'model', intent: null, createdAt: new Date().toISOString(), answeredAt: new Date().toISOString() };
      f.server.app.store.saveAsk(ask);
      return ask;
    },
    async about() { return { asks: [], allowance: askAllowance }; },
  };
  f.host.useAsks(service);
  const session = `unfold:/${publicId}`;
  const chat = `ahp-chat://side-1/${Buffer.from(session).toString('base64url')}`;
  await f.client.rpc('subscribe', { channel: session });
  const open = (selection?: Json) => f.client.rpc('createChat', { channel: session, chat, source: { kind: 'sideChat', chat: defaultChatOf(session), turnId: `${publicId}-round-1-1`, ...(selection ? { selection } : {}) }, _meta: { [sideChatWithoutContextMeta]: true } });
  const ask = (text: string, turnId: string) => f.dispatch(chat, { type: 'chat/turnStarted', turnId, message: { text, origin: { kind: 'user' } } });
  const done = (turnId: string) => f.client.until(message => action(message, chat, 'chat/turnComplete') && message.params.action.turnId === turnId);
  return { ...f, asked, session, chat, open, ask, done };
}

test('VS Code 1.147 may open a side chat on a Work Item session, which lists beside its chat, while Unfold\'s own sessions keep exactly one chat', { timeout: testTimeout(20_000) }, async t => {
  const f = await sideChatting(t, 'wi-205');
  const fresh = connect(`${f.server.url.replace(/^http/, 'ws')}/?tkn=${f.host.issueToken({ id: 'op-1', name: 'op-1', role: 'operator' })}`);
  t.after(() => fresh.close());
  await fresh.open;
  const initialized = await fresh.rpc('initialize', { channel: 'ahp-root://', protocolVersions: ['0.9.0'], clientId: 'side-chat-probe', clientInfo: { name: 'vscode-agents-window' }, _meta: { 'vscode.ahpSessionUris': true, 'vscode.ahpChatUris': true }, initialSubscriptions: ['ahp-root://'] });
  assert.equal(initialized._meta[sideChatWithoutContextMeta], true, 'VS Code 1.147 refuses a side chat without source context unless the host says so');
  const agent = initialized.snapshots[0].state.agents.find((entry: Json) => entry.provider === 'unfold');
  assert.deepEqual(agent.capabilities, { multipleChats: { sideChat: true } }, 'VS Code offers a side chat only on an agent that advertises it');

  assert.deepEqual(await f.open(), {});
  const added = await f.client.until(message => action(message, f.session, 'session/chatAdded'));
  assert.deepEqual(added.params.action.summary, { resource: f.chat, title: sideChatText.title('205'), status: 1, modifiedAt: added.params.action.summary.modifiedAt, origin: { kind: 'sideChat', chat: defaultChatOf(f.session), turnId: 'wi-205-round-1-1' }, interactivity: 'full' });
  const sessionState = (await f.client.rpc('subscribe', { channel: f.session })).snapshot.state;
  assert.equal(sessionState.defaultChat, defaultChatOf(f.session), 'the Work Item\'s own chat stays the default');
  assert.deepEqual(sessionState.chats.map((chat: Json) => chat.origin.kind), ['user', 'tool', 'tool', 'sideChat']);
  const chatState = (await f.client.rpc('subscribe', { channel: f.chat })).snapshot.state;
  assert.deepEqual(chatState.turns, []);

  await assert.rejects(f.client.rpc('createChat', { channel: f.session, chat: f.chat.replace('side-1', 'side-2'), source: { kind: 'sideChat', chat: defaultChatOf(f.session), turnId: 't' }, _meta: { [sideChatWithoutContextMeta]: 'yes' } }), /side-chat context metadata/);
  const own = `unfold:/${f.unfoldSession.id}`;
  await assert.rejects(f.client.rpc('createChat', { channel: own, chat: `ahp-chat://side-3/${Buffer.from(own).toString('base64url')}`, source: { kind: 'sideChat', chat: defaultChatOf(own), turnId: 't' } }), /exactly one chat/);
  await assert.rejects(f.client.rpc('createChat', { channel: f.session, chat: f.chat.replace('side-1', 'side-4') }), /no such session/, 'a Work Item still opens no other chat');
});

test('a question in a side chat is asked through Ask only after the person confirms what it may spend, and nothing reaches the Team', { timeout: testTimeout(20_000) }, async t => {
  const f = await sideChatting(t, 'wi-202');
  await f.open();
  const free = f.ask(standingQuestion, 'side-turn-1');
  assert.equal((await f.answered(free)).params.rejectionReason, undefined);
  await f.done('side-turn-1');
  assert.deepEqual(f.state.writes, [], 'the question reached no note, restart or command in Ploeg');
  assert.deepEqual(f.asked.map(entry => entry.request), [{ recordOnly: true }], 'a question the record answers asks no model and asks for no confirmation');

  const question = 'Why is it still running after an hour?';
  f.ask(question, 'side-turn-2');
  const requested = await f.requested(f.chat);
  assert.match(requested.params.action.request.message, /^Ask a model about #202\?$/);
  const explained = await f.replied(f.chat, /^The record does not answer this/);
  const shown = (usd: number) => money(usd).replaceAll('$', '\\$');
  assert.ok(explained.params.action.part.content.includes(`spends up to ${shown(0.02)} from delivery's Ask Allowance, ${shown(4.58)} of ${shown(5)} left`), explained.params.action.part.content);
  assert.deepEqual(f.asked.map(entry => entry.request), [{ recordOnly: true }, { recordOnly: true }], 'nothing is asked of a model before the confirmation');
  f.dispatch(f.chat, { type: 'chat/inputCompleted', requestId: requested.params.action.request.id, response: 'accept', answers: picked('ask') });
  const answer = await f.client.until(message => action(message, f.chat, 'chat/responsePart') && message.params.action.turnId === 'side-turn-2' && /^\*\*Ask\*\* · not sent to the team/.test(message.params.action.part.content));
  assert.match(answer.params.action.part.content, new RegExp(modelAnswer));
  await f.done('side-turn-2');
  assert.deepEqual(f.asked.at(-1), { workItemId: '202', question, request: { model: true } });

  assert.deepEqual(f.state.writes, [], 'no note, restart, answer or cancel reached Ploeg: the Team never reads a side chat');
  const workItemChat = (await f.client.rpc('subscribe', { channel: defaultChatOf(f.session) })).snapshot.state;
  assert.ok(!JSON.stringify(workItemChat).includes(question), 'the Work Item\'s own chat does not show the question');
  const sideState = (await f.client.rpc('subscribe', { channel: f.chat })).snapshot.state;
  assert.deepEqual(sideState.turns.map((turn: Json) => [turn.message.text, turn.state]), [[standingQuestion, 'complete'], [question, 'complete']], 'the side chat keeps its Asks');

  const note = f.dispatch(defaultChatOf(f.session), { type: 'chat/turnStarted', turnId: 'note-after-side', message: { text: 'Use the decimal rounding helper.', origin: { kind: 'user' } } });
  assert.equal((await f.answered(note)).params.rejectionReason, undefined);
  await f.replied(defaultChatOf(f.session), /^Saved for the next Round/);
  assert.deepEqual((f.state.writes as Write[]).map(write => write.path), ['work-items/202/notes'], 'the Work Item\'s own chat still saves a note as before');
});

test('declining the spend confirmation in a side chat asks nothing, spends nothing and says how to ask in Unfold', { timeout: testTimeout(20_000) }, async t => {
  const f = await sideChatting(t, 'wi-204');
  await f.open();
  f.ask('Which file did the implementer get stuck on?', 'side-turn-1');
  const requested = await f.requested(f.chat);
  f.dispatch(f.chat, { type: 'chat/inputCompleted', requestId: requested.params.action.request.id, response: 'accept', answers: picked('keep') });
  const declined = await f.replied(f.chat, /^Not asked, so nothing was spent\./);
  assert.match(declined.params.action.part.content, /ask in Unfold instead/i);
  await f.done('side-turn-1');

  f.ask('And why did it stop?', 'side-turn-2');
  await f.client.until(message => action(message, f.chat, 'chat/inputRequested') && message.params.action.request.id === 'side-turn-2-confirm');
  f.dispatch(f.chat, { type: 'chat/turnCancelled', turnId: 'side-turn-2' });
  await f.done('side-turn-2');
  assert.ok(f.asked.every(entry => entry.request?.recordOnly), 'only the free record was read');
  assert.deepEqual(f.state.writes, []);
});

test('a side chat on a workbench without Ask says so on the first message and spends nothing', { timeout: testTimeout(20_000) }, async t => {
  const f = await sideChatting(t, 'wi-202');
  f.host.useAsks(undefined);
  await f.open();
  f.ask('Why is it still running?', 'side-turn-1');
  await f.replied(f.chat, /^Asking is not set up on this workbench, so nothing was asked or spent\./);
  await f.done('side-turn-1');
  assert.deepEqual(f.asked, []);
  assert.deepEqual(f.state.writes, []);
  const refused = f.dispatch(f.chat, { type: 'chat/turnResume', turnId: 'side-turn-1' });
  assert.equal((await f.answered(refused)).params.rejectionReason, sideChatText.readOnly);
});

test('what the person had selected when opening a side chat goes to Ask with each question as its context', { timeout: testTimeout(20_000) }, async t => {
  const f = await sideChatting(t, 'wi-205');
  const selection = 'Rounded half up in the order totals.';
  await f.open({ text: selection, responsePartId: 'part-7' });
  f.ask(standingQuestion, 'side-turn-1');
  await f.done('side-turn-1');
  const question = 'Why half up and not to even?';
  f.ask(question, 'side-turn-2');
  const requested = await f.requested(f.chat);
  f.dispatch(f.chat, { type: 'chat/inputCompleted', requestId: requested.params.action.request.id, response: 'accept', answers: picked('ask') });
  await f.done('side-turn-2');
  assert.deepEqual(f.asked, [
    { workItemId: '205', question: standingQuestion, request: { recordOnly: true, selection } },
    { workItemId: '205', question, request: { recordOnly: true, selection } },
    { workItemId: '205', question, request: { model: true, selection } },
  ]);
  assert.deepEqual(f.state.writes, [], 'the selection reaches Ask only, never the Team');
});

test('a side chat kept across a restart opens before the session list, and only for a person Ploeg and the team map still let see its Work Item', { timeout: testTimeout(40_000) }, async t => {
  const f = await sideChatting(t, 'wi-205');
  await f.open();
  f.ask(standingQuestion, 'side-turn-1');
  await f.done('side-turn-1');
  await f.server.restart();
  const host = f.server.app.agentHost;
  host.workItems.pollMs = 3_600_000;
  host.workItems.reconcileMs = 3_600_000;
  host.runLive.pollMs = 3_600_000;
  const person = { id: 'op-1', name: 'op-1', role: 'operator' } as const;
  const client = connect(`${f.server.url.replace(/^http/, 'ws')}/?tkn=${host.issueToken(person)}`);
  t.after(() => client.close());
  await client.open;
  await client.rpc('initialize', { channel: 'ahp-root://', protocolVersions: ['0.9.0'], clientId: 'side-chat-after-restart', clientInfo: { name: 'vscode-agents-window' }, _meta: { 'vscode.ahpSessionUris': true, 'vscode.ahpChatUris': true }, initialSubscriptions: ['ahp-root://'] });
  assert.equal(host.workItems.remembered(person, 'wi-205'), undefined, 'the restarted host has not listed the Work Item to this person');

  const kept = f.state.details.get('205')!;
  f.state.details.delete('205');
  await assert.rejects(client.rpc('subscribe', { channel: f.chat }), /no such chat, or it is not yours/, 'a Work Item Ploeg no longer shows this person hides its side chat');
  f.state.details.set('205', kept);
  f.userTeams['op-1'] = [];
  await assert.rejects(client.rpc('subscribe', { channel: f.chat }), /no such chat, or it is not yours/, 'a person no longer in the Work Item\'s Team cannot open its side chat');
  f.userTeams['op-1'] = ['delivery'];

  const state = (await client.rpc('subscribe', { channel: f.chat })).snapshot.state;
  assert.equal(state.title, sideChatText.title('205'));
  assert.deepEqual(state.turns.map((turn: Json) => [turn.message.text, turn.state]), [[standingQuestion, 'complete']], 'the side chat opens with its Asks before any session list');
});
