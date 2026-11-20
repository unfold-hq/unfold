import type { Core } from './core.js';
import type * as Now from './now.js';
import type { SessionRow } from './now.js';
import type { PloegNow, PloegNowItem } from './ploeg-types.js';

/** The chat session type Unfold Insiders contributes to VS Code's Sessions list, and the URI scheme of its items. */
export const workSessionType = 'unfold-work';

/** The setting that chooses what the Sessions list shows: only the work a person may take on, or also the work that needs them. */
export const sessionsListSetting = 'insiders.sessionsList';

/**
 * `take-on` lists only proposed Work Items. `all` also lists the person's Work Items and sessions that need them or are
 * ready for review, which the workbench's agent host may already list in the same window.
 */
export type WorkSessionScope = 'take-on' | 'all';

export type WorkSessionStatus = 'needs-input' | 'completed' | 'failed';

export type WorkSessionRef = { kind: 'work-item' | 'session'; id: string };

export type WorkSessionChange = { file: string; insertions: number; deletions: number };

/** One row of the Sessions list, free of VS Code types, so the mapping is tested without an editor. */
export type WorkSessionEntry = {
  ref: WorkSessionRef;
  label: string;
  description: string;
  badge?: string;
  status?: WorkSessionStatus;
  tooltip: string;
  icon: string;
  created: number;
  updated: number;
  changes: WorkSessionChange[];
  takeOn: boolean;
};

/** What the list is built from: the Now snapshot and the session rows the extension already reads, and who is signed in. */
export type WorkSessionInput = { now?: PloegNow; rows: SessionRow[]; userId?: string; demo: boolean };

/** Now's own grouping and wording, passed in so a row reads exactly as it does on Now. */
export type WorkSessionRules = Pick<typeof Now, 'nowGroup' | 'linkedWorkItems' | 'describeItem' | 'describeSession'>;

export function workSessionScope(value: unknown): WorkSessionScope {
  return value === 'all' ? 'all' : 'take-on';
}

export function workSessionUri(ref: WorkSessionRef): string {
  return `${workSessionType}:/${ref.kind}/${ref.id}`;
}

export function workSessionRef(uri: { scheme: string; path: string }): WorkSessionRef | undefined {
  if (uri.scheme !== workSessionType) return undefined;
  const found = /^\/(work-item|session)\/([A-Za-z0-9_-]{1,64})$/.exec(uri.path);
  return found ? { kind: found[1] as WorkSessionRef['kind'], id: found[2] } : undefined;
}

const time = (value: string | undefined) => { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? parsed : 0; };

function shiftLine(core: Core, item: PloegNowItem, demo: boolean): string {
  const shift = item.latestShift;
  if (!shift || demo) return '';
  const budget = typeof shift.budgetUsd === 'number' && shift.budgetUsd > 0 ? ` of ${core.money(shift.budgetUsd)}` : '';
  return `Latest Shift${shift.round ? `, Round ${shift.round}` : ''}: ${core.money(shift.spentUsd ?? 0)} spent${budget}.`;
}

function itemStatus(rules: WorkSessionRules, item: PloegNowItem): WorkSessionStatus | undefined {
  const group = rules.nowGroup(item);
  if (group === 'review') return 'completed';
  if (item.state === 'needs_human') return 'needs-input';
  if (group === 'needs') return 'failed';
  return undefined;
}

function workItemEntry(core: Core, rules: WorkSessionRules, item: PloegNowItem, demo: boolean): WorkSessionEntry {
  const words = rules.describeItem(core, item, demo);
  return {
    ref: { kind: 'work-item', id: item.id },
    label: words.label,
    description: words.description,
    status: itemStatus(rules, item),
    tooltip: [words.heading, ...words.lines, shiftLine(core, item, demo)].filter(Boolean).join('\n'),
    icon: rules.nowGroup(item) === 'review' ? 'git-pull-request' : 'bell-dot',
    created: time(item.createdAt),
    updated: time(item.updatedAt),
    changes: [],
    takeOn: false,
  };
}

function proposedEntry(core: Core, rules: WorkSessionRules, item: PloegNowItem, demo: boolean): WorkSessionEntry {
  const words = rules.describeItem(core, item, demo);
  const offer = `Proposed, not taken on: start a new Unfold session from this list, or open this one, to take it on. You confirm the Team and its budget first; nothing runs until you do.`;
  return {
    ref: { kind: 'work-item', id: item.id },
    label: words.label,
    description: ['Proposed · you may take this on', `Team ${item.team}`, item.sourceTitle ? `from ${item.sourceTitle}` : '', demo ? 'illustration' : ''].filter(Boolean).join(' · '),
    badge: 'Proposed',
    tooltip: [offer, ...words.lines].join('\n'),
    icon: 'lightbulb',
    created: time(item.createdAt),
    updated: time(item.updatedAt),
    changes: [],
    takeOn: true,
  };
}

function sessionStatus(row: SessionRow): WorkSessionStatus {
  if (row.group === 'review') return 'completed';
  return row.progress.phase === 'asking' || row.session.status === 'waiting_input' ? 'needs-input' : 'failed';
}

function sessionEntry(core: Core, rules: WorkSessionRules, row: SessionRow): WorkSessionEntry {
  const words = rules.describeSession(core, row);
  return {
    ref: { kind: 'session', id: row.session.id },
    label: words.label,
    description: words.description,
    status: sessionStatus(row),
    tooltip: words.lines.join('\n'),
    icon: row.group === 'review' ? 'git-pull-request' : 'bell-dot',
    created: time(row.session.createdAt),
    updated: time(row.session.updatedAt),
    changes: core.changedFiles(row.session).map(change => ({ file: change.file, insertions: change.added, deletions: change.removed })),
    takeOn: false,
  };
}

/**
 * The rows of the Sessions list. Proposed Work Items are always listed, marked as work the person may take on. With
 * `all`, the Work Items that need the person or are ready for their review follow, and the person's own sessions that
 * do, each Work Item once: a Work Item a session drives is shown as that session, as on Now.
 */
export function workSessionEntries(core: Core, rules: WorkSessionRules, input: WorkSessionInput, scope: WorkSessionScope): WorkSessionEntry[] {
  const demo = input.demo || Boolean(input.now?.demo);
  const waiting = input.now?.waiting ?? [];
  const proposed = waiting.filter(item => rules.nowGroup(item) === 'proposed').map(item => proposedEntry(core, rules, item, demo));
  if (scope === 'take-on') return proposed;
  const own = input.rows.filter(row => (row.group === 'needs' || row.group === 'review') && (!input.userId || row.session.ownerId === input.userId));
  const linked = rules.linkedWorkItems(input.rows);
  const items = waiting.filter(item => ['needs', 'review'].includes(rules.nowGroup(item) ?? '') && !linked.has(item.id)).map(item => workItemEntry(core, rules, item, demo));
  const sessions = own.map(row => sessionEntry(core, rules, row));
  return [...[...items, ...sessions].sort((a, b) => b.updated - a.updated), ...proposed];
}

/** What a reply in a session that takes no input is told: Unfold runs no model, so nothing typed there goes anywhere. */
export const noInputReply = 'Unfold runs no model here and forwards nothing typed in this session. Act on this work from Now or its Work Item page.';
