import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRecordRuntime } from '../infra/proof-benchmark/record-runtime.mjs';
import { normalizeLiveTlsnPayment } from '../policy/src/evidence.mjs';
import { payload, now } from '../policy/test/fixtures/tlsn-record.mjs';

test('private verifier callback requires its secret, rejects browser origin, and stores only accepted records', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'pactlane-ingress-test-'));
  const runtime = await prepareRecordRuntime({ directory, ingressPort: 0, clock: () => now });
  t.after(async () => {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const cfg = JSON.parse(readFileSync(join(runtime.runtimeDirectory, 'config.yaml'), 'utf8'));
  const target = cfg.webhooks['app.revolut.com'];
  assert.equal(new URL(target.url).hostname, '127.0.0.1');
  const send = (headers = {}, body = payload(), path = target.url) =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await send()).status, 403);
  assert.equal((await send({ ...target.headers, Origin: 'https://attacker.example' })).status, 404);
  const rejected = payload();
  rejected.config.recv[0].start = 1;
  const invalid = await send(target.headers, rejected);
  assert.equal(invalid.status, 422);
  assert.doesNotMatch(await invalid.text(), /00000000|NOT_PERSISTED/);
  const accepted = await send(target.headers);
  assert.equal(accepted.status, 200);
  const receipt = await accepted.json();
  assert.equal(receipt.releaseGate, 'NOT_CLEARED');
  assert.deepEqual(Object.keys(receipt).sort(), ['evidenceId', 'releaseGate', 'status']);
  assert.equal(
    normalizeLiveTlsnPayment(runtime.store.reader.readVerifiedRecord(receipt.evidenceId))
      .amountMinor,
    '123',
  );
  assert.equal((await fetch(target.url, { headers: target.headers })).status, 404);
  assert.equal((await send(target.headers, payload(), target.url + '?x=1')).status, 404);
});
