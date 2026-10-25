// End-to-end policy composition with synthetic verifier/ledger data and a
// disposable signing key. This makes no bank request or network transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Address, Keypair, Networks } from '@stellar/stellar-sdk';
import {
  createLivePaymentPolicy,
  createEd25519SigningAdapter,
  createTlsnEvidenceStore,
  ReplayStore,
  escrowDomainKey,
  claimDigest,
  recipientCommitment,
} from '../src/index.mjs';
import { payload, now, ids } from './fixtures/tlsn-record.mjs';

test('authenticated record feeds exact mainnet-domain policy and durable replay protection', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-record-policy-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const secret = 'ab'.repeat(32),
    key = Keypair.random();
  const evidence = createTlsnEvidenceStore({
    path: join(directory, 'evidence.sqlite'),
    ingressSecret: secret,
    clock: () => now,
  });
  t.after(() => evidence.close());
  const receipt = evidence.ingest({ authorization: `Bearer ${secret}`, payload: payload() });
  const domain = {
    network_passphrase: Networks.PUBLIC,
    contract: Address.contract(Buffer.alloc(32, 71)).toString(),
  };
  const token = Address.contract(Buffer.alloc(32, 72)).toString();
  const salt = '33'.repeat(32),
    seconds = now / 1000;
  let signatures = 0;
  const signer = createEd25519SigningAdapter({
    publicKeyHex: Buffer.from(key.rawPublicKey()).toString('hex'),
    signDigest: async (digest) => {
      signatures++;
      return key.sign(digest);
    },
  });
  const initial = {
    ...domain,
    confirmed: true,
    ledgerTimestamp: String(seconds),
    ledgerSequence: '100',
    paymentUsed: false,
    config: { token, signer: signer.publicKeyHex },
    offerData: { recipientSalt: salt, payerScope: `revolut:identity:${ids[2]}` },
    order: {
      id: '1',
      state: 'Paying',
      buyer: Address.account(Buffer.alloc(32, 73)).toString(),
      reserved_at: String(seconds - 30),
      locked_at: String(seconds - 20),
      pay_by: String(seconds + 300),
      terms: {
        seller: Address.account(Buffer.alloc(32, 74)).toString(),
        token_amount: '10000000',
        fiat_minor: '123',
        currency: 'EUR',
        rail: 'revolut',
        reservation_seconds: '600',
        offer_expires_at: String(seconds + 3600),
        recipient: recipientCommitment({
          recipient_id: `revolut:identity:${ids[4]}`,
          recipient_salt: salt,
        }).toString('hex'),
      },
    },
  };
  let snapshot = structuredClone(initial);
  const path = join(directory, 'replay.sqlite');
  let store = new ReplayStore(path);
  t.after(() => store.close());
  const policy = (targetDomain = domain) => {
    store.advanceCheckpoint(escrowDomainKey(targetDomain), '100');
    return createLivePaymentPolicy({
      domain: targetDomain,
      network: 'mainnet',
      token,
      ledgerReader: { readOrder: async () => snapshot },
      verifierReader: evidence.reader,
      store,
      signer,
      clock: () => String(seconds),
    });
  };
  const input = { orderId: '1', evidenceId: receipt.evidenceId };
  for (const [change, code] of [
    [(s) => delete s.offerData.payerScope, 'PAYER_BINDING_UNVERIFIED'],
    [(s) => (s.offerData.payerScope = `revolut:identity:${ids[4]}`), 'PAYER_BINDING_UNVERIFIED'],
    [(s) => (s.order.terms.fiat_minor = '124'), 'AMOUNT_MISMATCH'],
    [(s) => (s.order.terms.recipient = '44'.repeat(32)), 'RECIPIENT_MISMATCH'],
    [(s) => (s.order.locked_at = String(seconds)), 'PAYMENT_OUTSIDE_WINDOW'],
    [(s) => (s.paymentUsed = true), 'PAYMENT_CONSUMED_ON_CHAIN'],
  ]) {
    snapshot = structuredClone(initial);
    change(snapshot);
    await assert.rejects(policy().issue(input), { code });
    assert.equal(signatures, 0);
  }
  snapshot = structuredClone(initial);
  const signed = await policy().issue(input);
  assert.equal(signed.kind, 'VERIFIED_POLICY_CLAIM_V1');
  assert.equal(signed.claim.token_amount, '10000000');
  const digest = claimDigest({ ...domain, claim: signed.claim });
  assert.equal(key.verify(digest, Buffer.from(signed.signatureHex, 'hex')), true);
  assert.equal(
    key.verify(
      claimDigest({ ...domain, network_passphrase: Networks.TESTNET, claim: signed.claim }),
      Buffer.from(signed.signatureHex, 'hex'),
    ),
    false,
  );
  assert.doesNotMatch(JSON.stringify(signed), /revolut:identity|NOT_PERSISTED|987654321/);
  store.close();
  store = new ReplayStore(path);
  assert.deepEqual(await policy().issue(input), signed);
  assert.equal(signatures, 1);
  snapshot.order.id = '2';
  await assert.rejects(policy().issue({ ...input, orderId: '2' }), {
    code: 'PAYMENT_ALREADY_BOUND',
  });
  const other = { ...domain, contract: Address.contract(Buffer.alloc(32, 75)).toString() };
  snapshot = { ...structuredClone(initial), ...other };
  await assert.rejects(policy(other).issue(input), { code: 'PAYMENT_ALREADY_BOUND' });
  assert.equal(signatures, 1);
});
