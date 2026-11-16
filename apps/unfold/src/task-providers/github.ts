import type { FiledIssue, IssueFix } from '../tasks.ts';
import type { IssueFiling, TaskProviderAdapter } from './registry.ts';
import { authorize, isPullRequest, ownerRepository, parseRepositoryIssue, releaseAfter, repositoryIssueDetails, repositoryIssuePath, repositoryIssueUrl } from './repository-issues.ts';
import { apiWebRoot, listPage, numericId, plainComment, readOne, record, TaskError, when } from './shared.ts';

const gheComApiHost = /^api\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.ghe\.com$/;

function githubApiRoot(parsed: URL, path: string): void {
  const rule = 'GitHub baseUrl must be https://api.github.com, a GHE.com API root https://api.SUBDOMAIN.ghe.com, or a GitHub Enterprise Server API root ending with /api/v3';
  const host = parsed.hostname.replace(/\.$/, '');
  if (host === 'ghe.com' || host.endsWith('.ghe.com')) {
    if (!gheComApiHost.test(parsed.hostname) || parsed.port || path !== '') throw new Error(rule);
    return;
  }
  if (!(parsed.hostname === 'api.github.com' && path === '') && !path.endsWith('/api/v3')) throw new Error(rule);
}

function pullRequestIn(target: string, entry: Record<string, unknown>): IssueFix | undefined {
  const issue = record(record(entry.source ?? {}).issue ?? {});
  const pull = record(issue.pull_request ?? {});
  const url = typeof pull.html_url === 'string' ? pull.html_url : typeof issue.html_url === 'string' ? issue.html_url : '';
  const number = String(issue.number ?? '');
  if (!issue.pull_request || !numericId.test(number) || !url.toLowerCase().endsWith(`/${target}/pull/${number}`)) return undefined;
  const mergedAt = when(pull.merged_at);
  return { number, url, merged: Boolean(mergedAt), ...(mergedAt ? { mergedAt } : {}) };
}

/**
 * Report a problem on GitHub: an issue in a repository with the label `reported-in-app` when the repository has it,
 * Markdown bodies, and a state that follows the newest pull request of the same repository that references the issue
 * to the first release of the running version's line after it merged. GitHub's REST API takes no issue attachments,
 * so the body names the screenshot and buffers as not attached.
 */
export const githubIssues: IssueFiling = {
  bodyFormat: 'markdown',
  loginField: 'login',
  describe: project => `GitHub · ${project}`,
  async create(_source, target, title, body, call): Promise<FiledIssue> {
    const label = await call('GET', `/repos/${target}/labels/reported-in-app`).then(value => String(record(value).name ?? '').toLowerCase() === 'reported-in-app', () => false);
    const issue = record(await call('POST', `/repos/${target}/issues`, { title, body, ...(label ? { labels: ['reported-in-app'] } : {}) }));
    const number = String(issue.number ?? '');
    if (!numericId.test(number) || typeof issue.html_url !== 'string') throw new TaskError(502, 'task_response_invalid', 'The tracker did not answer with an issue number and address.');
    return { id: String(issue.id ?? number), number, url: issue.html_url };
  },
  async state(_source, target, issue, version, login, call) {
    const value = record(await call('GET', `/repos/${target}/issues/${issue.number}`));
    const timeline = await call('GET', `/repos/${target}/issues/${issue.number}/timeline?per_page=100`).catch(() => []);
    const events = (Array.isArray(timeline) ? timeline : []).map(entry => record(entry));
    const comments = events.filter(entry => entry.event === 'commented' && when(entry.created_at)).map(entry => {
      const author = String(record(entry.user ?? entry.actor ?? {}).login ?? '');
      return { id: String(entry.id ?? ''), author, text: plainComment(entry.body, false), at: when(entry.created_at)!, mine: Boolean(login) && author === login };
    }).filter(comment => comment.text);
    const fix = events.filter(entry => entry.event === 'cross-referenced').map(entry => pullRequestIn(target, entry)).filter((entry): entry is IssueFix => Boolean(entry)).at(-1);
    const release = fix?.mergedAt ? await releaseAfter(call, `/repos/${target}/releases?per_page=50`, fix.mergedAt, version).catch(() => undefined) : undefined;
    const labels = (Array.isArray(value.labels) ? value.labels : []).map(label => String(record(label).name ?? '')).filter(Boolean);
    const assignees = Array.isArray(value.assignees) ? value.assignees : [];
    return { open: value.state !== 'closed', ...(when(value.closed_at) ? { closedAt: when(value.closed_at) } : {}), labels, assigned: assignees.length > 0, comments: comments.slice(-10), ...(fix ? { fix } : {}), ...(release ? { release } : {}) };
  },
  async comment(_source, target, issue, body, call) {
    await call('POST', `/repos/${target}/issues/${issue.number}/comments`, { body });
  },
};

/** GitHub issues of one repository on github.com, GHE.com or GitHub Enterprise Server, read with a Bearer token. */
export const github: TaskProviderAdapter = {
  name: 'github',
  label: 'GitHub',
  descriptionFormat: 'markdown',
  taskId: numericId,
  issues: githubIssues,
  apiRoot: githubApiRoot,
  project: ownerRepository,
  webRoot(source) {
    const host = new URL(source.baseUrl).hostname;
    if (host === 'api.github.com') return 'https://github.com';
    const gheCom = gheComApiHost.exec(host);
    if (gheCom) return `https://${gheCom[1]}.ghe.com`;
    return apiWebRoot(source);
  },
  taskUrl: (source, id, _value, base) => repositoryIssueUrl(source, id, base),
  headers(source, headers) {
    headers.Accept = 'application/vnd.github+json';
    headers['X-GitHub-Api-Version'] = '2022-11-28';
    authorize(source, headers, 'Bearer');
  },
  parse: parseRepositoryIssue,
  details: (_source, value, read) => repositoryIssueDetails(value, read),
  list: (source, page, reading) => listPage(page, reading, { path: repositoryIssuePath(source), query: { page: String(page), per_page: '50', state: 'open', sort: 'updated', direction: 'desc' }, pageSize: 50, skip: isPullRequest }),
  read: (source, id, truncate, reading) => readOne(id, truncate, reading, `${repositoryIssuePath(source)}/${id}`),
};
