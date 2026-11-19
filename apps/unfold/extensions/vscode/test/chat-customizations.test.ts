import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const source = readFileSync(new URL('src/extension.ts', root), 'utf8');
const pluginSource = new URL('../claude-code/', root);
const skillSource = new URL('../../skills/operate-agent-session/SKILL.md', root);
type Contribution = { path: string; when?: string };
const contributed = (point: string): Contribution[] => manifest.contributes[point] ?? [];
const frontmatterName = (text: string) => /^---\n[\s\S]*?^name:\s*(\S+)\s*$[\s\S]*?^---$/m.exec(text)?.[1];

test('the extension contributes the Unfold skill, instructions and Agent Plugin to chat only while signed in', () => {
  for (const point of ['chatSkills', 'chatInstructions', 'chatPlugins']) {
    const entries = contributed(point);
    assert.equal(entries.length, 1, `${point} has one entry`);
    for (const entry of entries) assert.equal(entry.when, 'unfold.connected', `${point} ${entry.path} is active only while signed in`);
  }
  assert.match(source, /setContext', 'unfold\.connected', true/);
  assert.match(source, /setContext', 'unfold\.connected', false/);
  assert.equal(manifest.engines.vscode, '^1.99.0', 'editors older than the chat contributions still install the extension');
});

test('the contributed skill is the shipped copy of operate-agent-session, in a folder named after it', () => {
  const [skill] = contributed('chatSkills');
  const file = new URL(skill.path, root);
  assert.ok(existsSync(file), `${skill.path} is copied at build time`);
  const text = readFileSync(file, 'utf8');
  assert.equal(text, readFileSync(skillSource, 'utf8'));
  assert.equal(frontmatterName(text), basename(dirname(fileURLToPath(file))), 'VS Code requires the folder name to match the skill name');
});

test('the contributed instructions name Unfold, its read-only tools and untrusted data', () => {
  const [instructions] = contributed('chatInstructions');
  assert.match(instructions.path, /\.instructions\.md$/);
  const text = readFileSync(new URL(instructions.path, root), 'utf8');
  assert.equal(frontmatterName(text), 'unfold');
  assert.match(text, /^description: \S/m);
  for (const tool of manifest.contributes.languageModelTools) assert.ok(text.includes(`\`${tool.name}\``), `the instructions name ${tool.name}`);
  assert.match(text, /untrusted/);
});

test('the contributed plugin is the Agent Plugin copied whole, recognised by VS Code as Agent Plugins v1', () => {
  const [plugin] = contributed('chatPlugins');
  const target = new URL(`${plugin.path.replace(/\/?$/, '/')}`, root);
  const manifestCopy = readFileSync(new URL('plugin.json', target), 'utf8');
  assert.equal(manifestCopy, readFileSync(new URL('plugin.json', pluginSource), 'utf8'));
  assert.match(JSON.parse(manifestCopy).$schema, /^https:\/\/agent-plugins\.org\/schemas\//);
  const skills = readdirSync(new URL('skills/', pluginSource));
  assert.ok(skills.length > 0);
  for (const skill of skills) {
    assert.equal(readFileSync(new URL(`skills/${skill}/SKILL.md`, target), 'utf8'), readFileSync(new URL(`skills/${skill}/SKILL.md`, pluginSource), 'utf8'), `skills/${skill} is copied`);
  }
});
