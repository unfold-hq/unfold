import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig, User } from '../src/types.ts';
import { Store } from '../src/store.ts';
import { InsightService } from '../src/insight.ts';
import { PloegClient, PloegError, type PloegConnections, type PloegTeam } from '../src/ploeg.ts';
import { Onboarding, compareReleases, pinnedRelease, ploegSteps, type ChecklistLine, type StoredEntries } from '../src/onboarding.ts';
import { application, configuration, request } from './api-support.ts';

const admin: User = { id: 'admin-1', name: 'Admin', role: 'admin' };
const developer: User = { id: 'dev-1', name: 'Dev', role: 'operator' };
const clock = () => new Date('2026-11-17T10:00:00.000Z');
const emptyConnections: PloegConnections = { demo: false, supported: true, checkedAt: null, eventWindowDays: 30, repositories: [], boards: [], unrouted: [], fetchedAt: '2026-11-17T10:00:00.000Z' };
const team = (id: string, spendCap: PloegTeam['spendCap']): PloegTeam => ({ id, paused: false, queueDepth: 0, roles: [], assignees: [], pinnedScopes: [], ...(spendCap === undefined ? {} : { spendCap }) });
const dayCap = { usd: 20, period: 'day' as const, periodEnd: '2026-11-18T00:00:00Z', remainingUsd: 20 };

async function withStore(t: TestContext): Promise<Store> {
  const directory = await mkdtemp(join(tmpdir(), 'unfold-onboarding-'));
  const store = new Store(join(directory, 'onboarding.sqlite'));
  t.after(async () => { try { store.close(); } catch {} await rm(directory, { recursive: true, force: true }); });
  return store;
}

function fakePloeg(options: { teams?: PloegTeam[]; connections?: PloegConnections; served?: Record<string, boolean | null> } = {}) {
  const asked: string[] = [];
  return {
    asked,
    connections: async () => structuredClone(options.connections ?? emptyConnections),
    routing: async () => ({ all: options.teams ?? [] }),
    serves: async (_user: User, route: string) => { asked.push(route); return options.served?.[route] ?? false; },
  };
}

function setup(t: TestContext, store: Store, ploeg: ReturnType<typeof fakePloeg>, config: Partial<AppConfig> = {}, stored?: StoredEntries, steps?: typeof ploegSteps) {
  const insight = new InsightService(store, { mode: 'live' } as AppConfig, '9.9.9', clock, { schedule: false });
  t.after(() => insight.stop());
  return new Onboarding({ store, ploeg, insight, now: clock, config: { repositories: [], taskSources: [], ...config }, ...(stored ? { stored } : {}), ...(steps ? { steps } : {}) });
}

const events = (store: Store) => store.db.prepare('SELECT * FROM product_event ORDER BY id').all() as Record<string, string>[];
const line = (stages: ChecklistLine[], id: string) => stages.flatMap(entry => [entry, ...(entry.checks ?? [])]).find(entry => entry.id === id)!;

test('an Admin of an empty Tenant lands on Connections and starts onboarding once per Tenant', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg());
  assert.deepEqual(onboarding.landing(admin), { land: true });
  assert.deepEqual(onboarding.landing({ ...admin, id: 'admin-2' }), { land: true }, 'a second Admin lands there too');
  assert.deepEqual(onboarding.landing(developer), { land: false }, 'someone who is not an Admin opens Now');
  assert.deepEqual(events(store).map(row => row.name), ['onboarding.started'], 'a second Admin records no second onboarding.started');
});

test('a configured installation opens Now and records no onboarding.started', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg(), { repositories: [{ id: 'unfold', name: 'Unfold', url: 'https://github.com/acme/unfold.git', baseBranch: 'main' } as AppConfig['repositories'][number]] });
  assert.deepEqual(onboarding.landing(admin), { land: false });
  const checklist = await onboarding.checklist(admin);
  assert.equal(checklist.onboarding, false);
  assert.equal(events(store).length, 0, 'no onboarding event is recorded for a configured installation');
});

test('a stored repository or a saved source counts as the Tenant having one, even while the flag keeps it out of use', async t => {
  const store = await withStore(t);
  const off = setup(t, store, fakePloeg(), {}, { repositories: () => [{ id: 'r-site', name: 'acme/site', url: 'https://github.com/acme/site.git', state: 'off' }], sources: () => 0 });
  assert.deepEqual(off.landing(admin), { land: false });
  const source = setup(t, await withStore(t), fakePloeg(), {}, { repositories: () => [], sources: () => 1 });
  assert.deepEqual(source.landing(admin), { land: false });
  assert.equal(events(store).length, 0);
});

test('stored repositories show on the register line with their state', async t => {
  const connections = { ...emptyConnections, repositories: [{ key: 'acme', label: 'acme', forge: 'forgejo', owner: 'acme', repo: 'site', baseBranch: 'main', readiness: 'ready', reason: '', lastForgeEventAt: null, boards: [] }] } as PloegConnections;
  const stored: StoredEntries = { repositories: () => [{ id: 'r-a', name: 'acme/app', url: 'https://forge.example/acme/app.git', state: 'active' }, { id: 'r-b', name: 'acme/old', url: 'https://forge.example/acme/old.git', state: 'off' }], sources: () => 0 };
  const checklist = await setup(t, await withStore(t), fakePloeg({ connections }), {}, stored).checklist(admin);
  const register = line(checklist.stages, 'register-repositories');
  assert.equal(register.status, 'warning');
  assert.match(register.text, /1 repository added in Unfold: acme\/app\./);
  assert.match(register.text, /acme\/old/);
  assert.match(register.fix!, /repositories\.stored/);
  assert.deepEqual(checklist.storedRepositories.map(entry => entry.state), ['active', 'off']);
  const without = await setup(t, await withStore(t), fakePloeg(), {}, { repositories: () => [{ id: 'r-a', name: 'acme/app', url: 'https://forge.example/acme/app.git', state: 'active' }], sources: () => 0 }).checklist(admin);
  assert.equal(line(without.stages, 'register-repositories').status, 'unavailable', 'a repository only Unfold holds is not registered in Ploeg');
  assert.match(line(without.stages, 'register-repositories').text, /added in Unfold: acme\/app\. Ploeg does not know it/);
});

test('under tenancy.enforce only an Admin membership of the Tenant manages it', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg(), { tenancy: { enforce: true } });
  assert.equal(onboarding.manages({ ...admin, memberships: [{ kind: 'tenant', tenant: 'default', role: 'developer' }] }), false);
  assert.equal(onboarding.manages({ ...admin, memberships: [{ kind: 'tenant', tenant: 'default', role: 'admin' }] }), true);
});

test('a first-time Tenant sees every later stage grey or refused with its reason, never green', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg({ teams: [] }));
  onboarding.landing(admin);
  const checklist = await onboarding.checklist(admin);
  assert.equal(checklist.manage, true);
  assert.deepEqual(checklist.stages.map(entry => entry.stage), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11]);
  assert.deepEqual(checklist.stages.map(entry => entry.id).slice(-3), ['connect-claude', 'first-task', 'first-pull-request'], 'Connect Claude comes just before the first task, the first work a person starts with it');
  assert.deepEqual(checklist.stages.filter(entry => entry.status === 'ok').map(entry => entry.id), ['sign-in']);
  for (const entry of checklist.stages.filter(stage => stage.status !== 'ok')) assert(entry.fix || entry.action || entry.status === 'pending', `${entry.id} names its fix`);
  const team = line(checklist.stages, 'install-team');
  assert.equal(team.status, 'problem');
  assert.match(team.text, /Teams are set by the person installing Ploeg/);
  assert.match(team.install!, /executor\.teams/);
  const bind = line(checklist.stages, 'bind-lists');
  assert.equal(bind.status, 'unavailable');
  assert.match(bind.text, /does not bind Lists to a Team at runtime yet/);
  assert.equal(bind.waitsFor?.record, 'Ploeg ADR-0186');
  assert.match(bind.configEntry!, /taskSources/);
  assert.equal(line(checklist.stages, 'installation').action?.kind, 'install-values');
  assert.equal(checklist.installValues.length, 11);
});

test('someone who does not manage the Tenant reads the lines with "Ask an administrator" and no Admins listed', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg({ teams: [] }));
  const checklist = await onboarding.checklist(developer);
  assert.equal(checklist.manage, false);
  assert.deepEqual(checklist.installValues, []);
  const lines = checklist.stages.flatMap(entry => [entry, ...(entry.checks ?? [])]);
  assert(lines.every(entry => !entry.action || entry.action.href === '#tasks'), 'no action is offered except opening Tasks');
  assert.equal(line(checklist.stages, 'bind-lists').fix, 'Ask an administrator to connect this.');
  assert.doesNotMatch(JSON.stringify(checklist), /admin-1/, 'the Admins are not named');
});

test('Teams, spend caps and webhooks come from Ploeg’s Teams and connections reads', async t => {
  const store = await withStore(t);
  const connections: PloegConnections = { ...emptyConnections, boards: [{ tracker: 'clickup', name: 'Sprint', projectId: '9', team: null, repository: 'acme', default: null, allow: [], webhook: 'present', teams: [], sources: [] }], repositories: [{ key: 'acme', label: 'acme', forge: 'forgejo', owner: 'acme', repo: 'site', baseBranch: 'main', readiness: 'ready', reason: '', lastForgeEventAt: null, boards: ['Sprint'] }] } as PloegConnections;
  const capped = setup(t, store, fakePloeg({ teams: [team('bronze', dayCap)], connections }));
  const checklist = await capped.checklist(admin);
  assert.equal(line(checklist.stages, 'install-team').status, 'ok');
  assert.equal(line(checklist.stages, 'install-spend-cap').text, 'bronze: USD 20 a day.');
  assert.equal(line(checklist.stages, 'install-webhook').status, 'ok');
  assert.equal(line(checklist.stages, 'bind-lists').configured, true, 'a configured board shows as configured by the installation');
  assert.match(line(checklist.stages, 'bind-lists').text, /^Configured by the installation/);
  assert.equal(line(checklist.stages, 'budget').status, 'pending', 'the cap is shown, not confirmed for the Admin');
  assert.match(line(checklist.stages, 'connect-github').text, /pushes to forgejo\. Adding GitHub needs Ploeg with Ploeg ADR-0192, not released yet/, 'an installation on another forge sees the second-forge state');

  const uncapped = await setup(t, await withStore(t), fakePloeg({ teams: [team('bronze', null)] })).checklist(admin);
  assert.equal(line(uncapped.stages, 'install-spend-cap').status, 'problem');
  assert.match(line(uncapped.stages, 'install-spend-cap').fix!, /spend cap/);
});

test('a dry run the installation has not opted in to turns its installation line red with the install value', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg({ teams: [team('bronze', dayCap)] }));
  onboarding.landing(admin);
  onboarding.notOptedIn(admin, 'bind-lists', 'bindings_not_accepted');
  onboarding.notOptedIn(admin, 'register-repositories', 'registration_not_accepted');
  onboarding.notOptedIn(admin, 'register-repositories', 'permission_required');
  onboarding.notOptedIn(admin, 'register-repositories', 'person_claim_required');
  const checklist = await onboarding.checklist(admin);
  for (const [id, code, value] of [['install-bindings', 'bindings_not_accepted', /trackerBindings\.connections/], ['install-registration', 'registration_not_accepted', /targetRegistration\.enabled/], ['install-consumer', 'permission_required', /bindScopes: true/], ['install-claims', 'person_claim_required', /requireClaims/]] as const) {
    const entry = line(checklist.stages, id);
    assert.equal(entry.status, 'problem', id);
    assert.equal(entry.reason, code);
    assert.match(entry.text, /has not opted in/);
    assert.match(entry.install!, value);
  }
  assert.equal(line(checklist.stages, 'installation').status, 'problem');
  const refused = events(store).filter(row => row.name === 'onboarding.step_refused').map(row => JSON.parse(row.props));
  assert.deepEqual(refused.filter(props => props.reason !== 'not_served').map(props => props.reason).sort(), ['bindings_not_accepted', 'permission_required', 'person_claim_required', 'registration_not_accepted']);
});

test('step events are recorded once per line and carry no screen text', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg({ teams: [] }));
  onboarding.landing(admin);
  await onboarding.checklist(admin);
  await onboarding.checklist(admin);
  const rows = events(store);
  const names = rows.map(row => row.name);
  assert.equal(names.filter(name => name === 'onboarding.started').length, 1);
  assert.equal(names.filter(name => name === 'onboarding.step_completed').length, 1, 'sign-in completes once');
  assert.equal(rows.filter(row => row.name === 'onboarding.step_failed' && JSON.parse(row.props).step === 'install-team').length, 1, 'a line that stays red fails once');
  assert.equal(rows.filter(row => row.name === 'onboarding.step_refused' && JSON.parse(row.props).step === 'bind-lists').length, 1, 'a refused step is recorded once per step and release');
  const checklist = await onboarding.checklist(admin);
  const texts = checklist.stages.flatMap(entry => [entry, ...(entry.checks ?? [])]).flatMap(entry => [entry.title, entry.text, entry.fix ?? '', entry.install ?? ''].filter(value => value.length > 12));
  for (const row of rows) {
    assert.equal(row.screen, '');
    assert.notEqual(row.actor, admin.id, 'the actor is pseudonymous');
    for (const value of Object.values(JSON.parse(row.props) as Record<string, unknown>)) {
      assert(typeof value !== 'string' || /^[a-z0-9_.@-]+$/.test(value), `${row.name} stores only codes, got ${String(value)}`);
      assert(!texts.includes(String(value)));
    }
  }
});

test('the two clocks stop once each, the task clock marked when a readiness pull request came first', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg());
  onboarding.pullRequestOpened(admin, 'task');
  assert.equal(events(store).length, 0, 'nothing is measured before onboarding started');
  onboarding.landing(admin);
  onboarding.pullRequestOpened(admin, 'readiness');
  onboarding.pullRequestOpened(admin, 'task');
  onboarding.pullRequestOpened(admin, 'task');
  const rows = events(store).filter(row => row.name.startsWith('onboarding.first_'));
  assert.deepEqual(rows.map(row => [row.name, JSON.parse(row.props)]), [
    ['onboarding.first_agent_pr_opened', { seconds: 0, kind: 'readiness' }],
    ['onboarding.first_task_pr_opened', { seconds: 0, readiness_first: true }],
  ]);
});

test('product events stay off when the installation turns them off', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg(), { productEvents: false });
  onboarding.landing(admin);
  assert.equal(events(store).length, 0);
});

test('releases compare by version, a release after its candidates', () => {
  assert(compareReleases('0.2.0-rc.108', '0.2.0-rc.109') < 0);
  assert(compareReleases('0.2.0-rc.108', '0.2.0-rc.20') > 0);
  assert(compareReleases('0.2.0', '0.2.0-rc.200') > 0);
  assert(compareReleases('0.3.0-rc.1', '0.2.9') > 0);
  assert.equal(compareReleases('0.2.0-rc.108', '0.2.0-rc.108'), 0);
});

test('the pinned Ploeg bundle comes from ploeg-release.json, and the step record names the ADR-0192 release for the second-forge gate', () => {
  const pinned = JSON.parse(readFileSync(new URL('../ploeg-release.json', import.meta.url), 'utf8')).contract as string;
  assert.equal(pinnedRelease(), /:([^@]+)@/.exec(pinned)![1]);
  assert.equal(pinnedRelease(new URL('./no-such-file.json', import.meta.url)), 'unknown');
  assert.equal(ploegSteps.secondForge.record, 'Ploeg ADR-0192');
  assert('release' in ploegSteps.secondForge);
  for (const step of ploegSteps.steps) assert(step.read === null || /^[a-z][a-z-]+$/.test(step.read), `${step.id} names an operator read route`);
});

async function ploegServer(t: TestContext, answers: Record<string, number>, bodies: Record<string, unknown> = {}) {
  const env = `UNFOLD_ONBOARDING_TEST_${randomBytes(6).toString('hex').toUpperCase()}`;
  process.env[env] = randomBytes(24).toString('hex');
  const seen: { method: string; path: string }[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    seen.push({ method: req.method!, path });
    const status = answers[path] ?? 404;
    if (status === 200) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ schemaVersion: '1.0', ...(bodies[path] as object ?? { bindings: [] }) }));
    else res.writeHead(status).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); delete process.env[env]; });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { seen, config: { url: `http://127.0.0.1:${address.port}`, tokenEnv: env } };
}

test('a step whose read route answers 404 is refused with ploeg_step_unavailable and no write is sent', async t => {
  const store = await withStore(t);
  const upstream = await ploegServer(t, {});
  const ploeg = new PloegClient({ ...configuration('/unused', 'live'), ploeg: upstream.config });
  const onboarding = new Onboarding({ store, ploeg, now: clock, config: { repositories: [], taskSources: [] } });
  await assert.rejects(onboarding.admit(admin, 'bind-lists'), (error: unknown) => error instanceof PloegError && error.status === 503 && error.code === 'ploeg_step_unavailable' && /Ploeg ADR-0186, not released yet/.test(error.message));
  await assert.rejects(onboarding.admit(admin, 'prepare-repository'), (error: unknown) => error instanceof PloegError && error.code === 'ploeg_step_unavailable', 'a step without a read route is gated on the pinned bundle');
  await assert.rejects(onboarding.admit(developer, 'bind-lists'), (error: unknown) => error instanceof PloegError && error.status === 403);
  assert.deepEqual(upstream.seen, [{ method: 'GET', path: '/api/v1/operator/tracker-bindings' }], 'only the read route was asked, never a write, and nothing for a refused person or a step without a route');
});

test('a Ploeg that serves the read route later makes the step available without a restart', async t => {
  const store = await withStore(t);
  const answers: Record<string, number> = {};
  const upstream = await ploegServer(t, answers, { '/api/v1/operator/teams': { teams: [{ id: 'bronze', paused: false, queueDepth: 0, roles: [], assignees: [], pinnedScopes: [], spendCap: { usd: 20, period: 'day', periodEnd: '2026-11-18T00:00:00Z', remainingUsd: 20 } }] } });
  answers['/api/v1/operator/teams'] = 200;
  const ploeg = new PloegClient({ ...configuration('/unused', 'live'), ploeg: upstream.config });
  const onboarding = new Onboarding({ store, ploeg, now: clock, config: { repositories: [], taskSources: [] } });
  assert.equal((await onboarding.available(admin, 'bind-lists', true)).served, false);
  answers['/api/v1/operator/tracker-bindings'] = 200;
  assert.equal((await onboarding.available(admin, 'bind-lists', true)).served, true);
  await onboarding.admit(admin, 'bind-lists', 'bronze');
  answers['/api/v1/operator/tracker-bindings'] = 500;
  assert.equal((await onboarding.available(admin, 'bind-lists', true)).served, null, 'a Ploeg that cannot be asked is unknown, not unavailable');
  assert(upstream.seen.every(entry => entry.method === 'GET'));
});

test('GET /api/onboarding serves the demo checklist, which says it is a demo and connects nothing', async t => {
  const demo = await application();
  t.after(() => demo.close());
  const answer = await request(demo.url, '/api/onboarding');
  assert.equal(answer.status, 200, answer.text);
  assert.equal(answer.body.demo, true);
  assert.equal(answer.body.manage, true, 'the demo signs everyone in as an administrator');
  assert(answer.body.stages.every((entry: ChecklistLine) => entry.status !== 'ok' || entry.id === 'sign-in' || entry.configured || entry.checks), 'the demo marks nothing done that it did not read');
  const bootstrap = await request(demo.url, '/api/bootstrap');
  assert.deepEqual(bootstrap.body.onboarding, { land: false }, 'the demo has configured sources, so nobody lands on the checklist');
});

const servedSteps = { ...ploegSteps, steps: ploegSteps.steps.map(step => ({ ...step, read: step.read ?? step.id })) };
const allServed = Object.fromEntries(servedSteps.steps.map(step => [step.read!, true]));

test('the spend-cap gate refuses readiness work and onboarding bindings for a Team without a cap, and asks Ploeg only reads', async t => {
  const store = await withStore(t);
  const ploeg = fakePloeg({ teams: [team('bronze', null), team('silver', dayCap)], served: allServed });
  const onboarding = setup(t, store, ploeg, {}, undefined, servedSteps);
  onboarding.landing(admin);
  const refusedWith = (code: string, status = 409) => (error: unknown) => error instanceof PloegError && error.status === status && error.code === code;
  await assert.rejects(onboarding.admit(admin, 'prepare-repository', 'bronze'), (error: unknown) => refusedWith('budget_missing')(error) && /executor\.spendCap/.test((error as Error).message) && /sent Ploeg nothing/.test((error as Error).message));
  await assert.rejects(onboarding.admit(admin, 'bind-lists', 'bronze'), refusedWith('budget_missing'), 'a Team without a cap cannot be bound during onboarding');
  await onboarding.admit(admin, 'register-repositories', 'bronze');
  await onboarding.admit(admin, 'connect-clickup');
  await onboarding.admit(admin, 'bind-lists', 'silver');
  await assert.rejects(onboarding.admit(admin, 'bind-lists'), refusedWith('invalid_input', 400), 'a gated step names its Team');
  await assert.rejects(onboarding.admit(admin, 'bind-lists', 'gold'), refusedWith('ploeg_not_found', 404));
  await assert.rejects(onboarding.admit(admin, 'prepare-repository', 'silver'), refusedWith('spend_cap_unconfirmed'), 'readiness work waits for an Admin to confirm the cap');
  await assert.rejects(onboarding.admit(developer, 'prepare-repository', 'bronze'), refusedWith('forbidden', 403));

  const confirmation = await onboarding.confirmCap(admin, { team: 'silver', usd: 20, period: 'day' });
  assert.deepEqual(confirmation, { team: 'silver', usd: 20, period: 'day', by: { id: 'admin-1', name: 'Admin' }, at: '2026-11-17T10:00:00.000Z' });
  await onboarding.admit(admin, 'prepare-repository', 'silver');
  const refused = events(store).filter(row => row.name === 'onboarding.step_refused').map(row => JSON.parse(row.props));
  assert.deepEqual(refused.map(props => [props.step, props.reason]), [['prepare-repository', 'budget_missing'], ['bind-lists', 'budget_missing'], ['prepare-repository', 'spend_cap_unconfirmed']]);
  assert(ploeg.asked.every(route => servedSteps.steps.some(step => step.read === route)), 'only read routes were asked');
});

test('an Admin confirms the cap Ploeg reports now, never another one, and only an Admin may', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg({ teams: [team('bronze', null), team('silver', dayCap), team('old', undefined)] }));
  const refusedWith = (code: string, status: number) => (error: unknown) => error instanceof PloegError && error.status === status && error.code === code;
  await assert.rejects(onboarding.confirmCap(admin, { team: 'silver', usd: 25, period: 'day' }), refusedWith('spend_cap_changed', 409));
  await assert.rejects(onboarding.confirmCap(admin, { team: 'silver', usd: 20, period: 'week' }), refusedWith('spend_cap_changed', 409));
  await assert.rejects(onboarding.confirmCap(admin, { team: 'bronze', usd: 20, period: 'day' }), refusedWith('budget_missing', 409));
  await assert.rejects(onboarding.confirmCap(admin, { team: 'old', usd: 20, period: 'day' }), refusedWith('ploeg_unsupported', 501), 'a Ploeg that reports no caps has nothing to confirm');
  await assert.rejects(onboarding.confirmCap(admin, { team: 'silver', usd: 0, period: 'day' }), refusedWith('invalid_input', 400));
  await assert.rejects(onboarding.confirmCap(admin, { team: 'silver', usd: 20, period: 'year' }), refusedWith('invalid_input', 400));
  await assert.rejects(onboarding.confirmCap(developer, { team: 'silver', usd: 20, period: 'day' }), refusedWith('forbidden', 403));
  assert.equal((await onboarding.checklist(admin)).budget.find(entry => entry.team === 'silver')?.confirmed, null, 'nothing refused was recorded');
});

test('the Budget line shows each cap in USD with its period, who confirmed it and when, and asks again when the cap changed', async t => {
  const store = await withStore(t);
  const teams = [team('silver', dayCap), team('bronze', null)];
  const onboarding = setup(t, store, fakePloeg({ teams }));
  const before = await onboarding.checklist(admin);
  assert.equal(line(before.stages, 'budget').status, 'pending');
  assert.equal(line(before.stages, 'budget').action?.kind, 'confirm-cap');
  assert.match(line(before.stages, 'budget').text, /^silver: USD 20 a day, not confirmed yet\. bronze has no spend cap, so Unfold starts no readiness work for it and binds no List to it during onboarding\.$/);
  assert.deepEqual(before.budget.map(entry => [entry.team, entry.bindable]), [['silver', true], ['bronze', false]]);

  await onboarding.confirmCap(admin, { team: 'silver', usd: 20, period: 'day' });
  const after = await onboarding.checklist(admin);
  assert.equal(line(after.stages, 'budget').status, 'warning', 'a Team without a cap stays named');
  assert.match(line(after.stages, 'budget').text, /^silver: USD 20 a day, confirmed by Admin on 2026-11-17 10:00 UTC\./);
  assert.equal(line(after.stages, 'budget').action, undefined, 'nothing is left to confirm');
  const reader = await onboarding.checklist(developer);
  assert.match(line(reader.stages, 'budget').text, /^silver: USD 20 a day, confirmed on 2026-11-17 10:00 UTC\./, 'someone who does not manage the Tenant is not told which Admin confirmed it');
  assert.equal(reader.budget[0].confirmed?.by, undefined);

  teams[1] = team('bronze', { ...dayCap, usd: 12.5, period: 'week' });
  teams[0] = team('silver', { ...dayCap, usd: 30 });
  const changed = await onboarding.checklist(admin);
  assert.equal(line(changed.stages, 'budget').status, 'pending');
  assert.match(line(changed.stages, 'budget').text, /silver: USD 30 a day now; USD 20 a day was confirmed by Admin on 2026-11-17 10:00 UTC\./);
  assert.match(line(changed.stages, 'budget').text, /bronze: USD 12\.50 a week, not confirmed yet\./);
  assert.equal(changed.budget[0].confirmed, null);
  assert.equal(changed.budget[0].changed?.usd, 20);
  await assert.rejects(onboarding.admit(admin, 'prepare-repository', 'silver'));

  await onboarding.confirmCap(admin, { team: 'silver', usd: 30, period: 'day' });
  await onboarding.confirmCap(admin, { team: 'bronze', usd: 12.5, period: 'week' });
  assert.equal(line((await onboarding.checklist(admin)).stages, 'budget').status, 'ok');
});

test('the demo Budget line says it is a demo and offers nothing to confirm', async t => {
  const store = await withStore(t);
  const onboarding = setup(t, store, fakePloeg({ teams: [team('delivery', undefined)], connections: { ...emptyConnections, demo: true } }));
  const checklist = await onboarding.checklist(admin);
  assert.match(line(checklist.stages, 'budget').text, /^Demo · no Run starts and no money is spent/);
  assert.equal(line(checklist.stages, 'budget').action, undefined);
  await assert.rejects(onboarding.confirmCap(admin, { team: 'delivery', usd: 20, period: 'day' }), (error: unknown) => error instanceof PloegError && error.code === 'ploeg_demo');
});
