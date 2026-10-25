/** Disposable, bank-free TESTNET rehearsal. Never imports the live proof normalizer.
 * Creates fresh test accounts and PLTEST tokens. No real USDC, fiat or user wallet.
 * Explicit --execute required. Secrets exist only in this process and are never logged.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  buildAuthorizationEntryPreimage,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { createStellarServices } from './stellar-rpc-adapter.mjs';
import { TransactionJournal } from './transaction-journal.mjs';
import { ReplayStore } from '../policy/src/replay-store.mjs';
import { makePolicy } from '../policy/src/engine.mjs';
import { validateSyntheticPayment } from '../policy/src/evidence.mjs';
import { recipientCommitment, claimScVal } from '../contracts/escrow/protocol/protocol.mjs';
import { createStellarReaders } from './host/stellar-reader.mjs';
import { createEscrowIndexer } from './host/indexer.mjs';

if (!process.argv.includes('--execute')) {
  console.log(
    'Run with --execute to create disposable accounts, a PLTEST token and escrow on Stellar testnet. No bank access or real USDC.',
  );
  process.exit(0);
}
const root = resolve(import.meta.dirname, '..');
const directory = join(root, '.private', `testnet-${Date.now()}`);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const server = new rpc.Server('https://soroban-testnet.stellar.org');
const net = await server.getNetwork();
if (net.passphrase !== Networks.TESTNET || net.protocolVersion < 29)
  throw new Error('TESTNET_REQUIRED');
const keys = {
  issuer: Keypair.random(),
  seller: Keypair.random(),
  buyer: Keypair.random(),
  policy: Keypair.random(),
};
const report = {
  kind: 'DISPOSABLE_SYNTHETIC_TESTNET_REHEARSAL',
  startedAt: new Date().toISOString(),
  bankProof: false,
  realUSDC: false,
  releaseGate: 'NOT_CLEARED',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  protocolVersion: net.protocolVersion,
  transactions: [],
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const check = (ok, code) => {
  if (!ok) throw new Error(code);
};
let feeTotal = 0n;
async function confirm(hash) {
  for (let i = 0; i < 40; i++) {
    const found = await server.getTransaction(hash);
    if (found.status === 'SUCCESS') return found;
    check(found.status !== 'FAILED', 'TESTNET_TRANSACTION_FAILED');
    await pause(1000);
  }
  throw new Error('TESTNET_TRANSACTION_UNCERTAIN_DO_NOT_RETRY');
}
async function submit(label, key, operation, soroban = true) {
  let tx = new TransactionBuilder(await server.getAccount(key.publicKey()), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(180)
    .build();
  if (soroban) tx = await server.prepareTransaction(tx);
  check(
    BigInt(tx.fee) <= 1_000_000_000n && feeTotal + BigInt(tx.fee) <= 5_000_000_000n,
    'TESTNET_FEE_CAP',
  );
  feeTotal += BigInt(tx.fee);
  tx.sign(key);
  const hash = hex(tx.hash());
  // Record intent before send. Never resubmit automatically after an unknown result.
  report.transactions.push({ label, hash, maxFeeStroops: tx.fee, status: 'submitted-or-unknown' });
  save();
  const sent = await server.sendTransaction(tx);
  check(
    sent.hash === hash && ['PENDING', 'DUPLICATE'].includes(sent.status),
    'TESTNET_SUBMISSION_UNCERTAIN',
  );
  const result = await confirm(hash);
  Object.assign(report.transactions.at(-1), { status: 'confirmed', ledger: result.ledger });
  save();
  console.log(`${label}: confirmed`);
  return result;
}
function save() {
  writeFileSync(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
}
async function trust(key, asset) {
  await submit('trust-PLTEST', key, Operation.changeTrust({ asset, limit: '1000' }), false);
}
const journals = [];
try {
  for (const key of [keys.issuer, keys.seller, keys.buyer]) {
    try {
      await server.fundAddress(key.publicKey());
    } catch {
      await pause(2000);
      await server.getAccount(key.publicKey());
    }
  }
  const asset = new Asset('PLTEST', keys.issuer.publicKey());
  await trust(keys.seller, asset);
  await trust(keys.buyer, asset);
  await submit(
    'issue-PLTEST',
    keys.issuer,
    Operation.payment({ destination: keys.seller.publicKey(), asset, amount: '100' }),
    false,
  );
  const token = asset.contractId(Networks.TESTNET);
  await submit('deploy-PLTEST-SAC', keys.issuer, Operation.createStellarAssetContract({ asset }));
  const wasm = readFileSync(join(root, 'contracts/escrow/artifacts/pactlane_escrow.wasm'));
  const wasmHash = createHash('sha256').update(wasm).digest();
  check(
    hex(wasmHash) === '8940569853b21a957fc5a81402666e95ed75f054ce2223926231ffc2c0c506dd',
    'WASM_NOT_REVIEWED',
  );
  await submit('upload-reviewed-escrow', keys.issuer, Operation.uploadContractWasm({ wasm }));
  const created = await submit(
    'deploy-escrow',
    keys.issuer,
    Operation.createCustomContract({
      address: new Address(keys.issuer.publicKey()),
      wasmHash,
      salt: randomBytes(32),
      constructorArgs: [
        new Address(token).toScVal(),
        xdr.ScVal.scvBytes(keys.policy.rawPublicKey()),
      ],
    }),
  );
  const contract = scValToNative(created.returnValue);
  const startLedger = created.ledger;
  const deployment = {
    networkPassphrase: Networks.TESTNET,
    rpcUrl: report.rpcUrl,
    contract,
    token,
    tokenDecimals: 7,
    policySignerPublicKeyHex: hex(keys.policy.rawPublicKey()),
    maxFeeStroops: '10000000',
    startLedger,
    readerAccount: keys.buyer.publicKey(),
    privateOffer: {
      recipientSalt: '31'.repeat(32),
      recipientId: 'synthetic-provider-recipient',
      seller: keys.seller.publicKey(),
    },
  };
  Object.assign(report, {
    contract,
    token,
    tokenLabel: 'PLTEST (synthetic, not USDC)',
    wasmSha256: hex(wasmHash),
    policySignerPublicKeyHex: deployment.policySignerPublicKeyHex,
    startLedger,
  });
  save();
  let selected = keys.seller;
  const wallet = {
    connect: async () => selected.publicKey(),
    selected: async () => selected.publicKey(),
    network: async () => Networks.TESTNET,
    sign: async (txXdr, account) => {
      const key = Object.values(keys).find((k) => k.publicKey() === account);
      check(key && account === selected.publicKey(), 'REHEARSAL_ACCOUNT_MISMATCH');
      const tx = TransactionBuilder.fromXDR(txXdr, Networks.TESTNET);
      tx.sign(key);
      return tx.toXDR();
    },
    signAuthEntry: async (preimageXdr, account) => {
      check(account === keys.seller.publicKey(), 'REHEARSAL_RECOVERY_PARTY_MISMATCH');
      const preimage = xdr.HashIdPreimage.fromXDR(preimageXdr, 'base64');
      return Buffer.from(
        keys.seller.sign(createHash('sha256').update(preimage.toXDR()).digest()),
      ).toString('base64');
    },
  };
  const journal = new TransactionJournal(join(directory, 'transactions.sqlite'));
  journals.push(journal);
  const service = createStellarServices({
    deployment,
    server,
    wallet,
    journal,
    submissionEnabled: true,
    pollAttempts: 40,
    sleep: () => pause(1000),
  });
  await service.connectWallet('seller');
  selected = keys.buyer;
  await service.connectWallet('buyer');
  const recipientId = 'synthetic-provider-recipient';
  const terms = {
    seller: keys.seller.publicKey(),
    token_amount: '220000000',
    fiat_minor: '2000',
    currency: 'EUR',
    rail: 'revolut',
    recipient: recipientCommitment({
      recipient_id: recipientId,
      recipient_salt: deployment.privateOffer.recipientSalt,
    }).toString('hex'),
    offer_expires_at: String(Math.floor(Date.now() / 1000) + 3600),
    reservation_seconds: '900',
  };
  async function trade(label) {
    selected = keys.seller;
    const funded = await service.fund({
      ...terms,
      offer_expires_at: String(BigInt(terms.offer_expires_at) + BigInt(label)),
    });
    const id = funded.order.id;
    report.transactions.push({ label: `fund-${id}`, ...funded.transaction });
    save();
    selected = keys.buyer;
    const reserved = await service.reserve(id, selected.publicKey());
    report.transactions.push({ label: `reserve-${id}`, ...reserved.transaction });
    save();
    const locked = await service.beginPayment(id);
    report.transactions.push({ label: `lock-${id}`, ...locked.transaction });
    save();
    return locked.order;
  }
  const order = await trade('0');
  const store = new ReplayStore(join(directory, 'synthetic-policy.sqlite'), {
    syntheticOnly: true,
  });
  journals.push(store);
  const domain = { network_passphrase: Networks.TESTNET, contract };
  const reader = createStellarReaders({
    deployment,
    server,
    readerAccount: keys.buyer.publicKey(),
  });
  const indexer = createEscrowIndexer({ deployment, store, server });
  await indexer.syncOnce();
  const evidence = {
    kind: 'SYNTHETIC_PAYMENT_FIXTURE_V1',
    serverName: 'app.revolut.com',
    method: 'GET',
    requestPath: '/api/retail/transaction/00000000-0000-0000-0000-000000000001',
    httpStatus: 200,
    rail: 'revolut',
    currency: 'EUR',
    amountUnit: 'EUR_CENTS',
    amountMinor: '2000',
    state: 'COMPLETED',
    direction: 'OUTGOING',
    transactionType: 'REVOLUT_TO_REVOLUT',
    recipientId,
    payerScope: 'synthetic-account',
    paymentId: '00000000-0000-0000-0000-000000000001',
    completedAt: order.locked_at,
  };
  const policy = makePolicy({
    domain,
    ledgerReader: {
      readOrder: async (query) => {
        const value = await reader.readOrder(query);
        await indexer.syncOnce();
        return value;
      },
    },
    loadEvidence: async () => evidence,
    normalize: validateSyntheticPayment,
    store,
    syntheticOnly: true,
    signer: {
      publicKeyHex: deployment.policySignerPublicKeyHex,
      syntheticOnly: true,
      signDigest: async (digest) => keys.policy.sign(digest),
    },
  });
  const authorization = await policy.issue({ orderId: order.id, evidenceId: 'synthetic-fixture' });
  check(
    authorization.syntheticOnly === true && authorization.releaseGate === 'NOT_CLEARED',
    'SYNTHETIC_MODE_LOST',
  );
  // Dedicated test-only invocation: the normal live adapter refuses this synthetic result.
  const released = await submit(
    'release-synthetic-claim',
    keys.buyer,
    new Contract(contract).call(
      'release',
      xdr.ScVal.fromXDR(claimScVal(authorization.claim).toXDR()),
      xdr.ScVal.scvBytes(Buffer.from(authorization.signatureHex, 'hex')),
    ),
  );
  const confirmed = {
    hash: report.transactions.at(-1).hash,
    ledger: String(released.ledger),
    networkPassphrase: Networks.TESTNET,
    contract,
    status: 'confirmed',
  };
  report.releaseReceipt = await service.reconcileReceipt(order.id, confirmed);
  save();
  await policy.reconcileRelease({ orderId: order.id, evidenceId: 'synthetic-fixture' });
  let replayRejected = false;
  try {
    await server.prepareTransaction(
      new TransactionBuilder(await server.getAccount(keys.buyer.publicKey()), {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          new Contract(contract).call(
            'release',
            xdr.ScVal.fromXDR(claimScVal(authorization.claim).toXDR()),
            xdr.ScVal.scvBytes(Buffer.from(authorization.signatureHex, 'hex')),
          ),
        )
        .setTimeout(60)
        .build(),
    );
  } catch {
    replayRejected = true;
  }
  check(replayRejected, 'REPLAY_NOT_REJECTED');
  report.replayRejected = true;
  const recovery = await trade('1');
  const resolved = await service.resolve(recovery.id, '110000000');
  report.transactions.push({ label: 'resolve-mutual-half-split', ...resolved.transaction });
  report.recoveryReceipt = await service.reconcileReceipt(recovery.id, resolved.transaction);
  check(
    report.releaseReceipt.buyerReceivedAtoms === '220000000' &&
      report.recoveryReceipt.buyerReceivedAtoms === '110000000' &&
      report.recoveryReceipt.sellerReturnedAtoms === '110000000',
    'TOKEN_CONSERVATION_FAILED',
  );
  report.completedAt = new Date().toISOString();
  report.outcome = 'PASSED';
  save();
  console.log(`Testnet rehearsal passed. Sanitized report: ${join(directory, 'report.json')}`);
} catch (error) {
  report.outcome = 'FAILED';
  report.error = /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'RPC_OR_SDK_ERROR';
  save();
  console.error(
    `Rehearsal stopped: ${report.error}. Existing submissions are in the private report; no automatic retry.`,
  );
  process.exitCode = 1;
} finally {
  for (const item of journals.reverse()) item.close();
}
