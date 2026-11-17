import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { prefs } from '../core/prefs.js';
import { icon } from '../core/icons.js';
import { opensByItself, unseenReleases, updateNoticeMarkup, whatsNewMarkup } from '../core/changelog.js';

const updateCheckMs = 5 * 60_000;
const listeners = new Set();
let changelog = null;
let dismissedVersion = null;
let offeredVersion = null;
let watching = false;

function changed() { for (const listener of listeners) { try { listener(); } catch {} } }

/** Calls `listener` whenever the unread state of What's new changes. */
export function onWhatsNew(listener) { listeners.add(listener); return () => listeners.delete(listener); }

/** How many releases with notes this person has not read on this browser. */
export function unreadReleases() { return unseenReleases(changelog, prefs.get('seenVersion')).length; }

function markSeen() {
  if (!changelog?.version) return;
  prefs.set('seenVersion', changelog.version);
  changed();
}

function openWhatsNew() {
  const dialog = document.getElementById('whats-new');
  if (!dialog || dialog.open || !changelog) return;
  dialog.innerHTML = whatsNewMarkup(changelog, prefs.get('seenVersion'));
  dialog.addEventListener('close', markSeen, { once: true });
  dialog.showModal();
}

async function loadChangelog() {
  try { changelog = await api('/api/changelog'); } catch { changelog = null; return; }
  if (!prefs.get('seenVersion')) { markSeen(); return; }
  changed();
  if (opensByItself(changelog, prefs.get('seenVersion')) && !document.querySelector('dialog[open]')) openWhatsNew();
}

function showUpdate(version) {
  const notice = document.getElementById('update-notice');
  if (!notice) return;
  notice.innerHTML = `<div class="toast" data-tone="info" role="status">${icon('info')}${updateNoticeMarkup(version)}</div>`;
  notice.hidden = false;
}

function hideUpdate() {
  const notice = document.getElementById('update-notice');
  if (notice) { notice.hidden = true; notice.innerHTML = ''; }
}

async function checkForUpdate() {
  if (!state.bootstrap?.version || document.visibilityState !== 'visible') return;
  let deployed;
  try { deployed = (await api('/api/health')).version; } catch { return; }
  if (typeof deployed !== 'string' || deployed === state.bootstrap.version || deployed === dismissedVersion) return;
  offeredVersion = deployed;
  showUpdate(deployed);
}

/** Loads the release notes after sign-in and starts watching for a newer deploy than the one this page runs. */
export function startWhatsNew() {
  void loadChangelog();
  if (watching) return;
  watching = true;
  setInterval(() => { void checkForUpdate(); }, updateCheckMs);
  document.addEventListener('visibilitychange', () => { void checkForUpdate(); });
}

/** What's new: the dialog behind the sidebar version, and the notice that offers a reload after a deploy. */
export default {
  id: 'whats-new',
  actions: {
    'whats-new-open': () => openWhatsNew(),
    'reload-app': () => location.reload(),
    'dismiss-update': () => { dismissedVersion = offeredVersion; hideUpdate(); },
  },
};
