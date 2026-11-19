import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const recorder = fileURLToPath(new URL('../scripts/workbench-record.mjs', import.meta.url));
const record = env => spawnSync(process.execPath, [recorder, 'local', '190'], { env: { PATH: process.env.PATH ?? '', UNFOLD_COOKIE: 'session=x', ...env }, encoding: 'utf8', input: '' });

for (const [label, env] of [['missing', {}], ['blank', { UNFOLD_URL: '  ' }]]) {
  test(`the workbench recorder stops before it starts a browser when UNFOLD_URL is ${label}`, () => {
    const { status, stderr } = record(env);
    assert.notEqual(status, 0);
    assert.match(stderr, /UNFOLD_URL is missing\. Set it to the address of the Unfold to record, such as http:\/\/127\.0\.0\.1:4080/);
  });
}
