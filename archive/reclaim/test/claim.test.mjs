import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { readFileSync } from 'node:fs';
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/claim.json', import.meta.url), 'utf8'),
);
import { claimEnvelope, recoverClaimSigners } from '../lib/claim.mjs';

// PUBLIC, disposable fixture key: no bank payment, service attestor or funded wallet.
const wallet = new Wallet('0x' + '11'.repeat(32));
const claim = {
  provider: 'http',
  parameters: JSON.stringify({ example: 'synthetic fixture' }),
  context: JSON.stringify({ z: 'demo', a: { amount: '-100', recipient: 'fixture' } }),
  owner: wallet.address,
  timestampS: 1792750000,
  epoch: 1,
};

test('claim encoding matches the archived synthetic vector', () => {
  const envelope = claimEnvelope(claim);
  assert.equal(envelope.identifier, fixture.identifier);
  assert.equal(envelope.message, fixture.message);
  assert.equal(envelope.digest, fixture.digest);
});
test('canonical context is stable across JSON key order and whitespace', () => {
  const alternate = {
    ...claim,
    context: '{"a":{"recipient":"fixture","amount":"-100"},"z":"demo"}',
  };
  assert.equal(claimEnvelope(alternate).digest, claimEnvelope(claim).digest);
});
test('a genuine local fixture signature recovers its fixture signer', async () => {
  const signature = await wallet.signMessage(claimEnvelope(claim).message);
  assert.equal(recoverClaimSigners(claim, [signature]).signers[0], wallet.address.toLowerCase());
});
for (const [name, change] of [
  [
    'amount in context',
    { context: JSON.stringify({ z: 'demo', a: { amount: '-200', recipient: 'fixture' } }) },
  ],
  ['request parameters', { parameters: '{"example":"another source"}' }],
  ['owner', { owner: '0x' + '22'.repeat(20) }],
  ['timestamp', { timestampS: claim.timestampS + 1 }],
  ['epoch', { epoch: 2 }],
]) {
  test(`changing ${name} invalidates the fixture signer match`, async () => {
    const signature = await wallet.signMessage(claimEnvelope(claim).message);
    const actual = recoverClaimSigners({ ...claim, ...change }, [signature]).signers[0];
    assert.notEqual(actual, wallet.address.toLowerCase());
  });
}
test('invalid JSON context and absent signatures fail closed', () => {
  assert.throws(() => claimEnvelope({ ...claim, context: '{' }));
  assert.throws(() => recoverClaimSigners(claim, []));
});
