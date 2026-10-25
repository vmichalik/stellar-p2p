const SCALE = 10_000_000n;
function unsigned(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
    throw new Error('Use exact nonnegative integer units.');
  if (!/^\d+$/.test(String(value))) throw new Error('Use exact nonnegative integer units.');
  return BigInt(value);
}
const group = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export function formatTokens(atoms) {
  const amount = unsigned(atoms);
  const fraction = String(amount % SCALE)
    .padStart(7, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0');
  return `${group(amount / SCALE)}.${fraction}`;
}
export function formatEuros(minor) {
  const amount = unsigned(minor);
  return `€${group(amount / 100n)}.${String(amount % 100n).padStart(2, '0')}`;
}
export const formatRate = (atomsPerEuro) => `1 EUR = ${formatTokens(atomsPerEuro)} USDC`;

/** Presentation only: never establishes payment acceptance or changes an order. */
export function tradePresentation(order, viewer = 'buyer', now = Date.now()) {
  const seller = viewer === 'seller';
  const terminal = ['completed', 'resolved', 'refunded'].includes(order.status);
  const base = {
    heldAtoms: terminal ? 0 : order.tokenAtoms,
    fundsLabel: order.lockedAt ? 'Payment locked' : 'Reserved',
    nextActor: 'Ana',
    tone: 'pending',
  };
  if (order.resolution && order.status === 'reserved' && now >= order.expiresAt) {
    return {
      ...base,
      title: 'This unlocked reservation can be returned',
      detail:
        'The deadline has passed. Return the USDC to the seller, or continue the proposed agreement.',
      nextActor: 'Either participant',
      tone: 'attention',
    };
  }
  if (
    order.resolution &&
    !terminal &&
    !['verifying', 'verified', 'settling'].includes(order.status)
  ) {
    const proposal = order.resolution;
    const own = seller ? proposal.sellerApproved : proposal.buyerApproved;
    const other = seller ? proposal.buyerApproved : proposal.sellerApproved;
    const actor = !own
      ? seller
        ? 'Ben'
        : 'Ana'
      : !other
        ? seller
          ? 'Ana'
          : 'Ben'
        : 'Either participant';
    return {
      ...base,
      title: !own
        ? 'Your approval is needed'
        : !other
          ? `Waiting for ${actor}’s approval`
          : 'Both approvals are ready',
      detail:
        'Both wallets must approve the same amounts. Funds stay held until the agreement is confirmed.',
      nextActor: actor,
      tone: 'attention',
    };
  }
  switch (order.status) {
    case 'reserved':
      return now >= order.expiresAt
        ? {
            ...base,
            title: 'Reservation expired',
            detail: 'No payment lock was confirmed. The USDC can be returned to the seller.',
            nextActor: 'Either participant',
          }
        : {
            ...base,
            title: seller ? 'Ana needs to lock payment' : 'Lock the USDC before paying',
            detail: 'Payment instructions appear only after the lock confirms.',
            tone: order.lockFailure ? 'attention' : 'pending',
          };
    case 'locking':
      return {
        ...base,
        title: 'Confirming the payment lock',
        detail: 'Do not send a payment yet. Wait for confirmation.',
        nextActor: 'Confirmation',
      };
    case 'paying':
      return {
        ...base,
        title: seller
          ? order.paymentReported
            ? 'Ana has reported a payment'
            : now >= order.expiresAt
              ? 'Waiting for payment verification'
              : 'Waiting for Ana’s payment'
          : order.paymentReported
            ? 'Verify your existing payment'
            : now >= order.expiresAt
              ? 'Verify an earlier payment'
              : `Pay ${formatEuros(order.fiatMinor)}, then verify`,
        detail:
          now >= order.expiresAt
            ? 'Do not send a new payment. A timely earlier transfer can still be verified; funds remain held.'
            : order.paymentReported
              ? 'No need to pay again. Verification is the next step.'
              : 'The payment lock is confirmed. USDC stays held while the payment is checked.',
      };
    case 'verifying':
      return {
        ...base,
        title: 'Checking the payment',
        detail: 'USDC remains held while the selected transfer is checked.',
        nextActor: 'Payment check',
      };
    case 'verification_failed':
      return {
        ...base,
        title: seller ? 'Waiting for a payment check' : 'Retry verification, not payment',
        detail:
          'USDC stays held. Ana can retry verification, or both wallets can agree on a resolution.',
        tone: 'attention',
      };
    case 'verified':
      return {
        ...base,
        title: seller ? 'Payment verified · ready to release' : 'Your USDC is ready to receive',
        detail: 'The payment check is complete. Ana can now finish settlement.',
        tone: 'success',
      };
    case 'settling':
      return {
        ...base,
        title: 'Confirming the USDC release',
        detail: 'Wait for confirmation before treating this exchange as complete.',
        nextActor: 'Confirmation',
      };
    case 'completed':
      return {
        ...base,
        title: 'Trade complete',
        detail: 'The settled exchange is recorded in the receipt.',
        fundsLabel: 'Released',
        nextActor: 'Complete',
        tone: 'success',
      };
    case 'resolved':
      return {
        ...base,
        title: 'Resolved by both participants',
        detail: 'The agreed allocation is complete. This offer cannot be used again.',
        fundsLabel: 'Allocated',
        nextActor: 'Complete',
        tone: 'success',
      };
    case 'refunded':
      return {
        ...base,
        title: 'USDC returned to the seller',
        detail: 'The unlocked reservation was refunded. This offer is closed.',
        fundsLabel: 'Returned',
        nextActor: 'Complete',
        tone: 'success',
      };
    default:
      return {
        ...base,
        title: 'Review this trade',
        detail: 'Check the current trade status before continuing.',
        nextActor: 'Review',
      };
  }
}

export function recoveryOptions(order, now = Date.now()) {
  return {
    verifyExistingPayment:
      Number.isFinite(order.lockedAt) && ['paying', 'verification_failed'].includes(order.status),
    refundExpiredReservation: order.status === 'reserved' && now >= order.expiresAt,
  };
}
export function formatDeadline(timestamp) {
  return `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon', timeZoneName: 'shortOffset' }).format(timestamp)} (Lisbon)`;
}

export function activityLabel(order, viewer, fallback, now = Date.now()) {
  if (!order.resolution || !['reserved', 'paying', 'verification_failed'].includes(order.status))
    return fallback;
  if (order.status === 'reserved' && now >= order.expiresAt) return 'Refund available';
  if (order.resolution.buyerApproved && order.resolution.sellerApproved) return 'Recovery ready';
  return order.resolution[viewer === 'seller' ? 'sellerApproved' : 'buyerApproved']
    ? 'Recovery pending'
    : 'Your approval needed';
}
