const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vscode = require('vscode');
const { parse } = require('jsonc-parser');

const target = process.env.UNFOLD_INTEGRATION_TARGET;
const extensionId = process.env.UNFOLD_INTEGRATION_EXTENSION;
const demoUrl = process.env.UNFOLD_INTEGRATION_DEMO_URL;
const settingsFile = process.env.UNFOLD_INTEGRATION_SETTINGS;
const insiders = target === 'insiders';
const unreachable = 'http://127.0.0.1:9';
const declaredProposals = ['chatSessionsProvider', 'chatArtifactIntegrations', 'chatInputNotification', 'treeViewMarkdownMessage', 'treeItemMarkdownLabel', 'statusBarItemTooltip', 'chatStatusItem', 'remoteAgentHost'];
const readTools = ['unfold_now', 'unfold_get_work', 'unfold_find_work'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(describe, probe, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await probe(); if (value) return value; last = undefined; }
    catch (error) { last = error; }
    await sleep(250);
  }
  throw new Error(`${describe} did not happen within ${timeoutMs / 1000} seconds${last ? `: ${last.message}` : ''}`);
}

async function demo(path) {
  const response = await fetch(`${demoUrl}${path}`, { headers: { Accept: 'application/json', 'X-Unfold-Request': '1' } });
  assert.equal(response.status, 200, `${path} answered ${response.status}`);
  return response.json();
}

async function invoke(name, input = {}) {
  const result = await vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined }, new vscode.CancellationTokenSource().token);
  return result.content.map(part => typeof part.value === 'string' ? part.value : '').join('');
}

function userSettings() {
  return parse(readFileSync(settingsFile, 'utf8')) ?? {};
}

function extension() {
  const found = vscode.extensions.getExtension(extensionId);
  assert.ok(found, `${extensionId} is installed`);
  return found;
}

describe(`Unfold in VS Code ${target} ${vscode.version}`, function () {
  let api;
  let now;

  before(async function () {
    assert.ok(target && extensionId && demoUrl && settingsFile, 'run.mjs passes the target, the extension id, the demo URL and the settings file');
    now = await demo('/api/ploeg/now');
    assert.equal(now.demo, true, 'the workbench under test is the deterministic demo');
  });

  it('activates without an error and hands over its read-only API', async function () {
    api = await extension().activate();
    assert.equal(extension().isActive, true);
    assert.equal(typeof api?.proposals, 'function', 'activate returned its API, so it did not fail into an error message');
  });

  it('registers every command it contributes', async function () {
    const commands = new Set(await vscode.commands.getCommands(true));
    const contributed = extension().packageJSON.contributes.commands.map(entry => entry.command);
    assert.deepEqual(contributed.filter(command => !commands.has(command)), []);
    assert.equal(commands.has('unfold.insiders.sendFeedback'), insiders, 'the Insiders-only feedback command is registered exactly in the Insiders build');
  });

  it('declares the API proposals of its build and no other', function () {
    const declared = extension().packageJSON.enabledApiProposals;
    if (insiders) assert.deepEqual([...declared].sort(), [...declaredProposals].sort());
    else assert.equal(declared, undefined, 'the regular build declares no proposal');
  });

  it('reaches the demo workbench and answers what waits from it', async function () {
    const answer = await eventually('unfold_now answering from the demo', async () => { const text = await invoke('unfold_now'); return text.startsWith(`Unfold at ${demoUrl}`) ? text : undefined; });
    assert.match(answer, /illustrative demo: nothing ran and nothing was spent/);
    const waiting = now.waiting.find(item => item.state === 'needs_human');
    assert.ok(waiting, 'the demo has a Work Item that needs a person');
    assert.ok(answer.includes(waiting.title), `unfold_now names "${waiting.title}"`);
  });

  it('registers every language-model tool it contributes', async function () {
    const contributed = extension().packageJSON.contributes.languageModelTools.map(tool => tool.name);
    await eventually('every Unfold tool in vscode.lm.tools', () => { const registered = new Set(vscode.lm.tools.map(tool => tool.name)); return contributed.every(name => registered.has(name)); });
    for (const name of readTools) assert.ok(contributed.includes(name), `${name} is contributed`);
  });

  it('reads one Work Item with unfold_get_work', async function () {
    const item = now.waiting.find(entry => entry.state === 'awaiting_review') ?? now.waiting[0];
    const answer = await invoke('unfold_get_work', { id: item.id });
    assert.ok(answer.includes(item.title), `unfold_get_work names "${item.title}": ${answer.slice(0, 300)}`);
    assert.match(await invoke('unfold_get_work', {}), /Pass a Work Item id/);
  });

  it('finds Work Items by title and by tracker id with unfold_find_work', async function () {
    const item = now.waiting.find(entry => entry.externalId?.startsWith('DEMO-')) ?? now.waiting[0];
    const byTitle = await invoke('unfold_find_work', { query: item.title.split(' ').slice(0, 3).join(' ') });
    assert.ok(byTitle.includes(item.id), `a title search finds Work Item ${item.id}: ${byTitle.slice(0, 300)}`);
    const byTracker = await invoke('unfold_find_work', { query: item.externalId });
    assert.ok(byTracker.includes(item.id), `a tracker id search finds Work Item ${item.id}: ${byTracker.slice(0, 300)}`);
  });

  it('wires the workbench into the Agents window the way its build can', async function () {
    const { address } = await demo('/api/agent-host');
    const entries = () => (userSettings()['chat.remoteAgentHosts'] ?? []).filter(entry => entry?.address === address);
    if (insiders) {
      await eventually('the remoteAgentHost registration', () => api.proposals().used.includes('remoteAgentHost'));
      assert.deepEqual(entries(), [], 'the Insiders build registers the host and leaves settings.json alone');
    } else {
      const [entry] = await eventually('the chat.remoteAgentHosts entry in settings.json', () => entries().length ? entries() : undefined);
      assert.equal(entry.name, 'Unfold');
      assert.match(entry.connectionToken, /\S{16,}/, 'the entry carries a minted connection token');
    }
  });

  it('follows a changed server URL: unreachable, then the demo again', async function () {
    const configuration = () => vscode.workspace.getConfiguration('unfold');
    await configuration().update('serverUrl', unreachable, vscode.ConfigurationTarget.Global);
    try {
      const answer = await eventually('an answer that no longer comes from the demo', async () => { const text = await invoke('unfold_now'); return text.startsWith('Unfold at') ? undefined : text; });
      assert.match(answer, /Unfold: Connect to Workbench/, 'the answer says how to connect again');
    } finally {
      await configuration().update('serverUrl', demoUrl, vscode.ConfigurationTarget.Global);
    }
    await eventually('the demo answer again', async () => (await invoke('unfold_now')).startsWith(`Unfold at ${demoUrl}`));
  });

  if (insiders) {
    it('uses every Insiders proposal without a refusal', async function () {
      await vscode.commands.executeCommand('unfold.now.focus');
      await vscode.commands.executeCommand('unfold.refresh');
      const report = await eventually('every proposal in use', () => { const current = api.proposals(); return declaredProposals.every(name => current.used.includes(name)) ? current : undefined; }, 30_000)
        .catch(error => { const current = api.proposals(); throw new Error(`${error.message}. Off: ${JSON.stringify(current.states.filter(state => !state.on))}; used: ${current.used.join(', ')}`); });
      assert.deepEqual(report.states.filter(state => !state.on), []);
    });
  } else {
    it('reports every proposal as not declared and uses none', function () {
      const report = api.proposals();
      assert.deepEqual(report.used, []);
      assert.deepEqual(report.states.map(state => state.reason), declaredProposals.map(() => 'not-declared'));
    });
  }
});
