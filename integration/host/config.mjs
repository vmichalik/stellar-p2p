import { readFileSync, statSync } from 'node:fs';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';

const fail = () => {
  throw new Error('HOST_CONFIGURATION_INVALID');
};
const required = (value) => {
  if (typeof value !== 'string' || !value.trim()) fail();
  return value.trim();
};
const positiveInteger = (value) => {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || value.length > 20) fail();
  return value;
};

function assertHttps(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail();
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) fail();
  return parsed.href.replace(/\/$/, '');
}

export function loadDeployment(path) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (config.networkPassphrase !== Networks.TESTNET) fail();
  if (!StrKey.isValidContract(config.contract) || !StrKey.isValidContract(config.token)) fail();
  if (config.tokenDecimals !== 7) fail();
  if (!/^[a-f0-9]{64}$/.test(config.policySignerPublicKeyHex ?? '')) fail();
  const fixtures = [0x11, 0x2a].map((byte) =>
    Buffer.from(Keypair.fromRawEd25519Seed(Buffer.alloc(32, byte)).rawPublicKey()).toString('hex'),
  );
  if (fixtures.includes(config.policySignerPublicKeyHex)) fail();
  if (BigInt(positiveInteger(config.maxFeeStroops)) <= 0n) fail();
  if (!Number.isSafeInteger(config.startLedger) || config.startLedger < 1) fail();
  if (!StrKey.isValidEd25519PublicKey(config.readerAccount)) fail();
  if (config.submissionEnabled !== undefined && typeof config.submissionEnabled !== 'boolean')
    fail();
  return Object.freeze({ ...config, rpcUrl: assertHttps(required(config.rpcUrl)) });
}

export function loadPrivateOfferConfig(path, contract) {
  const metadata = statSync(path);
  if ((metadata.mode & 0o077) !== 0) fail();
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (
    value.contract !== contract ||
    typeof value.recipientSalt !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.recipientSalt)
  )
    fail();
  if (
    typeof value.recipientId !== 'string' ||
    value.recipientId.length < 1 ||
    value.recipientId.length > 128
  )
    fail();
  if (
    value.orderId !== undefined &&
    (typeof value.orderId !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value.orderId))
  )
    fail();
  if (
    !StrKey.isValidEd25519PublicKey(value.seller) ||
    !value.destination ||
    typeof value.destination !== 'object' ||
    Array.isArray(value.destination)
  )
    fail();
  return Object.freeze({ ...value });
}

export function loadSigningKey(path, expectedPublicKeyHex) {
  const metadata = statSync(path);
  if ((metadata.mode & 0o077) !== 0) fail();
  const bytes = readFileSync(path);
  let keypair;
  try {
    const raw = bytes.toString('utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(raw)) fail();
    keypair = Keypair.fromRawEd25519Seed(Buffer.from(raw, 'hex'));
  } finally {
    bytes.fill(0);
  }
  const publicKeyHex = Buffer.from(keypair.rawPublicKey()).toString('hex');
  if (publicKeyHex !== expectedPublicKeyHex) fail();
  return Object.freeze({ publicKeyHex, signDigest: async (digest) => keypair.sign(digest) });
}

export function sanitizedConfig(deployment, mode = 'live') {
  return Object.freeze({
    mode,
    network: 'testnet',
    networkPassphrase: deployment.networkPassphrase,
    contract: deployment.contract,
    token: deployment.token,
    tokenDecimals: deployment.tokenDecimals,
    policySignerPublicKeyHex: deployment.policySignerPublicKeyHex,
    submissionEnabled: deployment.submissionEnabled === true,
  });
}
