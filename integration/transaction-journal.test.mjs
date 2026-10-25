import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TransactionJournal, isDurableTransactionJournal } from './transaction-journal.mjs';

test('journal requires disk storage and retains the exact unknown transaction across restart', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-journal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => new TransactionJournal(':memory:'));
  assert.equal(isDurableTransactionJournal({ get() {}, reserve() {}, put() {} }), false);
  const path = join(directory, 'transactions.sqlite');
  let journal = new TransactionJournal(path);
  assert.equal(journal.reserve('order:begin'), true);
  journal.put('order:begin', {
    state: 'submitted-or-unknown',
    hash: '11'.repeat(32),
    method: 'begin_payment',
  });
  journal.close();
  journal = new TransactionJournal(path);
  assert.equal(journal.reserve('order:begin'), false);
  assert.equal(journal.get('order:begin').hash, '11'.repeat(32));
  assert.throws(() =>
    journal.put('order:begin', {
      state: 'confirmed',
      hash: '22'.repeat(32),
      method: 'begin_payment',
    }),
  );
  journal.put('order:begin', {
    state: 'confirmed',
    hash: '11'.repeat(32),
    method: 'begin_payment',
  });
  assert.throws(() =>
    journal.put('order:begin', {
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
  assert.equal(first.reserve('fund:whole-offer'), true);
  assert.equal(second.reserve('fund:whole-offer'), false);
  assert.equal(second.get('fund:whole-offer').state, 'preparing');
  first.close();
  second.close();
  const reopened = new TransactionJournal(path);
  assert.equal(reopened.reserve('fund:whole-offer'), false);
  reopened.close();
});
