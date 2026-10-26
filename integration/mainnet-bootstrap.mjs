import { createHash, randomBytes } from 'node:crypto';
import {
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  existsSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  Address,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

const check = (ok, code) => {
  if (!ok) throw Error(code);
};
// Atomic durable operator state. A prepared or submitted transaction survives restart.
export function savePrivateJson(path, value) {
  const temp = path + '.next';
  const fd = openSync(temp, 'w', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  const dir = openSync(dirname(path), 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}

export function createMainnetBootstrap({
  directory,
  owner,
  token,
  signerPublicKeyHex,
  wasm,
  feeCapStroops,
  server,
  onDeployed = async () => {},
  clock = () => Math.floor(Date.now() / 1000),
}) {
  check(Keypair.fromPublicKey(owner) && Address.fromString(token), 'INVALID_SETUP');
  check(
    /^[a-f0-9]{64}$/.test(signerPublicKeyHex) && feeCapStroops === '250000000',
    'SETUP_APPROVAL_REQUIRED',
  );
  const wasmHash = createHash('sha256').update(wasm).digest('hex');
  check(
    wasmHash === '8940569853b21a957fc5a81402666e95ed75f054ce2223926231ffc2c0c506dd',
    'WASM_MISMATCH',
  );
  const path = join(directory, 'deployment-journal.json');
  const identity = { owner, token, signerPublicKeyHex, wasmHash, feeCapStroops };
  let state = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { identity, salt: randomBytes(32).toString('hex'), completed: [], pending: null };
  check(JSON.stringify(state.identity) === JSON.stringify(identity), 'SETUP_CONFIG_CHANGED');
  const save = () => savePrivateJson(path, state);
  save();
  let busy = false;
  const serial = async (fn) => {
    check(!busy, 'SETUP_BUSY');
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };
  const spent = () => state.completed.reduce((sum, item) => sum + BigInt(item.fee), 0n);
  const view = () => ({
    ...identity,
    networkPassphrase: Networks.PUBLIC,
    completed: state.completed.map(({ kind, hash, ledger, fee, contract }) => ({
      kind,
      hash,
      ledger,
      fee,
      ...(contract ? { contract } : {}),
    })),
    pending: state.pending
      ? {
          kind: state.pending.kind,
          hash: state.pending.hash,
          fee: state.pending.fee,
          status: state.pending.status,
        }
      : null,
  });
  async function network() {
    const n = await server.getNetwork();
    check(n.passphrase === Networks.PUBLIC && n.protocolVersion === 29, 'NETWORK_MISMATCH');
  }
  async function reconcile() {
    const pending = state.pending;
    if (!pending) return;
    const result = await server.getTransaction(pending.hash);
    if (result.status === 'SUCCESS') {
      check(result.returnValue, 'DEPLOYMENT_RECEIPT_MISSING');
      const value = scValToNative(result.returnValue);
      if (pending.kind === 'upload')
        check(Buffer.from(value).toString('hex') === wasmHash, 'UPLOAD_RECEIPT_MISMATCH');
      else check(typeof value === 'string' && value.startsWith('C'), 'CONTRACT_RECEIPT_MISMATCH');
      state.completed.push({
        kind: pending.kind,
        hash: pending.hash,
        fee: pending.fee,
        ledger: String(result.ledger),
        ...(pending.kind === 'deploy' ? { contract: value } : {}),
      });
      state.pending = null;
      save();
    } else if (result.status === 'FAILED') {
      // Retain a terminal failure for operator review, including its fee ceiling.
      state.pending.status = 'failed';
      save();
    } else if (pending.status === 'prepared' && clock() > pending.expires + 30) {
      // Only an envelope never submitted by this service can be replaced. Wait
      // for the RPC ledger to pass its validity window and check its hash first.
      const ledger = await server.getLatestLedger();
      check(Number(ledger.closeTime) > pending.expires + 10, 'WAIT_FOR_LEDGER');
      state.pending = null;
      save();
    }
  }
  async function activate() {
    const deployed = state.completed.find((x) => x.kind === 'deploy');
    if (deployed) await onDeployed(deployed);
  }
  return Object.freeze({
    view,
    status: () =>
      serial(async () => {
        await reconcile();
        await activate();
        return view();
      }),
    prepare: () =>
      serial(async () => {
        await network();
        await reconcile();
        await activate();
        if (state.completed.some((x) => x.kind === 'deploy')) return { ...view(), done: true };
        if (state.pending) {
          check(
            state.pending.status === 'prepared' && clock() < state.pending.expires,
            'TRANSACTION_RECONCILIATION_REQUIRED',
          );
          return { ...view(), xdr: state.pending.xdr };
        }
        const kind = state.completed.length ? 'deploy' : 'upload';
        const operation =
          kind === 'upload'
            ? Operation.uploadContractWasm({ wasm })
            : Operation.createCustomContract({
                address: Address.fromString(owner),
                wasmHash: Buffer.from(wasmHash, 'hex'),
                salt: Buffer.from(state.salt, 'hex'),
                constructorArgs: [
                  Address.fromString(token).toScVal(),
                  xdr.ScVal.scvBytes(Buffer.from(signerPublicKeyHex, 'hex')),
                ],
              });
        const account = await server.getAccount(owner);
        const expires = clock() + 900;
        const transaction = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: Networks.PUBLIC,
        })
          .addOperation(operation)
          .setTimebounds(0, expires)
          .build();
        const sim = await server.simulateTransaction(transaction);
        check(rpc.Api.isSimulationSuccess(sim), 'DEPLOYMENT_SIMULATION_FAILED');
        const prepared = rpc.assembleTransaction(transaction, sim).build();
        check(
          spent() + BigInt(prepared.fee) <= BigInt(feeCapStroops),
          'DEPLOYMENT_FEE_CAP_EXCEEDED',
        );
        state.pending = {
          kind,
          status: 'prepared',
          xdr: prepared.toXDR(),
          hash: prepared.hash().toString('hex'),
          fee: prepared.fee,
          expires,
        };
        save();
        return { ...view(), xdr: state.pending.xdr };
      }),
    submit: (signedXdr) =>
      serial(async () => {
        await network();
        check(typeof signedXdr === 'string' && signedXdr.length < 100000, 'INVALID_TRANSACTION');
        const tx = TransactionBuilder.fromXDR(signedXdr, Networks.PUBLIC);
        check(
          state.pending?.status === 'prepared' &&
            tx.hash().toString('hex') === state.pending.hash &&
            tx.source === owner &&
            tx.fee === state.pending.fee &&
            clock() < state.pending.expires,
          'TRANSACTION_CHANGED',
        );
        check(
          tx.signatures.length === 1 &&
            Keypair.fromPublicKey(owner).verify(tx.hash(), tx.signatures[0].signature.toBytes()),
          'OWNER_SIGNATURE_REQUIRED',
        );
        check(spent() + BigInt(tx.fee) <= BigInt(feeCapStroops), 'DEPLOYMENT_FEE_CAP_EXCEEDED');
        // Persist before any RPC submission. A timeout is an unknown outcome, not
        // permission to sign another transaction or spend the fee twice.
        state.pending.status = 'submitted';
        save();
        try {
          await server.sendTransaction(tx);
        } catch {
          /* status reconciles exact hash */
        }
        await reconcile();
        await activate();
        return view();
      }),
  });
}
