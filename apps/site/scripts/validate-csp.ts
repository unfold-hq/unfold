import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { checkPageCsp } from './csp.ts';

const dist = process.argv[2] ?? 'dist';

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return path.endsWith('.html') ? [path] : [];
  });
}

const failures: string[] = [];
let pages = 0;
let scripts = 0;
let styles = 0;

for (const file of htmlFiles(dist)) {
  const report = checkPageCsp(file, readFileSync(file, 'utf8'));
  if (!report.governed) continue;
  pages++;
  scripts += report.scripts;
  styles += report.styles;
  failures.push(...report.failures);
}

if (failures.length > 0) {
  process.stderr.write(
    `\ncsp validation failed — ${failures.length} blocked inline resource(s):\n\n` +
      failures.map((failure) => `  ${failure}\n`).join('\n') +
      '\n',
  );
  process.exit(1);
}

process.stdout.write(
  `csp: ${scripts} inline script(s) + ${styles} inline style(s) across ${pages} page(s) — all hash-authorised\n`,
);
