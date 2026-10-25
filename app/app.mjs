import {
  TOKEN_SCALE,
  OPEN_STATES,
  quote,
  sellerQuote,
  canShowPaymentInstructions,
} from './model.mjs';
import { createDemoAdapter } from './demo-adapter.mjs';

const paths = {
  buy: '<path d="M18 6 6 18M6 7v11h11"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  up: '<path d="M6 18 18 6M6 6h12v12"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6m-6 4h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  wallet: '<path d="M19 7V4H6a3 3 0 0 0 0 6h15v10H6a3 3 0 0 1-3-3V7"/><path d="M16 13h5v4h-5z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 4H6a2 2 0 0 0-2 2v9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',
};
const icon = (name, extra = '') =>
  `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const euros = (minor) =>
  `€${(minor / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tokens = (atoms) =>
  (atoms / TOKEN_SCALE).toLocaleString('en-IE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const time = (timestamp) =>
  new Date(timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
let localStorage;
try {
  localStorage = window.localStorage;
} catch {
  /* In-memory fallback works in restrictive embeds. */
}
const adapter = createDemoAdapter({ storage: localStorage });
const root = document.querySelector('#pactlane');
const modal = document.querySelector('#modal');
const toastElement = document.querySelector('#toast');
let state = adapter.snapshot();
let selectedOffer = 'ben';
let amount = '20.00';
let sellAmount = '22.00';
let sellerTag = '@ben';
let route = 'buy';
let orderId = state.orders.find((order) => OPEN_STATES.includes(order.status))?.id;
if (orderId) route = 'trade';
let outcome = 'success';
let lockOutcome = 'success';
let progress = 'Preparing payment check';
let toastTimeout;
let busy = false;
let lastTrigger;

function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastElement.classList.remove('visible'), 5000);
}

const row = (label, value) =>
  `<div class="detail-row"><span>${label}</span><strong>${value}</strong></div>`;
const pill = (label, kind = 'green') => `<span class="pill ${kind}">${label}</span>`;
const currentOrder = () => state.orders.find((order) => order.id === orderId);
const statusLabels = {
  reserved: 'Ready to lock',
  locking: 'Locking escrow',
  paying: 'Awaiting payment',
  verifying: 'Checking payment',
  verification_failed: 'Needs verification',
  verified: 'Ready to receive',
  settling: 'Receiving USDC',
  completed: 'Completed',
  refunded: 'Refunded',
  resolved: 'Resolved by agreement',
};

function marketplace() {
  const active = state.orders.find((order) => OPEN_STATES.includes(order.status));
  return `<div class="page-heading"><div><p class="eyebrow">PEER-TO-PEER EXCHANGE</p><h1>Buy USDC</h1><p>Pay with Revolut. Receive USDC in your Stellar wallet.</p></div><span class="market-note">${icon('shield')} Seller funds held in escrow</span></div>
    ${active ? `<div class="resume-banner"><div>${icon('clock')}<span>Your trade with ${esc(active.seller)} is waiting.</span></div><button class="text-button" data-action="open-trade" data-id="${esc(active.id)}">Continue trade ${icon('arrow')}</button></div>` : state.seller.status !== 'funded' ? `<div class="resume-banner"><div>${icon('up')}<span>Have USDC to exchange?</span></div><button class="text-button" data-action="sell">Create an offer ${icon('arrow')}</button></div>` : ''}
    <div class="market-layout"><section class="offers-column" aria-labelledby="offers-title">
      <div class="filter-bar"><div class="filter"><span>You pay with</span><strong><span class="currency-disc">€</span> EUR</strong></div><div class="filter"><span>Payment method</span><strong><span class="revolut-mark">R</span> Revolut</strong></div></div>
      <div class="section-title"><h2 id="offers-title">Available offers <span>${state.offers.filter((offer) => offer.availableAtoms > 0).length}</span></h2><span>Fixed whole offer</span></div>
      <div class="offer-list">${state.offers
        .map(
          (
            offer,
          ) => `<button class="offer ${offer.id === selectedOffer ? 'selected' : ''}" data-action="select-offer" data-id="${offer.id}" aria-pressed="${offer.id === selectedOffer}" ${offer.availableAtoms <= 0 ? 'disabled' : ''}>
        <span class="offer-top"><span class="person"><span class="avatar ${offer.color}">${offer.initials}</span><span><strong>${offer.name}</strong><span>Revolut · EUR</span></span></span>${pill(offer.availableAtoms > 0 ? 'Funded' : offer.id === 'ben' && state.seller.status !== 'funded' ? 'Not funded' : 'Unavailable', offer.availableAtoms > 0 ? 'green' : 'neutral')}</span>
        <span class="offer-rate"><strong>${(offer.rateAtomsPerEuro / TOKEN_SCALE).toFixed(2)} <span>USDC / EUR</span></strong><span class="select-circle">${offer.id === selectedOffer ? icon('check') : ''}</span></span>
        <span class="offer-bottom"><span>${tokens(offer.availableAtoms)} USDC available</span><span>Exact payment ${euros(offer.maxMinor)}</span></span>
      </button>`,
        )
        .join('')}</div>
      <div class="how-it-works"><div>${icon('lock')}<span>Reserve a funded offer</span></div><div>${icon('shield')}<span>Verify your payment</span></div><div>${icon('wallet')}<span>Receive in your wallet</span></div></div>
    </section><aside class="quote-panel panel" aria-labelledby="quote-title"><div class="quote-heading"><h2 id="quote-title">Your exchange</h2><span class="paired-mark" aria-hidden="true">↙↗</span></div>
      <form id="quote-form" novalidate><label class="money-field" for="pay-amount"><span>You pay</span><span class="money-input"><input id="pay-amount" name="amount" readonly value="${esc(amount)}" inputmode="decimal" autocomplete="off" aria-describedby="quote-error" placeholder="0.00"><span class="currency-label"><span class="currency-disc">€</span> EUR</span></span></label>
      <div class="exchange-divider">${icon('buy')}</div><div class="money-field receive-field"><span>You receive</span><span class="money-input"><output id="receive-amount" for="pay-amount">0.00</output><span class="currency-label"><span class="usdc-disc">$</span> USDC</span></span></div>
      <div id="quote-error" class="field-error" aria-live="polite"></div><div class="quote-details">${row('Seller', `<span id="quote-seller"></span>`)}${row('Receive on', 'Stellar testnet')}${row('Pactlane fee', '€0.00')}</div>
      <button type="submit" class="button primary" id="reserve-button">Reserve USDC ${icon('arrow')}</button></form>
      <p class="quote-footnote">${icon('lock')} Your rate is fixed when you reserve.</p>
    </aside></div>`;
}

function sellerPage() {
  const seller = state.seller;
  const offer = state.offers.find((item) => item.id === 'ben');
  const trades = state.orders.filter((order) => order.offerId === 'ben');
  const reservedAtoms = trades
    .filter((order) => OPEN_STATES.includes(order.status))
    .reduce((total, order) => total + order.tokenAtoms, 0);
  const funded = seller.status === 'funded';
  const preparing = seller.status === 'new';
  const status = funded
    ? reservedAtoms
      ? 'Buyer reserved'
      : offer.availableAtoms
        ? 'Live offer'
        : 'Offer complete'
    : seller.status === 'funding'
      ? 'Funding escrow'
      : preparing
        ? 'New offer'
        : 'Ready to fund';
  return `<div class="page-heading"><div><p class="eyebrow">BEN’S SELLER WORKSPACE</p><h1>Sell USDC</h1><p>Set your offer. Fund escrow. Get paid in Revolut.</p></div>${pill(status, funded ? 'green' : 'orange')}</div>
    <div class="trade-layout seller-layout"><section class="panel seller-offer-panel">
    ${preparing ? `<h2>Create your offer</h2><p class="seller-intro">Your USDC becomes available to buyers once you fund the offer.</p><form id="seller-form" novalidate><label class="money-field" for="seller-amount"><span>You sell</span><span class="money-input"><input id="seller-amount" inputmode="decimal" value="${esc(sellAmount)}" autocomplete="off" aria-describedby="seller-error"><span class="currency-label"><span class="usdc-disc">$</span> USDC</span></span></label><p class="seller-wallet-note">Demo wallet balance: ${tokens(seller.balanceAtoms)} USDC</p><label class="settings-label" for="seller-tag">Your Revolut tag</label><input class="text-input" id="seller-tag" value="${esc(sellerTag)}" autocomplete="off" spellcheck="false"><div class="quote-details">${row('Your rate', '1 EUR = 1.10 USDC')}${row('Payment currency', 'EUR')}${row('Buyer pays exactly', '<span id="seller-receive">€20.00</span>')}</div><p class="field-error" id="seller-error" aria-live="polite"></p><button class="button primary" type="submit">Create offer ${icon('arrow')}</button></form>` : `<span class="status-symbol ${seller.status === 'funding' ? 'processing' : ''}">${seller.status === 'funding' ? '<span class="spinner"></span>' : icon(funded ? 'check' : 'lock')}</span><h2>${funded ? (reservedAtoms ? 'Ana has reserved your USDC' : (seller.settledAtoms || seller.returnedAtoms) && !offer.availableAtoms ? 'Your offer is closed' : 'Your offer is live') : seller.status === 'funding' ? 'Funding your escrow' : 'Your offer is ready to fund'}</h2><p class="seller-intro">${funded ? (reservedAtoms ? 'Your USDC stays in escrow while Ana completes payment verification.' : seller.settledAtoms || seller.returnedAtoms ? 'This whole offer has ended. Review its outcome in the trade activity below.' : 'Buyers can now reserve your funded USDC.') : seller.status === 'funding' ? 'Confirming your simulated deposit. Your offer will appear in the marketplace next.' : 'Approve a demo deposit from Ben’s wallet to make this offer available.'}</p><div class="summary-amount"><span>${funded ? 'USDC deposited' : 'Deposit to escrow'}</span><strong>${tokens(seller.offerAtoms)} <span>USDC</span></strong></div>${funded ? row('Offer reference', esc(seller.orderId)) : ''}${row('Your Revolut tag', esc(seller.tag))}${row('Your rate', '1 EUR = 1.10 USDC')}${row('Available for buyers', tokens(offer.availableAtoms) + ' USDC')}${row('Reserved by Ana', tokens(reservedAtoms) + ' USDC')}${funded ? row('Released to Ana', tokens(seller.settledAtoms) + ' USDC') + row('Returned to Ben', tokens(seller.returnedAtoms) + ' USDC') : ''}${funded ? `<button class="button primary" data-action="buyer-view">${reservedAtoms || !offer.availableAtoms ? 'View Ana’s trade' : 'Open buyer view'} ${icon('arrow')}</button>` : seller.status === 'created' ? `<button class="button primary" data-action="review-deposit">Fund ${tokens(seller.offerAtoms)} USDC ${icon('wallet')}</button>` : '<p class="small-note">Demo simulation · no real transaction</p>'}`}
    </section><aside class="panel seller-summary"><div class="section-title"><h2>Your balances</h2><span class="avatar mini peach">B</span></div><div class="summary-amount"><span>Ben’s demo wallet</span><strong>${tokens(seller.balanceAtoms)} <span>USDC</span></strong></div>${row('Held in escrow', tokens(seller.depositedAtoms - seller.settledAtoms - seller.returnedAtoms) + ' USDC')}${row('Verified EUR received', euros(seller.receivedFiatMinor))}${row('Payment method', 'Revolut')}${row('Network', 'Stellar testnet')}<div class="escrow-note">${icon('shield')}<p>Escrow releases after verified payment or an agreement approved by both wallets.</p></div><p class="small-note seller-demo-note">Demo balances and deposits are simulated.</p></aside></div>
    <section class="seller-activity"><div class="section-title"><h2>Offer activity</h2><span>Ben’s trades</span></div>${
      trades.find((order) => order.resolution && OPEN_STATES.includes(order.status))
        ? resolutionPanel(
            trades.find((order) => order.resolution && OPEN_STATES.includes(order.status)),
            'seller',
          )
        : ''
    }${trades.length ? `<div class="trade-list">${trades.map((order) => `<button class="trade-list-item panel" data-action="seller-trade" data-id="${esc(order.id)}"><span class="trade-list-icon">${icon('receipt')}</span><span class="trade-list-description"><strong>${tokens(order.tokenAtoms)} USDC · Ana</strong><span>${euros(order.fiatMinor)} · ${esc(order.id)}</span></span>${pill(statusLabels[order.status], order.status === 'completed' ? 'green' : 'orange')}${icon('arrow')}</button>`).join('')}</div>` : `<div class="seller-empty">${icon('receipt')}<p>${funded ? 'Your offer is waiting for its first buyer.' : 'Buyer reservations will appear here once your offer is funded.'}</p></div>`}</section>`;
}

function updateSellerQuote() {
  if (!document.querySelector('#seller-form')) return;
  try {
    const result = sellerQuote(sellAmount);
    document.querySelector('#seller-receive').textContent = euros(result.maxMinor);
    document.querySelector('#seller-error').textContent = '';
  } catch (error) {
    document.querySelector('#seller-receive').textContent = '—';
    document.querySelector('#seller-error').textContent = error.message;
  }
}

function summary(order) {
  return `<aside class="panel trade-summary"><div class="section-title"><h2>Your exchange</h2><span class="paired-mark small" aria-hidden="true">↙↗</span></div><div class="summary-amount"><span>You receive</span><strong>${tokens(order.tokenAtoms)} <span>USDC</span></strong></div>${row('You pay', euros(order.fiatMinor) + ' EUR')}${row('Seller', esc(order.seller))}${row('Payment method', 'Revolut')}${row('Receive in', esc(state.wallet?.label))}${row('Trade reference', `<span class="mono">${esc(order.id)}</span>`)}<div class="escrow-note">${icon('lock')}<p>${['completed', 'resolved', 'refunded'].includes(order.status) ? 'This trade has ended.' : 'The USDC stays reserved while you verify your payment.'}</p></div></aside>`;
}

function steps(order) {
  const index =
    {
      reserved: 1,
      locking: 1,
      paying: 2,
      verifying: 3,
      verification_failed: 3,
      verified: 4,
      settling: 4,
      completed: 5,
    }[order.status] ?? 0;
  return `<ol class="steps" aria-label="Trade progress">${['Reserved', 'Payment lock', 'Payment', 'Verification', 'Received'].map((label, i) => `<li class="${i < index ? 'done' : i === index ? 'current' : ''}" ${i === index ? 'aria-current="step"' : ''}><span>${i < index ? icon('check') : i + 1}</span><strong>${label}</strong></li>`).join('')}</ol>`;
}
function lockPanel(order) {
  const expired = Date.now() >= order.expiresAt;
  const locking = order.status === 'locking';
  return `<section class="panel status-panel"><span class="status-symbol ${locking ? 'processing' : 'neutral'}">${locking ? '<span class="spinner"></span>' : icon('lock')}</span><h2>${locking ? 'Locking your payment window' : expired ? 'Reservation expired' : 'Secure your payment window'}</h2><p>${locking ? 'Waiting for the demo escrow lock to confirm. Payment instructions will appear after confirmation.' : expired ? 'This reservation was never locked for payment. Do not send any money for it.' : 'Lock the reserved escrow before sending any money. Once it confirms, we’ll show your Revolut payment instructions.'}</p>${order.lockFailure ? '<div class="important-note"><strong>Payment lock not confirmed.</strong><span>Do not send a payment. You can retry while the reservation is active.</span></div>' : ''}${locking ? '<p class="small-note">Demo simulation · no real transaction</p>' : expired ? '<button class="button primary" data-action="refund-expired">Return expired reservation to seller</button>' : `<button class="button primary" data-action="lock-payment">${order.lockFailure ? 'Retry payment lock' : 'Lock payment window'} ${icon('lock')}</button><p class="quote-footnote" data-countdown>${remaining(order)}</p><button class="text-button" data-action="request-resolution" data-id="${esc(order.id)}">Agree to end this trade</button>`}</section>`;
}
function paymentPanel(order) {
  if (!canShowPaymentInstructions(order))
    return `<section class="panel status-panel"><span class="status-symbol amber">${icon('clock')}</span><h2>Payment window ended</h2><p>Don’t send a new payment. If you paid before the deadline, you can still verify that transfer.</p><button class="button primary" data-action="paid">I already paid · verify payment ${icon('shield')}</button><button class="button secondary" data-action="request-resolution" data-id="${esc(order.id)}">Agree on a resolution</button><p class="small-note">Your USDC stays held. A resolution needs both wallets’ approval.</p></section>`;
  return `<section class="panel payment-panel"><div class="section-title"><h2>Pay ${esc(order.seller)} in Revolut</h2><span class="countdown" data-countdown>${remaining(order)}</span></div><p>Your payment lock is confirmed. Send the exact amount using your Revolut app.</p><div class="payment-amount">${euros(order.fiatMinor)} <span>EUR</span></div><div class="recipient-card"><span class="avatar peach">${esc(order.seller[0])}</span><span><strong>${esc(order.seller)}</strong><span>${esc(order.tag)}</span></span><button class="icon-button" data-action="copy-tag" aria-label="Copy Revolut tag">${icon('copy')}</button></div><div class="payment-note">Return here once your transfer is complete. Verification can finish later if the payment itself was made before the deadline.</div><button class="button primary" data-action="paid">${order.paymentReported ? 'Continue payment verification' : 'I’ve paid · verify payment'} ${icon('arrow')}</button><button class="text-button cancel-link" data-action="request-resolution" data-id="${esc(order.id)}">Agree on a resolution</button></section>`;
}
function resolutionPanel(order, party = 'buyer') {
  const proposal = order.resolution;
  const approved = proposal[party + 'Approved'];
  const both = proposal.buyerApproved && proposal.sellerApproved;
  return `<section class="panel resolution-panel"><span class="status-symbol neutral">${icon('shield')}</span><h2>Resolve this trade together</h2><p>Both wallets must approve the same allocation. Your USDC stays held until the agreement is confirmed.</p><div class="disclosure">${row('Ana receives', tokens(proposal.buyerAtoms) + ' USDC')}${row('Ben receives back', tokens(order.tokenAtoms - proposal.buyerAtoms) + ' USDC')}${row('Ana’s approval', proposal.buyerApproved ? 'Approved' : 'Waiting')}${row('Ben’s approval', proposal.sellerApproved ? 'Approved' : 'Waiting')}</div>${!approved ? `<button class="button primary" data-action="review-resolution" data-id="${esc(order.id)}" data-party="${party}">Review ${party === 'buyer' ? 'Ana’s' : 'Ben’s'} approval</button>` : '<p class="small-note">Your demo wallet approved this allocation.</p>'}${both ? `<button class="button primary" data-action="confirm-resolution" data-id="${esc(order.id)}">Confirm agreed resolution</button>` : ''}<button class="button secondary" data-action="${party === 'buyer' ? 'sell' : 'buyer-view'}">${party === 'buyer' ? 'Open Ben’s view' : 'Open Ana’s trade'}</button>${party === 'buyer' && order.paymentReported ? '<button class="text-button" data-action="review-proof">Retry payment verification</button>' : ''}</section>`;
}
function terminalOutcome(order) {
  const buyerAtoms = order.status === 'resolved' ? order.resolution.buyerAtoms : 0;
  return `<section class="panel status-panel"><span class="status-symbol">${icon('check')}</span><h2>${order.status === 'resolved' ? 'Both parties agreed' : 'USDC returned to seller'}</h2><p>${order.status === 'resolved' ? 'Both demo wallets approved this allocation. The trade is closed.' : 'The unlocked reservation expired and the USDC returned to the seller. This offer cannot be reserved again.'}</p><div class="disclosure">${row('Ana received', tokens(buyerAtoms) + ' USDC')}${row('Ben received back', tokens(order.tokenAtoms - buyerAtoms) + ' USDC')}${row('Trade reference', esc(order.id))}</div><button class="button primary" data-action="sell">View seller workspace</button><button class="button secondary" data-action="trades">My trades</button></section>`;
}

function verificationPanel(order) {
  if (order.status === 'verification_failed')
    return `<section class="panel status-panel"><span class="status-symbol amber">${icon('info')}</span><h2>Verification incomplete</h2><p>${order.failure === 'mismatch' ? 'The selected payment details don’t match this trade. Check the amount and recipient, then choose the correct transfer.' : 'We couldn’t finish the payment check. Your reservation is still here, so you can try again.'}</p><div class="important-note"><strong>Don’t pay again.</strong><span>Your bank payment may have gone through. No USDC has been released.</span></div><button class="button primary" data-action="review-proof">Try verification again ${icon('refresh')}</button><button class="button secondary" data-action="request-resolution" data-id="${esc(order.id)}">Agree on a resolution</button></section>`;
  const inProgress = order.status === 'verifying' || order.status === 'settling';
  return `<section class="panel status-panel"><span class="status-symbol ${inProgress ? 'processing' : ''}">${inProgress ? '<span class="spinner"></span>' : icon('check')}</span><h2>${order.status === 'verifying' ? 'Checking your payment' : order.status === 'settling' ? 'Receiving your USDC' : 'Your payment matches'}</h2><p>${order.status === 'verifying' ? 'Your selected payment details are being checked against the reserved trade.' : order.status === 'settling' ? 'Finishing your demo exchange. Your receipt will appear here.' : 'The amount, recipient and payment status match. You can now finish your exchange.'}</p>${order.status === 'verifying' ? `<div class="progress-line" role="status"><span class="pulse-dot"></span><span id="proof-progress">${esc(progress)}</span></div>` : `<div class="check-list"><div>${icon('check')} Amount and recipient match</div><div>${icon('check')} Completed outgoing payment</div><div>${icon('check')} Payment is unused for settlement</div></div>`}${order.status === 'verified' ? `<button class="button primary" data-action="settle">Receive ${tokens(order.tokenAtoms)} USDC ${icon('arrow')}</button>` : '<p class="small-note">Demo simulation · no bank or chain request</p>'}</section>`;
}

function receipt(order) {
  return `<div class="receipt-layout"><section class="panel receipt-panel"><span class="status-symbol">${icon('check')}</span><p class="received-label">You received</p><h2 class="receipt-amount">${tokens(order.tokenAtoms)} <span>USDC</span></h2><p>Your demo exchange with ${esc(order.seller)} is complete.</p><div class="receipt-separator"><span></span><span></span></div>${row('You paid', euros(order.fiatMinor) + ' EUR')}${row('Payment method', 'Revolut')}${row('Received in', esc(state.wallet?.label))}${row('Completed', time(order.completedAt))}<div class="receipt-actions"><button class="button primary" data-action="receipt-details">Settlement details ${icon('up')}</button><button class="button secondary" data-action="buy">Back to offers</button></div></section><section class="activity-panel"><h2>Trade activity</h2><ol class="activity-list">${order.activity.map((item) => `<li><span class="activity-check">${icon('check')}</span><div><strong>${esc(item.title)}</strong><span>${time(item.at)}</span></div></li>`).join('')}</ol><div class="receipt-pair"><span>${euros(order.fiatMinor)}<small>Revolut · EUR</small></span><span>${icon('arrow')}</span><span>${tokens(order.tokenAtoms)}<small>Stellar · USDC</small></span></div><p class="small-note">Demo receipt · sample data. No bank payment or on-chain transaction occurred.</p></section></div>`;
}

function tradePage() {
  const order = currentOrder();
  if (!order) return tradesPage();
  const terminal = ['resolved', 'refunded'].includes(order.status);
  const complete = order.status === 'completed';
  let content;
  if (complete) content = receipt(order);
  else if (terminal) content = terminalOutcome(order);
  else {
    const panel =
      order.resolution && !['verified', 'verifying', 'settling'].includes(order.status)
        ? resolutionPanel(order)
        : ['reserved', 'locking'].includes(order.status)
          ? lockPanel(order)
          : order.status === 'paying'
            ? paymentPanel(order)
            : verificationPanel(order);
    content = `${steps(order)}<div class="trade-layout">${panel}${summary(order)}</div>`;
  }
  return `<button class="back-link" data-action="trades">← My trades</button><div class="page-heading"><div><p class="eyebrow">${esc(order.id)}</p><h1>${complete ? 'Trade complete' : terminal ? 'Trade closed' : `Buy ${tokens(order.tokenAtoms)} USDC`}</h1><p>${complete ? 'Your USDC is in your demo wallet.' : terminal ? 'Your final allocation is recorded below.' : `Your trade with ${esc(order.seller)}. One step at a time.`}</p></div>${pill(statusLabels[order.status], complete || terminal || order.status === 'verified' ? 'green' : 'orange')}</div>${content}`;
}

function tradesPage() {
  return `<div class="page-heading"><div><p class="eyebrow">YOUR EXCHANGES</p><h1>My trades</h1><p>Pick up where you left off, or open a receipt.</p></div><button class="button secondary compact" data-action="buy">New exchange ${icon('up')}</button></div>${state.orders.length ? `<div class="trade-list">${state.orders.map((order) => `<button class="trade-list-item panel" data-action="open-trade" data-id="${esc(order.id)}"><span class="trade-list-icon">${icon(order.status === 'completed' ? 'check' : 'receipt')}</span><span class="trade-list-description"><strong>${tokens(order.tokenAtoms)} USDC</strong><span>${euros(order.fiatMinor)} to ${esc(order.seller)} · ${time(order.reservedAt)}</span></span>${pill(statusLabels[order.status], order.status === 'completed' ? 'green' : 'orange')}${icon('arrow')}</button>`).join('')}</div>` : `<div class="panel empty-state"><span class="status-symbol neutral">${icon('receipt')}</span><h2>Your first exchange starts here</h2><p>Once you reserve an offer, you can follow it here from payment to receipt.</p><button class="button primary" data-action="buy">Explore offers ${icon('arrow')}</button></div>`}`;
}

function render() {
  state = adapter.snapshot();
  if (!state.offers.some((offer) => offer.id === selectedOffer && offer.availableAtoms > 0))
    selectedOffer = state.offers.find((offer) => offer.availableAtoms > 0)?.id ?? selectedOffer;
  const sellerView = route === 'sell';
  const activeWallet = sellerView ? state.seller.wallet : state.wallet;
  const personName = sellerView ? 'Ben' : 'Ana';
  root.innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="wordmark" href="#" data-action="buy" aria-label="Pactlane home"><span class="brand-symbol" aria-hidden="true"><span></span><span></span></span>pactlane<span class="brand-dot">.</span></a><p class="nav-label">YOUR WORKSPACE</p><nav aria-label="Main navigation"><button class="nav-item ${route === 'buy' ? 'active' : ''}" data-action="buy" ${route === 'buy' ? 'aria-current="page"' : ''}>${icon('buy')} Buy USDC</button><button class="nav-item ${sellerView ? 'active' : ''}" data-action="sell" ${sellerView ? 'aria-current="page"' : ''}>${icon('up')} Sell USDC</button><button class="nav-item ${['trade', 'trades'].includes(route) ? 'active' : ''}" data-action="trades" ${['trade', 'trades'].includes(route) ? 'aria-current="page"' : ''}>${icon('receipt')} My trades ${state.orders.length ? `<span class="nav-count">${state.orders.length}</span>` : ''}</button></nav><div class="sidebar-bottom"><div class="network-badge"><span class="network-dot"></span> Stellar testnet</div><span class="sidebar-caption">Peer-to-peer. On Stellar.</span></div></aside><div class="workspace"><header class="app-header"><span class="header-location">${sellerView ? 'Seller workspace' : route === 'buy' ? 'Marketplace' : 'Your activity'}</span><div class="header-actions"><span class="demo-badge">Demo <span>· Sample data</span></span><button class="icon-button" data-action="settings" aria-label="Demo settings">${icon('settings')}</button><button class="wallet-button" data-action="wallet">${activeWallet ? `<span class="avatar mini peach">${personName[0]}</span><span>${personName}’s wallet</span><span class="network-dot"></span>` : `${icon('wallet')}<span>Connect wallet</span>`}</button></div></header><main id="main" tabindex="-1">${sellerView ? sellerPage() : route === 'buy' ? marketplace() : route === 'trades' ? tradesPage() : tradePage()}</main><footer class="app-footer"><span>Built for a fair exchange.</span><span>Demo mode · Simulated payments and settlement</span></footer></div></div>`;
  document.title = `Pactlane · ${sellerView ? 'Sell USDC' : route === 'buy' ? 'Buy USDC' : 'My trades'}`;
  if (route === 'buy') {
    amount = (state.offers.find((offer) => offer.id === selectedOffer).maxMinor / 100).toFixed(2);
    document.querySelector('#pay-amount').value = amount;
    updateQuote();
  }
  if (sellerView) updateSellerQuote();
}

function updateQuote() {
  const offer = state.offers.find((item) => item.id === selectedOffer);
  document.querySelector('#quote-seller').textContent = offer?.name ?? 'Choose an offer';
  const error = document.querySelector('#quote-error');
  const input = document.querySelector('#pay-amount');
  const button = document.querySelector('#reserve-button');
  const active = state.orders.some((order) => OPEN_STATES.includes(order.status));
  try {
    const result = quote(offer, amount);
    document.querySelector('#receive-amount').textContent = tokens(result.tokenAtoms);
    error.textContent = '';
    input.setAttribute('aria-invalid', 'false');
    button.disabled = active;
    button.innerHTML = active
      ? 'Finish your current trade first'
      : `Reserve ${tokens(result.tokenAtoms)} USDC ${icon('arrow')}`;
  } catch (failure) {
    document.querySelector('#receive-amount').textContent = '—';
    error.textContent =
      state.seller.status !== 'funded'
        ? 'This offer is waiting for seller funding.'
        : failure.message;
    input.setAttribute('aria-invalid', 'true');
    button.disabled = true;
    if (active) button.textContent = 'Finish your current trade first';
  }
}

function remaining(order) {
  const seconds = Math.max(0, Math.ceil((order.expiresAt - Date.now()) / 1000));
  return `${icon('clock')} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function navigate(next, id) {
  route = next;
  if (id) orderId = id;
  render();
  document.querySelector('#main').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function openModal(content) {
  lastTrigger = document.activeElement;
  modal.innerHTML = `<button class="icon-button modal-close" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button>${content}`;
  modal.showModal();
}

function closeModal() {
  modal.close();
  if (lastTrigger?.isConnected) lastTrigger.focus();
}

function walletModal(afterConnect = 'stay') {
  const sellerView = route === 'sell';
  const wallet = sellerView ? state.seller.wallet : state.wallet;
  const name = sellerView ? 'Ben' : 'Ana';
  const balance = sellerView ? state.seller.balanceAtoms : state.balanceAtoms;
  if (wallet) {
    openModal(
      `<span class="status-symbol neutral">${icon('wallet')}</span><h2 id="modal-title">${name}’s demo wallet</h2><p>A place to try the full Pactlane flow.</p><div class="wallet-balance"><span>Demo balance</span><strong>${tokens(balance)} USDC</strong></div><p class="small-note">This is a simulated wallet on a testnet interface. No wallet extension is connected.</p><button class="button primary" data-action="close-modal">Done</button>`,
    );
  } else {
    openModal(
      `<span class="status-symbol neutral">${icon('wallet')}</span><h2 id="modal-title">Meet your demo wallet</h2><p>Try ${sellerView ? 'selling USDC' : 'your first exchange'} as ${name}. We’ll keep your sample trades in this browser.</p><div class="wallet-demo-card"><span class="avatar peach">${name[0]}</span><div><strong>${name}’s wallet</strong><span>Stellar testnet · Demo account</span></div></div><p class="small-note">No extension, real funds or bank login needed.</p><button class="button primary" data-action="connect" data-party="${sellerView ? 'seller' : 'buyer'}" data-after="${afterConnect}">Use ${name}’s demo wallet ${icon('arrow')}</button>`,
    );
  }
}

function reserve() {
  const active = state.orders.find((order) => OPEN_STATES.includes(order.status));
  if (active) {
    navigate('trade', active.id);
    return;
  }
  if (!state.wallet) {
    walletModal('reserve');
    return;
  }
  const order = adapter.reserve(selectedOffer, amount);
  navigate('trade', order.id);
}

function proofModal() {
  const order = currentOrder();
  openModal(
    `<span class="status-symbol neutral">${icon('shield')}</span><p class="eyebrow">PAYMENT VERIFICATION</p><h2 id="modal-title">Review your payment check</h2><p>In the connected app, TLSNotary will ask you to approve the selected details from your completed Revolut transfer.</p><div class="disclosure">${row('Recipient', `${esc(order.seller)} · ${esc(order.tag)}`)}${row('Amount', euros(order.fiatMinor) + ' EUR')}${row('Transfer', 'Completed · Outgoing')}${row('Also checked', 'Payment ID and completion time')}</div><p class="small-note">Your bank password and login credentials aren’t part of the shared details. This demo uses sample payment data.</p><label class="consent"><input type="checkbox" id="proof-consent"> <span>I’ve reviewed the selected payment details.</span></label><button class="button primary" id="start-proof" data-action="verify" disabled>Start demo verification ${icon('arrow')}</button>`,
  );
}

async function handleAction(button) {
  const action = button.dataset.action;
  if (['buy', 'sell', 'trades'].includes(action)) {
    navigate(action);
    return;
  }
  if (action === 'select-offer') {
    selectedOffer = button.dataset.id;
    amount = (state.offers.find((offer) => offer.id === selectedOffer).maxMinor / 100).toFixed(2);
    render();
    document
      .querySelector(`[data-action="select-offer"][data-id="${selectedOffer}"]`)
      .focus({ preventScroll: true });
    return;
  }
  if (action === 'open-trade') {
    navigate('trade', button.dataset.id);
    return;
  }
  if (action === 'wallet') {
    walletModal();
    return;
  }
  if (action === 'close-modal') {
    closeModal();
    return;
  }
  if (action === 'connect') {
    const after = button.dataset.after;
    if (button.dataset.party === 'seller') adapter.connectSellerWallet();
    else adapter.connectWallet();
    closeModal();
    render();
    if (after === 'reserve') reserve();
    if (after === 'seller-create') {
      adapter.createSellerOffer(sellAmount, sellerTag);
      navigate('sell');
    }
    return;
  }
  if (action === 'review-deposit') {
    openModal(
      `<span class="status-symbol neutral">${icon('wallet')}</span><h2 id="modal-title">Review your deposit</h2><p>Move demo USDC from Ben’s wallet into escrow for this offer.</p><div class="disclosure">${row('Deposit', tokens(state.seller.offerAtoms) + ' USDC')}${row('From', 'Ben’s demo wallet')}${row('To', 'Pactlane demo escrow')}${row('Network shown', 'Stellar testnet')}</div><p class="small-note">This simulates wallet approval and funding. No real transaction will be signed or submitted.</p><button class="button primary" data-action="fund-seller">Approve demo deposit</button>`,
    );
    return;
  }
  if (action === 'fund-seller') {
    if (busy) return;
    closeModal();
    busy = true;
    try {
      await adapter.fundSellerOffer();
    } finally {
      busy = false;
    }
    if (route === 'sell') navigate('sell');
    else render();
    return;
  }
  if (action === 'buyer-view') {
    const trade = state.orders.find(
      (order) => order.offerId === 'ben' && OPEN_STATES.includes(order.status),
    );
    const completed =
      !state.offers[0].availableAtoms &&
      state.orders.find(
        (order) =>
          order.offerId === 'ben' && ['completed', 'resolved', 'refunded'].includes(order.status),
      );
    if (trade || completed) navigate('trade', (trade || completed).id);
    else {
      selectedOffer = 'ben';
      amount = (Math.min(2000, state.offers[0].maxMinor) / 100).toFixed(2);
      navigate('buy');
    }
    return;
  }
  if (action === 'seller-trade') {
    const order = state.orders.find((item) => item.id === button.dataset.id);
    openModal(
      `<h2 id="modal-title">Your trade with Ana</h2><div class="disclosure">${row('Reference', esc(order.id))}${row('Status', statusLabels[order.status])}${row('Ana pays', euros(order.fiatMinor) + ' EUR')}${row('Ana receives', tokens(order.tokenAtoms) + ' USDC')}${row('Payment reported', order.paymentReported ? 'Yes' : 'Not yet')}${row('Escrow', order.status === 'completed' ? 'Released' : ['resolved', 'refunded'].includes(order.status) ? 'Closed' : order.lockedAt ? 'Payment locked' : 'Reserved')}</div><p class="small-note">Both demo participants share this trade. Payment and settlement are simulated.</p>${OPEN_STATES.includes(order.status) ? `<button class="button secondary" data-action="request-resolution" data-id="${esc(order.id)}">Review mutual resolution</button>` : ''}<button class="button primary" data-action="open-buyer-trade" data-id="${esc(order.id)}">Open Ana’s trade ${icon('arrow')}</button>`,
    );
    return;
  }
  if (action === 'open-buyer-trade') {
    closeModal();
    navigate('trade', button.dataset.id);
    return;
  }
  if (action === 'copy-tag') {
    try {
      await navigator.clipboard.writeText(currentOrder().tag);
      toast('Revolut tag copied.');
    } catch {
      toast(`Revolut tag: ${currentOrder().tag}`);
    }
    return;
  }
  if (action === 'paid') {
    if (!currentOrder().paymentReported) adapter.reportPayment(orderId);
    proofModal();
    return;
  }
  if (action === 'review-proof') {
    proofModal();
    return;
  }
  if (action === 'lock-payment') {
    if (busy) return;
    busy = true;
    try {
      await adapter.beginPayment(orderId, { outcome: lockOutcome });
    } finally {
      busy = false;
    }
    if (route === 'trade') navigate('trade');
    else render();
    return;
  }
  if (action === 'refund-expired') {
    adapter.refundExpired(orderId);
    render();
    return;
  }
  if (action === 'request-resolution') {
    orderId = button.dataset.id || orderId;
    const order = currentOrder();
    if (order.resolution) {
      closeModal();
      render();
      return;
    }
    openModal(
      `<h2 id="modal-title">Propose a resolution</h2><p>Choose how to allocate the reserved USDC. Ana and Ben must both approve the same proposal.</p><label class="settings-label" for="resolution-allocation">USDC allocation</label><select id="resolution-allocation"><option value="refund">Return all ${tokens(order.tokenAtoms)} USDC to Ben</option><option value="release">Release all ${tokens(order.tokenAtoms)} USDC to Ana</option><option value="split">Split equally between Ana and Ben</option></select><p class="small-note">A proposal or one approval does not move funds. Payment verification can still complete while agreement is pending.</p><button class="button primary" data-action="propose-resolution">Propose allocation</button>`,
    );
    return;
  }
  if (action === 'propose-resolution') {
    const choice = document.querySelector('#resolution-allocation').value;
    const atoms =
      choice === 'refund'
        ? 0
        : choice === 'release'
          ? currentOrder().tokenAtoms
          : Math.floor(currentOrder().tokenAtoms / 2);
    adapter.proposeResolution(orderId, atoms);
    closeModal();
    render();
    return;
  }
  if (action === 'review-resolution') {
    orderId = button.dataset.id;
    const order = currentOrder();
    const party = button.dataset.party;
    openModal(
      `<h2 id="modal-title">Review ${party === 'buyer' ? 'Ana’s' : 'Ben’s'} approval</h2><div class="disclosure">${row('Trade', esc(order.id))}${row('Ana receives', tokens(order.resolution.buyerAtoms) + ' USDC')}${row('Ben receives back', tokens(order.tokenAtoms - order.resolution.buyerAtoms) + ' USDC')}</div><p class="small-note">Approve this exact allocation with this participant’s demo wallet. Both approvals are required before confirmation.</p><button class="button primary" data-action="approve-resolution" data-party="${party}" data-proposal="${esc(order.resolution.id)}">Approve with ${party === 'buyer' ? 'Ana’s' : 'Ben’s'} demo wallet</button>`,
    );
    return;
  }
  if (action === 'approve-resolution') {
    adapter.approveResolution(orderId, button.dataset.proposal, button.dataset.party);
    closeModal();
    render();
    return;
  }
  if (action === 'confirm-resolution') {
    orderId = button.dataset.id;
    adapter.resolveAgreement(orderId);
    navigate('trade');
    return;
  }
  if (action === 'verify') {
    if (busy || !document.querySelector('#proof-consent')?.checked) return;
    closeModal();
    busy = true;
    try {
      await adapter.verify(orderId, {
        outcome,
        onProgress: (label) => {
          progress = label;
          const element = document.querySelector('#proof-progress');
          if (element) element.textContent = label;
        },
      });
    } finally {
      busy = false;
    }
    if (route === 'trade') navigate('trade');
    else render();
    return;
  }
  if (action === 'settle') {
    if (busy) return;
    busy = true;
    try {
      await adapter.settle(orderId);
    } finally {
      busy = false;
    }
    if (route === 'trade') navigate('trade');
    else render();
    return;
  }
  if (action === 'receipt-details') {
    const order = currentOrder();
    openModal(
      `<span class="status-symbol">${icon('check')}</span><h2 id="modal-title">Demo settlement</h2><p>Your sample exchange is complete.</p><div class="disclosure">${row('Reference', esc(order.id))}${row('Received', tokens(order.tokenAtoms) + ' USDC')}${row('Network shown', 'Stellar testnet')}${row('Transaction', 'Simulated · no transaction hash')}</div><p class="small-note">A connected app will show the confirmed Stellar transaction here. This demo has no explorer link.</p><button class="button primary" data-action="close-modal">Back to receipt</button>`,
    );
    return;
  }
  if (action === 'settings') {
    openModal(
      `<h2 id="modal-title">Try the different paths</h2><p>Choose the outcome of the next demo payment check.</p><label class="settings-label" for="demo-lock">Payment lock outcome</label><select id="demo-lock"><option value="success" ${lockOutcome === 'success' ? 'selected' : ''}>Lock confirms</option><option value="unavailable" ${lockOutcome === 'unavailable' ? 'selected' : ''}>Lock unavailable</option></select><label class="settings-label" for="demo-outcome">Verification outcome</label><select id="demo-outcome"><option value="success" ${outcome === 'success' ? 'selected' : ''}>Payment matches</option><option value="unavailable" ${outcome === 'unavailable' ? 'selected' : ''}>Verification temporarily unavailable</option><option value="mismatch" ${outcome === 'mismatch' ? 'selected' : ''}>Payment details don’t match</option></select><p class="small-note">Every path uses fictional offers and local sample data. No bank, wallet or escrow service is connected.${adapter.persists() ? '' : ' Browser storage is unavailable; this session will not persist.'}</p><button class="button primary" data-action="save-settings">Save settings</button><button class="text-button reset-demo" data-action="reset-request" ${busy ? 'disabled' : ''}>Reset demo trades and wallet</button>`,
    );
    return;
  }
  if (action === 'save-settings') {
    outcome = document.querySelector('#demo-outcome').value;
    lockOutcome = document.querySelector('#demo-lock').value;
    closeModal();
    toast('Demo settings saved.');
    return;
  }
  if (action === 'reset-request') {
    openModal(
      '<h2 id="modal-title">Start fresh?</h2><p>This clears the sample trades and demo wallet in this browser.</p><button class="button primary" data-action="reset-confirm">Reset demo</button><button class="button secondary" data-action="close-modal">Keep my trades</button>',
    );
    return;
  }
  if (action === 'reset-confirm') {
    if (busy) return;
    adapter.reset();
    selectedOffer = 'ben';
    amount = '20.00';
    sellAmount = '22.00';
    sellerTag = '@ben';
    outcome = 'success';
    lockOutcome = 'success';
    orderId = undefined;
    closeModal();
    navigate('buy');
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  event.preventDefault();
  Promise.resolve()
    .then(() => handleAction(button))
    .catch((error) => {
      toast(error.message);
    });
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'pay-amount') {
    amount = event.target.value;
    updateQuote();
  }
  if (event.target.id === 'seller-amount') {
    sellAmount = event.target.value;
    updateSellerQuote();
  }
  if (event.target.id === 'seller-tag') sellerTag = event.target.value;
  if (event.target.id === 'proof-consent')
    document.querySelector('#start-proof').disabled = !event.target.checked;
});
document.addEventListener('submit', (event) => {
  if (event.target.id === 'seller-form') {
    event.preventDefault();
    try {
      sellerQuote(sellAmount);
      if (!state.seller.wallet) walletModal('seller-create');
      else {
        adapter.createSellerOffer(sellAmount, sellerTag);
        navigate('sell');
      }
    } catch (error) {
      document.querySelector('#seller-error').textContent = error.message;
    }
    return;
  }
  if (event.target.id !== 'quote-form') return;
  event.preventDefault();
  try {
    reserve();
  } catch (error) {
    toast(error.message);
  }
});
adapter.subscribe(() => render());
setInterval(() => {
  const order = currentOrder();
  const element = document.querySelector('[data-countdown]');
  if (element && order) {
    element.innerHTML = remaining(order);
    if (Date.now() >= order.expiresAt && ['reserved', 'paying'].includes(order.status)) render();
  }
}, 1000);
render();
