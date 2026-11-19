import test from 'node:test';
import assert from 'node:assert/strict';
import { UnfoldClient, gatewayHeaderName, type Secrets } from '../src/client.ts';
import { gatewayChoices, inputProblem, manageGatewayHeaders, type GatewayChoice, type GatewayUi } from '../src/gateway.ts';

class MemorySecrets implements Secrets {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key); }
  async store(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}

type Step = { pick: (choices: GatewayChoice[]) => GatewayChoice | undefined; name?: string; value?: string };

function scripted(steps: Step[]) {
  const shown: Array<{ choices: GatewayChoice[]; title: string; placeholder: string }> = [];
  const asked: string[] = [];
  let current: Step | undefined;
  const ui: GatewayUi = {
    pick: async (choices, title, placeholder) => { shown.push({ choices, title, placeholder }); current = steps.shift(); return current?.pick(choices); },
    name: async () => current?.name,
    value: async name => { asked.push(name); return current?.value; },
  };
  return { ui, shown, asked };
}

const add = (choices: GatewayChoice[]) => choices.find(choice => choice.action === 'add');
const remove = (name: string) => (choices: GatewayChoice[]) => choices.find(choice => choice.action === 'remove' && choice.name === name);
const clear = (choices: GatewayChoice[]) => choices.find(choice => choice.action === 'clear');
const close = () => undefined;

test('a person adds, replaces and removes access gateway headers for one workbench, and no value is ever shown', async () => {
  const client = new UnfoldClient('https://unfold.example', new MemorySecrets());
  const first = scripted([
    { pick: add, name: 'X-Gateway-Id', value: 'editors' },
    { pick: add, name: ' X-Gateway-Secret ', value: 'opaque-gateway-secret' },
    { pick: add, name: 'x-gateway-id', value: 'reviewers' },
    { pick: close },
  ]);
  assert.equal(await manageGatewayHeaders(client, first.ui), true);
  assert.deepEqual(await client.gatewayHeaders(), { 'x-gateway-id': 'reviewers', 'X-Gateway-Secret': 'opaque-gateway-secret' });
  assert.deepEqual(first.asked, ['X-Gateway-Id', 'X-Gateway-Secret', 'x-gateway-id'], 'the value prompt names the header as it will be sent');
  assert.equal(first.shown[0].title, 'Access gateway headers for unfold.example');
  assert.equal(first.shown[0].placeholder, 'None stored. Add the headers the access gateway in front of unfold.example accepts.');
  assert.equal(first.shown[3].placeholder, '2 stored and sent with every request to unfold.example. Escape closes this list.');
  assert.doesNotMatch(JSON.stringify(first.shown), /opaque-gateway-secret|editors|reviewers/);

  const second = scripted([{ pick: remove('X-Gateway-Secret') }, { pick: close }]);
  assert.equal(await manageGatewayHeaders(client, second.ui), true);
  assert.deepEqual(await client.gatewayHeaders(), { 'x-gateway-id': 'reviewers' });

  await client.setGatewayHeaders({ 'X-One': '1', 'X-Two': '2' });
  const third = scripted([{ pick: clear }, { pick: close }]);
  assert.equal(await manageGatewayHeaders(client, third.ui), true);
  assert.deepEqual(await client.gatewayHeaders(), {});
});

test('closing the list or leaving a prompt changes nothing, and a refused header leaves what was stored', async () => {
  const secrets = new MemorySecrets();
  const client = new UnfoldClient('https://unfold.example', secrets);
  assert.equal(await manageGatewayHeaders(client, scripted([{ pick: close }]).ui), false);
  assert.equal(await manageGatewayHeaders(client, scripted([{ pick: add }, { pick: add, name: 'X-Gateway-Id' }, { pick: close }]).ui), false);
  assert.equal(secrets.values.size, 0);
  await client.setGatewayHeaders({ 'X-Gateway-Id': 'editors' });
  await assert.rejects(manageGatewayHeaders(client, scripted([{ pick: add, name: 'Authorization', value: 'Bearer taken' }]).ui), /The editor sets Authorization itself/);
  assert.deepEqual(await client.gatewayHeaders(), { 'X-Gateway-Id': 'editors' });
});

test('the list offers what fits the stored headers', () => {
  assert.deepEqual(gatewayChoices({}).map(choice => choice.action), ['add']);
  assert.deepEqual(gatewayChoices({ 'X-One': '1' }).map(choice => [choice.action, choice.name]), [['add', undefined], ['remove', 'X-One']]);
  assert.deepEqual(gatewayChoices({ 'X-One': '1', 'X-Two': '2' }).map(choice => choice.action), ['add', 'remove', 'remove', 'clear']);
});

test('an input box shows why a name is refused and nothing once it passes', () => {
  const problem = inputProblem(gatewayHeaderName);
  assert.equal(problem('X-Gateway-Id'), undefined);
  assert.equal(problem('Cookie'), 'The editor sets Cookie itself, so an access gateway header cannot replace it.');
  assert.equal(problem('two words'), 'Enter one header name of at most 64 characters, without a colon or spaces.');
});
