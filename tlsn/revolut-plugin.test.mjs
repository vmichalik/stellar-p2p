import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('./revolut.plugin.mjs', import.meta.url), 'utf8');
const detail = {
  method: 'GET',
  url: 'https://app.revolut.com/api/retail/transaction/00000000-0000-4000-8000-000000000001',
  timestamp: 1,
  requestHeaders: [
    { name: 'Cookie', value: 'synthetic-cookie' },
    { name: 'X-Unrelated', value: 'must-not-forward' },
  ],
};

async function harness({
  configured = false,
  headers = [],
  fail = false,
  failureMessage = 'private URL or credentials must not escape',
  missing = false,
  shapeStatus = 200,
  shapeBody = {
    amount: -123,
    currency: 'EUR',
    recipient: { code: 'synthetic-private-person' },
    unapprovedField: 'synthetic-private-value',
  },
  shapeContentType = 'application/json',
} = {}) {
  const state = new Map();
  const calls = { prove: [], done: [] };
  globalThis.useState = (key, fallback) => (state.has(key) ? state.get(key) : fallback);
  globalThis.setState = (key, value) => state.set(key, value);
  globalThis.useHeaders = (filter) => filter(headers);
  globalThis.useEffect = (fn) => fn();
  globalThis.openWindow = () => {};
  globalThis.div = (options, children) => ({ options, children });
  globalThis.button = (options, children) => ({ options, children });
  globalThis.prove = async (...args) => {
    calls.prove.push(args);
    if (fail) throw new Error(failureMessage);
    if (args[1].handlers.some((row) => row.part === 'STATUS_CODE')) {
      const body = typeof shapeBody === 'string' ? shapeBody : JSON.stringify(shapeBody);
      // This mock tests plugin selection/sanitization, not the shipped HTTP parser.
      // Keep the fixture framed; response-parser.test.mjs exercises the actual WASM boundary.
      const response = `HTTP/1.1 ${shapeStatus} Test\r\ncontent-type: ${shapeContentType}\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
      const results = [];
      for (const row of args[1].handlers) {
        const base = { type: row.type, part: row.part, action: { kind: 'REVEAL' } };
        if (row.type === 'SENT')
          results.push({ ...base, value: 'GET /synthetic-private-id HTTP/1.1' });
        else if (row.part === 'STATUS_CODE') results.push({ ...base, value: String(shapeStatus) });
        else if (row.part === 'HEADERS')
          results.push({ ...base, value: `content-type: ${shapeContentType}` });
        else if (row.part === 'ALL') {
          for (const match of response.matchAll(new RegExp(row.params.regex, 'g')))
            results.push({ ...base, value: match[0] });
        }
      }
      return { results };
    }
    return {
      results: args[1].handlers
        .filter((h) => h.part === 'BODY')
        .slice(missing ? 1 : 0)
        .map((h) => ({
          type: h.type,
          part: h.part,
          action: { kind: 'REVEAL' },
          value: JSON.stringify(h.params.path.split('.').pop()) + ':"synthetic-value"',
        })),
    };
  };
  globalThis.done = async (value) => {
    calls.done.push(JSON.parse(value));
  };
  const code = configured
    ? source
        .replace(
          "const VERIFIER_ORIGIN = '';",
          "const VERIFIER_ORIGIN = 'https://reviewed.example';",
        )
        .replace(
          "const PROXY_URL = '';",
          "const PROXY_URL = 'wss://reviewed.example/proxy?token=app.revolut.com';",
        )
    : source;
  const plugin = (
    await import(
      'data:text/javascript;base64,' + Buffer.from(code).toString('base64') + '#' + Math.random()
    )
  ).default;
  return { plugin, state, calls };
}

test('no automatic proof on login or detail capture', async () => {
  const h = await harness({ configured: true, headers: [detail] });
  h.plugin.main();
  assert.equal(h.state.get('selected').url, detail.url);
  assert.equal(h.calls.prove.length, 0);
});

test('reject dashboard/list, writes, misleading hosts and URL suffixes', async () => {
  const invalid = [
    {
      ...detail,
      url: 'https://app.revolut.com/api/retail/user/current/transactions/last?count=20',
    },
    { ...detail, method: 'POST' },
    { ...detail, url: detail.url.replace('app.revolut.com', 'app.revolut.com.evil.example') },
    { ...detail, url: detail.url.replace('https://', 'https://untrusted@') },
    { ...detail, url: detail.url + '?extra=1' },
    { ...detail, url: detail.url + '/other' },
  ];
  for (const row of invalid) {
    const h = await harness({ configured: true, headers: [row] });
    h.plugin.main();
    await h.plugin.generateProof();
    assert.equal(h.calls.prove.length, 0);
  }
});

test('unconfigured verifier cannot receive even a synthetic request', async () => {
  const h = await harness({ headers: [detail] });
  h.plugin.main();
  await h.plugin.generateProof();
  assert.equal(h.calls.prove.length, 0);
  assert.match(h.state.get('message'), /Configure/);
});

test('explicit click uses latest detail and limits headers/disclosures/callback', async () => {
  const latest = { ...detail, timestamp: 2, url: detail.url.replace(/1$/, '2') };
  const h = await harness({ configured: true, headers: [detail, latest] });
  h.plugin.main();
  await h.plugin.generateProof();
  assert.equal(h.calls.prove.length, 1);
  const [request, options] = h.calls.prove[0];
  assert.equal(request.url, latest.url);
  assert.equal(request.headers.cookie, 'synthetic-cookie');
  assert.equal(request.headers['x-unrelated'], undefined);
  assert.equal(options.maxSentData, 4096);
  assert.equal(options.maxRecvData, 16384);
  assert.equal(
    options.handlers.some((row) => row.type === 'SENT' && row.part === 'HEADERS'),
    false,
  );
  assert.equal(h.calls.done[0].releaseGate, 'NOT_CLEARED');
  assert.doesNotMatch(JSON.stringify(h.calls.done[0]), /synthetic-value|synthetic-cookie|00000000/);
});

test('missing required field prevents successful callback', async () => {
  const h = await harness({ configured: true, headers: [detail], missing: true });
  h.plugin.main();
  await h.plugin.generateProof();
  assert.equal(h.calls.done.length, 0);
  assert.match(h.state.get('message'), /missing/);
});

test('failures do not propagate private error text', async () => {
  const h = await harness({ configured: true, headers: [detail], fail: true });
  h.plugin.main();
  await h.plugin.generateProof();
  assert.equal(h.state.get('pending'), false);
  assert.equal(h.calls.done.length, 1);
  assert.equal(h.calls.done[0].mode, 'attempt-error');
  assert.equal(h.calls.done[0].errorCode, 'PROOF_FAILED');
  assert.equal(h.calls.done[0].releaseGate, 'NOT_CLEARED');
  assert.doesNotMatch(JSON.stringify(h.calls.done[0]), /private URL|credentials/);
  assert.doesNotMatch(h.state.get('message'), /private URL|credentials/);
});

test('setup timeout is a fixed diagnostic code without private exception details', async () => {
  for (const limit of [30000, 60000]) {
    const h = await harness({
      configured: true,
      headers: [detail],
      fail: true,
      failureMessage: `setupProver timed out after ${limit}ms for prover-3 private-synthetic-secret https://private.example`,
    });
    h.plugin.main();
    await h.plugin.checkResponse();
    assert.equal(h.calls.done[0].errorCode, 'MPC_SETUP_TIMEOUT');
    assert.equal(h.calls.done[0].releaseGate, 'NOT_CLEARED');
    assert.doesNotMatch(
      JSON.stringify(h.calls.done[0]),
      /private-synthetic|private.example|prover-3/,
    );
    assert.doesNotMatch(h.state.get('message'), /private-synthetic|private.example|prover-3/);
  }
});

test('oversized authentication request stops before MPC without leaking its values', async () => {
  const large = {
    ...detail,
    requestHeaders: [{ name: 'Cookie', value: 'synthetic-private-cookie-' + 'x'.repeat(4096) }],
  };
  const h = await harness({ configured: true, headers: [large] });
  h.plugin.main();
  await h.plugin.generateProof();
  assert.equal(h.calls.prove.length, 0);
  assert.match(h.state.get('message'), /REQUEST_TOO_LARGE/);
  assert.doesNotMatch(h.state.get('message'), /synthetic-private-cookie/);
});

test('response diagnostic identifies object shape and allowlisted names without values', async () => {
  const h = await harness({ configured: true, headers: [detail] });
  h.plugin.main();
  assert.equal(h.calls.prove.length, 0);
  await h.plugin.checkResponse();
  const summary = h.calls.done[0];
  assert.equal(summary.httpStatus, 200);
  assert.equal(summary.rootType, 'object');
  assert.equal(summary.contentType, 'json');
  assert.deepEqual(summary.fieldNames, ['amount', 'currency', 'recipient', 'code']);
  assert.equal(summary.releaseGate, 'NOT_CLEARED');
  assert.equal(
    h.calls.prove[0][1].handlers.some((row) => row.part === 'BODY'),
    false,
  );
  assert.doesNotMatch(JSON.stringify(summary), /synthetic-private|unapprovedField|EUR|-123/);
});

test('response diagnostic reports authentication failure without mistaking it for payment', async () => {
  const h = await harness({
    configured: true,
    headers: [detail],
    shapeStatus: 401,
    shapeBody: {
      error: 'synthetic-private-error',
      message: 'synthetic-private-message',
      code: 'synthetic-private-code',
    },
  });
  h.plugin.main();
  await h.plugin.checkResponse();
  const summary = h.calls.done[0];
  assert.equal(summary.httpStatus, 401);
  assert.equal(summary.mode, 'response-shape');
  assert.equal(summary.releaseGate, 'NOT_CLEARED');
  assert.deepEqual(summary.fieldNames, ['error', 'message', 'code']);
  assert.doesNotMatch(JSON.stringify(summary), /synthetic-private/);
});

test('response diagnostic distinguishes an array from an HTML error page', async () => {
  const array = await harness({
    configured: true,
    headers: [detail],
    shapeBody: [{ amount: -123 }],
  });
  array.plugin.main();
  await array.plugin.checkResponse();
  assert.equal(array.calls.done[0].rootType, 'array');
  const html = await harness({
    configured: true,
    headers: [detail],
    shapeStatus: 403,
    shapeContentType: 'text/html',
    shapeBody: '<html>synthetic-private-text</html>',
  });
  html.plugin.main();
  await html.plugin.checkResponse();
  assert.equal(html.calls.done[0].rootType, 'unknown');
  assert.equal(html.calls.done[0].contentType, 'html');
  assert.equal(html.calls.done[0].httpStatus, 403);
  assert.deepEqual(html.calls.done[0].fieldNames, []);
});
