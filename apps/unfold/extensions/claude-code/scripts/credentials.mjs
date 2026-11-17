import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The Keychain service every Unfold credential of this plugin is kept under; the account is the Unfold address. */
export const keychainService = 'unfold-claude-code';
const tokenPattern = /^vle_[A-Za-z0-9_-]{20,200}$/;
const keyPattern = /^https?:\/\/[\x21-\x7e]{1,500}$/;

/** `UNFOLD_URL` without surrounding space or trailing slashes. */
export function unfoldAddress(raw) {
  return String(raw ?? '').trim().replace(/\/+$/, '');
}

/** The key a credential is kept under: the Unfold address as origin and path, so two installations never share one. Empty when the address is not http(s). */
export function credentialKey(url) {
  let parsed;
  try { parsed = new URL(unfoldAddress(url)); } catch { return ''; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  const key = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  return keyPattern.test(key) ? key : '';
}

/** The plugin's data directory: `${CLAUDE_PLUGIN_DATA}`, or `~/.local/state/unfold-claude-code` outside a plugin. */
export function dataDir(env = process.env) {
  return env.CLAUDE_PLUGIN_DATA || join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'unfold-claude-code');
}

function validEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.token !== 'string' || !tokenPattern.test(entry.token)) return null;
  const family = typeof entry.familyExpiresAt === 'string' && entry.familyExpiresAt ? { familyExpiresAt: entry.familyExpiresAt } : {};
  return { token: entry.token, expiresAt: typeof entry.expiresAt === 'string' ? entry.expiresAt : '', user: typeof entry.user === 'string' ? entry.user.slice(0, 200) : '', ...family };
}

function encoded(entry) { return Buffer.from(JSON.stringify(entry), 'utf8').toString('base64url'); }

function decoded(text) {
  try { return validEntry(JSON.parse(Buffer.from(text.trim(), 'base64url').toString('utf8'))); } catch { return null; }
}

/** Credentials in the macOS login Keychain, one generic password per Unfold address. The token reaches `security` on standard input, never as an argument. */
export function keychainStore(run = execFileSync) {
  const quiet = { encoding: 'utf8', timeout: 5000 };
  const read = key => {
    try { return decoded(run('security', ['find-generic-password', '-s', keychainService, '-a', key, '-w'], { ...quiet, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; }
  };
  return {
    kind: 'keychain',
    where: 'the macOS Keychain',
    read,
    write(key, entry) {
      const valid = validEntry(entry);
      if (!valid || !keyPattern.test(key)) throw new Error('Refusing to store a malformed Unfold credential.');
      run('security', ['-i'], { ...quiet, input: `add-generic-password -U -s ${keychainService} -a ${key} -w ${encoded(valid)}\n`, stdio: ['pipe', 'ignore', 'ignore'] });
      if (read(key)?.token !== valid.token) throw new Error('The macOS Keychain did not keep the Unfold credential.');
    },
    forget(key) {
      try { run('security', ['delete-generic-password', '-s', keychainService, '-a', key], { ...quiet, stdio: 'ignore' }); } catch { return; }
    },
  };
}

/** Credentials in `credentials.json` in the plugin's data directory: a map from Unfold address to credential, mode 0600 in a 0700 directory. */
export function fileStore(dir) {
  const file = join(dir, 'credentials.json');
  const all = () => {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  };
  const save = next => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  };
  return {
    kind: 'file',
    where: file,
    read: key => validEntry(all()[key]),
    write(key, entry) {
      const valid = validEntry(entry);
      if (!valid || !keyPattern.test(key)) throw new Error('Refusing to store a malformed Unfold credential.');
      save({ ...all(), [key]: valid });
    },
    forget(key) {
      const next = all();
      if (!Object.hasOwn(next, key)) return;
      delete next[key];
      save(next);
    },
  };
}

/** Where this machine keeps credentials: the macOS Keychain when `security` exists, otherwise a file. `UNFOLD_CREDENTIAL_STORE=file` or `keychain` chooses. */
export function credentialStore(env = process.env, platform = process.platform) {
  const chosen = env.UNFOLD_CREDENTIAL_STORE;
  if (chosen === 'keychain') return keychainStore();
  if (chosen !== 'file' && platform === 'darwin' && existsSync('/usr/bin/security')) return keychainStore();
  return fileStore(dataDir(env));
}

/**
 * The credential hooks and commands send to `url`. `UNFOLD_TOKEN` wins when set; otherwise the stored credential for
 * that address, unless it has expired. `source` is `env`, `stored` or `none`.
 * @param {string} url
 * @param {{ env?: Record<string, string | undefined>, store?: { read: (key: string) => { token: string, expiresAt: string, user: string, familyExpiresAt?: string } | null }, now?: number }} [options]
 */
export function resolveCredential(url, { env = process.env, store, now = Date.now() } = {}) {
  const fromEnv = String(env.UNFOLD_TOKEN ?? '').trim();
  if (fromEnv) return { token: fromEnv, source: 'env', expiresAt: '', user: '' };
  const key = credentialKey(url);
  const stored = key ? (store ?? credentialStore(env)).read(key) : null;
  if (!stored || (stored.expiresAt && Date.parse(stored.expiresAt) <= now)) return { token: '', source: 'none', expiresAt: '', user: '' };
  return { ...stored, source: 'stored' };
}

/** Masks every editor credential and bearer value in `text`, so no message or log line carries one. */
export function redacted(text) {
  return String(text ?? '').replace(/vle_[A-Za-z0-9_-]+/g, 'vle_[redacted]').replace(/(bearer\s+)[^\s"']+/gi, '$1[redacted]');
}
