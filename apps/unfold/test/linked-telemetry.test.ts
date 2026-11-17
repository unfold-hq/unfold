import test from 'node:test';
import assert from 'node:assert/strict';
import { digestCostQuery, metricQueries, readSessionTelemetry, readSessionsCost, readSessionsUsage } from '../src/linked-telemetry.ts';

type Series = { name: string; labels: Record<string, string>; value: number };

const branchShape = /^(sum(?: by \(type\))?) \(max_over_time\(\{__name__=~"([^"]+)", (session_id|"session\.id")(=~?)("(?:[^"\\]|\\.)*")\}\[\d+s\]\)\)$/;

function evaluate(query: string, series: Series[]): { metric: Record<string, string>; value: [number, string] }[] {
  const answer = new Map<string, { metric: Record<string, string>; value: number }>();
  for (const branch of query.split(' or ')) {
    const shape = branchShape.exec(branch);
    if (!shape) throw new Error(`the fake store cannot read ${branch}`);
    const [, aggregate, name, quotedLabel, operator, literal] = shape;
    const label = quotedLabel.replaceAll('"', '');
    const wanted = JSON.parse(literal) as string;
    const matches = (value: string | undefined) => value !== undefined && (operator === '=' ? value === wanted : new RegExp(`^(?:${wanted})$`).test(value));
    const groups = new Map<string, { metric: Record<string, string>; value: number }>();
    for (const entry of series.filter(entry => new RegExp(`^(?:${name})$`).test(entry.name) && matches(entry.labels[label]))) {
      const metric: Record<string, string> = aggregate === 'sum' ? {} : { type: entry.labels.type };
      const key = JSON.stringify(metric);
      groups.set(key, { metric, value: (groups.get(key)?.value ?? 0) + entry.value });
    }
    for (const [key, group] of groups) if (!answer.has(key)) answer.set(key, group);
  }
  return [...answer.values()].map(entry => ({ metric: entry.metric, value: [0, String(entry.value)] }));
}

function store(series: Series[]): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const query = new URLSearchParams(String(init.body)).get('query') ?? '';
    return new Response(JSON.stringify({ status: 'success', data: { result: evaluate(query, series) } }));
  }) as typeof fetch;
}

const session = 'abcd1234-aaaa';
const other = 'abcd1234-bbbb';

function converted(id: string, cost: number, label = 'session_id', names = { cost: 'claude_code_cost_usage_USD_total', tokens: 'claude_code_token_usage_tokens_total', active: 'claude_code_active_time_seconds_total' }): Series[] {
  return [
    { name: names.cost, labels: { [label]: id, model: 'opus' }, value: cost },
    { name: names.tokens, labels: { [label]: id, type: 'input' }, value: 1000 },
    { name: names.tokens, labels: { [label]: id, type: 'output' }, value: 200 },
    { name: names.tokens, labels: { [label]: id, type: 'cacheRead' }, value: 50 },
    { name: names.tokens, labels: { [label]: id, type: 'cacheCreation' }, value: 5 },
    { name: names.active, labels: { [label]: id }, value: 90 },
  ];
}

const asReceived = (id: string, cost: number) => converted(id, cost, 'session.id', { cost: 'claude_code.cost.usage', tokens: 'claude_code.token.usage', active: 'claude_code.active_time.total' });
const fromExporter = (id: string, cost: number) => converted(id, cost, 'session_id', { cost: 'claude_code_cost_usage_total', tokens: 'claude_code_token_usage_total', active: 'claude_code_active_time_total' });
const metricsOnly = { metricsUrl: 'http://vm.local' };
const now = Date.parse('2026-11-17T10:00:00Z');
const read = (series: Series[]) => readSessionTelemetry(metricsOnly, session, '2026-11-17T09:00:00Z', { fetch: store(series), now });

test('a session reads the same whether the store converted Claude Code’s metric names, kept them as received, or scraped its Prometheus exporter', async () => {
  for (const series of [converted(session, 1.25), asReceived(session, 1.25), fromExporter(session, 1.25)]) {
    const telemetry = await read([...series, ...converted(other, 99), ...asReceived(other, 99)]);
    assert.equal(telemetry.costUsd, 1.25, series[0].name);
    assert.deepEqual(telemetry.tokens, { input: 1000, output: 200, cacheRead: 50, cacheCreation: 5 }, series[0].name);
    assert.equal(telemetry.activeSeconds, 90, series[0].name);
    assert.equal(telemetry.available, true);
  }
});

test('a store holding both namings of one session counts it once', async () => {
  const telemetry = await read([...converted(session, 1.25), ...asReceived(session, 1.25)]);
  assert.equal(telemetry.costUsd, 1.25);
  assert.equal(telemetry.tokens?.input, 1000);
});

test('a session with no series is unknown, never zero, and a reported zero stays zero', async () => {
  const missing = await read(converted(other, 3));
  assert.deepEqual([missing.costUsd, missing.tokens, missing.activeSeconds, missing.available], [null, null, null, false]);
  assert.match(String(missing.reason), /no Claude Code metrics for this session yet/);
  const zero = await read(asReceived(session, 0).map(entry => ({ ...entry, value: 0 })));
  assert.deepEqual([zero.costUsd, zero.tokens, zero.activeSeconds, zero.available], [0, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, 0, true]);
  assert.doesNotMatch(String(zero.reason), /no Claude Code metrics/);
});

test('a session with no log events has unknown events, not zero prompts', async () => {
  const fetcher = (async (url: string) => String(url).endsWith('/api/v1/query') ? new Response(JSON.stringify({ status: 'success', data: { result: [] } })) : new Response('')) as typeof fetch;
  const telemetry = await readSessionTelemetry({ metricsUrl: 'http://vm.local', logsUrl: 'http://vl.local' }, session, '2026-11-17T09:00:00Z', { fetch: fetcher, now });
  assert.deepEqual([telemetry.events, telemetry.available], [null, false]);
  assert.match(String(telemetry.reason), /no Claude Code events/);
});

test('the queries ask the session label under both namings, quoting the dotted one', () => {
  const queries = metricQueries(session, '600s');
  assert.match(queries.cost, /session_id="abcd1234-aaaa"/);
  assert.match(queries.cost, /"session\.id"="abcd1234-aaaa"/);
  assert.match(digestCostQuery([session, other], '600s'), /"session\.id"=~"abcd1234-aaaa\|abcd1234-bbbb"/);
});

test('the digest and Your usage read both namings and say unknown when the store has nothing for the sessions', async () => {
  for (const series of [converted(session, 2), asReceived(session, 2)]) {
    assert.deepEqual(await readSessionsCost(metricsOnly, [session], '600s', { fetch: store([...series, ...asReceived(other, 7)]) }), { costUsd: 2, reason: null });
    const usage = await readSessionsUsage(metricsOnly, [session], '600s', { fetch: store(series) });
    assert.deepEqual(usage, { costUsd: 2, tokens: { input: 1000, output: 200, cacheRead: 50, cacheCreation: 5 }, reason: null, read: true });
  }
  const unseen = await readSessionsCost(metricsOnly, [session], '600s', { fetch: store(asReceived(other, 7)) });
  assert.equal(unseen.costUsd, null);
  assert.match(String(unseen.reason), /no metrics for these sessions yet/);
  const empty = await readSessionsUsage(metricsOnly, [session], '600s', { fetch: store([]) });
  assert.deepEqual([empty.costUsd, empty.tokens, empty.read], [null, null, true]);
  assert.match(String(empty.reason), /no metrics for these sessions yet/);
  const zero = await readSessionsUsage(metricsOnly, [session], '600s', { fetch: store(asReceived(session, 0).map(entry => ({ ...entry, value: 0 }))) });
  assert.deepEqual([zero.costUsd, zero.tokens, zero.reason], [0, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, null]);
});

test('session ids Unfold would not ask about never become an empty matcher that reads every unlabelled series', async () => {
  const everyone = [...asReceived('abcd1234-cccc', 40), ...asReceived('abcd1234-dddd', 60)];
  const asked: string[] = [];
  const watched = (async (url: string, init: RequestInit) => { asked.push(new URLSearchParams(String(init.body)).get('query') ?? ''); return store(everyone)(url, init); }) as typeof fetch;
  const cost = await readSessionsCost(metricsOnly, ['bad"}|.*', 'short'], '600s', { fetch: watched });
  const usage = await readSessionsUsage(metricsOnly, ['bad"}|.*'], '600s', { fetch: watched });
  assert.deepEqual([cost.costUsd, usage.costUsd, usage.tokens, asked.length], [null, null, null, 0]);
});
