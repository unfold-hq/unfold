import { escape } from './dom.js';
import { icon } from './icons.js';
import { namedDate } from './format.js';
import { badge, button, callout, disclosure } from './ui.js';

const routinesDocs = 'https://code.claude.com/docs/en/routines';
const environmentsDocs = 'https://code.claude.com/docs/en/self-hosted-environments';
const savedPrompt = 'Carry out the Ploeg task in the <routine-fire-payload> block.';
const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}<span class="sr-only"> (opens in a new tab)</span></a>`;

/** The Claude card's heading, which takes focus after its form is gone. */
export const claudeTitleId = 'link-claude-title';

function steps() {
  return `<ol><li>In claude.ai, create a routine (${link(routinesDocs, 'how routines work')}). Choose this installation’s ${link(environmentsDocs, 'self-hosted environment')} and the repositories the Team works on.</li><li>Use this as its prompt: <code class="mono">${escape(savedPrompt)}</code> ${button({ label: 'Copy the prompt', icon: 'copy', size: 'sm', action: 'linked-session-copy', data: { text: savedPrompt } })}</li><li>Add an API trigger to the routine. claude.ai then shows a URL and a token, the token only once.</li><li>Paste both here.</li></ol>`;
}

function form(teams, ui) {
  const names = teams.map(entry => entry.team);
  const chosen = names.includes(ui.team) ? ui.team : (teams.find(entry => !entry.routine) ?? teams[0]).team;
  const team = names.length === 1
    ? `<input type="hidden" name="team" value="${escape(names[0])}">`
    : `<div class="field"><label class="field-label" for="claude-team">Team</label><select id="claude-team" name="team" required>${teams.map(entry => `<option value="${escape(entry.team)}"${entry.team === chosen ? ' selected' : ''}>${escape(`${entry.team}${entry.routine ? ' (connected)' : ''}`)}</option>`).join('')}</select></div>`;
  const replaces = teams.some(entry => entry.routine);
  const refused = ui.problem ? `<div id="claude-problem" role="alert" tabindex="-1">${callout({ tone: 'danger', title: 'Not connected', body: `<p>${escape(ui.problem)}</p>` })}</div>` : '';
  return `${steps()}<form class="claude-form" data-form="claude-connect" autocomplete="off">${refused}${team}
    <div class="field"><label class="field-label" for="claude-url">Trigger URL</label><input id="claude-url" name="fireUrl" type="url" required maxlength="2048" spellcheck="false" aria-describedby="claude-url-hint" value="${escape(ui.fireUrl ?? '')}"><p class="field-hint" id="claude-url-hint">Starts with https://api.anthropic.com/v1/claude_code/routines/ and ends with /fire.</p></div>
    <div class="field"><label class="field-label" for="claude-token">Trigger token</label><input id="claude-token" name="token" type="password" required minlength="16" maxlength="512" autocomplete="off" spellcheck="false"${replaces ? ' aria-describedby="claude-token-hint"' : ''}>${replaces ? '<p class="field-hint" id="claude-token-hint">A Team that is already connected gets this URL and token instead.</p>' : ''}</div>
    <div>${button({ label: 'Connect', variant: 'primary', type: 'submit', id: 'claude-submit', busy: ui.busy })}</div></form>`;
}

function connectedRow({ team, routine }) {
  const updated = routine.updatedAt && routine.updatedAt !== routine.registeredAt ? `, token replaced on ${namedDate(routine.updatedAt)}` : '';
  const used = routine.creatorPinned ? 'Only sessions your own Claude account starts are accepted.' : 'No work has started with it yet.';
  return `<li><div><h3 class="health-title">Team ${escape(team)}</h3><p class="health-detail">${escape(`Connected on ${namedDate(routine.registeredAt)}${updated}. ${used}`)}</p></div>${button({ label: 'Disconnect', size: 'sm', variant: 'danger-ghost', action: 'claude-remove', data: { team }, ariaLabel: `Disconnect your Claude from Team ${team}` })}</li>`;
}

function shellOf(state, body, footer = '') {
  return `<section class="card settings-card account-card" aria-labelledby="${claudeTitleId}"><header class="card-header account-header"><div class="account-heading"><h2 class="card-title" id="${claudeTitleId}" tabindex="-1">Claude</h2><p class="card-subtitle">claude.ai</p></div>${state}</header><div class="card-body">${body}</div>${footer}</section>`;
}

/**
 * The Claude card of Linked accounts, or '' when there is nothing a person can do with it: no Team of theirs runs work
 * on a person's own Claude, the installation does not do so, or they start no work. `data` is `GET /api/claude-routines`,
 * null before it is read; `ui` holds a failed read, and what was typed in the form with the problem it met. The token
 * is never sent back to the page.
 * @param {object | null} data
 * @param {string | undefined} role
 * @param {{ error?: string, problem?: string, team?: string, fireUrl?: string, busy?: boolean }} ui
 * @returns {string}
 */
export function claudeCard(data, role, ui = {}) {
  const again = button({ label: 'Check again', icon: 'refresh', size: 'sm', action: 'claude-refresh' });
  if (role === 'viewer') return '';
  if (ui.error) return shellOf('', callout({ tone: 'danger', title: 'Could not read your Claude connection', body: `<p>${escape(ui.error)}</p>`, actions: again }));
  if (!data || data.demo || data.served !== true || data.refused?.code === 'routines_not_accepted' || !data.teams.length) return '';
  if (data.refused) return shellOf('', callout({ tone: 'danger', title: 'Ploeg refused', body: `<p>${escape(data.refused.message)} (${escape(data.refused.code)})</p>`, actions: again }));
  const connected = data.teams.filter(entry => entry.routine);
  const free = data.teams.filter(entry => !entry.routine);
  const status = connected.length ? badge({ tone: 'success', glyph: 'check-circle', label: 'Linked' }) : badge({ tone: 'neutral', glyph: 'circle-dashed', label: 'Not linked' });
  const names = data.teams.map(entry => entry.team);
  const who = names.length === 1 ? `Team ${names[0]}` : `Teams ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const why = `<p class="account-why"><strong>${connected.length ? 'With this link you can' : 'Link Claude to'}</strong> ${escape(`start work of ${who} on your own Claude account and limits, with Start with my Claude on a Work Item that waits for you. The task and the repository then go to Anthropic.`)} Other Teams do not need it.</p>`;
  const rows = connected.length ? `<ul class="claude-teams">${connected.map(connectedRow).join('')}</ul>` : '';
  const setup = disclosure({ summary: !connected.length ? 'Link Claude' : free.length ? 'Connect another Team or replace a token' : 'Replace the token', body: form(data.teams, ui), id: 'claude-setup', open: !connected.length || Boolean(ui.problem || ui.busy) });
  return shellOf(status, `${why}${rows}${setup}`, `<footer class="settings-card-footer"><p class="settings-card-note">${icon('lock')}<span>Ploeg keeps the token in its secret store. Unfold never stores or shows it, and no Claude login is stored anywhere.</span></p></footer>`);
}
