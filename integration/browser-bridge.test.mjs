import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { Address, Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import { createBrowserBridge } from './browser-bridge.mjs';
import { readDeploymentDomain } from '../app/host-client.mjs';

// Disposable, public fixture keys. Every HTTP request stays on the loopback
// server below; no wallet extension, bank, RPC or funded account is used.
const alice = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x61));
const bob = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x62));
const contract = Address.contract(Buffer.alloc(32, 0x63)).toString();
const deployment = {
  networkPassphrase: Networks.TESTNET,
  contract,
  token: contract,
  tokenDecimals: 7,
  tokenLabel: 'Test token',
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function order(owner = alice.publicKey()) {
  return {
    id: '7',
    state: 'Paying',
    buyer: owner,
    reserved_at: '100',
    locked_at: '101',
    pay_by: '200',
    terms: {
      seller: bob.publicKey(),
      token_amount: '220000000',
      fiat_minor: '2000',
      currency: 'EUR',
      rail: 'revolut',
      recipient: '12'.repeat(32),
      offer_expires_at: '300',
      reservation_seconds: '100',
    },
  };
}
const confirmed = {
  hash: '34'.repeat(32),
  networkPassphrase: Networks.TESTNET,
  contract,
  ledger: '123',
  status: 'confirmed',
};

async function fixture(t, options = {}) {
  let bridge;
  const server = createServer((request, response) => bridge.handler(request, response));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const publicOrigin = `http://127.0.0.1:${server.address().port}`;
  bridge = createBrowserBridge({
    publicOrigin,
    deployment,
    createServices: () => ({}),
    ...options,
  });
  t.after(async () => {
    bridge.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  async function request(path, { method = 'GET', body, cookie, headers = {}, raw } = {}) {
    const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        publicOrigin + path,
        {
          method,
          headers: {
            ...(method !== 'GET' ? { Origin: publicOrigin } : {}),
            ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers,
          },
        },
        (response) => {
          let data = '';
          response.on('data', (part) => {
            data += part;
          });
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: JSON.parse(data),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
  }
  async function challenge(key = alice) {
    const response = await request('/api/session/challenge', {
      method: 'POST',
      body: { account: key.publicKey() },
    });
    assert.equal(response.status, 200);
    return { ...response.body, cookie: response.headers['set-cookie'][0].split(';')[0], response };
  }
  async function login(key = alice) {
    const c = await challenge(key);
    const response = await request('/api/session/verify', {
      method: 'POST',
      cookie: c.cookie,
      body: {
        challengeId: c.challengeId,
        signature: Buffer.from(key.signMessage(c.message)).toString('base64'),
      },
    });
    assert.equal(response.status, 200);
    return response.headers['set-cookie'][0].split(';')[0];
  }
  async function start(cookie, action, args) {
    const response = await request('/api/commands', {
      method: 'POST',
      cookie,
      body: { action, args },
    });
    assert.equal(response.status, 202, JSON.stringify(response.body));
    return response.body.operationId;
  }
  async function poll(cookie, id, predicate = (body) => body.status !== 'running') {
    for (let i = 0; i < 100; i++) {
      const response = await request(`/api/operations/${id}`, { cookie });
      assert.equal(response.status, 200);
      if (predicate(response.body)) return response.body;
      await sleep(2);
    }
    assert.fail('Local bridge operation did not reach the expected state');
  }
  const reply = (cookie, id, requestId, body) =>
    request(`/api/operations/${id}/wallet-results/${requestId}`, { method: 'POST', cookie, body });
  return { publicOrigin, request, challenge, login, start, poll, reply, bridge };
}

test('requires an exact HTTPS or explicit loopback origin and finite positive limits', () => {
  for (const publicOrigin of [
    'https://app.example.test/',
    'http://app.example.test',
    'https://user:pass@app.example.test',
    'https://app.example.test/path',
  ])
    assert.throws(() => createBrowserBridge({ publicOrigin, createServices: () => ({}) }));
  assert.throws(() =>
    createBrowserBridge({
      publicOrigin: 'https://app.example.test',
      createServices: () => ({}),
      walletTimeoutMs: 0,
    }),
  );
});

test('authenticates an exact real SDK message, binds the browser cookie, and consumes the challenge once', async (t) => {
  const f = await fixture(t);
  const c = await f.challenge();
  assert.ok(c.message.includes(f.publicOrigin));
  assert.ok(c.message.includes(Networks.TESTNET));
  assert.ok(c.message.includes(alice.publicKey()));
  assert.ok(c.message.includes(c.challengeId));
  assert.match(c.response.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
  const body = {
    challengeId: c.challengeId,
    signature: Buffer.from(alice.signMessage(c.message)).toString('base64'),
  };
  assert.equal((await f.request('/api/session/verify', { method: 'POST', body })).status, 401);
  const accepted = await f.request('/api/session/verify', {
    method: 'POST',
    cookie: c.cookie,
    body,
  });
  assert.equal(accepted.status, 200);
  const cookie = accepted.headers['set-cookie'][0].split(';')[0];
  assert.equal((await f.request('/api/session', { cookie })).body.account, alice.publicKey());
  assert.equal(
    (await f.request('/api/session/verify', { method: 'POST', cookie: c.cookie, body })).status,
    401,
  );
  assert.equal((await f.request('/api/session', { cookie: c.cookie })).status, 401);
});

test('rejects wrong signer, modified origin/network/message and expired challenges', async (t) => {
  let now = 10_000;
  const f = await fixture(t, { clock: () => now });
  for (const mutate of [
    (c) => bob.signMessage(c.message),
    (c) => alice.sign(Buffer.from(c.message)), // Raw Ed25519 is not SEP-53.
    (c) => alice.signMessage(c.message.replace(f.publicOrigin, 'https://other.example.test')),
    (c) => alice.signMessage(c.message.replace(Networks.TESTNET, Networks.PUBLIC)),
    (c) => alice.signMessage(c.message + '\nextra'),
  ]) {
    const c = await f.challenge();
    assert.equal(
      (
        await f.request('/api/session/verify', {
          method: 'POST',
          cookie: c.cookie,
          body: {
            challengeId: c.challengeId,
            signature: Buffer.from(mutate(c)).toString('base64'),
          },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await f.request('/api/session/verify', {
          method: 'POST',
          cookie: c.cookie,
          body: {
            challengeId: c.challengeId,
            signature: Buffer.from(alice.signMessage(c.message)).toString('base64'),
          },
        })
      ).status,
      401,
    );
  }
  const c = await f.challenge();
  now = c.expiresAt;
  assert.equal(
    (
      await f.request('/api/session/verify', {
        method: 'POST',
        cookie: c.cookie,
        body: {
          challengeId: c.challengeId,
          signature: Buffer.from(alice.signMessage(c.message)).toString('base64'),
        },
      })
    ).status,
    401,
  );
});

test('rejects foreign Host/Origin, mutation without Origin, unknown routes and oversized or non-JSON bodies', async (t) => {
  const f = await fixture(t, { maxBodyBytes: 512 });
  for (const headers of [
    { Origin: 'https://other.example.test' },
    { Origin: '' },
    { Host: 'other.example.test' },
  ])
    assert.equal(
      (
        await f.request('/api/session/challenge', {
          method: 'POST',
          body: { account: alice.publicKey() },
          headers,
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await f.request('/api/session/challenge', {
        method: 'POST',
        raw: 'x',
        headers: { 'Content-Type': 'text/plain' },
      })
    ).status,
    415,
  );
  assert.equal(
    (await f.request('/api/session/challenge', { method: 'POST', raw: '{' })).status,
    400,
  );
  assert.equal(
    (
      await f.request('/api/session/challenge', {
        method: 'POST',
        raw: JSON.stringify({ account: 'x'.repeat(600) }),
      })
    ).status,
    413,
  );
  assert.equal((await f.request('/api/session?token=anything')).status, 404);
  const cookie = await f.login();
  assert.equal(
    (await f.request('/api/session', { cookie, headers: { Origin: 'https://other.example.test' } }))
      .status,
    403,
  );
  assert.equal((await f.request('/api/session', { cookie: `${cookie}; ${cookie}` })).status, 400);
});

test('HTTPS deployments issue Secure host-only cookies and never add permissive CORS', async (t) => {
  const origin = 'https://pactlane.example.test';
  // Local HTTP stands in for a TLS reverse proxy; it is not an external request.
  const f = await fixture(t, { publicOrigin: origin });
  const headers = { Host: 'pactlane.example.test', Origin: origin };
  const challenge = await f.request('/api/session/challenge', {
    method: 'POST',
    headers,
    body: { account: alice.publicKey() },
  });
  assert.equal(challenge.status, 200);
  assert.match(challenge.headers['set-cookie'][0], /^__Host-pactlane_preauth=/);
  assert.match(challenge.headers['set-cookie'][0], /; Secure$/);
  const response = await f.request('/api/session/verify', {
    method: 'POST',
    headers,
    cookie: challenge.headers['set-cookie'][0].split(';')[0],
    body: {
      challengeId: challenge.body.challengeId,
      signature: Buffer.from(alice.signMessage(challenge.body.message)).toString('base64'),
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers['set-cookie'][0], /^__Host-pactlane_session=/);
  assert.match(response.headers['set-cookie'][0], /; Secure$/);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('a client that keeps streaming an incomplete body receives 408 and server socket closure', async (t) => {
  const f = await fixture(t, { bodyTimeoutMs: 25 });
  const response = await new Promise((resolve, reject) => {
    let observed;
    const req = httpRequest(
      f.publicOrigin + '/api/session/challenge',
      {
        method: 'POST',
        headers: { Origin: f.publicOrigin, 'Content-Type': 'application/json' },
      },
      (res) => {
        let body = '';
        res.on('data', (part) => {
          body += part;
        });
        res.on('end', () => {
          observed = {
            status: res.statusCode,
            connection: res.headers.connection,
            body: JSON.parse(body),
          };
        });
      },
    );
    const streaming = setInterval(() => req.write(' '), 2);
    const deadline = setTimeout(() => {
      clearInterval(streaming);
      req.destroy();
      reject(new Error('Rejected upload socket stayed open'));
    }, 1_000);
    req.on('error', (error) => {
      if (!observed) reject(error);
    });
    req.on('socket', (socket) =>
      socket.once('close', () => {
        clearInterval(streaming);
        clearTimeout(deadline);
        if (observed) resolve(observed);
        else reject(new Error('Socket closed before the bounded error response arrived'));
      }),
    );
    // Intentionally never call req.end(): closure must be enforced by the server.
    req.write('{');
  });
  assert.deepEqual(response, {
    status: 408,
    connection: 'close',
    body: { error: 'REQUEST_TIMEOUT' },
  });
});

test('isolates service instances and every one-use wallet reply by session, operation and request', async (t) => {
  const created = [];
  const f = await fixture(t, {
    createServices: ({ wallet, account }) => {
      created.push(account);
      return {
        async connectWallet() {
          assert.equal(await wallet.connect(), account);
          assert.equal(await wallet.selected(), account);
          assert.equal(await wallet.network(), Networks.TESTNET);
          assert.equal(await wallet.sign('dW5zaWduZWQ=', account), 'c2lnbmVk');
          return { account, networkPassphrase: Networks.TESTNET };
        },
      };
    },
  });
  const a = await f.login(alice),
    b = await f.login(bob);
  const first = await f.start(a, 'connectWallet', { party: 'buyer' });
  const second = await f.start(b, 'connectWallet', { party: 'seller' });
  assert.equal((await f.request(`/api/operations/${first}`, { cookie: b })).status, 404);
  assert.equal(
    (
      await f.request('/api/commands', {
        method: 'POST',
        cookie: a,
        body: { action: 'connectWallet', args: { party: 'buyer' } },
      })
    ).status,
    409,
  );
  for (const [cookie, id, key] of [
    [a, first, alice],
    [b, second, bob],
  ]) {
    for (const method of ['connect', 'selected', 'network', 'sign']) {
      const { walletRequest } = await f.poll(cookie, id, (body) => Boolean(body.walletRequest));
      assert.equal(walletRequest.method, method);
      assert.equal(
        (await f.reply(cookie === a ? b : a, id, walletRequest.id, { result: key.publicKey() }))
          .status,
        404,
      );
      if (method === 'connect')
        assert.equal(
          (
            await f.reply(cookie, id, walletRequest.id, {
              result: key === alice ? bob.publicKey() : alice.publicKey(),
            })
          ).status,
          400,
        );
      if (method === 'sign')
        assert.deepEqual(walletRequest.args, {
          transactionXdr: 'dW5zaWduZWQ=',
          account: key.publicKey(),
          ...readDeploymentDomain(deployment),
        });
      const result =
        method === 'network' ? Networks.TESTNET : method === 'sign' ? 'c2lnbmVk' : key.publicKey();
      assert.equal((await f.reply(cookie, id, walletRequest.id, { result })).status, 200);
      assert.equal((await f.reply(cookie, id, walletRequest.id, { result })).status, 409);
    }
    assert.equal((await f.poll(cookie, id)).result.account, key.publicKey());
  }
  assert.deepEqual(created.sort(), [alice.publicKey(), bob.publicKey()].sort());
});

test('dispatches exact allowed inputs, forces the session account and strips private output fields', async (t) => {
  let funded, reserved;
  const privateOrder = {
    ...order(),
    offerData: { recipientSalt: 'PRIVATE_SALT' },
    terms: { ...order().terms, recipientSalt: 'PRIVATE_SALT' },
    config: { secret: 'PRIVATE_SECRET' },
  };
  const f = await fixture(t, {
    createServices: () => ({
      getOrder: async () => privateOrder,
      fund: async (terms) => {
        funded = terms;
        return {
          order: privateOrder,
          transaction: { ...confirmed, privateHeaders: 'PRIVATE_HEADERS' },
          offerData: 'PRIVATE_SALT',
        };
      },
      reserve: async (id, buyer) => {
        reserved = [id, buyer];
        return { order: privateOrder, transaction: confirmed };
      },
      getPolicyStatus: async () => ({
        status: 'unavailable',
        orderId: '7',
        proof: 'PRIVATE_PROOF',
      }),
    }),
  });
  const cookie = await f.login();
  const { seller, ...terms } = order().terms;
  for (const body of [
    { action: 'fund', args: { terms: { ...terms, seller } } },
    { action: 'reserve', args: { orderId: '7', buyer: bob.publicKey() } },
    { action: 'getOrder', args: { orderId: '7', verified: true } },
    { action: 'getOrder', args: { orderId: '7' }, deployment: {} },
    { action: 'resolve', args: { orderId: '7' } },
    { action: 'launchPaymentProof', args: { orderId: '7' } },
    { action: '__proto__', args: {} },
  ])
    assert.equal((await f.request('/api/commands', { method: 'POST', cookie, body })).status, 400);
  for (const [action, args] of [
    ['getOrder', { orderId: '7' }],
    ['fund', { terms }],
    ['reserve', { orderId: '7' }],
    ['getPolicyStatus', { orderId: '7' }],
  ]) {
    const result = await f.poll(cookie, await f.start(cookie, action, args));
    assert.equal(result.status, 'completed');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|recipientSalt|offerData|privateHeaders/);
  }
  assert.equal(funded.seller, alice.publicKey());
  assert.deepEqual(reserved, ['7', alice.publicKey()]);
});

test('sanitizes service errors and wallet refusals without trusting completion or private error text', async (t) => {
  const f = await fixture(t, {
    createServices: ({ wallet }) => ({
      async getOrder() {
        throw new Error('https://bank.example.test/private-cookie-secret');
      },
      async getPolicyStatus() {
        throw Object.assign(new Error('PRIVATE_PROOF'), { code: 'TLSN_PAYMENT_SCHEMA_UNVERIFIED' });
      },
      async connectWallet() {
        await wallet.connect();
        throw new Error('unreachable');
      },
    }),
  });
  const cookie = await f.login();
  assert.equal(
    (await f.poll(cookie, await f.start(cookie, 'getOrder', { orderId: '7' }))).error,
    'SERVICE_UNAVAILABLE',
  );
  assert.equal(
    (await f.poll(cookie, await f.start(cookie, 'getPolicyStatus', { orderId: '7' }))).error,
    'TLSN_PAYMENT_SCHEMA_UNVERIFIED',
  );
  const id = await f.start(cookie, 'connectWallet', { party: 'buyer' });
  const { walletRequest } = await f.poll(cookie, id, (body) => Boolean(body.walletRequest));
  assert.equal(
    (await f.reply(cookie, id, walletRequest.id, { error: 'PRIVATE_WALLET_ERROR' })).status,
    200,
  );
  assert.equal((await f.poll(cookie, id)).error, 'WALLET_OPERATION_UNKNOWN');
});

test('wallet and operation timeouts settle jobs; late completion cannot revive a job', async (t) => {
  let complete;
  const f = await fixture(t, {
    walletTimeoutMs: 25,
    operationTimeoutMs: 70,
    createServices: ({ wallet, account }) => ({
      async connectWallet() {
        await wallet.connect();
        return { account, networkPassphrase: Networks.TESTNET };
      },
      getOrder: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    }),
  });
  const cookie = await f.login();
  const first = await f.start(cookie, 'connectWallet', { party: 'buyer' });
  assert.equal((await f.poll(cookie, first)).error, 'WALLET_TIMEOUT');
  const second = await f.start(cookie, 'getOrder', { orderId: '7' });
  assert.equal((await f.poll(cookie, second)).error, 'OPERATION_TIMEOUT');
  complete(order());
  await sleep(5);
  assert.equal((await f.poll(cookie, second)).error, 'OPERATION_TIMEOUT');
});

test('logout and session expiry reject waiting wallets and forbid late replies', async (t) => {
  let now = 1_000;
  const failures = [];
  const f = await fixture(t, {
    clock: () => now,
    sessionTtlMs: 1_000,
    createServices: ({ wallet, account }) => ({
      async connectWallet() {
        try {
          await wallet.connect();
        } catch (error) {
          failures.push(error.message);
          throw error;
        }
        return { account, networkPassphrase: Networks.TESTNET };
      },
    }),
  });
  for (const ending of ['logout', 'expiry']) {
    const cookie = await f.login();
    const id = await f.start(cookie, 'connectWallet', { party: 'buyer' });
    const { walletRequest } = await f.poll(cookie, id, (body) => Boolean(body.walletRequest));
    if (ending === 'logout')
      assert.equal((await f.request('/api/session', { method: 'DELETE', cookie })).status, 200);
    else {
      now += 1_001;
      assert.equal((await f.request('/api/session', { cookie })).status, 401);
    }
    assert.equal(
      (await f.reply(cookie, id, walletRequest.id, { result: alice.publicKey() })).status,
      401,
    );
  }
  assert.deepEqual(failures, ['SESSION_ENDED', 'SESSION_EXPIRED']);
});

test('operation timeout rejects a still-pending wallet and close rejects an active operation', async (t) => {
  const failures = [];
  const f = await fixture(t, {
    operationTimeoutMs: 30,
    walletTimeoutMs: 1_000,
    createServices: ({ wallet }) => ({
      async connectWallet() {
        try {
          await wallet.connect();
        } catch (error) {
          failures.push(error.message);
          throw error;
        }
      },
    }),
  });
  const cookie = await f.login();
  const id = await f.start(cookie, 'connectWallet', { party: 'buyer' });
  const { walletRequest } = await f.poll(cookie, id, (body) => Boolean(body.walletRequest));
  assert.equal((await f.poll(cookie, id)).error, 'OPERATION_TIMEOUT');
  assert.equal(
    (await f.reply(cookie, id, walletRequest.id, { result: alice.publicKey() })).status,
    409,
  );
  const second = await f.start(cookie, 'connectWallet', { party: 'buyer' });
  await f.poll(cookie, second, (body) => Boolean(body.walletRequest));
  f.bridge.close();
  await sleep(1);
  assert.equal((await f.request('/api/session', { cookie })).status, 503);
  assert.deepEqual(failures, ['OPERATION_TIMEOUT', 'BRIDGE_CLOSED']);
});

test('bounds challenge/session/job storage and catches asynchronous factory failures', async (t) => {
  const f = await fixture(t, {
    maxChallenges: 1,
    maxSessions: 1,
    maxOperationsPerSession: 1,
    createServices: async () => {
      throw new Error('PRIVATE_FACTORY_CONFIGURATION');
    },
  });
  await f.challenge();
  assert.equal(
    (
      await f.request('/api/session/challenge', {
        method: 'POST',
        body: { account: bob.publicKey() },
      })
    ).status,
    429,
  );
  // A new fixture keeps this capacity check separate from successful authentication.
  const g = await fixture(t, {
    maxSessions: 1,
    maxOperationsPerSession: 1,
    createServices: async () => {
      throw new Error('PRIVATE_FACTORY_CONFIGURATION');
    },
  });
  const cookie = await g.login();
  const first = await g.start(cookie, 'getOrder', { orderId: '7' });
  assert.equal((await g.poll(cookie, first)).error, 'SERVICE_UNAVAILABLE');
  const second = await g.start(cookie, 'getOrder', { orderId: '7' });
  assert.equal((await g.poll(cookie, second)).error, 'SERVICE_UNAVAILABLE');
  assert.equal((await g.request(`/api/operations/${first}`, { cookie })).status, 404);
  const c = await g.challenge(bob);
  assert.equal(
    (
      await g.request('/api/session/verify', {
        method: 'POST',
        cookie: c.cookie,
        body: {
          challengeId: c.challengeId,
          signature: Buffer.from(bob.signMessage(c.message)).toString('base64'),
        },
      })
    ).status,
    429,
  );
});

test('timed-out host work remains bounded across commands and fresh sessions until it settles', async (t) => {
  const completions = new Map();
  const f = await fixture(t, {
    maxActiveOperations: 1,
    operationTimeoutMs: 25,
    createServices: ({ account }) => ({
      getOrder: () => new Promise((resolve) => completions.set(account, resolve)),
    }),
  });
  const firstSession = await f.login(alice);
  const first = await f.start(firstSession, 'getOrder', { orderId: '7' });
  assert.equal((await f.poll(firstSession, first)).error, 'OPERATION_TIMEOUT');
  const freshSession = await f.login(alice);
  const body = { action: 'getOrder', args: { orderId: '7' } };
  assert.equal(
    (await f.request('/api/commands', { method: 'POST', cookie: freshSession, body })).status,
    409,
  );
  const otherSession = await f.login(bob);
  assert.equal(
    (await f.request('/api/commands', { method: 'POST', cookie: otherSession, body })).status,
    429,
  );
  completions.get(alice.publicKey())(order());
  await sleep(1);
  const next = await f.start(otherSession, 'getOrder', { orderId: '7' });
  completions.get(bob.publicKey())(order(bob.publicKey()));
  assert.equal((await f.poll(otherSession, next)).status, 'completed');
  assert.equal((await f.poll(firstSession, first)).error, 'OPERATION_TIMEOUT');
});

test('public view projects only approved fields and binds private rows to the authenticated owner', async (t) => {
  const seen = [];
  const view = (account) => ({
    configured: true,
    deployment: {
      networkPassphrase: Networks.TESTNET,
      contract,
      token: contract,
      tokenDecimals: 7,
      tokenLabel: 'Test token',
      privateKey: 'PRIVATE_DEPLOYMENT',
    },
    offers: [
      {
        id: '0',
        seller: bob.publicKey(),
        tokenAmount: '220000000',
        fiatMinor: '2000',
        currency: 'EUR',
        rail: 'revolut',
        offerExpiresAt: '300',
        recipientCommitment: '12'.repeat(32),
        destination: 'PRIVATE_DESTINATION',
      },
    ],
    ownerOrders: account
      ? [
          {
            ...order(account),
            recipientSalt: 'PRIVATE_SALT',
            lastConfirmedTransaction: { ...confirmed, envelope: 'PRIVATE_ENVELOPE' },
          },
        ]
      : [],
    sellerDrafts: account
      ? [
          {
            id: 'draft',
            publicTerms: { ...order().terms, seller: account },
            source: 'PRIVATE_OFFER',
          },
        ]
      : [],
    balances: { tokenAtoms: '100', privateAccount: 'PRIVATE_BALANCE' },
    serverTime: '150',
    unavailableReasons: ['PAYMENT_VERIFICATION_UNAVAILABLE'],
    readiness: { paymentProof: false, submission: false, recovery: false },
    policyKey: 'PRIVATE_POLICY',
  });
  const f = await fixture(t, {
    readView: ({ account }) => {
      seen.push(account);
      return view(account);
    },
  });
  const anonymous = await f.request('/api/view');
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.body.account, null);
  assert.equal(anonymous.body.balances, null);
  assert.deepEqual(anonymous.body.ownerOrders, []);
  assert.doesNotMatch(JSON.stringify(anonymous.body), /PRIVATE|destination|recipientSalt/);
  const cookie = await f.login();
  const owned = await f.request('/api/view', { cookie });
  assert.equal(owned.status, 200);
  assert.equal(owned.body.account, alice.publicKey());
  assert.equal(owned.body.ownerOrders[0].buyer, alice.publicKey());
  assert.deepEqual(owned.body.balances, { tokenAtoms: '100' });
  assert.doesNotMatch(JSON.stringify(owned.body), /PRIVATE|recipientSalt|envelope/);
  assert.deepEqual(seen, [null, alice.publicKey()]);
  await f.request('/api/session', { method: 'DELETE', cookie });
  assert.equal((await f.request('/api/view', { cookie })).body.account, null);
});

test('rejects private rows for another viewer and inconsistent public deployment or currency', async (t) => {
  let value = {
    configured: true,
    deployment: {
      networkPassphrase: Networks.TESTNET,
      contract,
      token: contract,
      tokenDecimals: 7,
      tokenLabel: 'Test token',
    },
    offers: [],
    ownerOrders: [order()],
    sellerDrafts: [],
    balances: null,
    serverTime: '150',
    unavailableReasons: [],
    readiness: {},
  };
  const f = await fixture(t, { readView: () => value });
  assert.equal((await f.request('/api/view')).status, 400);
  const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x64));
  const cookie = await f.login(other);
  assert.equal((await f.request('/api/view', { cookie })).status, 400);
  value.ownerOrders = [];
  value.deployment.token = alice.publicKey();
  assert.equal((await f.request('/api/view')).status, 400);
  value.deployment.token = contract;
  value.offers = [
    {
      id: '0',
      seller: bob.publicKey(),
      tokenAmount: '1',
      fiatMinor: '1',
      currency: 'USD',
      rail: 'revolut',
      offerExpiresAt: '300',
      recipientCommitment: '12'.repeat(32),
    },
  ];
  assert.equal((await f.request('/api/view')).status, 400);
});

test('preserves only explicit wallet refusal as safely rejected', async (t) => {
  const f = await fixture(t, {
    createServices: ({ wallet }) => ({ connectWallet: () => wallet.connect() }),
  });
  const cookie = await f.login();
  const id = await f.start(cookie, 'connectWallet', { party: 'buyer' });
  const { walletRequest } = await f.poll(cookie, id, (body) => Boolean(body.walletRequest));
  assert.equal(
    (await f.reply(cookie, id, walletRequest.id, { error: 'WALLET_REJECTED' })).status,
    200,
  );
  assert.equal((await f.poll(cookie, id)).error, 'WALLET_REJECTED');
});

test('routes one-use recovery claims only to the authenticated seller and strips private broker fields', async (t) => {
  const sessions = new Map(),
    ended = [];
  const requestId = 'r'.repeat(43),
    claimToken = 'c'.repeat(43);
  const dto = {
    requestId,
    orderId: '7',
    networkPassphrase: Networks.TESTNET,
    contract,
    token: contract,
    buyer: alice.publicKey(),
    seller: bob.publicKey(),
    tokenAmount: '220000000',
    buyerTokens: '100000000',
    sellerTokens: '120000000',
    fiatMinor: '2000',
    currency: 'EUR',
    rail: 'revolut',
    orderState: 'Paying',
    expirationLedger: 200,
    expiresAt: Date.now() + 45000,
    status: 'queued',
  };
  let claimed = null,
    delivered = null;
  const rejected = (code) => {
    throw Object.assign(Error(code), { code });
  };
  const broker = {
    openSession(session) {
      sessions.set(session.id, session);
    },
    closeSession(id) {
      sessions.delete(id);
      ended.push(id);
    },
    async list(id) {
      return sessions.get(id)?.account === dto.seller
        ? [{ ...dto, buyerSessionId: 'PRIVATE_SESSION', preimageXdr: 'PRIVATE_PREIMAGE' }]
        : [];
    },
    async claim(id, requested) {
      if (sessions.get(id)?.account !== dto.seller || requested !== requestId)
        rejected('RECOVERY_REQUEST_MISMATCH');
      if (claimed) rejected('RECOVERY_ALREADY_CLAIMED');
      claimed = id;
      return {
        ...dto,
        status: 'claimed',
        claimToken,
        preimageXdr: 'cHVibGljLWZpeHR1cmU=',
        internalSecret: 'PRIVATE_BROKER',
      };
    },
    async respond(id, requested, reply) {
      if (id !== claimed || requested !== requestId || reply.claimToken !== claimToken)
        rejected('RECOVERY_REQUEST_MISMATCH');
      delivered = reply;
    },
  };
  const f = await fixture(t, {
    recovery: broker,
    readView: () => ({
      configured: true,
      deployment: {
        networkPassphrase: Networks.TESTNET,
        contract,
        token: contract,
        tokenDecimals: 7,
        tokenLabel: 'Test token',
      },
      offers: [],
      ownerOrders: [],
      sellerDrafts: [],
      balances: null,
      serverTime: '100',
      unavailableReasons: [],
      readiness: { recovery: true },
    }),
  });
  const buyerCookie = await f.login(alice),
    sellerCookie = await f.login(bob);
  const buyerView = await f.request('/api/view', { cookie: buyerCookie });
  assert.deepEqual(buyerView.body.recoveryRequests, []);
  const sellerView = await f.request('/api/view', { cookie: sellerCookie });
  assert.deepEqual(sellerView.body.recoveryRequests, [
    { ...dto, ...readDeploymentDomain(deployment) },
  ]);
  assert.doesNotMatch(
    JSON.stringify(sellerView.body),
    /PRIVATE|preimageXdr|claimToken|buyerSessionId/,
  );
  const path = `/api/recovery/${requestId}`;
  assert.equal(
    (await f.request(path + '/claim', { method: 'POST', body: {}, cookie: buyerCookie })).status,
    409,
  );
  const claim = await f.request(path + '/claim', {
    method: 'POST',
    body: {},
    cookie: sellerCookie,
  });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.claimToken, claimToken);
  assert.doesNotMatch(JSON.stringify(claim.body), /PRIVATE|internalSecret/);
  assert.equal(
    (await f.request(path + '/claim', { method: 'POST', body: {}, cookie: sellerCookie })).body
      .error,
    'RECOVERY_ALREADY_CLAIMED',
  );
  const signature = Buffer.from(bob.signMessage('public fixture')).toString('base64');
  assert.equal(
    (
      await f.request(path + '/respond', {
        method: 'POST',
        cookie: sellerCookie,
        body: { claimToken, signature, signerAddress: alice.publicKey() },
      })
    ).status,
    400,
  );
  assert.equal(delivered, null);
  assert.equal(
    (
      await f.request(path + '/respond', {
        method: 'POST',
        cookie: sellerCookie,
        body: { claimToken, signature, signerAddress: bob.publicKey() },
      })
    ).status,
    200,
  );
  assert.deepEqual(delivered, { claimToken, signature, signerAddress: bob.publicKey() });
  await f.request('/api/session', { method: 'DELETE', cookie: sellerCookie });
  assert.ok(ended.length > 0);
  assert.equal(
    (
      await f.request(path + '/respond', {
        method: 'POST',
        cookie: sellerCookie,
        body: { claimToken, error: 'RECOVERY_REJECTED' },
      })
    ).status,
    401,
  );
});

test('resolve dispatch binds the authenticated buyer and exposes only confirmed order results', async (t) => {
  let captured;
  const f = await fixture(t, {
    createServices: ({ account, sessionId, getOperationDeadline }) => ({
      async resolve(orderId, buyerTokens) {
        captured = { account, sessionId, deadline: getOperationDeadline(), orderId, buyerTokens };
        return {
          order: { ...order(account), state: 'Resolved' },
          transaction: confirmed,
          private: 'PRIVATE_AUTH',
        };
      },
    }),
  });
  const cookie = await f.login();
  const result = await f.poll(
    cookie,
    await f.start(cookie, 'resolve', { orderId: '7', buyerTokens: '0' }),
  );
  assert.equal(result.status, 'completed');
  assert.equal(result.result.order.state, 'Resolved');
  assert.equal(captured.account, alice.publicKey());
  assert.equal(captured.orderId, '7');
  assert.equal(captured.buyerTokens, '0');
  assert.match(captured.sessionId, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(captured.deadline > Date.now());
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|sessionId|deadline/);
  assert.equal(
    (
      await f.request('/api/commands', {
        method: 'POST',
        cookie,
        body: {
          action: 'resolve',
          args: { orderId: '7', buyerTokens: '0', seller: bob.publicKey() },
        },
      })
    ).status,
    400,
  );
});

const mainnetDeployment = () => ({
  network: 'mainnet',
  networkPassphrase: Networks.PUBLIC,
  contract,
  token: new Asset('USDC', bob.publicKey()).contractId(Networks.PUBLIC),
  tokenDecimals: 7,
  tokenLabel: 'USDC',
  asset: { code: 'USDC', issuer: bob.publicKey() },
});
const emptyView = (deployment) => ({
  configured: true,
  deployment,
  offers: [],
  ownerOrders: [],
  sellerDrafts: [],
  balances: null,
  serverTime: '150',
  unavailableReasons: [],
  readiness: { submission: false, paymentProof: false },
});

test('mainnet SDK session signature and wallet requests bind the exact issued asset and deployment', async (t) => {
  const configured = mainnetDeployment();
  const domain = readDeploymentDomain(configured);
  let factoryDeployment;
  const f = await fixture(t, {
    deployment: configured,
    readView: () => emptyView(configured),
    createServices: ({ wallet, account, deployment }) => {
      factoryDeployment = deployment;
      return {
        async connectWallet() {
          assert.equal(await wallet.network(), Networks.PUBLIC);
          await wallet.sign('dW5zaWduZWQ=', account);
          return { account, networkPassphrase: Networks.PUBLIC };
        },
      };
    },
  });
  const challenge = await f.challenge();
  assert.equal(challenge.network, 'mainnet');
  assert.equal(challenge.deploymentId, domain.deploymentId);
  assert.ok(challenge.message.includes(`Deployment: ${domain.deploymentId}`));
  assert.ok(challenge.message.includes(`Token: ${configured.token}`));
  const cookie = await f.login();
  assert.equal(
    (await f.request('/api/session', { cookie })).body.deploymentId,
    domain.deploymentId,
  );
  const view = await f.request('/api/view', { cookie });
  assert.deepEqual(view.body.deployment.asset, configured.asset);
  assert.equal(view.body.readiness.submission, false);
  const id = await f.start(cookie, 'connectWallet', { party: 'buyer' });
  const first = await f.poll(cookie, id, (value) => Boolean(value.walletRequest));
  assert.equal(
    (await f.reply(cookie, id, first.walletRequest.id, { result: Networks.TESTNET })).status,
    400,
  );
  assert.equal(
    (await f.reply(cookie, id, first.walletRequest.id, { result: Networks.PUBLIC })).status,
    200,
  );
  const second = await f.poll(cookie, id, (value) => Boolean(value.walletRequest));
  assert.deepEqual(second.walletRequest.args, {
    transactionXdr: 'dW5zaWduZWQ=',
    account: alice.publicKey(),
    ...domain,
  });
  assert.equal(
    (await f.reply(cookie, id, second.walletRequest.id, { result: 'c2lnbmVk' })).status,
    200,
  );
  assert.equal((await f.poll(cookie, id)).result.networkPassphrase, Networks.PUBLIC);
  assert.equal(factoryDeployment.deploymentId, domain.deploymentId);
});

test('SDK signatures for a different network or token cannot authenticate the configured mainnet session', async (t) => {
  const configured = mainnetDeployment();
  const f = await fixture(t, { deployment: configured });
  for (const alter of [
    (message) => message.replaceAll(Networks.PUBLIC, Networks.TESTNET),
    (message) => message.replaceAll(configured.token, contract),
  ]) {
    const challenge = await f.challenge();
    const response = await f.request('/api/session/verify', {
      method: 'POST',
      cookie: challenge.cookie,
      body: {
        challengeId: challenge.challengeId,
        signature: Buffer.from(alice.signMessage(alter(challenge.message))).toString('base64'),
      },
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'SIGNATURE_REJECTED');
  }
});

test('mainnet bridge refuses implicit networks and mismatched SAC identity; changed views cannot replace its domain', async (t) => {
  const configured = mainnetDeployment();
  for (const value of [
    { ...configured, network: undefined },
    { ...configured, asset: undefined },
    { ...configured, token: new Asset('USDC', bob.publicKey()).contractId(Networks.TESTNET) },
  ])
    assert.throws(() =>
      createBrowserBridge({
        publicOrigin: 'https://app.example.test',
        deployment: value,
        createServices: () => ({}),
      }),
    );
  let current = structuredClone(configured);
  const f = await fixture(t, { deployment: configured, readView: () => emptyView(current) });
  const cookie = await f.login();
  current.contract = Address.contract(Buffer.alloc(32, 0x75)).toString();
  const response = await f.request('/api/view', { cookie });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'DEPLOYMENT_CHANGED');
  assert.equal(
    (await f.request('/api/session', { cookie })).body.deploymentId,
    readDeploymentDomain(configured).deploymentId,
  );
});
