import { writeFile } from 'node:fs/promises';
import { Signature, Wallet } from 'ethers';
import canonicalize from 'canonicalize';
import { claimEnvelope } from '../lib/claim.mjs';

// Public disposable key. It must never hold funds or act as a trusted service key.
const wallet = new Wallet('0x' + '11'.repeat(32));
const claim = {
  provider: 'http',
  parameters: JSON.stringify({ example: 'synthetic fixture' }),
  context: JSON.stringify({ z: 'demo', a: { amount: '-100', recipient: 'fixture' } }),
  owner: wallet.address,
  timestampS: 1792750000,
  epoch: 1,
};
const envelope = claimEnvelope(claim);
const signature = await wallet.signMessage(envelope.message);
const parsed = Signature.from(signature);
const fixture = {
  synthetic: true,
  provider: claim.provider,
  parameters: claim.parameters,
  context: canonicalize(JSON.parse(claim.context)),
  owner: claim.owner.toLowerCase(),
  timestamp: claim.timestampS,
  epoch: claim.epoch,
  signature: parsed.r.slice(2) + parsed.s.slice(2),
  recovery_id: parsed.yParity,
  trusted_signer: wallet.address.toLowerCase().slice(2),
  identifier: envelope.identifier,
  message: envelope.message,
  digest: envelope.digest,
};
await writeFile(
  new URL('../fixtures/claim.json', import.meta.url),
  JSON.stringify(fixture, null, 2) + '\n',
);
console.log('Synthetic signature fixture generated. No bank data or service key was used.');
