import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

async function resolveAsset(
  distDir: string,
  pathname: string,
): Promise<{ body: Buffer; ext: string; status: number }> {
  const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const tries = clean === '/' ? ['index.html'] : [clean.slice(1), `${clean.slice(1)}.html`];
  for (const relative of tries) {
    const file = join(distDir, relative);
    try {
      return { body: await readFile(file), ext: extname(file), status: 200 };
    } catch {
      continue;
    }
  }
  return { body: await readFile(join(distDir, '404.html')), ext: '.html', status: 404 };
}

export function serveDist(distDir: string): Server {
  return createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    const { body, ext, status } = await resolveAsset(distDir, decodeURIComponent(pathname));
    const gzip = /\bgzip\b/.test(request.headers['accept-encoding'] ?? '');
    response.writeHead(status, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      vary: 'accept-encoding',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    });
    response.end(gzip ? gzipSync(body) : body);
  });
}

if (import.meta.main) {
  const server = serveDist(resolve(process.argv[2] ?? 'dist'));
  server.listen(Number(process.env.PORT ?? 4173), () => {
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : '';
    process.stdout.write(`serve-dist listening on http://localhost:${port}\n`);
  });
}
