import { readFileSync } from 'node:fs';
import { PloegError, type PloegConnections, type PloegTeam } from './ploeg.ts';
import { defaultTenant } from './tenancy.ts';
import type { AppConfig, InsightEvent, User } from './types.ts';

/** One onboarding step a later slice builds, with the Ploeg read route that tells whether Ploeg serves it and the release that adds it. */
export type PloegStep = { id: StepId; stage: number; record: string; read: string | null; release: string | null };
export type StepId = 'connect-github' | 'register-repositories' | 'connect-clickup' | 'prepare-repository' | 'bind-lists';
/** `src/ploeg-steps.json`: the forge and tracker the onboarding connects first (decision D4), the steps of the onboarding checklist that need a Ploeg route, and the release that ships Ploeg ADR-0192 for the second-forge gate. */
export type PloegSteps = { schemaVersion: 1; pinnedBundle: string; pair: { forge: string; forgeName: string; tracker: string; trackerName: string }; steps: PloegStep[]; secondForge: { record: string; release: string | null } };

export const ploegStepsUrl = new URL('./ploeg-steps.json', import.meta.url);
export const ploegSteps = JSON.parse(readFileSync(ploegStepsUrl, 'utf8')) as PloegSteps;

/** The answers of a Ploeg dry run that mean the installation has not opted in to a step, with the install value that opts it in. */
export const optInRefusals = {
  registration_not_accepted: { id: 'install-registration', title: 'Ploeg accepts repositories from the screen', value: 'targetRegistration.enabled: true, with targetRegistration.connections naming the GitHub connection and targetRegistration.requireClaims' },
  bindings_not_accepted: { id: 'install-bindings', title: 'The Team accepts Lists from the screen', value: 'teams.<team>.trackerBindings.connections naming the ClickUp connection, and trackerBindings.max' },
  permission_required: { id: 'install-consumer', title: 'Unfold may connect, register and bind', value: 'the unfold entry in consumers[] with execute, bindScopes: true, registerTargets: true and the Team in its teams' },
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
];

/** What one checklist line says: `ok` green, `problem` red, `warning` amber, `unknown` not known yet, `pending` not started, `unavailable` refused because Ploeg does not serve the step. */
export type LineStatus = 'ok' | 'problem' | 'warning' | 'unknown' | 'pending' | 'unavailable';
export type ChecklistAction = { label: string; href?: string; kind: 'link' | 'refresh' | 'install-values' | 'config-entry' };
export type ChecklistLine = {
  id: string; stage: number; title: string; status: LineStatus; text: string;
  fix?: string; action?: ChecklistAction; install?: string; reason?: string; configured?: boolean;
  waitsFor?: { record: string; release: string | null }; configEntry?: string; checks?: ChecklistLine[];
};
/** `GET /api/onboarding`: the checklist one person reads on Settings → Connections. */
export type Checklist = {
  demo: boolean; manage: boolean; onboarding: boolean; pinnedBundle: string;
  stages: ChecklistLine[]; installValues: typeof installValues;
  connections: PloegConnections | null; reads: { connections: string | null; teams: string | null }; fetchedAt: string;
};

type StepState = { startedAt?: string; lines: Record<string, LineStatus>; completed: string[]; refused: string[]; optIn: OptInRefusal[]; firstAgent?: { at: string; kind: 'readiness' | 'task' }; firstTask?: string };
type StateStore = { getSecret<T>(id: string): T | undefined; setSecret(id: string, value: unknown): void };
type PloegReads = {
  connections(user: User, fresh?: boolean): Promise<PloegConnections>;
  routing(user: User, fresh?: boolean): Promise<{ all: PloegTeam[] }>;
  serves(user: User, route: string, fresh?: boolean): Promise<boolean | null>;
};
type Recorder = { ingest(events: InsightEvent[], user: User): number };
type Options = { store: StateStore; ploeg: PloegReads; config: Pick<AppConfig, 'repositories' | 'taskSources' | 'productEvents' | 'tenancy'>; insight?: Recorder; now?: () => Date; steps?: PloegSteps };

const stateId = (tenant: string) => `onboarding:${tenant}`;
const askAdmin = 'Ask an administrator to connect this.';
const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const cap = (team: PloegTeam) => team.spendCap ? `${team.id}: USD ${team.spendCap.usd} a ${team.spendCap.period}` : team.id;

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

  constructor(options: Options) {
    this.store = options.store; this.ploeg = options.ploeg; this.config = options.config; this.insight = options.insight;
    this.now = options.now ?? (() => new Date()); this.steps = options.steps ?? ploegSteps;
  }

  /** Whether `user` connects accounts and adds repositories and Lists: an administrator, and under `tenancy.enforce` an Admin of the Tenant. */
  manages(user: User, tenant = defaultTenant): boolean {
    if (user.role !== 'admin') return false;
    return this.config.tenancy?.enforce !== true || (user.memberships ?? []).some(held => held.kind === 'tenant' && held.tenant === tenant && held.role === 'admin');
  }

  /** Whether the Tenant has no task source and no repository at all, configured or stored. */
  empty(): boolean { return !(this.config.repositories ?? []).length && !(this.config.taskSources ?? []).length; }

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
    return { step, served: step.release !== null && compareReleases(this.steps.pinnedBundle, step.release) >= 0 };
  }

  /**
   * Admits one step that writes to Ploeg, before anything is sent: 403 for someone who does not manage the Tenant,
   * and `503 ploeg_step_unavailable` naming the release that adds it when this Ploeg does not serve the step. It
   * learns that from the step's read route or the pinned bundle, never by sending the write.
   */
  async admit(user: User, id: StepId): Promise<void> {
    if (!this.manages(user)) throw new PloegError(403, 'forbidden', 'Only an administrator connects accounts and adds repositories and Lists.');
    const { step, served } = await this.available(user, id, true);
    if (served === true) return;
    if (served === null) throw new PloegError(503, 'ploeg_unavailable', 'Ploeg could not be reached to check this step. Try again in a minute.');
    this.refused(user, step.id, step.release ?? 'unreleased', 'not_served');
    throw new PloegError(503, 'ploeg_step_unavailable', `${unavailableText(step, this.steps.pinnedBundle)} Use the configuration entry for this step instead.`);
  }

  /**
   * Notes a dry run that Ploeg refused because the installation has not opted in (`422 registration_not_accepted`,
   * `422 bindings_not_accepted`, `403 permission_required`, `403 person_claim_required`): the matching installation
   * line turns red with its install value, and `onboarding.step_refused` is recorded.
   */
  notOptedIn(user: User, step: StepId, code: OptInRefusal): void {
    const state = this.read();
    if (!state.optIn.includes(code)) { state.optIn.push(code); this.write(state); }
    this.refused(user, step, this.steps.pinnedBundle, code);
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
    const stages = this.stages({ connections, teams, served, state, manage });
    this.track(user, state, stages);
    return { demo: Boolean(connections?.demo), manage, onboarding: Boolean(state.startedAt) && this.empty(), pinnedBundle: this.steps.pinnedBundle, stages, installValues: manage ? installValues : [], connections, reads, fetchedAt: this.now().toISOString() };
  }

  private stages(input: { connections: PloegConnections | null; teams: PloegTeam[] | null; served: Record<StepId, boolean | null>; state: StepState; manage: boolean }): ChecklistLine[] {
    const { connections, teams, served, state, manage } = input;
    const step = (id: StepId) => this.steps.steps.find(entry => entry.id === id)!;
    const repositories = connections?.repositories ?? [];
    const boards = connections?.boards ?? [];
    const sources = this.config.taskSources ?? [];
    const forges = [...new Set(repositories.map(repository => repository.forge))];
    const pair = this.steps.pair;
    const otherForges = forges.filter(forge => forge !== pair.forge);
    const action = (value: ChecklistAction): ChecklistAction | undefined => manage ? value : undefined;
    const readOnly = manage ? {} : { fix: askAdmin };
    const notServed = (id: StepId, title: string, configEntry: string, extra = ''): ChecklistLine => {
      const record = step(id);
      const known = served[id];
      if (known === null) return { id, stage: record.stage, title, status: 'unknown', text: `Ploeg could not be asked whether it serves this step.${extra}`, fix: manage ? 'Check again in a minute.' : askAdmin, action: action({ label: 'Check again', kind: 'refresh' }) };
      const text = known ? `This Ploeg serves the step; Unfold adds its screen in a later release.${extra}` : `${unavailableText(record, this.steps.pinnedBundle)}${extra}`;
      return { id, stage: record.stage, title, status: 'unavailable', text, reason: known ? 'unfold_step_pending' : 'ploeg_step_unavailable', waitsFor: { record: known ? 'a later Unfold release' : record.record, release: known ? null : record.release }, configEntry, fix: manage ? 'Until then, add it to the configuration the person who installed Ploeg and Unfold keeps.' : askAdmin, action: action({ label: 'Show the configuration entry', kind: 'config-entry' }) };
    };

    const installation = this.installationLines({ connections, teams, state, manage });
    const installStatus: LineStatus = installation.some(line => line.status === 'problem') ? 'problem' : installation.some(line => line.status === 'unknown') ? 'unknown' : 'ok';
    const lines: ChecklistLine[] = [
      { id: 'sign-in', stage: 0, title: 'Sign in', status: 'ok', text: 'You are signed in through this installation’s sign-in.' },
      { id: 'installation', stage: 1, title: 'Installation', status: installStatus, text: installStatus === 'ok' ? 'Every install value Unfold can read is set.' : installStatus === 'problem' ? 'An install value is missing. The person who installed Unfold and Ploeg sets it.' : 'Ploeg does not report every install value; the first step that needs one tells.', checks: installation, ...(manage ? { action: { label: 'Show the install values', kind: 'install-values' as const } } : readOnly) },
    ];

    const secondForge = otherForges.length ? ` This installation pushes to ${list(otherForges)}. Adding ${pair.forgeName} needs Ploeg ${this.steps.secondForge.release ?? `with ${this.steps.secondForge.record}, not released yet`}.` : '';
    const github = repositories.filter(repository => repository.forge === pair.forge);
    lines.push(github.length
      ? { id: 'connect-github', stage: 2, title: 'Connect GitHub', status: 'ok', configured: true, text: `Configured by the installation: Ploeg pushes to ${pair.forgeName} for ${github.length === 1 ? '1 repository' : `${github.length} repositories`}.` }
      : notServed('connect-github', 'Connect GitHub', 'Ploeg: a GitHub forge with its App id and private key (Connect GitHub as a forge in Ploeg’s docs).', secondForge));

    const notReady = repositories.filter(repository => repository.readiness === 'not_ready');
    lines.push(repositories.length
      ? { id: 'register-repositories', stage: 3, title: 'Register repositories', status: 'ok', configured: true, text: `Configured by the installation: ${repositories.length === 1 ? '1 repository' : `${repositories.length} repositories`}, listed below.` }
      : notServed('register-repositories', 'Register repositories', 'Ploeg: a targets entry per repository. Unfold: a repositories[] entry with the same owner/name.'));

    const clickup = boards.filter(board => board.tracker === pair.tracker);
    lines.push(clickup.length
      ? { id: 'connect-clickup', stage: 4, title: 'Connect ClickUp', status: 'ok', configured: true, text: `Configured by the installation: Ploeg routes ${clickup.length === 1 ? `1 ${pair.trackerName} List` : `${clickup.length} ${pair.trackerName} Lists`}.` }
      : notServed('connect-clickup', 'Connect ClickUp', 'Ploeg: trackers.clickup with the Unfold member’s token from the environment and the member in trackers.clickup.agents.'));

    lines.push(sources.length
      ? { id: 'pick-lists', stage: 5, title: 'Pick Lists', status: 'ok', configured: true, text: `${sources.length === 1 ? '1 task source shows' : `${sources.length} task sources show`} in Tasks.` }
      : { id: 'pick-lists', stage: 5, title: 'Pick Lists', status: 'pending', text: 'No List or board shows in Tasks yet.', fix: manage ? 'Pick a board by name, check that Unfold can read it, and save it.' : askAdmin, action: action({ label: 'Connect a tracker', href: '#settings/task-setup', kind: 'link' }) });

    lines.push(this.budgetLine(teams, manage));

    lines.push(notServed('prepare-repository', 'Prepare a repository', 'Add an AGENTS.md at the root of the repository’s base branch by hand.', notReady.length ? ` ${list(notReady.map(repository => `${repository.owner}/${repository.repo}`))} ${notReady.length === 1 ? 'needs' : 'need'} one.` : ''));

    lines.push(!repositories.length
      ? { id: 'review-and-merge', stage: 8, title: 'Review and merge', status: 'pending', text: 'Waits for a registered repository.' }
      : notReady.length
        ? { id: 'review-and-merge', stage: 8, title: 'Review and merge', status: 'problem', text: `${list(notReady.map(repository => `${repository.owner}/${repository.repo}`))} ${notReady.length === 1 ? 'is' : 'are'} not ready, so Ploeg refuses work routed there.`, fix: manage ? 'Add an AGENTS.md at the root of the base branch. Ploeg checks again on the next task.' : askAdmin, action: action({ label: 'Check again', kind: 'refresh' }) }
        : { id: 'review-and-merge', stage: 8, title: 'Review and merge', status: 'ok', configured: true, text: 'Every repository Ploeg routes to is ready for agents.' });

    lines.push(boards.length
      ? { id: 'bind-lists', stage: 9, title: 'Bind Lists', status: 'ok', configured: true, text: `Configured by the installation: Ploeg routes ${boards.length === 1 ? '1 board' : `${boards.length} boards`}, listed below.` }
      : notServed('bind-lists', 'Bind Lists', 'Ploeg: trackers.<tracker>.projects with the List, its Team and its repository. Unfold: a taskSources entry with the same List and its ploeg target.'));

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

  private budgetLine(teams: PloegTeam[] | null, manage: boolean): ChecklistLine {
    const base = { id: 'budget', stage: 6, title: 'Budget' };
    if (teams === null) return { ...base, status: 'unknown', text: 'Ploeg’s Teams could not be read.' };
    if (!teams.length) return { ...base, status: 'pending', text: 'Needs a Team first.' };
    const uncapped = teams.filter(team => team.spendCap === null);
    if (uncapped.length) return { ...base, status: 'problem', text: `${list(uncapped.map(team => team.id))} ${uncapped.length === 1 ? 'has' : 'have'} no spend cap.`, fix: manage ? 'Ask your installer to set the Team’s spend cap.' : askAdmin };
    const known = teams.filter(team => team.spendCap);
    return { ...base, status: 'pending', text: `${known.length ? `${list(known.map(cap))}. ` : 'This Ploeg does not report Team spend caps. '}Confirming the cap before the first paid step comes in a later Unfold release.` };
  }

  private track(user: User, state: StepState, stages: ChecklistLine[]): void {
    if (!state.startedAt) return;
    const lines = stages.flatMap(line => [line, ...(line.checks ?? [])]);
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

/** "This Ploeg does not … yet (Unfold is built against Ploeg `<pinned>`). Ploeg `<release>` adds it." for a step Ploeg does not serve. */
export function unavailableText(step: PloegStep, pinned: string): string {
  const what: Record<StepId, string> = {
    'connect-github': 'connect GitHub from the screen',
    'register-repositories': 'register repositories at runtime',
    'connect-clickup': 'connect ClickUp from the screen',
    'prepare-repository': 'open a readiness pull request',
    'bind-lists': 'bind Lists to a Team at runtime',
  };
  return `This Ploeg does not ${what[step.id]} yet (Unfold is built against Ploeg ${pinned}). ${step.release ? `Ploeg ${step.release} adds it.` : `It waits for ${step.record}, not released yet.`}`;
}
