import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import {
  ADMISSION_HOLD_MS,
  PROXY_BYTES_PER_DIRECTION,
  DEFAULT_EXTENSION_ORIGIN,
  createBenchmarkGateway,
  gatewayHeaders,
  TLSN_VERSION,
  VERIFIER_GIT_HASH,
  validUpgradePath,
} from './gateway.mjs';

const TARGETS = [
  { id: 'mini', origin: 'https://mini.example.test:9492' },
  { id: 'cloud', origin: 'https://cloud.example.test:9492' },
];
const ID = '00000000-0000-4000-8000-000000000001';
const INFO = { version: '0.1.0', git_hash: VERIFIER_GIT_HASH, tlsn_version: TLSN_VERSION };
const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const ASSET_ROOT = fileURLToPath(
  new URL('../../.private/benchmark-stage/benchmark/', import.meta.url),
);
const stagedAssetsAvailable = await access(
  new URL('../../.private/benchmark-stage/benchmark/tlsn_wasm_bg.wasm', import.meta.url),
).then(
  () => true,
  () => false,
);
const stagedTest = (name, fn) =>
  test(
    name,
    {
      skip: stagedAssetsAvailable
        ? false
        : 'Prepare the ignored benchmark stage to run released-runtime integration tests.',
    },
    fn,
  );

async function fixture(
  t,
  {
    health = 'ok',
    info = INFO,
    upstreamStatus = 200,
    gatewayOptions = {},
    echo = true,
    initialReply = null,
  } = {},
) {
  const calls = [];
  const peers = new Set();
  const upstream = createServer((incoming, response) => {
    calls.push({
      kind: 'http',
      url: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    });
    response.writeHead(upstreamStatus, {
      'Content-Type': incoming.url === '/info' ? 'application/json' : 'text/plain',
    });
    response.end(incoming.url === '/info' ? JSON.stringify(info) : health);
  });
  upstream.on('upgrade', (incoming, socket, head) => {
    const call = {
      kind: 'ws',
      url: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
      receivedBytes: head.length,
    };
    calls.push(call);
    peers.add(socket);
    socket.once('close', () => peers.delete(socket));
    const accept = createHash('sha1')
      .update(incoming.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    const response = Buffer.from(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.write(initialReply ? Buffer.concat([response, initialReply]) : response);
    if (head.length) socket.write(head);
    socket.on('data', (data) => {
      call.receivedBytes += data.length;
      if (echo) socket.write(data);
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = await createBenchmarkGateway({
    publicOrigin: TARGETS[0].origin,
    targets: TARGETS,
    port: 0,
    upstreamPort: upstream.address().port,
    assetRoot: ASSET_ROOT,
    ...gatewayOptions,
  });
  const address = await gateway.listen();
  t.after(async () => {
    await gateway.close();
    for (const socket of peers) socket.destroy();
    await new Promise((resolve) => upstream.close(resolve));
  });
  return { gateway, upstream, calls, peers, port: address.port };
}

function get(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { hostname: '127.0.0.1', port, path, method, headers, agent: false },
      (response) => {
        const chunks = [];
        response.on('data', (data) => chunks.push(data));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.once('error', reject);
    request.end();
  });
}

function rawUpgrade(
  port,
  path,
  {
    origin = TARGETS[0].origin,
    method = 'GET',
    key = WS_KEY,
    extraHeaders = {},
    body = null,
    keep = false,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let buffer = Buffer.alloc(0),
      settled = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Test handshake timeout'));
    }, 3000);
    socket.once('connect', () => {
      const headers = {
        Host: 'caller-controlled.invalid',
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        ...(origin === null ? {} : { Origin: origin }),
        ...extraHeaders,
      };
      const request = Buffer.from(
        `${method} ${path} HTTP/1.1\r\n` +
          Object.entries(headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\r\n') +
          '\r\n\r\n',
      );
      socket.write(body ? Buffer.concat([request, body]) : request);
    });
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const split = buffer.indexOf('\r\n\r\n');
      if (split < 0 || settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      const head = buffer.subarray(0, split + 4).toString('ascii');
      const rest = buffer.subarray(split + 4);
      if (!keep) socket.destroy();
      resolve({ head, rest, socket });
    };
    socket.on('data', onData);
    socket.once('error', (error) => {
      clearTimeout(timer);
      if (!settled) reject(error);
    });
  });
}

stagedTest(
  'gateway binds only loopback and serves fixed benchmark assets with exact-origin isolation policy',
  async (t) => {
    const h = await fixture(t);
    assert.equal(h.gateway.server.address().address, '127.0.0.1');
    const page = await get(h.port, '/benchmark/');
    assert.equal(page.status, 200);
    assert.match(page.body.toString(), /Check TLSNotary setup/);
    assert.equal(page.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(page.headers['cross-origin-embedder-policy'], 'require-corp');
    assert.equal(page.headers['cross-origin-resource-policy'], 'same-origin');
    assert.match(
      page.headers['content-security-policy'],
      /connect-src 'self' wss:\/\/mini.example.test:9492 wss:\/\/cloud.example.test:9492;/,
    );
    assert.equal(page.headers['cache-control'], 'no-store');
    const wasm = await get(h.port, '/benchmark/tlsn_wasm_bg.wasm');
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers['content-type'], 'application/wasm');
    assert.equal(
      createHash('sha256').update(wasm.body).digest('hex'),
      'bb3c73628f088867a1f99291275b56a379ce44fd239efca9445fb5908a97e318',
    );
    assert.equal(h.calls.length, 0);
  },
);

stagedTest(
  'config uses only operator-pinned origins, never request Host or other caller input',
  async (t) => {
    const h = await fixture(t);
    const home = await get(h.port, '/', { headers: { Host: 'untrusted.invalid' } });
    assert.equal(home.status, 302);
    assert.equal(home.headers.location, '/benchmark/');
    assert.doesNotMatch(home.body.toString(), /untrusted/);
    assert.equal((await get(h.port, '/', { method: 'POST' })).status, 404);
    assert.equal((await get(h.port, '/?next=https://untrusted.invalid')).status, 404);
    const config = await get(h.port, '/benchmark/config.mjs', {
      headers: { Host: 'untrusted.invalid', Origin: 'https://other.invalid' },
    });
    assert.equal(config.status, 200);
    assert.match(config.body.toString(), /mini.example.test/);
    assert.match(config.body.toString(), /cloud.example.test/);
    assert.doesNotMatch(config.body.toString(), /untrusted|other.invalid/);
  },
);

stagedTest(
  'unlisted routes, query strings, traversal, bank proxy and non-GET methods never reach upstream',
  async (t) => {
    const h = await fixture(t);
    for (const path of [
      '/?next=https://untrusted.invalid',
      '/proxy?token=app.revolut.com',
      '/session',
      '/verifier?sessionId=' + ID,
      '/benchmark/../README.md',
      '/benchmark/%2e%2e/config.mjs',
      '/benchmark/worker.mjs?x=1',
      '/plugin.mjs',
      '/extension-check/?x=1',
      '/extension-check/plugin.mjs?x=1',
      '/benchmark/README.md',
      '/benchmark/gateway.mjs',
      '/benchmark/core.test.mjs',
      '/health?token=private',
      '/info?x=1',
    ])
      assert.equal((await get(h.port, path)).status, 404, path);
    for (const method of ['POST', 'HEAD', 'DELETE', 'PUT'])
      assert.equal((await get(h.port, '/health', { method })).status, 404, method);
    assert.equal(h.calls.length, 0);
  },
);

stagedTest(
  'only pinned readiness fields are returned and caller secrets/headers are never forwarded',
  async (t) => {
    const h = await fixture(t, { info: { ...INFO, secret: 'must-not-escape' } });
    const headers = {
      Cookie: 'synthetic-secret',
      Authorization: 'synthetic-secret',
      Host: 'untrusted.invalid',
    };
    assert.equal((await get(h.port, '/health', { headers })).body.toString(), 'ok');
    const info = await get(h.port, '/info', { headers });
    assert.equal(info.status, 200);
    assert.deepEqual(JSON.parse(info.body), INFO);
    for (const call of h.calls) {
      assert.equal(call.method, 'GET');
      assert.equal(call.headers.cookie, undefined);
      assert.equal(call.headers.authorization, undefined);
      assert.match(call.headers.host, /^127\.0\.0\.1:/);
      assert.doesNotMatch(JSON.stringify(call), /synthetic-secret|untrusted/);
    }
    assert.doesNotMatch(info.body.toString(), /must-not-escape|secret/);
  },
);

stagedTest('wrong verifier revision fails closed without reflecting its response', async (t) => {
  const h = await fixture(t, {
    health: 'private-debug-info',
    info: { ...INFO, git_hash: 'private-wrong-revision' },
  });
  const health = await get(h.port, '/health');
  const info = await get(h.port, '/info');
  assert.equal(health.status, 503);
  assert.equal(info.status, 503);
  assert.doesNotMatch(health.body.toString() + info.body.toString(), /private/);
});

stagedTest(
  'WebSocket path and origin allowlists reject arbitrary targets before upstream access',
  async (t) => {
    const h = await fixture(t);
    for (const path of [
      '/proxy?token=APP.revolut.com',
      '/proxy?token=evil.invalid',
      '/proxy?token=app.revolut.com:443',
      '/proxy?token=%61pp.revolut.com',
      '/proxy?token=app.revolut.com&extra=1',
      '/session?x=1',
      '/verifier?sessionId=bad',
      '/verifier?sessionId=' + ID + '&x=1',
      '/verifier?sessionId=%2e%2e',
    ])
      assert.match((await rawUpgrade(h.port, path)).head, /^HTTP\/1.1 404 /, path);
    assert.match(
      (await rawUpgrade(h.port, '/proxy?token=app.revolut.com', { method: 'POST' })).head,
      /^HTTP\/1.1 404 /,
    );
    for (const origin of ['https://other.invalid', 'null', null])
      assert.match((await rawUpgrade(h.port, '/session', { origin })).head, /^HTTP\/1.1 403 /);
    assert.match(
      (await rawUpgrade(h.port, '/session', { key: 'invalid' })).head,
      /^HTTP\/1.1 400 /,
    );
    assert.equal(h.calls.length, 0);
  },
);

stagedTest('approved WebSockets bridge synthetic data and discard caller headers', async (t) => {
  const h = await fixture(t);
  const upgrade = await rawUpgrade(h.port, '/verifier?sessionId=' + ID, {
    keep: true,
    origin: TARGETS[1].origin,
    extraHeaders: {
      Cookie: 'synthetic-secret',
      Authorization: 'synthetic-secret',
      'Sec-WebSocket-Protocol': 'must-not-forward',
      'Sec-WebSocket-Extensions': 'permessage-deflate',
    },
  });
  assert.match(upgrade.head, /^HTTP\/1.1 101 /);
  const payload = Buffer.from('bounded synthetic MPC transport fixture');
  const received = once(upgrade.socket, 'data');
  upgrade.socket.write(payload);
  assert.deepEqual((await received)[0], payload);
  upgrade.socket.destroy();
  const call = h.calls.find((row) => row.kind === 'ws');
  assert.equal(call.url, '/verifier?sessionId=' + ID);
  assert.equal(call.headers.origin, TARGETS[1].origin);
  assert.match(call.headers.host, /^127\.0\.0\.1:/);
  assert.equal(call.headers.cookie, undefined);
  assert.equal(call.headers.authorization, undefined);
  assert.equal(call.headers['sec-websocket-protocol'], undefined);
  assert.equal(call.headers['sec-websocket-extensions'], undefined);
});

test('tampered pinned runtime prevents gateway construction before listening', async () => {
  await assert.rejects(
    createBenchmarkGateway({
      publicOrigin: TARGETS[0].origin,
      targets: TARGETS,
      readFileImpl: async (path) =>
        path.endsWith('tlsn_wasm.js') ? Buffer.from('tampered') : readFile(path),
    }),
    /PINNED_ASSET_MISMATCH/,
  );
});

test('invalid public origin and targets fail before any filesystem or network access', async () => {
  let reads = 0;
  for (const publicOrigin of [
    'http://mini.example.test',
    'https://mini.example.test:9492/',
    'https://unlisted.invalid',
  ]) {
    await assert.rejects(
      createBenchmarkGateway({
        publicOrigin,
        targets: TARGETS,
        readFileImpl: async () => {
          reads++;
          return Buffer.alloc(0);
        },
      }),
      /INVALID_PUBLIC_ORIGIN/,
    );
  }
  assert.equal(reads, 0);
  assert.equal(validUpgradePath('/session'), true);
  assert.equal(validUpgradePath('/verifier?sessionId=' + ID), true);
  assert.equal(validUpgradePath('/proxy?token=app.revolut.com'), true);
  assert.doesNotMatch(gatewayHeaders(TARGETS)['Content-Security-Policy'], /connect-src[^;]*\*/);
});

stagedTest(
  'external bind is opt-in and only the explicit cloud container address is accepted',
  async () => {
    const base = { publicOrigin: TARGETS[0].origin, targets: TARGETS, assetRoot: ASSET_ROOT };
    const local = await createBenchmarkGateway(base);
    const cloud = await createBenchmarkGateway({ ...base, host: '0.0.0.0' });
    assert.equal(local.host, '127.0.0.1');
    assert.equal(cloud.host, '0.0.0.0');
    assert.equal(cloud.upstreamPort, 17847);
    // Deliberately do not listen on all interfaces during tests.
    for (const host of ['localhost', '::', '::1', '192.0.2.1', '', '0.0.0.0:17848'])
      await assert.rejects(createBenchmarkGateway({ ...base, host }), /INVALID_LISTEN_HOST/);
  },
);

test('invalid admission limits fail before listening or opening upstream', async () => {
  const base = { publicOrigin: TARGETS[0].origin, targets: TARGETS };
  for (const limits of [
    { maxVerifierStarts: 0 },
    { maxVerifierStarts: 5 },
    { maxVerifierStarts: 1.5 },
    { maxWebSocketConnections: 99 },
    { maxVerifierStarts: 2, maxWebSocketConnections: 2 },
  ])
    await assert.rejects(createBenchmarkGateway({ ...base, ...limits }), /INVALID_ADMISSION_LIMIT/);
});

stagedTest(
  'verifier admission is bounded, held after disconnect, and expires without payload parsing',
  async (t) => {
    const timers = [];
    const h = await fixture(t, {
      gatewayOptions: {
        setTimeoutImpl(fn, delay) {
          const timer = { fn, delay, cleared: false, unref() {} };
          timers.push(timer);
          return timer;
        },
        clearTimeoutImpl(timer) {
          if (timer) timer.cleared = true;
        },
      },
    });
    for (let i = 0; i < 2; i++) {
      const response = await rawUpgrade(h.port, '/verifier?sessionId=' + ID);
      assert.match(response.head, /^HTTP\/1.1 101 /);
    }
    for (let i = 0; i < 30 && timers.filter((timer) => !timer.cleared).length > 2; i++)
      await new Promise((resolve) => setTimeout(resolve, 2));
    const before = h.calls.filter((row) => row.kind === 'ws').length;
    const busy = await rawUpgrade(h.port, '/verifier?sessionId=' + ID);
    assert.match(busy.head, /^HTTP\/1.1 503 /);
    assert.equal(h.calls.filter((row) => row.kind === 'ws').length, before);
    const retained = timers.filter((timer) => !timer.cleared);
    assert.equal(retained.length, 2);
    assert.ok(retained.every((timer) => timer.delay === ADMISSION_HOLD_MS));
    assert.ok(ADMISSION_HOLD_MS > 120000);
    for (const timer of retained) timer.fn();
    assert.match((await rawUpgrade(h.port, '/verifier?sessionId=' + ID)).head, /^HTTP\/1.1 101 /);
  },
);

stagedTest('control connections have a global cap and an absolute lifetime', async (t) => {
  const timers = [];
  const h = await fixture(t, {
    gatewayOptions: {
      maxVerifierStarts: 1,
      maxWebSocketConnections: 2,
      setTimeoutImpl(fn, delay) {
        const timer = { fn, delay, unref() {} };
        timers.push(timer);
        return timer;
      },
      clearTimeoutImpl() {},
    },
  });
  const first = await rawUpgrade(h.port, '/session', { keep: true });
  const second = await rawUpgrade(h.port, '/verifier?sessionId=' + ID, { keep: true });
  const busy = await rawUpgrade(h.port, '/session');
  assert.match(first.head, /^HTTP\/1.1 101 /);
  assert.match(second.head, /^HTTP\/1.1 101 /);
  assert.match(busy.head, /^HTTP\/1.1 503 /);
  assert.equal(timers.length, 4);
  assert.ok(timers.every((timer) => timer.delay === ADMISSION_HOLD_MS));
  const closed = once(first.socket, 'close');
  timers[1].fn();
  await closed;
  await new Promise((resolve) => setImmediate(resolve));
  assert.match((await rawUpgrade(h.port, '/session')).head, /^HTTP\/1.1 101 /);
  second.socket.destroy();
});

async function until(predicate) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Synthetic transport did not reach the expected byte count');
}

stagedTest(
  'public extension routes use fresh strict nonces and operator-pinned plugin destinations',
  async (t) => {
    const h = await fixture(t);
    const first = await get(h.port, '/extension-check/');
    const second = await get(h.port, '/extension-check/');
    const nonce = first.headers['content-security-policy'].match(/script-src 'nonce-([^']+)'/)[1];
    const another = second.headers['content-security-policy'].match(
      /script-src 'nonce-([^']+)'/,
    )[1];
    assert.notEqual(nonce, another);
    assert.ok(first.body.toString().includes(`nonce="${nonce}"`));
    assert.doesNotMatch(first.body.toString(), /__TLSN_SCRIPT_NONCE__/);
    assert.doesNotMatch(
      first.headers['content-security-policy'],
      /script-src[^;]*(wasm-unsafe-eval|unsafe-eval|'self')/,
    );
    assert.equal(first.headers['cross-origin-embedder-policy'], undefined);
    const plugin = await get(h.port, '/extension-check/plugin.mjs', {
      headers: { Host: 'untrusted.invalid' },
    });
    assert.equal(plugin.status, 200);
    assert.ok(plugin.body.toString().includes(JSON.stringify(TARGETS[0].origin)));
    assert.match(plugin.body.toString(), /https:\/\/app\.revolut\.com\/robots\.txt/);
    assert.doesNotMatch(plugin.body.toString(), /untrusted\.invalid/);
    assert.equal((await get(h.port, '/extension-check/window')).status, 200);
    assert.equal((await get(h.port, '/plugin.mjs')).status, 404);
    assert.equal(h.calls.length, 0);
  },
);

test('extension origin additions reject wildcard, malformed or unbounded operator configuration before reads', async () => {
  let reads = 0;
  for (const extraExtensionOrigins of [
    '*',
    ['null'],
    ['chrome-extension://*'],
    ['https://evil.invalid'],
    ['chrome-extension://' + 'a'.repeat(32) + '/'],
    Array(5).fill(DEFAULT_EXTENSION_ORIGIN),
    [DEFAULT_EXTENSION_ORIGIN, DEFAULT_EXTENSION_ORIGIN],
  ]) {
    await assert.rejects(
      createBenchmarkGateway({
        publicOrigin: TARGETS[0].origin,
        targets: TARGETS,
        extraExtensionOrigins,
        readFileImpl: async () => {
          reads++;
          return Buffer.alloc(0);
        },
      }),
      /INVALID_EXTENSION_ORIGINS/,
    );
  }
  assert.equal(reads, 0);
});

stagedTest(
  'official and explicitly approved extension origins work while other extension IDs fail closed',
  async (t) => {
    const other = 'chrome-extension://' + 'a'.repeat(32);
    const h = await fixture(t);
    assert.match((await rawUpgrade(h.port, '/session', { origin: other })).head, /^HTTP\/1.1 403 /);
    assert.equal(h.calls.length, 0);
    assert.match(
      (await rawUpgrade(h.port, '/session', { origin: DEFAULT_EXTENSION_ORIGIN })).head,
      /^HTTP\/1.1 101 /,
    );
    assert.equal(h.calls[0].headers.origin, DEFAULT_EXTENSION_ORIGIN);
    const approved = await fixture(t, { gatewayOptions: { extraExtensionOrigins: [other] } });
    assert.match(
      (await rawUpgrade(approved.port, '/session', { origin: other })).head,
      /^HTTP\/1.1 101 /,
    );
  },
);

stagedTest(
  'session, verifier and proxy start pools are independent, retained and cleared on shutdown',
  async (t) => {
    const timers = [];
    const h = await fixture(t, {
      gatewayOptions: {
        setTimeoutImpl(fn, delay) {
          const timer = { fn, delay, cleared: false, unref() {} };
          timers.push(timer);
          return timer;
        },
        clearTimeoutImpl(timer) {
          if (timer) timer.cleared = true;
        },
      },
    });
    const routes = ['/session', '/verifier?sessionId=' + ID, '/proxy?token=app.revolut.com'];
    for (const route of routes) {
      for (let count = 0; count < 2; count++)
        assert.match((await rawUpgrade(h.port, route)).head, /^HTTP\/1.1 101 /);
      assert.match((await rawUpgrade(h.port, route)).head, /^HTTP\/1.1 503 /);
    }
    await until(() => timers.filter((timer) => !timer.cleared).length === 6);
    const retained = timers.filter((timer) => !timer.cleared);
    retained[0].fn();
    retained[1].fn();
    assert.match((await rawUpgrade(h.port, '/session')).head, /^HTTP\/1.1 101 /);
    assert.match((await rawUpgrade(h.port, '/verifier?sessionId=' + ID)).head, /^HTTP\/1.1 503 /);
    assert.match(
      (await rawUpgrade(h.port, '/proxy?token=app.revolut.com')).head,
      /^HTTP\/1.1 503 /,
    );
    await h.gateway.close();
    assert.ok(timers.every((timer) => timer.cleared || retained.slice(0, 2).includes(timer)));
  },
);

stagedTest(
  'fixed proxy upload cap includes initial upgrade-head data and never forwards the overflow byte',
  async (t) => {
    const h = await fixture(t, { echo: false });
    const upgrade = await rawUpgrade(h.port, '/proxy?token=app.revolut.com', {
      keep: true,
      origin: DEFAULT_EXTENSION_ORIGIN,
      body: Buffer.alloc(PROXY_BYTES_PER_DIRECTION),
    });
    assert.match(upgrade.head, /^HTTP\/1.1 101 /);
    await until(
      () => h.calls.find((row) => row.kind === 'ws')?.receivedBytes === PROXY_BYTES_PER_DIRECTION,
    );
    const closed = new Promise((resolve) => upgrade.socket.once('close', resolve));
    upgrade.socket.write(Buffer.from('x'));
    await closed;
    assert.equal(h.calls.find((row) => row.kind === 'ws').receivedBytes, PROXY_BYTES_PER_DIRECTION);
  },
);

stagedTest(
  'fixed proxy download cap includes upstream upgrade-head data and drops its overflow byte',
  async (t) => {
    const h = await fixture(t, {
      echo: false,
      initialReply: Buffer.alloc(PROXY_BYTES_PER_DIRECTION),
    });
    const upgrade = await rawUpgrade(h.port, '/proxy?token=app.revolut.com', { keep: true });
    let received = upgrade.rest.length;
    upgrade.socket.on('data', (data) => {
      received += data.length;
    });
    await until(() => received === PROXY_BYTES_PER_DIRECTION);
    const closed = new Promise((resolve) => upgrade.socket.once('close', resolve));
    [...h.peers][0].write(Buffer.from('x'));
    await closed;
    assert.equal(received, PROXY_BYTES_PER_DIRECTION);
  },
);

stagedTest('the proxy byte cap does not constrain the larger MPC verifier transport', async (t) => {
  const h = await fixture(t, { echo: false });
  const size = PROXY_BYTES_PER_DIRECTION + 1;
  const upgrade = await rawUpgrade(h.port, '/verifier?sessionId=' + ID, {
    keep: true,
    body: Buffer.alloc(size),
  });
  assert.match(upgrade.head, /^HTTP\/1.1 101 /);
  await until(() => h.calls.find((row) => row.kind === 'ws')?.receivedBytes === size);
  assert.equal(upgrade.socket.destroyed, false);
  upgrade.socket.destroy();
});

stagedTest(
  'response-check serves only consent-gated HTML and a nonce-protected shape-only plugin pinned to this verifier',
  async (t) => {
    const h = await fixture(t);
    const page = await get(h.port, '/response-check/', { headers: { Host: 'untrusted.invalid' } });
    assert.equal(page.status, 200);
    assert.match(page.body.toString(), /id="consent" type="checkbox"/);
    const nonce = page.headers['content-security-policy'].match(/script-src 'nonce-([^']+)'/)[1];
    assert.ok(page.body.toString().includes(`nonce="${nonce}"`));
    assert.doesNotMatch(page.headers['content-security-policy'], /wasm-unsafe-eval|unsafe-eval/);
    assert.doesNotMatch(
      page.body.toString(),
      /untrusted\.invalid|__TLSN_PUBLIC_ORIGIN__|__TLSN_SCRIPT_NONCE__/,
    );
    assert.ok(page.body.toString().includes(TARGETS[0].origin));
    const plugin = await get(h.port, '/response-check/plugin.mjs', {
      headers: { Host: 'untrusted.invalid' },
    });
    assert.equal(plugin.status, 200);
    assert.match(plugin.body.toString(), /const RESPONSE_SHAPE_ONLY = true;/);
    assert.ok(
      plugin.body
        .toString()
        .includes(`const VERIFIER_ORIGIN = ${JSON.stringify(TARGETS[0].origin)};`),
    );
    for (const path of [
      '/response-check/window',
      '/response-check/?mode=payment-fields',
      '/response-check/plugin.mjs?mode=payment-fields',
      '/revolut.plugin.mjs',
      '/plugin.mjs',
    ])
      assert.equal((await get(h.port, path)).status, 404);
    assert.equal((await get(h.port, '/response-check/', { method: 'POST' })).status, 404);
    assert.equal(h.calls.length, 0);
  },
);
