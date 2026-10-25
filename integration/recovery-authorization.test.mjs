import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  authorizeEntry,
  buildWithDelegatesEntry,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { prepareRecoveryTransaction } from './recovery-authorization.mjs';

// Disposable test identities only. Every RPC and wallet port stays in-process.
const buyer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x66));
const seller = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x77));
const stranger = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x78));
const contract = Address.contract(Buffer.alloc(32, 5)).toString();
const root = (orderId = 7n, buyerTokens = 100n, subInvocations = []) =>
  new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contract).toScAddress(),
        functionName: 'resolve',
        args: [
          nativeToScVal(orderId, { type: 'u64' }),
          nativeToScVal(buyerTokens, { type: 'i128' }),
        ],
      }),
    ),
    subInvocations,
  });
const addressEntry = (invocation = root(), nonce = 42n, account = seller.publicKey()) =>
  new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(account).toScAddress(),
        nonce,
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
  });
const accountEntry = (account, thresholds = [1, 0, 0, 0]) =>
  new xdr.AccountEntry({
    accountId: Keypair.fromPublicKey(account).xdrPublicKey(),
    balance: 0n,
    seqNum: 10n,
    numSubEntries: 0,
    inflationDest: null,
    flags: 0,
    homeDomain: '',
    thresholds: Buffer.from(thresholds),
    signers: [],
    ext: xdr.AccountEntryExt.v0(),
  });

function fixture(options = {}) {
  let sequence = 100;
  const calls = { seller: 0, modes: [], signedTransactions: [] };
  const unsigned = addressEntry(options.root, options.nonce);
  const sourceEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: root(),
  });
  const transaction = new TransactionBuilder(new Account(buyer.publicKey(), '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(contract).call(
        'resolve',
        nativeToScVal(7n, { type: 'u64' }),
        nativeToScVal(100n, { type: 'i128' }),
      ),
    )
    .setTimeout(60)
    .build();
  const sellerPort = {
    selected: async () => (options.wrongAccount ? stranger.publicKey() : seller.publicKey()),
    network: async () => (options.wrongNetwork ? Networks.PUBLIC : Networks.TESTNET),
    async signAuthorization(request) {
      calls.seller++;
      calls.request = request;
      if (options.response) return options.response(request);
      const entry = xdr.SorobanAuthorizationEntry.fromXDR(request.entryXdr, 'base64');
      const signed = await authorizeEntry(
        entry,
        options.signer ?? seller,
        request.expirationLedger + (options.expiryChange ?? 0),
        options.signNetwork ?? request.networkPassphrase,
      );
      if (options.expireAfterSeller) sequence = request.expirationLedger;
      return signed.toXDR('base64');
    },
  };
  const server = {
    getAccountEntry: async (account) =>
      options.multisig
        ? { ...accountEntry(account), signers: [{}] }
        : accountEntry(account, options.thresholds),
    getLatestLedger: async () => ({ sequence }),
    async simulateTransaction(tx, _resources, mode) {
      calls.modes.push(mode);
      if (mode === 'enforce') {
        calls.signedTransactions.push(tx);
        if (options.enforceFails) return { error: 'rejected', latestLedger: sequence };
      }
      return {
        _parsed: true,
        transactionData: new SorobanDataBuilder(),
        minResourceFee: '0',
        events: [],
        latestLedger: sequence,
        result: {
          auth: options.entries ?? (options.omitSource ? [unsigned] : [sourceEntry, unsigned]),
          retval: xdr.ScVal.scvVoid(),
        },
      };
    },
  };
  const input = {
    transaction,
    server,
    contract,
    orderId: '7',
    buyerTokens: '100',
    buyer: buyer.publicKey(),
    seller: seller.publicKey(),
    recovery: { seller: sellerPort },
    maxFeeStroops: '10000',
  };
  return {
    input,
    calls,
    server,
    unsigned,
    setSequence(value) {
      sequence = value;
    },
  };
}

test('real SDK seller authorization and buyer envelope bind the same exact recovery call', async () => {
  const f = fixture();
  const result = await prepareRecoveryTransaction(f.input);
  assert.equal(f.calls.seller, 1);
  assert.equal(f.calls.request.expirationLedger, 112);
  assert.equal(f.calls.request.orderId, '7');
  assert.equal(f.calls.request.buyerTokens, '100');
  assert.equal(result.transaction.operations[0].auth.length, 2);
  assert.equal(result.transaction.operations[0].auth[1].credentials.addressV2.nonce, 42n);
  result.transaction.sign(buyer);
  await result.validateSigned(result.transaction);
  assert.deepEqual(f.calls.modes, ['record', 'enforce', 'enforce']);
  assert.equal(f.calls.signedTransactions[1].signatures.length, 1);
});

test('simulation may omit the source credential because the buyer signs the envelope', async () => {
  const f = fixture({ omitSource: true });
  const result = await prepareRecoveryTransaction(f.input);
  assert.equal(result.transaction.operations[0].auth.length, 1);
  await assert.rejects(result.validateSigned(result.transaction), /WALLET_SIGNATURE_MISSING/);
});

test('changed allocation, order or injected subinvocation are rejected before a wallet prompt', async () => {
  for (const invocation of [root(7n, 101n), root(8n), root(7n, 100n, [root()])]) {
    const f = fixture({ root: invocation });
    await assert.rejects(prepareRecoveryTransaction(f.input), /INVOCATION_MISMATCH/);
    assert.equal(f.calls.seller, 0);
  }
});

test('missing, duplicate, wrong-party and delegated address requirements fail closed', async () => {
  const delegated = buildWithDelegatesEntry({
    entry: addressEntry(),
    validUntilLedgerSeq: 112,
    delegates: [{ address: stranger.publicKey() }],
  });
  for (const entries of [
    [],
    [addressEntry(), addressEntry()],
    [addressEntry(root(), 42n, stranger.publicKey())],
    [delegated],
  ]) {
    const f = fixture({ entries });
    await assert.rejects(prepareRecoveryTransaction(f.input), /AUTH_MISMATCH/);
    assert.equal(f.calls.seller, 0);
  }
});

test('wrong selected account/network and unsupported account thresholds reject before signing', async () => {
  for (const options of [
    { wrongAccount: true },
    { wrongNetwork: true },
    { thresholds: [0, 1, 1, 1] },
    { thresholds: [1, 1, 2, 2] },
    { multisig: true },
  ]) {
    const f = fixture(options);
    await assert.rejects(
      prepareRecoveryTransaction(f.input),
      /WALLET_MISMATCH|ACCOUNT_UNSUPPORTED/,
    );
    assert.equal(f.calls.seller, 0);
  }
});

test('actual SDK signatures for another party or network and changed expiration are rejected', async () => {
  for (const options of [
    { signer: stranger },
    { signNetwork: Networks.PUBLIC },
    { expiryChange: 1 },
  ]) {
    const f = fixture(options);
    await assert.rejects(
      prepareRecoveryTransaction(f.input),
      /SIGNATURE_INVALID|AUTHORIZATION_CHANGED/,
    );
    assert.deepEqual(f.calls.modes, ['record']);
  }
});

test('wallet cannot replace order or allocation even with a valid seller signature', async () => {
  for (const invocation of [root(8n), root(7n, 101n)]) {
    const f = fixture({
      response: async (request) =>
        (
          await authorizeEntry(
            addressEntry(invocation),
            seller,
            request.expirationLedger,
            request.networkPassphrase,
          )
        ).toXDR('base64'),
    });
    await assert.rejects(prepareRecoveryTransaction(f.input), /AUTHORIZATION_CHANGED/);
  }
});

test('replayed seller entry from another simulation nonce is rejected', async () => {
  const f = fixture({
    nonce: 43n,
    response: async (request) =>
      (
        await authorizeEntry(
          addressEntry(),
          seller,
          request.expirationLedger,
          request.networkPassphrase,
        )
      ).toXDR('base64'),
  });
  await assert.rejects(prepareRecoveryTransaction(f.input), /AUTHORIZATION_CHANGED/);
});

test('expiry is exclusive and checked after either wallet delay', async () => {
  const sellerDelayed = fixture({ expireAfterSeller: true });
  await assert.rejects(prepareRecoveryTransaction(sellerDelayed.input), /AUTHORIZATION_EXPIRED/);
  const buyerDelayed = fixture();
  const result = await prepareRecoveryTransaction(buyerDelayed.input);
  result.transaction.sign(buyer);
  buyerDelayed.setSequence(112);
  await assert.rejects(result.validateSigned(result.transaction), /AUTHORIZATION_EXPIRED/);
});

test('failed auth enforcement and post-approval envelope mutation never pass validation', async () => {
  await assert.rejects(
    prepareRecoveryTransaction(fixture({ enforceFails: true }).input),
    /SIMULATION_FAILED/,
  );
  const f = fixture();
  const result = await prepareRecoveryTransaction(f.input);
  const changed = TransactionBuilder.cloneFrom(result.transaction, { fee: '999' }).build();
  changed.sign(buyer);
  await assert.rejects(result.validateSigned(changed), /WALLET_CHANGED_TRANSACTION/);
});
