import { state, onForget, disconnect } from '../core/state.js';
import { api } from '../core/api.js';
import { escape, renderHtml, announce, notify } from '../core/dom.js';
import { badge, button, callout, demoNote, ploegUnconfigured, skeleton } from '../core/ui.js';
import { attemptRepository, pickRepositories, pickerState, repositoriesMarkup } from '../core/forge-repositories.js';
import { shell } from '../shell.js';

const fresh = () => ({ data: null, error: '', loading: false, ...pickerState() });
const view = fresh();
onForget(() => Object.assign(view, fresh()));

const outcomes = {
  connected: 'GitHub is connected. Ploeg holds the installation; pick the repositories agents may work on.',
  awaiting_consent: 'GitHub asked an owner of the organisation to approve the installation. Ploeg finishes the connection once they do.',
  app_created: 'Ploeg created the GitHub App. Install it on the repositories agents may work on.',
};
const states = {
  active: { tone: 'success', label: 'Works' },
  awaiting_consent: { tone: 'attention', label: 'Waits for approval' },
  invalid: { tone: 'danger', label: 'Broken' },
  token_missing: { tone: 'danger', label: 'Key missing' },
  removed: { tone: 'neutral', label: 'Removed' },
};

function unavailable(data) {
  if (data.demo) return callout({ tone: 'neutral', title: 'Demo', body: '<p>The demo connects nothing: it has no Ploeg to hold a GitHub App or register a repository.</p>' });
  if (data.served.connect === null) return callout({ tone: 'attention', title: 'Ploeg could not be asked', body: '<p>Unfold could not ask Ploeg whether it makes GitHub connections. Check again in a minute.</p>', actions: button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'github-refresh' }) });
  return callout({ tone: 'neutral', title: 'Not available yet', body: '<p>This Ploeg does not make GitHub connections from the screen yet (Ploeg ADR-0195). The onboarding checklist names the release that adds it and the configuration entry to use until then.</p>', actions: button({ label: 'Back to Connections', href: '#settings/connections', size: 'sm', icon: 'arrow' }) });
}

function appSection(data) {
  if (!data.manage) return '';
  const install = data.apps.map(app => button({ label: `Install ${app.slug || app.id}`, size: 'sm', icon: 'plus', action: 'github-start', data: { method: 'install', app: app.id }, busy: view.busy === `install-${app.id}` })).join('');
  const create = `<div class="field"><label class="field-label" for="github-owner">GitHub organisation that owns the App</label><input id="github-owner" maxlength="39" autocomplete="off" spellcheck="false" aria-describedby="github-owner-hint"><p class="field-hint" id="github-owner-hint">Leave it empty to create the App on your own GitHub account.</p></div>${button({ label: 'Create the GitHub App', variant: data.apps.length ? 'secondary' : 'primary', size: 'sm', icon: 'plus', action: 'github-start', data: { method: 'manifest' }, busy: view.busy === 'manifest' })}`;
  const callback = data.callbackUrl ? `<p class="field-hint">GitHub sends you back to ${escape(data.callbackUrl)}. Ploeg keeps the App’s key, webhook secret and client secret; Unfold keeps none of them.</p>` : '<p class="field-hint">Unfold has no baseUrl, so GitHub could not send you back. The person who installed Unfold sets it first.</p>';
  const body = `${data.apps.length ? `<p>Ploeg already holds ${data.apps.length === 1 ? 'a GitHub App' : `${data.apps.length} GitHub Apps`}. Install one on another organisation or more repositories:</p><div class="checklist-confirm">${install}</div>` : '<p>Ploeg holds no GitHub App yet. GitHub opens with the App’s name, permissions and webhook filled in by Ploeg; install it on selected repositories, not all of them.</p>'}${create}${callback}`;
  return `<section class="card settings-card" aria-labelledby="github-app-title"><header class="card-header"><div class="card-heading"><h2 class="card-title" id="github-app-title">GitHub App</h2></div></header><div class="card-body">${body}</div></section>`;
}

function connectionSection(data) {
  if (!data.connections.length) return '';
  const rows = data.connections.map(entry => {
    const look = states[entry.state] || { tone: 'neutral', label: entry.state };
    const pick = data.manage && entry.state === 'active' && data.served.register === true ? button({ label: view.picked === entry.id ? 'Reload repositories' : 'Pick repositories', size: 'sm', icon: 'folder', action: 'github-pick', data: { connection: entry.id }, busy: view.busy === `pick-${entry.id}` }) : '';
    const reason = entry.invalidReason ? `<p class="health-detail">Ploeg reports ${escape(entry.invalidReason)}. Reinstall the App on GitHub to repair it.</p>` : '';
    return `<li class="health-check"><div class="health-main"><div class="health-heading"><h3 class="health-title">${escape(entry.account || entry.id)}</h3>${badge({ tone: look.tone, label: look.label, size: 'sm' })}${entry.source === 'static' ? badge({ tone: 'neutral', label: 'Configured by the installation', size: 'sm' }) : ''}</div><p class="health-detail">Ploeg connection ${escape(entry.id)}.</p>${reason}${pick ? `<div class="checklist-action">${pick}</div>` : ''}</div></li>`;
  }).join('');
  return `<section class="card settings-card" aria-labelledby="github-connections-title"><header class="card-header"><div class="card-heading"><h2 class="card-title" id="github-connections-title">Installations Ploeg holds</h2></div></header><ol class="health-list">${rows}</ol></section>`;
}

const words = { prefix: 'github', check: { action: 'github-check' }, register: { action: 'github-register' }, title: 'Repositories the installation reaches', subtitle: 'Ploeg checks each one in a dry run before it registers it. A registered repository is stored in Unfold and granted to Own work.', empty: 'The installation reaches no repository. Add repositories to it on GitHub, then reload.', readOnly: 'Read-only for the App' };

function body() {
  if (state.ploegStatus === 'unconfigured') return ploegUnconfigured();
  if (view.error && !view.data) return callout({ tone: 'danger', title: 'Could not read the GitHub connection', body: `<p>${escape(view.error)}</p>`, actions: button({ label: 'Try again', icon: 'refresh', size: 'sm', action: 'github-refresh' }) });
  if (!view.data) return skeleton({ rows: 4 });
  const data = view.data;
  if (data.demo) return `${demoNote('Nothing on this page connects anything.')}${unavailable(data)}`;
  if (data.served.connect !== true) return unavailable(data);
  if (data.refused) return callout({ tone: 'danger', title: data.refused.install ? 'Not opted in' : 'Ploeg refused to list the GitHub connections', body: `<p>${escape(data.refused.message)} (${escape(data.refused.code)})</p>${data.refused.install ? `<p>The person who installed Ploeg sets: <code>${escape(data.refused.install)}</code></p>` : ''}`, actions: button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'github-refresh' }) });
  if (data.secondForge?.unread) return callout({ tone: 'attention', title: 'Ploeg could not be asked', body: '<p>Unfold could not read which forges this installation pushes to, so it starts no GitHub connection until it can. Check again in a minute.</p>', actions: button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'github-refresh' }) });
  const second = data.secondForge ? callout({ tone: 'attention', title: 'Waits for Ploeg', body: `<p>This installation pushes to ${escape(data.secondForge.forges.join(', '))}. Adding GitHub needs Ploeg ${escape(data.secondForge.waitsFor.release || `with ${data.secondForge.waitsFor.record}, not released yet`)}.</p>` }) : '';
  const readOnly = data.manage ? '' : callout({ tone: 'neutral', title: 'Ask an administrator', body: '<p>Only an administrator connects GitHub and registers repositories.</p>' });
  return `${readOnly}${second}${data.secondForge ? '' : appSection(data)}${connectionSection(data)}${repositoriesMarkup(view, words)}`;
}

function render() {
  const back = button({ label: 'Connections', href: '#settings/connections', size: 'sm', icon: 'arrow' });
  renderHtml(shell(`<div class="settings-page connections-page"${view.loading ? ' aria-busy="true"' : ''}><div class="connections-actions">${back}</div>${body()}</div>`, { title: 'Connect GitHub', subtitle: 'Ploeg holds the GitHub App and every key. Unfold sends you to GitHub and shows what Ploeg reports.' }));
}

async function load() {
  view.loading = true; view.error = '';
  if (state.view === 'connect-github') render();
  try { view.data = await api('/api/onboarding/github'); }
  catch (error) { if (error.status !== 401) view.error = error.message || 'Unfold could not read the GitHub connection.'; }
  view.loading = false;
  if (state.view === 'connect-github') render();
}

function returnedOutcome() {
  const params = new URLSearchParams(location.search);
  const outcome = params.get('github');
  const failure = params.get('github_error');
  if (!outcome && !failure) return;
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  if (failure) notify(failure === 'onboarding_state_invalid' ? 'Unfold could not match GitHub’s return to a connection you started. Start again.' : `GitHub was not connected (${failure}).`, true);
  else if (outcomes[outcome]) { notify(outcomes[outcome]); announce(outcomes[outcome]); }
}

async function enter() {
  disconnect(); state.session = null; state.view = 'connect-github';
  returnedOutcome();
  render();
  await load();
}

async function start(control) {
  const { method, app } = control.dataset;
  const owner = document.getElementById('github-owner')?.value.trim() || '';
  view.busy = method === 'install' ? `install-${app}` : 'manifest'; render();
  try {
    const started = await api('/api/onboarding/github/flows', { method: 'POST', body: JSON.stringify(method === 'install' ? { method, app } : { method, ...(owner ? { owner } : {}) }) });
    location.assign(started.continue);
  } catch (error) {
    if (error.status !== 401) notify(error.message || 'Unfold could not start the GitHub connection.', true);
    view.busy = ''; render();
  }
}

/** Connect GitHub (`#settings/connections/github`): create or install the GitHub App through Ploeg, then pick and register repositories. */
export default {
  id: 'connect-github',
  match: hash => hash === 'settings/connections/github' ? {} : null,
  enter,
  render,
  actions: { 'github-refresh': load, 'github-start': start, 'github-pick': control => pickRepositories(view, '/api/onboarding/github', control, render), 'github-check': control => attemptRepository(view, '/api/onboarding/github', control, true, render), 'github-register': control => attemptRepository(view, '/api/onboarding/github', control, false, render) },
};
