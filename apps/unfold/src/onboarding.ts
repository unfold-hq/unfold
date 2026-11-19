import { readFileSync } from 'node:fs';
import { PloegError, type PloegConnections, type PloegTeam } from './ploeg.ts';
import type { TeamSpendCap } from './hand-off-spend.ts';
import type { ReadinessLines } from './readiness-prepare.ts';
import { defaultTenant } from './tenancy.ts';
import type { AppConfig, InsightEvent, User } from './types.ts';

/** One onboarding step a later slice builds, with the Ploeg read route that tells whether Ploeg serves it and the release that adds it. */
export type PloegStep = { id: StepId; stage: number; record: string; read: string | null; release: string | null };
export type StepId = 'connect-github' | 'connect-gitlab' | 'connect-gitlab-service-account' | 'register-repositories' | 'connect-clickup' | 'read-scopes' | 'prepare-repository' | 'bind-lists' | 'connect-claude';
/**
 * `src/ploeg-steps.json`: the forge and tracker the onboarding connects first (decision D4), the steps of the onboarding
 * checklist that need a Ploeg route, the first release that ships Ploeg ADR-0192, below which an installation on another
 * forge cannot add the onboarding forge, and GitLab as the other forge: its Ploeg instance name and the record and
 * release that let Ploeg mint a Run's GitLab credential.
 */
export type PloegSteps = {
  schemaVersion: 1; pair: { forge: string; forgeName: string; tracker: string; trackerName: string }; steps: PloegStep[]; secondForge: { record: string; release: string | null };
  gitlab: { forge: string; forgeName: string; instance: string; mint: { record: string; release: string | null } };
};

export const ploegStepsUrl = new URL('./ploeg-steps.json', import.meta.url);
export const ploegSteps = JSON.parse(readFileSync(ploegStepsUrl, 'utf8')) as PloegSteps;
/** The Ploeg contract bundle release this Unfold is built against, from `ploeg-release.json`; `unknown` when the file is not there. */
export function pinnedRelease(url = new URL('../ploeg-release.json', import.meta.url)): string {
  try { return /:([^:@]+)@sha256:/.exec(String((JSON.parse(readFileSync(url, 'utf8')) as { contract?: unknown }).contract))?.[1] ?? 'unknown'; }
  catch { return 'unknown'; }
}

/** The answers of a Ploeg dry run that mean the installation has not opted in to a step, with the install value that opts it in. */
export const optInRefusals = {
  registration_not_accepted: { id: 'install-registration', title: 'Ploeg accepts repositories from the screen', value: 'targetRegistration.enabled: true, with targetRegistration.connections naming the GitHub connection and targetRegistration.requireClaims' },
  bindings_not_accepted: { id: 'install-bindings', title: 'The Team accepts Lists from the screen', value: 'teams.<team>.trackerBindings.connections naming the ClickUp connection, and trackerBindings.max' },
  permission_required: { id: 'install-consumer', title: 'Unfold may connect, register and bind', value: 'the unfold entry in consumers[] with execute, bindScopes: true, registerTargets: true, manageConnections: true with Unfold’s callback in connectionRedirectUris, readTrackers naming the ClickUp connection (or ["*"]), and the Team in its teams' },
  connections_not_accepted: { id: 'install-connections', title: 'Ploeg accepts connections from the screen', value: 'connections.enabled: true with an allow entry for clickup and its methods (token, or oauth with the instance’s ClickUp OAuth application), an allow entry {port: forge, kind: github, methods: [github_app_manifest, github_app_installation]}, connections.requireClaims, a SecretStore and PLOEG_PUBLIC_WEBHOOK_BASE' },
  person_claim_required: { id: 'install-claims', title: 'Your sign-in carries the claims Ploeg asks for', value: 'the claims targetRegistration.requireClaims names, issued to the Admin by the identity provider' },
} as const;
export type OptInRefusal = keyof typeof optInRefusals;

/** Every one-time install value of v1 (design section 1), for **Show the install values**. */
export const installValues: readonly { prerequisite: string; value: string; read: string }[] = [
  { prerequisite: 'A Team exists', value: 'executor.teams[] with at least one entry; the Ploeg chart ships teams: []', read: 'Teams read' },
  { prerequisite: 'The Team has a spend cap', value: 'executor.spendCap or the Team’s own spendCap, not null; the chart default is {usd: 20, period: day}', read: 'Teams read' },
  { prerequisite: 'The Team accepts runtime bindings', value: optInRefusals.bindings_not_accepted.value, read: 'not reported; the binding dry run answers 422 bindings_not_accepted' },
  { prerequisite: 'The installation accepts runtime targets', value: optInRefusals.registration_not_accepted.value, read: 'not reported; the registration dry run answers 422 registration_not_accepted' },
  { prerequisite: 'Unfold’s consumer may do it', value: optInRefusals.permission_required.value, read: 'not reported; Ploeg answers 403 permission_required' },
  { prerequisite: 'Changes are proven', value: 'attribution: proven with person tokens (audiences or clientIds for Unfold’s consumer), and Unfold’s token exchange', read: 'partly' },
  { prerequisite: 'The person carries the claims', value: optInRefusals.person_claim_required.value, read: 'not reported; Ploeg answers 403 person_claim_required' },
  { prerequisite: 'A secret store', value: 'Ploeg’s SecretStore: OpenBao or Vault KV, or the Kubernetes Secret adapter with its Role', read: 'not reported yet' },
  { prerequisite: 'Egress', value: 'ploegd may reach api.github.com, github.com and api.clickup.com; Unfold may reach GitHub’s App pages and ClickUp’s API', read: 'not reported; the first probe’s failure names the host' },
  { prerequisite: 'A public webhook URL', value: 'Ploeg’s public webhook URL, reachable from GitHub and ClickUp', read: 'connections read' },
  { prerequisite: 'Ploeg makes connections from the screen', value: optInRefusals.connections_not_accepted.value, read: 'not reported; starting a connection answers 422 connections_not_accepted' },
];

/** What one checklist line says: `ok` green, `problem` red, `warning` amber, `unknown` not known yet, `pending` not started, `unavailable` refused because Ploeg does not serve the step. */
export type LineStatus = 'ok' | 'problem' | 'warning' | 'unknown' | 'pending' | 'unavailable';
export type ChecklistAction = { label: string; href?: string; external?: boolean; data?: Record<string, string>; kind: 'link' | 'refresh' | 'install-values' | 'config-entry' | 'confirm-cap' | 'prepare' | 'cancel-prepare' };
export type ChecklistLine = {
  id: string; stage: number; title: string; status: LineStatus; text: string;
  fix?: string; action?: ChecklistAction; actions?: ChecklistAction[]; install?: string; reason?: string; configured?: boolean;
  waitsFor?: { record: string; release: string | null }; configEntry?: string; checks?: ChecklistLine[];
};
/** `GET /api/onboarding`: the checklist one person reads on Settings → Connections. */
export type Checklist = {
  demo: boolean; manage: boolean; onboarding: boolean; pinnedBundle: string;
  stages: ChecklistLine[]; installValues: typeof installValues;
  storedRepositories: ReturnType<StoredEntries['repositories']>;
  connections: PloegConnections | null; reads: { connections: string | null; teams: string | null }; fetchedAt: string;
  budget: TeamBudget[];
};
/** An Admin's confirmation of a Team's spend cap: the cap as Ploeg reported it when they confirmed, who confirmed it and when. */
export type CapConfirmation = { team: string; usd: number; period: TeamSpendCap['period']; by: { id: string; name: string }; at: string };
/**
 * One Team on the Budget stage: its `spendCap` as Ploeg's Teams read reports it (null for none, left out when this
 * Ploeg does not report it), the confirmation that still matches it, and whether onboarding may bind a List to it.
 */
export type TeamBudget = { team: string; spendCap?: TeamSpendCap | null; confirmed: ShownConfirmation | null; changed: ShownConfirmation | null; bindable: boolean };
/** A confirmation as the checklist shows it: who confirmed it only to someone who manages the Tenant. */
export type ShownConfirmation = Omit<CapConfirmation, 'by'> & { by?: CapConfirmation['by'] };

type StepState = { startedAt?: string; lines: Record<string, LineStatus>; completed: string[]; refused: string[]; optIn: OptInRefusal[]; firstAgent?: { at: string; kind: 'readiness' | 'task' }; firstTask?: string; caps?: Record<string, CapConfirmation> };
type StateStore = { getSecret<T>(id: string): T | undefined; setSecret(id: string, value: unknown): void };
type PloegReads = {
  connections(user: User, fresh?: boolean): Promise<PloegConnections>;
  routing(user: User, fresh?: boolean): Promise<{ all: PloegTeam[] }>;
  serves(user: User, route: string, fresh?: boolean): Promise<boolean | null>;
};
/** What Unfold's own store holds for the Tenant: repositories Admins added from the screen with their state, and how many saved task sources. */
export type StoredEntries = { repositories(): { id: string; name: string; url: string; state: 'active' | 'shadowed' | 'off' }[]; sources(): number };
type Recorder = { ingest(events: InsightEvent[], user: User): number };
/** The line a later slice shows for a step this Ploeg serves, from what Unfold holds; none keeps the step's "Unfold adds its screen" line. */
export type StepLines = (manage: boolean, context: { otherForges: string[]; user: User }) => Partial<Record<StepId, ChecklistLine>>;
type Readiness = { lines(user: User, input: { connections: PloegConnections | null; teams: PloegTeam[] | null; budget: TeamBudget[]; manage: boolean; fresh: boolean }): Promise<ReadinessLines> };
type Options = { pinned?: string; store: StateStore; ploeg: PloegReads; config: Pick<AppConfig, 'repositories' | 'taskSources' | 'productEvents' | 'tenancy'>; insight?: Recorder; now?: () => Date; steps?: PloegSteps; stored?: StoredEntries; stepLines?: StepLines };

const stateId = (tenant: string) => `onboarding:${tenant}`;
const askAdmin = 'Ask an administrator to connect this.';
const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const cap = (team: PloegTeam) => team.spendCap ? `${team.id}: ${amount(team.spendCap)}` : team.id;
const amount = (value: { usd: number; period: string }) => `USD ${Number.isInteger(value.usd) ? value.usd : value.usd.toFixed(2)} a ${value.period}`;
const periods: readonly TeamSpendCap['period'][] = ['day', 'week', 'month'];
const matches = (confirmation: CapConfirmation | undefined, spendCap: TeamSpendCap | null | undefined) => Boolean(confirmation && spendCap && confirmation.usd === spendCap.usd && confirmation.period === spendCap.period);
const minute = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const confirmedBy = (confirmation: ShownConfirmation) => `${confirmation.by ? ` by ${confirmation.by.name}` : ''} on ${minute(confirmation.at)}`;
/** The onboarding steps that spend or lead to spend, refused with `409 budget_missing` for a Team without a spend cap. */
export const capGatedSteps: ReadonlySet<StepId> = new Set(['prepare-repository', 'bind-lists']);

/** Whether the pinned Ploeg resolves a Run's forge from its Work Target (Ploeg ADR-0192), so an installation that serves another forge may add the onboarding forge. */
export function secondForgeOpen(steps: PloegSteps, pinned: string): boolean {
  return steps.secondForge.release !== null && pinned !== 'unknown' && compareReleases(pinned, steps.secondForge.release) >= 0;
}

/**
 * Compares two Ploeg release versions such as `0.2.0` and `0.2.0-rc.108`: negative when `a` is older. A release
 * without a pre-release part is newer than its candidates.
 */
export function compareReleases(a: string, b: string): number {
  const parse = (value: string) => { const [core, pre = ''] = value.replace(/^v/, '').split('-', 2); return { core: core.split('.').map(Number), pre }; };
  const left = parse(a); const right = parse(b);
  for (let index = 0; index < 3; index++) if ((left.core[index] ?? 0) !== (right.core[index] ?? 0)) return (left.core[index] ?? 0) - (right.core[index] ?? 0);
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  const number = (pre: string) => Number(pre.split('.').at(-1));
  return number(left.pre) - number(right.pre);
}

/**
 * The onboarding checklist of Settings → Connections (ADR-0059, OpenSpec change `self-serve-onboarding`, slice S1):
 * the stage lines computed from Ploeg's connections and Teams reads, whether an Admin lands on it after signing in,
 * the `ploeg_step_unavailable` refusal of a step Ploeg does not serve, and the `onboarding.*` product events.
 */
export class Onboarding {
  private readonly store: StateStore;
  private readonly ploeg: PloegReads;
  private readonly config: Options['config'];
  private readonly insight: Recorder | undefined;
  private readonly now: () => Date;
  private readonly steps: PloegSteps;
  private readonly stored: StoredEntries;
  private readonly pinned: string;
  private stepLines: StepLines | undefined;
  private readiness: Readiness | undefined;

  constructor(options: Options) {
    this.store = options.store; this.ploeg = options.ploeg; this.config = options.config; this.insight = options.insight;
    this.now = options.now ?? (() => new Date()); this.steps = options.steps ?? ploegSteps;
    this.stored = options.stored ?? { repositories: () => [], sources: () => 0 };
    this.pinned = options.pinned ?? pinnedRelease();
    this.stepLines = options.stepLines;
  }

  /** Shows the lines `lines` gives for the steps this Ploeg serves, in place of their "Unfold adds its screen" line. */
  useStepLines(lines: StepLines): void { this.stepLines = lines; }
  /** Shows the readiness pull request (slice S7) on the Prepare and Review-and-merge stages once Ploeg serves the step. */
  useReadiness(readiness: Readiness): void { this.readiness = readiness; }

  /** Whether `user` connects accounts and adds repositories and Lists: an administrator, and under `tenancy.enforce` an Admin of the Tenant. */
  manages(user: User, tenant = defaultTenant): boolean {
    if (user.role !== 'admin') return false;
    return this.config.tenancy?.enforce !== true || (user.memberships ?? []).some(held => held.kind === 'tenant' && held.tenant === tenant && held.role === 'admin');
  }

  /** Whether the Tenant has no task source and no repository at all, configured or stored, whether or not a stored one is in use. */
  empty(): boolean { return !(this.config.repositories ?? []).length && !(this.config.taskSources ?? []).length && !this.stored.repositories().length && !this.stored.sources(); }

  /** Where `user` lands after signing in: Connections for an Admin of an empty Tenant, which also starts onboarding once per Tenant. */
  landing(user: User): { land: boolean } {
    const land = this.manages(user) && this.empty();
    if (land) this.start(user);
    return { land };
  }

  /** Records `onboarding.started` the first time an Admin of an empty Tenant signs in. Never twice for a Tenant. */
  start(user: User): void {
    const state = this.read();
    if (state.startedAt) return;
    state.startedAt = this.now().toISOString();
    this.write(state);
    this.record(user, 'onboarding.started', {});
  }

  /** The step record for `id`, and whether this Ploeg serves it now: from its read route, or from the pinned bundle where the step has none. */
  async available(user: User, id: StepId, fresh = false): Promise<{ step: PloegStep; served: boolean | null }> {
    const step = this.steps.steps.find(entry => entry.id === id);
    if (!step) throw new Error(`Unknown onboarding step ${id}`);
    if (step.read) return { step, served: await this.ploeg.serves(user, step.read, fresh) };
    return { step, served: step.release !== null && this.pinned !== 'unknown' && compareReleases(this.pinned, step.release) >= 0 };
  }

  /**
   * Admits one step that writes to Ploeg, before anything is sent: 403 for someone who does not manage the Tenant,
   * and `503 ploeg_step_unavailable` naming the release that adds it when this Ploeg does not serve the step. It
   * learns that from the step's read route or the pinned bundle, never by sending the write.
   */
  async admit(user: User, id: StepId, team?: string): Promise<void> {
    if (!this.manages(user)) throw new PloegError(403, 'forbidden', 'Only an administrator connects accounts and adds repositories and Lists.');
    await this.served(user, id);
    if (capGatedSteps.has(id)) await this.capGate(user, id, team);
  }

  /**
   * Admits a step each person takes for themselves, such as connecting their own Claude routine: anyone but a viewer,
   * with the same `503 ploeg_step_unavailable` refusal as {@link admit} when this Ploeg does not serve the step.
   */
  async admitPerson(user: User, id: StepId): Promise<void> {
    if (user.role === 'viewer') throw new PloegError(403, 'forbidden', 'Viewers cannot connect accounts or start work.');
    await this.served(user, id);
  }

  private async served(user: User, id: StepId): Promise<void> {
    const { step, served } = await this.available(user, id, true);
    if (served === true) return;
    if (served === null) throw new PloegError(503, 'ploeg_unavailable', 'Ploeg could not be reached to check this step. Try again in a minute.');
    this.refused(user, step.id, step.release ?? 'unreleased', 'not_served');
    throw new PloegError(503, 'ploeg_step_unavailable', `${unavailableText(step, this.pinned)} Use the configuration entry for this step instead.`);
  }

  /**
   * The spend-cap gate (OpenSpec change `self-serve-onboarding`, slice S6) of a step that spends or leads to spend:
   * `409 budget_missing` while Ploeg's Teams read reports the Team's `spendCap` as null, and for readiness work also
   * `409 spend_cap_unconfirmed` until an Admin confirmed the cap Ploeg reports now. It reads the Teams fresh and sends
   * Ploeg nothing. Hand-off and import from configured sources never pass through it.
   */
  private async capGate(user: User, id: StepId, team: string | undefined): Promise<void> {
    if (!team) throw new PloegError(400, 'invalid_input', 'Name the Team the work is for.');
    const found = (await this.ploeg.routing(user, true)).all.find(entry => entry.id === team);
    if (!found) throw new PloegError(404, 'ploeg_not_found', `Ploeg reports no Team ${team}.`);
    if (found.spendCap === null) {
      this.refused(user, id, this.pinned, 'budget_missing');
      throw new PloegError(409, 'budget_missing', `Team ${team} has no spend cap, so Unfold starts no onboarding work for it and sent Ploeg nothing. Ask your installer to set the Team’s spend cap: ${installValues[1].value}.`);
    }
    if (id !== 'prepare-repository' || matches(this.read().caps?.[team], found.spendCap)) return;
    this.refused(user, id, this.pinned, 'spend_cap_unconfirmed');
    throw new PloegError(409, 'spend_cap_unconfirmed', found.spendCap ? `Confirm Team ${team}’s spend cap of ${amount(found.spendCap)} on the Budget line of the onboarding checklist first.` : `This Ploeg does not report Team ${team}’s spend cap, so there is no cap to confirm and Unfold starts no readiness work.`);
  }

  /**
   * Records that `user` confirmed a Team's spend cap, bound to the cap they were shown: `{team, usd, period}` must be
   * what Ploeg's Teams read reports now, or `409 spend_cap_changed`. `409 budget_missing` for a Team without a cap,
   * `501 ploeg_unsupported` when this Ploeg reports no caps, `409 ploeg_demo` in the demo. Only an Admin confirms.
   */
  async confirmCap(user: User, input: unknown): Promise<CapConfirmation> {
    if (!this.manages(user)) throw new PloegError(403, 'forbidden', 'Only an administrator confirms a Team’s spend cap.');
    const data = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const team = typeof data.team === 'string' ? data.team.trim() : '';
    const period = periods.find(entry => entry === data.period);
    if (!team || team.length > 100 || typeof data.usd !== 'number' || !Number.isFinite(data.usd) || data.usd <= 0 || !period) throw new PloegError(400, 'invalid_input', 'Send the Team and the cap you were shown: {team, usd, period}, with period day, week or month.');
    const [connections, teams] = await Promise.all([this.ploeg.connections(user).catch(() => null), this.ploeg.routing(user, true)]);
    if (connections?.demo) throw new PloegError(409, 'ploeg_demo', 'The demo has no spend cap to confirm: no Run starts and no money is spent.');
    const found = teams.all.find(entry => entry.id === team);
    if (!found) throw new PloegError(404, 'ploeg_not_found', `Ploeg reports no Team ${team}.`);
    if (found.spendCap === null) throw new PloegError(409, 'budget_missing', `Team ${team} has no spend cap to confirm. Ask your installer to set the Team’s spend cap: ${installValues[1].value}.`);
    if (found.spendCap === undefined) throw new PloegError(501, 'ploeg_unsupported', 'This Ploeg does not report Team spend caps, so there is no cap to confirm.');
    if (found.spendCap.usd !== data.usd || found.spendCap.period !== period) throw new PloegError(409, 'spend_cap_changed', `Ploeg now reports ${amount(found.spendCap)} for Team ${team}, not the cap you confirmed. Read it again and confirm it.`);
    const confirmation: CapConfirmation = { team, usd: found.spendCap.usd, period: found.spendCap.period, by: { id: user.id, name: user.name }, at: this.now().toISOString() };
    const state = this.read();
    state.caps = { ...state.caps, [team]: confirmation };
    this.write(state);
    return confirmation;
  }

  /**
   * Notes a dry run that Ploeg refused because the installation has not opted in (`422 registration_not_accepted`,
   * `422 bindings_not_accepted`, `403 permission_required`, `403 person_claim_required`): the matching installation
   * line turns red with its install value, and `onboarding.step_refused` is recorded.
   */
  notOptedIn(user: User, step: StepId, code: OptInRefusal): void {
    const state = this.read();
    if (!state.optIn.includes(code)) { state.optIn.push(code); this.write(state); }
    this.refused(user, step, this.pinned, code);
  }

  /** Records the Tenant's first agent pull request and its first task pull request, each at most once, with the seconds since onboarding started. */
  pullRequestOpened(user: User, kind: 'readiness' | 'task'): void {
    const state = this.read();
    if (!state.startedAt) return;
    const at = this.now().toISOString();
    const seconds = Math.max(0, Math.round((Date.parse(at) - Date.parse(state.startedAt)) / 1000));
    const events: [string, Record<string, string | number | boolean>][] = [];
    if (!state.firstAgent) { state.firstAgent = { at, kind }; events.push(['onboarding.first_agent_pr_opened', { seconds, kind }]); }
    if (kind === 'task' && !state.firstTask) { state.firstTask = at; events.push(['onboarding.first_task_pr_opened', { seconds, readiness_first: state.firstAgent.kind === 'readiness' }]); }
    if (!events.length) return;
    this.write(state);
    for (const [name, props] of events) this.record(user, name, props);
  }

  /** The checklist `user` reads. It changes nothing in Ploeg; it records the step events of lines that turned green or red. */
  async checklist(user: User, fresh = false): Promise<Checklist> {
    const reads: Checklist['reads'] = { connections: null, teams: null };
    const failure = (error: unknown) => error instanceof PloegError ? error.code : 'ploeg_unavailable';
    const [connections, teams] = await Promise.all([
      this.ploeg.connections(user, fresh).catch(error => { reads.connections = failure(error); return null; }),
      this.ploeg.routing(user, fresh).then(routing => routing.all).catch(error => { reads.teams = failure(error); return null; }),
    ]);
    const served = Object.fromEntries(await Promise.all(this.steps.steps.map(async step => [step.id, await this.available(user, step.id, fresh).then(result => result.served).catch(() => null)] as const))) as Record<StepId, boolean | null>;
    const state = this.read();
    const manage = this.manages(user);
    const storedRepositories = this.stored.repositories();
    const budget = (teams ?? []).map(entry => budgetOf(entry, state, manage));
    const readiness = served['prepare-repository'] === true && this.readiness && !connections?.demo ? await this.readiness.lines(user, { connections, teams, budget, manage, fresh }).catch(() => null) : null;
    if (readiness) Object.assign(state, this.read());
    const stages = this.stages({ user, connections, teams, served, state, manage, storedRepositories, budget, readiness });
    this.track(user, state, stages);
    return { demo: Boolean(connections?.demo), manage, onboarding: Boolean(state.startedAt) && this.empty(), pinnedBundle: this.pinned, stages, installValues: manage ? installValues : [], storedRepositories, connections, reads, fetchedAt: this.now().toISOString(), budget };
  }

  private stages(input: { user: User; connections: PloegConnections | null; teams: PloegTeam[] | null; served: Record<StepId, boolean | null>; state: StepState; manage: boolean; storedRepositories: ReturnType<StoredEntries['repositories']>; budget: TeamBudget[]; readiness: ReadinessLines | null }): ChecklistLine[] {
    const { user, connections, teams, served, state, manage, storedRepositories, budget, readiness } = input;
    const step = (id: StepId) => this.steps.steps.find(entry => entry.id === id)!;
    const repositories = connections?.repositories ?? [];
    const boards = connections?.boards ?? [];
    const sources = this.config.taskSources ?? [];
    const forges = [...new Set(repositories.map(repository => repository.forge))];
    const pair = this.steps.pair;
    const otherForges = forges.filter(forge => forge !== pair.forge);
    const action = (value: ChecklistAction): ChecklistAction | undefined => manage ? value : undefined;
    const readOnly = manage ? {} : { fix: askAdmin };
    const own = this.stepLines?.(manage, { otherForges, user }) ?? {};
    const notServed = (id: StepId, title: string, configEntry: string, extra = ''): ChecklistLine => {
      const record = step(id);
      const known = served[id];
      if (known === true && own[id]) return own[id];
      if (known === null) return { id, stage: record.stage, title, status: 'unknown', text: `Ploeg could not be asked whether it serves this step.${extra}`, fix: manage ? 'Check again in a minute.' : askAdmin, action: action({ label: 'Check again', kind: 'refresh' }) };
      const text = known ? `This Ploeg serves the step; Unfold adds its screen in a later release.${extra}` : `${unavailableText(record, this.pinned)}${extra}`;
      return { id, stage: record.stage, title, status: 'unavailable', text, reason: known ? 'unfold_step_pending' : 'ploeg_step_unavailable', waitsFor: { record: known ? 'a later Unfold release' : record.record, release: known ? null : record.release }, configEntry, fix: manage ? 'Until then, add it to the configuration the person who installed Ploeg and Unfold keeps.' : askAdmin, action: action({ label: 'Show the configuration entry', kind: 'config-entry' }) };
    };

    const installation = this.installationLines({ connections, teams, state, manage });
    const installStatus: LineStatus = installation.some(line => line.status === 'problem') ? 'problem' : installation.some(line => line.status === 'unknown') ? 'unknown' : 'ok';
    const lines: ChecklistLine[] = [
      { id: 'sign-in', stage: 0, title: 'Sign in', status: 'ok', text: 'You are signed in through this installation’s sign-in.' },
      { id: 'installation', stage: 1, title: 'Installation', status: installStatus, text: installStatus === 'ok' ? 'Every install value Unfold can read is set.' : installStatus === 'problem' ? 'An install value is missing. The person who installed Unfold and Ploeg sets it.' : 'Ploeg does not report every install value; the first step that needs one tells.', checks: installation, ...(manage ? { action: { label: 'Show the install values', kind: 'install-values' as const } } : readOnly) },
    ];

    const secondForge = otherForges.length && !secondForgeOpen(this.steps, this.pinned) ? ` This installation pushes to ${list(otherForges)}. Adding ${pair.forgeName} needs Ploeg ${this.steps.secondForge.release ?? `with ${this.steps.secondForge.record}, not released yet`}.` : '';
    const github = repositories.filter(repository => repository.forge === pair.forge);
    lines.push(github.length
      ? { id: 'connect-github', stage: 2, title: 'Connect GitHub', status: 'ok', configured: true, text: `Configured by the installation: Ploeg pushes to ${pair.forgeName} for ${github.length === 1 ? '1 repository' : `${github.length} repositories`}.` }
      : notServed('connect-github', 'Connect GitHub', 'Ploeg: a GitHub forge with its App id and private key (Connect GitHub as a forge in Ploeg’s docs).', secondForge));

    const notReady = repositories.filter(repository => repository.readiness === 'not_ready');
    const count = (n: number) => n === 1 ? '1 repository' : `${n} repositories`;
    const activeStored = storedRepositories.filter(entry => entry.state === 'active');
    const offStored = storedRepositories.filter(entry => entry.state === 'off');
    const shadowedStored = storedRepositories.filter(entry => entry.state === 'shadowed');
    const storedText = [
      activeStored.length ? `${count(activeStored.length)} added in Unfold: ${list(activeStored.map(entry => entry.name))}.` : '',
      offStored.length ? `${count(offStored.length)} added in Unfold ${offStored.length === 1 ? 'is' : 'are'} not in use while the repositories.stored flag is off: ${list(offStored.map(entry => entry.name))}.` : '',
      shadowedStored.length ? `${count(shadowedStored.length)} added in Unfold ${shadowedStored.length === 1 ? 'is' : 'are'} hidden by the configuration: ${list(shadowedStored.map(entry => entry.name))}.` : '',
    ].filter(Boolean).join(' ');
    const register = repositories.length
      ? { id: 'register-repositories', stage: 3, title: 'Register repositories', status: 'ok' as const, configured: true, text: `Configured by the installation: ${count(repositories.length)}, listed below.${storedText ? ` ${storedText}` : ''}` }
      : notServed('register-repositories', 'Register repositories', 'Ploeg: a targets entry per repository. Unfold: a repositories[] entry with the same owner/name.', storedText ? ` ${storedText} Ploeg does not know ${storedRepositories.length === 1 ? 'it' : 'them'} until it registers repositories at runtime.` : '');
    lines.push(offStored.length && register.status === 'ok' ? { ...register, status: 'warning' as const, fix: manage ? 'Turn on the repositories.stored feature flag to use the repositories added in Unfold.' : askAdmin } : register);

    const clickup = boards.filter(board => board.tracker === pair.tracker);
    lines.push(clickup.length
      ? { id: 'connect-clickup', stage: 4, title: 'Connect ClickUp', status: 'ok', configured: true, text: `Configured by the installation: Ploeg routes ${clickup.length === 1 ? `1 ${pair.trackerName} List` : `${clickup.length} ${pair.trackerName} Lists`}.` }
      : notServed('connect-clickup', 'Connect ClickUp', 'Ploeg: trackers.clickup with the Unfold member’s token from the environment and the member in trackers.clickup.agents.'));

    lines.push(sources.length
      ? { id: 'pick-lists', stage: 5, title: 'Pick Lists', status: 'ok', configured: true, text: `${sources.length === 1 ? '1 task source shows' : `${sources.length} task sources show`} in Tasks.` }
      : { id: 'pick-lists', stage: 5, title: 'Pick Lists', status: 'pending', text: 'No List or board shows in Tasks yet.', fix: manage ? 'Pick a board by name, check that Unfold can read it, and save it.' : askAdmin, action: action({ label: 'Connect a tracker', href: '#settings/task-setup', kind: 'link' }) });

    lines.push(this.budgetLine(teams, budget, manage, Boolean(connections?.demo)));

    const manualPrepare = connections?.demo
      ? { id: 'prepare-repository', stage: 7, title: 'Prepare a repository', status: 'pending' as const, text: 'Demo · no readiness pull request opens, no Run starts and no money is spent.' }
      : notServed('prepare-repository', 'Prepare a repository', 'Add an AGENTS.md at the root of the repository’s base branch by hand.', notReady.length ? ` ${list(notReady.map(repository => `${repository.owner}/${repository.repo}`))} ${notReady.length === 1 ? 'needs' : 'need'} one.` : '');
    lines.push(readiness?.prepare ?? manualPrepare);

    lines.push(readiness?.review ?? (!repositories.length
      ? { id: 'review-and-merge', stage: 8, title: 'Review and merge', status: 'pending', text: 'Waits for a registered repository.' }
      : notReady.length
        ? { id: 'review-and-merge', stage: 8, title: 'Review and merge', status: 'problem', text: `${list(notReady.map(repository => `${repository.owner}/${repository.repo}`))} ${notReady.length === 1 ? 'is' : 'are'} not ready, so Ploeg refuses work routed there.`, fix: manage ? 'Add an AGENTS.md at the root of the base branch. Ploeg checks again on the next task.' : askAdmin, action: action({ label: 'Check again', kind: 'refresh' }) }
        : { id: 'review-and-merge', stage: 8, title: 'Review and merge', status: 'ok', configured: true, text: 'Every repository Ploeg routes to is ready for agents.' }));

    const prepared = readiness?.bindable.length ? ` Ready for a List now that its readiness pull request merged: ${list(readiness.bindable)}.` : '';
    const bind = boards.length
      ? { id: 'bind-lists', stage: 9, title: 'Bind Lists', status: 'ok' as const, configured: true, text: `Configured by the installation: Ploeg routes ${boards.length === 1 ? '1 board' : `${boards.length} boards`}, listed below.${prepared}` }
      : notServed('bind-lists', 'Bind Lists', 'Ploeg: trackers.<tracker>.projects with the List, its Team and its repository. Unfold: a taskSources entry with the same List and its ploeg target.', prepared);
    lines.push(prepared && !bind.text.includes(prepared) ? { ...bind, text: `${bind.text}${prepared}` } : bind);

    lines.push(notServed('connect-claude', 'Connect Claude', 'Ploeg: carrier: routine on the Team’s claude-environment Role, PLOEG_CLAUDE_ROUTINES and the credential gateway (Ploeg ADR-0197). Until then the Team runs on unattended: api.'));
    lines.push({ id: 'first-task', stage: 10, title: 'First task', status: 'pending', text: 'Assign a task in a routed board to the Team’s tracker user, or hand one off from Tasks.', ...(manage || sources.length ? { action: { label: 'Open Tasks', href: '#tasks', kind: 'link' as const } } : {}) });
    lines.push({ id: 'first-pull-request', stage: 11, title: 'First pull request', status: 'pending', text: 'Nothing to do: Now shows the Work Item moving until its Run opens a pull request.' });
    return lines;
  }

  private installationLines(input: { connections: PloegConnections | null; teams: PloegTeam[] | null; state: StepState; manage: boolean }): ChecklistLine[] {
    const { connections, teams, state, manage } = input;
    const ask = manage ? 'Hand the install value to the person who installed Unfold and Ploeg.' : askAdmin;
    const lines: ChecklistLine[] = [];
    if (teams === null) lines.push({ id: 'install-team', stage: 1, title: 'A Team exists', status: 'unknown', text: 'Ploeg’s Teams could not be read.', fix: manage ? 'Check again in a minute.' : askAdmin });
    else if (!teams.length) lines.push({ id: 'install-team', stage: 1, title: 'A Team exists', status: 'problem', text: 'Ploeg has no Team. Teams are set by the person installing Ploeg, and repositories and Lists need one.', install: installValues[0].value, fix: ask });
    else lines.push({ id: 'install-team', stage: 1, title: 'A Team exists', status: 'ok', text: `${list(teams.map(team => team.id))}.` });

    const uncapped = (teams ?? []).filter(team => team.spendCap === null);
    const unreported = (teams ?? []).filter(team => team.spendCap === undefined);
    if (!teams?.length) lines.push({ id: 'install-spend-cap', stage: 1, title: 'The Team has a spend cap', status: teams === null ? 'unknown' : 'pending', text: 'Needs a Team first.' });
    else if (uncapped.length) lines.push({ id: 'install-spend-cap', stage: 1, title: 'The Team has a spend cap', status: 'problem', text: `${list(uncapped.map(team => team.id))} ${uncapped.length === 1 ? 'has' : 'have'} no spend cap, so Unfold starts no onboarding work for ${uncapped.length === 1 ? 'it' : 'them'}.`, install: installValues[1].value, fix: manage ? 'Ask your installer to set the Team’s spend cap.' : askAdmin });
    else if (unreported.length) lines.push({ id: 'install-spend-cap', stage: 1, title: 'The Team has a spend cap', status: 'unknown', text: 'This Ploeg does not report Team spend caps.', install: installValues[1].value });
    else lines.push({ id: 'install-spend-cap', stage: 1, title: 'The Team has a spend cap', status: 'ok', text: `${list(teams.map(cap))}.` });

    const boards = connections?.boards ?? [];
    const present = boards.filter(board => board.webhook === 'present');
    const broken = boards.filter(board => board.webhook === 'missing' || board.webhook === 'unreadable');
    if (present.length) lines.push({ id: 'install-webhook', stage: 1, title: 'Webhooks reach Ploeg', status: broken.length ? 'warning' : 'ok', text: broken.length ? `${present.length} of ${boards.length} boards tell Ploeg about assignments; ${list(broken.map(board => board.name))} ${broken.length === 1 ? 'does' : 'do'} not.` : `Every board Ploeg checks tells it about assignments.`, ...(broken.length ? { fix: manage ? 'See the board below for its fix.' : askAdmin } : {}) });
    else if (broken.length) lines.push({ id: 'install-webhook', stage: 1, title: 'Webhooks reach Ploeg', status: 'problem', text: 'No board tells Ploeg about assignments, so assigning a task to a Team starts nothing.', install: installValues[9].value, fix: ask });
    else lines.push({ id: 'install-webhook', stage: 1, title: 'Webhooks reach Ploeg', status: 'unknown', text: connections === null ? 'Ploeg’s connections could not be read.' : 'No board Ploeg checks yet; the first bound List tells.', install: installValues[9].value });

    for (const [code, refusal] of Object.entries(optInRefusals) as [OptInRefusal, typeof optInRefusals[OptInRefusal]][]) {
      lines.push(state.optIn.includes(code)
        ? { id: refusal.id, stage: 1, title: refusal.title, status: 'problem', reason: code, text: `Ploeg serves this step, but the installation has not opted in (${code}). The person who installed Ploeg sets it.`, install: refusal.value, fix: ask }
        : { id: refusal.id, stage: 1, title: refusal.title, status: 'unknown', text: 'Ploeg does not report this; the first step that needs it tells.', install: refusal.value });
    }
    return lines;
  }

  private budgetLine(teams: PloegTeam[] | null, budget: TeamBudget[], manage: boolean, demo: boolean): ChecklistLine {
    const base = { id: 'budget', stage: 6, title: 'Budget' };
    if (demo) return { ...base, status: 'pending', text: 'Demo · no Run starts and no money is spent, so there is no spend cap to confirm.' };
    if (teams === null) return { ...base, status: 'unknown', text: 'Ploeg’s Teams could not be read.' };
    if (!teams.length) return { ...base, status: 'pending', text: 'Needs a Team first.' };
    const uncapped = budget.filter(entry => entry.spendCap === null).map(entry => entry.team);
    const capped = budget.filter(entry => entry.spendCap);
    const confirmed = capped.filter(entry => entry.confirmed);
    const open = capped.filter(entry => !entry.confirmed);
    const changed = open.filter(entry => entry.changed);
    const confirmAction: ChecklistAction | undefined = manage && open.length ? { label: 'Confirm the spend cap', kind: 'confirm-cap' } : undefined;
    const parts = [
      ...confirmed.map(entry => `${entry.team}: ${amount(entry.confirmed!)}, confirmed${confirmedBy(entry.confirmed!)}.`),
      ...open.map(entry => entry.changed ? `${entry.team}: ${amount(entry.spendCap!)} now; ${amount(entry.changed)} was confirmed${confirmedBy(entry.changed)}.` : `${entry.team}: ${amount(entry.spendCap!)}, not confirmed yet.`),
      uncapped.length ? `${list(uncapped)} ${uncapped.length === 1 ? 'has' : 'have'} no spend cap, so Unfold starts no readiness work for ${uncapped.length === 1 ? 'it' : 'them'} and binds no List to ${uncapped.length === 1 ? 'it' : 'them'} during onboarding.` : '',
      !capped.length && !uncapped.length ? 'This Ploeg does not report Team spend caps, so Unfold cannot show one to confirm.' : '',
    ].filter(Boolean);
    const text = parts.join(' ');
    if (!capped.length && uncapped.length) return { ...base, status: 'problem', reason: 'budget_missing', text, fix: manage ? 'Ask your installer to set the Team’s spend cap.' : askAdmin };
    if (!capped.length) return { ...base, status: 'unknown', text };
    if (confirmed.length) return { ...base, status: changed.length || uncapped.length ? 'warning' : 'ok', text, ...(changed.length || uncapped.length ? { fix: manage ? changed.length ? 'Confirm the cap Ploeg reports now.' : 'Ask your installer to set the spend cap of the Teams without one.' : askAdmin } : {}), ...(confirmAction ? { action: confirmAction } : {}) };
    return { ...base, status: 'pending', text, fix: manage ? 'Confirm the spend cap before the first paid step. Ploeg starts no Run that would take the Team’s spend this period over it.' : askAdmin, ...(confirmAction ? { action: confirmAction } : {}) };
  }

  private track(user: User, state: StepState, stages: ChecklistLine[]): void {
    if (!state.startedAt) return;
    const lines = stages.flatMap(line => [line, ...(line.checks ?? [])]).filter(line => !line.id.includes(':'));
    const seconds = Math.max(0, Math.round((this.now().getTime() - Date.parse(state.startedAt)) / 1000));
    const events: [string, Record<string, string | number | boolean>][] = [];
    for (const line of lines) {
      const before = state.lines[line.id];
      if (line.status === 'ok' && !state.completed.includes(line.id)) { state.completed.push(line.id); events.push(['onboarding.step_completed', { step: line.id, seconds }]); }
      if (line.status === 'problem' && before !== 'problem') events.push(['onboarding.step_failed', { step: line.id, code: line.reason ?? 'check_failed' }]);
      if (line.status === 'unavailable' && line.reason === 'ploeg_step_unavailable') {
        const key = `${line.id}@${line.waitsFor?.release ?? 'unreleased'}`;
        if (!state.refused.includes(key)) { state.refused.push(key); events.push(['onboarding.step_refused', { step: line.id, release: line.waitsFor?.release ?? 'unreleased', reason: 'not_served' }]); }
      }
      state.lines[line.id] = line.status;
    }
    this.write(state);
    for (const [name, props] of events) this.record(user, name, props);
  }

  private refused(user: User, step: string, release: string, reason: string): void {
    const state = this.read();
    const key = `${step}@${release}${reason === 'not_served' ? '' : `:${reason}`}`;
    if (!state.startedAt || state.refused.includes(key)) return;
    state.refused.push(key);
    this.write(state);
    this.record(user, 'onboarding.step_refused', { step, release, reason });
  }

  private record(user: User, name: string, props: Record<string, string | number | boolean>): void {
    if (this.config.productEvents === false || !this.insight) return;
    try { this.insight.ingest([{ name, at: this.now().toISOString(), session: '', screen: '', props }], user); }
    catch (error) { console.error(JSON.stringify({ level: 'warn', event: 'onboarding.event_dropped', name, message: String((error as Error)?.message ?? error).slice(0, 200) })); }
  }

  private read(): StepState {
    const stored = this.store.getSecret<Partial<StepState>>(stateId(defaultTenant));
    return { lines: {}, completed: [], refused: [], optIn: [], ...(stored && typeof stored === 'object' ? stored : {}) };
  }

  private write(state: StepState): void { this.store.setSecret(stateId(defaultTenant), state); }
}

function budgetOf(team: PloegTeam, state: StepState, manage: boolean): TeamBudget {
  const held = state.caps?.[team.id];
  const shown = held ? (manage ? held : { team: held.team, usd: held.usd, period: held.period, at: held.at }) : null;
  const confirmed = matches(held, team.spendCap) ? shown : null;
  return { team: team.id, ...(team.spendCap === undefined ? {} : { spendCap: team.spendCap }), confirmed, changed: !confirmed && team.spendCap ? shown : null, bindable: team.spendCap !== null };
}

/** "This Ploeg does not … yet (Unfold is built against Ploeg `<pinned>`). Ploeg `<release>` adds it." for a step Ploeg does not serve. */
export function unavailableText(step: PloegStep, pinned: string): string {
  const what: Record<StepId, string> = {
    'connect-github': 'connect GitHub from the screen',
    'connect-gitlab': 'connect GitLab from the screen',
    'connect-gitlab-service-account': 'create a GitLab service account from a temporary Owner token',
    'register-repositories': 'register repositories at runtime',
    'connect-clickup': 'connect ClickUp from the screen',
    'read-scopes': 'list a tracker connection’s Lists for Unfold',
    'prepare-repository': 'open a readiness pull request',
    'bind-lists': 'bind Lists to a Team at runtime',
    'connect-claude': 'start Runs through your own Claude routine',
  };
  return `This Ploeg does not ${what[step.id]} yet (Unfold is built against Ploeg ${pinned}). ${step.release ? `Ploeg ${step.release} adds it.` : `It waits for ${step.record}, not released yet.`}`;
}
