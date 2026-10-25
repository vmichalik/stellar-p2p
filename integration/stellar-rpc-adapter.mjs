import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {
  authorizeEntry,
  buildAuthorizationEntryPreimage,
  hash,
  inspectAuthEntry,
} from '@stellar/stellar-sdk/base';
import {
  claimDigest,
  claimScVal,
  recipientCommitment,
} from '../contracts/escrow/protocol/protocol.mjs';
import { isDurableTransactionJournal } from './transaction-journal.mjs';

const check = (condition, code) => {
  if (!condition) throw new Error(code);
};
const sameAuthEntries = (actual, expected) =>
  Array.isArray(actual) &&
  Array.isArray(expected) &&
  actual.length === expected.length &&
  actual.every((entry, index) =>
    Buffer.from(entry.toXDR()).equals(Buffer.from(expected[index].toXDR())),
  );
const integer = (value) => {
  check(
    typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 39,
    'INVALID_INTEGER',
  );
  return BigInt(value);
};
const u64 = (value) => {
  const n = integer(value);
  check(n <= (1n << 64n) - 1n, 'INVALID_U64');
  return nativeToScVal(n, { type: 'u64' });
};
const i128 = (value) => {
  const n = integer(value);
  check(n <= (1n << 127n) - 1n, 'INVALID_I128');
  return nativeToScVal(n, { type: 'i128' });
};
const addr = (value) => new Address(value).toScVal();
const hexBytes = (value, length) => {
  check(
    typeof value === 'string' && new RegExp(`^[a-f0-9]{${length * 2}}$`).test(value),
    'INVALID_BYTES',
  );
  return xdr.ScVal.scvBytes(Buffer.from(value, 'hex'));
};
const map = (fields) =>
  xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map((key) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: fields[key] })),
  );
const plain = (value) =>
  typeof value === 'bigint'
    ? value.toString()
    : value instanceof Uint8Array
      ? Buffer.from(value).toString('hex')
      : Array.isArray(value)
        ? value.map(plain)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]))
          : value;

export function freighterWalletPort(api) {
  return {
    async connect() {
      const result = await api.requestAccess();
      check(
        !result.error && StrKey.isValidEd25519PublicKey(result.address),
        'WALLET_ACCESS_FAILED',
      );
      return result.address;
    },
    async selected() {
      const result = await api.getAddress();
      check(!result.error, 'WALLET_UNAVAILABLE');
      return result.address;
    },
    async network() {
      const result = await api.getNetworkDetails();
      check(!result.error, 'WALLET_NETWORK_UNAVAILABLE');
      return result.networkPassphrase;
    },
    async sign(transactionXdr, account) {
      const result = await api.signTransaction(transactionXdr, {
        networkPassphrase: Networks.TESTNET,
        address: account,
      });
      check(!result.error && result.signerAddress === account, 'WALLET_SIGNING_FAILED');
      return result.signedTxXdr;
    },
    async signAuthEntry(entryXdr, account) {
      const result = await api.signAuthEntry(entryXdr, {
        networkPassphrase: Networks.TESTNET,
        address: account,
      });
      check(!result.error && result.signerAddress === account, 'WALLET_AUTH_SIGNING_FAILED');
      return result.signedAuthEntry;
    },
  };
}

/** Testnet-only implementation of the app's confirmed service boundary.
 * No default submission permission, signing key, proof-success adapter or journal.
 * Journal hints can block retries; they can never establish chain confirmation.
 */
export function createStellarServices({
  deployment,
  wallet,
  server,
  journal,
  policy,
  instructions,
  submissionEnabled = false,
  pollAttempts = 20,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const cfg = structuredClone(deployment);
  check(
    cfg?.networkPassphrase === Networks.TESTNET && /^https:\/\/[^?#]+$/.test(cfg.rpcUrl),
    'TESTNET_CONFIGURATION_REQUIRED',
  );
  check(
    StrKey.isValidContract(cfg.contract) &&
      StrKey.isValidContract(cfg.token) &&
      cfg.tokenDecimals === 7,
    'INVALID_DEPLOYMENT',
  );
  check(/^[a-f0-9]{64}$/.test(cfg.policySignerPublicKeyHex), 'SIGNER_CONFIGURATION_REQUIRED');
  check(
    typeof cfg.maxFeeStroops === 'string' && integer(cfg.maxFeeStroops) > 0n,
    'FEE_LIMIT_REQUIRED',
  );
  const testKeys = [0x11, 0x2a].map((n) =>
    Buffer.from(Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)).rawPublicKey()).toString('hex'),
  );
  check(!testKeys.includes(cfg.policySignerPublicKeyHex), 'PUBLIC_FIXTURE_SIGNER_FORBIDDEN');
  const remote = server ?? new rpc.Server(cfg.rpcUrl);
  const accounts = {};
  const inFlight = new Map();
  let readerAccount =
    typeof cfg.readerAccount === 'string' && StrKey.isValidEd25519PublicKey(cfg.readerAccount)
      ? cfg.readerAccount
      : undefined;

  async function network() {
    const n = await remote.getNetwork();
    check(n.passphrase === Networks.TESTNET && n.protocolVersion >= 29, 'RPC_NETWORK_MISMATCH');
  }
  async function transaction(method, args, account) {
    const source = await remote.getAccount(account);
    return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(cfg.contract).call(method, ...args))
      .setTimeout(60)
      .build();
  }
  async function view(method, args = [], contract = cfg.contract) {
    check(readerAccount, 'CONNECT_WALLET_FIRST');
    await network();
    const source = await remote.getAccount(readerAccount);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(new Contract(contract).call(method, ...args))
      .setTimeout(60)
      .build();
    const result = await remote.simulateTransaction(tx);
    check(rpc.Api.isSimulationSuccess(result) && result.result?.retval, 'RPC_READ_FAILED');
    return plain(scValToNative(result.result.retval));
  }
  async function order(orderId) {
    const result = await view('get_order', [u64(orderId)]);
    const state = Array.isArray(result.state) ? result.state[0] : result.state;
    check(
      ['Funded', 'Reserved', 'Paying', 'Released', 'Refunded', 'Resolved'].includes(state),
      'INVALID_CHAIN_STATE',
    );
    return { id: orderId, ...result, state };
  }
  async function configuration() {
    const result = await view('get_config');
    check(
      result.token === cfg.token && result.signer === cfg.policySignerPublicKeyHex,
      'CONTRACT_CONFIGURATION_MISMATCH',
    );
    const decimals = await view('decimals', [], cfg.token);
    check(Number(decimals) === cfg.tokenDecimals, 'TOKEN_DECIMALS_MISMATCH');
  }
  function checkEnvelope(reply, hash, method, args) {
    check(
      reply.status === 'SUCCESS' && reply.envelopeXdr && Number.isSafeInteger(reply.ledger),
      'TRANSACTION_NOT_CONFIRMED',
    );
    const tx = TransactionBuilder.fromXDR(
      typeof reply.envelopeXdr === 'string' ? reply.envelopeXdr : reply.envelopeXdr.toXDR('base64'),
      Networks.TESTNET,
    );
    check(
      Buffer.from(tx.hash()).toString('hex') === hash && tx.operations.length === 1,
      'TRANSACTION_IDENTITY_MISMATCH',
    );
    const op = tx.operations[0];
    check(
      op.type === 'invokeHostFunction' && op.func.type === 'hostFunctionTypeInvokeContract',
      'TRANSACTION_IDENTITY_MISMATCH',
    );
    const invoke = op.func.invokeContract;
    check(
      Address.fromScAddress(invoke.contractAddress).toString() === cfg.contract &&
        invoke.functionName.toString() === method,
      'TRANSACTION_IDENTITY_MISMATCH',
    );
    check(
      invoke.args.length === args.length &&
        invoke.args.every((v, i) => Buffer.from(v.toXDR()).equals(Buffer.from(args[i].toXDR()))),
      'TRANSACTION_ARGUMENT_MISMATCH',
    );
    return {
      hash,
      ledger: String(reply.ledger),
      status: 'confirmed',
      networkPassphrase: Networks.TESTNET,
      contract: cfg.contract,
    };
  }
  async function waitFor(hash) {
    for (let attempt = 0; attempt < pollAttempts; attempt++) {
      const found = await remote.getTransaction(hash);
      if (found.status === 'SUCCESS') return found;
      check(found.status !== 'FAILED', 'TRANSACTION_FAILED');
      await sleep(500);
    }
    throw new Error('TRANSACTION_PENDING_RECONCILIATION');
  }
  async function send(method, args, expectedAccount, key, collectAuthorization) {
    check(submissionEnabled, 'TESTNET_SUBMISSION_NOT_AUTHORIZED');
    check(isDurableTransactionJournal(journal), 'DURABLE_TRANSACTION_JOURNAL_REQUIRED');
    if (inFlight.has(key)) return inFlight.get(key);
    const operation = (async () => {
      check(
        expectedAccount &&
          (await wallet.selected()) === expectedAccount &&
          (await wallet.network()) === Networks.TESTNET,
        'WALLET_ACCOUNT_OR_NETWORK_CHANGED',
      );
      await network();
      await configuration();
      const prior = await journal.get(key);
      if (prior) {
        check(/^[a-f0-9]{64}$/.test(prior.hash), 'TRANSACTION_PENDING_RECONCILIATION');
        const reply = await waitFor(prior.hash);
        return { reply, transaction: checkEnvelope(reply, prior.hash, method, args) };
      }
      // The host journal must reserve atomically across tabs/processes before
      // any wallet prompt. A preparing/unknown record is never auto-cleared.
      check(await journal.reserve(key), 'TRANSACTION_PENDING_RECONCILIATION');
      let unsigned = await transaction(method, args, expectedAccount);
      if (collectAuthorization) {
        const simulated = await remote.simulateTransaction(unsigned, undefined, 'record');
        check(rpc.Api.isSimulationSuccess(simulated), 'AUTHORIZATION_SIMULATION_FAILED');
        const entries = await collectAuthorization(unsigned, simulated);
        check(Array.isArray(entries) && entries.length > 0, 'AUTHORIZATION_ENTRIES_MISSING');
        // Transaction.operations is a decoded view over the underlying XDR.
        // Rebuild the operation so auth entries are present in the serialized
        // envelope consumed by prepareTransaction and Freighter.
        unsigned = TransactionBuilder.cloneFrom(unsigned)
          .clearOperations()
          .addOperation(
            Operation.invokeContractFunction({
              contract: cfg.contract,
              function: method,
              args,
              auth: entries,
            }),
          )
          .build();
        const roundTripped = TransactionBuilder.fromXDR(unsigned.toXDR(), Networks.TESTNET);
        check(
          sameAuthEntries(roundTripped.operations[0]?.auth, entries),
          'AUTHORIZATION_ENTRIES_NOT_SERIALIZED',
        );
      }
      const prepared = await remote.prepareTransaction(unsigned);
      if (collectAuthorization) {
        const supplied =
          TransactionBuilder.fromXDR(unsigned.toXDR(), Networks.TESTNET).operations[0]?.auth ?? [];
        const returned =
          TransactionBuilder.fromXDR(prepared.toXDR(), Networks.TESTNET).operations[0]?.auth ?? [];
        check(
          supplied.length >= 1 && supplied.length <= 2 && sameAuthEntries(returned, supplied),
          'AUTHORIZATION_ENTRIES_CHANGED',
        );
      }
      check(BigInt(prepared.fee) <= integer(cfg.maxFeeStroops), 'TRANSACTION_FEE_LIMIT');
      const signed = TransactionBuilder.fromXDR(
        await wallet.sign(prepared.toXDR(), expectedAccount),
        Networks.TESTNET,
      );
      check(
        signed.source === expectedAccount &&
          Buffer.from(signed.hash()).equals(Buffer.from(prepared.hash())),
        'WALLET_CHANGED_TRANSACTION',
      );
      if (collectAuthorization) {
        const expectedAuth =
          TransactionBuilder.fromXDR(prepared.toXDR(), Networks.TESTNET).operations[0]?.auth ?? [];
        const signedAuth =
          TransactionBuilder.fromXDR(signed.toXDR(), Networks.TESTNET).operations[0]?.auth ?? [];
        check(sameAuthEntries(signedAuth, expectedAuth), 'AUTHORIZATION_ENTRIES_CHANGED');
      }
      check(
        signed.signatures.some((sig) =>
          Keypair.fromPublicKey(expectedAccount).verify(signed.hash(), sig.signature.toBytes()),
        ),
        'WALLET_SIGNATURE_MISSING',
      );
      const hash = Buffer.from(signed.hash()).toString('hex');
      // Persist the hash BEFORE submission. Unknown outcomes stay blocked across
      // reloads; no automatic new transaction is created for this action key.
      await journal.put(key, { hash, method, state: 'submitted-or-unknown' });
      const accepted = await remote.sendTransaction(signed);
      check(
        accepted.hash === hash && ['PENDING', 'DUPLICATE'].includes(accepted.status),
        'TRANSACTION_SUBMISSION_UNCERTAIN',
      );
      const reply = await waitFor(hash);
      const confirmed = checkEnvelope(reply, hash, method, args);
      await journal.put(key, { hash, method, state: 'confirmed' });
      return { reply, transaction: confirmed };
    })();
    inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(key);
    }
  }
  async function writeOrder(method, orderId, args, account) {
    const result = await send(method, args, account, `${cfg.contract}:${method}:${orderId}`);
    return { order: await order(orderId), transaction: result.transaction };
  }

  return Object.freeze({
    mode: 'live',
    deployment: Object.freeze(cfg),
    async connectWallet(party) {
      check(['buyer', 'seller'].includes(party), 'INVALID_PARTY');
      const account = await wallet.connect();
      check(
        StrKey.isValidEd25519PublicKey(account) && (await wallet.network()) === Networks.TESTNET,
        'WALLET_NETWORK_MISMATCH',
      );
      await network();
      readerAccount = account;
      accounts[party] = account;
      await configuration();
      return { account, networkPassphrase: Networks.TESTNET };
    },
    getOrder: order,
    async fund(terms) {
      check(
        terms.seller === accounts.seller && terms.currency === 'EUR' && terms.rail === 'revolut',
        'INVALID_OFFER',
      );
      if (cfg.privateOffer) {
        const expectedRecipient = recipientCommitment({
          recipient_id: cfg.privateOffer.recipientId,
          recipient_salt: cfg.privateOffer.recipientSalt,
        }).toString('hex');
        check(
          terms.seller === cfg.privateOffer.seller && terms.recipient === expectedRecipient,
          'PRIVATE_OFFER_MISMATCH',
        );
      }
      check(integer(terms.token_amount) > 0n && integer(terms.fiat_minor) > 0n, 'INVALID_OFFER');
      const encoded = map({
        seller: addr(terms.seller),
        token_amount: i128(terms.token_amount),
        fiat_minor: i128(terms.fiat_minor),
        currency: xdr.ScVal.scvSymbol('EUR'),
        rail: xdr.ScVal.scvSymbol('revolut'),
        recipient: hexBytes(terms.recipient, 32),
        offer_expires_at: u64(terms.offer_expires_at),
        reservation_seconds: u64(terms.reservation_seconds),
      });
      const result = await send(
        'fund',
        [encoded],
        accounts.seller,
        `${cfg.contract}:fund:${encoded.toXDR('base64')}`,
      );
      check(result.reply.returnValue, 'FUNDED_ORDER_ID_MISSING');
      const id = String(scValToNative(result.reply.returnValue));
      return { order: await order(id), transaction: result.transaction };
    },
    async reserve(orderId, buyer) {
      check(buyer === accounts.buyer, 'BUYER_WALLET_MISMATCH');
      return writeOrder('reserve', orderId, [u64(orderId), addr(buyer)], accounts.buyer);
    },
    async beginPayment(orderId) {
      const current = await order(orderId);
      check(current.buyer === accounts.buyer, 'BUYER_WALLET_MISMATCH');
      const result = await writeOrder('begin_payment', orderId, [u64(orderId)], accounts.buyer);
      check(
        result.order.state === 'Paying' && integer(result.order.locked_at) > 0n,
        'PAYMENT_LOCK_NOT_CONFIRMED',
      );
      return result;
    },
    async getPaymentInstructions(orderId) {
      const current = await order(orderId);
      const latest = await remote.getLatestLedger();
      check(
        current.state === 'Paying' &&
          current.buyer === accounts.buyer &&
          integer(current.locked_at) > 0n &&
          BigInt(latest.closeTime) < integer(current.pay_by),
        'PAYMENT_INSTRUCTIONS_LOCKED',
      );
      check(typeof instructions?.read === 'function', 'PAYMENT_DESTINATION_UNAVAILABLE');
      const value = await instructions.read({
        orderId,
        recipientCommitment: current.terms.recipient,
      });
      check(
        value?.orderId === orderId &&
          value.recipientCommitment === current.terms.recipient &&
          value.sourceBindingVerified === true,
        'PAYMENT_DESTINATION_BINDING_UNVERIFIED',
      );
      return value.destination;
    },
    async launchPaymentProof(orderId, onProgress) {
      const current = await order(orderId);
      check(current.state === 'Paying' && current.buyer === accounts.buyer, 'ORDER_NOT_PAYING');
      check(typeof policy?.launchProof === 'function', 'LIVE_PROOF_ADAPTER_UNAVAILABLE');
      // A completion callback updates display only. Status is read separately.
      await policy.launchProof({ orderId, onProgress });
    },
    async getPolicyStatus(orderId) {
      check(typeof policy?.readStatus === 'function', 'LIVE_POLICY_UNAVAILABLE');
      return policy.readStatus(orderId);
    },
    async release(orderId, authorization) {
      check(typeof policy?.readAuthorization === 'function', 'LIVE_POLICY_UNAVAILABLE');
      const approved = await policy.readAuthorization({ orderId, authorization });
      check(
        approved?.syntheticOnly === false &&
          approved.releaseGate === 'POLICY_ACCEPTED' &&
          approved.domain?.contract === cfg.contract &&
          approved.domain?.network_passphrase === Networks.TESTNET &&
          approved.claim?.order_id === orderId,
        'UNTRUSTED_POLICY_AUTHORIZATION',
      );
      const digest = claimDigest({
        network_passphrase: Networks.TESTNET,
        contract: cfg.contract,
        claim: approved.claim,
      });
      const signature = hexBytes(approved.signatureHex, 64);
      check(
        Keypair.fromPublicKey(
          StrKey.encodeEd25519PublicKey(Buffer.from(cfg.policySignerPublicKeyHex, 'hex')),
        ).verify(digest, Buffer.from(approved.signatureHex, 'hex')),
        'POLICY_SIGNATURE_INVALID',
      );
      // Normalize the frozen encoder's ScVal through XDR into this SDK instance.
      const claim = xdr.ScVal.fromXDR(claimScVal(approved.claim).toXDR());
      return writeOrder('release', orderId, [claim, signature], accounts.buyer);
    },
    async refundExpiredReservation(orderId) {
      const current = await order(orderId);
      const latest = await remote.getLatestLedger();
      check(
        current.state === 'Reserved' && BigInt(latest.closeTime) >= integer(current.pay_by),
        'REFUND_NOT_AVAILABLE',
      );
      return writeOrder('refund', orderId, [u64(orderId)], accounts.buyer ?? accounts.seller);
    },
    async cancelFundedOffer(orderId) {
      const current = await order(orderId);
      check(
        current.state === 'Funded' &&
          current.terms.seller === accounts.seller &&
          accounts.seller === (await wallet.selected()) &&
          (await wallet.network()) === Networks.TESTNET,
        'FUNDED_OFFER_CANCELLATION_UNAVAILABLE',
      );
      return writeOrder('refund', orderId, [u64(orderId)], accounts.seller);
    },
    async resolve(orderId, buyerTokens) {
      const current = await order(orderId);
      const amount = integer(buyerTokens);
      const total = integer(current.terms.token_amount);
      check(
        ['Reserved', 'Paying'].includes(current.state) &&
          current.buyer &&
          current.terms.seller &&
          amount >= 0n &&
          amount <= total &&
          accounts.buyer === current.buyer &&
          accounts.seller === current.terms.seller,
        'INVALID_RESOLUTION',
      );
      check(current.buyer !== current.terms.seller, 'DISTINCT_WALLETS_REQUIRED');
      const args = [u64(orderId), i128(buyerTokens)];
      const key = `${cfg.contract}:resolve:${orderId}:${amount}`;
      const submitted = await send('resolve', args, accounts.buyer, key, async (_tx, simulated) => {
        const latest = await remote.getLatestLedger();
        const expires = Number(latest.sequence) + 100;
        check(Number.isSafeInteger(expires), 'AUTHORIZATION_EXPIRY_INVALID');
        check(_tx.source === current.buyer, 'SOURCE_AUTHORIZATION_MISMATCH');
        const entries = simulated.result.auth ?? [];
        const matching = new Map();
        let sourceAuthorizationCount = 0;
        for (const entry of entries) {
          const info = inspectAuthEntry(entry);
          const root = entry.rootInvocation;
          check(
            root.function.type === 'sorobanAuthorizedFunctionTypeContractFn',
            'AUTHORIZATION_INVOCATION_MISMATCH',
          );
          const call = root.function.contractFn;
          check(
            Address.fromScAddress(call.contractAddress).toString() === cfg.contract &&
              call.functionName.toString() === 'resolve' &&
              call.args.length === 2 &&
              Buffer.from(call.args[0].toXDR()).equals(Buffer.from(args[0].toXDR())) &&
              Buffer.from(call.args[1].toXDR()).equals(Buffer.from(args[1].toXDR())),
            'AUTHORIZATION_INVOCATION_MISMATCH',
          );
          check(root.subInvocations.length === 0, 'AUTHORIZATION_INVOCATION_MISMATCH');
          if (info.credentialType === 'sourceAccount') {
            sourceAuthorizationCount++;
            check(
              _tx.source === current.buyer && sourceAuthorizationCount === 1,
              'SOURCE_AUTHORIZATION_MISMATCH',
            );
          } else {
            check(
              info.credentialType === 'addressV2' &&
                info.address === current.terms.seller &&
                !matching.has(info.address),
              'AUTHORIZATION_PARTIES_MISMATCH',
            );
            matching.set(info.address, entry);
          }
        }
        check(matching.has(current.terms.seller), 'SELLER_AUTHORIZATION_REQUIRED');
        const address = current.terms.seller;
        const entry = matching.get(address);
        const signatureBase64 = await wallet.signAuthEntry(
          buildAuthorizationEntryPreimage(entry, expires, Networks.TESTNET).toXDR('base64'),
          address,
        );
        check(typeof signatureBase64 === 'string', 'WALLET_AUTH_SIGNING_FAILED');
        const signature = Buffer.from(signatureBase64, 'base64');
        const signed = await authorizeEntry(
          entry,
          async () => signature,
          expires,
          Networks.TESTNET,
          address,
        );
        const info = inspectAuthEntry(signed);
        check(
          info.address === address &&
            info.signatureExpirationLedger === expires &&
            info.signed &&
            Buffer.from(signed.rootInvocation.toXDR()).equals(
              Buffer.from(entry.rootInvocation.toXDR()),
            ),
          'AUTHORIZATION_ENTRY_INVALID',
        );
        const credentials = signed.credentials.addressV2;
        check(
          String(credentials.nonce) === String(entry.credentials.addressV2.nonce),
          'AUTHORIZATION_ENTRY_INVALID',
        );
        const payload = hash(
          buildAuthorizationEntryPreimage(signed, expires, Networks.TESTNET).toXdr(),
        );
        check(
          info.signers.some(
            (node) =>
              node.address === address &&
              node.signatures?.some((sig) =>
                Keypair.fromPublicKey(address).verify(payload, sig.signature),
              ),
          ),
          'AUTHORIZATION_SIGNATURE_INVALID',
        );
        return entries.map((candidate) =>
          inspectAuthEntry(candidate).credentialType === 'sourceAccount' ? candidate : signed,
        );
      });
      const resolved = await order(orderId);
      check(
        resolved.state === 'Resolved' && integer(resolved.terms.token_amount) === total,
        'RESOLUTION_NOT_CONFIRMED',
      );
      return {
        order: resolved,
        transaction: submitted.transaction,
        buyerTokens: amount.toString(),
        sellerTokens: (total - amount).toString(),
      };
    },
    async reconcileReceipt(orderId, confirmed) {
      check(
        confirmed.networkPassphrase === Networks.TESTNET &&
          confirmed.contract === cfg.contract &&
          /^[a-f0-9]{64}$/.test(confirmed.hash),
        'RECEIPT_DOMAIN_MISMATCH',
      );
      const reply = await remote.getTransaction(confirmed.hash);
      const current = await order(orderId);
      check(
        reply.status === 'SUCCESS' &&
          String(reply.ledger) === confirmed.ledger &&
          ['Released', 'Refunded', 'Resolved'].includes(current.state),
        'RECEIPT_NOT_CONFIRMED',
      );
      const envelope = TransactionBuilder.fromXDR(
        typeof reply.envelopeXdr === 'string'
          ? reply.envelopeXdr
          : reply.envelopeXdr.toXDR('base64'),
        Networks.TESTNET,
      );
      check(
        Buffer.from(envelope.hash()).toString('hex') === confirmed.hash &&
          envelope.operations.length === 1,
        'RECEIPT_DOMAIN_MISMATCH',
      );
      const operation = envelope.operations[0];
      check(
        operation.type === 'invokeHostFunction' &&
          operation.func.type === 'hostFunctionTypeInvokeContract',
        'RECEIPT_DOMAIN_MISMATCH',
      );
      const invoke = operation.func.invokeContract;
      check(
        Address.fromScAddress(invoke.contractAddress).toString() === cfg.contract,
        'RECEIPT_DOMAIN_MISMATCH',
      );
      const method = invoke.functionName.toString();
      check(
        (method === 'release' && invoke.args.length === 2) ||
          (method === 'refund' && invoke.args.length === 1) ||
          (method === 'resolve' && invoke.args.length === 2),
        'RECEIPT_ORDER_MISMATCH',
      );
      const argument = scValToNative(invoke.args[0]);
      const allocation = method === 'resolve' ? scValToNative(invoke.args[1]) : null;
      check(
        ['release', 'refund', 'resolve'].includes(method) &&
          String(method === 'release' ? argument.order_id : argument) === orderId &&
          ((method === 'release' && current.state === 'Released') ||
            (method === 'refund' && current.state === 'Refunded') ||
            (method === 'resolve' && current.state === 'Resolved')),
        'RECEIPT_ORDER_MISMATCH',
      );
      if (method === 'resolve') {
        check(
          typeof allocation === 'bigint' &&
            allocation >= 0n &&
            allocation <= integer(current.terms.token_amount),
          'RECEIPT_ALLOCATION_MISMATCH',
        );
      }
      let buyerReceived = 0n,
        sellerReturned = 0n;
      for (const event of reply.events?.contractEventsXdr?.flat() ?? []) {
        if (
          !event.contractId ||
          StrKey.encodeContract(Buffer.from(event.contractId.toBytes())) !== cfg.token
        )
          continue;
        const body = event.body.v0;
        const topics = body.topics.map(scValToNative);
        if (topics[0] !== 'transfer' || topics[1] !== cfg.contract) continue;
        const amount = scValToNative(body.data);
        check(typeof amount === 'bigint' && amount > 0n, 'TOKEN_EVENT_UNSUPPORTED');
        if (topics[2] === current.buyer) buyerReceived += amount;
        else if (topics[2] === current.terms.seller) sellerReturned += amount;
        else throw new Error('UNEXPECTED_ESCROW_TRANSFER');
      }
      check(
        buyerReceived + sellerReturned === integer(current.terms.token_amount),
        'TOKEN_TRANSFER_EVIDENCE_MISSING',
      );
      check(
        current.state !== 'Released' || buyerReceived === integer(current.terms.token_amount),
        'TOKEN_TRANSFER_EVIDENCE_MISMATCH',
      );
      check(
        current.state !== 'Refunded' || sellerReturned === integer(current.terms.token_amount),
        'TOKEN_TRANSFER_EVIDENCE_MISMATCH',
      );
      check(
        current.state !== 'Resolved' ||
          (buyerReceived === allocation &&
            sellerReturned === integer(current.terms.token_amount) - allocation),
        'TOKEN_TRANSFER_EVIDENCE_MISMATCH',
      );
      return {
        orderId,
        orderState: current.state,
        buyerReceivedAtoms: buyerReceived.toString(),
        sellerReturnedAtoms: sellerReturned.toString(),
        transaction: confirmed,
      };
    },
  });
}
