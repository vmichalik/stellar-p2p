import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildDemo, DEMO_FILES } from '../../scripts/build-demo.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pactlane-demo-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'app');
  const output = join(root, 'demo');
  for (const name of DEMO_FILES) {
    const path = join(source, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      name === 'index.html'
        ? '<!doctype html><html><head><title>Old title</title></head><body>Sample demo</body></html>'
        : 'synthetic fixture: ' + name,
    );
  }
  return { source, output };
}

test('demo build copies only allowlisted app assets and labels every manifest synthetic', async (t) => {
  const paths = await fixture(t);
  await writeFile(join(paths.source, 'account-private.json'), 'synthetic secret, never copied');
  const result = await buildDemo({ ...paths, revision: 'fixture-revision' });
  assert.equal(result.mode, 'synthetic-demo');
  assert.equal(result.livePaymentVerification, false);
  assert.equal(result.liveSettlement, false);
  assert.equal(result.revision, 'fixture-revision');
  assert.deepEqual(
    result.files.map((file) => file.path),
    DEMO_FILES,
  );
  assert.ok(result.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.equal((await readdir(paths.output)).includes('account-private.json'), false);
  const headers = await readFile(join(paths.output, '_headers'), 'utf8');
  assert.match(headers, /connect-src 'none'/);
  assert.doesNotMatch(headers, /https:|wss:/);
  const index = await readFile(join(paths.output, 'index.html'), 'utf8');
  assert.match(index, /rel="canonical" href="https:\/\/pactlane\.io\/"/);
  assert.equal(result.intendedOrigins.proof, 'https://proof.pactlane.io');
  assert.equal(result.proofCustomDomainReady, false);
  assert.match(index, /https:\/\/stellar-p2p-proof-vijay\.fly\.dev\/extension-check\//);
  assert.match(
    index,
    /property="og:image" content="https:\/\/pactlane\.io\/assets\/social-preview\.png"/,
  );
  assert.match(index, /sample payments and simulated settlement/);
  assert.doesNotMatch(index, /<title>Old title<\/title>/);
  assert.match(
    await readFile(join(paths.output, 'sitemap.xml'), 'utf8'),
    /<loc>https:\/\/pactlane\.io\/<\/loc>/,
  );
});

test('demo build rejects unexpected existing output without deleting or publishing it', async (t) => {
  const paths = await fixture(t);
  await mkdir(paths.output);
  await writeFile(join(paths.output, 'private.txt'), 'synthetic private output');
  await assert.rejects(buildDemo(paths), /unexpected file/);
  assert.equal(
    await readFile(join(paths.output, 'private.txt'), 'utf8'),
    'synthetic private output',
  );
});

test('missing app assets and symlinked input fail before output is written', async (t) => {
  const paths = await fixture(t);
  await rm(join(paths.source, 'index.html'));
  await assert.rejects(buildDemo(paths));
  await symlink(join(paths.source, 'styles.css'), join(paths.source, 'index.html'));
  await assert.rejects(buildDemo(paths), /regular files/);
  await assert.rejects(readdir(paths.output), { code: 'ENOENT' });
});
