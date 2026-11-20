import test from 'node:test';
import assert from 'node:assert/strict';
import { ProposalGuard, enableProposedApiCommand, insidersProposals, isProposalRefusal, offNoticeKey, proposalsOffNotice } from '../src/proposals.ts';

const all = { enabledApiProposals: [...insidersProposals] };
const refused = () => { throw new Error('Extension \'unfold-hq.unfold-workbench-insiders\' CANNOT use API proposal: remoteAgentHost.'); };

test('the regular extension declares no proposal, so every part is off, nothing runs and nothing is announced', () => {
  const guard = new ProposalGuard({}, {});
  assert.equal(guard.insiders, false);
  for (const name of insidersProposals) assert.equal(guard.usable(name), false);
  let called = false;
  assert.equal(guard.use('remoteAgentHost', () => { called = true; return 1; }), undefined);
  assert.equal(called, false);
  assert.deepEqual(guard.off(), []);
  assert.equal(proposalsOffNotice(guard.off()), undefined);
});

test('a granted proposal runs its call and returns its value', () => {
  const guard = new ProposalGuard(all, all);
  assert.equal(guard.use('remoteAgentHost', () => 'registered'), 'registered');
  assert.deepEqual(guard.off(), []);
});

test('Stable VS Code grants nothing to the Insiders build, so every declared part is off and named once in plain words', () => {
  const guard = new ProposalGuard(all, { enabledApiProposals: [] });
  assert.equal(guard.insiders, true);
  assert.equal(guard.use('remoteAgentHost', () => 'never'), undefined);
  assert.deepEqual(guard.off().map(state => [state.name, state.reason]), insidersProposals.map(name => [name, 'not-granted']));
  const notice = proposalsOffNotice(guard.off())!;
  assert.match(notice, /code-insiders --enable-proposed-api unfold-hq\.unfold-workbench-insiders/);
  assert.match(notice, /The Agents window without editing settings\.json \(remoteAgentHost\)/);
  assert.match(notice, /argv\.json/);
});

test('a call VS Code refuses turns that part off and falls back, without throwing', () => {
  const guard = new ProposalGuard(all, all);
  assert.equal(guard.use('remoteAgentHost', refused), undefined);
  assert.equal(guard.usable('remoteAgentHost'), false);
  assert.deepEqual(guard.off(), [{ name: 'remoteAgentHost', on: false, reason: 'refused' }]);
  assert.equal(guard.usable('chatStatusItem'), true);
});

test('an API that is not there in this VS Code turns that part off', () => {
  const guard = new ProposalGuard(all, all);
  const chat: { registerRemoteAgentHost?: () => unknown } = {};
  assert.equal(guard.use('remoteAgentHost', () => chat.registerRemoteAgentHost!()), undefined);
  assert.deepEqual(guard.off(), [{ name: 'remoteAgentHost', on: false, reason: 'missing' }]);
});

test('any other failure is a real error and reaches the caller', () => {
  const guard = new ProposalGuard(all, all);
  assert.throws(() => guard.use('remoteAgentHost', () => { throw new Error('The host has no name.'); }), /no name/);
  assert.equal(guard.usable('remoteAgentHost'), true);
});

test('a proposal granted with a version suffix counts as granted', () => {
  const guard = new ProposalGuard(all, { enabledApiProposals: ['remoteAgentHost@2'] });
  assert.equal(guard.usable('remoteAgentHost'), true);
  assert.equal(guard.usable('chatSessionsProvider'), false);
});

test('the refusal text VS Code throws is recognised, other errors are not', () => {
  assert.equal(isProposalRefusal(new Error('Extension \'x\' CANNOT use API proposal: timeline.')), true);
  assert.equal(isProposalRefusal(new Error('Network down')), false);
  assert.equal(enableProposedApiCommand(), 'code-insiders --enable-proposed-api unfold-hq.unfold-workbench-insiders');
});

test('the notice key changes only when the set of parts that are off changes', () => {
  const a = new ProposalGuard(all, { enabledApiProposals: ['remoteAgentHost'] }).off();
  const b = new ProposalGuard(all, { enabledApiProposals: ['remoteAgentHost'] }).off();
  const c = new ProposalGuard(all, { enabledApiProposals: [] }).off();
  assert.equal(offNoticeKey(a), offNoticeKey(b));
  assert.notEqual(offNoticeKey(a), offNoticeKey(c));
});

test('used names only the proposals whose calls VS Code accepted and that are still on', () => {
  const guard = new ProposalGuard(all, all);
  assert.deepEqual(guard.used(), []);
  guard.use('chatStatusItem', () => 'item');
  guard.use('remoteAgentHost', refused);
  assert.deepEqual(guard.used(), ['chatStatusItem']);
  assert.deepEqual(new ProposalGuard({}, {}).used(), []);
});
