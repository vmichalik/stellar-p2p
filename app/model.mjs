export const TOKEN_SCALE = 10_000_000;
export const STORAGE_VERSION = 4;
export const OPEN_STATES = [
  'reserved',
  'locking',
  'paying',
  'verifying',
  'verification_failed',
  'verified',
  'settling',
];
export const DEMO_OFFERS = [
  {
    id: 'ben',
    name: 'Ben',
    tag: '@ben',
    initials: 'B',
    color: 'peach',
    rateAtomsPerEuro: 11_000_000,
    availableAtoms: 220_000_000,
    minMinor: 2000,
    maxMinor: 2000,
  },
];
const buyerWallet = () => ({ name: 'Ana', label: 'Ana’s demo wallet', network: 'testnet' });
const sellerWallet = () => ({ name: 'Ben', label: 'Ben’s demo wallet', network: 'testnet' });

export function parseEuro(value) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(String(value)))
    throw new Error('Enter an amount with up to two decimal places.');
  const [whole, decimal = ''] = String(value).split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}
export function quote(offer, value) {
  if (!offer) throw new Error('Choose an offer first.');
  const fiatMinor = parseEuro(value);
  if (fiatMinor !== offer.maxMinor)
    throw new Error(`This whole offer is for exactly €${(offer.maxMinor / 100).toFixed(2)}.`);
  const tokenAtoms = (fiatMinor * offer.rateAtomsPerEuro) / 100;
  if (offer.consumed || !Number.isSafeInteger(tokenAtoms) || tokenAtoms !== offer.availableAtoms)
    throw new Error('This whole offer is no longer available.');
  return { fiatMinor, tokenAtoms };
}
export function canShowPaymentInstructions(order, now = Date.now()) {
  return order?.status === 'paying' && Number.isFinite(order.lockedAt) && now < order.expiresAt;
}
export function sellerQuote(value) {
  if (!/^\d{1,5}(\.\d{1,7})?$/.test(String(value)))
    throw new Error('Enter a USDC amount with up to seven decimal places.');
  const [whole, decimal = ''] = String(value).split('.');
  const tokenAtoms = Number(whole) * TOKEN_SCALE + Number(decimal.padEnd(7, '0'));
  if (tokenAtoms < 55_000_000) throw new Error('Deposit at least 5.50 USDC.');
  if (tokenAtoms > 220_000_000) throw new Error('Ben’s demo wallet has 22.00 USDC available.');
  if (tokenAtoms % 110_000 !== 0)
    throw new Error('Choose a USDC amount that converts exactly to EUR cents at this rate.');
  return { tokenAtoms, maxMinor: tokenAtoms / 110_000 };
}
export function initialState() {
  return {
    version: STORAGE_VERSION,
    wallet: null,
    balanceAtoms: 0,
    seller: {
      wallet: null,
      status: 'new',
      balanceAtoms: 220_000_000,
      offerAtoms: 220_000_000,
      depositedAtoms: 0,
      settledAtoms: 0,
      returnedAtoms: 0,
      receivedFiatMinor: 0,
      tag: '@ben',
    },
    offers: DEMO_OFFERS.map((offer) => ({
      ...offer,
      consumed: false,
      availableAtoms: offer.id === 'ben' ? 0 : offer.availableAtoms,
    })),
    orders: [],
  };
}
function requireState(order, allowed) {
  if (!order || !allowed.includes(order.status))
    throw new Error('This trade has changed. Refresh its status before continuing.');
}
const resolutionStates = ['reserved', 'paying', 'verification_failed', 'verified'];
function creditReturn(state, order, buyerAtoms) {
  state.balanceAtoms += buyerAtoms;
  if (order.offerId === 'ben') {
    state.seller.settledAtoms += buyerAtoms;
    state.seller.returnedAtoms += order.tokenAtoms - buyerAtoms;
    state.seller.balanceAtoms += order.tokenAtoms - buyerAtoms;
  }
}
export function transition(previous, event) {
  const state = structuredClone(previous);
  const order = state.orders.find((item) => item.id === event.orderId);
  const now = event.now ?? Date.now();
  switch (event.type) {
    case 'seller_connect':
      state.seller.wallet = sellerWallet();
      break;
    case 'connect':
      state.wallet = buyerWallet();
      break;
    case 'seller_create': {
      if (!state.seller.wallet) throw new Error('Connect Ben’s demo wallet first.');
      if (!['new', 'created'].includes(state.seller.status))
        throw new Error('This offer is already funded.');
      const { tokenAtoms, maxMinor } = sellerQuote(event.amount);
      if (!/^@[a-zA-Z0-9._]{3,30}$/.test(event.tag))
        throw new Error('Enter a Revolut tag such as @ben.');
      if (tokenAtoms > state.seller.balanceAtoms)
        throw new Error('The demo wallet has insufficient USDC.');
      Object.assign(state.seller, { status: 'created', offerAtoms: tokenAtoms, tag: event.tag });
      Object.assign(state.offers[0], { tag: event.tag, minMinor: maxMinor, maxMinor });
      break;
    }
    case 'seller_fund_started':
      if (state.seller.status !== 'created') throw new Error('Create an unfunded offer first.');
      state.seller.status = 'funding';
      break;
    case 'seller_fund_confirmed':
      if (state.seller.status !== 'funding')
        throw new Error('This deposit has already been handled.');
      if (!event.id) throw new Error('A funded offer needs its escrow order reference.');
      state.seller.balanceAtoms -= state.seller.offerAtoms;
      state.seller.depositedAtoms += state.seller.offerAtoms;
      state.seller.status = 'funded';
      state.seller.fundedAt = now;
      state.seller.orderId = event.id;
      state.offers[0].orderId = event.id;
      state.offers[0].availableAtoms = state.seller.offerAtoms;
      break;
    case 'reserve': {
      if (!state.wallet) throw new Error('Connect your demo wallet first.');
      if (state.orders.some((item) => OPEN_STATES.includes(item.status)))
        throw new Error('Finish your current trade before reserving another offer.');
      if (!event.id || state.orders.some((item) => item.id === event.id))
        throw new Error('This trade reference is already in use.');
      const offer = state.offers.find((item) => item.id === event.offerId);
      if (!offer?.orderId || event.id !== offer.orderId)
        throw new Error('Reserve the order reference returned by funding.');
      const amounts = quote(offer, event.amount);
      offer.availableAtoms = 0;
      offer.consumed = true;
      state.orders.unshift({
        id: event.id,
        offerId: offer.id,
        seller: offer.name,
        tag: offer.tag,
        ...amounts,
        status: 'reserved',
        paymentReported: false,
        reservedAt: now,
        expiresAt: now + 15 * 60_000,
        activity: [{ title: 'USDC reserved', at: now }],
      });
      break;
    }
    case 'payment_lock_started':
      requireState(order, ['reserved']);
      if (now >= order.expiresAt)
        throw new Error('The payment window has ended. Do not send a payment.');
      order.status = 'locking';
      delete order.lockFailure;
      break;
    case 'payment_lock_failed':
      requireState(order, ['locking']);
      order.status = 'reserved';
      order.lockFailure = true;
      break;
    case 'payment_lock_confirmed':
      requireState(order, ['locking']);
      if (now >= order.expiresAt) {
        order.status = 'reserved';
        order.lockFailure = true;
        break;
      }
      order.status = 'paying';
      order.lockedAt = now;
      order.activity.push({ title: 'Payment lock confirmed', at: now });
      break;
    case 'payment_reported':
      requireState(order, ['paying']);
      // Reporting a prior payment after pay_by is allowed. The real policy must
      // establish paid_at from verified evidence, never from this browser event.
      order.paymentReported = true;
      break;
    case 'verify_started':
      requireState(order, ['paying', 'verification_failed']);
      if (!order.paymentReported || !Number.isFinite(order.lockedAt))
        throw new Error('Confirm the payment lock and report your payment first.');
      order.status = 'verifying';
      delete order.failure;
      break;
    case 'verify_failed':
      requireState(order, ['verifying']);
      order.status = 'verification_failed';
      order.failure = event.reason === 'mismatch' ? 'mismatch' : 'unavailable';
      break;
    case 'verify_succeeded':
      requireState(order, ['verifying']);
      order.status = 'verified';
      order.activity.push({ title: 'Payment check completed', at: now });
      break;
    case 'settle_started':
      requireState(order, ['verified']);
      order.status = 'settling';
      break;
    case 'settlement_confirmed':
      requireState(order, ['settling']);
      order.status = 'completed';
      order.completedAt = now;
      delete order.resolution;
      creditReturn(state, order, order.tokenAtoms);
      if (order.offerId === 'ben') state.seller.receivedFiatMinor += order.fiatMinor;
      order.activity.push({ title: 'Demo USDC received', at: now });
      break;
    case 'refund_expired':
      requireState(order, ['reserved']);
      if (now < order.expiresAt)
        throw new Error('An active reservation needs both parties to agree before it can end.');
      order.status = 'refunded';
      order.completedAt = now;
      creditReturn(state, order, 0);
      order.activity.push({ title: 'Expired reservation returned to seller', at: now });
      break;
    case 'resolution_proposed':
      requireState(order, resolutionStates);
      if (order.resolution) throw new Error('Review the existing proposal first.');
      if (
        !Number.isSafeInteger(event.buyerAtoms) ||
        event.buyerAtoms < 0 ||
        event.buyerAtoms > order.tokenAtoms ||
        !event.proposalId
      )
        throw new Error('The proposed allocation is invalid.');
      order.resolution = {
        id: event.proposalId,
        buyerAtoms: event.buyerAtoms,
        buyerApproved: false,
        sellerApproved: false,
      };
      break;
    case 'resolution_approved':
      requireState(order, resolutionStates);
      if (!order.resolution || order.resolution.id !== event.proposalId)
        throw new Error('This proposal has changed. Review it again.');
      if (!['buyer', 'seller'].includes(event.party)) throw new Error('Choose a demo participant.');
      if (
        (event.party === 'buyer' && !state.wallet) ||
        (event.party === 'seller' && !state.seller.wallet)
      )
        throw new Error('Connect the approving demo wallet first.');
      order.resolution[`${event.party}Approved`] = true;
      break;
    case 'resolution_confirmed': {
      requireState(order, resolutionStates);
      const proposal = order.resolution;
      if (!proposal?.buyerApproved || !proposal?.sellerApproved)
        throw new Error('Both demo wallets must approve the same allocation.');
      order.status = 'resolved';
      order.completedAt = now;
      creditReturn(state, order, proposal.buyerAtoms);
      order.activity.push({ title: 'Resolved with both wallets’ approval', at: now });
      break;
    }
    default:
      throw new Error('Unknown demo event.');
  }
  return state;
}
export function recoverState(value) {
  // These are disposable demo fixtures, never authoritative payment evidence.
  try {
    if (
      !value ||
      value.version !== STORAGE_VERSION ||
      !Array.isArray(value.orders) ||
      !Array.isArray(value.offers) ||
      !Number.isSafeInteger(value.balanceAtoms) ||
      value.balanceAtoms < 0
    )
      return initialState();
    if (
      !value.seller ||
      !['new', 'created', 'funding', 'funded'].includes(value.seller.status) ||
      !/^@[a-zA-Z0-9._]{3,30}$/.test(value.seller.tag) ||
      [
        'balanceAtoms',
        'offerAtoms',
        'depositedAtoms',
        'settledAtoms',
        'returnedAtoms',
        'receivedFiatMinor',
      ].some((key) => !Number.isSafeInteger(value.seller[key]) || value.seller[key] < 0)
    )
      return initialState();
    if (
      value.offers.length !== DEMO_OFFERS.length ||
      new Set(value.offers.map((item) => item.id)).size !== DEMO_OFFERS.length ||
      value.offers.some(
        (item) =>
          !DEMO_OFFERS.some((offer) => offer.id === item.id) ||
          !Number.isSafeInteger(item.availableAtoms) ||
          item.availableAtoms < 0,
      )
    )
      return initialState();
    const statuses = [...OPEN_STATES, 'completed', 'refunded', 'resolved'];
    if (
      value.orders.some(
        (order) =>
          !statuses.includes(order.status) ||
          typeof order.id !== 'string' ||
          !Number.isSafeInteger(order.fiatMinor) ||
          !Number.isSafeInteger(order.tokenAtoms) ||
          !Number.isFinite(order.expiresAt) ||
          !Array.isArray(order.activity),
      )
    )
      return initialState();
    const state = structuredClone(value);
    state.offers = DEMO_OFFERS.map((offer) => ({
      ...offer,
      availableAtoms: value.offers.find((item) => item.id === offer.id).availableAtoms,
      consumed: Boolean(value.offers.find((item) => item.id === offer.id).consumed),
      orderId: value.offers.find((item) => item.id === offer.id).orderId,
    }));
    state.wallet = value.wallet ? buyerWallet() : null;
    state.seller.wallet = value.seller.wallet ? sellerWallet() : null;
    if (state.seller.status === 'funding') state.seller.status = 'created';
    Object.assign(state.offers[0], {
      tag: state.seller.tag,
      minMinor: state.seller.offerAtoms / 110_000,
      maxMinor: state.seller.offerAtoms / 110_000,
    });
    for (const order of state.orders) {
      if (order.status === 'locking') {
        order.status = 'reserved';
        order.lockFailure = true;
      }
      if (order.status === 'verifying') {
        order.status = 'verification_failed';
        order.failure = 'unavailable';
      }
      if (order.status === 'settling') order.status = 'verified';
    }
    return state;
  } catch {
    return initialState();
  }
}
