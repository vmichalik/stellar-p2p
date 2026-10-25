import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Account,
  Address,
  Keypair,
  Networks,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { createHostRuntime } from '../host-runtime.mjs';

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

export {
  fixture,
  alice,
  bob,
  other,
  deployment,
  terms,
  order,
  encodedOrder,
  address,
  amount,
  sym,
  map,
};
