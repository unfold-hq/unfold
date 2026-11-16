import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';

import { serveDist } from './serve-dist.ts';

const A11Y_ONLY_PAGES = [
  '/404.html',
  '/nl/404.html',
  '/thanks.html',
  '/nl/thanks.html',
  '/signup-problem.html',
  '/nl/signup-problem.html',
];

const WCAG22_AA_RULES_AXE_SHIPS_DISABLED = [
  'aria-roledescription',
  'audio-caption',
  'css-orientation-lock',
  'label-content-name-mismatch',
  'p-as-heading',
  'table-fake-caption',
  'target-size',
  'td-has-header',
];

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

async function pageList(): Promise<string[]> {
  const rc = JSON.parse(await readFile('lighthouserc.json', 'utf8')) as {
    ci?: { collect?: { url?: string[] } };
  };
  const shared = (rc.ci?.collect?.url ?? []).map((url) => new URL(url).pathname);
  if (shared.length === 0) throw new Error('lighthouserc.json lists no URLs to scan');
  return [...new Set([...shared, ...A11Y_ONLY_PAGES])];
}

const pages = await pageList();
const server = serveDist(resolve('dist'));
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address() as AddressInfo;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext();
const rules = Object.fromEntries(
  WCAG22_AA_RULES_AXE_SHIPS_DISABLED.map((id) => [id, { enabled: true }]),
);

let blocking = 0;
let advisory = 0;

for (const path of pages) {
  const page = await context.newPage();
  try {
    const response = await page.goto(`http://127.0.0.1:${port}${path}`, {
      waitUntil: 'load',
      timeout: 20_000,
    });
    if (!response?.ok()) {
      process.stderr.write(`✗ ${path} — HTTP ${response?.status() ?? 'no response'}\n`);
      blocking += 1;
      continue;
    }
    const { violations } = await new AxeBuilder({ page }).options({ rules }).analyze();
    const bad = violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''));
    advisory += violations.length - bad.length;
    blocking += bad.length;
    if (violations.length === 0) {
      process.stdout.write(`✓ ${path}\n`);
      continue;
    }
    process.stdout.write(`${bad.length > 0 ? '✗' : '!'} ${path}\n`);
    for (const violation of violations) {
      const mark = BLOCKING_IMPACTS.has(violation.impact ?? '') ? '✗' : '!';
      process.stdout.write(
        `    ${mark} [${violation.impact}] ${violation.id}: ${violation.help}\n`,
      );
      for (const node of violation.nodes.slice(0, 3)) {
        process.stdout.write(`        ${node.target.join(' ')}\n`);
      }
      process.stdout.write(`        ${violation.helpUrl}\n`);
    }
  } finally {
    await page.close();
  }
}

await browser.close();
await new Promise<void>((done) => server.close(() => done()));

process.stdout.write(
  `\naxe: ${pages.length} page(s) · ${blocking} blocking (serious/critical) · ${advisory} advisory\n`,
);

if (blocking > 0) {
  process.stderr.write(
    '\nSerious or critical accessibility violations. Fix them in the component, not by editing page markup to silence the rule.\n',
  );
  process.exitCode = 1;
}
