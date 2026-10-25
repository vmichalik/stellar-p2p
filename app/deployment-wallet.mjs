import { readDeploymentDomain } from './host-client.mjs';

// The exchange chooses the network from its validated public deployment. The
// standalone wallet setup page may still choose a network independently.
export function createDeploymentWallet({ readDeployment, createWallet, onInvalidate = () => {} }) {
  let active = null;
  let generation = 0;
  let connecting = null;
  const fail = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  const domain = () => {
    const value = readDeployment();
    if (!value) fail('HOST_NOT_CONFIGURED');
    return readDeploymentDomain(value);
  };
  function assertCurrent(expected, epoch) {
    if (epoch !== generation || domain().deploymentId !== expected)
      fail('CLIENT_DEPLOYMENT_CHANGED');
  }
  async function connected() {
    const current = domain();
    if (active && active.id !== current.deploymentId) fail('CLIENT_DEPLOYMENT_CHANGED');
    if (active?.connected) return active;
    if (connecting) return connecting;
    const epoch = generation;
    connecting = (async () => {
      const wallet =
        active?.wallet ??
        (await createWallet({
          networkPassphrase: current.networkPassphrase,
          onInvalidate: () => {
            generation++;
            if (active) active.connected = false;
            onInvalidate();
          },
        }));
      assertCurrent(current.deploymentId, epoch);
      active = { id: current.deploymentId, wallet, connected: false };
      const access = await wallet.requestAccess();
      assertCurrent(current.deploymentId, epoch);
      if (access?.error) fail('WALLET_UNAVAILABLE');
      const selected = await wallet.getNetworkDetails();
      assertCurrent(current.deploymentId, epoch);
      if (selected?.error || selected.networkPassphrase !== current.networkPassphrase)
        fail('WALLET_NETWORK_CHANGED');
      active.connected = true;
      return active;
    })();
    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  }
  const api = {};
  for (const method of [
    'requestAccess',
    'getAddress',
    'getNetworkDetails',
    'signMessage',
    'signTransaction',
    'signAuthEntry',
  ]) {
    api[method] = async (...args) => {
      const item = await connected();
      const epoch = generation;
      const result = await item.wallet[method === 'requestAccess' ? 'getAddress' : method](...args);
      assertCurrent(item.id, epoch);
      return result;
    };
  }
  api.disconnect = async () => {
    generation++;
    const previous = active;
    active = null;
    previous?.wallet.cancel?.();
    await previous?.wallet.disconnect();
  };
  return Object.freeze(api);
}
