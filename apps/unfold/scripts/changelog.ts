import { execFileSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { assemble, changelogMarkdown, FragmentError, fragmentId, parseFragment, readFragments, releasedIndexName, sectionsMarkdown, type Change, type ReleasedIndex } from '../src/changelog.ts';

const appDirectory = fileURLToPath(new URL('..', import.meta.url));
const changesDirectory = join(appDirectory, 'changes');
const releaseTag = /^unfold-v(\d+\.\d+\.\d+(?:-rc\.\d+)?)$/;
const exemptScopes = new Set(['deps', 'ploeg', 'ci', 'test', 'tests', 'docs', 'release', 'site']);
const optOut = /^Release-Note:\s*none\s*$/im;

const git = (...args: string[]) => execFileSync('git', args, { cwd: appDirectory, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const appPath = () => git('rev-parse', '--show-prefix').trim().replace(/\/$/, '');
const changesPath = () => `${appPath()}/changes`;

function addedFragments(from: string | null, to: string): string[] {
  const listing = from
    ? git('diff', '--name-only', '--no-renames', '--diff-filter=A', from, to, '--', `:(top)${changesPath()}`)
    : git('ls-tree', '-r', '--name-only', to, '--', `:(top)${changesPath()}`);
  return listing.split('\n').map(path => fragmentId(path.split('/').pop() ?? '')).filter((id): id is string => Boolean(id)).sort();
}

/** The Unfold release tags reachable from `head`, oldest first. */
export function releaseTags(head = 'HEAD'): { tag: string; version: string; date: string | null }[] {
  return git('for-each-ref', '--merged', head, '--sort=creatordate', '--format=%(refname:short)%09%(creatordate:iso-strict)', 'refs/tags/unfold-v*')
    .split('\n').filter(Boolean).map(line => line.split('\t'))
    .filter(([tag]) => releaseTag.test(tag))
    .map(([tag, date]) => ({ tag, version: releaseTag.exec(tag)![1], date: date || null }));
}

/** Which fragments each release tag added, newest release first: the index the release build ships beside the fragments. */
export function resolveReleases(head = 'HEAD'): ReleasedIndex {
  const tags = releaseTags(head);
  const releases = tags.map((current, position) => ({ version: current.version, date: current.date, changes: addedFragments(tags[position - 1]?.tag ?? null, current.tag) }));
  return { releases: releases.reverse() };
}

function fragmentAt(ref: string, id: string): Change {
  return parseFragment(id, git('show', `${ref}:${changesPath()}/${id}.md`));
}

/** The release notes of the fragments added after `from` up to `to`, read as they are at `to`. */
export function releaseNotes(from: string | null, to: string): string {
  const changes = addedFragments(from, to).map(id => fragmentAt(to, id));
  return changes.length ? sectionsMarkdown(changes) : '';
}

const conventional = /^(\w+)(?:\(([^)]*)\))?(!)?: /;

/** Why the commits after `base` need a release-note fragment and add none, or null when they are fine. */
export function missingFragment(base: string, head = 'HEAD'): string | null {
  if (addedFragments(base, head).length) return null;
  const log = git('log', '--no-merges', '--format=%H%x1f%B%x1e', `${base}..${head}`, '--', `:(top)${appPath()}`);
  const commits = log.split('\x1e').map(entry => entry.trim()).filter(Boolean).map(entry => { const [hash, message] = entry.split('\x1f'); return { hash, message }; });
  if (commits.some(commit => optOut.test(commit.message))) return null;
  const userFacing = commits.filter(commit => {
    const [, type, scope, breaking] = conventional.exec(commit.message) ?? [];
    return breaking === '!' || (['feat', 'fix', 'perf'].includes(type) && !exemptScopes.has(scope ?? ''));
  });
  if (!userFacing.length) return null;
  return `${userFacing.map(commit => `${commit.hash.slice(0, 9)} ${commit.message.split('\n')[0]}`).join('\n')}\n\nThese commits change Unfold for the people who use it, and no release-note fragment is added in apps/unfold/changes/. Add one (see apps/unfold/changes/README.md), or add the trailer "Release-Note: none" to a commit message when nobody using Unfold notices the change.`;
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

function main(args: string[]): number {
  const [command] = args;
  try {
    if (command === 'check') { const count = readFragments(changesDirectory).size; console.log(`${count} release-note fragment${count === 1 ? '' : 's'} read.`); return 0; }
    if (command === 'resolve') { const out = option(args, '--out') ?? join(changesDirectory, releasedIndexName); writeFileSync(out, `${JSON.stringify(resolveReleases(), null, 2)}\n`); console.log(`Wrote ${relative(process.cwd(), out)}.`); return 0; }
    if (command === 'notes') { process.stdout.write(releaseNotes(option(args, '--from') || null, option(args, '--to') ?? 'HEAD')); return 0; }
    if (command === 'markdown') { process.stdout.write(changelogMarkdown(assemble(readFragments(changesDirectory), resolveReleases()))); return 0; }
    if (command === 'require') {
      const base = option(args, '--base');
      if (!base) { console.error('require needs --base <commit>.'); return 2; }
      const problem = missingFragment(base, option(args, '--head') ?? 'HEAD');
      if (problem) { console.error(problem); return 1; }
      console.log('Release notes: nothing user-facing is missing a fragment.');
      return 0;
    }
  } catch (error) {
    if (error instanceof FragmentError) { console.error(error.message); return 1; }
    throw error;
  }
  console.error('Usage: changelog.ts check | resolve [--out <file>] | notes [--from <ref>] [--to <ref>] | markdown | require --base <commit> [--head <commit>]');
  return 2;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) process.exitCode = main(process.argv.slice(2));
