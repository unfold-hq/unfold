export const extensionId = 'unfold-hq.unfold-workbench';
export const insidersExtensionId = 'unfold-hq.unfold-workbench-insiders';

export const insidersProposals = [
  'chatSessionsProvider',
  'chatArtifactIntegrations',
  'chatInputNotification',
  'treeViewMarkdownMessage',
  'treeItemMarkdownLabel',
  'statusBarItemTooltip',
  'chatStatusItem',
  'remoteAgentHost',
] as const;

export type ProposalName = typeof insidersProposals[number];

export const proposalParts: Record<ProposalName, string> = {
  chatSessionsProvider: 'Work in the Sessions list',
  chatArtifactIntegrations: 'Work Items and pull requests in chat',
  chatInputNotification: 'What waits, above the chat input',
  treeViewMarkdownMessage: 'The summary line at the top of Now',
  treeItemMarkdownLabel: 'Bold decisive parts in Now',
  statusBarItemTooltip: 'The status bar hover with what runs and what it costs',
  chatStatusItem: 'Unfold in the chat status menu',
  remoteAgentHost: 'The Agents window without editing settings.json',
};

export type ProposalOffReason = 'not-declared' | 'not-granted' | 'refused' | 'missing';

export type ProposalState = { name: ProposalName; on: boolean; reason?: ProposalOffReason };

export type ProposalReport = { states: ProposalState[]; used: ProposalName[] };

export type ExtensionManifest = { enabledApiProposals?: unknown };

const refusal = /CANNOT use API proposal/i;

export function isProposalRefusal(error: unknown): boolean {
  return refusal.test(error instanceof Error ? error.message : String(error));
}

function namesOf(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.split('@')[0]) : []);
}

export class ProposalGuard {
  private readonly declared: Set<string>;
  private readonly granted: Set<string>;
  private readonly failed = new Map<ProposalName, ProposalOffReason>();
  private readonly succeeded = new Set<ProposalName>();

  constructor(declared: ExtensionManifest, granted: ExtensionManifest = declared) {
    this.declared = namesOf(declared.enabledApiProposals);
    this.granted = namesOf(granted.enabledApiProposals);
  }

  get insiders(): boolean { return this.declared.size > 0; }

  usable(name: ProposalName): boolean { return this.reasonOff(name) === undefined; }

  use<T>(name: ProposalName, call: () => T): T | undefined {
    if (!this.usable(name)) return undefined;
    try { const value = call(); this.succeeded.add(name); return value; }
    catch (error) {
      if (isProposalRefusal(error)) { this.failed.set(name, 'refused'); return undefined; }
      if (error instanceof TypeError) { this.failed.set(name, 'missing'); return undefined; }
      throw error;
    }
  }

  states(): ProposalState[] {
    return insidersProposals.map(name => { const reason = this.reasonOff(name); return reason ? { name, on: false, reason } : { name, on: true }; });
  }

  used(): ProposalName[] { return insidersProposals.filter(name => this.succeeded.has(name) && this.usable(name)); }

  off(): ProposalState[] { return this.states().filter(state => !state.on && state.reason !== 'not-declared'); }

  private reasonOff(name: ProposalName): ProposalOffReason | undefined {
    if (!this.declared.has(name)) return 'not-declared';
    if (!this.granted.has(name)) return 'not-granted';
    return this.failed.get(name);
  }
}

export function enableProposedApiCommand(id = insidersExtensionId): string {
  return `code-insiders --enable-proposed-api ${id}`;
}

export function proposalsOffNotice(off: readonly ProposalState[], id = insidersExtensionId): string | undefined {
  if (!off.length) return undefined;
  const parts = off.map(state => `${proposalParts[state.name]} (${state.name})`).join('; ');
  return `Unfold Insiders works like the regular extension, with these experimental parts off: ${parts}. VS Code turns them on only in VS Code Insiders started with ${enableProposedApiCommand(id)}, or with "${id}" under "enable-proposed-api" in argv.json.`;
}

export function offNoticeKey(off: readonly ProposalState[]): string {
  return off.map(state => state.name).sort().join(',');
}
