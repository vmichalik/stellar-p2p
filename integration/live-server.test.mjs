import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Address, Keypair, Networks } from '@stellar/stellar-sdk';
import { createLiveServer } from './live-server.mjs';

// Actual loopback HTTP with synthetic runtime data and disposable wallet keys.
const alice = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x61));
const bob = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x62));
const contract = Address.contract(Buffer.alloc(32, 5)).toString();
const token = Address.contract(Buffer.alloc(32, 6)).toString();
const terms = (seller) => ({
  seller,
  token_amount: '220000000',
  fiat_minor: '2000',
  currency: 'EUR',
  rail: 'revolut',
  recipient: '09'.repeat(32),
  offer_expires_at: '2000',
  reservation_seconds: '100',
});
function view(account) {
  return {
    configured: true,
    deployment: {
      networkPassphrase: Networks.TESTNET,
      contract,
      token,
      tokenDecimals: 7,
      tokenLabel: 'Synthetic test token',
      rpcUrl: 'SYNTHETIC_PRIVATE_RPC',
    },
    serverTime: '1000',
    offers: [
      {
        id: '0',
        seller: bob.publicKey(),
        tokenAmount: '220000000',
        fiatMinor: '2000',
        currency: 'EUR',
        rail: 'revolut',
        offerExpiresAt: '2000',
        recipientCommitment: '09'.repeat(32),
        recipientSalt: 'SYNTHETIC_PRIVATE_SALT',
      },
    ],
    ownerOrders: account
      ? [
          {
            id: '1',
            state: 'Paying',
            buyer: account,
            terms: { ...terms(bob.publicKey()), privateNote: 'SYNTHETIC_PRIVATE_NOTE' },
            reserved_at: '980',
            locked_at: '990',
            pay_by: '1100',
            offerData: { recipientSalt: 'SYNTHETIC_PRIVATE_SALT' },
          },
        ]
      : [],
    sellerDrafts: account
      ? [{ id: 'draft', publicTerms: terms(account), privateNote: 'SYNTHETIC_PRIVATE_NOTE' }]
      : [],
    balances: { tokenAtoms: '9007199254740993', privateNote: 'SYNTHETIC_PRIVATE_NOTE' },
    unavailableReasons: ['PAYMENT_VERIFICATION_UNAVAILABLE'],
    readiness: { paymentProof: false, submission: false, recovery: false },
    credentials: 'SYNTHETIC_PRIVATE_CREDENTIAL',
  };
}
async function fixture(t, overrides = {}) {
  let app;
  const owners = [],
    serviceAccounts = [];
  let closes = 0;
  const runtime = {
    readView: async ({ account }) => {
      owners.push(account);
      return view(account);
    },
    createServices: ({ account }) => {
      serviceAccounts.push(account);
      return { getOrder: async () => view(account).ownerOrders[0] };
    },
    close: () => {
      closes++;
    },
    ...overrides,
  };
  const server = createServer((req, res) => app.handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const publicOrigin = `http://127.0.0.1:${server.address().port}`;
  app = await createLiveServer({
    publicOrigin,
    runtime,
    walletConnect: overrides.walletConnect ?? {},
  });
  t.after(async () => {
    app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        publicOrigin + path,
        {
          method,
          headers: {
            ...(method === 'GET' || method === 'HEAD' ? {} : { Origin: publicOrigin }),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers,
          },
        },
        (res) => {
          const parts = [];
          res.on('data', (part) => parts.push(part));
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }),
          );
        },
      );
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  async function login(key = alice) {
    const challenge = await request('/api/session/challenge', {
      method: 'POST',
      body: { account: key.publicKey() },
    });
    assert.equal(challenge.status, 200);
    const value = JSON.parse(challenge.body);
    const verified = await request('/api/session/verify', {
      method: 'POST',
      cookie: challenge.headers['set-cookie'][0].split(';')[0],
      body: {
        challengeId: value.challengeId,
        signature: Buffer.from(key.signMessage(value.message)).toString('base64'),
      },
    });
    assert.equal(verified.status, 200);
    return verified.headers['set-cookie'][0].split(';')[0];
  }
  return { app, runtime, request, login, owners, serviceAccounts, closes: () => closes };
}

test('serves only the live asset allowlist and exact installed Freighter bytes with same-origin headers', async (t) => {
  const f = await fixture(t);
  for (const path of [
    '/',
    '/live-app.mjs',
    '/live-view-adapter.mjs',
    '/host-client.mjs',
    '/freighter-connector.mjs',
    '/wallet-dialog.mjs',
    '/wallet-setup.mjs',
    '/wallet',
    '/wallet-config.json',
    '/styles.css',
    '/live-styles.css',
    '/assets/fonts/manrope.woff2',
    '/vendor/freighter-api.js',
  ]) {
    const result = await f.request(path);
    assert.equal(result.status, 200, path);
    assert.ok(result.body.length > 0);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['referrer-policy'], 'no-referrer');
    assert.match(result.headers['content-security-policy'], /connect-src 'self'/);
    assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  const head = await f.request('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  const vendor = await f.request('/vendor/freighter-api.js');
  const installed = await readFile(
    new URL('node_modules/@stellar/freighter-api/build/index.min.js', import.meta.url),
  );
  assert.deepEqual(vendor.body, installed);
  assert.equal(createHash('sha256').update(vendor.body).digest('hex'), f.app.freighterSha256);
});

test('denies repository/private paths, alternate origins and static mutations', async (t) => {
  const f = await fixture(t);
  for (const path of [
    '/package.json',
    '/.env',
    '/integration/host-runtime.mjs',
    '/app/model.test.mjs',
    '/node_modules/@stellar/freighter-api/package.json',
    '/.private/orders.sqlite',
    '/%2e%2e/integration/host-runtime.mjs',
    '/styles.css?secret=synthetic',
    '/demo-adapter.mjs',
  ]) {
    const response = await f.request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body.toString(), 'Not found');
  }
  assert.equal((await f.request('/', { headers: { Host: 'other.example.test' } })).status, 403);
  assert.equal((await f.request('/', { method: 'POST', body: {} })).status, 403);
  assert.equal(
    (await f.request('/api/view', { headers: { Origin: 'https://other.example.test' } })).status,
    403,
  );
  assert.equal((await f.request('/api/view?account=' + alice.publicKey())).status, 404);
});

test('public views strip private fields and authenticated owner identity comes only from the signed session', async (t) => {
  const f = await fixture(t);
  const anonymous = JSON.parse((await f.request('/api/view')).body);
  assert.equal(anonymous.account, null);
  assert.equal(anonymous.balances, null);
  assert.deepEqual(anonymous.ownerOrders, []);
  assert.deepEqual(anonymous.sellerDrafts, []);
  assert.doesNotMatch(
    JSON.stringify(anonymous),
    /SYNTHETIC_PRIVATE|recipientSalt|credentials|rpcUrl/,
  );
  const cookie = await f.login();
  const own = JSON.parse((await f.request('/api/view', { cookie })).body);
  assert.equal(own.account, alice.publicKey());
  assert.equal(own.ownerOrders[0].buyer, alice.publicKey());
  assert.equal(own.sellerDrafts[0].publicTerms.seller, alice.publicKey());
  assert.equal(own.balances.tokenAtoms, '9007199254740993');
  assert.doesNotMatch(
    JSON.stringify(own),
    /SYNTHETIC_PRIVATE|recipientSalt|privateNote|offerData|credentials|rpcUrl/,
  );
  assert.deepEqual(f.owners, [null, alice.publicKey()]);
  assert.equal(
    (
      await f.request('/api/commands', {
        method: 'POST',
        body: { action: 'getOrder', args: { orderId: '1' } },
      })
    ).status,
    401,
  );
  const started = await f.request('/api/commands', {
    method: 'POST',
    cookie,
    body: { action: 'getOrder', args: { orderId: '1' } },
  });
  assert.equal(started.status, 202);
  const operationId = JSON.parse(started.body).operationId;
  const completed = JSON.parse(
    (await f.request('/api/operations/' + operationId, { cookie })).body,
  );
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.buyer, alice.publicKey());
  assert.deepEqual(f.serviceAccounts, [alice.publicKey()]);
  assert.doesNotMatch(
    JSON.stringify(completed),
    /SYNTHETIC_PRIVATE|recipientSalt|privateNote|offerData/,
  );
});

test('runtime errors and cross-owner view mistakes do not leak private values', async (t) => {
  const failed = await fixture(t, {
    readView: async () => {
      throw Error('SYNTHETIC_PRIVATE_RPC_ERROR');
    },
  });
  const unavailable = await failed.request('/api/view');
  assert.equal(unavailable.status, 500);
  assert.deepEqual(JSON.parse(unavailable.body), { error: 'BRIDGE_UNAVAILABLE' });
  const wrongOwner = await fixture(t, {
    readView: async ({ account }) => {
      const value = view(account);
      if (account) value.ownerOrders[0].buyer = bob.publicKey();
      return value;
    },
  });
  const cookie = await wrongOwner.login();
  const rejected = await wrongOwner.request('/api/view', { cookie });
  assert.equal(rejected.status, 400);
  assert.doesNotMatch(
    rejected.body.toString(),
    /SYNTHETIC_PRIVATE|recipientSalt|privateNote|offerData/,
  );
});

test('mobile assets are opt-in, locally bundled and do not widen the default CSP', async (t) => {
  const off = await fixture(t);
  assert.equal((await off.request('/vendor/walletconnect.mjs')).status, 404);
  const config = await off.request('/wallet-config.json');
  assert.equal(JSON.parse(config.body.toString()).enabled, false);
  assert.doesNotMatch(config.headers['content-security-policy'], /relay.walletconnect/);
  const enabled = await fixture(t, { walletConnect: { projectId: 'a'.repeat(32) } });
  const bundle = await enabled.request('/vendor/walletconnect.mjs');
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers['content-security-policy'], /wss:\/\/relay.walletconnect.com/);
  assert.doesNotMatch(bundle.headers['content-security-policy'], /connect-src \*/);
  const publicConfig = JSON.parse((await enabled.request('/wallet-config.json')).body.toString());
  assert.equal(publicConfig.enabled, true);
  assert.deepEqual(Object.keys(publicConfig).sort(), ['appUrl', 'enabled', 'projectId']);
});
