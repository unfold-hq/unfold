import { createHash, randomBytes } from 'node:crypto';
import { PloegError, type PloegAdmitted, type PloegCancellation, type PloegClient, type PloegConnectionRepository, type PloegConnections, type PloegPrepareAdmission, type PloegTeam } from './ploeg.ts';
import type { ChecklistAction, ChecklistLine, Onboarding, TeamBudget } from './onboarding.ts';
import { defaultTenant } from './tenancy.ts';
import type { User } from './types.ts';

/**
 * One repository's readiness Work Item as Unfold remembers it: the attempt and its `requestId`, the cap the person
 * confirmed, who confirmed it, and what Ploeg answered. `admitting` is written before the Admission is sent, so a
 * retry after a lost answer replays the same `requestId` instead of admitting a second Work Item.
 */
export type PrepareRecord = {
  target: string; team: string; attempt: number; requestId: string; budgetUsd: number;
  by: { id: string; name: string }; at: string; workItemId: string | null;
  state: 'admitting' | 'admitted' | 'cancelled' | 'ended';
  pullRequest: { url: string; state: 'open' | 'closed' | 'unknown' } | null; cancelledAt?: string; ploegState?: string;
};
/** What the checklist's Prepare and Review-and-merge stages show, and the repositories a person may now bind a List to. */
export type ReadinessLines = { prepare: ChecklistLine; review: ChecklistLine | null; bindable: string[] };

type PreparePloeg = Pick<PloegClient, 'connections' | 'routing' | 'admitPrepare' | 'decide' | 'detail'> & { readonly isDemo: boolean };
type Gate = Pick<Onboarding, 'manages' | 'admit' | 'pullRequestOpened'>;
type StateStore = { getSecret<T>(id: string): T | undefined; setSecret(id: string, value: unknown): void };
type Options = { store: StateStore; ploeg: PreparePloeg; onboarding: Gate; now?: () => Date };

const stateId = (tenant: string) => `readiness-prepare:${tenant}`;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const dollars = (usd: number) => `USD ${usd.toFixed(2)}`;
const named = (repository: PloegConnectionRepository) => `${repository.owner}/${repository.repo}`;
const running = new Set(['ingested', 'queued', 'leased', 'proposed']);
const level3 = 'required checks on the base branch';

/**
 * The cap that bounds a readiness Run, as far as Unfold can read it: the Team's spend cap from Ploeg's Teams read.
 * Ploeg lowers the Run's pool further to the Team's prepare cap and the Team plan's pool (Ploeg ADR-0194 section 5),
 * which its reads do not report. Null when the Team has no cap Unfold can read. Never an estimate.
 */
export function readableCap(team: PloegTeam | undefined): number | null {
  return team?.spendCap ? team.spendCap.usd : null;
}

/**
 * The readiness pull request of onboarding stage 7 and 8 (ADR-0059, OpenSpec change `self-serve-onboarding`, slice
 * S7): offered only where Ploeg reports `prepareAvailable: true`, admitted as a `prepare_repository` Work Item (Ploeg
 * ADR-0194) with the cap a signed-in Admin confirmed as `budgetUsd`, at most one per repository, cancelled through
 * Ploeg without ever restarting, and followed until its merge makes the repository ready (ADR-0047 Level 2).
 */
export class ReadinessPrepare {
  private readonly store: StateStore;
  private readonly ploeg: PreparePloeg;
  private readonly onboarding: Gate;
  private readonly now: () => Date;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(options: Options) {
    this.store = options.store; this.ploeg = options.ploeg; this.onboarding = options.onboarding; this.now = options.now ?? (() => new Date());
  }

  /** The readiness Work Items Unfold remembers, by Work Target key. */
  records(): Record<string, PrepareRecord> {
    const stored = this.store.getSecret<Record<string, PrepareRecord>>(stateId(defaultTenant));
    return stored && typeof stored === 'object' ? stored : {};
  }

  /**
   * Admits the readiness Work Item for `{target, team, usd}` after a signed-in Admin confirmed `usd`, the cap shown.
   * The step gate answers first (`503 ploeg_step_unavailable`, `409 budget_missing`, `409 spend_cap_unconfirmed`);
   * then `409 spend_cap_changed` when the cap Unfold reads now is another one, and `409 prepare_unavailable` when
   * Ploeg does not report `prepareAvailable: true`. A repository whose readiness Work Item is live answers that one.
   */
  async start(user: User, input: unknown): Promise<{ prepare: PrepareRecord; replayed: boolean }> {
    if (!this.onboarding.manages(user)) throw new PloegError(403, 'forbidden', 'Only an administrator prepares a repository.');
    const data = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const target = typeof data.target === 'string' ? data.target : '';
    const team = typeof data.team === 'string' ? data.team : '';
    if (!keyPattern.test(target) || !keyPattern.test(team) || typeof data.usd !== 'number' || !Number.isFinite(data.usd) || data.usd <= 0) throw new PloegError(400, 'invalid_input', 'Send the repository, the Team and the cap you were shown: {target, team, usd}.');
    const usd = data.usd;
    if (this.ploeg.isDemo) throw new PloegError(409, 'ploeg_demo', 'The demo opens no readiness pull request: no Run starts and no money is spent.');
    await this.onboarding.admit(user, 'prepare-repository', team);
    return this.locked(target, async () => {
      const stored = this.records()[target];
      const held = stored?.state === 'admitted' && stored.workItemId ? await this.follow(user, stored, true, true) : stored;
      if (held?.state === 'admitted') return { prepare: held, replayed: true };
      const repository = (await this.ploeg.connections(user, true)).repositories.find(entry => entry.key === target);
      if (!repository) throw new PloegError(404, 'ploeg_not_found', 'Ploeg reports no registered repository with that key.');
      if (repository.readiness === 'ready') throw new PloegError(409, 'target_already_ready', `${named(repository)} is ready already: its base branch has an AGENTS.md, so there is nothing to prepare.`);
      if (repository.prepareAvailable !== true) throw new PloegError(409, 'prepare_unavailable', `Ploeg does not offer a readiness pull request for ${named(repository)}${repository.reason ? `: ${repository.reason}` : '.'}`);
      const cap = readableCap((await this.ploeg.routing(user, true)).all.find(entry => entry.id === team));
      if (cap === null) throw new PloegError(409, 'spend_cap_unconfirmed', `Ploeg reports no spend cap for Team ${team} that Unfold can show, so it starts no readiness work.`);
      if (cap !== usd) throw new PloegError(409, 'spend_cap_changed', `The cap that bounds the readiness Run is ${dollars(cap)} now, not the ${dollars(usd)} you confirmed. Read it again and confirm it.`);
      const replay = held?.state === 'admitting' && held.team === team && held.budgetUsd === usd;
      const attempt = replay ? held.attempt : (held?.attempt ?? 0) + 1;
      const requestId = replay ? held.requestId : `prepare-${createHash('sha256').update(target).digest('hex').slice(0, 24)}-${attempt}-${randomBytes(8).toString('hex')}`;
      const tracked = held?.pullRequest && held.pullRequest.state !== 'closed' && held.state !== 'ended' ? held.pullRequest : null;
      const record: PrepareRecord = { target, team, attempt, requestId, budgetUsd: usd, by: { id: user.id, name: user.name }, at: this.now().toISOString(), workItemId: null, state: 'admitting', pullRequest: tracked };
      this.save(target, record);
      let admitted: PloegAdmitted;
      try { admitted = await this.ploeg.admitPrepare(user, { requestId: record.requestId, team, target, budgetUsd: usd } satisfies PloegPrepareAdmission); }
      catch (error) {
        if (error instanceof PloegError && error.status >= 400 && error.status < 500 && error.code !== 'prepare_in_progress') this.save(target, held && held.state !== 'admitting' ? held : null);
        throw error;
      }
      const prepare: PrepareRecord = { ...record, workItemId: admitted.id, state: 'admitted', pullRequest: null };
      this.save(target, prepare);
      return { prepare, replayed: admitted.replayed };
    });
  }

  /**
   * Cancels the live readiness Work Item of `{target}` through Ploeg. It never starts another one. When its pull
   * request had opened, Ploeg's answer says whether it closed it; one it left open stays tracked on the checklist.
   */
  async cancel(user: User, input: unknown): Promise<{ prepare: PrepareRecord; cancellation: PloegCancellation }> {
    if (!this.onboarding.manages(user)) throw new PloegError(403, 'forbidden', 'Only an administrator cancels a readiness pull request.');
    const data = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const target = typeof data.target === 'string' && keyPattern.test(data.target) ? data.target : '';
    if (!target) throw new PloegError(400, 'invalid_input', 'Name the repository whose readiness Work Item to cancel: {target}.');
    if (this.ploeg.isDemo) throw new PloegError(409, 'ploeg_demo', 'The demo runs no readiness Work Item, so there is nothing to cancel.');
    return this.locked(target, async () => {
      const stored = this.records()[target];
      const held = stored?.state === 'admitted' && stored.workItemId ? await this.follow(user, stored, true, true) : stored;
      if (held?.state !== 'admitted' || !held.workItemId) throw new PloegError(409, 'prepare_not_running', 'No readiness Work Item runs for this repository.');
      const cancellation = await this.ploeg.decide(user, held.workItemId, 'cancel', '', { commandId: `prepare-cancel-${held.workItemId}` }) as PloegCancellation;
      const closed = cancellation.pullRequest;
      const pullRequest = closed ? { url: closed.url, state: closed.state } : held.pullRequest ? { url: held.pullRequest.url, state: 'unknown' as const } : null;
      const prepare: PrepareRecord = { ...held, state: 'cancelled', cancelledAt: this.now().toISOString(), pullRequest };
      this.save(target, prepare);
      return { prepare, cancellation };
    });
  }

  /**
   * The Prepare and Review-and-merge stages for the checklist, from Ploeg's connections read and each live readiness
   * Work Item. Seeing a readiness pull request open records `onboarding.first_agent_pr_opened` once per Tenant.
   */
  async lines(user: User, input: { connections: PloegConnections | null; teams: PloegTeam[] | null; budget: TeamBudget[]; manage: boolean; fresh: boolean }): Promise<ReadinessLines> {
    const { connections, budget, manage } = input;
    const records: Record<string, PrepareRecord> = {};
    for (const [key, record] of Object.entries(this.records())) records[key] = record.state === 'admitted' && record.workItemId ? await this.follow(user, record, input.fresh, manage) : record;
    const repositories = connections?.repositories ?? [];
    const teams = new Map((input.teams ?? []).map(team => [team.id, team]));
    const confirmed = budget.filter(entry => entry.confirmed && entry.spendCap);
    const prepareChecks: ChecklistLine[] = [];
    const reviewChecks: ChecklistLine[] = [];
    const bindable: string[] = [];
    const ask = 'Ask an administrator to prepare it.';
    for (const repository of repositories) {
      const record = records[repository.key];
      const name = named(repository);
      const id = `prepare:${repository.key}`;
      if (repository.readiness === 'ready') {
        if (!record) continue;
        bindable.push(name);
        reviewChecks.push({ id: `review:${repository.key}`, stage: 8, title: name, status: 'ok', text: `${name} is ready: its base branch has an AGENTS.md, which is Level 2 of the AI Codebase Maturity Model. Next for Level 3: ${level3}. Ploeg does not report that fact yet, so Unfold cannot check it. Bind a List to ${name} in the next step.` });
        continue;
      }
      if (record?.state === 'admitted') {
        const pr = record.pullRequest;
        const cancel: ChecklistAction | undefined = manage ? { label: pr ? 'Cancel and close the pull request' : 'Cancel', kind: 'cancel-prepare', data: { target: repository.key } } : undefined;
        if (!pr && record.ploegState === 'needs_human') {
          prepareChecks.push({ id, stage: 7, title: name, status: 'problem', reason: 'needs_human', text: `The readiness Work Item #${record.workItemId} stopped and needs a person, for instance because the Run changed more than AGENTS.md. Ploeg pushed nothing.`, action: { label: 'Open the Work Item', href: `#work/${record.workItemId}`, kind: 'link' }, ...(cancel ? { actions: [cancel] } : {}) });
          continue;
        }
        prepareChecks.push({ id, stage: 7, title: name, status: pr ? 'ok' : 'pending', text: pr ? `Ploeg opened the readiness pull request (Work Item #${record.workItemId}, capped at ${dollars(record.budgetUsd)}, confirmed by ${record.by.name}).` : `Ploeg is preparing ${name}: Work Item #${record.workItemId}, capped at ${dollars(record.budgetUsd)}, confirmed by ${record.by.name}. Cancelling stops it and starts nothing new.`, ...(cancel ? { action: cancel } : {}) });
        if (pr) reviewChecks.push({ id: `review:${repository.key}`, stage: 8, title: name, status: 'warning', text: `Review and merge the readiness pull request: it adds only AGENTS.md. A reviewer’s findings are posted on it and no Run fixes them, so change the branch yourself if a command is wrong. Merging makes ${name} ready.`, action: { label: 'Open the pull request', href: pr.url, kind: 'link', external: true } });
        continue;
      }
      if ((record?.state === 'cancelled' || record?.state === 'admitting') && record.pullRequest && record.pullRequest.state !== 'closed') {
        prepareChecks.push({ id, stage: 7, title: name, status: 'warning', reason: 'prepare_in_progress', text: `The readiness Work Item was cancelled, but Ploeg did not close its pull request. Until a person closes or merges it, Ploeg refuses a second readiness Work Item for ${name} (prepare_in_progress).`, action: { label: 'Open the pull request', href: record.pullRequest.url, kind: 'link', external: true } });
        continue;
      }
      if (repository.prepareAvailable !== true) {
        if (repository.readiness === 'not_ready') prepareChecks.push({ id, stage: 7, title: name, status: 'problem', reason: 'prepare_unavailable', text: `${name} is not ready${repository.reason ? `: ${repository.reason}` : '.'} Ploeg offers no readiness pull request for it.` });
        continue;
      }
      const before = record?.state === 'cancelled' ? ' The last readiness Work Item was cancelled and its pull request closed.' : record?.state === 'ended' ? ' The last readiness Work Item ended without a merged pull request.' : '';
      const bound = 'Ploeg also holds it to the Team’s prepare cap (USD 2.00 unless the installation set another) and the Team plan’s pool, which it does not report. Unfold shows no estimate.';
      const offers = confirmed.map(entry => ({ team: entry.team, cap: readableCap(teams.get(entry.team)) })).filter((entry): entry is { team: string; cap: number } => entry.cap !== null);
      const text = offers.length
        ? `Only AGENTS.md is missing. Ploeg can run one Run that opens a pull request adding it and changing nothing else, capped at ${offers.map(entry => `${dollars(entry.cap)} on Team ${entry.team}`).join(' or ')}. ${bound}${before}`
        : `Only AGENTS.md is missing, and Ploeg can open a pull request that adds it. Confirm a Team’s spend cap on the Budget line first; the Run is capped by it.${before}`;
      const actions: ChecklistAction[] = manage ? offers.map(entry => ({ label: `Prepare this repository · ${dollars(entry.cap)} on ${entry.team}`, kind: 'prepare', data: { target: repository.key, team: entry.team, usd: String(entry.cap) } })) : [];
      prepareChecks.push({ id, stage: 7, title: name, status: 'pending', text, ...(manage ? {} : { fix: ask }), ...(actions.length ? { actions } : {}) });
    }
    const waiting = prepareChecks.filter(line => line.status !== 'ok' && line.status !== 'problem').length;
    const prepare: ChecklistLine = prepareChecks.length
      ? { id: 'prepare-repository', stage: 7, title: 'Prepare a repository', status: waiting ? 'pending' : prepareChecks.some(line => line.status === 'problem') ? 'problem' : 'ok', text: waiting ? 'A repository that misses only AGENTS.md can get one readiness pull request from Ploeg. A person confirms the cap first.' : 'Every repository that needed a readiness pull request has one, or says why it cannot.', checks: prepareChecks }
      : { id: 'prepare-repository', stage: 7, title: 'Prepare a repository', status: bindable.length ? 'ok' : 'pending', text: bindable.length ? 'Every prepared repository is ready.' : 'No registered repository needs a readiness pull request.' };
    const open = reviewChecks.filter(line => line.status !== 'ok').length;
    const review: ChecklistLine | null = reviewChecks.length
      ? { id: 'review-and-merge', stage: 8, title: 'Review and merge', status: open ? 'warning' : 'ok', text: open ? 'A readiness pull request waits for a person to review and merge it. Ploeg never merges.' : 'Every readiness pull request is merged and its repository is ready.', checks: reviewChecks }
      : null;
    return { prepare, review, bindable };
  }

  /**
   * The record as Ploeg reports its Work Item now: its state, the pull request it opened, and `ended` once it stopped
   * without one waiting for review. Only a reader who manages the Tenant persists what changed and records
   * `onboarding.first_agent_pr_opened`; anyone else's read leaves the store as it is.
   */
  private async follow(user: User, record: PrepareRecord, fresh: boolean, persist: boolean): Promise<PrepareRecord> {
    const detail = await this.ploeg.detail(user, record.workItemId!, fresh).catch(() => null);
    if (!detail) return record;
    const url = detail.item.pullRequest?.url ?? '';
    let current: PrepareRecord = record.ploegState === detail.item.state ? record : { ...record, ploegState: detail.item.state };
    if (url && !current.pullRequest) current = { ...current, pullRequest: { url, state: 'open' } };
    if (!running.has(detail.item.state) && detail.item.state !== 'awaiting_review' && detail.item.state !== 'needs_human') current = { ...current, state: 'ended', ...(url ? { pullRequest: { url, state: detail.item.state === 'done' ? 'closed' : 'unknown' } } : {}) };
    if (!persist) return current;
    if (url) this.onboarding.pullRequestOpened(user, 'readiness');
    if (current !== record) this.save(record.target, current);
    return current;
  }

  private save(target: string, record: PrepareRecord | null): void {
    const records = this.records();
    if (record) records[target] = record; else delete records[target];
    this.store.setSecret(stateId(defaultTenant), records);
  }

  private async locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.locks.set(key, next);
    try { return await next; } finally { if (this.locks.get(key) === next) this.locks.delete(key); }
  }
}
