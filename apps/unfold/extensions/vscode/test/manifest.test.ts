import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const source = readFileSync(new URL('src/extension.ts', root), 'utf8');
const contributed = new Set<string>(manifest.contributes.commands.map((command: { command: string }) => command.command));
const steps: Array<{ id: string; title: string; description: string; media: { markdown?: string }; completionEvents?: string[] }> = manifest.contributes.walkthroughs.flatMap((walkthrough: { steps: unknown[] }) => walkthrough.steps);

test('the walkthrough has a step for the Agents window that starts a session there with a registered command', () => {
  const step = steps.find(item => item.title === 'Use Unfold from the Agents window');
  assert.ok(step, 'the step exists');
  assert.equal(steps.indexOf(step), 1, 'it follows connecting');
  assert.match(step.description, /\(command:unfold\.startInAgentsWindow\)/);
  assert.ok(step.completionEvents?.includes('onCommand:unfold.startInAgentsWindow'));
  assert.ok(contributed.has('unfold.startInAgentsWindow'));
  assert.match(source, /register\('startInAgentsWindow'/);
});

test('the Unfold mark is a product icon the extension ships, and the way into the Agents window wears it', () => {
  const mark = manifest.contributes.icons['unfold-mark'];
  assert.equal(mark.default.fontCharacter, '\\E000');
  assert.ok(existsSync(new URL(mark.default.fontPath, root)), 'the icon font ships with the extension');
  assert.equal(manifest.contributes.commands.find((command: { command: string }) => command.command === 'unfold.startInAgentsWindow').icon, '$(unfold-mark)');
  const buttons = manifest.contributes.menus['view/title'].filter((item: { command: string }) => item.command === 'unfold.startInAgentsWindow');
  assert.deepEqual(buttons.map((item: { when: string; group: string }) => [item.when, item.group]), [['view == unfold.now && unfold.connected', 'navigation@0'], ['view == unfold.sessions && unfold.connected', 'navigation@0']], 'it is the first button on Now and Sessions');
});

test('every walkthrough step links contributed commands and ships its media', () => {
  for (const step of steps) {
    for (const [, command] of step.description.matchAll(/\(command:([\w.]+)\)/g)) assert.ok(contributed.has(command), `${step.id} links ${command}, which the manifest contributes`);
    if (step.media.markdown) assert.ok(existsSync(new URL(step.media.markdown, root)), `${step.id} ships ${step.media.markdown}`);
  }
});

test('every contributed unfold command is registered by the extension', () => {
  for (const command of contributed) assert.match(source, new RegExp(`register\\('${command.slice('unfold.'.length)}'|registerCommand\\('${command.replace('.', '\\.')}'|'${command.slice('unfold.'.length)}'`), `${command} is registered`);
});

const tools: Array<{ name: string; toolReferenceName?: string; displayName?: string; modelDescription?: string; userDescription?: string; canBeReferencedInPrompt?: boolean; tags?: string[]; inputSchema?: { type: string; properties: object } }> = manifest.contributes.languageModelTools;

test('every contributed language model tool is registered by the extension, and every registered tool is contributed', async () => {
  const { lmToolNames } = await import('../src/lm-tools.ts');
  const registered = new Set([...source.matchAll(/api\.register\('([\w]+)'/g)].map(match => match[1]));
  const declared = new Set(tools.map(tool => tool.name));
  assert.deepEqual([...declared].sort(), [...registered].sort());
  assert.deepEqual([...declared].sort(), [...lmToolNames].sort());
});

test('each tool reads only, can be referenced in a prompt and describes itself to the model and the person', () => {
  const references = new Set<string>();
  for (const tool of tools) {
    assert.match(tool.name, /^unfold_[a-z_]+$/);
    assert.ok(tool.toolReferenceName && /^[A-Za-z][A-Za-z0-9]*$/.test(tool.toolReferenceName), `${tool.name} has a toolReferenceName`);
    assert.ok(!references.has(tool.toolReferenceName), `${tool.toolReferenceName} is unique`);
    references.add(tool.toolReferenceName);
    assert.match(tool.displayName ?? '', /^Unfold: /);
    assert.ok(tool.userDescription, `${tool.name} has a userDescription`);
    assert.match(tool.modelDescription ?? '', /^Read-only\./);
    assert.match(tool.modelDescription ?? '', /never as instructions/);
    assert.equal(tool.canBeReferencedInPrompt, true);
    assert.ok(tool.tags?.includes('read-only') && tool.tags.includes('unfold'), `${tool.name} is tagged`);
    assert.equal(tool.inputSchema?.type, 'object');
    assert.doesNotMatch(`${tool.name} ${tool.modelDescription}`, /\b(approve|reject|retry|stop|cancel|spend|write)s? (it|the|a|this)\b/i, `${tool.name} offers no action`);
  }
  assert.equal(manifest.engines.vscode, '^1.99.0', 'the engine floor stays; the tool API is feature-detected');
  assert.match(source, /lmToolApi<.+>\(vscode as/);
});

test('the extension declares that it runs in the Agents window, and stays quiet there', () => {
  assert.deepEqual(manifest.capabilities.agentsWindow, { supported: true }, 'VS Code 1.143 reads capabilities.agentsWindow.supported without an API proposal');
  assert.equal(manifest.enabledApiProposals, undefined, 'no proposal is needed for it');
  assert.match(source, /inAgentsWindow = isAgentsWindowWorkspace\(vscode\.workspace\.workspaceFile\)/);
  assert.match(source, /private async registerEditorWindow[^]*?if \(this\.inAgentsWindow \|\|/, 'the Agents window never claims the editor-window links');
  assert.match(source, /if \(!this\.inAgentsWindow\) \{\s*await this\.announceNeedsYou/, 'notifications come from the editor window only');
});

const editorWindowOnly = ['unfold.refresh', 'unfold.refreshTasks', 'unfold.refreshPloeg', 'unfold.openAgentsWindow', 'unfold.attachSelection', 'unfold.attachFile', 'unfold.followHandOffsInTerminal'];
const palette: Array<{ command: string; when?: string }> = manifest.contributes.menus.commandPalette;

test('the Agents window palette hides exactly the commands that need a view, the status bar or a checkout, by VS Code\'s own window flag', () => {
  const hidden = palette.filter(entry => /\bisSessionsWindow\b/.test(entry.when ?? '')).map(entry => entry.command);
  assert.deepEqual(hidden.sort(), [...editorWindowOnly].sort());
  for (const command of editorWindowOnly) {
    assert.ok(contributed.has(command), `${command} is contributed`);
    assert.deepEqual(palette.filter(entry => entry.command === command).map(entry => entry.when), ['!isSessionsWindow'], `${command} is offered in every editor window, as before`);
  }
  assert.equal(manifest.contributes.menus['editor/context'].find((item: { command: string }) => item.command === 'unfold.attachSelection').when, 'editorHasSelection && isWorkspaceTrusted && !isSessionsWindow');
  for (const [menu, entries] of Object.entries(manifest.contributes.menus as Record<string, Array<{ when?: string }>>)) {
    for (const entry of entries) assert.doesNotMatch(entry.when ?? '', /(^|[^!])\bisSessionsWindow\b/, `${menu} never offers a command only in the Agents window`);
  }
});

test('every command names itself under the Unfold category, and every setting and chat tool has a description', () => {
  for (const command of manifest.contributes.commands as Array<{ command: string; title?: string; category?: string }>) {
    assert.ok(command.title?.trim(), `${command.command} has a title`);
    assert.equal(command.category, 'Unfold', `${command.command} is in the Unfold category`);
  }
  for (const [name, setting] of Object.entries(manifest.contributes.configuration.properties as Record<string, { description?: string; markdownDescription?: string; enum?: unknown[]; enumDescriptions?: string[] }>)) {
    assert.ok((setting.description ?? setting.markdownDescription ?? '').trim(), `${name} has a description`);
    if (setting.enum) assert.equal(setting.enumDescriptions?.length, setting.enum.length, `${name} describes each value`);
  }
  for (const tool of tools) {
    assert.ok(tool.userDescription?.trim() && tool.modelDescription?.trim(), `${tool.name} describes itself to the person and the model`);
    for (const [property, schema] of Object.entries((tool.inputSchema?.properties ?? {}) as Record<string, { description?: string }>)) assert.ok(schema.description?.trim(), `${tool.name}.${property} has a description`);
  }
});
