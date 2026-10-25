import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Account,
  Address,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { createHostRuntime, unconfiguredView } from './host-runtime.mjs';

// Synthetic RPC and disposable private SQLite directories; no network calls.
const alice = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x61)).publicKey();
const bob = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x62)).publicKey();
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x63)).publicKey();
const deployment = {
  networkPassphrase: Networks.TESTNET,
  rpcUrl: 'https://rpc.example.test',
  contract: Address.contract(Buffer.alloc(32, 5)).toString(),
  token: Address.contract(Buffer.alloc(32, 6)).toString(),
  tokenDecimals: 7,
  maxFeeStroops: '10000',
  policySignerPublicKeyHex: '07'.repeat(32),
  escrowWasmSha256: '08'.repeat(32),
  tokenLabel: 'Synthetic test token',
};
const sym = xdr.ScVal.scvSymbol;
const uint = (n) => nativeToScVal(BigInt(n), { type: 'u64' });
const amount = (n) => nativeToScVal(BigInt(n), { type: 'i128' });
const address = (value) => new Address(value).toScVal();
const bytes = (hex) => xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'));
const variant = (name) => xdr.ScVal.scvVec([sym(name)]);
const map = (fields) =>
  xdr.ScVal.scvMap(
    Object.entries(fields)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => new xdr.ScMapEntry({ key: sym(key), val })),
  );
const terms = (seller = alice, overrides = {}) => ({
  seller,
  token_amount: '220000000',
  fiat_minor: '2000',
  currency: 'EUR',
  rail: 'revolut',
  recipient: '09'.repeat(32),
  offer_expires_at: '2000',
  reservation_seconds: '100',
  ...overrides,
});
function order(id, state, seller, buyer = null, overrides = {}) {
  return {
    id,
    state,
    buyer,
    terms: terms(seller, overrides),
    reserved_at: buyer ? '980' : '0',
    locked_at: state === 'Paying' ? '990' : '0',
    pay_by: buyer ? '1100' : '0',
  };
}
function encodedOrder(value) {
  return map({
    buyer: value.buyer ? address(value.buyer) : xdr.ScVal.scvVoid(),
    locked_at: uint(value.locked_at),
    reserved_at: uint(value.reserved_at),
    pay_by: uint(value.pay_by),
    state: variant(value.state),
    terms: map({
      seller: address(value.terms.seller),
      token_amount: amount(value.terms.token_amount),
      fiat_minor: amount(value.terms.fiat_minor),
      currency: sym('EUR'),
      rail: sym('revolut'),
      recipient: bytes(value.terms.recipient),
      offer_expires_at: uint(value.terms.offer_expires_at),
      reservation_seconds: uint(value.terms.reservation_seconds),
    }),
  });
}
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-host-runtime-'));
  const storageDirectory = join(directory, 'private');
  let runtime;
  t.after(() => {
    runtime?.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const orders = new Map([
    ['0', order('0', 'Funded', alice)],
    ['1', order('1', 'Paying', bob, alice)],
    ['2', order('2', 'Reserved', bob, other)],
    ['3', order('3', 'Funded', bob, null, { offer_expires_at: '900' })],
  ]);
  const counts = {
    network: 0,
    ledger: 0,
    balance: 0,
    sign: 0,
    submit: 0,
    privateReads: 0,
    walletCalls: [],
  };
  const config = map({
    signer: bytes(deployment.policySignerPublicKeyHex),
    token: address(deployment.token),
  });
  const instance = xdr.ScVal.scvContractInstance(
    new xdr.ScContractInstance({
      executable: xdr.ContractExecutable.contractExecutableWasm(
        Buffer.from(options.wasm ?? deployment.escrowWasmSha256, 'hex'),
      ),
      storage: [new xdr.ScMapEntry({ key: variant('Config'), val: config })],
    }),
  );
  const server = {
    async getNetwork() {
      counts.network++;
      if (options.unavailable) throw Error('SYNTHETIC_PRIVATE_RPC_FAILURE');
      return { passphrase: Networks.TESTNET, protocolVersion: 29 };
    },
    async getLedgerEntries(...keys) {
      counts.ledger++;
      const entries = keys.flatMap((key, index) => {
        const orderId = index === 0 ? null : String(scValToNative(key.contractData.key)[1]);
        if (orderId === options.missingOrder) return [];
        const selected = index === 0 ? instance : encodedOrder(orders.get(orderId));
        return [
          {
            key,
            val: xdr.LedgerEntryData.contractData(
              new xdr.ContractDataEntry({
                ext: xdr.ExtensionPoint.v0(),
                ...key.contractData,
                val: selected,
              }),
            ),
            lastModifiedLedgerSeq: 95,
            liveUntilLedgerSeq: 200,
          },
        ];
      });
      return { latestLedger: 100, entries };
    },
    async getLedgers() {
      return { latestLedger: 100, ledgers: [{ sequence: 100, ledgerCloseTime: '1000' }] };
    },
    async getEvents() {
      return { oldestLedger: 80, latestLedger: 100, cursor: 'complete', events: [] };
    },
    async getAccount(account) {
      return new Account(account, '10');
    },
    async getLatestLedger() {
      return { sequence: 100, closeTime: '1010', protocolVersion: 29 };
    },
    async simulateTransaction(tx) {
      const method = tx.operations[0].func.invokeContract.functionName.toString();
      let value;
      if (method === 'balance') {
        counts.balance++;
        value = amount('9007199254740993');
      } else if (method === 'get_config') value = config;
      else if (method === 'decimals') value = nativeToScVal(7, { type: 'u32' });
      else if (method === 'get_order')
        value = encodedOrder(
          orders.get(String(scValToNative(tx.operations[0].func.invokeContract.args[0]))),
        );
      else throw Error('Unexpected synthetic read: ' + method);
      return {
        _parsed: true,
        transactionData: {},
        minResourceFee: '0',
        events: [],
        latestLedger: 100,
        result: { retval: value },
      };
    },
    async sendTransaction() {
      counts.submit++;
      throw Error('Submission forbidden in runtime tests');
    },
  };
  const own = {
    id: 'own-draft',
    publicTerms: terms(alice, { token_amount: '330000000' }),
    privateNote: 'SYNTHETIC_PRIVATE_DRAFT_NOTE',
  };
  const drafts = [
    own,
    { id: 'other-draft', publicTerms: terms(bob, { token_amount: '440000000' }) },
    { id: 'already-funded', publicTerms: terms(alice) },
    { id: 'expired', publicTerms: terms(alice, { offer_expires_at: '999' }) },
  ];
  const configOptions = {
    deployment,
    deploymentLedger: '90',
    storageDirectory,
    orderIds: ['0', '1', '2', '3'],
    sellerDrafts: drafts,
    server,
    clock: () => '1010',
    offerReader: {
      async read() {
        counts.privateReads++;
        throw Error('Private offer lookup must not run for public views');
      },
    },
  };
  const wallet = {
    connect: async () => {
      counts.walletCalls.push('connect');
      return alice;
    },
    selected: async () => {
      counts.walletCalls.push('selected');
      return alice;
    },
    network: async () => {
      counts.walletCalls.push('network');
      return Networks.TESTNET;
    },
    sign: async () => {
      counts.walletCalls.push('sign');
      counts.sign++;
      throw Error('Signing forbidden in runtime tests');
    },
  };
  return {
    counts,
    own,
    drafts,
    server,
    wallet,
    orders,
    storageDirectory,
    configOptions,
    create(overrides = {}) {
      runtime = createHostRuntime({ ...configOptions, ...overrides });
      return runtime;
    },
  };
}

test('unconfigured runtime exposes empty unavailable state and never creates a service', async () => {
  const runtime = createHostRuntime();
  const view = await runtime.readView();
  assert.deepEqual(
    { ...view, serverTime: 'ignored' },
    { ...unconfiguredView(), serverTime: 'ignored' },
  );
  assert.equal(view.configured, false);
  assert.deepEqual(view.offers, []);
  assert.equal(view.balances, null);
  assert.deepEqual(view.readiness, { paymentProof: false, submission: false, recovery: false });
  assert.throws(() => runtime.createServices({ account: alice }), /HOST_NOT_CONFIGURED/);
  runtime.close();
  runtime.close();
});

test('invalid deployment/catalog configuration fails before creating private storage', (t) => {
  const f = fixture(t);
  for (const invalid of [
    { deployment: { ...deployment, networkPassphrase: Networks.PUBLIC } },
    { deployment: { ...deployment, maxFeeStroops: '0x10' } },
    { deployment: { ...deployment, tokenDecimals: 6 } },
    { orderIds: ['01'] },
    { orderIds: ['18446744073709551616'] },
    { deploymentLedger: '0' },
    { deploymentLedger: '90.1' },
    {
      sellerDrafts: [
        { id: 'bad', publicTerms: { ...terms(), recipientSalt: 'SYNTHETIC_PRIVATE_SALT' } },
      ],
    },
  ]) {
    assert.throws(() => f.create(invalid), undefined, JSON.stringify(invalid));
    assert.equal(
      existsSync(f.storageDirectory),
      false,
      'Invalid configuration must fail before any SQLite directory is created',
    );
  }
  assert.equal(f.counts.network, 0);
  assert.equal(f.counts.sign, 0);
  assert.equal(f.counts.submit, 0);
});

test('public and owner views derive exact chain amounts and reveal only that owner’s approved drafts', async (t) => {
  const f = fixture(t),
    runtime = f.create();
  assert.equal(f.counts.network, 0, 'Boot must not contact RPC');
  const anonymous = await runtime.readView();
  const initialLedgerReads = f.counts.ledger;
  assert.deepEqual(
    anonymous.offers.map((row) => row.id),
    ['0'],
  );
  assert.deepEqual(anonymous.ownerOrders, []);
  assert.deepEqual(anonymous.sellerDrafts, []);
  assert.equal(anonymous.balances, null);
  const own = await runtime.readView({ account: alice });
  assert.deepEqual(
    own.ownerOrders.map((row) => row.id),
    ['0', '1'],
  );
  assert.deepEqual(own.sellerDrafts, [{ id: f.own.id, publicTerms: f.own.publicTerms }]);
  assert.deepEqual(own.balances, { tokenAtoms: '9007199254740993' });
  assert.equal(own.readiness.paymentProof, false);
  assert.equal(own.readiness.submission, false);
  assert.equal(own.readiness.recovery, false);
  assert.equal(f.counts.privateReads, 0);
  assert.doesNotMatch(
    JSON.stringify(own),
    /SYNTHETIC_PRIVATE|recipientSalt|rpcUrl|policySignerPublicKeyHex|escrowWasmSha256/,
  );
  assert.equal(
    f.counts.ledger,
    initialLedgerReads,
    'The second view should reuse coherent cached deployment/order snapshots',
  );
  assert.equal(statSync(f.storageDirectory).mode & 0o777, 0o700);
  assert.equal(statSync(join(f.storageDirectory, 'orders.sqlite')).mode & 0o777, 0o600);
});

test('runtime fails closed for unavailable RPC without manufacturing offers, balances or proof readiness', async (t) => {
  const f = fixture(t, { unavailable: true }),
    runtime = f.create();
  const view = await runtime.readView({ account: alice });
  assert.deepEqual(view.offers, []);
  assert.deepEqual(view.ownerOrders, []);
  assert.equal(view.balances, null);
  assert.ok(view.unavailableReasons.includes('CHAIN_UNAVAILABLE'));
  assert.ok(view.unavailableReasons.includes('BALANCE_UNAVAILABLE'));
  assert.equal(view.readiness.paymentProof, false);
  assert.doesNotMatch(JSON.stringify(view), /SYNTHETIC_PRIVATE_RPC_FAILURE/);
});

test('session services reject unapproved funding and payment locks; disabled submission never prompts or submits', async (t) => {
  const f = fixture(t),
    runtime = f.create();
  const services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await assert.rejects(services.fund(terms(alice, { token_amount: '1' })), /OFFER_NOT_APPROVED/);
  await assert.rejects(services.beginPayment('1'), /PAYMENT_VERIFICATION_UNAVAILABLE/);
  await services.connectWallet('seller');
  await assert.rejects(services.fund(f.own.publicTerms), /TESTNET_SUBMISSION_NOT_AUTHORIZED/);
  assert.deepEqual(await services.getPolicyStatus('1'), { orderId: '1', status: 'unavailable' });
  assert.equal(f.counts.sign, 0);
  assert.equal(f.counts.submit, 0);
  assert.equal(f.counts.privateReads, 0);
  runtime.close();
  runtime.close();
  await assert.rejects(
    runtime.createServices({ account: alice, wallet: f.wallet }),
    /AUTHENTICATION_REQUIRED|HOST_CLOSED/,
  );
});

test('one missing configured order does not hide independently verified offers or owner orders', async (t) => {
  const f = fixture(t, { missingOrder: '2' }),
    runtime = f.create();
  const result = await runtime.readView({ account: alice });
  assert.deepEqual(
    result.offers.map((item) => item.id),
    ['0'],
  );
  assert.deepEqual(
    result.ownerOrders.map((item) => item.id),
    ['0', '1'],
  );
  assert.ok(result.unavailableReasons.includes('ORDER_UNAVAILABLE'));
  assert.equal(result.unavailableReasons.includes('CHAIN_UNAVAILABLE'), false);
});

test('a full durable catalog refuses an additional funding action before any wallet call', async (t) => {
  const f = fixture(t);
  let runtime = f.create({
    orderIds: Array.from({ length: 64 }, (_, index) => String(index)),
    submissionEnabled: true,
  });
  let services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await assert.rejects(services.fund(f.own.publicTerms), /CATALOG_LIMIT/);
  assert.deepEqual(f.counts.walletCalls, []);
  assert.equal(f.counts.submit, 0);
  runtime.close();
  runtime = f.create({ orderIds: [], submissionEnabled: true });
  services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await assert.rejects(services.fund(f.own.publicTerms), /CATALOG_LIMIT/);
  assert.deepEqual(f.counts.walletCalls, []);
  assert.equal(f.counts.submit, 0);
});

test('wrong deployed WASM rejects the first funding action even when the order catalog is empty', async (t) => {
  const f = fixture(t, { wasm: 'ff'.repeat(32) });
  const runtime = f.create({ orderIds: [], submissionEnabled: true });
  const services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await assert.rejects(services.fund(f.own.publicTerms), /DEPLOYMENT_UNAVAILABLE/);
  assert.deepEqual(f.counts.walletCalls, []);
  assert.equal(f.counts.submit, 0);
  const result = await runtime.readView();
  assert.ok(result.unavailableReasons.includes('CHAIN_UNAVAILABLE'));
  assert.deepEqual(result.offers, []);
});

test('a confirmed refund records exact transaction metadata across restart only for its owners and matching state', async (t) => {
  const f = fixture(t);
  const current = order('4', 'Reserved', bob, alice);
  current.pay_by = '1000';
  f.orders.set('4', current);
  let signed;
  f.server.prepareTransaction = async (tx) => tx;
  f.server.sendTransaction = async (tx) => {
    f.counts.submit++;
    signed = tx;
    current.state = 'Refunded';
    return { status: 'PENDING', hash: Buffer.from(tx.hash()).toString('hex') };
  };
  f.server.getTransaction = async () => ({
    status: 'SUCCESS',
    ledger: 100,
    envelopeXdr: signed.toEnvelope(),
  });
  f.wallet.sign = async (value) => {
    f.counts.sign++;
    const tx = TransactionBuilder.fromXDR(value, Networks.TESTNET);
    tx.sign(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x61)));
    return tx.toXDR();
  };
  let runtime = f.create({ orderIds: ['4'], submissionEnabled: true });
  const services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await services.connectWallet('buyer');
  const result = await services.refundExpiredReservation('4');
  assert.equal(result.order.state, 'Refunded');
  assert.equal(f.counts.sign, 1);
  assert.equal(f.counts.submit, 1);
  assert.deepEqual(
    (await runtime.readView({ account: alice })).ownerOrders[0].lastConfirmedTransaction,
    result.transaction,
  );
  runtime.close();
  runtime = f.create({ orderIds: [], sellerDrafts: [] });
  assert.deepEqual(
    (await runtime.readView({ account: alice })).ownerOrders[0].lastConfirmedTransaction,
    result.transaction,
  );
  assert.deepEqual(
    (await runtime.readView({ account: bob })).ownerOrders[0].lastConfirmedTransaction,
    result.transaction,
  );
  assert.deepEqual((await runtime.readView({ account: other })).ownerOrders, []);
  assert.deepEqual((await runtime.readView()).ownerOrders, []);
  runtime.close();
  current.state = 'Reserved';
  runtime = f.create({ orderIds: [], sellerDrafts: [] });
  assert.equal(
    (await runtime.readView({ account: alice })).ownerOrders[0].lastConfirmedTransaction,
    undefined,
  );
  assert.equal(f.counts.submit, 1, 'Reload/readback must never submit another transaction');
});
