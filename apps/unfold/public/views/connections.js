import { state, onForget, disconnect } from '../core/state.js';
import { api } from '../core/api.js';
import { escape, renderHtml, announce } from '../core/dom.js';
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

/** Connections (`#settings/connections`): the onboarding checklist, then every board and repository Ploeg routes to with each wiring check and its fix. */
export default {
  id: 'connections',
  match: hash => hash === 'settings/connections' ? {} : null,
  enter: enterConnections,
  render: renderConnections,
  actions: { 'connections-refresh': () => load(true) },
};
