import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once, EventEmitter } from 'node:events';
import { Address, Asset, Keypair } from '@stellar/stellar-sdk';
import { createBrowserBridge } from './browser-bridge.mjs';
import { createDeploymentWallet } from '../app/deployment-wallet.mjs';
import { createHostClient } from '../app/host-client.mjs';
import { createFreighterConnector, STELLAR_NETWORKS } from '../app/freighter-connector.mjs';

for (const hostNetwork of ['testnet', 'mainnet'])
  test(`mobile connector authenticates to ${hostNetwork} through HTTP and rejects the other wallet network`, async (t) => {
    const key = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 91));
    let bridge,
      signatures = 0,
      commands = 0;
    const server = createServer((req, res) => {
      if (req.url === '/api/commands') commands++;
      bridge.handler(req, res);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const asset = { code: 'UNIT', issuer: Keypair.random().publicKey() };
    const deployment = {
      network: hostNetwork,
      networkPassphrase: STELLAR_NETWORKS[hostNetwork].passphrase,
      contract: Address.contract(Buffer.alloc(32, 41)).toString(),
      token: new Asset(asset.code, asset.issuer).contractId(
        STELLAR_NETWORKS[hostNetwork].passphrase,
      ),
      asset,
      tokenDecimals: 7,
      tokenLabel: 'Synthetic fixture token',
    };
    bridge = createBrowserBridge({
      publicOrigin: origin,
      deployment,
      createServices: () => ({}),
      readView: async () => ({
        configured: true,
        deployment,
        serverTime: '1000',
        offers: [],
        ownerOrders: [],
        sellerDrafts: [],
        unavailableReasons: [],
      }),
    });
    t.after(async () => {
      bridge.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    const jar = new Map();
    const transport = async (path, options) => {
      const response = await fetch(origin + path, {
        ...options,
        headers: {
          ...options.headers,
          Origin: origin,
          Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        },
      });
      for (const entry of response.headers.getSetCookie()) {
        const part = entry.split(';')[0],
          i = part.indexOf('=');
        jar.set(part.slice(0, i), part.slice(i + 1));
      }
      return response;
    };
    for (const network of ['testnet', 'mainnet']) {
      const provider = new EventEmitter();
      provider.session = {
        expiry: Math.floor(Date.now() / 1000) + 3600,
        namespaces: {
          stellar: {
            accounts: [`${STELLAR_NETWORKS[network].chain}:${key.publicKey()}`],
            methods: ['stellar_signXDR', 'stellar_signMessage', 'stellar_signAuthEntry'],
          },
        },
      };
      provider.request = async ({ method, params }, chain) => {
        assert.equal(method, 'stellar_signMessage');
        assert.equal(chain, STELLAR_NETWORKS[network].chain);
        signatures++;
        return { signature: Buffer.from(key.signMessage(params.message)).toString('base64') };
      };
      provider.disconnect = async () => {
        provider.session = null;
      };
      provider.abortPairingAttempt = () => {};
      const connector = createDeploymentWallet({
        readDeployment: () => deployment,
        createWallet: async (options) =>
          createFreighterConnector({
            ...options,
            choose: async () => 'mobile',
            loadMobile: async () => provider,
          }),
      });
      const client = createHostClient({
        freighter: connector,
        fetch: transport,
        location: { origin },
      });
      if (network === hostNetwork) {
        const authenticated = await client.authenticate();
        assert.equal(authenticated.account, key.publicKey());
        await client.logout();
      } else await assert.rejects(client.authenticate(), /WALLET_UNAVAILABLE/);
    }
    assert.equal(signatures, 1);
    assert.equal(commands, 0);
  });
