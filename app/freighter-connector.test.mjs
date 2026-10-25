import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createFreighterConnector, STELLAR_NETWORKS } from './freighter-connector.mjs';
const ACCOUNT = 'G' + 'A'.repeat(55),
  OTHER = 'G' + 'B'.repeat(55);
const SIG = btoa(String.fromCharCode(...new Uint8Array(64).fill(17)));
function fixture({ network = 'testnet', session, request } = {}) {
  const calls = [],
    provider = new EventEmitter(),
    net = STELLAR_NETWORKS[network];
  provider.session = session ?? {
    expiry: 1000,
    namespaces: {
      stellar: {
        accounts: [`${net.chain}:${ACCOUNT}`],
        methods: ['stellar_signXDR', 'stellar_signMessage', 'stellar_signAuthEntry'],
      },
    },
  };
  provider.connect = async (options) => {
    calls.push(['connect', options]);
    return provider.session;
  };
  provider.disconnect = async () => {
    provider.session = null;
  };
  provider.abortPairingAttempt = () => {};
  provider.request = async (method, chain) => {
    calls.push([method, chain]);
    return request
      ? request(method, provider)
      : {
          signature: SIG,
          signedXDR: btoa('signed envelope'),
          signedAuthEntry: SIG,
          signerAddress: ACCOUNT,
        };
  };
  const wallet = createFreighterConnector({
    networkPassphrase: net.passphrase,
    choose: async () => 'mobile',
    loadMobile: async () => provider,
    clock: () => 1000,
  });
  return {
    wallet,
    provider,
    calls,
    options: { address: ACCOUNT, networkPassphrase: net.passphrase },
  };
}
for (const network of ['testnet', 'mainnet'])
  test(`${network}: mobile normalizes all required Freighter methods without wallet submission`, async () => {
    const f = fixture({ network });
    assert.equal((await f.wallet.requestAccess()).address, ACCOUNT);
    assert.equal(
      (await f.wallet.getNetworkDetails()).networkPassphrase,
      STELLAR_NETWORKS[network].passphrase,
    );
    assert.equal((await f.wallet.signMessage('session challenge', f.options)).signedMessage, SIG);
    assert.equal(
      (await f.wallet.signTransaction('unsigned XDR', f.options)).signerAddress,
      ACCOUNT,
    );
    assert.equal((await f.wallet.signAuthEntry('auth preimage', f.options)).signedAuthEntry, SIG);
    assert.deepEqual(
      f.calls.map((c) => c[0].method),
      ['stellar_signMessage', 'stellar_signXDR', 'stellar_signAuthEntry'],
    );
    assert.ok(f.calls.every((c) => c[1] === STELLAR_NETWORKS[network].chain));
  });
test('rejects missing mobile capabilities before login or recovery signing', async () => {
  const f = fixture();
  f.provider.session.namespaces.stellar.methods = ['stellar_signXDR'];
  await assert.rejects(f.wallet.requestAccess(), /WALLET_METHOD_UNSUPPORTED/);
  assert.equal(f.calls.length, 0);
});
test('rejects mainnet/testnet mismatch and ambiguous wallet accounts', async () => {
  const f = fixture({ network: 'mainnet' });
  f.provider.session.namespaces.stellar.accounts = [`stellar:testnet:${ACCOUNT}`];
  await assert.rejects(f.wallet.requestAccess(), /WALLET_NETWORK_MISMATCH/);
  const ambiguous = fixture({ network: 'mainnet' });
  ambiguous.provider.session.namespaces.stellar.accounts = [
    `stellar:pubnet:${ACCOUNT}`,
    `stellar:pubnet:${OTHER}`,
  ];
  await assert.rejects(ambiguous.wallet.requestAccess(), /WALLET_ACCOUNT_AMBIGUOUS/);
});
test('rejects signing for another network or address without a wallet request', async () => {
  const f = fixture();
  await f.wallet.requestAccess();
  await assert.rejects(
    f.wallet.signTransaction('x', {
      ...f.options,
      networkPassphrase: STELLAR_NETWORKS.mainnet.passphrase,
    }),
    /WALLET_SIGNING_DOMAIN_MISMATCH/,
  );
  await assert.rejects(
    f.wallet.signAuthEntry('x', { ...f.options, address: OTHER }),
    /WALLET_SIGNING_DOMAIN_MISMATCH/,
  );
  assert.equal(f.calls.length, 0);
});
test('account switch, chain switch and expiry invalidate a mobile signing result', async () => {
  for (const event of ['accountsChanged', 'chainChanged', 'session_expire']) {
    const f = fixture({
      request: async (m, p) => {
        p.emit(event, []);
        return { signature: SIG };
      },
    });
    await f.wallet.requestAccess();
    await assert.rejects(f.wallet.signMessage('challenge', f.options), /WALLET_SESSION_CHANGED/);
  }
});
test('malformed signatures and wrong recovery signer are rejected', async () => {
  const f = fixture({
    request: async () => ({ signature: 'not base64', signedAuthEntry: SIG, signerAddress: OTHER }),
  });
  await f.wallet.requestAccess();
  await assert.rejects(f.wallet.signMessage('challenge', f.options), /WALLET_RESPONSE_INVALID/);
  await assert.rejects(f.wallet.signAuthEntry('preimage', f.options), /WALLET_ACCOUNT_CHANGED/);
});
test('wallet refusal is not promoted to the pinned extension definite-refusal code', async () => {
  const f = fixture({
    request: async () => {
      throw Object.assign(new Error('Rejected'), { code: 5000 });
    },
  });
  await f.wallet.requestAccess();
  await assert.rejects(f.wallet.signTransaction('xdr', f.options), (e) => e.code === 5000);
  assert.equal(f.calls.length, 1);
});
test('message byte limit is enforced for UTF-8 before prompting', async () => {
  const f = fixture();
  await f.wallet.requestAccess();
  await assert.rejects(f.wallet.signMessage('€'.repeat(342), f.options), /WALLET_MESSAGE_INVALID/);
  assert.equal(f.calls.length, 0);
});
test('desktop connection checks network and signing stays account/domain bound', async () => {
  let signs = 0;
  const extension = {
    isConnected: async () => ({ isConnected: true }),
    requestAccess: async () => ({ address: ACCOUNT }),
    getAddress: async () => ({ address: ACCOUNT }),
    getNetworkDetails: async () => ({ networkPassphrase: STELLAR_NETWORKS.mainnet.passphrase }),
    signTransaction: async () => {
      signs++;
      return { signedTxXdr: 'signed', signerAddress: ACCOUNT };
    },
  };
  const wallet = createFreighterConnector({
    extension,
    networkPassphrase: STELLAR_NETWORKS.mainnet.passphrase,
  });
  await wallet.requestAccess();
  await assert.rejects(
    wallet.signTransaction('xdr', {
      address: ACCOUNT,
      networkPassphrase: STELLAR_NETWORKS.testnet.passphrase,
    }),
    /WALLET_SIGNING_DOMAIN_MISMATCH/,
  );
  assert.equal(signs, 0);
  await wallet.signTransaction('xdr', {
    address: ACCOUNT,
    networkPassphrase: STELLAR_NETWORKS.mainnet.passphrase,
  });
  assert.equal(signs, 1);
});
test('cancel during pairing settles immediately and disconnects any late approved session', async () => {
  const provider = new EventEmitter();
  let approve,
    disconnected = 0,
    shown;
  provider.session = null;
  provider.connect = () =>
    new Promise((resolve) => {
      approve = () => {
        provider.session = {
          expiry: 1000,
          namespaces: {
            stellar: {
              accounts: [`stellar:testnet:${ACCOUNT}`],
              methods: ['stellar_signXDR', 'stellar_signMessage', 'stellar_signAuthEntry'],
            },
          },
        };
        resolve(provider.session);
      };
      provider.emit(
        'display_uri',
        'wc:' + 'a'.repeat(64) + '@2?relay-protocol=irn&symKey=' + 'b'.repeat(64),
      );
    });
  provider.disconnect = async () => {
    disconnected++;
    provider.session = null;
  };
  provider.abortPairingAttempt = () => {};
  const wallet = createFreighterConnector({
    choose: async () => 'mobile',
    loadMobile: async () => provider,
    clock: () => 1000,
    pair: (uri, cancel) => {
      if (uri) shown = cancel;
    },
  });
  const pending = wallet.requestAccess();
  for (let i = 0; i < 10 && !shown; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof shown, 'function');
  shown();
  await assert.rejects(pending, /WALLET_CONNECTION_CANCELLED/);
  approve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disconnected, 1);
  await assert.rejects(wallet.getNetworkDetails(), /WALLET_NOT_CONNECTED|WALLET_SESSION_EXPIRED/);
});

test('late cancelled-provider events cannot invalidate a subsequent approved wallet', async () => {
  const old = new EventEmitter(),
    newer = new EventEmitter();
  let approve,
    shown,
    invalidations = 0,
    loads = 0;
  const session = () => ({
    expiry: 1000,
    namespaces: {
      stellar: {
        accounts: [`stellar:testnet:${ACCOUNT}`],
        methods: ['stellar_signXDR', 'stellar_signMessage', 'stellar_signAuthEntry'],
      },
    },
  });
  old.session = null;
  old.abortPairingAttempt = () => {};
  old.disconnect = async () => {
    old.session = null;
    old.emit('session_delete');
  };
  old.connect = () =>
    new Promise((resolve) => {
      approve = () => {
        old.session = session();
        resolve(old.session);
      };
      old.emit('display_uri', 'wc:' + 'a'.repeat(64) + '@2?relay-protocol=irn');
    });
  newer.session = session();
  newer.abortPairingAttempt = () => {};
  newer.disconnect = async () => {};
  const wallet = createFreighterConnector({
    choose: async () => 'mobile',
    clock: () => 1000,
    loadMobile: async () => (++loads === 1 ? old : newer),
    pair: (uri, cancel) => {
      if (uri) shown = cancel;
    },
    onInvalidate: () => invalidations++,
  });
  const first = wallet.requestAccess();
  for (let i = 0; i < 10 && !shown; i++) await new Promise((resolve) => setImmediate(resolve));
  shown();
  await assert.rejects(first, /WALLET_CONNECTION_CANCELLED/);
  await wallet.requestAccess();
  assert.equal(invalidations, 1);
  approve();
  await new Promise((resolve) => setImmediate(resolve));
  old.emit('accountsChanged');
  assert.equal((await wallet.getAddress()).address, ACCOUNT);
  assert.equal(invalidations, 1);
  assert.equal(old.listenerCount('display_uri'), 0);
});
