import type { ProposalState } from './proposals.js';

export const feedbackRepository = 'https://github.com/unfold-hq/unfold';

export type FeedbackFacts = {
  appName: string;
  vscodeVersion: string;
  extensionId: string;
  extensionVersion: string;
  platform: string;
  proposals: readonly ProposalState[];
  workbench?: string;
};

export function workbenchOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch { return undefined; }
}

function proposalLine(state: ProposalState): string {
  return `| \`${state.name}\` | ${state.on ? 'on' : `off (${state.reason})`} |`;
}

export function feedbackBody(facts: FeedbackFacts): string {
  const origin = workbenchOrigin(facts.workbench);
  return [
    '**What happened**',
    '',
    '',
    '**What you expected**',
    '',
    '',
    '**Environment**',
    '',
    `- Editor: ${facts.appName} ${facts.vscodeVersion}`,
    `- Extension: ${facts.extensionId} ${facts.extensionVersion}`,
    `- Platform: ${facts.platform}`,
    `- Workbench: ${origin ?? 'not connected'}`,
    '',
    '| Proposal | State |',
    '| --- | --- |',
    ...facts.proposals.filter(state => state.reason !== 'not-declared').map(proposalLine),
    '',
  ].join('\n');
}

export function feedbackIssueUrl(facts: FeedbackFacts): string {
  const url = new URL(`${feedbackRepository}/issues/new`);
  url.searchParams.set('title', 'Unfold Insiders: ');
  url.searchParams.set('body', feedbackBody(facts));
  return url.toString();
}
