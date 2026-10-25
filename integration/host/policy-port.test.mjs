import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';
import { claimDigest } from '../../policy/src/index.mjs';
import {
  createPolicyHostPort,
  PolicyAuthorizationStore,
  wrapReceiptReconciliation,
} from './policy-port.mjs';

const domain = {
  network_passphrase: Networks.TESTNET,
  contract: StrKey.encodeContract(Buffer.alloc(32, 6)),
};
const keypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x44));
const publicKeyHex = Buffer.from(keypair.rawPublicKey()).toString('hex');
const claim = {
  buyer: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x45)).publicKey(),
  currency: 'EUR',
  expires_at: '2000',
  fiat_minor: '2000',
  nullifier: '22'.repeat(32),
  order_id: '1',
  paid_at: '1200',
  pay_by: '1900',
  rail: 'revolut',
  recipient: '33'.repeat(32),
  reserved_at: '1100',
  seller: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x46)).publicKey(),
  token: StrKey.encodeContract(Buffer.alloc(32, 7)),
  token_amount: '220000000',
};

function signedAuthorization(overrides = {}) {
  const digest = claimDigest({ ...domain, claim });
  return {
    kind: 'VERIFIED_POLICY_CLAIM_V1',
    syntheticOnly: false,
    releaseGate: 'POLICY_ACCEPTED',
    domain,
    claim,
    digestHex: digest.toString('hex'),
    signatureHex: Buffer.from(keypair.sign(digest)).toString('hex'),
    signerPublicKeyHex: publicKeyHex,
    ...overrides,
  };
}

function fixture(policy) {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-policy-port-'));
  const path = join(directory, 'policy-authorizations.sqlite');
  const store = new PolicyAuthorizationStore(path);
  const port = createPolicyHostPort({
    policy,
    store,
    domain,
    signerPublicKeyHex: publicKeyHex,
    now: () => '1000',
  });
  return { directory, path, store, port };
}

test('policy port persists only verified authorization references and resolves them after restart', async () => {
  let calls = 0,
    reconciliations = [];
  const policy = {
    async issue(input) {
      calls++;
      assert.deepEqual(input, { orderId: '1', evidenceId: 'verified-record-1' });
      return signedAuthorization();
    },
    async reconcileRelease(input) {
      reconciliations.push(input);
      return { status: 'RELEASE_CONFIRMED' };
    },
  };
  const first = fixture(policy);
  try {
    const result = await first.port.issue({ orderId: '1', evidenceId: 'verified-record-1' });
    assert.equal(result.releaseGate, 'POLICY_ACCEPTED');
    assert.match(result.authorization, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(statSync(first.path).mode & 0o077, 0);
    assert.deepEqual(
      await first.port.readAuthorization({ orderId: '1', authorization: result.authorization }),
      signedAuthorization(),
    );
    assert.equal((await first.port.readStatus('1')).authorization, result.authorization);
    assert.deepEqual(await first.port.reconcileRelease('1'), { status: 'RELEASE_CONFIRMED' });
    assert.deepEqual(reconciliations, [{ orderId: '1', evidenceId: 'verified-record-1' }]);
    await assert.rejects(
      first.port.readAuthorization({ orderId: '1', authorization: signedAuthorization() }),
      /POLICY_AUTHORIZATION_UNKNOWN/,
    );
    await assert.rejects(
      first.port.issue({ orderId: '1', evidenceId: 'verified-record-1', claim }),
      /INVALID_POLICY_REFERENCE/,
    );
    first.store.close();
    const reopened = new PolicyAuthorizationStore(first.path);
    try {
      const restarted = createPolicyHostPort({
        policy,
        store: reopened,
        domain,
        signerPublicKeyHex: publicKeyHex,
        now: () => '1000',
      });
      assert.deepEqual(
        await restarted.readAuthorization({ orderId: '1', authorization: result.authorization }),
        signedAuthorization(),
      );
      assert.equal(
        (await restarted.issue({ orderId: '1', evidenceId: 'verified-record-1' })).authorization,
        result.authorization,
      );
      assert.equal(calls, 1);
    } finally {
      reopened.close();
    }
  } finally {
    try {
      first.store.close();
    } catch {}
    rmSync(first.directory, { recursive: true, force: true });
  }
});

test('synthetic, mismatched, or unsigned browser claims cannot clear the release gate', async () => {
  const synthetic = fixture({
    async issue() {
      return signedAuthorization({
        kind: 'SYNTHETIC_POLICY_CLAIM_NOT_FOR_RELEASE',
        syntheticOnly: true,
        releaseGate: 'NOT_CLEARED',
      });
    },
  });
  try {
    await assert.rejects(
      synthetic.port.issue({ orderId: '1', evidenceId: 'record' }),
      /POLICY_AUTHORIZATION_INVALID/,
    );
    assert.deepEqual(await synthetic.port.readStatus('1'), {
      status: 'NOT_CLEARED',
      releaseGate: 'NOT_CLEARED',
    });
    assert.deepEqual(await synthetic.port.reconcileRelease('1'), {
      status: 'ISSUANCE_RECONCILIATION_REQUIRED',
      releaseGate: 'NOT_CLEARED',
    });
    const mismatched = fixture({
      async issue() {
        return signedAuthorization({
          domain: { ...domain, contract: StrKey.encodeContract(Buffer.alloc(32, 8)) },
        });
      },
    });
    try {
      await assert.rejects(
        mismatched.port.issue({ orderId: '1', evidenceId: 'record' }),
        /POLICY_AUTHORIZATION_DOMAIN_MISMATCH/,
      );
    } finally {
      mismatched.store.close();
      rmSync(mismatched.directory, { recursive: true, force: true });
    }
  } finally {
    synthetic.store.close();
    rmSync(synthetic.directory, { recursive: true, force: true });
  }
});

test('receipt reconciliation consults policy only after the chain service confirms Released', async () => {
  const calls = [];
  const service = {
    async reconcileReceipt(orderId, confirmed) {
      calls.push(['chain', orderId, confirmed]);
      return { orderId, orderState: confirmed ? 'Released' : 'Refunded' };
    },
  };
  const policyPort = {
    async reconcileRelease(orderId) {
      calls.push(['policy', orderId]);
      return { status: 'RELEASE_CONFIRMED' };
    },
  };
  const wrapped = wrapReceiptReconciliation(service, policyPort);

  assert.deepEqual(await wrapped.reconcileReceipt('1', true), {
    orderId: '1',
    orderState: 'Released',
    policyReconciliation: { status: 'RELEASE_CONFIRMED' },
  });
  assert.deepEqual(await wrapped.reconcileReceipt('2', false), {
    orderId: '2',
    orderState: 'Refunded',
  });
  assert.deepEqual(calls, [
    ['chain', '1', true],
    ['policy', '1'],
    ['chain', '2', false],
  ]);
});

test('receipt reconciliation cannot clear policy holds when the signer is unavailable', async () => {
  const wrapped = wrapReceiptReconciliation(
    {
      async reconcileReceipt(orderId) {
        return { orderId, orderState: 'Released' };
      },
    },
    {
      async reconcileRelease() {
        throw new Error('LIVE_PAYMENT_VALIDATION_PENDING');
      },
    },
  );
  await assert.rejects(wrapped.reconcileReceipt('1'), /LIVE_PAYMENT_VALIDATION_PENDING/);
});
