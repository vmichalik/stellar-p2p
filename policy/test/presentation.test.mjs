import test from 'node:test';
import assert from 'node:assert/strict';
import { presentPolicyOutcome } from '../src/presentation.mjs';

test('fixed state/action tokens distinguish mismatches, unavailable proof, replay and recovery', () => {
  for (const [code, state, action] of [
    ['AMOUNT_MISMATCH', 'payment-mismatch', 'review-selected-transfer'],
    ['RECIPIENT_MISMATCH', 'payment-mismatch', 'review-selected-transfer'],
    ['MPC_SETUP_TIMEOUT', 'proof-unavailable', 'review-proof-status'],
    ['TLSN_PAYMENT_SCHEMA_UNVERIFIED', 'proof-unavailable', 'review-proof-status'],
    ['PAYMENT_ALREADY_BOUND', 'transfer-already-used', 'review-original-trade'],
    ['PAYMENT_CONSUMED_ON_CHAIN', 'transfer-already-used', 'review-original-trade'],
    ['MANUAL_RECONCILIATION_REQUIRED', 'recovery-review-required', 'review-recovery-status'],
    [
      'CLAIM_RENEWAL_REQUIRES_RECONCILIATION',
      'policy-review-required',
      'reconcile-policy-issuance',
    ],
    ['POLICY_ADAPTER_FAILED', 'policy-review-required', 'reconcile-policy-issuance'],
  ]) {
    assert.equal(presentPolicyOutcome({ code }).state, state);
    assert.equal(presentPolicyOutcome({ errorCode: code }).suggestedAction, action);
  }
});

test('only explicit lifecycle context identifies submitted transactions or mutual authorization', () => {
  const failure = { code: 'MPC_SETUP_TIMEOUT' };
  assert.equal(presentPolicyOutcome(failure).state, 'proof-unavailable');
  assert.equal(
    presentPolicyOutcome(failure, { submissionStatus: 'unknown' }).state,
    'transaction-outcome-unknown',
  );
  assert.equal(
    presentPolicyOutcome(failure, { submissionStatus: 'pending' }).state,
    'transaction-pending',
  );
  assert.equal(
    presentPolicyOutcome(failure, { recoveryStatus: 'awaiting-both-parties' }).state,
    'awaiting-mutual-recovery',
  );
  assert.equal(
    presentPolicyOutcome({ code: 'MANUAL_RECONCILIATION_REQUIRED' }).state,
    'recovery-review-required',
  );
});

test('synthetic and signed-policy results cannot become a confirmed release', () => {
  assert.equal(presentPolicyOutcome({ kind: 'VERIFIED_POLICY_CLAIM_V1' }).state, 'policy-accepted');
  assert.equal(
    presentPolicyOutcome({ status: 'RELEASE_CONFIRMED', syntheticOnly: true }).state,
    'synthetic-only',
  );
  assert.equal(presentPolicyOutcome({ status: 'RELEASE_CONFIRMED' }).state, 'release-confirmed');
  assert.equal(
    presentPolicyOutcome({ syntheticOnly: true }, { submissionStatus: 'unknown' }).evidenceMode,
    'synthetic-only',
  );
  assert.equal(
    presentPolicyOutcome({ status: 'RELEASE_CONFIRMED', code: 'AMOUNT_MISMATCH' }).state,
    'payment-mismatch',
  );
});

test('presentation never reflects private input or grants an execution capability', () => {
  const secret = 'private-account-token-url-amount';
  const outcomes = [
    null,
    { message: secret, details: secret },
    { code: secret },
    { code: 'AMOUNT_MISMATCH', message: secret },
    { kind: 'VERIFIED_POLICY_CLAIM_V1', claim: secret },
    { status: 'RELEASE_CONFIRMED' },
  ];
  for (const outcome of outcomes) {
    const value = presentPolicyOutcome(outcome);
    assert(!JSON.stringify(value).includes(secret));
    assert.equal(value.presentationOnly, true);
    assert.equal(value.automaticRetry, false);
    assert.equal(value.resendPayment, false);
    assert.equal(value.releaseAuthorized, false);
    assert(Object.isFrozen(value));
  }
  const getter = {
    get code() {
      throw new Error(secret);
    },
  };
  assert.equal(presentPolicyOutcome(getter).state, 'review-required');
});
