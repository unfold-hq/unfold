import { state, onForget, disconnect } from '../core/state.js';
import { api } from '../core/api.js';
import { escape, renderHtml, announce, notify } from '../core/dom.js';
import { button, callout, demoNote, ploegUnconfigured, skeleton } from '../core/ui.js';
import { shell } from '../shell.js';
import { checklistHeadline, checklistMarkup, connectionsMarkup, connectionsModel } from '../connections.js';

const view = { data: null, error: '', loading: false };
onForget(() => Object.assign(view, { data: null, error: '', loading: false }));

function body() {
  if (state.ploegStatus === 'unconfigured') return ploegUnconfigured();
  if (view.error && !view.data) return callout({ tone: 'danger', title: 'Could not read the connections', body: `<p>${escape(view.error)}</p>`, actions: button({ label: 'Try again', icon: 'refresh', size: 'sm', action: 'connections-refresh' }) });
  if (!view.data) return skeleton({ rows: 4 });
  const wiring = view.data.connections ? connectionsMarkup(connectionsModel(view.data.connections)) : callout({ tone: 'attention', title: 'Could not read how boards and repositories are wired', body: `<p>${escape(readFailure(view.data.reads?.connections))}</p>` });
  return `${view.data.demo ? demoNote('Illustrative Ploeg connections. Nothing on this page was connected, and no model calls or charges were made.') : ''}${checklistMarkup(view.data)}${wiring}`;
}

function readFailure(code) {
  if (code === 'ploeg_scope') return 'Your account has access to no Team in Ploeg, so the boards and repositories are not shown. The checklist above still applies.';
  return `Ploeg did not answer the connections read${code ? ` (${code})` : ''}. Check again in a minute.`;
}

function renderConnections() {
  const refresh = button({ label: view.loading ? 'Checking…' : 'Check again', icon: 'refresh', size: 'sm', action: 'connections-refresh', busy: view.loading });
  const content = `<div class="settings-page connections-page"${view.loading ? ' aria-busy="true"' : ''}><div class="connections-actions">${refresh}</div>${body()}</div>`;
  renderHtml(shell(content, { title: 'Connections', subtitle: 'What is connected, what is missing, and the one action that fixes each line.' }));
}

async function load(fresh = false) {
  view.loading = true; view.error = '';
  if (state.view === 'connections') renderConnections();
  try { view.data = await api(`/api/onboarding${fresh ? '?refresh=1' : ''}`); }
  catch (error) { if (error.status !== 401) view.error = error.message || 'Ploeg did not answer.'; }
  view.loading = false;
  if (state.view !== 'connections') return;
  renderConnections();
  if (view.data) announce(checklistHeadline(view.data));
}

async function enterConnections() {
  disconnect(); state.session = null; state.view = 'connections';
  renderConnections();
  await load();
}

async function confirmCap(control) {
  const { team, usd, period } = control.dataset;
  control.disabled = true;
  try {
    await api('/api/onboarding/spend-cap', { method: 'POST', body: JSON.stringify({ team, usd: Number(usd), period }) });
    notify(`Team ${team}’s spend cap is confirmed.`);
  } catch (error) {
    if (error.status !== 401) notify(error.message || 'Unfold could not record the confirmation.', true);
  } finally {
    control.disabled = false;
  }
  await load(true);
}

async function prepare(control) {
  const { target, team, usd } = control.dataset;
  control.disabled = true;
  try {
    const answer = await api('/api/onboarding/prepare', { method: 'POST', body: JSON.stringify({ target, team, usd: Number(usd) }) });
    notify(`Ploeg is preparing the repository as Work Item #${answer.prepare.workItemId}.`);
  } catch (error) {
    if (error.status !== 401) notify(error.message || 'Unfold could not ask Ploeg to prepare the repository.', true);
  } finally {
    control.disabled = false;
  }
  await load(true);
}

async function cancelPrepare(control) {
  const { target } = control.dataset;
  control.disabled = true;
  try {
    const answer = await api('/api/onboarding/prepare/cancel', { method: 'POST', body: JSON.stringify({ target }) });
    const pullRequest = answer.prepare.pullRequest;
    notify(!pullRequest ? 'The readiness Work Item is cancelled. Nothing starts again by itself.' : pullRequest.state === 'closed' ? 'The readiness Work Item is cancelled and Ploeg closed its pull request.' : 'The readiness Work Item is cancelled, but its pull request is still open. Close it before preparing again.');
  } catch (error) {
    if (error.status !== 401) notify(error.message || 'Unfold could not cancel the readiness Work Item.', true);
  } finally {
    control.disabled = false;
  }
  await load(true);
}

/** Connections (`#settings/connections`): the onboarding checklist, then every board and repository Ploeg routes to with each wiring check and its fix. */
export default {
  id: 'connections',
  match: hash => hash === 'settings/connections' ? {} : null,
  enter: enterConnections,
  render: renderConnections,
  actions: { 'connections-refresh': () => load(true), 'connections-confirm-cap': confirmCap, 'connections-prepare': prepare, 'connections-cancel-prepare': cancelPrepare },
};
