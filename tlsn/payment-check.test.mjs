import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { isPaymentRoute, readPaymentRoute } from './payment-check.mjs';
const ORIGIN = 'https://payment.example.test';
const FIELDS = [
  '0.amount',
  '0.currency',
  '0.recipient.code',
  '0.id',
  '0.state',
  '0.completedDate',
  '0.type',
];
async function pageHarness(result, { failure = false } = {}) {
  const html = String((await readPaymentRoute('/payment-check/', ORIGIN)).body);
  const plugin = String((await readPaymentRoute('/payment-check/plugin.mjs', ORIGIN)).body);
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

test('payment routes are explicit and endpoints cannot be supplied through Host or query values', async () => {
  const plugin = await readPaymentRoute('/payment-check/plugin.mjs', ORIGIN);
  assert.match(plugin.body, /const RESPONSE_SHAPE_ONLY = false;/);
  assert.ok(plugin.body.includes(`const VERIFIER_ORIGIN = ${JSON.stringify(ORIGIN)};`));
  for (const path of ['/payment-check/plugin.mjs?x=1', '/payment-check/window', '/plugin.mjs']) {
    assert.equal(isPaymentRoute(path), false);
    await assert.rejects(readPaymentRoute(path, ORIGIN));
  }
  for (const origin of [
    'http://fixture.test',
    'https://user:secret@fixture.test',
    'https://fixture.test/',
    'https://fixture.test?x=1',
  ])
    await assert.rejects(readPaymentRoute('/payment-check/', origin), /INVALID_RESPONSE_ORIGIN/);
});

test('payment execution requires fresh consent and consumes it after completion or failure', async () => {
  for (const failure of [false, true]) {
    const h = await pageHarness(
      {
        diagnosticOnly: true,
        mode: 'payment-fields',
        releaseGate: 'NOT_CLEARED',
        httpStatus: 200,
        fieldsPresent: Object.fromEntries(FIELDS.map((key) => [key, true])),
      },
      { failure },
    );
    const run = h.elements.get('#run'),
      consent = h.elements.get('#consent');
    assert.equal(run.disabled, true);
    run.disabled = false;
    await run.listeners.get('click')();
    assert.equal(h.calls.length, 0);
    consent.checked = true;
    consent.listeners.get('change')();
    assert.equal(run.disabled, false);
    await run.listeners.get('click')();
    assert.equal(h.calls.length, 1);
    assert.match(h.calls[0][0], /const RESPONSE_SHAPE_ONLY = false;/);
    assert.equal(consent.checked, false);
    assert.equal(run.disabled, true);
    assert.match(
      h.elements.get('#result').textContent,
      failure ? /PROOF_FAILED/ : /HTTP 200; fields 7\/7 present/,
    );
    assert.match(h.elements.get('#result').textContent, /Payment remains unverified.*NOT_CLEARED/);
    assert.doesNotMatch(h.elements.get('#result').textContent, /synthetic-private/);
  }
});

test('payment page renders status and exact boolean field presence, never transfer values', async () => {
  const h = await pageHarness(null);
  h.context.renderResult({
    diagnosticOnly: true,
    mode: 'payment-fields',
    releaseGate: 'NOT_CLEARED',
    httpStatus: 200,
    fieldsPresent: { '0.amount': 12345, '0.currency': 'EUR', '0.id': true, '<img src=x>': true },
    amount: 12345,
    recipient: 'synthetic-private',
    requestPath: 'synthetic-private-bank-url',
  });
  assert.match(h.elements.get('#result').textContent, /fields 1\/7 present; missing 0.amount/);
  assert.doesNotMatch(h.elements.get('#result').textContent, /12345|EUR|synthetic-private|<img/);
  h.context.renderResult({
    diagnosticOnly: true,
    mode: 'attempt-error',
    releaseGate: 'NOT_CLEARED',
    errorCode: 'synthetic-private',
  });
  assert.match(h.elements.get('#result').textContent, /PROOF_FAILED/);
  h.context.renderResult({
    diagnosticOnly: true,
    mode: 'response-shape',
    releaseGate: 'NOT_CLEARED',
  });
  assert.match(h.elements.get('#result').textContent, /RESPONSE_ONLY_COMPLETED/);
  h.context.renderResult({
    diagnosticOnly: true,
    mode: 'payment-fields',
    releaseGate: 'CLEARED',
    fieldsPresent: Object.fromEntries(FIELDS.map((key) => [key, true])),
  });
  assert.match(h.elements.get('#result').textContent, /UNRECOGNIZED_DIAGNOSTIC.*NOT_CLEARED/);
});
