import { handBackDialogMarkup, mayTakeOn, takeOnLists, takeOnMarkup } from '../take-on.js';
import { approveDialogMarkup } from '../ploeg-activity.js';
import { cancelDialogMarkup, cancelSummary } from '../ploeg.js';
import { handBackOffer } from '../core/take-over.js';
import { state, onForget } from '../core/state.js';
import { api } from '../core/api.js';
import { $, renderHtml, notify, announce } from '../core/dom.js';
import { live } from '../core/live.js';
import { applyNowCounts, refreshCounts } from '../core/counts.js';
import { shell } from '../shell.js';
import { enterPloegView, liveRefresh, onPloegReload, openPloegDialog, ploegFailure, ploegHelpers, ploegVisible, refreshButton, settle, track } from './ploeg-common.js';
import { fieldError } from './dialogs.js';

const view = { data: null, error: null, loading: false, request: 0, busy: '' };
onForget(() => Object.assign(view, { data: null, error: null, loading: false, request: view.request + 1, busy: '' }));

const user = () => state.bootstrap?.user ?? null;
const demo = () => Boolean(view.data?.demo || state.bootstrap?.mode === 'demo');

function renderTakeOn() {
  const actions = refreshButton({ busy: view.loading, shown: Boolean(view.data) || !view.error });
  renderHtml(shell(takeOnMarkup(view, user()), { title: 'Take on', subtitle: 'Proposed, taken-over and running work you can approve, hand back or stop.', actions }));
}

const signature = () => JSON.stringify([view.data?.waiting, view.data?.active, view.data?.errors, view.error]);

async function read(quiet) {
  const request = ++view.request;
  view.loading = !quiet;
  if (!quiet && ploegVisible('take-on')) renderTakeOn();
  const before = signature();
  try {
    const data = await api('/api/ploeg/now?refresh=1');
    if (request !== view.request) return false;
    Object.assign(view, { data, error: null });
    applyNowCounts(data);
    live.touch('take-on');
  } catch (failure) {
    if (request !== view.request) return false;
    view.error = ploegFailure(failure);
  } finally {
    if (request === view.request) view.loading = false;
  }
  if (ploegVisible('take-on') && (!quiet || signature() !== before) && !$('#confirm-dialog')?.open) renderTakeOn();
  return true;
}

const load = () => track('take-on', read(false));

async function poll() {
  if (view.busy) return settle('take-on');
  await read(true);
}

const find = (kind, id) => takeOnLists(view.data)[kind].find(item => String(item.id) === id);

function focusRow(id) {
  const target = document.getElementById(`take-on-${id}-title`)?.querySelector('a') ?? document.getElementById('page-title');
  target?.focus({ preventScroll: false });
}

async function after(id) {
  view.busy = '';
  refreshCounts().catch(() => {});
  if (ploegVisible('take-on')) { await load(); focusRow(id); }
}

async function approve(entry) {
  view.busy = entry.id;
  try {
    const result = await api(`/api/ploeg/work-items/${encodeURIComponent(entry.id)}/approve`, { method: 'POST', body: '{}' });
    const message = result.demo ? 'Recorded in this demo only. Nothing was dispatched.' : `Approved. Ploeg queued “${entry.title || `Work Item ${entry.id}`}” for the ${result.team || entry.team} Team.`;
    notify(message);
    announce(message);
  } catch (failure) { notify(failure.message, true); }
  await after(entry.id);
}

function confirmApprove(button) {
  const entry = find('approve', button.dataset.id);
  if (!entry || view.busy || !mayTakeOn(user())) return;
  const dialog = openPloegDialog(approveDialogMarkup(entry, demo(), ploegHelpers()));
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'confirm') void track('take-on', approve(entry));
    else document.getElementById(button.id)?.focus();
  }, { once: true });
}

async function readDetail(button) {
  button.setAttribute('aria-busy', 'true');
  try { return await api(`/api/ploeg/work-items/${encodeURIComponent(button.dataset.id)}?refresh=1`); }
  catch (failure) { notify(failure.message || 'Ploeg did not answer.', true); return null; }
  finally { button.removeAttribute('aria-busy'); }
}

async function openHandBack(button) {
  const entry = find('handBack', button.dataset.id);
  if (!entry || view.busy || !mayTakeOn(user())) return;
  const detail = await readDetail(button);
  if (!detail || !ploegVisible('take-on') || $('#confirm-dialog')?.open) return;
  const dialog = openPloegDialog(handBackDialogMarkup(detail, handBackOffer(detail, user()) ?? { enabled: false, reason: 'Ploeg no longer reports this Work Item as taken over. Refresh to see where it stands.' }));
  dialog.addEventListener('close', () => { if (!view.busy) document.getElementById(button.id)?.focus(); }, { once: true });
}

async function submitHandBack(data, form) {
  const id = form.dataset.id;
  const note = String(data.note ?? '').trim();
  if (note.length > 4096) { fieldError(form, 'take-on-hand-back-note', 'A note is at most 4096 characters.'); return; }
  if (!id || view.busy) return;
  view.busy = id;
  form.closest('dialog')?.close();
  try {
    const result = await api(`/api/ploeg/work-items/${encodeURIComponent(id)}/hand-back`, { method: 'POST', body: JSON.stringify({ commandId: crypto.randomUUID(), ...(note ? { note } : {}) }) });
    const message = result.demo ? 'This is the demo: nothing restarted.' : `Handed back. Ploeg resumes Round ${result.fromRound} on the same branch.`;
    notify(message);
    announce(message);
  } catch (failure) { notify(failure.message, true); }
  await track('take-on', after(id));
}

async function openStop(button) {
  const entry = find('stop', button.dataset.id);
  if (!entry || view.busy || !mayTakeOn(user())) return;
  const detail = await readDetail(button);
  if (!detail || !ploegVisible('take-on') || $('#confirm-dialog')?.open) return;
  const isDemo = Boolean(detail.demo) || demo();
  const dialog = $('#confirm-dialog');
  const previous = dialog.className;
  dialog.className = 'dialog work-cancel-dialog';
  dialog.innerHTML = cancelDialogMarkup(detail, { demo: isDemo });
  dialog.returnValue = '';
  dialog.addEventListener('close', () => {
    dialog.className = previous;
    if (dialog.returnValue === 'cancel' && !isDemo) void track('take-on', stop(entry));
    else document.getElementById(button.id)?.focus();
  }, { once: true });
  dialog.showModal();
}

async function stop(entry) {
  view.busy = entry.id;
  try {
    const result = await api(`/api/ploeg/work-items/${encodeURIComponent(entry.id)}/cancel`, { method: 'POST', body: '{}' });
    const summary = cancelSummary(result);
    notify(`“${entry.title || `Work Item ${entry.id}`}”: ${summary.title}`);
    announce(summary.title);
  } catch (failure) { notify(failure.message || 'Ploeg did not cancel this Work Item.', true); }
  await after(entry.id);
}

async function enterTakeOn() {
  enterPloegView('take-on');
  await load();
}

onPloegReload('take-on', load);
live.register('take-on', { interval: 30000, refresh: liveRefresh('take-on', poll, () => view.error) });

/**
 * Take on (`#take-on`): proposed, taken-over and running work as one list for a phone, with Approve, Hand back and
 * Stop through the confirmations and routes Proposed, Now and the Work Item page already use. Refreshes every
 * 30 seconds and never redraws under an open dialog.
 */
export default {
  id: 'take-on',
  match: hash => hash === 'take-on' ? {} : null,
  enter: enterTakeOn,
  render: renderTakeOn,
  actions: {
    'take-on-approve': confirmApprove,
    'take-on-hand-back': openHandBack,
    'take-on-stop': openStop,
  },
  forms: { 'take-on-hand-back': submitHandBack },
};
