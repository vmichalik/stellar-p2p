import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, Address, Networks } from '@stellar/stellar-sdk';
import {
  createLivePaymentPolicy,
  createEd25519SigningAdapter,
  ReplayStore,
  escrowDomainKey,
  orderBinding,
  claimDigest,
  recipientCommitment,
  paymentNullifier,
} from '../src/index.mjs';
import { createSyntheticPaymentPolicy, SYNTHETIC_PUBLIC_KEY_HEX } from '../src/testing.mjs';
import { makePolicy } from '../src/engine.mjs';
import { validateSyntheticPayment } from '../src/evidence.mjs';

const address = (byte, contract = false) =>
  (contract ? Address.contract : Address.account)(Buffer.alloc(32, byte)).toString();
const domain = { network_passphrase: Networks.TESTNET, contract: address(5, true) };
const paymentId = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const payment = {
    kind: 'SYNTHETIC_PAYMENT_FIXTURE_V1',
    serverName: 'app.revolut.com',
    method: 'GET',
    requestPath: `/api/retail/transaction/${paymentId}`,
    httpStatus: 200,
    rail: 'revolut',
    currency: 'EUR',
    amountUnit: 'EUR_CENTS',
    amountMinor: '2000',
    state: 'COMPLETED',
    direction: 'OUTGOING',
    transactionType: 'REVOLUT_TO_REVOLUT',
    recipientId: 'synthetic-recipient',
    payerScope: 'synthetic-payer-account',
    paymentId,
    completedAt: '980',
  };
  const salt = '33'.repeat(32);
  const snapshot = {
    ...domain,
    confirmed: true,
    ledgerTimestamp: '1000',
    ledgerSequence: '100',
    paymentUsed: false,
    config: { token: address(6, true), signer: SYNTHETIC_PUBLIC_KEY_HEX },
    offerData: { recipientSalt: salt },
    order: {
      id: '1',
      state: 'Paying',
      buyer: address(2),
      reserved_at: '900',
      locked_at: '950',
      pay_by: '1100',
      terms: {
        seller: address(1),
        token_amount: '220000000',
        fiat_minor: '2000',
        currency: 'EUR',
        rail: 'revolut',
        recipient: recipientCommitment({
          recipient_id: payment.recipientId,
          recipient_salt: salt,
        }).toString('hex'),
        offer_expires_at: '1200',
        reservation_seconds: '200',
      },
    },
  };
  return { payment, snapshot };
}
function harness({
  payment,
  snapshot,
  store,
  clock = () => '1000',
  targetDomain = domain,
  manualManifests = {},
} = {}) {
  const f = fixture();
  store ??= new ReplayStore(':memory:', { syntheticOnly: true });
  store.advanceCheckpoint(escrowDomainKey(targetDomain), '100');
  const s = snapshot || f.snapshot;
  return {
    store,
    policy: createSyntheticPaymentPolicy({
      domain: targetDomain,
      store,
      clock,
      snapshots: { [s.order.id]: s },
      evidence: { e1: payment || f.payment },
      manualManifests,
    }),
  };
}
const request = { orderId: '1', evidenceId: 'e1' };

test('exact whole-order claim and signature are built from server fixtures only', async () => {
  const { policy, store } = harness();
  try {
    const receipt = await policy.issue(request);
    assert.equal(receipt.syntheticOnly, true);
    assert.equal(receipt.kind, 'SYNTHETIC_POLICY_CLAIM_NOT_FOR_RELEASE');
    assert.equal(receipt.releaseGate, 'NOT_CLEARED');
    assert.equal(receipt.claim.fiat_minor, '2000');
    assert.equal(receipt.claim.token_amount, '220000000');
    assert.equal(receipt.claim.expires_at, '1120');
    assert.equal(
      claimDigest({ ...domain, claim: receipt.claim }).toString('hex'),
      receipt.digestHex,
    );
    assert.equal(Buffer.from(receipt.signatureHex, 'hex').length, 64);
    assert.doesNotMatch(JSON.stringify(receipt), /synthetic-recipient|synthetic-payer-account/);
  } finally {
    store.close();
  }
});

for (const [name, mutate, code] of [
  ['wrong host', (p) => (p.serverName = 'evil.example'), 'INVALID_PAYMENT_SOURCE'],
  ['wrong method', (p) => (p.method = 'POST'), 'INVALID_PAYMENT_SOURCE'],
  ['authentication failure', (p) => (p.httpStatus = 401), 'INVALID_PAYMENT_SOURCE'],
  ['wrong request identity', (p) => (p.requestPath += '?other=1'), 'PAYMENT_IDENTITY_MISMATCH'],
  ['incomplete payment', (p) => (p.state = 'PENDING'), 'INVALID_PAYMENT_STATE'],
  ['incoming transfer', (p) => (p.direction = 'INCOMING'), 'INVALID_PAYMENT_STATE'],
  ['wrong transaction type', (p) => (p.transactionType = 'CARD_PAYMENT'), 'INVALID_PAYMENT_STATE'],
  ['wrong currency', (p) => (p.currency = 'USD'), 'INVALID_PAYMENT_UNITS'],
  ['ambiguous amount units', (p) => (p.amountUnit = 'EUR_MAJOR'), 'INVALID_PAYMENT_UNITS'],
  ['wrong exact amount', (p) => (p.amountMinor = '1999'), 'AMOUNT_MISMATCH'],
  ['floating amount', (p) => (p.amountMinor = 20.0), 'INVALID_INTEGER'],
  ['negative debit is not normalized', (p) => (p.amountMinor = '-2000'), 'INVALID_INTEGER'],
  ['wrong recipient', (p) => (p.recipientId = 'other-recipient'), 'RECIPIENT_MISMATCH'],
  [
    'recipient is not normalized silently',
    (p) => (p.recipientId += ' '),
    'INVALID_PAYMENT_IDENTITY',
  ],
  ['missing payer scope', (p) => (p.payerScope = ''), 'INVALID_PAYMENT_IDENTITY'],
  ['payment before lock', (p) => (p.completedAt = '949'), 'PAYMENT_OUTSIDE_WINDOW'],
  ['payment at deadline', (p) => (p.completedAt = '1100'), 'PAYMENT_OUTSIDE_WINDOW'],
  ['future payment', (p) => (p.completedAt = '1001'), 'PAYMENT_OUTSIDE_WINDOW'],
  ['unbranded fixture', (p) => (p.kind = 'verified'), 'SYNTHETIC_EVIDENCE_REQUIRED'],
]) {
  test(`rejects ${name}`, async () => {
    const f = fixture();
    mutate(f.payment);
    const h = harness({ payment: f.payment });
    try {
      await assert.rejects(h.policy.issue(request), { code });
    } finally {
      h.store.close();
    }
  });
}
for (const [name, mutate, code] of [
  ['unconfirmed ledger', (s) => (s.confirmed = false), 'UNTRUSTED_ORDER_SNAPSHOT'],
  [
    'different network',
    (s) => (s.network_passphrase = Networks.PUBLIC),
    'UNTRUSTED_ORDER_SNAPSHOT',
  ],
  ['different contract', (s) => (s.contract = address(9, true)), 'UNTRUSTED_ORDER_SNAPSHOT'],
  ['stale ledger', (s) => (s.ledgerTimestamp = '939'), 'STALE_LEDGER_SNAPSHOT'],
  ['future ledger', (s) => (s.ledgerTimestamp = '1001'), 'STALE_LEDGER_SNAPSHOT'],
  ['unlocked reservation', (s) => (s.order.state = 'Reserved'), 'ORDER_NOT_PAYING'],
  ['already resolved', (s) => (s.order.state = 'Resolved'), 'ORDER_NOT_PAYING'],
  ['wrong configured key', (s) => (s.config.signer = '22'.repeat(32)), 'SIGNER_CONFIG_MISMATCH'],
  ['changed salt', (s) => (s.offerData.recipientSalt = '44'.repeat(32)), 'RECIPIENT_MISMATCH'],
  ['on-chain replay', (s) => (s.paymentUsed = true), 'PAYMENT_CONSUMED_ON_CHAIN'],
  ['invalid locked interval', (s) => (s.order.locked_at = '899'), 'INVALID_ORDER_WINDOW'],
]) {
  test(`rejects ${name}`, async () => {
    const f = fixture();
    mutate(f.snapshot);
    const h = harness({ snapshot: f.snapshot });
    try {
      await assert.rejects(h.policy.issue(request), { code });
    } finally {
      h.store.close();
    }
  });
}

test('caller cannot provide evidence, digest, order snapshot, claims or extra fields', async () => {
  const h = harness();
  try {
    for (const key of ['evidence', 'verified', 'digest', 'claim', 'snapshot', 'amount']) {
      await assert.rejects(h.policy.issue({ ...request, [key]: 'attacker-controlled' }), {
        code: 'INVALID_INPUT',
      });
    }
    await assert.rejects(h.policy.issue({ orderId: 1, evidenceId: 'e1' }), {
      code: 'INVALID_INTEGER',
    });
  } finally {
    h.store.close();
  }
});

test('proof may finish after deadline for an in-window payment', async () => {
  const f = fixture();
  f.snapshot.ledgerTimestamp = '1150';
  const h = harness({ snapshot: f.snapshot, clock: () => '1150' });
  try {
    assert.equal((await h.policy.issue(request)).claim.paid_at, '980');
  } finally {
    h.store.close();
  }
});

test('durable idempotency survives reopen, while other orders and deployments reject reuse', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-policy-'));
  const path = join(directory, 'registry.sqlite');
  let store = new ReplayStore(path, { syntheticOnly: true });
  try {
    const first = await harness({ store }).policy.issue(request);
    store.close();
    store = new ReplayStore(path, { syntheticOnly: true });
    const retry = await harness({ store, clock: () => '1010' }).policy.issue(request);
    assert.deepEqual(retry, first);
    const f = fixture();
    f.snapshot.order.id = '2';
    await assert.rejects(
      harness({ store, snapshot: f.snapshot }).policy.issue({ ...request, orderId: '2' }),
      { code: 'PAYMENT_ALREADY_BOUND' },
    );
    const otherDomain = { ...domain, contract: address(7, true) };
    f.snapshot.contract = otherDomain.contract;
    await assert.rejects(
      harness({ store, snapshot: f.snapshot, targetDomain: otherDomain }).policy.issue({
        ...request,
        orderId: '2',
      }),
      { code: 'PAYMENT_ALREADY_BOUND' },
    );
    const mainnetDomain = { ...domain, network_passphrase: Networks.PUBLIC };
    const mainnet = fixture().snapshot;
    mainnet.network_passphrase = Networks.PUBLIC;
    assert.equal(store.readCheckpoint(escrowDomainKey(mainnetDomain)), null);
    assert.throws(() => store.assertReconciled(escrowDomainKey(mainnetDomain), '100'), {
      code: 'CHAIN_RECONCILIATION_BEHIND',
    });
    await assert.rejects(
      harness({ store, snapshot: mainnet, targetDomain: mainnetDomain }).policy.issue(request),
      { code: 'PAYMENT_ALREADY_BOUND' },
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an expired signed claim remains bound and needs reconciliation to renew', async () => {
  const store = new ReplayStore(':memory:', { syntheticOnly: true });
  try {
    await harness({ store }).policy.issue(request);
    const f = fixture();
    f.snapshot.ledgerTimestamp = '1120';
    await assert.rejects(
      harness({ store, snapshot: f.snapshot, clock: () => '1120' }).policy.issue(request),
      { code: 'CLAIM_RENEWAL_REQUIRES_RECONCILIATION' },
    );
  } finally {
    store.close();
  }
});

test('a second payment cannot create a different claim for the same whole order', async () => {
  const store = new ReplayStore(':memory:', { syntheticOnly: true });
  try {
    await harness({ store }).policy.issue(request);
    const f = fixture();
    f.payment.paymentId = f.payment.paymentId.replace(/1$/, '2');
    f.payment.requestPath = `/api/retail/transaction/${f.payment.paymentId}`;
    await assert.rejects(harness({ store, payment: f.payment }).policy.issue(request), {
      code: 'ORDER_ALREADY_BOUND',
    });
  } finally {
    store.close();
  }
});

test('signer failure leaves a durable reservation and sanitized error', async () => {
  const f = fixture();
  const store = new ReplayStore(':memory:', { syntheticOnly: true });
  store.advanceCheckpoint(escrowDomainKey(domain), '100');
  const signer = {
    syntheticOnly: true,
    publicKeyHex: SYNTHETIC_PUBLIC_KEY_HEX,
    signDigest: async () => {
      throw new Error('private-token-bank-id');
    },
  };
  const policy = makePolicy({
    domain,
    store,
    signer,
    syntheticOnly: true,
    clock: () => '1000',
    normalize: validateSyntheticPayment,
    loadEvidence: async () => f.payment,
    ledgerReader: { readOrder: async () => f.snapshot },
  });
  try {
    await assert.rejects(
      policy.issue(request),
      (error) => error.code === 'POLICY_ADAPTER_FAILED' && !error.message.includes('private-token'),
    );
    f.snapshot.order.id = '2';
    await assert.rejects(
      harness({ store, snapshot: f.snapshot }).policy.issue({ ...request, orderId: '2' }),
      { code: 'PAYMENT_ALREADY_BOUND' },
    );
  } finally {
    store.close();
  }
});

test('reconciliation checkpoint and unknown manual settlements block signing', async () => {
  const f = fixture();
  const store = new ReplayStore(':memory:', { syntheticOnly: true });
  const policy = createSyntheticPaymentPolicy({
    domain,
    store,
    snapshots: { 1: f.snapshot },
    evidence: { e1: f.payment },
    clock: () => '1000',
  });
  try {
    await assert.rejects(policy.issue(request), { code: 'CHAIN_RECONCILIATION_BEHIND' });
    store.advanceCheckpoint(escrowDomainKey(domain), '100');
    await policy.beginManualReconciliation({ orderId: '1' });
    await assert.rejects(policy.issue(request), { code: 'MANUAL_RECONCILIATION_REQUIRED' });
    assert.throws(() => store.completeManualResolution(orderBinding(domain, '1'), []), {
      code: 'MANUAL_PAYMENT_IDENTITY_REQUIRED',
    });
    await assert.rejects(policy.issue(request), { code: 'MANUAL_RECONCILIATION_REQUIRED' });
  } finally {
    store.close();
  }
});

test('confirmed complete manual manifest consumes identity even when tokens were refunded/split', async () => {
  const store = new ReplayStore(':memory:', { syntheticOnly: true });
  try {
    await harness({ store }).policy.beginManualReconciliation({ orderId: '1' });
    const f = fixture();
    f.snapshot.order.state = 'Resolved';
    const { policy } = harness({
      store,
      snapshot: f.snapshot,
      manualManifests: {
        recovery1: { complete: true, confirmed: true, orderId: '1', evidenceIds: ['e1'] },
      },
    });
    assert.equal(
      (await policy.reconcileManualResolution({ resolutionId: 'recovery1' })).status,
      'MANUAL_PAYMENTS_CONSUMED',
    );
    f.snapshot.order.state = 'Paying';
    f.snapshot.order.id = '2';
    await assert.rejects(
      harness({ store, snapshot: f.snapshot }).policy.issue({ ...request, orderId: '2' }),
      { code: 'PAYMENT_ALREADY_BOUND' },
    );
  } finally {
    store.close();
  }
});

test('live bootstrap rejects fixture signing keys and synthetic stores', () => {
  assert.throws(
    () =>
      createEd25519SigningAdapter({
        publicKeyHex: SYNTHETIC_PUBLIC_KEY_HEX,
        signDigest: async () => Buffer.alloc(64),
      }),
    { code: 'LIVE_SIGNER_REQUIRED' },
  );
  assert.throws(
    () => createLivePaymentPolicy({ domain, store: { syntheticOnly: true }, signer: {} }),
    { code: 'LIVE_SIGNER_REQUIRED' },
  );
});

test('live adapter rejects browser callbacks, public proof and claimed verified records before signing', async () => {
  const store = new ReplayStore(':memory:');
  let signs = 0;
  const key = Keypair.random();
  const signer = createEd25519SigningAdapter({
    publicKeyHex: Buffer.from(key.rawPublicKey()).toString('hex'),
    signDigest: async (digest) => {
      signs++;
      return key.sign(digest);
    },
  });
  try {
    for (const record of [
      { verified: true },
      { mode: 'extension-check', httpStatus: 200 },
      fixture().payment,
      { serverName: 'app.revolut.com', independentlyVerified: true },
    ]) {
      const policy = createLivePaymentPolicy({
        domain,
        token: fixture().snapshot.config.token,
        store,
        signer,
        verifierReader: { readVerifiedRecord: async () => record },
        ledgerReader: { readOrder: async () => fixture().snapshot },
        clock: () => '1000',
      });
      await assert.rejects(policy.issue(request), { code: 'TLSN_PAYMENT_SCHEMA_UNVERIFIED' });
    }
    assert.equal(signs, 0);
  } finally {
    store.close();
  }
});

test('official network domains bind different keys and mainnet claims use the mainnet digest', async () => {
  const mainnetDomain = { ...domain, network_passphrase: Networks.PUBLIC };
  assert.notEqual(escrowDomainKey(domain), escrowDomainKey(mainnetDomain));
  assert.notEqual(orderBinding(domain, '1'), orderBinding(mainnetDomain, '1'));
  for (const network_passphrase of ['', 'Custom network', Networks.FUTURENET]) {
    assert.throws(() => escrowDomainKey({ ...domain, network_passphrase }), {
      code: 'INVALID_DOMAIN',
    });
  }
  const snapshot = fixture().snapshot;
  snapshot.network_passphrase = Networks.PUBLIC;
  const h = harness({ targetDomain: mainnetDomain, snapshot });
  try {
    const receipt = await h.policy.issue(request);
    assert.equal(receipt.domain.network_passphrase, Networks.PUBLIC);
    assert.equal(
      receipt.digestHex,
      claimDigest({ ...mainnetDomain, claim: receipt.claim }).toString('hex'),
    );
    assert.notEqual(
      receipt.digestHex,
      claimDigest({ ...domain, claim: receipt.claim }).toString('hex'),
    );
    const key = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x11));
    assert.equal(
      key.verify(
        claimDigest({ ...domain, claim: receipt.claim }),
        Buffer.from(receipt.signatureHex, 'hex'),
      ),
      false,
    );
  } finally {
    h.store.close();
  }
});

test('live bootstrap requires explicit mainnet and an exact configured token, while normalization stays closed', async () => {
  const key = Keypair.random();
  const store = new ReplayStore(':memory:');
  let signs = 0;
  const signer = createEd25519SigningAdapter({
    publicKeyHex: Buffer.from(key.rawPublicKey()).toString('hex'),
    signDigest: async (digest) => {
      signs++;
      return key.sign(digest);
    },
  });
  const options = {
    domain: { ...domain, network_passphrase: Networks.PUBLIC },
    network: 'mainnet',
    token: fixture().snapshot.config.token,
    store,
    signer,
    verifierReader: { readVerifiedRecord: async () => fixture().payment },
    ledgerReader: {
      readOrder: async () => {
        throw new Error('normalizer must reject first');
      },
    },
  };
  try {
    for (const mutation of [
      { network: undefined },
      { network: 'testnet' },
      { network: 'custom' },
      { domain },
      { token: undefined },
      { token: address(1) },
    ]) {
      assert.throws(
        () => createLivePaymentPolicy({ ...options, ...mutation }),
        /INVALID_DOMAIN|INVALID_TOKEN/,
      );
    }
    await assert.rejects(createLivePaymentPolicy(options).issue(request), {
      code: 'TLSN_PAYMENT_SCHEMA_UNVERIFIED',
    });
    assert.equal(signs, 0);
  } finally {
    store.close();
  }
});

test('configured token is checked against the ledger before claim reservation or signing on either network', async () => {
  for (const network_passphrase of [Networks.TESTNET, Networks.PUBLIC]) {
    const f = fixture();
    const targetDomain = { ...domain, network_passphrase };
    f.snapshot.network_passphrase = network_passphrase;
    const store = new ReplayStore(':memory:', { syntheticOnly: true });
    const key = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x11));
    let signs = 0;
    store.advanceCheckpoint(escrowDomainKey(targetDomain), '100');
    const policy = makePolicy({
      domain: targetDomain,
      token: address(6, true),
      store,
      syntheticOnly: true,
      signer: {
        syntheticOnly: true,
        publicKeyHex: SYNTHETIC_PUBLIC_KEY_HEX,
        signDigest: async (digest) => {
          signs++;
          return key.sign(digest);
        },
      },
      clock: () => '1000',
      loadEvidence: async () => f.payment,
      normalize: validateSyntheticPayment,
      ledgerReader: { readOrder: async () => f.snapshot },
    });
    try {
      f.snapshot.config.token = address(7, true);
      await assert.rejects(policy.issue(request), { code: 'TOKEN_CONFIG_MISMATCH' });
      assert.equal(signs, 0);
      f.snapshot.config.token = address(6, true);
      assert.equal((await policy.issue(request)).claim.token, address(6, true));
      assert.equal(signs, 1);
    } finally {
      store.close();
    }
  }
});

test('signing failure retry signs the original reserved digest and expiry', async () => {
  const f = fixture();
  const store = new ReplayStore(':memory:', { syntheticOnly: true });
  store.advanceCheckpoint(escrowDomainKey(domain), '100');
  let calls = 0,
    now = '1000';
  const digests = [];
  const key = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x11));
  const signer = {
    syntheticOnly: true,
    publicKeyHex: SYNTHETIC_PUBLIC_KEY_HEX,
    signDigest: async (digest) => {
      digests.push(digest.toString('hex'));
      calls++;
      if (calls === 1) throw new Error('uncertain signing delivery');
      return key.sign(digest);
    },
  };
  const policy = makePolicy({
    domain,
    store,
    signer,
    syntheticOnly: true,
    clock: () => now,
    normalize: validateSyntheticPayment,
    loadEvidence: async () => f.payment,
    ledgerReader: { readOrder: async () => f.snapshot },
  });
  try {
    await assert.rejects(policy.issue(request), { code: 'POLICY_ADAPTER_FAILED' });
    now = '1010';
    const receipt = await policy.issue(request);
    assert.equal(receipt.claim.expires_at, '1120');
    assert.deepEqual(digests, [receipt.digestHex, receipt.digestHex]);
  } finally {
    store.close();
  }
});

test('concurrent independent SQLite handles issue a payment for at most one order', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-policy-race-'));
  const path = join(directory, 'registry.sqlite');
  const first = new ReplayStore(path, { syntheticOnly: true });
  const second = new ReplayStore(path, { syntheticOnly: true });
  try {
    const f = fixture();
    f.snapshot.order.id = '2';
    const results = await Promise.allSettled([
      harness({ store: first }).policy.issue(request),
      harness({ store: second, snapshot: f.snapshot }).policy.issue({ ...request, orderId: '2' }),
    ]);
    assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((row) => row.status === 'rejected').reason.code,
      'PAYMENT_ALREADY_BOUND',
    );
  } finally {
    first.close();
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a stored claim cannot bypass changed authoritative order terms on retry', async () => {
  const store = new ReplayStore(':memory:', { syntheticOnly: true });
  try {
    await harness({ store }).policy.issue(request);
    const f = fixture();
    f.snapshot.order.terms.token_amount = '220000001';
    await assert.rejects(harness({ store, snapshot: f.snapshot }).policy.issue(request), {
      code: 'ORDER_TERMS_CHANGED',
    });
  } finally {
    store.close();
  }
});

test('manual recovery arising during signing prevents return of a signature', async () => {
  const f = fixture();
  const store = new ReplayStore(':memory:', { syntheticOnly: true });
  store.advanceCheckpoint(escrowDomainKey(domain), '100');
  const key = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x11));
  const signer = {
    syntheticOnly: true,
    publicKeyHex: SYNTHETIC_PUBLIC_KEY_HEX,
    signDigest: async (digest) => {
      store.holdManualResolution(orderBinding(domain, '1'));
      return key.sign(digest);
    },
  };
  const policy = makePolicy({
    domain,
    store,
    signer,
    syntheticOnly: true,
    clock: () => '1000',
    normalize: validateSyntheticPayment,
    loadEvidence: async () => f.payment,
    ledgerReader: { readOrder: async () => f.snapshot },
  });
  try {
    await assert.rejects(policy.issue(request), { code: 'MANUAL_RECONCILIATION_REQUIRED' });
  } finally {
    store.close();
  }
});

test('manual manifests require completed chain resolution and complete payment identities', async () => {
  for (const change of [
    (m) => (m.complete = false),
    (m) => (m.confirmed = false),
    (m) => (m.evidenceIds = []),
  ]) {
    const f = fixture();
    f.snapshot.order.state = 'Resolved';
    const manifest = { complete: true, confirmed: true, orderId: '1', evidenceIds: ['e1'] };
    change(manifest);
    const h = harness({ snapshot: f.snapshot, manualManifests: { r1: manifest } });
    try {
      h.store.holdManualResolution(orderBinding(domain, '1'));
      await assert.rejects(h.policy.reconcileManualResolution({ resolutionId: 'r1' }), {
        code: 'MANUAL_PAYMENT_IDENTITY_REQUIRED',
      });
      assert.throws(() => h.store.assertReconciled(escrowDomainKey(domain), '100'), {
        code: 'MANUAL_RECONCILIATION_REQUIRED',
      });
    } finally {
      h.store.close();
    }
  }
});

test('confirmed release reconciles idempotently and keeps payment consumed', async () => {
  const store = new ReplayStore(':memory:', { syntheticOnly: true });
  try {
    await harness({ store }).policy.issue(request);
    const f = fixture();
    f.snapshot.order.state = 'Released';
    f.snapshot.paymentUsed = true;
    const h = harness({ store, snapshot: f.snapshot });
    assert.equal((await h.policy.reconcileRelease(request)).status, 'RELEASE_CONFIRMED');
    assert.equal((await h.policy.reconcileRelease(request)).status, 'RELEASE_CONFIRMED');
    await assert.rejects(harness({ store }).policy.issue(request), { code: 'PAYMENT_CONSUMED' });
  } finally {
    store.close();
  }
});

test('one persistent registry cannot be reopened as a different evidence mode', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-policy-mode-'));
  const path = join(directory, 'registry.sqlite');
  try {
    const store = new ReplayStore(path, { syntheticOnly: true });
    store.close();
    assert.throws(() => new ReplayStore(path), { code: 'STORE_MODE_MISMATCH' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
