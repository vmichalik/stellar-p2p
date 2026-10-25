import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';
import { claimDigest } from '../../policy/src/index.mjs';

const requireThat = (condition, code) => {
  if (!condition) throw new Error(code);
};
const exactObject = (value, keys) =>
  value &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key)) &&
  Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => 'value' in descriptor,
  );
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validOrder = (value) =>
  typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 20;
const validRef = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(value);
const jsonCopy = (value) => JSON.stringify(value);

/** Server-only durable job and authorization storage. Contains verifier IDs and signed policy data, never payment payloads. */
export class PolicyAuthorizationStore {
  #db;
  constructor(path) {
    requireThat(
      typeof path === 'string' && path.length > 0 && path !== ':memory:',
      'POLICY_STORE_INVALID',
    );
    this.#db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.#db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS evidence_jobs (
        job_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING','ISSUED')),
        authorization_ref TEXT UNIQUE,
        UNIQUE(order_id, evidence_id)
      );
      CREATE TABLE IF NOT EXISTS authorizations (
        authorization_ref TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        authorization_json TEXT NOT NULL
      );
    `);
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
  beginJob(orderId, evidenceId) {
    requireThat(validOrder(orderId) && validId(evidenceId), 'INVALID_POLICY_REFERENCE');
    return this.#transaction(() => {
      this.#db
        .prepare(`INSERT OR IGNORE INTO evidence_jobs VALUES (?, ?, ?, 'PENDING', NULL)`)
        .run(randomBytes(24).toString('base64url'), orderId, evidenceId);
      return this.#db
        .prepare('SELECT * FROM evidence_jobs WHERE order_id=? AND evidence_id=?')
        .get(orderId, evidenceId);
    });
  }
  completeJob({ jobId, orderId, evidenceId, authorizationRef, authorization }) {
    requireThat(validRef(authorizationRef), 'POLICY_REFERENCE_INVALID');
    const encoded = jsonCopy(authorization);
    return this.#transaction(() => {
      const job = this.#db.prepare('SELECT * FROM evidence_jobs WHERE job_id=?').get(jobId);
      requireThat(
        job && job.order_id === orderId && job.evidence_id === evidenceId,
        'POLICY_JOB_MISMATCH',
      );
      if (job.status === 'ISSUED') return job.authorization_ref;
      this.#db
        .prepare('INSERT INTO authorizations VALUES (?, ?, ?, ?)')
        .run(authorizationRef, orderId, evidenceId, encoded);
      this.#db
        .prepare("UPDATE evidence_jobs SET status='ISSUED', authorization_ref=? WHERE job_id=?")
        .run(authorizationRef, jobId);
      return authorizationRef;
    });
  }
  getJob(orderId, evidenceId) {
    requireThat(validOrder(orderId) && validId(evidenceId), 'INVALID_POLICY_REFERENCE');
    return (
      this.#db
        .prepare('SELECT * FROM evidence_jobs WHERE order_id=? AND evidence_id=?')
        .get(orderId, evidenceId) ?? null
    );
  }
  readAuthorization(orderId, authorizationRef) {
    requireThat(validOrder(orderId) && validRef(authorizationRef), 'POLICY_AUTHORIZATION_UNKNOWN');
    const row = this.#db
      .prepare(
        'SELECT authorization_json FROM authorizations WHERE authorization_ref=? AND order_id=?',
      )
      .get(authorizationRef, orderId);
    requireThat(row, 'POLICY_AUTHORIZATION_UNKNOWN');
    try {
      return JSON.parse(row.authorization_json);
    } catch {
      throw new Error('POLICY_AUTHORIZATION_INVALID');
    }
  }
  status(orderId) {
    requireThat(validOrder(orderId), 'INVALID_POLICY_REFERENCE');
    return (
      this.#db
        .prepare(
          `SELECT status, authorization_ref FROM evidence_jobs WHERE order_id=? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(orderId) ?? null
    );
  }
  issuedJob(orderId) {
    requireThat(validOrder(orderId), 'INVALID_POLICY_REFERENCE');
    return (
      this.#db
        .prepare(
          `SELECT evidence_id, authorization_ref FROM evidence_jobs WHERE order_id=? AND status='ISSUED' ORDER BY rowid DESC LIMIT 1`,
        )
        .get(orderId) ?? null
    );
  }
  close() {
    this.#db.close();
  }
}

function validateAuthorization(value, { orderId, domain, signerPublicKeyHex, now }) {
  requireThat(
    value &&
      typeof value === 'object' &&
      value.kind === 'VERIFIED_POLICY_CLAIM_V1' &&
      value.syntheticOnly === false &&
      value.releaseGate === 'POLICY_ACCEPTED',
    'POLICY_AUTHORIZATION_INVALID',
  );
  requireThat(
    value.domain?.network_passphrase === domain.network_passphrase &&
      value.domain?.contract === domain.contract,
    'POLICY_AUTHORIZATION_DOMAIN_MISMATCH',
  );
  requireThat(
    value.claim?.order_id === orderId && validOrder(value.claim.order_id),
    'POLICY_AUTHORIZATION_ORDER_MISMATCH',
  );
  requireThat(
    value.signerPublicKeyHex === signerPublicKeyHex && /^[a-f0-9]{64}$/.test(signerPublicKeyHex),
    'POLICY_SIGNER_MISMATCH',
  );
  requireThat(
    /^[a-f0-9]{64}$/.test(value.digestHex ?? '') &&
      /^[a-f0-9]{128}$/.test(value.signatureHex ?? ''),
    'POLICY_AUTHORIZATION_INVALID',
  );
  const expires = value.claim.expires_at;
  requireThat(
    typeof expires === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(expires) &&
      BigInt(expires) > BigInt(now()),
    'POLICY_AUTHORIZATION_EXPIRED',
  );
  const digest = claimDigest({ ...domain, claim: value.claim });
  requireThat(digest.toString('hex') === value.digestHex, 'POLICY_DIGEST_MISMATCH');
  const publicKey = StrKey.encodeEd25519PublicKey(Buffer.from(signerPublicKeyHex, 'hex'));
  requireThat(
    Keypair.fromPublicKey(publicKey).verify(digest, Buffer.from(value.signatureHex, 'hex')),
    'POLICY_SIGNATURE_INVALID',
  );
  return structuredClone(value);
}

/** Browser callers can name an order and trusted verifier record only. Claims, proofs and trust flags are always created server-side. */
export function createPolicyHostPort({
  policy,
  store,
  domain,
  signerPublicKeyHex,
  readStatus = async () => null,
  now = () => String(Math.floor(Date.now() / 1000)),
}) {
  requireThat(
    store &&
      typeof store.beginJob === 'function' &&
      domain?.network_passphrase === Networks.TESTNET,
    'POLICY_HOST_PORT_INVALID',
  );
  const inflight = new Map();
  async function issue(input) {
    requireThat(
      exactObject(input, ['orderId', 'evidenceId']) &&
        validOrder(input.orderId) &&
        validId(input.evidenceId),
      'INVALID_POLICY_REFERENCE',
    );
    requireThat(policy && typeof policy.issue === 'function', 'LIVE_PAYMENT_VALIDATION_PENDING');
    const job = store.beginJob(input.orderId, input.evidenceId);
    if (job.status === 'ISSUED') {
      await readAuthorization({ orderId: input.orderId, authorization: job.authorization_ref });
      return {
        authorization: job.authorization_ref,
        status: 'POLICY_ACCEPTED',
        releaseGate: 'POLICY_ACCEPTED',
      };
    }
    if (inflight.has(job.job_id)) return inflight.get(job.job_id);
    const task = (async () => {
      // This call receives IDs only; the policy module fetches and normalizes verifier evidence itself.
      const raw = await policy.issue({ orderId: input.orderId, evidenceId: input.evidenceId });
      const authorization = validateAuthorization(raw, {
        orderId: input.orderId,
        domain,
        signerPublicKeyHex,
        now,
      });
      const authorizationRef = randomBytes(32).toString('base64url');
      const reference = store.completeJob({
        jobId: job.job_id,
        orderId: input.orderId,
        evidenceId: input.evidenceId,
        authorizationRef,
        authorization,
      });
      return {
        authorization: reference,
        status: 'POLICY_ACCEPTED',
        releaseGate: 'POLICY_ACCEPTED',
      };
    })();
    inflight.set(job.job_id, task);
    try {
      return await task;
    } finally {
      inflight.delete(job.job_id);
    }
  }
  async function readAuthorization({ orderId, authorization }) {
    requireThat(validOrder(orderId) && validRef(authorization), 'POLICY_AUTHORIZATION_UNKNOWN');
    const value = store.readAuthorization(orderId, authorization);
    return validateAuthorization(value, { orderId, domain, signerPublicKeyHex, now });
  }
  async function status(orderId) {
    requireThat(validOrder(orderId), 'INVALID_POLICY_REFERENCE');
    const record = store.status(orderId);
    if (record?.status === 'ISSUED' && record.authorization_ref) {
      try {
        await readAuthorization({ orderId, authorization: record.authorization_ref });
        return {
          status: 'POLICY_ACCEPTED',
          releaseGate: 'POLICY_ACCEPTED',
          authorization: record.authorization_ref,
        };
      } catch {
        /* expired or corrupt records stay stored but do not clear the gate */
      }
    }
    let displayStatus = 'NOT_CLEARED';
    try {
      const external = await readStatus(orderId);
      if (['PROOF_PENDING', 'PROOF_COMPLETED', 'NOT_CLEARED'].includes(external?.status))
        displayStatus = external.status;
    } catch {
      /* read-only status adapters never clear the release gate */
    }
    return { status: displayStatus, releaseGate: 'NOT_CLEARED' };
  }
  async function reconcileRelease(orderId) {
    requireThat(validOrder(orderId), 'INVALID_POLICY_REFERENCE');
    const job = store.issuedJob(orderId);
    if (!policy || !job)
      return { status: 'ISSUANCE_RECONCILIATION_REQUIRED', releaseGate: 'NOT_CLEARED' };
    // The policy engine fetches the verifier record and confirmed chain snapshot again.
    return policy.reconcileRelease({ orderId, evidenceId: job.evidence_id });
  }
  return Object.freeze({ issue, readAuthorization, readStatus: status, reconcileRelease });
}

export function wrapReceiptReconciliation(service, policyPort, { enabled = true } = {}) {
  requireThat(
    service && typeof service.reconcileReceipt === 'function',
    'POLICY_HOST_PORT_INVALID',
  );
  return Object.freeze({
    ...service,
    async reconcileReceipt(orderId, confirmed) {
      const receipt = await service.reconcileReceipt(orderId, confirmed);
      if (!enabled || receipt?.orderState !== 'Released') return receipt;
      const policyReconciliation = await policyPort.reconcileRelease(orderId);
      return { ...receipt, policyReconciliation };
    },
  });
}
