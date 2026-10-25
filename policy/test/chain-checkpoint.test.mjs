import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReplayStore } from '../src/index.mjs';
import { DatabaseSync } from 'node:sqlite';

const domain = '12'.repeat(32),
  binding = '34'.repeat(32),
  nullifier = '56'.repeat(32);
const batch = (overrides = {}) => ({
  domain,
  deploymentLedger: '100',
  fromLedger: '100',
  throughLedger: '110',
  resolutions: [{ binding, ledgerSequence: '105' }],
  ...overrides,
});

test('complete scan commits its hold and checkpoint durably; duplicate scan cannot restore a cleared hold', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-chain-checkpoint-'));
  const path = join(directory, 'replay.sqlite');
  let store = new ReplayStore(path);
  try {
    assert.equal(store.readCheckpoint(domain, '100'), null);
    assert.equal(store.reconcileChainBatch(batch()), '110');
    assert.throws(() => store.assertReconciled(domain, '110'), {
      code: 'MANUAL_RECONCILIATION_REQUIRED',
    });
    store.close();
    store = new ReplayStore(path);
    assert.equal(store.readCheckpoint(domain, '100'), '110');
    assert.throws(() => store.assertReconciled(domain, '110'), {
      code: 'MANUAL_RECONCILIATION_REQUIRED',
    });
    store.completeManualResolution(binding, [nullifier]);
    store.assertReconciled(domain, '110');
    assert.equal(store.reconcileChainBatch(batch()), '110');
    store.assertReconciled(domain, '110');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('range holes, stale concurrent batches and changed deployment anchors do not advance', () => {
  const store = new ReplayStore(':memory:');
  try {
    assert.throws(() => store.reconcileChainBatch(batch({ fromLedger: '101' })), {
      code: 'CHAIN_CHECKPOINT_CHANGED',
    });
    assert.equal(store.readCheckpoint(domain), null);
    store.reconcileChainBatch(batch({ resolutions: [] }));
    assert.throws(() => store.advanceCheckpoint(domain, '120'), {
      code: 'INDEXED_CHECKPOINT_REQUIRED',
    });
    assert.throws(() => store.reconcileChainBatch(batch({ throughLedger: '120' })), {
      code: 'CHAIN_CHECKPOINT_CHANGED',
    });
    assert.equal(store.readCheckpoint(domain), '110');
    assert.throws(() => store.readCheckpoint(domain, '99'), { code: 'CHAIN_ORIGIN_MISMATCH' });
    assert.throws(
      () =>
        store.reconcileChainBatch(
          batch({
            deploymentLedger: '99',
            fromLedger: '111',
            throughLedger: '120',
            resolutions: [],
          }),
        ),
      { code: 'CHAIN_ORIGIN_MISMATCH' },
    );
    assert.throws(
      () =>
        store.reconcileChainBatch(
          batch({
            fromLedger: '111',
            throughLedger: '120',
            resolutions: [{ binding, ledgerSequence: '110' }],
          }),
        ),
      { code: 'INVALID_CHAIN_RESOLUTIONS' },
    );
    store.assertReconciled(domain, '110');
    assert.throws(() => store.assertReconciled(domain, '111'), {
      code: 'CHAIN_RECONCILIATION_BEHIND',
    });
  } finally {
    store.close();
  }
});

test('legacy manually advanced checkpoint is not silently accepted as an indexed history', () => {
  const store = new ReplayStore(':memory:');
  try {
    store.advanceCheckpoint(domain, '110');
    assert.throws(() => store.readCheckpoint(domain, '100'), {
      code: 'UNTRACKED_CHAIN_CHECKPOINT',
    });
    assert.throws(
      () =>
        store.reconcileChainBatch(
          batch({ fromLedger: '111', throughLedger: '120', resolutions: [] }),
        ),
      { code: 'UNTRACKED_CHAIN_CHECKPOINT' },
    );
  } finally {
    store.close();
  }
});

test('checkpoint write failure rolls back holds, and a competing writer cannot skip an unscanned range', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-chain-atomic-'));
  const path = join(directory, 'replay.sqlite');
  const first = new ReplayStore(path),
    second = new ReplayStore(path),
    db = new DatabaseSync(path);
  try {
    db.exec(
      "CREATE TRIGGER reject_checkpoint BEFORE INSERT ON checkpoints BEGIN SELECT RAISE(ABORT, 'synthetic disk write failure'); END;",
    );
    assert.throws(() => first.reconcileChainBatch(batch()), { code: 'STORE_UNAVAILABLE' });
    assert.equal(second.readCheckpoint(domain, '100'), null);
    assert.throws(() => second.assertReconciled(domain, '100'), {
      code: 'CHAIN_RECONCILIATION_BEHIND',
    });
    db.exec('DROP TRIGGER reject_checkpoint');
    first.reconcileChainBatch(batch({ resolutions: [] }));
    // The second process fetched 100..120 before the first committed 100..110.
    assert.throws(() => second.reconcileChainBatch(batch({ throughLedger: '120' })), {
      code: 'CHAIN_CHECKPOINT_CHANGED',
    });
    first.assertReconciled(domain, '110');
    assert.equal(first.readCheckpoint(domain), '110');
  } finally {
    first.close();
    second.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
