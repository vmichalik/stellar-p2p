import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { REVIEWED_WASM_SHA256, verifyDeployment } from './deployment-verifier.mjs';

function fixture() {
  const account = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x45));
  const contract = Address.contract(Buffer.alloc(32, 8)).toString();
  const tx = new TransactionBuilder(new Account(account.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(account.publicKey()),
        wasmHash: Buffer.from(REVIEWED_WASM_SHA256, 'hex'),
        salt: Buffer.alloc(32, 0x15),
      }),
    )
    .setTimeout(60)
    .build();
  const deployment = {
    contract,
    startLedger: 50,
    deploymentTransactionHash: Buffer.from(tx.hash()).toString('hex'),
  };
  const server = {
    getNetwork: async () => ({ passphrase: Networks.TESTNET, protocolVersion: 29 }),
    getTransaction: async () => ({
      status: 'SUCCESS',
      ledger: 50,
      returnValue: new Address(contract).toScVal(),
      envelopeXdr: tx.toEnvelope(),
    }),
    getContractWasmByContractId: async () =>
      readFileSync(
        new URL('../../contracts/escrow/artifacts/pactlane_escrow.wasm', import.meta.url),
      ),
  };
  return { deployment, server };
}
test('host pins creation transaction, first indexed ledger and actual reviewed WASM', async () => {
  const { deployment, server } = fixture();
  // This fixture checks decoding/binding, not a network deployment.
  assert.deepEqual(await verifyDeployment({ deployment, server }), {
    verified: true,
    creationLedger: '50',
    wasmSha256: REVIEWED_WASM_SHA256,
  });
  await assert.rejects(
    verifyDeployment({ deployment: { ...deployment, startLedger: 51 }, server }),
    /DEPLOYMENT_HISTORY_UNVERIFIED/,
  );
  server.getContractWasmByContractId = async () => Buffer.from('different code');
  await assert.rejects(verifyDeployment({ deployment, server }), /DEPLOYED_CODE_MISMATCH/);
});
