import type { AppConfig, Session, User } from './types.ts';
import type { Ask } from './ask/types.ts';
import type { LinkedSession } from './linked-sessions.ts';
import { digestFacts, digestReadLimit } from './linked-handoff.ts';
import { digestSessionLimit, readSessionsUsage, type TokenCounts } from './linked-telemetry.ts';
import type { RecordedUsage } from './linked-usage.ts';
import type { ChatTurn } from './chat/types.ts';
import type { PloegChatRecord } from './ploeg.ts';

/** The periods Your usage covers: the current UTC calendar month, the period an Ask Allowance resets on, or the last 30 days. */
export const usagePeriods = ['month', '30d'] as const;
export type UsagePeriod = typeof usagePeriods[number];
/** The most Asks and sessions one usage read takes from the workbench database. */
export const usageReadLimits = { asks: 1000, sessions: 500, chats: 200 } as const;
const chatReadsAtOnce = 8;

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
  chats: UsageMoney & { truncated: boolean };
  linkedSessions: {
    count: number; claudeCode: number; uncosted: number;
    estimateUsd: number | null; costStatus: 'estimate'; tokens: TokenCounts | null;
    estimateSource: 'telemetry' | 'recorded' | null; recordedAt: string | null;
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

/** One chat message's cost as usage counts it: what Unfold kept once Ploeg settled it, else Ploeg's record, unknown when Ploeg could not be read or does not know. */
export function chatPrice(turn: Pick<ChatTurn, 'settled'>, record: Pick<PloegChatRecord, 'costStatus' | 'usd'> | null): Priced {
  if (turn.settled && amount(turn.settled.usd)) return { demo: false, usd: turn.settled.usd, settled: true };
  if (!record || record.costStatus === 'unknown' || !amount(record.usd)) return { demo: false, usd: null, settled: false };
  return { demo: false, usd: record.usd, settled: record.costStatus === 'settled' };
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
  { source: 'chats', reason: 'Messages in chats you deleted are not counted: Unfold forgets which messages were yours once a chat is deleted, while their cost stays on the Team’s chat allowance.' },
];

/** The records a usage read needs. */
export type UsageSources = {
  asksBetween(askerId: string, since: string, until: string, limit: number): Ask[];
  sessionSpendSince(ownerId: string, since: string, limit: number): Pick<Session, 'spentUsd' | 'observedUsd' | 'costStatus' | 'budgetUsd'>[];
  linkedOwned(ownerId: string, limit: number): LinkedSession[];
  recordedUsage?(sessionId: string): RecordedUsage | undefined;
  /** The person's own chat messages that Ploeg admitted, newest first. */
  chatTurns?(ownerId: string, since: string, until: string, limit: number): ChatTurn[];
  /** One chat message's record as Ploeg reads it now. */
  chatRecord?(user: User, team: string, chatId: string): Promise<PloegChatRecord>;
  /** Keeps a chat message's settled cost, so a later read does not ask Ploeg again. */
  keepChatSettled?(turn: ChatTurn): void;
};

/**
 * The Linked Session estimate Your usage shows: the live sum from the metrics store, or the sum of the estimates Unfold
 * recorded for the same sessions when that is higher or the store cannot answer, as after the store dropped old samples.
 */
export function linkedEstimate(live: { costUsd: number | null; tokens: TokenCounts | null }, recorded: RecordedUsage[]): { estimateUsd: number | null; tokens: TokenCounts | null; estimateSource: 'telemetry' | 'recorded' | null; recordedAt: string | null } {
  const recordedAt = recorded.map(entry => entry.observedAt).sort().at(-1) ?? null;
  const recordedUsd = recorded.length ? rounded(recorded.reduce((sum, entry) => sum + entry.costUsd, 0)) : null;
  if (recordedUsd !== null && (live.costUsd === null || live.costUsd < recordedUsd)) {
    const tokens = recorded.reduce((sum, entry) => ({ input: sum.input + entry.tokens.input, output: sum.output + entry.tokens.output, cacheRead: sum.cacheRead + entry.tokens.cacheRead, cacheCreation: sum.cacheCreation + entry.tokens.cacheCreation }), { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
    return { estimateUsd: recordedUsd, tokens, estimateSource: 'recorded', recordedAt };
  }
  return { estimateUsd: live.costUsd, tokens: live.tokens, estimateSource: live.costUsd === null ? null : 'telemetry', recordedAt };
}

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
    const estimate = linkedEstimate(telemetry, facts.ids.slice(0, digestSessionLimit).map(id => this.sources.recordedUsage?.(id)).filter((entry): entry is RecordedUsage => entry !== undefined));
    const chatTurns = this.sources.chatTurns?.(user.id, since.toISOString(), until.toISOString(), usageReadLimits.chats) ?? [];
    const chatMoney = usageMoney(await this.chatPrices(user, chatTurns));
    const askMoney = usageMoney(asks.map(askPrice));
    const sessionMoney = usageMoney(sessions.map(sessionPrice));
    const budgetUsd = rounded(sessions.filter(session => session.costStatus !== 'demo').reduce((sum, session) => sum + (amount(session.budgetUsd) ? session.budgetUsd : 0), 0));
    return {
      period: period as UsagePeriod, since: since.toISOString(), until: until.toISOString(),
      spent: combinedMoney([askMoney, sessionMoney, chatMoney]),
      asks: { ...askMoney, truncated: asks.length >= usageReadLimits.asks },
      sessions: { ...sessionMoney, budgetUsd, truncated: sessions.length >= usageReadLimits.sessions },
      chats: { count: chatMoney.count, usd: chatMoney.usd, final: chatMoney.final, unknown: chatMoney.unknown, truncated: chatTurns.length >= usageReadLimits.chats },
      linkedSessions: {
        count: facts.active, claudeCode: facts.ids.length, uncosted: facts.uncosted,
        ...estimate, costStatus: 'estimate',
        telemetry: !this.config.observability?.metricsUrl ? 'not_configured' : telemetry.read ? 'connected' : 'unreadable',
        reason: telemetry.reason, truncated: linked.length >= digestReadLimit || facts.ids.length > digestSessionLimit,
      },
      notAttributed,
    };
  }

  private async chatPrices(user: User, turns: ChatTurn[]): Promise<Priced[]> {
    const prices: Priced[] = [];
    for (let start = 0; start < turns.length; start += chatReadsAtOnce) {
      prices.push(...await Promise.all(turns.slice(start, start + chatReadsAtOnce).map(turn => this.chatPrice(user, turn))));
    }
    return prices;
  }

  private async chatPrice(user: User, turn: ChatTurn): Promise<Priced> {
    if (turn.settled || !turn.admission || !this.sources.chatRecord) return chatPrice(turn, null);
    const record = await this.sources.chatRecord(user, turn.admission.team, turn.admission.chatId).catch(() => null);
    const price = chatPrice(turn, record);
    if (price.settled && price.usd !== null) this.sources.keepChatSettled?.({ ...turn, settled: { usd: price.usd } });
    return price;
  }
}
