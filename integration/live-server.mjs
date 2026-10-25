import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createBrowserBridge } from './browser-bridge.mjs';
import { createHostRuntime } from './host-runtime.mjs';
import { walletConfiguration, walletBundle } from './wallet-assets.mjs';

const app = resolve(import.meta.dirname, '../app');
const routes = new Map([
  ['/', ['live.html', 'text/html; charset=utf-8']],
  ['/wallet', ['wallet-setup.html', 'text/html; charset=utf-8']],
  ...[
    'live-app.mjs',
    'live-view-adapter.mjs',
    'host-client.mjs',
    'freighter-connector.mjs',
    'wallet-dialog.mjs',
    'wallet-setup.mjs',
  ].map((name) => [`/${name}`, [name, 'text/javascript; charset=utf-8']]),
  ...['styles.css', 'live-styles.css'].map((name) => [
    `/${name}`,
    [name, 'text/css; charset=utf-8'],
  ]),
  ['/assets/fonts/manrope.woff2', ['assets/fonts/manrope.woff2', 'font/woff2']],
]);

/** Static allowlist plus same-origin API. No arbitrary repo/config paths are served. */
export async function createLiveServer({
  publicOrigin,
  runtime = createHostRuntime(),
  walletConnect = {},
  ...bridgeOptions
} = {}) {
  const origin = new URL(publicOrigin);
  const walletConfig = walletConfiguration({ ...walletConnect, publicOrigin });
  const mobileBundle = walletConfig.enabled ? await walletBundle() : null;
  const walletConnections = walletConfig.enabled
    ? ' https://relay.walletconnect.com wss://relay.walletconnect.com https://relay.walletconnect.org wss://relay.walletconnect.org https://pulse.walletconnect.org https://verify.walletconnect.com https://verify.walletconnect.org'
    : '';
  const freighter = await readFile(
    new URL('node_modules/@stellar/freighter-api/build/index.min.js', import.meta.url),
  );
  const packageInfo = JSON.parse(
    await readFile(
      new URL('node_modules/@stellar/freighter-api/package.json', import.meta.url),
      'utf8',
    ),
  );
  if (packageInfo.version !== '6.0.1') throw Error('FREIGHTER_VERSION_MISMATCH');
  const freighterSha256 = createHash('sha256').update(freighter).digest('hex');
  if (freighterSha256 !== 'd797429cf97f9a67f1999910830a89dc01d565aedebafb651a11b1ed003a7e9d')
    throw Error('FREIGHTER_BUNDLE_MISMATCH');
  const bridge = createBrowserBridge({
    ...bridgeOptions,
    publicOrigin,
    createServices: (input) => runtime.createServices(input),
    readView: (input) => runtime.readView(input),
    recovery: runtime.recovery,
  });
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'${walletConnections}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  return Object.freeze({
    freighterSha256,
    async handler(request, response) {
      if (request.url?.startsWith('/api/')) return bridge.handler(request, response);
      try {
        if (!['GET', 'HEAD'].includes(request.method) || request.headers.host !== origin.host) {
          response.writeHead(403, headers).end('Unavailable');
          return;
        }
        const url = new URL(request.url, publicOrigin);
        if (url.origin !== publicOrigin || url.search || url.hash) throw Error();
        let body, type;
        if (url.pathname === '/wallet-config.json') {
          body = JSON.stringify(walletConfig);
          type = 'application/json; charset=utf-8';
        } else if (url.pathname === '/vendor/walletconnect.mjs' && mobileBundle) {
          body = mobileBundle;
          type = 'text/javascript; charset=utf-8';
        } else if (url.pathname === '/vendor/freighter-api.js') {
          body = freighter;
          type = 'text/javascript; charset=utf-8';
        } else {
          const entry = routes.get(url.pathname);
          if (!entry) throw Error();
          const path = resolve(app, entry[0]);
          if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) throw Error();
          body = await readFile(path);
          type = entry[1];
        }
        response
          .writeHead(200, { ...headers, 'Content-Type': type })
          .end(request.method === 'HEAD' ? undefined : body);
      } catch {
        response.writeHead(404, headers).end('Not found');
      }
    },
    close() {
      bridge.close();
      runtime.close();
    },
  });
}
