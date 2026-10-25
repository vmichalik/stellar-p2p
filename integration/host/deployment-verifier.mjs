import { createHash } from 'node:crypto';
import { Networks, scValToNative, TransactionBuilder } from '@stellar/stellar-sdk';

export const REVIEWED_WASM_SHA256 =
  '8940569853b21a957fc5a81402666e95ed75f054ce2223926231ffc2c0c506dd';
const ensure = (condition, code) => {
  if (!condition) throw new Error(code);
};

/** Prove the indexer's starting ledger from the creation transaction, and pin actual deployed code.
 * A pruned creation transaction is an explicit stop, requiring a reviewed history/archive process.
 */
export async function verifyDeployment({ deployment, server }) {
  ensure(
    /^[a-f0-9]{64}$/.test(deployment.deploymentTransactionHash ?? ''),
    'DEPLOYMENT_TRANSACTION_REQUIRED',
  );
  const network = await server.getNetwork();
  ensure(
    network.passphrase === Networks.TESTNET && network.protocolVersion >= 29,
    'RPC_NETWORK_MISMATCH',
  );
  const creation = await server.getTransaction(deployment.deploymentTransactionHash);
  ensure(
    creation.status === 'SUCCESS' &&
      creation.ledger === deployment.startLedger &&
      creation.returnValue &&
      scValToNative(creation.returnValue) === deployment.contract,
    'DEPLOYMENT_HISTORY_UNVERIFIED',
  );
  const tx = TransactionBuilder.fromXDR(
    typeof creation.envelopeXdr === 'string'
      ? creation.envelopeXdr
      : creation.envelopeXdr.toXDR('base64'),
    Networks.TESTNET,
  );
  ensure(
    Buffer.from(tx.hash()).toString('hex') === deployment.deploymentTransactionHash &&
      tx.operations.length === 1 &&
      tx.operations[0].type === 'invokeHostFunction' &&
      tx.operations[0].func.type === 'hostFunctionTypeCreateContractV2',
    'DEPLOYMENT_HISTORY_UNVERIFIED',
  );
  const wasm = await server.getContractWasmByContractId(deployment.contract);
  ensure(
    createHash('sha256').update(wasm).digest('hex') === REVIEWED_WASM_SHA256,
    'DEPLOYED_CODE_MISMATCH',
  );
  return Object.freeze({
    verified: true,
    creationLedger: String(creation.ledger),
    wasmSha256: REVIEWED_WASM_SHA256,
  });
}
