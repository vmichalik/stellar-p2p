// Offline parser integration only: synthetic transcripts, released WASM, no MPC or bank request.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { readResponseRoute } from './response-check.mjs';
import { readPaymentRoute } from './payment-check.mjs';

const ROOT = new URL('../.private/benchmark-stage/benchmark/', import.meta.url);
const HASHES = {
  'tlsn_wasm.js': '523711ce5c7f1d5206bc05250153e74f3063ed7e420d0a0953ca24b4ea39dc4f',
  'tlsn_wasm_bg.wasm': 'bb3c73628f088867a1f99291275b56a379ce44fd239efca9445fb5908a97e318',
  'snippets/web-spawn-05868593a72e2d44/js/spawn.js':
    'ef1d4a01ff707f368a03e3dd5d991af8c191d2dc607abb1f3a672f16a5ceb14a',
};
const prepared = await access(new URL('tlsn_wasm_bg.wasm', ROOT)).then(
  () => true,
  () => false,
);
const parserTest = (name, fn) =>
  test(
    name,
    {
      skip: prepared
        ? false
        : 'Prepare the ignored benchmark stage to exercise the shipped parser.',
    },
    fn,
  );
let runtime;
if (prepared) {
  const assets = {};
  for (const [name, expected] of Object.entries(HASHES)) {
    assets[name] = await readFile(new URL(name, ROOT));
    assert.equal(createHash('sha256').update(assets[name]).digest('hex'), expected);
  }
  // The released worker bootstrap registers message listeners on import. No worker is started.
  globalThis.self = new EventTarget();
  runtime = await import(new URL('tlsn_wasm.js', ROOT));
  runtime.initSync({ module: assets['tlsn_wasm_bg.wasm'] });
}

const sent = Buffer.from('GET /synthetic HTTP/1.1\r\nHost: fixture.example.test\r\n\r\n');
const statusOnly = [{ type: 'RECV', part: 'STATUS_CODE', action: { kind: 'REVEAL' } }];
const body = Buffer.from(
  '{"amount":-123,"currency":"EUR","recipient":{"code":"synthetic-private"}}',
);

function response(bytes, { framing = 'length', encoding, type = 'application/json' } = {}) {
  const headers = [
    'HTTP/1.1 200 Test',
    `content-type: ${type}`,
    'date: Sun, 25 Oct 2026 12:00:00 GMT',
  ];
  if (encoding) headers.push(`content-encoding: ${encoding}`);
  if (framing === 'length') headers.push(`content-length: ${bytes.length}`);
  if (framing === 'chunked') headers.push('transfer-encoding: chunked');
  const head = Buffer.from(headers.join('\r\n') + '\r\n\r\n');
  return framing === 'chunked'
    ? Buffer.concat([
        head,
        Buffer.from(bytes.length.toString(16) + '\r\n'),
        bytes,
        Buffer.from('\r\n0\r\n\r\n'),
      ])
    : Buffer.concat([head, bytes]);
}

async function shapeHandlers(payment = false) {
  const source = String(
    (
      await (payment
        ? readPaymentRoute('/payment-check/plugin.mjs', 'https://fixture.example.test')
        : readResponseRoute('/response-check/plugin.mjs', 'https://fixture.example.test'))
    ).body,
  );
  const state = new Map([
    [
      'selected',
      {
        method: 'GET',
        url: 'https://app.revolut.com/api/retail/transaction/00000000-0000-4000-8000-000000000001',
        requestHeaders: [{ name: 'Cookie', value: 'synthetic-cookie' }],
      },
    ],
  ]);
  let handlers;
  globalThis.useState = (key, fallback) => (state.has(key) ? state.get(key) : fallback);
  globalThis.setState = (key, value) => state.set(key, value);
  // Capture the actual plugin's configuration. Parsing below uses released compute_reveal.
  globalThis.prove = async (_request, options) => {
    handlers = options.handlers.map((handler) => ({
      ...handler,
      // The pinned SDK canonicalizes its string action to the tagged WASM enum.
      action: { kind: handler.action },
    }));
    return { results: [] };
  };
  globalThis.done = async () => {};
  const plugin = (
    await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  ).default;
  if (payment) await plugin.generateProof();
  else await plugin.checkResponse();
  return handlers;
}

parserTest(
  'released parser rejects an unframed response body even for status-only disclosure',
  () => {
    assert.throws(
      () => runtime.compute_reveal(sent, response(body, { framing: 'none' }), statusOnly),
      /must contain either a Content-Length or Transfer-Encoding header/,
    );
  },
);

parserTest('released parser accepts correctly framed identity and chunked responses', () => {
  for (const framing of ['length', 'chunked']) {
    const recv = response(body, { framing });
    const result = runtime.compute_reveal(sent, recv, statusOnly);
    assert.equal(result.recv_ranges_with_handlers.length, 1);
    const { start, end } = result.recv_ranges_with_handlers[0];
    assert.equal(recv.subarray(start, end).toString(), '200');
  }
});

parserTest('released parser rejects a gzip body even when only HTTP status is requested', () => {
  const recv = response(gzipSync(body), { encoding: 'gzip' });
  assert.throws(
    () => runtime.compute_reveal(sent, recv, statusOnly),
    /failed to parse HTTP response.*invalid utf-8/,
  );
});

parserTest(
  'actual response-shape handlers reveal structure without values through the released parser',
  async () => {
    const handlers = await shapeHandlers();
    for (const [bytes, framing, root] of [
      [body, 'length', '{'],
      [Buffer.concat([Buffer.from('['), body, Buffer.from(']')]), 'chunked', '['],
    ]) {
      const recv = response(bytes, { framing });
      const result = runtime.compute_reveal(sent, recv, handlers);
      const disclosed = result.recv_ranges_with_handlers.map(({ start, end }) =>
        recv.subarray(start, end).toString(),
      );
      assert.ok(disclosed.includes('200'));
      assert.ok(disclosed.some((value) => value.trim().endsWith(root)));
      assert.ok(disclosed.includes('"amount":'));
      assert.ok(disclosed.includes('"code":'));
      assert.doesNotMatch(disclosed.join('\n'), /-123|EUR|synthetic-private/);
    }
  },
);

parserTest(
  'actual shape handlers also reject unsupported framing and gzip before any disclosure',
  async () => {
    const handlers = await shapeHandlers();
    for (const recv of [
      response(body, { framing: 'none' }),
      response(gzipSync(body), { encoding: 'gzip' }),
    ])
      assert.throws(
        () => runtime.compute_reveal(sent, recv, handlers),
        /failed to parse HTTP response/,
      );
  },
);

parserTest(
  'actual payment selectors reveal seven synthetic values with the shipped parser',
  async () => {
    const handlers = await shapeHandlers(true);
    const record = {
      amount: -123,
      currency: 'EUR',
      recipient: { code: 'synthetic-recipient', hidden: 'not-selected' },
      id: 'synthetic-payment',
      state: 'COMPLETED',
      completedDate: 1792929600000,
      type: 'SYNTHETIC_TRANSFER',
      hidden: 'not-selected',
    };
    for (const framing of ['length', 'chunked']) {
      const recv = response(Buffer.from(JSON.stringify([record])), { framing });
      const result = runtime.compute_reveal(sent, recv, handlers);
      const disclosed = result.recv_ranges_with_handlers.map(({ start, end }) =>
        recv.subarray(start, end).toString(),
      );
      for (const field of ['amount', 'currency', 'id', 'state', 'completedDate', 'type'])
        assert.ok(
          disclosed.includes(JSON.stringify(field) + ':' + JSON.stringify(record[field])),
          field,
        );
      assert.ok(disclosed.includes('"code":"synthetic-recipient"'));
      assert.ok(disclosed.some((value) => value.startsWith('HTTP/1.1 200')));
      assert.doesNotMatch(disclosed.join('\n'), /not-selected/);
      assert.equal(result.sent_ranges_with_handlers.length, 1);
    }
    const missing = [{ ...record, recipient: {} }];
    assert.throws(
      () => runtime.compute_reveal(sent, response(Buffer.from(JSON.stringify(missing))), handlers),
      /JSON path '0.recipient.code' not found/,
    );
  },
);
