import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, opensByItself, unseenReleases, updateNoticeMarkup, whatsNewMarkup } from '../public/core/changelog.js';

const note = (id, type, highlight = false) => ({ id, type, highlight, summary: `Summary of ${id}.`, details: highlight ? `Details of ${id}.` : '' });
const changelog = {
  version: '0.4.0-rc.12',
  releases: [
    { version: '0.4.0-rc.13', date: '2026-11-19T10:00:00Z', changes: [note('future', 'added', true)] },
    { version: '0.4.0-rc.12', date: '2026-11-18T10:00:00Z', changes: [note('fix', 'fixed')] },
    { version: '0.4.0-rc.11', date: '2026-11-17T10:00:00Z', changes: [] },
    { version: '0.4.0-rc.10', date: '2026-11-16T10:00:00Z', changes: [note('big', 'added', true)] },
    { version: '0.4.0-rc.9', date: '2026-11-15T10:00:00Z', changes: [note('old', 'changed')] },
  ],
  unreleased: [],
};

test('versions order numerically, and a release candidate comes before its release', () => {
  const sorted = ['0.4.0', '0.4.0-rc.10', '0.10.0', '0.4.0-rc.9', '0.4.1-rc.1', 'unknown'].sort(compareVersions);
  assert.deepEqual(sorted, ['unknown', '0.4.0-rc.9', '0.4.0-rc.10', '0.4.0', '0.4.1-rc.1', '0.10.0']);
  assert.equal(compareVersions('0.4.0-rc.2', '0.4.0-rc.2'), 0);
});

test('unread releases are those with notes after the last one seen, up to the running version', () => {
  assert.deepEqual(unseenReleases(changelog, '0.4.0-rc.9').map(release => release.version), ['0.4.0-rc.12', '0.4.0-rc.10']);
  assert.deepEqual(unseenReleases(changelog, '0.4.0-rc.12'), []);
  assert.deepEqual(unseenReleases(changelog, null), [], 'someone who never opened Unfold here has nothing unread');
});

test('What’s new opens by itself only for an unread highlight', () => {
  assert.equal(opensByItself(changelog, '0.4.0-rc.9'), true);
  assert.equal(opensByItself(changelog, '0.4.0-rc.10'), false, 'a fix alone shows the dot and does not interrupt');
  assert.equal(opensByItself(changelog, null), false);
});

test('the dialog marks unread releases New, leaves out releases without notes and newer than the running version, and escapes notes', () => {
  const html = whatsNewMarkup({ ...changelog, releases: [...changelog.releases, { version: '0.4.0-rc.8', date: null, changes: [{ ...note('x', 'fixed'), summary: '<b>bold</b>' }] }] }, '0.4.0-rc.9');
  assert.equal((html.match(/whats-new-badge/g) ?? []).length, 2);
  assert.doesNotMatch(html, /rc\.13|rc\.11/);
  assert.match(html, /Details of big\./);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(html, /<h4 class="whats-new-type">Fixed<\/h4>/);
  assert.match(whatsNewMarkup({ version: '0.1.0', releases: [], unreleased: [] }, null), /No release notes yet/);
  assert.match(whatsNewMarkup({ version: '0.1.0', releases: [], unreleased: [note('next', 'added')] }, null), /Not released yet/);
});

test('the update notice names the deployed version and offers a reload', () => {
  const html = updateNoticeMarkup('0.4.0-rc.13');
  assert.match(html, /0\.4\.0-rc\.13/);
  assert.match(html, /data-action="reload-app"/);
  assert.match(html, /data-action="dismiss-update"/);
});
