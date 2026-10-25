// Trusted local operator module, never a public HTTP configuration route.
// No key material, deployment address, RPC provider or permission is supplied here.
import { createHostRuntime } from './host-runtime.mjs';
import { validateDeployment } from './deployment-config.mjs';
import { resolveNetwork } from '../app/network.mjs';

const required = (env, name) => {
  const value = env[name];
  if (typeof value !== 'string' || !value || value.trim() !== value)
    throw Error(`Required operator input: ${name}`);
  return value;
};
const flag = (env, name) => {
  const value = env[name] ?? 'false';
  if (value !== 'true' && value !== 'false') throw Error(`Expected true or false: ${name}`);
  return value === 'true';
};

export function operatorOptions(env = process.env) {
  const selected = resolveNetwork({
    network: env.PACTLANE_NETWORK ?? 'testnet',
    networkPassphrase: env.PACTLANE_NETWORK_PASSPHRASE,
  });
  const deployment = validateDeployment({
    network: selected.name,
    networkPassphrase: selected.passphrase,
    rpcUrl: required(env, 'PACTLANE_RPC_URL'),
    contract: required(env, 'PACTLANE_ESCROW_CONTRACT'),
    escrowWasmSha256: required(env, 'PACTLANE_ESCROW_WASM_SHA256'),
    token: required(env, 'PACTLANE_TOKEN_CONTRACT'),
    asset: {
      code: required(env, 'PACTLANE_ASSET_CODE'),
      issuer: required(env, 'PACTLANE_ASSET_ISSUER'),
    },
    tokenDecimals: 7,
    policySignerPublicKeyHex: required(env, 'PACTLANE_POLICY_PUBLIC_KEY_HEX'),
    maxFeeStroops: required(env, 'PACTLANE_MAX_FEE_STROOPS'),
    allowMainnetSubmission: flag(env, 'PACTLANE_ALLOW_MAINNET_SUBMISSION'),
  });
  return {
    deployment,
    deploymentLedger: required(env, 'PACTLANE_DEPLOYMENT_LEDGER'),
    storageDirectory: required(env, 'PACTLANE_STORAGE_DIRECTORY'),
    replayStorePath: required(env, 'PACTLANE_REPLAY_STORE_PATH'),
    submissionEnabled: flag(env, 'PACTLANE_SUBMISSION_ENABLED'),
    // Add only independently approved orders/offers to the trusted composition.
    // No proof-success adapter or payment signer is constructed by this example.
    orderIds: [],
    sellerDrafts: [],
  };
}

export function createRuntime() {
  return createHostRuntime(operatorOptions());
}
