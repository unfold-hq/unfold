import { createHash } from 'node:crypto';

const EXECUTABLE_SCRIPT_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
]);

export interface PageCspReport {
  governed: boolean;
  scripts: number;
  styles: number;
  failures: string[];
}

export function sha256Source(body: string): string {
  return `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`;
}

function metaCspOffset(html: string): number {
  return html.search(/<meta[^>]+http-equiv=["']content-security-policy["']/i);
}

function metaCsp(html: string): string | null {
  const match = html.match(
    /<meta[^>]+http-equiv=(["'])content-security-policy\1[^>]*content=(["'])([\s\S]*?)\2/i,
  );
  return match?.[3] ?? null;
}

function governedInlineScripts(html: string, cspOffset: number): string[] {
  const bodies: string[] = [];
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if ((match.index ?? 0) < cspOffset) continue;
    const attributes = match[1] ?? '';
    if (/\bsrc\s*=/.test(attributes)) continue;
    const type = (attributes.match(/\btype\s*=\s*["']([^"']*)["']/i)?.[1] ?? '').toLowerCase();
    if (EXECUTABLE_SCRIPT_TYPES.has(type)) bodies.push(match[2] ?? '');
  }
  return bodies;
}

function governedInlineStyles(html: string, cspOffset: number): string[] {
  const bodies: string[] = [];
  for (const match of html.matchAll(/<style(?:[^>]*)>([\s\S]*?)<\/style>/gi)) {
    if ((match.index ?? 0) < cspOffset) continue;
    bodies.push(match[1] ?? '');
  }
  return bodies;
}

export function directiveHashes(csp: string, directive: string): Set<string> {
  const segment = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${directive} `) || part === directive);
  return new Set(segment?.match(/sha256-[A-Za-z0-9+/=]+/g) ?? []);
}

function preview(body: string): string {
  return body.trim().replace(/\s+/g, ' ').slice(0, 90);
}

export function checkPageCsp(file: string, html: string): PageCspReport {
  const cspOffset = metaCspOffset(html);
  if (cspOffset === -1) return { governed: false, scripts: 0, styles: 0, failures: [] };
  const scripts = governedInlineScripts(html, cspOffset);
  const styles = governedInlineStyles(html, cspOffset);
  if (scripts.length === 0 && styles.length === 0) {
    return { governed: false, scripts: 0, styles: 0, failures: [] };
  }
  const csp = metaCsp(html);
  if (csp === null) {
    return {
      governed: true,
      scripts: 0,
      styles: 0,
      failures: [`${file}: has a meta CSP element whose content attribute could not be parsed`],
    };
  }
  const failures: string[] = [];
  const allowedScripts = directiveHashes(csp, 'script-src');
  for (const body of scripts) {
    const hash = sha256Source(body);
    if (allowedScripts.has(hash)) continue;
    failures.push(
      `${file}: inline script not authorised by the page's own CSP\n` +
        `    computed ${hash}\n` +
        `    script   ${preview(body)}…\n` +
        `    fix: drop \`is:inline\`/\`define:vars\` so Astro bundles and hashes it ` +
        `(pass data via a data- attribute instead)`,
    );
  }
  const allowedStyles = directiveHashes(csp, 'style-src');
  for (const body of styles) {
    const hash = sha256Source(body);
    if (allowedStyles.has(hash)) continue;
    failures.push(
      `${file}: inline stylesheet not authorised by the page's own CSP\n` +
        `    computed ${hash}\n` +
        `    style    ${preview(body)}…\n` +
        `    fix: let Astro emit the style (it hashes what it emits); ` +
        `a hand-written raw <style> in a layout/page body is never hashed`,
    );
  }
  return { governed: true, scripts: scripts.length, styles: styles.length, failures };
}
