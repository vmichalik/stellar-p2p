// Explicit fixture regeneration only. This public seed is never a live signer.
import { writeFileSync } from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';
import {
  PROTOCOL_VERSION,
  recipientXdr,
  recipientCommitment,
  nullifierXdr,
  paymentNullifier,
  networkId,
  claimXdr,
  claimDigest,
} from './protocol.mjs';

const publicTestSeed = Buffer.alloc(32, 42);
const signer = Keypair.fromRawEd25519Seed(publicTestSeed);
const identities = {
  recipient_id: 'synthetic-recipient-0001',
  recipient_salt: Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString('hex'),
  payer_scope: 'synthetic-account-0001',
  payment_id: 'synthetic-transfer-0001',
};
const recipientInput = {
  recipient_id: identities.recipient_id,
  recipient_salt: identities.recipient_salt,
};
const paymentInput = { payer_scope: identities.payer_scope, payment_id: identities.payment_id };
const claim = {
  order_id: '0',
  seller: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4',
  buyer: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M',
  token: 'CBCJA4OGLBASJ35C3WMTFV2NJSSW5OOIFQHF6OYP56DWDVA7EGEJYRAZ',
  token_amount: '220000000',
  fiat_minor: '2000',
  currency: 'EUR',
  rail: 'revolut',
  recipient: recipientCommitment(recipientInput).toString('hex'),
  reserved_at: '1792929600',
  pay_by: '1792930200',
  paid_at: '1792929630',
  expires_at: '1792930800',
  nullifier: paymentNullifier(paymentInput).toString('hex'),
};
const base = {
  network_passphrase: 'Test SDF Network ; September 2015',
  contract: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK3IM',
  claim,
};
function vector(id, kind, input, context = null) {
  const digest = claimDigest(input);
  return {
    id,
    kind,
    ...input,
    identities: { ...identities },
    context,
    network_id_hex: networkId(input.network_passphrase).toString('hex'),
    recipient_xdr_hex: recipientXdr(recipientInput).toString('hex'),
    payment_identity_xdr_hex: nullifierXdr(paymentInput).toString('hex'),
    claim_xdr_hex: claimXdr(input).toString('hex'),
    digest_hex: digest.toString('hex'),
    signature_hex: Buffer.from(signer.sign(digest)).toString('hex'),
  };
}
const fixture = {
  version: PROTOCOL_VERSION,
  warning: 'PUBLIC SYNTHETIC FIXTURES ONLY. Never fund or deploy with this signing seed.',
  public_test_seed_hex: publicTestSeed.toString('hex'),
  signer_public_key: signer.publicKey(),
  signer_public_key_hex: Buffer.from(signer.rawPublicKey()).toString('hex'),
  vectors: [
    vector('whole-offer-eur20-usdc22', 'settlement', base, {
      locked_at: '1792929605',
      ledger_time: '1792929660',
      offer_expires_at: '1792933200',
      reservation_seconds: '600',
      token_decimals: 7,
    }),
    vector('integer-boundaries-and-account-addresses', 'encoding_only', {
      ...base,
      network_passphrase: 'Public Global Stellar Network ; September 2015',
      claim: {
        ...claim,
        seller: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey(),
        buyer: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey(),
        order_id: '18446744073709551615',
        token_amount: '170141183460469231731687303715884105727',
        fiat_minor: '170141183460469231731687303715884105727',
        reserved_at: '9007199254740993',
        paid_at: '9007199254740994',
        pay_by: '18446744073709551614',
        expires_at: '18446744073709551615',
      },
    }),
  ],
};
writeFileSync(new URL('./vectors.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`Wrote ${fixture.vectors.length} public synthetic ${PROTOCOL_VERSION} vectors.`);
