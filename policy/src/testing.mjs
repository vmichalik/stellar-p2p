// TEST/DEMO ONLY. This module creates no RPC, TLSNotary, HTTP or release clients.
// Its fixed public seed can never be passed to the live signing factory.
import { Keypair } from '@stellar/stellar-sdk';
import { makePolicy } from './engine.mjs';
import { validateSyntheticPayment } from './evidence.mjs';
import { requirePolicy } from './errors.mjs';
const key = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x11));
export const SYNTHETIC_PUBLIC_KEY_HEX = Buffer.from(key.rawPublicKey()).toString('hex');

export function createSyntheticPaymentPolicy({
  domain,
  snapshots,
  evidence,
  store,
  clock,
  claimLifetimeSeconds,
  maxLedgerAgeSeconds,
  manualManifests = {},
}) {
  requirePolicy(store?.syntheticOnly === true, 'SYNTHETIC_STORE_REQUIRED');
  // Snapshot all fixtures up front. Later caller mutation cannot change the
  // trusted lookup result or inject a signer into this synthetic-only path.
  const orders = structuredClone(snapshots),
    payments = structuredClone(evidence),
    manifests = structuredClone(manualManifests);
  const signer = Object.freeze({
    publicKeyHex: SYNTHETIC_PUBLIC_KEY_HEX,
    syntheticOnly: true,
    signDigest: async (digest) => key.sign(digest),
  });
  return makePolicy({
    domain,
    store,
    clock,
    claimLifetimeSeconds,
    maxLedgerAgeSeconds,
    syntheticOnly: true,
    signer,
    ledgerReader: { readOrder: async ({ orderId }) => structuredClone(orders[orderId]) },
    loadEvidence: async (id) => structuredClone(payments[id]),
    normalize: validateSyntheticPayment,
    manualResolutionReader: { readConfirmedManifest: async (id) => structuredClone(manifests[id]) },
  });
}
