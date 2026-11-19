import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

export const coreModules = ['states.js', 'format.js', 'reasons.js', 'blackboard.js', 'checkout.js', 'progress.js', 'terms.js', 'agents-window.js', 'tracker-registry.js'];
const source = new URL('../../../public/core/', import.meta.url);
const target = new URL('../media/core/', import.meta.url);

await mkdir(target, { recursive: true });
for (const name of coreModules) {
  const text = await readFile(new URL(name, source), 'utf8');
  for (const [, specifier] of text.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)) {
    if (!coreModules.includes(specifier.replace(/^\.\//, ''))) throw new Error(`public/core/${name} imports ${specifier}, which the extension does not ship. Add it to coreModules or keep the module self-contained.`);
  }
  await copyFile(new URL(name, source), new URL(name, target));
}
await writeFile(new URL('package.json', target), '{ "type": "module" }\n');

const agentFiles = [
  { from: '../../../skills/operate-agent-session/', to: '../media/agent/skills/operate-agent-session/' },
  { from: '../../claude-code/', to: '../media/agent/plugin/' }
];

await rm(new URL('../media/agent/', import.meta.url), { recursive: true, force: true });
for (const { from, to } of agentFiles) {
  await cp(new URL(from, import.meta.url), new URL(to, import.meta.url), { recursive: true });
}
