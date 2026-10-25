import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('./extension-check.plugin.mjs', import.meta.url), 'utf8');
const verifier = 'https://private-verifier.example';
const proxy = 'wss://private-verifier.example/proxy?token=app.revolut.com';
const windowUrl = 'https://private-verifier.example/extension-check/window';
const DEFAULT_PROVE_RESULT = Symbol('default prove result');

function findButton(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (node.kind === 'button' && node.options?.onclick === name) return node;
  for (const child of node.children || []) {
    const found = findButton(child, name);
    if (found) return found;
  }
  return null;
}

async function harness({
  configured = true,
  proveResult = DEFAULT_PROVE_RESULT,
  proveError,
  verifierOrigin = verifier,
  proxyUrl = proxy,
  configuredWindowUrl = windowUrl,
} = {}) {
  const state = new Map();
  const calls = { prove: [], done: [], openWindow: [] };
  globalThis.useState = (key, fallback) => (state.has(key) ? state.get(key) : fallback);
  globalThis.setState = (key, value) => state.set(key, value);
  globalThis.useEffect = (fn) => fn();
  globalThis.openWindow = (url) => calls.openWindow.push(url);
  globalThis.div = (options, children) => ({ kind: 'div', options, children });
  globalThis.button = (options, children) => ({ kind: 'button', options, children });
  globalThis.prove = async (...args) => {
    // Boundary contract of the pinned release's WASM Method enum.
    assert.ok(
      ['GET', 'POST', 'PUT', 'DELETE'].includes(args[0].method),
      'unsupported released-WASM HTTP method',
    );
    calls.prove.push(args);
    if (proveError) throw new Error(proveError);
    return proveResult === DEFAULT_PROVE_RESULT
      ? { results: [{ type: 'RECV', part: 'STATUS_CODE', value: '204' }] }
      : proveResult;
  };
  globalThis.done = async (json) => {
    calls.done.push({ value: JSON.parse(json), pendingAtCall: state.get('pending') });
  };

  let code = `const URL = undefined;\n${source}`;
  if (configured) {
    code = code
      .replace(
        "const VERIFIER_ORIGIN = '';",
        `const VERIFIER_ORIGIN = ${JSON.stringify(verifierOrigin)};`,
      )
      .replace("const PROXY_URL = '';", `const PROXY_URL = ${JSON.stringify(proxyUrl)};`)
      .replace(
        "const WINDOW_URL = '';",
        `const WINDOW_URL = ${JSON.stringify(configuredWindowUrl)};`,
      );
  }
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${Math.random()}`;
  const plugin = (await import(moduleUrl)).default;
  return { plugin, state, calls };
}

test('mount opens only the configured local window and never proves automatically', async () => {
  const h = await harness();
  const ui = h.plugin.main();
  assert.deepEqual(h.calls.openWindow, [windowUrl]);
  assert.equal(h.calls.prove.length, 0);
  assert.ok(findButton(ui, 'checkExtension'));
  assert.equal(h.plugin.config.urls[0], windowUrl);
  assert.deepEqual(h.plugin.config.requests, [
    {
      method: 'GET',
      host: 'app.revolut.com',
      pathname: '/robots.txt',
      verifierUrl: verifier,
    },
  ]);
});

test('missing verifier configuration fails closed before opening a window or proving', async () => {
  const h = await harness({ configured: false });
  const ui = h.plugin.main();
  assert.equal(h.calls.openWindow.length, 0);
  assert.equal(h.calls.prove.length, 0);
  assert.equal(findButton(ui, 'checkExtension'), null);
  await h.plugin.checkExtension();
  assert.equal(h.calls.prove.length, 0);
  assert.equal(h.calls.done.length, 0);
});

test('malicious or non-origin endpoint configuration fails closed without URL APIs', async () => {
  const invalidConfigurations = [
    { verifierOrigin: 'https://evil.example/path' },
    { verifierOrigin: 'https://evil.example?token=secret' },
    {
      verifierOrigin: 'https://evil.example',
      proxyUrl: 'wss://other.example/proxy?token=app.revolut.com',
    },
    {
      verifierOrigin: 'https://evil.example',
      configuredWindowUrl: 'https://other.example/extension-check/window',
    },
  ];
  for (const values of invalidConfigurations) {
    const h = await harness(values);
    const ui = h.plugin.main();
    assert.equal(h.calls.openWindow.length, 0);
    assert.equal(h.calls.prove.length, 0);
    assert.equal(findButton(ui, 'checkExtension'), null);
    await h.plugin.checkExtension();
    assert.equal(h.calls.prove.length, 0);
    assert.equal(h.calls.done.length, 0);
  }
});

test('explicit action sends only the fixed public GET request and returns status-only summary', async () => {
  const h = await harness({
    proveResult: {
      results: [
        { type: 'SENT', part: 'START_LINE', value: 'GET /robots.txt HTTP/1.1' },
        { type: 'RECV', part: 'STATUS_CODE', value: '204' },
        { type: 'RECV', part: 'BODY', value: 'secret response content must not escape' },
      ],
    },
  });
  const ui = h.plugin.main();
  assert.equal(h.calls.prove.length, 0);
  const button = findButton(ui, 'checkExtension');
  assert.equal(button.options.onclick, 'checkExtension');
  await h.plugin[button.options.onclick]();

  assert.equal(h.calls.prove.length, 1);
  const [request, options] = h.calls.prove[0];
  assert.deepEqual(request, {
    url: 'https://app.revolut.com/robots.txt',
    method: 'GET',
    headers: { Host: 'app.revolut.com', 'Accept-Encoding': 'identity', Connection: 'close' },
  });
  assert.equal(options.verifierUrl, verifier);
  assert.equal(options.proxyUrl, proxy);
  assert.equal(options.maxSentData, 4096);
  assert.equal(options.maxRecvData, 16384);
  assert.deepEqual(options.handlers, [
    { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
    { type: 'RECV', part: 'STATUS_CODE', action: 'REVEAL' },
  ]);
  assert.equal(h.calls.done.length, 1);
  assert.equal(h.calls.done[0].pendingAtCall, false);
  assert.deepEqual(h.calls.done[0].value, {
    diagnosticOnly: true,
    mode: 'extension-check',
    releaseGate: 'NOT_CLEARED',
    bankRequestMade: false,
    publicRequestMade: true,
    httpStatus: 204,
  });
  assert.ok(!JSON.stringify(h.calls.done[0]).includes('secret response content'));
  assert.ok(!JSON.stringify(h.calls.done[0]).includes('GET /robots.txt HTTP'));
});

test('known setup timeout returns a fixed code without exception details', async () => {
  const h = await harness({
    proveError: 'setupProver timed out after 30000ms for private.example token=secret',
  });
  h.plugin.main();
  await h.plugin.checkExtension();
  assert.equal(h.calls.done[0].value.errorCode, 'MPC_SETUP_TIMEOUT');
  assert.equal(h.calls.done[0].value.releaseGate, 'NOT_CLEARED');
  assert.equal(h.calls.done[0].pendingAtCall, false);
  assert.doesNotMatch(JSON.stringify(h.calls.done[0]), /private\.example|secret|30000/);
  assert.doesNotMatch(h.state.get('message'), /private\.example|secret|30000/);
});

test('mux setup errors and all other errors collapse to the two fixed failure codes', async () => {
  for (const [message, expected] of [
    ['context mux error with private details', 'MPC_SETUP_FAILED'],
    ['arbitrary private URL and credential', 'EXTENSION_CHECK_FAILED'],
  ]) {
    const h = await harness({ proveError: message });
    h.plugin.main();
    await h.plugin.checkExtension();
    assert.equal(h.calls.done[0].value.errorCode, expected);
    assert.equal(h.calls.done[0].value.bankRequestMade, false);
    assert.equal(
      h.calls.done[0].value.publicRequestMade,
      expected === 'EXTENSION_CHECK_FAILED' ? null : false,
    );
    assert.equal(h.calls.done[0].pendingAtCall, false);
    assert.doesNotMatch(JSON.stringify(h.calls.done[0]), /private details|private URL|credential/);
  }
});

test('unrecognized status stays null while a missing proof result fails closed', async () => {
  for (const result of [null, { results: 'not-an-array' }]) {
    const h = await harness({ proveResult: result });
    h.plugin.main();
    await h.plugin.checkExtension();
    assert.equal(h.calls.done[0].value.errorCode, 'EXTENSION_CHECK_FAILED');
    assert.equal(h.calls.done[0].value.releaseGate, 'NOT_CLEARED');
  }
  const unrecognized = await harness({
    proveResult: { results: [{ type: 'RECV', part: 'STATUS_CODE', value: '200 OK' }] },
  });
  unrecognized.plugin.main();
  await unrecognized.plugin.checkExtension();
  assert.equal(unrecognized.calls.done[0].value.publicRequestMade, true);
  assert.equal(unrecognized.calls.done[0].value.httpStatus, null);
});
