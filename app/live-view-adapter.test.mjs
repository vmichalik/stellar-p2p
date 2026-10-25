import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveViewAdapter, formatUnits } from './live-view-adapter.mjs';

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
      view.account ? { account: view.account, networkPassphrase: TESTNET } : null,
    authenticate: async () => {
      calls.push(['authenticate']);
      view.account = buyer;
      return { account: buyer, networkPassphrase: TESTNET };
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
        result = { account: view.account, networkPassphrase: TESTNET };
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
  authentication.resolve({ account: buyer, networkPassphrase: TESTNET });
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
