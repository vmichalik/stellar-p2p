import {
  Address,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  buildAuthorizationEntryPreimage,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

const check = (condition, code) => {
  if (!condition) throw new Error(code);
};
const equal = (a, b) => Buffer.from(a.toXDR()).equals(Buffer.from(b.toXDR()));
const ledger = (value) => {
  check(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, 'RECOVERY_LEDGER_INVALID');
  return value;
};
const uint = (value, bits) => {
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'RECOVERY_ARGUMENT_INVALID');
  const number = BigInt(value);
  check(number < 1n << BigInt(bits), 'RECOVERY_ARGUMENT_INVALID');
  return number;
};

async function simpleAccount(server, account) {
  check(StrKey.isValidEd25519PublicKey(account), 'RECOVERY_ACCOUNT_UNSUPPORTED');
  const entry = await server.getAccountEntry(account);
  const thresholds = entry?.thresholds?.toBytes();
  // This bounded workflow supports only the account's own master Ed25519 key.
  // Additional signers, disabled master keys and threshold policies need a
  // separate wallet workflow; a valid signature alone does not establish them.
  check(
    entry?.accountId &&
      equal(entry.accountId, Keypair.fromPublicKey(account).xdrPublicKey()) &&
      entry.signers?.length === 0 &&
      thresholds?.length === 4 &&
      thresholds[0] === 1 &&
      [...thresholds].every((value) => value <= 1),
    'RECOVERY_ACCOUNT_UNSUPPORTED',
  );
}

function successful(simulation) {
  check(
    simulation &&
      rpc.Api.isSimulationSuccess(simulation) &&
      !rpc.Api.isSimulationError(simulation) &&
      !rpc.Api.isSimulationRestore(simulation) &&
      simulation.result,
    'RECOVERY_SIMULATION_FAILED',
  );
  ledger(simulation.latestLedger);
  return simulation;
}

/** Buyer signs the final transaction envelope; seller separately signs its
 * address-bound Soroban authorization. No server-held wallet key is accepted.
 * Called only after the caller's durable order-wide journal reservation.
 *
 * recovery.seller: selected(), network(), signAuthorization(request) -> base64
 * SorobanAuthorizationEntry. The request includes the full unsigned entry and
 * human-readable order/allocation, network, account and exclusive expiry.
 */
export async function prepareRecoveryTransaction({
  transaction,
  server,
  contract,
  orderId,
  buyerTokens,
  buyer,
  seller,
  recovery,
  maxFeeStroops,
}) {
  check(
    recovery?.seller &&
      typeof recovery.seller.selected === 'function' &&
      typeof recovery.seller.network === 'function' &&
      typeof recovery.seller.signAuthorization === 'function',
    'DUAL_WALLET_AUTHORIZATION_WORKFLOW_REQUIRED',
  );
  check(buyer !== seller, 'RECOVERY_PARTIES_INVALID');
  const validForLedgers = recovery.validForLedgers ?? 12;
  check(
    Number.isInteger(validForLedgers) && validForLedgers >= 2 && validForLedgers <= 60,
    'RECOVERY_EXPIRATION_INVALID',
  );
  const invocation = new xdr.InvokeContractArgs({
    contractAddress: new Address(contract).toScAddress(),
    functionName: 'resolve',
    args: [
      nativeToScVal(uint(orderId, 64), { type: 'u64' }),
      nativeToScVal(uint(buyerTokens, 127), { type: 'i128' }),
    ],
  });
  const root = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invocation),
    subInvocations: [],
  });
  const operation = transaction.operations[0];
  check(
    transaction.networkPassphrase === Networks.TESTNET &&
      transaction.source === buyer &&
      transaction.operations.length === 1 &&
      (!operation.source || operation.source === buyer) &&
      operation.type === 'invokeHostFunction' &&
      operation.func.type === 'hostFunctionTypeInvokeContract' &&
      equal(operation.func.invokeContract, invocation) &&
      (operation.auth ?? []).length === 0,
    'RECOVERY_TRANSACTION_MISMATCH',
  );
  await Promise.all([simpleAccount(server, buyer), simpleAccount(server, seller)]);
  const recorded = successful(
    await server.simulateTransaction(transaction, undefined, 'record', true),
  );
  const entries = recorded.result.auth;
  check(
    Array.isArray(entries) && entries.length >= 1 && entries.length <= 2,
    'RECOVERY_AUTH_MISMATCH',
  );
  let sourceEntry;
  let sellerEntry;
  for (const entry of entries) {
    check(equal(entry.rootInvocation, root), 'RECOVERY_INVOCATION_MISMATCH');
    if (entry.credentials.type === 'sorobanCredentialsSourceAccount') {
      check(!sourceEntry, 'RECOVERY_AUTH_MISMATCH');
      sourceEntry = entry;
    } else {
      // Protocol 29 / SDK 17.1.0 use address-bound CAP-71 credentials. Legacy,
      // delegated, contract-account and unexpected third-party auth fail closed.
      check(
        entry.credentials.type === 'sorobanCredentialsAddressV2' && !sellerEntry,
        'RECOVERY_AUTH_MISMATCH',
      );
      const credentials = entry.credentials.addressV2;
      check(
        Address.fromScAddress(credentials.address).toString() === seller &&
          credentials.signatureExpirationLedger === 0 &&
          (credentials.signature.type === 'scvVoid' ||
            (credentials.signature.type === 'scvVec' && credentials.signature.vec.length === 0)),
        'RECOVERY_AUTH_MISMATCH',
      );
      sellerEntry = entry;
    }
  }
  check(sellerEntry, 'RECOVERY_AUTH_MISMATCH');
  const latest = ledger((await server.getLatestLedger()).sequence);
  check(latest >= recorded.latestLedger, 'RECOVERY_LEDGER_INVALID');
  const expirationLedger = ledger(latest + validForLedgers);
  const port = recovery.seller;
  const selected = async () =>
    check(
      (await port.selected()) === seller && (await port.network()) === Networks.TESTNET,
      'RECOVERY_SELLER_WALLET_MISMATCH',
    );
  await selected();
  const response = await port.signAuthorization(
    Object.freeze({
      entryXdr: sellerEntry.toXDR('base64'),
      account: seller,
      networkPassphrase: Networks.TESTNET,
      expirationLedger,
      contract,
      orderId,
      buyerTokens,
    }),
  );
  await selected();
  check(typeof response === 'string' && response.length <= 16384, 'RECOVERY_AUTHORIZATION_INVALID');
  const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(response, 'base64');
  check(
    signedEntry.credentials.type === 'sorobanCredentialsAddressV2',
    'RECOVERY_AUTHORIZATION_INVALID',
  );
  const signedCredentials = signedEntry.credentials.addressV2;
  check(
    equal(signedEntry.rootInvocation, root) &&
      equal(signedCredentials.address, sellerEntry.credentials.addressV2.address) &&
      signedCredentials.nonce === sellerEntry.credentials.addressV2.nonce &&
      signedCredentials.signatureExpirationLedger === expirationLedger,
    'RECOVERY_AUTHORIZATION_CHANGED',
  );
  const signature = scValToNative(signedCredentials.signature);
  check(
    Array.isArray(signature) &&
      signature.length === 1 &&
      signature[0]?.public_key instanceof Uint8Array &&
      signature[0]?.signature instanceof Uint8Array &&
      Object.keys(signature[0]).length === 2 &&
      Buffer.from(signature[0].public_key).equals(
        Buffer.from(StrKey.decodeEd25519PublicKey(seller)),
      ) &&
      signature[0].signature.length === 64,
    'RECOVERY_SIGNATURE_INVALID',
  );
  const payload = hash(
    buildAuthorizationEntryPreimage(sellerEntry, expirationLedger, Networks.TESTNET).toXDR(),
  );
  check(
    Keypair.fromPublicKey(seller).verify(payload, signature[0].signature),
    'RECOVERY_SIGNATURE_INVALID',
  );
  const auth = entries.map((entry) => (entry === sellerEntry ? signedEntry : entry));
  const authorized = TransactionBuilder.cloneFrom(transaction)
    .clearOperations()
    .addOperation(
      Operation.invokeHostFunction({ source: operation.source, func: operation.func, auth }),
    )
    .build();
  const notExpired = async () => {
    const current = ledger((await server.getLatestLedger()).sequence);
    check(current >= latest && current < expirationLedger, 'RECOVERY_AUTHORIZATION_EXPIRED');
  };
  await notExpired();
  const enforced = successful(await server.simulateTransaction(authorized, undefined, 'enforce'));
  check(enforced.latestLedger < expirationLedger, 'RECOVERY_AUTHORIZATION_EXPIRED');
  const prepared = rpc.assembleTransaction(authorized, enforced).build();
  check(BigInt(prepared.fee) <= BigInt(maxFeeStroops), 'TRANSACTION_FEE_LIMIT');
  return {
    transaction: prepared,
    // Recheck after the buyer's possibly delayed wallet approval. Never mutate
    // or reassemble the envelope after that signature has bound both approvals.
    async validateSigned(signed) {
      check(
        Buffer.from(signed.hash()).equals(Buffer.from(prepared.hash())),
        'WALLET_CHANGED_TRANSACTION',
      );
      check(
        signed.signatures.some((signature) =>
          Keypair.fromPublicKey(buyer).verify(signed.hash(), signature.signature.toBytes()),
        ),
        'WALLET_SIGNATURE_MISSING',
      );
      await notExpired();
      const result = successful(await server.simulateTransaction(signed, undefined, 'enforce'));
      check(result.latestLedger < expirationLedger, 'RECOVERY_AUTHORIZATION_EXPIRED');
    },
  };
}
