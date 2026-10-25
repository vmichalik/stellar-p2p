import test, { after } from 'node:test';
import assert from 'node:assert/strict';
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
import { claimDigest, recipientCommitment } from '../contracts/escrow/protocol/protocol.mjs';
import { hash, inspectAuthEntry } from '@stellar/stellar-sdk/base';
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
const sellerKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x77));
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

function transferEvent(recipient = buyer.publicKey(), amount = 220000000n) {
  return new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: StrContract(token),
    type: xdr.ContractEventType.contract,
    body: xdr.ContractEventBody.v0(
      new xdr.ContractEventV0({
        topics: [
          nativeToScVal('transfer', { type: 'symbol' }),
          scAddress(contract),
          scAddress(recipient),
        ],
        data: nativeToScVal(amount, { type: 'i128' }),
      }),
    ),
  });
}
function StrContract(value) {
  return new Address(value).toScAddress().contractId;
}

function resolveInvocation(args) {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contract).toScAddress(),
        functionName: 'resolve',
        args,
      }),
    ),
    subInvocations: [],
  });
  return invocation;
}

function unsignedResolveAuth(address, args) {
  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: resolveInvocation(args),
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(address).toScAddress(),
        nonce: xdr.Int64.fromString(address === seller ? '77' : '66'),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVec([]),
      }),
    ),
  });
}

function unsignedResolveSourceAuth(args) {
  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: resolveInvocation(args),
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
  });
}

function fixture(options = {}) {
  const calls = { sign: 0, submit: 0, instructions: 0, preparedAuthXdr: [] };
  let active = buyer.publicKey();
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
    getAccount: async () => new Account(options.wrongSource ? seller : active, '10'),
    getLatestLedger: async () => ({ closeTime: '1000', sequence: 100, protocolVersion: 29 }),
    simulateTransaction: async (tx) => {
      const method = tx.operations[0].func.invokeContract.functionName.toString();
      const values = {
        get_order: current,
        get_config: { token, signer: Buffer.from(signer.rawPublicKey()) },
        decimals: 7,
      };
      const auth =
        method === 'resolve'
          ? [
              ...(options.explicitSourceAuth
                ? [
                    unsignedResolveSourceAuth(
                      options.wrongSourceInvocation
                        ? [
                            nativeToScVal(1n, { type: 'u64' }),
                            tx.operations[0].func.invokeContract.args[1],
                          ]
                        : tx.operations[0].func.invokeContract.args,
                    ),
                  ]
                : []),
              unsignedResolveAuth(
                options.extraBuyerAuth ? buyer.publicKey() : seller,
                tx.operations[0].func.invokeContract.args,
              ),
            ]
          : [];
      return {
        _parsed: true,
        transactionData: {},
        minResourceFee: '0',
        events: [],
        latestLedger: 100,
        result: { auth, retval: nativeToScVal(values[method]) },
      };
    },
    prepareTransaction: async (tx) => {
      const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
      calls.preparedAuthXdr.push(
        (decoded.operations[0]?.auth ?? []).map((entry) =>
          Buffer.from(entry.toXDR()).toString('base64'),
        ),
      );
      return tx;
    },
    sendTransaction: async (tx) => {
      calls.submit++;
      sent = tx;
      const method = tx.operations[0].func.invokeContract.functionName.toString();
      if (method === 'begin_payment') {
        current.state = ['Paying'];
        current.locked_at = '950';
      }
      if (method === 'release') current.state = ['Released'];
      if (method === 'resolve') current.state = ['Resolved'];
      if (method === 'refund') current.state = ['Refunded'];
      if (method === 'fund') {
        current.state = ['Funded'];
        current.buyer = null;
      }
      return { status: 'PENDING', hash: Buffer.from(tx.hash()).toString('hex') };
    },
    getTransaction: async () => {
      if (options.pending) return { status: 'NOT_FOUND' };
      const method = sent.operations[0].func.invokeContract.functionName.toString();
      let events = [];
      if (method === 'release') events = [transferEvent(buyer.publicKey(), 220000000n)];
      if (method === 'refund') events = [transferEvent(seller, 220000000n)];
      if (method === 'resolve') {
        const amount = scValToNative(sent.operations[0].func.invokeContract.args[1]);
        if (amount > 0n) events.push(transferEvent(buyer.publicKey(), amount));
        if (220000000n - amount > 0n) events.push(transferEvent(seller, 220000000n - amount));
      }
      return {
        status: 'SUCCESS',
        ledger: 101,
        envelopeXdr: sent.toEnvelope(),
        ...(method === 'fund' ? { returnValue: nativeToScVal(0n, { type: 'u64' }) } : {}),
        events: { contractEventsXdr: [events] },
      };
    },
  };
  const wallet = {
    connect: async () => active,
    selected: async () => active,
    network: async () => (options.wrongNetwork ? Networks.PUBLIC : Networks.TESTNET),
    sign: async (value) => {
      calls.sign++;
      let tx = TransactionBuilder.fromXDR(value, Networks.TESTNET);
      if (options.mutateTransaction) tx = TransactionBuilder.cloneFrom(tx, { fee: '999' }).build();
      if (!options.missingBuyerSignature) tx.sign(active === seller ? sellerKey : buyer);
      return tx.toXDR();
    },
    signAuthEntry: async (preimageXdr, account) => {
      const signer = account === seller ? sellerKey : buyer;
      return Buffer.from(
        signer.sign(hash(xdr.HashIdPreimage.fromXDR(preimageXdr, 'base64').toXdr())),
      ).toString('base64');
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
    deployment: options.privateOffer
      ? { ...deployment, privateOffer: options.privateOffer }
      : deployment,
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
  return {
    service,
    server,
    calls,
    current,
    journal,
    journalPath,
    getSent: () => sent,
    setActive: (value) => {
      active = value;
    },
  };
}

test('wallet port uses official address, network and signed envelope fields', async () => {
  let signingOptions;
  let authSigningOptions;
  const wallet = freighterWalletPort({
    requestAccess: async () => ({ address: buyer.publicKey() }),
    getAddress: async () => ({ address: buyer.publicKey() }),
    getNetworkDetails: async () => ({ networkPassphrase: Networks.TESTNET }),
    signTransaction: async (_value, options) => {
      signingOptions = options;
      return { signedTxXdr: 'fixture', signerAddress: buyer.publicKey() };
    },
    signAuthEntry: async (_value, options) => {
      authSigningOptions = options;
      return { signedAuthEntry: 'c2lnbmF0dXJl', signerAddress: buyer.publicKey() };
    },
  });
  assert.equal(await wallet.connect(), buyer.publicKey());
  assert.equal(await wallet.network(), Networks.TESTNET);
  assert.equal(await wallet.sign('fixture', buyer.publicKey()), 'fixture');
  assert.deepEqual(signingOptions, {
    networkPassphrase: Networks.TESTNET,
    address: buyer.publicKey(),
  });
  assert.equal(await wallet.signAuthEntry('preimage', buyer.publicKey()), 'c2lnbmF0dXJl');
  assert.deepEqual(authSigningOptions, {
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

test('funding binds the configured seller and recipient commitment before any wallet prompt', async () => {
  const privateOffer = {
    seller,
    recipientId: 'configured-recipient',
    recipientSalt: 'ab'.repeat(32),
    destination: { handle: '@private' },
  };
  const commitment = recipientCommitment({
    recipient_id: privateOffer.recipientId,
    recipient_salt: privateOffer.recipientSalt,
  }).toString('hex');
  const f = fixture({ privateOffer });
  f.setActive(seller);
  await f.service.connectWallet('seller');
  const terms = {
    seller,
    token_amount: '220000000',
    fiat_minor: '2000',
    currency: 'EUR',
    rail: 'revolut',
    recipient: commitment,
    offer_expires_at: '4000',
    reservation_seconds: '200',
  };
  await assert.rejects(
    f.service.fund({ ...terms, recipient: '33'.repeat(32) }),
    /PRIVATE_OFFER_MISMATCH/,
  );
  await assert.rejects(
    f.service.fund({ ...terms, seller: buyer.publicKey() }),
    /INVALID_OFFER|PRIVATE_OFFER_MISMATCH/,
  );
  assert.equal(f.calls.sign, 0);
  const result = await f.service.fund(terms);
  assert.equal(result.order.state, 'Funded');
  assert.equal(f.calls.submit, 1);
});

test('seller can cancel a funded offer through the contract refund method', async () => {
  const f = fixture();
  f.current.state = ['Funded'];
  f.current.buyer = null;
  f.setActive(seller);
  await f.service.connectWallet('seller');
  const result = await f.service.cancelFundedOffer('0');
  assert.equal(result.order.state, 'Refunded');
  assert.equal(result.transaction.status, 'confirmed');
  const receipt = await f.service.reconcileReceipt('0', result.transaction);
  assert.equal(receipt.orderState, 'Refunded');
  assert.equal(receipt.sellerReturnedAtoms, '220000000');
  assert.equal(f.calls.submit, 1);
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

test('mutual recovery combines buyer source signature and seller Soroban auth entry', async () => {
  const f = fixture();
  f.setActive(seller);
  await f.service.connectWallet('seller');
  f.setActive(buyer.publicKey());
  await f.service.connectWallet('buyer');
  const result = await f.service.resolve('0', '80000000');
  assert.equal(result.order.state, 'Resolved');
  assert.equal(result.buyerTokens, '80000000');
  assert.equal(result.sellerTokens, '140000000');
  assert.equal(f.calls.sign, 1);
  assert.equal(f.calls.submit, 1);
  assert.equal(f.calls.preparedAuthXdr.length, 1);
  const preparedAuth = f.calls.preparedAuthXdr[0].map((entry) =>
    xdr.SorobanAuthorizationEntry.fromXDR(entry, 'base64'),
  );
  const envelopeAuth = TransactionBuilder.fromXDR(f.getSent().toXDR(), Networks.TESTNET)
    .operations[0].auth;
  assert.equal(preparedAuth.length, 1);
  assert.deepEqual(
    envelopeAuth.map((entry) => Buffer.from(entry.toXDR()).toString('base64')),
    f.calls.preparedAuthXdr[0],
  );
  const authInfo = inspectAuthEntry(preparedAuth[0]);
  assert.equal(authInfo.address, seller);
  assert.equal(authInfo.signed, true);
  assert.equal(
    String(preparedAuth[0].credentials.addressV2.nonce),
    String(envelopeAuth[0].credentials.addressV2.nonce),
  );
  const receipt = await f.service.reconcileReceipt('0', result.transaction);
  assert.equal(receipt.buyerReceivedAtoms, '80000000');
  assert.equal(receipt.sellerReturnedAtoms, '140000000');
  f.current.state = ['Released'];
  await assert.rejects(
    f.service.reconcileReceipt('0', result.transaction),
    /RECEIPT_ORDER_MISMATCH/,
  );
});

test('mutual recovery accepts an explicit source-account auth entry for buyer', async () => {
  const f = fixture({ explicitSourceAuth: true });
  f.setActive(seller);
  await f.service.connectWallet('seller');
  f.setActive(buyer.publicKey());
  await f.service.connectWallet('buyer');
  assert.equal((await f.service.resolve('0', '80000000')).order.state, 'Resolved');
  assert.equal(f.calls.submit, 1);
});

test('mutual recovery fails closed when seller auth or buyer source signature is missing', async () => {
  const f = fixture();
  f.setActive(seller);
  await f.service.connectWallet('seller');
  f.setActive(buyer.publicKey());
  await f.service.connectWallet('buyer');
  const simulate = f.server.simulateTransaction;
  f.server.simulateTransaction = async (...args) => {
    const result = await simulate(...args);
    if (args[0].operations[0].func.invokeContract.functionName.toString() === 'resolve') {
      result.result.auth.pop();
    }
    return result;
  };
  await assert.rejects(f.service.resolve('0', '80000000'), /SELLER_AUTHORIZATION_REQUIRED/);
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);

  const missingBuyer = fixture({ missingBuyerSignature: true });
  missingBuyer.setActive(seller);
  await missingBuyer.service.connectWallet('seller');
  missingBuyer.setActive(buyer.publicKey());
  await missingBuyer.service.connectWallet('buyer');
  await assert.rejects(missingBuyer.service.resolve('0', '80000000'), /WALLET_SIGNATURE_MISSING/);
  assert.equal(missingBuyer.calls.submit, 0);
});

test('mutual recovery rejects a wrong transaction source or source invocation', async () => {
  const wrongSource = fixture({ wrongSource: true });
  wrongSource.setActive(seller);
  await wrongSource.service.connectWallet('seller');
  wrongSource.setActive(buyer.publicKey());
  await wrongSource.service.connectWallet('buyer');
  await assert.rejects(
    wrongSource.service.resolve('0', '80000000'),
    /SOURCE_AUTHORIZATION_MISMATCH/,
  );
  assert.equal(wrongSource.calls.sign, 0);

  const wrongInvocation = fixture({ explicitSourceAuth: true, wrongSourceInvocation: true });
  wrongInvocation.setActive(seller);
  await wrongInvocation.service.connectWallet('seller');
  wrongInvocation.setActive(buyer.publicKey());
  await wrongInvocation.service.connectWallet('buyer');
  await assert.rejects(
    wrongInvocation.service.resolve('0', '80000000'),
    /AUTHORIZATION_INVOCATION_MISMATCH/,
  );
  assert.equal(wrongInvocation.calls.submit, 0);
});
