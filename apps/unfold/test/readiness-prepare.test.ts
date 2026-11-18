import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig, User } from '../src/types.ts';
import { Store } from '../src/store.ts';
import { InsightService } from '../src/insight.ts';
import { PloegClient, PloegError } from '../src/ploeg.ts';
import { Onboarding, ploegSteps, type ChecklistLine } from '../src/onboarding.ts';
import { ReadinessPrepare } from '../src/readiness-prepare.ts';
import { application, configuration, request } from './api-support.ts';

const admin: User = { id: 'admin-1', name: 'Ada Admin', role: 'admin' };
const operator: User = { id: 'op-1', name: 'Op', role: 'operator' };
const clock = () => new Date('2026-11-18T10:00:00.000Z');
const at = '2026-11-18T09:00:00.000Z';
const servedSteps = { ...ploegSteps, steps: ploegSteps.steps.map(step => step.id === 'prepare-repository' ? { ...step, release: '0.2.0' } : step) };

type Repository = { key: string; owner: string; repo: string; readiness: 'ready' | 'not_ready'; reason: string; prepareAvailable?: boolean };
type WorkItem = { id: string; state: string; pullRequest: string | null; requestId: string };
type Fake = {
  repositories: Repository[]; cap: number; workItems: WorkItem[]; posts: { path: string; body: Record<string, unknown>; acting: string }[];
  refuse?: { status: number; code: string }; closeOnCancel: boolean;
};

const repository = (key: string, overrides: Partial<Repository> = {}): Repository => ({ key, owner: 'acme', repo: key, readiness: 'not_ready', reason: 'AGENTS.md is missing at the root of main', prepareAvailable: true, ...overrides });

function reply(res: ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ schemaVersion: '1.0', ...(body as object) })); }

function itemOf(entry: WorkItem) {
  return { id: entry.id, provider: 'manual', externalId: '', revision: '', team: 'delivery', state: entry.state, title: 'Prepare this repository', description: '', url: '', priority: 0, attempts: 0, infraFailures: 0, nextEligibleAt: null, createdAt: at, updatedAt: at, target: null, latestShift: null, lease: null, pullRequest: entry.pullRequest ? { url: entry.pullRequest, number: 7, headSha: 'abc' } : null };
}

async function fakePloeg(t: TestContext, initial: Partial<Fake> = {}) {
  const fake: Fake = { repositories: [repository('site')], cap: 20, workItems: [], posts: [], closeOnCancel: true, ...initial };
  const env = `UNFOLD_PREPARE_TEST_${randomBytes(6).toString('hex').toUpperCase()}`;
  process.env[env] = randomBytes(24).toString('hex');
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname.replace('/api/v1/operator/', '');
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      if (req.method === 'POST') {
        const text = Buffer.concat(chunks).toString('utf8');
        const body = text ? JSON.parse(text) as Record<string, unknown> : {};
        fake.posts.push({ path, body, acting: String(req.headers['x-ploeg-acting-user']) });
        if (path === 'work-items') {
          if (fake.refuse) return reply(res, fake.refuse.status, { error: { code: fake.refuse.code, message: 'refused' } });
          const replay = fake.workItems.find(entry => entry.requestId === body.requestId);
          if (replay) return reply(res, 200, { workItem: { id: replay.id, team: 'delivery', state: replay.state, shiftId: null, budgetUsd: body.budgetUsd, poolUsd: null }, created: false, replayed: true });
          const entry = { id: String(40 + fake.workItems.length + 1), state: 'queued', pullRequest: null, requestId: String(body.requestId) };
          fake.workItems.push(entry);
          return reply(res, 201, { workItem: { id: entry.id, team: 'delivery', state: 'queued', shiftId: null, budgetUsd: body.budgetUsd, poolUsd: null }, created: true, replayed: false });
        }
        const cancelled = /^work-items\/(\d+)\/cancel$/.exec(path);
        if (cancelled) {
          const entry = fake.workItems.find(item => item.id === cancelled[1])!;
          const pullRequest = entry.pullRequest ? { url: entry.pullRequest, state: fake.closeOnCancel ? 'closed' : 'open' } : null;
          entry.state = 'withdrawn';
          return reply(res, 200, { cancellation: { workItemId: entry.id, state: 'withdrawn', withdrawn: true, shiftId: null, cancelledRuns: 1, stoppedRuns: 0, keysBlocked: true, commandId: body.commandId ?? null, replayed: false, pullRequest } });
        }
        return reply(res, 404, { error: { code: 'not_found', message: 'no' } });
      }
      if (path === 'connections') return reply(res, 200, { checkedAt: at, eventWindowDays: 30, boards: [], repositories: fake.repositories.map(entry => ({ label: null, forge: 'github', baseBranch: 'main', lastForgeEventAt: null, boards: [], ...entry })) });
      if (path === 'teams') return reply(res, 200, { teams: [{ id: 'delivery', paused: false, queueDepth: 0, roles: [], assignees: [], pinnedScopes: [], spendCap: { usd: fake.cap, period: 'day', periodEnd: '2026-11-19T00:00:00Z', remainingUsd: fake.cap } }] });
      const detail = /^work-items\/(\d+)$/.exec(path);
      const entry = detail && fake.workItems.find(item => item.id === detail[1]);
      if (entry) return reply(res, 200, { item: itemOf(entry), shifts: [], runs: [], checkpoints: [], events: [], truncated: { shifts: false, runs: false, checkpoints: false, events: false } });
      res.writeHead(404).end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); delete process.env[env]; });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { fake, config: { url: `http://127.0.0.1:${address.port}`, tokenEnv: env } };
}

async function setup(t: TestContext, initial: Partial<Fake> = {}, steps = servedSteps) {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-prepare-'));
  const store = new Store(join(directory, 'prepare.sqlite'));
  t.after(async () => { try { store.close(); } catch {} await rm(directory, { recursive: true, force: true }); });
  const upstream = await fakePloeg(t, initial);
  const ploeg = new PloegClient({ ...configuration('/unused', 'live'), ploeg: upstream.config });
  const insight = new InsightService(store, { mode: 'live' } as AppConfig, '9.9.9', clock, { schedule: false });
  t.after(() => insight.stop());
  const build = () => {
    const onboarding = new Onboarding({ store, ploeg, insight, now: clock, pinned: '0.2.0', steps, config: { repositories: [], taskSources: [] } });
    const prepare = new ReadinessPrepare({ store, ploeg, onboarding, now: clock });
    onboarding.useReadiness(prepare);
    return { onboarding, prepare };
  };
  const { onboarding, prepare } = build();
  onboarding.start(admin);
  return { store, fake: upstream.fake, onboarding, prepare, build };
}

const line = (stages: ChecklistLine[], id: string) => stages.flatMap(entry => [entry, ...(entry.checks ?? [])]).find(entry => entry.id === id);
const admissions = (fake: Fake) => fake.posts.filter(post => post.path === 'work-items');
const events = (store: Store, name: string) => (store.db.prepare('SELECT * FROM product_event WHERE name = ?').all(name) as { props: string }[]).map(row => JSON.parse(row.props));
const refusedWith = (status: number, code: string) => (error: unknown) => error instanceof PloegError && error.status === status && error.code === code;

test('Prepare this repository is offered only where Ploeg reports prepareAvailable, with the cap and no estimate', async t => {
  const { onboarding } = await setup(t, { repositories: [repository('site'), repository('old', { reason: 'the repository is archived', prepareAvailable: false }), repository('mirror', { reason: 'AGENTS.md is missing', prepareAvailable: undefined })] });
  const before = await onboarding.checklist(admin, true);
  const site = line(before.stages, 'prepare:site')!;
  assert.equal(site.actions, undefined, 'no offer before the Team’s spend cap is confirmed');
  assert.match(site.text, /Confirm a Team’s spend cap/);
  await onboarding.confirmCap(admin, { team: 'delivery', usd: 20, period: 'day' });
  const stages = (await onboarding.checklist(admin, true)).stages;
  const offered = line(stages, 'prepare:site')!;
  assert.deepEqual(offered.actions, [{ label: 'Prepare this repository · USD 20.00 on delivery', kind: 'prepare', data: { target: 'site', team: 'delivery', usd: '20' } }]);
  assert.match(offered.text, /capped at USD 20\.00 on Team delivery/);
  assert.match(offered.text, /Unfold shows no estimate/);
  assert.doesNotMatch(offered.text, /costs about|estimated/i);
  const archived = line(stages, 'prepare:old')!;
  assert.equal(archived.status, 'problem');
  assert.match(archived.text, /archived/);
  assert.equal(archived.actions, undefined);
  assert.equal(line(stages, 'prepare:mirror')?.actions, undefined, 'reason text alone never makes an offer');
  const reader = await onboarding.checklist(operator, true);
  assert.equal(line(reader.stages, 'prepare:site')?.actions, undefined, 'someone who does not manage the Tenant gets no button');
});

test('a confirmed prepare admits one prepare_repository Work Item with the cap as budgetUsd, once per repository', async t => {
  const { fake, onboarding, prepare, build } = await setup(t);
  await onboarding.confirmCap(admin, { team: 'delivery', usd: 20, period: 'day' });
  const [first, second] = await Promise.all([prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 }), prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 })]);
  assert.equal(first.prepare.workItemId, '41');
  assert.equal(second.prepare.workItemId, '41', 'a double click names the same Work Item');
  assert.equal(admissions(fake).length, 1);
  const body = admissions(fake)[0].body;
  assert.equal(body.kind, 'prepare_repository');
  assert.equal(body.budgetUsd, 20);
  assert.equal(body.target, 'site');
  assert.equal(body.team, 'delivery');
  assert(!('title' in body) && !('description' in body), 'Ploeg owns the title and brief');
  assert.equal(admissions(fake)[0].acting, 'admin-1');
  const restarted = build();
  await restarted.onboarding.checklist(admin, true);
  assert.equal(admissions(fake).length, 1, 'a restart and a checklist read resend nothing');
  const retried = await restarted.prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 });
  assert.equal(retried.prepare.workItemId, '41');
  assert.equal(admissions(fake).length, 1, 'a retry after a restart resolves to the existing Work Item');
});

test('a changed cap asks again and sends nothing; a step Ploeg does not serve is refused before any write', async t => {
  const { fake, onboarding, prepare } = await setup(t);
  await onboarding.confirmCap(admin, { team: 'delivery', usd: 20, period: 'day' });
  await assert.rejects(prepare.start(admin, { target: 'site', team: 'delivery', usd: 15 }), refusedWith(409, 'spend_cap_changed'));
  fake.cap = 25;
  await assert.rejects(prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 }), refusedWith(409, 'spend_cap_unconfirmed'));
  await onboarding.confirmCap(admin, { team: 'delivery', usd: 25, period: 'day' });
  await assert.rejects(prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 }), refusedWith(409, 'spend_cap_changed'), 'the button of the old cap is refused');
  await assert.rejects(prepare.start(operator, { target: 'site', team: 'delivery', usd: 25 }), refusedWith(403, 'forbidden'));
  assert.equal(admissions(fake).length, 0);
  const unserved = await setup(t, {}, ploegSteps);
  await assert.rejects(unserved.prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 }), refusedWith(503, 'ploeg_step_unavailable'));
  assert.equal(unserved.fake.posts.length, 0);
  assert.equal(line((await unserved.onboarding.checklist(admin, true)).stages, 'prepare-repository')?.status, 'unavailable', 'until Ploeg ships ADR-0194 the line stays the S1 refusal');
});

test('a repository Ploeg does not offer, or one that is ready, gets no Work Item', async t => {
  const { fake, onboarding, prepare } = await setup(t, { repositories: [repository('old', { prepareAvailable: false, reason: 'the repository is a mirror' }), repository('done', { readiness: 'ready', reason: '' })] });
  await onboarding.confirmCap(admin, { team: 'delivery', usd: 20, period: 'day' });
  await assert.rejects(prepare.start(admin, { target: 'old', team: 'delivery', usd: 20 }), (error: unknown) => refusedWith(409, 'prepare_unavailable')(error) && /mirror/.test((error as Error).message));
  await assert.rejects(prepare.start(admin, { target: 'done', team: 'delivery', usd: 20 }), refusedWith(409, 'target_already_ready'));
  assert.equal(admissions(fake).length, 0);
});

test('cancelling before the pull request stops the Work Item, restarts nothing, and the offer returns', async t => {
  const { fake, onboarding, prepare } = await setup(t);
  await onboarding.confirmCap(admin, { team: 'delivery', usd: 20, period: 'day' });
  await prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 });
  const running = line((await onboarding.checklist(admin, true)).stages, 'prepare:site')!;
  assert.equal(running.action?.kind, 'cancel-prepare');
  const cancelled = await prepare.cancel(admin, { target: 'site' });
  assert.equal(cancelled.prepare.state, 'cancelled');
  assert.equal(cancelled.prepare.pullRequest, null);
  assert.deepEqual(fake.posts.map(post => post.path), ['work-items', 'work-items/41/cancel']);
  assert.equal(fake.posts[1].body.commandId, 'prepare-cancel-41');
  await assert.rejects(prepare.cancel(admin, { target: 'site' }), refusedWith(409, 'prepare_not_running'));
  const after = line((await onboarding.checklist(admin, true)).stages, 'prepare:site')!;
  assert.equal(after.actions?.[0].kind, 'prepare');
  assert.equal(admissions(fake).length, 1, 'nothing restarts by itself');
  const again = await prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 });
  assert.equal(again.prepare.workItemId, '42', 'a new prepare after a cancel is a new attempt');
  assert.notEqual(admissions(fake)[1].body.requestId, admissions(fake)[0].body.requestId);
});

test('an opened readiness pull request shows a review-and-merge line, records the first agent pull request once, and a cancel shows what Ploeg did with it', async t => {
  const { store, fake, onboarding, prepare } = await setup(t);
  await onboarding.confirmCap(admin, { team: 'delivery', usd: 20, period: 'day' });
  await prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 });
  fake.workItems[0].state = 'awaiting_review';
  fake.workItems[0].pullRequest = 'https://github.com/acme/site/pull/7';
  const stages = (await onboarding.checklist(admin, true)).stages;
  await onboarding.checklist(admin, true);
  const review = line(stages, 'review:site')!;
  assert.equal(review.status, 'warning');
  assert.deepEqual(review.action, { label: 'Open the pull request', href: 'https://github.com/acme/site/pull/7', kind: 'link', external: true });
  assert.match(review.text, /adds only AGENTS\.md/);
  assert.deepEqual(events(store, 'onboarding.first_agent_pr_opened').map(props => props.kind), ['readiness']);
  assert(!JSON.stringify(store.db.prepare('SELECT props FROM product_event').all()).includes('acme'), 'no product event names a repository');
  fake.closeOnCancel = false;
  const cancelled = await prepare.cancel(admin, { target: 'site' });
  assert.deepEqual(cancelled.prepare.pullRequest, { url: 'https://github.com/acme/site/pull/7', state: 'open' });
  const tracked = line((await onboarding.checklist(admin, true)).stages, 'prepare:site')!;
  assert.equal(tracked.reason, 'prepare_in_progress');
  assert.equal(tracked.actions, undefined, 'no second readiness Work Item is offered while the pull request is open');
  assert.equal(tracked.action?.href, 'https://github.com/acme/site/pull/7');
  fake.refuse = { status: 409, code: 'prepare_in_progress' };
  await assert.rejects(prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 }), refusedWith(409, 'prepare_in_progress'));
  assert.equal(prepare.records().site.state, 'cancelled', 'a refused Admission keeps the tracked pull request');
});

test('a cancel after the pull request opened that Ploeg closed offers the repository again', async t => {
  const { fake, onboarding, prepare } = await setup(t);
  await onboarding.confirmCap(admin, { team: 'delivery', usd: 20, period: 'day' });
  await prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 });
  fake.workItems[0].pullRequest = 'https://github.com/acme/site/pull/7';
  await onboarding.checklist(admin, true);
  const cancelled = await prepare.cancel(admin, { target: 'site' });
  assert.equal(cancelled.prepare.pullRequest?.state, 'closed');
  const offered = line((await onboarding.checklist(admin, true)).stages, 'prepare:site')!;
  assert.equal(offered.actions?.[0].kind, 'prepare');
  assert.match(offered.text, /cancelled and its pull request closed/);
});

test('after the merge the repository shows Level 2, names the next Level 3 check and is offered for binding', async t => {
  const { fake, onboarding, prepare } = await setup(t);
  await onboarding.confirmCap(admin, { team: 'delivery', usd: 20, period: 'day' });
  await prepare.start(admin, { target: 'site', team: 'delivery', usd: 20 });
  fake.workItems[0].pullRequest = 'https://github.com/acme/site/pull/7';
  fake.workItems[0].state = 'done';
  fake.repositories = [repository('site', { readiness: 'ready', reason: '', prepareAvailable: false })];
  const stages = (await onboarding.checklist(admin, true)).stages;
  const ready = line(stages, 'review:site')!;
  assert.equal(ready.status, 'ok');
  assert.match(ready.text, /Level 2/);
  assert.match(ready.text, /Next for Level 3: required checks on the base branch/);
  assert.equal(line(stages, 'review-and-merge')?.status, 'ok');
  assert.match(line(stages, 'bind-lists')!.text, /Ready for a List now that its readiness pull request merged: acme\/site/);
});

test('the HTTP routes need a signed-in Admin, and the demo says it is a demo and sends nothing', async t => {
  const demo = await application();
  t.after(() => demo.close());
  const answer = await request(demo.url, '/api/onboarding/prepare', { method: 'POST', body: { target: 'site', team: 'delivery', usd: 2 } });
  assert.equal(answer.status, 409, answer.text);
  assert.equal(answer.body.error.code, 'ploeg_demo');
  assert.match(answer.body.error.message, /demo/);
  const cancel = await request(demo.url, '/api/onboarding/prepare/cancel', { method: 'POST', body: { target: 'site' } });
  assert.equal(cancel.body.error.code, 'ploeg_demo');
  const unsigned = await request(demo.url, '/api/onboarding/prepare', { method: 'GET' });
  assert.equal(unsigned.status, 405);
  const checklist = await request(demo.url, '/api/onboarding');
  assert.match(checklist.body.stages.find((entry: ChecklistLine) => entry.id === 'prepare-repository').text, /^Demo · no readiness pull request opens/);
});
