import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Address, Contract, Networks, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { ReplayStore, escrowDomainKey, orderBinding } from '../policy/src/index.mjs';
import { createChainReconciler } from './chain-reconciler.mjs';

const contract = Address.contract(Buffer.alloc(32, 5)).toString();
const domain = { contract, network_passphrase: Networks.TESTNET };
const domainKey = escrowDomainKey(domain);
const symbol = (value) => nativeToScVal(value, { type: 'symbol' });
function event(ledger, orderId, state = 'Resolved', eventIndex = 0) {
  // SDK XDR, round-tripped through the same format delivered by getEvents.
  const wire = new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: new Address(contract).toScAddress().contractId,
    type: xdr.ContractEventType.contract,
    body: xdr.ContractEventBody.v0(
      new xdr.ContractEventV0({
        topics: [symbol('order_changed'), nativeToScVal(BigInt(orderId), { type: 'u64' })],
        data: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({ key: symbol('state'), val: xdr.ScVal.scvVec([symbol(state)]) }),
        ]),
      }),
    ),
  });
  const body = xdr.ContractEvent.fromXDR(wire.toXDR()).body.v0;
  return {
    type: 'contract',
    contractId: new Contract(contract),
    ledger,
    id:
      String((BigInt(ledger) << 32n) | 4096n).padStart(19, '0') +
      '-' +
      String(eventIndex).padStart(10, '0'),
    txHash: 'ab'.repeat(32),
    inSuccessfulContractCall: true,
    topic: body.topics,
    value: body.data,
  };
}
function fixture(events = [], options = {}) {
  const store = options.store ?? new ReplayStore(':memory:');
  const calls = [];
  const server = {
    getNetwork: async () => ({ passphrase: Networks.TESTNET, protocolVersion: 29 }),
    getEvents: async (request) => {
      calls.push(request);
      return {
        oldestLedger: 100,
        latestLedger: 9999,
        cursor: 'opaque-end-of-requested-window',
        events: events
          .filter(
            (value) => value.ledger >= request.startLedger && value.ledger < request.endLedger,
          )
          .slice(0, request.limit),
      };
    },
  };
  return {
    store,
    server,
    calls,
    scanner: createChainReconciler({ domain, deploymentLedger: '100', store, server, ...options }),
  };
}

test('frozen artifact event specification matches the XDR decoder boundary', () => {
  const spec = JSON.parse(
    readFileSync(new URL('../contracts/escrow/interface.json', import.meta.url), 'utf8'),
  );
  const value = spec.find((entry) => entry.event_v0?.name === 'OrderChanged').event_v0;
  assert.deepEqual(value.prefix_topics, ['order_changed']);
  assert.equal(value.data_format, 'map');
  assert.deepEqual(
    value.params.map(({ name, type, location }) => ({ name, type, location })),
    [
      { name: 'order_id', type: 'u64', location: 'topic_list' },
      { name: 'state', type: { udt: { name: 'State' } }, location: 'data' },
    ],
  );
});

test('scan starts at deployment and commits recovery holds before allowing policy at the checkpoint', async () => {
  // The contract's first funded order is ID zero.
  const f = fixture([event(101, 0, 'Funded'), event(105, 0, 'Resolved')]);
  try {
    assert.deepEqual(await f.scanner.syncThrough('110'), {
      ledgerSequence: '110',
      eventsProcessed: 2,
    });
    assert.equal(f.calls[0].startLedger, 100);
    assert.equal(f.calls[0].endLedger, 111);
    assert.deepEqual(f.calls[0].filters, [{ type: 'contract', contractIds: [contract] }]);
    assert.equal(f.store.readCheckpoint(domainKey), '110');
    assert.throws(() => f.store.assertReconciled(domainKey, '110'), {
      code: 'MANUAL_RECONCILIATION_REQUIRED',
    });
    f.store.completeManualResolution(orderBinding(domain, '0'), ['88'.repeat(32)]);
    f.store.assertReconciled(domainKey, '110');
    // A much newer latestLedger does not advance the requested scan boundary.
    assert.equal(f.store.readCheckpoint(domainKey), '110');
  } finally {
    f.store.close();
  }
});

test('full pages split into bounded disjoint ranges; no cursor is mixed with ledger bounds', async () => {
  const f = fixture([event(101, 1, 'Funded'), event(106, 2, 'Paying'), event(109, 3, 'Refunded')], {
    eventLimit: 2,
  });
  try {
    const result = await f.scanner.syncThrough('110');
    assert.equal(result.eventsProcessed, 3);
    assert.ok(f.calls.length > 1);
    assert.ok(
      f.calls.every((call) => call.cursor === undefined && call.endLedger > call.startLedger),
    );
    f.store.assertReconciled(domainKey, '110');
  } finally {
    f.store.close();
  }
});

test('a saturated single ledger never advances, even after earlier ranges were fetched', async () => {
  const f = fixture([event(105, 1, 'Resolved', 1), event(105, 2, 'Resolved', 2)], {
    eventLimit: 2,
    rangeLedgers: 3,
  });
  try {
    await assert.rejects(f.scanner.syncThrough('110'), /CHAIN_LEDGER_EVENT_LIMIT/);
    assert.equal(f.store.readCheckpoint(domainKey), null);
    assert.throws(() => f.store.assertReconciled(domainKey, '100'), {
      code: 'CHAIN_RECONCILIATION_BEHIND',
    });
  } finally {
    f.store.close();
  }
});

test('retention gaps, stale RPCs, malformed events and wrong networks leave no checkpoint', async () => {
  for (const issue of ['retention', 'stale', 'contract', 'topic', 'state', 'failed', 'network']) {
    const value = event(105, 1);
    if (issue === 'contract')
      value.contractId = new Contract(Address.contract(Buffer.alloc(32, 6)).toString());
    if (issue === 'topic') value.topic[1] = symbol('1');
    if (issue === 'state')
      value.value = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: symbol('state'),
          val: xdr.ScVal.scvVec([symbol('Unsupported')]),
        }),
      ]);
    if (issue === 'failed') value.inSuccessfulContractCall = false;
    const f = fixture([value]);
    try {
      if (issue === 'network')
        f.server.getNetwork = async () => ({ passphrase: Networks.PUBLIC, protocolVersion: 29 });
      const read = f.server.getEvents;
      f.server.getEvents = async (request) => ({
        ...(await read(request)),
        ...(issue === 'retention' ? { oldestLedger: 101 } : {}),
        ...(issue === 'stale' ? { latestLedger: 109 } : {}),
      });
      await assert.rejects(f.scanner.syncThrough('110'));
      assert.equal(f.store.readCheckpoint(domainKey), null, issue);
    } finally {
      f.store.close();
    }
  }
});

test('later-page error leaves the entire scan uncommitted; retry can complete', async () => {
  const f = fixture([event(101, 1, 'Resolved')], { rangeLedgers: 5 });
  const read = f.server.getEvents;
  let fail = true;
  f.server.getEvents = async (request) => {
    if (fail && request.startLedger >= 105) throw new Error('RPC_UNAVAILABLE');
    return read(request);
  };
  try {
    await assert.rejects(f.scanner.syncThrough('110'), /RPC_UNAVAILABLE/);
    assert.equal(f.store.readCheckpoint(domainKey), null);
    fail = false;
    await f.scanner.syncThrough('110');
    assert.equal(f.store.readCheckpoint(domainKey), '110');
    assert.throws(() => f.store.assertReconciled(domainKey, '110'), {
      code: 'MANUAL_RECONCILIATION_REQUIRED',
    });
  } finally {
    f.store.close();
  }
});

test('disk restart resumes after checkpoint and does not resurrect an already reconciled recovery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-chain-scanner-'));
  const path = join(directory, 'policy.sqlite');
  let store = new ReplayStore(path);
  try {
    await fixture([event(105, 1)], { store }).scanner.syncThrough('110');
    store.completeManualResolution(orderBinding(domain, '1'), ['77'.repeat(32)]);
    store.close();
    store = new ReplayStore(path);
    const f = fixture([event(105, 1), event(112, 2, 'Paying')], { store });
    const results = await Promise.all([f.scanner.syncThrough('115'), f.scanner.syncThrough('115')]);
    assert.equal(f.calls[0].startLedger, 111);
    assert.equal(results[0].eventsProcessed, 1);
    assert.equal(results[1].eventsProcessed, 0);
    store.assertReconciled(domainKey, '115');
    await assert.rejects(
      createChainReconciler({
        domain,
        deploymentLedger: '99',
        store,
        server: f.server,
      }).syncThrough('115'),
      { code: 'CHAIN_ORIGIN_MISMATCH' },
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scan budgets fail closed and identical duplicate events are processed once', async () => {
  const same = event(101, 1, 'Paying');
  const f = fixture([same, same]);
  try {
    assert.equal((await f.scanner.syncThrough('110')).eventsProcessed, 1);
    const limited = createChainReconciler({
      domain,
      deploymentLedger: '100',
      server: f.server,
      store: f.store,
      rangeLedgers: 1,
      maxRequests: 1,
    });
    await assert.rejects(limited.syncThrough('115'), /CHAIN_SCAN_BUDGET_EXCEEDED/);
    assert.equal(f.store.readCheckpoint(domainKey), '110');
  } finally {
    f.store.close();
  }
});
