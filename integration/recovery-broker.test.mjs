import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Address,
  Keypair,
  Networks,
  authorizeEntry,
  hash,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { createRecoveryBroker, RECOVERY_ERROR_CODES } from './recovery-broker.mjs';

// Offline disposable identities and RPC ports. No real wallet or listener.
const buyer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x61));
const seller = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x62));
const stranger = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x63));
const deployment = {
  networkPassphrase: Networks.TESTNET,
  contract: Address.contract(Buffer.alloc(32, 5)).toString(),
  token: Address.contract(Buffer.alloc(32, 6)).toString(),
  tokenDecimals: 7,
};
const ids = Object.fromEntries(
  ['buyer', 'seller', 'seller2', 'stranger', 'buyer2'].map((name, i) => [
    name,
    Buffer.alloc(32, i + 1).toString('base64url'),
  ]),
);
const unsigned = (orderId = '7', buyerTokens = '400', options = {}) =>
  new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(options.seller ?? seller.publicKey()).toScAddress(),
        nonce: 42n,
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(options.contract ?? deployment.contract).toScAddress(),
          functionName: 'resolve',
          args: [
            nativeToScVal(BigInt(orderId), { type: 'u64' }),
            nativeToScVal(BigInt(buyerTokens), { type: 'i128' }),
          ],
        }),
      ),
      subInvocations: options.subInvocations ?? [],
    }),
  });
const signature = (claim, signer = seller) =>
  Buffer.from(
    signer.sign(hash(xdr.HashIdPreimage.fromXDR(claim.preimageXdr, 'base64').toXDR())),
  ).toString('base64');
const reply = (claim, signer = seller) => ({
  claimToken: claim.claimToken,
  signature: signature(claim, signer),
  signerAddress: signer.publicKey(),
});

function fixture(t, options = {}) {
  let now = 1_000,
    sequence = 100;
  const snapshot = (orderId) => ({
    confirmed: true,
    network_passphrase: Networks.TESTNET,
    contract: deployment.contract,
    config: { token: deployment.token },
    order: {
      id: orderId,
      state: 'Paying',
      buyer: buyer.publicKey(),
      terms: {
        seller: seller.publicKey(),
        token_amount: '1000',
        fiat_minor: '2000',
        currency: 'EUR',
        rail: 'revolut',
      },
    },
    privateSalt: 'PRIVATE_SALT',
    rawProof: 'PRIVATE_PROOF',
  });
  const broker = createRecoveryBroker({
    deployment,
    readOrder: async ({ orderId }) =>
      options.snapshot ? options.snapshot(snapshot(orderId)) : snapshot(orderId),
    getLatestLedger: async () => ({ sequence }),
    clock: () => now,
    ...options.config,
  });
  t.after(() => broker.close());
  const open = (name, key, expiresAt = 100_000) =>
    broker.openSession({ id: ids[name], account: key.publicKey(), expiresAt });
  open('buyer', buyer);
  open('seller', seller);
  async function publish({
    orderId = '7',
    buyerTokens = '400',
    deadline = 20_000,
    entry = unsigned(orderId, buyerTokens),
    mutate,
  } = {}) {
    const port = await broker.sellerPort({
      buyerSessionId: ids.buyer,
      orderId,
      buyerTokens,
      deadline,
    });
    assert.equal(await port.selected(), seller.publicKey());
    assert.equal(await port.network(), Networks.TESTNET);
    const request = {
      entryXdr: entry.toXDR('base64'),
      account: seller.publicKey(),
      networkPassphrase: Networks.TESTNET,
      expirationLedger: 112,
      contract: deployment.contract,
      orderId,
      buyerTokens,
      ...mutate,
    };
    const outcome = port.signAuthorization(request).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    // Let the trusted latest-ledger promise resolve and publish the request.
    await new Promise(setImmediate);
    return { port, request, outcome };
  }
  return {
    broker,
    publish,
    open,
    setNow(value) {
      now = value;
    },
    setLedger(value) {
      sequence = value;
    },
  };
}

test('queued context is public-only; seller signs actual preimage and broker returns SDK-identical authorization', async (t) => {
  const f = fixture(t);
  const pending = await f.publish();
  const [view] = await f.broker.list(ids.seller);
  assert.equal(view.status, 'queued');
  assert.equal(view.buyerTokens, '400');
  assert.equal(view.sellerTokens, '600');
  assert.equal(view.tokenAmount, '1000');
  assert.equal(view.fiatMinor, '2000');
  assert.equal(view.contract, deployment.contract);
  assert.equal(view.token, deployment.token);
  assert.equal(view.expiresAt, 20_000);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE|preimage|entryXdr|claimToken|Session/);
  for (const sessionId of Object.values(ids)) assert.ok(!JSON.stringify(view).includes(sessionId));
  const claim = await f.broker.claim(ids.seller, view.requestId);
  assert.equal(claim.status, 'claimed');
  assert.ok(claim.preimageXdr);
  assert.match(claim.claimToken, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await f.broker.respond(ids.seller, view.requestId, reply(claim)), {
    accepted: true,
  });
  const result = await pending.outcome;
  assert.equal(result.error, undefined);
  assert.equal(
    result.value,
    (await authorizeEntry(unsigned(), seller, 112, Networks.TESTNET)).toXDR('base64'),
  );
  assert.deepEqual(await f.broker.list(ids.seller), []);
  await assert.rejects(
    f.broker.respond(ids.seller, view.requestId, reply(claim)),
    /REQUEST_EXPIRED/,
  );
  await assert.rejects(pending.port.signAuthorization(pending.request), /REQUEST_EXPIRED/);
});

test('claims bind one authenticated seller session and one-use token, including same-account browsers', async (t) => {
  const f = fixture(t);
  f.open('seller2', seller);
  f.open('stranger', stranger);
  f.open('buyer2', buyer);
  const pending = await f.publish();
  const [view] = await f.broker.list(ids.seller);
  assert.deepEqual(await f.broker.list(ids.stranger), []);
  assert.deepEqual(await f.broker.list(ids.buyer2), []);
  await assert.rejects(f.broker.inspect(ids.stranger, view.requestId), /REQUEST_MISMATCH/);
  await assert.rejects(f.broker.claim(ids.buyer, view.requestId), /REQUEST_MISMATCH/);
  const results = await Promise.allSettled([
    f.broker.claim(ids.seller, view.requestId),
    f.broker.claim(ids.seller2, view.requestId),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results[0].status, 'fulfilled');
  const claim = results[0].value;
  await assert.rejects(f.broker.claim(ids.seller, view.requestId), /ALREADY_CLAIMED/);
  await assert.rejects(
    f.broker.respond(ids.seller2, view.requestId, reply(claim)),
    /REQUEST_MISMATCH/,
  );
  await assert.rejects(
    f.broker.respond(ids.seller, view.requestId, { ...reply(claim), claimToken: ids.stranger }),
    /REQUEST_MISMATCH/,
  );
  await f.broker.respond(ids.seller, view.requestId, reply(claim));
  assert.ok((await pending.outcome).value);
});

test('server validates unsigned root, split, party and network before any seller can inspect signing material', async (t) => {
  for (const options of [
    { entry: unsigned('8') },
    { entry: unsigned('7', '401') },
    { entry: unsigned('7', '400', { contract: deployment.token }) },
    { entry: unsigned('7', '400', { seller: stranger.publicKey() }) },
    { entry: unsigned('7', '400', { subInvocations: [unsigned().rootInvocation] }) },
    { mutate: { networkPassphrase: Networks.PUBLIC } },
    { mutate: { expirationLedger: 100 } },
  ]) {
    const f = fixture(t),
      pending = await f.publish(options);
    assert.match((await pending.outcome).error.code, /RECOVERY_REQUEST_(MISMATCH|EXPIRED)/);
    assert.deepEqual(await f.broker.list(ids.seller), []);
  }
  const f = fixture(t, {
    snapshot: (value) => ({ ...value, order: { ...value.order, buyer: stranger.publicKey() } }),
  });
  await assert.rejects(
    f.broker.sellerPort({
      buyerSessionId: ids.buyer,
      orderId: '7',
      buyerTokens: '400',
      deadline: 2000,
    }),
    /REQUEST_MISMATCH/,
  );
});

test('explicit UI/wallet refusal and unknown wallet outcomes consume only the claimed request', async (t) => {
  for (const [error, code] of [
    ['RECOVERY_REJECTED', 'RECOVERY_REJECTED'],
    ['WALLET_REJECTED', 'RECOVERY_REJECTED'],
    ['WALLET_OPERATION_UNKNOWN', 'RECOVERY_UNAVAILABLE'],
  ]) {
    const f = fixture(t),
      pending = await f.publish();
    const [view] = await f.broker.list(ids.seller),
      claim = await f.broker.claim(ids.seller, view.requestId);
    assert.deepEqual(
      await f.broker.respond(ids.seller, view.requestId, { claimToken: claim.claimToken, error }),
      { accepted: true },
    );
    assert.equal((await pending.outcome).error.code, code);
    await assert.rejects(
      f.broker.respond(ids.seller, view.requestId, reply(claim)),
      /REQUEST_EXPIRED/,
    );
  }
});

test('wrong signer, changed preimage and malformed signature never reach the collector', async (t) => {
  for (const mutate of [
    (claim) => reply(claim, stranger),
    (claim) => ({
      ...reply(claim),
      signature: Buffer.from(seller.sign(Buffer.alloc(32, 1))).toString('base64'),
    }),
    (claim) => ({ ...reply(claim), signature: 'not-a-signature' }),
  ]) {
    const f = fixture(t),
      pending = await f.publish();
    const [view] = await f.broker.list(ids.seller),
      claim = await f.broker.claim(ids.seller, view.requestId);
    await assert.rejects(
      f.broker.respond(ids.seller, view.requestId, mutate(claim)),
      /SIGNATURE_INVALID/,
    );
    assert.equal((await pending.outcome).error.code, 'RECOVERY_SIGNATURE_INVALID');
    assert.deepEqual(await f.broker.list(ids.seller), []);
  }
});

test('request deadline and exclusive ledger expiry are rechecked at claim/reply', async (t) => {
  const f = fixture(t),
    pending = await f.publish({ deadline: 2000 });
  const [view] = await f.broker.list(ids.seller);
  f.setNow(2000);
  await assert.rejects(f.broker.claim(ids.seller, view.requestId), /REQUEST_EXPIRED/);
  assert.equal((await pending.outcome).error.code, 'RECOVERY_REQUEST_EXPIRED');
  const g = fixture(t),
    waiting = await g.publish();
  const [visible] = await g.broker.list(ids.seller),
    claim = await g.broker.claim(ids.seller, visible.requestId);
  g.setLedger(112);
  await assert.rejects(
    g.broker.respond(ids.seller, visible.requestId, reply(claim)),
    /REQUEST_EXPIRED/,
  );
  assert.equal((await waiting.outcome).error.code, 'RECOVERY_REQUEST_EXPIRED');
});

test('claim can shorten expiry; buyer or claimed seller logout cancels pending authorization', async (t) => {
  for (const owner of ['buyer', 'seller']) {
    const f = fixture(t);
    f.broker.closeSession(ids.seller);
    f.open('seller', seller, 1500);
    const pending = await f.publish(),
      [view] = await f.broker.list(ids.seller);
    const claim = await f.broker.claim(ids.seller, view.requestId);
    assert.equal(claim.expiresAt, 1500);
    f.broker.closeSession(ids[owner]);
    assert.equal((await pending.outcome).error.code, 'RECOVERY_SESSION_INVALID');
    await assert.rejects(
      f.broker.respond(ids.seller, view.requestId, reply(claim)),
      /SESSION_INVALID|REQUEST_EXPIRED/,
    );
  }
});

test('session loss while the authoritative order read is pending cannot create a late request', async (t) => {
  let complete;
  const f = fixture(t, {
    snapshot: (value) =>
      new Promise((resolve) => {
        complete = () => resolve(value);
      }),
  });
  const port = f.broker.sellerPort({
    buyerSessionId: ids.buyer,
    orderId: '7',
    buyerTokens: '400',
    deadline: 2000,
  });
  const outcome = assert.rejects(port, /SESSION_INVALID/);
  f.broker.closeSession(ids.buyer);
  complete();
  await outcome;
  assert.deepEqual(await f.broker.list(ids.seller), []);
});

test('broker bounds sessions/requests and a real timer expires a pending seller wait', async (t) => {
  const f = fixture(t, { config: { maxSessions: 2, maxRequests: 1 } });
  assert.throws(() => f.open('seller2', seller), /CAPACITY/);
  const pending = await f.publish(),
    second = await f.publish({ orderId: '8' });
  assert.equal((await second.outcome).error.code, 'RECOVERY_CAPACITY');
  f.broker.close();
  assert.equal((await pending.outcome).error.code, 'RECOVERY_CLOSED');
  await assert.rejects(f.broker.list(ids.seller), /CLOSED/);
  const g = fixture(t, { config: { requestTtlMs: 20 } }),
    timeout = await g.publish();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await timeout.outcome).error.code, 'RECOVERY_REQUEST_EXPIRED');
  assert.ok(RECOVERY_ERROR_CODES.includes('RECOVERY_REQUEST_EXPIRED'));
});
