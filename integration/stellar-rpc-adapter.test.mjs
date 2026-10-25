import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  Account,
  Address,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { claimDigest } from '../contracts/escrow/protocol/protocol.mjs';
import { createStellarServices, freighterWalletPort } from './stellar-rpc-adapter.mjs';
import { TransactionJournal } from './transaction-journal.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const resources = [];
after(() => {
  for (const { journal } of resources) journal.close();
  for (const { directory } of resources)
    if (directory) rmSync(directory, { recursive: true, force: true });
});

// Public, disposable unit-test identities. All RPC and wallet ports are mocked;
// no test in this file makes a network request or uses a funded account.
const buyer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x66));
const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x55));
const contract = Address.contract(Buffer.alloc(32, 5)).toString();
const token = Address.contract(Buffer.alloc(32, 6)).toString();
const seller = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x77)).publicKey();
const deployment = {
  networkPassphrase: Networks.TESTNET,
  rpcUrl: 'https://rpc.example.test',
  contract,
  token,
  tokenDecimals: 7,
  policySignerPublicKeyHex: Buffer.from(signer.rawPublicKey()).toString('hex'),
  maxFeeStroops: '10000',
};
const scAddress = (value) => new Address(value).toScVal();

function transferEvent() {
  return new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: StrContract(token),
    type: xdr.ContractEventType.contract,
    body: xdr.ContractEventBody.v0(
      new xdr.ContractEventV0({
        topics: [
          nativeToScVal('transfer', { type: 'symbol' }),
          scAddress(contract),
          scAddress(buyer.publicKey()),
        ],
        data: nativeToScVal(220000000n, { type: 'i128' }),
      }),
    ),
  });
}
function StrContract(value) {
  return new Address(value).toScAddress().contractId;
}

function fixture(options = {}) {
  const calls = { sign: 0, submit: 0, instructions: 0 };
  let sent;
  const current = {
    buyer: buyer.publicKey(),
    state: ['Reserved'],
    reserved_at: '900',
    locked_at: '0',
    pay_by: '1100',
    terms: {
      seller,
      token_amount: '220000000',
      fiat_minor: '2000',
      currency: 'EUR',
      rail: 'revolut',
      recipient: '33'.repeat(32),
      offer_expires_at: '4000',
      reservation_seconds: '200',
    },
  };
  const server = {
    getNetwork: async () => ({ passphrase: Networks.TESTNET, protocolVersion: 29 }),
    getAccount: async () => new Account(buyer.publicKey(), '10'),
    getLatestLedger: async () => ({ closeTime: '1000', sequence: 100, protocolVersion: 29 }),
    simulateTransaction: async (tx) => {
      const method = tx.operations[0].func.invokeContract.functionName.toString();
      const values = {
        get_order: current,
        get_config: { token, signer: Buffer.from(signer.rawPublicKey()) },
        decimals: 7,
      };
      return {
        _parsed: true,
        transactionData: {},
        minResourceFee: '0',
        events: [],
        latestLedger: 100,
        result: { auth: [], retval: nativeToScVal(values[method]) },
      };
    },
    prepareTransaction: async (tx) => tx,
    sendTransaction: async (tx) => {
      calls.submit++;
      sent = tx;
      const method = tx.operations[0].func.invokeContract.functionName.toString();
      if (method === 'begin_payment') {
        current.state = ['Paying'];
        current.locked_at = '950';
      }
      if (method === 'release') current.state = ['Released'];
      return { status: 'PENDING', hash: Buffer.from(tx.hash()).toString('hex') };
    },
    getTransaction: async () =>
      options.pending
        ? { status: 'NOT_FOUND' }
        : {
            status: 'SUCCESS',
            ledger: 101,
            envelopeXdr: sent.toEnvelope(),
            events: { contractEventsXdr: [[transferEvent()]] },
          },
  };
  const wallet = {
    connect: async () => buyer.publicKey(),
    selected: async () => buyer.publicKey(),
    network: async () => (options.wrongNetwork ? Networks.PUBLIC : Networks.TESTNET),
    sign: async (value) => {
      calls.sign++;
      let tx = TransactionBuilder.fromXDR(value, Networks.TESTNET);
      if (options.mutateTransaction) tx = TransactionBuilder.cloneFrom(tx, { fee: '999' }).build();
      tx.sign(buyer);
      return tx.toXDR();
    },
  };
  const claim = {
    buyer: buyer.publicKey(),
    currency: 'EUR',
    expires_at: '2000',
    fiat_minor: '2000',
    nullifier: '44'.repeat(32),
    order_id: '0',
    paid_at: '980',
    pay_by: '1100',
    rail: 'revolut',
    recipient: '33'.repeat(32),
    reserved_at: '900',
    seller,
    token,
    token_amount: '220000000',
  };
  const approved = {
    syntheticOnly: false,
    releaseGate: 'POLICY_ACCEPTED',
    domain: { network_passphrase: Networks.TESTNET, contract },
    claim,
    signatureHex: Buffer.from(
      signer.sign(claimDigest({ network_passphrase: Networks.TESTNET, contract, claim })),
    ).toString('hex'),
  };
  const directory = options.journalPath ? null : mkdtempSync(join(tmpdir(), 'pactlane-rpc-unit-'));
  const journalPath = options.journalPath ?? join(directory, 'transactions.sqlite');
  const journal = new TransactionJournal(journalPath);
  resources.push({ journal, directory });
  const service = createStellarServices({
    deployment,
    wallet,
    server,
    submissionEnabled: options.submissionEnabled !== false,
    journal,
    pollAttempts: 1,
    sleep: async () => {},
    instructions: {
      read: async ({ orderId, recipientCommitment }) => {
        calls.instructions++;
        return {
          orderId,
          recipientCommitment,
          sourceBindingVerified: true,
          destination: '@synthetic.seller',
        };
      },
    },
    policy: {
      readAuthorization: async () =>
        options.synthetic ? { ...approved, syntheticOnly: true } : approved,
    },
  });
  return { service, server, calls, current, journal, journalPath };
}

test('wallet port uses official address, network and signed envelope fields', async () => {
  let signingOptions;
  const wallet = freighterWalletPort({
    requestAccess: async () => ({ address: buyer.publicKey() }),
    getAddress: async () => ({ address: buyer.publicKey() }),
    getNetworkDetails: async () => ({ networkPassphrase: Networks.TESTNET }),
    signTransaction: async (_value, options) => {
      signingOptions = options;
      return { signedTxXdr: 'fixture', signerAddress: buyer.publicKey() };
    },
  });
  assert.equal(await wallet.connect(), buyer.publicKey());
  assert.equal(await wallet.network(), Networks.TESTNET);
  assert.equal(await wallet.sign('fixture', buyer.publicKey()), 'fixture');
  assert.deepEqual(signingOptions, {
    networkPassphrase: Networks.TESTNET,
    address: buyer.publicKey(),
  });
});

test('wrong wallet network and missing submission authorization stop before signing', async () => {
  const wrong = fixture({ wrongNetwork: true });
  await assert.rejects(wrong.service.connectWallet('buyer'), /NETWORK_MISMATCH/);
  const blocked = fixture({ submissionEnabled: false });
  await blocked.service.connectWallet('buyer');
  await assert.rejects(blocked.service.beginPayment('0'), /SUBMISSION_NOT_AUTHORIZED/);
  assert.equal(blocked.calls.sign, 0);
});

test('payment instructions require confirmed lock and disappear after pay_by', async () => {
  const f = fixture();
  await f.service.connectWallet('buyer');
  await assert.rejects(f.service.getPaymentInstructions('0'), /INSTRUCTIONS_LOCKED/);
  assert.equal(f.calls.instructions, 0);
  const result = await f.service.beginPayment('0');
  assert.equal(result.order.state, 'Paying');
  assert.equal(result.transaction.status, 'confirmed');
  assert.equal(await f.service.getPaymentInstructions('0'), '@synthetic.seller');
  f.server.getLatestLedger = async () => ({ closeTime: '1100' });
  await assert.rejects(f.service.getPaymentInstructions('0'), /INSTRUCTIONS_LOCKED/);
  assert.equal(f.calls.instructions, 1);
});

test('mutated wallet envelope is rejected before submission', async () => {
  const f = fixture({ mutateTransaction: true });
  await f.service.connectWallet('buyer');
  await assert.rejects(f.service.beginPayment('0'), /WALLET_CHANGED_TRANSACTION/);
  assert.equal(f.calls.submit, 0);
});

test('unknown submission stays journaled and retry never signs or sends a second transaction', async () => {
  const f = fixture({ pending: true });
  await f.service.connectWallet('buyer');
  await assert.rejects(f.service.beginPayment('0'), /PENDING_RECONCILIATION/);
  await assert.rejects(f.service.beginPayment('0'), /PENDING_RECONCILIATION/);
  assert.equal(f.journal.get(`${contract}:begin_payment:0`).state, 'submitted-or-unknown');
  assert.equal(f.calls.sign, 1);
  assert.equal(f.calls.submit, 1);
});

test('synthetic policy results cannot reach the live release transaction path', async () => {
  const f = fixture({ synthetic: true });
  await f.service.connectWallet('buyer');
  await assert.rejects(f.service.release('0', 'opaque'), /UNTRUSTED_POLICY_AUTHORIZATION/);
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
});

test('independent adapter instances share one atomic journal reservation before prompting', async () => {
  const first = fixture();
  const second = fixture({ journalPath: first.journalPath });
  await first.service.connectWallet('buyer');
  await second.service.connectWallet('buyer');
  const results = await Promise.allSettled([
    first.service.beginPayment('0'),
    second.service.beginPayment('0'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(first.calls.sign + second.calls.sign, 1);
  assert.equal(first.calls.submit + second.calls.submit, 1);
});

test('canonical signed claim prepares release and receipt requires matching token event evidence', async () => {
  const f = fixture();
  await f.service.connectWallet('buyer');
  f.current.state = ['Paying'];
  f.current.locked_at = '950';
  const result = await f.service.release('0', 'opaque');
  assert.equal(result.order.state, 'Released');
  const receipt = await f.service.reconcileReceipt('0', result.transaction);
  assert.equal(receipt.buyerReceivedAtoms, '220000000');
  assert.equal(receipt.sellerReturnedAtoms, '0');
  const original = f.server.getTransaction;
  f.server.getTransaction = async () => ({
    ...(await original()),
    events: { contractEventsXdr: [] },
  });
  await assert.rejects(
    f.service.reconcileReceipt('0', result.transaction),
    /TOKEN_TRANSFER_EVIDENCE_MISSING/,
  );
  await assert.rejects(
    f.service.reconcileReceipt('1', result.transaction),
    /RECEIPT_ORDER_MISMATCH/,
  );
});

test('single-wallet recovery is unavailable until the dual-wallet workflow is implemented', async () => {
  await assert.rejects(
    fixture().service.resolve('0', '0'),
    /DUAL_WALLET_AUTHORIZATION_WORKFLOW_REQUIRED/,
  );
});
