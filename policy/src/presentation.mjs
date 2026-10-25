// Browser-safe PRESENTATION ONLY. These states never authorize payment,
// signing, disclosure or release. Render no raw exception messages or evidence.
const state = (name, action, tone = 'attention') =>
  Object.freeze({
    state: name,
    messageKey: `policy.${name}`,
    suggestedAction: action,
    tone,
    presentationOnly: true,
    evidenceMode: name === 'synthetic-only' ? 'synthetic-only' : 'not-established',
    automaticRetry: false,
    resendPayment: false,
    releaseAuthorized: false,
  });

const states = Object.freeze({
  mismatch: state('payment-mismatch', 'review-selected-transfer'),
  unavailable: state('proof-unavailable', 'review-proof-status'),
  used: state('transfer-already-used', 'review-original-trade'),
  recovery: state('recovery-review-required', 'review-recovery-status'),
  mutual: state('awaiting-mutual-recovery', 'review-both-party-approvals', 'waiting'),
  recoveryUnconfirmed: state('recovery-not-confirmed', 'refresh-recovery-status', 'waiting'),
  pending: state('transaction-pending', 'check-submitted-transaction', 'waiting'),
  uncertain: state('transaction-outcome-unknown', 'reconcile-submitted-transaction', 'waiting'),
  policyReview: state('policy-review-required', 'reconcile-policy-issuance'),
  refresh: state('trade-refresh-required', 'refresh-trade-status', 'waiting'),
  accepted: state('policy-accepted', 'review-release-authorization', 'ready'),
  released: state('release-confirmed', 'view-confirmed-receipt', 'complete'),
  reconciled: state('recovery-reconciled', 'view-recovery-receipt', 'complete'),
  synthetic: state('synthetic-only', 'continue-labeled-demo', 'info'),
  unknown: state('review-required', 'refresh-trade-status'),
});

const byCode = new Map();
function group(target, codes) {
  for (const code of codes) byCode.set(code, target);
}
group(states.mismatch, [
  'AMOUNT_MISMATCH',
  'RECIPIENT_MISMATCH',
  'ORDER_CURRENCY_MISMATCH',
  'PAYMENT_OUTSIDE_WINDOW',
  'INVALID_PAYMENT_STATE',
  'PAYMENT_IDENTITY_MISMATCH',
]);
group(states.unavailable, [
  'TLSN_PAYMENT_SCHEMA_UNVERIFIED',
  'VERIFIER_READER_REQUIRED',
  'INVALID_EVIDENCE',
  'INVALID_PAYMENT_SOURCE',
  'INVALID_PAYMENT_UNITS',
  'INVALID_PAYMENT_IDENTITY',
  'MPC_SETUP_TIMEOUT',
  'MPC_SETUP_FAILED',
  'HTTP_REQUEST_TIMEOUT',
  'VERIFICATION_RESPONSE_TIMEOUT',
  'PROOF_FAILED',
  'RESPONSE_FIELD_MISSING',
  'EXTENSION_CHECK_FAILED',
]);
group(states.used, ['PAYMENT_ALREADY_BOUND', 'PAYMENT_CONSUMED', 'PAYMENT_CONSUMED_ON_CHAIN']);
group(states.recovery, [
  'MANUAL_RECONCILIATION_REQUIRED',
  'MANUAL_PAYMENT_IDENTITY_REQUIRED',
  'MANUAL_HOLD_REQUIRED',
  'MANUAL_RECONCILIATION_UNAVAILABLE',
]);
group(states.recoveryUnconfirmed, ['MANUAL_RESOLUTION_NOT_CONFIRMED']);
group(states.policyReview, [
  'POLICY_ADAPTER_FAILED',
  'STORE_UNAVAILABLE',
  'ORDER_ALREADY_BOUND',
  'ISSUANCE_RECONCILIATION_REQUIRED',
  'CLAIM_RENEWAL_REQUIRES_RECONCILIATION',
  'STORED_CLAIM_MISMATCH',
  'ORDER_TERMS_CHANGED',
  'INVALID_POLICY_SIGNATURE',
  'SIGNER_CONFIG_MISMATCH',
]);
group(states.refresh, [
  'CHAIN_RECONCILIATION_BEHIND',
  'STALE_LEDGER_SNAPSHOT',
  'UNTRUSTED_ORDER_SNAPSHOT',
  'ORDER_NOT_PAYING',
  'INVALID_RECOVERY_STATE',
  'RELEASE_NOT_CONFIRMED',
]);

/**
 * Map an error/result to fixed UI tokens. Lifecycle context must be supplied by
 * the trusted app transaction/recovery adapters, never inferred from a timeout.
 * App copy and links belong to the app. No input values are copied to output.
 */
export function presentPolicyOutcome(outcome, context = {}) {
  try {
    const synthetic =
      outcome?.syntheticOnly === true || outcome?.kind === 'SYNTHETIC_POLICY_CLAIM_NOT_FOR_RELEASE';
    const preserveMode = (value) =>
      synthetic ? Object.freeze({ ...value, evidenceMode: 'synthetic-only' }) : value;
    // Actual outstanding submissions take priority over new proof/payment work.
    if (context.submissionStatus === 'unknown') return preserveMode(states.uncertain);
    if (context.submissionStatus === 'pending') return preserveMode(states.pending);
    if (synthetic) return states.synthetic;
    if (context.recoveryStatus === 'awaiting-both-parties') return states.mutual;
    const code = typeof outcome === 'string' ? outcome : (outcome?.code ?? outcome?.errorCode);
    // Errors win over contradictory result fields. Unknown codes never echo.
    if (code !== undefined) return byCode.get(code) ?? states.unknown;
    if (outcome?.status === 'RELEASE_CONFIRMED') return states.released;
    if (outcome?.status === 'MANUAL_PAYMENTS_CONSUMED') return states.reconciled;
    if (outcome?.status === 'MANUAL_RECONCILIATION_REQUIRED') return states.recovery;
    if (outcome?.kind === 'VERIFIED_POLICY_CLAIM_V1') return states.accepted;
    return states.unknown;
  } catch {
    return states.unknown;
  }
}
