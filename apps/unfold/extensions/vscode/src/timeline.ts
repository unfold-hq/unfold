import type { GitRepository, RepositoryIdentity } from './git-remotes.js';
import type { PloegItem, RunCard } from './ploeg-types.js';

/** The provider id and the label the Timeline view filters by. */
export const timelineSourceId = 'unfold.workItems';
export const timelineSourceLabel = 'Unfold';
/** The context value of an Unfold entry, for the menu that opens its pull request. */
export const timelineItemContext = 'unfold.workItem';

/** VS Code finalized the Timeline API in 1.145. Older editors carry an unrelated proposed `registerTimelineProvider` that throws. */
export const timelineMinimumVersion = [1, 145] as const;

/** The reads the Timeline source makes, a subset of `UnfoldClient`: only the signed-in person's own Teams and Work Items. */
export type TimelineReader = {
  readonly origin: string;
  ploegNow(): Promise<{ demo?: boolean; teams?: string[] }>;
  closedWorkItems(team: string, cursor: string): Promise<{ items: PloegItem[]; nextCursor: string | null }>;
  workItemCard(id: string): Promise<RunCard | undefined>;
};

/** One Work Item pull request whose merge landed a commit of this repository. */
export type MergedPullRequest = { workItemId: string; title: string; team: string; number: number; url: string; mergedAt: string | null };

/** Merged pull requests by the lowercase commit SHA they landed as. */
export type MergedIndex = ReadonlyMap<string, readonly MergedPullRequest[]>;

/** A commit `git log --format='%H %ct'` printed: its SHA and commit time in seconds. */
export type LoggedCommit = { sha: string; time: number };

/** One Timeline entry before it becomes a `TimelineItem`. */
export type TimelineEntry = { id: string; label: string; description: string; tooltip: string; timestamp: number; workItem: { id: string; title: string }; pullRequestUrl: string };

/** How far one repository's read reaches: Teams, pages of closed Work Items per Team, Run cards, and cards read at once. */
export const timelineLimits = { teams: 6, pagesPerTeam: 4, cards: 60, parallel: 4, cacheMs: 10 * 60_000 };

const shaPattern = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The commits in `git log --format='%H %ct'` output, newest first; anything else is skipped. */
export function parseLog(output: string): LoggedCommit[] {
  return output.split('\n').flatMap(line => {
    const [sha, time] = line.trim().split(' ');
    const value = sha?.toLowerCase() ?? '';
    return shaPattern.test(value) ? [{ sha: value, time: Number(time) || 0 }] : [];
  });
}

/** The repository paths (`owner/repo`, lowercase) the remotes of `repository` point at, read with `parseRemote`. */
export function repositoryPaths(repository: Pick<GitRepository, 'state'>, parseRemote: (url: string | undefined) => RepositoryIdentity | undefined): string[] {
  const paths = repository.state.remotes.flatMap(remote => [remote.fetchUrl, remote.pushUrl]).map(url => parseRemote(url)?.path.toLowerCase()).filter((path): path is string => Boolean(path));
  return [...new Set(paths)].sort();
}

/** The open repository holding `file`: the one with the longest root that contains it. */
export function repositoryOf<T extends { rootUri: { fsPath: string } }>(repositories: readonly T[], file: string): T | undefined {
  const inside = repositories.filter(repository => {
    const root = repository.rootUri.fsPath.replace(/[\\/]+$/, '');
    return file.startsWith(`${root}/`) || file.startsWith(`${root}\\`);
  });
  return inside.sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
}

const targetPath = (item: PloegItem) => item.target ? [...item.target.owner.split('/'), ...item.target.repo.split('/')].filter(Boolean).join('/').toLowerCase() : '';

async function inBatches<T, R>(values: readonly T[], size: number, read: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += size) results.push(...await Promise.all(values.slice(index, index + size).map(read)));
  return results;
}

/**
 * The merged pull requests of the person's done Work Items that target one of `paths`, by the SHAs they landed as.
 * It reads the newest closed Work Items of the person's Teams, then the Run card of each that targets this repository.
 * A Work Item the person may not read is never returned by the workbench, and a card it refuses is left out.
 */
export async function readMergedIndex(reader: TimelineReader, paths: readonly string[], limits = timelineLimits): Promise<MergedIndex> {
  const index = new Map<string, MergedPullRequest[]>();
  if (!paths.length) return index;
  const now = await reader.ploegNow();
  if (now.demo) return index;
  const wanted = new Set(paths);
  const done: PloegItem[] = [];
  await Promise.all((now.teams ?? []).slice(0, limits.teams).map(async team => {
    let cursor = '0';
    for (let page = 0; page < limits.pagesPerTeam; page++) {
      const result = await reader.closedWorkItems(team, cursor);
      done.push(...result.items.filter(item => item.state === 'done' && wanted.has(targetPath(item))));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
  }));
  const chosen = [...new Map(done.map(item => [item.id, item])).values()].sort((a, b) => b.id.length - a.id.length || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0)).slice(0, limits.cards);
  const cards = await inBatches(chosen, limits.parallel, async item => ({ item, card: await reader.workItemCard(item.id).catch(() => undefined) }));
  for (const { item, card } of cards) {
    if (!card || card.demo) continue;
    for (const play of card.plays) {
      if (play.state !== 'merged' || !play.url) continue;
      const entry: MergedPullRequest = { workItemId: item.id, title: item.title, team: item.team, number: play.number, url: play.url, mergedAt: play.mergedAt };
      for (const sha of new Set([play.mergeCommitSha, play.headSha].map(value => value?.toLowerCase() ?? '').filter(value => shaPattern.test(value)))) index.set(sha, [...(index.get(sha) ?? []), entry]);
    }
  }
  return index;
}

const dateOf = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

/** The Timeline entries for a file's commits: one per Work Item pull request whose merge SHA is among them, newest first. */
export function matchCommits(commits: readonly LoggedCommit[], index: MergedIndex): TimelineEntry[] {
  const entries = new Map<string, TimelineEntry>();
  for (const commit of commits) {
    for (const pull of index.get(commit.sha) ?? []) {
      const id = `${pull.workItemId}:${pull.number}`;
      if (entries.has(id)) continue;
      const timestamp = Date.parse(pull.mergedAt ?? '') || commit.time * 1000;
      const title = pull.title || `Work Item ${pull.workItemId}`;
      entries.set(id, {
        id,
        label: title,
        description: `PR #${pull.number} · Work Item ${pull.workItemId}`,
        tooltip: `Work Item ${pull.workItemId}: ${title}\nPull request #${pull.number}, merged ${dateOf(timestamp)} as ${commit.sha.slice(0, 8)}\nTeam ${pull.team}`,
        timestamp,
        workItem: { id: pull.workItemId, title },
        pullRequestUrl: pull.url,
      });
    }
  }
  return [...entries.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/** What the Timeline source needs from the editor: sign-in, workspace trust, the open repositories and how to read their remotes, one `git log` per file and the reader. */
export type TimelineDependencies = {
  parseRemote(url: string | undefined): RepositoryIdentity | undefined;
  signedIn(): Promise<boolean>;
  trusted(): boolean;
  repositories(): Promise<readonly GitRepository[]>;
  log(root: string, file: string): Promise<string>;
  reader(): TimelineReader | undefined;
  clock?: () => number;
};

/** The Unfold Timeline source: per file one `git log`, per repository one cached read of the person's merged Work Items. */
export class UnfoldTimeline {
  private readonly cache = new Map<string, { at: number; index: Promise<MergedIndex> }>();
  private readonly links = new WeakMap<object, string>();

  private readonly dependencies: TimelineDependencies;

  constructor(dependencies: TimelineDependencies) { this.dependencies = dependencies; }

  /** Forgets every repository's read, for a sign-out, another workbench or an explicit refresh. */
  reset(): void { this.cache.clear(); }

  /** The entries for the file at `file`; empty when signed out, untrusted, outside a repository or without Unfold history. `fresh` drops the cached read first. */
  async entries(file: string, fresh = false, cancelled: () => boolean = () => false): Promise<TimelineEntry[]> {
    const reader = this.dependencies.reader();
    if (!reader || !this.dependencies.trusted() || !await this.dependencies.signedIn()) return [];
    const repository = repositoryOf(await this.dependencies.repositories(), file);
    const paths = repository ? repositoryPaths(repository, this.dependencies.parseRemote) : [];
    if (!repository || !paths.length || cancelled()) return [];
    const commits = parseLog(await this.dependencies.log(repository.rootUri.fsPath, file).catch(() => ''));
    if (!commits.length || cancelled()) return [];
    const key = `${reader.origin}\n${repository.rootUri.fsPath}\n${paths.join(' ')}`;
    const at = (this.dependencies.clock ?? Date.now)();
    const cached = this.cache.get(key);
    if (fresh || !cached || at - cached.at > timelineLimits.cacheMs) {
      const index = readMergedIndex(reader, paths);
      this.cache.set(key, { at, index });
      index.catch(() => { if (this.cache.get(key)?.index === index) this.cache.delete(key); });
    }
    const index = await this.cache.get(key)!.index.catch(() => new Map() as MergedIndex);
    return cancelled() ? [] : matchCommits(commits, index);
  }

  /** Remembers the pull request behind a Timeline item VS Code hands back to a menu command. */
  remember(item: object, url: string): void { this.links.set(item, url); }

  /** The pull request URL of a Timeline item this source made, or undefined for anything else. */
  pullRequestOf(item: unknown): string | undefined { return item && typeof item === 'object' ? this.links.get(item) : undefined; }
}

type TimelineHost = { version?: unknown; workspace?: { registerTimelineProvider?: unknown }; TimelineItem?: unknown; TimelineTriggerKind?: unknown };

/** Whether `version` (such as `1.147.0` or `1.145.0-insider`) is at least `minimum`. */
export function atLeast(version: unknown, minimum: readonly [number, number] = timelineMinimumVersion): boolean {
  const match = typeof version === 'string' ? /^(\d+)\.(\d+)/.exec(version) : null;
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > minimum[0] || (major === minimum[0] && minor >= minimum[1]);
}

/** The finalized Timeline API, from the running editor's `vscode` module. */
export type TimelineApi<P, I> = { register(provider: P): { dispose(): unknown }; item(label: string, timestamp: number): I; invoked(kind: unknown): boolean };

/**
 * The Timeline API when the running editor is VS Code 1.145 or later and has it, else undefined. `engines.vscode`
 * stays at 1.99, and before 1.145 `registerTimelineProvider` was a proposal with another signature that throws for
 * an extension without it, so the version is checked as well as the members.
 */
export function timelineApi<P, I>(host: TimelineHost): TimelineApi<P, I> | undefined {
  const register = host.workspace?.registerTimelineProvider;
  const Item = host.TimelineItem;
  const kinds = host.TimelineTriggerKind as { Invoke?: unknown } | undefined;
  if (!atLeast(host.version) || typeof register !== 'function' || typeof Item !== 'function' || typeof kinds?.Invoke !== 'number') return undefined;
  return {
    register: provider => register.call(host.workspace, timelineSourceId, timelineSourceLabel, 'file', provider),
    item: (label, timestamp) => new (Item as new (label: string, timestamp: number) => I)(label, timestamp),
    invoked: kind => kind === kinds.Invoke,
  };
}
