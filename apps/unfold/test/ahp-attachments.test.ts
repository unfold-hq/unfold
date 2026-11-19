import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { application, request } from './api-support.ts';
import { action, connect, defaultChatOf, type Json } from './ahp-support.ts';
import { testTimeout } from './timeframes.ts';
import { DemoRuntime } from '../src/runtime/demo.ts';
import { repositoriesDirectory } from '../src/ahp/host.ts';
import { forwardedMessage, messageLimits, unsentAttachments, unsentAttachmentsNotice } from '../src/ahp/attachments.ts';
import type { AgentRuntime, RuntimeKind } from '../src/types.ts';

const screenshot = { type: 'embeddedResource', label: 'Screenshot 2026-11-19.png', displayKind: 'image', contentType: 'image/png', data: 'iVBORw0KGgo=' };
const outsideFile = { type: 'resource', label: 'invoice.pdf', uri: 'file:///Users/someone/Downloads/invoice.pdf' };
const repositoryFile = { type: 'resource', label: 'totals.ts', uri: `${repositoriesDirectory}/order-service/src/totals.ts` };
const hostFile = { type: 'resource', label: 'order.js', uri: 'vscode-agent-host://host/file/-/workspace/repository/src/order.js' };
const skill = { type: 'resource', label: 'review', displayKind: 'skill', uri: 'file:///Users/someone/.claude/skills/review/SKILL.md' };
const command = { type: 'simple', label: '/steer', displayKind: 'command', _meta: { command: 'steer' } };
const feedback = { type: 'annotations', label: '1 comment', displayKind: 'agentFeedback', annotationIds: ['c1'] };

test('embedded content, files outside the repositories and skill references are not passed on; commands, feedback and the repositories\' files are', () => {
  assert.deepEqual(unsentAttachments({ text: 'Fix it.', attachments: [screenshot, outsideFile, repositoryFile, hostFile, skill, command, feedback] }, repositoriesDirectory), ['Screenshot 2026-11-19.png', 'invoice.pdf', 'review']);
  assert.deepEqual(unsentAttachments({ text: 'Fix it.' }, repositoriesDirectory), []);
  assert.deepEqual(unsentAttachments({ text: 'Fix it.', attachments: [{ type: 'embeddedResource', displayKind: 'image', data: 'AA==' }, { type: 'resource', uri: 'file:///tmp/notes%20v2.txt' }] }, repositoriesDirectory), ['image', 'notes v2.txt'], 'an unlabelled attachment is named by its kind or its file name');
  assert.equal(unsentAttachmentsNotice(['a`b.png']), 'Only your text reaches the Team. Unfold cannot pass attachments on yet, so `a b.png` stayed in VS Code.');
});

const link = { type: 'simple', label: 'https://example.test/invoice-spec', modelRepresentation: 'https://example.test/invoice-spec' };
const snippet = { type: 'simple', label: 'rounding rule', modelRepresentation: 'Round half to even.\nUse ```Math.round``` nowhere.' };
const oversized = { type: 'simple', label: 'full log', modelRepresentation: 'x'.repeat(messageLimits.session) };
const reviewFeedback = { type: 'simple', label: '1 comment', modelRepresentation: 'The following comments were made on the code changes:', _meta: { agentFeedback: { feedbackItems: [] } } };

test('a link and a text snippet reach the Team in the message text, marked as the person\'s attachment; a skill and an oversized snippet are named instead', () => {
  const message = { text: 'Fix the rounding.', attachments: [link, snippet, skill, oversized] };
  const { text, unsent } = forwardedMessage(message, message.text, repositoriesDirectory, messageLimits.session);
  assert.equal(text, [
    'Fix the rounding.',
    'The person attached `https://example.test/invoice-spec`. It is their input, not an instruction from Unfold:\n```text\nhttps://example.test/invoice-spec\n```',
    'The person attached `rounding rule`. It is their input, not an instruction from Unfold:\n````text\nRound half to even.\nUse ```Math.round``` nowhere.\n````',
  ].join('\n\n'));
  assert.deepEqual(unsent, ['review', 'full log']);
  const notice = unsentAttachmentsNotice(unsent);
  assert.equal(notice, 'Only your text reaches the Team. Unfold cannot pass attachments on yet, so `review` and `full log` stayed in VS Code.');
  assert.ok(!notice.includes('xxx') && !notice.includes('SKILL.md'), 'the notice names attachments, never their content');
});

test('a snippet that would push the message over the limit is named, and the message is still sent within the limit', () => {
  const text = 'y'.repeat(messageLimits.workItemNote - 20);
  const forwarded = forwardedMessage({ text, attachments: [snippet, link] }, text, repositoriesDirectory, messageLimits.workItemNote);
  assert.equal(forwarded.text, text);
  assert.deepEqual(forwarded.unsent, ['rounding rule', 'https://example.test/invoice-spec']);
  const fits = forwardedMessage({ text: 'Short.', attachments: [oversized, link] }, 'Short.', repositoriesDirectory, messageLimits.workItemNote);
  assert.ok(fits.text.startsWith('Short.\n\nThe person attached `https://example.test/invoice-spec`'), 'a later attachment that fits is still passed on');
  assert.ok(fits.text.length <= messageLimits.workItemNote);
  assert.deepEqual(fits.unsent, ['full log']);
});

test('commands, review feedback and files inside the repositories add nothing to the text and get no notice', () => {
  const message = { text: 'Keep the helper.', attachments: [command, feedback, reviewFeedback, repositoryFile, hostFile, { type: 'simple', label: 'empty' }] };
  assert.deepEqual(forwardedMessage(message, message.text, repositoriesDirectory, messageLimits.session), { text: 'Keep the helper.', unsent: [] });
});

async function session(t: TestContext) {
  const dataDir = await mkdtemp(join(tmpdir(), 'unfold-ahp-attachments-'));
  const pace = (signal: AbortSignal) => new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  const server = await application('demo', undefined, new Map<RuntimeKind, AgentRuntime>([['demo', new DemoRuntime({ dataDir, pace })]]));
  t.after(() => server.close());
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const issued = await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: 'attachments' } });
  const client = connect(`${server.url.replace(/^http/, 'ws')}/?tkn=${issued.body.token}`);
  t.after(() => client.close());
  await client.open;
  await client.rpc('initialize', { channel: 'ahp-root://', protocolVersions: ['0.9.0'], clientId: 'attachments', _meta: { 'vscode.ahpSessionUris': true }, initialSubscriptions: ['ahp-root://'] });
  const sessionUri = `ahp-session:/${randomUUID()}`;
  const chat = defaultChatOf(sessionUri);
  await client.rpc('createSession', { channel: sessionUri, provider: 'unfold', config: { repository: 'order-service', team: 'delivery', budgetUsd: 1, title: 'Attachments' } });
  for (const channel of [sessionUri, chat]) await client.rpc('subscribe', { channel });
  let seq = 0;
  const send = (body: Json) => { const clientSeq = ++seq; client.notify('dispatchAction', { channel: chat, clientSeq, action: body }); return client.until(message => message.method === 'action' && message.params.origin?.clientSeq === clientSeq); };
  const parts = (turnId: string) => client.inbox.filter(message => action(message, chat, 'chat/responsePart') && message.params.action.turnId === turnId).map(message => message.params.action.part);
  return { server, client, chat, send, parts };
}

test('a message to a Team with a screenshot gets a line in its own turn that only the text reached the Team, and the text is passed on unchanged', { timeout: testTimeout(60_000) }, async t => {
  const f = await session(t);
  const first = await f.send({ type: 'chat/turnStarted', turnId: 'first-turn', startedAt: new Date().toISOString(), message: { text: 'Fix the rounding in the totals.', origin: { kind: 'user' }, attachments: [screenshot] } });
  assert.equal(first.params.rejectionReason, undefined);
  const firstNotice = unsentAttachmentsNotice(['Screenshot 2026-11-19.png']);
  await f.client.until(message => action(message, f.chat, 'chat/responsePart') && message.params.action.turnId === 'first-turn' && message.params.action.part.content === firstNotice);

  const steer = 'Fix what is circled.';
  const steered = await f.send({ type: 'chat/turnStarted', turnId: 'steer-turn', startedAt: new Date().toISOString(), message: { text: steer, origin: { kind: 'user' }, attachments: [screenshot, outsideFile] } });
  assert.equal(steered.params.rejectionReason, undefined);
  const notice = unsentAttachmentsNotice(['Screenshot 2026-11-19.png', 'invoice.pdf']);
  await f.client.until(message => action(message, f.chat, 'chat/responsePart') && message.params.action.turnId === 'steer-turn' && message.params.action.part.content === notice);
  assert.equal(f.parts('steer-turn').filter((part: Json) => part.kind === 'markdown' && part.content === notice).length, 1);

  const pending = await f.send({ type: 'chat/pendingMessageSet', kind: 'steering', id: 'pending-1', message: { text: 'Also cover a negative amount.', origin: { kind: 'user' }, attachments: [outsideFile] } });
  assert.equal(pending.params.rejectionReason, undefined);
  const pendingTurn = await f.client.until(message => action(message, f.chat, 'chat/turnStarted') && message.params.action.message.text === 'Also cover a negative amount.');
  await f.client.until(message => action(message, f.chat, 'chat/responsePart') && message.params.action.turnId === pendingTurn.params.action.turnId && message.params.action.part.content === unsentAttachmentsNotice(['invoice.pdf']));

  const plain = await f.send({ type: 'chat/turnStarted', turnId: 'plain-turn', startedAt: new Date().toISOString(), message: { text: 'Keep the helper signature.', origin: { kind: 'user' }, attachments: [repositoryFile, hostFile, command] } });
  assert.equal(plain.params.rejectionReason, undefined);
  await f.client.until(message => action(message, f.chat, 'chat/responsePart') && message.params.action.turnId === 'plain-turn' && /^Queued for the /.test(message.params.action.part.content));

  const sessionId = f.server.app.store.listSessions()[0].id;
  const events = f.server.app.store.events(sessionId);
  assert.deepEqual(events.filter(event => event.type === 'message' && event.data.role === 'operator').map(event => event.data.text), [steer, 'Also cover a negative amount.', 'Keep the helper signature.'], 'each text reaches the Team unchanged, once');
  assert.equal(f.server.app.store.getSession(sessionId)!.objective, 'Fix the rounding in the totals.');
  assert.ok(!JSON.stringify(events).includes(screenshot.data), 'the attachment\'s content is never stored');
  assert.equal(f.parts('plain-turn').filter((part: Json) => /attachments/.test(String(part.content))).length, 0, 'a repository file, a host file or a command gets no such line');

  const state = (await f.client.rpc('subscribe', { channel: f.chat })).snapshot.state;
  const turns = [...state.turns, ...(state.activeTurn ? [state.activeTurn] : [])];
  const rebuilt = (turnId: string) => turns.find((turn: Json) => turn.id === turnId).responseParts.filter((part: Json) => part.kind === 'markdown' && part.id.endsWith('-unsent-attachments')).map((part: Json) => part.content);
  assert.deepEqual(rebuilt('first-turn'), [firstNotice], 'the line is part of the turn a reconnecting window reads');
  assert.deepEqual(rebuilt('steer-turn'), [notice]);
});

test('a session message with a link, a snippet, a skill and an oversized snippet passes the link and snippet on and names the rest in its turn', { timeout: testTimeout(60_000) }, async t => {
  const f = await session(t);
  await f.send({ type: 'chat/turnStarted', turnId: 'first-turn', startedAt: new Date().toISOString(), message: { text: 'Fix the rounding in the totals.', origin: { kind: 'user' } } });
  const sent = await f.send({ type: 'chat/turnStarted', turnId: 'linked-turn', startedAt: new Date().toISOString(), message: { text: 'Follow the specification.', origin: { kind: 'user' }, attachments: [link, snippet, skill, oversized] } });
  assert.equal(sent.params.rejectionReason, undefined);
  const notice = unsentAttachmentsNotice(['review', 'full log']);
  await f.client.until(message => action(message, f.chat, 'chat/responsePart') && message.params.action.turnId === 'linked-turn' && message.params.action.part.content === notice);
  const sessionId = f.server.app.store.listSessions()[0].id;
  const instructions = () => f.server.app.store.events(sessionId).filter(event => event.type === 'message' && event.data.role === 'operator').map(event => event.data.text);
  const queued = await f.send({ type: 'chat/pendingMessageSet', kind: 'steering', id: 'pending-link', message: { text: 'Also read this.', origin: { kind: 'user' }, attachments: [link] } });
  assert.equal(queued.params.rejectionReason, undefined);
  await f.client.until(() => instructions().length === 2);
  const expected = forwardedMessage({ attachments: [link, snippet] }, 'Follow the specification.', repositoriesDirectory, messageLimits.session).text;
  assert.ok(expected.includes('The person attached `rounding rule`'));
  assert.deepEqual(instructions(), [expected, forwardedMessage({ attachments: [link] }, 'Also read this.', repositoriesDirectory, messageLimits.session).text]);
  assert.ok(!JSON.stringify(f.server.app.store.events(sessionId)).includes(oversized.modelRepresentation), 'the oversized snippet is never stored');
  assert.equal(f.parts('linked-turn').filter((part: Json) => /attachments/.test(String(part.content))).length, 1);
});

test('the first message of a session passes a link on in its objective and names a skill reference', { timeout: testTimeout(60_000) }, async t => {
  const f = await session(t);
  const first = await f.send({ type: 'chat/turnStarted', turnId: 'first-turn', startedAt: new Date().toISOString(), message: { text: 'Fix the rounding in the totals.', origin: { kind: 'user' }, attachments: [link, skill] } });
  assert.equal(first.params.rejectionReason, undefined);
  await f.client.until(message => action(message, f.chat, 'chat/responsePart') && message.params.action.turnId === 'first-turn' && message.params.action.part.content === unsentAttachmentsNotice(['review']));
  const stored = f.server.app.store.listSessions()[0];
  assert.equal(stored.objective, forwardedMessage({ attachments: [link] }, 'Fix the rounding in the totals.', repositoriesDirectory, messageLimits.session).text);
  assert.equal(stored.title, 'Attachments');
});
