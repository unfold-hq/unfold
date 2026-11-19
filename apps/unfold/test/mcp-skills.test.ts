import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { createMcpServer } from '../src/mcp.ts';
import { loadSkillCatalogue, mcpSkillsExtension, pluginSkillsRoot, servedSkillNames, skillFrontmatter } from '../src/mcp-skills.ts';

type Json = Record<string, any>;

const appsCapabilities = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } };
const modernMeta = (capabilities: Json = {}) => ({ 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'Visual Studio Code', version: '1.147.0' }, 'io.modelcontextprotocol/clientCapabilities': capabilities });
const server = (skills: boolean) => createMcpServer({ url: 'http://unfold.test', token: 'vle_test', version: 'test', prompts: true, ...(skills ? { skills } : {}), fetch: (async () => { throw new Error('skills never call Unfold'); }) as typeof fetch });
let next = 0;
const ask = async (mcp: ReturnType<typeof createMcpServer>, method: string, params: Json = {}, modern = false, capabilities: Json = {}) => (await mcp.handle({ jsonrpc: '2.0', id: ++next, method, params: modern ? { ...params, _meta: modernMeta(capabilities) } : params }))!;
const initialize = (mcp: ReturnType<typeof createMcpServer>, capabilities: Json = {}) => ask(mcp, 'initialize', { protocolVersion: '2025-11-25', capabilities, clientInfo: { name: 'Visual Studio Code', version: '1.147.0' } });

async function shipped(name: string) {
  const bytes = await readFile(join(pluginSkillsRoot, name, 'SKILL.md'));
  const text = bytes.toString('utf8');
  return { bytes, text, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, frontmatter: parse(/^---\n([\s\S]*?)\n---\n/.exec(text)![1]!) };
}

test('with mcp.skills off, unfold-mcp declares no skills extension and answers no skills method, on either revision', async () => {
  const mcp = server(false);
  const init = await initialize(mcp);
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false }, prompts: { listChanged: false }, completions: {} });
  const discovered = await ask(mcp, 'server/discover', {}, true);
  assert.equal(discovered.result.capabilities.extensions, undefined);
  assert.equal(discovered.result.capabilities.resources, undefined);
  for (const modern of [false, true]) {
    for (const [method, params] of [['skills/list', {}], ['skills/get', { uri: 'skill://unfold/SKILL.md' }], ['resources/list', {}], ['resources/read', { uri: 'skill://unfold/SKILL.md' }]] as const) {
      const answer = await ask(mcp, method, params, modern);
      assert.equal(answer.error?.code, -32601, `${method} ${modern ? '2026-07-28' : '2025-11-25'}`);
    }
  }
});

test('with mcp.skills off, an MCP Apps client still reads only the card resource and never a skill', async () => {
  const mcp = server(false);
  const listed = await ask(mcp, 'resources/list', {}, true, appsCapabilities);
  assert.ok(listed.result.resources.length > 0);
  assert.ok(listed.result.resources.every((resource: Json) => !resource.uri.startsWith('skill://')));
  const read = await ask(mcp, 'resources/read', { uri: 'skill://unfold/SKILL.md' }, true, appsCapabilities);
  assert.equal(read.error.code, -32602);
});

test('with mcp.skills on, initialize and server/discover declare the skills extension and resources', async () => {
  const mcp = server(true);
  const init = await initialize(mcp);
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false }, prompts: { listChanged: false }, completions: {}, resources: { listChanged: false }, extensions: { [mcpSkillsExtension]: {} } });
  const discovered = await ask(mcp, 'server/discover', {}, true);
  assert.deepEqual(discovered.result.capabilities.extensions, { [mcpSkillsExtension]: {} });
  assert.deepEqual(discovered.result.capabilities.resources, {});
  assert.equal(discovered.result.cacheScope, 'private', 'the flag is per person, so the declaration is not shared');
  const both = await ask(server(true), 'server/discover', {}, true, appsCapabilities);
  assert.deepEqual(Object.keys(both.result.capabilities.extensions).sort(), [mcpSkillsExtension, 'io.modelcontextprotocol/ui'].sort());
});

test('with mcp.skills on, skills/list serves the plugin\'s own SKILL.md files with their verbatim frontmatter, SHA-256 digest and size', async () => {
  const mcp = server(true);
  for (const modern of [false, true]) {
    const listed = await ask(mcp, 'skills/list', {}, modern);
    assert.deepEqual(listed.result.skills.map((skill: Json) => skill.uri), ['skill://unfold/SKILL.md', 'skill://link-work-item/SKILL.md']);
    for (const skill of listed.result.skills) {
      const name = skill.frontmatter.name;
      const file = await shipped(name);
      assert.equal(skill.uri, `skill://${name}/SKILL.md`, 'the last path segment is the frontmatter name');
      assert.deepEqual(skill.frontmatter, file.frontmatter, 'the frontmatter is what a YAML parser reads from the shipped file');
      assert.deepEqual(skill.resources, [{ uri: skill.uri, digest: file.digest, size: file.bytes.length }]);
      assert.match(skill.resources[0].digest, /^sha256:[0-9a-f]{64}$/);
    }
    if (modern) {
      assert.equal(listed.result.resultType, 'complete');
      assert.equal(listed.result.cacheScope, 'private');
      assert.equal(typeof listed.result.ttlMs, 'number');
    }
  }
});

test('with mcp.skills on, skills/get returns one entry by its SKILL.md URI and -32602 for any other URI', async () => {
  const mcp = server(true);
  const file = await shipped('unfold');
  for (const modern of [false, true]) {
    const got = await ask(mcp, 'skills/get', { uri: 'skill://unfold/SKILL.md' }, modern);
    assert.deepEqual(got.result.skill, { uri: 'skill://unfold/SKILL.md', frontmatter: file.frontmatter, resources: [{ uri: 'skill://unfold/SKILL.md', digest: file.digest, size: file.bytes.length }] });
    if (modern) assert.equal(got.result.resultType, 'complete');
    for (const uri of ['skill://brief/SKILL.md', 'skill://unfold', 'skill://unfold/../brief/SKILL.md', 42, undefined]) {
      const refused = await ask(mcp, 'skills/get', { uri }, modern);
      assert.equal(refused.error?.code, -32602, String(uri));
    }
  }
});

test('with mcp.skills on, resources/read returns bytes that match the listed digest and size, and resources/list names each file', async () => {
  const mcp = server(true);
  const listed = (await ask(mcp, 'skills/list', {}, true)).result.skills as Json[];
  for (const skill of listed) {
    for (const entry of skill.resources) {
      const read = await ask(mcp, 'resources/read', { uri: entry.uri }, true);
      const [content] = read.result.contents;
      assert.equal(content.uri, entry.uri);
      assert.equal(content.mimeType, 'text/markdown');
      const bytes = Buffer.from(content.text, 'utf8');
      assert.equal(bytes.length, entry.size);
      assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, entry.digest);
    }
  }
  const resources = (await ask(mcp, 'resources/list', {}, false)).result.resources as Json[];
  assert.deepEqual(resources.map(resource => resource.uri), ['skill://unfold/SKILL.md', 'skill://link-work-item/SKILL.md']);
  assert.equal(resources[0]!.name, 'unfold');
  assert.equal(resources[0]!.description, listed[0]!.frontmatter.description);
  const missing = await ask(mcp, 'resources/read', { uri: 'skill://unfold/notes.md' }, true);
  assert.equal(missing.error.code, -32602);
  const withApps = await ask(mcp, 'resources/list', {}, true, appsCapabilities);
  assert.ok(withApps.result.resources.some((resource: Json) => resource.uri.startsWith('ui://')), 'MCP Apps clients keep the card resource');
  assert.ok(withApps.result.resources.some((resource: Json) => resource.uri === 'skill://unfold/SKILL.md'));
});

test('the served skills are only those that need nothing but Unfold\'s MCP tools', () => {
  assert.deepEqual([...servedSkillNames], ['unfold', 'link-work-item']);
  assert.ok(!servedSkillNames.includes('brief' as never), 'brief runs the plugin\'s own scripts through allowed-tools');
});

test('a changed skill file changes its digest and size; supporting files join the manifest; a name that differs from its directory fails at start-up', async t => {
  const root = await mkdtemp(join(tmpdir(), 'unfold-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'demo', 'references'), { recursive: true });
  await writeFile(join(root, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: "A demo: quoted"\n---\n\nFirst text.\n');
  await writeFile(join(root, 'demo', 'references', 'guide.md'), 'Guide.\n');
  const before = loadSkillCatalogue(root, ['demo']);
  assert.deepEqual(before.entries[0]!.frontmatter, { name: 'demo', description: 'A demo: quoted' });
  assert.deepEqual(before.entries[0]!.resources.map(resource => resource.uri), ['skill://demo/SKILL.md', 'skill://demo/references/guide.md']);
  await writeFile(join(root, 'demo', 'SKILL.md'), '---\nname: demo\ndescription: "A demo: quoted"\n---\n\nSecond, longer text.\n');
  const after = loadSkillCatalogue(root, ['demo']);
  assert.notEqual(after.entries[0]!.resources[0]!.digest, before.entries[0]!.resources[0]!.digest);
  assert.notEqual(after.entries[0]!.resources[0]!.size, before.entries[0]!.resources[0]!.size);
  assert.equal(after.entries[0]!.resources[1]!.digest, before.entries[0]!.resources[1]!.digest);
  await writeFile(join(root, 'demo', 'SKILL.md'), '---\nname: other\ndescription: x\n---\n');
  assert.throws(() => loadSkillCatalogue(root, ['demo']), /directory and the name must match/);
});

test('frontmatter that a one-line reader could misread is refused instead of served differently from the file', () => {
  assert.throws(() => skillFrontmatter('---\nname: demo\ndescription: >-\n  folded\n---\n', 'demo'), /one-line scalar|YAML parser/);
  assert.throws(() => skillFrontmatter('---\nname: demo\ndescription: a: b\n---\n', 'demo'), /YAML parser/);
  assert.throws(() => skillFrontmatter('no frontmatter', 'demo'), /does not begin with YAML frontmatter/);
  assert.deepEqual(skillFrontmatter('---\nname: demo\ndescription: \'it\'\'s\'\n---\n', 'demo'), { name: 'demo', description: 'it\'s' });
});
