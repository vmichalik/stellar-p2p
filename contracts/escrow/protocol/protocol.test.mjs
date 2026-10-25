import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  PROTOCOL_VERSION, claimDigest, claimScVal, claimXdr, networkId,
  nullifierXdr, paymentNullifier, recipientCommitment, recipientXdr,
} from './protocol.mjs';

const frozen = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const sample = frozen.vectors[0];
const domain = v => ({ network_passphrase: v.network_passphrase, contract: v.contract, claim: v.claim });
const recipientInput = v => ({ recipient_id: v.identities.recipient_id, recipient_salt: v.identities.recipient_salt });
const paymentInput = v => ({ payer_scope: v.identities.payer_scope, payment_id: v.identities.payment_id });
const hex = value => Buffer.from(value).toString('hex');
const changedByte = value => `${value.startsWith('00') ? '01' : '00'}${value.slice(2)}`;

test('official SDK independently reproduces every frozen XDR, digest and Ed25519 signature', () => {
  assert.equal(frozen.version, PROTOCOL_VERSION);
  const signer = Keypair.fromRawEd25519Seed(Buffer.from(frozen.public_test_seed_hex, 'hex'));
  assert.equal(signer.publicKey(), frozen.signer_public_key);
  assert.equal(hex(signer.rawPublicKey()), frozen.signer_public_key_hex);
  for (const vector of frozen.vectors) {
    assert.equal(hex(networkId(vector.network_passphrase)), vector.network_id_hex);
    assert.equal(hex(recipientXdr(recipientInput(vector))), vector.recipient_xdr_hex);
    assert.equal(hex(recipientCommitment(recipientInput(vector))), vector.claim.recipient);
    assert.equal(hex(nullifierXdr(paymentInput(vector))), vector.payment_identity_xdr_hex);
    assert.equal(hex(paymentNullifier(paymentInput(vector))), vector.claim.nullifier);
    assert.equal(hex(claimXdr(domain(vector))), vector.claim_xdr_hex);
    const digest = claimDigest(domain(vector));
    assert.equal(hex(digest), vector.digest_hex);
    assert.equal(hex(createHash('sha256').update(Buffer.from(vector.claim_xdr_hex, 'hex')).digest()), vector.digest_hex);
    assert.equal(hex(signer.sign(digest)), vector.signature_hex);
    assert(Keypair.fromPublicKey(frozen.signer_public_key).verify(digest, Buffer.from(vector.signature_hex, 'hex')));
  }
});

test('claim maps use lexical symbol keys independent of JS property insertion order', () => {
  const reversed = Object.fromEntries(Object.entries(sample.claim).reverse());
  assert.equal(hex(claimDigest({ ...domain(sample), claim: reversed })), sample.digest_hex);
  const names = claimScVal(sample.claim).map.map(entry => entry.key.value);
  assert.deepEqual(names, [...names].sort());
  assert.equal(names.length, 14);
});

test('payer and transfer identities are framed unambiguously and are case-sensitive', () => {
  const original = paymentInput(sample);
  assert.notEqual(hex(paymentNullifier({ ...original, payment_id: original.payment_id.toUpperCase() })), sample.claim.nullifier);
  assert.notEqual(hex(paymentNullifier({ ...original, payer_scope: 'another-synthetic-account' })), sample.claim.nullifier);
  assert.notEqual(hex(paymentNullifier({ payer_scope: 'a', payment_id: 'bc' })),
    hex(paymentNullifier({ payer_scope: 'ab', payment_id: 'c' })));
});

test('nullifiers remain identical across order, network, token and buyer changes', () => {
  assert.notEqual(frozen.vectors[0].claim.order_id, frozen.vectors[1].claim.order_id);
  assert.notEqual(frozen.vectors[0].network_passphrase, frozen.vectors[1].network_passphrase);
  assert.equal(frozen.vectors[0].claim.nullifier, frozen.vectors[1].claim.nullifier);
  assert.throws(() => paymentNullifier({ ...paymentInput(sample), order_id: '1' }));
  assert.throws(() => paymentNullifier({ ...paymentInput(sample), contract: sample.contract }));
  assert.throws(() => paymentNullifier({ ...paymentInput(sample), salt: '00'.repeat(32) }));
});

test('recipient commitment binds its exact identity and offer salt', () => {
  const input = recipientInput(sample);
  assert.notEqual(hex(recipientCommitment({ ...input, recipient_id: input.recipient_id.toUpperCase() })), sample.claim.recipient);
  assert.notEqual(hex(recipientCommitment({ ...input, recipient_salt: changedByte(input.recipient_salt) })), sample.claim.recipient);
  assert.notEqual(sample.claim.recipient, sample.claim.nullifier);
});

test('identity encoders reject whitespace, Unicode, empty, oversized and nonstring IDs', () => {
  for (const invalid of ['', ' x', 'x ', 'a\tb', 'a\nb', 'é', 'a'.repeat(257), 123, null]) {
    assert.throws(() => recipientCommitment({ ...recipientInput(sample), recipient_id: invalid }));
    assert.throws(() => paymentNullifier({ ...paymentInput(sample), payer_scope: invalid }));
    assert.throws(() => paymentNullifier({ ...paymentInput(sample), payment_id: invalid }));
  }
});

test('byte fields reject wrong width, zero, uppercase hex, prefixes and raw text', () => {
  for (const invalid of ['0'.repeat(64), '1'.repeat(63), '1'.repeat(66), 'AA'.repeat(32), `0x${'01'.repeat(32)}`, [], null]) {
    assert.throws(() => recipientCommitment({ ...recipientInput(sample), recipient_salt: invalid }));
    for (const field of ['recipient', 'nullifier']) {
      assert.throws(() => claimDigest({ ...domain(sample), claim: { ...sample.claim, [field]: invalid } }));
    }
  }
});

test('every integer must retain its exact declared width without JS Number conversion', () => {
  const u64 = ['order_id', 'reserved_at', 'paid_at', 'pay_by', 'expires_at'];
  const i128 = ['token_amount', 'fiat_minor'];
  for (const field of [...u64, ...i128]) {
    for (const invalid of [1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '01', '+1', '-1', '1.0', '1e3', '', null]) {
      assert.throws(() => claimDigest({ ...domain(sample), claim: { ...sample.claim, [field]: invalid } }));
    }
    const max = u64.includes(field) ? 1n << 64n : 1n << 127n;
    assert.throws(() => claimDigest({ ...domain(sample), claim: { ...sample.claim, [field]: max } }));
  }
  for (const field of i128) {
    assert.throws(() => claimDigest({ ...domain(sample), claim: { ...sample.claim, [field]: '0' } }));
  }
  const bigintClaim = Object.fromEntries(Object.entries(sample.claim).map(([key, value]) =>
    [key, [...u64, ...i128].includes(key) ? BigInt(value) : value]));
  assert.equal(hex(claimDigest({ ...domain(sample), claim: bigintClaim })), sample.digest_hex);
});

test('unknown claim fields, partial fills and missing fields cannot be silently ignored', () => {
  assert.throws(() => claimDigest({ ...domain(sample), claim: { ...sample.claim, fill_amount: '1' } }));
  const missing = { ...sample.claim };
  delete missing.fiat_minor;
  assert.throws(() => claimDigest({ ...domain(sample), claim: missing }));
  assert.throws(() => claimDigest({ ...domain(sample), network_id: sample.network_id_hex }));
  assert.throws(() => claimDigest({ ...domain(sample), claim: { ...sample.claim, currency: 'USD' } }));
  assert.throws(() => claimDigest({ ...domain(sample), claim: { ...sample.claim, rail: 'other' } }));
});

test('address encodings reject bad checksums, noncanonical case and noncontract escrow/token', () => {
  const account = frozen.vectors[1].claim.buyer;
  for (const invalid of [sample.contract.toLowerCase(), `${sample.contract.slice(0, -1)}A`, account, '']) {
    assert.throws(() => claimDigest({ ...domain(sample), contract: invalid }));
    assert.throws(() => claimDigest({ ...domain(sample), claim: { ...sample.claim, token: invalid } }));
  }
  assert.throws(() => claimDigest({ ...domain(sample), claim: { ...sample.claim, buyer: account.toLowerCase() } }));
});

test('domain and each accepted claim field change the signature digest', () => {
  const alternate = StrKey.encodeContract(Buffer.alloc(32, 9));
  assert.notEqual(hex(claimDigest({ ...domain(sample), contract: alternate })), sample.digest_hex);
  assert.notEqual(hex(claimDigest({ ...domain(sample), network_passphrase: frozen.vectors[1].network_passphrase })), sample.digest_hex);
  const changes = {
    buyer: alternate, seller: alternate, token: alternate, token_amount: '220000001',
    fiat_minor: '2001', order_id: '1', reserved_at: '1792929601', paid_at: '1792929631',
    pay_by: '1792930201', expires_at: '1792930801',
    recipient: changedByte(sample.claim.recipient), nullifier: changedByte(sample.claim.nullifier),
  };
  for (const [field, value] of Object.entries(changes)) {
    assert.notEqual(hex(claimDigest({ ...domain(sample), claim: { ...sample.claim, [field]: value } })), sample.digest_hex);
  }
  for (const invalid of ['', ' Test SDF Network ; September 2015', 'bad\nnetwork', null]) {
    assert.throws(() => claimDigest({ ...domain(sample), network_passphrase: invalid }));
  }
});
