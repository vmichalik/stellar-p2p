import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  Account,
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { createMainnetBootstrap } from './mainnet-bootstrap.mjs';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-bootstrap-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const owner = Keypair.random(),
    policy = Keypair.random(),
    token = Address.contract(Buffer.alloc(32, 45)).toString();
  let fee = '197356260',
    count = 0,
    outcome = { status: 'NOT_FOUND' },
    activated = null,
    now = 1000;
  const server = {
    getNetwork: async () => ({ passphrase: Networks.PUBLIC, protocolVersion: 29 }),
    getAccount: async () => new Account(owner.publicKey(), '100'),
    getLatestLedger: async () => ({ closeTime: now }),
    getTransaction: async () => outcome,
    simulateTransaction: async () => ({
      _parsed: true,
      transactionData: new SorobanDataBuilder().setResourceFee(fee),
      minResourceFee: fee,
      events: [],
      latestLedger: 100,
      result: { retval: xdr.ScVal.scvVoid(), auth: [] },
    }),
    sendTransaction: async () => {
      count++;
      throw Error('timeout after submission');
    },
  };
  const options = {
    directory,
    owner: owner.publicKey(),
    token,
    signerPublicKeyHex: Buffer.from(policy.rawPublicKey()).toString('hex'),
    wasm: readFileSync(
      new URL('../contracts/escrow/artifacts/pactlane_escrow.wasm', import.meta.url),
    ),
    feeCapStroops: '250000000',
    server,
    onDeployed: async (receipt) => {
      activated = receipt;
    },
    clock: () => now,
  };
  return {
    directory,
    owner,
    options,
    server,
    create: () => createMainnetBootstrap(options),
    fee: (x) => (fee = x),
    outcome: (x) => (outcome = x),
    count: () => count,
    activated: () => activated,
    now: (x) => (now = x),
  };
}
test('deployment cap, exact owner signature and unchanged transaction are enforced before submission', async (t) => {
  const f = fixture(t),
    service = f.create();
  f.fee('250000001');
  await assert.rejects(service.prepare(), /FEE_CAP/);
  assert.equal(f.count(), 0);
  f.fee('197356260');
  const p = await service.prepare();
  const foreign = TransactionBuilder.fromXDR(p.xdr, Networks.PUBLIC);
  foreign.sign(Keypair.random());
  await assert.rejects(service.submit(foreign.toXDR()), /OWNER_SIGNATURE/);
  const altered = TransactionBuilder.cloneFrom(TransactionBuilder.fromXDR(p.xdr, Networks.PUBLIC), {
    fee: '10',
  }).build();
  altered.sign(f.owner);
  await assert.rejects(service.submit(altered.toXDR()), /TRANSACTION_CHANGED/);
  assert.equal(f.count(), 0);
});
test('unknown submission survives restart and can never be silently resubmitted', async (t) => {
  const f = fixture(t),
    first = f.create(),
    prepared = await first.prepare();
  const tx = TransactionBuilder.fromXDR(prepared.xdr, Networks.PUBLIC);
  tx.sign(f.owner);
  await first.submit(tx.toXDR());
  assert.equal(f.count(), 1);
  const second = f.create();
  assert.equal((await second.status()).pending.status, 'submitted');
  await assert.rejects(second.prepare(), /RECONCILIATION/);
  await assert.rejects(second.submit(tx.toXDR()), /TRANSACTION_CHANGED/);
  assert.equal(f.count(), 1);
  f.outcome({
    status: 'SUCCESS',
    ledger: 123,
    returnValue: xdr.ScVal.scvBytes(Buffer.from(prepared.wasmHash, 'hex')),
  });
  const result = await second.status();
  assert.equal(result.completed.length, 1);
  assert.equal(result.pending, null);
  f.outcome({ status: 'NOT_FOUND' });
  f.fee('60000000');
  await assert.rejects(second.prepare(), /FEE_CAP/);
  f.fee('100000');
  const deployment = await second.prepare();
  const deployTx = TransactionBuilder.fromXDR(deployment.xdr, Networks.PUBLIC);
  deployTx.sign(f.owner);
  await second.submit(deployTx.toXDR());
  const contract = Address.contract(Buffer.alloc(32, 92)).toString();
  f.outcome({
    status: 'SUCCESS',
    ledger: 124,
    returnValue: Address.fromString(contract).toScVal(),
  });
  await second.status();
  assert.equal(f.activated().contract, contract);
  assert.equal(f.count(), 2);
  assert.equal((await second.prepare()).done, true);
});
test('deployment state cannot be reused with a different policy key', (t) => {
  const f = fixture(t);
  f.create();
  assert.throws(
    () => createMainnetBootstrap({ ...f.options, signerPublicKeyHex: '99'.repeat(32) }),
    /CONFIG_CHANGED/,
  );
});
