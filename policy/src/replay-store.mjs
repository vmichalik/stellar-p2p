import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { PolicyError, requirePolicy, hex32, uint } from './errors.mjs';

// Server-only storage. No method is an HTTP endpoint. One database must cover
// every deployment/network served by the signer. Never delete/expire bindings.
export class ReplayStore {
  #db;
  constructor(path, { syntheticOnly = false } = {}) {
    requirePolicy(typeof path === 'string' && path.length > 0, 'INVALID_STORE');
    requirePolicy(typeof syntheticOnly === 'boolean', 'INVALID_STORE');
    Object.defineProperty(this, 'syntheticOnly', { value: syntheticOnly, enumerable: true });
    this.#db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.#db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS store_mode (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payments (
        nullifier TEXT PRIMARY KEY, binding TEXT NOT NULL UNIQUE,
        claim TEXT NOT NULL, digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING','ISSUED','SETTLED','MANUAL')),
        signature TEXT
      );
      CREATE TABLE IF NOT EXISTS checkpoints (domain TEXT PRIMARY KEY, sequence TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS manual_holds (binding TEXT PRIMARY KEY);
    `);
    const mode = syntheticOnly ? 'SYNTHETIC_ONLY' : 'LIVE';
    this.#db.prepare('INSERT OR IGNORE INTO store_mode VALUES (1,?)').run(mode);
    const row = this.#db.prepare('SELECT mode FROM store_mode WHERE id=1').get();
    if (row.mode !== mode) {
      this.#db.close();
      throw new PolicyError('STORE_MODE_MISMATCH');
    }
  }
  #transaction(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      if (error instanceof PolicyError) throw error;
      throw new PolicyError('STORE_UNAVAILABLE');
    }
  }
  #noHolds() {
    requirePolicy(
      !this.#db.prepare('SELECT 1 FROM manual_holds LIMIT 1').get(),
      'MANUAL_RECONCILIATION_REQUIRED',
    );
  }
  // Trusted chain indexer only: advance AFTER processing all relevant events.
  // A Resolved event without an identified payment manifest must create a hold.
  advanceCheckpoint(domain, sequence) {
    hex32(domain);
    uint(sequence);
    this.#transaction(() => {
      const previous = this.#db
        .prepare('SELECT sequence FROM checkpoints WHERE domain=?')
        .get(domain);
      requirePolicy(
        !previous || BigInt(sequence) >= BigInt(previous.sequence),
        'CHECKPOINT_REGRESSION',
      );
      this.#db.prepare('INSERT OR REPLACE INTO checkpoints VALUES (?,?)').run(domain, sequence);
    });
  }
  assertReconciled(domain, sequence) {
    this.#noHolds();
    const row = this.#db.prepare('SELECT sequence FROM checkpoints WHERE domain=?').get(domain);
    requirePolicy(row && BigInt(row.sequence) >= uint(sequence), 'CHAIN_RECONCILIATION_BEHIND');
  }
  holdManualResolution(binding) {
    hex32(binding);
    this.#db.prepare('INSERT OR IGNORE INTO manual_holds VALUES (?)').run(binding);
  }
  reserve({ nullifier, binding, claim, digest, now }) {
    hex32(nullifier);
    hex32(binding);
    hex32(digest);
    return this.#transaction(() => {
      this.#noHolds();
      const prior = this.#db.prepare('SELECT * FROM payments WHERE nullifier=?').get(nullifier);
      if (prior) {
        requirePolicy(prior.binding === binding, 'PAYMENT_ALREADY_BOUND');
        requirePolicy(['PENDING', 'ISSUED'].includes(prior.status), 'PAYMENT_CONSUMED');
        requirePolicy(
          uint(JSON.parse(prior.claim).expires_at) > now,
          'CLAIM_RENEWAL_REQUIRES_RECONCILIATION',
        );
        return { ...prior, claim: JSON.parse(prior.claim) };
      }
      requirePolicy(
        !this.#db.prepare('SELECT 1 FROM payments WHERE binding=?').get(binding),
        'ORDER_ALREADY_BOUND',
      );
      this.#db
        .prepare('INSERT INTO payments VALUES (?,?,?,?,?,NULL)')
        .run(nullifier, binding, JSON.stringify(claim), digest, 'PENDING');
      return { nullifier, binding, claim, digest, status: 'PENDING', signature: null };
    });
  }
  complete(nullifier, digest, signature) {
    return this.#transaction(() => {
      this.#noHolds();
      const prior = this.#db.prepare('SELECT * FROM payments WHERE nullifier=?').get(nullifier);
      requirePolicy(
        prior && prior.digest === digest && ['PENDING', 'ISSUED'].includes(prior.status),
        'ISSUANCE_RECONCILIATION_REQUIRED',
      );
      this.#db
        .prepare("UPDATE payments SET status='ISSUED', signature=? WHERE nullifier=?")
        .run(signature, nullifier);
    });
  }
  // Called only after a confirmed Released order AND payment_used(nullifier).
  markReleased(nullifier, binding) {
    hex32(nullifier);
    hex32(binding);
    const result = this.#db
      .prepare(
        "UPDATE payments SET status='SETTLED' WHERE nullifier=? AND binding=? AND status IN ('ISSUED','SETTLED')",
      )
      .run(nullifier, binding);
    requirePolicy(result.changes === 1, 'ISSUANCE_RECONCILIATION_REQUIRED');
  }
  // Trusted recovery reconciler only, after chain confirmation and a COMPLETE
  // verified payment manifest. Empty/unknown identity never clears a hold.
  completeManualResolution(binding, nullifiers) {
    hex32(binding);
    requirePolicy(
      Array.isArray(nullifiers) &&
        nullifiers.length > 0 &&
        new Set(nullifiers).size === nullifiers.length,
      'MANUAL_PAYMENT_IDENTITY_REQUIRED',
    );
    nullifiers.forEach(hex32);
    this.#transaction(() => {
      requirePolicy(
        this.#db.prepare('SELECT 1 FROM manual_holds WHERE binding=?').get(binding),
        'MANUAL_HOLD_REQUIRED',
      );
      for (const nullifier of nullifiers) {
        const prior = this.#db.prepare('SELECT * FROM payments WHERE nullifier=?').get(nullifier);
        requirePolicy(!prior || prior.binding === binding, 'PAYMENT_ALREADY_BOUND');
        if (prior)
          this.#db.prepare("UPDATE payments SET status='MANUAL' WHERE nullifier=?").run(nullifier);
        else {
          // Manual manifests may include several payments, so their tombstones
          // use unique internal bindings while keeping the global nullifier PK.
          this.#db
            .prepare('INSERT INTO payments VALUES (?,?,?,?,?,NULL)')
            .run(nullifier, `${binding}:manual:${nullifier}`, '{}', '', 'MANUAL');
        }
      }
      this.#db.prepare('DELETE FROM manual_holds WHERE binding=?').run(binding);
    });
  }
  close() {
    this.#db.close();
  }
}
