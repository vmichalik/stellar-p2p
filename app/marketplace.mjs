// Drafts stay in the seller workspace. The market contains confirmed deposits
// only; a positive sample balance on its own is not enough to publish an offer.
export function fundedDemoOffers(state) {
  return state.offers.filter(
    (offer) =>
      state.seller.status === 'funded' &&
      typeof offer.orderId === 'string' &&
      offer.orderId === state.seller.orderId &&
      offer.availableAtoms > 0 &&
      !offer.consumed,
  );
}
