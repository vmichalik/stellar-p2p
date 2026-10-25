import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createHostHttpServer, createWalletRequestBridge } from './http-api.mjs';

function invoke(
  handler,
  { method = 'GET', path = '/api/config', origin, host, token, payload, secFetchSite },
) {
  const headers = {
    host,
    ...(origin ? { origin } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(secFetchSite ? { 'sec-fetch-site': secFetchSite } : {}),
  };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  const request = Readable.from(
    payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))],
  );
  Object.assign(request, { method, url: path, headers });
  const response = {
    headers: {},
    status: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = body?.toString() ?? '';
      this.writableEnded = true;
    },
  };
  return Promise.resolve(handler(request, response)).then(() => response);
}

test('HTTP API enforces origin and bearer capability and returns wallet replies', async () => {
  const capability = 'a'.repeat(43),
    origin = 'http://127.0.0.1:8787';
  const walletBridge = createWalletRequestBridge({ timeoutMs: 2_000 });
  const service = {
    async connectWallet(party) {
      assert.equal(party, 'buyer');
      return { account: 'GTEST' };
    },
  };
  const policyPort = {
    async issue(input) {
      assert.deepEqual(input, { evidenceId: 'record-1', orderId: '9' });
      return {
        authorization: 'opaque-reference',
        status: 'POLICY_ACCEPTED',
        releaseGate: 'POLICY_ACCEPTED',
      };
    },
  };
  const api = createHostHttpServer({
    service,
    deployment: { publicConfig: { mode: 'live' } },
    origin,
    capabilities: [capability],
    walletBridge,
    policyPort,
  });
  const handler = api.server.listeners('request')[0];
  const denied = await invoke(handler, { origin, host: '127.0.0.1:8787', token: 'wrong' });
  assert.equal(denied.status, 401);
  const wrongOrigin = await invoke(handler, {
    origin: 'https://evil.example',
    host: '127.0.0.1:8787',
    token: capability,
  });
  assert.equal(wrongOrigin.status, 403);
  const wrongHost = await invoke(handler, {
    host: 'evil.example',
    token: capability,
    secFetchSite: 'same-origin',
  });
  assert.equal(wrongHost.status, 401);
  const sameOriginGet = await invoke(handler, {
    host: '127.0.0.1:8787',
    token: capability,
    secFetchSite: 'same-origin',
  });
  assert.equal(sameOriginGet.status, 200);
  const response = await invoke(handler, { origin, host: '127.0.0.1:8787', token: capability });
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store, private');
  assert.deepEqual(JSON.parse(response.body), { result: { config: { mode: 'live' } } });
  const issued = await invoke(handler, {
    method: 'POST',
    path: '/api/orders/9/policy',
    origin,
    host: '127.0.0.1:8787',
    token: capability,
    payload: { evidenceId: 'record-1' },
  });
  assert.equal(issued.status, 200);
  assert.deepEqual(JSON.parse(issued.body).result, {
    authorization: 'opaque-reference',
    status: 'POLICY_ACCEPTED',
    releaseGate: 'POLICY_ACCEPTED',
  });
  const forged = await invoke(handler, {
    method: 'POST',
    path: '/api/orders/9/policy',
    origin,
    host: '127.0.0.1:8787',
    token: capability,
    payload: { evidenceId: 'record-1', syntheticOnly: false, claim: {} },
  });
  assert.equal(forged.status, 400);
  assert.equal(JSON.parse(forged.body).error, 'INVALID_POLICY_REFERENCE');

  const pending = walletBridge.wallet.connect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const [request] = walletBridge.list();
  const reply = await invoke(handler, {
    method: 'POST',
    path: '/api/wallet/replies',
    origin,
    host: '127.0.0.1:8787',
    token: capability,
    payload: { id: request.id, result: 'GTEST' },
  });
  assert.equal(reply.status, 200);
  assert.deepEqual(await pending, 'GTEST');
});

test('rate-limit exits once and remote plaintext origins are rejected', async () => {
  const capability = 'a'.repeat(43),
    origin = 'http://127.0.0.1:8787';
  let calls = 0;
  const walletBridge = createWalletRequestBridge();
  const api = createHostHttpServer({
    service: {
      getOrder: async () => {
        calls++;
        return {};
      },
    },
    deployment: {},
    origin,
    capabilities: [capability],
    walletBridge,
    maxRequestsPerMinute: 1,
  });
  const handler = api.server.listeners('request')[0];
  await invoke(handler, {
    path: '/api/orders/0',
    origin,
    host: '127.0.0.1:8787',
    token: capability,
  });
  const limited = await invoke(handler, {
    path: '/api/orders/0',
    origin,
    host: '127.0.0.1:8787',
    token: capability,
  });
  assert.equal(limited.status, 429);
  assert.equal(calls, 1);
  assert.throws(
    () =>
      createHostHttpServer({
        service: {},
        deployment: {},
        origin: 'http://remote.example',
        walletBridge,
      }),
    /HTTPS_OR_LOOPBACK_REQUIRED/,
  );
});

test('workbench capabilities expire after one hour', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const token = 'a'.repeat(43),
    origin = 'http://127.0.0.1:8787';
  const api = createHostHttpServer({
    service: {},
    deployment: { publicConfig: {} },
    origin,
    capabilities: [token],
    walletBridge: createWalletRequestBridge(),
  });
  const handler = api.server.listeners('request')[0];
  assert.equal((await invoke(handler, { origin, host: '127.0.0.1:8787', token })).status, 200);
  t.mock.timers.setTime(3_601_000);
  assert.equal((await invoke(handler, { origin, host: '127.0.0.1:8787', token })).status, 401);
});
