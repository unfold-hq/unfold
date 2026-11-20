import * as ui from './core/ui.js';
import { escape } from './core/dom.js';
import { icon } from './core/icons.js';
import { plural, timeHtml } from './core/format.js';
import { listReason } from './core/reasons.js';
import { workItemState } from './core/states.js';
import { workItemRef } from './ploeg.js';

/** Who may approve, hand back and stop work: the roles Proposed, Now and the Work Item page already allow. */
export const mayTakeOn = user => user?.role === 'admin' || user?.role === 'operator';

const takenOver = item => item?.state === 'needs_human' && listReason(item)?.code === 'taken_over';

/**
 * The work a person can take on, from one `GET /api/ploeg/now` answer: proposals to approve, Work Items a person
 * took over and can hand back, and what runs or waits in the queue and can be stopped. Each list keeps Ploeg's order.
 * @param {{ waiting?: object[], active?: object[] } | null} data
 * @returns {{ approve: object[], handBack: object[], stop: object[] }}
 */
export function takeOnLists(data) {
  const waiting = Array.isArray(data?.waiting) ? data.waiting : [];
  const active = Array.isArray(data?.active) ? data.active : [];
  return {
    approve: waiting.filter(item => item.state === 'proposed'),
    handBack: waiting.filter(takenOver),
    stop: active.filter(item => item.state === 'leased' || item.state === 'queued'),
  };
}

/** The cost line of a proposal: the words the approval dialog uses, never an invented amount. */
export function proposalCost(item, demo) {
  if (demo) return 'Demo · nothing is dispatched and nothing is spent.';
  return `Spends from the ${item.team || 'its'} Team’s budget once approved. Ploeg does not report that budget to Unfold yet, so no amount is shown.`;
}

function spendMeter(item, demo) {
  const shift = item.latestShift;
  return ui.meter({ settled: shift?.spentUsd ?? item.spentUsd, reserved: shift?.reservedUsd, authorized: shift?.budgetUsd, demo, label: 'Spend' });
}

function actionButton({ action, id, label, glyph, variant, describedBy }) {
  return `<button type="button" class="button ${variant} take-on-action" id="${action}-${escape(id)}" data-action="${action}" data-id="${escape(id)}" aria-describedby="${describedBy}">${icon(glyph)}<span class="button-label">${escape(label)}</span></button>`;
}

function row(item, kind, { decide, demo, now }) {
  const id = String(item.id);
  const titleId = `take-on-${escape(id)}-title`;
  const stateMeta = kind === 'approve' ? null : workItemState(item.state);
  const badge = kind === 'approve'
    ? ui.badge({ tone: 'neutral', glyph: 'proposed', label: 'Proposed' })
    : kind === 'handBack' ? ui.badge({ tone: 'attention', glyph: 'pause-circle', label: 'Taken over' }) : ui.stateBadge(stateMeta);
  const ready = kind === 'approve' && item.ready === false ? ui.badge({ tone: 'attention', glyph: 'alert', label: 'Needs refinement' }) : '';
  const head = `<p class="take-on-meta">${ui.chip({ label: `Team ${item.team || 'not reported'}` })}${badge}${ready}</p>`;
  const what = kind === 'approve'
    ? (item.sourceTitle ? `Found while working on ${item.sourceTitle}` : 'Proposed by an agent')
    : kind === 'handBack' ? 'A person took the Run over. Hand it back once the change is pushed.' : item.state === 'leased' ? 'An agent works on it now.' : 'Waiting for a worker.';
  const ref = workItemRef(item);
  const since = timeHtml(kind === 'approve' ? item.createdAt : item.updatedAt, { now });
  const facts = `<p class="take-on-what meta">${escape(what)}${ref ? ` · <span>${escape(ref)}</span>` : ''}${since ? ` · ${since}` : ''}</p>`;
  const cost = kind === 'approve'
    ? `<p class="take-on-cost" id="take-on-${escape(id)}-cost">${icon('coins')}<span>${escape(proposalCost(item, demo))}</span></p>`
    : `<div class="take-on-cost" id="take-on-${escape(id)}-cost">${spendMeter(item, demo)}</div>`;
  const described = `${titleId} take-on-${escape(id)}-cost`;
  const buttons = !decide ? '' : kind === 'approve'
    ? actionButton({ action: 'take-on-approve', id, label: 'Approve', glyph: 'check', variant: 'primary', describedBy: described })
    : kind === 'handBack' ? actionButton({ action: 'take-on-hand-back', id, label: 'Hand back', glyph: 'undo', variant: 'primary', describedBy: described })
      : actionButton({ action: 'take-on-stop', id, label: 'Stop', glyph: 'x-circle', variant: 'secondary', describedBy: described });
  const title = `<h3 class="take-on-title" id="${titleId}"><a href="#work/${escape(id)}">${escape(item.title || `Work Item ${id}`)}</a></h3>`;
  return `<li class="take-on-row card" data-kind="${kind}" data-id="${escape(id)}">${head}${title}${facts}${cost}${buttons ? `<div class="take-on-actions">${buttons}</div>` : ''}</li>`;
}

const sections = [
  ['approve', 'To approve', 'Agents proposed these. Nothing runs until someone approves.'],
  ['handBack', 'Taken over', 'A person holds these. Ploeg continues once they are handed back.'],
  ['stop', 'Running and queued', 'Stop withdraws the Work Item and stops what it runs.'],
];

const groupErrors = { approve: 'waiting', handBack: 'waiting', stop: 'active' };

function sectionMarkup([kind, title, description], items, context, errors) {
  const failed = errors?.[groupErrors[kind]];
  const notice = failed ? ui.callout({ tone: 'attention', icon: 'alert', body: `<p>${escape(`Could not read this part: ${failed}`)}</p>` }) : '';
  if (!items.length && !failed) return '';
  const list = items.length ? `<ul class="take-on-list">${items.map(item => row(item, kind, context)).join('')}</ul>` : '';
  return `<section class="take-on-section" aria-labelledby="take-on-${kind}-heading"><header class="take-on-section-header"><h2 class="take-on-section-title" id="take-on-${kind}-heading">${escape(title)} <span class="take-on-count num">${items.length}</span></h2><p class="meta">${escape(description)}</p></header>${notice}${list}</section>`;
}

/**
 * Take on: open and proposed work as one list a thumb can work. Each row names the Team, what it is and what it
 * costs as Ploeg reports it, with one full-width action: Approve a proposal, Hand back a taken-over Work Item, or
 * Stop running or queued work. The actions open the confirmations Proposed and the Work Item page use. Viewers read
 * the list and are told who decides.
 * @param {{ data: object | null, error: { message?: string } | null }} view
 * @param {{ role?: string } | null} user
 * @param {number} [now]
 */
export function takeOnMarkup(view, user, now = Date.now()) {
  if (!view.data && view.error) return `<div class="take-on">${ui.callout({ tone: 'danger', icon: 'x-circle', title: 'Could not load the work you can take on', body: `<p>${escape(view.error.message || 'Ploeg did not answer.')}</p>`, actions: '<button type="button" class="button secondary" data-action="ploeg-reload">Try again</button>' })}</div>`;
  if (!view.data) return '<div class="take-on" aria-busy="true"><span class="sr-only">Loading…</span><ul class="take-on-list" aria-hidden="true"><li class="take-on-row card"><span class="skeleton text"></span><span class="skeleton text"></span></li><li class="take-on-row card"><span class="skeleton text"></span><span class="skeleton text"></span></li></ul></div>';
  const demo = Boolean(view.data.demo);
  const decide = mayTakeOn(user);
  const lists = takeOnLists(view.data);
  const context = { decide, demo, now };
  const total = lists.approve.length + lists.handBack.length + lists.stop.length;
  const demoLine = demo ? ui.demoNote('Approve, hand back and stop open the same confirmations as in a live workbench. Nothing is dispatched and nothing is spent.') : '';
  const stale = view.error ? ui.callout({ tone: 'attention', icon: 'alert', body: `<p>${escape(`Could not refresh: ${view.error.message || 'Ploeg did not answer.'} Showing the last data Unfold read.`)}</p>` }) : '';
  const viewer = decide ? '' : ui.callout({ tone: 'neutral', icon: 'eye', body: '<p>Your account can read this work. An operator or administrator approves, hands back or stops it.</p>' });
  const body = sections.map(entry => sectionMarkup(entry, lists[entry[0]], context, view.data.errors)).join('');
  const empty = body ? '' : `<div class="card">${ui.emptyState({ icon: 'check-circle', tone: 'success', title: 'Nothing to take on', body: '<p>No proposal waits for approval, nothing is taken over and nothing runs.</p>' })}</div>`;
  const summary = total ? `<p class="take-on-summary">${escape(plural(total, 'Work Item'))} you can act on</p>` : '';
  return `<div class="take-on">${demoLine}${stale}${viewer}${summary}${body}${empty}</div>`;
}

/**
 * The hand-back confirmation: what Ploeg resumes, from where and on which budget, with an optional note for the next
 * Run. `offer` is `handBackOffer(detail, viewer)`; a refused offer shows its reason and no live button.
 */
export function handBackDialogMarkup(detail, offer) {
  const item = detail.item;
  const id = escape(item.id);
  const shift = (detail.shifts ?? []).find(entry => !entry.closedAt) ?? item.latestShift ?? null;
  const spend = shift ? ui.dl([['Spend so far', ui.meter({ settled: shift.spentUsd, reserved: shift.reservedUsd, authorized: shift.budgetUsd, demo: Boolean(detail.demo), label: '' })]], { rows: true }) : '';
  const enabled = Boolean(offer?.enabled);
  const reason = enabled ? '' : ui.callout({ tone: 'neutral', title: detail.demo ? 'Not available in the demo' : 'You cannot hand this back', body: `<p>${escape(offer?.reason || 'Ploeg would refuse this hand-back.')}</p>` });
  const label = offer?.actFor ? `Hand back for ${offer.actFor}` : 'Hand back';
  return `<form data-form="take-on-hand-back" data-id="${id}" class="take-on-dialog" novalidate><header class="dialog-header"><h2 id="confirm-title">${escape(`${label}?`)}</h2><button type="button" class="button ghost icon-only sm" data-action="ploeg-dialog-close" aria-label="Close" title="Close">${icon('x')}</button></header><div class="dialog-body"><p><strong>${escape(item.title || `Work Item ${item.id}`)}</strong> <span class="subtle">${escape(workItemRef(item))}</span></p><p>${escape('Ploeg resumes the Round that stopped on the same branch, from your latest commit, with the budget the attempt had left. Its Runs spend from that budget again. Commit and push your changes first.')}</p>${spend}<div class="field"><label class="field-label" for="take-on-hand-back-note">Note for the next Run (optional)</label><textarea id="take-on-hand-back-note" name="note" rows="3" maxlength="4096" placeholder="What you changed and what Ploeg should do next"${enabled ? '' : ' disabled'}></textarea><p class="field-error" data-error-for="take-on-hand-back-note" hidden></p></div>${reason}</div><footer class="dialog-footer"><button type="button" class="button secondary" data-action="ploeg-dialog-close" autofocus>Keep it</button><button type="submit" class="button primary"${enabled ? '' : ' disabled'}>${icon('undo')}<span class="button-label">${escape(label)}</span></button></footer></form>`;
}
