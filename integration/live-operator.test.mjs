import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { createTlsnEvidenceStore } from '../policy/src/tlsn-store.mjs';
import { payload, now } from '../policy/test/fixtures/tlsn-record.mjs';
import { createLiveOperator } from './live-operator.mjs';

const fetch = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const req = request(url, { method: options.method, headers: options.headers }, (res) => {
      let body = '';
      res.on('data', (part) => (body += part));
      res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end(options.body);
  });

test('operator restores accepted identity privately, needs key approval, and serves origin-bound setup', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pactlane-operator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'operator'),
    evidenceDirectory = join(root, 'evidence');
  mkdirSync(directory);
  mkdirSync(evidenceDirectory);
  const store = createTlsnEvidenceStore({
    path: join(evidenceDirectory, 'verified-payments.sqlite'),
    ingressSecret: 'ab'.repeat(32),
    clock: () => now,
  });
  t.after(() => store.close());
  store.ingest({ authorization: 'Bearer ' + 'ab'.repeat(32), payload: payload() });
  const owner = {
    accounts: [Keypair.random().publicKey(), Keypair.random().publicKey()],
    maximumTestUSDC: '1',
    fiatMinor: '89',
    rolesConfirmed: true,
    bankRecipientConfirmedAsSeller: true,
    destination: '@wh1zbog',
    deploymentFeeCapStroops: '250000000',
    feeCapApproved: true,
  };
  const ownerPath = join(directory, 'owner.json');
  writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600 });
  const opts = {
    directory,
    evidenceDirectory,
    evidenceStore: store,
    proofHealth: async () => true,
  };
  await assert.rejects(createLiveOperator(opts), /SIGNER_CREATION_NOT_APPROVED/);
  writeFileSync(ownerPath, JSON.stringify({ ...owner, initializeSigner: true }));
  const operator = await createLiveOperator(opts);
  t.after(() => operator.close());
  assert.equal(statSync(join(directory, 'policy-seed')).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(ownerPath, 'utf8')).initializeSigner, undefined);
  const server = createServer((req, res) => operator.handler(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = 'http://127.0.0.1:' + server.address().port,
    host = 'stellar-p2p-proof-vijay.fly.dev';
  const status = await fetch(url + '/bootstrap/status', { headers: { host } });
  assert.equal(status.status, 200);
  const body = await status.json();
  assert.equal(body.owner, owner.accounts[0]);
  assert.equal(body.completed.length, 0);
  assert.equal(JSON.stringify(body).includes('payerScope'), false);
  assert.equal((await fetch(url + '/setup', { headers: { host } })).status, 200);
  assert.equal(
    (
      await fetch(url + '/bootstrap/prepare', {
        method: 'POST',
        headers: { host, origin: 'https://attacker.invalid', 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    400,
  );
  const api = await fetch(url + '/api/view', { headers: { host } });
  assert.equal(api.status, 200);
  assert.equal((await api.json()).configured, false);
  assert.equal(
    (await fetch(url + '/bootstrap/status', { headers: { host: 'attacker.invalid' } })).status,
    400,
  );
});
