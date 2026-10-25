import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { claimDigest, claimScVal } from '../contracts/escrow/protocol/protocol.mjs';
import { isDurableTransactionJournal } from './transaction-journal.mjs';
import { prepareRecoveryTransaction } from './recovery-authorization.mjs';
import { createHash } from 'node:crypto';

const check = (condition, code) => {
  if (!condition) throw new Error(code);
};
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
      // Freighter 6.0.1's FreighterApiDeclinedError is specifically code -4.
      // Other provider errors (or any returned envelope) are not proof of refusal.
      if (result.error?.code === -4 && !result.signedTxXdr && !result.signerAddress)
        throw new Error('WALLET_REJECTED');
      check(!result.error && result.signerAddress === account, 'WALLET_SIGNING_FAILED');
      return result.signedTxXdr;
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
  recovery,
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
  let readerAccount;

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
  async function send(method, args, expectedAccount, key, prepare) {
    check(submissionEnabled, 'TESTNET_SUBMISSION_NOT_AUTHORIZED');
    check(isDurableTransactionJournal(journal), 'DURABLE_TRANSACTION_JOURNAL_REQUIRED');
    const argumentKey = args.map((argument) => argument.toXDR('base64')).join(':');
    const argumentsHash = createHash('sha256')
      .update(JSON.stringify([method, expectedAccount, argumentKey]))
      .digest('hex');
    const running = inFlight.get(key);
    if (running) {
      check(running.argumentsHash === argumentsHash, 'TRANSACTION_ARGUMENT_MISMATCH');
      return running.operation;
    }
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
      if (prior && prior.state !== 'retryable') {
        check(
          !prior.argumentsHash || prior.argumentsHash === argumentsHash,
          'TRANSACTION_ARGUMENT_MISMATCH',
        );
        check(/^[a-f0-9]{64}$/.test(prior.hash), 'TRANSACTION_PENDING_RECONCILIATION');
        const reply = await waitFor(prior.hash);
        return { reply, transaction: checkEnvelope(reply, prior.hash, method, args) };
      }
      // Reservation ownership and every later transition survive process restart.
      // Only this live owner can prove preparation failed without a buyer envelope.
      const attempt = await journal.reserve(key, { method, argumentsHash });
      check(attempt, 'TRANSACTION_PENDING_RECONCILIATION');
      let preparation, prepared, unsignedXdr, preparedHash;
      try {
        const raw = await transaction(method, args, expectedAccount);
        preparation = prepare
          ? await prepare(raw)
          : { transaction: await remote.prepareTransaction(raw) };
        prepared = preparation.transaction;
        check(BigInt(prepared.fee) <= integer(cfg.maxFeeStroops), 'TRANSACTION_FEE_LIMIT');
        unsignedXdr = prepared.toXDR();
        preparedHash = Buffer.from(prepared.hash()).toString('hex');
      } catch {
        await journal.markRetryable(key, attempt, 'PREPARATION_FAILED');
        throw new Error('TRANSACTION_PREPARATION_RETRYABLE');
      }
      // Persist the exact offered envelope hash before requesting a signature.
      // Generic signer failures may hide a signed/submitted transaction, so they
      // retain this hash for reconciliation. Only explicit refusal is retryable.
      await journal.markSigning(key, attempt, preparedHash);
      let signedXdr;
      try {
        signedXdr = await wallet.sign(unsignedXdr, expectedAccount);
      } catch (error) {
        if (error?.code === 'WALLET_REJECTED' || error?.message === 'WALLET_REJECTED')
          await journal.markRetryable(key, attempt, 'WALLET_REJECTED');
        throw error;
      }
      // Even a malformed or changed returned envelope is conservatively final
      // for retry purposes. No subsequent validation failure releases this row.
      await journal.markSigned(key, attempt);
      const signed = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
      check(
        Buffer.from(signed.hash()).equals(Buffer.from(prepared.hash())),
        'WALLET_CHANGED_TRANSACTION',
      );
      check(
        signed.signatures.some((sig) =>
          Keypair.fromPublicKey(expectedAccount).verify(signed.hash(), sig.signature.toBytes()),
        ),
        'WALLET_SIGNATURE_MISSING',
      );
      if (preparation.validateSigned) await preparation.validateSigned(signed);
      const hash = Buffer.from(signed.hash()).toString('hex');
      // Persist the hash BEFORE submission. Unknown outcomes stay blocked across
      // reloads; no automatic new transaction is created for this action key.
      await journal.put(key, attempt, { hash, method, state: 'submitted-or-unknown' });
      const accepted = await remote.sendTransaction(signed);
      check(
        accepted.hash === hash && ['PENDING', 'DUPLICATE'].includes(accepted.status),
        'TRANSACTION_SUBMISSION_UNCERTAIN',
      );
      const reply = await waitFor(hash);
      const confirmed = checkEnvelope(reply, hash, method, args);
      await journal.put(key, attempt, { hash, method, state: 'confirmed' });
      return { reply, transaction: confirmed };
    })();
    inFlight.set(key, { argumentsHash, operation });
    try {
      return await operation;
    } finally {
      inFlight.delete(key);
    }
  }
  async function writeOrder(method, orderId, args, account, prepare) {
    const result = await send(
      method,
      args,
      account,
      `${cfg.contract}:${method}:${orderId}`,
      prepare,
    );
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
    async resolve(orderId, buyerTokens) {
      check(recovery?.seller, 'DUAL_WALLET_AUTHORIZATION_WORKFLOW_REQUIRED');
      const current = await order(orderId);
      check(current.buyer === accounts.buyer, 'BUYER_WALLET_MISMATCH');
      check(
        integer(buyerTokens) <= integer(current.terms.token_amount),
        'INVALID_RESOLUTION_SPLIT',
      );
      const prior = isDurableTransactionJournal(journal)
        ? await journal.get(`${cfg.contract}:resolve:${orderId}`)
        : null;
      check(
        ['Reserved', 'Paying'].includes(current.state) ||
          (current.state === 'Resolved' && prior?.state !== 'retryable' && prior?.hash),
        'RESOLUTION_NOT_AVAILABLE',
      );
      // Buyer's final envelope signs the exact call plus seller's signed auth.
      // The order-wide journal permits reconciliation, never a second allocation.
      return writeOrder(
        'resolve',
        orderId,
        [u64(orderId), i128(buyerTokens)],
        accounts.buyer,
        (transaction) =>
          prepareRecoveryTransaction({
            transaction,
            server: remote,
            contract: cfg.contract,
            orderId,
            buyerTokens,
            buyer: current.buyer,
            seller: current.terms.seller,
            recovery,
            maxFeeStroops: cfg.maxFeeStroops,
          }),
      );
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
        reply.envelopeXdr.toXDR('base64'),
        Networks.TESTNET,
      );
      check(
        Buffer.from(envelope.hash()).toString('hex') === confirmed.hash &&
          envelope.operations.length === 1,
        'RECEIPT_DOMAIN_MISMATCH',
      );
      const invoke = envelope.operations[0].func.invokeContract;
      check(
        Address.fromScAddress(invoke.contractAddress).toString() === cfg.contract,
        'RECEIPT_DOMAIN_MISMATCH',
      );
      const method = invoke.functionName.toString();
      const argument = scValToNative(invoke.args[0]);
      check(
        ['release', 'refund', 'resolve'].includes(method) &&
          String(method === 'release' ? argument.order_id : argument) === orderId,
        'RECEIPT_ORDER_MISMATCH',
      );
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
