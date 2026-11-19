import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The MCP Skills extension (SEP-2640) that `unfold-mcp` serves while the `mcp.skills` flag is on for the person. */
export const mcpSkillsExtension = 'io.modelcontextprotocol/skills';

/** Where the Unfold plugin ships its skills; `unfold-mcp` serves these same files, so the two never drift. */
export const pluginSkillsRoot = fileURLToPath(new URL('../extensions/claude-code/skills/', import.meta.url));

/** The plugin skills that need nothing but Unfold's MCP tools, so a client without the plugin can follow them. */
export const servedSkillNames = ['unfold', 'link-work-item'] as const;

export type SkillResource = { uri: string; digest: string; size: number };
export type SkillEntry = { uri: string; frontmatter: { name: string; description: string; [field: string]: string }; resources: SkillResource[] };
type SkillFile = SkillResource & { text: string; mimeType: string };
export type SkillCatalogue = { entries: SkillEntry[]; files: Map<string, SkillFile> };

const maxResources = 512;
const maxBytes = 16_777_216;
const scalarLine = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]+(.*)$/;

export function skillFrontmatter(text: string, where: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error(`${where} does not begin with YAML frontmatter.`);
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const field = scalarLine.exec(line);
    if (!field) throw new Error(`${where} frontmatter line ${JSON.stringify(line)} is not a one-line scalar, which unfold-mcp serves verbatim only.`);
    fields[field[1]!] = scalar(field[2]!.trimEnd(), where);
  }
  return fields;
}

function scalar(raw: string, where: string): string {
  if (raw.startsWith('"')) return JSON.parse(raw) as string;
  if (raw.startsWith('\'') && raw.endsWith('\'') && raw.length > 1) return raw.slice(1, -1).replaceAll('\'\'', '\'');
  if (/^[>|&*!%@`[{]/.test(raw) || / #|: /.test(raw)) throw new Error(`${where} frontmatter value ${JSON.stringify(raw)} needs a YAML parser; quote it.`);
  return raw;
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

const mimeTypes: Record<string, string> = { md: 'text/markdown', json: 'application/json', txt: 'text/plain', mjs: 'text/javascript', js: 'text/javascript', ts: 'text/plain', sh: 'text/x-shellscript', yaml: 'application/yaml', yml: 'application/yaml' };

/** Reads the served skills from `root` and digests every file's raw bytes; a skill that breaks SEP-2640 fails here, at start-up. */
export function loadSkillCatalogue(root = pluginSkillsRoot, names: readonly string[] = servedSkillNames): SkillCatalogue {
  const entries: SkillEntry[] = [];
  const files = new Map<string, SkillFile>();
  for (const name of names) {
    const directory = join(root, name);
    const paths = filesUnder(directory);
    if (!paths.includes('SKILL.md')) throw new Error(`Skill ${name} has no SKILL.md in ${directory}.`);
    const resources: SkillResource[] = [];
    for (const path of ['SKILL.md', ...paths.filter(path => path !== 'SKILL.md')]) {
      const bytes = readFileSync(join(directory, path));
      const text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`Skill file ${name}/${path} is not UTF-8 text.`);
      const resource = { uri: `skill://${name}/${path}`, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, size: bytes.length };
      resources.push(resource);
      files.set(resource.uri, { ...resource, text, mimeType: mimeTypes[path.split('.').pop()!.toLowerCase()] ?? 'text/plain' });
    }
    const frontmatter = skillFrontmatter(files.get(`skill://${name}/SKILL.md`)!.text, `${name}/SKILL.md`);
    if (frontmatter.name !== name) throw new Error(`Skill ${name}/SKILL.md names itself ${JSON.stringify(frontmatter.name)}; the directory and the name must match.`);
    if (!frontmatter.description) throw new Error(`Skill ${name}/SKILL.md has no description.`);
    if (resources.length > maxResources || resources.reduce((total, resource) => total + resource.size, 0) > maxBytes) throw new Error(`Skill ${name} exceeds the SEP-2640 limits of ${maxResources} files or ${maxBytes} bytes.`);
    entries.push({ uri: `skill://${name}/SKILL.md`, frontmatter: frontmatter as SkillEntry['frontmatter'], resources });
  }
  return { entries, files };
}

/** The catalogue `unfold-mcp` serves, read once when the module loads. */
export const skillCatalogue = loadSkillCatalogue();

/** The `resources/list` rows for every served skill file, `SKILL.md` named and described from its frontmatter. */
export function skillResourceList(catalogue: SkillCatalogue = skillCatalogue) {
  return catalogue.entries.flatMap(entry => entry.resources.map(resource => {
    const file = catalogue.files.get(resource.uri)!;
    const path = resource.uri.slice(entry.uri.length - 'SKILL.md'.length);
    return resource.uri === entry.uri
      ? { uri: resource.uri, name: entry.frontmatter.name, description: entry.frontmatter.description, mimeType: file.mimeType, size: file.size }
      : { uri: resource.uri, name: path, mimeType: file.mimeType, size: file.size };
  }));
}

/** The `resources/read` contents of one served skill file, or undefined when `uri` names none. */
export function readSkillResource(uri: unknown, catalogue: SkillCatalogue = skillCatalogue) {
  const file = typeof uri === 'string' ? catalogue.files.get(uri) : undefined;
  return file ? [{ uri: file.uri, mimeType: file.mimeType, text: file.text }] : undefined;
}

/** The SEP-2640 entry of the skill whose `SKILL.md` is `uri`, or undefined when `uri` names no served skill. */
export function skillEntry(uri: unknown, catalogue: SkillCatalogue = skillCatalogue): SkillEntry | undefined {
  return catalogue.entries.find(entry => entry.uri === uri);
}
