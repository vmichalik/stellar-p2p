import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SOCIAL } from '../../deploy/demo/social.mjs';
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

test('site build copies only allowlisted assets and records actual capabilities', async (t) => {
  const paths = await fixture(t);
  await writeFile(join(paths.source, 'account-private.json'), 'synthetic secret, never copied');
  const result = await buildDemo({ ...paths, revision: 'fixture-revision' });
  assert.equal(result.mode, 'live-and-demo');
  assert.equal(result.defaultMode, 'live');
  assert.equal(result.demoQuery, 'demo=1');
  assert.equal(result.liveCapabilitiesSource, '/api/view');
  assert.equal(Object.hasOwn(result, 'livePaymentVerification'), false);
  assert.equal(Object.hasOwn(result, 'liveSettlement'), false);
  assert.equal(result.revision, 'fixture-revision');
  assert.deepEqual(
    result.files.map((file) => file.path),
    DEMO_FILES,
  );
  assert.ok(result.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.equal((await readdir(paths.output)).includes('account-private.json'), false);
  const headers = await readFile(join(paths.output, '_headers'), 'utf8');
  assert.match(headers, /connect-src 'self'/);
  assert.doesNotMatch(headers, /https:|wss:/);
  const index = await readFile(join(paths.output, 'index.html'), 'utf8');
  assert.match(index, /rel="canonical" href="https:\/\/pactlane\.io\/"/);
  assert.equal(result.intendedOrigins.proof, 'https://proof.pactlane.io');
  assert.equal(result.proofCustomDomainReady, false);
  assert.match(index, /https:\/\/stellar-p2p-proof-vijay\.fly\.dev\/extension-check\//);
  assert.ok(index.includes(`property="og:image" content="https://pactlane.io${SOCIAL.og.path}"`));
  assert.ok(
    index.includes(`name="twitter:image" content="https://pactlane.io${SOCIAL.twitter.path}"`),
  );
  assert.match(index, /property="og:image:type" content="image\/jpeg"/);
  assert.match(index, /name="twitter:image:alt"/);
  assert.match(index, /A human supplier/);
  assert.doesNotMatch(index, /prototype|beta|coming soon/i);
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

test('a newly imported module cannot be silently omitted from the deployment', async (t) => {
  const paths = await fixture(t);
  await writeFile(join(paths.source, 'app.mjs'), "import './presentation-not-reviewed.mjs';\n");
  await writeFile(
    join(paths.source, 'presentation-not-reviewed.mjs'),
    'export const synthetic = true;',
  );
  await assert.rejects(buildDemo(paths), /outside the explicit allowlist/);
  await assert.rejects(readdir(paths.output), { code: 'ENOENT' });
});

test('reviewed media is opt-in, exact-file-only, hashed and bounded before output', async (t) => {
  const paths = await fixture(t);
  const mediaDirectory = join(paths.source, 'reviewed-media');
  await mkdir(mediaDirectory);
  await writeFile(join(mediaDirectory, 'demo.mp4'), Buffer.from('0000ftypSYNTHETIC'));
  await writeFile(join(mediaDirectory, 'demo-script.txt'), 'Synthetic demo script');
  await writeFile(join(mediaDirectory, 'private-extra.txt'), 'Never copy this file');
  const basic = await buildDemo(paths);
  assert.equal(basic.mediaIncluded, false);
  assert.equal(
    basic.files.some((file) => file.path === 'demo.mp4'),
    false,
  );
  const selected = await buildDemo({ ...paths, mediaDirectory });
  assert.equal(selected.mediaIncluded, true);
  assert.deepEqual(
    selected.files.slice(-2).map((file) => file.path),
    ['demo.mp4', 'demo-script.txt'],
  );
  assert.ok(selected.files.slice(-2).every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.equal((await readdir(paths.output)).includes('private-extra.txt'), false);
  assert.match(await readFile(join(paths.output, '_headers'), 'utf8'), /media-src 'self'/);
  await truncate(join(mediaDirectory, 'demo.mp4'), 25 * 1024 * 1024);
  const fresh = join(paths.source, 'fresh-output');
  await assert.rejects(buildDemo({ ...paths, output: fresh, mediaDirectory }), /size limits/);
  await assert.rejects(readdir(fresh), { code: 'ENOENT' });
});
