import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
export const DEMO_FILES = [
  'index.html',
  'styles.css',
  'app.mjs',
  'model.mjs',
  'demo-adapter.mjs',
  'assets/fonts/manrope.woff2',
  'assets/fonts/OFL.txt',
];
const GENERATED = ['manifest.json', '_headers'];
export const DEMO_HEADERS = `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cache-Control: no-store
`;

async function filesUnder(root) {
  const found = [];
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        for (const nested of await filesUnder(path)) found.push(join(entry.name, nested));
      } else {
        found.push(entry.name);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return found;
}

export async function buildDemo({
  source = join(ROOT, 'app'),
  output = join(ROOT, 'dist/demo'),
  revision = 'unrecorded',
} = {}) {
  const expected = new Set([...DEMO_FILES, ...GENERATED]);
  for (const file of await filesUnder(output)) {
    if (!expected.has(file.split('\\').join('/'))) {
      throw new Error('Demo output contains an unexpected file; use a new empty output directory.');
    }
  }

  // Read every allowlisted regular file before writing the output. Never copy
  // arbitrary source folders, account settings, proof tooling or test fixtures.
  const inputs = [];
  for (const name of DEMO_FILES) {
    const path = join(source, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error('Demo inputs must be regular files.');
    inputs.push({ name, data: await readFile(path) });
  }
  const manifest = {
    schemaVersion: 1,
    mode: 'synthetic-demo',
    revision,
    livePaymentVerification: false,
    liveSettlement: false,
    files: inputs.map(({ name, data }) => ({
      path: name,
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes: data.length,
    })),
  };
  for (const { name, data } of inputs) {
    const path = join(output, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(output, '_headers'), DEMO_HEADERS);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain', '--', 'app'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const revision =
    git.status === 0
      ? git.stdout.trim() + (status.stdout.trim() ? '+app-dirty' : '')
      : 'unrecorded';
  try {
    const manifest = await buildDemo({ revision });
    console.log(
      `Built ${manifest.files.length} synthetic-demo files in ${relative(ROOT, join(ROOT, 'dist/demo'))}. Nothing was deployed.`,
    );
  } catch {
    console.error(
      'Demo build failed. Check that the committed app snapshot is present and the output contains only generated demo files.',
    );
    process.exitCode = 1;
  }
}
