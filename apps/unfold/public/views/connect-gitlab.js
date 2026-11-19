import { state, onForget, disconnect } from '../core/state.js';
import { api } from '../core/api.js';
import { escape, renderHtml, announce, notify } from '../core/dom.js';
import { badge, button, callout, demoNote, ploegUnconfigured, skeleton } from '../core/ui.js';
import { attemptRepository, pickRepositories, pickerState, repositoriesMarkup } from '../core/forge-repositories.js';
import { shell } from '../shell.js';

const base = '/api/onboarding/gitlab';
const fresh = () => ({ data: null, error: '', loading: false, connecting: '', formError: {}, connected: null, left: null, removing: '', ...pickerState() });
const view = fresh();
onForget(() => Object.assign(view, fresh()));

const states = {
  active: { tone: 'success', label: 'Works' },
  invalid: { tone: 'danger', label: 'Broken' },
  token_missing: { tone: 'danger', label: 'Token missing' },
  removed: { tone: 'neutral', label: 'Removed' },
};
const leftWords = {
  service_account: id => `The service account ${id} stays in GitLab. Remove it under the group’s Settings, Service accounts, once nothing else uses it.`,
  token: id => `Ploeg could not revoke the token ${id}. Revoke it in GitLab under Access tokens.`,
  webhook: id => `The project webhook ${id} stays in GitLab. Remove it under the project’s Settings, Webhooks.`,
};

const words = { prefix: 'gitlab', check: { action: 'gitlab-check' }, register: { action: 'gitlab-register' }, title: 'Projects the connection reaches', subtitle: 'Ploeg checks each one in a dry run before it registers it. A registered project is stored in Unfold and granted to Own work.', empty: 'The connection reaches no project. Give the service account the Maintainer role on the projects or their group in GitLab, then reload.', readOnly: 'Read-only for the account' };

function unavailable(data) {
  if (data.demo) return callout({ tone: 'neutral', title: 'Demo', body: '<p>The demo connects nothing: it has no Ploeg to hold a GitLab connection or register a project.</p>' });
  if (data.served.connect === null) return callout({ tone: 'attention', title: 'Ploeg could not be asked', body: '<p>Unfold could not ask Ploeg whether it makes GitLab connections. Check again in a minute.</p>', actions: button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'gitlab-refresh' }) });
  return callout({ tone: 'neutral', title: 'Not available yet', body: '<p>This Ploeg does not make forge connections from the screen yet (Ploeg ADR-0195). Until it does, the person who installed Ploeg configures GitLab in Ploeg’s chart.</p>', actions: button({ label: 'Back to Connections', href: '#settings/connections', size: 'sm', icon: 'arrow' }) });
}

function refusedNote(method) {
  if (!method.refused) return '';
  return `<p class="field-hint">Ploeg’s configuration did not allow this method for the instance ${escape(method.refused.instance)} the last time (${escape(method.refused.at.slice(0, 16).replace('T', ' '))} UTC): connections.allow does not list ${escape(method.method)}. Once the person who installed Ploeg adds it, try again.</p>`;
}

function errorNote(id) { return view.formError[id] ? `<p class="field-error" role="alert">${escape(view.formError[id])}</p>` : ''; }

function ownerPath(data, method) {
  const title = 'Create the connection with a temporary Owner token';
  if (method.served === false) return `<section class="card settings-card" aria-labelledby="gitlab-owner-title"><header class="card-header"><div class="card-heading"><h2 class="card-title" id="gitlab-owner-title">${title}</h2>${badge({ tone: 'neutral', label: 'Waits for Ploeg', size: 'sm' })}</div></header><div class="card-body"><p>${escape(method.text || '')}</p><p>Until then, make the service account yourself and paste its token below.</p></div></section>`;
  const form = `<form data-form="gitlab-owner" autocomplete="off"><div class="field"><label class="field-label" for="gitlab-owner-group">Group whose projects Ploeg may use</label><input id="gitlab-owner-group" name="group" required maxlength="255" spellcheck="false" placeholder="acme" aria-describedby="gitlab-owner-group-hint"><p class="field-hint" id="gitlab-owner-group-hint">Its path, as in ${escape(data.gitlabUrl)}/<strong>acme</strong>. The service account becomes Maintainer on this group.</p></div><div class="field"><label class="field-label" for="gitlab-owner-token">Temporary Owner token</label><input id="gitlab-owner-token" name="token" type="password" required spellcheck="false" aria-describedby="gitlab-owner-token-hint"><p class="field-hint" id="gitlab-owner-token-hint">Unfold hands it to Ploeg once and keeps no copy.</p></div>${errorNote('owner')}${button({ type: 'submit', label: 'Create the connection', variant: 'primary', size: 'sm', busy: view.connecting === 'owner' })}</form>`;
  const steps = `<ol><li>As an Owner of the top-level group, ${button({ label: 'open GitLab’s new token page', href: data.tokenPage, external: true, size: 'sm' })}. Name and the <code>api</code> scope are filled in.</li><li>Set the expiry date to tomorrow; GitLab cannot fill that in for you. Create the token and copy it.</li><li>Paste it below with the group path.</li></ol>`;
  return `<section class="card settings-card" aria-labelledby="gitlab-owner-title"><header class="card-header"><div class="card-heading"><h2 class="card-title" id="gitlab-owner-title">${title}</h2>${badge({ tone: 'success', label: 'Recommended', size: 'sm' })}</div></header><div class="card-body"><p>Ploeg uses your token once to create a GitLab service account and make it Maintainer on the group. It keeps only that account’s own token and revokes the one you pasted. Agents never act as you.</p>${steps}${refusedNote(method)}${data.manage ? form : ''}</div></section>`;
}

function servicePath(data, method) {
  if (method.served === false) return '';
  const form = `<form data-form="gitlab-token" autocomplete="off"><div class="field"><label class="field-label" for="gitlab-token">The service account’s token</label><input id="gitlab-token" name="token" type="password" required spellcheck="false" aria-describedby="gitlab-token-hint"><p class="field-hint" id="gitlab-token-hint">Scope <code>api</code>, and the account Maintainer on the projects agents work on. Unfold hands it to Ploeg once and keeps no copy.</p></div>${errorNote('token')}${button({ type: 'submit', label: 'Hand the token to Ploeg', size: 'sm', busy: view.connecting === 'token' })}</form>`;
  const body = `<p>Made a GitLab service account by hand? Paste its personal access token. Ploeg keeps it and pushes as that account. <a href="${escape(data.serviceAccountDocs)}" target="_blank" rel="noopener noreferrer">GitLab’s service account documentation</a></p>${refusedNote(method)}${data.manage ? form : ''}`;
  const open = Boolean(view.formError.token) || data.methods.some(entry => entry.method === 'gitlab_service_account' && (entry.served === false || entry.refused));
  return `<details class="card settings-card"${open ? ' open' : ''}><summary class="card-header"><span class="card-title">I already made a service account</span></summary><div class="card-body">${body}</div></details>`;
}

function connectionSection(data) {
  if (!data.connections.length) return '';
  const rows = data.connections.map(entry => {
    const look = states[entry.state] || { tone: 'neutral', label: entry.state };
    const pick = data.manage && entry.state === 'active' && data.served.register === true ? button({ label: view.picked === entry.id ? 'Reload projects' : 'Pick projects', size: 'sm', icon: 'folder', action: 'gitlab-pick', data: { connection: entry.id }, busy: view.busy === `pick-${entry.id}` }) : '';
    const reason = entry.invalidReason ? `<p class="health-detail">Ploeg reports ${escape(entry.invalidReason)}. Connect GitLab again with a new token to repair it.</p>` : '';
    const mint = entry.canMint === true ? badge({ tone: 'success', label: 'Gives each Run its own credential', size: 'sm' }) : entry.canMint === false ? badge({ tone: 'attention', label: 'Cannot give Runs their own credential', size: 'sm' }) : '';
    const remove = data.manage && entry.source === 'runtime' ? button({ label: 'Remove', size: 'sm', icon: 'trash', action: 'gitlab-remove', data: { connection: entry.id }, busy: view.removing === entry.id }) : '';
    return `<li class="health-check"><div class="health-main"><div class="health-heading"><h3 class="health-title">${escape(entry.account || entry.id)}</h3>${badge({ tone: look.tone, label: look.label, size: 'sm' })}${entry.source === 'static' ? badge({ tone: 'neutral', label: 'Configured by the installation', size: 'sm' }) : ''}${mint}</div><p class="health-detail">Ploeg connection ${escape(entry.id)} on instance ${escape(entry.instance)}.</p>${reason}${pick || remove ? `<div class="checklist-action">${pick}${remove}</div>` : ''}</div></li>`;
  }).join('');
  return `<section class="card settings-card" aria-labelledby="gitlab-connections-title"><header class="card-header"><div class="card-heading"><h2 class="card-title" id="gitlab-connections-title">GitLab connections Ploeg holds</h2></div></header><ol class="health-list">${rows}</ol></section>`;
}

function body() {
  if (state.ploegStatus === 'unconfigured') return ploegUnconfigured();
  if (view.error && !view.data) return callout({ tone: 'danger', title: 'Could not read the GitLab connection', body: `<p>${escape(view.error)}</p>`, actions: button({ label: 'Try again', icon: 'refresh', size: 'sm', action: 'gitlab-refresh' }) });
  if (!view.data) return skeleton({ rows: 4 });
  const data = view.data;
  if (data.demo) return `${demoNote('Nothing on this page connects anything.')}${unavailable(data)}`;
  if (data.served.connect !== true) return unavailable(data);
  if (data.refused) return callout({ tone: 'danger', title: data.refused.install ? 'Not opted in' : 'Ploeg refused to list the GitLab connections', body: `<p>${escape(data.refused.message)} (${escape(data.refused.code)})</p>${data.refused.install ? `<p>The person who installed Ploeg sets: <code>${escape(data.refused.install)}</code></p>` : ''}`, actions: button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'gitlab-refresh' }) });
  if (data.secondForge?.unread) return callout({ tone: 'attention', title: 'Ploeg could not be asked', body: '<p>Unfold could not read which forges this installation pushes to, so it starts no GitLab connection until it can. Check again in a minute.</p>', actions: button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'gitlab-refresh' }) });
  const second = data.secondForge ? callout({ tone: 'attention', title: 'Waits for Ploeg', body: `<p>This installation pushes to ${escape(data.secondForge.forges.join(', '))}. Adding GitLab needs Ploeg ${escape(data.secondForge.waitsFor.release || `with ${data.secondForge.waitsFor.record}, not released yet`)}.</p>` }) : '';
  const readOnly = data.manage ? '' : callout({ tone: 'neutral', title: 'Ask an administrator', body: '<p>Only an administrator connects GitLab and registers projects.</p>' });
  const done = view.connected;
  const warning = done?.warnings.length ? callout({ tone: 'danger', title: done.warnings.some(entry => entry.code === 'owner_token_not_revoked') ? 'Revoke the Owner token in GitLab now' : 'Ploeg connected GitLab with a warning', body: `${done.warnings.map(entry => `<p>${escape(entry.message || entry.code)} (${escape(entry.code)})</p>`).join('')}${done.warnings.some(entry => entry.code === 'owner_token_not_revoked') ? '<p>Ploeg could not revoke the token you pasted. Open your GitLab profile, Access tokens, and revoke the token named Unfold setup by hand.</p>' : ''}` }) : '';
  const account = done?.serviceAccount ? callout({ tone: 'success', title: 'Ploeg created the GitLab service account', body: `<p>${escape(done.serviceAccount.username)} is Maintainer on ${escape(done.serviceAccount.group)}${done.serviceAccount.topGroup && done.serviceAccount.topGroup !== done.serviceAccount.group ? ` in ${escape(done.serviceAccount.topGroup)}` : ''}${done.serviceAccount.created ? '' : ', which Ploeg already had'}.${done.serviceAccount.tokenExpiresAt ? ` Its token expires ${escape(done.serviceAccount.tokenExpiresAt.slice(0, 10))}; Ploeg keeps it.` : ''}</p>` }) : '';
  const left = view.left?.length ? callout({ tone: 'attention', title: 'Left at GitLab', body: view.left.map(entry => `<p>${escape((leftWords[entry.kind] || (id => `Ploeg left ${entry.kind} ${id} at GitLab.`))(entry.id))}${entry.url ? ` <a href="${escape(entry.url)}" target="_blank" rel="noopener noreferrer">Open it in GitLab</a>` : ''}</p>`).join('') }) : '';
  const method = id => data.methods.find(entry => entry.method === id);
  const paths = data.secondForge ? '' : `${ownerPath(data, method('gitlab_service_account'))}${servicePath(data, method('token'))}`;
  return `${readOnly}${warning}${account}${left}${second}${paths}${connectionSection(data)}${repositoriesMarkup(view, words)}`;
}

function render() {
  const back = button({ label: 'Connections', href: '#settings/connections', size: 'sm', icon: 'arrow' });
  renderHtml(shell(`<div class="settings-page connections-page"${view.loading ? ' aria-busy="true"' : ''}><div class="connections-actions">${back}</div>${body()}</div>`, { title: 'Connect GitLab', subtitle: 'Ploeg holds the GitLab service account and its token. Unfold relays the token once and shows what Ploeg reports.' }));
}

async function load() {
  view.loading = true; view.error = '';
  if (state.view === 'connect-gitlab') render();
  try { view.data = await api(base); }
  catch (error) { if (error.status !== 401) view.error = error.message || 'Unfold could not read the GitLab connection.'; }
  view.loading = false;
  if (state.view === 'connect-gitlab') render();
}

async function enter() {
  disconnect(); state.session = null; state.view = 'connect-gitlab';
  render();
  await load();
}

async function connect(kind, data, form) {
  view.connecting = kind; view.formError = {}; view.connected = null; view.left = null; render();
  try {
    const done = await api(`${base}/connections`, { method: 'POST', body: JSON.stringify(kind === 'owner' ? { method: 'service_account', token: data.token, group: data.group } : { method: 'token', token: data.token }) });
    form.reset();
    view.connected = done;
    const text = kind === 'owner' ? 'GitLab is connected. Ploeg created the service account and keeps its token; Unfold kept no copy. Pick the projects agents may work on.' : 'GitLab is connected. Ploeg keeps the service account’s token; Unfold kept no copy. Pick the projects agents may work on.';
    notify(text); announce(text);
  } catch (error) {
    if (error.status !== 401) view.formError = { [kind]: `${error.message || 'Ploeg did not connect GitLab.'}${error.code ? ` (${error.code})` : ''}` };
  }
  view.connecting = '';
  await load();
}

async function remove(control) {
  const connection = control.dataset.connection;
  view.removing = connection; view.left = null; render();
  try {
    const done = await api(`${base}/connections/${encodeURIComponent(connection)}`, { method: 'DELETE' });
    view.left = done.leftAtVendor;
    notify(done.leftAtVendor.length ? 'Ploeg removed the GitLab connection. Some things stay at GitLab; the page lists them.' : 'Ploeg removed the GitLab connection.');
  } catch (error) {
    if (error.status !== 401) notify(error.message || 'Ploeg did not remove the GitLab connection.', true);
  }
  view.removing = '';
  await load();
}

/** Connect GitLab (`#settings/connections/gitlab`): hand Ploeg a temporary Owner token or a service account's token once, then pick and register projects. */
export default {
  id: 'connect-gitlab',
  match: hash => hash === 'settings/connections/gitlab' ? {} : null,
  enter,
  render,
  actions: { 'gitlab-refresh': load, 'gitlab-remove': remove, 'gitlab-pick': control => pickRepositories(view, base, control, render), 'gitlab-check': control => attemptRepository(view, base, control, true, render), 'gitlab-register': control => attemptRepository(view, base, control, false, render) },
  forms: { 'gitlab-owner': (data, form) => connect('owner', data, form), 'gitlab-token': (data, form) => connect('token', data, form) },
};
