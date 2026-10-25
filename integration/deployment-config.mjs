import { Asset, Keypair, StrKey } from '@stellar/stellar-sdk';
import { resolveNetwork, deploymentIdentity } from '../app/network.mjs';

const check = (ok, code = 'INVALID_DEPLOYMENT') => {
  if (!ok) throw Error(code);
};
const hex32 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// This SDK/XDR and escrow artifact have been reviewed against ledger protocol 29.
// A newer RPC binary does not establish support for a newer ledger protocol.
export const SUPPORTED_PROTOCOL = 29;

export function validateDeployment(input) {
  check(input && typeof input === 'object' && !Array.isArray(input));
  const cfg = structuredClone(input);
  const network = resolveNetwork(cfg);
  cfg.network = network.name;
  cfg.networkPassphrase = network.passphrase;
  let endpoint;
  try {
    endpoint = new URL(cfg.rpcUrl);
  } catch {
    throw Error('INVALID_RPC_URL');
  }
  check(
    endpoint.protocol === 'https:' &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash,
    'INVALID_RPC_URL',
  );
  check(StrKey.isValidContract(cfg.contract) && StrKey.isValidContract(cfg.token));
  check(cfg.contract !== cfg.token && cfg.tokenDecimals === 7);
  check(hex32(cfg.policySignerPublicKeyHex) && hex32(cfg.escrowWasmSha256));
  check(!/^0{64}$/.test(cfg.policySignerPublicKeyHex) && !/^0{64}$/.test(cfg.escrowWasmSha256));
  check(
    typeof cfg.maxFeeStroops === 'string' &&
      /^[1-9][0-9]{0,9}$/.test(cfg.maxFeeStroops) &&
      BigInt(cfg.maxFeeStroops) >= 100n &&
      BigInt(cfg.maxFeeStroops) <= 4294967295n,
    'FEE_LIMIT_REQUIRED',
  );
  const fixtureKeys = [0x11, 0x2a, ...(cfg.network === 'mainnet' ? [0x55] : [])].map((n) =>
    Buffer.from(Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)).rawPublicKey()).toString('hex'),
  );
  check(!fixtureKeys.includes(cfg.policySignerPublicKeyHex), 'PUBLIC_FIXTURE_SIGNER_FORBIDDEN');
  check(
    cfg.allowMainnetSubmission === undefined || typeof cfg.allowMainnetSubmission === 'boolean',
    'INVALID_SUBMISSION_SETTING',
  );
  cfg.allowMainnetSubmission ??= false;
  check(cfg.network === 'mainnet' || !cfg.allowMainnetSubmission, 'INVALID_SUBMISSION_SETTING');
  check(
    cfg.protocolVersion === undefined || cfg.protocolVersion === SUPPORTED_PROTOCOL,
    'UNSUPPORTED_PROTOCOL',
  );
  cfg.protocolVersion = SUPPORTED_PROTOCOL;
  if (cfg.asset !== undefined) {
    check(
      cfg.asset &&
        Object.keys(cfg.asset).length === 2 &&
        typeof cfg.asset.code === 'string' &&
        /^[a-zA-Z0-9]{1,12}$/.test(cfg.asset.code) &&
        StrKey.isValidEd25519PublicKey(cfg.asset.issuer),
      'INVALID_ASSET_IDENTITY',
    );
    const asset = new Asset(cfg.asset.code, cfg.asset.issuer);
    check(asset.contractId(cfg.networkPassphrase) === cfg.token, 'ASSET_CONTRACT_MISMATCH');
    cfg.asset = Object.freeze({ code: cfg.asset.code, issuer: cfg.asset.issuer });
  } else check(cfg.network === 'testnet', 'ASSET_IDENTITY_REQUIRED');
  check(
    cfg.tokenLabel === undefined ||
      (typeof cfg.tokenLabel === 'string' &&
        cfg.tokenLabel.length > 0 &&
        cfg.tokenLabel.length <= 80 &&
        !/[\x00-\x1f]/.test(cfg.tokenLabel)),
  );
  cfg.tokenLabel ??= cfg.asset?.code ?? 'Test token';
  const identity = deploymentIdentity(cfg);
  check(
    cfg.deploymentId === undefined || cfg.deploymentId === identity,
    'DEPLOYMENT_IDENTITY_MISMATCH',
  );
  cfg.deploymentId = identity;
  return Object.freeze(cfg);
}

export function assertRpcNetwork(cfg, metadata) {
  check(metadata?.passphrase === cfg.networkPassphrase, 'RPC_NETWORK_MISMATCH');
  check(
    /^[0-9]+$/.test(String(metadata.protocolVersion)) &&
      Number(metadata.protocolVersion) === SUPPORTED_PROTOCOL,
    'RPC_PROTOCOL_UNSUPPORTED',
  );
}

export function submissionAllowed(cfg, enabled = false) {
  check(typeof enabled === 'boolean', 'INVALID_SUBMISSION_SETTING');
  return enabled && (cfg.network !== 'mainnet' || cfg.allowMainnetSubmission === true);
}

export function requireSubmission(cfg, enabled) {
  check(
    submissionAllowed(cfg, enabled),
    cfg.network === 'mainnet'
      ? 'MAINNET_SUBMISSION_NOT_AUTHORIZED'
      : 'TESTNET_SUBMISSION_NOT_AUTHORIZED',
  );
}

export function publicDeployment(cfg) {
  return Object.freeze({
    network: cfg.network,
    networkPassphrase: cfg.networkPassphrase,
    contract: cfg.contract,
    token: cfg.token,
    tokenDecimals: cfg.tokenDecimals,
    tokenLabel: cfg.tokenLabel,
    ...(cfg.asset ? { asset: cfg.asset } : {}),
    deploymentId: cfg.deploymentId,
  });
}

export function actionKey(cfg, method, identity) {
  return `${cfg.deploymentId}:${method}:${identity}`;
}
