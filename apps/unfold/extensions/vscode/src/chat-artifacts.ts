import type * as vscode from 'vscode';
import type { Core } from './core.js';
import { answered, carryOutAction, confirmationKey, failure, fallbackReason, OfferedConfirmations, planAction, workLink, type ActionContext, type LmActionToolName, type ToolActor } from './lm-tools.ts';
import type { PloegDetail, PloegNow } from './ploeg-types.js';
import type { ProposalGuard } from './proposals.js';

export const artifactProviderId = 'unfold.workItems';
export const artifactRefreshMs = 60_000;

export type ArtifactActionId = 'approve' | 'retry' | 'handBack';

export type ArtifactActionSpec = { id: ArtifactActionId; label: string; icon: string; tool: LmActionToolName; button: string };

export const artifactActions: readonly ArtifactActionSpec[] = [
  { id: 'approve', label: 'Approve', icon: 'check', tool: 'unfold_approve_work', button: 'Approve' },
  { id: 'retry', label: 'Try again', icon: 'debug-restart', tool: 'unfold_retry_work', button: 'Try Again' },
  { id: 'handBack', label: 'Hand back', icon: 'debug-continue', tool: 'unfold_hand_back', button: 'Hand Back' },
];

const workItemPath = /^(?:work|ploeg)\/([1-9][0-9]{0,18})$/;
const pullRequestPath = /^(.*\/(?:pulls?|merge_requests)\/[1-9][0-9]{0,11})(?:\/.*)?$/;

function parsed(link: string): URL | undefined {
  try {
    const url = new URL(link);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url : undefined;
  } catch { return undefined; }
}

export function workItemFromLink(link: string, origin: string): string | undefined {
  const url = parsed(link);
  if (!url || url.origin !== origin || url.pathname !== '/' || url.search) return undefined;
  const hash = url.hash.replace(/^#\/?/, '');
  const query = hash.indexOf('?');
  return workItemPath.exec(query === -1 ? hash : hash.slice(0, query))?.[1];
}

export function pullRequestKey(link: string | undefined): string | undefined {
  const url = link ? parsed(link) : undefined;
  const path = url ? pullRequestPath.exec(url.pathname.replace(/\/+$/, ''))?.[1] : undefined;
  return url && path ? `${url.protocol}//${url.host}${path}`.toLowerCase() : undefined;
}

export function workItemForPullRequest(link: string, now: PloegNow | undefined): string | undefined {
  const key = pullRequestKey(link);
  if (!key) return undefined;
  return [...(now?.waiting ?? []), ...(now?.active ?? [])].find(item => pullRequestKey(item.pullRequestUrl) === key)?.id;
}

export type ArtifactTarget = { kind: 'work' | 'pull'; id: string; key: string };

export type ArtifactReader = ToolActor & { ploegNow(fresh?: boolean): Promise<PloegNow> };

export async function resolveArtifact(link: string, reader: ArtifactReader): Promise<ArtifactTarget | undefined> {
  const id = workItemFromLink(link, reader.origin);
  if (id) return { kind: 'work', id, key: `unfold:${reader.origin}:work:${id}` };
  const key = pullRequestKey(link);
  if (!key) return undefined;
  const owner = workItemForPullRequest(link, await reader.ploegNow().catch(() => undefined));
  return owner ? { kind: 'pull', id: owner, key: `unfold:${reader.origin}:pull:${key}` } : undefined;
}

type TakeOver = { takeOver?: { state?: string } | null };

export function offeredActions(detail: PloegDetail): ArtifactActionId[] {
  const state = detail.item.state;
  const offered: ArtifactActionId[] = [];
  if (state === 'proposed') offered.push('approve');
  if (state === 'needs_human' || state === 'stale') offered.push('retry');
  if (state === 'needs_human' && (detail as PloegDetail & TakeOver).takeOver?.state === 'taken_over') offered.push('handBack');
  return offered;
}

const stateIcons: Record<string, string> = { proposed: 'lightbulb', ingested: 'inbox', queued: 'layers', leased: 'pulse', active: 'pulse', awaiting_review: 'git-pull-request', needs_human: 'bell-dot', stale: 'warning', withdrawn: 'circle-slash', done: 'pass' };
const statePriority: Record<string, number> = { needs_human: 50, stale: 45, awaiting_review: 40, proposed: 30, leased: 20, active: 20, queued: 10 };

export function spendText(core: Core, detail: PloegDetail): string {
  if (detail.demo) return 'Illustrative demo: no model calls and nothing spent';
  const shifts = detail.shifts ?? [];
  if (!shifts.length) return 'Nothing spent yet: no Shift opened';
  const spent = shifts.reduce((sum, shift) => sum + (Number(shift.spentUsd) || 0), 0);
  const open = shifts.find(shift => !shift.closedAt);
  return open ? `${core.money(spent)} spent, Round ${open.round} may spend up to ${core.money(open.budgetUsd)}` : `${core.money(spent)} spent over ${shifts.length === 1 ? '1 Shift' : `${shifts.length} Shifts`}`;
}

export function pullRequestOf(detail: PloegDetail): string {
  const fromItem = (detail.item as { pullRequestUrl?: string }).pullRequestUrl;
  return fromItem || [...(detail.checkpoints ?? [])].reverse().find(entry => entry.prUrl)?.prUrl || '';
}

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

export type ArtifactView = {
  id: string; state: string; stateLabel: string; icon: string; priority: number; pillLabel: string; label: string; description: string;
  waitsOn: string; why: string; spent: string; team: string; page: string; pullRequest: string; actions: ArtifactActionId[]; demo: boolean;
};

export function artifactView(core: Core, detail: PloegDetail, origin: string): ArtifactView {
  const item = detail.item;
  const meta = core.workItemState(item.state);
  const reason = core.detailReason(detail) ?? fallbackReason(item.state);
  const waitsOn = reason ? reason.chip : 'Nothing from you';
  const why = reason ? `${reason.sentence} ${reason.action}` : meta.description ?? meta.label;
  const spent = spendText(core, detail);
  return {
    id: item.id, state: item.state, stateLabel: meta.label, icon: stateIcons[item.state] ?? 'circle-outline', priority: statePriority[item.state] ?? 0,
    pillLabel: `Work Item ${item.id}`, label: oneLine(`Work Item ${item.id}: ${item.title || meta.label}`),
    description: `${meta.label} · ${spent} · Waits on: ${waitsOn}`,
    waitsOn, why, spent, team: item.team, page: workLink(origin, item.id), pullRequest: pullRequestOf(detail), actions: offeredActions(detail), demo: Boolean(detail.demo),
  };
}

export const mainDetails = 'main';

export function artifactState(view: ArtifactView, icon: (id: string) => vscode.ThemeIcon): vscode.ChatArtifactIntegrationState {
  return {
    availability: { kind: 'available' },
    main: { label: view.label, pillLabel: view.pillLabel, icon: icon(view.icon), description: view.description, detailsId: mainDetails },
    groupId: 'unfold.workItems',
    group: { icon: icon(view.icon), priority: view.priority },
    stateActions: view.actions.map(id => ({ id, enabled: true })),
  };
}

export function artifactDetails(view: ArtifactView, link: (url: string) => vscode.Uri, icon: (id: string) => vscode.ThemeIcon): vscode.ChatArtifactDetails {
  const facts = [
    { id: 'state', label: 'State', value: view.stateLabel },
    { id: 'waits', label: 'Waits on', value: view.waitsOn },
    { id: 'spent', label: 'Spent', value: view.spent },
    { id: 'team', label: 'Team', value: view.team },
  ];
  const items = [{ id: 'page', icon: icon('link-external'), label: 'Open in Unfold', resource: link(view.page) }];
  if (view.pullRequest && parsed(view.pullRequest)) items.push({ id: 'pullRequest', icon: icon('git-pull-request'), label: 'Open the pull request', resource: link(view.pullRequest) });
  return { title: view.label, description: view.why, availability: { kind: 'available' }, facts, actions: view.actions, items, completeness: 'complete' };
}

export type Confirm = (title: string, message: string, button: string) => Promise<boolean>;
export type ArtifactActionResult = { kind: 'completed'; summary: string } | { kind: 'skipped'; reason: string };

export const noAutomation = 'Unfold changes a Work Item only after a person confirms it, so it runs no action automatically. Nothing was changed.';

export async function prepareArtifactAction(spec: ArtifactActionSpec, workItemId: string, source: 'manual' | 'automation', context: ActionContext): Promise<{ kind: 'ready' } | { kind: 'skipped'; reason: string }> {
  if (source !== 'manual') return { kind: 'skipped', reason: noAutomation };
  const plan = await planAction(spec.tool, { id: workItemId }, context);
  return plan.kind === 'refusal' ? { kind: 'skipped', reason: plan.text } : { kind: 'ready' };
}

export async function runArtifactAction(spec: ArtifactActionSpec, workItemId: string, source: 'manual' | 'automation', context: ActionContext, confirm: Confirm, token?: { readonly isCancellationRequested: boolean }): Promise<ArtifactActionResult> {
  if (source !== 'manual') return { kind: 'skipped', reason: noAutomation };
  const input = { id: workItemId };
  const plan = await planAction(spec.tool, input, context);
  if (plan.kind === 'refusal') return { kind: 'skipped', reason: plan.text };
  if (!await confirm(plan.title, plan.message, spec.button)) return { kind: 'skipped', reason: 'You did not confirm, so nothing was changed.' };
  const offered = new OfferedConfirmations();
  offered.offer(confirmationKey(spec.tool, input), plan.message, context.now?.());
  const outcome = await carryOutAction(spec.tool, input, context, offered, token);
  if (outcome.kind === 'done') return { kind: 'completed', summary: outcome.text };
  if (outcome.kind === 'not-done') return { kind: 'skipped', reason: outcome.text };
  throw new Error(outcome.text);
}

export type ArtifactHost = Pick<typeof vscode, 'ThemeIcon' | 'Uri' | 'EventEmitter' | 'chat' | 'commands' | 'window' | 'workspace'>;

export type ArtifactDeps = {
  core: Core;
  reader(): ArtifactReader | undefined;
  configurationError(): Error | undefined;
  signedIn(): Promise<boolean>;
  secrets: Pick<vscode.SecretStorage, 'onDidChange'>;
};

function actionContext(deps: ArtifactDeps): ActionContext {
  return { core: deps.core, actor: deps.reader(), configurationError: deps.configurationError(), signedIn: deps.signedIn };
}

class WorkItemObservation implements vscode.ChatArtifactIntegration {
  state: vscode.ChatArtifactIntegrationState = { availability: { kind: 'loading' } };
  readonly actions: vscode.ChatArtifactAction[];
  private readonly changed: vscode.EventEmitter<void>;
  readonly onDidChange: vscode.Event<void>;
  private details: vscode.ChatArtifactDetails;
  private readonly detailsChanged: vscode.EventEmitter<void>;
  private readonly timer: ReturnType<typeof setInterval>;
  private disposed = false;
  private readonly host: ArtifactHost;
  private readonly deps: ArtifactDeps;
  private readonly id: string;

  constructor(host: ArtifactHost, deps: ArtifactDeps, id: string) {
    this.host = host;
    this.deps = deps;
    this.id = id;
    this.changed = new host.EventEmitter<void>();
    this.onDidChange = this.changed.event;
    this.detailsChanged = new host.EventEmitter<void>();
    this.details = { title: `Work Item ${id}`, availability: { kind: 'loading' } };
    this.actions = artifactActions.map(spec => this.codeAction(spec));
    this.timer = setInterval(() => void this.load(), artifactRefreshMs);
  }

  async load(fresh = false): Promise<void> {
    const icon = (name: string) => new this.host.ThemeIcon(name);
    const reader = this.deps.reader();
    try {
      if (!reader) throw this.deps.configurationError() ?? new Error('The Unfold server URL setting is invalid.');
      const view = artifactView(this.deps.core, await reader.workItem(this.id, fresh), reader.origin);
      this.state = artifactState(view, icon);
      this.details = artifactDetails(view, url => this.host.Uri.parse(url, true), icon);
    } catch (error) {
      const reason = reader ? failure(error, this.id, reader.origin) : String((error as Error).message);
      const availability: vscode.ChatArtifactAvailability = { kind: answered(error) && error.status === 401 ? 'authenticationRequired' : 'error', reason };
      this.state = { availability };
      this.details = { title: `Work Item ${this.id}`, availability };
    }
    if (this.disposed) return;
    this.changed.fire();
    this.detailsChanged.fire();
  }

  acquireDetails(): vscode.ChatArtifactDetailsModel {
    const observation = this;
    return { get details() { return observation.details; }, onDidChange: this.detailsChanged.event, dispose: () => undefined };
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    this.changed.dispose();
    this.detailsChanged.dispose();
  }

  private codeAction(spec: ArtifactActionSpec): vscode.ChatArtifactCodeAction {
    const confirm: Confirm = async (title, message, button) => await this.host.window.showWarningMessage(title, { modal: true, detail: message }, button) === button;
    return {
      kind: 'code', id: spec.id, label: spec.label, icon: new this.host.ThemeIcon(spec.icon), consentVersion: '1', executionScope: 'resource',
      prepare: context => prepareArtifactAction(spec, this.id, context.source, actionContext(this.deps)),
      run: async (context, token) => {
        try { return await runArtifactAction(spec, this.id, context.source, actionContext(this.deps), confirm, token); }
        finally { void this.load(true); }
      },
    };
  }
}

export function registerChatArtifacts(host: ArtifactHost, proposals: ProposalGuard, deps: ArtifactDeps): vscode.Disposable[] {
  if (!proposals.usable('chatArtifactIntegrations')) return [];
  const changed = new host.EventEmitter<void>();
  const icon = (name: string) => new host.ThemeIcon(name);
  const provider: vscode.ChatArtifactIntegrationProvider = {
    label: 'Unfold',
    description: 'Work Item links of the connected Unfold workbench, and pull requests that belong to your Work Items there.',
    groupLabel: 'Work Items',
    onDidChange: changed.event,
    match: async resource => {
      const reader = deps.reader();
      if (!reader) return undefined;
      const link = resource.toString();
      const id = workItemFromLink(link, reader.origin);
      if (id && !await deps.signedIn()) return { kind: 'authenticationRequired', reason: `Sign in to the Unfold workbench at ${reader.origin} to see Work Item ${id}.`, main: { label: `Work Item ${id}`, pillLabel: `Work Item ${id}`, icon: icon('lock'), detailsId: mainDetails } };
      if (!id && !(pullRequestKey(link) && await deps.signedIn())) return undefined;
      const target = await resolveArtifact(link, reader);
      return target ? { kind: 'matched', resource, key: target.key, credentialScope: reader.origin } : undefined;
    },
    signIn: async () => { await host.commands.executeCommand('unfold.connect'); },
    createArtifactIntegration: async resource => {
      const reader = deps.reader();
      const target = reader ? await resolveArtifact(resource.toString(), reader) : undefined;
      if (!target) return undefined;
      const observation = new WorkItemObservation(host, deps, target.id);
      await observation.load();
      return observation;
    },
  };
  const registration = proposals.use('chatArtifactIntegrations', () => host.chat.registerArtifactIntegrationProvider(artifactProviderId, provider));
  if (!registration) { changed.dispose(); return []; }
  return [
    registration,
    changed,
    deps.secrets.onDidChange(event => { if (event.key.startsWith('unfold.session:')) changed.fire(); }),
    host.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('unfold.serverUrl')) changed.fire(); }),
  ];
}
