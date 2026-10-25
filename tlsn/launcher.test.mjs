import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  createLauncherServer,
  makeGatewayResponseHeaders,
  checkUpload,
  CONNECTION_CHECK_BYTES,
} from './launcher.mjs';

const PUBLIC_ORIGIN = 'https://proof.example.test:9492';

function mockResponse() {
  const completion = Promise.withResolvers();
  return {
    completed: completion.promise,
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
      this.writableEnded = true;
      completion.resolve();
    },
    destroy() {
      this.destroyed = true;
      completion.resolve();
    },
  };
}

async function dispatch(server, request) {
  const response = mockResponse();
  server.emit('request', { headers: {}, ...request }, response);
  let timeout;
  try {
    await Promise.race([
      response.completed,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Mock response did not finish')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  return response;
}

function fakeRequest(upstreamRequests, responseData) {
  return (options, callback) => {
    upstreamRequests.push(options);
    const outgoing = new EventEmitter();
    outgoing.end = () => {
      if (!callback) return;
      const response = new EventEmitter();
      response.statusCode = responseData.statusCode ?? 200;
      response.headers = responseData.headers ?? { 'content-type': 'text/plain' };
      setImmediate(() => {
        callback(response);
        response.emit('data', Buffer.from(responseData.body));
        response.emit('end');
      });
    };
    return outgoing;
  };
}

function fixture(options = {}) {
  const upstreamRequests = [];
  const launcher = createLauncherServer({
    publicOrigin: PUBLIC_ORIGIN,
    upstreamPort: 17847,
    requestImpl: fakeRequest(upstreamRequests, { body: 'ok' }),
    ...options,
  });
  return { launcher, upstreamRequests };
}

test('serves the launcher with a strict loopback-only CSP and configured origin', async () => {
  const { launcher } = fixture();
  const response = await dispatch(launcher.server, { method: 'GET', url: '/' });
  const body = String(response.body);
  assert.equal(response.statusCode, 200);
  assert.match(body, /https:\/\/proof\.example\.test:9492/);
  assert.match(response.headers['Content-Security-Policy'], /default-src 'self'/);
  assert.match(response.headers['Content-Security-Policy'], /script-src 'nonce-/);
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.doesNotMatch(body, /__TLSN_SCRIPT_NONCE__|__TLSN_PUBLIC_ORIGIN__/);
  assert.doesNotMatch(response.headers['Content-Security-Policy'], /wasm-unsafe-eval/);
});

test('WASM capability and isolation headers are scoped to the bank-free setup page', async () => {
  const { launcher } = fixture();
  const response = await dispatch(launcher.server, { method: 'GET', url: '/setup-check/' });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['Content-Security-Policy'], /wasm-unsafe-eval/);
  assert.match(response.headers['Content-Security-Policy'], /worker-src 'self'/);
  assert.equal(response.headers['Cross-Origin-Embedder-Policy'], 'require-corp');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.doesNotMatch(String(response.body), /__TLSN_SCRIPT_NONCE__/);
});

test('public extension diagnostic pins all destinations and keeps the launcher CSP', async () => {
  const { launcher } = fixture();
  const page = await dispatch(launcher.server, { method: 'GET', url: '/extension-check/' });
  assert.equal(page.statusCode, 200);
  assert.doesNotMatch(page.headers['Content-Security-Policy'], /wasm-unsafe-eval/);
  const response = await dispatch(launcher.server, {
    method: 'GET',
    url: '/extension-check/plugin.mjs',
    headers: { host: 'untrusted.example' },
  });
  assert.equal(response.statusCode, 200);
  const source = String(response.body);
  assert.match(source, /const VERIFIER_ORIGIN = "https:\/\/proof\.example\.test:9492";/);
  assert.match(
    source,
    /const WINDOW_URL = "https:\/\/proof\.example\.test:9492\/extension-check\/window";/,
  );
  assert.doesNotMatch(source, /untrusted\.example/);
  const invalid = await dispatch(launcher.server, {
    method: 'GET',
    url: '/extension-check/plugin.mjs?path=../../.private/file',
  });
  assert.equal(invalid.statusCode, 404);
});

test('injects only the configured fixed verifier and proxy into the fixed plugin', async () => {
  const { launcher } = fixture();
  const response = await dispatch(launcher.server, { method: 'GET', url: '/plugin.mjs' });
  const source = String(response.body);
  assert.equal(response.statusCode, 200);
  assert.match(source, /const VERIFIER_ORIGIN = "https:\/\/proof\.example\.test:9492";/);
  assert.match(
    source,
    /const PROXY_URL = "wss:\/\/proof\.example\.test:9492\/proxy\?token=app\.revolut\.com";/,
  );
  assert.equal((source.match(/const VERIFIER_ORIGIN =/g) ?? []).length, 1);
  assert.equal((source.match(/const PROXY_URL =/g) ?? []).length, 1);
  assert.doesNotMatch(source, /__TLSN_PUBLIC_ORIGIN__/);
});

test('proxies only GET health and info without forwarding the caller Host header', async () => {
  const upstreamRequests = [];
  const launcher = createLauncherServer({
    publicOrigin: PUBLIC_ORIGIN,
    upstreamPort: 17847,
    requestImpl: (options, callback) => {
      upstreamRequests.push(options);
      const outgoing = new EventEmitter();
      outgoing.end = () => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers =
          options.path === '/info'
            ? { 'content-type': 'application/json; charset=utf-8' }
            : { 'content-type': 'text/plain' };
        setImmediate(() => {
          callback(response);
          response.emit(
            'data',
            Buffer.from(options.path === '/info' ? '{"version":"test"}' : 'ok'),
          );
          response.emit('end');
        });
      };
      return outgoing;
    },
  });
  const health = await dispatch(launcher.server, {
    method: 'GET',
    url: '/health',
    headers: { host: 'attacker.invalid' },
  });
  const info = await dispatch(launcher.server, { method: 'GET', url: '/info' });
  assert.equal(String(health.body), 'ok');
  assert.deepEqual(JSON.parse(info.body), { version: 'test' });
  assert.deepEqual(
    upstreamRequests.map(({ method, path }) => [method, path]),
    [
      ['GET', '/health'],
      ['GET', '/info'],
    ],
  );
  assert.ok(
    upstreamRequests.every(
      ({ hostname, port, headers }) => hostname === '127.0.0.1' && port === 17847 && !headers,
    ),
  );
});

test('rejects unsupported routes, methods, and query strings without upstream access', async () => {
  const { launcher, upstreamRequests } = fixture();
  for (const url of [
    '/webhook',
    '/session',
    '/health?url=http://127.0.0.1/',
    '/info?extra=1',
    '/plugin.mjs?path=../../README.md',
  ]) {
    const response = await dispatch(launcher.server, { method: 'GET', url });
    assert.equal(response.statusCode, 404, url);
  }
  const post = await dispatch(launcher.server, { method: 'POST', url: '/health' });
  assert.equal(post.statusCode, 405);
  assert.deepEqual(upstreamRequests, []);
});

test('validates the required HTTPS public origin before constructing a server', () => {
  for (const publicOrigin of [
    '',
    'http://proof.example.test',
    'https://proof.example.test/path',
    'https://proof.example.test?x=1',
    'https://user:pass@proof.example.test',
  ]) {
    assert.throws(() => createLauncherServer({ publicOrigin }), /TLSN_PUBLIC_ORIGIN/);
  }
});

test('allows only exact WebSocket paths and required parameters', () => {
  const { launcher } = fixture();
  const allowed = [
    '/session',
    '/verifier?sessionId=123e4567-e89b-12d3-a456-426614174000',
    '/proxy?token=app.revolut.com',
  ];
  for (const url of allowed) assert.equal(launcher.validateUpgradePath(url), true, url);
  const rejected = [
    '/session?target=example.com',
    '/verifier',
    '/verifier?sessionId=not-a-uuid',
    '/verifier?sessionId=123e4567-e89b-12d3-a456-426614174000&target=example.com',
    '/proxy',
    '/proxy?token=127.0.0.1',
    '/proxy?token=example.com',
    '/proxy?token=app.revolut.com&sessionId=123e4567-e89b-12d3-a456-426614174000',
  ];
  for (const url of rejected) assert.equal(launcher.validateUpgradePath(url), false, url);
});

test('security headers are generated without reflecting request input', () => {
  const { nonce, headers } = makeGatewayResponseHeaders(PUBLIC_ORIGIN);
  assert.ok(nonce.length > 16);
  assert.ok(headers['Content-Security-Policy'].includes(`script-src 'nonce-${nonce}'`));
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(headers['Content-Type'], 'text/html; charset=utf-8');
});

test('launcher shows only fixed failure codes and recovery text from an error callback', async () => {
  const html = await readFile(new URL('./launcher.html', import.meta.url), 'utf8');
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const elements = new Map(
    [
      '#extension',
      '#verifier',
      '#result',
      '#run',
      '#source',
      '#connection-check',
      '#connection-result',
    ].map((key) => [key, { textContent: '', dataset: {}, addEventListener() {} }]),
  );
  const context = {
    document: {
      querySelector: (key) =>
        key.startsWith('meta') ? { content: PUBLIC_ORIGIN } : elements.get(key),
    },
    window: { tlsn: { version: '0.1.0.1501', execCode() {} }, addEventListener() {} },
    fetch: () => new Promise(() => {}),
    AbortSignal,
  };
  vm.runInNewContext(script, context);
  context.renderResult({
    diagnosticOnly: true,
    mode: 'attempt-error',
    errorCode: 'MPC_SETUP_TIMEOUT',
    message: 'synthetic-private-cookie-and-bank-url',
  });
  const result = elements.get('#result');
  assert.match(result.textContent, /MPC_SETUP_TIMEOUT.*Check connection only/);
  assert.match(result.textContent, /Payment remains unverified\. Nothing has been released\./);
  assert.equal(result.dataset.state, 'error');
  assert.doesNotMatch(result.textContent, /synthetic-private/);
  context.renderResult({
    diagnosticOnly: true,
    mode: 'attempt-error',
    errorCode: 'synthetic-private-error',
  });
  assert.match(result.textContent, /^PROOF_FAILED:/);
  assert.doesNotMatch(result.textContent, /synthetic-private/);
});

test('synthetic upload is origin-bound, size-bound and never reflected', async () => {
  const makeRequest = (headers = {}) =>
    Object.assign(new EventEmitter(), {
      headers: {
        origin: PUBLIC_ORIGIN,
        'content-type': 'application/octet-stream',
        'content-length': String(CONNECTION_CHECK_BYTES),
        ...headers,
      },
    });
  for (const headers of [
    { origin: 'https://other.example' },
    { 'content-length': '999999999' },
    { 'content-type': 'application/json' },
  ]) {
    const response = mockResponse();
    await checkUpload(makeRequest(headers), response, PUBLIC_ORIGIN);
    assert.ok([400, 403].includes(response.statusCode));
  }
  const request = makeRequest();
  const response = mockResponse();
  const task = checkUpload(request, response, PUBLIC_ORIGIN);
  request.emit('data', Buffer.alloc(CONNECTION_CHECK_BYTES, 'synthetic-private-value'));
  request.emit('end');
  await task;
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { receivedBytes: CONNECTION_CHECK_BYTES });
  assert.doesNotMatch(response.body, /synthetic-private/);
  const truncated = makeRequest();
  const incompleteResponse = mockResponse();
  const incomplete = checkUpload(truncated, incompleteResponse, PUBLIC_ORIGIN);
  truncated.emit('data', Buffer.from('synthetic'));
  truncated.emit('end');
  await incomplete;
  assert.equal(incompleteResponse.statusCode, 400);
});
