import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { isResponseRoute, readResponseRoute } from './response-check.mjs';

const ORIGIN = 'https://response.example.test';
const detail = {
  method: 'GET',
  url: 'https://app.revolut.com/api/retail/transaction/00000000-0000-4000-8000-000000000001',
  timestamp: 1,
  requestHeaders: [{ name: 'Cookie', value: 'synthetic-private-cookie' }],
};

async function pluginHarness() {
  const source = String((await readResponseRoute('/response-check/plugin.mjs', ORIGIN)).body);
  const state = new Map();
  const calls = { prove: [], done: [], openWindow: [] };
  globalThis.useState = (key, value) => (state.has(key) ? state.get(key) : value);
  globalThis.setState = (key, value) => state.set(key, value);
  globalThis.useHeaders = (select) => select([detail]);
  globalThis.useEffect = (effect) => effect();
  globalThis.openWindow = (url) => calls.openWindow.push(url);
  globalThis.div = (options, children) => ({ options, children });
  globalThis.button = (options, children) => ({ options, children });
  globalThis.prove = async (...args) => {
    calls.prove.push(args);
    return {
      results: [
        { type: 'RECV', part: 'STATUS_CODE', value: '200' },
        { type: 'RECV', part: 'HEADERS', value: 'content-type: application/json' },
        { type: 'RECV', part: 'ALL', value: '\r\n\r\n{' },
        { type: 'RECV', part: 'ALL', value: '"amount":' },
        { type: 'RECV', part: 'BODY', value: '"amount":-123' },
        { type: 'SENT', part: 'START_LINE', value: detail.url },
      ],
    };
  };
  globalThis.done = async (value) => calls.done.push(JSON.parse(value));
  const plugin = (
    await import(
      'data:text/javascript;base64,' + Buffer.from(source).toString('base64') + '#' + Math.random()
    )
  ).default;
  return { plugin, state, calls };
}

function buttons(node) {
  if (!node || typeof node !== 'object') return [];
  return [node.options?.onclick, ...(node.children || []).flatMap(buttons)].filter(Boolean);
}

test('response renderer accepts only exact routes and pins the shape-only plugin to the operator origin', async () => {
  const plugin = await readResponseRoute('/response-check/plugin.mjs', ORIGIN);
  assert.match(plugin.body, /const RESPONSE_SHAPE_ONLY = true;/);
  assert.ok(plugin.body.includes(`const VERIFIER_ORIGIN = ${JSON.stringify(ORIGIN)};`));
  assert.ok(
    plugin.body.includes(
      `const PROXY_URL = ${JSON.stringify(ORIGIN.replace('https:', 'wss:') + '/proxy?token=app.revolut.com')};`,
    ),
  );
  for (const path of [
    '/response-check/plugin.mjs?mode=payment-fields',
    '/response-check/../revolut.plugin.mjs',
    '/plugin.mjs',
  ]) {
    assert.equal(isResponseRoute(path), false);
    await assert.rejects(readResponseRoute(path, ORIGIN));
  }
  for (const origin of [
    'http://response.example.test',
    'https://response.example.test/',
    'https://user:secret@response.example.test',
    'https://response.example.test?secret=x',
  ])
    await assert.rejects(readResponseRoute('/response-check/', origin), /INVALID_RESPONSE_ORIGIN/);
});

test('rendered shape-only plugin has no payment action, makes no automatic proof, and rejects mode escalation', async () => {
  const h = await pluginHarness();
  const ui = h.plugin.main();
  assert.deepEqual(buttons(ui), ['checkResponse']);
  assert.equal(h.calls.prove.length, 0);
  for (const mode of ['payment-fields', 'unknown', null, {}, 1]) await h.plugin.generateProof(mode);
  assert.equal(h.calls.prove.length, 0);
  assert.match(h.state.get('message'), /Only the approved response-shape check/);
  await h.plugin.generateProof();
  assert.equal(h.calls.prove.length, 1);
  const [request, options] = h.calls.prove[0];
  assert.equal(request.url, detail.url);
  assert.equal(options.maxSentData, 4096);
  assert.equal(options.maxRecvData, 16384);
  assert.equal(options.verifierUrl, ORIGIN);
  assert.equal(
    options.handlers.some(
      (row) => row.part === 'BODY' || (row.type === 'SENT' && row.part === 'HEADERS'),
    ),
    false,
  );
  assert.deepEqual(h.calls.done[0].fieldNames, ['amount']);
  assert.equal(h.calls.done[0].mode, 'response-shape');
  assert.equal(h.calls.done[0].releaseGate, 'NOT_CLEARED');
  assert.doesNotMatch(JSON.stringify(h.calls.done), /private-cookie|00000000|-123/);
});

async function pageHarness(result, { failure = false } = {}) {
  const html = String((await readResponseRoute('/response-check/', ORIGIN)).body);
  const plugin = String((await readResponseRoute('/response-check/plugin.mjs', ORIGIN)).body);
  const elements = new Map(
    ['#run', '#consent', '#result', '#source', '#verifier-origin'].map((id) => [
      id,
      {
        textContent: '',
        checked: false,
        disabled: id === '#run',
        listeners: new Map(),
        addEventListener(type, callback) {
          this.listeners.set(type, callback);
        },
      },
    ]),
  );
  Object.defineProperty(elements.get('#result'), 'innerHTML', {
    set() {
      throw new Error('HTML rendering is forbidden');
    },
  });
  const calls = [];
  const context = vm.createContext({
    document: {
      querySelector: (id) => (id.startsWith('meta') ? { content: ORIGIN } : elements.get(id)),
    },
    window: {
      tlsn: {
        version: '0.1.0.1501',
        async execCode(...args) {
          calls.push(args);
          if (failure) throw new Error('synthetic-private-bank-url');
          return result;
        },
      },
      addEventListener() {},
    },
    fetch: async (path) => ({
      ok: true,
      text: async () => (path.endsWith('plugin.mjs') ? plugin : 'ok'),
      json: async () => ({
        git_hash: '68bbd380d6e1a89d79748e5294661c752f5d1205',
        tlsn_version: '0.1.0-alpha.15',
      }),
    }),
    AbortSignal,
  });
  vm.runInContext(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1], context);
  await context.initialize();
  return { elements, calls, context };
}

test('page requires explicit consent before extension execution and consumes consent after one attempt', async () => {
  const h = await pageHarness({
    diagnosticOnly: true,
    mode: 'response-shape',
    releaseGate: 'NOT_CLEARED',
    httpStatus: 200,
    rootType: 'object',
    contentType: 'json',
    fieldNames: ['amount'],
  });
  const run = h.elements.get('#run'),
    consent = h.elements.get('#consent');
  assert.equal(h.elements.get('#verifier-origin').textContent, ORIGIN);
  assert.equal(run.disabled, true);
  run.disabled = false;
  await run.listeners.get('click')();
  assert.equal(h.calls.length, 0);
  consent.checked = true;
  consent.listeners.get('change')();
  assert.equal(run.disabled, false);
  await run.listeners.get('click')();
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0][0], /const RESPONSE_SHAPE_ONLY = true;/);
  assert.equal(consent.checked, false);
  assert.equal(run.disabled, true);
});

test('response page renders only allowlisted metadata and fixed errors, never supplied values or HTML', async () => {
  const h = await pageHarness(null);
  h.context.renderResult({
    diagnosticOnly: true,
    mode: 'response-shape',
    releaseGate: 'NOT_CLEARED',
    httpStatus: 200,
    rootType: 'object',
    contentType: 'json',
    fieldNames: ['amount', 'amount', '<img src=x>', 'synthetic-private-id'],
    amount: -123,
    requestPath: 'synthetic-private-bank-url',
  });
  assert.match(h.elements.get('#result').textContent, /HTTP 200.*fields amount\./);
  assert.doesNotMatch(h.elements.get('#result').textContent, /synthetic-private|<img|-123/);
  h.context.renderResult({
    diagnosticOnly: true,
    mode: 'attempt-error',
    releaseGate: 'NOT_CLEARED',
    errorCode: 'MPC_SETUP_TIMEOUT',
    message: 'synthetic-private-bank-url',
  });
  assert.match(h.elements.get('#result').textContent, /MPC_SETUP_TIMEOUT/);
  assert.doesNotMatch(h.elements.get('#result').textContent, /synthetic-private/);
  h.context.renderResult({
    diagnosticOnly: true,
    fieldsPresent: { amount: true },
    requestPath: 'synthetic-private-bank-url',
  });
  assert.match(h.elements.get('#result').textContent, /UNRECOGNIZED_DIAGNOSTIC/);
});

test('failed extension execution also consumes consent without displaying exception text', async () => {
  const h = await pageHarness(null, { failure: true });
  const consent = h.elements.get('#consent');
  consent.checked = true;
  consent.listeners.get('change')();
  await h.elements.get('#run').listeners.get('click')();
  assert.equal(consent.checked, false);
  assert.match(h.elements.get('#result').textContent, /PROOF_FAILED/);
  assert.doesNotMatch(h.elements.get('#result').textContent, /synthetic-private/);
});
