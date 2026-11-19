import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRemote, type GitRepository } from '../src/git-remotes.ts';
import type { PloegItem, RunCard, RunCardPlay } from '../src/ploeg-types.ts';
import { UnfoldTimeline, atLeast, matchCommits, parseLog, readMergedIndex, repositoryOf, timelineApi, timelineItemContext, timelineSourceId, type TimelineReader } from '../src/timeline.ts';

const sha = (digit: string) => digit.repeat(40);
const merged = sha('a');
const head = sha('b');
const unrelated = sha('c');
const unmerged = sha('d');
const root = '/work/shop';
const file = `${root}/src/cart.ts`;

const repository = (remote = 'git@forgejo.example:acme/shop.git', path = root): GitRepository => ({
  rootUri: { path, fsPath: path },
  state: { remotes: [{ name: 'origin', fetchUrl: remote }], workingTreeChanges: [], indexChanges: [], mergeChanges: [] },
  fetch: async () => {}, getBranch: async () => ({}), checkout: async () => {}, createBranch: async () => {}, setBranchUpstream: async () => {}, pull: async () => {}, status: async () => {},
});

const item = (id: string, extra: Partial<PloegItem> = {}): PloegItem => ({ id, title: `Fix the cart total ${id}`, provider: 'vikunja', externalId: id, team: 'bronze', state: 'done', description: '', attempts: 1, target: { owner: 'acme', repo: 'shop' }, ...extra });
const play = (extra: Partial<RunCardPlay> = {}): RunCardPlay => ({ number: 12, url: 'https://forgejo.example/acme/shop/pulls/12', state: 'merged', branch: 'agent/vik-1', headSha: head, mergeCommitSha: merged, mergedAt: '2026-11-10T09:30:00Z', ci: null, reviews: [], ...extra });
const card = (id: string, plays: RunCardPlay[]): RunCard => ({ workItemId: id, state: 'done', roles: [], plays, totals: { costStatus: 'observed', usageComplete: true }, demo: false });

type Calls = { now: number; pages: string[]; cards: string[] };
function reader(data: { teams?: string[]; items?: PloegItem[]; cards?: Record<string, RunCard | undefined>; demo?: boolean; fail?: boolean } = {}): TimelineReader & { calls: Calls } {
  const calls: Calls = { now: 0, pages: [], cards: [] };
  return {
    calls,
    origin: 'https://unfold.example',
    async ploegNow() { calls.now++; if (data.fail) throw new Error('unreachable'); return { demo: Boolean(data.demo), teams: data.teams ?? ['bronze'] }; },
    async closedWorkItems(team, cursor) { calls.pages.push(`${team}@${cursor}`); return { items: (data.items ?? [item('41')]).filter(entry => entry.team === team), nextCursor: null }; },
    async workItemCard(id) { calls.cards.push(id); return data.cards ? data.cards[id] : card(id, [play()]); },
  };
}

function timeline(options: { reader?: TimelineReader; signedIn?: boolean; trusted?: boolean; repositories?: GitRepository[]; log?: string; clock?: () => number } = {}) {
  const logs: { root: string; file: string }[] = [];
  const source = new UnfoldTimeline({
    parseRemote,
    signedIn: async () => options.signedIn ?? true,
    trusted: () => options.trusted ?? true,
    repositories: async () => options.repositories ?? [repository()],
    log: async (at, path) => { logs.push({ root: at, file: path }); return options.log ?? `${merged} 1762767000\n${unrelated} 1762700000\n`; },
    reader: () => options.reader,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  return { source, logs };
}

test('a file changed by a merged Work Item pull request lists that Work Item with its title, date and pull request number', async () => {
  const read = reader();
  const { source, logs } = timeline({ reader: read });
  const entries = await source.entries(file);
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry!.label, 'Fix the cart total 41');
  assert.equal(entry!.description, 'PR #12 · Work Item 41');
  assert.equal(entry!.timestamp, Date.parse('2026-11-10T09:30:00Z'));
  assert.match(entry!.tooltip, /Pull request #12, merged 2026-11-10 as aaaaaaaa/);
  assert.deepEqual(entry!.workItem, { id: '41', title: 'Fix the cart total 41' });
  assert.equal(entry!.pullRequestUrl, 'https://forgejo.example/acme/shop/pulls/12');
  assert.deepEqual(logs, [{ root, file }]);
  assert.deepEqual(read.calls.pages, ['bronze@0'], 'it reads the closed Work Items of the person\'s own Teams');
});

test('choosing an entry opens the Work Item, and its pull request is kept for the secondary action', async () => {
  const { source } = timeline({ reader: reader() });
  const [entry] = await source.entries(file);
  const item = {};
  source.remember(item, entry!.pullRequestUrl);
  assert.equal(source.pullRequestOf(item), 'https://forgejo.example/acme/shop/pulls/12');
  assert.equal(source.pullRequestOf({}), undefined, 'an item from another source has no pull request here');
  assert.equal(source.pullRequestOf(undefined), undefined);
  const extension = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
  assert.match(extension, /command: \{ command: 'unfold\.openWorkItem', title: 'Open Work Item', arguments: \[entry\.workItem\] \}/);
  assert.match(extension, /safeHttpsUrl\(this\.timeline\.pullRequestOf\(value\)\)/);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.contributes.menus['timeline/item/context'], [{ command: 'unfold.openPullRequest', when: `timelineItem == ${timelineItemContext}`, group: 'inline' }]);
});

test('only the Work Items the workbench returns to the person are listed; a refused card, another repository, an open or withdrawn Work Item and an unmerged pull request are not', async () => {
  const items = [item('41'), item('42', { target: { owner: 'acme', repo: 'other' } }), item('43', { state: 'withdrawn' }), item('44'), item('45')];
  const read = reader({ items, cards: { '41': card('41', [play()]), '44': undefined, '45': card('45', [play({ number: 13, state: 'closed', mergeCommitSha: unmerged, headSha: unmerged })]) } });
  const { source } = timeline({ reader: read, log: `${merged} 1\n${unmerged} 1\n` });
  const entries = await source.entries(file);
  assert.deepEqual(entries.map(entry => entry.workItem.id), ['41']);
  assert.deepEqual(read.calls.cards.sort(), ['41', '44', '45'], 'no card is read for another repository or a Work Item that is not done');
});

test('a file with no Unfold history shows nothing, and listing runs one Git command per file and reads Ploeg once per repository', async () => {
  const read = reader();
  const { source, logs } = timeline({ reader: read, log: `${unrelated} 1762700000\n` });
  assert.deepEqual(await source.entries(file), []);
  assert.deepEqual(await source.entries(`${root}/README.md`), []);
  assert.deepEqual(await source.entries(`${root}/src/other.ts`), []);
  assert.equal(logs.length, 3, 'one git log per file');
  assert.equal(read.calls.now, 1, 'one read of the person\'s Teams for the repository');
  assert.equal(read.calls.cards.length, 1);
});

test('a file without commits reads nothing from the workbench, and a file outside every repository runs no Git command', async () => {
  const read = reader();
  const empty = timeline({ reader: read, log: '' });
  assert.deepEqual(await empty.source.entries(file), []);
  assert.equal(read.calls.now, 0);
  const outside = timeline({ reader: read });
  assert.deepEqual(await outside.source.entries('/elsewhere/notes.md'), []);
  assert.equal(outside.logs.length, 0);
});

test('the cached read lasts ten minutes and an explicit refresh or reset reads again', async () => {
  let at = 0;
  const read = reader();
  const { source } = timeline({ reader: read, clock: () => at });
  await source.entries(file);
  at = 9 * 60_000;
  await source.entries(file);
  assert.equal(read.calls.now, 1);
  await source.entries(file, true);
  assert.equal(read.calls.now, 2);
  source.reset();
  await source.entries(file);
  assert.equal(read.calls.now, 3);
  at = 30 * 60_000;
  await source.entries(file);
  assert.equal(read.calls.now, 4);
});

test('when the person is signed out, the source lists nothing, runs no Git command and reads nothing', async () => {
  const read = reader();
  const { source, logs } = timeline({ reader: read, signedIn: false });
  assert.deepEqual(await source.entries(file), []);
  assert.equal(logs.length, 0);
  assert.equal(read.calls.now, 0);
  const unconfigured = timeline({ reader: undefined });
  assert.deepEqual(await unconfigured.source.entries(file), []);
  assert.equal(unconfigured.logs.length, 0);
});

test('an untrusted workspace runs no Git command', async () => {
  const { source, logs } = timeline({ reader: reader(), trusted: false });
  assert.deepEqual(await source.entries(file), []);
  assert.equal(logs.length, 0);
});

test('a failed workbench read lists nothing and is not cached', async () => {
  const read = reader({ fail: true });
  const { source } = timeline({ reader: read });
  assert.deepEqual(await source.entries(file), []);
  assert.deepEqual(await source.entries(file), []);
  assert.equal(read.calls.now, 2);
});

test('the demo lists nothing, so it never presents illustrative pull requests as this repository\'s history', async () => {
  const read = reader({ demo: true });
  assert.equal((await readMergedIndex(read, ['acme/shop'])).size, 0);
  assert.equal(read.calls.cards.length, 0);
});

test('a fast-forward merge matches by head SHA, and one pull request is listed once', async () => {
  const index = await readMergedIndex(reader(), ['acme/shop']);
  const entries = matchCommits(parseLog(`${head} 1762767000\n${merged} 1762767000\n`), index);
  assert.equal(entries.length, 1);
});

test('git log output parses to SHAs and times, and the repository is the innermost one holding the file', () => {
  assert.deepEqual(parseLog(`${merged.toUpperCase()} 17\nnot a sha 3\n\n${unrelated} x`), [{ sha: merged, time: 17 }, { sha: unrelated, time: 0 }]);
  const outer = repository(undefined, '/work');
  const inner = repository(undefined, root);
  assert.equal(repositoryOf([outer, inner], file), inner);
  assert.equal(repositoryOf([inner], '/work/shopping/x.ts'), undefined);
});

const modern = (extra: Record<string, unknown> = {}) => {
  const registered: unknown[][] = [];
  class TimelineItem { label: string; timestamp: number; constructor(label: string, timestamp: number) { this.label = label; this.timestamp = timestamp; } }
  const host = { version: '1.147.0', workspace: { registerTimelineProvider(...args: unknown[]) { registered.push(args); return { dispose() {} }; } }, TimelineItem, TimelineTriggerKind: { Invoke: 1, Automatic: 2 }, ...extra };
  return { host, registered };
};

test('VS Code 1.145 and later get the Unfold Timeline source for files', () => {
  const { host, registered } = modern();
  const api = timelineApi<object, { label: string; timestamp: number }>(host);
  assert.ok(api);
  const provider = {};
  api.register(provider);
  assert.deepEqual(registered, [[timelineSourceId, 'Unfold', 'file', provider]]);
  assert.deepEqual({ ...api.item('Fix it', 5) }, { label: 'Fix it', timestamp: 5 });
  assert.equal(api.invoked(1), true);
  assert.equal(api.invoked(2), false);
  assert.ok(timelineApi(modern({ version: '1.145.0-insider' }).host));
  assert.ok(timelineApi(modern({ version: '2.0.0' }).host));
});

test('VS Code before 1.145 gets no Timeline source and no error, even though it carries the old proposed function', () => {
  const proposal = () => { throw new Error('Extension \'unfold-hq.unfold-workbench\' CANNOT use API proposal: timeline.'); };
  for (const version of ['1.99.3', '1.144.2', '1.9.0']) {
    const { host } = modern({ version, workspace: { registerTimelineProvider: proposal } });
    assert.equal(timelineApi(host), undefined, `${version} has no Timeline source`);
  }
  assert.equal(timelineApi(modern({ version: undefined }).host), undefined);
  assert.equal(timelineApi(modern({ TimelineTriggerKind: undefined }).host), undefined);
  assert.equal(timelineApi(modern({ workspace: {} }).host), undefined);
  assert.equal(atLeast('1.144.9'), false);
  assert.equal(atLeast('1.145.0'), true);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.engines.vscode, '^1.99.0', 'the engine floor stays; the Timeline API is feature-detected');
  const extension = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
  assert.match(extension, /const api = timelineApi<[^\n]+>\(vscode as unknown as[^\n]+\);\n\s+if \(!api\) return;\n\s+try \{/, 'registration is skipped without the API and cannot fail activation');
});
