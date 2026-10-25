import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { decodeVerifierPayment } from './tlsn-record.mjs';
import { requirePolicy, identifier } from './errors.mjs';

const records = new WeakMap();
const readers = new WeakSet();
export function isTrustedTlsnReader(value) {
  return readers.has(value);
}
export function normalizedVerifiedPayment(record) {
  requirePolicy(records.has(record), 'TLSN_PAYMENT_SCHEMA_UNVERIFIED');
  return structuredClone(records.get(record));
}

/** Private local receiver. Only the pinned verifier knows the ingress secret.
 * Never expose ingest through the browser API or use a client verified flag.
 * Store normalized required fields, not cookies, balances, names or transcripts.
 */
export function createTlsnEvidenceStore({
  path,
  ingressSecret,
  clock = Date.now,
  maxRecords = 1000,
}) {
  requirePolicy(typeof path === 'string' && isAbsolute(path), 'PRIVATE_EVIDENCE_STORE_REQUIRED');
  requirePolicy(
    !existsSync(path) || (lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()),
    'PRIVATE_EVIDENCE_STORE_REQUIRED',
  );
  requirePolicy(
    typeof ingressSecret === 'string' && /^[a-f0-9]{64}$/.test(ingressSecret),
    'VERIFIER_INGRESS_SECRET_REQUIRED',
  );
  requirePolicy(
    typeof clock === 'function' &&
      Number.isSafeInteger(maxRecords) &&
      maxRecords > 0 &&
      maxRecords <= 10000,
    'INVALID_STORE',
  );
  const expected = Buffer.from(`Bearer ${ingressSecret}`);
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS tlsn_payment_records (
      id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL,
      payment TEXT NOT NULL, digest TEXT NOT NULL, received_at INTEGER NOT NULL
    );`);
  function authenticate(authorization) {
    const supplied = Buffer.from(typeof authorization === 'string' ? authorization : '');
    requirePolicy(
      supplied.length === expected.length && timingSafeEqual(supplied, expected),
      'VERIFIER_INGRESS_UNAUTHORIZED',
    );
  }
  const reader = Object.freeze({
    readVerifiedRecord(id) {
      identifier(id);
      const row = db.prepare('SELECT * FROM tlsn_payment_records WHERE id=?').get(id);
      requirePolicy(row && row.schema_version === 1, 'VERIFIED_EVIDENCE_NOT_FOUND');
      requirePolicy(
        createHash('sha256').update(row.payment).digest('hex') === row.digest,
        'EVIDENCE_STORE_CORRUPT',
      );
      const record = Object.freeze({ evidenceId: id });
      records.set(record, JSON.parse(row.payment));
      return record;
    },
  });
  readers.add(reader);
  return Object.freeze({
    reader,
    ingest({ authorization, payload }) {
      authenticate(authorization);
      // IDs are opaque references only, never account/order authorization.
      const id = payload?.session?.id;
      identifier(id);
      const receivedAt = clock();
      const payment = JSON.stringify(decodeVerifierPayment(payload, receivedAt));
      const digest = createHash('sha256').update(payment).digest('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = db.prepare('SELECT digest FROM tlsn_payment_records WHERE id=?').get(id);
        requirePolicy(!previous || previous.digest === digest, 'EVIDENCE_ID_COLLISION');
        if (!previous) {
          requirePolicy(
            db.prepare('SELECT count(*) AS n FROM tlsn_payment_records').get().n < maxRecords,
            'EVIDENCE_STORE_CAPACITY',
          );
          db.prepare('INSERT INTO tlsn_payment_records VALUES (?,1,?,?,?)').run(
            id,
            payment,
            digest,
            receivedAt,
          );
        }
        db.exec('COMMIT');
        return Object.freeze({
          evidenceId: id,
          status: 'VERIFIED_RECORD_STORED',
          releaseGate: 'NOT_CLEARED',
        });
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      readers.delete(reader);
      db.close();
    },
  });
}
