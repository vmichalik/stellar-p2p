import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSetupRoute, readSetupRoute } from './setup-check.mjs';

test('diagnostic assets use a fixed route allowlist', () => {
  for (const path of [
    '/setup-check/',
    '/setup-check/worker.mjs',
    '/setup-check/tlsn_wasm.js',
    '/setup-check/tlsn_wasm_bg.wasm',
  ]) {
    assert.equal(isSetupRoute(path), true);
  }
  for (const path of [
    '/setup-check',
    '/setup-check/?x=1',
    '/setup-check/../.private/file',
    '/setup-check/arbitrary.js',
  ]) {
    assert.equal(isSetupRoute(path), false);
  }
});

test('tampered released runtime fails closed before it can be served', async () => {
  await assert.rejects(
    readSetupRoute('/setup-check/tlsn_wasm.js', 'https://proof.example', async () =>
      Buffer.from('altered-runtime'),
    ),
    /checksum mismatch/,
  );
  let reads = 0;
  await assert.rejects(
    readSetupRoute('/setup-check/../.private/file', 'https://proof.example', async () => {
      reads++;
    }),
    /Unsupported/,
  );
  assert.equal(reads, 0);
});

test('bank-free worker receives only the configured verifier origin', async () => {
  const result = await readSetupRoute('/setup-check/worker.mjs', 'https://proof.example:9492');
  assert.match(result.body, /const VERIFIER_ORIGIN = "https:\/\/proof\.example:9492";/);
  assert.doesNotMatch(result.body, /const VERIFIER_ORIGIN = '';/);
  assert.doesNotMatch(result.body, /location\.host|request\.headers|\.send_request\(|\.reveal\(/);
});
