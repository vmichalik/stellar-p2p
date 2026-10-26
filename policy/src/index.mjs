import { Keypair, StrKey, Networks } from '@stellar/stellar-sdk';
import { makePolicy } from './engine.mjs';
import { normalizeLiveTlsnPayment } from './evidence.mjs';
import { requirePolicy, hex32 } from './errors.mjs';

const liveSigners = new WeakSet();
export const isLiveSigningAdapter = (value) => liveSigners.has(value);
const forbiddenTestKeys = new Set(
  [0x11, 0x2a].map((byte) =>
    Buffer.from(Keypair.fromRawEd25519Seed(Buffer.alloc(32, byte)).rawPublicKey()).toString('hex'),
  ),
);
export { PolicyError } from './errors.mjs';
export { ReplayStore } from './replay-store.mjs';
export { createTlsnEvidenceStore } from './tlsn-store.mjs';
export { escrowDomainKey, orderBinding } from './engine.mjs';
export {
  claimDigest,
  claimXdr,
  recipientCommitment,
  paymentNullifier,
} from '../vendor/escrow-protocol.mjs';

// Integrator supplies a server-controlled HSM/KMS callback. No private key is
// loaded from HTTP, environment values, test fixtures or this package.
export function createEd25519SigningAdapter({ publicKeyHex, signDigest }) {
  hex32(publicKeyHex);
  requirePolicy(
    !forbiddenTestKeys.has(publicKeyHex) && typeof signDigest === 'function',
    'LIVE_SIGNER_REQUIRED',
  );
  requirePolicy(
    StrKey.isValidEd25519PublicKey(StrKey.encodeEd25519PublicKey(Buffer.from(publicKeyHex, 'hex'))),
    'LIVE_SIGNER_REQUIRED',
  );
  const adapter = Object.freeze({ publicKeyHex, signDigest, syntheticOnly: false });
  liveSigners.add(adapter);
  return adapter;
}

export function createLivePaymentPolicy(options) {
  requirePolicy(options && typeof options === 'object', 'INVALID_BOOTSTRAP');
  const allowed = [
    'domain',
    'network',
    'token',
    'ledgerReader',
    'verifierReader',
    'store',
    'signer',
    'clock',
    'claimLifetimeSeconds',
    'maxLedgerAgeSeconds',
    'manualResolutionReader',
  ];
  requirePolicy(
    Object.keys(options).every((key) => allowed.includes(key)),
    'INVALID_BOOTSTRAP',
  );
  requirePolicy(
    liveSigners.has(options.signer) && options.store?.syntheticOnly === false,
    'LIVE_SIGNER_REQUIRED',
  );
  requirePolicy(
    typeof options.verifierReader?.readVerifiedRecord === 'function',
    'VERIFIER_READER_REQUIRED',
  );
  const network = options.network ?? 'testnet';
  requirePolicy(
    (network === 'testnet' && options.domain?.network_passphrase === Networks.TESTNET) ||
      (network === 'mainnet' && options.domain?.network_passphrase === Networks.PUBLIC),
    'INVALID_DOMAIN',
  );
  return makePolicy({
    ...options,
    syntheticOnly: false,
    loadEvidence: (id) => options.verifierReader.readVerifiedRecord(id),
    normalize: normalizeLiveTlsnPayment,
  });
}
