import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostClient, answerWalletRequest } from './client.mjs';

test('capability stays in the bearer header and requests cannot escape the host API', async () => {
  let recorded;
  const client = createHostClient({
    capability: 'a'.repeat(43),
    fetchImpl: async (...args) => {
      recorded = args;
      return { ok: true, json: async () => ({ result: { ok: true } }) };
    },
  });
  assert.deepEqual(await client.request('/api/connect', { party: 'buyer' }), { ok: true });
  assert.equal(recorded[0], '/api/connect');
  assert.equal(recorded[1].headers.authorization, `Bearer ${'a'.repeat(43)}`);
  assert.equal(recorded[1].credentials, 'omit');
  assert.equal(recorded[1].redirect, 'error');
  await assert.rejects(client.request('https://other.test/api/connect'), /INVALID_API_PATH/);
});
test('transport never reflects a raw server exception', async () => {
  const client = createHostClient({
    capability: 'a'.repeat(43),
    fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'private bank payload' }) }),
  });
  await assert.rejects(client.request('/api/config'), { message: 'REQUEST_FAILED' });
});
test('Freighter signing pins testnet and requested address and rejects another signer', async () => {
  let options;
  const api = {
    signTransaction: async (_xdr, opts) => {
      options = opts;
      return { signerAddress: 'buyer', signedTxXdr: 'signed' };
    },
  };
  assert.equal(
    await answerWalletRequest({ kind: 'sign', transactionXdr: 'xdr', account: 'buyer' }, api),
    'signed',
  );
  assert.equal(options.networkPassphrase, 'Test SDF Network ; September 2015');
  await assert.rejects(
    answerWalletRequest({ kind: 'sign', transactionXdr: 'xdr', account: 'seller' }, api),
    /WALLET_ACCOUNT_MISMATCH/,
  );
});
test('authorization signing returns the official signature response without treating it as an envelope', async () => {
  const api = {
    signAuthEntry: async (preimage, opts) => {
      assert.equal(preimage, 'preimage');
      assert.equal(opts.address, 'seller');
      return { signerAddress: 'seller', signedAuthEntry: 'signature' };
    },
  };
  assert.deepEqual(
    await answerWalletRequest(
      { kind: 'signAuthEntry', preimageXdr: 'preimage', account: 'seller' },
      api,
    ),
    { signerAddress: 'seller', signedAuthEntry: 'signature' },
  );
});
