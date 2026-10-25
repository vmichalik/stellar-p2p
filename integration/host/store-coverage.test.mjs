import assert from 'node:assert/strict';
import test from 'node:test';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { ReplayStore, escrowDomainKey } from '../../policy/src/index.mjs';

const domain = (byte) =>
  escrowDomainKey({
    network_passphrase: Networks.TESTNET,
    contract: StrKey.encodeContract(Buffer.alloc(32, byte)),
  });

test('replay database binds to one deployment and refuses unknown historical coverage', () => {
  const firstDomain = domain(10),
    secondDomain = domain(11);
  const store = new ReplayStore(':memory:');
  try {
    store.bindDomain(firstDomain);
    store.bindDomain(firstDomain);
    assert.throws(() => store.bindDomain(secondDomain), { code: 'STORE_COVERAGE_MISMATCH' });
  } finally {
    store.close();
  }

  const legacy = new ReplayStore(':memory:');
  try {
    legacy.advanceCheckpoint(firstDomain, '25');
    assert.throws(() => legacy.bindDomain(firstDomain), { code: 'STORE_COVERAGE_UNVERIFIED' });
  } finally {
    legacy.close();
  }
});
