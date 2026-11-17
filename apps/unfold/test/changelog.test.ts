import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, changelogMarkdown, FragmentError, loadChangelog, parseFragment, readFragments, sectionsMarkdown } from '../src/changelog.ts';

const fragment = (front: string, body: string) => `---\n${front}\n---\n${body}\n`;

test('a fragment carries a Keep a Changelog type, an optional highlight, a one-sentence summary and optional details', () => {
  assert.deepEqual(parseFragment('dialog', fragment('type: added\nhighlight: true', 'See what changed.\n\nA dot shows\nunread notes.')), { id: 'dialog', type: 'added', highlight: true, summary: 'See what changed.', details: 'A dot shows\nunread notes.' });
  assert.deepEqual(parseFragment('fix', fragment('type: fixed', 'Spend no longer\nshows as zero.')), { id: 'fix', type: 'fixed', highlight: false, summary: 'Spend no longer shows as zero.', details: '' });
});

test('a fragment that a release could not show is refused with the file and the reason', () => {
  const refused = (text: string, reason: RegExp) => assert.throws(() => parseFragment('note', text), (error: unknown) => error instanceof FragmentError && error.message.startsWith('note.md: ') && reason.test(error.message));
  refused('type: added\n\nNo front matter.', /front matter/);
  refused(fragment('type: feature', 'A summary.'), /type must be one of/);
  refused(fragment('type: added\nhighlight: yes', 'A summary.'), /highlight must be true or false/);
  refused(fragment('type: added\nscope: ui', 'A summary.'), /knows no front matter field "scope"/);
  refused(fragment('type: added', ''), /needs a summary/);
  refused(fragment('type: added', '- A list item.'), /one plain sentence/);
  refused(fragment('type: added', 'x'.repeat(161)), /161 characters/);
});

test('the fragment directory reads every fragment and skips its guide and the released index', () => {
  const directory = mkdtempSync(join(tmpdir(), 'unfold-changes-'));
  writeFileSync(join(directory, 'README.md'), '# Release notes\n');
  writeFileSync(join(directory, 'released.json'), JSON.stringify({ releases: [{ version: '0.4.0-rc.2', date: '2026-11-18T10:00:00Z', changes: ['b'] }, { version: '0.4.0-rc.1', date: '2026-11-17T10:00:00Z', changes: [] }] }));
  writeFileSync(join(directory, 'a.md'), fragment('type: fixed', 'A fix.'));
  writeFileSync(join(directory, 'b.md'), fragment('type: added', 'A feature.'));
  const changelog = loadChangelog(directory);
  assert.deepEqual(changelog.releases.map(release => [release.version, release.changes.map(change => change.id)]), [['0.4.0-rc.2', ['b']], ['0.4.0-rc.1', []]]);
  assert.deepEqual(changelog.unreleased.map(change => change.id), ['a']);
  writeFileSync(join(directory, 'Bad Name.md'), fragment('type: fixed', 'A fix.'));
  assert.throws(() => readFragments(directory), /Bad Name\.md: a fragment is named/);
});

test('release notes put highlights with their details first, then one Keep a Changelog section per type', () => {
  const changes = [parseFragment('z', fragment('type: fixed', 'A fix.\n\nWhy it broke.')), parseFragment('a', fragment('type: added\nhighlight: true', 'A big one.\n\nHow to use it.')), parseFragment('b', fragment('type: added', 'A small one.'))];
  assert.equal(sectionsMarkdown(changes), '### Highlights\n\n- **A big one.**\n\n  How to use it.\n\n### Added\n\n- A small one.\n\n### Fixed\n\n- A fix.\n\n  Why it broke.');
  const document = changelogMarkdown(assemble(new Map(changes.map(change => [change.id, change])), { releases: [{ version: '0.4.0-rc.2', date: '2026-11-18T10:00:00+01:00', changes: ['a', 'b', 'z'] }, { version: '0.4.0-rc.1', date: null, changes: [] }] }));
  assert.match(document, /^# Changelog\n/);
  assert.match(document, /## \[Unreleased\]\n\nNothing yet\./);
  assert.match(document, /## \[0\.4\.0-rc\.2\]\(https:\/\/github\.com\/unfold-hq\/unfold\/releases\/tag\/unfold-v0\.4\.0-rc\.2\) - 2026-11-18/);
  assert.doesNotMatch(document, /0\.4\.0-rc\.1/);
});

test('the fragments in the repository are valid', () => {
  assert.ok(readFragments(fileURLToPath(new URL('../changes', import.meta.url))).size > 0);
});

test('each release lists the fragments its tag added, and a pull request that changes Unfold for people needs one', () => {
  const root = mkdtempSync(join(tmpdir(), 'unfold-release-notes-'));
  const app = join(root, 'apps', 'unfold');
  mkdirSync(join(app, 'changes'), { recursive: true });
  mkdirSync(join(app, 'scripts'), { recursive: true });
  mkdirSync(join(app, 'src'), { recursive: true });
  writeFileSync(join(app, 'scripts', 'changelog.ts'), readFileSync(new URL('../scripts/changelog.ts', import.meta.url)));
  writeFileSync(join(app, 'src', 'changelog.ts'), readFileSync(new URL('../src/changelog.ts', import.meta.url)));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
  const script = (...args: string[]) => { try { return { status: 0, out: execFileSync(process.execPath, [join(app, 'scripts', 'changelog.ts'), ...args], { cwd: app, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (error: any) { return { status: error.status as number, out: `${error.stdout}${error.stderr}` }; } };
  git('init', '-q', '-b', 'development');
  git('add', '.'); git('commit', '-q', '-m', 'chore: start');
  git('tag', 'unfold-v0.4.0-rc.1');
  const base = git('rev-parse', 'HEAD').trim();
  writeFileSync(join(app, 'src', 'feature.ts'), 'export const feature = 1;\n');
  git('add', '.'); git('commit', '-q', '-m', 'feat(ui): add a feature');
  assert.equal(script('require', '--base', base).status, 1);
  writeFileSync(join(app, 'changes', 'feature.md'), fragment('type: added\nhighlight: true', 'A feature.'));
  git('add', '.'); git('commit', '-q', '-m', 'docs: note the feature');
  assert.equal(script('require', '--base', base).status, 0);
  assert.equal(script('notes', '--from', 'unfold-v0.4.0-rc.1', '--to', 'HEAD').out, '### Highlights\n\n- **A feature.**');
  git('tag', 'unfold-v0.4.0-rc.2');
  writeFileSync(join(app, 'src', 'fix.ts'), 'export const fix = 1;\n');
  git('add', '.'); git('commit', '-q', '-m', 'fix(ui): tidy an internal name\n\nRelease-Note: none');
  assert.equal(script('require', '--base', 'unfold-v0.4.0-rc.2').status, 0);
  writeFileSync(join(app, 'src', 'deps.ts'), 'export const deps = 1;\n');
  git('add', '.'); git('commit', '-q', '-m', 'fix(deps): update a dependency');
  assert.equal(script('require', '--base', 'HEAD~1').status, 0);
  assert.equal(script('resolve').status, 0);
  const index = JSON.parse(readFileSync(join(app, 'changes', 'released.json'), 'utf8'));
  assert.deepEqual(index.releases.map((release: { version: string; changes: string[] }) => [release.version, release.changes]), [['0.4.0-rc.2', ['feature']], ['0.4.0-rc.1', []]]);
});
