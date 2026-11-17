import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TaskSourceConfig } from '../tasks.ts';
import type { AppAuthentication, SourceApp } from './registry.ts';
import { numericId, record, TaskError } from './shared.ts';

/** The permissions an installation token asks for: issues to file, label and comment, metadata GitHub requires, and contents to list releases. */
export const githubAppPermissions: Readonly<Record<string, 'read' | 'write'>> = { issues: 'write', metadata: 'read', contents: 'read' };

const clientId = /^Iv[0-9A-Za-z._-]{1,62}$/;
const envName = /^[A-Z][A-Z0-9_]{0,127}$/;
const fields = new Set(['appId', 'installationId', 'privateKeyEnv', 'privateKeyFile']);
const renewBeforeMs = 5 * 60_000;
const timeoutMs = 10_000;
const maxCached = 200;
const levels: Record<string, number> = { read: 1, write: 2, admin: 3 };

type Grant = { token: string; expiresAt: number };
const grants = new Map<string, Grant>();
const minting = new Map<string, Promise<Grant>>();
const installations = new Map<string, string>();

function identifier(value: unknown): string | undefined {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' ? text : undefined;
}

function parse(raw: unknown, label: string): SourceApp {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label}.githubApp must be an object with appId and privateKeyEnv or privateKeyFile`);
  const value = raw as Record<string, unknown>;
  const unknown = Object.keys(value).filter(key => !fields.has(key));
  if (unknown.length) throw new Error(`${label}.githubApp takes appId, installationId, privateKeyEnv and privateKeyFile only, not ${unknown.join(', ')}`);
  const id = identifier(value.appId);
  if (!id || !(numericId.test(id) || clientId.test(id))) throw new Error(`${label}.githubApp.appId must be the GitHub App's numeric App ID or its Client ID`);
  const installationId = value.installationId === undefined ? undefined : identifier(value.installationId);
  if (value.installationId !== undefined && (!installationId || !numericId.test(installationId))) throw new Error(`${label}.githubApp.installationId must be a numeric installation ID; leave it out to look the installation up from the repository`);
  if ((value.privateKeyEnv === undefined) === (value.privateKeyFile === undefined)) throw new Error(`${label}.githubApp needs exactly one of privateKeyEnv and privateKeyFile`);
  if (value.privateKeyEnv !== undefined && (typeof value.privateKeyEnv !== 'string' || !envName.test(value.privateKeyEnv))) throw new Error(`${label}.githubApp.privateKeyEnv must name an environment variable`);
  if (value.privateKeyFile !== undefined && (typeof value.privateKeyFile !== 'string' || !value.privateKeyFile.startsWith('/') || value.privateKeyFile.length > 1024 || /[\u0000-\u001f]/.test(value.privateKeyFile))) throw new Error(`${label}.githubApp.privateKeyFile must be an absolute path`);
  return { id, ...(installationId ? { installationId } : {}), privateKey: typeof value.privateKeyEnv === 'string' ? { env: value.privateKeyEnv } : { file: value.privateKeyFile as string } };
}

function keyText(app: SourceApp): string | undefined {
  if ('env' in app.privateKey) return process.env[app.privateKey.env];
  try { return readFileSync(app.privateKey.file, 'utf8'); } catch { return undefined; }
}

function privateKey(app: SourceApp): KeyObject {
  const where = 'env' in app.privateKey ? `the variable ${app.privateKey.env}` : `the file ${app.privateKey.file}`;
  const text = keyText(app)?.trim();
  if (!text) throw new TaskError(502, 'github_app_key_unreadable', `The GitHub App's private key is missing: ${where} is empty or cannot be read.`);
  try {
    const key = createPrivateKey(text.includes('\n') ? text : text.replaceAll('\\n', '\n'));
    if (key.asymmetricKeyType !== 'rsa') throw new Error('not RSA');
    return key;
  } catch { throw new TaskError(502, 'github_app_key_unreadable', `The GitHub App's private key in ${where} is not a PEM RSA private key.`); }
}

function keyProblem(app: SourceApp): string | undefined {
  try { privateKey(app); return undefined; } catch (error) { return (error as Error).message; }
}

/** A JSON Web Token that authenticates as the app for at most nine minutes, issued a minute in the past against clock drift. */
export function appJwt(app: SourceApp, now = Date.now()): string {
  const seconds = Math.floor(now / 1000);
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: seconds - 60, exp: seconds + 540, iss: numericId.test(app.id) ? Number(app.id) : app.id })}`;
  return `${unsigned}.${sign('sha256', Buffer.from(unsigned), privateKey(app)).toString('base64url')}`;
}

async function appCall(source: TaskSourceConfig, method: 'GET' | 'POST', path: string, jwt: string, refusal: Record<number, TaskError>, body?: unknown): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(`${source.baseUrl}${path}`), { method, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'unfold-task-connector', Authorization: `Bearer ${jwt}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual', signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      if (refusal[response.status]) throw refusal[response.status];
      if (response.status === 401 || response.status === 403) throw new TaskError(502, 'github_app_rejected', 'GitHub refused the GitHub App\'s signed request. Check the configured appId and that the private key belongs to that App and was not revoked.');
      if (response.status >= 300 && response.status < 400) throw new TaskError(502, 'task_redirect_refused', 'The task service redirected the request. Update its configured API root.');
      throw new TaskError(502, 'task_service_failed', 'The task service could not complete this request.');
    }
    try { return record(await response.json()); } catch { throw new TaskError(502, 'task_response_invalid', 'GitHub answered the GitHub App request with something other than a JSON object.'); }
  } catch (error) {
    if (error instanceof TaskError) throw error;
    if (controller.signal.aborted) throw new TaskError(504, 'task_timeout', 'The task service did not respond in time.');
    throw new TaskError(502, 'task_unreachable', 'The task service could not be reached. Check its configured URL and network access.');
  } finally { clearTimeout(timer); }
}

function repository(source: TaskSourceConfig): { owner: string; name: string } {
  const [owner, name] = source.project.split('/');
  return { owner, name };
}

function notInstalled(source: TaskSourceConfig): TaskError {
  return new TaskError(502, 'github_app_not_installed', `The GitHub App is not installed on ${source.project}, or its installation does not include that repository. Install it there, or correct installationId.`);
}

function installationKey(source: TaskSourceConfig, app: SourceApp): string { return `${source.baseUrl}\u0000${app.id}\u0000${source.project}`; }

async function installationOf(source: TaskSourceConfig, app: SourceApp, jwt: string): Promise<string> {
  if (app.installationId) return app.installationId;
  const key = installationKey(source, app);
  const known = installations.get(key);
  if (known) return known;
  const { owner, name } = repository(source);
  const answer = await appCall(source, 'GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/installation`, jwt, { 404: notInstalled(source) });
  const id = identifier(answer.id);
  if (!id || !numericId.test(id)) throw new TaskError(502, 'task_response_invalid', 'GitHub did not answer with an installation ID.');
  if (installations.size >= maxCached) installations.delete(installations.keys().next().value!);
  installations.set(key, id);
  return id;
}

/** The parts of a granted token that reach further than `wanted` and the one repository: another permission, a higher level, or another or every repository. */
export function widerThanAsked(answer: Record<string, unknown>, repositoryName: string, wanted: Readonly<Record<string, string>> = githubAppPermissions): string[] {
  const granted = answer.permissions && typeof answer.permissions === 'object' && !Array.isArray(answer.permissions) ? answer.permissions as Record<string, unknown> : {};
  const wider = Object.entries(granted).filter(([name, level]) => !wanted[name] || (levels[String(level)] ?? Infinity) > levels[wanted[name]]).map(([name, level]) => `${name}: ${String(level)}`);
  const repositories = Array.isArray(answer.repositories) ? answer.repositories : undefined;
  if (answer.repository_selection !== 'selected') wider.push(`repository_selection: ${String(answer.repository_selection)}`);
  else if (!repositories) wider.push('repositories: not listed');
  else for (const entry of repositories) {
    const name = entry && typeof entry === 'object' ? String((entry as Record<string, unknown>).name ?? '') : '';
    if (name.toLowerCase() !== repositoryName.toLowerCase()) wider.push(`repository: ${name || 'unnamed'}`);
  }
  return wider;
}

async function mint(source: TaskSourceConfig, app: SourceApp, key: string): Promise<Grant> {
  const jwt = appJwt(app);
  const installation = await installationOf(source, app, jwt);
  const { name } = repository(source);
  const missing = new TaskError(502, 'github_app_permissions_missing', `GitHub refused a token for ${source.project} with Issues read and write, Metadata read and Contents read. Give the GitHub App those repository permissions and accept them on its installation.`);
  let answer: Record<string, unknown>;
  try {
    answer = await appCall(source, 'POST', `/app/installations/${installation}/access_tokens`, jwt, { 404: notInstalled(source), 422: missing }, { repositories: [name], permissions: githubAppPermissions });
  } catch (error) {
    if (error instanceof TaskError && error.code === 'github_app_not_installed') installations.delete(installationKey(source, app));
    throw error;
  }
  const expiresAt = Date.parse(String(answer.expires_at ?? ''));
  if (typeof answer.token !== 'string' || !answer.token || /[^\x21-\x7e]/.test(answer.token) || !Number.isFinite(expiresAt)) throw new TaskError(502, 'task_response_invalid', 'GitHub did not answer with an installation token and its expiry.');
  const wider = widerThanAsked(answer, name);
  if (wider.length) throw new TaskError(502, 'github_app_grant_too_wide', `GitHub granted the GitHub App's token more than Unfold asked for (${wider.join(', ')}), so Unfold does not use it. Unfold asks for ${source.project} only, with Issues write, Metadata read and Contents read.`);
  const grant = { token: answer.token, expiresAt };
  if (grants.size >= maxCached && !grants.has(key)) grants.delete(grants.keys().next().value!);
  grants.set(key, grant);
  return grant;
}

function cacheKey(source: TaskSourceConfig, app: SourceApp): string { return `${source.baseUrl}\u0000${app.id}\u0000${app.installationId ?? ''}\u0000${source.project}`; }

function appOf(source: TaskSourceConfig): SourceApp {
  if (!source.app) throw new TaskError(502, 'task_credentials_rejected', 'The task source has no GitHub App configured.');
  return source.app;
}

async function token(source: TaskSourceConfig, fresh: boolean): Promise<string> {
  const app = appOf(source);
  const key = cacheKey(source, app);
  const held = grants.get(key);
  if (fresh && held) grants.delete(key);
  else if (held && held.expiresAt - Date.now() > renewBeforeMs) return held.token;
  let pending = minting.get(key);
  if (!pending) {
    pending = mint(source, app, key).finally(() => minting.delete(key));
    minting.set(key, pending);
  }
  return (await pending).token;
}

function cached(source: TaskSourceConfig): string | undefined {
  return source.app ? grants.get(cacheKey(source, source.app))?.token : undefined;
}

const logins = new Map<string, Promise<string>>();

/** The login GitHub shows on what the app writes: its slug followed by `[bot]`, read once per app with `GET /app`. */
function login(source: TaskSourceConfig): Promise<string> {
  const app = appOf(source);
  const key = `${source.baseUrl}\u0000${app.id}`;
  let known = logins.get(key);
  if (!known) {
    known = appCall(source, 'GET', '/app', appJwt(app), {}).then(answer => {
      const slug = typeof answer.slug === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/i.test(answer.slug) ? answer.slug : undefined;
      if (!slug) throw new TaskError(502, 'task_response_invalid', 'GitHub did not answer with the GitHub App\'s slug.');
      return `${slug}[bot]`;
    });
    known.catch(() => logins.delete(key));
    logins.set(key, known);
  }
  return known;
}

/** Authenticating a GitHub source as a GitHub App: installation tokens for one repository and named permissions, minted by Unfold and renewed five minutes before they expire. */
export const githubApp: AppAuthentication = { field: 'githubApp', parse, keyProblem, token, cached, login };
