// Shared, browser-safe network names. No RPC endpoint or deployment is inferred.
export const NETWORKS = Object.freeze({
  testnet: Object.freeze({
    name: 'testnet',
    passphrase: 'Test SDF Network ; September 2015',
    label: 'Stellar testnet',
  }),
  mainnet: Object.freeze({
    name: 'mainnet',
    passphrase: 'Public Global Stellar Network ; September 2015',
    label: 'Stellar mainnet',
  }),
});

export function resolveNetwork({ network = 'testnet', networkPassphrase } = {}) {
  const selected =
    typeof network === 'string' && Object.hasOwn(NETWORKS, network) ? NETWORKS[network] : null;
  if (!selected || (networkPassphrase !== undefined && networkPassphrase !== selected.passphrase))
    throw Error('NETWORK_CONFIGURATION_MISMATCH');
  return selected;
}

export function deploymentIdentity(value) {
  const selected = resolveNetwork(value);
  if (
    value?.networkPassphrase !== selected.passphrase ||
    !/^C[A-Z2-7]{55}$/.test(value?.contract ?? '') ||
    !/^C[A-Z2-7]{55}$/.test(value?.token ?? '')
  )
    throw Error('INVALID_DEPLOYMENT');
  return JSON.stringify([selected.passphrase, value.contract, value.token]);
}
