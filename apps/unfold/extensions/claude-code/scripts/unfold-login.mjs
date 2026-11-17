#!/usr/bin/env node
import { rmSync } from 'node:fs';
import { credentialKey, credentialStore, redacted, resolveCredential, unfoldAddress } from './credentials.mjs';
import { readSignIn, signInFile, startSignIn, waitForApproval } from './sign-in.mjs';

const unfoldUrl = unfoldAddress(process.env.UNFOLD_URL);
const say = line => process.stdout.write(`${line}\n`);
const noAddress = 'UNFOLD_URL is not set. Your organisation sets it in Claude Code’s managed settings, or add it to the env block of ~/.claude/settings.json.';

async function login() {
  const credential = resolveCredential(unfoldUrl);
  if (credential.source === 'env') say('UNFOLD_TOKEN is set in your environment, so the plugin uses it and keeps no sign-in of its own. Remove it to let the plugin sign you in and renew itself.');
  const started = await startSignIn({ url: unfoldUrl, force: true, timeoutMs: 10_000 });
  if (!started) {
    const last = readSignIn(unfoldUrl);
    say(`Unfold did not start a sign-in. ${last?.message ?? 'Check that UNFOLD_URL is right and that Unfold is reachable.'}`);
    return 1;
  }
  say(`${started.reused ? 'A sign-in already waits' : 'Your browser opens Unfold'}: ${started.page}`);
  if (started.userCode) say(`Sign in, check that the page shows ${started.userCode}, and approve it. Deny it if the code differs.`);
  say('The plugin keeps the credential once you approve; you do not need to copy anything. Run /unfold:login status to check.');
  return 0;
}

async function logout() {
  const store = credentialStore();
  const key = credentialKey(unfoldUrl);
  const stored = store.read(key);
  if (stored) {
    await fetch(`${unfoldUrl}/api/logout`, { method: 'POST', headers: { authorization: `Bearer ${stored.token}`, 'content-type': 'application/json', 'x-unfold-request': '1', 'x-unfold-client': 'claude-code-plugin' }, body: '{}', signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    store.forget(key);
  }
  rmSync(signInFile(unfoldUrl), { force: true });
  say(stored ? `Signed this machine out of ${unfoldUrl} and forgot its credential.` : `This machine kept no sign-in for ${unfoldUrl}.`);
  if (String(process.env.UNFOLD_TOKEN ?? '').trim()) say('UNFOLD_TOKEN is still set in your environment, so sessions keep reporting with it until you remove it.');
  return 0;
}

function status() {
  const credential = resolveCredential(unfoldUrl);
  const last = readSignIn(unfoldUrl);
  if (credential.source === 'env') say(`Reporting to ${unfoldUrl} with UNFOLD_TOKEN from your environment.`);
  else if (credential.source === 'stored') say(`Signed in to ${unfoldUrl}${credential.user ? ` as ${credential.user}` : ''} until ${credential.expiresAt.slice(0, 10) || 'Unfold says otherwise'}; kept in ${credentialStore().where}. The plugin renews it in your browser a week before it ends.`);
  else say(`Not signed in to ${unfoldUrl}. Run /unfold:login.`);
  if (last?.status === 'waiting' && Date.parse(last.expiresAt) > Date.now()) say(`A sign-in waits for your approval (code ${last.userCode}): ${last.page}`);
  else if (last && last.status !== 'approved' && last.status !== 'waiting') say(`The last sign-in ended ${last.status}${last.message ? `: ${last.message}` : ''}.`);
  return 0;
}

async function main() {
  const [command = 'login', argument] = process.argv.slice(2);
  if (command === 'wait') { await waitForApproval({ file: String(argument ?? '') }); return 0; }
  if (!credentialKey(unfoldUrl)) { say(noAddress); return 1; }
  if (command === 'login') return login();
  if (command === 'logout') return logout();
  if (command === 'status') return status();
  say('Usage: unfold-login.mjs [login | logout | status]');
  return 2;
}

try { process.exitCode = await main(); } catch (error) { process.stderr.write(`unfold: ${redacted(error.message)}\n`); process.exitCode = 1; }
