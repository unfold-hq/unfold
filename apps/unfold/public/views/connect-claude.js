import { state, onForget, disconnect } from '../core/state.js';
import { api } from '../core/api.js';
import { escape, renderHtml, announce, notify } from '../core/dom.js';
import { button, callout, demoNote, ploegUnconfigured, skeleton } from '../core/ui.js';
import { howToMarkup, teamMarkup } from '../core/connect-claude.js';
import { shell } from '../shell.js';

const fresh = () => ({ data: null, error: '', loading: false, busy: '' });
const view = fresh();
onForget(() => Object.assign(view, fresh()));

function unavailable(data) {
  if (data.served === null) return callout({ tone: 'attention', title: 'Ploeg could not be asked', body: '<p>Unfold could not ask Ploeg whether it starts Runs through your Claude routine. Check again in a minute.</p>', actions: button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'claude-refresh' }) });
  const release = data.waitsFor?.release ? `Ploeg ${data.waitsFor.release} adds it.` : 'It waits for a Ploeg release.';
  return callout({ tone: 'neutral', title: 'Not available yet', body: `<p>This Ploeg does not start Runs through your own Claude routine yet (${escape(data.waitsFor?.record || 'Ploeg ADR-0197')}). ${escape(release)}</p>` });
}

function body() {
  if (state.ploegStatus === 'unconfigured') return ploegUnconfigured();
  if (view.error && !view.data) return callout({ tone: 'danger', title: 'Could not read your Claude routines', body: `<p>${escape(view.error)}</p>`, actions: button({ label: 'Try again', icon: 'refresh', size: 'sm', action: 'claude-refresh' }) });
  if (!view.data) return skeleton({ rows: 3 });
  return routinesMarkup(view.data, state.bootstrap?.user?.role, view.busy);
}

/** What Connect Claude shows for the overview Unfold read, for a person with `role`; `busy` names the Team being changed. */
export function routinesMarkup(data, role, busy = '') {
  if (data.demo) return `${demoNote('Nothing on this page connects anything.')}${callout({ tone: 'neutral', title: 'Demo', body: '<p>The demo has no Ploeg to keep a routine’s token, and starts no Run.</p>' })}`;
  if (data.served !== true) return unavailable(data);
  if (role === 'viewer') return callout({ tone: 'neutral', title: 'Not for viewers', body: '<p>Viewers start no work, so there is no routine to connect.</p>' });
  if (data.refused?.code === 'routines_not_accepted') return callout({ tone: 'neutral', title: 'Not turned on in this installation', body: `<p>${escape(data.refused.message)}</p><p>Until then there is nothing to connect here. Your Teams start their Runs the way the person who installed Ploeg set them up.</p>`, actions: button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'claude-refresh' }) });
  const refused = data.refused ? callout({ tone: 'danger', title: 'Ploeg refused', body: `<p>${escape(data.refused.message)} (${escape(data.refused.code)})</p>`, actions: button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'claude-refresh' }) }) : '';
  const rows = data.teams.map(entry => teamMarkup(entry, busy)).join('');
  const teams = data.refused ? '' : rows ? `<section class="card settings-card" aria-labelledby="claude-teams-title"><header class="card-header"><div class="card-heading"><h2 class="card-title" id="claude-teams-title">Your Teams</h2></div></header><ol class="health-list">${rows}</ol></section>` : '<p class="meta">You have no Team in Ploeg yet.</p>';
  return `${refused}${howToMarkup()}${teams}`;
}

function render() {
  const back = button({ label: 'Preferences', href: '#settings/preferences', size: 'sm', icon: 'arrow' });
  renderHtml(shell(`<div class="settings-page connections-page"${view.loading ? ' aria-busy="true"' : ''}><div class="connections-actions">${back}</div>${body()}</div>`, { title: 'Connect Claude', subtitle: 'Start Work Items with your own Claude routine. Ploeg keeps its token; Unfold keeps none.' }));
}

async function load() {
  view.loading = true; view.error = '';
  if (state.view === 'connect-claude') render();
  try { view.data = await api('/api/claude-routines'); }
  catch (error) { if (error.status !== 401) view.error = error.message || 'Unfold could not read your Claude routines.'; }
  view.loading = false;
  if (state.view === 'connect-claude') render();
}

async function enter() {
  disconnect(); state.session = null; state.view = 'connect-claude';
  render();
  await load();
}

async function connect(data, form) {
  const team = form.dataset.team;
  const fireUrl = String(data.fireUrl ?? '').trim();
  const token = String(data.token ?? '');
  const field = form.querySelector('[name="token"]');
  if (field) field.value = '';
  view.busy = `connect-${team}`; render();
  try {
    await api(`/api/claude-routines/${encodeURIComponent(team)}`, { method: 'PUT', body: JSON.stringify({ fireUrl, token }) });
    notify(`Your Claude routine is connected for ${team}.`);
    announce(`Your Claude routine is connected for ${team}.`);
  } catch (error) {
    if (error.status !== 401) notify(error.message || 'Ploeg did not connect the routine.', true);
  }
  view.busy = ''; await load();
}

async function remove(control) {
  const team = control.dataset.team;
  view.busy = `remove-${team}`; render();
  try {
    await api(`/api/claude-routines/${encodeURIComponent(team)}`, { method: 'DELETE' });
    notify(`Your Claude routine for ${team} is removed. Ploeg deleted its token.`);
  } catch (error) {
    if (error.status !== 401) notify(error.message || 'Ploeg did not remove the routine.', true);
  }
  view.busy = ''; await load();
}

/** Connect Claude (`#settings/claude`): each person connects their own claude.ai routine per Team through Ploeg (Ploeg ADR-0197 section 7). */
export default {
  id: 'connect-claude',
  match: hash => hash === 'settings/claude' ? {} : null,
  enter,
  render,
  actions: { 'claude-refresh': load, 'claude-remove': remove },
  forms: { 'claude-connect': connect },
};
