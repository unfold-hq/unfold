'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { RELEASE_NOTES_PLUGIN } = require(process.env.UNFOLD_RELEASE_CONFIG || path.join(__dirname, 'release-config'));

const CHANGELOG_SCRIPT = path.join(__dirname, '../apps/unfold/scripts/changelog.ts');
const NO_NOTES = 'Nothing in this release changes Unfold for the people who use it: it holds maintenance, dependency or internal work only.';

function fragmentNotes(context) {
  const from = context.lastRelease?.gitTag || '';
  const to = context.nextRelease?.gitHead || 'HEAD';
  return execFileSync(process.execPath, [CHANGELOG_SCRIPT, 'notes', '--from', from, '--to', to], { cwd: context.cwd, encoding: 'utf8' }).trim();
}

/**
 * Puts the release notes people read first, from the fragments in apps/unfold/changes, under the release heading,
 * and folds the commit list the conventional-commit notes produce into a Commits disclosure below them.
 */
function compose(commitNotes, fragments) {
  const [heading, ...rest] = String(commitNotes).trim().split('\n');
  const commits = rest.join('\n').trim();
  const sections = [heading, fragments || NO_NOTES];
  if (commits) sections.push(`<details>\n<summary>Commits</summary>\n\n${commits}\n\n</details>`);
  return `${sections.join('\n\n')}\n`;
}

async function generateNotes(pluginConfig, context) {
  const commitNotes = await require(RELEASE_NOTES_PLUGIN).generateNotes(pluginConfig, context);
  return compose(commitNotes, fragmentNotes(context));
}

module.exports = { generateNotes, compose };
