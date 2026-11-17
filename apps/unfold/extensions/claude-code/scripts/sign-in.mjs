import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialKey, credentialStore, dataDir, redacted, unfoldAddress } from './credentials.mjs';

/** A stored credential is renewed this long before it expires: before Unfold's one-week warning starts. */
export const renewWithinMs = 8 * 24 * 3600_000;
/** After a sign-in that was not approved, hooks wait this long before they open the browser again; `/unfold:login` does not wait. */
export const retryAfterMs = 3600_000;
const lockStaleMs = 30_000;
const waiter = fileURLToPath(new URL('./unfold-login.mjs', import.meta.url));
const headers = { 'content-type': 'application/json', 'x-unfold-request': '1', 'x-unfold-client': 'claude-code-plugin' };

/** The file one Unfold address's sign-in is followed in, readable by the person only. */
export function signInFile(url, env = process.env) {
  return join(dataDir(env), 'sign-in', `${createHash('sha256').update(credentialKey(url)).digest('hex').slice(0, 24)}.json`);
}

/** The sign-in last started for `url`, or null. */
export function readSignIn(url, env = process.env) {
  try { return JSON.parse(readFileSync(signInFile(url, env), 'utf8')); } catch { return null; }
}

/** Records a sign-in's progress; a sign-in that is no longer waiting keeps no secret. */
export function writeSignIn(file, state) {
  const kept = state.status === 'waiting' ? state : Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'secret'));
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(kept), { mode: 0o600 });
  renameSync(temporary, file);
}

/** Why `credential` needs a browser sign-in now: `sign-in` without one, `renew` when it expires within `renewWithinMs`, or null. `UNFOLD_TOKEN` is never renewed. */
export function signInReason(credential, now = Date.now()) {
  if (credential.source === 'env') return null;
  if (!credential.token) return 'sign-in';
  const expires = Date.parse(credential.expiresAt);
  return Number.isFinite(expires) && expires - now <= renewWithinMs ? 'renew' : null;
}

/** Whether a hook may start a sign-in now, given the last one: not while one waits, and not within `retryAfterMs` of one that was not approved. */
export function mayStart(last, now = Date.now()) {
  if (!last) return true;
  if (last.status === 'waiting') return !(Date.parse(last.expiresAt) > now);
  if (last.status === 'approved') return true;
  const ended = Date.parse(last.endedAt ?? last.startedAt);
  return !(Number.isFinite(ended) && now - ended < retryAfterMs);
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

/** Starts the waiter that opens the browser and collects the credential, detached so the hook that started it exits at once. */
export function spawnWaiter(file, env = process.env) {
  const child = spawn(process.execPath, [waiter, 'wait', file], { detached: true, stdio: 'ignore', env });
  child.on('error', () => undefined);
  child.unref();
}

/**
 * Starts Unfold's editor sign-in for `url` as `Claude Code on <host>` and hands it to a detached waiter. Resolves with
 * the code and page the person must see, or null when another sign-in waits, one was refused within the hour (unless
 * `force`), or Unfold could not start one. Never waits for the person.
 */
export async function startSignIn({ url, env = process.env, fetcher = fetch, now = Date.now(), timeoutMs = 3000, force = false, host = hostname().split('.')[0], startWaiter = spawnWaiter }) {
  const base = unfoldAddress(url);
  if (!credentialKey(base)) return null;
  const file = signInFile(base, env);
  const last = readSignIn(base, env);
  if (!force && !mayStart(last, now)) return null;
  if (force && last?.status === 'waiting' && Date.parse(last.expiresAt) > now) return { userCode: last.userCode, page: last.page, reused: true };
  const release = claim(file);
  if (!release) return null;
  try {
    let ticket;
    try {
      const response = await fetcher(`${base}/api/auth/editor`, { method: 'POST', headers, body: JSON.stringify({ client: 'claude-code', host }), signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Unfold answered ${response.status}; signing in from Claude Code needs single sign-on on this Unfold.`);
      ticket = await response.json();
    } catch (error) {
      writeSignIn(file, { status: 'unavailable', url: base, startedAt: new Date(now).toISOString(), endedAt: new Date(now).toISOString(), message: redacted(error.message).slice(0, 300) });
      return null;
    }
    const page = String(ticket.url ?? '');
    if (!/^https?:\/\/\S+$/.test(page) || typeof ticket.code !== 'string' || typeof ticket.secret !== 'string') return null;
    writeSignIn(file, { status: 'waiting', url: base, code: ticket.code, secret: ticket.secret, userCode: String(ticket.userCode ?? ''), page, interval: Number(ticket.interval) || 2, startedAt: new Date(now).toISOString(), expiresAt: new Date(now + (Number(ticket.expiresIn) || 600) * 1000).toISOString() });
    startWaiter(file, env);
    return { userCode: String(ticket.userCode ?? ''), page, reused: false };
  } finally { release(); }
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

/**
 * The detached half of a sign-in: opens the page, polls Unfold until the person approves or denies it or it expires,
 * stores the credential for its address, and signs the credential it replaces out of Unfold.
 */
export async function waitForApproval({ file, env = process.env, fetcher = fetch, store = credentialStore(env), open = page => openBrowser(page, env), sleep = ms => new Promise(done => setTimeout(done, ms)), clock = () => Date.now() }) {
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch { return 'missing'; }
  if (state.status !== 'waiting' || typeof state.secret !== 'string') return state.status;
  const base = unfoldAddress(state.url);
  const key = credentialKey(base);
  const finish = (status, extra = {}) => { writeSignIn(file, { ...state, status, endedAt: new Date(clock()).toISOString(), ...extra }); return status; };
  open(state.page);
  let interval = Math.max(Number(state.interval) || 2, 1);
  while (clock() < Date.parse(state.expiresAt)) {
    await sleep(interval * 1000);
    let polled;
    try { polled = await fetcher(`${base}/api/auth/editor/${encodeURIComponent(state.code)}`, { method: 'POST', headers, body: JSON.stringify({ secret: state.secret }), signal: AbortSignal.timeout(10_000) }); } catch { continue; }
    if (polled.status === 202) continue;
    if (polled.status === 429) { interval += 1; continue; }
    const answer = await polled.json().catch(() => ({}));
    if (polled.status === 200 && typeof answer.token === 'string') {
      const previous = store.read(key);
      store.write(key, { token: answer.token, expiresAt: String(answer.expiresAt ?? ''), user: String(answer.user?.name ?? '') });
      if (previous?.token && previous.token !== answer.token) {
        await fetcher(`${base}/api/logout`, { method: 'POST', headers: { ...headers, authorization: `Bearer ${previous.token}` }, body: '{}', signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
      }
      return finish('approved', { user: String(answer.user?.name ?? '').slice(0, 200), credentialExpiresAt: String(answer.expiresAt ?? '') });
    }
    return finish(polled.status === 403 ? 'denied' : 'failed', { message: redacted(answer.error?.message ?? `Unfold answered ${polled.status}.`).slice(0, 300) });
  }
  return finish('expired');
}

/**
 * What a hook tells the person and the session when `credential` needs a browser sign-in, after starting one if a hook
 * may: `{ systemMessage, context }`, or null when nothing needs saying.
 */
export async function signInNotice({ url, credential, event, env = process.env, fetcher = fetch, now = Date.now(), timeoutMs = 3000, startWaiter = spawnWaiter }) {
  const reason = signInReason(credential, now);
  if (!reason) return null;
  const started = await startSignIn({ url, env, fetcher, now, timeoutMs, startWaiter });
  if (started) {
    const code = started.userCode ? ` Check that it shows ${started.userCode}.` : '';
    const systemMessage = reason === 'renew'
      ? `Unfold: your sign-in ends ${credential.expiresAt.slice(0, 10)}. Approve the renewal in your browser.${code} Not opened? ${started.page}`
      : `Unfold: approve the sign-in in your browser to link this session.${code} Not opened? ${started.page}`;
    return { systemMessage, context: reason === 'renew' ? '' : 'The Unfold plugin opened the person’s browser to sign in to Unfold. Once they approve, this session reports to Unfold. Do not ask them for a token.' };
  }
  const last = readSignIn(url, env);
  if (event === 'SessionStart' && reason === 'sign-in' && last?.status === 'waiting' && Date.parse(last.expiresAt) > now) {
    return { systemMessage: `Unfold: a sign-in waits for your approval in the browser (code ${last.userCode}): ${last.page}`, context: '' };
  }
  if (event === 'SessionStart' && reason === 'sign-in' && last && last.status !== 'waiting' && last.status !== 'unavailable') {
    return { systemMessage: 'Unfold: not signed in, so this session is not linked. Run /unfold:login to sign in.', context: '' };
  }
  return null;
}
