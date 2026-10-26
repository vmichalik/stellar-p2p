import { readRecoveryRequest, readDeployment, readDeploymentDomain } from './host-client.mjs';

const STATES = new Set(['Funded', 'Reserved', 'Paying', 'Released', 'Refunded', 'Resolved']);
const TERMINAL = new Set(['Released', 'Refunded', 'Resolved']);
const MUTATIONS = new Set([
  'fund',
  'reserve',
  'beginPayment',
  'release',
  'refundExpiredReservation',
  'resolve',
]);
const check = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};
const integer = (value, bits = 127) => {
  check(
    typeof value === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(value) &&
      value.length <= 39 &&
      BigInt(value) < 1n << BigInt(bits),
    'INVALID_HOST_RESPONSE',
  );
  return value;
};
const account = (value) => {
  check(typeof value === 'string' && /^G[A-Z2-7]{55}$/.test(value), 'INVALID_HOST_RESPONSE');
  return value;
};
const contract = (value) => {
  check(typeof value === 'string' && /^C[A-Z2-7]{55}$/.test(value), 'INVALID_HOST_RESPONSE');
  return value;
};
const bytes32 = (value) => {
  check(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'INVALID_HOST_RESPONSE');
  return value;
};
const terms = (value) => {
  check(value?.currency === 'EUR' && value?.rail === 'revolut', 'INVALID_HOST_RESPONSE');
  const result = {
    seller: account(value.seller),
    token_amount: integer(value.token_amount),
    fiat_minor: integer(value.fiat_minor),
    currency: 'EUR',
    rail: 'revolut',
    recipient: bytes32(value.recipient),
    offer_expires_at: integer(value.offer_expires_at, 64),
    reservation_seconds: integer(value.reservation_seconds, 64),
  };
  check(
    BigInt(result.token_amount) > 0n && BigInt(result.fiat_minor) > 0n,
    'INVALID_HOST_RESPONSE',
  );
  return result;
};
const order = (value) => {
  check(STATES.has(value?.state), 'INVALID_HOST_RESPONSE');
  return {
    id: integer(value.id, 64),
    state: value.state,
    terms: terms(value.terms),
    buyer: value.buyer === null ? null : account(value.buyer),
    reserved_at: integer(value.reserved_at, 64),
    pay_by: integer(value.pay_by, 64),
    locked_at: integer(value.locked_at, 64),
  };
};
const transaction = (value, deployment) => {
  check(
    deployment &&
      value?.status === 'confirmed' &&
      value.networkPassphrase === deployment.networkPassphrase &&
      value.contract === deployment.contract,
    'UNCONFIRMED_TRANSACTION',
  );
  return {
    hash: bytes32(value.hash),
    networkPassphrase: deployment.networkPassphrase,
    contract: value.contract,
    ledger: integer(value.ledger, 64),
    status: 'confirmed',
  };
};

export function formatUnits(value, decimals = 7, minimumDecimals = 2) {
  if (value === null || value === undefined) return '—';
  integer(value);
  check(
    Number.isInteger(decimals) &&
      decimals >= 0 &&
      decimals <= 18 &&
      minimumDecimals >= 0 &&
      minimumDecimals <= decimals,
    'INVALID_DISPLAY_DECIMALS',
  );
  const padded = value.padStart(decimals + 1, '0');
  const whole = (decimals ? padded.slice(0, -decimals) : padded).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ',',
  );
  const fraction = (decimals ? padded.slice(-decimals) : '')
    .replace(/0+$/, '')
    .padEnd(minimumDecimals, '0');
  return whole + (fraction ? '.' + fraction : '');
}

export function parseTokenUnits(value) {
  check(
    typeof value === 'string' &&
      /^(0|[1-9][0-9]*)(?:\.[0-9]{1,7})?$/.test(value) &&
      value.length <= 40,
    'INVALID_RESOLUTION_SPLIT',
  );
  const [whole, fraction = ''] = value.split('.');
  const atoms = BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'));
  check(atoms < 1n << 127n, 'INVALID_RESOLUTION_SPLIT');
  return atoms.toString();
}

export function friendlyError(error) {
  if (error?.code === 'RECOVERY_RESPONSE_UNKNOWN')
    return 'Seller approval could not be confirmed. Refresh the trade before doing anything else; do not sign this request again.';
  if (error?.outcome === 'unknown')
    return 'Confirmation is still pending. Check this operation before starting another; closing the wallet does not cancel a submitted transaction.';
  const messages = {
    DEPLOYMENT_NOT_CONFIGURED: 'The exchange is unavailable right now. Please try again shortly.',
    HOST_NOT_CONFIGURED: 'The exchange is unavailable right now. Please try again shortly.',
    DEPLOYMENT_UNAVAILABLE:
      'The exchange is unavailable. No transaction was submitted; refresh before trying again.',
    WALLET_REJECTED:
      'Wallet approval was declined. No transaction was submitted; you can try again when ready.',
    TRANSACTION_PREPARATION_RETRYABLE:
      'The transaction could not be prepared. Nothing was submitted; refresh before trying again.',
    OFFER_NOT_APPROVED: 'This offer is no longer available for this wallet.',
    CATALOG_LIMIT: 'The exchange cannot accept another offer right now.',
    RECOVERY_UNAVAILABLE: 'Both-wallet recovery is not available for this trade yet.',
    RECOVERY_REQUEST_INVALID:
      'The recovery terms could not be verified. Refresh before continuing.',
    RECOVERY_REQUEST_CHANGED:
      'The recovery terms changed. Refresh and review the new request before signing.',
    RECOVERY_EXPIRED: 'This recovery request expired. Funds remain in escrow.',
    RECOVERY_REQUEST_EXPIRED: 'This recovery request expired. Funds remain in escrow.',
    RECOVERY_SESSION_INVALID:
      'The wallet session for recovery ended. Reconnect and refresh the trade.',
    RECOVERY_ALREADY_CLAIMED:
      'This recovery request is already being reviewed. Refresh its status.',
    RECOVERY_REQUEST_MISMATCH:
      'The recovery terms could not be verified. Refresh before continuing.',
    RECOVERY_SIGNATURE_INVALID:
      'The recovery signature could not be verified. Funds remain in escrow.',
    RECOVERY_CAPACITY: 'The exchange cannot accept another recovery request right now.',
    RECOVERY_ARGUMENT_INVALID:
      'The recovery terms could not be verified. Refresh before continuing.',
    RECOVERY_CLOSED:
      'Recovery is unavailable while the exchange reconnects. Funds remain in escrow.',
    RECOVERY_REJECTED: 'The recovery proposal was declined. Funds remain in escrow.',
    RECOVERY_REQUEST_ALREADY_CLAIMED:
      'This recovery request is already being reviewed. Refresh its status.',
    INVALID_RESOLUTION_SPLIT:
      'Enter a token amount between zero and the full escrow, with up to seven decimal places.',
    RESOLUTION_NOT_AVAILABLE:
      'This trade no longer supports this recovery proposal. Refresh its status.',
    CONNECT_WALLET_FIRST: 'Connect your wallet for this side of the trade first.',
    OPERATION_PENDING: 'Finish checking the pending operation before starting another.',
    RECEIVING_ACCOUNT_MISSING:
      'The receiving Stellar account does not exist yet. Set up that account before retrying.',
    RECEIVING_TRUSTLINE_MISSING:
      'The receiving wallet needs a trustline for this exact asset before retrying.',
    RECEIVING_ASSET_UNAUTHORIZED:
      'The issuer has not authorized this receiving trustline. Resolve that before retrying.',
    RECEIVING_CAPACITY_INSUFFICIENT:
      'The receiving trustline cannot hold this amount. Check its limit before retrying.',
    RECEIVING_READ_STALE: 'The receiving-wallet check is stale. Refresh and retry.',
    RECEIVING_READ_UNAVAILABLE:
      'The receiving wallet could not be checked. Refresh and retry when the network read is available.',
    RECEIVING_ACCOUNT_INVALID:
      'The receiving account could not be validated. Refresh before retrying.',
    RECEIVING_ASSET_MISMATCH:
      'The receiving trustline does not match the configured asset. Check the asset code and issuer.',
    RECEIVING_LEDGER_MISMATCH:
      'The receiving-wallet reads disagree on the ledger. Refresh before retrying.',
    RECEIVING_CAPACITY_INVALID:
      'The receiving trustline capacity could not be validated. Refresh before retrying.',
    ISSUER_ACCOUNT_UNSUPPORTED:
      'An issuer account is not supported as the receiving wallet for this trade.',
    ASSET_IDENTITY_REQUIRED:
      'This exchange needs an exact asset code and issuer before transactions can proceed.',
    TESTNET_SUBMISSION_NOT_AUTHORIZED: 'Transactions are not enabled for this exchange yet.',
    MAINNET_SUBMISSION_NOT_AUTHORIZED: 'Mainnet transactions are not enabled for this exchange.',
    SUBMISSION_NOT_AUTHORIZED: 'Transactions are not enabled for this exchange yet.',
    CLIENT_CHAIN_UNAVAILABLE:
      'The exchange could not verify its chain configuration. Refresh before continuing; reconcile any transaction already awaiting confirmation.',
    CLIENT_DEPLOYMENT_CHANGED:
      'The exchange network or asset changed. Disconnect and review the new configuration before reconnecting.',
    DEPLOYMENT_CHANGED:
      'The exchange configuration changed. Disconnect and reconnect before continuing.',
    HOST_DEPLOYMENT_INVALID: 'The exchange network or asset configuration could not be verified.',
    PAYMENT_VERIFICATION_UNAVAILABLE:
      'Payment verification is unavailable. Keep your funds in escrow and do not send a bank payment yet.',
    PAYMENT_STATUS_UNAVAILABLE:
      'The payment check could not finish. No release transaction was submitted. Refresh and check payment verification again.',
    PAYMENT_INSTRUCTIONS_LOCKED:
      'Payment details are available only after a confirmed lock and before the payment deadline.',
    PAYMENT_DESTINATION_UNAVAILABLE:
      'The recipient details could not be verified. Do not send a payment.',
    PAYMENT_DESTINATION_BINDING_UNVERIFIED:
      'The recipient details could not be verified. Do not send a payment.',
    TLSN_PAYMENT_SCHEMA_UNVERIFIED: 'Payment verification is not ready. Your escrow remains held.',
    LIVE_POLICY_UNAVAILABLE: 'Payment verification is unavailable. Your escrow remains held.',
    WALLET_ACCOUNT_OR_NETWORK_CHANGED:
      'Your wallet changed. Reconnect the correct account on the configured Stellar network.',
    WALLET_NETWORK_MISMATCH:
      'Select the configured Stellar network in your wallet, then reconnect.',
    WALLET_UNAVAILABLE: 'Open Freighter on this device to connect your wallet.',
    RECEIPT_UNAVAILABLE:
      'The transfer receipt is not available yet. Refresh the trade to check again.',
    UNCONFIRMED_TRANSACTION:
      'The transaction has not been confirmed. Refresh your trade before continuing.',
    INVALID_HOST_RESPONSE: 'The exchange returned an unexpected result. Refresh before continuing.',
    SESSION_CHANGED: 'Your wallet session changed. Connect again before continuing.',
  };
  return (
    messages[error?.code] ??
    'This action could not be completed. Refresh your trade before trying again.'
  );
}

function cleanView(raw, expectedAccount) {
  check(
    raw &&
      typeof raw.configured === 'boolean' &&
      Array.isArray(raw.offers) &&
      Array.isArray(raw.ownerOrders) &&
      Array.isArray(raw.sellerDrafts),
    'INVALID_HOST_RESPONSE',
  );
  check((raw.account ?? null) === expectedAccount, 'SESSION_CHANGED');
  const deployment = raw.configured ? readDeployment(raw.deployment) : null;
  check(raw.configured || raw.deployment === null, 'INVALID_HOST_RESPONSE');
  const ownerOrders = raw.ownerOrders.map((value) => {
    const result = order(value);
    check(
      expectedAccount && [result.buyer, result.terms.seller].includes(expectedAccount),
      'SESSION_CHANGED',
    );
    if (value.lastConfirmedTransaction)
      result.lastConfirmedTransaction = transaction(value.lastConfirmedTransaction, deployment);
    return result;
  });
  const offers = raw.offers.map((value) => {
    check(value.currency === 'EUR' && value.rail === 'revolut', 'INVALID_HOST_RESPONSE');
    return {
      id: integer(value.id, 64),
      seller: account(value.seller),
      tokenAmount: integer(value.tokenAmount),
      fiatMinor: integer(value.fiatMinor),
      currency: 'EUR',
      rail: 'revolut',
      offerExpiresAt: integer(value.offerExpiresAt, 64),
      recipientCommitment: bytes32(value.recipientCommitment),
    };
  });
  const sellerDrafts = raw.sellerDrafts.map((value) => {
    check(
      typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128,
      'INVALID_HOST_RESPONSE',
    );
    const publicTerms = terms(value.publicTerms);
    check(publicTerms.seller === expectedAccount, 'SESSION_CHANGED');
    return { id: value.id, publicTerms };
  });
  const recoveryRequests = (raw.recoveryRequests ?? []).map((value) => {
    const request = readRecoveryRequest(value, deployment);
    const existing = ownerOrders.find((entry) => entry.id === request.orderId);
    check(
      existing &&
        [request.buyer, request.seller].includes(expectedAccount) &&
        request.networkPassphrase === deployment?.networkPassphrase &&
        request.contract === deployment.contract &&
        request.token === deployment.token &&
        request.orderState === existing.state &&
        request.buyer === existing.buyer &&
        request.seller === existing.terms.seller &&
        request.tokenAmount === existing.terms.token_amount &&
        request.fiatMinor === existing.terms.fiat_minor,
      'RECOVERY_REQUEST_INVALID',
    );
    return request;
  });
  check(
    new Set(ownerOrders.map((value) => value.id)).size === ownerOrders.length &&
      new Set(offers.map((value) => value.id)).size === offers.length,
    'INVALID_HOST_RESPONSE',
  );
  return {
    configured: raw.configured,
    deployment,
    account: expectedAccount,
    offers,
    ownerOrders,
    sellerDrafts,
    recoveryRequests,
    serverTime: integer(raw.serverTime, 64),
    balances:
      raw.balances?.tokenAtoms != null ? { tokenAtoms: integer(raw.balances.tokenAtoms) } : null,
    readiness: {
      submission: raw.readiness?.submission === true,
      paymentProof: raw.readiness?.paymentProof === true,
      recovery: raw.readiness?.recovery === true,
    },
    unavailableReasons: Array.isArray(raw.unavailableReasons)
      ? raw.unavailableReasons.filter((value) => typeof value === 'string')
      : [],
  };
}

/** Browser state is a view of confirmed service data. No demo state reducer,
 * local balance arithmetic, payment claims or persisted recipient details. */
export function createLiveViewAdapter({ client, clock = () => Date.now() }) {
  let epoch = 0,
    readVersion = 0,
    readAt = clock(),
    sessionDeployment = null;
  let state = {
    status: 'loading',
    account: null,
    roles: [],
    selectedOfferId: null,
    selectedOrderId: null,
    view: null,
    pending: null,
    error: null,
    instructions: null,
    policy: null,
    transactions: {},
    receipts: {},
    recoveryNotice: null,
    recoverySplits: {},
  };
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const now = () =>
    state.view
      ? BigInt(state.view.serverTime) + BigInt(Math.max(0, Math.floor((clock() - readAt) / 1000)))
      : 0n;
  const currentOrder = (id) => state.view?.ownerOrders.find((value) => value.id === id);
  const ready = (party, mutation = false) => {
    check(state.view?.configured, 'DEPLOYMENT_NOT_CONFIGURED');
    check(state.status === 'ready', 'INVALID_HOST_RESPONSE');
    if (party) check(state.account && state.roles.includes(party), 'CONNECT_WALLET_FIRST');
    if (mutation)
      check(
        state.view.readiness.submission,
        state.view.deployment.network === 'mainnet'
          ? 'MAINNET_SUBMISSION_NOT_AUTHORIZED'
          : 'TESTNET_SUBMISSION_NOT_AUTHORIZED',
      );
  };
  const mayInstruct = (id) => {
    const value = currentOrder(id);
    return (
      state.view?.readiness.paymentProof &&
      value?.state === 'Paying' &&
      value.buyer === state.account &&
      BigInt(value.locked_at) > 0n &&
      now() < BigInt(value.pay_by)
    );
  };
  const fail = (error) => {
    state.error = {
      code: error?.code ?? 'SERVICE_UNAVAILABLE',
      message: friendlyError(error),
      outcome: error?.outcome ?? 'failed',
    };
    emit();
  };

  async function refresh() {
    const generation = epoch,
      version = ++readVersion;
    state.status = state.view ? 'refreshing' : 'loading';
    state.instructions = null;
    state.policy = null;
    emit();
    try {
      const raw = await client.view();
      if (generation !== epoch || version !== readVersion) return;
      const view = cleanView(raw, state.account);
      const domainChanged = state.view?.deployment?.deploymentId !== view.deployment?.deploymentId;
      if (domainChanged) {
        state.receipts = {};
        state.transactions = {};
        state.policy = null;
        state.recoveryNotice = null;
        state.recoverySplits = {};
      }
      check(
        !state.account || sessionDeployment?.deploymentId === view.deployment?.deploymentId,
        'SESSION_CHANGED',
      );
      if (domainChanged) state.roles = [];
      state.view = view;
      readAt = clock();
      state.status = 'ready';
      for (const [id, receipt] of Object.entries(state.receipts)) {
        const value = currentOrder(id);
        if (
          !value ||
          value.state !== receipt.orderState ||
          BigInt(value.terms.token_amount) !==
            BigInt(receipt.buyerReceivedAtoms) + BigInt(receipt.sellerReturnedAtoms)
        )
          delete state.receipts[id];
      }
      if (!view.offers.some((value) => value.id === state.selectedOfferId))
        state.selectedOfferId = view.offers[0]?.id ?? null;
      if (!view.ownerOrders.some((value) => value.id === state.selectedOrderId))
        state.selectedOrderId = view.ownerOrders.at(-1)?.id ?? null;
      if (state.policy && currentOrder(state.policy.orderId)?.state !== 'Paying')
        state.policy = null;
      if (state.pending?.status !== 'unknown') state.error = null;
      emit();
      return view;
    } catch (error) {
      if (generation !== epoch || version !== readVersion) return;
      state.status = 'error';
      state.instructions = null;
      fail(error);
    }
  }

  function acceptResult(action, args, result) {
    if (MUTATIONS.has(action)) {
      const value = order(result?.order),
        tx = transaction(result?.transaction, state.view.deployment);
      check(action === 'fund' || value.id === args.orderId, 'INVALID_HOST_RESPONSE');
      check([value.buyer, value.terms.seller].includes(state.account), 'SESSION_CHANGED');
      if (action === 'beginPayment')
        check(value.state === 'Paying' && BigInt(value.locked_at) > 0n, 'UNCONFIRMED_TRANSACTION');
      if (action === 'resolve') {
        check(value.state === 'Resolved', 'UNCONFIRMED_TRANSACTION');
        state.recoverySplits[value.id] = args.buyerTokens;
      }
      state.view.ownerOrders = [
        ...state.view.ownerOrders.filter((item) => item.id !== value.id),
        value,
      ];
      if (['release', 'refundExpiredReservation', 'resolve'].includes(action))
        state.transactions[value.id] = tx;
      state.selectedOrderId = value.id;
    } else if (action === 'getPaymentInstructions') {
      check(mayInstruct(args.orderId), 'PAYMENT_INSTRUCTIONS_LOCKED');
      check(
        typeof result === 'string' && result.length > 0 && result.length <= 512,
        'INVALID_HOST_RESPONSE',
      );
      state.instructions = { orderId: args.orderId, destination: result };
    } else if (action === 'getPolicyStatus') {
      check(
        result?.orderId === args.orderId &&
          ['pending', 'unavailable', 'rejected', 'verified'].includes(result.status),
        'INVALID_HOST_RESPONSE',
      );
      if (result.status === 'verified')
        check(
          typeof result.authorization === 'string' && result.authorization.length > 0,
          'INVALID_HOST_RESPONSE',
        );
      state.policy = {
        orderId: args.orderId,
        status: result.status,
        ...(result.status === 'verified' ? { authorization: result.authorization } : {}),
      };
    } else if (action === 'reconcileReceipt') {
      const value = currentOrder(args.orderId),
        tx = transaction(result?.transaction, state.view.deployment);
      check(
        value &&
          TERMINAL.has(value.state) &&
          result.orderId === args.orderId &&
          result.orderState === value.state &&
          tx.hash === args.transaction.hash &&
          tx.ledger === args.transaction.ledger,
        'RECEIPT_UNAVAILABLE',
      );
      const buyerReceivedAtoms = integer(result.buyerReceivedAtoms),
        sellerReturnedAtoms = integer(result.sellerReturnedAtoms);
      check(
        BigInt(buyerReceivedAtoms) + BigInt(sellerReturnedAtoms) ===
          BigInt(value.terms.token_amount),
        'RECEIPT_UNAVAILABLE',
      );
      check(value.state !== 'Released' || sellerReturnedAtoms === '0', 'RECEIPT_UNAVAILABLE');
      check(value.state !== 'Refunded' || buyerReceivedAtoms === '0', 'RECEIPT_UNAVAILABLE');
      check(
        value.state !== 'Resolved' ||
          state.recoverySplits[args.orderId] === undefined ||
          buyerReceivedAtoms === state.recoverySplits[args.orderId],
        'RECEIPT_UNAVAILABLE',
      );
      state.receipts[args.orderId] = {
        orderId: args.orderId,
        orderState: value.state,
        buyerReceivedAtoms,
        sellerReturnedAtoms,
        transaction: tx,
      };
    }
  }

  async function respondRecovery(requestId, approve) {
    ready('seller', true);
    check(state.view.readiness.recovery, 'RECOVERY_UNAVAILABLE');
    check(!state.pending, 'OPERATION_PENDING');
    const request = state.view.recoveryRequests.find((value) => value.requestId === requestId);
    check(request?.seller === state.account, 'RECOVERY_REQUEST_INVALID');
    check(request.status === 'queued', 'RECOVERY_REQUEST_ALREADY_CLAIMED');
    check(BigInt(request.expiresAt) > now() * 1000n, 'RECOVERY_EXPIRED');
    const generation = epoch;
    ++readVersion;
    state.pending = {
      action: approve ? 'approveRecovery' : 'rejectRecovery',
      args: { requestId },
      status: 'running',
      operationId: null,
    };
    state.error = null;
    state.instructions = null;
    state.policy = null;
    state.recoveryNotice = null;
    emit();
    try {
      const result = await client[approve ? 'approveRecovery' : 'rejectRecovery'](
        structuredClone(request),
        {
          onProgress(value) {
            if (generation === epoch && state.pending) {
              Object.assign(state.pending, value);
              emit();
            }
          },
        },
      );
      if (generation !== epoch) return;
      check(
        result?.requestId === requestId && result.accepted === true && result.approved === approve,
        'INVALID_HOST_RESPONSE',
      );
      state.pending = null;
      state.recoveryNotice = { orderId: request.orderId, approved: approve };
      await refresh();
      return result;
    } catch (error) {
      if (generation !== epoch) return;
      state.pending = null;
      if (error?.outcome === 'unknown') error.code = 'RECOVERY_RESPONSE_UNKNOWN';
      fail(error);
      throw error;
    }
  }

  async function execute(action, args, { resume = false } = {}) {
    check(!state.pending || (resume && state.pending.status === 'unknown'), 'OPERATION_PENDING');
    const generation = epoch;
    const old = state.pending;
    state.pending = {
      action,
      args: structuredClone(args),
      status: 'running',
      operationId: resume ? old.operationId : null,
    };
    state.error = null;
    state.instructions = null;
    ++readVersion;
    emit();
    const progress = (value) => {
      if (generation !== epoch || !state.pending) return;
      state.pending = { ...state.pending, ...value, action, args: structuredClone(args) };
      emit();
    };
    try {
      const reply = resume
        ? await client.resumeOperation(old.operationId, { onProgress: progress })
        : await client.command(action, args, { onProgress: progress });
      if (generation !== epoch) return;
      state.pending.operationId = reply?.operationId ?? state.pending.operationId;
      try {
        check(reply && Object.hasOwn(reply, 'result'), 'INVALID_HOST_RESPONSE');
        acceptResult(action, args, reply.result);
      } catch (error) {
        if (MUTATIONS.has(action))
          Object.assign(error, { outcome: 'unknown', operationId: state.pending.operationId });
        throw error;
      }
      state.pending = null;
      emit();
      if (MUTATIONS.has(action)) await refresh();
      return reply.result;
    } catch (error) {
      if (generation !== epoch) return;
      // A policy lookup can issue an authorization, but cannot submit a wallet
      // transaction. Keep transaction uncertainty specific to transaction calls.
      if (action === 'getPolicyStatus') {
        state.policy = null;
        if (error?.outcome === 'unknown')
          Object.assign(error, { code: 'PAYMENT_STATUS_UNAVAILABLE', outcome: 'failed' });
      }
      if (error?.outcome === 'unknown')
        state.pending = {
          action,
          args: structuredClone(args),
          status: 'unknown',
          operationId: error.operationId ?? state.pending?.operationId ?? null,
        };
      else state.pending = null;
      state.instructions = null;
      fail(error);
      throw error;
    }
  }

  return Object.freeze({
    mode: 'live',
    snapshot() {
      if (state.instructions && !mayInstruct(state.instructions.orderId)) state.instructions = null;
      return structuredClone({ ...state, now: now().toString() });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async initialize() {
      const generation = epoch;
      try {
        const session = await client.session();
        if (generation !== epoch) return;
        sessionDeployment = session ? readDeploymentDomain(session) : null;
        state.account = session ? account(session.account) : null;
      } catch (error) {
        if (generation !== epoch) return;
        state.account = null;
        fail(error);
      }
      if (generation !== epoch) return;
      return refresh();
    },
    refresh,
    selectOffer(id) {
      check(
        state.view?.offers.some((value) => value.id === id),
        'INVALID_HOST_RESPONSE',
      );
      state.selectedOfferId = id;
      emit();
    },
    selectOrder(id) {
      check(currentOrder(id), 'INVALID_HOST_RESPONSE');
      state.selectedOrderId = id;
      state.instructions = null;
      state.policy = null;
      emit();
    },
    async connect(party) {
      check(['buyer', 'seller'].includes(party), 'CONNECT_WALLET_FIRST');
      ready();
      check(!state.pending, 'OPERATION_PENDING');
      const generation = ++epoch;
      ++readVersion;
      state.instructions = null;
      state.policy = null;
      state.error = null;
      state.pending = {
        action: 'connectWallet',
        args: { party },
        status: 'running',
        operationId: null,
      };
      emit();
      try {
        if (!state.account) {
          const session = await client.authenticate();
          if (generation !== epoch) return;
          sessionDeployment = readDeploymentDomain(session);
          check(
            sessionDeployment.deploymentId === state.view.deployment.deploymentId,
            'SESSION_CHANGED',
          );
          state.account = account(session.account);
        }
        const reply = await client.command('connectWallet', { party });
        if (generation !== epoch) return;
        check(
          reply.result?.account === state.account &&
            reply.result.networkPassphrase === state.view.deployment.networkPassphrase,
          'SESSION_CHANGED',
        );
        if (!state.roles.includes(party)) state.roles.push(party);
        state.pending = null;
        await refresh();
      } catch (error) {
        if (generation === epoch) {
          state.pending = null;
          fail(error);
        }
        throw error;
      }
    },
    async logout() {
      sessionDeployment = null;
      ++epoch;
      ++readVersion;
      state = {
        ...state,
        account: null,
        roles: [],
        view: null,
        status: 'loading',
        pending: null,
        instructions: null,
        policy: null,
        transactions: {},
        receipts: {},
        recoveryNotice: null,
        recoverySplits: {},
        error: null,
      };
      emit();
      try {
        await client.logout();
      } finally {
        await refresh();
      }
    },
    async fund(draftId) {
      ready('seller', true);
      const draft = state.view.sellerDrafts.find((value) => value.id === draftId);
      check(draft, 'INVALID_HOST_RESPONSE');
      const { seller: _seller, ...approvedTerms } = draft.publicTerms;
      return execute('fund', { terms: structuredClone(approvedTerms) });
    },
    async reserve(id = state.selectedOfferId) {
      ready('buyer', true);
      const offer = state.view.offers.find((value) => value.id === id);
      check(offer && now() < BigInt(offer.offerExpiresAt), 'INVALID_HOST_RESPONSE');
      return execute('reserve', { orderId: id });
    },
    async beginPayment(id) {
      ready('buyer', true);
      check(state.view.readiness.paymentProof, 'PAYMENT_VERIFICATION_UNAVAILABLE');
      const value = currentOrder(id);
      check(
        value?.state === 'Reserved' &&
          value.buyer === state.account &&
          now() < BigInt(value.pay_by),
        'PAYMENT_INSTRUCTIONS_LOCKED',
      );
      await execute('beginPayment', { orderId: id });
      if (state.status === 'ready' && mayInstruct(id))
        return execute('getPaymentInstructions', { orderId: id });
    },
    async showInstructions(id) {
      ready('buyer');
      check(state.view.readiness.paymentProof, 'PAYMENT_VERIFICATION_UNAVAILABLE');
      check(mayInstruct(id), 'PAYMENT_INSTRUCTIONS_LOCKED');
      return execute('getPaymentInstructions', { orderId: id });
    },
    async checkVerification(id) {
      ready('buyer');
      check(currentOrder(id)?.state === 'Paying', 'INVALID_HOST_RESPONSE');
      return execute('getPolicyStatus', { orderId: id });
    },
    async release(id) {
      ready('buyer', true);
      check(
        state.policy?.orderId === id && state.policy.status === 'verified',
        'PAYMENT_VERIFICATION_UNAVAILABLE',
      );
      const result = await execute('release', {
        orderId: id,
        authorization: state.policy.authorization,
      });
      if (result) await this.loadReceipt(id);
      return result;
    },
    async refund(id) {
      const value = currentOrder(id);
      ready(value?.buyer === state.account ? 'buyer' : 'seller', true);
      check(
        value?.state === 'Reserved' && now() >= BigInt(value.pay_by),
        'PAYMENT_INSTRUCTIONS_LOCKED',
      );
      const result = await execute('refundExpiredReservation', { orderId: id });
      if (result) await this.loadReceipt(id);
      return result;
    },
    async proposeRecovery(id, buyerTokens) {
      ready('buyer', true);
      check(state.view.readiness.recovery, 'RECOVERY_UNAVAILABLE');
      const value = currentOrder(id);
      check(
        value?.buyer === state.account && ['Reserved', 'Paying'].includes(value.state),
        'RESOLUTION_NOT_AVAILABLE',
      );
      check(
        typeof buyerTokens === 'string' &&
          /^(0|[1-9][0-9]*)$/.test(buyerTokens) &&
          buyerTokens.length <= 39 &&
          BigInt(buyerTokens) <= BigInt(value.terms.token_amount),
        'INVALID_RESOLUTION_SPLIT',
      );
      check(
        !state.view.recoveryRequests.some((request) => request.orderId === id),
        'OPERATION_PENDING',
      );
      const result = await execute('resolve', { orderId: id, buyerTokens });
      if (result) await this.loadReceipt(id);
      return result;
    },
    approveRecovery: (requestId) => respondRecovery(requestId, true),
    rejectRecovery: (requestId) => respondRecovery(requestId, false),
    async loadReceipt(id) {
      ready();
      const value = currentOrder(id);
      const tx = value?.lastConfirmedTransaction ?? state.transactions[id];
      check(value && TERMINAL.has(value.state) && tx, 'RECEIPT_UNAVAILABLE');
      return execute('reconcileReceipt', {
        orderId: id,
        transaction: transaction(tx, state.view.deployment),
      });
    },
    async resumePending() {
      check(state.pending?.status === 'unknown' && state.pending.operationId, 'OPERATION_PENDING');
      return execute(state.pending.action, state.pending.args, { resume: true });
    },
  });
}
