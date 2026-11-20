import * as vscode from 'vscode';
import type { Core } from './core.js';
import type { PloegNow } from './ploeg-types.js';
import type { ProposalGuard } from './proposals.js';
import { describeRun, describeSession, linkedWorkItems, nowGroup, type SessionRow } from './now.js';
import type { NowEntry } from './now-tree.js';
import { budgetAlarms, type NowRules, chatStatus, decisiveLabel, glanceCommands, glanceMessage, targetCommand, todaySpend, waitingOn, whatWaitsNotice, type Notice, type Severity } from './what-waits.js';

/** What Now showed after the last refresh, for the Insiders surfaces that repeat it. */
export type GlanceState = { now: PloegNow | undefined; rows: SessionRow[]; demo: boolean; message: string };

/** The status bar hover as Markdown, read when it opens, or undefined to keep the plain tooltip. */
export type HoverReader = () => Promise<string | undefined>;

export const nowRules: NowRules = { nowGroup, linkedWorkItems, describeRun, describeSession };

function decisive(entry: NowEntry): boolean {
  if (entry.kind === 'session') return entry.row.group === 'needs' || entry.row.group === 'review';
  if (entry.kind === 'item') return ['needs', 'review'].includes(nowGroup(entry.item) ?? '');
  return false;
}

function labelText(item: vscode.TreeItem): string | undefined {
  return typeof item.label === 'string' ? item.label : item.label?.label;
}

/** Now's tree with the title of each row that waits on the person in bold, when the Insiders build may use `treeItemMarkdownLabel`; Now's own tree otherwise. */
export function glanceTreeProvider(tree: vscode.TreeDataProvider<NowEntry>, proposals: ProposalGuard): vscode.TreeDataProvider<NowEntry> {
  if (!proposals.usable('treeItemMarkdownLabel')) return tree;
  return {
    onDidChangeTreeData: tree.onDidChangeTreeData,
    getChildren: entry => tree.getChildren(entry),
    getTreeItem: async entry => {
      const item = await tree.getTreeItem(entry);
      const text = labelText(item);
      if (!text || !decisive(entry)) return item;
      proposals.use('treeItemMarkdownLabel', () => { item.label = { label: new vscode.MarkdownString(decisiveLabel(text, true)) } as unknown as vscode.TreeItemLabel; });
      return item;
    },
  };
}

/** The Insiders surfaces that repeat what Now knows: the notice above the chat input, the line at the top of Now, the status bar hover and the chat status menu. Each one runs only when its proposal is usable; otherwise it does nothing. */
export class InsidersGlance implements vscode.Disposable {
  private notice?: vscode.ChatInputNotification;
  private noticeShown = '';
  private chatItem?: vscode.ChatStatusItem;

  constructor(private readonly core: Core, private readonly proposals: ProposalGuard, private readonly view: vscode.TreeView<NowEntry>, status: vscode.StatusBarItem, hover: HoverReader) {
    this.proposals.use('statusBarItemTooltip', () => { status.tooltip2 = async () => { const text = await hover(); return text === undefined ? status.tooltip : new vscode.MarkdownString(text); }; });
  }

  update(state: GlanceState) {
    const waiting = waitingOn(nowRules, state.now, state.rows);
    const demo = state.demo || Boolean(state.now?.demo);
    const spend = todaySpend(state.now, demo);
    this.paintNotice(whatWaitsNotice(waiting, budgetAlarms(state.rows), demo));
    this.proposals.use('treeViewMarkdownMessage', () => {
      const message = new vscode.MarkdownString(glanceMessage(this.core, waiting, spend, state.message));
      message.isTrusted = { enabledCommands: [...glanceCommands] };
      (this.view as unknown as vscode.TreeView2<NowEntry>).message = message;
    });
    const words = chatStatus(this.core, waiting, spend, demo);
    this.chatItem ??= this.proposals.use('chatStatusItem', () => vscode.window.createChatStatusItem('unfold.status'));
    if (this.chatItem) {
      this.chatItem.title = 'Unfold';
      this.chatItem.description = words.description;
      this.chatItem.detail = words.detail;
      this.chatItem.tooltip = words.tooltip;
      this.chatItem.show();
    }
  }

  offline() {
    this.notice?.hide();
    this.noticeShown = '';
    this.chatItem?.hide();
  }

  private paintNotice(notice: Notice | undefined) {
    if (!notice) { this.notice?.hide(); this.noticeShown = ''; return; }
    this.notice ??= this.proposals.use('chatInputNotification', () => vscode.chat.createInputNotification('unfold.whatWaits'));
    if (!this.notice) return;
    const key = JSON.stringify(notice);
    if (key === this.noticeShown) return;
    this.noticeShown = key;
    const shown = this.notice;
    const { command, arguments: args } = targetCommand(notice.action.target);
    this.proposals.use('chatInputNotification', () => {
      shown.severity = severityOf(notice.severity);
      shown.message = notice.message;
      shown.description = notice.description;
      shown.actions = [{ label: notice.action.label, commandId: command, commandArgs: args }];
      shown.dismissible = true;
      shown.autoDismissOnMessage = false;
      shown.show();
    });
  }

  dispose() {
    this.notice?.dispose();
    this.chatItem?.dispose();
  }
}

function severityOf(severity: Severity): vscode.ChatInputNotificationSeverity {
  if (severity === 'error') return vscode.ChatInputNotificationSeverity.Error;
  return severity === 'warning' ? vscode.ChatInputNotificationSeverity.Warning : vscode.ChatInputNotificationSeverity.Info;
}
