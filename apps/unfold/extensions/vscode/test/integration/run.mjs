import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { downloadAndUnzipVSCode, runTests, runVSCodeCommand } from '@vscode/test-electron';

const extensionRoot = resolve(import.meta.dirname, '../..');
const appRoot = resolve(extensionRoot, '../..');
const work = mkdtempSync(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'ufvs-'));
const keep = process.env.UNFOLD_VSCODE_TEST_KEEP === '1';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const name of Object.keys(process.env)) if (name === 'ELECTRON_RUN_AS_NODE' || name.startsWith('VSCODE_')) delete process.env[name];

const targets = {
  stable: { version: 'stable', extensionId: 'unfold-hq.unfold-workbench', packageScript: 'package', launchArgs: [] },
  insiders: { version: 'insiders', extensionId: 'unfold-hq.unfold-workbench-insiders', packageScript: 'package:insiders', launchArgs: ['--enable-proposed-api', 'unfold-hq.unfold-workbench-insiders'] },
};

function chosenTargets() {
  const named = (process.env.UNFOLD_VSCODE_TARGETS || 'stable,insiders').split(',').map(name => name.trim()).filter(Boolean);
  for (const name of named) if (!targets[name]) throw new Error(`UNFOLD_VSCODE_TARGETS names ${name}; use stable, insiders or both`);
  return named;
}

function packageVsix(name) {
  const out = join(work, `${name}.vsix`);
  const result = spawnSync(npm, ['run', targets[name].packageScript, '--', '--out', out], { cwd: extensionRoot, stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`npm run ${targets[name].packageScript} failed with ${result.status}`);
  return out;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolvePort(port)); });
  });
}

async function startDemo() {
  const dataDir = join(work, 'demo-data');
  mkdirSync(dataDir, { recursive: true });
  const kept = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot'];
  const env = { ...Object.fromEntries(kept.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]])), UNFOLD_HOST: '127.0.0.1', UNFOLD_PORT: String(await freePort()), UNFOLD_DATA_DIR: dataDir };
  const log = createWriteStream(join(work, 'demo.log'));
  const child = spawn(process.execPath, ['src/main.ts', '--demo'], { cwd: appRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.pipe(log);
  const ready = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('the demo did not report server.ready within 60 seconds')), 60_000);
    let buffered = '';
    child.stdout.on('data', chunk => {
      log.write(chunk);
      buffered += chunk;
      for (const line of buffered.split('\n')) {
        try { const event = JSON.parse(line); if (event.event === 'server.ready') { clearTimeout(timer); resolveReady(event); } } catch {}
      }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`the demo exited with ${code} before it was ready; see ${join(work, 'demo.log')}`)); });
  });
  if (ready.mode !== 'demo') { child.kill('SIGKILL'); throw new Error(`refusing to run against mode ${ready.mode}; the suite drives only the deterministic demo`); }
  return { child, url: ready.url };
}

function profileArgs(profile) {
  const keychain = process.platform === 'darwin' ? ['--use-mock-keychain'] : process.platform === 'linux' ? ['--password-store=basic'] : [];
  return [`--user-data-dir=${profile.userData}`, `--extensions-dir=${profile.extensions}`, ...keychain];
}

function prepareProfile(name, demoUrl) {
  const root = join(work, name);
  const profile = { userData: join(root, 'ud'), extensions: join(root, 'ext'), workspace: join(root, 'ws') };
  for (const directory of [join(profile.userData, 'User'), profile.extensions, profile.workspace]) mkdirSync(directory, { recursive: true });
  profile.settings = join(profile.userData, 'User', 'settings.json');
  writeFileSync(profile.settings, `${JSON.stringify({
    'unfold.serverUrl': demoUrl,
    'workbench.startupEditor': 'none',
    'security.workspace.trust.enabled': false,
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    'update.mode': 'none',
    'telemetry.telemetryLevel': 'off',
  }, null, 2)}\n`);
  return profile;
}

const refusedByVsCode = /Unknown agent: "unfold[^"]*"/;

function logFiles(directory) {
  return readdirSync(directory, { withFileTypes: true, recursive: true }).filter(entry => entry.isFile() && entry.name.endsWith('.log')).map(entry => join(entry.parentPath, entry.name));
}

function refusals(userData) {
  return logFiles(join(userData, 'logs')).flatMap(file => readFileSync(file, 'utf8').split('\n').filter(line => refusedByVsCode.test(line)).map(line => `${file}: ${line.trim()}`));
}

async function runTarget(name, vsix, demoUrl) {
  const target = targets[name];
  const vscodeExecutablePath = await downloadAndUnzipVSCode({ version: target.version, cachePath: join(extensionRoot, '.vscode-test') });
  const profile = prepareProfile(name, demoUrl);
  await runVSCodeCommand([...profileArgs(profile), '--install-extension', vsix, '--force'], { version: target.version, cachePath: join(extensionRoot, '.vscode-test') });
  process.stdout.write(`\n== ${name}: ${vscodeExecutablePath}\n`);
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: resolve(import.meta.dirname, 'host'),
    extensionTestsPath: resolve(import.meta.dirname, 'suite', 'index.cjs'),
    launchArgs: [profile.workspace, ...profileArgs(profile), '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', ...target.launchArgs],
    extensionTestsEnv: { UNFOLD_INTEGRATION_TARGET: name, UNFOLD_INTEGRATION_EXTENSION: target.extensionId, UNFOLD_INTEGRATION_DEMO_URL: demoUrl, UNFOLD_INTEGRATION_SETTINGS: profile.settings },
  });
  const refused = refusals(profile.userData);
  if (refused.length) throw new Error(`VS Code refused what the extension registered, which only its own logs show:\n${refused.join('\n')}`);
}

const names = chosenTargets();
const failed = [];
let demo;
try {
  const packaged = Object.fromEntries(names.map(name => [name, packageVsix(name)]));
  demo = await startDemo();
  for (const name of names) {
    try { await runTarget(name, packaged[name], demo.url); }
    catch (error) { failed.push(name); process.stderr.write(`${name} failed: ${error instanceof Error ? error.message : error}\n`); }
  }
} finally {
  if (demo && demo.child.exitCode === null) demo.child.kill('SIGKILL');
  if (failed.length || keep) process.stdout.write(`Logs and profiles kept in ${work}\n`);
  else rmSync(work, { recursive: true, force: true });
}
if (failed.length) { process.stderr.write(`The VS Code integration suite failed in: ${failed.join(', ')}\n`); process.exit(1); }
process.stdout.write(`The VS Code integration suite passed in: ${names.join(', ')}\n`);
