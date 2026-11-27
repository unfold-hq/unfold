import { state, onForget, disconnect } from '../core/state.js';
import { api } from '../core/api.js';
import { escape, renderHtml, notify } from '../core/dom.js';
import { badge, button, callout, chip, disclosure, emptyState, skeleton } from '../core/ui.js';
import { dateTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import { failureCallout, failureOf } from '../core/failure.js';
import { shell } from '../shell.js';
import { confirmAction } from './dialogs.js';

const fresh = () => ({ data: null, error: null, issued: null });
const view = fresh();
onForget(() => Object.assign(view, fresh()));

const roleLabels = { viewer: 'Viewer', developer: 'Developer', admin: 'Admin' };
const isAdmin = () => state.bootstrap?.user?.role === 'admin';

function issuedCallout() {
  if (!view.issued) return '';
  const body = `<p>Copy it now: Unfold shows a SCIM token only once and keeps just its hash. Paste it into the identity provider of Tenant <strong>${escape(view.issued.tenant)}</strong>${view.issued.replaced ? '; the previous token stopped working' : ''}.</p><div class="field"><label class="field-label" for="scim-url">SCIM base URL</label><input id="scim-url" class="mono" type="text" readonly autocomplete="off" spellcheck="false" value="${escape(view.data?.scimUrl ?? '')}"></div><div class="field"><label class="field-label" for="scim-token">Bearer token</label><input id="scim-token" class="mono" type="text" readonly autocomplete="off" spellcheck="false" value="${escape(view.issued.token)}"></div>`;
  return callout({ tone: 'attention', title: view.issued.replaced ? 'New SCIM token' : 'SCIM token issued', body, actions: button({ label: 'Done, I copied it', size: 'sm', action: 'scim-token-done' }) });
}

function mappingRow(tenant, mapping, index) {
  const grants = [mapping.role ? chip({ label: `${roleLabels[mapping.role]} in ${tenant}`, icon: 'user' }) : '', ...mapping.clients.map(client => chip({ label: `Client ${client}` }))].join('');
  const remove = button({ label: 'Remove', size: 'sm', variant: 'danger-ghost', action: 'scim-mapping-remove', data: { tenant, index: String(index) }, ariaLabel: `Remove the mapping of ${mapping.value}` });
  return `<li class="settings-item"><span class="settings-item-icon" aria-hidden="true">${icon('layers')}</span><div class="settings-item-main"><p class="settings-item-title"><code>${escape(mapping.value)}</code> <span class="meta">by ${mapping.match === 'externalId' ? 'externalId' : 'display name'}</span></p><div class="settings-item-meta">${grants}</div><div class="settings-item-meta">${remove}</div></div></li>`;
}

function mappingForm(tenant) {
  const body = `<form class="settings-form" data-form="scim-mapping-add" novalidate>
<input type="hidden" name="tenant" value="${escape(tenant)}">
<div class="field"><label class="field-label" for="scim-group-${escape(tenant)}">Group</label><input id="scim-group-${escape(tenant)}" name="value" type="text" required maxlength="256" aria-describedby="scim-group-hint-${escape(tenant)}"><p class="field-hint" id="scim-group-hint-${escape(tenant)}">The group's name, or its externalId, as your identity provider pushes it.</p></div>
<div class="field"><label class="field-label" for="scim-match-${escape(tenant)}">Match by</label><select id="scim-match-${escape(tenant)}" name="match"><option value="displayName">Display name</option><option value="externalId">externalId</option></select></div>
<div class="field"><label class="field-label" for="scim-role-${escape(tenant)}">Access Role</label><select id="scim-role-${escape(tenant)}" name="role"><option value="">None</option><option value="viewer">Viewer</option><option value="developer">Developer</option><option value="admin">Admin</option></select></div>
<div class="field"><label class="field-label" for="scim-clients-${escape(tenant)}">Clients (optional)</label><input id="scim-clients-${escape(tenant)}" name="clients" type="text" maxlength="2000" aria-describedby="scim-clients-hint-${escape(tenant)}"><p class="field-hint" id="scim-clients-hint-${escape(tenant)}">Client ids separated by commas. Members act for these Clients.</p></div>
<div>${button({ label: 'Add mapping', icon: 'plus', variant: 'primary', type: 'submit' })}</div></form>`;
  return disclosure({ id: `scim-mapping-${tenant}`, summary: 'Map a group', body });
}

function tenantCard(entry) {
  const flag = entry.enabled ? badge({ tone: 'success', label: 'On', size: 'sm' }) : badge({ tone: 'neutral', label: 'Off', size: 'sm', title: 'The identity.scim flag is off for this Tenant, so /scim/v2 answers 404 to its token' });
  const token = entry.token
    ? `<p class="settings-item-text">${icon('lock')}<span>Token issued ${escape(dateTime(new Date(entry.token.issuedAt)))} by ${escape(entry.token.issuedBy)}.</span></p><div class="settings-item-meta">${button({ label: 'New token', size: 'sm', action: 'scim-token-issue', data: { tenant: entry.tenant, replace: 'true' }, ariaLabel: `Make a new SCIM token for ${entry.tenant}` })}${button({ label: 'Withdraw', size: 'sm', variant: 'danger-ghost', action: 'scim-token-withdraw', data: { tenant: entry.tenant }, ariaLabel: `Withdraw the SCIM token of ${entry.tenant}` })}</div>`
    : `<p class="settings-item-text">No token yet. Your identity provider cannot push to this Tenant.</p><div class="settings-item-meta">${button({ label: 'Issue token', size: 'sm', variant: 'primary', action: 'scim-token-issue', data: { tenant: entry.tenant, replace: 'false' } })}</div>`;
  const mappings = entry.mappings.length ? `<ul class="settings-items">${entry.mappings.map((mapping, index) => mappingRow(entry.tenant, mapping, index)).join('')}</ul>` : emptyState({ icon: 'layers', title: 'No group mappings', body: `Groups named unfold/${entry.tenant}/viewer, member or admin work without one.`, compact: true });
  return `<section class="card settings-card" aria-labelledby="scim-${escape(entry.tenant)}-title"><header class="card-header"><div class="card-heading"><h2 class="card-title" id="scim-${escape(entry.tenant)}-title">Tenant ${escape(entry.tenant)} ${flag}</h2><p class="card-subtitle">Users and Groups this Tenant's token pushes stay inside this Tenant.</p></div></header><div class="card-body">${token}${mappingForm(entry.tenant)}</div>${mappings}</section>`;
}

function content() {
  if (!isAdmin()) return callout({ tone: 'neutral', title: 'Administrators manage provisioning', body: '<p>Ask an administrator of your Tenant to connect your identity provider.</p>' });
  if (view.error && !view.data) return failureCallout({ title: 'Could not read SCIM provisioning', failure: view.error, action: 'scim-retry' });
  if (!view.data) return `<div aria-busy="true">${skeleton({ rows: 3 })}</div>`;
  const data = view.data;
  if (!data.configured) return callout({ tone: 'neutral', title: 'SCIM is not configured', body: '<p>The operator adds an <code>identity.scim</code> block to the configuration and turns on the <code>identity.scim</code> flag.</p>' });
  const tenants = data.tenants.length ? data.tenants.map(tenantCard).join('') : emptyState({ icon: 'user', title: 'No Tenant to manage', body: 'You are not an Admin of any Tenant.', compact: true });
  const claim = data.userIdClaim ? `<code>${escape(data.userIdClaim)}</code>` : 'no claim configured, so by email';
  return `${issuedCallout()}${tenants}<p class="settings-footnote">${icon('link')}<span>Point your identity provider at <code>${escape(data.scimUrl)}</code>. A SCIM User links to a person by the identity provider user id their sign-in carries (${claim}), else by email.</span></p>`;
}

function render() {
  renderHtml(shell(`<div class="settings-page">${content()}</div>`, { title: 'SCIM provisioning', subtitle: 'Let each Tenant\'s own identity provider create, change and remove its people.' }));
}

async function load() {
  view.error = null;
  try { view.data = await api('/api/admin/scim'); }
  catch (error) { if (error.status !== 401) view.error = failureOf(error); }
  if (state.view === 'scim') render();
}

async function enter() {
  disconnect(); state.session = null; state.view = 'scim';
  render();
  if (isAdmin()) await load();
}

const mappingsOf = tenant => view.data?.tenants.find(entry => entry.tenant === tenant)?.mappings ?? [];

async function saveMappings(tenant, mappings) {
  await api(`/api/admin/scim/tenants/${encodeURIComponent(tenant)}/group-mappings`, { method: 'PUT', body: JSON.stringify({ mappings }) });
  await load();
}

async function issue(tenant) {
  const issued = await api(`/api/admin/scim/tenants/${encodeURIComponent(tenant)}/token`, { method: 'POST', body: '{}' });
  view.issued = { tenant, token: issued.token, replaced: issued.replaced };
  await load();
}

async function addMapping(data) {
  const clients = String(data.clients ?? '').split(',').map(part => part.trim()).filter(Boolean);
  await saveMappings(data.tenant, [...mappingsOf(data.tenant), { match: data.match, value: data.value, role: data.role || null, clients }]);
  notify('The mapping applies to the Tenant\'s people now.');
}

/** SCIM provisioning (`#settings/scim`, administrators): each Tenant's own SCIM token, shown once, and its group mappings. */
export default {
  id: 'scim',
  match: hash => hash === 'settings/scim' ? {} : null,
  enter,
  render,
  actions: {
    'scim-token-done': () => { view.issued = null; render(); },
    'scim-retry': () => { view.error = null; render(); return load(); },
    'scim-token-issue': control => control.dataset.replace === 'true'
      ? confirmAction('Make a new SCIM token?', `The current token of ${control.dataset.tenant} stops working at once. Paste the new one into the identity provider before its next push.`, 'Make a new token', () => issue(control.dataset.tenant))
      : issue(control.dataset.tenant),
    'scim-token-withdraw': control => confirmAction('Withdraw this SCIM token?', `The identity provider of ${control.dataset.tenant} can no longer create, change or remove people. People it provisioned keep their access.`, 'Withdraw', async () => {
      await api(`/api/admin/scim/tenants/${encodeURIComponent(control.dataset.tenant)}/token`, { method: 'DELETE' });
      notify('The SCIM token is withdrawn.');
      await load();
    }, { tone: 'danger', dismiss: 'Keep it' }),
    'scim-mapping-remove': control => saveMappings(control.dataset.tenant, mappingsOf(control.dataset.tenant).filter((_, index) => String(index) !== control.dataset.index)),
  },
  forms: { 'scim-mapping-add': addMapping },
};
