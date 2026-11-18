#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The Keychain service every telemetry session of this helper is kept under; the account is the issuer. */
export const keychainService = 'dev.unfold.telemetry';
/** After a device flow the person did not approve, the helper waits this long before it asks again. */
export const askAgainAfterMs = 4 * 3600_000;
/** An access token that ends within this margin is refreshed before it is printed. */
export const refreshWithinMs = 60_000;
/** The longest `token` may take in all, so the plugin's sign-in never waits on it. */
export const tokenDeadlineMs = 5000;
const discoveryTtlMs = 24 * 3600_000;
const lockStaleMs = 30_000;
const deviceGrant = 'urn:ietf:params:oauth:grant-type:device_code';
const exchangeGrant = 'urn:ietf:params:oauth:grant-type:token-exchange';
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token';
const self = fileURLToPath(import.meta.url);
const tokenPattern = /^[\x21-\x7e]{1,16384}$/;
const userCodePattern = /^[A-Za-z0-9-]{1,64}$/;

/** The configuration, all from the environment: issuer, client id, scopes, optional audience, the header to print and the audience of the token the plugin's sign-in exchanges for. */
export function configuration(env = process.env) {
  const issuer = String(env.UNFOLD_TELEMETRY_ISSUER ?? '').trim().replace(/\/+$/, '');
  let valid = false;
  try { valid = ['https:', 'http:'].includes(new URL(issuer).protocol); } catch { valid = false; }
  return {
    issuer: valid ? issuer : '',
    clientId: String(env.UNFOLD_TELEMETRY_CLIENT_ID ?? '').trim(),
    scopes: String(env.UNFOLD_TELEMETRY_SCOPES ?? '').trim() || 'openid offline_access',
    audience: String(env.UNFOLD_TELEMETRY_AUDIENCE ?? '').trim(),
    header: String(env.UNFOLD_TELEMETRY_HEADER ?? '').trim() || 'Authorization',
    exchangeAudience: String(env.UNFOLD_TELEMETRY_EXCHANGE_AUDIENCE ?? '').trim() || 'unfold',
    notify: env.UNFOLD_TELEMETRY_NOTIFY !== '0',
    debug: env.UNFOLD_TELEMETRY_DEBUG === '1',
  };
}

/** Where the helper keeps its files: `plugins/data/unfold` under `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
export function dataDir(env = process.env) {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'plugins', 'data', 'unfold');
}

/** Masks every bearer value and every token-like field in `text`, so no message or log line carries one. */
export function redacted(text) {
  return String(text ?? '').replace(/(bearer\s+)[^\s"']+/gi, '$1[redacted]').replace(/("?(?:access|refresh|id|subject)_?token"?\s*[:=]\s*"?)[^\s",}]+/gi, '$1[redacted]');
}

function claims(token) {
  try {
    const [, payload] = String(token).split('.');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function validEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.issuer !== 'string' || typeof entry.clientId !== 'string') return null;
  const accessToken = typeof entry.accessToken === 'string' && tokenPattern.test(entry.accessToken) ? entry.accessToken : '';
  const refreshToken = typeof entry.refreshToken === 'string' && tokenPattern.test(entry.refreshToken) ? entry.refreshToken : '';
  if (!accessToken && !refreshToken) return null;
  return { issuer: entry.issuer, clientId: entry.clientId, accessToken, refreshToken, expiresAt: typeof entry.expiresAt === 'string' ? entry.expiresAt : '', user: typeof entry.user === 'string' ? entry.user.slice(0, 200) : '', scope: typeof entry.scope === 'string' ? entry.scope.slice(0, 500) : '' };
}

function encoded(entry) { return Buffer.from(JSON.stringify(entry), 'utf8').toString('base64url'); }

function decoded(text) {
  try { return validEntry(JSON.parse(Buffer.from(String(text).trim(), 'base64url').toString('utf8'))); } catch { return null; }
}

/** Sessions in the macOS login Keychain, one generic password per issuer. The tokens reach `security` on standard input, never as an argument. */
export function keychainStore(run = execFileSync) {
  const quiet = { encoding: 'utf8', timeout: 5000 };
  const read = issuer => {
    try { return decoded(run('security', ['find-generic-password', '-s', keychainService, '-a', issuer, '-w'], { ...quiet, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; }
  };
  return {
    kind: 'keychain',
    where: 'the macOS Keychain',
    read,
    write(issuer, entry) {
      const valid = validEntry(entry);
      if (!valid) throw new Error('Refusing to store a malformed telemetry session.');
      run('security', ['-i'], { ...quiet, input: `add-generic-password -U -s ${keychainService} -a ${issuer} -w ${encoded(valid)}\n`, stdio: ['pipe', 'ignore', 'ignore'] });
      if (read(issuer)?.accessToken !== valid.accessToken) throw new Error('The macOS Keychain did not keep the telemetry session.');
    },
    forget(issuer) {
      try { run('security', ['delete-generic-password', '-s', keychainService, '-a', issuer], { ...quiet, stdio: 'ignore' }); } catch { return; }
    },
  };
}

function saveJson(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

function readJson(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

/** Sessions in `telemetry.json` in the helper's data directory: a map from issuer to session, mode 0600 in a 0700 directory. */
export function fileStore(dir) {
  const file = join(dir, 'telemetry.json');
  return {
    kind: 'file',
    where: file,
    read: issuer => validEntry(readJson(file)[issuer]),
    write(issuer, entry) {
      const valid = validEntry(entry);
      if (!valid) throw new Error('Refusing to store a malformed telemetry session.');
      saveJson(file, { ...readJson(file), [issuer]: valid });
    },
    forget(issuer) {
      const next = readJson(file);
      if (!Object.hasOwn(next, issuer)) return;
      delete next[issuer];
      saveJson(file, next);
    },
  };
}

/**
 * Where this machine keeps its telemetry sessions: the macOS Keychain when `security` exists, with the file as the
 * fallback when the Keychain is missing or locked; elsewhere the file. `UNFOLD_TELEMETRY_STORE=file` or `keychain` chooses.
 */
export function telemetryStore(env = process.env, platform = process.platform, run = execFileSync) {
  const file = fileStore(dataDir(env));
  const chosen = env.UNFOLD_TELEMETRY_STORE;
  const keychain = chosen === 'keychain' || (chosen !== 'file' && platform === 'darwin' && existsSync('/usr/bin/security')) ? keychainStore(run) : null;
  if (!keychain) return { kind: 'file', read: issuer => ({ entry: file.read(issuer), where: file.where, fallback: false }), write: (issuer, entry) => { file.write(issuer, entry); return { where: file.where, fallback: false }; }, forget: issuer => file.forget(issuer) };
  return {
    kind: 'keychain',
    read(issuer) {
      const kept = keychain.read(issuer);
      if (kept) return { entry: kept, where: keychain.where, fallback: false };
      const fallen = file.read(issuer);
      return { entry: fallen, where: fallen ? file.where : keychain.where, fallback: Boolean(fallen) };
    },
    write(issuer, entry) {
      try { keychain.write(issuer, entry); file.forget(issuer); return { where: keychain.where, fallback: false }; } catch { file.write(issuer, entry); return { where: file.where, fallback: true }; }
    },
    forget(issuer) { keychain.forget(issuer); file.forget(issuer); },
  };
}

/** The file the device flow's progress and the discovery document are kept in. It holds no token. */
export function stateFile(env = process.env) { return join(dataDir(env), 'telemetry-state.json'); }

/** The state kept for `issuer`: the last device flow and the cached discovery document. */
export function readState(issuer, env = process.env) {
  const kept = readJson(stateFile(env))[issuer];
  return kept && typeof kept === 'object' ? kept : {};
}

/** Records `state` for `issuer`, merged over what is kept, without any secret. */
export function writeState(issuer, state, env = process.env) {
  const file = stateFile(env);
  const all = readJson(file);
  const kept = all[issuer] && typeof all[issuer] === 'object' ? all[issuer] : {};
  const next = Object.fromEntries(Object.entries({ ...kept, ...state }).filter(([key]) => key !== 'deviceCode'));
  saveJson(file, { ...all, [issuer]: next });
  return next;
}

/** Whether a device flow may be started now: not while one waits, and not within `askAgainAfterMs` of one the person did not approve. */
export function mayAsk(state, now = Date.now()) {
  if (!state || !state.status) return true;
  if (state.status === 'waiting' || state.status === 'starting') return !(Date.parse(state.expiresAt ?? '') > now);
  if (state.status === 'approved') return true;
  const ended = Date.parse(state.endedAt ?? state.askedAt ?? '');
  return !(Number.isFinite(ended) && now - ended < askAgainAfterMs);
}

function claim(file) {
  const lock = `${file}.lock`;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const take = () => {
    try { closeSync(openSync(lock, 'wx', 0o600)); return () => rmSync(lock, { force: true }); } catch { return null; }
  };
  const taken = take();
  if (taken) return taken;
  try { if (Date.now() - statSync(lock).mtimeMs <= lockStaleMs) return null; } catch { return take(); }
  rmSync(lock, { force: true });
  return take();
}

async function postForm(fetcher, url, fields, signal) {
  const body = new URLSearchParams(Object.entries(fields).filter(([, value]) => value !== '' && value !== undefined));
  const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString(), signal });
  const answer = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, answer: answer && typeof answer === 'object' ? answer : {} };
}

/** The issuer's endpoints from `/.well-known/openid-configuration`, cached in the state file for a day. */
export async function discover(issuer, { env = process.env, fetcher = fetch, now = Date.now(), timeoutMs = 5000 } = {}) {
  const cached = readState(issuer, env).discovery;
  if (cached && typeof cached === 'object' && now - Date.parse(cached.fetchedAt ?? '') < discoveryTtlMs && cached.tokenEndpoint) return cached;
  const response = await fetcher(`${issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`The issuer answered ${response.status} to discovery.`);
  const document = await response.json();
  const endpoint = name => {
    const value = String(document[name] ?? '');
    return /^https?:\/\/\S+$/.test(value) ? value : '';
  };
  const discovery = { tokenEndpoint: endpoint('token_endpoint'), deviceAuthorizationEndpoint: endpoint('device_authorization_endpoint'), fetchedAt: new Date(now).toISOString() };
  if (!discovery.tokenEndpoint) throw new Error('The issuer names no token endpoint.');
  writeState(issuer, { discovery }, env);
  return discovery;
}

function sessionFromTokens(answer, configurationValues, previous, now) {
  const accessToken = String(answer.access_token ?? '');
  if (!tokenPattern.test(accessToken)) return null;
  const lifetime = Number(answer.expires_in);
  const exp = Number(claims(accessToken).exp);
  const expiresAt = Number.isFinite(lifetime) && lifetime > 0 ? now + lifetime * 1000 : Number.isFinite(exp) && exp > 0 ? exp * 1000 : now + 3600_000;
  const identity = typeof answer.id_token === 'string' ? claims(answer.id_token) : claims(accessToken);
  const user = String(identity.email ?? identity.preferred_username ?? identity.name ?? identity.sub ?? previous?.user ?? '').slice(0, 200);
  return { issuer: configurationValues.issuer, clientId: configurationValues.clientId, accessToken, refreshToken: typeof answer.refresh_token === 'string' && tokenPattern.test(answer.refresh_token) ? answer.refresh_token : previous?.refreshToken ?? '', expiresAt: new Date(expiresAt).toISOString(), user, scope: String(answer.scope ?? previous?.scope ?? '') };
}

/** The stored session for the configured issuer and client, or null. A session of another client id is forgotten. */
export function readSession(configurationValues, store) {
  const { entry, where, fallback } = store.read(configurationValues.issuer);
  if (entry && entry.clientId !== configurationValues.clientId) { store.forget(configurationValues.issuer); return { entry: null, where, fallback }; }
  return { entry, where, fallback };
}

function usable(entry, now) {
  return Boolean(entry?.accessToken) && Date.parse(entry.expiresAt) - now > refreshWithinMs;
}

/**
 * Refreshes `entry` at the issuer with its refresh token. Resolves with the new session, `null` when the issuer refused
 * the refresh token (which forgets the session), or `entry` itself when the issuer could not be reached.
 */
export async function refresh(configurationValues, entry, { env = process.env, store, fetcher = fetch, now = Date.now(), signal = AbortSignal.timeout(5000) } = {}) {
  if (!entry?.refreshToken) return null;
  let discovery;
  try { discovery = await discover(configurationValues.issuer, { env, fetcher, now, timeoutMs: 5000 }); } catch { return entry; }
  let result;
  try { result = await postForm(fetcher, discovery.tokenEndpoint, { grant_type: 'refresh_token', refresh_token: entry.refreshToken, client_id: configurationValues.clientId, scope: configurationValues.scopes, audience: configurationValues.audience }, signal); } catch { return entry; }
  if (result.ok) {
    const session = sessionFromTokens(result.answer, configurationValues, entry, now);
    if (!session) return entry;
    store.write(configurationValues.issuer, session);
    return session;
  }
  if (result.status === 401 || result.answer.error === 'invalid_grant') { store.forget(configurationValues.issuer); return null; }
  return entry;
}

/** Resolves with a session whose access token is good for at least `refreshWithinMs`, refreshing when needed, or null. Never opens a browser. */
export async function currentSession(configurationValues, { env = process.env, store = telemetryStore(env), fetcher = fetch, now = Date.now(), signal } = {}) {
  const { entry } = readSession(configurationValues, store);
  if (!entry) return null;
  if (usable(entry, now)) return entry;
  const renewed = await refresh(configurationValues, entry, { env, store, fetcher, now, signal: signal ?? AbortSignal.timeout(5000) });
  return renewed && usable(renewed, now) ? renewed : null;
}

/** Opens `page` in the person's browser: `$BROWSER` when set, otherwise the platform's opener. Never throws and never waits. */
export function openBrowser(page, env = process.env, platform = process.platform) {
  if (!/^https?:\/\/\S+$/.test(page)) return;
  const [command, args] = env.BROWSER ? [env.BROWSER, [page]] : platform === 'darwin' ? ['open', [page]] : platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', page]] : ['xdg-open', [page]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch { return; }
}

/** Shows a desktop notification with the user code: `osascript` on macOS, `notify-send` on Linux when it exists. Never throws and never waits. */
export function notify(userCode, env = process.env, platform = process.platform) {
  if (env.UNFOLD_TELEMETRY_NOTIFY === '0' || !userCodePattern.test(userCode)) return;
  const message = `Approve the sign-in in your browser. The page must show ${userCode}.`;
  const [command, args] = platform === 'darwin' ? ['osascript', ['-e', `display notification "${message}" with title "Unfold telemetry"`]] : ['notify-send', ['Unfold telemetry', message]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch { return; }
}

/**
 * The OAuth 2.0 device authorization flow (RFC 8628): asks the issuer for a code, opens the verification page, shows
 * the code, and polls the token endpoint until the person approves or denies it or it expires. Stores the session on
 * approval. Resolves with the final status: `approved`, `denied`, `expired`, `failed` or `unavailable`.
 */
export async function deviceFlow(configurationValues, { env = process.env, store = telemetryStore(env), fetcher = fetch, clock = () => Date.now(), sleep = ms => new Promise(done => setTimeout(done, ms)), open = page => openBrowser(page, env), show = code => notify(code, env), report = line => void line } = {}) {
  const issuer = configurationValues.issuer;
  const finish = (status, extra = {}) => { writeState(issuer, { status, endedAt: new Date(clock()).toISOString(), ...extra }, env); return status; };
  let discovery;
  try { discovery = await discover(issuer, { env, fetcher, now: clock(), timeoutMs: 10_000 }); } catch (error) { report(`The issuer could not be reached: ${redacted(error.message)}`); return finish('unavailable', { message: redacted(error.message).slice(0, 300) }); }
  if (!discovery.deviceAuthorizationEndpoint) { report('The issuer offers no device authorization endpoint, so the helper cannot sign you in.'); return finish('unavailable', { message: 'no device_authorization_endpoint' }); }
  let started;
  try { started = await postForm(fetcher, discovery.deviceAuthorizationEndpoint, { client_id: configurationValues.clientId, scope: configurationValues.scopes, audience: configurationValues.audience }, AbortSignal.timeout(10_000)); } catch (error) { report(`The issuer could not be reached: ${redacted(error.message)}`); return finish('unavailable', { message: redacted(error.message).slice(0, 300) }); }
  const ticket = started.answer;
  const page = String(ticket.verification_uri_complete ?? ticket.verification_uri ?? '');
  const userCode = String(ticket.user_code ?? '');
  if (!started.ok || typeof ticket.device_code !== 'string' || !/^https?:\/\/\S+$/.test(page) || !userCode) { report(`The issuer refused to start a sign-in (${started.status}${ticket.error ? `, ${String(ticket.error).slice(0, 80)}` : ''}).`); return finish('failed', { message: `device authorization answered ${started.status}` }); }
  const expiresAt = clock() + (Number(ticket.expires_in) || 600) * 1000;
  let interval = Math.max(Number(ticket.interval) || 5, 1);
  writeState(issuer, { status: 'waiting', askedAt: new Date(clock()).toISOString(), expiresAt: new Date(expiresAt).toISOString(), userCode, page, endedAt: undefined, message: undefined }, env);
  report(`Your browser opens ${page}`);
  report(`Sign in and check that the page shows ${userCode}; approve it only then.`);
  open(page);
  show(userCode);
  while (clock() < expiresAt) {
    await sleep(interval * 1000);
    let polled;
    try { polled = await postForm(fetcher, discovery.tokenEndpoint, { grant_type: deviceGrant, device_code: ticket.device_code, client_id: configurationValues.clientId }, AbortSignal.timeout(10_000)); } catch { continue; }
    if (polled.ok) {
      const session = sessionFromTokens(polled.answer, configurationValues, null, clock());
      if (!session) return finish('failed', { message: 'the issuer sent no access token' });
      const kept = store.write(issuer, session);
      report(`Signed in to ${issuer}${session.user ? ` as ${session.user}` : ''}; kept in ${kept.where}.`);
      return finish('approved', { user: session.user });
    }
    const error = String(polled.answer.error ?? '');
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down') { interval += 5; continue; }
    if (error === 'access_denied') { report('You denied the sign-in.'); return finish('denied'); }
    if (error === 'expired_token') break;
    report(`The issuer refused the sign-in (${polled.status}${error ? `, ${error.slice(0, 80)}` : ''}).`);
    return finish('failed', { message: `token endpoint answered ${polled.status}` });
  }
  report('The sign-in expired before it was approved.');
  return finish('expired');
}

/** Starts the device flow in a detached process, so the caller exits at once. Only one flow starts per issuer at a time. */
export function startDeviceFlow(configurationValues, env = process.env, now = Date.now(), start = file => spawnFlow(file, env)) {
  const issuer = configurationValues.issuer;
  const release = claim(join(dataDir(env), `flow-${Buffer.from(issuer).toString('base64url').slice(0, 40)}`));
  if (!release) return false;
  try {
    if (!mayAsk(readState(issuer, env), now)) return false;
    writeState(issuer, { status: 'starting', askedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), endedAt: undefined, message: undefined, userCode: undefined, page: undefined }, env);
    start(self);
    return true;
  } finally { release(); }
}

function spawnFlow(file, env) {
  const child = spawn(process.execPath, [file, 'device-flow'], { detached: true, stdio: 'ignore', env });
  child.on('error', () => undefined);
  child.unref();
}

/**
 * The headers Claude Code sends with its telemetry: `{ [header]: 'Bearer <access token>' }` with a session, `{}` without
 * one. Without a session a device flow starts in the background when `mayAsk` allows. Never waits for the person.
 */
export async function headers(configurationValues, { env = process.env, store = telemetryStore(env), fetcher = fetch, now = Date.now(), start = () => startDeviceFlow(configurationValues, env, now) } = {}) {
  if (!configurationValues.issuer || !configurationValues.clientId) return {};
  const session = await currentSession(configurationValues, { env, store, fetcher, now });
  if (session) return { [configurationValues.header]: `Bearer ${session.accessToken}` };
  const { entry } = readSession(configurationValues, store);
  if (entry?.accessToken && Date.parse(entry.expiresAt) > now) return { [configurationValues.header]: `Bearer ${entry.accessToken}` };
  if (!entry?.refreshToken) start();
  return {};
}

/**
 * An access token for Unfold, obtained by RFC 8693 token exchange at the issuer with the telemetry access token as the
 * subject. Resolves with the token, or '' when there is no session, the issuer refused, or `tokenDeadlineMs` passed.
 */
export async function exchangeForUnfold(configurationValues, { env = process.env, store = telemetryStore(env), fetcher = fetch, now = Date.now(), signal = AbortSignal.timeout(tokenDeadlineMs) } = {}) {
  if (!configurationValues.issuer || !configurationValues.clientId) return '';
  const session = await currentSession(configurationValues, { env, store, fetcher, now, signal });
  if (!session) return '';
  let discovery;
  try { discovery = await discover(configurationValues.issuer, { env, fetcher, now, timeoutMs: tokenDeadlineMs }); } catch { return ''; }
  let result;
  try { result = await postForm(fetcher, discovery.tokenEndpoint, { grant_type: exchangeGrant, client_id: configurationValues.clientId, subject_token: session.accessToken, subject_token_type: accessTokenType, audience: configurationValues.exchangeAudience }, signal); } catch { return ''; }
  const token = String(result.answer.access_token ?? '');
  return result.ok && tokenPattern.test(token) ? token : '';
}

const say = line => process.stdout.write(`${line}\n`);
const notConfigured = 'UNFOLD_TELEMETRY_ISSUER and UNFOLD_TELEMETRY_CLIENT_ID are not set. Your organisation sets them in Claude Code’s managed settings, or add them to the env block of ~/.claude/settings.json.';

async function login(configurationValues) {
  const store = telemetryStore();
  const session = await currentSession(configurationValues, { store });
  if (session) { say(`Already signed in to ${configurationValues.issuer}${session.user ? ` as ${session.user}` : ''} until ${session.expiresAt}; the helper renews it by itself. Run logout first to sign in as someone else.`); return 0; }
  const status = await deviceFlow(configurationValues, { store, report: say });
  return status === 'approved' ? 0 : 1;
}

function status(configurationValues) {
  const store = telemetryStore();
  const { entry, where, fallback } = readSession(configurationValues, store);
  const state = readState(configurationValues.issuer);
  if (!entry) say(`Not signed in to ${configurationValues.issuer} as client ${configurationValues.clientId}. Claude Code's telemetry carries no identity. Run the helper with login to sign in now.`);
  else {
    const expires = Date.parse(entry.expiresAt);
    const left = Number.isFinite(expires) ? (expires > Date.now() ? `valid until ${entry.expiresAt}` : `expired ${entry.expiresAt}`) : 'with no known expiry';
    say(`Signed in to ${configurationValues.issuer} as client ${configurationValues.clientId}${entry.user ? `, as ${entry.user}` : ''}. The access token is ${left}; ${entry.refreshToken ? 'the helper refreshes it by itself' : 'there is no refresh token, so the helper asks you to sign in again when it ends'}. Kept in ${where}${fallback ? ', because the macOS Keychain was not available when it was stored' : ''}.`);
    say(`Claude Code sends it as the ${configurationValues.header} header; the plugin's own sign-in exchanges it for the audience ${configurationValues.exchangeAudience}.`);
  }
  if (state.status === 'waiting' && Date.parse(state.expiresAt ?? '') > Date.now()) say(`A sign-in waits for your approval (code ${state.userCode}): ${state.page}`);
  else if (state.status && state.status !== 'approved' && state.status !== 'waiting' && state.status !== 'starting') say(`The last sign-in ended ${state.status}${state.message ? `: ${state.message}` : ''}${state.endedAt ? ` at ${state.endedAt}` : ''}. The helper asks again four hours after that, or run login now.`);
  return 0;
}

function logout(configurationValues) {
  const store = telemetryStore();
  const { entry } = readSession(configurationValues, store);
  store.forget(configurationValues.issuer);
  writeState(configurationValues.issuer, { status: undefined, askedAt: undefined, endedAt: undefined, expiresAt: undefined, userCode: undefined, page: undefined, message: undefined, user: undefined });
  say(entry ? `Forgot the telemetry session for ${configurationValues.issuer}. The next Claude Code start asks you to sign in again.` : `This machine kept no telemetry session for ${configurationValues.issuer}.`);
  return 0;
}

async function token(configurationValues) {
  const printed = await exchangeForUnfold(configurationValues);
  if (!printed) return 1;
  say(printed);
  return 0;
}

async function main() {
  const [command = 'headers'] = process.argv.slice(2);
  const configurationValues = configuration();
  const configured = Boolean(configurationValues.issuer && configurationValues.clientId);
  if (command === 'headers') {
    let printed = {};
    try { printed = await headers(configurationValues); } catch (error) { if (configurationValues.debug) process.stderr.write(`unfold telemetry: ${redacted(error.message)}\n`); }
    say(JSON.stringify(printed));
    return 0;
  }
  if (command === 'device-flow') { if (configured) await deviceFlow(configurationValues); return 0; }
  if (command === 'token') return configured ? token(configurationValues) : 2;
  if (!configured) { say(notConfigured); return 2; }
  if (command === 'login') return login(configurationValues);
  if (command === 'status') return status(configurationValues);
  if (command === 'logout') return logout(configurationValues);
  say('Usage: otel-headers.mjs [login | status | logout | token]');
  return 2;
}

function runAsMain() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(self); } catch { return false; }
}

if (runAsMain()) {
  const printsHeaders = process.argv[2] === undefined || process.argv[2] === 'headers';
  try { process.exitCode = await main(); } catch (error) {
    process.stderr.write(`unfold telemetry: ${redacted(error.message)}\n`);
    if (printsHeaders) say('{}');
    process.exitCode = printsHeaders ? 0 : 1;
  }
}
