import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const insidersName = 'unfold-workbench-insiders';
export const insidersDisplayName = 'Unfold Insiders — Remote Agent Workbench';
export const insidersProposals = [
  'chatSessionsProvider',
  'chatArtifactIntegrations',
  'chatInputNotification',
  'treeViewMarkdownMessage',
  'treeItemMarkdownLabel',
  'statusBarItemTooltip',
  'chatStatusItem',
  'remoteAgentHost',
];
export const insidersActivationEvents = ['onChatArtifactIntegration'];
export const feedbackCommand = { command: 'unfold.insiders.sendFeedback', title: 'Send Feedback', category: 'Unfold Insiders', icon: '$(feedback)' };
export const stagedFiles = ['dist', 'media', 'README.md', 'CHANGELOG.md', 'LICENSE', '.vscodeignore'];

const buildOnly = ['scripts', 'devDependencies', 'overrides', 'allowScripts'];

export function insidersManifest(manifest) {
  const next = structuredClone(manifest);
  for (const key of buildOnly) delete next[key];
  next.name = insidersName;
  next.displayName = insidersDisplayName;
  next.description = `${manifest.description} Insiders build with VS Code's proposed APIs; installed from a GitHub release VSIX only.`;
  next.enabledApiProposals = [...insidersProposals];
  next.activationEvents = [...(next.activationEvents ?? []), ...insidersActivationEvents.filter(event => !next.activationEvents?.includes(event))];
  next.contributes = { ...next.contributes, commands: [...(next.contributes?.commands ?? []), feedbackCommand] };
  return next;
}

export async function stageInsiders(root, out) {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const file of stagedFiles) await cp(join(root, file), join(out, file), { recursive: true });
  await writeInsidersManifest(root, join(out, 'package.json'));
  return out;
}

export async function writeInsidersManifest(root, out) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await writeFile(out, `${JSON.stringify(insidersManifest(manifest), null, 2)}\n`);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const [flag, out] = process.argv.slice(2);
  const written = flag === '--manifest' && out ? await writeInsidersManifest(root, resolve(out)) : await stageInsiders(root, join(root, 'dist-insiders'));
  process.stdout.write(`${written}\n`);
}
