import { api } from './api.js';
import { escape, announce, notify } from './dom.js';
import { badge, button, callout, skeleton } from './ui.js';

/**
 * The key Unfold suggests for a repository: its path in lower case with every other character a hyphen.
 * The Admin may change it; Unfold sends only the key they confirm.
 * @param {string} repository
 * @returns {string}
 */
export function suggestedKey(repository) {
  return repository.toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 128);
}

/** The picker state a Connect page keeps for the repositories one connection reaches. */
export const pickerState = () => ({ busy: '', picked: '', granted: null, grantedError: '', keys: {}, results: {} });

/**
 * What a dry run or a registration came to, with each check and, for a refusal a later Ploeg release lifts, what it waits for.
 * @param {any} result
 */
export function resultMarkup(result) {
  if (!result) return '';
  const checks = result.checks.length ? `<ul class="health-list">${result.checks.map(check => `<li class="health-detail">${badge({ tone: check.result === 'pass' ? 'success' : check.result === 'fail' ? 'danger' : 'neutral', label: check.result === 'pass' ? 'Passed' : check.result === 'fail' ? 'Failed' : 'Unknown', size: 'sm' })} ${escape(check.name)}${check.text ? `: ${escape(check.text)}` : ''}</li>`).join('')}</ul>` : '';
  const readiness = result.readiness === 'not_ready' ? `<p class="health-detail">Not ready${result.reasons.length ? `: ${escape(result.reasons.join(', '))}` : ''}.${result.prepareAvailable ? ' Ploeg can open a pull request that adds the AGENTS.md (Prepare a repository on the checklist).' : ''}</p>` : '';
  const waits = result.waitsFor ? `<p class="health-detail">Waits for ${escape(result.waitsFor.release ? `Ploeg ${result.waitsFor.release}` : `${result.waitsFor.record}, not released yet`)}.</p>` : '';
  return `<p class="health-detail">${escape(result.message)}${result.reason ? ` (${escape(result.reason)})` : ''}</p>${waits}${readiness}${checks}`;
}

/**
 * The repositories one connection reaches, each with its key, Check and Register.
 * @param {ReturnType<typeof pickerState>} view
 * @param {{ prefix: string, title: string, subtitle: string, empty: string, readOnly: string, check: { action: string }, register: { action: string } }} words
 */
export function repositoriesMarkup(view, words) {
  if (!view.picked) return '';
  if (view.grantedError) return callout({ tone: 'danger', title: 'Could not list the repositories', body: `<p>${escape(view.grantedError)}</p>` });
  if (!view.granted) return skeleton({ rows: 3 });
  const rows = view.granted.repositories.map(entry => {
    const id = `${words.prefix}-key-${suggestedKey(entry.repository)}`;
    const key = view.keys[entry.repository] ?? entry.key ?? suggestedKey(entry.repository);
    const result = view.results[entry.repository];
    const done = entry.registered || result?.repository;
    const status = done ? badge({ tone: 'success', label: 'Registered', size: 'sm' }) : entry.canWrite ? '' : badge({ tone: 'attention', label: words.readOnly, size: 'sm' });
    const controls = done || !entry.canWrite ? '' : `<div class="field"><label class="field-label" for="${escape(id)}">Key</label><input id="${escape(id)}" data-forge-key="${escape(entry.repository)}" maxlength="128" autocomplete="off" spellcheck="false" value="${escape(key)}"><p class="field-hint">Lower case. Tasks pick this repository with the label repo/&lt;key&gt;.</p></div><div class="checklist-confirm">${button({ label: 'Check', size: 'sm', icon: 'check', action: words.check.action, data: { repository: entry.repository }, busy: view.busy === `check-${entry.repository}` })}${result?.dryRun && result.outcome === 'accepted' ? button({ label: 'Register', variant: 'primary', size: 'sm', icon: 'plus', action: words.register.action, data: { repository: entry.repository }, busy: view.busy === `register-${entry.repository}` }) : ''}</div>`;
    return `<li class="health-check"><div class="health-main"><div class="health-heading"><h3 class="health-title">${escape(entry.repository)}</h3>${status}</div>${controls}${resultMarkup(result)}</div></li>`;
  }).join('');
  const body = rows ? `<ol class="health-list">${rows}</ol>` : `<p class="card-body">${escape(words.empty)}</p>`;
  return `<section class="card settings-card" aria-labelledby="${words.prefix}-repositories-title"><header class="card-header"><div class="card-heading"><h2 class="card-title" id="${words.prefix}-repositories-title">${escape(words.title)}</h2><p class="card-subtitle">${escape(words.subtitle)}</p></div></header>${body}</section>`;
}

/**
 * Lists the repositories one connection reaches.
 * @param {ReturnType<typeof pickerState>} view
 * @param {string} base The Connect page's API path, such as /api/onboarding/github.
 * @param {HTMLElement} control
 * @param {() => void} render
 */
export async function pickRepositories(view, base, control, render) {
  view.picked = control.dataset.connection; view.granted = null; view.grantedError = ''; view.results = {}; view.busy = `pick-${view.picked}`; render();
  try { view.granted = await api(`${base}/connections/${encodeURIComponent(view.picked)}/repositories`); }
  catch (error) { if (error.status !== 401) view.grantedError = error.message || 'Ploeg did not list the repositories.'; }
  view.busy = ''; render();
}

/**
 * Checks a repository in a dry run, or registers it.
 * @param {ReturnType<typeof pickerState>} view
 * @param {string} base
 * @param {HTMLElement} control
 * @param {boolean} dryRun
 * @param {() => void} render
 */
export async function attemptRepository(view, base, control, dryRun, render) {
  const repository = control.dataset.repository;
  const input = [...document.querySelectorAll('[data-forge-key]')].find(element => element.dataset.forgeKey === repository);
  const key = input ? input.value.trim() : view.keys[repository];
  view.keys[repository] = key;
  view.busy = `${dryRun ? 'check' : 'register'}-${repository}`; render();
  try {
    const result = await api(`${base}/targets`, { method: 'POST', body: JSON.stringify({ connection: view.picked, repository, key, dryRun }) });
    view.results[repository] = result;
    announce(result.message);
    if (result.repository) notify(`${repository} is registered as ${key}.`);
  } catch (error) {
    if (error.status !== 401) { view.results[repository] = { dryRun, outcome: 'refused', reason: error.code || null, message: error.message || 'Ploeg refused the repository.', checks: [], readiness: 'unknown', reasons: [], prepareAvailable: false }; notify(error.message || 'Ploeg refused the repository.', true); }
  }
  view.busy = ''; render();
}
