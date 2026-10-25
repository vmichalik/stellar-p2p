import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';

const durable = new WeakSet();
const check = (condition) => {
  if (!condition) throw new Error('TRANSACTION_JOURNAL_INVALID');
};
const validKey = (key) => check(typeof key === 'string' && key.length > 0 && key.length <= 4096);

/** Host-only disk journal. Never stores a wallet secret or signed envelope.
 * Unknown/preparing records have no automatic expiry or delete operation.
 */
export class TransactionJournal {
  #db;
  constructor(path) {
    check(typeof path === 'string' && path.length > 0 && path !== ':memory:');
    this.#db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS actions (
        key TEXT PRIMARY KEY, state TEXT NOT NULL, hash TEXT, method TEXT
      );`);
    durable.add(this);
  }
  get(key) {
    validKey(key);
    const row = this.#db.prepare('SELECT state, hash, method FROM actions WHERE key=?').get(key);
    return row ? { ...row } : null;
  }
  reserve(key) {
    validKey(key);
    return (
      this.#db.prepare("INSERT OR IGNORE INTO actions VALUES (?, 'preparing', NULL, NULL)").run(key)
        .changes === 1
    );
  }
  put(key, record) {
    validKey(key);
    check(
      record &&
        /^[a-f0-9]{64}$/.test(record.hash) &&
        ['submitted-or-unknown', 'confirmed'].includes(record.state) &&
        ['fund', 'reserve', 'begin_payment', 'release', 'refund', 'resolve'].includes(
          record.method,
        ),
    );
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.get(key);
      check(
        prior &&
          (!prior.hash || prior.hash === record.hash) &&
          (!prior.method || prior.method === record.method),
      );
      check(prior.state !== 'confirmed' || record.state === 'confirmed');
      this.#db
        .prepare('UPDATE actions SET state=?, hash=?, method=? WHERE key=?')
        .run(record.state, record.hash, record.method, key);
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    durable.delete(this);
    this.#db.close();
  }
}

export const isDurableTransactionJournal = (journal) => durable.has(journal);
