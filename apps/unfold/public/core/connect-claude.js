import { escape } from './dom.js';
import { badge, button } from './ui.js';

const routinesDocs = 'https://code.claude.com/docs/en/routines';
const environmentsDocs = 'https://code.claude.com/docs/en/self-hosted-environments';
const day = iso => (iso ? String(iso).slice(0, 10) : '');
const fieldId = (team, field) => `claude-${field}-${team.replace(/[^A-Za-z0-9_-]/g, '-')}`;

/** How to make the routine Unfold asks for, in the order claude.ai asks for it. */
export function howToMarkup() {
  const steps = [
    `In claude.ai, create a routine (<a href="${routinesDocs}" target="_blank" rel="noopener noreferrer">Routines</a>). Pick this installation’s self-hosted environment as its environment (<a href="${environmentsDocs}" target="_blank" rel="noopener noreferrer">self-hosted environments</a>) and the repositories your Team works on.`,
    'Give it a saved prompt that tells Claude to carry out the Ploeg task in the &lt;routine-fire-payload&gt; block.',
    'Add an API trigger. claude.ai shows its fire URL and a token, the token only once.',
    'Paste both below, for the Team. Unfold sends them straight to Ploeg, which keeps the token in its secret store. Unfold never stores, logs or shows the token, and no page here shows it again.',
  ];
  return `<section class="card settings-card" aria-labelledby="claude-how-title"><header class="card-header"><div class="card-heading"><h2 class="card-title" id="claude-how-title">Connect once, per Team</h2><p class="card-subtitle">Ploeg then starts your Runs with your own routine, on your own Claude account and limits. No Claude login is stored anywhere.</p></div></header><div class="card-body"><ol>${steps.map(step => `<li>${step}</li>`).join('')}</ol><p class="field-hint">Ploeg does not say which Teams start Runs through a routine; it refuses a Team that does not. Anthropic allows 30 starts an hour per routine and 100 per account.</p></div></section>`;
}

/**
 * One Team's line: connected or not, the fire URL Ploeg holds, and the form that connects or replaces the routine.
 * The token field is always empty: the token is never sent back to the page.
 * @param {{ team: string, routine: { fireUrl: string, creatorPinned: boolean, registeredAt: string, updatedAt: string } | null }} entry
 * @param {string} busy
 * @returns {string}
 */
export function teamMarkup(entry, busy = '') {
  const { team, routine } = entry;
  const status = routine ? badge({ tone: 'success', label: 'Connected', size: 'sm' }) : badge({ tone: 'neutral', label: 'Not connected', size: 'sm' });
  const facts = routine
    ? `<p class="health-detail">Fire URL ${escape(routine.fireUrl)}, connected on ${escape(day(routine.registeredAt))}${routine.updatedAt && routine.updatedAt !== routine.registeredAt ? `, replaced on ${escape(day(routine.updatedAt))}` : ''}.</p><p class="health-detail">${routine.creatorPinned ? 'Ploeg has seen your Claude account start a session with it; a session another account starts is refused.' : 'Ploeg has not seen a session from this routine yet. The first one ties it to your Claude account.'}</p>`
    : '';
  const urlId = fieldId(team, 'url');
  const tokenId = fieldId(team, 'token');
  const form = `<form class="claude-routine-form" data-form="claude-connect" data-team="${escape(team)}" autocomplete="off">
    <div class="field"><label class="field-label" for="${escape(urlId)}">Fire URL</label><input id="${escape(urlId)}" name="fireUrl" type="url" required maxlength="2048" spellcheck="false" placeholder="https://api.anthropic.com/v1/claude_code/routines/trig_…/fire" value="${routine ? escape(routine.fireUrl) : ''}"></div>
    <div class="field"><label class="field-label" for="${escape(tokenId)}">Token</label><input id="${escape(tokenId)}" name="token" type="password" required minlength="16" maxlength="512" autocomplete="off" spellcheck="false" aria-describedby="${escape(tokenId)}-hint"><p class="field-hint" id="${escape(tokenId)}-hint">${routine ? 'Paste the current token to replace the one Ploeg keeps.' : 'Goes straight to Ploeg; Unfold does not keep it.'}</p></div>
    <div class="checklist-confirm">${button({ label: routine ? 'Replace' : 'Connect', icon: 'plus', variant: routine ? 'secondary' : 'primary', size: 'sm', type: 'submit', busy: busy === `connect-${team}` })}${routine ? button({ label: 'Remove', icon: 'trash', variant: 'ghost', size: 'sm', action: 'claude-remove', data: { team }, busy: busy === `remove-${team}` }) : ''}</div>
  </form>`;
  return `<li class="health-check"><div class="health-main"><div class="health-heading"><h3 class="health-title">${escape(team)}</h3>${status}</div>${facts}${form}</div></li>`;
}
