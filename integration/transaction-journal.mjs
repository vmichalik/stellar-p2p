import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const durable = new WeakSet();
const check = (condition, code = 'TRANSACTION_JOURNAL_INVALID') => {
  if (!condition) throw new Error(code);
};
const validKey = (key) => check(typeof key === 'string' && key.length > 0 && key.length <= 4096);
const hex32 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const methods = new Set(['fund', 'reserve', 'begin_payment', 'release', 'refund', 'resolve']);

/** Host-only disk journal. Never stores a wallet secret or signed envelope.
 * Every attempt transition is retained. Only a positively identified failure
 * before a returned buyer envelope permits another attempt; clocks never do.
 * Attempt tokens are host-private ownership capabilities, never browser input.
 */
export class TransactionJournal {
  #db;
  constructor(path) {
    check(typeof path === 'string' && path.length > 0 && path !== ':memory:');
    this.#db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
      this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      this.#transaction(() => {
        this.#db.exec(`CREATE TABLE IF NOT EXISTS actions (
        key TEXT PRIMARY KEY, state TEXT NOT NULL, hash TEXT, method TEXT,
        attempt_token TEXT, arguments_hash TEXT
      );
      CREATE TABLE IF NOT EXISTS action_attempt_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL,
        attempt_token TEXT, arguments_hash TEXT, method TEXT,
        state TEXT NOT NULL, hash TEXT, code TEXT,
        recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`);
        const columns = this.#db
          .prepare('PRAGMA table_info(actions)')
          .all()
          .map((row) => row.name);
        if (!columns.includes('attempt_token'))
          this.#db.exec('ALTER TABLE actions ADD COLUMN attempt_token TEXT');
        if (!columns.includes('arguments_hash'))
          this.#db.exec('ALTER TABLE actions ADD COLUMN arguments_hash TEXT');
        // Legacy preparing rows have no provable owner and stay blocked.
        this.#db.exec(`INSERT INTO action_attempt_history
        (key, attempt_token, arguments_hash, method, state, hash, code)
        SELECT key, attempt_token, arguments_hash, method, state, hash, 'LEGACY_IMPORTED'
        FROM actions a WHERE a.attempt_token IS NULL AND NOT EXISTS
          (SELECT 1 FROM action_attempt_history h WHERE h.key=a.key);`);
      });
      durable.add(this);
    } catch (error) {
      // A failed constructor cannot be closed by its caller. Release the handle
      // after schema/permission/PRAGMA failures as well as successful lifetimes.
      try {
        this.#db.close();
      } catch {
        /* Preserve the initialization failure. */
      }
      throw error;
    }
  }
  #transaction(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.#db.exec('COMMIT');
      return value;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  #row(key) {
    return this.#db.prepare('SELECT * FROM actions WHERE key=?').get(key);
  }
  #record(row, code = null) {
    this.#db
      .prepare(
        `INSERT INTO action_attempt_history
      (key, attempt_token, arguments_hash, method, state, hash, code) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.key, row.attempt_token, row.arguments_hash, row.method, row.state, row.hash, code);
  }
  #owned(key, attempt, states) {
    validKey(key);
    check(hex32(attempt));
    const row = this.#row(key);
    check(row && row.attempt_token === attempt, 'TRANSACTION_ATTEMPT_NOT_OWNED');
    check(states.includes(row.state), 'TRANSACTION_JOURNAL_TRANSITION_INVALID');
    return row;
  }
  #update(row, state, hash, code = null) {
    const changed = this.#db
      .prepare('UPDATE actions SET state=?, hash=? WHERE key=? AND attempt_token=? AND state=?')
      .run(state, hash, row.key, row.attempt_token, row.state).changes;
    check(changed === 1, 'TRANSACTION_ATTEMPT_NOT_OWNED');
    this.#record({ ...row, state, hash }, code);
  }
  get(key) {
    validKey(key);
    const row = this.#row(key);
    return row
      ? { state: row.state, hash: row.hash, method: row.method, argumentsHash: row.arguments_hash }
      : null;
  }
  history(key) {
    validKey(key);
    return this.#db
      .prepare(
        `SELECT attempt_token AS attempt, arguments_hash AS argumentsHash,
      method, state, hash, code FROM action_attempt_history WHERE key=? ORDER BY id`,
      )
      .all(key)
      .map((row) => ({ ...row }));
  }
  reserve(key, { method, argumentsHash }) {
    validKey(key);
    check(methods.has(method) && hex32(argumentsHash));
    return this.#transaction(() => {
      const prior = this.#row(key);
      if (prior && prior.state !== 'retryable') {
        check(
          !prior.arguments_hash || prior.arguments_hash === argumentsHash,
          'TRANSACTION_ARGUMENT_MISMATCH',
        );
        return null;
      }
      check(!prior || (prior.attempt_token && prior.method === method));
      const attempt = randomBytes(32).toString('hex');
      if (prior) {
        check(
          this.#db
            .prepare(
              `UPDATE actions SET state='preparing', hash=NULL,
          attempt_token=?, arguments_hash=? WHERE key=? AND state='retryable' AND attempt_token=?`,
            )
            .run(attempt, argumentsHash, key, prior.attempt_token).changes === 1,
          'TRANSACTION_ATTEMPT_NOT_OWNED',
        );
      } else {
        this.#db
          .prepare(
            `INSERT INTO actions
          (key, state, hash, method, attempt_token, arguments_hash) VALUES (?, 'preparing', NULL, ?, ?, ?)`,
          )
          .run(key, method, attempt, argumentsHash);
      }
      this.#record(this.#row(key));
      return attempt;
    });
  }
  markSigning(key, attempt, hash) {
    check(hex32(hash));
    this.#transaction(() =>
      this.#update(this.#owned(key, attempt, ['preparing']), 'signing', hash),
    );
  }
  markSigned(key, attempt) {
    this.#transaction(() => {
      const row = this.#owned(key, attempt, ['signing']);
      check(hex32(row.hash));
      this.#update(row, 'signed', row.hash);
    });
  }
  markRetryable(key, attempt, code) {
    check(['PREPARATION_FAILED', 'WALLET_REJECTED'].includes(code));
    this.#transaction(() => {
      const row = this.#owned(
        key,
        attempt,
        code === 'WALLET_REJECTED' ? ['preparing', 'signing'] : ['preparing'],
      );
      // Any offered unsigned-envelope hash remains in history. Retryable means
      // the host did not acquire a buyer-signed envelope, not an expired lease.
      this.#update(row, 'retryable', row.hash, code);
    });
  }
  put(key, attempt, record) {
    check(
      record &&
        hex32(record.hash) &&
        methods.has(record.method) &&
        ['submitted-or-unknown', 'confirmed'].includes(record.state),
    );
    this.#transaction(() => {
      const row = this.#owned(
        key,
        attempt,
        record.state === 'confirmed'
          ? ['submitted-or-unknown', 'confirmed']
          : ['signed', 'submitted-or-unknown'],
      );
      check(row.hash === record.hash && row.method === record.method);
      this.#update(row, record.state, record.hash);
    });
  }
  close() {
    durable.delete(this);
    this.#db.close();
  }
}

export const isDurableTransactionJournal = (journal) => durable.has(journal);
