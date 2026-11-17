import { state, onForget, disconnect } from '../core/state.js';
import { api } from '../core/api.js';
import { escape, renderHtml } from '../core/dom.js';
import { card, segmented, skeleton, stat } from '../core/ui.js';
import { compactCount, money, namedDate, plural, tokens } from '../core/format.js';
import { failureCallout } from '../core/failure.js';
import { icon } from '../core/icons.js';
import { shell } from '../shell.js';

const view = { period: 'month', usage: null, error: null, request: 0 };
onForget(() => Object.assign(view, { period: 'month', usage: null, error: null, request: view.request + 1 }));

const periods = [['month', 'This month'], ['30d', 'Last 30 days']];

/** One amount as Your usage shows it: "Not known yet" when nothing is known, "at least" when part is unknown, never a zero for an unknown cost. */
export function usageAmount(part) {
  if (!part || part.usd === null || part.usd === undefined) return 'Not known yet';
  return `${part.unknown ? 'At least ' : ''}${money(part.usd)}`;
}

/** The line under an amount: how many it counts, which are not known yet, and whether the sum is final. */
export function usageDetail(part, noun) {
  if (!part.count) return `No ${noun}s in this period`;
  const parts = [plural(part.count, noun)];
  if (part.unknown) parts.push(`${compactCount(part.unknown)} not known yet`);
  else if (!part.final) parts.push('not final yet');
  return parts.join(' · ');
}

/** The estimate of the person's Linked Claude Code sessions, with its honest reason when telemetry is not connected or did not answer. */
export function linkedMarkup(linked) {
  const recorded = linked.estimateSource === 'recorded' && linked.estimateUsd !== null;
  const connected = linked.telemetry === 'connected' || recorded;
  const value = !linked.count ? 'No sessions' : recorded ? `About ${money(linked.estimateUsd)}` : linked.telemetry === 'not_configured' ? 'No telemetry connected' : linked.estimateUsd === null ? 'Not known yet' : `About ${money(linked.estimateUsd)}`;
  const recordedDetail = `Claude Code’s own estimate at API prices as Unfold recorded it${linked.recordedAt ? ` (newest reading ${linked.recordedAt.slice(0, 10)})` : ''}, because the metrics store no longer has all of it. A Claude plan is not billed this.`;
  const detail = !linked.count ? 'No agent session of yours reported in this period.' : recorded ? recordedDetail : linked.telemetry === 'not_configured' ? 'This workbench reads no metrics store, so Claude Code’s cost estimate cannot be shown.' : linked.reason || 'Claude Code’s own estimate at API prices. A Claude plan is not billed this.';
  const total = linked.tokens ? linked.tokens.input + linked.tokens.output + linked.tokens.cacheRead + linked.tokens.cacheCreation : null;
  const tiles = [
    stat({ label: 'Estimated cost', value, detail, icon: 'coins', quiet: !connected || linked.estimateUsd === null }),
    stat({ label: 'Sessions', value: compactCount(linked.count), detail: linked.uncosted ? `${plural(linked.uncosted, 'session')} from other harnesses report no cost` : `${plural(linked.claudeCode, 'Claude Code session')}`, icon: 'bot' }),
    stat({ label: 'Tokens', value: connected && total !== null && linked.count ? tokens(total) : 'Not known yet', detail: connected && linked.tokens && linked.count ? `${tokens(linked.tokens.input)} in · ${tokens(linked.tokens.output)} out · ${tokens(linked.tokens.cacheRead)} cache read · ${tokens(linked.tokens.cacheCreation)} cache written` : 'Counted from Claude Code’s telemetry', icon: 'terminal', quiet: !connected || !linked.count }),
  ].join('');
  return `<div class="stat-row">${tiles}</div>${linked.truncated ? '<p class="meta">Only your most recent sessions are counted.</p>' : ''}`;
}

/** Your usage for one period: spent through Unfold, by source, then the Linked Session estimate and what is not attributed yet. */
export function usageMarkup(usage, actions = '') {
  const window = `${namedDate(usage.since)} to ${namedDate(usage.until)}${usage.period === 'month' ? ' (UTC)' : ''}`;
  const sessionsDetail = usage.sessions.count ? `${usageDetail(usage.sessions, 'session')} · ${money(usage.sessions.budgetUsd)} budget` : usageDetail(usage.sessions, 'session');
  const demo = usage.asks.demo + usage.sessions.demo;
  const spent = card({ id: 'usage-spent', title: 'Spent through Unfold', subtitle: window, icon: 'coins', actions, body: `<div class="stat-row">${[
    stat({ label: 'Total', value: usageAmount(usage.spent), detail: usage.spent.count ? (usage.spent.final ? 'Final' : usage.spent.unknown ? 'Part of it is not known yet' : 'Not final yet') : 'Nothing spent in this period', icon: 'coins', quiet: usage.spent.usd === null }),
    stat({ label: 'Asks', value: usageAmount(usage.asks), detail: usageDetail(usage.asks, 'Ask'), icon: 'help-circle', quiet: usage.asks.usd === null }),
    stat({ label: 'Started in Unfold', value: usageAmount(usage.sessions), detail: sessionsDetail, icon: 'work', quiet: usage.sessions.usd === null }),
  ].join('')}</div>${demo ? `<p class="meta">${escape(plural(demo, 'demo item'))} left out: the demo makes no model calls and spends nothing.</p>` : ''}${usage.asks.truncated || usage.sessions.truncated ? '<p class="meta">Only your most recent Asks and sessions are counted.</p>' : ''}` });
  const linked = card({ id: 'usage-linked', title: 'Your own agent sessions', subtitle: 'Claude Code on your machine, linked through the Unfold plugin. Unfold does not pay for these.', icon: 'terminal', body: linkedMarkup(usage.linkedSessions) });
  const missing = card({ id: 'usage-not-attributed', title: 'Not attributed to you yet', icon: 'info', body: usage.notAttributed.map(entry => `<p class="meta">${escape(entry.reason)}</p>`).join('') });
  return `${spent}${linked}${missing}`;
}

function content() {
  const choice = segmented({ label: 'Period', action: 'usage-period', items: periods.map(([id, label]) => ({ id, label, selected: view.period === id })) });
  let body;
  if (view.error && !view.usage) body = `${choice}${failureCallout({ title: 'Could not read your usage', failure: view.error, action: 'usage-retry' })}`;
  else if (!view.usage) body = `${choice}<div class="card">${skeleton({ rows: 3 })}</div>`;
  else body = usageMarkup(view.usage, choice);
  const note = `<p class="settings-footnote">${icon('lock')}<span>Only you see this page. It counts your own Asks, the Work Items you started in Unfold and your own agent sessions; an administrator sees their own usage here, not yours.</span></p>`;
  return `<div class="settings-page">${body}${note}</div>`;
}

function render() {
  renderHtml(shell(content(), { title: 'Your usage', subtitle: 'What your own AI use cost, by where it ran.' }));
}

async function load() {
  const request = ++view.request;
  const period = view.period;
  try { const { usage } = await api(`/api/me/usage?period=${period}`); if (request === view.request) { view.usage = usage; view.error = null; } }
  catch (error) { if (request === view.request) view.error = error.message; }
  if (request === view.request && state.view === 'usage') render();
}

async function enter() {
  disconnect(); state.session = null; state.view = 'usage';
  view.usage = null; view.error = null;
  render();
  await load();
}

async function choosePeriod(element) {
  const period = element.dataset.id === '30d' ? '30d' : 'month';
  if (period === view.period && view.usage) return;
  view.period = period; view.usage = null; view.error = null;
  render();
  await load();
}

/** Your usage: `#settings/usage` totals the signed-in person's own Asks, sessions and Linked Session estimate for a period. */
export default {
  id: 'usage',
  match: hash => hash === 'settings/usage' ? {} : null,
  enter,
  render,
  actions: { 'usage-period': choosePeriod, 'usage-retry': () => { view.error = null; render(); return load(); } },
};
