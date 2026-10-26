import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { createHostRuntime, unconfiguredView } from './host-runtime.mjs';
import { createLivePaymentSupport } from './live-payments.mjs';
import { createEd25519SigningAdapter, createTlsnEvidenceStore } from '../policy/src/index.mjs';
import { normalizedVerifiedPayment } from '../policy/src/tlsn-store.mjs';
import { payload, now } from '../policy/test/fixtures/tlsn-record.mjs';
import {
  fixture,
  alice,
  bob,
  other,
  deployment,
  terms,
  order,
} from './test-fixtures/host-runtime.mjs';

test('seller creates distinct durable private drafts; funding visibility and wallet boundaries survive restart', async (t) => {
  const key = Keypair.random();
  const signer = createEd25519SigningAdapter({
    publicKeyHex: Buffer.from(key.rawPublicKey()).toString('hex'),
    signDigest: async (digest) => key.sign(digest),
  });
  const cfg = { ...deployment, policySignerPublicKeyHex: signer.publicKeyHex };
  const f = fixture(t, { deployment: cfg });
  const evidence = createTlsnEvidenceStore({
    path: join(f.storageDirectory, '..', 'evidence.sqlite'),
    ingressSecret: 'ab'.repeat(32),
    clock: () => now,
  });
  const receipt = evidence.ingest({
    authorization: 'Bearer ' + 'ab'.repeat(32),
    payload: payload(),
  });
  const record = normalizedVerifiedPayment(evidence.reader.readVerifiedRecord(receipt.evidenceId));
  const support = createLivePaymentSupport({
    binding: {
      network: 'testnet',
      token: cfg.token,
      seller: alice,
      buyer: bob,
      recipientId: record.recipientId,
      payerScope: record.payerScope,
      recipientSalt: '33'.repeat(32),
      destination: '@synthetic',
      evidenceId: receipt.evidenceId,
      tokenAmount: '10000000',
      fiatMinor: '89',
    },
    evidenceReader: evidence.reader,
    signer,
    authorizationPath: join(f.storageDirectory, '..', 'authorizations.sqlite'),
    proofHealth: async () => true,
    clock: () => '1010',
  });
  t.after(() => {
    support.close();
    evidence.close();
  });
  const options = {
    paymentSupport: support,
    offerReader: undefined,
    replayStorePath: join(f.storageDirectory, '..', 'replay.sqlite'),
    sellerDrafts: [],
    orderIds: [],
  };
  let runtime = f.create(options);
  const seller = await runtime.createServices({ account: alice, wallet: f.wallet });
  const buyer = await runtime.createServices({ account: bob, wallet: f.wallet });
  const args = { tokenAmount: '10000000', fiatMinor: '89' };
  await assert.rejects(buyer.createOffer(args), /OFFER_CREATION_UNAVAILABLE/);
  await assert.rejects(seller.createOffer({ ...args, seller: bob }), /INVALID_OFFER_AMOUNT/);
  await assert.rejects(
    seller.createOffer({ ...args, tokenAmount: '10000001' }),
    /OFFER_AMOUNT_LIMIT/,
  );
  const first = await seller.createOffer(args);
  const second = await seller.createOffer(args);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.publicTerms.offer_expires_at, second.publicTerms.offer_expires_at);
  assert.equal(first.publicTerms.seller, alice);
  assert.equal(first.publicTerms.recipient, support.recipientCommitment);
  assert.deepEqual((await runtime.readView()).offers, []);
  assert.deepEqual((await runtime.readView({ account: bob })).sellerDrafts, []);
  assert.equal((await runtime.readView({ account: bob })).capabilities.createOffers, false);
  assert.equal((await runtime.readView({ account: alice })).capabilities.createOffers, true);
  runtime.close();
  runtime = f.create(options);
  assert.deepEqual((await runtime.readView({ account: alice })).sellerDrafts, [first, second]);
  const resumed = await runtime.createServices({ account: alice, wallet: f.wallet });
  await assert.rejects(
    resumed.fund({ ...first.publicTerms, recipient: '00'.repeat(32) }),
    /OFFER_NOT_APPROVED/,
  );
  assert.equal(f.counts.sign, 0);
  assert.equal(f.counts.submit, 0);
  runtime.close();
  f.orders.set('4', { ...order('4', 'Funded', alice), terms: first.publicTerms });
  runtime = f.create({ ...options, orderIds: ['4'] });
  assert.deepEqual((await runtime.readView({ account: alice })).sellerDrafts, [second]);
  assert.deepEqual(
    (await runtime.readView()).offers.map((offer) => offer.id),
    ['4'],
  );
});

test('unconfigured runtime exposes empty unavailable state and never creates a service', async () => {
  const runtime = createHostRuntime();
  const view = await runtime.readView();
  assert.deepEqual(
    { ...view, serverTime: 'ignored' },
    { ...unconfiguredView(), serverTime: 'ignored' },
  );
  assert.equal(view.configured, false);
  assert.deepEqual(view.offers, []);
  assert.equal(view.balances, null);
  assert.deepEqual(view.readiness, { paymentProof: false, submission: false, recovery: false });
  assert.throws(() => runtime.createServices({ account: alice }), /HOST_NOT_CONFIGURED/);
  runtime.close();
  runtime.close();
});

test('invalid deployment/catalog configuration fails before creating private storage', (t) => {
  const f = fixture(t);
  for (const invalid of [
    { deployment: { ...deployment, networkPassphrase: Networks.PUBLIC } },
    { deployment: { ...deployment, maxFeeStroops: '0x10' } },
    { deployment: { ...deployment, tokenDecimals: 6 } },
    { orderIds: ['01'] },
    { orderIds: ['18446744073709551616'] },
    { deploymentLedger: '0' },
    { deploymentLedger: '90.1' },
    {
      sellerDrafts: [
        { id: 'bad', publicTerms: { ...terms(), recipientSalt: 'SYNTHETIC_PRIVATE_SALT' } },
      ],
    },
  ]) {
    assert.throws(() => f.create(invalid), undefined, JSON.stringify(invalid));
    assert.equal(
      existsSync(f.storageDirectory),
      false,
      'Invalid configuration must fail before any SQLite directory is created',
    );
  }
  assert.equal(f.counts.network, 0);
  assert.equal(f.counts.sign, 0);
  assert.equal(f.counts.submit, 0);
});

test('public and owner views derive exact chain amounts and reveal only that owner’s approved drafts', async (t) => {
  const f = fixture(t),
    runtime = f.create();
  assert.equal(f.counts.network, 0, 'Boot must not contact RPC');
  const anonymous = await runtime.readView();
  const initialLedgerReads = f.counts.ledger;
  assert.deepEqual(
    anonymous.offers.map((row) => row.id),
    ['0'],
  );
  assert.deepEqual(anonymous.ownerOrders, []);
  assert.deepEqual(anonymous.sellerDrafts, []);
  assert.equal(anonymous.balances, null);
  const own = await runtime.readView({ account: alice });
  assert.deepEqual(
    own.ownerOrders.map((row) => row.id),
    ['0', '1'],
  );
  assert.deepEqual(own.sellerDrafts, [{ id: f.own.id, publicTerms: f.own.publicTerms }]);
  assert.deepEqual(own.balances, { tokenAtoms: '9007199254740993' });
  assert.equal(own.readiness.paymentProof, false);
  assert.equal(own.readiness.submission, false);
  assert.equal(own.readiness.recovery, false);
  assert.equal(f.counts.privateReads, 0);
  assert.doesNotMatch(
    JSON.stringify(own),
    /SYNTHETIC_PRIVATE|recipientSalt|rpcUrl|policySignerPublicKeyHex|escrowWasmSha256/,
  );
  assert.equal(
    f.counts.ledger,
    initialLedgerReads,
    'The second view should reuse coherent cached deployment/order snapshots',
  );
  assert.equal(statSync(f.storageDirectory).mode & 0o777, 0o700);
  assert.equal(statSync(join(f.storageDirectory, 'orders.sqlite')).mode & 0o777, 0o600);
});

test('runtime fails closed for unavailable RPC without manufacturing offers, balances or proof readiness', async (t) => {
  const f = fixture(t, { unavailable: true }),
    runtime = f.create();
  const view = await runtime.readView({ account: alice });
  assert.deepEqual(view.offers, []);
  assert.deepEqual(view.ownerOrders, []);
  assert.equal(view.balances, null);
  assert.ok(view.unavailableReasons.includes('CHAIN_UNAVAILABLE'));
  assert.ok(view.unavailableReasons.includes('BALANCE_UNAVAILABLE'));
  assert.equal(view.readiness.paymentProof, false);
  assert.doesNotMatch(JSON.stringify(view), /SYNTHETIC_PRIVATE_RPC_FAILURE/);
});

test('session services reject unapproved funding and payment locks; disabled submission never prompts or submits', async (t) => {
  const f = fixture(t),
    runtime = f.create();
  const services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await assert.rejects(services.fund(terms(alice, { token_amount: '1' })), /OFFER_NOT_APPROVED/);
  await assert.rejects(services.beginPayment('1'), /PAYMENT_VERIFICATION_UNAVAILABLE/);
  await services.connectWallet('seller');
  await assert.rejects(services.fund(f.own.publicTerms), /TESTNET_SUBMISSION_NOT_AUTHORIZED/);
  assert.deepEqual(await services.getPolicyStatus('1'), { orderId: '1', status: 'unavailable' });
  assert.equal(f.counts.sign, 0);
  assert.equal(f.counts.submit, 0);
  assert.equal(f.counts.privateReads, 0);
  runtime.close();
  runtime.close();
  await assert.rejects(
    runtime.createServices({ account: alice, wallet: f.wallet }),
    /AUTHENTICATION_REQUIRED|HOST_CLOSED/,
  );
});

test('one missing configured order does not hide independently verified offers or owner orders', async (t) => {
  const f = fixture(t, { missingOrder: '2' }),
    runtime = f.create();
  const result = await runtime.readView({ account: alice });
  assert.deepEqual(
    result.offers.map((item) => item.id),
    ['0'],
  );
  assert.deepEqual(
    result.ownerOrders.map((item) => item.id),
    ['0', '1'],
  );
  assert.ok(result.unavailableReasons.includes('ORDER_UNAVAILABLE'));
  assert.equal(result.unavailableReasons.includes('CHAIN_UNAVAILABLE'), false);
});

test('a full durable catalog refuses an additional funding action before any wallet call', async (t) => {
  const f = fixture(t);
  let runtime = f.create({
    orderIds: Array.from({ length: 64 }, (_, index) => String(index)),
    submissionEnabled: true,
  });
  let services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await assert.rejects(services.fund(f.own.publicTerms), /CATALOG_LIMIT/);
  assert.deepEqual(f.counts.walletCalls, []);
  assert.equal(f.counts.submit, 0);
  runtime.close();
  runtime = f.create({ orderIds: [], submissionEnabled: true });
  services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await assert.rejects(services.fund(f.own.publicTerms), /CATALOG_LIMIT/);
  assert.deepEqual(f.counts.walletCalls, []);
  assert.equal(f.counts.submit, 0);
});

test('wrong deployed WASM rejects the first funding action even when the order catalog is empty', async (t) => {
  const f = fixture(t, { wasm: 'ff'.repeat(32) });
  const runtime = f.create({ orderIds: [], submissionEnabled: true });
  const services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await assert.rejects(services.fund(f.own.publicTerms), /DEPLOYMENT_UNAVAILABLE/);
  assert.deepEqual(f.counts.walletCalls, []);
  assert.equal(f.counts.submit, 0);
  const result = await runtime.readView();
  assert.ok(result.unavailableReasons.includes('CHAIN_UNAVAILABLE'));
  assert.deepEqual(result.offers, []);
});

test('a confirmed refund records exact transaction metadata across restart only for its owners and matching state', async (t) => {
  const f = fixture(t);
  const current = order('4', 'Reserved', bob, alice);
  current.pay_by = '1000';
  f.orders.set('4', current);
  let signed;
  f.server.prepareTransaction = async (tx) => tx;
  f.server.sendTransaction = async (tx) => {
    f.counts.submit++;
    signed = tx;
    current.state = 'Refunded';
    return { status: 'PENDING', hash: Buffer.from(tx.hash()).toString('hex') };
  };
  f.server.getTransaction = async () => ({
    status: 'SUCCESS',
    ledger: 100,
    envelopeXdr: signed.toEnvelope(),
  });
  f.wallet.sign = async (value) => {
    f.counts.sign++;
    const tx = TransactionBuilder.fromXDR(value, Networks.TESTNET);
    tx.sign(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x61)));
    return tx.toXDR();
  };
  let runtime = f.create({ orderIds: ['4'], submissionEnabled: true });
  const services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await services.connectWallet('buyer');
  const result = await services.refundExpiredReservation('4');
  assert.equal(result.order.state, 'Refunded');
  assert.equal(f.counts.sign, 1);
  assert.equal(f.counts.submit, 1);
  assert.deepEqual(
    (await runtime.readView({ account: alice })).ownerOrders[0].lastConfirmedTransaction,
    result.transaction,
  );
  runtime.close();
  runtime = f.create({ orderIds: [], sellerDrafts: [] });
  assert.deepEqual(
    (await runtime.readView({ account: alice })).ownerOrders[0].lastConfirmedTransaction,
    result.transaction,
  );
  assert.deepEqual(
    (await runtime.readView({ account: bob })).ownerOrders[0].lastConfirmedTransaction,
    result.transaction,
  );
  assert.deepEqual((await runtime.readView({ account: other })).ownerOrders, []);
  assert.deepEqual((await runtime.readView()).ownerOrders, []);
  runtime.close();
  current.state = 'Reserved';
  runtime = f.create({ orderIds: [], sellerDrafts: [] });
  assert.equal(
    (await runtime.readView({ account: alice })).ownerOrders[0].lastConfirmedTransaction,
    undefined,
  );
  assert.equal(f.counts.submit, 1, 'Reload/readback must never submit another transaction');
});
