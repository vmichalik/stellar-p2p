import test from 'node:test';
import assert from 'node:assert/strict';
import { Asset, Keypair, Networks } from '@stellar/stellar-sdk';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateDeployment,
  assertRpcNetwork,
  actionKey,
  submissionAllowed,
} from './deployment-config.mjs';
import { operatorOptions } from './operator.example.mjs';
import { bindStorageDeployment } from './storage-deployment.mjs';
import { assertReceivingReady } from './asset-readiness.mjs';
import { deployment, fixture, alice } from './test-fixtures/host-runtime.mjs';
import { issuedDeployment, receivingEntries } from './test-fixtures/issued-asset.mjs';

test('testnet remains the default; mainnet is explicit with exact issued asset, identity and separate submission opt-in', () => {
  const testnet = validateDeployment(deployment);
  assert.equal(testnet.network, 'testnet');
  const mainnet = validateDeployment(issuedDeployment(deployment, 'mainnet'));
  assert.equal(mainnet.networkPassphrase, Networks.PUBLIC);
  assert.equal(
    mainnet.token,
    new Asset(mainnet.asset.code, mainnet.asset.issuer).contractId(Networks.PUBLIC),
  );
  assert.equal(submissionAllowed(mainnet), false);
  assert.equal(submissionAllowed(mainnet, true), false);
  assert.equal(
    submissionAllowed(validateDeployment({ ...mainnet, allowMainnetSubmission: true }), true),
    true,
  );
  assert.equal(submissionAllowed(testnet, true), true);
  assert.throws(
    () => validateDeployment({ ...mainnet, network: undefined }),
    /NETWORK_CONFIGURATION_MISMATCH/,
  );
});

test('inconsistent networks, asset/contract, fixture signer, unsupported protocol and unbounded fees are rejected', () => {
  const cfg = issuedDeployment(deployment, 'mainnet');
  for (const [change, code] of [
    [{ network: 'public' }, 'NETWORK_CONFIGURATION_MISMATCH'],
    [{ network: ['mainnet'] }, 'NETWORK_CONFIGURATION_MISMATCH'],
    [{ networkPassphrase: Networks.TESTNET }, 'NETWORK_CONFIGURATION_MISMATCH'],
    [{ asset: undefined }, 'ASSET_IDENTITY_REQUIRED'],
    [{ token: deployment.token }, 'ASSET_CONTRACT_MISMATCH'],
    [{ tokenDecimals: 6 }, 'INVALID_DEPLOYMENT'],
    [{ contract: cfg.token }, 'INVALID_DEPLOYMENT'],
    [{ escrowWasmSha256: '' }, 'INVALID_DEPLOYMENT'],
    [
      {
        policySignerPublicKeyHex: Buffer.from(
          Keypair.fromRawEd25519Seed(Buffer.alloc(32, 0x11)).rawPublicKey(),
        ).toString('hex'),
      },
      'PUBLIC_FIXTURE_SIGNER_FORBIDDEN',
    ],
    [{ maxFeeStroops: '4294967296' }, 'FEE_LIMIT_REQUIRED'],
    [{ maxFeeStroops: '1e4' }, 'FEE_LIMIT_REQUIRED'],
    [{ protocolVersion: 30 }, 'UNSUPPORTED_PROTOCOL'],
    [{ rpcUrl: 'http://localhost:8000' }, 'INVALID_RPC_URL'],
  ])
    assert.throws(() => validateDeployment({ ...cfg, ...change }), new RegExp(code));
  assert.throws(
    () => assertRpcNetwork(cfg, { passphrase: Networks.TESTNET, protocolVersion: 29 }),
    /RPC_NETWORK_MISMATCH/,
  );
  assert.throws(
    () => assertRpcNetwork(cfg, { passphrase: Networks.PUBLIC, protocolVersion: 30 }),
    /RPC_PROTOCOL_UNSUPPORTED/,
  );
  assert.doesNotThrow(() =>
    assertRpcNetwork(cfg, { passphrase: Networks.PUBLIC, protocolVersion: '29' }),
  );
});

test('journal namespaces include network and exact asset, and storage identity refuses cross-network or legacy reuse', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-network-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const testnet = validateDeployment(deployment);
  const mainnet = validateDeployment(issuedDeployment(deployment, 'mainnet'));
  assert.notEqual(actionKey(testnet, 'resolve', '0'), actionKey(mainnet, 'resolve', '0'));
  const differentToken = validateDeployment({ ...deployment, token: mainnet.token });
  assert.notEqual(actionKey(testnet, 'resolve', '0'), actionKey(differentToken, 'resolve', '0'));
  const shared = join(directory, 'shared-payments.sqlite');
  bindStorageDeployment(directory, testnet, shared);
  const before = readFileSync(join(directory, 'deployment.json'), 'utf8');
  assert.doesNotThrow(() => bindStorageDeployment(directory, testnet, shared));
  assert.throws(
    () => bindStorageDeployment(directory, mainnet, shared),
    /STORAGE_DEPLOYMENT_MISMATCH/,
  );
  assert.throws(
    () => bindStorageDeployment(directory, testnet, shared + '.new'),
    /STORAGE_DEPLOYMENT_MISMATCH/,
  );
  assert.equal(readFileSync(join(directory, 'deployment.json'), 'utf8'), before);
  const legacy = mkdtempSync(join(tmpdir(), 'pactlane-legacy-store-'));
  t.after(() => rmSync(legacy, { recursive: true, force: true }));
  writeFileSync(join(legacy, 'transactions.sqlite'), 'retained unknown transaction');
  assert.throws(
    () => bindStorageDeployment(legacy, testnet, shared),
    /LEGACY_STORAGE_REVIEW_REQUIRED/,
  );
  assert.equal(
    readFileSync(join(legacy, 'transactions.sqlite'), 'utf8'),
    'retained unknown transaction',
  );
});

test('receiving readiness checks exact trustline authorization and BigInt capacity including liabilities', async () => {
  const cfg = issuedDeployment(deployment, 'mainnet'),
    account = Keypair.random().publicKey();
  let options = {},
    sent = 0;
  const server = {
    getNetwork: async () => ({ passphrase: Networks.PUBLIC, protocolVersion: 29 }),
    getLedgerEntries: async (...keys) => receivingEntries(keys, options),
    getLedgers: async () => ({ ledgers: [{ sequence: 100, ledgerCloseTime: '1000' }] }),
    sendTransaction: async () => {
      sent++;
      throw Error('never submit');
    },
  };
  const check = () =>
    assertReceivingReady({
      deployment: cfg,
      server,
      account,
      amount: '9007199254740993',
      clock: () => '1010',
    });
  assert.equal((await check()).ready, true);
  for (const [state, error] of [
    [{ missingAccount: true }, 'RECEIVING_ACCOUNT_MISSING'],
    [{ missingTrustline: true }, 'RECEIVING_TRUSTLINE_MISSING'],
    [{ flags: 2 }, 'RECEIVING_ASSET_UNAUTHORIZED'],
    [{ limit: 9007199254740993n, buying: 1n }, 'RECEIVING_CAPACITY_INSUFFICIENT'],
    [{ limit: 9007199254740993n, balance: 1n }, 'RECEIVING_CAPACITY_INSUFFICIENT'],
  ]) {
    options = state;
    await assert.rejects(check(), new RegExp(error));
  }
  assert.equal(sent, 0);
});

test('mainnet runtime validates chain identity, exposes accurate mode and keeps submission/payment locked by default', async (t) => {
  const cfg = issuedDeployment(deployment, 'mainnet');
  const f = fixture(t, { deployment: cfg });
  assert.throws(() => f.create(), /SHARED_REPLAY_STORE_REQUIRED/);
  const runtime = f.create({
    replayStorePath: join(f.storageDirectory, '..', 'authority-payments.sqlite'),
  });
  const view = await runtime.readView({ account: alice });
  assert.equal(view.deployment.network, 'mainnet');
  assert.equal(view.deployment.token, cfg.token);
  assert.equal(view.offers.length, 1);
  assert.deepEqual(view.readiness, { paymentProof: false, submission: false, recovery: false });
  const services = await runtime.createServices({ account: alice, wallet: f.wallet });
  await services.connectWallet('seller');
  await assert.rejects(services.fund(f.own.publicTerms), /MAINNET_SUBMISSION_NOT_AUTHORIZED/);
  await assert.rejects(services.beginPayment('0'), /PAYMENT_VERIFICATION_UNAVAILABLE/);
  await assert.rejects(services.getPaymentInstructions('1'), /PAYMENT_VERIFICATION_UNAVAILABLE/);
  assert.equal(f.counts.sign, 0);
  assert.equal(f.counts.submit, 0);
});

test('wrong RPC network prevents mainnet wallet access', async (t) => {
  const cfg = issuedDeployment(deployment, 'mainnet');
  const f = fixture(t, { deployment: cfg, rpcNetwork: Networks.TESTNET });
  const runtime = f.create({
    replayStorePath: join(f.storageDirectory, '..', 'authority-payments.sqlite'),
  });
  const service = await runtime.createServices({ account: alice, wallet: f.wallet });
  await assert.rejects(service.connectWallet('buyer'), /RPC_NETWORK_MISMATCH/);
  assert.deepEqual(f.counts.walletCalls, []);
  assert.equal(f.counts.submit, 0);
});

test('operator example derives only the explicit network and never supplies deployment values or permissions', () => {
  assert.throws(() => operatorOptions({}), /Required operator input/);
  const cfg = issuedDeployment(deployment, 'mainnet');
  const env = {
    PACTLANE_NETWORK: 'mainnet',
    PACTLANE_RPC_URL: cfg.rpcUrl,
    PACTLANE_ESCROW_CONTRACT: cfg.contract,
    PACTLANE_ESCROW_WASM_SHA256: cfg.escrowWasmSha256,
    PACTLANE_TOKEN_CONTRACT: cfg.token,
    PACTLANE_ASSET_CODE: cfg.asset.code,
    PACTLANE_ASSET_ISSUER: cfg.asset.issuer,
    PACTLANE_POLICY_PUBLIC_KEY_HEX: cfg.policySignerPublicKeyHex,
    PACTLANE_MAX_FEE_STROOPS: cfg.maxFeeStroops,
    PACTLANE_DEPLOYMENT_LEDGER: '90',
    PACTLANE_STORAGE_DIRECTORY: '/private/tmp/example-mainnet',
    PACTLANE_REPLAY_STORE_PATH: '/private/tmp/example-shared-payments.sqlite',
  };
  const options = operatorOptions(env);
  assert.equal(options.deployment.network, 'mainnet');
  assert.equal(options.submissionEnabled, false);
  assert.equal(options.deployment.allowMainnetSubmission, false);
  assert.throws(
    () => operatorOptions({ ...env, PACTLANE_SUBMISSION_ENABLED: 'yes' }),
    /Expected true or false/,
  );
  assert.throws(
    () => operatorOptions({ ...env, PACTLANE_NETWORK_PASSPHRASE: Networks.TESTNET }),
    /NETWORK_CONFIGURATION_MISMATCH/,
  );
});
