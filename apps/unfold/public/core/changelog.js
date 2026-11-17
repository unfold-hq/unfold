import { escape } from './dom.js';
import { date } from './format.js';
import { markdown } from './markdown.js';
import { button } from './ui.js';

/** Where every release, with its commits, is listed. */
export const releasesUrl = 'https://github.com/unfold-hq/unfold/releases';

const headings = { added: 'Added', changed: 'Changed', deprecated: 'Deprecated', removed: 'Removed', fixed: 'Fixed', security: 'Security' };
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function identifiers(text) {
  return text.split('.').map(part => /^\d+$/.test(part) ? Number(part) : part);
}

/**
 * Orders two semantic versions: negative when `a` is older, positive when newer, 0 when equal. A release candidate
 * comes before its release, and `rc.10` after `rc.9`. A version that is not semantic sorts before every other.
 */
export function compareVersions(a, b) {
  const left = versionPattern.exec(String(a ?? ''));
  const right = versionPattern.exec(String(b ?? ''));
  if (!left || !right) return (left ? 1 : 0) - (right ? 1 : 0);
  for (const index of [1, 2, 3]) { const difference = Number(left[index]) - Number(right[index]); if (difference) return difference; }
  if (!left[4] || !right[4]) return (left[4] ? -1 : 0) - (right[4] ? -1 : 0);
  const [x, y] = [identifiers(left[4]), identifiers(right[4])];
  for (let index = 0; index < Math.max(x.length, y.length); index++) {
    if (x[index] === undefined) return -1;
    if (y[index] === undefined) return 1;
    if (x[index] === y[index]) continue;
    if (typeof x[index] === 'number' && typeof y[index] === 'number') return x[index] - y[index];
    if (typeof x[index] === 'number') return -1;
    if (typeof y[index] === 'number') return 1;
    return x[index] < y[index] ? -1 : 1;
  }
  return 0;
}

/** The releases with notes that are newer than `seen` and not newer than the running version. None when `seen` is unknown. */
export function unseenReleases(changelog, seen) {
  if (!changelog || !seen) return [];
  return changelog.releases.filter(release => release.changes.length && compareVersions(release.version, seen) > 0 && compareVersions(release.version, changelog.version) <= 0);
}

/** Whether the unread releases hold a highlight, the only kind of note that opens What's new by itself. */
export function opensByItself(changelog, seen) {
  return unseenReleases(changelog, seen).some(release => release.changes.some(change => change.highlight));
}

function note(change) {
  const details = change.details ? `<div class="whats-new-details" data-private>${markdown(change.details, { baseLevel: 5 })}</div>` : '';
  return `<li class="whats-new-note${change.highlight ? ' is-highlight' : ''}"><p class="whats-new-summary">${escape(change.summary)}</p>${change.highlight ? details : ''}</li>`;
}

function notes(changes) {
  const highlights = changes.filter(change => change.highlight);
  const groups = Object.entries(headings).map(([type, heading]) => [heading, changes.filter(change => change.type === type && !change.highlight)]).filter(([, list]) => list.length);
  return `${highlights.length ? `<ul class="whats-new-list is-highlights">${highlights.map(note).join('')}</ul>` : ''}${groups.map(([heading, list]) => `<h4 class="whats-new-type">${escape(heading)}</h4><ul class="whats-new-list">${list.map(note).join('')}</ul>`).join('')}`;
}

function release(entry, fresh) {
  const when = entry.date ? `<time datetime="${escape(entry.date)}">${escape(date(entry.date))}</time>` : '';
  const link = `${releasesUrl}/tag/unfold-v${encodeURIComponent(entry.version)}`;
  return `<section class="whats-new-release${fresh ? ' is-new' : ''}" aria-label="Unfold ${escape(entry.version)}"><h3 class="whats-new-version"><a href="${escape(link)}" target="_blank" rel="noopener noreferrer" class="num">${escape(entry.version)}</a>${fresh ? '<span class="whats-new-badge">New</span>' : ''}${when}</h3>${notes(entry.changes)}</section>`;
}

/** The What's new dialog: unread releases first and marked New, then earlier ones, then notes not released yet. */
export function whatsNewMarkup(changelog, seen) {
  const fresh = new Set(unseenReleases(changelog, seen).map(entry => entry.version));
  const releases = (changelog?.releases ?? []).filter(entry => entry.changes.length && compareVersions(entry.version, changelog.version) <= 0);
  const unreleased = changelog?.unreleased?.length ? `<section class="whats-new-release is-unreleased" aria-label="Not released yet"><h3 class="whats-new-version">Not released yet</h3>${notes(changelog.unreleased)}</section>` : '';
  const lead = fresh.size ? `Here is what changed since you last looked. You are on <span class="num">${escape(changelog.version)}</span>.` : `You are on Unfold <span class="num">${escape(changelog?.version ?? '')}</span>.`;
  const body = releases.length || unreleased ? `${releases.map(entry => release(entry, fresh.has(entry.version))).join('')}${unreleased}` : '<p class="whats-new-empty">No release notes yet. Every release is listed with its commits on GitHub.</p>';
  return `<form method="dialog" class="whats-new-form"><header class="dialog-header"><h2 id="whats-new-title">What’s new in Unfold</h2>${button({ icon: 'x', variant: 'ghost', size: 'sm', type: 'submit', ariaLabel: 'Close what’s new', title: 'Close' })}</header><div class="dialog-body"><p class="whats-new-lead">${lead}</p>${body}</div><footer class="dialog-footer">${button({ label: 'All releases on GitHub', variant: 'ghost', href: releasesUrl, external: true })}${button({ label: 'Got it', variant: 'primary', type: 'submit', autofocus: true })}</footer></form>`;
}

/** The notice that a newer version is deployed than the one this page runs. */
export function updateNoticeMarkup(version) {
  return `<span class="toast-message">Unfold <span class="num">${escape(version)}</span> is deployed. Reload to use it.</span><div class="toast-actions">${button({ label: 'Reload', size: 'sm', action: 'reload-app' })}${button({ label: 'Later', variant: 'ghost', size: 'sm', action: 'dismiss-update' })}</div>`;
}
