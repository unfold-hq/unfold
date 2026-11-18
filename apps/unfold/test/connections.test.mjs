import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checklistHeadline, checklistMarkup, connectionsHeadline, connectionsMarkup, connectionsModel } from '../public/connections.js';

const at = Date.parse('2026-10-19T10:00:00Z');
const repository = (key, extra = {}) => ({ key, label: key, forge: 'forgejo', owner: 'acme', repo: key, baseBranch: 'main', readiness: 'ready', reason: '', lastForgeEventAt: '2026-10-18T10:00:00Z', boards: ['Unfold'], ...extra });
const board = (name, extra = {}) => ({ tracker: 'vikunja', name, projectId: '10', team: null, repository: null, default: 'unfold', allow: ['infra'], webhook: 'present', teams: [{ team: 'bronze', assignees: [{ username: 'bronze', shared: true }] }], sources: [{ id: 'unfold', name: 'Unfold', target: 'acme/unfold@main', routed: true }], ...extra });
const data = (extra = {}) => ({ demo: false, supported: true, checkedAt: '2026-10-19T09:40:00Z', eventWindowDays: 30, repositories: [repository('unfold'), repository('infra')], boards: [board('Unfold')], unrouted: [], ...extra });
const statuses = entry => Object.fromEntries(entry.checks.map(check => [check.id, check.status]));

test('a fully wired board and its repositories read as working', () => {
  const model = connectionsModel(data(), at);
  assert.equal(model.problems, 0);
  assert.equal(model.warnings, 0);
  assert.equal(connectionsHeadline(model), 'Every connection works: 1 board and 2 repositories.');
  assert.deepEqual(statuses(model.boards[0]), { webhook: 'ok', teams: 'ok', route: 'ok', unfold: 'ok' });
  assert.match(model.boards[0].checks.find(check => check.id === 'route').text, /Work without a repo\/ label goes to acme\/unfold\. A label may pick repo\/infra\./);
});

test('each broken wire is a problem with its fix, and broken entries sort first', () => {
  const model = connectionsModel(data({
    repositories: [repository('unfold'), repository('infra', { readiness: 'not_ready', reason: 'acme/infra has no AGENTS.md on branch "main"', lastForgeEventAt: null })],
    boards: [board('Unfold'), board('Dark Factory', { projectId: '5', webhook: 'missing', default: null, allow: [], repository: null, teams: [{ team: 'bronze', assignees: [{ username: 'bronze', shared: false }] }], sources: [] })],
    unrouted: [{ id: 'dark-factory', name: 'Dark Factory', provider: 'vikunja', project: '5' }],
  }), at);
  assert.equal(model.repositories[0].title, 'acme/infra', 'the repository that is not ready comes first');
  assert.deepEqual(statuses(model.repositories[0]), { ready: 'problem', reviews: 'warning', boards: 'ok' });
  const dark = model.boards.find(entry => entry.title === 'Dark Factory');
  assert.deepEqual(statuses(dark), { webhook: 'problem', teams: 'problem', route: 'info', unfold: 'info' });
  assert.match(dark.checks[1].text, /^bronze cannot see this board/);
  assert.match(dark.checks[1].fix, /Share bronze into the board/);
  assert.equal(statuses(model.boards.find(entry => entry.title === 'Unfold')).route, 'problem', 'a board whose allowed repository is not ready says its tasks are refused');
  assert.equal(model.problems, 5);
  assert.equal(model.warnings, 1);
  assert.equal(connectionsHeadline(model), '5 problems to fix and 1 to check across 2 boards and 2 repositories.');
  const html = connectionsMarkup(model, { now: at });
  assert.match(html, /In Unfold, not routed by Ploeg/);
  assert.match(html, /A hand-off assigns the Team and nothing starts\./);
  assert.match(html, /Add an AGENTS\.md at the root of main/);
  assert.match(html, /Boards checked 20 min ago/);
});

test('a task source that sends work elsewhere than the board routes is flagged', () => {
  const model = connectionsModel(data({ boards: [board('Unfold', { sources: [{ id: 'u', name: 'Unfold tasks', target: 'acme/other@main', routed: false }] })] }), at);
  const check = model.boards[0].checks.find(entry => entry.id === 'unfold');
  assert.equal(check.status, 'warning');
  assert.match(check.text, /Unfold tasks sends its tasks to acme\/other@main, which this board does not route to/);
});

test('unknown shares and an older Ploeg say so instead of guessing', () => {
  const unknown = connectionsModel(data({ checkedAt: null, boards: [board('Unfold', { webhook: 'unchecked', teams: [{ team: 'bronze', assignees: [{ username: 'bronze', shared: null }] }] })] }), at);
  assert.deepEqual(statuses(unknown.boards[0]).teams, 'unknown');
  assert.equal(statuses(unknown.boards[0]).webhook, 'info');
  assert.match(connectionsMarkup(unknown, { now: at }), /Ploeg has not finished its first board check/);
  const older = connectionsModel({ supported: false, repositories: [], boards: [], unrouted: [] }, at);
  assert.equal(connectionsHeadline(older), 'This Ploeg does not report its connections yet.');
  assert.match(connectionsMarkup(older, { now: at }), /Ploeg ADR-0129/);
  assert.doesNotMatch(connectionsMarkup(older, { now: at }), /class="card/);
});

test('names from Ploeg are escaped', () => {
  const html = connectionsMarkup(connectionsModel(data({ boards: [board('<img src=x onerror=alert(1)>')] }), at), { now: at });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

const stages = manage => [
  { id: 'sign-in', stage: 0, title: 'Sign in', status: 'ok', text: 'You are signed in.' },
  { id: 'installation', stage: 1, title: 'Installation', status: 'problem', text: 'An install value is missing.', ...(manage ? { action: { label: 'Show the install values', kind: 'install-values' } } : { fix: 'Ask an administrator to connect this.' }), checks: [{ id: 'install-bindings', stage: 1, title: 'The Team accepts Lists from the screen', status: 'problem', reason: 'bindings_not_accepted', text: 'The installation has not opted in.', install: 'teams.<team>.trackerBindings.connections' }] },
  { id: 'bind-lists', stage: 9, title: 'Bind Lists', status: 'unavailable', text: 'This Ploeg does not bind Lists to a Team at runtime yet.', waitsFor: { record: 'Ploeg ADR-0186', release: null }, configEntry: 'Ploeg: trackers.<tracker>.projects', ...(manage ? { action: { label: 'Show the configuration entry', kind: 'config-entry' }, fix: 'Until then, add it to the configuration.' } : { fix: 'Ask an administrator to connect this.' }) },
];

test('the checklist shows each stage with its state, its fix and the action that fixes it', () => {
  const checklist = { manage: true, stages: stages(true), installValues: [{ prerequisite: 'A Team exists', value: 'executor.teams[]', read: 'Teams read' }] };
  assert.equal(checklistHeadline(checklist), '1 of 3 stages done. Next: Installation.');
  const html = checklistMarkup(checklist);
  assert.match(html, /Not opted in/);
  assert.match(html, /Install value: <code>teams\.&lt;team&gt;\.trackerBindings\.connections<\/code>/);
  assert.match(html, /Show the install values/);
  assert.match(html, /executor\.teams\[\]/);
  assert.match(html, /Not available yet/);
  assert.match(html, /Waits for Ploeg ADR-0186\./);
  assert.match(html, /Show the configuration entry/);
  assert.doesNotMatch(html, /…|text-overflow/);
});

test('someone who does not manage the Tenant reads the checklist without actions', () => {
  const html = checklistMarkup({ manage: false, stages: stages(false), installValues: [] });
  assert.match(html, /Ask an administrator to connect what is missing/);
  assert.match(html, /Ask an administrator to connect this\./);
  assert.doesNotMatch(html, /Show the install values|Show the configuration entry|<button/);
});

test('every configured board and repository says it is configured by the installation', () => {
  const html = connectionsMarkup(connectionsModel(data(), at), { now: at });
  assert.equal(html.match(/Configured by the installation/g).length, 3);
});

test('the Budget line offers one confirm button per unconfirmed cap, naming the amount, its period and the Team in full', () => {
  const budgetLine = { id: 'budget', stage: 6, title: 'Budget', status: 'pending', text: 'delivery: USD 12.50 a week, not confirmed yet.', action: { label: 'Confirm the spend cap', kind: 'confirm-cap' } };
  const cap = { usd: 12.5, period: 'week', periodEnd: '2026-11-23T00:00:00.000Z', remainingUsd: 12.5 };
  const html = checklistMarkup({ manage: true, stages: [budgetLine], installValues: [], budget: [
    { team: 'delivery', spendCap: cap, confirmed: null, changed: null, bindable: true },
    { team: 'research', spendCap: { ...cap, usd: 20, period: 'day' }, confirmed: { team: 'research', usd: 20, period: 'day', at: '2026-11-17T10:00:00.000Z' }, changed: null, bindable: true },
    { team: 'bronze', spendCap: null, confirmed: null, changed: null, bindable: false },
  ] });
  assert.match(html, /data-action="connections-confirm-cap"[^>]*data-team="delivery"[^>]*data-usd="12\.5"[^>]*data-period="week"/);
  assert.match(html, /Confirm USD 12\.50 a week for delivery/);
  assert.equal(html.match(/connections-confirm-cap/g).length, 1, 'a confirmed cap and a Team without one get no button');
  assert.doesNotMatch(html, /…/);
});

test('a readiness line offers one Prepare button per Team with its cap, a cancel button, and opens the pull request in a new tab', () => {
  const offer = { id: 'prepare:site', stage: 7, title: 'acme/site', status: 'pending', text: 'Only AGENTS.md is missing.', actions: [{ label: 'Prepare this repository · USD 20.00 on delivery', kind: 'prepare', data: { target: 'site', team: 'delivery', usd: '20' } }] };
  const running = { id: 'prepare:app', stage: 7, title: 'acme/app', status: 'pending', text: 'Ploeg is preparing acme/app.', action: { label: 'Cancel', kind: 'cancel-prepare', data: { target: 'app' } } };
  const review = { id: 'review:web', stage: 8, title: 'acme/web', status: 'warning', text: 'Review and merge the readiness pull request.', action: { label: 'Open the pull request', href: 'https://github.com/acme/web/pull/7', kind: 'link', external: true } };
  const html = checklistMarkup({ manage: true, installValues: [], budget: [], stages: [{ id: 'prepare-repository', stage: 7, title: 'Prepare a repository', status: 'pending', text: 'x', checks: [offer, running] }, { id: 'review-and-merge', stage: 8, title: 'Review and merge', status: 'warning', text: 'y', checks: [review] }] });
  assert.match(html, /data-action="connections-prepare"[^>]*data-target="site"[^>]*data-team="delivery"[^>]*data-usd="20"/);
  assert.match(html, /Prepare this repository · USD 20\.00 on delivery/);
  assert.match(html, /data-action="connections-cancel-prepare"[^>]*data-target="app"/);
  assert.match(html, /href="https:\/\/github\.com\/acme\/web\/pull\/7"[^>]*target="_blank"/);
});
