import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escape, renderHtml, notify } from '../core/dom.js';
import { button, callout, skeleton } from '../core/ui.js';
import { shell } from '../shell.js';

const fresh = () => ({ data: null, error: '', busy: false, tokenError: '', map: null, level: null, trail: [], levelError: '', checks: null, bindError: '', connection: '', list: '', listName: '', team: '', repository: '', allow: [] });
const view = fresh();

const optIn = {
  'connections_not_accepted': 'Ploeg does not accept connections from the screen on this installation yet.',
  'bindings_not_accepted': 'The Team does not accept Lists from the screen yet.',
  'permission_required': 'Unfold’s consumer in Ploeg lacks the permission for this step.',
  'person_claim_required': 'Your sign-in lacks a claim Ploeg asks for this step.',
};
const tones = { ok: 'success', warning: 'attention', problem: 'danger', pending: 'neutral', unknown: 'neutral' };

function stepNote(served, what) {
  if (served === true) return '';
  if (served === null) return callout({ tone: 'attention', title: `Ploeg could not be asked whether it ${what}`, body: '<p>Check again in a minute.</p>', actions: button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'clickup-reload' }) });
  return callout({ tone: 'neutral', title: `This Ploeg does not ${what} yet`, body: '<p>Unfold sends it nothing for this step. Settings → Connections names the Ploeg release that adds it and the configuration entry to use until then.</p>', actions: button({ label: 'Open Connections', href: '#settings/connections', size: 'sm' }) });
}

function guide(data) {
  const memberGuide = data.guide;
  if (!memberGuide) return '';
  const token = `<form data-form="clickup-token" class="account-token"><div class="field"><label class="field-label" for="clickup-token">${escape(memberGuide.tokenLabel)}</label><input id="clickup-token" name="token" type="password" autocomplete="off" spellcheck="false" required aria-describedby="clickup-token-hint"><p class="field-hint" id="clickup-token-hint">Unfold hands it to Ploeg once and keeps no copy. It is never shown again.</p></div>${view.tokenError ? `<p class="field-error" role="alert">${escape(view.tokenError)}</p>` : ''}${button({ type: 'submit', label: 'Hand the token to Ploeg', variant: 'primary', size: 'sm', busy: view.busy })}</form>`;
  const oauth = `<p>Does this installation have a ClickUp OAuth application? Then sign in as the member instead of pasting.</p>${button({ label: 'Sign in to ClickUp as the Unfold member', size: 'sm', action: 'clickup-oauth' })}`;
  return `<section class="settings-section"><h2>Create the Unfold member</h2><p>${escape(memberGuide.why)}</p><ol>${memberGuide.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol><p><a href="${escape(memberGuide.docs)}" target="_blank" rel="noopener noreferrer">ClickUp’s token documentation</a></p>${data.manage && data.steps.connect ? `${token}${oauth}` : ''}</section>`;
}

function sourceRow(source, manage) {
  const line = source.line;
  const actions = manage ? [
    line.action?.kind === 'refresh' ? button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'clickup-check', data: { source: source.id } }) : '',
    source.binding ? button({ label: 'Remove the binding', size: 'sm', action: 'clickup-unbind', data: { source: source.id } }) : '',
  ].join('') : '';
  return `<li class="check-line" data-status="${escape(line.status)}"><strong>${escape(line.title)}</strong> <span class="badge" data-tone="${tones[line.status] ?? 'neutral'}">${escape(line.status)}</span><p>${escape(line.text)}</p>${line.fix ? `<p>${escape(line.fix)}</p>` : ''}${actions}</li>`;
}

function connections(data) {
  if (!data.connections.length) return '';
  return `<section class="settings-section"><h2>Connected through Ploeg</h2>${data.connections.map(connection => `<div class="connection-card"><p><strong>${escape(connection.account || connection.id)}</strong> · ${escape(connection.method === 'oauth' ? 'signed in' : 'token pasted')}${connection.setAt ? ` on ${escape(connection.setAt.slice(0, 10))}` : ''} · Ploeg reports ${escape(connection.ploeg?.state ?? 'nothing yet')}${connection.ploeg?.invalidReason ? ` (${escape(connection.ploeg.invalidReason)})` : ''}. Unfold keeps no token.</p>${connection.sources.length ? `<ul class="check-lines">${connection.sources.map(source => sourceRow(source, data.manage)).join('')}</ul>` : ''}${data.manage ? button({ label: 'Remove this connection', size: 'sm', action: 'clickup-remove', data: { connection: connection.id } }) : ''}</div>`).join('')}</section>`;
}

function mapStep(data) {
  if (!data.manage || !data.connections.length) return '';
  if (data.steps.bind !== true) return stepNote(data.steps.bind, 'bind Lists to a Team at runtime');
  const map = view.map;
  if (!map) return `<section class="settings-section"><h2>Bind a List</h2>${button({ label: 'Choose a List to bind', size: 'sm', variant: 'primary', action: 'clickup-map' })}</section>`;
  const listField = data.steps.lists === true && !view.levelError ? picker() : typedList(data.steps.lists === true ? view.levelError : 'This Ploeg cannot list the connection’s Lists yet, so paste the List’s id: the number in its ClickUp address.');
  const teams = map.teams.map(team => `<option value="${escape(team.id)}"${team.id === view.team ? ' selected' : ''}${team.bindable ? '' : ' disabled'}>${escape(team.id)}${team.bindable ? '' : ' (no spend cap)'}</option>`).join('');
  const repositories = map.repositories.map(repository => `<option value="${escape(repository.key)}"${repository.key === view.repository ? ' selected' : ''}>${escape(repository.name)}</option>`).join('');
  const further = map.repositories.filter(repository => repository.key !== view.repository).map(repository => `<label><input type="checkbox" data-clickup-allow value="${escape(repository.key)}"${view.allow.includes(repository.key) ? ' checked' : ''}> ${escape(repository.name)}</label>`).join('');
  const waiting = map.waiting.length ? `<p>${escape(map.waiting.join(', '))} ${map.waiting.length === 1 ? 'is' : 'are'} registered but not ready: merge the readiness pull request first.</p>` : '';
  const checks = view.checks ? `<ul class="check-lines">${view.checks.map(check => `<li data-status="${escape(check.status)}"><strong>${escape(check.id)}</strong> ${escape(check.status)}${check.text ? `: ${escape(check.text)}` : ''}</li>`).join('')}</ul>` : '';
  const ready = view.connection && view.list && view.team && view.repository;
  return `<section class="settings-section"><h2>Bind a List</h2>
    <div class="field"><label class="field-label" for="clickup-connection">Connection</label><select id="clickup-connection" data-clickup-field="connection">${data.connections.map(connection => `<option value="${escape(connection.id)}"${connection.id === view.connection ? ' selected' : ''}>${escape(connection.account || connection.id)}</option>`).join('')}</select></div>
    <div class="field"><label class="field-label" for="clickup-list">List</label>${listField}</div>
    <div class="field"><label class="field-label" for="clickup-team">Team</label><select id="clickup-team" data-clickup-field="team"><option value="">Choose a Team</option>${teams}</select></div>
    ${map.repositories.length ? `<div class="field"><label class="field-label" for="clickup-repository">Default repository</label><select id="clickup-repository" data-clickup-field="repository"><option value="">Choose a ready repository</option>${repositories}</select></div>${further ? `<fieldset class="field"><legend>Further repositories a repo label may pick</legend>${further}</fieldset>` : ''}` : '<p>No repository is ready for agents yet, so no List can be bound.</p>'}
    ${waiting}${checks}${view.bindError ? `<p class="field-error" role="alert">${escape(view.bindError)}</p>` : ''}
    ${button({ label: 'Dry run', size: 'sm', action: 'clickup-dry-run', disabled: !ready, busy: view.busy })} ${button({ label: 'Bind', size: 'sm', variant: 'primary', action: 'clickup-bind', disabled: !ready, busy: view.busy })}
  </section>`;
}

function typedList(hint) {
  return `<input id="clickup-list" data-clickup-field="list" value="${escape(view.list)}" inputmode="text" autocomplete="off" aria-describedby="clickup-list-hint"><p class="field-hint" id="clickup-list-hint">${escape(hint)}</p>`;
}

const scopeName = scope => scope.untrusted?.name || scope.id;

function picker() {
  const trail = [{ ref: '', name: 'ClickUp' }, ...view.trail].map((step, depth) => button({ label: step.name, size: 'sm', variant: 'ghost', action: 'clickup-level', data: { depth } })).join(' › ');
  const level = view.level;
  const rows = !level ? '<p>Reading the level from Ploeg…</p>' : !level.scopes.length ? '<p>Nothing here that the Unfold member can see.</p>' : `<ul>${level.scopes.map(scope => `<li><span>${escape(scopeName(scope))}</span> <small>${escape(scope.kind)}</small> ${scope.browsable ? button({ label: 'Open', size: 'sm', action: 'clickup-open', data: { ref: scope.ref, name: scopeName(scope) } }) : ''}${scope.bindable ? button({ label: view.list === scope.id ? 'Chosen' : 'Choose', size: 'sm', variant: view.list === scope.id ? 'primary' : 'secondary', action: 'clickup-pick', data: { id: scope.id, name: scopeName(scope) } }) : ''}</li>`).join('')}</ul>`;
  const more = level?.nextCursor ? button({ label: 'Show more', size: 'sm', action: 'clickup-more' }) : '';
  const chosen = view.list ? `<p>Chosen: <span>${escape(view.listName || view.list)}</span></p>` : '';
  return `<nav aria-label="Where in ClickUp">${trail}</nav>${rows}${more}${chosen}`;
}

function content() {
  if (view.error && !view.data) return callout({ tone: 'danger', title: 'Could not read Connect ClickUp', body: `<p role="alert">${escape(view.error)}</p>`, actions: button({ label: 'Try again', icon: 'refresh', size: 'sm', action: 'clickup-reload' }) });
  const data = view.data;
  if (!data) return skeleton({ rows: 4 });
  if (data.demo) return callout({ tone: 'neutral', title: 'Demo', body: '<p>The demo connects nothing: it holds no ClickUp connection and sends Ploeg nothing.</p>' });
  return `${data.manage ? '' : '<p>Ask an administrator to connect ClickUp.</p>'}${stepNote(data.steps.connect, 'connect ClickUp from the screen')}${guide(data)}${connections(data)}${mapStep(data)}`;
}

function render() {
  if (state.view !== 'connect-clickup') return;
  renderHtml(shell(`<div class="settings-page">${content()}</div>`, { title: 'Connect ClickUp', subtitle: 'Create the member Unfold works as, hand its token to Ploeg once, and bind Lists to a Team.' }));
}

function failure(error) {
  if (optIn[error.code]) return `${optIn[error.code]} ${error.message}`;
  if (error.code === 'tracker_unavailable') return 'Ploeg could not read ClickUp just now. Try again in a minute.';
  if (error.code === 'capability_missing') return 'Ploeg cannot list this tracker’s containers.';
  if (error.code === 'unknown_connection') return 'Ploeg does not let Unfold read this connection: Unfold’s consumer needs readTrackers naming it.';
  if (error.code === 'conflicts_with_static') return `Configured by the installation${error.staticEntry ? `: ${error.staticEntry}` : ''}. Unfold stored no binding.`;
  return error.message;
}

async function load() {
  view.error = '';
  try { view.data = await api('/api/onboarding/clickup'); if (!view.connection) view.connection = view.data.connections[0]?.id ?? ''; }
  catch (error) { if (error.status !== 401) view.error = error.message; }
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  if (params.get('clickup') === 'connected') notify('ClickUp is connected through Ploeg. Unfold keeps no token.');
  if (params.get('clickup_error')) notify(`ClickUp was not connected (${params.get('clickup_error')}).`, true);
  render();
}

async function saveToken(data, form) {
  view.busy = true; view.tokenError = ''; render();
  try { await api('/api/onboarding/clickup/token', { method: 'POST', body: JSON.stringify({ token: data.token }) }); form.reset(); notify('Ploeg holds the member’s token now. Unfold kept no copy.'); }
  catch (error) { if (error.status !== 401) view.tokenError = failure(error); }
  view.busy = false;
  await load();
}

async function oauth() {
  try { const { authorizeUrl } = await api('/api/onboarding/clickup/oauth', { method: 'POST', body: '{}' }); globalThis.location.assign(authorizeUrl); }
  catch (error) { if (error.status !== 401) notify(failure(error), true); }
}

async function readLevel(parent, after) {
  const query = new URLSearchParams({ ...(parent ? { parent } : {}), ...(after ? { after } : {}) });
  try {
    const level = await api(`/api/onboarding/clickup/connections/${encodeURIComponent(view.connection)}/lists${query.size ? `?${query}` : ''}`);
    view.level = after && view.level ? { ...level, scopes: [...view.level.scopes, ...level.scopes] } : level;
    view.levelError = '';
  } catch (error) { if (error.status !== 401) view.levelError = `${failure(error)} Paste the List’s id instead: the number in its ClickUp address.`; }
  render();
}

async function openMap() {
  try { view.map = await api('/api/onboarding/clickup/map'); }
  catch (error) { if (error.status !== 401) notify(failure(error), true); }
  render();
  if (view.map && view.data.steps.lists === true && view.connection) { view.trail = []; view.level = null; await readLevel(); }
}

function openScope(control) {
  view.trail = [...view.trail, { ref: control.dataset.ref, name: control.dataset.name }];
  view.level = null; render();
  return readLevel(control.dataset.ref);
}

function openDepth(control) {
  view.trail = view.trail.slice(0, Number(control.dataset.depth));
  view.level = null; render();
  return readLevel(view.trail.at(-1)?.ref);
}

async function bind(dryRun) {
  view.busy = true; view.bindError = ''; view.checks = null; render();
  const name = view.listName;
  try {
    const result = await api('/api/onboarding/clickup/bindings', { method: 'POST', body: JSON.stringify({ connection: view.connection, list: { id: view.list, ...(name ? { name } : {}) }, team: view.team, default: view.repository, allow: view.allow, dryRun }) });
    view.checks = result.checks;
    if (!result.dryRun) { notify(result.binding?.state === 'active' ? 'The List is bound and active.' : 'Ploeg holds the binding; its line says what it still waits for.'); view.map = null; }
  } catch (error) { if (error.status !== 401) { view.bindError = failure(error); view.checks = error.checks ?? null; } }
  view.busy = false;
  await load();
}

async function act(path, method, done) {
  try { await api(path, { method, ...(method === 'POST' ? { body: '{}' } : {}) }); notify(done); }
  catch (error) { if (error.status !== 401) notify(failure(error), true); }
  await load();
}

/** Connect ClickUp (`#settings/connect-clickup`): the member guide, the token or sign-in handed to Ploeg once, and Lists bound to a Team and ready repositories through Ploeg. */
export default {
  id: 'connect-clickup',
  match: hash => hash === 'settings/connect-clickup' ? {} : null,
  load,
  render,
  actions: {
    'clickup-reload': () => { Object.assign(view, fresh()); render(); return load(); },
    'clickup-oauth': oauth,
    'clickup-map': openMap,
    'clickup-open': openScope,
    'clickup-level': openDepth,
    'clickup-more': () => readLevel(view.trail.at(-1)?.ref, view.level?.nextCursor),
    'clickup-pick': control => { view.list = control.dataset.id; view.listName = control.dataset.name; render(); },
    'clickup-dry-run': () => bind(true),
    'clickup-bind': () => bind(false),
    'clickup-check': control => act(`/api/onboarding/clickup/bindings/${encodeURIComponent(control.dataset.source)}/check`, 'POST', 'Checked again with Ploeg.'),
    'clickup-unbind': control => act(`/api/onboarding/clickup/bindings/${encodeURIComponent(control.dataset.source)}`, 'DELETE', 'The binding is removed.'),
    'clickup-remove': control => act(`/api/onboarding/clickup/connections/${encodeURIComponent(control.dataset.connection)}`, 'DELETE', 'Ploeg removed the connection.'),
  },
  forms: { 'clickup-token': saveToken },
  changes: {
    '[data-clickup-field]': element => { view[element.dataset.clickupField] = element.value; if (element.dataset.clickupField === 'repository') view.allow = view.allow.filter(key => key !== element.value); render(); },
    '[data-clickup-allow]': element => { view.allow = element.checked ? [...new Set([...view.allow, element.value])] : view.allow.filter(key => key !== element.value); },
  },
  inputs: {
    'input[data-clickup-field="list"]': element => { view.list = element.value.trim(); const ready = view.connection && view.list && view.team && view.repository; for (const control of document.querySelectorAll('[data-action="clickup-dry-run"], [data-action="clickup-bind"]')) control.disabled = !ready; },
  },
};
