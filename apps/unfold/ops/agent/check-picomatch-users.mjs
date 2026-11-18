import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const skipped = new Set(['/proc', '/sys', '/dev', '/run', '/tmp']);
const allowedCopy = '/usr/lib/node_modules/node-gyp/node_modules/picomatch';
const allowedImporter = '/usr/lib/node_modules/node-gyp/lib/build.js';
const globbers = new Set(['picomatch', 'tinyglobby', 'fdir']);
const importPattern = /(?:require\(\s*|from\s+|import\(\s*)['"](picomatch|tinyglobby|fdir)['"]/;
const globCallPattern = /\bglob\(\s*([^,)]*)/g;
const expectedPatterns = ["'build/*.sln'", "'build/*.mk'"];

function* entries(directory) {
  let names;
  try { names = readdirSync(directory); } catch { return; }
  for (const name of names) {
    const path = join(directory, name);
    if (skipped.has(path)) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    yield { path, name, directory: stat.isDirectory() };
    if (stat.isDirectory()) yield* entries(path);
  }
}

const insideGlobber = path => path.split(sep).some((part, index, parts) => parts[index - 1] === 'node_modules' && globbers.has(part));

const copies = [];
const importers = [];
for (const entry of entries('/')) {
  if (entry.directory && entry.name === 'picomatch' && existsSync(join(entry.path, 'package.json'))) copies.push(entry.path);
  if (!entry.directory && /\.(c|m)?js$/.test(entry.name) && !insideGlobber(entry.path) && importPattern.test(readFileSync(entry.path, 'utf8'))) importers.push(entry.path);
}

const problems = [];
const unexpectedCopies = copies.filter(path => path !== allowedCopy);
if (unexpectedCopies.length) problems.push(`picomatch outside node-gyp: ${unexpectedCopies.join(', ')}`);
const unexpectedImporters = importers.filter(path => path !== allowedImporter);
if (unexpectedImporters.length) problems.push(`picomatch, tinyglobby or fdir loaded by ${unexpectedImporters.join(', ')}`);
if (existsSync(allowedImporter)) {
  const patterns = [...readFileSync(allowedImporter, 'utf8').matchAll(globCallPattern)].map(match => match[1].trim());
  const unexpectedPatterns = patterns.filter(pattern => !expectedPatterns.includes(pattern));
  if (unexpectedPatterns.length) problems.push(`node-gyp globs patterns other than ${expectedPatterns.join(' and ')}: ${unexpectedPatterns.join(', ')}`);
}
if (problems.length) {
  console.error('The OpenVEX not_affected statement for CVE-2026-112366 / GHSA-fc5q-39xc-vjpf (picomatch) in unfold-agent no longer holds; review it before shipping:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`picomatch appears only as node-gyp's copy (${copies.length} found), reached only through node-gyp's fixed globs`);
