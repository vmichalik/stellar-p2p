import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  parseEuro,
  quote,
  transition,
  recoverState,
  TOKEN_SCALE,
  DEMO_OFFERS,
  sellerQuote,
  canShowPaymentInstructions,
} from './model.mjs';
import { createDemoAdapter, STORAGE_KEY } from './demo-adapter.mjs';
const funded = () => {
  let state = transition(initialState(), { type: 'seller_connect' });
  state = transition(state, { type: 'seller_create', amount: '22', tag: '@ben' });
  state = transition(state, { type: 'seller_fund_started' });
  return transition(state, { type: 'seller_fund_confirmed', id: 'PL-TEST', now: 500 });
};
const reserved = () =>
  transition(transition(funded(), { type: 'connect' }), {
    type: 'reserve',
    id: 'PL-TEST',
    offerId: 'ben',
    amount: '20.00',
    now: 1000,
  });
const event = (state, type, extra = {}) =>
  transition(state, { type, orderId: 'PL-TEST', now: 2000, ...extra });
const locked = () => event(event(reserved(), 'payment_lock_started'), 'payment_lock_confirmed');
const paid = () => event(locked(), 'payment_reported');
const verified = () => event(event(paid(), 'verify_started'), 'verify_succeeded');

test('quotes use exact minor units and fixed whole offers; partial fill is rejected', () => {
  assert.equal(parseEuro('0.10'), 10);
  assert.deepEqual(quote(DEMO_OFFERS[0], '20'), { fiatMinor: 2000, tokenAtoms: 22 * TOKEN_SCALE });
  for (const value of ['-1', '1e2', '5.001', '', 'NaN', ' 20 '])
    assert.throws(() => parseEuro(value));
  for (const value of ['0', '5', '10', '20.01']) assert.throws(() => quote(DEMO_OFFERS[0], value));
  assert.throws(() => quote({ ...DEMO_OFFERS[0], availableAtoms: 1 }, '20'));
});
test('reservation needs a wallet, consumes the whole offer and prevents concurrent orders', () => {
  assert.throws(() =>
    transition(funded(), { type: 'reserve', id: 'x', offerId: 'ben', amount: '20' }),
  );
  const state = reserved();
  assert.equal(state.offers[0].availableAtoms, 0);
  assert.equal(state.offers[0].consumed, true);
  assert.throws(() =>
    transition(state, { type: 'reserve', id: 'y', offerId: 'ben', amount: '20' }),
  );
});
test('payment reporting and verification require a confirmed payment lock', () => {
  assert.throws(() => event(reserved(), 'payment_reported'));
  assert.throws(() => event(reserved(), 'verify_started'));
  const pending = event(reserved(), 'payment_lock_started');
  assert.throws(() => event(pending, 'payment_reported'));
  assert.throws(() => event(pending, 'payment_lock_started'));
  const failed = event(pending, 'payment_lock_failed');
  assert.equal(failed.orders[0].status, 'reserved');
  assert.equal(failed.orders[0].lockedAt, undefined);
  assert.equal(locked().orders[0].status, 'paying');
});
test('proof failure keeps escrow held; after lock there is no unilateral timeout refund', () => {
  let state = event(event(paid(), 'verify_started'), 'verify_failed', { reason: 'unavailable' });
  assert.equal(state.orders[0].status, 'verification_failed');
  assert.equal(state.balanceAtoms, 0);
  assert.equal(
    state.seller.depositedAtoms - state.seller.settledAtoms - state.seller.returnedAtoms,
    22 * TOKEN_SCALE,
  );
  assert.throws(() => event(state, 'refund_expired', { now: 1_000_000 }));
  state = event(state, 'verify_started');
  assert.equal(event(state, 'verify_succeeded').orders[0].status, 'verified');
});
test('a Paying buyer returning after pay_by can report and verify an earlier payment', () => {
  const late = 1_000_000;
  let state = event(locked(), 'payment_reported', { now: late });
  state = event(state, 'verify_started', { now: late });
  state = event(state, 'verify_succeeded', { now: late });
  state = event(state, 'settle_started', { now: late });
  state = event(state, 'settlement_confirmed', { now: late });
  assert.equal(state.balanceAtoms, 22 * TOKEN_SCALE);
  // The browser report never supplies paid_at. A live policy still has to prove
  // that the bank payment itself occurred after lock and before pay_by.
});
test('settlement requires verified status, reconciles both sides and credits once', () => {
  assert.throws(() => event(reserved(), 'settle_started'));
  assert.throws(() => event(paid(), 'verify_succeeded'));
  const state = event(event(verified(), 'settle_started'), 'settlement_confirmed');
  assert.equal(state.balanceAtoms, 22 * TOKEN_SCALE);
  assert.equal(state.seller.receivedFiatMinor, 2000);
  assert.equal(
    state.seller.depositedAtoms - state.seller.settledAtoms - state.seller.returnedAtoms,
    0,
  );
  assert.throws(() => event(state, 'settlement_confirmed'));
  assert.throws(() => event(state, 'settle_started'));
});
test('expired unlocked reservation refunds to seller without recycling the offer', () => {
  assert.throws(() => event(reserved(), 'refund_expired'));
  const state = event(reserved(), 'refund_expired', { now: 901_000 });
  assert.equal(state.orders[0].status, 'refunded');
  assert.equal(state.seller.balanceAtoms, 22 * TOKEN_SCALE);
  assert.equal(state.offers[0].availableAtoms, 0);
  assert.throws(() =>
    transition(state, { type: 'reserve', id: 'new', offerId: 'ben', amount: '20' }),
  );
  assert.throws(() => event(reserved(), 'payment_lock_started', { now: 901_000 }));
});
test('refresh never invents a deposit, lock, proof or confirmed settlement', () => {
  const pending = event(reserved(), 'payment_lock_started');
  assert.equal(recoverState(pending).orders[0].status, 'reserved');
  assert.equal(recoverState(pending).orders[0].lockedAt, undefined);
  assert.equal(
    recoverState(event(paid(), 'verify_started')).orders[0].status,
    'verification_failed',
  );
  const settling = recoverState(event(verified(), 'settle_started'));
  assert.equal(settling.orders[0].status, 'verified');
  assert.equal(settling.balanceAtoms, 0);
  assert.deepEqual(recoverState({ version: 99 }), initialState());
});
test('mutual recovery needs both wallets to approve the exact allocation', () => {
  let state = event(paid(), 'resolution_proposed', {
    proposalId: 'split',
    buyerAtoms: 11 * TOKEN_SCALE,
  });
  state = event(state, 'resolution_approved', { proposalId: 'split', party: 'buyer' });
  assert.throws(() => event(state, 'resolution_confirmed'));
  assert.throws(() =>
    event(state, 'resolution_approved', { proposalId: 'changed', party: 'seller' }),
  );
  state = event(state, 'resolution_approved', { proposalId: 'split', party: 'seller' });
  state = event(state, 'resolution_confirmed');
  assert.equal(state.orders[0].status, 'resolved');
  assert.equal(state.balanceAtoms, 11 * TOKEN_SCALE);
  assert.equal(state.seller.balanceAtoms, 11 * TOKEN_SCALE);
  assert.equal(state.seller.receivedFiatMinor, 0);
  assert.equal(state.offers[0].availableAtoms, 0);
  assert.throws(() => event(state, 'resolution_confirmed'));
  assert.throws(() => event(state, 'settlement_confirmed'));
});
test('a later valid payment can still release while a mutual proposal is pending', () => {
  let state = event(paid(), 'resolution_proposed', { proposalId: 'refund', buyerAtoms: 0 });
  state = event(state, 'resolution_approved', { proposalId: 'refund', party: 'buyer' });
  state = event(state, 'verify_started');
  state = event(state, 'verify_succeeded');
  state = event(event(state, 'settle_started'), 'settlement_confirmed');
  assert.equal(state.orders[0].resolution, undefined);
  assert.equal(state.balanceAtoms, 22 * TOKEN_SCALE);
  assert.throws(() => event(state, 'resolution_confirmed'));
});
test('seller deposit funds the exact whole offer the buyer reserves', () => {
  assert.equal(initialState().offers[0].availableAtoms, 0);
  assert.throws(() =>
    transition(initialState(), { type: 'seller_create', amount: '22', tag: '@ben' }),
  );
  const state = funded();
  assert.equal(state.seller.balanceAtoms, 0);
  assert.equal(state.seller.depositedAtoms, 22 * TOKEN_SCALE);
  assert.throws(() => transition(state, { type: 'seller_fund_confirmed' }));
});
test('seller inputs and interrupted funding cannot create unconfirmed capacity', () => {
  for (const amount of ['-1', '5', '22.01', '1e1', '20.00000001', '22.001'])
    assert.throws(() => sellerQuote(amount));
  assert.equal(sellerQuote('11').maxMinor, 1000);
  const connected = transition(initialState(), { type: 'seller_connect' });
  assert.throws(() => transition(connected, { type: 'seller_create', amount: '22', tag: 'ben' }));
  const created = transition(connected, { type: 'seller_create', amount: '22', tag: '@ben' });
  const restored = recoverState(transition(created, { type: 'seller_fund_started' }));
  assert.equal(restored.seller.status, 'created');
  assert.equal(restored.seller.balanceAtoms, 22 * TOKEN_SCALE);
  assert.equal(restored.offers[0].availableAtoms, 0);
});
test('adapter persists a full seller → buyer flow with lock failure, retry and one payout', async () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key),
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };
  const adapter = createDemoAdapter({ storage, pause: async () => {} });
  adapter.connectSellerWallet();
  adapter.createSellerOffer('22', '@ben');
  await adapter.fundSellerOffer();
  adapter.connectWallet();
  const fundedId = adapter.snapshot().seller.orderId;
  const order = adapter.reserve('ben', '20');
  assert.equal(order.id, fundedId);
  await adapter.beginPayment(order.id, { outcome: 'unavailable' });
  assert.equal(adapter.snapshot().orders[0].status, 'reserved');
  await adapter.beginPayment(order.id);
  adapter.reportPayment(order.id);
  await adapter.verify(order.id, { outcome: 'mismatch' });
  assert.equal(adapter.snapshot().orders[0].status, 'verification_failed');
  await adapter.verify(order.id);
  await adapter.settle(order.id);
  await assert.rejects(adapter.settle(order.id));
  assert.equal(adapter.snapshot().balanceAtoms, 22 * TOKEN_SCALE);
  assert.equal(createDemoAdapter({ storage }).snapshot().orders[0].status, 'completed');
  assert.ok(records.has(STORAGE_KEY));
  adapter.reset();
  assert.equal(records.has(STORAGE_KEY), false);
});

test('instruction visibility requires Paying and hides all new-payment details after pay_by', () => {
  assert.equal(canShowPaymentInstructions(reserved().orders[0], 3000), false);
  assert.equal(
    canShowPaymentInstructions(event(reserved(), 'payment_lock_started').orders[0], 3000),
    false,
  );
  assert.equal(canShowPaymentInstructions(locked().orders[0], 3000), true);
  const reported = paid().orders[0];
  assert.equal(canShowPaymentInstructions(reported, reported.expiresAt), false);
  assert.equal(canShowPaymentInstructions(reported, reported.expiresAt + 1), false);
});
