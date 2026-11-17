const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const technical = new Set(['AES', 'CU', 'CVE', 'CWE', 'ECMA', 'GHSA', 'HTTP', 'IEC', 'IEEE', 'ISO', 'MD', 'PEP', 'RFC', 'RSA', 'SHA', 'SSL', 'TLS', 'UTF']);
const colour = /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/;
const marked = id => /[a-z]/.test(id) && /[0-9]/.test(id) && !colour.test(id);
const taskPaths = [/^\/t\/[0-9a-z]{6,12}$/, /^\/t\/[0-9]{1,20}\/[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,9}$/, /^\/[^/]+(?:\/[^/]+){1,5}\/(?:-\/)?issues\/[1-9][0-9]{0,9}$/, /^\/tasks\/[1-9][0-9]{0,18}$/, /^\/browse\/[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,9}$/];

/**
 * The id-shaped task references a text names that only the person's task sources can resolve: uppercase keys such as
 * `OPS-12` (a Jira issue or a ClickUp custom task id), ClickUp ids written `#86c1abcde` or `CU-86c1abcde`, repository
 * issues such as `acme/shop#12`, and task or issue addresses without their query. Keys with a prefix in `known` are
 * left to the tracker references. A bare id, such as a commit hash, is never taken.
 * @param {string} text
 * @param {string[]} [known]
 * @returns {string[]}
 */
export function taskCandidatesIn(text, known = []) {
  const found = new Set();
  const skip = new Set(known.map(prefix => prefix.toUpperCase()));
  for (const match of text.matchAll(/(?<![A-Za-z0-9_/#-])([A-Z][A-Z0-9_]{1,9})-([1-9][0-9]{0,9})(?![0-9A-Za-z])/g)) if (!technical.has(match[1]) && !skip.has(match[1])) found.add(`${match[1]}-${match[2]}`);
  for (const match of text.matchAll(/(?<![A-Za-z0-9_])CU-([0-9a-z]{6,12})(?![0-9A-Za-z])/gi)) if (marked(match[1].toLowerCase())) found.add(`#${match[1].toLowerCase()}`);
  for (const match of text.matchAll(/(?<![\w/&:#.-])#([0-9a-z]{6,12})(?![\w-])/g)) if (marked(match[1])) found.add(`#${match[1]}`);
  for (const match of text.matchAll(/(?<![\w/.:-])([A-Za-z0-9_.-]{1,100}(?:\/[A-Za-z0-9_.-]{1,100}){1,5})#([1-9][0-9]{0,9})(?![\w])/g)) found.add(`${match[1]}#${match[2]}`);
  for (const match of text.matchAll(/https?:\/\/[^\s<>()"'`\]]{1,300}/g)) {
    let url;
    try { url = new URL(match[0].replace(/[.,;:!?]+$/, '')); } catch { continue; }
    const path = url.pathname.replace(/\/+$/, '');
    if (!url.username && !url.password && taskPaths.some(pattern => pattern.test(path))) found.add(`${url.protocol}//${url.host}${path}`);
  }
  return [...found].slice(0, 10);
}

/**
 * The tracker tasks (`VIK-123`, for the prefixes Unfold named), Work Items (an Unfold `#work/<id>` link on `base`, or
 * "Work Item 184") and other id-shaped task references ({@link taskCandidatesIn}) a prompt or commit message names.
 * Only these ids leave the machine, never the text.
 * @param {string} text
 * @param {string[]} [prefixes]
 * @param {string} [base]
 * @returns {{ refs: string[], workItems: string[], tasks?: string[] } | null}
 */
export function mentionsIn(text, prefixes = [], base = '') {
  const known = prefixes.filter(prefix => /^[A-Za-z]{2,10}$/.test(prefix));
  const refs = known.length ? [...new Set([...String(text).matchAll(new RegExp(`(?:^|[^A-Za-z0-9])(${known.join('|')})-([1-9][0-9]{0,18})(?![0-9A-Za-z])`, 'gi'))].map(match => `${match[1].toUpperCase()}-${match[2]}`))].slice(0, 10) : [];
  const links = base ? [...String(text).matchAll(new RegExp(`${escaped(base)}/?#work/([1-9][0-9]{0,18})(?![0-9])`, 'g'))].map(match => match[1]) : [];
  const named = [...String(text).matchAll(/\bwork[ -]item #?([1-9][0-9]{0,18})(?![0-9])/gi)].map(match => match[1]);
  const workItems = [...new Set([...links, ...named])].slice(0, 10);
  const tasks = taskCandidatesIn(String(text), known);
  if (!refs.length && !workItems.length && !tasks.length) return null;
  return { refs, workItems, ...(tasks.length ? { tasks } : {}) };
}
