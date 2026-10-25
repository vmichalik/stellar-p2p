import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TransactionJournal, isDurableTransactionJournal } from './transaction-journal.mjs';
import { DatabaseSync } from 'node:sqlite';

const binding = { method: 'begin_payment', argumentsHash: 'aa'.repeat(32) };

test('journal requires disk storage and retains the exact unknown transaction across restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-journal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => new TransactionJournal(':memory:'));
  assert.equal(isDurableTransactionJournal({ get() {}, reserve() {}, put() {} }), false);
  const path = join(directory, 'transactions.sqlite');
  let journal = new TransactionJournal(path);
  const attempt = journal.reserve('order:begin', binding);
  assert.match(attempt, /^[a-f0-9]{64}$/);
  journal.markSigning('order:begin', attempt, '11'.repeat(32));
  journal.markSigned('order:begin', attempt);
  journal.put('order:begin', attempt, {
    state: 'submitted-or-unknown',
    hash: '11'.repeat(32),
    method: 'begin_payment',
  });
  journal.close();
  journal = new TransactionJournal(path);
  assert.equal(journal.reserve('order:begin', binding), null);
  assert.equal(journal.get('order:begin').hash, '11'.repeat(32));
  assert.throws(() =>
    journal.put('order:begin', attempt, {
      state: 'confirmed',
      hash: '22'.repeat(32),
      method: 'begin_payment',
    }),
  );
  journal.put('order:begin', attempt, {
    state: 'confirmed',
    hash: '11'.repeat(32),
    method: 'begin_payment',
  });
  assert.throws(() =>
    journal.put('order:begin', attempt, {
      state: 'submitted-or-unknown',
      hash: '11'.repeat(32),
      method: 'begin_payment',
    }),
  );
  journal.close();
});

test('separate SQLite handles atomically reserve one action and cannot expire a preparing record', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-journal-race-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'transactions.sqlite');
  const first = new TransactionJournal(path),
    second = new TransactionJournal(path);
  assert.match(first.reserve('fund:whole-offer', binding), /^[a-f0-9]{64}$/);
  assert.equal(second.reserve('fund:whole-offer', binding), null);
  assert.equal(second.get('fund:whole-offer').state, 'preparing');
  first.close();
  second.close();
  const reopened = new TransactionJournal(path);
  assert.equal(reopened.reserve('fund:whole-offer', binding), null);
  reopened.close();
});

test('retry retains both bindings and fences every stale owner across SQLite handles', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-journal-retry-'));
  const path = join(directory, 'transactions.sqlite');
  const first = new TransactionJournal(path),
    second = new TransactionJournal(path);
  t.after(() => {
    first.close();
    second.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const old = first.reserve('order:begin', binding);
  first.markRetryable('order:begin', old, 'PREPARATION_FAILED');
  const changed = { ...binding, argumentsHash: 'bb'.repeat(32) };
  const current = second.reserve('order:begin', changed);
  assert.notEqual(current, old);
  assert.throws(() => first.reserve('order:begin', binding), /ARGUMENT_MISMATCH/);
  assert.equal(first.reserve('order:begin', changed), null);
  for (const mutate of [
    () => first.markSigning('order:begin', old, '11'.repeat(32)),
    () => first.markSigned('order:begin', old),
    () => first.markRetryable('order:begin', old, 'PREPARATION_FAILED'),
    () =>
      first.put('order:begin', old, {
        ...binding,
        state: 'submitted-or-unknown',
        hash: '11'.repeat(32),
      }),
  ])
    assert.throws(mutate, /ATTEMPT_NOT_OWNED/);
  assert.equal(second.get('order:begin').state, 'preparing');
  assert.deepEqual(
    first.history('order:begin').map(({ state, argumentsHash }) => [state, argumentsHash]),
    [
      ['preparing', binding.argumentsHash],
      ['retryable', binding.argumentsHash],
      ['preparing', changed.argumentsHash],
    ],
  );
});

test('only explicit refusal can retry signing, and no returned envelope can be retried', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-journal-signing-'));
  const journal = new TransactionJournal(join(directory, 'transactions.sqlite'));
  t.after(() => {
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const declined = journal.reserve('order:begin', binding);
  journal.markSigning('order:begin', declined, '11'.repeat(32));
  assert.throws(
    () => journal.markRetryable('order:begin', declined, 'PREPARATION_FAILED'),
    /TRANSITION_INVALID/,
  );
  assert.throws(() => journal.markRetryable('order:begin', declined, 'WALLET_TIMEOUT'));
  journal.markRetryable('order:begin', declined, 'WALLET_REJECTED');
  const attempt = journal.reserve('order:begin', binding);
  journal.markSigning('order:begin', attempt, '22'.repeat(32));
  journal.markSigned('order:begin', attempt);
  assert.throws(
    () => journal.markRetryable('order:begin', attempt, 'WALLET_REJECTED'),
    /TRANSITION_INVALID/,
  );
  journal.put('order:begin', attempt, {
    method: binding.method,
    state: 'submitted-or-unknown',
    hash: '22'.repeat(32),
  });
  assert.throws(
    () => journal.markRetryable('order:begin', attempt, 'WALLET_REJECTED'),
    /TRANSITION_INVALID/,
  );
  const history = journal.history('order:begin');
  assert.equal(history.find((entry) => entry.state === 'retryable').hash, '11'.repeat(32));
  assert.equal(history.filter((entry) => entry.state === 'preparing').length, 2);
});

test('legacy databases preserve unknown/preparing rows and migrate history idempotently', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-journal-legacy-'));
  const path = join(directory, 'transactions.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE actions (key TEXT PRIMARY KEY, state TEXT NOT NULL, hash TEXT, method TEXT);
    INSERT INTO actions VALUES ('legacy:preparing', 'preparing', NULL, NULL);`);
  legacy
    .prepare('INSERT INTO actions VALUES (?, ?, ?, ?)')
    .run('legacy:unknown', 'submitted-or-unknown', '33'.repeat(32), 'begin_payment');
  legacy.close();
  for (let pass = 0; pass < 2; pass++) {
    const journal = new TransactionJournal(path);
    assert.equal(journal.reserve('legacy:preparing', binding), null);
    assert.equal(journal.get('legacy:preparing').state, 'preparing');
    assert.throws(
      () => journal.markRetryable('legacy:preparing', '11'.repeat(32), 'PREPARATION_FAILED'),
      /ATTEMPT_NOT_OWNED/,
    );
    assert.equal(journal.get('legacy:unknown').hash, '33'.repeat(32));
    assert.equal(journal.history('legacy:unknown').length, 1);
    assert.equal(journal.history('legacy:unknown')[0].code, 'LEGACY_IMPORTED');
    journal.close();
  }
});

test('a failed legacy migration closes the otherwise unreachable database handle', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-journal-invalid-'));
  const path = join(directory, 'transactions.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const broken = new DatabaseSync(path);
  broken.exec('CREATE TABLE actions (key TEXT PRIMARY KEY)');
  broken.close();
  const original = DatabaseSync.prototype.close;
  const closed = [];
  DatabaseSync.prototype.close = function () {
    closed.push(this);
    return original.call(this);
  };
  try {
    assert.throws(() => new TransactionJournal(path), /no such column/);
  } finally {
    DatabaseSync.prototype.close = original;
  }
  assert.equal(closed.length, 1);
  assert.throws(() => closed[0].prepare('SELECT 1'), /not open/);
});
