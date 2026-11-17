import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

type Manifest = { kind: string; metadata: { name: string; labels?: Record<string, string>; annotations?: Record<string, string> }; spec: Record<string, any> };
type Answer = { status: number; body: unknown };

const chart = fileURLToPath(new URL('../ops/helm/unfold', import.meta.url));
const appVersion = /^appVersion: (\S+)$/m.exec(readFileSync(`${chart}/Chart.yaml`, 'utf8'))![1];
const skip = spawnSync('helm', ['version'], { stdio: 'ignore' }).status !== 0 && 'helm is unavailable';
const render = (args: string[]) => {
  const rendered = spawnSync('helm', ['template', 'unfold', chart, '--namespace', 'unfold', '--set', 'ploeg.enabled=false', ...args], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr);
  return parseAllDocuments(rendered.stdout).map(document => document.toJS() as Manifest | null).filter((manifest): manifest is Manifest => Boolean(manifest?.kind));
};
const testHooks = (manifests: Manifest[]) => manifests.filter(manifest => manifest.metadata.annotations?.['helm.sh/hook'] === 'test');
const smokePod = (manifests: Manifest[]) => {
  const pod = testHooks(manifests).find(manifest => manifest.kind === 'Pod');
  assert.ok(pod, 'renders a test hook pod');
  return pod;
};
const env = (pod: Manifest) => Object.fromEntries(pod.spec.containers[0].env.map((entry: { name: string; value: string }) => [entry.name, entry.value]));
const selects = (selector: Record<string, string>, labels: Record<string, string> = {}) => Object.entries(selector).every(([key, value]) => labels[key] === value);

const runScript = async (pod: Manifest, answers: Record<string, Answer>, overrides: Record<string, string> = {}) => {
  const server = createServer((req, res) => {
    const answer = answers[req.url ?? ''] ?? { status: 404, body: { error: { code: 'not_found' } } };
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer.body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const [command, ...args] = pod.spec.containers[0].command as string[];
    assert.equal(command, 'node');
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env(pod), UNFOLD_SMOKE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, ...overrides } });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const status = await new Promise<number | null>(resolve => child.on('close', resolve));
    return { status, output };
  } finally {
    server.close();
  }
};
const healthy = (version: string, ploegContract?: unknown): Record<string, Answer> => ({
  '/readyz': { status: 200, body: { status: 'ok', version } },
  '/healthz': { status: 200, body: { status: 'ok', version, ...(ploegContract ? { ploegContract } : {}) } },
  '/api/auth/methods': { status: 200, body: { local: true, oidc: null } },
});

test('the chart ships a Helm test hook pod that checks the in-cluster Service and the chart appVersion', { skip }, () => {
  const manifests = render([]);
  const pod = smokePod(manifests);
  assert.equal(pod.metadata.name, 'unfold-smoke-test');
  assert.equal(pod.metadata.annotations?.['helm.sh/hook-delete-policy'], 'before-hook-creation,hook-succeeded');
  assert.equal(pod.spec.restartPolicy, 'Never');
  assert.ok(pod.spec.activeDeadlineSeconds > 0 && pod.spec.activeDeadlineSeconds < 120, 'the test ends within two minutes');
  assert.ok(Number(env(pod).UNFOLD_SMOKE_DEADLINE_SECONDS) < pod.spec.activeDeadlineSeconds, 'the script gives up before Kubernetes kills it, so it can say why');
  assert.deepEqual(env(pod), { UNFOLD_SMOKE_URL: 'http://unfold.unfold.svc:4080', UNFOLD_SMOKE_VERSION: appVersion, UNFOLD_SMOKE_DEADLINE_SECONDS: '90' });
  const workbench = manifests.find(manifest => manifest.kind === 'Deployment' && manifest.metadata.name === 'unfold')!;
  assert.equal(pod.spec.containers[0].image, workbench.spec.template.spec.containers[0].image, 'the test runs in the workbench image, so no new image enters the supply chain');
  const service = manifests.find(manifest => manifest.kind === 'Service' && manifest.metadata.name === 'unfold')!;
  assert.equal(selects(service.spec.selector, pod.metadata.labels), false, 'the Service never sends traffic to the test pod');
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.deepEqual(pod.spec.securityContext, { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, seccompProfile: { type: 'RuntimeDefault' } });
  assert.deepEqual(pod.spec.containers[0].securityContext, { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } });
  assert.deepEqual(testHooks(manifests).map(manifest => manifest.kind), ['Pod'], 'no NetworkPolicy unless asked for');
});

test('the test hook follows the Service port and can be turned off', { skip }, () => {
  assert.equal(env(smokePod(render(['--set', 'service.port=8080']))).UNFOLD_SMOKE_URL, 'http://unfold.unfold.svc:8080');
  assert.deepEqual(testHooks(render(['--set', 'tests.enabled=false'])), []);
});

test('the test hook NetworkPolicy admits the test pod to the workbench port, and pod labels never replace the chart labels', { skip }, () => {
  const manifests = render(['--set', 'tests.networkPolicy.enabled=true', '--set-json', 'tests.podLabels={"policy.example/allow":"unfold","app.kubernetes.io/name":"other"}']);
  const pod = smokePod(manifests);
  assert.equal(pod.metadata.labels?.['policy.example/allow'], 'unfold');
  assert.equal(pod.metadata.labels?.['app.kubernetes.io/name'], 'unfold-smoke-test');
  const policy = testHooks(manifests).find(manifest => manifest.kind === 'NetworkPolicy');
  assert.ok(policy, 'renders the test NetworkPolicy');
  assert.ok(Number(policy.metadata.annotations?.['helm.sh/hook-weight']) < Number(pod.metadata.annotations?.['helm.sh/hook-weight']), 'the policy exists before the pod starts');
  const workbench = manifests.find(manifest => manifest.kind === 'Deployment' && manifest.metadata.name === 'unfold')!;
  assert.ok(selects(policy.spec.podSelector.matchLabels, workbench.spec.template.metadata.labels), 'the policy selects the workbench pods');
  assert.ok(selects(policy.spec.ingress[0].from[0].podSelector.matchLabels, pod.metadata.labels), 'the policy admits the test pod');
  assert.deepEqual(policy.spec.ingress[0].ports, [{ protocol: 'TCP', port: 'http' }]);
  assert.equal(workbench.spec.template.spec.containers[0].ports[0].name, 'http');
});

test('the smoke script passes a healthy Unfold and skips the Ploeg contract when no Ploeg is configured', { skip }, async () => {
  const pod = smokePod(render([]));
  const compatible = await runScript(pod, healthy(appVersion, { state: 'compatible', ploeg: '0.2.0', checkedAt: '2026-11-17T00:00:00Z' }));
  assert.equal(compatible.status, 0, compatible.output);
  assert.match(compatible.output, /PASS \/readyz: ready, version /);
  assert.match(compatible.output, /PASS \/healthz: Ploeg 0\.2\.0 serves every contract this Unfold requires/);
  assert.match(compatible.output, /PASS \/api\/auth\/methods: sign-in offers name and password/);
  const standalone = await runScript(pod, healthy(appVersion));
  assert.equal(standalone.status, 0, standalone.output);
  assert.match(standalone.output, /SKIP \/healthz: this Unfold has no Ploeg configured/);
});

test('the smoke script fails with a reason per check', { skip }, async () => {
  const pod = smokePod(render([]));
  const wrongVersion = await runScript(pod, healthy('0.0.1'));
  assert.equal(wrongVersion.status, 1, wrongVersion.output);
  assert.match(wrongVersion.output, new RegExp(`FAIL /readyz: Unfold reports version 0\\.0\\.1, but this chart release installs ${appVersion.replace(/\./g, '\\.')}`));
  const expectsOther = await runScript(pod, healthy(appVersion), { UNFOLD_SMOKE_VERSION: '9.9.9' });
  assert.equal(expectsOther.status, 1, 'a wrong version expectation fails');
  const incompatible = await runScript(pod, healthy(appVersion, { state: 'incompatible', message: 'Unfold requires Ploeg contract operator v2.' }));
  assert.equal(incompatible.status, 1, incompatible.output);
  assert.match(incompatible.output, /FAIL \/healthz: Unfold requires Ploeg contract operator v2\./);
  const unchecked = await runScript(pod, healthy(appVersion, { state: 'unchecked' }), { UNFOLD_SMOKE_DEADLINE_SECONDS: '1' });
  assert.equal(unchecked.status, 1, unchecked.output);
  assert.match(unchecked.output, /FAIL \/healthz: Unfold has not yet read which contracts Ploeg serves \(state unchecked\), still after 1 seconds/);
  const signInRefused = await runScript(pod, { ...healthy(appVersion), '/api/auth/methods': { status: 401, body: {} } });
  assert.equal(signInRefused.status, 1, signInRefused.output);
  assert.match(signInRefused.output, /FAIL \/api\/auth\/methods: answered 401 without credentials/);
  const closed = createServer();
  await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
  const port = (closed.address() as AddressInfo).port;
  await new Promise(resolve => closed.close(resolve));
  const unreachable = await runScript(pod, {}, { UNFOLD_SMOKE_URL: `http://127.0.0.1:${port}`, UNFOLD_SMOKE_DEADLINE_SECONDS: '1' });
  assert.equal(unreachable.status, 1, unreachable.output);
  assert.match(unreachable.output, new RegExp(`FAIL /readyz: no answer from http://127\\.0\\.0\\.1:${port}/readyz \\(fetch failed: ECONNREFUSED\\), still after 1 seconds`));
});
