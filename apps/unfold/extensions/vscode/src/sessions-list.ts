import * as vscode from 'vscode';
import type { Core } from './core.js';
import { takeOn, takeOnTarget, type ActionContext } from './lm-tools.js';
import { describeItem, describeSession, linkedWorkItems, nowGroup } from './now.js';
import type { ProposalGuard } from './proposals.js';
import { noInputReply, sessionsListSetting, workSessionEntries, workSessionRef, workSessionScope, workSessionType, workSessionUri, type WorkSessionEntry, type WorkSessionInput, type WorkSessionStatus } from './work-sessions.js';

export type SessionsListDeps = { core: Core; proposals: ProposalGuard; acting(): ActionContext; refresh(): Promise<void> };

/** Work in VS Code's Sessions list (`chatSessionsProvider`): proposed work to take on and, when chosen, the work that needs the person. Unfold Insiders only. */
export class SessionsList implements vscode.Disposable {
  private readonly deps: SessionsListDeps;
  private readonly disposables: vscode.Disposable[] = [];
  private controller?: vscode.ChatSessionItemController;
  private input: WorkSessionInput = { rows: [], demo: false };
  private entries: WorkSessionEntry[] = [];

  private constructor(deps: SessionsListDeps) { this.deps = deps; }

  /** Registers the list when VS Code grants `chatSessionsProvider`; undefined in the regular extension or when VS Code refuses it. */
  static register(deps: SessionsListDeps): SessionsList | undefined {
    const list = new SessionsList(deps);
    if (deps.proposals.use('chatSessionsProvider', () => list.start())) return list;
    list.dispose();
    return undefined;
  }

  private start(): true {
    const controller = vscode.chat.createChatSessionItemController(workSessionType, async () => this.paint());
    this.disposables.push(controller);
    this.controller = controller;
    controller.newChatSessionItemHandler = async context => this.startNew(context.request.prompt);
    const participant = vscode.chat.createChatParticipant(workSessionType, (request, context, stream) => this.reply(context.chatSessionContext?.chatSessionItem.resource, stream));
    this.disposables.push(participant);
    this.disposables.push(vscode.chat.registerChatSessionContentProvider(workSessionType, { provideChatSessionContent: resource => this.content(resource) }, participant));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration(`unfold.${sessionsListSetting}`)) this.paint(); }));
    return true;
  }

  /** Shows a fresh Now snapshot and session rows, as the extension's refresh reads them. */
  update(input: WorkSessionInput): void {
    this.input = input;
    this.paint();
  }

  private paint(): void {
    const controller = this.controller;
    if (!controller) return;
    this.entries = workSessionEntries(this.deps.core, { nowGroup, linkedWorkItems, describeItem, describeSession }, this.input, workSessionScope(vscode.workspace.getConfiguration('unfold').get(sessionsListSetting)));
    this.deps.proposals.use('chatSessionsProvider', () => controller.items.replace(this.entries.map(entry => this.item(controller, entry))));
  }

  private item(controller: vscode.ChatSessionItemController, entry: WorkSessionEntry): vscode.ChatSessionItem {
    const uri = workSessionUri(entry.ref);
    const item = controller.createChatSessionItem(vscode.Uri.parse(uri), entry.label);
    item.description = entry.description;
    item.tooltip = entry.tooltip;
    item.iconPath = new vscode.ThemeIcon(entry.icon);
    if (entry.badge) item.badge = entry.badge;
    if (entry.status) item.status = statusOf(entry.status);
    item.timing = { created: entry.created, lastRequestEnded: entry.updated };
    if (entry.changes.length) item.changes = entry.changes.map(change => new vscode.ChatSessionChangedFile(vscode.Uri.parse(`${uri}/files/${change.file.split('/').map(encodeURIComponent).join('/')}`), undefined, undefined, change.insertions, change.deletions));
    return item;
  }

  private content(resource: vscode.Uri): vscode.ChatSession {
    const ref = workSessionRef(resource);
    const entry = ref && this.entries.find(candidate => candidate.ref.kind === ref.kind && candidate.ref.id === ref.id);
    if (!entry?.takeOn) return { history: [], requestHandler: undefined };
    return { title: entry.label, history: [], requestHandler: (_request, _context, stream) => this.takeOnReply(entry.ref.id, stream) };
  }

  private async reply(resource: vscode.Uri | undefined, stream: vscode.ChatResponseStream): Promise<void> {
    const ref = resource && workSessionRef(resource);
    const entry = ref && this.entries.find(candidate => candidate.ref.kind === ref.kind && candidate.ref.id === ref.id);
    if (entry?.takeOn) return this.takeOnReply(entry.ref.id, stream);
    stream.markdown(noInputReply);
  }

  private async takeOnReply(id: string, stream: vscode.ChatResponseStream): Promise<void> {
    const result = await takeOn(id, this.deps.acting(), confirmModal);
    stream.markdown(result.text);
    if (result.done) void this.deps.refresh();
  }

  private async startNew(prompt: string): Promise<vscode.ChatSessionItem> {
    const controller = this.controller!;
    const id = takeOnTarget(prompt) ?? await this.pickProposed();
    if (!id) throw new Error('Nothing to take on: name a proposed Work Item, such as 184, or pick one. Unfold starts no other session from this list.');
    const proposed = this.entries.find(entry => entry.takeOn && entry.ref.id === id);
    const result = await takeOn(id, this.deps.acting(), confirmModal);
    if (!result.done) throw new Error(result.text);
    void this.deps.refresh();
    const item = controller.createChatSessionItem(vscode.Uri.parse(workSessionUri({ kind: 'work-item', id })), proposed?.label ?? `Work Item ${id}`);
    item.description = result.text;
    item.iconPath = new vscode.ThemeIcon('check');
    return item;
  }

  private async pickProposed(): Promise<string | undefined> {
    const offers = this.entries.filter(entry => entry.takeOn);
    if (!offers.length) return undefined;
    const choice = await vscode.window.showQuickPick(offers.map(entry => ({ label: entry.label, description: entry.description, id: entry.ref.id })), { title: 'Take on which proposed Work Item?', ignoreFocusOut: true });
    return choice?.id;
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.controller = undefined;
  }
}

function statusOf(status: WorkSessionStatus): vscode.ChatSessionStatus {
  if (status === 'needs-input') return vscode.ChatSessionStatus.NeedsInput;
  if (status === 'completed') return vscode.ChatSessionStatus.Completed;
  return vscode.ChatSessionStatus.Failed;
}

async function confirmModal(title: string, message: string, accept: string): Promise<boolean> {
  return await vscode.window.showWarningMessage(title, { modal: true, detail: message }, accept) === accept;
}
