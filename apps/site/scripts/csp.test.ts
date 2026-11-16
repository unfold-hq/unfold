import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { checkPageCsp, directiveHashes, sha256Source } from './csp.ts';

const script = 'document.documentElement.dataset.ready = "1";';
const style = 'body{color:red}';

function page({
  scriptSrc = [] as string[],
  styleSrc = [] as string[],
  head = '',
  body = '',
}): string {
  const policy = `default-src 'self'; script-src 'self' ${scriptSrc.join(' ')}; style-src 'self' ${styleSrc.join(' ')}`;
  return `<html><head>${head}<meta http-equiv="content-security-policy" content="${policy}"></head><body>${body}</body></html>`;
}

describe('the build-time CSP check', () => {
  test('passes inline scripts and styles whose hash is in their own directive', () => {
    const html = page({
      scriptSrc: [`'${sha256Source(script)}'`],
      styleSrc: [`'${sha256Source(style)}'`],
      body: `<script type="module">${script}</script><style>${style}</style>`,
    });
    assert.deepEqual(checkPageCsp('index.html', html), {
      governed: true,
      scripts: 1,
      styles: 1,
      failures: [],
    });
  });

  test('fails an inline script the policy does not hash', () => {
    const report = checkPageCsp('index.html', page({ body: `<script>${script}</script>` }));
    assert.equal(report.failures.length, 1);
    assert.match(report.failures[0] ?? '', /inline script not authorised/);
    assert.match(
      report.failures[0] ?? '',
      new RegExp(sha256Source(script).replace(/[+/]/g, '\\$&')),
    );
  });

  test('never lets a style-src hash authorise a script or a script-src hash a style', () => {
    const html = page({
      scriptSrc: [`'${sha256Source(style)}'`],
      styleSrc: [`'${sha256Source(script)}'`],
      body: `<script>${script}</script><style>${style}</style>`,
    });
    const failures = checkPageCsp('index.html', html).failures;
    assert.equal(failures.length, 2);
    assert.match(failures[0] ?? '', /inline script/);
    assert.match(failures[1] ?? '', /inline stylesheet/);
  });

  test('ignores markup above the meta policy, external scripts and inert script types', () => {
    const html = page({
      head: `<script>${script}</script><style>${style}</style>`,
      body:
        '<script type="module" src="/app.js"></script>' +
        '<script type="application/ld+json">{"@type":"Organization"}</script>',
    });
    assert.deepEqual(checkPageCsp('index.html', html), {
      governed: false,
      scripts: 0,
      styles: 0,
      failures: [],
    });
  });

  test('skips a page without a meta policy', () => {
    const report = checkPageCsp(
      'plain.html',
      `<html><body><script>${script}</script></body></html>`,
    );
    assert.equal(report.governed, false);
    assert.deepEqual(report.failures, []);
  });

  test('reads a policy whose quoted sources contain the other quote character', () => {
    const html = `<meta http-equiv='content-security-policy' content="script-src 'self' '${sha256Source(script)}'"><script>${script}</script>`;
    assert.deepEqual(checkPageCsp('index.html', html).failures, []);
  });

  test('reports a meta policy whose content cannot be parsed', () => {
    const html = `<meta http-equiv="content-security-policy"><script>${script}</script>`;
    assert.match(checkPageCsp('index.html', html).failures[0] ?? '', /could not be parsed/);
  });

  test('takes hashes only from the named directive', () => {
    const csp = "script-src 'sha256-AAA='; style-src 'sha256-BBB='";
    assert.deepEqual([...directiveHashes(csp, 'script-src')], ['sha256-AAA=']);
    assert.deepEqual([...directiveHashes(csp, 'style-src')], ['sha256-BBB=']);
    assert.deepEqual([...directiveHashes(csp, 'img-src')], []);
  });
});
