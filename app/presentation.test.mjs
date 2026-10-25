import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTokens,
  formatEuros,
  formatRate,
  tradePresentation,
  activityLabel,
  recoveryOptions,
  formatDeadline,
} from './presentation.mjs';
const order = {
  status: 'paying',
  tokenAtoms: 55_110_000,
  fiatMinor: 501,
  lockedAt: 1000,
  expiresAt: 9000,
  paymentReported: false,
};

test('exact token display preserves offer and split precision with two minimum decimals', () => {
  assert.equal(formatTokens(55_110_000), '5.511');
  assert.equal(formatTokens(27_555_000), '2.7555');
  assert.equal(formatTokens(220_000_000), '22.00');
  assert.equal(formatTokens(1), '0.0000001');
  assert.equal(formatTokens(0), '0.00');
  assert.equal(formatTokens('9007199254740993'), '900,719,925.4740993');
});
test('EUR cents and rates retain exact integer-unit values', () => {
  assert.equal(formatEuros(501), '€5.01');
  assert.equal(formatEuros('9007199254740993'), '€90,071,992,547,409.93');
  assert.equal(formatRate(11_000_000), '1 EUR = 1.10 USDC');
  assert.equal(formatRate(11_000_001), '1 EUR = 1.1000001 USDC');
  for (const value of [Number.MAX_SAFE_INTEGER + 1, -1, 1.2, '1e7'])
    assert.throws(() => formatTokens(value));
});
test('seller headline follows verification and settlement state, rather than reservation alone', () => {
  assert.equal(
    tradePresentation({ ...order, status: 'verified' }, 'seller').title,
    'Payment verified · ready to release',
  );
  assert.equal(
    tradePresentation({ ...order, status: 'settling' }, 'seller').nextActor,
    'Confirmation',
  );
  const finished = tradePresentation({ ...order, status: 'completed' }, 'seller');
  assert.equal(finished.heldAtoms, 0);
  assert.equal(finished.fundsLabel, 'Released');
});
test('reported and late payments prompt verification without another payment', () => {
  const reported = tradePresentation({ ...order, paymentReported: true }, 'buyer', 2000);
  assert.equal(reported.title, 'Verify your existing payment');
  assert.match(reported.detail, /No need to pay again/);
  const late = tradePresentation(order, 'buyer', 10_000);
  assert.equal(late.heldAtoms, order.tokenAtoms);
  assert.match(late.detail, /Do not send a new payment/);
});
test('recovery identifies the signer whose exact approval is still needed', () => {
  const pending = {
    ...order,
    status: 'verification_failed',
    resolution: { buyerApproved: true, sellerApproved: false },
  };
  assert.equal(tradePresentation(pending, 'buyer').nextActor, 'Ben');
  assert.equal(tradePresentation(pending, 'buyer').title, 'Waiting for Ben’s approval');
  assert.equal(tradePresentation(pending, 'seller').title, 'Your approval is needed');
  assert.equal(tradePresentation(pending, 'seller').heldAtoms, order.tokenAtoms);
  assert.equal(activityLabel(pending, 'seller', 'Awaiting payment'), 'Your approval needed');
  assert.equal(activityLabel(pending, 'buyer', 'Awaiting payment'), 'Recovery pending');
  assert.equal(
    tradePresentation({ ...pending, resolution: { buyerApproved: true, sellerApproved: true } })
      .title,
    'Both approvals are ready',
  );
});

test('a proposal never hides late verification or turns Paying into an expired refund', () => {
  const proposal = { buyerApproved: false, sellerApproved: false };
  for (const paymentReported of [false, true]) {
    const locked = { ...order, resolution: proposal, paymentReported };
    assert.deepEqual(recoveryOptions(locked, 10_000), {
      verifyExistingPayment: true,
      refundExpiredReservation: false,
    });
  }
  const reserved = { ...order, status: 'reserved', lockedAt: undefined, resolution: proposal };
  assert.deepEqual(recoveryOptions(reserved, 8000), {
    verifyExistingPayment: false,
    refundExpiredReservation: false,
  });
  assert.deepEqual(recoveryOptions(reserved, 9000), {
    verifyExistingPayment: false,
    refundExpiredReservation: true,
  });
});
test('payment deadline is rendered with an explicit Lisbon timezone', () => {
  assert.match(
    formatDeadline(Date.UTC(2026, 9, 25, 13, 30)),
    /25 Oct,? 13:30 GMT(?:\+0)? \(Lisbon\)/,
  );
});
