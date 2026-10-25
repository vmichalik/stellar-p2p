// Wallet transport only. The host still validates signatures, transaction XDR,
// deployment/network identity, policy acceptance and durable submission state.
export const STELLAR_NETWORKS = Object.freeze({
  testnet: Object.freeze({
    label: 'Stellar testnet',
    chain: 'stellar:testnet',
    passphrase: 'Test SDF Network ; September 2015',
  }),
  mainnet: Object.freeze({
    label: 'Stellar mainnet',
    chain: 'stellar:pubnet',
    passphrase: 'Public Global Stellar Network ; September 2015',
  }),
});
const METHODS = ['stellar_signXDR', 'stellar_signMessage', 'stellar_signAuthEntry'];
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const check = (value, code) => {
  if (!value) fail(code);
};
const address = (value) => typeof value === 'string' && /^G[A-Z2-7]{55}$/.test(value);
const signature = (value) => {
  check(
    typeof value === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(value),
    'WALLET_RESPONSE_INVALID',
  );
  check(atob(value).length === 64 && btoa(atob(value)) === value, 'WALLET_RESPONSE_INVALID');
  return value;
};

export function createFreighterConnector({
  extension = globalThis.freighterApi,
  networkPassphrase = STELLAR_NETWORKS.testnet.passphrase,
  choose = async () => 'extension',
  loadMobile,
  pair = () => {},
  onInvalidate = () => {},
  clock = Date.now,
} = {}) {
  const network = Object.values(STELLAR_NETWORKS).find((n) => n.passphrase === networkPassphrase);
  check(network, 'WALLET_NETWORK_UNSUPPORTED');
  let selected = null,
    provider = null,
    account = null,
    epoch = 0,
    busy = false,
    cancelAccess;
  const invalidate = () => {
    epoch++;
    account = null;
    cancelAccess?.();
    onInvalidate();
  };
  function sessionAccount() {
    const session = provider?.session,
      ns = session?.namespaces?.stellar;
    check(session && session.expiry * 1000 > clock(), 'WALLET_SESSION_EXPIRED');
    check(
      METHODS.every((m) => ns?.methods?.includes(m)),
      'WALLET_METHOD_UNSUPPORTED',
    );
    check(Array.isArray(ns.accounts) && ns.accounts.length === 1, 'WALLET_ACCOUNT_AMBIGUOUS');
    const prefix = network.chain + ':';
    check(
      ns.accounts[0].startsWith(prefix) && address(ns.accounts[0].slice(prefix.length)),
      'WALLET_NETWORK_MISMATCH',
    );
    const current = ns.accounts[0].slice(prefix.length);
    check(!account || account === current, 'WALLET_ACCOUNT_CHANGED');
    return current;
  }
  async function access() {
    check(!busy, 'WALLET_REQUEST_IN_PROGRESS');
    busy = true;
    const generation = epoch;
    const cancelled = new Promise((_, reject) => {
      cancelAccess = () =>
        reject(
          Object.assign(new Error('WALLET_CONNECTION_CANCELLED'), {
            code: 'WALLET_CONNECTION_CANCELLED',
          }),
        );
    });
    const pending = async (value) => Promise.race([value, cancelled]);
    try {
      selected = await pending(choose());
      check(generation === epoch, 'WALLET_SESSION_CHANGED');
      if (selected === 'extension') {
        check(typeof extension?.requestAccess === 'function', 'WALLET_UNAVAILABLE');
        const installed = await extension.isConnected?.();
        check(!installed || installed.isConnected === true, 'WALLET_EXTENSION_NOT_INSTALLED');
        const result = await extension.requestAccess();
        if (result?.error) return result;
        check(address(result?.address), 'WALLET_RESPONSE_INVALID');
        const active = await extension.getNetworkDetails();
        check(
          !active?.error && active.networkPassphrase === network.passphrase,
          'WALLET_NETWORK_MISMATCH',
        );
        check(generation === epoch, 'WALLET_SESSION_CHANGED');
        account = result.address;
        return result;
      }
      check(
        selected === 'mobile' && typeof loadMobile === 'function',
        'WALLET_MOBILE_NOT_CONFIGURED',
      );
      if (!provider) {
        const loading = loadMobile();
        loading.then(
          (late) => {
            if (generation !== epoch) {
              late.abortPairingAttempt();
              if (late.session) late.disconnect().catch(() => {});
            }
          },
          () => {},
        );
        provider = await pending(loading);
        const boundProvider = provider;
        const invalidateBound = () => {
          if (provider === boundProvider) invalidate();
        };
        for (const event of ['session_delete', 'session_expire'])
          provider.on(event, invalidateBound);
        for (const event of ['accountsChanged', 'chainChanged'])
          provider.on(event, () => {
            if (provider === boundProvider && account) invalidate();
          });
        provider.on('session_update', () => {
          if (provider !== boundProvider) return;
          try {
            sessionAccount();
          } catch {
            invalidate();
          }
        });
      }
      if (!provider.session) {
        const connectingProvider = provider;
        const display = (uri) => {
          if (provider === connectingProvider && generation === epoch) showPairing(uri);
        };
        connectingProvider.on('display_uri', display);
        try {
          const connecting = connectingProvider.connect({
            namespaces: {
              stellar: {
                chains: [network.chain],
                methods: METHODS,
                events: ['accountsChanged'],
              },
            },
          });
          connecting.then(
            () => {
              if (generation !== epoch && connectingProvider.session)
                connectingProvider.disconnect().catch(() => {});
            },
            () => {},
          );
          await pending(connecting);
        } finally {
          connectingProvider.removeListener('display_uri', display);
          pair(null);
        }
      }
      if (generation !== epoch) {
        await provider.disconnect().catch(() => {});
        fail('WALLET_SESSION_CHANGED');
      }
      account = sessionAccount();
      return { address: account };
    } catch (error) {
      if (provider?.session && !account) await provider.disconnect().catch(() => {});
      throw error;
    } finally {
      cancelAccess = null;
      busy = false;
      pair(null);
    }
  }
  function showPairing(uri) {
    check(
      typeof uri === 'string' && /^wc:[a-f0-9-]+@2\?/.test(uri) && uri.length < 4096,
      'WALLET_PAIRING_INVALID',
    );
    pair(uri, () => api.cancel());
  }
  async function mobileRequest(method, params, options) {
    check(selected === 'mobile' && provider, 'WALLET_NOT_CONNECTED');
    check(
      options?.networkPassphrase === network.passphrase && options?.address === account,
      'WALLET_SIGNING_DOMAIN_MISMATCH',
    );
    check(!busy, 'WALLET_REQUEST_IN_PROGRESS');
    const generation = epoch,
      signer = sessionAccount();
    busy = true;
    try {
      const result = await provider.request({ method, params }, network.chain);
      check(generation === epoch && sessionAccount() === signer, 'WALLET_SESSION_CHANGED');
      return { result, signer };
    } finally {
      busy = false;
    }
  }
  async function extensionSign(method, value, options) {
    check(
      options?.networkPassphrase === network.passphrase &&
        options?.address === account &&
        address(account),
      'WALLET_SIGNING_DOMAIN_MISMATCH',
    );
    check(!busy, 'WALLET_REQUEST_IN_PROGRESS');
    busy = true;
    const generation = epoch;
    try {
      const selectedAccount = await extension.getAddress();
      const current = await extension.getNetworkDetails();
      check(
        selectedAccount.address === account && current.networkPassphrase === network.passphrase,
        'WALLET_SIGNING_DOMAIN_MISMATCH',
      );
      const response = await extension[method](value, options);
      if (response?.error) return response;
      const afterAccount = await extension.getAddress(),
        afterNetwork = await extension.getNetworkDetails();
      check(
        generation === epoch &&
          afterAccount.address === account &&
          afterNetwork.networkPassphrase === network.passphrase &&
          response?.signerAddress === account,
        'WALLET_SESSION_CHANGED',
      );
      return response;
    } finally {
      busy = false;
    }
  }
  const api = {
    requestAccess: access,
    async getAddress() {
      if (!selected) return access();
      if (selected === 'mobile') return { address: sessionAccount() };
      return extension.getAddress();
    },
    async getNetworkDetails() {
      if (selected === 'mobile') {
        sessionAccount();
        return { network: network.label, networkPassphrase: network.passphrase };
      }
      check(selected === 'extension', 'WALLET_NOT_CONNECTED');
      return extension.getNetworkDetails();
    },
    async signMessage(message, options) {
      if (selected === 'extension') return extensionSign('signMessage', message, options);
      check(
        typeof message === 'string' &&
          new TextEncoder().encode(message).length <= 1024 &&
          message.length > 0,
        'WALLET_MESSAGE_INVALID',
      );
      const { result, signer } = await mobileRequest('stellar_signMessage', { message }, options);
      return { signedMessage: signature(result?.signature), signerAddress: signer };
    },
    async signTransaction(xdr, options) {
      if (selected === 'extension') return extensionSign('signTransaction', xdr, options);
      const { result, signer } = await mobileRequest('stellar_signXDR', { xdr }, options);
      check(
        typeof result?.signedXDR === 'string' &&
          result.signedXDR.length > 0 &&
          result.signedXDR.length <= 65536,
        'WALLET_RESPONSE_INVALID',
      );
      return { signedTxXdr: result.signedXDR, signerAddress: signer };
    },
    async signAuthEntry(entryXdr, options) {
      if (selected === 'extension') return extensionSign('signAuthEntry', entryXdr, options);
      const { result, signer } = await mobileRequest(
        'stellar_signAuthEntry',
        { entryXdr },
        options,
      );
      check(result?.signerAddress === signer, 'WALLET_ACCOUNT_CHANGED');
      return { signedAuthEntry: signature(result.signedAuthEntry), signerAddress: signer };
    },
    async disconnect() {
      epoch++;
      account = null;
      selected = null;
      const old = provider;
      provider = null;
      if (old?.session) await old.disconnect();
    },
    cancel() {
      const old = provider;
      invalidate();
      provider = null;
      old?.abortPairingAttempt();
      pair(null);
    },
    network,
  };
  return Object.freeze(api);
}
