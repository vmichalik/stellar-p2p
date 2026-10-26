import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITY_HEADERS } from '../deploy/demo/headers.mjs';
import { DISCOVERY_FILES } from './build-demo.mjs';

export async function createDemoPreview({
  root = resolve(import.meta.dirname, '../dist/demo'),
} = {}) {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  if (
    manifest.mode !== 'live-and-demo' ||
    manifest.liveCapabilitiesSource !== '/api/view' ||
    Object.hasOwn(manifest, 'liveSettlement') ||
    Object.hasOwn(manifest, 'livePaymentVerification')
  )
    throw new Error('Only the reviewed site bundle may be previewed');
  const allowed = new Set([
    ...manifest.files.map((row) => '/' + row.path),
    '/manifest.json',
    ...Object.keys(DISCOVERY_FILES).map((name) => '/' + name),
  ]);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.json': 'application/json',
    '.xml': 'application/xml; charset=utf-8',
    '.mp4': 'video/mp4',
  };
  return createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, SECURITY_HEADERS).end();
        return;
      }
      const url = new URL(request.url, 'http://localhost');
      const pathname = url.pathname;
      if (pathname.startsWith('/api/')) {
        response
          .writeHead(503, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }));
        return;
      }
      if (pathname === '/wallet-config.json') {
        response
          .writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' })
          .end(JSON.stringify({ enabled: false }));
        return;
      }
      const file = pathname === '/' ? '/index.html' : pathname;
      if (!allowed.has(file)) {
        response.writeHead(404, SECURITY_HEADERS).end('Not found');
        return;
      }
      const bytes = await readFile(resolve(root, '.' + file));
      const headers = { ...SECURITY_HEADERS, 'Content-Type': types[extname(file)] };
      if (file === '/demo.mp4' && manifest.mediaIncluded)
        headers['Content-Security-Policy'] += "; media-src 'self'";
      if (url.searchParams.get('demo') === '1')
        headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(
          "connect-src 'self'",
          "connect-src 'none'",
        );
      response.writeHead(200, headers);
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(404, SECURITY_HEADERS).end('Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createDemoPreview();
  server.listen(Number(process.env.PACTLANE_PREVIEW_PORT || 17863), '127.0.0.1', () => {
    console.log(
      `Pactlane site preview: http://127.0.0.1:${process.env.PACTLANE_PREVIEW_PORT || 17863}`,
    );
  });
}
