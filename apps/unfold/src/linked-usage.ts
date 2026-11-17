import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './types.ts';
import type { JobWorker } from './jobs/worker.ts';
import type { Ownership } from './tenancy.ts';
import { readSessionsUsage, type SessionTelemetry, type TokenCounts } from './linked-telemetry.ts';

/** Where a recorded Linked Session cost comes from: Claude Code's own estimate at API list prices, read from the metrics store. */
export const linkedUsageSource = 'telemetry-estimate';
/** The job kind that reads one Linked Session's cost after it stopped working, so the figure is kept before the metrics store drops it. */
export const linkedUsageJob = 'linked.usage';
/** How long after a session stops the job reads its cost: Claude Code exports metrics once a minute by default. */
export const linkedUsageDelayMs = 3 * 60_000;
/** The bounds of one usage read: sessions, Work Items, and readings per session. */
export const linkedUsageLimits = { sessions: 2000, workItems: 500, readings: 1000 } as const;
/** The largest markup an owner may set, in basis points (1000%). */
export const markupMaxBasisPoints = 100_000;

/** One reading of a Linked Session's cumulative cost and tokens, as Unfold recorded it. Amounts are never lowered by a later, smaller reading. */
export type UsageReading = { sessionId: string; observedAt: string; costMicros: number; tokens: TokenCounts; source: typeof linkedUsageSource };
/** The cost of one session on one UTC day: what its readings that day added to the cumulative figure. */
export type UsageDay = { sessionId: string; dayStart: number; costMicros: number; tokens: TokenCounts };
/**
 * Where a cost comes from: a Ploeg Run's metered spend, or a Linked Session's telemetry estimate. Each stays in its own
 * rows and figures; an estimate is never added into a metered amount.
 */
export const costSources = ['ploeg-run', 'linked-session'] as const;
export type CostSource = typeof costSources[number];
/** What a markup applies to: one cost source, or `all`, which applies to every source that has no markup of its own. */
export const markupSources = ['all', ...costSources] as const;
export type MarkupSource = typeof markupSources[number];
/** How each cost source's amount was measured. */
export const costBasis: Record<CostSource, 'metered' | typeof linkedUsageSource> = { 'ploeg-run': 'metered', 'linked-session': 'telemetry-estimate' };
/** A markup an owner set: from `effectiveFrom` (a UTC date) on, billable amounts of `source` are the recorded amount plus `basisPoints` / 100 percent. */
export type UsageMarkup = { tenant: string; client: string | null; source: MarkupSource; effectiveFrom: string; basisPoints: number; setAt: string; setBy: string };

const day = 86_400_000;
const zeroTokens = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
const tokenKinds = ['input', 'output', 'cacheRead', 'cacheCreation'] as const;
const tokenTotal = (tokens: TokenCounts) => tokenKinds.reduce((sum, kind) => sum + tokens[kind], 0);
const whole = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;

/** US$ as whole micro-dollars, so sums and splits stay exact. */
export const toMicros = (usd: number): number => Math.round(usd * 1_000_000);
/** Whole micro-dollars as US$. */
export const fromMicros = (micros: number): number => micros / 1_000_000;

/** The billable amount of `costMicros` under a markup of `basisPoints`, rounded half up to a micro-dollar. A markup of 0 is the estimate itself. */
export function billableMicros(costMicros: number, basisPoints: number): number {
  return basisPoints === 0 ? costMicros : Math.round(costMicros * (10_000 + basisPoints) / 10_000);
}

/** `total` split over `parts` whole shares that add up to it exactly; the first shares carry the remainder. */
export function splitWhole(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  return Array.from({ length: parts }, (_, index) => base + (index < total - base * parts ? 1 : 0));
}

/** A markup percentage as basis points: a decimal with at most two places between 0 and 1000. */
export function markupBasisPoints(value: unknown): number {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(text)) throw new Error('Give the markup as a percentage such as 15 or 12.5, with at most two decimals.');
  const [units, fraction = ''] = text.split('.');
  const basisPoints = Number(units) * 100 + Number(fraction.padEnd(2, '0'));
  if (basisPoints > markupMaxBasisPoints) throw new Error('A markup is at most 1000 percent.');
  return basisPoints;
}

/** Basis points as the percentage people read, such as `12.5`. */
export const markupPercent = (basisPoints: number): string => String(basisPoints / 100);

/**
 * The cost and tokens Unfold recorded for each Linked Session, in the workbench database, so the figure behind an
 * invoice outlives the metrics store's retention. Readings are cumulative and only kept when they add something.
 */
export class LinkedUsageStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS linked_session_usage (session_id TEXT NOT NULL, observed_at TEXT NOT NULL, cost_micros INTEGER NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_creation INTEGER NOT NULL, source TEXT NOT NULL, PRIMARY KEY (session_id, observed_at));
      CREATE INDEX IF NOT EXISTS linked_session_usage_observed ON linked_session_usage(observed_at);
    `);
  }

  /**
   * Records one reading of a session's cumulative estimate. A reading with neither cost nor tokens says nothing was
   * observed and is not kept; a reading lower than the last one, as a metrics store that dropped old samples answers, keeps the higher
   * figure. Answers the reading kept, or undefined when it added nothing.
   */
  record(sessionId: string, costUsd: number | null, tokens: TokenCounts | null, at: string): UsageReading | undefined {
    if (costUsd === null || !Number.isFinite(costUsd) || costUsd < 0) return undefined;
    const read: TokenCounts = { input: whole(tokens?.input), output: whole(tokens?.output), cacheRead: whole(tokens?.cacheRead), cacheCreation: whole(tokens?.cacheCreation) };
    if (!tokenTotal(read) && !toMicros(costUsd)) return undefined;
    const last = this.latest(sessionId);
    const costMicros = Math.max(toMicros(costUsd), last?.costMicros ?? 0);
    const kept: TokenCounts = last ? { input: Math.max(read.input, last.tokens.input), output: Math.max(read.output, last.tokens.output), cacheRead: Math.max(read.cacheRead, last.tokens.cacheRead), cacheCreation: Math.max(read.cacheCreation, last.tokens.cacheCreation) } : read;
    if (last && costMicros === last.costMicros && tokenTotal(kept) === tokenTotal(last.tokens)) return undefined;
    if (last && at <= last.observedAt) return undefined;
    this.db.prepare('INSERT OR IGNORE INTO linked_session_usage(session_id,observed_at,cost_micros,input,output,cache_read,cache_creation,source) VALUES(?,?,?,?,?,?,?,?)').run(sessionId, at, costMicros, kept.input, kept.output, kept.cacheRead, kept.cacheCreation, linkedUsageSource);
    return { sessionId, observedAt: at, costMicros, tokens: kept, source: linkedUsageSource };
  }

  /** The newest reading of one session, or undefined. */
  latest(sessionId: string): UsageReading | undefined {
    const row = this.db.prepare('SELECT * FROM linked_session_usage WHERE session_id=? ORDER BY observed_at DESC LIMIT 1').get(sessionId) as Record<string, string | number> | undefined;
    return row ? reading(row) : undefined;
  }

  /** The readings of one session, oldest first. */
  readings(sessionId: string): UsageReading[] {
    return (this.db.prepare('SELECT * FROM linked_session_usage WHERE session_id=? ORDER BY observed_at LIMIT ?').all(sessionId, linkedUsageLimits.readings) as Record<string, string | number>[]).map(reading);
  }

  /** The sessions with a reading in `[from, to)`, at most {@link linkedUsageLimits.sessions}. */
  sessionsObserved(from: number, to: number): string[] {
    return (this.db.prepare('SELECT DISTINCT session_id FROM linked_session_usage WHERE observed_at>=? AND observed_at<? ORDER BY session_id LIMIT ?').all(new Date(from).toISOString(), new Date(to).toISOString(), linkedUsageLimits.sessions + 1) as { session_id: string }[]).map(row => row.session_id);
  }

  /** What each UTC day added to one session's cumulative cost and tokens, oldest first. */
  days(sessionId: string): UsageDay[] {
    const out = new Map<number, UsageDay>();
    let before: UsageReading | undefined;
    for (const entry of this.readings(sessionId)) {
      const dayStart = Math.floor(Date.parse(entry.observedAt) / day) * day;
      const found = out.get(dayStart) ?? { sessionId, dayStart, costMicros: 0, tokens: zeroTokens() };
      found.costMicros += entry.costMicros - (before?.costMicros ?? 0);
      for (const kind of tokenKinds) found.tokens[kind] += entry.tokens[kind] - (before?.tokens[kind] ?? 0);
      out.set(dayStart, found);
      before = entry;
    }
    return [...out.values()];
  }
}

function reading(row: Record<string, string | number>): UsageReading {
  return { sessionId: String(row.session_id), observedAt: String(row.observed_at), costMicros: Number(row.cost_micros), tokens: { input: Number(row.input), output: Number(row.output), cacheRead: Number(row.cache_read), cacheCreation: Number(row.cache_creation) }, source: linkedUsageSource };
}

/**
 * The markups owners set on recorded costs, per Tenant and optionally per Client, for one cost source or for `all`. A
 * markup is a dated row that holds from its date until the next one of the same owner and source, so changing it never
 * changes what an earlier day bills. None means 0.
 */
export class UsageMarkupStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec("CREATE TABLE IF NOT EXISTS usage_markups (tenant TEXT NOT NULL, client TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'all', effective_from TEXT NOT NULL, basis_points INTEGER NOT NULL, set_at TEXT NOT NULL, set_by TEXT NOT NULL, PRIMARY KEY (tenant, client, source, effective_from))");
  }

  /** Every markup, by Tenant, Client, source and date. */
  all(): UsageMarkup[] {
    return (this.db.prepare('SELECT * FROM usage_markups ORDER BY tenant, client, source, effective_from').all() as Record<string, string | number>[]).map(markup);
  }

  /** The markups of one owner and source exactly, oldest first. */
  of(owner: Ownership, source: MarkupSource): UsageMarkup[] {
    return (this.db.prepare('SELECT * FROM usage_markups WHERE tenant=? AND client=? AND source=? ORDER BY effective_from').all(owner.tenant, owner.client ?? '', source) as Record<string, string | number>[]).map(markup);
  }

  /**
   * Adds a markup of `source` from `effectiveFrom`. The first markup of an owner and source may start on any date; after
   * that a markup starts today or later, and only one not yet in effect may be replaced, so no day that already billed
   * is billed again differently.
   */
  set(owner: Ownership, source: MarkupSource, basisPoints: number, effectiveFrom: string, today: string, by: string, at: string): UsageMarkup {
    const existing = this.of(owner, source);
    if (existing.length && effectiveFrom < today) throw new MarkupError('A changed markup starts today or later, so amounts already billed stay as they were.');
    const same = existing.find(entry => entry.effectiveFrom === effectiveFrom);
    if (same && effectiveFrom <= today) throw new MarkupError('This markup is already in effect. Set a new one from a later date.');
    this.db.prepare('INSERT INTO usage_markups(tenant,client,source,effective_from,basis_points,set_at,set_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant,client,source,effective_from) DO UPDATE SET basis_points=excluded.basis_points, set_at=excluded.set_at, set_by=excluded.set_by').run(owner.tenant, owner.client ?? '', source, effectiveFrom, basisPoints, at, by);
    return { tenant: owner.tenant, client: owner.client ?? null, source, effectiveFrom, basisPoints, setAt: at, setBy: by };
  }

  /**
   * The markup in basis points on `source` for `owner` on the UTC day starting `dayStart`. The first of these in effect
   * that day wins: the Client's markup for the source, the Client's for `all`, the Tenant's for the source, the
   * Tenant's for `all`; else 0.
   */
  at(owner: Ownership, source: CostSource, dayStart: number): number {
    const date = new Date(dayStart).toISOString().slice(0, 10);
    const pick = (client: string, kind: MarkupSource) => (this.db.prepare('SELECT basis_points FROM usage_markups WHERE tenant=? AND client=? AND source=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1').get(owner.tenant, client, kind, date) as { basis_points: number } | undefined)?.basis_points;
    const tiers: [string, MarkupSource][] = [...(owner.client ? [[owner.client, source], [owner.client, 'all']] as [string, MarkupSource][] : []), ['', source], ['', 'all']];
    for (const [client, kind] of tiers) { const found = pick(client, kind); if (found !== undefined) return found; }
    return 0;
  }
}

/** A markup Unfold refuses to set. */
export class MarkupError extends Error {}

function markup(row: Record<string, string | number>): UsageMarkup {
  return { tenant: String(row.tenant), client: row.client ? String(row.client) : null, source: String(row.source) as MarkupSource, effectiveFrom: String(row.effective_from), basisPoints: Number(row.basis_points), setAt: String(row.set_at), setBy: String(row.set_by) };
}

/** One Work Item's share of the estimates of the Linked Sessions linked to it on one UTC day, with the markup of that day. */
export type LinkedCharge = { workItemId: string; dayStart: number; costMicros: number; billableMicros: number; basisPoints: number; tokens: TokenCounts; sessions: number };

/**
 * The charges of the sessions `sessions` on each Work Item they are linked to, for the days in `[from, to)`. A session
 * linked to several Work Items splits each day's cost and tokens evenly between them, so no cost is counted twice.
 * `markupOf` gives the markup of a Work Item on a day, applied only to the billable amount.
 */
export function linkedCharges(store: LinkedUsageStore, sessions: { id: string; workItems: { id: string }[] }[], from: number, to: number, markupOf: (workItemId: string, dayStart: number) => number): LinkedCharge[] {
  const out = new Map<string, LinkedCharge & { ids: Set<string> }>();
  for (const session of sessions) {
    const items = [...new Set(session.workItems.map(entry => entry.id))].sort();
    if (!items.length) continue;
    for (const entry of store.days(session.id)) {
      if (entry.dayStart < from || entry.dayStart >= to) continue;
      const cost = splitWhole(entry.costMicros, items.length);
      const tokens = Object.fromEntries(tokenKinds.map(kind => [kind, splitWhole(entry.tokens[kind], items.length)])) as Record<keyof TokenCounts, number[]>;
      items.forEach((workItemId, index) => {
        const key = `${workItemId}:${entry.dayStart}`;
        const found = out.get(key) ?? { workItemId, dayStart: entry.dayStart, costMicros: 0, billableMicros: 0, basisPoints: markupOf(workItemId, entry.dayStart), tokens: zeroTokens(), sessions: 0, ids: new Set<string>() };
        found.costMicros += cost[index];
        for (const kind of tokenKinds) found.tokens[kind] += tokens[kind][index];
        found.ids.add(session.id);
        found.sessions = found.ids.size;
        out.set(key, found);
      });
    }
  }
  return [...out.values()].map(({ ids: _ids, ...charge }) => ({ ...charge, billableMicros: billableMicros(charge.costMicros, charge.basisPoints) })).sort((a, b) => a.dayStart - b.dayStart || a.workItemId.localeCompare(b.workItemId));
}

/** A Work Item's recorded Linked Session cost: the estimate, the billable amount with its owner's markups, tokens, and when the newest reading was taken. */
export type WorkItemUsage = { costUsd: number | null; billableUsd: number | null; markupPercent: string | null; tokens: TokenCounts | null; sessions: number; recorded: number; observedAt: string | null; source: typeof linkedUsageSource; costStatus: 'estimate' };

/** The totals of `charges` for one Work Item, with `sessions` the Claude Code sessions counted and `recorded` those with a reading. */
export function workItemUsage(charges: LinkedCharge[], sessions: number, recorded: number, observedAt: string | null, todayMarkup: number): WorkItemUsage {
  if (!charges.length) return { costUsd: recorded ? 0 : null, billableUsd: recorded ? 0 : null, markupPercent: markupPercent(todayMarkup), tokens: recorded ? zeroTokens() : null, sessions, recorded, observedAt, source: linkedUsageSource, costStatus: 'estimate' };
  const tokens = zeroTokens();
  for (const charge of charges) for (const kind of tokenKinds) tokens[kind] += charge.tokens[kind];
  return {
    costUsd: fromMicros(charges.reduce((sum, charge) => sum + charge.costMicros, 0)), billableUsd: fromMicros(charges.reduce((sum, charge) => sum + charge.billableMicros, 0)),
    markupPercent: markupPercent(todayMarkup), tokens, sessions, recorded, observedAt, source: linkedUsageSource, costStatus: 'estimate',
  };
}

/**
 * Keeps Linked Session estimates in Unfold: from every live telemetry read, and from a delayed job after a Claude Code
 * session stops working or ends, so the cost behind an invoice survives the metrics store's retention.
 */
export class LinkedUsage {
  readonly store: LinkedUsageStore;
  readonly markups: UsageMarkupStore;
  private config: AppConfig;
  private jobs?: JobWorker;
  private fetcher: typeof fetch;
  private clock: () => Date;
  private delayMs: number;
  constructor(db: DatabaseSync, config: AppConfig, options: { jobs?: JobWorker; fetch?: typeof fetch; now?: () => Date; delayMs?: number } = {}) {
    this.store = new LinkedUsageStore(db);
    this.markups = new UsageMarkupStore(db);
    this.config = config;
    this.jobs = options.jobs;
    this.fetcher = options.fetch ?? fetch;
    this.clock = options.now ?? (() => new Date());
    this.delayMs = options.delayMs ?? linkedUsageDelayMs;
    this.jobs?.register<{ sessionId: string; startedAt: string }>({
      kind: linkedUsageJob, leaseMs: 60_000, backoff: { baseMs: 60_000, maxMs: 1_800_000 }, retainMs: 86_400_000,
      run: async job => {
        const outcome = await this.capture(job.payload.sessionId, job.payload.startedAt);
        return outcome === 'unreadable' ? { retry: 'The metrics store could not be read.' } : { done: true };
      },
    });
  }

  /** Queues a read of one Claude Code session's estimate a few minutes from now; repeated notices before it runs coalesce. */
  notice(session: { id: string; harness: string; startedAt: string }): void {
    if (!this.jobs || session.harness !== 'claude-code' || !this.config.observability?.metricsUrl) return;
    const now = this.clock().getTime();
    this.jobs.queue.enqueue(linkedUsageJob, session.id, { sessionId: session.id, startedAt: session.startedAt }, now, { runAt: now + this.delayMs, maxAttempts: 5, repeat: 'when_finished' });
  }

  /** Reads one session's estimate from the metrics store now and records it. */
  async capture(sessionId: string, startedAt: string): Promise<'recorded' | 'unchanged' | 'unreadable'> {
    const now = this.clock().getTime();
    const started = Date.parse(startedAt);
    const range = `${Math.min(30 * 86_400, Math.max(600, Math.ceil(((Number.isFinite(started) ? now - started : day) + 600_000) / 1000)))}s`;
    const read = await readSessionsUsage(this.config.observability, [sessionId], range, { fetch: this.fetcher });
    if (!read.read) return 'unreadable';
    return this.store.record(sessionId, read.costUsd, read.tokens, new Date(now).toISOString()) ? 'recorded' : 'unchanged';
  }

  /** Records what a live telemetry read of one session said. */
  remember(sessionId: string, telemetry: Pick<SessionTelemetry, 'costUsd' | 'tokens'>): void {
    this.store.record(sessionId, telemetry.costUsd, telemetry.tokens, this.clock().toISOString());
  }

  /** The newest recorded estimate of one session, as the API presents it, or undefined. */
  recorded(sessionId: string): RecordedUsage | undefined {
    const last = this.store.latest(sessionId);
    return last ? { costUsd: fromMicros(last.costMicros), tokens: last.tokens, observedAt: last.observedAt, source: last.source, costStatus: 'estimate' } : undefined;
  }
}

/** A session's newest recorded estimate. */
export type RecordedUsage = { costUsd: number; tokens: TokenCounts; observedAt: string; source: typeof linkedUsageSource; costStatus: 'estimate' };

/** A Work Item as a cost export names it, and the Tenant and Client that own it; `owner` is undefined when no single one does. */
export type ChargedWorkItem = { item: { id: string; title: string; team: string; target: { owner: string; repo: string } | null; externalRef: string }; owner: Ownership | undefined };

/**
 * The recorded Linked Session charges of `[from, to)` on the Work Items `describe` lets the requester read, each with
 * its owner's markup per day. `sessions` gives a session by id; Work Items `describe` refuses are left out, and those
 * without a single owner are counted in `unowned`. Reads at most {@link linkedUsageLimits} sessions and Work Items.
 */
export async function linkedWorkCharges(usage: LinkedUsage, sessions: (id: string) => { id: string; workItems: { id: string }[] } | undefined, from: number, to: number, describe: (workItemId: string) => Promise<ChargedWorkItem | undefined>): Promise<{ charges: (LinkedCharge & { item: ChargedWorkItem['item']; owner: Ownership })[]; unowned: number; truncated: boolean }> {
  const ids = usage.store.sessionsObserved(from, to);
  const found = ids.slice(0, linkedUsageLimits.sessions).map(sessions).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  const workItems = [...new Set(found.flatMap(entry => entry.workItems.map(item => item.id)))];
  const described = new Map<string, ChargedWorkItem>();
  for (let start = 0; start < Math.min(workItems.length, linkedUsageLimits.workItems); start += 4) {
    await Promise.all(workItems.slice(start, Math.min(start + 4, linkedUsageLimits.workItems)).map(async id => { const entry = await describe(id).catch(() => undefined); if (entry) described.set(id, entry); }));
  }
  const charges = linkedCharges(usage.store, found, from, to, (id, dayStart) => { const owner = described.get(id)?.owner; return owner ? usage.markups.at(owner, 'linked-session', dayStart) : 0; });
  const out: (LinkedCharge & { item: ChargedWorkItem['item']; owner: Ownership })[] = [];
  const unowned = new Set<string>();
  for (const charge of charges) {
    const entry = described.get(charge.workItemId);
    if (!entry) continue;
    if (!entry.owner) { unowned.add(charge.workItemId); continue; }
    out.push({ ...charge, item: entry.item, owner: entry.owner });
  }
  return { charges: out, unowned: unowned.size, truncated: ids.length > linkedUsageLimits.sessions || workItems.length > linkedUsageLimits.workItems };
}

/** A Work Item's Ploeg spend as metered, and what it bills with its owner's markup on `ploeg-run`. Only closed Shifts bill; open ones are counted. */
export type PloegRunUsage = { meteredUsd: number | null; billableUsd: number | null; markupPercent: string; openShifts: number; source: 'ploeg-run'; basis: 'metered' };

/**
 * The metered spend of a Work Item's Shifts and its billable amount: each closed Shift's spend plus the markup on
 * `ploeg-run` of the day it closed. The metered amount is never marked up and never holds an estimate.
 */
export function ploegRunUsage(shifts: { spentUsd: number | null | undefined; closedAt: string | null | undefined }[], markupOf: (dayStart: number) => number, today: number): PloegRunUsage {
  const spent = shifts.filter(shift => typeof shift.spentUsd === 'number' && Number.isFinite(shift.spentUsd) && shift.spentUsd >= 0);
  const closed = spent.filter(shift => shift.closedAt && Number.isFinite(Date.parse(shift.closedAt)));
  const billable = closed.reduce((sum, shift) => sum + markedUp(shift.spentUsd as number, markupOf(Math.floor(Date.parse(shift.closedAt!) / day) * day)), 0);
  return {
    meteredUsd: spent.length ? spent.reduce((sum, shift) => sum + (shift.spentUsd as number), 0) : null,
    billableUsd: closed.length ? Math.round(billable * 1e10) / 1e10 : null,
    markupPercent: markupPercent(markupOf(Math.floor(today / day) * day)), openShifts: spent.length - closed.length, source: 'ploeg-run', basis: 'metered',
  };
}

/** `usd` plus a markup of `basisPoints`; a markup of 0 is `usd` itself. */
export function markedUp(usd: number, basisPoints: number): number {
  return basisPoints === 0 ? usd : usd * (10_000 + basisPoints) / 10_000;
}
