import type { Core } from './core.js';
import type { PloegNow, PloegNowItem } from './ploeg-types.js';
import type { describeRun, describeSession, linkedWorkItems, nowGroup, SessionRow } from './now.js';

/** The Now rules this module reads, passed in so it loads without the rest of the extension. */
export type NowRules = { nowGroup: typeof nowGroup; linkedWorkItems: typeof linkedWorkItems; describeRun: typeof describeRun; describeSession: typeof describeSession };

/** The share of an authorized budget at which the notice above the chat input warns. */
export const budgetWarningShare = 0.9;

/** What a button or link opens: one Work Item, one session, or Now. */
export type Target = { kind: 'workItem'; id: string; title: string } | { kind: 'session'; id: string; title: string } | { kind: 'now' };

/** How many things wait on the person, and the first of each kind, as Now lists them. */
export type Waiting = { needs: number; review: number; firstNeeds?: Target; firstReview?: Target };

/** What was spent today as far as the extension reads it: settled by Runs that finished today plus observed so far in running Runs. */
export type TodaySpend = { status: 'demo' } | { status: 'unknown' } | { status: 'amount'; settledUsd: number; observedUsd: number; partial: boolean };

/** A session whose spend passed the warning share of its authorized budget. */
export type BudgetAlarm = { title: string; share: number; spentUsd: number; budgetUsd: number; target: Target };

export type Severity = 'info' | 'warning' | 'error';

/** The notice above the chat input: what it says, how serious it is, and the one button it offers. */
export type Notice = { severity: Severity; message: string; description: string | undefined; action: { label: string; target: Target } };

function rowTarget(row: SessionRow): Target {
  return row.progress.workItemId ? { kind: 'workItem', id: row.progress.workItemId, title: row.session.title } : { kind: 'session', id: row.session.id, title: row.session.title };
}

function itemTarget(item: PloegNowItem): Target {
  return { kind: 'workItem', id: item.id, title: item.title || `Work Item ${item.id}` };
}

/** Counts what needs the person and what is ready for their review, each counted once: a Work Item a session drives counts as the session. */
export function waitingOn(rules: NowRules, now: PloegNow | undefined, rows: SessionRow[]): Waiting {
  const { nowGroup } = rules;
  const linked = rules.linkedWorkItems(rows);
  const items = (now?.waiting ?? []).filter(item => !linked.has(item.id));
  const needsRows = rows.filter(row => row.group === 'needs');
  const reviewRows = rows.filter(row => row.group === 'review');
  const needsItems = items.filter(item => nowGroup(item) === 'needs');
  const reviewItems = items.filter(item => nowGroup(item) === 'review');
  const firstNeeds = needsRows[0] ? rowTarget(needsRows[0]) : needsItems[0] ? itemTarget(needsItems[0]) : undefined;
  const firstReview = reviewRows[0] ? rowTarget(reviewRows[0]) : reviewItems[0] ? itemTarget(reviewItems[0]) : undefined;
  return { needs: needsRows.length + needsItems.length, review: reviewRows.length + reviewItems.length, ...(firstNeeds ? { firstNeeds } : {}), ...(firstReview ? { firstReview } : {}) };
}

const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/** Today's spend from the Runs Ploeg's Now lists. A demo spends nothing; a list Ploeg cut short, an unread list or a Run without an amount makes the sum a lower bound. */
export function todaySpend(now: PloegNow | undefined, demo: boolean, at = new Date()): TodaySpend {
  if (demo || now?.demo) return { status: 'demo' };
  if (!now) return { status: 'unknown' };
  const start = startOfDay(at);
  const finishedToday = now.recent.filter(run => run.finishedAt && Date.parse(run.finishedAt) >= start);
  const settled = finishedToday.filter(run => isAmount(run.settledUsd));
  const observed = now.running.filter(run => isAmount(run.observedUsd));
  if (!settled.length && !observed.length && (now.errors.recent || now.errors.running)) return { status: 'unknown' };
  const partial = Boolean(now.recentTruncated || now.runningTruncated || now.errors.recent || now.errors.running) || settled.length < finishedToday.length || observed.length < now.running.length;
  return { status: 'amount', settledUsd: settled.reduce((sum, run) => sum + (run.settledUsd ?? 0), 0), observedUsd: observed.reduce((sum, run) => sum + (run.observedUsd ?? 0), 0), partial };
}

/** The few words for today's spend, such as `US$ 4,10 today`, or '' when it is not known. */
export function spendWords(core: Core, spend: TodaySpend): string {
  if (spend.status === 'demo') return 'demo, no spend';
  if (spend.status === 'unknown') return '';
  return `${spend.partial ? 'at least ' : ''}${core.money(spend.settledUsd + spend.observedUsd)} today`;
}

/** Sessions still in play whose settled or observed spend reached the warning share of their authorized budget, highest share first. A demo session has no spend and never warns. */
export function budgetAlarms(rows: SessionRow[], share = budgetWarningShare): BudgetAlarm[] {
  const alarms: BudgetAlarm[] = [];
  for (const row of rows) {
    const { valueUsd, budgetUsd, status } = row.progress.spend;
    if (row.progress.demo || status === 'demo' || !isAmount(valueUsd) || !isAmount(budgetUsd) || budgetUsd <= 0) continue;
    if (valueUsd / budgetUsd >= share) alarms.push({ title: row.session.title, share: valueUsd / budgetUsd, spentUsd: valueUsd, budgetUsd, target: rowTarget(row) });
  }
  return alarms.sort((a, b) => b.share - a.share);
}

/** A share as whole percent with a space before the sign, rounded down so it never says more was spent than was. */
export function percent(share: number): string {
  return `${Math.floor(share * 100)} %`;
}

export function needsWords(count: number): string { return `${count} need${count === 1 ? 's' : ''} you`; }
export function reviewWords(count: number): string { return `${count} ready for review`; }

function budgetWords(alarms: BudgetAlarm[]): string {
  if (!alarms.length) return '';
  if (alarms.length === 1) return `Budget ${percent(alarms[0].share)} spent on ${alarms[0].title}`;
  return `${alarms.length} budgets ${percent(budgetWarningShare)} spent or more`;
}

const demoDescription = 'Demo workbench: illustrative records, no model calls or spend.';

function actionFor(target: Target, review: boolean): { label: string; target: Target } {
  if (target.kind === 'now') return { label: 'Open Now', target };
  if (target.kind === 'session') return { label: 'Open session', target };
  return { label: review ? 'Review Work Item' : 'Open Work Item', target };
}

/** The notice above the chat input, or undefined when nothing waits and no budget is near its end. Needing the person or a budget at 90 % warns, a spent budget is an error, and only reviews inform. The button opens the one thing that waits, or Now when there are several. */
export function whatWaitsNotice(waiting: Waiting, alarms: BudgetAlarm[], demo: boolean): Notice | undefined {
  const parts = [waiting.needs ? needsWords(waiting.needs) : '', waiting.review ? reviewWords(waiting.review) : '', budgetWords(alarms)].filter(Boolean);
  if (!parts.length) return undefined;
  const severity: Severity = alarms.some(alarm => alarm.share >= 1) ? 'error' : waiting.needs || alarms.length ? 'warning' : 'info';
  const things = waiting.needs + waiting.review + alarms.length;
  const only = things === 1 ? waiting.firstNeeds ?? waiting.firstReview ?? alarms[0]?.target : undefined;
  return { severity, message: parts.join(' · '), description: demo ? demoDescription : undefined, action: actionFor(only ?? { kind: 'now' }, Boolean(only && waiting.review === 1)) };
}

/** The command a target runs, with its arguments, as the Now rows and the notice button use them. */
export function targetCommand(target: Target): { command: string; arguments: unknown[] } {
  if (target.kind === 'workItem') return { command: 'unfold.openWorkItem', arguments: [{ id: target.id, title: target.title }] };
  if (target.kind === 'session') return { command: 'unfold.open', arguments: [target.id] };
  return { command: 'unfold.now.focus', arguments: [] };
}

/** The commands a Now summary line may run from its links. */
export const glanceCommands = ['unfold.openWorkItem', 'unfold.open', 'unfold.openNow'] as const;

/** Escapes text for Markdown, so a title cannot add links, emphasis or HTML. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!<>|~&$]/g, match => `\\${match}`);
}

function commandLink(text: string, target: Target): string {
  const { command, arguments: args } = targetCommand(target);
  return `[${escapeMarkdown(text)}](command:${command}${args.length ? `?${encodeURIComponent(JSON.stringify(args))}` : ''})`;
}

function groupLink(text: string, count: number, first: Target | undefined): string {
  return count === 1 && first ? commandLink(text, first) : `[${escapeMarkdown(text)}](command:unfold.openNow)`;
}

/** The Markdown line at the top of Now, such as `3 ready for review · 2 need you · US$ 4,10 today`, followed by the line Now already shows. A count links to its one Work Item, or to the full Now page when there are several. */
export function glanceMessage(core: Core, waiting: Waiting, spend: TodaySpend, existing: string): string {
  const parts = [
    waiting.review ? groupLink(reviewWords(waiting.review), waiting.review, waiting.firstReview) : '',
    waiting.needs ? groupLink(needsWords(waiting.needs), waiting.needs, waiting.firstNeeds) : '',
    !waiting.review && !waiting.needs ? 'Nothing waits on you' : '',
    escapeMarkdown(spendWords(core, spend)),
  ].filter(Boolean);
  return [parts.join(' · '), existing ? escapeMarkdown(existing) : ''].filter(Boolean).join('\n\n');
}

/** The Markdown label of a Now row: the title in bold when the row needs the person or waits for their review, as written otherwise. A tree label renders only emphasis that wraps the whole string and shows everything inside it literally, so the title is not escaped. */
export function decisiveLabel(title: string, decisive: boolean): string {
  return decisive ? `**${title}**` : title;
}

/** The status bar hover, read when it opens: what waits, each running Run or session with its Role, time and cost so far, and today's spend. */
export function statusHover(core: Core, rules: NowRules, now: PloegNow | undefined, rows: SessionRow[], options: { demo: boolean; origin: string; at?: number }): string {
  const at = options.at ?? Date.now();
  const waiting = waitingOn(rules, now, rows);
  const demo = options.demo || Boolean(now?.demo);
  const counts = [waiting.review ? reviewWords(waiting.review) : '', waiting.needs ? needsWords(waiting.needs) : ''].filter(Boolean).join(' · ') || 'Nothing waits on you';
  const linked = rules.linkedWorkItems(rows);
  const running = [
    ...rows.filter(row => row.group === 'running').map(row => { const text = rules.describeSession(core, row, at); return `- **${escapeMarkdown(text.label)}**: ${escapeMarkdown(text.description)}`; }),
    ...(now?.running ?? []).filter(run => !linked.has(run.workItemId)).map(run => { const text = rules.describeRun(core, run, demo, at); return `- **${escapeMarkdown(text.label)}**: ${escapeMarkdown(text.description)}`; }),
  ];
  const spend = spendWords(core, todaySpend(now, demo, new Date(at)));
  return [
    `**${escapeMarkdown(counts)}**`,
    running.length ? `Running now:\n\n${running.join('\n')}` : 'Nothing runs now.',
    spend ? `Spend: ${escapeMarkdown(spend)}${demo ? '' : ' (settled by Runs that finished today, plus observed so far in running Runs)'}` : 'Spend today: not reported.',
    escapeMarkdown(`${options.origin}${demo ? ' · demo workbench, no model calls or spend' : ''}`),
  ].join('\n\n');
}

/** What the chat status menu shows for Unfold: how many things need the person and today's spend, then what is ready for review. */
export function chatStatus(core: Core, waiting: Waiting, spend: TodaySpend, demo: boolean): { description: string; detail: string | undefined; tooltip: string } {
  const spent = spendWords(core, spend);
  const description = [waiting.needs ? needsWords(waiting.needs) : 'Nothing needs you', spent].filter(Boolean).join(' · ');
  const detail = waiting.review ? reviewWords(waiting.review) : undefined;
  return { description, detail, tooltip: demo ? demoDescription : 'Spend today is settled by Runs that finished today, plus what running Runs observed so far.' };
}
