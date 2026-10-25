import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, TOKEN_SCALE } from './model.mjs';
import {
  formatTokens,
  formatEuros,
  formatRate,
  tradePresentation,
  recoveryOptions,
  activityLabel,
} from './presentation.mjs';

function reserved() {
  let state = initialState();
  for (const event of [
    { type: 'seller_connect' },
    { type: 'seller_create', amount: '22', tag: '@ben' },
    { type: 'seller_fund_started' },
    { type: 'seller_fund_confirmed', id: 'PL-PRESENTATION', now: 500 },
    { type: 'connect' },
    { type: 'reserve', id: 'PL-PRESENTATION', offerId: 'ben', amount: '20', now: 1000 },
  ])
    state = transition(state, event);
  return state;
}
const apply = (state, type, extra = {}) =>
  transition(state, { type, orderId: 'PL-PRESENTATION', now: 2000, ...extra });
const order = (state) => state.orders[0];
function locked() {
  return apply(apply(reserved(), 'payment_lock_started'), 'payment_lock_confirmed');
}

test('amounts preserve every atomic unit and do not round unsafe number inputs', () => {
  assert.equal(formatTokens(1n), '0.0000001');
  assert.equal(formatTokens('1234567890123456789'), '123,456,789,012.3456789');
  assert.equal(formatTokens(22 * TOKEN_SCALE), '22.00');
  assert.equal(formatEuros('9007199254740993'), '€90,071,992,547,409.93');
  assert.equal(formatRate(11_000_000), '1 EUR = 1.10 USDC');
  for (const value of [Number.MAX_SAFE_INTEGER + 1, -1, 0.1, '1e7', 'NaN']) {
    assert.throws(() => formatTokens(value));
    assert.throws(() => formatEuros(value));
  }
});

test('expiry offers refund only before lock and preserves verification of an earlier payment', () => {
  const unlocked = order(reserved());
  const lockedOrder = order(locked());
  const late = lockedOrder.expiresAt + 1;
  assert.deepEqual(recoveryOptions(unlocked, late), {
    verifyExistingPayment: false,
    refundExpiredReservation: true,
  });
  assert.deepEqual(recoveryOptions(lockedOrder, late), {
    verifyExistingPayment: true,
    refundExpiredReservation: false,
  });
  const shown = tradePresentation(lockedOrder, 'buyer', late);
  assert.equal(shown.heldAtoms, lockedOrder.tokenAtoms);
  assert.match(shown.detail, /Do not send a new payment/);
  assert.equal(shown.nextActor, 'Ana');
});

test('seller sees buyer action after a failed check while the full escrow remains held', () => {
  let state = apply(locked(), 'payment_reported');
  state = apply(apply(state, 'verify_started'), 'verify_failed', { reason: 'unavailable' });
  const before = structuredClone(order(state));
  const shown = tradePresentation(order(state), 'seller');
  assert.equal(shown.heldAtoms, 22 * TOKEN_SCALE);
  assert.equal(shown.nextActor, 'Ana');
  assert.match(shown.title, /Waiting/);
  assert.equal(recoveryOptions(order(state)).verifyExistingPayment, true);
  assert.deepEqual(order(state), before, 'presenting a failure must not alter an order');
});

test('mutual recovery shows the remaining approver and clears held balance only after confirmation', () => {
  let state = apply(locked(), 'resolution_proposed', {
    proposalId: 'split',
    buyerAtoms: 11 * TOKEN_SCALE,
  });
  state = apply(state, 'resolution_approved', { proposalId: 'split', party: 'buyer' });
  assert.equal(tradePresentation(order(state), 'buyer').nextActor, 'Ben');
  assert.equal(tradePresentation(order(state), 'seller').nextActor, 'Ben');
  assert.equal(activityLabel(order(state), 'seller', 'Waiting'), 'Your approval needed');
  state = apply(state, 'resolution_approved', { proposalId: 'split', party: 'seller' });
  assert.equal(tradePresentation(order(state)).heldAtoms, 22 * TOKEN_SCALE);
  assert.equal(activityLabel(order(state), 'buyer', 'Waiting'), 'Recovery ready');
  state = apply(state, 'resolution_confirmed');
  assert.equal(tradePresentation(order(state)).heldAtoms, 0);
  assert.equal(tradePresentation(order(state)).fundsLabel, 'Allocated');
  assert.equal(state.balanceAtoms, 11 * TOKEN_SCALE);
});
