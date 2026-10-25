import { createHostClient } from './host-client.mjs';
import {
  createLiveViewAdapter,
  formatUnits,
  friendlyError,
  parseTokenUnits,
} from './live-view-adapter.mjs';

const client = createHostClient();
const adapter = createLiveViewAdapter({ client });
const root = document.querySelector('#pactlane');
const toastElement = document.querySelector('#toast');
let route = 'buy',
  toastTimer,
  lastTemporalKey;
const recoveryDrafts = new Map();
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const short = (value) => (value ? `${value.slice(0, 6)}…${value.slice(-5)}` : 'Not connected');
const paths = {
  buy: '<path d="M18 6 6 18M6 7v11h11"/>',
  sell: '<path d="M6 18 18 6M6 6h12v12"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  wallet: '<path d="M19 7V4H6a3 3 0 0 0 0 6h15v10H6a3 3 0 0 1-3-3V7"/><path d="M16 13h5v4h-5z"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6m-6 4h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
const pill = (label, kind = 'neutral') => `<span class="pill ${kind}">${esc(label)}</span>`;
const row = (label, value) =>
  `<div class="detail-row"><span>${esc(label)}</span><strong>${value}</strong></div>`;
const euros = (value) => `€${formatUnits(value, 2)}`;
const tokenLabel = (state) => state.view?.deployment?.tokenLabel ?? 'Test token';
const temporalKey = (state) =>
  JSON.stringify([
    ...(state.view?.offers ?? []).map((value) => BigInt(state.now) >= BigInt(value.offerExpiresAt)),
    ...(state.view?.ownerOrders ?? []).map((value) => BigInt(state.now) >= BigInt(value.pay_by)),
    ...(state.view?.recoveryRequests ?? []).map(
      (value) => BigInt(state.now) * 1000n >= BigInt(value.expiresAt),
    ),
  ]);
const token = (value, state) => `${formatUnits(value)} ${esc(tokenLabel(state))}`;
const isBusy = (state) =>
  Boolean(state.pending) || ['loading', 'refreshing'].includes(state.status);
const enabled = (state, role, mutation = false) =>
  state.status === 'ready' &&
  state.view?.configured &&
  !state.pending &&
  (!role || state.roles.includes(role)) &&
  (!mutation || state.view.readiness.submission);
const button = (label, action, { disabled = false, id, secondary = false } = {}) =>
  `<button class="button ${secondary ? 'secondary' : 'primary'}" data-action="${action}" ${id !== undefined ? `data-id="${esc(id)}"` : ''} ${disabled ? 'disabled' : ''}>${label}</button>`;
const heading = (title, description, eyebrow = 'PEER-TO-PEER EXCHANGE') =>
  `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div></div>`;
const empty = (title, description, symbol = 'wallet', action = '') =>
  `<section class="panel live-empty"><span class="status-symbol neutral">${icon(symbol)}</span><h2>${title}</h2><p>${description}</p>${action}</section>`;
const connect = (state, role) =>
  button(`${state.account ? 'Use wallet' : 'Connect wallet'} ${icon('wallet')}`, 'connect', {
    id: role,
    disabled: isBusy(state) || !state.view?.configured,
  });

function howItWorks() {
  return `<aside class="panel live-info-panel"><h2>A clear path to settlement</h2><p>Each step follows the confirmed status of your trade.</p>
    <div class="live-step"><span>1</span><div><strong>Reserve a funded offer</strong><p>The seller’s tokens are already in escrow.</p></div></div>
    <div class="live-step"><span>2</span><div><strong>Lock before you pay</strong><p>Payment details appear only after the lock is confirmed.</p></div></div>
    <div class="live-step"><span>3</span><div><strong>Verify, then receive</strong><p>Payment verification authorizes release to your wallet.</p></div></div>
    <p class="small-note">Stellar testnet · test assets only</p></aside>`;
}

function market(state) {
  const view = state.view;
  const offer = view?.offers.find((value) => value.id === state.selectedOfferId);
  const available =
    view?.offers.filter((value) => BigInt(value.offerExpiresAt) > BigInt(state.now)) ?? [];
  const intro = heading(
    tokenLabel(state) === 'Test token' ? 'Buy test tokens' : `Buy ${esc(tokenLabel(state))}`,
    'Choose a whole offer. Pay in EUR with Revolut.',
  );
  if (!view?.configured)
    return (
      intro +
      `<div class="trade-layout">${empty('The exchange is getting ready', 'This testnet exchange is not configured yet. Funded offers will appear here when it is ready.', 'shield', button(`Refresh ${icon('refresh')}`, 'refresh', { disabled: isBusy(state), secondary: true }))}${howItWorks()}</div>`
    );
  if (!available.length)
    return (
      intro +
      `<div class="trade-layout">${empty('No funded offers yet', 'Once a seller funds an offer, you can reserve the full amount here. No payment is needed to browse.', 'buy', button(`View seller workspace ${icon('arrow')}`, 'sell', { secondary: true }))}${howItWorks()}</div>`
    );
  return (
    intro +
    `<div class="market-layout"><section class="offers-column" aria-labelledby="offers-title"><div class="filter-bar"><div class="filter"><span>You pay with</span><strong><span class="currency-disc">€</span> EUR</strong></div><div class="filter"><span>Payment method</span><strong><span class="revolut-mark">R</span> Revolut</strong></div></div><div class="section-title"><h2 id="offers-title">Funded offers <span>${available.length}</span></h2><span>Fixed whole offer</span></div><div class="offer-list">${available.map((value) => `<button class="offer ${value.id === state.selectedOfferId ? 'selected' : ''}" data-action="offer" data-id="${esc(value.id)}" aria-pressed="${value.id === state.selectedOfferId}"><span class="offer-top"><span class="person"><span class="avatar peach">${icon('wallet')}</span><span><strong>Seller ${esc(short(value.seller))}</strong><span>Revolut · EUR</span></span></span>${pill('Funded', 'green')}</span><span class="offer-rate"><strong>${formatUnits(value.tokenAmount)} <span>${esc(tokenLabel(state))}</span></strong><span class="select-circle">${value.id === state.selectedOfferId ? icon('check') : ''}</span></span><span class="offer-bottom"><span>Order ${esc(value.id)}</span><span>Exact payment ${euros(value.fiatMinor)}</span></span></button>`).join('')}</div><div class="how-it-works"><div>${icon('lock')}<span>Funded escrow</span></div><div>${icon('shield')}<span>Verified payment</span></div><div>${icon('wallet')}<span>Your wallet</span></div></div></section>
    <aside class="quote-panel panel"><div class="quote-heading"><h2>Your exchange</h2><span class="paired-mark" aria-hidden="true">↙↗</span></div>${offer ? `<div class="summary-amount"><span>You pay exactly</span><strong>${euros(offer.fiatMinor)}</strong></div><div class="quote-details">${row('You receive', token(offer.tokenAmount, state))}${row('Seller', esc(short(offer.seller)))}${row('Network', 'Stellar testnet')}${row('Pactlane fee', '€0.00')}</div>${state.roles.includes('buyer') ? button(`Reserve this offer ${icon('arrow')}`, 'reserve', { id: offer.id, disabled: !enabled(state, 'buyer', true) || offer.seller === state.account || BigInt(offer.offerExpiresAt) <= BigInt(state.now) }) : connect(state, 'buyer')}<p class="quote-footnote">${icon('lock')} No bank payment until the payment lock is confirmed.</p>` : '<p class="small-note">Select an offer to continue.</p>'}</aside></div>`
  );
}

function seller(state) {
  const drafts = state.view?.sellerDrafts ?? [];
  const own = state.view?.ownerOrders.filter((value) => value.terms.seller === state.account) ?? [];
  return (
    heading(
      'Sell your tokens',
      'Fund an approved offer and follow your trades from one place.',
      'SELLER WORKSPACE',
    ) +
    `<div class="trade-layout"><div class="live-drafts">${!state.account || !state.roles.includes('seller') ? empty('Connect your seller wallet', 'Use the wallet assigned to your approved offer. Funding always requires your wallet approval.', 'wallet', connect(state, 'seller')) : drafts.length ? drafts.map((draft) => `<section class="panel live-draft">${pill('Ready to fund', 'orange')}<h2>${token(draft.publicTerms.token_amount, state)}</h2>${row('Buyer pays exactly', euros(draft.publicTerms.fiat_minor))}${row('Payment method', 'Revolut · EUR')}${row('Seller wallet', esc(short(draft.publicTerms.seller)))}<div class="live-actions">${button(`Fund escrow ${icon('lock')}`, 'fund', { id: draft.id, disabled: !enabled(state, 'seller', true) })}</div><p class="small-note">Recipient details stay private until a buyer’s payment lock is confirmed.</p></section>`).join('') : empty('Your offers will appear here', 'There are no approved, unfunded offers for this wallet. Existing trades are listed below.', 'sell')}
    ${own.length ? `<section><div class="section-title"><h2>Your trades</h2><span>${own.length}</span></div>${orderList(own, state)}</section>` : ''}</div><aside class="panel live-info-panel"><h2>Your wallet</h2><div class="live-balance">${formatUnits(state.view?.balances?.tokenAtoms)}</div><p>${esc(tokenLabel(state))} on Stellar testnet</p>${row('Account', esc(short(state.account)))}${row('Balance', !state.view?.balances ? 'Unavailable' : state.status === 'ready' ? 'Confirmed read' : 'Last confirmed read')}<div class="escrow-note">${icon('shield')}<p>After payment is locked, funds stay held until verified release or an agreement authorized by both wallets.</p></div></aside></div>`
  );
}

const labels = {
  Funded: 'Funded',
  Reserved: 'Reserved',
  Paying: 'Payment locked',
  Released: 'Released',
  Refunded: 'Returned',
  Resolved: 'Resolved by agreement',
};
function orderList(orders, state) {
  return `<div class="trade-list">${orders.map((value) => `<button class="trade-list-item live-order panel" data-action="order" data-id="${esc(value.id)}"><span class="trade-list-icon">${icon('receipt')}</span><span class="trade-list-description"><strong>${token(value.terms.token_amount, state)}</strong><span>${euros(value.terms.fiat_minor)} · Order ${esc(value.id)}</span></span>${pill(labels[value.state], ['Released', 'Refunded', 'Resolved'].includes(value.state) ? 'green' : 'orange')}${icon('arrow')}</button>`).join('')}</div>`;
}
function trades(state) {
  const orders = state.view?.ownerOrders ?? [];
  return (
    heading('Your trades', 'Follow escrow status and confirmed transfer receipts.') +
    (orders.length
      ? orderList(orders, state)
      : empty(
          state.account ? 'No trades for this wallet' : 'Your trades, in one place',
          state.account
            ? 'Your funded and reserved trades will appear here.'
            : 'Connect your wallet to see your reservations, offers and receipts.',
          'receipt',
          state.account
            ? button(`Browse offers ${icon('arrow')}`, 'buy', { secondary: true })
            : connect(state, 'buyer'),
        ))
  );
}

function countdown(value, state) {
  const remaining = BigInt(value.pay_by) - BigInt(state.now);
  if (remaining <= 0n) return 'Payment window ended';
  return `${remaining / 60n}m ${(remaining % 60n).toString().padStart(2, '0')}s remaining`;
}
function receipt(value, state) {
  const proof = state.receipts[value.id];
  if (!proof)
    return `<section class="panel status-panel"><span class="status-symbol">${icon('check')}</span><h2>${esc(labels[value.state])} on chain</h2><p>The chain confirms this trade’s status. Load its transfer receipt to see the confirmed token amounts.</p>${button('Load transfer receipt', 'receipt', { id: value.id, disabled: !enabled(state) || !(state.transactions[value.id] ?? value.lastConfirmedTransaction) })}<p class="small-note">A receipt is shown only after its transaction and token transfers are checked.</p></section>`;
  const mine = value.buyer === state.account ? proof.buyerReceivedAtoms : proof.sellerReturnedAtoms;
  return `<section class="panel receipt-panel"><span class="status-symbol">${icon('check')}</span><p class="received-label">${mine === '0' ? 'Trade settled' : 'Transfer confirmed'}</p><div class="receipt-amount">${formatUnits(mine)} <span>${esc(tokenLabel(state))}</span></div><p class="small-note">${mine === '0' ? 'No tokens were sent to this wallet' : 'To your wallet on Stellar testnet'}</p><div class="live-receipt-grid">${row('Trade', esc(value.id))}${row('Outcome', esc(labels[value.state]))}${row('Buyer received', token(proof.buyerReceivedAtoms, state))}${row('Seller returned', token(proof.sellerReturnedAtoms, state))}${row('Transaction', esc(short(proof.transaction.hash)))}${row('Confirmed ledger', esc(proof.transaction.ledger))}</div>${button(`Back to your trades ${icon('arrow')}`, 'trades', { secondary: true })}</section>`;
}

function recoveryAmount(value, state) {
  const draft = recoveryDrafts.get(`${state.account}:${value.id}`) ?? '0';
  try {
    const buyerTokens = parseTokenUnits(draft);
    if (BigInt(buyerTokens) > BigInt(value.terms.token_amount)) return null;
    return {
      buyerTokens,
      sellerTokens: (BigInt(value.terms.token_amount) - BigInt(buyerTokens)).toString(),
    };
  } catch {
    return null;
  }
}

function recoveryPanel(value, state) {
  if (!['Reserved', 'Paying'].includes(value.state)) return '';
  if (!state.view.readiness.recovery)
    return `<section class="panel live-recovery"><h2>Agree a recovery together</h2><p>Recovery needs both wallets to approve the same token split. The two-wallet connection is not available for this exchange yet.</p></section>`;
  const request = state.view.recoveryRequests.find((item) => item.orderId === value.id);
  const notice = state.recoveryNotice?.orderId === value.id ? state.recoveryNotice : null;
  const buyer = value.buyer === state.account;
  const pending = state.pending?.action === 'resolve' && state.pending.args.orderId === value.id;
  const domain = `<details class="live-recovery-domain"><summary>Verify wallets and contracts</summary>${row('Buyer', `<code>${esc(value.buyer)}</code>`)}${row('Seller', `<code>${esc(value.terms.seller)}</code>`)}${row('Escrow contract', `<code>${esc(state.view.deployment.contract)}</code>`)}${row('Token contract', `<code>${esc(state.view.deployment.token)}</code>`)}</details>`;
  let content;
  if (request || pending) {
    const split = request ?? {
      buyerTokens: state.pending.args.buyerTokens,
      sellerTokens: (
        BigInt(value.terms.token_amount) - BigInt(state.pending.args.buyerTokens)
      ).toString(),
    };
    const expired = request && BigInt(state.now) * 1000n >= BigInt(request.expiresAt);
    const canReview = !buyer && request?.status === 'queued' && !expired;
    content = `${row('Total in escrow', token(value.terms.token_amount, state))}${row('Buyer receives', token(split.buyerTokens, state))}${row('Seller receives', token(split.sellerTokens, state))}${row('Network', 'Stellar testnet')}${domain}<p class="small-note">${expired ? 'This request expired. Funds remain in escrow.' : buyer ? 'Keep this page open. The seller must refresh this trade and approve the exact split. Your wallet will then ask you to confirm the final transaction.' : request.status === 'claimed' ? 'This request is already being reviewed. Refresh to see the confirmed result.' : 'Approve only if you agree to these exact amounts. Your signature authorizes this split; the buyer must then sign the final transaction.'}</p>${request ? `<p class="small-note">Authorization expires before ledger ${request.expirationLedger}.</p>` : ''}${canReview ? `<div class="live-actions">${state.roles.includes('seller') ? button('Approve exact split', 'recovery-approve', { id: request.requestId, disabled: !enabled(state, 'seller', true) }) + button('Decline proposal', 'recovery-reject', { id: request.requestId, disabled: !enabled(state, 'seller', true), secondary: true }) : connect(state, 'seller')}</div>` : ''}`;
  } else if (notice) {
    content = `<p>${notice.approved ? 'Your authorization was sent. The buyer must confirm the final transaction. Funds stay in escrow until it is confirmed.' : 'You declined this proposal. Funds remain in escrow.'}</p>${button('Refresh trade', 'refresh', { disabled: isBusy(state), secondary: true })}`;
  } else if (buyer) {
    const amount = recoveryAmount(value, state);
    content = `<p>Propose how to divide all ${token(value.terms.token_amount, state)}. The seller must approve the same split, then you confirm the final transaction.</p><label class="field-label" for="recovery-amount">Tokens to buyer</label><input id="recovery-amount" class="text-input" data-recovery-input data-id="${esc(value.id)}" inputmode="decimal" autocomplete="off" value="${esc(recoveryDrafts.get(`${state.account}:${value.id}`) ?? '0')}" ${isBusy(state) ? 'disabled' : ''} /><div class="live-recovery-preview" aria-live="polite">${amount ? `${row('Buyer receives', token(amount.buyerTokens, state))}${row('Seller receives', token(amount.sellerTokens, state))}` : '<p class="field-error">Enter an amount within the escrow, with up to seven decimal places.</p>'}</div>${domain}<div class="live-actions">${state.roles.includes('buyer') ? button('Propose split to seller', 'recovery-propose', { id: value.id, disabled: !enabled(state, 'buyer', true) || !amount }) : connect(state, 'buyer')}</div><p class="small-note">A proposal does not move funds. Both wallets must approve.</p>`;
  } else {
    content = `<p>The buyer can propose a token split. Refresh this trade to review it before approving with your wallet.</p>${button('Check for a proposal', 'refresh', { disabled: isBusy(state), secondary: true })}`;
  }
  return `<section class="panel live-recovery"><div class="section-title"><h2>Agree a recovery together</h2>${pill('Both wallets')}</div>${content}</section>`;
}

function trade(state) {
  const value = state.view?.ownerOrders.find((item) => item.id === state.selectedOrderId);
  if (!value) return trades(state);
  const buyer = value.buyer === state.account;
  const expired = BigInt(state.now) >= BigInt(value.pay_by);
  const policy = state.policy?.orderId === value.id ? state.policy : null;
  const paymentReady = state.view.readiness.paymentProof;
  let content;
  if (['Released', 'Refunded', 'Resolved'].includes(value.state)) content = receipt(value, state);
  else if (value.state === 'Funded')
    content = `<section class="panel status-panel"><span class="status-symbol">${icon('shield')}</span><h2>Your offer is funded</h2><p>The tokens are held in escrow. A buyer can now reserve this whole offer.</p>${button(`Browse the marketplace ${icon('arrow')}`, 'buy', { secondary: true })}</section>`;
  else if (value.state === 'Reserved')
    content = `<section class="panel status-panel"><span class="status-symbol neutral">${icon('lock')}</span><h2>${expired ? 'Reservation expired' : buyer ? 'Your tokens are reserved' : 'A buyer has reserved your offer'}</h2><p>${expired ? 'The payment lock was never confirmed. The reservation can be returned through the contract.' : buyer ? 'Confirm the payment lock before sending any bank payment. The recipient details stay hidden until confirmation.' : 'The tokens remain in escrow while the buyer prepares their payment.'}</p>${!expired && !paymentReady ? `<div class="important-note"><strong>Payment verification is unavailable</strong><span>Do not send a bank payment. The payment step stays closed until verification is ready.</span></div>` : ''}<div class="live-actions">${expired ? button('Return expired reservation', 'refund', { id: value.id, disabled: !enabled(state, buyer ? 'buyer' : 'seller', true) }) : buyer ? (state.roles.includes('buyer') ? button(`Confirm payment lock ${icon('lock')}`, 'lock', { id: value.id, disabled: !enabled(state, 'buyer', true) || !paymentReady }) : connect(state, 'buyer')) : button(`Refresh status ${icon('refresh')}`, 'refresh', { secondary: true, disabled: isBusy(state) })}</div></section>`;
  else {
    const destination =
      state.instructions?.orderId === value.id ? state.instructions.destination : null;
    content = `<section class="panel payment-panel status-panel"><div class="section-title"><h2>${policy?.status === 'verified' ? 'Payment verified' : destination ? 'Send your exact payment' : 'Your escrow is held'}</h2>${pill(policy?.status === 'verified' ? 'Verified' : 'Locked', policy?.status === 'verified' ? 'green' : 'neutral')}</div><p>${policy?.status === 'verified' ? 'The payment service accepted your transfer for this trade. Confirm the release to receive tokens in your wallet.' : !paymentReady ? 'Payment verification is unavailable. Funds remain in escrow; there is no automatic timeout refund after the payment lock.' : expired ? 'The payment window has ended. If you already paid within the window, verification can still finish. Do not send another payment.' : 'The payment lock is confirmed. Only the matching payment can authorize release.'}</p>${destination ? `<div class="payment-amount">${euros(value.terms.fiat_minor)} <span>exact amount</span></div><div class="recipient-card"><span class="avatar peach"><span class="revolut-mark">R</span></span><span><strong>Verified payment destination</strong><span class="live-recipient">${esc(destination)}</span></span></div><p class="payment-note">Use these details for this trade only. Complete payment verification after sending.</p>` : ''}${!paymentReady && !policy ? `<div class="important-note"><strong>Do not send a new bank payment</strong><span>Wait until payment verification is available. If you already paid, keep the trade open and check its status.</span></div>` : ''}${policy && policy.status !== 'verified' ? `<div class="important-note"><strong>${policy.status === 'pending' ? 'Verification is still pending' : policy.status === 'rejected' ? 'This payment was not accepted' : 'Verification is unavailable'}</strong><span>Your tokens remain in escrow. A status update cannot release them by itself.</span></div>` : ''}<div class="live-actions">${buyer ? (!state.roles.includes('buyer') ? connect(state, 'buyer') : policy?.status === 'verified' ? button(`Receive ${esc(tokenLabel(state))} ${icon('wallet')}`, 'release', { id: value.id, disabled: !enabled(state, 'buyer', true) }) : `${paymentReady && !expired && !destination ? button('Show payment details', 'instructions', { id: value.id, disabled: !enabled(state, 'buyer'), secondary: true }) : ''}${button('Check payment verification', 'verify', { id: value.id, disabled: !enabled(state, 'buyer') })}`) : button(`Refresh status ${icon('refresh')}`, 'refresh', { secondary: true, disabled: isBusy(state) })}</div></section>`;
  }
  return `<button class="text-button live-nav-back" data-action="trades">← Your trades</button>${heading(`Trade ${esc(value.id)}`, `${euros(value.terms.fiat_minor)} · Revolut · Stellar testnet`, buyer ? 'BUYER WORKSPACE' : 'SELLER WORKSPACE')}<div class="trade-layout"><div class="live-trade-primary">${content}${recoveryPanel(value, state)}</div><aside class="panel live-info-panel"><h2>Trade details</h2>${row('Escrow amount', token(value.terms.token_amount, state))}${row('Exact EUR payment', euros(value.terms.fiat_minor))}${row('Seller', esc(short(value.terms.seller)))}${row('Buyer', esc(short(value.buyer)))}${row('Status', esc(labels[value.state]))}${['Reserved', 'Paying'].includes(value.state) ? `<div class="detail-row"><span>Payment window</span><strong data-countdown="${esc(value.id)}">${countdown(value, state)}</strong></div>` : ''}<div class="escrow-note">${icon('shield')}<p>${value.state === 'Paying' ? 'Recovery requires agreement from both wallets. A failed proof does not return funds automatically.' : 'Your wallet approves transactions. Balances and receipts come from confirmed chain data.'}</p></div></aside></div>`;
}

function render() {
  const state = adapter.snapshot();
  lastTemporalKey = temporalKey(state);
  const active = document.activeElement;
  const focus = active?.dataset?.action
    ? { action: active.dataset.action, id: active.dataset.id }
    : null;
  const currentRole = route === 'sell' ? 'seller' : 'buyer';
  const progress = state.pending
    ? `<div class="live-progress" role="status"><div class="progress-line">${state.pending.status === 'unknown' ? icon('clock') : '<span class="spinner" aria-hidden="true"></span>'}<span>${state.pending.status === 'unknown' ? 'Confirmation pending. Your transaction may still complete.' : state.pending.status === 'wallet' ? 'Confirm the request in your wallet.' : 'Waiting for the exchange to confirm this operation.'}</span></div>${state.pending.status === 'unknown' && state.pending.operationId ? `<div class="live-actions">${button('Check pending operation', 'resume', { secondary: true })}</div>` : ''}</div>`
    : '';
  const alert = state.error
    ? `<div class="live-alert" role="alert">${icon('info')}<div><strong>${state.error.outcome === 'unknown' ? 'Keep this trade open' : 'This step needs attention'}</strong><p>${esc(state.error.message)}</p></div></div>`
    : '';
  const unavailable =
    state.view?.configured && !state.view.readiness.submission
      ? `<div class="live-alert">${icon('info')}<div><strong>Transactions are not enabled yet</strong><p>You can connect your wallet and inspect trades. Funding and settlement stay unavailable until the exchange is ready.</p></div></div>`
      : '';
  const body =
    state.status === 'loading' && !state.view
      ? `${heading('Your exchange, with confidence', 'Reading the current state of Pactlane.')}<section class="panel live-empty" role="status"><span class="spinner" aria-hidden="true"></span><p>Connecting to the exchange…</p></section>`
      : route === 'sell'
        ? seller(state)
        : route === 'trades'
          ? trades(state)
          : route === 'trade'
            ? trade(state)
            : market(state);
  root.setAttribute(
    'aria-busy',
    String(state.status === 'loading' || state.status === 'refreshing'),
  );
  root.innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="wordmark" href="/" aria-label="Pactlane home"><span class="brand-symbol" aria-hidden="true"><span></span><span></span></span>Pactlane<span class="brand-dot">.</span></a><p class="nav-label">YOUR EXCHANGE</p><nav aria-label="Main navigation"><button class="nav-item ${route === 'buy' ? 'active' : ''}" data-action="buy">${icon('buy')} Buy tokens</button><button class="nav-item ${route === 'sell' ? 'active' : ''}" data-action="sell">${icon('sell')} Sell tokens</button><button class="nav-item ${['trades', 'trade'].includes(route) ? 'active' : ''}" data-action="trades">${icon('receipt')} Your trades <span class="nav-count">${state.view?.ownerOrders.length ?? 0}</span></button></nav><div class="sidebar-bottom"><div class="network-badge"><span class="network-dot"></span>Stellar testnet</div><p>Make a pact.<br />Move forward.</p><span class="sidebar-caption">Payment proof. Clear settlement.</span></div></aside><div class="workspace"><header class="app-header"><span class="header-location">Exchange / ${route === 'sell' ? 'Sell' : ['trades', 'trade'].includes(route) ? 'Your trades' : 'Buy'}</span><div class="header-actions"><span class="live-header-role">Test assets only</span><button class="icon-button" data-action="refresh" aria-label="Refresh confirmed status" ${isBusy(state) ? 'disabled' : ''}>${icon('refresh')}</button>${state.account ? `<span class="wallet-button live-account">${icon('wallet')}${esc(short(state.account))}</span><button class="icon-button" data-action="logout" aria-label="Disconnect wallet">${icon('close')}</button>` : `<button class="wallet-button" data-action="connect" data-id="${currentRole}" ${isBusy(state) || !state.view?.configured ? 'disabled' : ''}>${icon('wallet')} Connect wallet</button>`}</div></header><main id="main" tabindex="-1">${alert}${progress}${unavailable}${body}</main><footer class="app-footer"><span>Built for a clearer exchange.</span><span>Stellar testnet · confirmed transactions only</span></footer></div></div>`;
  if (focus)
    [...root.querySelectorAll('[data-action]')]
      .find(
        (element) =>
          element.dataset.action === focus.action &&
          element.dataset.id === focus.id &&
          !element.disabled,
      )
      ?.focus({ preventScroll: true });
}

function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove('visible'), 6000);
}
async function action(name, id) {
  try {
    if (['buy', 'sell', 'trades'].includes(name)) {
      route = name;
      render();
      return;
    }
    if (name === 'offer') {
      adapter.selectOffer(id);
      return;
    }
    if (name === 'order') {
      route = 'trade';
      adapter.selectOrder(id);
      return;
    }
    if (name === 'connect') await adapter.connect(id);
    else if (name === 'refresh') await adapter.refresh();
    else if (name === 'logout') {
      recoveryDrafts.clear();
      await adapter.logout();
    } else if (name === 'reserve') {
      await adapter.reserve(id);
      route = 'trade';
    } else if (name === 'fund') {
      await adapter.fund(id);
      route = 'trade';
    } else if (name === 'lock') await adapter.beginPayment(id);
    else if (name === 'instructions') await adapter.showInstructions(id);
    else if (name === 'verify') await adapter.checkVerification(id);
    else if (name === 'release') await adapter.release(id);
    else if (name === 'refund') await adapter.refund(id);
    else if (name === 'receipt') await adapter.loadReceipt(id);
    else if (name === 'recovery-propose') {
      const value = adapter.snapshot().view.ownerOrders.find((item) => item.id === id);
      const amount = recoveryAmount(value, adapter.snapshot());
      if (!amount) throw { code: 'INVALID_RESOLUTION_SPLIT' };
      await adapter.proposeRecovery(id, amount.buyerTokens);
    } else if (name === 'recovery-approve') await adapter.approveRecovery(id);
    else if (name === 'recovery-reject') await adapter.rejectRecovery(id);
    else if (name === 'resume') await adapter.resumePending();
    render();
  } catch (error) {
    toast(friendlyError(error));
    render();
  }
}
root.addEventListener('input', (event) => {
  if (!event.target.matches('[data-recovery-input]')) return;
  const state = adapter.snapshot();
  const value = state.view.ownerOrders.find((item) => item.id === event.target.dataset.id);
  recoveryDrafts.set(`${state.account}:${value.id}`, event.target.value);
  const amount = recoveryAmount(value, state);
  root.querySelector('.live-recovery-preview').innerHTML = amount
    ? `${row('Buyer receives', token(amount.buyerTokens, state))}${row('Seller receives', token(amount.sellerTokens, state))}`
    : '<p class="field-error">Enter an amount within the escrow, with up to seven decimal places.</p>';
  const submit = root.querySelector('[data-action="recovery-propose"]');
  if (submit) submit.disabled = !amount || !enabled(state, 'buyer', true);
});
root.addEventListener('click', (event) => {
  const target = event.target.closest('button[data-action]');
  if (target && !target.disabled) void action(target.dataset.action, target.dataset.id);
});
adapter.subscribe(render);
render();
void adapter.initialize();
setInterval(() => {
  const state = adapter.snapshot();
  if (temporalKey(state) !== lastTemporalKey) {
    render();
    return;
  }
  const recipient = root.querySelector('.live-recipient');
  if (recipient && !state.instructions) {
    render();
    return;
  }
  for (const element of root.querySelectorAll('[data-countdown]')) {
    const value = state.view?.ownerOrders.find((item) => item.id === element.dataset.countdown);
    if (value) element.textContent = countdown(value, state);
  }
}, 1000);
