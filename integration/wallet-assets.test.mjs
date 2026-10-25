import test from 'node:test';
import assert from 'node:assert/strict';
import { walletConfiguration, walletBundle } from './wallet-assets.mjs';
test('mobile configuration is explicit, public, same-origin and HTTPS', () => {
  const publicOrigin = 'https://pactlane.example.test';
  assert.equal(walletConfiguration({ publicOrigin }).enabled, false);
  assert.equal(walletConfiguration({ publicOrigin, projectId: 'a'.repeat(32) }).enabled, true);
  for (const bad of [
    { projectId: 'invalid' },
    { appUrl: 'https://other.example' },
    { appUrl: publicOrigin + '/private' },
    { appUrl: publicOrigin + '?key=secret' },
  ])
    assert.throws(
      () => walletConfiguration({ publicOrigin, ...bad }),
      /WALLET_CONFIGURATION_INVALID/,
    );
  assert.throws(
    () => walletConfiguration({ publicOrigin: 'http://public.example' }),
    /WALLET_CONFIGURATION_INVALID/,
  );
});
test('the pinned mobile SDK and QR encoder bundle locally as browser ESM', async () => {
  const bundle = await walletBundle();
  assert.ok(bundle.length > 1000);
  const source = new TextDecoder().decode(bundle);
  assert.match(source, /createProvider/);
  assert.match(source, /pairingImage/);
});
