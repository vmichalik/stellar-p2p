import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decodeVerifierPayment } from '../src/tlsn-record.mjs';
import { createTlsnEvidenceStore } from '../src/tlsn-store.mjs';
import { normalizeLiveTlsnPayment } from '../src/evidence.mjs';

import { ids, now, transaction, payload, range } from './fixtures/tlsn-record.mjs';

for (const chunked of [false, true])
  test(`normalizes one complete authenticated record with ${chunked ? 'chunked' : 'length'} framing`, () => {
    const result = decodeVerifierPayment(payload({ chunked }), now);
    assert.equal(result.amountMinor, '123');
    assert.equal(result.direction, 'OUTGOING');
    assert.equal(result.payerScope, `revolut:identity:${ids[2]}`);
    assert.equal(result.recipientId, `revolut:identity:${ids[4]}`);
    assert.equal(result.completedAt, String((now - 1000) / 1000));
    assert.doesNotMatch(
      JSON.stringify(result),
      /987654321|NOT_PERSISTED|synthetic-code|Set-Cookie/,
    );
  });

test('rejects gaps, hashes, fake handler labels, wrong TLS host and wrong request binding', () => {
  const changes = [
    (p) => (p.config.recv[0].start = 1),
    (p) => p.config.recv[0].end--,
    (p) => (p.config.recv[0].handler.action.kind = 'HASH'),
    (p) => (p.config.recv[0].handler.type = 'SENT'),
    (p) => (p.config.sent[0].start = 1),
    (p) => (p.server_name = 'attacker.example'),
    (p) => (p.transcript.sent = p.transcript.sent.replace(ids[0], ids[1])),
    (p) => (p.transcript.recv = p.transcript.recv.replace('200 OK', '401 NO')),
    (p) => p.transcript.recv_length--,
  ];
  for (const change of changes) {
    const p = payload();
    change(p);
    assert.throws(() => decodeVerifierPayment(p, now));
  }
  const p = payload();
  p.config.recv = [range('RECV', 0, 5), range('RECV', 6, p.transcript.recv_length)];
  p.results = [{ type: 'RECV', part: 'BODY', value: '{"amount":-123}' }];
  assert.throws(() => decodeVerifierPayment(p, now), /FULL_RESPONSE_REQUIRED/);
});

test('rejects ambiguous JSON, framing, compression and stale response', () => {
  const body = JSON.stringify([transaction()]);
  for (const json of [
    body.replace('"amount":-123', '"amount":-123,"amount":-999'),
    body.replace('"amount":-123', '"amount":-123,"amou\\u006et":-999'),
    JSON.stringify([transaction(), transaction()]),
    body + ' []',
  ])
    assert.throws(() => decodeVerifierPayment(payload({ json }), now));
  for (const headers of [
    'Content-Encoding: gzip\r\n',
    'Content-Length: 2\r\n',
    'Content-Type: text/html\r\n',
  ])
    assert.throws(() => decodeVerifierPayment(payload({ headers }), now));
  assert.throws(() =>
    decodeVerifierPayment(payload({ chunked: true, headers: 'Content-Length: 2\r\n' }), now),
  );
  assert.throws(() => decodeVerifierPayment(payload(), now + 300001), /STALE_VERIFIER_RESPONSE/);
});

test('refuses unsupported payment semantics instead of converting every amount to an absolute value', () => {
  const changes = [
    (p) => (p.amount = 123),
    (p) => (p.amount = 0),
    (p) => (p.amount = -1.5),
    (p) => (p.amount = -Number.MAX_SAFE_INTEGER - 1),
    (p) => (p.amountWithCharges = -124),
    (p) => (p.fee = 1),
    (p) => (p.currency = 'USD'),
    (p) => (p.state = 'PENDING'),
    (p) => (p.type = 'CARD_PAYMENT'),
    (p) => (p.transferAppSource = 'BANK'),
    (p) => (p.completedDate = now + 1),
    (p) => (p.recipient.id = ids[1]),
    (p) => (p.registeredIdentityId = p.recipient.identityId),
    (p) => delete p.registeredIdentityId,
    (p) => delete p.account.id,
    (p) => (p.recipient.account.type = 'SAVINGS'),
  ];
  for (const change of changes) {
    const p = transaction();
    change(p);
    assert.throws(() => decodeVerifierPayment(payload({ payment: p }), now));
  }
});

test('trusted ingress authenticates, persists only normalized fields, and normalizer rejects plain forged records', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pactlane-tlsn-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'evidence.sqlite'),
    secret = 'ab'.repeat(32);
  let store = createTlsnEvidenceStore({
    path,
    ingressSecret: secret,
    clock: () => now,
    maxRecords: 1,
  });
  assert.throws(
    () => store.ingest({ authorization: 'Bearer fake', payload: payload() }),
    /UNAUTHORIZED/,
  );
  const receipt = store.ingest({ authorization: `Bearer ${secret}`, payload: payload() });
  assert.equal(receipt.releaseGate, 'NOT_CLEARED');
  assert.throws(
    () =>
      normalizeLiveTlsnPayment({ verified: true, payment: decodeVerifierPayment(payload(), now) }),
    /SCHEMA_UNVERIFIED/,
  );
  assert.equal(
    normalizeLiveTlsnPayment(store.reader.readVerifiedRecord(receipt.evidenceId)).amountMinor,
    '123',
  );
  assert.throws(
    () =>
      normalizeLiveTlsnPayment(
        structuredClone(store.reader.readVerifiedRecord(receipt.evidenceId)),
      ),
    /SCHEMA_UNVERIFIED/,
  );
  assert.deepEqual(
    store.ingest({ authorization: `Bearer ${secret}`, payload: payload() }),
    receipt,
  );
  const changed = transaction();
  changed.amount = -124;
  changed.amountWithCharges = -124;
  assert.throws(
    () =>
      store.ingest({ authorization: `Bearer ${secret}`, payload: payload({ payment: changed }) }),
    /COLLISION/,
  );
  const other = payload();
  other.session.id = 'another-session';
  assert.throws(
    () => store.ingest({ authorization: `Bearer ${secret}`, payload: other }),
    /CAPACITY/,
  );
  store.close();
  assert.doesNotMatch(
    readFileSync(path).toString(),
    /NOT_PERSISTED|987654321|synthetic-code|Set-Cookie/,
  );
  store = createTlsnEvidenceStore({ path, ingressSecret: 'cd'.repeat(32), clock: () => now });
  assert.equal(
    normalizeLiveTlsnPayment(store.reader.readVerifiedRecord(receipt.evidenceId)).paymentId,
    ids[0],
  );
  store.close();
});
