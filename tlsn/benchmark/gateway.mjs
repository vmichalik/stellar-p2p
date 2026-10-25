import { createServer, request as httpRequest } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTargets } from './core.mjs';
import { isExtensionRoute, readExtensionRoute } from '../extension-check.mjs';
import { isResponseRoute, readResponseRoute } from '../response-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VERIFIER_GIT_HASH = '68bbd380d6e1a89d79748e5294661c752f5d1205';
export const TLSN_VERSION = '0.1.0-alpha.15';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_READINESS_BYTES = 65536;
export const ADMISSION_HOLD_MS = 150000;
export const PROXY_BYTES_PER_DIRECTION = 1024 * 1024;
export const DEFAULT_EXTENSION_ORIGIN = 'chrome-extension://gnoglgpcamodhflknhmafmjdahcejcgg';
const ROUTES = new Map([
  ['/benchmark/', ['benchmark.html', 'text/html; charset=utf-8']],
  ['/benchmark/benchmark.mjs', ['benchmark.mjs', 'text/javascript; charset=utf-8']],
  ['/benchmark/worker.mjs', ['worker.mjs', 'text/javascript; charset=utf-8']],
  ['/benchmark/core.mjs', ['core.mjs', 'text/javascript; charset=utf-8']],
  ['/benchmark/tlsn_wasm.js', ['tlsn_wasm.js', 'text/javascript; charset=utf-8']],
  ['/benchmark/tlsn_wasm_bg.wasm', ['tlsn_wasm_bg.wasm', 'application/wasm']],
  [
    '/benchmark/snippets/web-spawn-05868593a72e2d44/js/spawn.js',
    ['snippets/web-spawn-05868593a72e2d44/js/spawn.js', 'text/javascript; charset=utf-8'],
  ],
]);
const PINNED_ASSETS = Object.freeze({
  'tlsn_wasm.js': '523711ce5c7f1d5206bc05250153e74f3063ed7e420d0a0953ca24b4ea39dc4f',
  'tlsn_wasm_bg.wasm': 'bb3c73628f088867a1f99291275b56a379ce44fd239efca9445fb5908a97e318',
  'snippets/web-spawn-05868593a72e2d44/js/spawn.js':
    'ef1d4a01ff707f368a03e3dd5d991af8c191d2dc607abb1f3a672f16a5ceb14a',
});

function port(value, allowZero = false) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65535)
    throw new Error('INVALID_PORT');
  return value;
}

function listenHost(value) {
  if (value !== '127.0.0.1' && value !== '0.0.0.0') throw new Error('INVALID_LISTEN_HOST');
  return value;
}

function admissionLimit(value, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error('INVALID_ADMISSION_LIMIT');
  return value;
}

function publicConfiguration(publicOrigin, targets) {
  const approved = validateTargets(targets);
  if (!approved.some((target) => target.origin === publicOrigin))
    throw new Error('INVALID_PUBLIC_ORIGIN');
  return approved;
}

export function gatewayHeaders(targets, type = 'text/plain; charset=utf-8') {
  const sockets = validateTargets(targets)
    .map((row) => row.origin.replace(/^https:/, 'wss:'))
    .join(' ');
  return {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' ${sockets}; style-src 'unsafe-inline'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

export function validUpgradePath(rawUrl) {
  if (rawUrl === '/session' || rawUrl === '/proxy?token=app.revolut.com') return true;
  const match = typeof rawUrl === 'string' && rawUrl.match(/^\/verifier\?sessionId=([^&=]+)$/);
  return !!match && UUID.test(match[1]);
}

export function validateExtensionOrigins(values) {
  if (
    !Array.isArray(values) ||
    values.length > 4 ||
    new Set(values).size !== values.length ||
    values.some(
      (value) => typeof value !== 'string' || !/^chrome-extension:\/\/[a-p]{32}$/.test(value),
    )
  )
    throw new Error('INVALID_EXTENSION_ORIGINS');
  return Object.freeze([...values]);
}

async function loadAssets(root, read = readFile) {
  const files = new Map();
  for (const [route, [name, type]] of ROUTES) {
    let body;
    try {
      body = Buffer.from(await read(resolve(root, name)));
    } catch {
      throw new Error('BENCHMARK_ASSET_UNAVAILABLE');
    }
    if (
      PINNED_ASSETS[name] &&
      createHash('sha256').update(body).digest('hex') !== PINNED_ASSETS[name]
    )
      throw new Error('PINNED_ASSET_MISMATCH');
    files.set(route, { body, type });
  }
  return files;
}

export async function createBenchmarkGateway(options = {}) {
  const targets = publicConfiguration(options.publicOrigin, options.targets);
  const listenPort = port(options.port ?? 17848, true);
  const host = listenHost(options.host ?? '127.0.0.1');
  const upstreamPort = port(options.upstreamPort ?? 17847);
  const maxVerifierStarts = admissionLimit(options.maxVerifierStarts ?? 2, 2);
  const maxSessionStarts = admissionLimit(options.maxSessionStarts ?? 2, 2);
  const maxProxyStarts = admissionLimit(options.maxProxyStarts ?? 2, 2);
  const maxWebSocketConnections = admissionLimit(options.maxWebSocketConnections ?? 8, 16);
  const extensionOrigins = validateExtensionOrigins(options.extraExtensionOrigins ?? []);
  if (maxWebSocketConnections < 2 * maxVerifierStarts) throw new Error('INVALID_ADMISSION_LIMIT');
  const setAdmissionTimer = options.setTimeoutImpl ?? setTimeout;
  const clearAdmissionTimer = options.clearTimeoutImpl ?? clearTimeout;
  const request = options.requestImpl ?? httpRequest;
  const assets = await loadAssets(options.assetRoot ?? HERE, options.readFileImpl ?? readFile);
  assets.set('/benchmark/config.mjs', {
    type: 'text/javascript; charset=utf-8',
    body: Buffer.from(
      `// Fixed operator-approved origins.\nexport const TARGETS = Object.freeze(${JSON.stringify(targets)});\n`,
    ),
  });
  const approvedOrigins = new Set([
    ...targets.map((row) => row.origin),
    DEFAULT_EXTENSION_ORIGIN,
    ...extensionOrigins,
  ]);
  const connections = new Set();
  const activeClients = new Set();
  const verifierSlots = new Map();
  const sessionSlots = new Map();
  const proxySlots = new Map();

  function send(response, status, body, type) {
    response.writeHead(status, gatewayHeaders(targets, type));
    response.end(body);
  }

  function readiness(rawUrl, response) {
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: upstreamPort,
        path: rawUrl,
        method: 'GET',
        agent: false,
        headers: { host: `127.0.0.1:${upstreamPort}`, connection: 'close' },
      },
      (incoming) => {
        const chunks = [];
        let size = 0;
        incoming.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_READINESS_BYTES) upstream.destroy(new Error('UPSTREAM_LIMIT'));
          else chunks.push(chunk);
        });
        incoming.on('error', () => {
          if (!response.headersSent) send(response, 502, 'Verifier unavailable');
        });
        incoming.on('end', () => {
          if (response.destroyed || response.headersSent) return;
          const body = Buffer.concat(chunks).toString('utf8');
          if (incoming.statusCode !== 200 || size > MAX_READINESS_BYTES)
            return send(response, 502, 'Verifier unavailable');
          if (rawUrl === '/health')
            return body.trim() === 'ok'
              ? send(response, 200, 'ok')
              : send(response, 503, 'Pinned verifier unavailable');
          try {
            const info = JSON.parse(body);
            if (
              info.git_hash !== VERIFIER_GIT_HASH ||
              info.tlsn_version !== TLSN_VERSION ||
              info.version !== '0.1.0'
            )
              return send(response, 503, 'Pinned verifier unavailable');
            send(
              response,
              200,
              JSON.stringify({
                version: '0.1.0',
                git_hash: VERIFIER_GIT_HASH,
                tlsn_version: TLSN_VERSION,
              }),
              'application/json; charset=utf-8',
            );
          } catch {
            send(response, 503, 'Pinned verifier unavailable');
          }
        });
      },
    );
    upstream.on('error', () => {
      if (!response.destroyed && !response.headersSent) send(response, 502, 'Verifier unavailable');
    });
    upstream.setTimeout(5000, () => upstream.destroy(new Error('UPSTREAM_TIMEOUT')));
    response.once('close', () => upstream.destroy());
    upstream.end();
  }

  async function extensionAsset(rawUrl, response) {
    try {
      const asset = isResponseRoute(rawUrl)
        ? await readResponseRoute(rawUrl, options.publicOrigin)
        : await readExtensionRoute(rawUrl, options.publicOrigin);
      const nonce = randomBytes(18).toString('base64');
      const headers = gatewayHeaders(targets, asset.contentType);
      headers['Content-Security-Policy'] =
        `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`;
      delete headers['Cross-Origin-Embedder-Policy'];
      response.writeHead(200, headers);
      response.end(
        asset.html ? String(asset.body).replaceAll('__TLSN_SCRIPT_NONCE__', nonce) : asset.body,
      );
    } catch {
      send(response, 503, 'Public extension diagnostic unavailable');
    }
  }

  const server = createServer((incoming, response) => {
    const rawUrl = incoming.url ?? '';
    if (incoming.method !== 'GET') return send(response, 404, 'Not found');
    if (rawUrl === '/') {
      response.writeHead(302, { ...gatewayHeaders(targets), Location: '/benchmark/' });
      response.end();
      return;
    }
    if (isExtensionRoute(rawUrl) || isResponseRoute(rawUrl)) {
      void extensionAsset(rawUrl, response);
      return;
    }
    const asset = assets.get(rawUrl);
    if (asset) return send(response, 200, asset.body, asset.type);
    if (rawUrl === '/health' || rawUrl === '/info') return readiness(rawUrl, response);
    send(response, 404, 'Not found');
  });

  function rejectUpgrade(socket, status, body) {
    socket.end(
      `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
  }

  server.on('upgrade', (incoming, client, head) => {
    const rawUrl = incoming.url ?? '';
    if (incoming.method !== 'GET' || !validUpgradePath(rawUrl))
      return rejectUpgrade(client, '404 Not Found', 'Not found');
    if (!approvedOrigins.has(incoming.headers.origin))
      return rejectUpgrade(client, '403 Forbidden', 'Origin not allowed');
    if (
      incoming.headers.upgrade?.toLowerCase() !== 'websocket' ||
      incoming.headers['sec-websocket-version'] !== '13' ||
      !/^[A-Za-z0-9+/]{22}==$/.test(incoming.headers['sec-websocket-key'] ?? '')
    )
      return rejectUpgrade(client, '400 Bad Request', 'Invalid WebSocket');
    const isVerifier = rawUrl.startsWith('/verifier?');
    const isSession = rawUrl === '/session';
    const isProxy = rawUrl === '/proxy?token=app.revolut.com';
    if (
      activeClients.size >= maxWebSocketConnections ||
      (isVerifier && verifierSlots.size >= maxVerifierStarts) ||
      (isSession && sessionSlots.size >= maxSessionStarts) ||
      (isProxy && proxySlots.size >= maxProxyStarts)
    )
      return rejectUpgrade(
        client,
        '503 Service Unavailable',
        'Diagnostic capacity is busy; try later',
      );

    // Count connection starts conservatively, without parsing WS payloads or
    // trusting client identities. Keep a verifier slot after disconnect because
    // the pinned upstream can retain an abandoned task for 120 seconds.
    if (isVerifier || isSession || isProxy) {
      const slots = isVerifier ? verifierSlots : isSession ? sessionSlots : proxySlots;
      const slot = Symbol('diagnostic-start');
      const timer = setAdmissionTimer(() => slots.delete(slot), ADMISSION_HOLD_MS);
      timer?.unref?.();
      slots.set(slot, timer);
    }
    activeClients.add(client);
    const lifetime = setAdmissionTimer(() => client.destroy(), ADMISSION_HOLD_MS);
    lifetime?.unref?.();
    client.once('close', () => {
      activeClients.delete(client);
      clearAdmissionTimer(lifetime);
    });
    client.once('end', () => client.destroy());
    let bridged = false;
    const upstream = request({
      hostname: '127.0.0.1',
      port: upstreamPort,
      path: rawUrl,
      method: 'GET',
      agent: false,
      headers: {
        host: `127.0.0.1:${upstreamPort}`,
        connection: 'Upgrade',
        upgrade: 'websocket',
        origin: incoming.headers.origin,
        'sec-websocket-version': '13',
        'sec-websocket-key': incoming.headers['sec-websocket-key'],
      },
    });
    client.once('error', () => upstream.destroy());
    client.once('close', () => upstream.destroy());
    upstream.on('upgrade', (response, peer, upstreamHead) => {
      upstream.setTimeout(0);
      const accept = response.headers['sec-websocket-accept'];
      if (
        response.statusCode !== 101 ||
        typeof accept !== 'string' ||
        !/^[A-Za-z0-9+/]{27}=$/.test(accept)
      ) {
        peer.destroy();
        return rejectUpgrade(client, '502 Bad Gateway', 'Verifier unavailable');
      }
      bridged = true;
      connections.add(client);
      connections.add(peer);
      let uploadLimit, downloadLimit;
      const close = () => {
        connections.delete(client);
        connections.delete(peer);
        client.destroy();
        peer.destroy();
        uploadLimit?.destroy();
        downloadLimit?.destroy();
      };
      client.once('close', close);
      peer.once('close', close);
      peer.once('end', close);
      client.once('error', close);
      peer.once('error', close);
      if (
        isProxy &&
        (head.length > PROXY_BYTES_PER_DIRECTION || upstreamHead.length > PROXY_BYTES_PER_DIRECTION)
      ) {
        close();
        return;
      }
      client.write(
        `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      if (upstreamHead.length) client.write(upstreamHead);
      if (head.length) peer.write(head);
      if (isProxy) {
        const limited = (initial) => {
          let bytes = initial;
          return new Transform({
            transform(chunk, encoding, callback) {
              bytes += chunk.length;
              if (bytes > PROXY_BYTES_PER_DIRECTION) callback(new Error('PROXY_BYTE_LIMIT'));
              else callback(null, chunk);
            },
          }).once('error', close);
        };
        uploadLimit = limited(head.length);
        downloadLimit = limited(upstreamHead.length);
        peer.pipe(downloadLimit).pipe(client);
        client.pipe(uploadLimit).pipe(peer);
      } else {
        peer.pipe(client);
        client.pipe(peer);
      }
    });
    upstream.on('response', (response) => {
      response.resume();
      rejectUpgrade(client, '502 Bad Gateway', 'Verifier unavailable');
    });
    upstream.on('error', () => {
      if (client.destroyed) return;
      if (bridged) client.destroy();
      else rejectUpgrade(client, '502 Bad Gateway', 'Verifier unavailable');
    });
    upstream.setTimeout(10000, () => upstream.destroy(new Error('UPGRADE_TIMEOUT')));
    upstream.end();
  });

  return {
    server,
    targets,
    publicOrigin: options.publicOrigin,
    upstreamPort,
    host,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, host, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      return server.address();
    },
    async close() {
      for (const socket of connections) socket.destroy();
      for (const socket of activeClients) socket.destroy();
      for (const timer of verifierSlots.values()) clearAdmissionTimer(timer);
      for (const timer of sessionSlots.values()) clearAdmissionTimer(timer);
      for (const timer of proxySlots.values()) clearAdmissionTimer(timer);
      connections.clear();
      activeClients.clear();
      verifierSlots.clear();
      sessionSlots.clear();
      proxySlots.clear();
      if (server.listening)
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { TARGETS } = await import('./config.mjs');
    const gateway = await createBenchmarkGateway({
      publicOrigin: process.env.TLSN_BENCHMARK_PUBLIC_ORIGIN,
      targets: TARGETS,
      port: port(Number(process.env.TLSN_BENCHMARK_GATEWAY_PORT ?? 17848)),
      host: process.env.TLSN_BENCHMARK_LISTEN_HOST ?? '127.0.0.1',
      upstreamPort: port(Number(process.env.TLSN_BENCHMARK_UPSTREAM_PORT ?? 17847)),
      extraExtensionOrigins: JSON.parse(process.env.TLSN_EXTRA_EXTENSION_ORIGINS ?? '[]'),
    });
    const address = await gateway.listen();
    console.log(`Bank-free benchmark gateway listening on ${address.address}:${address.port}`);
    const stop = async () => {
      await gateway.close();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch {
    console.error(
      'Bank-free benchmark gateway could not start; check fixed targets, public origin, ports and pinned assets.',
    );
    process.exitCode = 1;
  }
}
