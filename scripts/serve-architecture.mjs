import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const page = '/docs/architecture/study.html';
const html = readFileSync(resolve(root, page.slice(1)), 'utf8');
// Only the guide and its checked-in reference links can be served. No directory listing.
const paths = new Set([page]);
for (const [, link] of html.matchAll(/href="([^"#]+)(?:#[^"]*)?"/g)) {
  if (/^[a-z]+:/i.test(link)) continue;
  paths.add(new URL(link, `http://127.0.0.1${page}`).pathname);
}
const port = Number(process.env.PACTLANE_GUIDE_PORT ?? '8788');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_GUIDE_PORT');
const server = createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://127.0.0.1:${port}`);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  const path = url.pathname === '/' ? page : url.pathname;
  const allowed =
    req.method === 'GET' &&
    !url.search &&
    paths.has(path) &&
    req.headers.host === `127.0.0.1:${port}` &&
    !path.startsWith('/.');
  if (!allowed) {
    res.writeHead(404);
    return res.end('Not found');
  }
  try {
    const body = readFileSync(resolve(root, `.${path}`));
    res.writeHead(200, {
      'content-type': path === page ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Architecture guide: http://127.0.0.1:${port}${page}`),
);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
