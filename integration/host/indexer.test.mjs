import assert from 'node:assert/strict';
import test from 'node:test';
import { Networks, StrKey, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { ReplayStore, escrowDomainKey } from '../../policy/src/index.mjs';
import { createEscrowIndexer } from './indexer.mjs';

const contract = StrKey.encodeContract(Buffer.alloc(32, 7));
const domain = { network_passphrase: Networks.TESTNET, contract };
const key = escrowDomainKey(domain);
const sym = (value) => nativeToScVal(value, { type: 'symbol' });
const orderEvent = (state) => ({
  contractId: contract,
  ledger: 50,
  topic: [sym('order_changed'), nativeToScVal(9n, { type: 'u64' })],
  value: xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: sym('state'), val: xdr.ScVal.scvVec([sym(state)]) }),
  ]),
});

test('indexer holds every unknown-payment Resolved event before advancing its checkpoint', async () => {
  const store = new ReplayStore(':memory:');
  const deployment = {
    contract,
    networkPassphrase: Networks.TESTNET,
    startLedger: 50,
    rpcUrl: 'https://rpc.invalid',
  };
  const server = {
    async getLatestLedger() {
      return { sequence: 50 };
    },
    async getEvents(request) {
      assert.equal(request.startLedger, 50);
      assert.equal(request.endLedger, 51);
      return { latestLedger: 50, cursor: 'page-1', events: [orderEvent('Resolved')] };
    },
  };
  try {
    const indexer = createEscrowIndexer({ deployment, store, server });
    assert.deepEqual(await indexer.syncOnce(), { checkpointLedger: '50', indexedLedgers: 1 });
    assert.equal(store.checkpoint(key), '50');
    assert.throws(() => store.assertReconciled(key, '50'), {
      code: 'MANUAL_RECONCILIATION_REQUIRED',
    });
  } finally {
    store.close();
  }
});

test('indexer refuses unknown order state data without advancing', async () => {
  const store = new ReplayStore(':memory:');
  const deployment = {
    contract,
    networkPassphrase: Networks.TESTNET,
    startLedger: 50,
    rpcUrl: 'https://rpc.invalid',
  };
  const server = {
    async getLatestLedger() {
      return { sequence: 50 };
    },
    async getEvents() {
      return { latestLedger: 50, cursor: 'page-1', events: [orderEvent('Unrecognized')] };
    },
  };
  try {
    const indexer = createEscrowIndexer({ deployment, store, server });
    await assert.rejects(indexer.syncOnce(), /INDEXER_EVENT_DECODE_FAILED/);
    assert.equal(store.checkpoint(key), null);
  } finally {
    store.close();
  }
});
