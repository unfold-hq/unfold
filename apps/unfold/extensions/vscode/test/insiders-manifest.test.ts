import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatSessionsContribution, feedbackCommand, insidersManifest, insidersProposals, stageInsiders, stagedFiles } from '../scripts/insiders.mjs';
import { insidersExtensionId, insidersProposals as guardedProposals } from '../src/proposals.ts';
import { sessionsListSetting, workSessionType } from '../src/work-sessions.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const insiders = insidersManifest(manifest);
const source = readFileSync(join(root, 'src/extension.ts'), 'utf8');

test('the Insiders manifest is the same extension under its own identifier and name', () => {
  assert.equal(`${insiders.publisher}.${insiders.name}`, insidersExtensionId);
  assert.equal(insiders.displayName, 'Unfold Insiders — Remote Agent Workbench');
  for (const key of ['version', 'main', 'engines', 'activationEvents', 'capabilities', 'extensionKind', 'icon', 'repository', 'license']) assert.deepEqual(insiders[key], manifest[key], `${key} is unchanged`);
  for (const key of Object.keys(manifest.contributes)) if (key !== 'commands' && key !== 'configuration') assert.deepEqual(insiders.contributes[key], manifest.contributes[key], `contributes.${key} is unchanged`);
});

test('it lists exactly the round 1 proposals of the design, which the guard knows by the same names', () => {
  assert.deepEqual(insiders.enabledApiProposals, ['chatSessionsProvider', 'chatArtifactIntegrations', 'chatInputNotification', 'treeViewMarkdownMessage', 'treeItemMarkdownLabel', 'statusBarItemTooltip', 'chatStatusItem', 'remoteAgentHost']);
  assert.deepEqual([...guardedProposals], insidersProposals);
  for (const name of insidersProposals) assert.ok(existsSync(join(root, 'proposed', `vscode.proposed.${name}.d.ts`)), `the type definition of ${name} is checked in`);
});

test('the regular manifest declares no proposal and has no Insiders command', () => {
  assert.equal(manifest.enabledApiProposals, undefined);
  assert.equal(manifest.contributes.commands.some((command: { command: string }) => command.command === feedbackCommand.command), false);
});

test('only the Insiders manifest contributes Send Feedback, and only the Insiders build registers it', () => {
  assert.deepEqual(insiders.contributes.commands.at(-1), feedbackCommand);
  assert.equal(insiders.contributes.commands.length, manifest.contributes.commands.length + 1);
  assert.match(source, /if \(this\.proposals\.insiders\) context\.subscriptions\.push\(vscode\.commands\.registerCommand\(sendFeedbackCommand/);
  assert.match(source, /const sendFeedbackCommand = 'unfold\.insiders\.sendFeedback'/);
});

test('build-only fields stay out, so packaging the staged folder never compiles again', () => {
  for (const key of ['scripts', 'devDependencies', 'overrides', 'allowScripts']) assert.equal(key in insiders, false, `${key} is dropped`);
  assert.ok(manifest.scripts, 'the source manifest is not changed');
});

test('staging writes the generated manifest next to the files the VSIX needs', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'unfold-insiders-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  for (const file of stagedFiles) {
    if (file === 'dist' || file === 'media') { await mkdir(join(fixture, 'src-root', file), { recursive: true }); await writeFile(join(fixture, 'src-root', file, 'x'), 'x'); }
    else await writeFile(join(fixture, 'src-root', file), file);
  }
  await writeFile(join(fixture, 'src-root', 'package.json'), JSON.stringify(manifest));
  const out = await stageInsiders(join(fixture, 'src-root'), join(fixture, 'out'));
  const staged = JSON.parse(await readFile(join(out, 'package.json'), 'utf8'));
  assert.equal(staged.name, 'unfold-workbench-insiders');
  for (const file of stagedFiles) assert.ok(existsSync(join(out, file)), `${file} is staged`);
});

test('only the Insiders manifest contributes the Sessions list and its setting, under the type the extension registers', () => {
  assert.equal(manifest.contributes.chatSessions, undefined);
  assert.equal(manifest.contributes.configuration.properties[`unfold.${sessionsListSetting}`], undefined);
  assert.deepEqual(insiders.contributes.chatSessions, [chatSessionsContribution]);
  assert.equal(chatSessionsContribution.type, workSessionType);
  const setting = insiders.contributes.configuration.properties[`unfold.${sessionsListSetting}`];
  assert.deepEqual(setting.enum, ['take-on', 'all']);
  assert.equal(setting.default, 'take-on');
  const { [`unfold.${sessionsListSetting}`]: _added, ...rest } = insiders.contributes.configuration.properties;
  assert.deepEqual(rest, manifest.contributes.configuration.properties);
  assert.match(source, /this\.registerSessionsList\(context\);/);
});
