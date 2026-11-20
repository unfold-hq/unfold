import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/auth.ts';
import { ploegDemo } from '../src/ploeg-demo.ts';
import type { PloegItem } from '../src/ploeg.ts';
import { application, login, request } from './api-support.ts';
import { action, connect, type Json } from './ahp-support.ts';

export const password = 'work-items-password-161803';
export const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
export const daysAgo = (days: number) => minutesAgo(days * 24 * 60);
export const runTemplate = ploegDemo.details['102'].runs[0];
export const itemTemplate = ploegDemo.details['102'].item;

export type Shape = { team?: string; state: PloegItem['state']; updated?: string; closeReason?: string; branch?: string; round?: number; spent?: number; pullRequest?: number; runs?: Array<{ id: string; role: string; round: number; state?: 'pending' | 'running' | 'finished'; outcome?: string; summary?: string; writes?: boolean }>; attempts?: number };

export function workItem(id: string, shape: Shape): Json {
  const team = shape.team ?? 'delivery';
  const shiftId = `9${id}`;
  const runs = (shape.runs ?? []).map(run => ({ ...structuredClone(runTemplate), id: run.id, workItemId: id, shiftId, team, role: run.role, round: run.round, writes: run.writes ?? run.role === 'implementer', state: run.state ?? 'finished', startedAt: minutesAgo(60 - Number(run.id) % 50), finishedAt: (run.state ?? 'finished') === 'finished' ? minutesAgo(59 - Number(run.id) % 50) : null, outcome: (run.state ?? 'finished') === 'finished' ? run.outcome ?? 'pr_opened' : null, summary: run.summary ?? '', verdict: run.role === 'reviewer' ? 'approve' : '', failureReason: null, stuckReason: '' }));
  const hasShift = shape.branch !== undefined || runs.length > 0 || shape.closeReason !== undefined || shape.state === 'leased';
  const shift = hasShift ? { id: shiftId, workItemId: id, team, branch: shape.branch ?? `agent/${id}`, round: shape.round ?? Math.max(1, ...runs.map(run => run.round)), budgetUsd: 3, spentUsd: shape.spent ?? 0, reservedUsd: 0, openedAt: minutesAgo(90), closedAt: shape.state === 'leased' ? null : minutesAgo(30), closeReason: shape.closeReason ?? '' } : null;
  const item = { ...structuredClone(itemTemplate), id, team, state: shape.state, title: `Work Item ${id}`, externalId: `T-${id}`, attempts: shape.attempts ?? 1, createdAt: minutesAgo(120), updatedAt: shape.updated ?? minutesAgo(Number(id) % 100), latestShift: shift, lease: null, ...(shape.pullRequest ? { pullRequest: { url: `https://forge.invalid/pulls/${shape.pullRequest}`, number: shape.pullRequest, mergeState: 'clean', baseBranch: 'main', headSha: 'abc', checkedAt: minutesAgo(5) } } : {}) };
  return { item, shifts: shift ? [shift] : [], runs: runs.reverse(), checkpoints: [], events: [], truncated: { shifts: false, runs: false, checkpoints: false, events: false } };
}

export function world() {
  const details = new Map<string, Json>([
    ['201', workItem('201', { state: 'queued', updated: minutesAgo(50) })],
    ['202', workItem('202', { state: 'leased', spent: 0.5, updated: minutesAgo(2), runs: [{ id: '301', role: 'implementer', round: 1, state: 'running' }] })],
    ['203', workItem('203', { state: 'proposed', updated: minutesAgo(40) })],
    ['204', workItem('204', { state: 'needs_human', closeReason: 'run stuck: implementer round 1', updated: minutesAgo(30), runs: [{ id: '302', role: 'implementer', round: 1, outcome: 'stuck' }] })],
    ['205', workItem('205', { state: 'awaiting_review', pullRequest: 42, updated: minutesAgo(10), runs: [{ id: '303', role: 'implementer', round: 1, summary: 'Rounded half up in the order totals.' }, { id: '304', role: 'reviewer', round: 2, summary: 'The change is correct.' }] })],
    ['206', workItem('206', { state: 'stale', attempts: 5, updated: minutesAgo(20) })],
    ['207', workItem('207', { state: 'done', pullRequest: 41, updated: daysAgo(2) })],
    ['208', workItem('208', { state: 'withdrawn', closeReason: 'withdrawn_by_operator', updated: daysAgo(3) })],
    ['209', workItem('209', { team: 'research', state: 'leased', updated: minutesAgo(1), runs: [{ id: '305', role: 'analyst', round: 1, state: 'running' }] })],
    ['210', workItem('210', { state: 'leased', branch: 'operator/session-1', updated: minutesAgo(3), runs: [{ id: '306', role: 'operator', round: 1, state: 'running' }] })],
    ['211', workItem('211', { state: 'done', pullRequest: 40, updated: daysAgo(20) })],
  ]);
  const events: Json[] = [
    { id: '1001', at: daysAgo(20), actor: 'ploegd:merge', action: 'work_item.done', workItemId: '211', team: 'delivery', detail: {} },
    { id: '1002', at: daysAgo(3), actor: 'operator:unfold:op-1', action: 'work_item.withdrawn', workItemId: '208', team: 'delivery', detail: {} },
    { id: '1003', at: daysAgo(2), actor: 'ploegd:merge', action: 'work_item.done', workItemId: '207', team: 'delivery', detail: {} },
  ];
  return { details, events, down: false, seen: [] as string[], writes: [] as Write[], requeues: new Map<string, Json>(), notes: new Map<string, Json>(), notesRoute: true, cancelBody: true, consumerMaxBudgetUsd: 5, pendingCommand: (_key: string): unknown => undefined, transcripts: new Map<string, Json[]>(), logRows: [] as Json[], logQueries: [] as string[] };
}

export type Write = { path: string; actor?: string; acting?: string; body: string; pending: unknown };

export type World = ReturnType<typeof world>;

export function ploegWrite(state: World, path: string, body: string): [Json, number] {
  const answering = /^work-items\/([0-9]+)\/questions\/([a-z0-9-]+)\/answer$/.exec(path);
  if (answering) {
    const question = (state.details.get(answering[1])?.questions as Json[] | undefined)?.find(entry => entry.id === answering[2]);
    if (!question) return [{ error: { code: 'not_found', message: 'No such question.' } }, 404];
    const input = JSON.parse(body);
    if (question.answer && question.answer !== input.answer) return [{ error: { code: 'already_answered', message: 'The question has another answer.' } }, 409];
    Object.assign(question, { answer: input.answer, answeredBy: 'op-1', waitingForPerson: false });
    return [{ answer: { workItemId: answering[1], questionId: answering[2], commandId: input.commandId, replayed: false } }, 201];
  }
  const [, id, command] = /^work-items\/([0-9]+)\/([a-z]+)$/.exec(path) ?? [];
  const detail = state.details.get(id);
  if (!detail) return [{ error: { code: 'not_found', message: 'The resource was not found in the consumer\'s scope.' } }, 404];
  const item = detail.item;
  const input = body ? JSON.parse(body) : {};
  const moved = (next: string) => { item.state = next; item.updatedAt = new Date().toISOString(); state.events.push({ id: String(2000 + state.events.length), at: item.updatedAt, actor: 'operator:unfold:op-1', action: `work_item.${next}`, workItemId: id, team: item.team, detail: {} }); };
  if (command === 'approve' || command === 'reject') {
    if (item.state !== 'proposed') return [{ error: { code: 'not_proposed', message: 'Only a proposed Work Item can be approved or rejected.' } }, 409];
    if (command === 'reject' && !String(input.reason ?? '').trim()) return [{ error: { code: 'invalid_decision', message: 'A rejection needs a reason of at most 4096 characters.' } }, 400];
    moved(command === 'approve' ? 'queued' : 'withdrawn');
    return [{ decision: { workItemId: id, team: item.team, state: item.state, approved: command === 'approve' } }, 200];
  }
  if (command === 'cancel') {
    if (body && !state.cancelBody) return [{ error: { code: 'invalid_request', message: 'Cancel takes no request body.' } }, 400];
    if (input.expectedShiftId !== undefined && (item.latestShift?.closedAt !== null || item.latestShift?.id !== input.expectedShiftId)) return [{ error: { code: 'shift_changed', message: 'The work item\'s open Shift is not the expected one.' } }, 409];
    const withdrawn = item.state !== 'withdrawn';
    if (withdrawn) moved('withdrawn');
    return [{ cancellation: { workItemId: id, state: 'withdrawn', withdrawn, shiftId: item.latestShift?.id ?? null, cancelledRuns: 0, stoppedRuns: withdrawn ? 1 : 0, keysBlocked: withdrawn } }, 200];
  }
  if (command === 'notes') {
    const replay = state.notes.get(input.commandId);
    if (replay) return replay.text === input.text ? [{ note: { ...replay, replayed: true } }, 200] : [{ error: { code: 'command_conflict', message: 'Another note holds this commandId.' } }, 409];
    if (['done', 'needs_human', 'awaiting_review', 'stale', 'withdrawn'].includes(item.state)) return [{ error: { code: 'work_item_terminal', message: 'The work item is terminal.' } }, 409];
    const open = item.latestShift && item.latestShift.closedAt === null ? item.latestShift.id : null;
    if (input.expectedShiftId !== undefined && input.expectedShiftId !== open) return [{ error: { code: 'shift_changed', message: 'The work item\'s open Shift is not the expected one.' } }, 409];
    const note = { id: String(500 + state.notes.size), workItemId: id, commandId: input.commandId, shiftId: open, createdAt: new Date().toISOString(), consumed: false, replayed: false, text: input.text };
    state.notes.set(input.commandId, note);
    const { text: _text, ...stored } = note;
    return [{ note: stored }, 201];
  }
  if (command === 'requeue') {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(String(input.commandId ?? ''))) return [{ error: { code: 'command_required', message: 'A requeue body needs a commandId of 1 to 128 identifier characters.' } }, 400];
    const replay = state.requeues.get(input.commandId);
    if (replay) return [{ requeue: { ...replay, replayed: true } }, 200];
    if (input.poolUsd !== undefined && input.poolUsd > state.consumerMaxBudgetUsd) return [{ error: { code: 'pool_above_limit', message: 'The pool exceeds the consumer\'s maxBudgetUsd.' } }, 400];
    if (!['needs_human', 'stale', 'awaiting_review'].includes(item.state)) return [{ error: { code: 'not_requeueable', message: 'Only a needs_human, stale or awaiting_review work item with no open Shift can be requeued.' } }, 409];
    if (input.expectedState && input.expectedState !== item.state) return [{ error: { code: 'state_changed', message: 'The work item is no longer in the expected state.' } }, 409];
    moved('queued');
    const resumed = input.resume === true && detail.resume ? { fromRound: detail.resume.fromRound, resume: true } : { fromRound: 1 };
    const requeued = { workItemId: id, team: item.team, state: 'queued', ...resumed, poolUsd: input.poolUsd ?? 3, shiftId: null, previousShiftId: item.latestShift?.id ?? null, commandId: input.commandId, replayed: false };
    state.requeues.set(input.commandId, requeued);
    return [{ requeue: requeued }, 200];
  }
  return [{ error: { code: 'not_found', message: 'Unknown command.' } }, 404];
}

export async function ploegServer(t: TestContext, bearer: string, state: World): Promise<string> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture.invalid');
    state.seen.push(`${url.pathname.replace('/api/v1/operator/', '')}${url.search}`);
    const send = (value: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ schemaVersion: '1.0', ...value as object }));
    if (req.headers.authorization !== `Bearer ${bearer}`) return send({}, 401);
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString('utf8');
      const path = url.pathname.replace('/api/v1/operator/', '');
      const acting = req.headers['x-ploeg-acting-user'] as string | undefined;
      state.writes.push({ path, actor: req.headers['x-ploeg-actor'] as string | undefined, acting, body, pending: state.pendingCommand(`work-item-command:${acting}:${path.split('/')[1]}`) });
      if (state.down) return send({ error: { code: 'unavailable', message: 'down' } }, 503);
      if (path.endsWith('/notes') && !state.notesRoute) return res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 page not found\n');
      const [answer, status] = ploegWrite(state, path, body);
      return send(answer, status);
    }
    if (req.method !== 'GET') return send({}, 401);
    if (state.down) return send({ error: 'unavailable' }, 503);
    const path = url.pathname.replace('/api/v1/operator/', '');
    if (path === 'teams') return send({ teams: ploegDemo.teams });
    if (path === 'work-items') {
      const after = BigInt(url.searchParams.get('after') || '0');
      const limit = Number(url.searchParams.get('limit') || 50);
      const items = [...state.details.values()].map(detail => detail.item).filter(item => item.team === url.searchParams.get('team') && (!url.searchParams.has('state') || item.state === url.searchParams.get('state')) && BigInt(item.id) > after).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      return send({ items: items.slice(0, limit), nextCursor: items.length > limit ? items[limit - 1].id : null });
    }
    const transcript = /^runs\/([0-9]+)\/transcript$/.exec(path);
    if (transcript) {
      const entries = state.transcripts.get(transcript[1]);
      if (!entries) return send({}, 404);
      const after = Number(url.searchParams.get('after') ?? 0);
      const page = entries.filter(entry => entry.seq > after);
      return send({ runId: transcript[1], entries: page, nextAfter: page.at(-1)?.seq ?? after, hasMore: false, truncated: false, complete: false });
    }
    const detail = /^work-items\/([0-9]+)$/.exec(path);
    if (detail) return state.details.has(detail[1]) ? send(state.details.get(detail[1])) : send({}, 404);
    if (path === 'events') {
      const limit = Number(url.searchParams.get('limit') || 50);
      const sorted = [...state.events].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      if (url.searchParams.get('order') === 'desc') {
        const before = url.searchParams.get('before');
        const page = sorted.reverse().filter(event => !before || BigInt(event.id) < BigInt(before));
        const events = page.slice(0, limit);
        return send({ events, nextCursor: page.length > limit ? events.at(-1)!.id : null, lastCursor: events[0]?.id ?? '0', hasMore: page.length > limit, consistency: 'snapshot' });
      }
      const after = url.searchParams.get('after') ?? '0';
      const page = sorted.filter(event => BigInt(event.id) > BigInt(after));
      const events = page.slice(0, limit);
      return send({ events, nextCursor: page.length > limit ? events.at(-1)!.id : null, lastCursor: events.at(-1)?.id ?? after, hasMore: page.length > limit, consistency: 'snapshot' });
    }
    return send({}, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

export async function logStore(t: TestContext, state: World): Promise<string> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const query = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('query') ?? '';
    state.logQueries.push(query);
    const rows = (values: Json[]) => res.writeHead(200, { 'content-type': 'application/stream+json' }).end(values.map(value => JSON.stringify(value)).join('\n'));
    const pods = [...new Map(state.logRows.map(row => [`${row.pod}/${row.container}`, row])).values()];
    if (query.includes('| stats by') && query.includes('"trace=')) return rows(pods.filter(row => row.traced).map(row => ({ namespace: 'ploeg', pod: row.pod, container: row.container, n: '1' })));
    if (query.includes('| stats by')) return rows(pods.filter(row => !row.traced && query.includes(`pod:=${JSON.stringify(row.pod)}`)).map(row => ({ namespace: 'ploeg', pod: row.pod, container: row.container, n: '1' })));
    const after = /_time:\((\S+?),/.exec(query)?.[1];
    return rows(state.logRows.filter(row => query.includes(`pod:=${JSON.stringify(row.pod)}`) && (!after || row._time > after)).sort((a, b) => b._time.localeCompare(a._time)).map(row => ({ _time: row._time, _msg: row._msg, pod: row.pod })));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

export async function fixture(t: TestContext) {
  const env = `UNFOLD_WORK_ITEMS_TEST_${randomBytes(6).toString('hex').toUpperCase()}`;
  const bearer = randomBytes(24).toString('hex');
  process.env[env] = bearer;
  t.after(() => { delete process.env[env]; });
  const state = world();
  const ploeg = await ploegServer(t, bearer, state);
  const logsUrl = await logStore(t, state);
  const userTeams: Record<string, string[]> = { 'op-1': ['delivery'], 'viewer-2': ['delivery'] };
  const server = await application('live', config => { config.ploeg = { url: ploeg, tokenEnv: env, userTeams }; config.observability = { logsUrl }; });
  t.after(() => server.close());
  const host = server.app.agentHost;
  host.workItems.pollMs = 3_600_000;
  host.workItems.reconcileMs = 3_600_000;
  host.runLive.pollMs = 3_600_000;
  server.app.store.addUser({ id: 'op-1', name: 'op-1', role: 'operator', passwordHash: await hashPassword(password) });
  server.app.store.addUser({ id: 'viewer-1', name: 'viewer-1', role: 'viewer', passwordHash: await hashPassword(password) });
  server.app.store.addUser({ id: 'viewer-2', name: 'viewer-2', role: 'viewer', passwordHash: await hashPassword(password) });
  state.pendingCommand = key => server.app.store.getSecret(key);
  const unfoldSession = server.app.engine.create({ title: 'An Unfold session', objective: 'Fix the order rounding regression.', repositoryId: 'order-service', teamId: 'delivery', runtime: 'opencode', budgetUsd: 1 }, { id: 'op-1', name: 'op-1', role: 'operator' });
  const attach = async (name: 'op-1' | 'viewer-1' | 'viewer-2' | 'admin') => {
    const token = name === 'admin'
      ? (await request(server.url, '/api/agent-host/tokens', { method: 'POST', cookie: (await login(server.url)).cookie, body: { label: 'work items' } })).body.token
      : name.startsWith('viewer-') ? host.issueToken({ id: name, name, role: 'viewer' }) : (await request(server.url, '/api/agent-host/tokens', { method: 'POST', cookie: (await login(server.url, name, password)).cookie, body: { label: 'work items' } })).body.token;
    const client = connect(`${server.url.replace(/^http/, 'ws')}/?tkn=${token}`);
    t.after(() => client.close());
    await client.open;
    await client.rpc('initialize', { channel: 'ahp-root://', protocolVersions: ['0.9.0'], clientId: `${name}-${randomBytes(3).toString('hex')}`, clientInfo: { name: 'vscode-agents-window' }, initialSubscriptions: ['ahp-root://'] });
    return client;
  };
  const listed = async (client: Awaited<ReturnType<typeof attach>>) => (await client.rpc('listSessions', {})).items as Json[];
  return { server, host, state, attach, listed, unfoldSession, userTeams };
}

export const picked = (option: string, reason?: string): Json => ({ '0': { state: 'submitted', value: { kind: 'selected', value: option } }, ...(reason !== undefined ? { '1': { state: 'submitted', value: { kind: 'text', value: reason } } } : {}) });

export async function commanding(t: TestContext, who: 'op-1' | 'viewer-2' = 'op-1') {
  const f = await fixture(t);
  const client = await f.attach(who);
  await f.listed(client);
  let seq = 100;
  const dispatch = (channel: string, body: Json) => { const clientSeq = ++seq; client.notify('dispatchAction', { channel, clientSeq, action: body }); return clientSeq; };
  const answered = (clientSeq: number) => client.until(message => message.method === 'action' && message.params.origin?.clientSeq === clientSeq);
  const requested = (chat: string, after = 0) => client.until(message => action(message, chat, 'chat/inputRequested') && client.inbox.indexOf(message) >= after);
  const replied = (chat: string, pattern: RegExp) => client.until(message => action(message, chat, 'chat/responsePart') && pattern.test(String(message.params.action.part?.content ?? '')));
  return { ...f, client, dispatch, answered, requested, replied };
}
