import { initialState, recoverState, transition } from './model.mjs';

export const STORAGE_KEY = 'pactlane.demo.v4';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// This adapter deliberately has no bank, wallet, proof or chain connection.
// A real adapter must read authoritative order status from the policy service.
export function createDemoAdapter({ storage, pause = delay } = {}) {
  let state;
  let persistence = Boolean(storage);
  try {
    state = recoverState(JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    state = initialState();
    persistence = false;
  }
  const listeners = new Set();

  function emit(event) {
    state = transition(state, event);
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      persistence = false;
    }
    for (const listener of listeners) listener();
    return structuredClone(state);
  }

  return {
    mode: 'demo',
    snapshot: () => structuredClone(state),
    persists: () => persistence,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    connectWallet() {
      return emit({ type: 'connect' });
    },
    connectSellerWallet() {
      return emit({ type: 'seller_connect' });
    },
    createSellerOffer(amount, tag) {
      return emit({ type: 'seller_create', amount, tag });
    },
    async fundSellerOffer() {
      emit({ type: 'seller_fund_started' });
      await pause(1200);
      emit({
        type: 'seller_fund_confirmed',
        id: `PL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      });
    },
    reserve(offerId, amount) {
      const id = state.offers.find((offer) => offer.id === offerId)?.orderId;
      emit({ type: 'reserve', offerId, amount, id });
      return structuredClone(state.orders.find((order) => order.id === id));
    },
    reportPayment(orderId) {
      return emit({ type: 'payment_reported', orderId });
    },
    refundExpired(orderId) {
      return emit({ type: 'refund_expired', orderId });
    },
    async beginPayment(orderId, { outcome = 'success' } = {}) {
      emit({ type: 'payment_lock_started', orderId });
      await pause(900);
      emit({
        type: outcome === 'success' ? 'payment_lock_confirmed' : 'payment_lock_failed',
        orderId,
      });
    },
    proposeResolution(orderId, buyerAtoms) {
      return emit({
        type: 'resolution_proposed',
        orderId,
        buyerAtoms,
        proposalId: crypto.randomUUID(),
      });
    },
    approveResolution(orderId, proposalId, party) {
      return emit({ type: 'resolution_approved', orderId, proposalId, party });
    },
    resolveAgreement(orderId) {
      return emit({ type: 'resolution_confirmed', orderId });
    },
    async verify(orderId, { outcome = 'success', onProgress = () => {} } = {}) {
      emit({ type: 'verify_started', orderId });
      for (const phase of [
        'Preparing payment check',
        'Checking selected payment details',
        'Matching your reserved trade',
      ]) {
        onProgress(phase);
        await pause(650);
      }
      if (outcome !== 'success') emit({ type: 'verify_failed', orderId, reason: outcome });
      else emit({ type: 'verify_succeeded', orderId });
    },
    async settle(orderId) {
      emit({ type: 'settle_started', orderId });
      await pause(1200);
      emit({ type: 'settlement_confirmed', orderId });
    },
    reset() {
      state = initialState();
      try {
        storage?.removeItem(STORAGE_KEY);
      } catch {
        persistence = false;
      }
      for (const listener of listeners) listener();
    },
  };
}
