import type { TaskSourceConfig } from './tasks.ts';
import type { User } from './types.ts';
import { findTaskProvider, referencePrefixes, taskProviders, type TaskCandidate } from './task-providers/index.ts';
import { request as trackerRequest } from './task-providers/shared.ts';
import type { TaskRequest } from './task-providers/registry.ts';

/** The bounds of one resolution: candidates a report may carry or a branch may name, tracker reads one report may cause, and how long an answer is remembered. */
export const referenceLimits = { candidates: 10, branch: 5, trackerReads: 6, cacheMs: 10 * 60_000, cacheEntries: 500 } as const;

/** Uppercase prefixes of standards and algorithms, such as `UTF-8` and `SHA-256`, which are never a tracker key. */
export const technicalPrefixes: ReadonlySet<string> = new Set(['AES', 'CVE', 'CWE', 'ECMA', 'GHSA', 'HTTP', 'IEC', 'IEEE', 'ISO', 'MD', 'PEP', 'RFC', 'RSA', 'SHA', 'SSL', 'TLS', 'UTF']);

const keyPattern = /^([A-Z][A-Z0-9_]{1,9})-([1-9][0-9]{0,9})$/;
const markPattern = /^#([0-9a-z]{6,12})$/;
const issuePattern = /^([A-Za-z0-9_.-]{1,100}(?:\/[A-Za-z0-9_.-]{1,100}){1,5})#([1-9][0-9]{0,9})$/;
const issuePath = /^\/([A-Za-z0-9_.-]{1,100}(?:\/[A-Za-z0-9_.-]{1,100}){1,5}?)\/(?:-\/)?issues\/([1-9][0-9]{0,9})$/;
const colour = /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/;

/** Whether `id` can be a native id written with a tracker mark: letters and digits, both present, and not shaped like a colour. */
export function markedId(id: string): boolean { return /[a-z]/.test(id) && /[0-9]/.test(id) && !colour.test(id); }

/** One candidate a hook sent, checked against the shapes Unfold accepts, or undefined. */
export function taskCandidate(value: unknown): TaskCandidate | undefined {
  if (typeof value !== 'string' || value.length > 300) return undefined;
  const text = value.trim();
  const key = keyPattern.exec(text);
  if (key) return technicalPrefixes.has(key[1]) || markPrefixes().has(`${key[1].toLowerCase()}-`) ? undefined : { kind: 'key', key: text };
  const mark = markPattern.exec(text);
  if (mark) return markedId(mark[1]) ? { kind: 'mark', id: mark[1] } : undefined;
  const issue = issuePattern.exec(text);
  if (issue) return { kind: 'issue', path: issue[1].toLowerCase(), number: issue[2] };
  if (!/^https?:\/\//i.test(text)) return undefined;
  let url: URL;
  try { url = new URL(text); } catch { return undefined; }
  if (url.username || url.password || url.search || url.hash) return undefined;
  const path = url.pathname.replace(/\/+$/, '');
  const host = url.host.toLowerCase();
  const issued = issuePath.exec(path);
  if (issued) return { kind: 'issue', host, path: issued[1].toLowerCase(), number: issued[2] };
  return path && path.length <= 200 ? { kind: 'url', host, path } : undefined;
}

/** The lowercase mark prefixes trackers' git integrations write, such as `cu-`. */
export function markPrefixes(): Set<string> { return new Set(taskProviders().flatMap(adapter => adapter.markPrefix ? [adapter.markPrefix.toLowerCase()] : [])); }

const candidateKey = (candidate: TaskCandidate) => JSON.stringify(candidate);

/** The candidates a hook's `mentions.tasks` carries, checked, without repeats, at most {@link referenceLimits.candidates}. */
export function taskCandidates(values: unknown): TaskCandidate[] {
  const found = new Map<string, TaskCandidate>();
  for (const value of Array.isArray(values) ? values.slice(0, 20) : []) {
    const candidate = taskCandidate(value);
    if (candidate && found.size < referenceLimits.candidates) found.set(candidateKey(candidate), candidate);
  }
  return [...found.values()];
}

/**
 * The candidates a branch name carries besides the reference prefixes Unfold names: a native id after a tracker's mark
 * prefix, such as `cu-86c1abcde`, and keys such as `ops-12` in `feat/ops-12-login`, which only a person's task sources
 * can resolve.
 */
export function branchCandidates(branch: string): TaskCandidate[] {
  const found = new Map<string, TaskCandidate>();
  const lower = branch.toLowerCase();
  const add = (candidate: TaskCandidate) => { if (found.size < referenceLimits.branch) found.set(candidateKey(candidate), candidate); };
  const marks = markPrefixes();
  for (const match of lower.matchAll(/(?:^|[^a-z0-9])([a-z]{1,10})-([0-9a-z]{6,12})(?=$|[^0-9a-z])/g)) if (marks.has(`${match[1]}-`) && markedId(match[2])) add({ kind: 'mark', id: match[2] });
  const prefixes = referencePrefixes();
  for (const match of lower.matchAll(/(?:^|[^a-z0-9])([a-z][a-z0-9_]{1,9})-([1-9][0-9]{0,9})(?=$|[^0-9a-z])/g)) {
    const prefix = match[1].toUpperCase();
    if (!prefixes[match[1]] && !marks.has(`${match[1]}-`) && !technicalPrefixes.has(prefix)) add({ kind: 'key', key: `${prefix}-${match[2]}` });
  }
  return [...found.values()];
}

/** A tracker task a candidate resolved to in one of the person's task sources. */
export type ResolvedReference = { provider: string; externalId: string; repository?: string };
/** Resolves candidates to tracker tasks in the person's own task sources. */
export type ResolveTasks = (user: User, candidates: TaskCandidate[]) => Promise<ResolvedReference[]>;

function webHost(source: TaskSourceConfig): string {
  try { return new URL(findTaskProvider(source.provider)!.webRoot(source)).host.toLowerCase(); } catch { return ''; }
}

/**
 * Resolves candidates against the task sources a person may read, through each source's adapter, and remembers each
 * answer for {@link referenceLimits.cacheMs}. A tracker read that fails is skipped and not remembered; one resolution
 * makes at most {@link referenceLimits.trackerReads} tracker reads.
 */
export class TaskReferenceResolver {
  private readonly sources: (user: User) => Promise<TaskSourceConfig[]>;
  private readonly request: (source: TaskSourceConfig) => TaskRequest;
  private readonly clock: () => number;
  private readonly cache = new Map<string, { until: number; value: ResolvedReference | null }>();
  constructor(sources: (user: User) => Promise<TaskSourceConfig[]>, options: { request?: (source: TaskSourceConfig) => TaskRequest; now?: () => number } = {}) {
    this.sources = sources;
    this.request = options.request ?? (source => (path, query) => trackerRequest(source, path, query));
    this.clock = options.now ?? Date.now;
  }

  readonly resolve: ResolveTasks = async (user, candidates) => {
    if (!candidates.length) return [];
    const sources = (await this.sources(user)).filter(source => findTaskProvider(source.provider)?.resolveReference);
    let reads = 0;
    const out = new Map<string, ResolvedReference>();
    for (const candidate of candidates.slice(0, referenceLimits.candidates)) {
      for (const source of sources) {
        const key = `${source.id}\u0000${source.provider}\u0000${source.baseUrl}\u0000${source.project}\u0000${candidateKey(candidate)}`;
        const cached = this.cache.get(key);
        let value: ResolvedReference | null | undefined = cached && cached.until > this.clock() ? cached.value : undefined;
        if (value === undefined) {
          const ask = this.request(source);
          const counted: TaskRequest = (path, query) => { reads += 1; if (reads > referenceLimits.trackerReads) return Promise.reject(new Error('read budget spent')); return ask(path, query); };
          try {
            const found = await findTaskProvider(source.provider)!.resolveReference!(source, candidate, webHost(source), counted);
            value = found ? { provider: source.provider, ...found } : null;
            if (this.cache.size >= referenceLimits.cacheEntries) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(key, { until: this.clock() + referenceLimits.cacheMs, value });
          } catch { value = null; }
        }
        if (value) out.set(`${value.provider}:${value.externalId}:${value.repository ?? ''}`, value);
      }
    }
    return [...out.values()];
  };
}
