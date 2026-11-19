import test from 'node:test';
import assert from 'node:assert/strict';
import { application, request } from './api-support.ts';
import { action, connect, vscodeAgentsWindow, type Json } from './ahp-support.ts';
import { testTimeout } from './timeframes.ts';
import { awaitingReview, changesetOperations, publishable, reviewOperationIds, reviewOperations } from '../src/ahp/review.ts';
import type { DeliveryService, DeliveryView, PublicationReadiness } from '../src/delivery.ts';
import type { Session, User } from '../src/types.ts';

const completed = { status: 'completed' } as unknown as Session;
const verified: PublicationReadiness = { enabled: true, verified: true };
const pullRequest = { number: 42, url: 'https://forge.example/acme/orders/pulls/42' };
const branch = 'unfold/wi-7/cccccccccccc';

test('a gated candidate offers only Accept and open pull request, and only once its passing receipt is recorded and publishing is enabled', () => {
  assert.deepEqual(reviewOperations(completed, true, verified).map(operation => [operation.id, operation.label]), [[reviewOperationIds.publish, 'Accept and open pull request']]);
  assert.doesNotMatch(reviewOperations(completed, true, verified)[0].description, /Nothing is pushed/);
  assert.deepEqual(reviewOperations(completed, true, { enabled: true, verified: false }), [], 'a receipt that did not pass never offers publishing');
  assert.deepEqual(reviewOperations(completed, true, { enabled: false, verified: true }), [], 'a workbench without a publisher offers nothing');
  assert.deepEqual(reviewOperations(completed, true, undefined), []);
  assert.deepEqual(reviewOperations(completed, true, { ...verified, publication: { phase: 'published', operationId: 'pub-c', branch, pullRequest } }), [], 'a published pull request is not offered again');
  assert.equal(publishable({ ...verified, publication: { phase: 'pushed', operationId: 'pub-c', branch } }), true, 'an interrupted publication can be resumed');
  assert.equal(awaitingReview({ ...completed, review: { decision: 'accepted' } } as unknown as Session, true, verified), false);
});

test('an ungated candidate keeps the note-only Accept, which says it pushes nothing', () => {
  const operations = reviewOperations(completed, false, verified);
  assert.deepEqual(operations.map(operation => operation.id), ['accept', 'request-changes', 'reject']);
  assert.match(operations[0].description, /Nothing is pushed or merged/);
});

type Published = { sessionId: string; user: User };

async function gatedSession(t: { after: (fn: () => unknown) => void }, readiness: PublicationReadiness, publishing?: () => Promise<unknown>) {
  const server = await application('demo', config => { config.delivery = { verifierTokenEnv: 'UNFOLD_TEST_VERIFIER', policies: [{ repositoryId: 'order-service' }] } as unknown as typeof config.delivery; });
  t.after(() => server.close());
  const operator = { id: 'demo-operator', name: 'Demo operator', role: 'operator' as const };
  const created = server.app.engine.create({ title: 'Gated', objective: 'Reproduce the rounding regression and fix it with the tests intact.', repositoryId: 'order-service', teamId: 'delivery', runtime: 'demo', budgetUsd: 1 }, operator);
  server.app.store.saveSession({ ...created, status: 'completed', candidate: { status: 'ready', fileCount: 1 }, execution: { id: 'a'.repeat(32), workItemId: '7', team: 'delivery', state: 'completed', stopConfirmed: true } } as unknown as Session);
  const published: Published[] = [];
  const state = { readiness };
  const delivery = {
    readiness: () => state.readiness,
    publishCurrent: async (sessionId: string, user: User): Promise<DeliveryView> => {
      published.push({ sessionId, user });
      await publishing?.();
      state.readiness = { ...state.readiness, publication: { phase: 'published', operationId: 'pub-c', branch, pullRequest } };
      return { configured: true, publicationEnabled: true, publication: state.readiness.publication };
    },
  } as unknown as DeliveryService;
  server.app.agentHost!.useDelivery(delivery);
  const window = async (clientId: string) => {
    const issued = await request(server.url, '/api/agent-host/tokens', { method: 'POST', body: { label: clientId } });
    const opened = connect(`${server.url.replace(/^http/, 'ws')}/?tkn=${issued.body.token}`);
    t.after(() => opened.close());
    await opened.open;
    await opened.rpc('initialize', { channel: 'ahp-root://', protocolVersions: ['0.9.0'], clientId, clientInfo: vscodeAgentsWindow, _meta: { 'vscode.ahpSessionUris': true } });
    return opened;
  };
  const client = await window('publish');
  return { client, window, id: created.id, session: `ahp-session:/${created.id}`, changeset: `ahp-changeset:/${created.id}`, published };
}

test('the Agents window lists Accept and open pull request on a verified gated candidate and invoking it calls the publish route', { timeout: testTimeout(60_000) }, async t => {
  const { client, id, session, changeset, published } = await gatedSession(t, verified);
  const operations = (await client.rpc('subscribe', { channel: changeset })).snapshot.state.operations as Json[];
  assert.deepEqual(operations.map(operation => operation.id), [reviewOperationIds.publish]);
  const result = await client.rpc('invokeChangesetOperation', { channel: changeset, operationId: reviewOperationIds.publish });
  assert.deepEqual(published.map(entry => entry.sessionId), [id]);
  assert.match(result.message, /Pull request #42 is open on the forge: https:\/\/forge\.example\/acme\/orders\/pulls\/42\. Merging it stays with you\./);
  const changed = await client.until(message => action(message, changeset, 'changeset/operationsChanged'));
  assert.deepEqual(changed.params.action.operations, []);
  const git = (await client.rpc('subscribe', { channel: session })).snapshot.state._meta.git;
  assert.equal(git.branchName, branch, '_meta.git names the published branch');
  assert.deepEqual(git.pullRequest, pullRequest);
});

test('Agent Merge on a verified gated candidate publishes nothing: it is refused with Accept and open pull request as the way', { timeout: testTimeout(60_000) }, async t => {
  const { client, session, published } = await gatedSession(t, verified);
  await client.rpc('subscribe', { channel: session });
  client.notify('dispatchAction', { channel: session, clientSeq: 1, action: { type: 'session/configChanged', config: { agentMerge: { enabled: true } } } });
  const refused = await client.until(message => action(message, session, 'session/configChanged'));
  assert.match(refused.params.rejectionReason, /choose Accept and open pull request in the Changes view/);
  assert.equal(published.length, 0);
});

test('Accept and open pull request carries a confirmation that names the repository and branches, and Accept, Request changes and Reject carry none', () => {
  const [publish] = changesetOperations(completed, true, verified, { repository: 'Order service', baseBranch: 'main' });
  assert.equal(publish.id, reviewOperationIds.publish);
  assert.equal(publish.status, 'idle');
  assert.match(publish.confirmation, /Order service/);
  assert.match(publish.confirmation, /pull request into main/);
  assert.match(publish.confirmation, /cannot be undone from VS Code/);
  assert.match(changesetOperations(completed, true, { ...verified, publication: { phase: 'pushed', operationId: 'pub-c', branch } }, { repository: 'Order service', baseBranch: 'main', branch })[0].confirmation, new RegExp(`the branch ${branch} of Order service`));
  assert.deepEqual(changesetOperations(completed, false, verified), reviewOperations(completed, false, verified), 'an ungated candidate lists the same operations as before, without a confirmation');
});

test('a gated candidate that is not publishable lists Accept and open pull request disabled with the reason, and a published or reviewed one lists nothing', () => {
  const [unverified] = changesetOperations(completed, true, { enabled: true, verified: false });
  assert.deepEqual([unverified.id, unverified.status], [reviewOperationIds.publish, 'disabled']);
  assert.match(unverified.description, /only for a verified candidate/);
  assert.equal(unverified.confirmation, undefined);
  assert.match(changesetOperations(completed, true, { enabled: false, verified: true })[0].description, /no publisher/);
  assert.match(changesetOperations(completed, true, { enabled: false, verified: true, publication: { phase: 'refused', operationId: 'pub-c', branch } })[0].description, /publisher refused/);
  assert.deepEqual(changesetOperations(completed, true, { ...verified, publication: { phase: 'published', operationId: 'pub-c', branch, pullRequest } }), []);
  assert.deepEqual(changesetOperations({ ...completed, review: { decision: 'rejected' } } as unknown as Session, true, { enabled: true, verified: false }), []);
  assert.deepEqual(changesetOperations({ status: 'running' } as unknown as Session, true, { enabled: true, verified: false }), []);
});

test('the Agents window shows the confirmation on a verified candidate and a disabled operation that publishes nothing on an unverified one', { timeout: testTimeout(60_000) }, async t => {
  const offered = await gatedSession(t, verified);
  const [publish] = (await offered.client.rpc('subscribe', { channel: offered.changeset })).snapshot.state.operations as Json[];
  assert.match(publish.confirmation, /of Order service and opens one pull request into main/);
  const unverified = await gatedSession(t, { enabled: true, verified: false });
  const [disabled] = (await unverified.client.rpc('subscribe', { channel: unverified.changeset })).snapshot.state.operations as Json[];
  assert.deepEqual([disabled.id, disabled.status], [reviewOperationIds.publish, 'disabled']);
  await assert.rejects(unverified.client.rpc('invokeChangesetOperation', { channel: unverified.changeset, operationId: reviewOperationIds.publish }), /is not available: Unfold opens a pull request only for a verified candidate/);
  assert.equal(unverified.published.length, 0);
});

test('while publishing runs, every window of the person shows it running and a second invoke is refused', { timeout: testTimeout(60_000) }, async t => {
  let finish!: () => void;
  const running = new Promise<void>(resolve => { finish = resolve; });
  const { client, window, changeset, published } = await gatedSession(t, verified, () => running);
  const other = await window('publish-other');
  await client.rpc('subscribe', { channel: changeset });
  await other.rpc('subscribe', { channel: changeset });
  const invoked = client.rpc('invokeChangesetOperation', { channel: changeset, operationId: reviewOperationIds.publish });
  for (const each of [client, other]) {
    const started = await each.until(message => action(message, changeset, 'changeset/operationStatusChanged'));
    assert.deepEqual([started.params.action.operationId, started.params.action.status], [reviewOperationIds.publish, 'running']);
  }
  const late = await window('publish-late');
  assert.equal((await late.rpc('subscribe', { channel: changeset })).snapshot.state.operations[0].status, 'running', 'a window that subscribes now sees it running');
  await assert.rejects(other.rpc('invokeChangesetOperation', { channel: changeset, operationId: reviewOperationIds.publish }), /already running/);
  finish();
  assert.match((await invoked).message, /Pull request #42 is open/);
  assert.equal(published.length, 1, 'the second click published nothing');
  await other.until(message => action(message, changeset, 'changeset/operationsChanged'));
  assert.deepEqual(other.inbox.filter(message => action(message, changeset, 'changeset/operationStatusChanged')).map(message => message.params.action.status), ['running', 'idle']);
});

test('a failed publish shows the error state and the Changes view keeps the candidate', { timeout: testTimeout(60_000) }, async t => {
  const { client, changeset, published } = await gatedSession(t, verified, async () => { throw Object.assign(new Error('The forge refused the push'), { status: 409 }); });
  await client.rpc('subscribe', { channel: changeset });
  const refused = await client.rpc('invokeChangesetOperation', { channel: changeset, operationId: reviewOperationIds.publish }).then(() => assert.fail('the publish should fail'), (error: Error) => error.message);
  assert.equal(published.length, 1);
  const failed = client.inbox.filter(message => action(message, changeset, 'changeset/operationStatusChanged')).map(message => message.params.action);
  assert.deepEqual(failed.map(each => each.status), ['running', 'error']);
  assert.equal(failed[1].error.message, refused, 'the error state says what the invoke said');
  assert.equal(client.inbox.some(message => action(message, changeset, 'changeset/operationsChanged')), false);
  const [kept] = (await client.rpc('subscribe', { channel: changeset })).snapshot.state.operations as Json[];
  assert.deepEqual([kept.id, kept.status, kept.error.message], [reviewOperationIds.publish, 'error', refused]);
});
