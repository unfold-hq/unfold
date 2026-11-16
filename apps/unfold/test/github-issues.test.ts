import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { application, login } from './api-support.ts';
import { reportSettings } from '../src/reports.ts';
import { attachToIssue, canAttachToIssue, commentOnIssue, createIssue, describeIssueTarget, readIssueState, type FiledIssue, type TaskSourceConfig } from '../src/tasks.ts';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const runningVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

type Call = { method: string; path: string; authorization: string; accept: string; apiVersion: string; type: string; body: string };
type Answer = { status: number; body: unknown };

async function fakeGitHub(answer: (call: Call) => Answer | undefined): Promise<{ url: string; calls: Call[]; close: () => Promise<void> }> {
  const calls: Call[] = [];
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const call = { method: req.method ?? '', path: req.url ?? '', authorization: String(req.headers.authorization ?? ''), accept: String(req.headers.accept ?? ''), apiVersion: String(req.headers['x-github-api-version'] ?? ''), type: String(req.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString() };
    calls.push(call);
    const { status, body } = call.authorization === 'Bearer github-test-token' ? answer(call) ?? { status: 404, body: { message: 'Not Found' } } : { status: 401, body: { message: 'Bad credentials' } };
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}/api/v3`, calls, close: () => new Promise<void>(done => { server.close(() => done()); server.closeIdleConnections(); }) };
}

function githubSource(baseUrl: string): TaskSourceConfig {
  return { id: 'gh', name: 'GitHub', provider: 'github', baseUrl, project: 'acme/unfold', repositoryId: 'order-service', token: 'github-test-token', executionOwner: 'interactive' };
}

function report(): FormData {
  const form = new FormData();
  form.append('title', 'The Now page shows a stale count');
  form.append('happened', 'The waiting count said 9 but only 7 rows were listed.');
  form.append('expected', 'The count matches the rows.');
  form.append('kind', 'broken');
  form.append('context', JSON.stringify({ route: '#now', screen: 'now' }));
  form.append('screenshot', new Blob([png], { type: 'image/png' }), 'screenshot.png');
  form.append('console', new Blob([JSON.stringify([{ level: 'error', message: 'TypeError: x is undefined' }])], { type: 'application/json' }), 'console.json');
  return form;
}

const issueAnswer = (call: Call): Answer | undefined => {
  if (call.method === 'POST' && call.path === '/api/v3/repos/acme/unfold/issues') return { status: 201, body: { id: 3001, number: 77, html_url: 'https://github.example/acme/unfold/issues/77', state: 'open' } };
  return undefined;
};

test('a report is filed as a GitHub issue with the reported-in-app label, a Markdown body and its files named as not attached', async t => {
  const github = await fakeGitHub(call => {
    if (call.method === 'GET' && call.path === '/api/v3/repos/acme/unfold/labels/reported-in-app') return { status: 200, body: { id: 5, name: 'Reported-In-App' } };
    return issueAnswer(call);
  });
  t.after(() => github.close());
  const app = await application('live', config => { config.taskSources = [githubSource(github.url)]; config.reports = { source: githubSource(github.url), project: 'acme/unfold' }; config.baseUrl = undefined; });
  t.after(() => app.close());
  const { cookie } = await login(app.url);

  const response = await fetch(`${app.url}/api/reports`, { method: 'POST', headers: { cookie, 'x-unfold-request': '1' }, body: report() });
  const filed = await response.json();
  assert.equal(response.status, 201, JSON.stringify(filed));
  assert.deepEqual({ status: filed.status, url: filed.url }, { status: 'filed', url: 'https://github.example/acme/unfold/issues/77' });

  const created = github.calls.find(call => call.method === 'POST' && call.path.endsWith('/issues'))!;
  assert.equal(created.type, 'application/json');
  assert.equal(created.accept, 'application/vnd.github+json');
  assert.equal(created.apiVersion, '2022-11-28');
  const issue = JSON.parse(created.body);
  assert.equal(issue.title, 'The Now page shows a stale count');
  assert.deepEqual(issue.labels, ['reported-in-app'], 'GitHub takes label names, and the label is only sent when the repository has it');
  assert.match(issue.body, /## What went wrong\n\nThe waiting count said 9/);
  assert.match(issue.body, /Not attached, because this tracker takes no file uploads: screenshot\.png, console\.json\./);
  assert.doesNotMatch(issue.body, /^Attached:/m);
  assert.doesNotMatch(issue.body, /!\[Screenshot\]/);
  assert.deepEqual(github.calls.map(call => `${call.method} ${call.path}`), ['GET /api/v3/repos/acme/unfold/labels/reported-in-app', 'POST /api/v3/repos/acme/unfold/issues'], 'no upload and no body update is attempted');
  assert.deepEqual({ ...(app.app.store.db.prepare('SELECT status FROM reports').get() as Record<string, string>) }, { status: 'filed' });
});

test('GitHub issue filing leaves the label out when the repository lacks it, and refuses attachments', async t => {
  const github = await fakeGitHub(issueAnswer);
  t.after(() => github.close());
  const source = githubSource(github.url);
  assert.equal(describeIssueTarget(source, 'acme/unfold'), 'GitHub · acme/unfold');
  assert.equal(canAttachToIssue(source), false);
  const issue = await createIssue(source, 'Acme/Unfold', 'Broken', 'body');
  assert.deepEqual(issue, { id: '3001', number: '77', url: 'https://github.example/acme/unfold/issues/77' });
  assert.equal(JSON.parse(github.calls.at(-1)!.body).labels, undefined, 'a missing label is never created by filing');
  await assert.rejects(attachToIssue(source, 'acme/unfold', issue, { name: 'screenshot.png', type: 'image/png', bytes: png }), { code: 'report_attachments_unsupported' });
  await assert.rejects(createIssue({ ...source, token: 'wrong' }, 'acme/unfold', 'Broken', 'body'), { code: 'report_write_forbidden' });
});

test('a filed GitHub issue is followed: comments, the merged pull request of the same repository and the release that carries it', async t => {
  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
  const github = await fakeGitHub(call => {
    if (call.path === '/api/v3/user') return { status: 200, body: { login: 'unfold-reports' } };
    if (call.method === 'GET' && call.path === '/api/v3/repos/acme/unfold/issues/77') return { status: 200, body: { number: 77, state: 'closed', closed_at: later(60), labels: [{ name: 'bug' }], assignees: [{ login: 'ada' }] } };
    if (call.path === '/api/v3/repos/acme/unfold/issues/77/timeline?per_page=100') return { status: 200, body: [
      { id: 1, event: 'commented', body: 'Thanks, **looking**. ![x](https://github.example/x.png)', user: { login: 'ada' }, created_at: later(10) },
      { id: 2, event: 'commented', body: '**Someone** adds, from Unfold', user: { login: 'unfold-reports' }, created_at: later(15) },
      { event: 'cross-referenced', created_at: later(20), source: { type: 'issue', issue: { number: 12, html_url: 'https://github.example/other/repo/pull/12', pull_request: { html_url: 'https://github.example/other/repo/pull/12', merged_at: later(30) } } } },
      { event: 'cross-referenced', created_at: later(25), source: { type: 'issue', issue: { number: 80, html_url: 'https://github.example/Acme/Unfold/pull/80', pull_request: { html_url: 'https://github.example/Acme/Unfold/pull/80', merged_at: later(50) } } } },
      { event: 'cross-referenced', created_at: later(26), source: { type: 'issue', issue: { number: 81, html_url: 'https://github.example/acme/unfold/issues/81' } } },
      { event: 'closed', created_at: later(60) },
    ] };
    if (call.path === '/api/v3/repos/acme/unfold/releases?per_page=50') return { status: 200, body: [
      { tag_name: `v${runningVersion}`, html_url: 'https://github.example/r/running', created_at: later(90) },
      { tag_name: 'v0.0.1-rc.2', html_url: 'https://github.example/r/first', created_at: later(70) },
      { tag_name: 'v0.0.1-rc.3', html_url: 'https://github.example/r/draft', created_at: later(65), draft: true },
    ] };
    if (call.method === 'POST' && call.path === '/api/v3/repos/acme/unfold/issues/77/comments') return { status: 201, body: { id: 9 } };
    return undefined;
  });
  t.after(() => github.close());
  const source = githubSource(github.url);
  const issue: FiledIssue = { id: '3001', number: '77', url: 'https://github.example/acme/unfold/issues/77' };

  const state = await readIssueState(source, 'acme/unfold', issue, runningVersion);
  assert.equal(state.open, false);
  assert.deepEqual(state.labels, ['bug']);
  assert.equal(state.assigned, true);
  assert.deepEqual(state.comments.map(comment => [comment.author, comment.text, comment.mine]), [['ada', 'Thanks, **looking**. [image]', false], ['unfold-reports', '**Someone** adds, from Unfold', true]]);
  assert.deepEqual(state.fix, { number: '80', url: 'https://github.example/Acme/Unfold/pull/80', merged: true, mergedAt: state.fix?.mergedAt }, 'a pull request of another repository or a plain issue is no fix');
  assert.deepEqual({ tag: state.release?.tag, live: state.release?.live }, { tag: 'v0.0.1-rc.2', live: true });

  await commentOnIssue(source, 'acme/unfold', issue, '**Ada** adds, from Unfold:\n\nIt happens again.\n');
  assert.equal(JSON.parse(github.calls.at(-1)!.body).body, '**Ada** adds, from Unfold:\n\nIt happens again.\n');
});

test('reports can have a GitHub connection of their own on github.com or GitHub Enterprise', t => {
  process.env.UNFOLD_REPORTS_GITHUB_TEST_TOKEN = 'reports-token';
  t.after(() => { delete process.env.UNFOLD_REPORTS_GITHUB_TEST_TOKEN; });
  const cloud = reportSettings({ provider: 'github', baseUrl: 'https://api.github.com', project: 'Acme/Unfold', tokenEnv: 'UNFOLD_REPORTS_GITHUB_TEST_TOKEN' }, [], 'live');
  assert.deepEqual({ provider: cloud?.source.provider, baseUrl: cloud?.source.baseUrl, project: cloud?.project }, { provider: 'github', baseUrl: 'https://api.github.com', project: 'acme/unfold' });
  assert.equal(reportSettings({ provider: 'github', baseUrl: 'https://github.acme.example/api/v3', project: 'acme/unfold', tokenEnv: 'UNFOLD_REPORTS_GITHUB_TEST_TOKEN' }, [], 'live')?.source.baseUrl, 'https://github.acme.example/api/v3');
  assert.throws(() => reportSettings({ provider: 'github', baseUrl: 'https://github.com', project: 'acme/unfold', tokenEnv: 'UNFOLD_REPORTS_GITHUB_TEST_TOKEN' }, [], 'live'), /GitHub baseUrl must be/);
});
