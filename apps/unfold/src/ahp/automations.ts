import type { AppConfig, User } from '../types.ts';
import { PloegClient, PloegError, type PloegTeam } from '../ploeg.ts';
import { assignmentEvent, assignmentEvents, handoffUnsupported, type TaskSourceConfig } from '../tasks.ts';
import { routedTeams, type Routing } from '../task-handoff.ts';
import { unfoldMeta } from '../unfold-keys.ts';

type Json = Record<string, any>;

/** The automation catalogue channel of AHP 0.9 and 1.0. */
export const automationsChannel = 'ahp-automations://';
/** Whether a channel is the catalogue: VS Code sends it as `URI.parse(automationsChannel).toString()`, which drops the empty authority's `//`. */
export const isAutomationsChannel = (uri: string) => uri === automationsChannel || uri === 'ahp-automations:';
/** The `InitializeResult._meta` key without which VS Code 1.141 reports a host's automations as needing an update. It declares that the host, not the client, evaluates triggers and runs automations. */
export const autonomousAutomationsMeta = 'vscode.autonomousAutomations';
/** The event-trigger type of a tracker route: Ploeg queues a Work Item when a team's tracker user is assigned to a task on the board. */
export const trackerAssignmentTrigger = 'unfold.tracker-assignment';
/** The trigger type of a bound List: Ploeg takes in the List's tasks through its tracker binding, because ClickUp sends no assignment event Ploeg routes on. */
export const trackerBindingTrigger = 'unfold.tracker-binding';

/** Why the host refuses `automation/createRequested`, `runAutomation` and every other change from a client. */
export const readOnlyReason = 'Unfold lists tracker routes but does not create, change or run automations: each run would start budgeted work that Ploeg has not authorized. Hand a tracker task to a Ploeg team from the Tasks page, or assign it in the tracker.';
const routeChangeReason = 'A tracker route is Ploeg team routing and tracker assignment. Change it in Ploeg or in the tracker, not from an agent host client.';
const removeForbiddenReason = 'Only a Tenant admin removes a List\'s binding. Ask one to remove it, here or in Connect ClickUp.';

/** What the host gives the catalogue: who is watching it, how to publish an action to one person's watching clients, and a repository's folder in the workspace picker. */
export type AutomationHost = {
  watchers(): User[];
  publish(userId: string, action: Json): void;
  workspaceFolder(repositoryId: string): string | undefined;
};

/** A ClickUp List bound to a Ploeg Team in Connect ClickUp, as the catalogue lists it. */
export type BoundList = { id: string; name: string; list: string; repositoryId: string; team: string; state: string; account: string };
/** The Lists bound in Connect ClickUp, who may remove a binding, and the removal itself: Ploeg's DELETE of the binding, audited, idempotent. */
export type BoundLists = { boundLists(): BoundList[]; manages(user: User): boolean; unbind(user: User, sourceId: string): Promise<unknown> };

type Routes = { entries: Json[]; reason?: string };
type Known = { fingerprint: string; createdAt: string; modifiedAt: string };

/** A board whose tracker-driven work Ploeg runs: a source handed to Ploeg whose tracker's assignment webhook queues Work Items. */
export function routedSources(config: AppConfig): TaskSourceConfig[] {
  return (config.taskSources ?? []).filter(source => Boolean(assignmentEvent(source)) && source.executionOwner === 'ploeg');
}

/**
 * Projects Ploeg's tracker routes as an AHP automation catalogue. One entry stands for one board and one Ploeg team a
 * person may route its tasks to; its event trigger is the tracker assignment that makes Ploeg queue a Work Item. A
 * ClickUp List bound in Connect ClickUp is one more entry, driven by its tracker binding. A Tenant admin's binding
 * entries advertise `remove`, which removes the binding in Ploeg; every other entry advertises no operations, so a
 * client can neither run nor change it, and the host advertises no `create` capability.
 */
export class TrackerAutomations {
  /** How often the catalogue is recomputed for the people watching it. */
  refreshMs = 60_000;
  private readonly config: AppConfig;
  private readonly host: AutomationHost;
  private readonly ploeg: PloegClient;
  private readonly known = new Map<string, Known>();
  private readonly published = new Map<string, Map<string, string>>();
  private timer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private again = false;
  private lists?: BoundLists;

  constructor(config: AppConfig, host: AutomationHost, ploeg = new PloegClient(config)) {
    this.config = config; this.host = host; this.ploeg = ploeg;
  }

  /** Lists the Lists bound in Connect ClickUp next to the tracker routes. */
  useBoundLists(lists: BoundLists): void { this.lists = lists; }

  /** Whether the host advertises automations: a live Ploeg operator connection and at least one board Ploeg runs or List bound to a Team. A demo advertises none. */
  get available(): boolean {
    const ploeg = this.config.ploeg;
    return Boolean(ploeg?.url && ploeg.tokenEnv && !ploeg.demo) && (routedSources(this.config).length > 0 || this.bound().length > 0);
  }

  /** `InitializeResult.automations`: the baseline catalogue only, without `create`, `schedules` or `runCancellation`. */
  capabilities(): Json { return {}; }

  /** The catalogue snapshot for one person, empty with a reason when the host advertises no automations. It also becomes the baseline later refreshes publish changes against. */
  async snapshot(user: User): Promise<Json> {
    const routes = await this.routes(user);
    this.publish(user, routes.entries);
    if (this.available) this.start();
    return { entries: routes.entries, _meta: unfoldMeta({ readOnly: true, reason: routes.reason ?? readOnlyReason }) };
  }

  /** The rejection reason for any action a client dispatches on the catalogue. */
  refuse(action: Json): string {
    return action?.type === 'automation/createRequested' ? readOnlyReason : routeChangeReason;
  }

  /** Answers the catalogue's commands. `runAutomation` is refused; there are no older runs to fetch. */
  async command(user: User, method: string, params: Json): Promise<{ result: Json } | { refused: string; code: 'permissionDenied' | 'notFound' }> {
    if (method === 'listAutomationTriggerDefinitions') return { result: { items: this.triggerDefinitions() } };
    const resource = typeof params.automation === 'string' ? params.automation : '';
    const known = (await this.routes(user)).entries.some(entry => entry.resource === resource);
    if (!known) return { refused: 'No tracker route of yours has this resource', code: 'notFound' };
    if (method === 'fetchAutomationRuns') return { result: {} };
    return { refused: readOnlyReason, code: 'permissionDenied' };
  }

  /**
   * Removes the binding behind a bound List's entry for a Tenant admin, through Connect ClickUp's own removal, and
   * returns why it refused otherwise; a refusal changes nothing. The person's own clients learn of the removal from the
   * echo of their action, and every other watcher from the refresh that follows.
   */
  async remove(user: User, resource: string): Promise<string | undefined> {
    const entries = (await this.routes(user, true)).entries;
    if (!entries.some(entry => entry.resource === resource)) return 'No tracker route of yours has this resource';
    const list = this.bound().find(entry => bindingResource(entry) === resource);
    if (!list || !this.lists) return routeChangeReason;
    if (!this.lists.manages(user)) return removeForbiddenReason;
    try { await this.lists.unbind(user, list.id); }
    catch (error) { return error instanceof Error ? error.message : 'Removing the binding failed'; }
    this.published.get(user.id)?.delete(resource);
    void this.refresh().catch(() => {});
    return undefined;
  }

  /** Recomputes every watcher's catalogue and publishes `automation/set` and `automation/removed` for what changed. A refresh asked for while one runs runs again after it. */
  async refresh(): Promise<void> {
    if (this.refreshing) { this.again = true; return; }
    this.refreshing = true;
    try {
      do {
        this.again = false;
        const watchers = new Map(this.host.watchers().map(user => [user.id, user]));
        for (const id of [...this.published.keys()]) if (!watchers.has(id)) this.published.delete(id);
        if (!watchers.size) { this.stop(); return; }
        for (const user of watchers.values()) this.publish(user, (await this.routes(user, true)).entries);
      } while (this.again);
    } finally { this.refreshing = false; }
  }

  close(): void { this.stop(); this.published.clear(); }

  private start(): void { if (!this.timer) { this.timer = setInterval(() => void this.refresh().catch(() => {}), this.refreshMs); this.timer.unref?.(); } }
  private stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = undefined; } }

  private publish(user: User, entries: Json[]): void {
    const before = this.published.get(user.id);
    const after = new Map(entries.map(entry => [entry.resource as string, JSON.stringify(entry)]));
    this.published.set(user.id, after);
    if (!before) return;
    for (const automation of entries) if (before.get(automation.resource) !== after.get(automation.resource)) this.host.publish(user.id, { type: 'automation/set', automation });
    for (const resource of before.keys()) if (!after.has(resource)) this.host.publish(user.id, { type: 'automation/removed', resource });
  }

  private bound(): BoundList[] { return this.lists?.boundLists() ?? []; }

  private async routes(user: User, fresh = false): Promise<Routes> {
    if (!this.available) return { entries: [], reason: 'This workbench has no live Ploeg connection or no board that Ploeg runs.' };
    const manages = this.lists?.manages(user) ?? false;
    const bindings = this.bound().filter(list => manages || this.ploeg.allows(user, list.team)).map(list => this.bindingEntry(list, manages));
    const tracker = await this.trackerRoutes(user, fresh);
    return { entries: [...tracker.entries, ...bindings], ...(tracker.reason && !bindings.length ? { reason: tracker.reason } : {}) };
  }

  private async trackerRoutes(user: User, fresh: boolean): Promise<Routes> {
    const sources = routedSources(this.config);
    if (!sources.length) return { entries: [] };
    let routing: Routing;
    try { routing = await this.ploeg.routing(user, fresh); }
    catch (error) { if (error instanceof PloegError) return { entries: [], reason: error.message }; throw error; }
    if (!routing.reported) return { entries: [], reason: 'This Ploeg version does not report which tracker users route work to its teams.' };
    const entries: Json[] = [];
    for (const source of sources) {
      const offer = routedTeams(routing, source, team => this.ploeg.allows(user, team));
      for (const team of offer.teams) entries.push(this.entry(source, team, offer.pinned === team.id));
    }
    return { entries };
  }

  private stamped(resource: string, definition: Json): Known {
    const fingerprint = JSON.stringify(definition);
    const now = new Date().toISOString();
    const known = this.known.get(resource);
    const stamp = !known ? { fingerprint, createdAt: now, modifiedAt: now } : known.fingerprint === fingerprint ? known : { ...known, fingerprint, modifiedAt: now };
    this.known.set(resource, stamp);
    return stamp;
  }

  private bindingEntry(list: BoundList, removable: boolean): Json {
    const resource = bindingResource(list);
    const folder = this.host.workspaceFolder(list.repositoryId);
    const member = list.account || 'the Unfold member';
    const waiting = list.state === 'active' ? '' : ` Ploeg reports the binding ${list.state.replaceAll('_', ' ')}, so tasks may not arrive yet; Connect ClickUp shows why.`;
    const definition = {
      title: `${list.name} → ${list.team}`,
      message: { text: `Ploeg holds a binding of the ClickUp List ${list.name} to Ploeg team ${list.team} and takes in the List's tasks assigned to ${member}, each as a Work Item. The binding drives this intake, not an assignment event, because ClickUp sends none that Ploeg routes on. Ploeg authorizes, budgets and runs each Work Item, and nothing here starts work.${waiting}`, origin: { kind: 'automation' } },
      session: { provider: 'unfold', ...(folder ? { workingDirectories: [folder] } : {}) },
      enabled: true,
      triggers: [{ id: 'tracker-binding', kind: 'event', type: trackerBindingTrigger, title: 'Tracker binding', description: 'Ploeg takes in a task of this List through its tracker binding.', events: [{ id: 'tracker-binding', title: `Assigned to ${member}` }], config: { source: list.id, list: list.list, team: list.team } }],
      _meta: unfoldMeta({ kind: 'trackerBinding', source: list.id, list: list.list, team: list.team, state: list.state }),
    };
    const stamp = this.stamped(resource, definition);
    return { resource, definition, runs: [], operations: removable ? ['remove'] : [], createdAt: stamp.createdAt, modifiedAt: stamp.modifiedAt };
  }

  private entry(source: TaskSourceConfig, team: PloegTeam, pinned: boolean): Json {
    const resource = `ahp-automation:/tracker.${encodeURIComponent(source.id)}.${encodeURIComponent(team.id)}`;
    const assignee = team.assignees[0];
    const folder = this.host.workspaceFolder(source.repositoryId);
    const handoff = !handoffUnsupported(source, this.config.ploeg);
    const definition = {
      title: `${source.name} → ${team.id}`,
      message: { text: `Tasks on ${source.name} assigned to ${assignee} become Work Items for Ploeg team ${team.id}. Ploeg authorizes, budgets and runs each one, and nothing here starts work. ${handoff ? `Hand a task over from Unfold's Tasks page, or assign it to ${assignee} in the tracker.` : `Assign a task to ${assignee} in the tracker.`}`, origin: { kind: 'automation' } },
      session: { provider: 'unfold', ...(folder ? { workingDirectories: [folder] } : {}) },
      enabled: true,
      triggers: [{ id: 'tracker-assignment', kind: 'event', type: trackerAssignmentTrigger, title: 'Tracker assignment', description: 'Ploeg queues a Work Item when its tracker user is assigned to a task on this board.', events: [{ id: assignmentEvent(source)!, title: `Assigned to ${assignee}` }], config: { source: source.id, team: team.id, assignee } }],
      _meta: unfoldMeta({ kind: 'trackerRoute', source: source.id, team: team.id, assignee, pinned, handoff }),
    };
    const stamp = this.stamped(resource, definition);
    return { resource, definition, runs: [], operations: [], createdAt: stamp.createdAt, modifiedAt: stamp.modifiedAt, _meta: unfoldMeta({ queueDepth: team.queueDepth, paused: team.paused }) };
  }

  private triggerDefinitions(): Json[] {
    const assignment = { type: trackerAssignmentTrigger, title: 'Tracker assignment', description: 'Ploeg queues a Work Item when a team\'s tracker user is assigned to a task on a board it runs. Unfold lists these routes; it does not create them.', events: assignmentEvents().map(id => ({ id, title: 'Task assigned to the team\'s tracker user' })) };
    const binding = { type: trackerBindingTrigger, title: 'Tracker binding', description: 'Ploeg takes in a task of a ClickUp List bound to a Team in Connect ClickUp. Unfold lists these bindings and lets a Tenant admin remove one; it creates none here.', events: [{ id: 'tracker-binding', title: 'Task taken in through the binding' }] };
    return this.bound().length ? [assignment, binding] : [assignment];
  }
}

const bindingResource = (list: BoundList) => `ahp-automation:/binding.${encodeURIComponent(list.id)}`;
