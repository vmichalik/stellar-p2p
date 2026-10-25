import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { Address, Keypair, Networks } from '@stellar/stellar-sdk';
import { createBrowserBridge } from './browser-bridge.mjs';

// Disposable, public fixture keys. Every HTTP request stays on the loopback
// server below; no wallet extension, bank, RPC or funded account is used.
const alice = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x61));
const bob = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x62));
const contract = Address.contract(Buffer.alloc(32, 0x63)).toString();
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
  bridge = createBrowserBridge({ publicOrigin, createServices: () => ({}), ...options });
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
          networkPassphrase: Networks.TESTNET,
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
  assert.equal((await f.poll(cookie, id)).error, 'WALLET_REJECTED');
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
