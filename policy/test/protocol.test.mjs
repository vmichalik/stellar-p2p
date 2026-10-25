import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import {
  claimDigest,
  claimXdr,
  recipientCommitment,
  paymentNullifier,
  createEd25519SigningAdapter,
} from '../src/index.mjs';
import { recipientXdr, nullifierXdr } from '../vendor/escrow-protocol.mjs';

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/protocol-vectors.json', import.meta.url)),
);
for (const v of vectors.vectors) {
  test(`contract-owned frozen protocol vector: ${v.id}`, () => {
    const recipient = {
      recipient_id: v.identities.recipient_id,
      recipient_salt: v.identities.recipient_salt,
    };
    const payment = { payer_scope: v.identities.payer_scope, payment_id: v.identities.payment_id };
    const input = {
      network_passphrase: v.network_passphrase,
      contract: v.contract,
      claim: v.claim,
    };
    assert.equal(recipientXdr(recipient).toString('hex'), v.recipient_xdr_hex);
    assert.equal(recipientCommitment(recipient).toString('hex'), v.claim.recipient);
    assert.equal(nullifierXdr(payment).toString('hex'), v.payment_identity_xdr_hex);
    assert.equal(paymentNullifier(payment).toString('hex'), v.claim.nullifier);
    assert.equal(claimXdr(input).toString('hex'), v.claim_xdr_hex);
    assert.equal(claimDigest(input).toString('hex'), v.digest_hex);
    assert.equal(
      createHash('sha256').update(Buffer.from(v.claim_xdr_hex, 'hex')).digest('hex'),
      v.digest_hex,
    );
    assert(
      Keypair.fromPublicKey(vectors.signer_public_key).verify(
        Buffer.from(v.digest_hex, 'hex'),
        Buffer.from(v.signature_hex, 'hex'),
      ),
    );
  });
}
test('contract vector fixture key is rejected by the live signing adapter', () => {
  assert.throws(
    () =>
      createEd25519SigningAdapter({
        publicKeyHex: vectors.signer_public_key_hex,
        signDigest: async () => Buffer.alloc(64),
      }),
    { code: 'LIVE_SIGNER_REQUIRED' },
  );
});
