import canonicalize from 'canonicalize';
import { keccak256, toUtf8Bytes, hashMessage, recoverAddress } from 'ethers';

// Reproduce the signed Reclaim envelope independently of its SDK. This does
// not establish bank provenance, attestor trust, or payment-release policy.
export function claimEnvelope(claim) {
  if (typeof claim.provider !== 'string' || typeof claim.parameters !== 'string') {
    throw new Error('Invalid claim fields');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(claim.owner)) throw new Error('Invalid owner');
  if (
    !Number.isSafeInteger(claim.timestampS) ||
    claim.timestampS < 0 ||
    !Number.isSafeInteger(claim.epoch) ||
    claim.epoch < 0
  ) {
    throw new Error('Invalid timestamp or epoch');
  }
  const context = claim.context ? canonicalize(JSON.parse(claim.context)) : '';
  const identifier = keccak256(toUtf8Bytes(`${claim.provider}\n${claim.parameters}\n${context}`));
  const message = [identifier, claim.owner.toLowerCase(), claim.timestampS, claim.epoch].join('\n');
  return { identifier, message, digest: hashMessage(toUtf8Bytes(message)) };
}

export function recoverClaimSigners(claim, signatures) {
  const envelope = claimEnvelope(claim);
  if (!Array.isArray(signatures) || !signatures.length) throw new Error('No signatures');
  return {
    ...envelope,
    signers: signatures.map((s) => recoverAddress(envelope.digest, s).toLowerCase()),
  };
}
