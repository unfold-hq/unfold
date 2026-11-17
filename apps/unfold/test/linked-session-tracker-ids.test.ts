import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LinkedSessions, parseLinkedEvent, type LinkedPloeg } from '../src/linked-sessions.ts';
import { TaskReferenceResolver, branchCandidates, taskCandidate, taskCandidates } from '../src/linked-references.ts';
import { mentionsIn, taskCandidatesIn } from '../extensions/claude-code/scripts/mentions.mjs';
import { TaskError } from '../src/task-providers/shared.ts';
import type { TaskSourceConfig } from '../src/tasks.ts';
import type { User } from '../src/types.ts';

const owner: User = { id: 'u-ryan', name: 'ryan', role: 'operator' };
const teammate: User = { id: 'u-sam', name: 'sam', role: 'operator' };
const base = 'https://unfold.example.org';
const sessionId = '0f6c1c9e-1111-4222-8333-944445555777';
const at = new Date('2026-11-17T10:00:00.000Z');

const source = (fields: Partial<TaskSourceConfig> & Pick<TaskSourceConfig, 'id' | 'provider' | 'baseUrl' | 'project'>): TaskSourceConfig => ({ name: fields.id, repositoryId: 'shop', executionOwner: 'ploeg', ...fields });
const clickup = source({ id: 'cu', provider: 'clickup', baseUrl: 'https://api.clickup.com/api/v2', project: '901' });
const jira = source({ id: 'jira', provider: 'jira', baseUrl: 'https://agency.atlassian.net/rest/api/3', project: 'OPS' });
const github = source({ id: 'gh', provider: 'github', baseUrl: 'https://api.github.com', project: 'acme/shop' });
const gitlab = source({ id: 'gl', provider: 'gitlab', baseUrl: 'https://gitlab.example.org/api/v4', project: 'group/app' });
const vikunja = source({ id: 'vik', provider: 'vikunja', baseUrl: 'https://tasks.example.org/api/v1', project: '7' });

type Call = { source: string; path: string; query?: Record<string, string> };

function trackers(calls: Call[]) {
  return (src: TaskSourceConfig) => async (path: string, query?: Record<string, string>) => {
    calls.push({ source: src.id, path, ...(query ? { query } : {}) });
    if (path === '/team') return { value: { teams: [{ id: '3001' }] }, headers: new Headers() };
    if (path === '/task/WEB-42' && query?.team_id === '3001') return { value: { id: '86c1abcde', list: { id: '901' } }, headers: new Headers() };
    if (path === '/task/WEB-43' && query?.team_id === '3001') return { value: { id: '86c9zzzzz', list: { id: '555' } }, headers: new Headers() };
    throw new TaskError(404, 'task_not_found', 'not found');
  };
}

const resolver = (sources: Record<string, TaskSourceConfig[]>, calls: Call[] = []) => new TaskReferenceResolver(async user => sources[user.id] ?? [], { request: trackers(calls) });
const all = { 'u-ryan': [clickup, jira, github, gitlab, vikunja] };

test('the plugin sends id-shaped task references and never a bare hash, a colour or a standard', () => {
  assert.deepEqual(taskCandidatesIn('Do OPS-12, CU-86c1abcde, #86c2bcdef, acme/shop#12, https://app.clickup.com/t/86c3cdefg?x=1 https://app.clickup.com/t/3001/WEB-44, https://github.com/acme/shop/issues/9, https://gitlab.example.org/group/app/-/issues/4, https://tasks.example.org/tasks/77, https://agency.atlassian.net/browse/OPS-13.'), [
    'OPS-12', '#86c1abcde', '#86c2bcdef', 'acme/shop#12',
    'https://app.clickup.com/t/86c3cdefg', 'https://app.clickup.com/t/3001/WEB-44', 'https://github.com/acme/shop/issues/9', 'https://gitlab.example.org/group/app/-/issues/4', 'https://tasks.example.org/tasks/77', 'https://agency.atlassian.net/browse/OPS-13',
  ]);
  assert.deepEqual(taskCandidatesIn('commit 86c1abcde and a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0, deadbeefcafe, colour #a1b2c3 or #a1b2c3d4, UTF-8, SHA-256, ISO-8601, RFC-9110, #123456, #abcdefgh, https://example.org/blog/post-12, https://example.org/docs#ab12cd34ef, see #work/184'), []);
  assert.deepEqual(taskCandidatesIn('VIK-12 and OPS-3', ['VIK']), ['OPS-3'], 'a prefix Unfold named stays a tracker reference');
  assert.deepEqual(mentionsIn('Fix OPS-12', ['VIK'], base), { refs: [], workItems: [], tasks: ['OPS-12'] });
  assert.equal(mentionsIn('nothing but 86c1abcde', ['VIK'], base), null);
});

test('Unfold accepts only the candidate shapes it knows and drops the rest', () => {
  assert.deepEqual(taskCandidate('OPS-12'), { kind: 'key', key: 'OPS-12' });
  assert.deepEqual(taskCandidate('#86c1abcde'), { kind: 'mark', id: '86c1abcde' });
  assert.deepEqual(taskCandidate('Acme/Shop#12'), { kind: 'issue', path: 'acme/shop', number: '12' });
  assert.deepEqual(taskCandidate('https://GitLab.example.org/group/app/-/issues/4'), { kind: 'issue', host: 'gitlab.example.org', path: 'group/app', number: '4' });
  assert.deepEqual(taskCandidate('https://app.clickup.com/t/86c1abcde'), { kind: 'url', host: 'app.clickup.com', path: '/t/86c1abcde' });
  for (const rejected of ['86c1abcde', '#a1b2c3', '#deadbeef', '#123456', 'UTF-8', 'SHA-256', 'CU-86', 'ops-12', 'https://u:p@app.clickup.com/t/86c1abcde', 'https://app.clickup.com/t/86c1abcde?token=x', 'javascript:alert(1)', 42, 'x'.repeat(301)]) assert.equal(taskCandidate(rejected), undefined, String(rejected));
  assert.equal(taskCandidates(Array.from({ length: 30 }, (_, index) => `OPS-${index + 1}`)).length, 10);
  assert.deepEqual(branchCandidates('feat/ops-12-login'), [{ kind: 'key', key: 'OPS-12' }]);
  assert.deepEqual(branchCandidates('CU-86c1abcde_checkout-page'), [{ kind: 'mark', id: '86c1abcde' }]);
  assert.deepEqual(branchCandidates('fix/utf-8-and-sha-256-and-vik-12'), [], 'standards and prefixes Unfold already names are not candidates');
});

test('each tracker resolves the references that name its own source and nothing else', async () => {
  const calls: Call[] = [];
  const resolve = resolver(all, calls).resolve;
  const one = async (value: string) => resolve(owner, [taskCandidate(value)!]);
  assert.deepEqual(await one('#86c1abcde'), [{ provider: 'clickup', externalId: '86c1abcde' }]);
  assert.deepEqual(await one('https://app.clickup.com/t/86c3cdefg'), [{ provider: 'clickup', externalId: '86c3cdefg' }]);
  assert.deepEqual(await one('https://app.clickup.com/t/3001/WEB-42'), [{ provider: 'clickup', externalId: '86c1abcde' }], 'a custom task id resolves in the workspace the address names');
  assert.deepEqual(await one('WEB-42'), [{ provider: 'clickup', externalId: '86c1abcde' }], 'a bare custom task id resolves through the workspaces of the token');
  assert.deepEqual(await one('WEB-43'), [], 'a custom task id whose task lives outside the source’s List resolves to nothing');
  assert.deepEqual(await one('OPS-12'), [{ provider: 'jira', externalId: 'OPS-12' }]);
  assert.deepEqual(await one('https://agency.atlassian.net/browse/OPS-13'), [{ provider: 'jira', externalId: 'OPS-13' }]);
  assert.deepEqual(await one('https://other.atlassian.net/browse/OPS-13'), [], 'a Jira address on another site resolves to nothing');
  assert.deepEqual(await one('acme/shop#12'), [{ provider: 'github', externalId: '12', repository: 'acme/shop' }]);
  assert.deepEqual(await one('https://github.com/acme/shop/issues/9'), [{ provider: 'github', externalId: '9', repository: 'acme/shop' }]);
  assert.deepEqual(await one('https://github.com/acme/other/issues/9'), [], 'an issue of a repository without a source resolves to nothing');
  assert.deepEqual(await one('https://forge.example.org/acme/shop/issues/9'), [], 'the same repository path on another host resolves to nothing');
  assert.deepEqual(await one('https://gitlab.example.org/group/app/-/issues/4'), [{ provider: 'gitlab', externalId: '4', repository: 'group/app' }]);
  assert.deepEqual(await one('https://tasks.example.org/tasks/77'), [{ provider: 'vikunja', externalId: '77' }]);
  assert.deepEqual(await one('VIK-77'), [{ provider: 'vikunja', externalId: '77' }]);
  assert.deepEqual(await one('https://elsewhere.example.org/tasks/77'), []);
  assert.deepEqual(await resolve(teammate, [taskCandidate('OPS-12')!, taskCandidate('#86c1abcde')!]), [], 'a person without these sources resolves nothing');
  const before = calls.length;
  assert.deepEqual(await one('WEB-42'), [{ provider: 'clickup', externalId: '86c1abcde' }]);
  assert.equal(calls.length, before, 'a resolved custom id is remembered');
  await one('NOPE-1');
  const afterMiss = calls.length;
  await one('NOPE-1');
  assert.equal(calls.length, afterMiss, 'a miss is remembered too');
});

test('one resolution reads the tracker a bounded number of times and survives a failing tracker', async () => {
  const calls: Call[] = [];
  const resolve = resolver({ 'u-ryan': [clickup] }, calls).resolve;
  assert.deepEqual(await resolve(owner, Array.from({ length: 10 }, (_, index) => taskCandidate(`ZZZ-${index + 1}`)!)), []);
  assert.ok(calls.length <= 6, `read ${calls.length} times`);
  const failing = new TaskReferenceResolver(async () => [clickup], { request: () => async () => { throw new Error('down'); } });
  assert.deepEqual(await failing.resolve(owner, [taskCandidate('WEB-42')!, taskCandidate('#86c1abcde')!]), [{ provider: 'clickup', externalId: '86c1abcde' }]);
});

function fakePloeg(): LinkedPloeg {
  const held: Record<string, { id: string; state: string; target: { owner: string; repo: string } | null }[]> = {
    'clickup:86c1abcde': [{ id: '301', state: 'active', target: { owner: 'acme', repo: 'shop' } }],
    'jira:OPS-12': [{ id: '302', state: 'active', target: null }],
    'github:12': [{ id: '303', state: 'active', target: { owner: 'acme', repo: 'shop' } }, { id: '304', state: 'active', target: { owner: 'acme', repo: 'other' } }],
  };
  return {
    async detail(_user, item) { return { item: { id: item, title: `Item ${item}`, provider: 'clickup', externalId: '86c1abcde' } }; },
    async trackerItems(user, provider, externalId) { return { items: user.id === owner.id ? held[`${provider}:${externalId}`] ?? [] : [] }; },
  };
}

const linkedService = (sources: Record<string, TaskSourceConfig[]> = all) => new LinkedSessions(new DatabaseSync(':memory:'), {} as never, fakePloeg(), { now: () => at, resolveTasks: resolver(sources).resolve });
const report = (fields: Record<string, unknown>) => parseLinkedEvent({ harness: 'claude-code', sessionId, event: 'prompt', ...fields }, at);

test('a ClickUp, Jira or GitHub reference links only a Work Item Ploeg holds for that task, and only on the repository it names', async () => {
  const linked = linkedService();
  const prompted = await linked.report(owner, report({ mentions: { tasks: ['#86c1abcde', 'OPS-12', 'acme/shop#12', '#deadbe7f9', 'WEB-43'] } }), base);
  assert.deepEqual(prompted.session.workItems.map(entry => [entry.id, entry.how]), [['301', 'mention'], ['302', 'mention'], ['303', 'mention']], 'the GitHub Work Item of another repository and ids with no Work Item stay out');
});

test('a branch named after a ClickUp or Jira task links its Work Item', async () => {
  const linked = linkedService();
  const started = await linked.report(owner, report({ event: 'start', branch: 'CU-86c1abcde_checkout' }), base);
  assert.deepEqual(started.session.workItems.map(entry => [entry.id, entry.how]), [['301', 'branch']]);
  const moved = await linked.report(owner, report({ event: 'start', branch: 'feat/ops-12-login' }), base);
  assert.deepEqual(moved.session.workItems.map(entry => [entry.id, entry.how]), [['301', 'branch'], ['302', 'branch']]);
});

test('a reference links nothing for a person whose task sources do not hold it, and random hex links nothing', async () => {
  const linked = linkedService({ 'u-ryan': [], 'u-sam': [clickup, jira, github] });
  const other = await linked.report(owner, report({ mentions: { tasks: ['#86c1abcde', 'OPS-12', 'acme/shop#12'] } }), base);
  assert.deepEqual(other.session.workItems, []);
  const hex = await linkedService().report(owner, report({ mentions: { tasks: ['#a1b2c3', '#deadbeef', '86c1abcde', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'] }, branch: 'fix/86c1abcde' }), base);
  assert.deepEqual(hex.session.workItems, []);
});
