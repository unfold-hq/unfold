import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LinkedSessions, parseLinkedEvent, type LinkedPloeg } from '../src/linked-sessions.ts';
import { LinkedUsage, LinkedUsageStore, UsageMarkupStore, MarkupError, billableMicros, linkedCharges, linkedUsageJob, linkedWorkCharges, markupBasisPoints, splitWhole, toMicros } from '../src/linked-usage.ts';
import { focusCsv, focusExport, focusExportQuery, type LinkedFocusCharge } from '../src/focus-export.ts';
import { linkedEstimate } from '../src/my-usage.ts';
import { BillingService, BillingStore, billingRoute, BillingError } from '../src/billing.ts';
import { JobQueue } from '../src/jobs/queue.ts';
import { JobWorker } from '../src/jobs/worker.ts';
import type { AppConfig, User } from '../src/types.ts';
import type { TenantScope } from '../src/tenant-scope.ts';

const owner: User = { id: 'u-ryan', name: 'ryan', role: 'operator' };
const teammate: User = { id: 'u-sam', name: 'sam', role: 'operator' };
const admin: User = { id: 'u-boss', name: 'boss', role: 'admin' };
const base = 'https://unfold.example.org';
const day = 86_400_000;
const sessionId = '0f6c1c9e-1111-4222-8333-944445555666';
const tokens = (input: number, output = 0) => ({ input, output, cacheRead: 0, cacheCreation: 0 });

function ploeg(): LinkedPloeg {
  return {
    async detail(user, id) {
      if (!['184', '185'].includes(id)) throw Object.assign(new Error('not found'), { status: 404 });
      return { item: { id, title: id === '184' ? 'Fix login' : 'Other', provider: 'vikunja', externalId: id } };
    },
    async trackerItems() { return { items: [] }; },
  };
}

function metrics(state: { cost: number | null; input: number; down?: boolean }): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    if (state.down) return new Response('', { status: 503 });
    const query = new URLSearchParams(String(init.body)).get('query') ?? '';
    const result = state.cost === null ? [] : query.startsWith('sum by (type)') ? [{ metric: { type: 'input' }, value: [0, String(state.input)] }] : [{ metric: {}, value: [0, String(state.cost)] }];
    return new Response(JSON.stringify({ status: 'success', data: { result } }));
  }) as typeof fetch;
}

function world(state: { cost: number | null; input: number; down?: boolean }, now = () => new Date('2026-10-17T10:00:00.000Z')) {
  const db = new DatabaseSync(':memory:');
  const config = { observability: { metricsUrl: 'http://metrics.local' } } as AppConfig;
  const jobs = new JobWorker(new JobQueue(db), { clock: () => now().getTime(), log: () => undefined });
  const usage = new LinkedUsage(db, config, { jobs, fetch: metrics(state), now, delayMs: 0 });
  const linked = new LinkedSessions(db, config, ploeg(), { fetch: metrics(state), now, usage });
  return { db, usage, linked, jobs };
}

const report = (fields: Record<string, unknown>, at: Date) => parseLinkedEvent({ harness: 'claude-code', sessionId, event: 'start', ...fields }, at);

test('a reading without tokens is not kept, a lower later reading keeps the higher figure, and an unchanged one adds nothing', () => {
  const store = new LinkedUsageStore(new DatabaseSync(':memory:'));
  assert.equal(store.record(sessionId, 0, tokens(0), '2026-10-17T10:00:00.000Z'), undefined, 'nothing observed is not a $0 fact');
  assert.equal(store.record(sessionId, null, null, '2026-10-17T10:00:00.000Z'), undefined);
  assert.equal(store.record(sessionId, 1.25, tokens(1000), '2026-10-17T10:00:00.000Z')?.costMicros, 1_250_000);
  assert.equal(store.record(sessionId, 1.25, tokens(1000), '2026-10-17T11:00:00.000Z'), undefined);
  assert.equal(store.record(sessionId, 0.4, tokens(10), '2026-10-17T12:00:00.000Z'), undefined, 'a store that dropped samples never lowers the record');
  assert.equal(store.record(sessionId, 2, tokens(1500), '2026-10-18T09:00:00.000Z')?.costMicros, 2_000_000);
  assert.deepEqual(store.days(sessionId).map(entry => [new Date(entry.dayStart).toISOString().slice(0, 10), entry.costMicros, entry.tokens.input]), [['2026-10-17', 1_250_000, 1000], ['2026-10-18', 750_000, 500]]);
});

test('the cost of a session survives the metrics store losing it: the Work Item and the session keep the recorded estimate', async () => {
  const state: { cost: number | null; input: number; down?: boolean } = { cost: 3.5, input: 42_000 };
  let clock = new Date('2026-10-17T10:00:00.000Z');
  const { linked, usage } = world(state, () => clock);
  await linked.report(owner, report({ workItem: '184' }, clock), base);
  const live = await linked.forWorkItem(owner, '184', base, true);
  assert.equal(live[0].telemetry?.costUsd, 3.5);
  assert.equal(live[0].recordedUsage?.costUsd, 3.5);
  clock = new Date('2026-11-30T10:00:00.000Z');
  state.cost = null;
  const later = await linked.forWorkItem(owner, '184', base, true);
  assert.notEqual(later[0].telemetry?.costUsd, 3.5, 'the live store no longer has it');
  assert.deepEqual([later[0].recordedUsage?.costUsd, later[0].recordedUsage?.source, later[0].recordedUsage?.observedAt], [3.5, 'telemetry-estimate', '2026-10-17T10:00:00.000Z']);
  state.down = true;
  const total = await linked.workItemUsage(owner, '184', { tenant: 'default' });
  assert.deepEqual([total.costUsd, total.billableUsd, total.tokens?.input, total.scope, total.costStatus], [3.5, 3.5, 42_000, 'own', 'estimate']);
  assert.equal(usage.store.readings(sessionId).length, 1);
});

test('a session that stops working queues one delayed read of its estimate, which records it', async () => {
  const state = { cost: 0.75, input: 900 };
  const clock = new Date('2026-10-17T10:00:00.000Z');
  const { linked, usage, jobs } = world(state, () => clock);
  await linked.report(owner, report({}, clock), base);
  assert.equal(jobs.queue.get(linkedUsageJob, sessionId), undefined, 'a start report reads nothing');
  await linked.report(owner, report({ event: 'idle' }, clock), base);
  await linked.report(owner, report({ event: 'end' }, clock), base);
  assert.equal(jobs.queue.get(linkedUsageJob, sessionId)?.state, 'pending');
  await jobs.drain(linkedUsageJob);
  assert.equal(usage.recorded(sessionId)?.costUsd, 0.75);
  assert.equal(jobs.queue.get(linkedUsageJob, sessionId)?.state, 'done');
});

test('another person sees only their own share of a Work Item; an administrator sees every session', async () => {
  const state = { cost: 2, input: 100 };
  const clock = new Date('2026-10-17T10:00:00.000Z');
  const { linked, usage } = world(state, () => clock);
  await linked.report(owner, report({ workItem: '184' }, clock), base);
  usage.store.record(sessionId, 2, tokens(100), clock.toISOString());
  const theirs = await linked.workItemUsage(teammate, '184', { tenant: 'default' });
  assert.deepEqual([theirs.costUsd, theirs.sessions, theirs.scope], [null, 0, 'own']);
  const all = await linked.workItemUsage(admin, '184', { tenant: 'default' });
  assert.deepEqual([all.costUsd, all.sessions, all.scope], [2, 1, 'all']);
});

test('a session linked to two Work Items splits each day exactly, never counting its cost twice', () => {
  const store = new LinkedUsageStore(new DatabaseSync(':memory:'));
  store.record('s-1', 0.000003, tokens(7), '2026-10-17T10:00:00.000Z');
  const charges = linkedCharges(store, [{ id: 's-1', workItems: [{ id: '185' }, { id: '184' }] }], 0, Number.MAX_SAFE_INTEGER, () => 0);
  assert.deepEqual(charges.map(charge => [charge.workItemId, charge.costMicros, charge.tokens.input]), [['184', 2, 4], ['185', 1, 3]]);
  assert.deepEqual(splitWhole(10, 3), [4, 3, 3]);
});

test('a markup of 0 is the estimate, a markup changes only the billable amount, and changing it never rewrites an earlier day', () => {
  const db = new DatabaseSync(':memory:');
  const store = new LinkedUsageStore(db);
  const markups = new UsageMarkupStore(db);
  const acme = { tenant: 'acme' };
  store.record('s-1', 10, tokens(1), '2026-10-05T10:00:00.000Z');
  store.record('s-1', 30, tokens(2), '2026-10-20T10:00:00.000Z');
  const sessions = [{ id: 's-1', workItems: [{ id: '184' }] }];
  const charge = (at: (dayStart: number) => number) => linkedCharges(store, sessions, 0, Number.MAX_SAFE_INTEGER, (_id, dayStart) => at(dayStart)).map(entry => [entry.costMicros, entry.billableMicros]);
  assert.deepEqual(charge(dayStart => markups.at(acme, dayStart)), [[10_000_000, 10_000_000], [20_000_000, 20_000_000]], 'no markup bills the estimate');
  markups.set(acme, markupBasisPoints('15'), '2026-10-01', '2026-10-10', 'u-boss', '2026-10-10T08:00:00.000Z');
  assert.deepEqual(charge(dayStart => markups.at(acme, dayStart)), [[10_000_000, 11_500_000], [20_000_000, 23_000_000]]);
  assert.throws(() => markups.set(acme, 2500, '2026-10-01', '2026-10-15', 'u-boss', '2026-10-15T08:00:00.000Z'), MarkupError, 'a change may not reach back');
  assert.throws(() => markups.set(acme, 2500, '2026-10-01', '2026-10-01', 'u-boss', '2026-10-01T08:00:00.000Z'), MarkupError, 'a markup already in effect is not replaced');
  markups.set(acme, markupBasisPoints(25), '2026-10-15', '2026-10-15', 'u-boss', '2026-10-15T08:00:00.000Z');
  assert.deepEqual(charge(dayStart => markups.at(acme, dayStart)), [[10_000_000, 11_500_000], [20_000_000, 25_000_000]], 'the 5 October day keeps its 15%');
  markups.set({ tenant: 'acme', client: 'globex' }, 0, '2026-10-16', '2026-10-16', 'u-boss', '2026-10-16T08:00:00.000Z');
  assert.equal(markups.at({ tenant: 'acme', client: 'globex' }, Date.parse('2026-10-20T00:00:00Z')), 0, 'a Client markup wins over its Tenant');
  assert.equal(markups.at({ tenant: 'acme', client: 'globex' }, Date.parse('2026-10-05T00:00:00Z')), 1500, 'before its own markup a Client takes the Tenant');
  assert.deepEqual(store.readings('s-1').map(entry => entry.costMicros), [10_000_000, 30_000_000], 'the recorded estimate never carries a markup');
  assert.equal(billableMicros(toMicros(1.234567), 1250), 1_388_888);
  assert.throws(() => markupBasisPoints('-5'));
  assert.throws(() => markupBasisPoints('12.345'));
  assert.throws(() => markupBasisPoints('1000.01'));
});

test('the FOCUS export adds Linked Session rows only when asked, at list price, with the estimate and the billable amount apart', () => {
  const now = Date.parse('2026-11-02T00:00:00Z');
  const charge: LinkedFocusCharge = { workItemId: '184', dayStart: Date.parse('2026-10-05T00:00:00Z'), costMicros: 12_345_678, billableMicros: billableMicros(12_345_678, 1000), basisPoints: 1000, tokens: tokens(5000, 300), sessions: 2, item: { id: '184', title: 'Fix login', team: 'silver', target: { owner: 'acme', repo: 'shop' }, externalRef: 'VIK-2051' }, owner: { tenant: 'acme', client: 'globex' } };
  const other: LinkedFocusCharge = { ...charge, workItemId: '185', item: { ...charge.item, id: '185' }, owner: { tenant: 'initech' } };
  const outside: LinkedFocusCharge = { ...charge, dayStart: Date.parse('2026-09-30T00:00:00Z') };
  const query = (extra: Record<string, string> = {}) => focusExportQuery(new URLSearchParams({ month: '2026-10', ...extra }), now);
  assert.equal(focusExport([], query(), { owner: () => undefined, linked: [charge] }).rows.length, 0, 'excluded unless asked');
  const result = focusExport([], query({ linkedSessions: 'include', tenant: 'acme' }), { owner: () => undefined, linked: [charge, other, outside] });
  assert.equal(result.counts.linkedSessionRows, 1);
  const [row] = result.rows;
  assert.deepEqual([row.BilledCost, row.EffectiveCost, row.ListCost, row.x_UnfoldEstimatedCost, row.x_UnfoldBillableCost, row.x_UnfoldMarkupPercent, row.x_UnfoldSpendStatus, row.x_UnfoldCostSource, row.ResourceType, row.SubAccountId, row.x_UnfoldLinkedSessionCount],
    [{ decimal: '0' }, { decimal: '0' }, { decimal: '12.345678' }, { decimal: '12.345678' }, { decimal: '13.580246' }, { decimal: '10' }, 'Estimate', 'telemetry-estimate', 'Linked sessions', 'globex', { decimal: '2' }]);
  assert.doesNotMatch(focusCsv(result.rows), /u-ryan|0f6c1c9e/, 'no person or session id leaves in the file');
  const euros = focusExport([], query({ linkedSessions: 'include', currency: 'EUR', usdToEur: '0.5' }), { owner: () => undefined, linked: [charge] }).rows[0];
  assert.deepEqual([euros.ListCost, euros.x_UnfoldBillableCost, euros.PricingCurrency], [{ decimal: '6.172839' }, { decimal: '6.790123' }, 'USD']);
});

test('the export reads recorded charges only for Work Items the requester may read, and counts those without a single owner', async () => {
  const db = new DatabaseSync(':memory:');
  const usage = new LinkedUsage(db, {} as AppConfig);
  usage.store.record('s-1', 4, tokens(10), '2026-10-05T10:00:00.000Z');
  const sessions = { 's-1': { id: 's-1', workItems: [{ id: '184' }, { id: '185' }, { id: '186' }] } } as Record<string, { id: string; workItems: { id: string }[] }>;
  const item = (id: string) => ({ id, title: id, team: 'silver', target: null, externalRef: '' });
  const result = await linkedWorkCharges(usage, id => sessions[id], Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-11-01T00:00:00Z'), async id => id === '184' ? { item: item(id), owner: { tenant: 'acme' } } : id === '185' ? { item: item(id), owner: undefined } : undefined);
  assert.deepEqual(result.charges.map(charge => [charge.workItemId, charge.costMicros]), [['184', 1_333_334]], 'its share only, not the whole session');
  assert.equal(result.unowned, 1);
});

test('Your usage takes the recorded estimate when the live sum is gone or lower, and the live one otherwise', () => {
  const recorded = [{ costUsd: 1.5, tokens: tokens(100), observedAt: '2026-10-17T10:00:00.000Z', source: 'telemetry-estimate' as const, costStatus: 'estimate' as const }];
  assert.deepEqual([linkedEstimate({ costUsd: null, tokens: null }, recorded).estimateUsd, linkedEstimate({ costUsd: null, tokens: null }, recorded).estimateSource], [1.5, 'recorded']);
  assert.equal(linkedEstimate({ costUsd: 0, tokens: tokens(0) }, recorded).estimateSource, 'recorded');
  assert.deepEqual([linkedEstimate({ costUsd: 2, tokens: tokens(200) }, recorded).estimateUsd, linkedEstimate({ costUsd: 2, tokens: tokens(200) }, recorded).estimateSource], [2, 'telemetry']);
  assert.deepEqual(linkedEstimate({ costUsd: null, tokens: null }, []), { estimateUsd: null, tokens: null, estimateSource: null, recordedAt: null });
});

test('only an administrator sets a markup through Billing, and a change that reaches back is refused', async () => {
  const db = new DatabaseSync(':memory:');
  const markups = new UsageMarkupStore(db);
  const tenants = { enforced: false, repositories: () => [], sources: () => [], actsFor: () => true } as unknown as TenantScope;
  const service = new BillingService(new BillingStore(db), { tenants, enabled: async () => false, demo: false, markups, now: () => Date.parse('2026-10-15T12:00:00Z') });
  const put = (user: User, data: Record<string, unknown>) => billingRoute(service, user, 'PUT', '/api/billing/usage-markups', new URLSearchParams(), async () => data);
  await assert.rejects(put(owner, { tenant: 'default', percent: 10 }), (error: BillingError) => error.status === 403);
  const set = await put(admin, { tenant: 'default', percent: '12.5', effectiveFrom: '2026-09-01' });
  assert.deepEqual((set as { json: { percent: string; basisPoints: number } }).json.percent, '12.5');
  await assert.rejects(put(admin, { tenant: 'default', percent: 20, effectiveFrom: '2026-10-01' }), (error: BillingError) => error.code === 'billing_markup_history');
  await assert.rejects(put(admin, { tenant: 'default', percent: 'lots' }), (error: BillingError) => error.code === 'billing_markup');
  const listed = await billingRoute(service, admin, 'GET', '/api/billing/usage-markups', new URLSearchParams(), async () => ({}));
  assert.equal((listed as { json: { markups: unknown[] } }).json.markups.length, 1);
});
