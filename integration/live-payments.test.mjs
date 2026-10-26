import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Address, Keypair, Networks } from '@stellar/stellar-sdk';
import { createLivePaymentSupport, isLivePaymentSupport } from './live-payments.mjs';
import {
  createEd25519SigningAdapter,
  createTlsnEvidenceStore,
  ReplayStore,
  escrowDomainKey,
} from '../policy/src/index.mjs';
import { normalizedVerifiedPayment } from '../policy/src/tlsn-store.mjs';
import { payload, now, transaction } from '../policy/test/fixtures/tlsn-record.mjs';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pactlane-live-payments-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const evidence = createTlsnEvidenceStore({
    path: join(dir, 'evidence.sqlite'),
    ingressSecret: 'ab'.repeat(32),
    clock: () => now,
  });
  t.after(() => evidence.close());
  const receipt = evidence.ingest({
    authorization: 'Bearer ' + 'ab'.repeat(32),
    payload: payload(),
  });
  const record = normalizedVerifiedPayment(evidence.reader.readVerifiedRecord(receipt.evidenceId));
  const key = Keypair.random();
  let signCount = 0;
  const signer = createEd25519SigningAdapter({
    publicKeyHex: Buffer.from(key.rawPublicKey()).toString('hex'),
    signDigest: async (d) => {
      signCount++;
      return key.sign(d);
    },
  });
  const cfg = {
    network: 'mainnet',
    networkPassphrase: Networks.PUBLIC,
    contract: Address.contract(Buffer.alloc(32, 81)).toString(),
    token: Address.contract(Buffer.alloc(32, 82)).toString(),
    policySignerPublicKeyHex: signer.publicKeyHex,
    deploymentId: 'test-deployment',
  };
  const binding = {
    network: 'mainnet',
    token: cfg.token,
    seller: Keypair.random().publicKey(),
    buyer: Keypair.random().publicKey(),
    recipientId: record.recipientId,
    payerScope: record.payerScope,
    recipientSalt: '33'.repeat(32),
    destination: '@synthetic',
    evidenceId: receipt.evidenceId,
    tokenAmount: '10000000',
    fiatMinor: '123',
  };
  let healthy = true;
  const options = {
    binding,
    evidenceReader: evidence.reader,
    signer,
    authorizationPath: join(dir, 'authorizations.sqlite'),
    proofHealth: async () => healthy,
    clock: () => String(now / 1000),
  };
  let support = createLivePaymentSupport(options);
  t.after(() => support.close());
  const domain = { network_passphrase: Networks.PUBLIC, contract: cfg.contract };
  const store = new ReplayStore(join(dir, 'replay.sqlite'));
  t.after(() => store.close());
  store.advanceCheckpoint(escrowDomainKey(domain), '100');
  const order = {
    id: '1',
    state: 'Paying',
    buyer: binding.buyer,
    reserved_at: String(now / 1000 - 30),
    locked_at: String(now / 1000 - 20),
    pay_by: String(now / 1000 + 300),
    terms: {
      seller: binding.seller,
      token_amount: binding.tokenAmount,
      fiat_minor: binding.fiatMinor,
      currency: 'EUR',
      rail: 'revolut',
      recipient: support.recipientCommitment,
      offer_expires_at: String(now / 1000 + 3600),
      reservation_seconds: '600',
    },
  };
  const ledgerReader = {
    readSnapshot: async () => ({ order }),
    readOrder: async () => ({
      ...domain,
      confirmed: true,
      ledgerTimestamp: String(now / 1000),
      ledgerSequence: '100',
      paymentUsed: false,
      config: { token: cfg.token, signer: signer.publicKeyHex },
      offerData: { recipientSalt: binding.recipientSalt, payerScope: binding.payerScope },
      order: structuredClone(order),
    }),
  };
  const context = {
    account: binding.buyer,
    domain,
    network: 'mainnet',
    token: cfg.token,
    deployment: cfg,
    ledgerReader,
    store,
  };
  return {
    cfg,
    binding,
    options,
    order,
    evidence,
    signer,
    key,
    support,
    context,
    signCount: () => signCount,
    health: (v) => {
      healthy = v;
    },
    restart: () => {
      support.close();
      support = createLivePaymentSupport(options);
      return support;
    },
  };
}
test('accepted evidence binds one exact order; authorization survives restart and cannot cross accounts', async (t) => {
  const f = fixture(t);
  assert.equal(isLivePaymentSupport(f.support), true);
  assert.equal(await f.support.ready(f.cfg), true);
  const policy = await f.support.policyFor(f.context);
  const status = await policy.readStatus('1');
  assert.equal(status.status, 'verified');
  assert.match(status.authorization, /^[a-f0-9]{64}$/);
  const signed = await policy.readAuthorization({
    orderId: '1',
    authorization: status.authorization,
  });
  assert.equal(signed.releaseGate, 'POLICY_ACCEPTED');
  assert.equal(
    f.key.verify(Buffer.from(signed.digestHex, 'hex'), Buffer.from(signed.signatureHex, 'hex')),
    true,
  );
  assert.equal(f.signCount(), 1);
  await assert.rejects(
    policy.readAuthorization({ orderId: '1', authorization: '00'.repeat(32) }),
    /PAYMENT_AUTHORIZATION_INVALID/,
  );
  const resumed = await f.restart().policyFor(f.context);
  assert.deepEqual(await resumed.readStatus('1'), status);
  assert.equal(f.signCount(), 1);
  const other = await f.restart().policyFor({ ...f.context, account: f.binding.seller });
  await assert.rejects(other.readStatus('1'), /BUYER_WALLET_MISMATCH/);
});
test('historical record cannot pay for a newer lock, and duplicate proofs remain one payment', async (t) => {
  const f = fixture(t);
  f.order.locked_at = String(now / 1000);
  const policy = await f.support.policyFor(f.context);
  assert.deepEqual(await policy.readStatus('1'), { orderId: '1', status: 'pending' });
  assert.equal(f.signCount(), 0);
  f.order.locked_at = String(now / 1000 - 20);
  const duplicate = payload();
  duplicate.session.id = 'second-proof';
  f.evidence.ingest({ authorization: 'Bearer ' + 'ab'.repeat(32), payload: duplicate });
  assert.equal((await policy.readStatus('1')).status, 'verified');
  assert.equal(f.signCount(), 1);
});
test('unhealthy verifier, mismatched signer, altered terms and fake readiness cannot enable a lock', async (t) => {
  const f = fixture(t);
  f.health(false);
  assert.equal(await f.support.ready(f.cfg), false);
  await assert.rejects(
    f.support.assertLock({ deployment: f.cfg, order: f.order, account: f.binding.buyer }),
    /PAYMENT_VERIFICATION_UNAVAILABLE/,
  );
  f.health(true);
  await assert.rejects(
    f.support.assertLock({
      deployment: f.cfg,
      order: { ...f.order, terms: { ...f.order.terms, fiat_minor: '124' } },
      account: f.binding.buyer,
    }),
    /ORDER_BINDING_MISMATCH/,
  );
  assert.equal(
    await f.support.ready({ ...f.cfg, policySignerPublicKeyHex: 'ff'.repeat(32) }),
    false,
  );
  assert.equal(isLivePaymentSupport({ ready: () => true }), false);
  assert.throws(
    () =>
      createLivePaymentSupport({ ...f.options, signer: { publicKeyHex: f.signer.publicKeyHex } }),
    /PAYMENT_VERIFICATION_UNAVAILABLE/,
  );
  assert.throws(() => f.support.assertBuyer(f.binding.seller), /BUYER_WALLET_MISMATCH/);
  assert.equal(f.signCount(), 0);
});
