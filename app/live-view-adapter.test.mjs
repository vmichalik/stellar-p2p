import test from 'node:test';
import assert from 'node:assert/strict';
import { readDeploymentDomain } from './host-client.mjs';
import { NETWORKS } from './network.mjs';
import { createLiveViewAdapter, formatUnits, parseTokenUnits } from './live-view-adapter.mjs';

const TESTNET = 'Test SDF Network ; September 2015';
const buyer = 'G' + 'A'.repeat(55),
  seller = 'G' + 'B'.repeat(55);
const escrow = 'C' + 'C'.repeat(55),
  token = 'C' + 'D'.repeat(55);
const terms = {
  seller,
  token_amount: '220000000',
  fiat_minor: '2000',
  currency: 'EUR',
  rail: 'revolut',
  recipient: '33'.repeat(32),
  offer_expires_at: '2000',
  reservation_seconds: '100',
};
const tx = (hash = '11'.repeat(32)) => ({
  hash,
  networkPassphrase: TESTNET,
  contract: escrow,
  ledger: '500',
  status: 'confirmed',
});
const chainOrder = (state = 'Reserved') => ({
  id: '0',
  terms: structuredClone(terms),
  state,
  buyer,
  reserved_at: '1000',
  pay_by: '1100',
  locked_at: state === 'Reserved' ? '0' : '1000',
});
const recovery = () => ({
  requestId: 'r'.repeat(43),
  orderId: '0',
  networkPassphrase: TESTNET,
  contract: escrow,
  token,
  buyer,
  seller,
  tokenAmount: terms.token_amount,
  buyerTokens: '100000001',
  sellerTokens: '119999999',
  orderState: 'Paying',
  expirationLedger: 512,
  expiresAt: 1_060_000,
  fiatMinor: terms.fiat_minor,
  currency: 'EUR',
  rail: 'revolut',
  status: 'queued',
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function fixture({ configured = true, signedIn = true, paymentProof = true } = {}) {
  const calls = [];
  let time = 0;
  let view = {
    configured,
    deployment: configured
      ? {
          networkPassphrase: TESTNET,
          contract: escrow,
          token,
          tokenDecimals: 7,
          tokenLabel: 'Test token',
        }
      : null,
    account: signedIn && configured ? buyer : null,
    serverTime: '1000',
    balances: null,
    offers: configured
      ? [
          {
            id: '0',
            seller,
            tokenAmount: '220000000',
            fiatMinor: '2000',
            currency: 'EUR',
            rail: 'revolut',
            offerExpiresAt: '2000',
            recipientCommitment: '33'.repeat(32),
          },
        ]
      : [],
    ownerOrders: [],
    sellerDrafts: [],
    readiness: { submission: configured, paymentProof, recovery: false },
    unavailableReasons: [],
  };
  const client = {
    session: async () =>
      view.account ? { account: view.account, ...readDeploymentDomain(view.deployment) } : null,
    authenticate: async () => {
      calls.push(['authenticate']);
      view.account = buyer;
      return { account: buyer, ...readDeploymentDomain(view.deployment) };
    },
    view: async () => structuredClone(view),
    logout: async () => {
      view.account = null;
      view.ownerOrders = [];
      view.sellerDrafts = [];
    },
    command: async (action, args) => {
      calls.push([action, structuredClone(args)]);
      let result;
      if (action === 'connectWallet')
        result = { account: view.account, ...readDeploymentDomain(view.deployment) };
      else if (action === 'reserve') {
        view.ownerOrders = [chainOrder()];
        view.offers = [];
        result = { order: chainOrder(), transaction: tx() };
      } else if (action === 'beginPayment') {
        view.ownerOrders[0] = chainOrder('Paying');
        result = { order: chainOrder('Paying'), transaction: tx() };
      } else if (action === 'getPaymentInstructions') result = '@synthetic.seller';
      else if (action === 'getPolicyStatus') result = { orderId: '0', status: 'unavailable' };
      else if (action === 'release') {
        view.ownerOrders[0] = chainOrder('Released');
        result = { order: chainOrder('Released'), transaction: tx('22'.repeat(32)) };
      } else if (action === 'reconcileReceipt')
        result = {
          orderId: '0',
          orderState: view.ownerOrders[0].state,
          buyerReceivedAtoms: '220000000',
          sellerReturnedAtoms: '0',
          transaction: args.transaction,
        };
      else throw new Error('UNEXPECTED_TEST_ACTION');
      return { operationId: 'operation-' + calls.length, result };
    },
  };
  return {
    client,
    calls,
    adapter: createLiveViewAdapter({ client, clock: () => time }),
    view: () => view,
    setView: (next) => {
      view = next;
    },
    advance: (milliseconds) => {
      time += milliseconds;
    },
  };
}
async function connected(options) {
  const f = fixture(options);
  await f.adapter.initialize();
  await f.adapter.connect('buyer');
  return f;
}

test('live formatting preserves values beyond Number precision and unconfigured views never prompt wallets', async () => {
  assert.equal(formatUnits('900719925474099312345'), '90,071,992,547,409.9312345');
  assert.equal(formatUnits('2000', 2), '20.00');
  assert.equal(formatUnits(null), '—');
  const f = fixture({ configured: false, signedIn: false });
  await f.adapter.initialize();
  await assert.rejects(f.adapter.connect('buyer'), { code: 'DEPLOYMENT_NOT_CONFIGURED' });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.adapter.snapshot().view.offers, []);
  assert.equal(f.adapter.snapshot().view.balances, null);
});

test('whole-offer ID zero reserve, confirmed lock and instruction lookup are sequential', async () => {
  const f = await connected();
  await f.adapter.reserve('0');
  assert.equal(f.adapter.snapshot().view.ownerOrders[0].state, 'Reserved');
  assert.equal(f.adapter.snapshot().instructions, null);
  await f.adapter.beginPayment('0');
  assert.deepEqual(
    f.calls.slice(-2).map(([action]) => action),
    ['beginPayment', 'getPaymentInstructions'],
  );
  assert.equal(f.adapter.snapshot().instructions.destination, '@synthetic.seller');
  f.advance(100_000);
  assert.equal(f.adapter.snapshot().instructions, null);
  await assert.rejects(f.adapter.showInstructions('0'), { code: 'PAYMENT_INSTRUCTIONS_LOCKED' });
  // A timely payment can still be checked after the payment window ended.
  await f.adapter.checkVerification('0');
  assert.equal(f.adapter.snapshot().policy.status, 'unavailable');
  assert.equal(f.adapter.snapshot().view.ownerOrders[0].state, 'Paying');
  assert.deepEqual(f.adapter.snapshot().receipts, {});
});

test('known unavailable payment verification blocks a new lock or instruction request', async () => {
  const f = await connected({ paymentProof: false });
  await f.adapter.reserve('0');
  await assert.rejects(f.adapter.beginPayment('0'), { code: 'PAYMENT_VERIFICATION_UNAVAILABLE' });
  assert.equal(
    f.calls.some(([action]) => action === 'beginPayment'),
    false,
  );
  f.view().ownerOrders[0] = chainOrder('Paying');
  await f.adapter.refresh();
  await assert.rejects(f.adapter.showInstructions('0'), {
    code: 'PAYMENT_VERIFICATION_UNAVAILABLE',
  });
  assert.equal(f.adapter.snapshot().instructions, null);
});

test('an unknown transaction never unlocks instructions and resumes the original operation only', async () => {
  const f = await connected();
  await f.adapter.reserve('0');
  const normal = f.client.command;
  f.client.command = async (action, args) => {
    if (action !== 'beginPayment') return normal(action, args);
    f.calls.push([action, args]);
    throw Object.assign(new Error('TRANSACTION_SUBMISSION_UNCERTAIN'), {
      code: 'TRANSACTION_SUBMISSION_UNCERTAIN',
      outcome: 'unknown',
      operationId: 'existing-operation',
    });
  };
  await assert.rejects(f.adapter.beginPayment('0'));
  assert.equal(f.adapter.snapshot().pending.status, 'unknown');
  assert.equal(f.adapter.snapshot().instructions, null);
  await assert.rejects(f.adapter.beginPayment('0'), { code: 'OPERATION_PENDING' });
  f.client.resumeOperation = async (id) => {
    assert.equal(id, 'existing-operation');
    f.view().ownerOrders[0] = chainOrder('Paying');
    return { operationId: id, result: { order: chainOrder('Paying'), transaction: tx() } };
  };
  await f.adapter.resumePending();
  assert.equal(f.calls.filter(([action]) => action === 'beginPayment').length, 1);
  assert.equal(f.adapter.snapshot().view.ownerOrders[0].state, 'Paying');
  assert.equal(f.adapter.snapshot().instructions, null);
});

test('a failed payment lookup never implies a submitted release or keeps stale authorization', async () => {
  const f = await connected();
  await f.adapter.reserve('0');
  await f.adapter.beginPayment('0');
  const normal = f.client.command;
  f.client.command = async (action, args) =>
    action === 'getPolicyStatus'
      ? {
          operationId: 'verified-check',
          result: { orderId: '0', status: 'verified', authorization: 'opaque' },
        }
      : normal(action, args);
  await f.adapter.checkVerification('0');
  assert.equal(f.adapter.snapshot().policy.status, 'verified');
  f.client.command = async () => {
    throw Object.assign(new Error('SERVICE_UNAVAILABLE'), {
      code: 'SERVICE_UNAVAILABLE',
      outcome: 'unknown',
      operationId: 'failed-check',
    });
  };
  await assert.rejects(f.adapter.checkVerification('0'), {
    code: 'PAYMENT_STATUS_UNAVAILABLE',
    outcome: 'failed',
  });
  const state = f.adapter.snapshot();
  assert.equal(state.pending, null);
  assert.equal(state.policy, null);
  assert.equal(state.view.ownerOrders[0].state, 'Paying');
  assert.match(state.error.message, /No release transaction was submitted/);
  await assert.rejects(f.adapter.release('0'), { code: 'PAYMENT_VERIFICATION_UNAVAILABLE' });
  assert.equal(
    f.calls.some(([action]) => action === 'release'),
    false,
  );
});

test('malformed confirmation cannot become a successful lock; failed instruction lookup retains held state', async () => {
  const f = await connected();
  await f.adapter.reserve('0');
  const normal = f.client.command;
  f.client.command = async (action, args) =>
    action === 'beginPayment'
      ? {
          operationId: 'bad-confirmation',
          result: { order: chainOrder('Paying'), transaction: { ...tx(), status: 'pending' } },
        }
      : normal(action, args);
  await assert.rejects(f.adapter.beginPayment('0'), {
    code: 'UNCONFIRMED_TRANSACTION',
    outcome: 'unknown',
  });
  assert.equal(f.adapter.snapshot().view.ownerOrders[0].state, 'Reserved');
  assert.equal(f.adapter.snapshot().instructions, null);
  const g = await connected();
  await g.adapter.reserve('0');
  const next = g.client.command;
  g.client.command = async (action, args) => {
    if (action === 'getPaymentInstructions')
      throw Object.assign(new Error('PAYMENT_DESTINATION_UNAVAILABLE'), {
        code: 'PAYMENT_DESTINATION_UNAVAILABLE',
      });
    return next(action, args);
  };
  await assert.rejects(g.adapter.beginPayment('0'), { code: 'PAYMENT_DESTINATION_UNAVAILABLE' });
  assert.equal(g.adapter.snapshot().view.ownerOrders[0].state, 'Paying');
  assert.equal(g.adapter.snapshot().instructions, null);
  assert.deepEqual(g.adapter.snapshot().receipts, {});
});

test('late refresh and private instruction responses cannot overwrite a newer view or logged-out session', async () => {
  const f = await connected();
  await f.adapter.reserve('0');
  const first = deferred(),
    second = deferred();
  let reads = 0;
  f.client.view = () => (++reads === 1 ? first.promise : second.promise);
  const older = f.adapter.refresh(),
    newer = f.adapter.refresh();
  const fresh = structuredClone(f.view());
  fresh.ownerOrders[0] = chainOrder('Paying');
  second.resolve(fresh);
  await newer;
  first.resolve(structuredClone(f.view()));
  await older;
  assert.equal(f.adapter.snapshot().view.ownerOrders[0].state, 'Paying');
  const privateResponse = deferred();
  f.client.command = async () => privateResponse.promise;
  f.client.view = async () => structuredClone(f.view());
  const instructions = f.adapter.showInstructions('0');
  await f.adapter.logout();
  privateResponse.resolve({ operationId: 'old-private-result', result: '@synthetic.private' });
  await instructions;
  assert.equal(f.adapter.snapshot().account, null);
  assert.equal(f.adapter.snapshot().instructions, null);
  assert.deepEqual(f.adapter.snapshot().view.ownerOrders, []);
});

test('terminal chain state alone is not a receipt; receipt identity and exact amounts must match', async () => {
  const f = await connected();
  f.view().ownerOrders = [
    { ...chainOrder('Released'), lastConfirmedTransaction: tx('22'.repeat(32)) },
  ];
  await f.adapter.refresh();
  assert.deepEqual(f.adapter.snapshot().receipts, {});
  const normal = f.client.command;
  f.client.command = async (action, args) => {
    const reply = await normal(action, args);
    if (action === 'reconcileReceipt') reply.result.transaction = tx('99'.repeat(32));
    return reply;
  };
  await assert.rejects(f.adapter.loadReceipt('0'), { code: 'RECEIPT_UNAVAILABLE' });
  assert.deepEqual(f.adapter.snapshot().receipts, {});
  f.client.command = normal;
  await f.adapter.loadReceipt('0');
  assert.equal(f.adapter.snapshot().receipts['0'].buyerReceivedAtoms, '220000000');
  f.view().ownerOrders[0].terms.token_amount = '221000000';
  await f.adapter.refresh();
  assert.deepEqual(f.adapter.snapshot().receipts, {});
});

test('release requires opaque verified authorization and reconciles the returned transaction before a receipt', async () => {
  const f = await connected();
  await f.adapter.reserve('0');
  await f.adapter.beginPayment('0');
  await assert.rejects(f.adapter.release('0'), { code: 'PAYMENT_VERIFICATION_UNAVAILABLE' });
  const normal = f.client.command;
  f.client.command = async (action, args) =>
    action === 'getPolicyStatus'
      ? {
          operationId: 'status',
          result: { orderId: '0', status: 'verified', authorization: 'opaque-host-reference' },
        }
      : normal(action, args);
  await f.adapter.checkVerification('0');
  await f.adapter.release('0');
  assert.deepEqual(
    f.calls.slice(-2).map(([action]) => action),
    ['release', 'reconcileReceipt'],
  );
  assert.equal(f.adapter.snapshot().receipts['0'].transaction.hash, '22'.repeat(32));
  assert.equal(f.adapter.snapshot().view.balances, null);
});

test('overlapping wallet connection is refused and late authentication cannot restore a logged-out account', async () => {
  const f = fixture({ signedIn: false });
  await f.adapter.initialize();
  const authentication = deferred();
  f.client.authenticate = async () => authentication.promise;
  const connecting = f.adapter.connect('buyer');
  await assert.rejects(f.adapter.connect('seller'), { code: 'OPERATION_PENDING' });
  await f.adapter.logout();
  authentication.resolve({ account: buyer, ...readDeploymentDomain(f.view().deployment) });
  await connecting;
  assert.equal(f.adapter.snapshot().account, null);
  assert.equal(
    f.calls.some(([action]) => action === 'connectWallet'),
    false,
  );
});

test('funding uses approved terms only and lets the authenticated host supply the seller address', async () => {
  const f = await connected();
  f.view().sellerDrafts = [{ id: 'approved-offer', publicTerms: { ...terms, seller: buyer } }];
  await f.adapter.connect('seller');
  const previous = f.client.command;
  f.client.command = async (action, args) => {
    if (action !== 'fund') return previous(action, args);
    const { seller: _seller, ...expected } = terms;
    assert.deepEqual(args, { terms: expected });
    const funded = {
      ...chainOrder('Funded'),
      terms: { ...terms, seller: buyer },
      buyer: null,
      reserved_at: '0',
      pay_by: '0',
      locked_at: '0',
    };
    f.view().ownerOrders = [funded];
    return { operationId: 'fund-approved', result: { order: funded, transaction: tx() } };
  };
  await f.adapter.fund('approved-offer');
  assert.equal(f.adapter.snapshot().view.ownerOrders[0].state, 'Funded');
  assert.equal(f.adapter.snapshot().view.ownerOrders[0].terms.seller, buyer);
  assert.deepEqual(f.adapter.snapshot().receipts, {});
});

test('recovery decimal input keeps exact atoms and rejects rounding, exponent notation and out-of-range splits', async () => {
  assert.equal(parseTokenUnits('10.0000001'), '100000001');
  assert.equal(parseTokenUnits('0'), '0');
  assert.equal(parseTokenUnits('9007199254740993.0000001'), '90071992547409930000001');
  for (const input of ['1e3', '-1', '0.00000001', '1,25', '', 'Infinity'])
    assert.throws(() => parseTokenUnits(input), { code: 'INVALID_RESOLUTION_SPLIT' });
  const f = await connected({ paymentProof: false });
  f.view().ownerOrders = [chainOrder('Paying')];
  f.view().readiness.recovery = true;
  await f.adapter.refresh();
  await assert.rejects(f.adapter.proposeRecovery('0', '220000001'), {
    code: 'INVALID_RESOLUTION_SPLIT',
  });
  assert.equal(
    f.calls.some(([action]) => action === 'resolve'),
    false,
  );
});

test('both-wallet recovery stays independent of payment proof and requires the confirmed exact-split receipt', async () => {
  const f = await connected({ paymentProof: false });
  f.view().ownerOrders = [chainOrder('Paying')];
  f.view().readiness.recovery = true;
  await f.adapter.refresh();
  const actions = [];
  f.client.command = async (action, args) => {
    actions.push([action, args]);
    if (action === 'resolve') {
      f.view().ownerOrders = [chainOrder('Resolved')];
      return {
        operationId: 'resolution',
        result: { order: chainOrder('Resolved'), transaction: tx() },
      };
    }
    assert.equal(action, 'reconcileReceipt');
    return {
      operationId: 'receipt',
      result: {
        orderId: '0',
        orderState: 'Resolved',
        buyerReceivedAtoms: '100000001',
        sellerReturnedAtoms: '119999999',
        transaction: tx(),
      },
    };
  };
  await f.adapter.proposeRecovery('0', '100000001');
  assert.deepEqual(
    actions.map(([action]) => action),
    ['resolve', 'reconcileReceipt'],
  );
  assert.deepEqual(actions[0][1], { orderId: '0', buyerTokens: '100000001' });
  assert.equal(f.adapter.snapshot().receipts['0'].buyerReceivedAtoms, '100000001');
  f.client.command = async () => ({
    operationId: 'wrong-receipt',
    result: {
      orderId: '0',
      orderState: 'Resolved',
      buyerReceivedAtoms: '100000000',
      sellerReturnedAtoms: '120000000',
      transaction: tx(),
    },
  });
  await assert.rejects(f.adapter.loadReceipt('0'), { code: 'RECEIPT_UNAVAILABLE' });
});

test('uncertain recovery keeps the buyer operation pending without another proposal or receipt', async () => {
  const f = await connected({ paymentProof: false });
  f.view().ownerOrders = [chainOrder('Reserved')];
  f.view().readiness.recovery = true;
  await f.adapter.refresh();
  let proposals = 0;
  f.client.command = async () => {
    proposals++;
    throw Object.assign(Error('unknown'), {
      outcome: 'unknown',
      operationId: 'recovery-operation',
    });
  };
  await assert.rejects(f.adapter.proposeRecovery('0', '0'));
  await assert.rejects(f.adapter.proposeRecovery('0', '1'), { code: 'OPERATION_PENDING' });
  assert.equal(proposals, 1);
  assert.equal(f.adapter.snapshot().pending.operationId, 'recovery-operation');
  assert.deepEqual(f.adapter.snapshot().receipts, {});
});

test('seller approval requires the matching confirmed order and does not fabricate settlement', async () => {
  const f = fixture({ paymentProof: false });
  f.view().account = seller;
  f.view().ownerOrders = [chainOrder('Paying')];
  f.view().readiness.recovery = true;
  f.view().recoveryRequests = [recovery()];
  await f.adapter.initialize();
  await f.adapter.connect('seller');
  let reviewed;
  f.client.approveRecovery = async (value) => {
    reviewed = value;
    f.view().recoveryRequests = [];
    return { requestId: value.requestId, accepted: true, approved: true };
  };
  await f.adapter.approveRecovery(recovery().requestId);
  assert.deepEqual(reviewed, { ...recovery(), ...readDeploymentDomain(f.view().deployment) });
  assert.equal(f.adapter.snapshot().view.ownerOrders[0].state, 'Paying');
  assert.equal(f.adapter.snapshot().recoveryNotice.approved, true);
  assert.deepEqual(f.adapter.snapshot().receipts, {});
  f.view().recoveryRequests = [{ ...recovery(), buyer: seller }];
  await f.adapter.refresh();
  assert.equal(f.adapter.snapshot().status, 'error');
});

test('expired proposals and late seller approvals after logout cannot authorize or restore a trade view', async () => {
  const f = fixture({ paymentProof: false });
  f.view().account = seller;
  f.view().ownerOrders = [chainOrder('Paying')];
  f.view().readiness.recovery = true;
  f.view().recoveryRequests = [recovery()];
  await f.adapter.initialize();
  await f.adapter.connect('seller');
  f.advance(61_000);
  await assert.rejects(f.adapter.approveRecovery(recovery().requestId), {
    code: 'RECOVERY_EXPIRED',
  });
  f.advance(-61_000);
  const approval = deferred();
  f.client.approveRecovery = () => approval.promise;
  const pending = f.adapter.approveRecovery(recovery().requestId);
  f.view().recoveryRequests = [];
  await f.adapter.logout();
  approval.resolve({ requestId: recovery().requestId, accepted: true, approved: true });
  await pending;
  assert.equal(f.adapter.snapshot().account, null);
  assert.equal(f.adapter.snapshot().recoveryNotice, null);
});

test('mainnet views retain explicit issued-asset identity and submission stays gated', async () => {
  const f = fixture();
  Object.assign(f.view().deployment, {
    network: 'mainnet',
    networkPassphrase: NETWORKS.mainnet.passphrase,
    tokenLabel: 'USDC',
    asset: { code: 'USDC', issuer: seller },
  });
  f.view().readiness.submission = false;
  await f.adapter.initialize();
  assert.equal(f.adapter.snapshot().view.deployment.network, 'mainnet');
  assert.deepEqual(f.adapter.snapshot().view.deployment.asset, { code: 'USDC', issuer: seller });
  await f.adapter.connect('buyer');
  await assert.rejects(f.adapter.reserve('0'), { code: 'MAINNET_SUBMISSION_NOT_AUTHORIZED' });
  assert.equal(
    f.calls.some(([action]) => action === 'reserve'),
    false,
  );
});

test('changing only the token contract invalidates the authenticated view and clears receipt caches', async () => {
  const f = await connected();
  await f.adapter.reserve('0');
  f.view().deployment.token = 'C' + 'E'.repeat(55);
  await f.adapter.refresh();
  const state = f.adapter.snapshot();
  assert.equal(state.error.code, 'SESSION_CHANGED');
  assert.notEqual(state.status, 'ready');
  assert.deepEqual(state.receipts, {});
  await assert.rejects(f.adapter.beginPayment('0'));
});

test('testnet confirmations cannot create receipts in an explicit mainnet deployment', async () => {
  const f = fixture();
  Object.assign(f.view().deployment, {
    network: 'mainnet',
    networkPassphrase: NETWORKS.mainnet.passphrase,
    tokenLabel: 'USDC',
    asset: { code: 'USDC', issuer: seller },
  });
  f.view().ownerOrders = [{ ...chainOrder('Resolved'), lastConfirmedTransaction: tx() }];
  await f.adapter.initialize();
  assert.equal(f.adapter.snapshot().error.code, 'UNCONFIRMED_TRANSACTION');
  assert.deepEqual(f.adapter.snapshot().receipts, {});
});

test('receiving readiness failure clears the pending action so the user can fix the wallet and retry', async () => {
  const f = await connected();
  const original = f.client.command;
  let ready = false;
  f.client.command = async (action, args) => {
    if (action === 'reserve' && !ready)
      throw Object.assign(new Error('RECEIVING_TRUSTLINE_MISSING'), {
        code: 'RECEIVING_TRUSTLINE_MISSING',
        outcome: 'failed',
        retryable: true,
      });
    return original(action, args);
  };
  await assert.rejects(f.adapter.reserve('0'), { code: 'RECEIVING_TRUSTLINE_MISSING' });
  assert.equal(f.adapter.snapshot().pending, null);
  assert.match(f.adapter.snapshot().error.message, /trustline/);
  ready = true;
  await f.adapter.reserve('0');
  assert.equal(f.adapter.snapshot().view.ownerOrders[0].state, 'Reserved');
});
