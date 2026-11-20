import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackBody, feedbackIssueUrl, workbenchOrigin, type FeedbackFacts } from '../src/feedback.ts';
import { ProposalGuard, insidersProposals } from '../src/proposals.ts';

const proposals = new ProposalGuard({ enabledApiProposals: [...insidersProposals] }, { enabledApiProposals: ['remoteAgentHost'] }).states();
const facts: FeedbackFacts = {
  appName: 'Visual Studio Code - Insiders',
  vscodeVersion: '1.148.0-insider',
  extensionId: 'unfold-hq.unfold-workbench-insiders',
  extensionVersion: '0.4.0-rc.115',
  platform: 'darwin',
  proposals,
  workbench: 'https://person:secret@unfold.example:8443/teams/one?token=abc#now',
};

test('the feedback issue opens on unfold-hq/unfold with the versions and which proposals are active', () => {
  const url = new URL(feedbackIssueUrl(facts));
  assert.equal(`${url.origin}${url.pathname}`, 'https://github.com/unfold-hq/unfold/issues/new');
  assert.equal(url.searchParams.get('title'), 'Unfold Insiders: ');
  const body = url.searchParams.get('body')!;
  assert.match(body, /Visual Studio Code - Insiders 1\.148\.0-insider/);
  assert.match(body, /unfold-hq\.unfold-workbench-insiders 0\.4\.0-rc\.115/);
  assert.match(body, /\| `remoteAgentHost` \| on \|/);
  assert.match(body, /\| `chatSessionsProvider` \| off \(not-granted\) \|/);
});

test('the workbench appears only as its origin: no credentials, path, query or fragment', () => {
  const body = feedbackBody(facts);
  assert.match(body, /Workbench: https:\/\/unfold\.example:8443\n/);
  for (const leak of ['secret', 'person', 'teams', 'token=abc', '#now']) assert.equal(body.includes(leak), false, `${leak} stays out`);
  assert.equal(workbenchOrigin('file:///etc/passwd'), undefined);
  assert.equal(workbenchOrigin('not a url'), undefined);
  assert.match(feedbackBody({ ...facts, workbench: undefined }), /Workbench: not connected/);
});

test('the body holds no character that VS Code could misread when it re-encodes the link', () => {
  for (const character of ['#', '&', '=', '+', '%']) assert.equal(feedbackBody(facts).includes(character), false, `${character} is absent`);
});

test('a proposal the build does not declare is not listed', () => {
  const regular = new ProposalGuard({}, {}).states();
  assert.equal(feedbackBody({ ...facts, proposals: regular }).includes('`remoteAgentHost`'), false);
});
