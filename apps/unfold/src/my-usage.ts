import type { AppConfig, Session, User } from './types.ts';
import type { Ask } from './ask/types.ts';
import type { LinkedSession } from './linked-sessions.ts';
import { digestFacts, digestReadLimit } from './linked-handoff.ts';
import { digestSessionLimit, readSessionsUsage, type TokenCounts } from './linked-telemetry.ts';

/** The periods Your usage covers: the current UTC calendar month, the period an Ask Allowance resets on, or the last 30 days. */
export const usagePeriods = ['month', '30d'] as const;
export type UsagePeriod = typeof usagePeriods[number];
/** The most Asks and sessions one usage read takes from the workbench database. */
export const usageReadLimits = { asks: 1000, sessions: 500 } as const;

/**
 * Money from one source in a period. `usd` sums the amounts that are known and is null when there are items and none
 * of them has a known amount; `unknown` counts the items without one, so a partial sum reads "at least". `final` is
 * true only when every amount is known and settled.
 */
export type UsageMoney = { count: number; usd: number | null; final: boolean; unknown: number };

/** What the signed-in person spent, or caused to be estimated, in a period, from the records Unfold already keeps about them. */
export type MyUsage = {
  period: UsagePeriod; since: string; until: string;
  spent: UsageMoney;
  asks: UsageMoney & { demo: number; truncated: boolean };
  sessions: UsageMoney & { budgetUsd: number; demo: number; truncated: boolean };
  linkedSessions: {
    count: number; claudeCode: number; uncosted: number;
    estimateUsd: number | null; costStatus: 'estimate'; tokens: TokenCounts | null;
    telemetry: 'connected' | 'not_configured' | 'unreadable'; reason: string | null; truncated: boolean;
  };
  notAttributed: { source: 'ploeg_runs' | 'chats'; reason: string }[];
};

/** A refused usage request, with the HTTP status and code the API answers. */
export class UsageError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

/** The start and end of `period` at `now`. */
export function usageWindow(period: UsagePeriod, now: Date): { since: Date; until: Date } {
  const since = period === 'month' ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) : new Date(now.getTime() - 30 * 86_400_000);
  return { since, until: now };
}

type Priced = { demo: boolean; usd: number | null; settled: boolean };

const rounded = (value: number) => Math.round(value * 1e6) / 1e6;
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Sums priced items into one {@link UsageMoney}, leaving demo items out. */
export function usageMoney(items: Priced[]): UsageMoney & { demo: number } {
  const real = items.filter(item => !item.demo);
  const known = real.filter(item => item.usd !== null);
  const unknown = real.length - known.length;
  return {
    count: real.length,
    usd: real.length && !known.length ? null : rounded(known.reduce((sum, item) => sum + item.usd!, 0)),
    final: unknown === 0 && known.every(item => item.settled),
    unknown,
    demo: items.length - real.length,
  };
}

/** One Ask's cost as usage counts it: a demo Ask has none, and a cost Ploeg marks unknown is unknown, never zero. */
export function askPrice(ask: Pick<Ask, 'demo' | 'costUsd' | 'costStatus'>): Priced {
  if (ask.demo || ask.costStatus === 'demo') return { demo: true, usd: null, settled: false };
  return { demo: false, usd: ask.costStatus !== 'unknown' && amount(ask.costUsd) ? ask.costUsd : null, settled: ask.costStatus === 'settled' };
}

/** One workbench session's spend as usage counts it: the higher of what settled and what was observed, unknown when its cost status says so. */
export function sessionPrice(session: Pick<Session, 'spentUsd' | 'observedUsd' | 'costStatus'>): Priced {
  if (session.costStatus === 'demo') return { demo: true, usd: null, settled: false };
  if (session.costStatus === 'unknown') return { demo: false, usd: null, settled: false };
  const values = [session.spentUsd, session.observedUsd].filter(amount);
  return { demo: false, usd: values.length ? Math.max(...values) : null, settled: session.costStatus === 'settled' };
}

/** Adds the money of several sources: unknown when none of them knows an amount, otherwise the known part. */
export function combinedMoney(parts: UsageMoney[]): UsageMoney {
  const known = parts.filter(part => part.usd !== null);
  const count = parts.reduce((sum, part) => sum + part.count, 0);
  return {
    count,
    usd: count && !known.length ? null : rounded(known.reduce((sum, part) => sum + part.usd!, 0)),
    final: parts.every(part => part.final),
    unknown: parts.reduce((sum, part) => sum + part.unknown, 0),
  };
}

const notAttributed: MyUsage['notAttributed'] = [
  { source: 'ploeg_runs', reason: 'Work Items handed to Ploeg are paid from their Team’s budget. Ploeg does not report that spend per person yet, so it is not counted here; Insights shows it per Team.' },
  { source: 'chats', reason: 'Chat messages in the Agents window are paid from their Team’s Chat Allowance, and Unfold does not record their cost per person.' },
];

/** The records a usage read needs. */
export type UsageSources = {
  asksBetween(askerId: string, since: string, until: string, limit: number): Ask[];
  sessionSpendSince(ownerId: string, since: string, limit: number): Pick<Session, 'spentUsd' | 'observedUsd' | 'costStatus' | 'budgetUsd'>[];
  linkedOwned(ownerId: string, limit: number): LinkedSession[];
};

/**
 * Your usage: what one person's own Asks, workbench sessions and Linked Sessions cost in a period. Every read is keyed
 * on the caller's own id, whatever their role, so an administrator sees only their own usage here.
 */
export class MyUsageService {
  private sources: UsageSources;
  private config: AppConfig;
  private fetcher: typeof fetch;
  private clock: () => Date;
  constructor(sources: UsageSources, config: AppConfig, options: { fetch?: typeof fetch; now?: () => Date } = {}) {
    this.sources = sources; this.config = config;
    this.fetcher = options.fetch ?? fetch;
    this.clock = options.now ?? (() => new Date());
  }

  async read(user: User, period: string): Promise<MyUsage> {
    if (!(usagePeriods as readonly string[]).includes(period)) throw new UsageError(400, 'usage_period', 'Use period=month or period=30d.');
    const { since, until } = usageWindow(period as UsagePeriod, this.clock());
    const asks = this.sources.asksBetween(user.id, since.toISOString(), until.toISOString(), usageReadLimits.asks);
    const sessions = this.sources.sessionSpendSince(user.id, since.toISOString(), usageReadLimits.sessions);
    const linked = this.sources.linkedOwned(user.id, digestReadLimit).filter(session => session.ownerId === user.id);
    const facts = digestFacts(linked, since.getTime());
    const range = `${Math.max(600, Math.ceil((until.getTime() - since.getTime()) / 1000))}s`;
    const telemetry = await readSessionsUsage(this.config.observability, facts.ids.slice(0, digestSessionLimit), range, { fetch: this.fetcher });
    const askMoney = usageMoney(asks.map(askPrice));
    const sessionMoney = usageMoney(sessions.map(sessionPrice));
    const budgetUsd = rounded(sessions.filter(session => session.costStatus !== 'demo').reduce((sum, session) => sum + (amount(session.budgetUsd) ? session.budgetUsd : 0), 0));
    return {
      period: period as UsagePeriod, since: since.toISOString(), until: until.toISOString(),
      spent: combinedMoney([askMoney, sessionMoney]),
      asks: { ...askMoney, truncated: asks.length >= usageReadLimits.asks },
      sessions: { ...sessionMoney, budgetUsd, truncated: sessions.length >= usageReadLimits.sessions },
      linkedSessions: {
        count: facts.active, claudeCode: facts.ids.length, uncosted: facts.uncosted,
        estimateUsd: telemetry.costUsd, costStatus: 'estimate', tokens: telemetry.tokens,
        telemetry: !this.config.observability?.metricsUrl ? 'not_configured' : telemetry.read ? 'connected' : 'unreadable',
        reason: telemetry.reason, truncated: linked.length >= digestReadLimit || facts.ids.length > digestSessionLimit,
      },
      notAttributed,
    };
  }
}
