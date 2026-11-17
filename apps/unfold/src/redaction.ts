import { readFileSync } from 'node:fs';
import type { AppConfig } from './types.ts';
import type { SourceApp } from './task-providers/registry.ts';

const maxRuntimeSecrets = 1000;
const runtimeSecrets = new Set<string>();

/** Adds a secret Unfold obtained while running, such as a minted installation token or a private key read from a file, to every later redaction. */
export function rememberSecret(value: string | undefined): void {
  for (const part of secretParts(value)) {
    runtimeSecrets.delete(part);
    if (runtimeSecrets.size >= maxRuntimeSecrets) runtimeSecrets.delete(runtimeSecrets.values().next().value!);
    runtimeSecrets.add(part);
  }
}

/** A secret, its JSON-escaped form and, for a multi-line one such as a PEM key, each line long enough to identify it, so a JSON log line or one that carries only part of it is redacted too. */
function secretParts(value: string | undefined): string[] {
  if (!value || value.length < 8) return [];
  const whole = value.trim();
  const lines = whole.replaceAll('\\n', '\n').split(/\r?\n/).map(line => line.trim()).filter(line => line.length >= 32 && !line.startsWith('-----'));
  return [...new Set([value, whole, JSON.stringify(value).slice(1, -1), JSON.stringify(whole).slice(1, -1), ...lines])];
}

function appKey(app: SourceApp | undefined): string | undefined {
  if (!app) return undefined;
  if ('env' in app.privateKey) return process.env[app.privateKey.env];
  try { return readFileSync(app.privateKey.file, 'utf8'); } catch { return undefined; }
}

function billingSecrets(config: AppConfig): string[] {
  const name = config.billing?.options.tokenEnv;
  const value = typeof name === 'string' ? process.env[name] : undefined;
  return value ? [value, ...value.split(':').filter(part => part.length >= 8)] : [];
}

/** The configured secret values the workbench never serves: card theme, delivery verifier and publisher, gateway, runtime, bootstrap, Ploeg, token exchange, task source, reports and billing credentials, task source and reports app private keys, every secret remembered while running, the Sentry DSN, the ntfy token, the VAPID private key and the Slack bot token and signing secret. */
export function knownSecrets(config: AppConfig): string[] {
  return [
    config.cardThemes?.ai ? process.env[config.cardThemes.ai.keyEnv] : undefined,
    config.decider ? process.env[config.decider.keyEnv] : undefined,
    config.delivery?.verifierTokenEnv ? process.env[config.delivery.verifierTokenEnv] : undefined,
    config.delivery?.publisher ? process.env[config.delivery.publisher.tokenEnv] : undefined,
    config.litellm?.masterKey, config.runtime.password, config.auth.bootstrapPassword,
    config.ploeg?.tokenEnv ? process.env[config.ploeg.tokenEnv] : undefined,
    config.ploeg?.personTokens ? process.env[config.ploeg.personTokens.clientSecretEnv] : undefined,
    ...[...(config.taskSources ?? []), ...(config.reports ? [config.reports.source] : [])].flatMap(source => [source.token, ...secretParts(appKey(source.app))]),
    config.errorReports?.sentryDsn,
    ...billingSecrets(config),
    config.notifications?.ntfy?.tokenEnv ? process.env[config.notifications.ntfy.tokenEnv] : undefined,
    config.notifications?.webPush ? process.env[config.notifications.webPush.privateKeyEnv] : undefined,
    config.notifications?.slack ? process.env[config.notifications.slack.tokenEnv] : undefined,
    config.notifications?.slack ? process.env[config.notifications.slack.signingSecretEnv] : undefined,
    ...runtimeSecrets,
  ].filter((value): value is string => Boolean(value));
}

/** Replaces every occurrence of each of `secrets`, and of every secret remembered while running, with `[redacted]`, longest first. */
export function withoutKnownSecrets(value: string, secrets: readonly string[]): string {
  let cleaned = value;
  for (const secret of [...new Set([...secrets, ...runtimeSecrets])].filter(Boolean).sort((a, b) => b.length - a.length)) cleaned = cleaned.split(secret).join('[redacted]');
  return cleaned;
}

/**
 * Plain text that is safe to show outside the sandbox: terminal escape sequences and control characters other than newline
 * and tab are removed, and credentials in URLs, `sk-` keys, bearer, basic and token values and `token=`-style parameters are masked.
 */
export function plainRedactedText(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[^\P{C}\n\t]/gu, '')
    .replace(/:\/\/[^\s/@]+@/g, '://[redacted]@')
    .replace(/\bsk-[\w-]+/g, '[redacted]')
    .replace(/\b(Bearer|Basic|token)\s+\S+/gi, '$1 [redacted]')
    .replace(/\b(token|password|secret|key|authorization)=[^\s&]+/gi, '$1=[redacted]');
}
