import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  Account,
  Asset,
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { claimDigest } from '../contracts/escrow/protocol/protocol.mjs';
import { createStellarServices, freighterWalletPort } from './stellar-rpc-adapter.mjs';
import { TransactionJournal } from './transaction-journal.mjs';
import { actionKey } from './deployment-config.mjs';
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
const sellerKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x77));
const seller = sellerKey.publicKey();
const deployment = {
  network: 'testnet',
  escrowWasmSha256: '08'.repeat(32),
  networkPassphrase: Networks.TESTNET,
  rpcUrl: 'https://rpc.example.test',
  contract,
  token,
  tokenDecimals: 7,
  policySignerPublicKeyHex: Buffer.from(signer.rawPublicKey()).toString('hex'),
  maxFeeStroops: '10000',
};
const scAddress = (value) => new Address(value).toScVal();
const scMap = (values) =>
  xdr.ScVal.scvMap(
    Object.entries(values)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val })),
  );
const accountEntry = (accountId) =>
  new xdr.AccountEntry({
    accountId,
    balance: 0n,
    seqNum: 10n,
    numSubEntries: 0,
    inflationDest: null,
    flags: 0,
    homeDomain: '',
    thresholds: Buffer.from([1, 0, 0, 0]),
    signers: [],
    ext: xdr.AccountEntryExt.v0(),
  });

function transferEvent(token) {
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
  const network = options.network ?? 'testnet';
  const networkPassphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  const policyKey = options.policyKey ?? (network === 'mainnet' ? Keypair.random() : signer);
  const asset =
    network === 'mainnet' || options.asset
      ? new Asset('USDC', Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x88)).publicKey())
      : null;
  const cfg = {
    ...deployment,
    network,
    networkPassphrase,
    policySignerPublicKeyHex: Buffer.from(policyKey.rawPublicKey()).toString('hex'),
    ...(asset
      ? {
          asset: { code: asset.getCode(), issuer: asset.getIssuer() },
          token: asset.contractId(networkPassphrase),
        }
      : {}),
    ...(network === 'mainnet'
      ? { allowMainnetSubmission: options.allowMainnetSubmission === true }
      : {}),
    ...options.deployment,
  };
  const calls = { sign: 0, submit: 0, instructions: 0, sellerAuthorization: 0 };
  let sent;
  const current = {
    buyer: buyer.publicKey(),
    state: [options.state ?? 'Reserved'],
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
    getNetwork: async () => ({
      passphrase: options.rpcNetwork ?? cfg.networkPassphrase,
      protocolVersion: 29,
    }),
    getAccount: async () => new Account(buyer.publicKey(), '10'),
    getAccountEntry: async (account) => accountEntry(Keypair.fromPublicKey(account).xdrPublicKey()),
    getLatestLedger: async () => ({ closeTime: '1000', sequence: 100, protocolVersion: 29 }),
    getLedgerEntries: async (...keys) => {
      const entries = keys.flatMap((key) => {
        let data;
        if (key.type === 'account') {
          if (options.accountMissing) return [];
          data = xdr.LedgerEntryData.account(accountEntry(key.account.accountId));
        } else if (key.type === 'trustline') {
          if (options.trustlineMissing) return [];
          data = xdr.LedgerEntryData.trustline(
            new xdr.TrustLineEntry({
              accountId: key.trustLine.accountId,
              asset: key.trustLine.asset,
              balance: 0n,
              limit: options.trustlineLimit ?? 10000000000n,
              flags: options.trustlineFlags ?? 1,
              ext: xdr.TrustLineEntryExt.v0(),
            }),
          );
        } else {
          assert.equal(key.type, 'contractData');
          const isEscrow =
            Address.fromScAddress(key.contractData.contract).toString() === cfg.contract;
          const val = xdr.ScVal.scvContractInstance(
            new xdr.ScContractInstance({
              executable: isEscrow
                ? xdr.ContractExecutable.contractExecutableWasm(
                    Buffer.from(options.ledgerWasm ?? cfg.escrowWasmSha256, 'hex'),
                  )
                : xdr.ContractExecutable.contractExecutableStellarAsset(),
              storage: isEscrow
                ? [
                    new xdr.ScMapEntry({
                      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Config')]),
                      val: scMap({
                        token: scAddress(options.ledgerToken ?? cfg.token),
                        signer: xdr.ScVal.scvBytes(
                          Buffer.from(cfg.policySignerPublicKeyHex, 'hex'),
                        ),
                      }),
                    }),
                  ]
                : [],
            }),
          );
          data = xdr.LedgerEntryData.contractData(
            new xdr.ContractDataEntry({
              ext: xdr.ExtensionPoint.v0(),
              ...key.contractData,
              val,
            }),
          );
        }
        return [
          {
            key: xdr.LedgerKey.fromXDR(key.toXDR()),
            val: xdr.LedgerEntryData.fromXDR(data.toXDR()),
            lastModifiedLedgerSeq: 95,
            liveUntilLedgerSeq: 200,
          },
        ];
      });
      return { latestLedger: 100, entries };
    },
    getLedgers: async (request) => {
      assert.deepEqual(request, { startLedger: 100, pagination: { limit: 1 } });
      return { ledgers: [{ sequence: 100, ledgerCloseTime: '1000' }] };
    },
    simulateTransaction: async (tx) => {
      const method = tx.operations[0].func.invokeContract.functionName.toString();
      if (method === 'resolve') {
        const rootInvocation = new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            tx.operations[0].func.invokeContract,
          ),
          subInvocations: [],
        });
        return {
          _parsed: true,
          transactionData: new SorobanDataBuilder(),
          minResourceFee: '0',
          events: [],
          latestLedger: 100,
          result: {
            retval: xdr.ScVal.scvVoid(),
            auth: [
              new xdr.SorobanAuthorizationEntry({
                rootInvocation,
                credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
                  new xdr.SorobanAddressCredentials({
                    address: new Address(seller).toScAddress(),
                    nonce: 42n,
                    signatureExpirationLedger: 0,
                    signature: xdr.ScVal.scvVoid(),
                  }),
                ),
              }),
            ],
          },
        };
      }
      const values = {
        get_order: current,
        get_config: { token: cfg.token, signer: Buffer.from(policyKey.rawPublicKey()) },
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
    prepareTransaction: async (tx) => {
      if (options.prepareError) throw options.prepareError;
      return tx;
    },
    sendTransaction: async (tx) => {
      calls.submit++;
      sent = tx;
      const method = tx.operations[0].func.invokeContract.functionName.toString();
      if (method === 'reserve') {
        current.state = ['Reserved'];
        current.buyer = buyer.publicKey();
      }
      if (method === 'begin_payment') {
        current.state = ['Paying'];
        current.locked_at = '950';
      }
      if (method === 'release') current.state = ['Released'];
      if (method === 'resolve') current.state = ['Resolved'];
      return { status: 'PENDING', hash: Buffer.from(tx.hash()).toString('hex') };
    },
    getTransaction: async () =>
      options.pending
        ? { status: 'NOT_FOUND' }
        : {
            status: 'SUCCESS',
            ledger: 101,
            envelopeXdr: sent.toEnvelope(),
            events: { contractEventsXdr: [[transferEvent(cfg.token)]] },
          },
  };
  const wallet = {
    connect: async () => buyer.publicKey(),
    selected: async () => buyer.publicKey(),
    network: async () =>
      options.wrongNetwork
        ? network === 'mainnet'
          ? Networks.TESTNET
          : Networks.PUBLIC
        : cfg.networkPassphrase,
    sign: async (value) => {
      calls.sign++;
      if (options.signError) throw options.signError;
      if (options.malformedEnvelope) return 'invalid-signed-envelope';
      let tx = TransactionBuilder.fromXDR(value, options.signNetwork ?? cfg.networkPassphrase);
      if (options.mutateTransaction) tx = TransactionBuilder.cloneFrom(tx, { fee: '999' }).build();
      tx.sign(buyer);
      if (options.beforeSignReturn) await options.beforeSignReturn();
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
    token: options.claimToken ?? cfg.token,
    token_amount: '220000000',
  };
  const approved = {
    syntheticOnly: false,
    releaseGate: 'POLICY_ACCEPTED',
    domain: { network_passphrase: options.policyDomainNetwork ?? cfg.networkPassphrase, contract },
    claim,
    signatureHex: Buffer.from(
      policyKey.sign(
        claimDigest({
          network_passphrase: options.policySignNetwork ?? cfg.networkPassphrase,
          contract,
          claim,
        }),
      ),
    ).toString('hex'),
  };
  const directory = options.journalPath ? null : mkdtempSync(join(tmpdir(), 'pactlane-rpc-unit-'));
  const journalPath = options.journalPath ?? join(directory, 'transactions.sqlite');
  const journal = new TransactionJournal(journalPath);
  resources.push({ journal, directory });
  const service = createStellarServices({
    deployment: cfg,
    clock: () => options.now ?? '1000',
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
    recovery: options.recovery
      ? {
          seller: {
            selected: async () => seller,
            network: async () => cfg.networkPassphrase,
            signAuthorization: async (request) => {
              calls.sellerAuthorization++;
              calls.sellerRequest = request;
              if (options.sellerRejects) throw new Error('SELLER_REJECTED');
              return (
                await authorizeEntry(
                  xdr.SorobanAuthorizationEntry.fromXDR(request.entryXdr, 'base64'),
                  sellerKey,
                  request.expirationLedger,
                  options.sellerSignNetwork ?? request.networkPassphrase,
                )
              ).toXDR('base64');
            },
          },
        }
      : undefined,
  });
  return {
    service,
    server,
    calls,
    current,
    journal,
    journalPath,
    cfg,
    key: (method, id) => actionKey(service.deployment, method, id),
    sent: () => sent,
  };
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

test('Freighter explicit decline is distinct from generic errors or a returned envelope', async () => {
  for (const [response, expected] of [
    [{ error: { code: -4 }, signedTxXdr: '', signerAddress: '' }, /WALLET_REJECTED/],
    [{ error: { code: -1 }, signedTxXdr: '', signerAddress: '' }, /WALLET_SIGNING_FAILED/],
    [
      { error: { code: -4 }, signedTxXdr: '', signerAddress: buyer.publicKey() },
      /WALLET_SIGNING_FAILED/,
    ],
    [
      { error: { code: -4 }, signedTxXdr: 'returned-envelope', signerAddress: buyer.publicKey() },
      /WALLET_SIGNING_FAILED/,
    ],
  ]) {
    const wallet = freighterWalletPort({ signTransaction: async () => response });
    await assert.rejects(wallet.sign('unsigned', buyer.publicKey()), expected);
  }
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
  const f = fixture({ asset: true });
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
  assert.equal(f.journal.get(f.key('begin_payment', '0')).state, 'submitted-or-unknown');
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

test('recovery without a second wallet authorization port fails closed', async () => {
  await assert.rejects(
    fixture().service.resolve('0', '0'),
    /DUAL_WALLET_AUTHORIZATION_WORKFLOW_REQUIRED/,
  );
});

test('mutual recovery collects seller auth and buyer envelope once, then reconciles journaled replay', async () => {
  const f = fixture({ recovery: true });
  await f.service.connectWallet('buyer');
  const result = await f.service.resolve('0', '100000000');
  assert.equal(result.order.state, 'Resolved');
  assert.equal(f.calls.sellerAuthorization, 1);
  assert.equal(f.calls.sign, 1);
  assert.equal(f.calls.submit, 1);
  assert.equal(f.sent().signatures.length, 1);
  assert.equal(f.sent().operations[0].auth[0].credentials.type, 'sorobanCredentialsAddressV2');
  const replay = await f.service.resolve('0', '100000000');
  assert.deepEqual(replay.transaction, result.transaction);
  await assert.rejects(f.service.resolve('0', '100000001'), /TRANSACTION_ARGUMENT_MISMATCH/);
  assert.equal(f.calls.sellerAuthorization, 1);
  assert.equal(f.calls.sign, 1);
  assert.equal(f.calls.submit, 1);
});

test('recovery requires submission permission and a valid split before either wallet signs', async () => {
  for (const options of [{ submissionEnabled: false }, {}]) {
    const f = fixture({ recovery: true, ...options });
    await f.service.connectWallet('buyer');
    await assert.rejects(
      f.service.resolve('0', options.submissionEnabled === false ? '0' : '220000001'),
      /SUBMISSION_NOT_AUTHORIZED|INVALID_RESOLUTION_SPLIT/,
    );
    assert.equal(f.calls.sellerAuthorization, 0);
    assert.equal(f.calls.sign, 0);
    assert.equal(f.calls.submit, 0);
  }
});

test('seller refusal never refunds and permits an explicitly requested revised recovery proposal', async () => {
  const options = { recovery: true, sellerRejects: true };
  const f = fixture(options);
  await f.service.connectWallet('buyer');
  await assert.rejects(f.service.resolve('0', '0'), /TRANSACTION_PREPARATION_RETRYABLE/);
  assert.equal(f.current.state[0], 'Reserved');
  assert.equal(f.calls.sellerAuthorization, 1);
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
  options.sellerRejects = false;
  await f.service.resolve('0', '100000000');
  assert.equal(f.calls.sellerAuthorization, 2);
  assert.equal(f.calls.sign, 1);
  assert.equal(f.calls.submit, 1);
  const attempts = f.journal
    .history(f.key('resolve', '0'))
    .filter((row) => row.state === 'preparing');
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0].argumentsHash, attempts[1].argumentsHash);
});

test('concurrent recovery proposals cannot silently share different allocations', async () => {
  const f = fixture({ recovery: true });
  await f.service.connectWallet('buyer');
  const outcomes = await Promise.allSettled([
    f.service.resolve('0', '100000000'),
    f.service.resolve('0', '100000001'),
  ]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.match(outcomes[1].reason.message, /TRANSACTION_ARGUMENT_MISMATCH/);
  assert.equal(f.calls.sellerAuthorization, 1);
  assert.equal(f.calls.sign, 1);
  assert.equal(f.calls.submit, 1);
});

test('a fresh adapter reconciles persisted recovery without collecting signatures again', async () => {
  const first = fixture({ recovery: true });
  await first.service.connectWallet('buyer');
  const result = await first.service.resolve('0', '100000000');
  const second = fixture({ recovery: true, journalPath: first.journalPath });
  second.current.state = ['Resolved'];
  second.server.getTransaction = first.server.getTransaction;
  await second.service.connectWallet('buyer');
  assert.deepEqual(
    (await second.service.resolve('0', '100000000')).transaction,
    result.transaction,
  );
  assert.equal(second.calls.sellerAuthorization, 0);
  assert.equal(second.calls.sign, 0);
  assert.equal(second.calls.submit, 0);
});

test('preparation failure is durably retryable without leaking its error or invoking signing', async () => {
  const options = { prepareError: new Error('PRIVATE_RPC_DATA') };
  const f = fixture(options);
  await f.service.connectWallet('buyer');
  await assert.rejects(f.service.beginPayment('0'), {
    message: 'TRANSACTION_PREPARATION_RETRYABLE',
  });
  assert.equal(f.journal.get(f.key('begin_payment', '0')).state, 'retryable');
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
  options.prepareError = undefined;
  await f.service.beginPayment('0');
  assert.equal(f.calls.sign, 1);
  assert.equal(f.calls.submit, 1);
  assert.equal(
    f.journal.history(f.key('begin_payment', '0')).filter((row) => row.state === 'preparing')
      .length,
    2,
  );
});

test('explicit buyer refusal allows a later user-requested attempt', async () => {
  const options = {
    signError: Object.assign(new Error('WALLET_REJECTED'), { code: 'WALLET_REJECTED' }),
  };
  const f = fixture(options);
  await f.service.connectWallet('buyer');
  await assert.rejects(f.service.beginPayment('0'), /WALLET_REJECTED/);
  assert.equal(f.journal.get(f.key('begin_payment', '0')).state, 'retryable');
  assert.equal(f.calls.submit, 0);
  options.signError = undefined;
  await f.service.beginPayment('0');
  assert.equal(f.calls.sign, 2);
  assert.equal(f.calls.submit, 1);
  const history = f.journal.history(f.key('begin_payment', '0'));
  assert.equal(history.filter((row) => row.state === 'preparing').length, 2);
  assert.equal(history.find((row) => row.state === 'retryable').code, 'WALLET_REJECTED');
});

test('generic signer errors and timeouts retain the offered hash and never sign again', async () => {
  for (const code of ['WALLET_TIMEOUT', 'SESSION_EXPIRED', 'PROVIDER_UNAVAILABLE']) {
    const f = fixture({ signError: Object.assign(new Error(code), { code }), pending: true });
    await f.service.connectWallet('buyer');
    await assert.rejects(f.service.beginPayment('0'), new RegExp(code));
    const saved = f.journal.get(f.key('begin_payment', '0'));
    assert.equal(saved.state, 'signing');
    assert.match(saved.hash, /^[a-f0-9]{64}$/);
    await assert.rejects(f.service.beginPayment('0'), /TRANSACTION_PENDING_RECONCILIATION/);
    assert.equal(f.calls.sign, 1);
    assert.equal(f.calls.submit, 0);
  }
});

test('every returned envelope prevents retry, including malformed and changed transactions', async () => {
  for (const options of [{ malformedEnvelope: true }, { mutateTransaction: true }]) {
    const f = fixture({ ...options, pending: true });
    await f.service.connectWallet('buyer');
    await assert.rejects(f.service.beginPayment('0'));
    assert.equal(f.journal.get(f.key('begin_payment', '0')).state, 'signed');
    await assert.rejects(f.service.beginPayment('0'), /TRANSACTION_PENDING_RECONCILIATION/);
    assert.equal(f.calls.sign, 1);
    assert.equal(f.calls.submit, 0);
  }
});

test('a stale signing continuation cannot store or submit after its owned attempt is replaced', async () => {
  const options = {};
  const f = fixture(options);
  const key = f.key('begin_payment', '0');
  options.beforeSignReturn = async () => {
    const [active] = f.journal.history(key).slice(-1);
    f.journal.markRetryable(key, active.attempt, 'WALLET_REJECTED');
    const replacement = f.journal.reserve(key, {
      method: 'begin_payment',
      argumentsHash: active.argumentsHash,
    });
    assert.notEqual(replacement, active.attempt);
  };
  await f.service.connectWallet('buyer');
  await assert.rejects(f.service.beginPayment('0'), /ATTEMPT_NOT_OWNED/);
  assert.equal(f.journal.get(key).state, 'preparing');
  assert.equal(f.calls.submit, 0);
});

test('explicit mainnet reserve and mutual recovery use the derived asset and mainnet signatures', async () => {
  const f = fixture({
    network: 'mainnet',
    allowMainnetSubmission: true,
    state: 'Funded',
    recovery: true,
  });
  await f.service.connectWallet('buyer');
  const reserved = await f.service.reserve('0', buyer.publicKey());
  assert.equal(reserved.order.state, 'Reserved');
  assert.equal(reserved.transaction.networkPassphrase, Networks.PUBLIC);
  const resolved = await f.service.resolve('0', '100000000');
  assert.equal(resolved.order.state, 'Resolved');
  assert.equal(resolved.transaction.networkPassphrase, Networks.PUBLIC);
  assert.equal(f.calls.sellerRequest.token, f.cfg.token);
  assert.equal(f.calls.sellerRequest.network, 'mainnet');
  assert.equal(f.calls.sellerRequest.deploymentId, f.service.deployment.deploymentId);
  assert.equal(f.calls.sellerAuthorization, 1);
  assert.equal(f.calls.sign, 2);
  assert.equal(f.calls.submit, 2);
  assert.equal(f.journal.get(f.key('resolve', '0')).state, 'confirmed');
  assert.equal(f.journal.get(`${contract}:resolve:0`), null);
});

test('mainnet needs both submission permissions, and new payment locks stay unavailable', async () => {
  for (const options of [
    { allowMainnetSubmission: false },
    { allowMainnetSubmission: true, submissionEnabled: false },
  ]) {
    const f = fixture({ network: 'mainnet', recovery: true, ...options });
    await f.service.connectWallet('buyer');
    await assert.rejects(
      f.service.reserve('0', buyer.publicKey()),
      /MAINNET_SUBMISSION_NOT_AUTHORIZED/,
    );
    await assert.rejects(f.service.resolve('0', '0'), /MAINNET_SUBMISSION_NOT_AUTHORIZED/);
    assert.equal(f.calls.sign, 0);
    assert.equal(f.calls.sellerAuthorization, 0);
    assert.equal(f.calls.submit, 0);
  }
  const f = fixture({ network: 'mainnet', allowMainnetSubmission: true });
  await f.service.connectWallet('buyer');
  await assert.rejects(f.service.beginPayment('0'), /PAYMENT_VERIFICATION_UNAVAILABLE/);
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
});

test('mainnet rejects wrong RPC or wallet network and signatures made for testnet', async () => {
  for (const options of [{ wrongNetwork: true }, { rpcNetwork: Networks.TESTNET }]) {
    const f = fixture({ network: 'mainnet', allowMainnetSubmission: true, ...options });
    await assert.rejects(f.service.connectWallet('buyer'), /NETWORK_MISMATCH/);
    assert.equal(f.calls.sign, 0);
    assert.equal(f.calls.submit, 0);
  }
  const buyerWrong = fixture({
    network: 'mainnet',
    allowMainnetSubmission: true,
    signNetwork: Networks.TESTNET,
  });
  await buyerWrong.service.connectWallet('buyer');
  await assert.rejects(
    buyerWrong.service.reserve('0', buyer.publicKey()),
    /WALLET_SIGNATURE_MISSING/,
  );
  assert.equal(buyerWrong.journal.get(buyerWrong.key('reserve', '0')).state, 'signed');
  assert.equal(buyerWrong.calls.submit, 0);
  const sellerWrong = fixture({
    network: 'mainnet',
    allowMainnetSubmission: true,
    recovery: true,
    sellerSignNetwork: Networks.TESTNET,
  });
  await sellerWrong.service.connectWallet('buyer');
  await assert.rejects(sellerWrong.service.resolve('0', '0'), /TRANSACTION_PREPARATION_RETRYABLE/);
  assert.equal(sellerWrong.calls.sellerAuthorization, 1);
  assert.equal(sellerWrong.calls.sign, 0);
  assert.equal(sellerWrong.calls.submit, 0);
});

test('mainnet claim token, claim network and policy signature must match the configured deployment', async () => {
  for (const [options, error] of [
    [{ claimToken: token }, /UNTRUSTED_POLICY_AUTHORIZATION/],
    [{ policyDomainNetwork: Networks.TESTNET }, /UNTRUSTED_POLICY_AUTHORIZATION/],
    [{ policySignNetwork: Networks.TESTNET }, /POLICY_SIGNATURE_INVALID/],
  ]) {
    const f = fixture({ network: 'mainnet', allowMainnetSubmission: true, ...options });
    await f.service.connectWallet('buyer');
    f.current.state = ['Paying'];
    f.current.locked_at = '950';
    await assert.rejects(f.service.release('0', 'opaque'), error);
    assert.equal(f.calls.sign, 0);
    assert.equal(f.calls.submit, 0);
  }
});

test('actual ledger code and token mismatches stop before any wallet signing', async () => {
  for (const [options, error] of [
    [{ ledgerWasm: '99'.repeat(32) }, /CONTRACT_CODE_MISMATCH/],
    [{ ledgerToken: token }, /CONTRACT_CONFIGURATION_MISMATCH/],
  ]) {
    const f = fixture({ network: 'mainnet', allowMainnetSubmission: true, ...options });
    await assert.rejects(f.service.connectWallet('buyer'), error);
    assert.equal(f.calls.sign, 0);
    assert.equal(f.calls.submit, 0);
  }
});

test('receiving capacity and authorization are required before a new reservation or instructions', async () => {
  for (const [options, error] of [
    [{ accountMissing: true }, /RECEIVING_ACCOUNT_MISSING/],
    [{ trustlineMissing: true }, /RECEIVING_TRUSTLINE_MISSING/],
    [{ trustlineFlags: 2 }, /RECEIVING_ASSET_UNAUTHORIZED/],
    [{ trustlineLimit: 219999999n }, /RECEIVING_CAPACITY_INSUFFICIENT/],
  ]) {
    const f = fixture({ network: 'mainnet', allowMainnetSubmission: true, ...options });
    await f.service.connectWallet('buyer');
    await assert.rejects(f.service.reserve('0', buyer.publicKey()), error);
    f.current.state = ['Paying'];
    f.current.locked_at = '950';
    await assert.rejects(f.service.getPaymentInstructions('0'), error);
    assert.equal(f.calls.instructions, 0);
    assert.equal(f.calls.sign, 0);
    assert.equal(f.calls.submit, 0);
  }
});

test('confirmed mainnet release reconciles after credit exhausts capacity without another signature', async () => {
  const options = { network: 'mainnet', allowMainnetSubmission: true };
  const f = fixture(options);
  await f.service.connectWallet('buyer');
  f.current.state = ['Paying'];
  f.current.locked_at = '950';
  const first = await f.service.release('0', 'opaque');
  assert.equal(first.order.state, 'Released');
  options.trustlineLimit = 0n;
  const reconciled = await f.service.release('0', 'opaque');
  assert.deepEqual(reconciled.transaction, first.transaction);
  const receipt = await f.service.reconcileReceipt('0', reconciled.transaction);
  assert.equal(receipt.buyerReceivedAtoms, '220000000');
  assert.equal(f.calls.sign, 1);
  assert.equal(f.calls.submit, 1);
});

test('legacy journal entries block new work; independent network keys never reuse an old action', async () => {
  const legacy = fixture();
  legacy.journal.reserve(`${contract}:begin_payment:0`, {
    method: 'begin_payment',
    argumentsHash: 'aa'.repeat(32),
  });
  await legacy.service.connectWallet('buyer');
  await assert.rejects(legacy.service.beginPayment('0'), /LEGACY_JOURNAL_REVIEW_REQUIRED/);
  assert.equal(legacy.calls.sign, 0);
  assert.equal(legacy.calls.submit, 0);

  const first = fixture({ pending: true });
  await first.service.connectWallet('buyer');
  await assert.rejects(first.service.reserve('0', buyer.publicKey()), /PENDING_RECONCILIATION/);
  const second = fixture({
    network: 'mainnet',
    allowMainnetSubmission: true,
    journalPath: first.journalPath,
  });
  await second.service.connectWallet('buyer');
  await second.service.reserve('0', buyer.publicKey());
  assert.notEqual(first.key('reserve', '0'), second.key('reserve', '0'));
  assert.equal(first.journal.get(first.key('reserve', '0')).state, 'submitted-or-unknown');
  assert.equal(second.journal.get(second.key('reserve', '0')).state, 'confirmed');
  assert.equal(second.calls.sign, 1);
  assert.equal(second.calls.submit, 1);
});

test('a directly composed Freighter port cannot silently use testnet for a mainnet service', async () => {
  let prompts = 0,
    requested;
  const api = {
    getNetworkDetails: async () => ({ networkPassphrase: Networks.PUBLIC }),
    requestAccess: async () => {
      prompts++;
      return { address: buyer.publicKey() };
    },
    signTransaction: async (_value, options) => {
      prompts++;
      requested = options.networkPassphrase;
      return { signedTxXdr: 'fixture', signerAddress: buyer.publicKey() };
    },
  };
  const implicit = freighterWalletPort(api);
  await assert.rejects(implicit.connect(), /WALLET_NETWORK_MISMATCH/);
  await assert.rejects(
    implicit.sign('fixture', buyer.publicKey(), Networks.PUBLIC),
    /WALLET_NETWORK_MISMATCH/,
  );
  assert.equal(prompts, 0);
  const explicit = freighterWalletPort(api, {
    network: 'mainnet',
    networkPassphrase: Networks.PUBLIC,
  });
  assert.equal(await explicit.connect(), buyer.publicKey());
  await explicit.sign('fixture', buyer.publicKey(), Networks.PUBLIC);
  assert.equal(requested, Networks.PUBLIC);
  assert.equal(prompts, 2);
});
