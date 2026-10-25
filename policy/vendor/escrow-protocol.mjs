import { createHash } from 'node:crypto';
import { Address, nativeToScVal, StrKey, xdr } from '@stellar/stellar-sdk';

export const PROTOCOL_VERSION = 'pactlane.protocol.v1';
export const RAIL = 'revolut';
export const SOURCE_ORIGIN = 'https://app.revolut.com';
export const DOMAINS = Object.freeze({
  recipient: 'PACTLANE_RECIPIENT_V1',
  nullifier: 'PACTLANE_NULLIFIER_V1',
  claim: 'PACTLANE_PAYMENT_V1',
});

const CLAIM_FIELDS = Object.freeze([
  'buyer', 'currency', 'expires_at', 'fiat_minor', 'nullifier', 'order_id',
  'paid_at', 'pay_by', 'rail', 'recipient', 'reserved_at', 'seller', 'token',
  'token_amount',
]);
const U64_MAX = (1n << 64n) - 1n;
const I128_MAX = (1n << 127n) - 1n;

function record(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label}: expected a plain record`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || fields.some(key => !keys.includes(key))) {
    throw new TypeError(`${label}: missing or unexpected fields`);
  }
}

function identity(value, label) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(value)) {
    throw new TypeError(`${label}: expected 1–256 non-whitespace ASCII bytes`);
  }
  return Buffer.from(value, 'ascii');
}

function bytes32(value, label, nonzero = true) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${label}: expected 32 bytes as lowercase hex`);
  }
  const bytes = Buffer.from(value, 'hex');
  if (nonzero && bytes.every(byte => byte === 0)) {
    throw new RangeError(`${label}: zero value is not allowed`);
  }
  return bytes;
}

function integer(value, max, label, positive = false) {
  if (typeof value !== 'bigint' &&
      (typeof value !== 'string' || value.length > max.toString().length ||
        !/^(0|[1-9][0-9]*)$/.test(value))) {
    throw new TypeError(`${label}: expected bigint or canonical unsigned decimal string`);
  }
  const n = BigInt(value);
  if (n < (positive ? 1n : 0n) || n > max) {
    throw new RangeError(`${label}: integer out of range`);
  }
  return n;
}

function address(value, label, contractOnly = false) {
  if (typeof value !== 'string' ||
      !(StrKey.isValidContract(value) || (!contractOnly && StrKey.isValidEd25519PublicKey(value)))) {
    throw new TypeError(`${label}: expected a canonical ${contractOnly ? 'C' : 'G or C'} address`);
  }
  const parsed = new Address(value);
  if (parsed.toString() !== value) {
    throw new TypeError(`${label}: noncanonical address`);
  }
  return parsed.toScVal();
}

const symbol = value => xdr.ScVal.scvSymbol(value);
const bytes = value => xdr.ScVal.scvBytes(value);
const vector = values => xdr.ScVal.scvVec(values);
const sha256 = value => createHash('sha256').update(value).digest();

export function recipientXdr(input) {
  record(input, ['recipient_id', 'recipient_salt'], 'recipient');
  return Buffer.from(vector([
    symbol(DOMAINS.recipient), symbol(RAIL), bytes(Buffer.from(SOURCE_ORIGIN, 'ascii')),
    bytes(identity(input.recipient_id, 'recipient_id')),
    bytes(bytes32(input.recipient_salt, 'recipient_salt')),
  ]).toXDR());
}

export function recipientCommitment(input) {
  return sha256(recipientXdr(input));
}

export function nullifierXdr(input) {
  record(input, ['payer_scope', 'payment_id'], 'payment identity');
  return Buffer.from(vector([
    symbol(DOMAINS.nullifier), symbol(RAIL), bytes(Buffer.from(SOURCE_ORIGIN, 'ascii')),
    bytes(identity(input.payer_scope, 'payer_scope')),
    bytes(identity(input.payment_id, 'payment_id')),
  ]).toXDR());
}

export function paymentNullifier(input) {
  return sha256(nullifierXdr(input));
}

export function networkId(networkPassphrase) {
  if (typeof networkPassphrase !== 'string' ||
      !/^[\x20-\x7e]{1,256}$/.test(networkPassphrase) ||
      networkPassphrase.trim() !== networkPassphrase) {
    throw new TypeError('network_passphrase: expected an explicit ASCII network passphrase');
  }
  return sha256(Buffer.from(networkPassphrase, 'utf8'));
}

export function claimScVal(claim) {
  record(claim, CLAIM_FIELDS, 'claim');
  if (claim.currency !== 'EUR' || claim.rail !== RAIL) {
    throw new TypeError('claim: v1 requires EUR/revolut');
  }
  const values = {
    buyer: address(claim.buyer, 'buyer'),
    currency: symbol(claim.currency),
    expires_at: nativeToScVal(integer(claim.expires_at, U64_MAX, 'expires_at'), { type: 'u64' }),
    fiat_minor: nativeToScVal(integer(claim.fiat_minor, I128_MAX, 'fiat_minor', true), { type: 'i128' }),
    nullifier: bytes(bytes32(claim.nullifier, 'nullifier')),
    order_id: nativeToScVal(integer(claim.order_id, U64_MAX, 'order_id'), { type: 'u64' }),
    paid_at: nativeToScVal(integer(claim.paid_at, U64_MAX, 'paid_at'), { type: 'u64' }),
    pay_by: nativeToScVal(integer(claim.pay_by, U64_MAX, 'pay_by'), { type: 'u64' }),
    rail: symbol(claim.rail),
    recipient: bytes(bytes32(claim.recipient, 'recipient')),
    reserved_at: nativeToScVal(integer(claim.reserved_at, U64_MAX, 'reserved_at'), { type: 'u64' }),
    seller: address(claim.seller, 'seller'),
    token: address(claim.token, 'token', true),
    token_amount: nativeToScVal(integer(claim.token_amount, I128_MAX, 'token_amount', true), { type: 'i128' }),
  };
  return xdr.ScVal.scvMap(CLAIM_FIELDS.map(key =>
    new xdr.ScMapEntry({ key: symbol(key), val: values[key] })));
}

export function claimXdr(input) {
  record(input, ['network_passphrase', 'contract', 'claim'], 'claim domain');
  return Buffer.from(vector([
    symbol(DOMAINS.claim), bytes(networkId(input.network_passphrase)),
    address(input.contract, 'contract', true), claimScVal(input.claim),
  ]).toXDR());
}

export function claimDigest(input) {
  return sha256(claimXdr(input));
}
