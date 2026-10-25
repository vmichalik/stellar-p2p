import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { isSetupRoute, readSetupRoute } from './setup-check.mjs';
import { isExtensionRoute, readExtensionRoute } from './extension-check.mjs';
import { isProofUiRoute, readProofUiRoute } from './proof-ui.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UPSTREAM_HOST = '127.0.0.1';
const DEFAULT_UPSTREAM_PORT = 17847;
const DEFAULT_GATEWAY_PORT = 17848;
const PLUGIN_PATH = join(HERE, 'revolut.plugin.mjs');
const HTML_PATH = join(HERE, 'launcher.html');
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CONNECTION_CHECK_BYTES = 1048576;

function validatePublicOrigin(value) {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('TLSN_PUBLIC_ORIGIN must be an HTTPS origin');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('TLSN_PUBLIC_ORIGIN must be an HTTPS origin');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== value ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('TLSN_PUBLIC_ORIGIN must be an HTTPS origin');
  }
  return parsed.origin;
}

function validPort(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error(`${label} must be a valid TCP port`);
  return value;
}

function fixedContentHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function sendText(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, fixedContentHeaders(contentType));
  response.end(body);
}

// Consume a bounded synthetic upload without logging, persisting, or echoing it.
export async function checkUpload(request, response, publicOrigin) {
  if (request.headers.origin !== publicOrigin) {
    sendText(response, 403, 'Origin not allowed');
    return;
  }
  if (
    request.headers['content-type'] !== 'application/octet-stream' ||
    request.headers['content-length'] !== String(CONNECTION_CHECK_BYTES)
  ) {
    sendText(response, 400, 'Expected exactly one MiB of synthetic data');
    return;
  }
  let receivedBytes = 0;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('upload timeout')), 20000);
      request.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > CONNECTION_CHECK_BYTES) {
          clearTimeout(timer);
          reject(new Error('upload too large'));
        }
      });
      request.once('end', () => {
        clearTimeout(timer);
        resolve();
      });
      request.once('error', () => {
        clearTimeout(timer);
        reject(new Error('upload failed'));
      });
      request.once('aborted', () => {
        clearTimeout(timer);
        reject(new Error('upload aborted'));
      });
    });
    if (receivedBytes !== CONNECTION_CHECK_BYTES) {
      sendText(response, 400, 'Incomplete upload');
      return;
    }
    sendText(response, 200, JSON.stringify({ receivedBytes }), 'application/json; charset=utf-8');
  } catch {
    if (!response.destroyed && !response.writableEnded)
      sendText(response, 400, 'Upload check did not complete');
  }
}

function validUpgradePath(rawUrl) {
  if (rawUrl === '/session') return true;
  const verifierMatch = rawUrl.match(/^\/verifier\?sessionId=([^&=]+)$/);
  if (verifierMatch) return SESSION_ID.test(verifierMatch[1]);
  return rawUrl === '/proxy?token=app.revolut.com';
}

function getUpgradeTarget(rawUrl) {
  if (rawUrl === '/session') return '/session';
  if (rawUrl.startsWith('/verifier?'))
    return `/verifier?sessionId=${rawUrl.slice('/verifier?sessionId='.length)}`;
  if (rawUrl === '/proxy?token=app.revolut.com') return rawUrl;
  return null;
}

function safeWebSocketHeaders(headers) {
  const forwarded = {
    host: `${UPSTREAM_HOST}:${this.upstreamPort}`,
    connection: 'Upgrade',
    upgrade: 'websocket',
  };
  for (const name of [
    'sec-websocket-key',
    'sec-websocket-version',
    'sec-websocket-protocol',
    'sec-websocket-extensions',
    'origin',
  ]) {
    if (typeof headers[name] === 'string') forwarded[name] = headers[name];
  }
  return forwarded;
}

export function makeGatewayResponseHeaders(publicOrigin) {
  const nonce = randomBytes(18).toString('base64');
  return {
    nonce,
    headers: {
      ...fixedContentHeaders('text/html; charset=utf-8'),
      'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
    publicOrigin,
  };
}

export function createLauncherServer(options = {}) {
  const publicOrigin = validatePublicOrigin(options.publicOrigin ?? process.env.TLSN_PUBLIC_ORIGIN);
  const upstreamPort = validPort(
    options.upstreamPort ?? DEFAULT_UPSTREAM_PORT,
    'TLSN_VERIFIER_PORT',
  );
  const port = validPort(options.port ?? DEFAULT_GATEWAY_PORT, 'TLSN_LAUNCHER_PORT');
  const requestImpl = options.requestImpl ?? httpRequest;

  async function handleHttp(request, response) {
    const rawUrl = request.url ?? '';
    if (request.method === 'GET' && isProofUiRoute(rawUrl)) {
      try {
        const asset = await readProofUiRoute(rawUrl);
        response.writeHead(200, fixedContentHeaders(asset.contentType));
        response.end(asset.body);
      } catch {
        sendText(response, 503, 'Presentation asset unavailable');
      }
      return;
    }
    if (request.method === 'GET' && isExtensionRoute(rawUrl)) {
      try {
        const asset = await readExtensionRoute(rawUrl, publicOrigin);
        const { nonce, headers } = makeGatewayResponseHeaders(publicOrigin);
        headers['Content-Type'] = asset.contentType;
        response.writeHead(200, headers);
        response.end(
          asset.html ? String(asset.body).replaceAll('__TLSN_SCRIPT_NONCE__', nonce) : asset.body,
        );
      } catch {
        sendText(response, 503, 'Extension diagnostic unavailable');
      }
      return;
    }
    if (request.method === 'GET' && isSetupRoute(rawUrl)) {
      try {
        const asset = await readSetupRoute(rawUrl, publicOrigin);
        const { nonce, headers } = makeGatewayResponseHeaders(publicOrigin);
        // Only this bank-free WASM diagnostic enables WASM evaluation/workers.
        headers['Content-Security-Policy'] =
          `default-src 'self'; script-src 'nonce-${nonce}' 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' ${publicOrigin.replace(/^https:/, 'wss:')}; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`;
        headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
        headers['Content-Type'] = asset.contentType;
        response.writeHead(200, headers);
        response.end(
          asset.html ? String(asset.body).replaceAll('__TLSN_SCRIPT_NONCE__', nonce) : asset.body,
        );
      } catch {
        sendText(response, 503, 'Setup diagnostic unavailable');
      }
      return;
    }
    if (request.method === 'POST' && rawUrl === '/connection-check') {
      await checkUpload(request, response, publicOrigin);
      return;
    }
    const getRoute =
      request.method === 'GET' && ['/', '/plugin.mjs', '/health', '/info'].includes(rawUrl);
    if (!getRoute) {
      sendText(
        response,
        request.method === 'GET' || request.method === 'HEAD' ? 404 : 405,
        'Not found',
      );
      return;
    }

    if (rawUrl === '/') {
      try {
        const html = await readFile(HTML_PATH, 'utf8');
        const { nonce, headers } = makeGatewayResponseHeaders(publicOrigin);
        const rendered = html
          .replaceAll('__TLSN_SCRIPT_NONCE__', nonce)
          .replaceAll('__TLSN_PUBLIC_ORIGIN__', publicOrigin);
        response.writeHead(200, headers);
        response.end(rendered);
      } catch {
        sendText(response, 500, 'Launcher unavailable');
      }
      return;
    }

    if (rawUrl === '/plugin.mjs') {
      try {
        const source = await readFile(PLUGIN_PATH, 'utf8');
        const verifier = JSON.stringify(publicOrigin);
        const proxy = JSON.stringify(
          `${publicOrigin.replace(/^https:/, 'wss:')}/proxy?token=app.revolut.com`,
        );
        const configured = source
          .replace("const VERIFIER_ORIGIN = '';", `const VERIFIER_ORIGIN = ${verifier};`)
          .replace("const PROXY_URL = '';", `const PROXY_URL = ${proxy};`);
        if (
          configured === source ||
          configured.includes("const VERIFIER_ORIGIN = '';") ||
          configured.includes("const PROXY_URL = '';")
        ) {
          sendText(response, 500, 'Plugin configuration unavailable');
          return;
        }
        response.writeHead(200, fixedContentHeaders('text/javascript; charset=utf-8'));
        response.end(configured);
      } catch {
        sendText(response, 500, 'Plugin unavailable');
      }
      return;
    }

    const verifierPath = rawUrl === '/health' || rawUrl === '/info' ? rawUrl : null;
    if (!verifierPath) {
      sendText(response, 404, 'Not found');
      return;
    }
    const upstream = requestImpl(
      { hostname: UPSTREAM_HOST, port: upstreamPort, path: verifierPath, method: 'GET' },
      (upstreamResponse) => {
        const chunks = [];
        let length = 0;
        upstreamResponse.on('data', (chunk) => {
          length += chunk.length;
          if (length <= 1024 * 1024) chunks.push(chunk);
          else upstream.destroy(new Error('response too large'));
        });
        upstreamResponse.on('end', () => {
          if (response.destroyed) return;
          const contentType = upstreamResponse.headers['content-type']?.startsWith(
            'application/json',
          )
            ? 'application/json; charset=utf-8'
            : 'text/plain; charset=utf-8';
          response.writeHead(upstreamResponse.statusCode ?? 502, fixedContentHeaders(contentType));
          response.end(Buffer.concat(chunks));
        });
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) sendText(response, 502, 'Verifier unavailable');
      else response.destroy();
    });
    upstream.setTimeout?.(5000, () => upstream.destroy(new Error('readiness timeout')));
    upstream.end();
  }

  const server = createHttpServer((request, response) => {
    void handleHttp(request, response);
  });
  server.on('upgrade', (request, clientSocket, head) => {
    const target = getUpgradeTarget(request.url ?? '');
    if (request.method !== 'GET' || !target || !validUpgradePath(request.url ?? '')) {
      clientSocket.end(
        'HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 9\r\n\r\nNot found',
      );
      return;
    }

    const headers = safeWebSocketHeaders.call({ upstreamPort }, request.headers);
    const upstream = requestImpl({
      hostname: UPSTREAM_HOST,
      port: upstreamPort,
      path: target,
      method: 'GET',
      headers,
    });
    upstream.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      const statusText = upstreamResponse.statusMessage || 'Switching Protocols';
      const responseHeaders = Object.entries(upstreamResponse.headers)
        .filter(
          ([name, value]) =>
            value !== undefined && !['connection', 'upgrade'].includes(name.toLowerCase()),
        )
        .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
      clientSocket.write(
        `HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${statusText}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${responseHeaders.join('\r\n')}\r\n\r\n`,
      );
      if (upstreamHead.length) clientSocket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
      clientSocket.on('error', () => upstreamSocket.destroy());
      upstreamSocket.on('error', () => clientSocket.destroy());
    });
    upstream.on('response', (upstreamResponse) => {
      const status = upstreamResponse.statusCode ?? 502;
      const body = status === 404 ? 'Not found' : 'Verifier unavailable';
      clientSocket.end(
        `HTTP/1.1 ${status} ${upstreamResponse.statusMessage || 'Error'}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      );
    });
    upstream.on('error', () => {
      if (!clientSocket.destroyed)
        clientSocket.end(
          'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 20\r\n\r\nVerifier unavailable',
        );
    });
    upstream.end();
  });

  return {
    server,
    port,
    upstreamPort,
    publicOrigin,
    validateUpgradePath: validUpgradePath,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

const invokedPath = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;
if (invokedPath) {
  try {
    const gateway = createLauncherServer({
      port: Number(process.env.TLSN_LAUNCHER_PORT ?? DEFAULT_GATEWAY_PORT),
      upstreamPort: Number(process.env.TLSN_UPSTREAM_PORT ?? DEFAULT_UPSTREAM_PORT),
    });
    const address = await gateway.listen();
    process.stdout.write(
      `TLSNotary launcher listening on http://${address.address}:${address.port}\n`,
    );
  } catch {
    process.stderr.write(
      'TLSNotary launcher could not start; check TLSN_PUBLIC_ORIGIN and local ports.\n',
    );
    process.exitCode = 1;
  }
}
