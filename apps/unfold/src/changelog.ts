import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const changeTypes = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'] as const;
export type ChangeType = typeof changeTypes[number];
export const changeHeadings: Record<ChangeType, string> = { added: 'Added', changed: 'Changed', deprecated: 'Deprecated', removed: 'Removed', fixed: 'Fixed', security: 'Security' };

export type Change = { id: string; type: ChangeType; highlight: boolean; summary: string; details: string };
export type Release = { version: string; date: string | null; changes: Change[] };
export type Changelog = { releases: Release[]; unreleased: Change[] };
export type ReleasedIndex = { releases: { version: string; date: string | null; changes: string[] }[] };

export const releasedIndexName = 'released.json';
export const changesGuideName = 'README.md';
export const releasesUrl = 'https://github.com/unfold-hq/unfold/releases';
export const summaryLimit = 160;
const fragmentFile = /^([a-z0-9][a-z0-9-]{0,79})\.md$/;

export class FragmentError extends Error {}

/** The fragment id of `file`, or null when `file` is not a fragment's file name. */
export function fragmentId(file: string): string | null {
  if (file === changesGuideName) return null;
  return fragmentFile.exec(file)?.[1] ?? null;
}

/** Reads one release-note fragment: YAML-style front matter with `type` and an optional `highlight`, then a one-sentence summary paragraph and optional details. */
export function parseFragment(id: string, text: string): Change {
  const fail = (message: string) => { throw new FragmentError(`${id}.md: ${message}`); };
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n?/g, '\n'));
  if (!match) return fail('starts with front matter between two --- lines');
  const fields = new Map<string, string>();
  for (const line of match[1].split('\n').filter(line => line.trim())) {
    const field = /^([a-z]+):\s*(.*?)\s*$/.exec(line);
    if (!field) return fail(`cannot read the front matter line "${line}"`);
    if (!['type', 'highlight'].includes(field[1])) return fail(`knows no front matter field "${field[1]}"; use type and highlight`);
    fields.set(field[1], field[2]);
  }
  const type = fields.get('type') as ChangeType;
  if (!changeTypes.includes(type)) return fail(`type must be one of ${changeTypes.join(', ')}`);
  const highlight = fields.get('highlight') ?? 'false';
  if (!['true', 'false'].includes(highlight)) return fail('highlight must be true or false');
  const [first = '', ...rest] = match[2].trim().split(/\n\s*\n/);
  const summary = first.replace(/\s*\n\s*/g, ' ').trim();
  if (!summary) return fail('needs a summary paragraph after the front matter');
  if (/^(#|[-*+] |\d+\. )/.test(summary)) return fail('the summary is one plain sentence, not a heading or a list');
  if (summary.length > summaryLimit) return fail(`the summary is ${summary.length} characters; keep it to ${summaryLimit} and put the rest in a second paragraph`);
  return { id, type, highlight: highlight === 'true', summary, details: rest.join('\n\n').trim() };
}

/** Every fragment in `directory`, by id. Throws a FragmentError naming each file that is not a valid fragment. */
export function readFragments(directory: string): Map<string, Change> {
  const changes = new Map<string, Change>();
  if (!existsSync(directory)) return changes;
  const problems: string[] = [];
  for (const file of readdirSync(directory).sort()) {
    if (file === releasedIndexName || file === changesGuideName) continue;
    const id = fragmentId(file);
    if (!id) { problems.push(`${file}: a fragment is named <lowercase-words-with-dashes>.md`); continue; }
    try { changes.set(id, parseFragment(id, readFileSync(join(directory, file), 'utf8'))); }
    catch (error) { if (error instanceof FragmentError) problems.push(error.message); else throw error; }
  }
  if (problems.length) throw new FragmentError(problems.join('\n'));
  return changes;
}

const typeOrder = (change: Change) => changeTypes.indexOf(change.type);

/** `changes` in reading order: highlights first, then by Keep a Changelog section, then by id. */
export function ordered(changes: Change[]): Change[] {
  return [...changes].sort((a, b) => Number(b.highlight) - Number(a.highlight) || typeOrder(a) - typeOrder(b) || a.id.localeCompare(b.id));
}

/** Joins the fragments with the released index: each release lists the fragments its tag added, and the rest are unreleased. */
export function assemble(fragments: Map<string, Change>, index: ReleasedIndex | null): Changelog {
  const released = new Set<string>();
  const releases = (index?.releases ?? []).map(release => {
    const changes = release.changes.map(id => fragments.get(id)).filter((change): change is Change => Boolean(change));
    for (const change of changes) released.add(change.id);
    return { version: release.version, date: release.date, changes: ordered(changes) };
  });
  return { releases, unreleased: ordered([...fragments.values()].filter(change => !released.has(change.id))) };
}

/** The changelog of the fragments in `directory`, with the released index the release build wrote beside them when there is one. */
export function loadChangelog(directory: string): Changelog {
  const indexFile = join(directory, releasedIndexName);
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) as ReleasedIndex : null;
  return assemble(readFragments(directory), index);
}

function entry(change: Change): string {
  const details = change.details ? `\n\n${change.details.split('\n').map(line => line ? `  ${line}` : '').join('\n')}` : '';
  return `- ${change.summary}${details}`;
}

/** The Keep a Changelog sections for `changes`: a Highlights section with their details first, then one section per type. */
export function sectionsMarkdown(changes: Change[], level = 3): string {
  const hashes = '#'.repeat(level);
  const sections: string[] = [];
  const highlights = changes.filter(change => change.highlight);
  if (highlights.length) sections.push(`${hashes} Highlights\n\n${ordered(highlights).map(change => `- **${change.summary}**${change.details ? `\n\n${change.details.split('\n').map(line => line ? `  ${line}` : '').join('\n')}` : ''}`).join('\n')}`);
  for (const type of changeTypes) {
    const rest = changes.filter(change => change.type === type && !change.highlight);
    if (rest.length) sections.push(`${hashes} ${changeHeadings[type]}\n\n${ordered(rest).map(entry).join('\n')}`);
  }
  return sections.join('\n\n');
}

/** The whole changelog as a Keep a Changelog document, newest release first. */
export function changelogMarkdown(changelog: Changelog): string {
  const intro = `# Changelog\n\nAll notable changes to Unfold are written down here, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Unfold follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html); while it is 0.x every release candidate is listed. Each release on [GitHub](${releasesUrl}) also lists its commits.`;
  const unreleased = `## [Unreleased]\n\n${changelog.unreleased.length ? sectionsMarkdown(changelog.unreleased) : 'Nothing yet.'}`;
  const releases = changelog.releases.filter(release => release.changes.length).map(release => `## [${release.version}](${releasesUrl}/tag/unfold-v${release.version})${release.date ? ` - ${release.date.slice(0, 10)}` : ''}\n\n${sectionsMarkdown(release.changes)}`);
  return `${[intro, unreleased, ...releases].join('\n\n')}\n`;
}
