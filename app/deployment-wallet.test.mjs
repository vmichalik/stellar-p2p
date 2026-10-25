import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeploymentWallet } from './deployment-wallet.mjs';
import { NETWORKS } from './network.mjs';

const deployment = (network) => ({
  network,
  networkPassphrase: NETWORKS[network].passphrase,
  contract: 'C' + 'A'.repeat(55),
  token: 'C' + 'B'.repeat(55),
});

test('unconfigured exchange cannot open a wallet or silently select testnet', async () => {
  let opened = 0;
  const wallet = createDeploymentWallet({
    readDeployment: () => null,
    createWallet: async () => {
      opened++;
    },
  });
  await assert.rejects(wallet.getNetworkDetails(), /HOST_NOT_CONFIGURED/);
  assert.equal(opened, 0);
});

test('network-first host access prompts once, preserves mainnet, and rejects deployment change before signing', async () => {
  let current = deployment('mainnet'),
    opened = 0,
    accesses = 0,
    signatures = 0;
  const wallet = createDeploymentWallet({
    readDeployment: () => current,
    createWallet: async ({ networkPassphrase }) => {
      opened++;
      assert.equal(networkPassphrase, NETWORKS.mainnet.passphrase);
      return {
        requestAccess: async () => {
          accesses++;
          return { address: 'fixture' };
        },
        getAddress: async () => ({ address: 'fixture' }),
        getNetworkDetails: async () => ({ networkPassphrase }),
        signMessage: async () => {
          signatures++;
        },
      };
    },
  });
  assert.equal((await wallet.getNetworkDetails()).networkPassphrase, NETWORKS.mainnet.passphrase);
  await wallet.requestAccess();
  assert.equal(opened, 1);
  assert.equal(accesses, 1);
  current = deployment('testnet');
  await assert.rejects(wallet.signMessage('no'), /CLIENT_DEPLOYMENT_CHANGED/);
  assert.equal(signatures, 0);
});

test('deployment change during wallet approval discards the late result', async () => {
  let current = deployment('mainnet'),
    approve;
  const pending = new Promise((resolve) => {
    approve = resolve;
  });
  const wallet = createDeploymentWallet({
    readDeployment: () => current,
    createWallet: async () => ({ requestAccess: () => pending }),
  });
  const opening = wallet.getNetworkDetails();
  await new Promise((resolve) => setImmediate(resolve));
  current = deployment('testnet');
  approve({ address: 'fixture' });
  await assert.rejects(opening, /CLIENT_DEPLOYMENT_CHANGED/);
});
