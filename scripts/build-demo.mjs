import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SITE, siteMetadata } from '../deploy/demo/site.mjs';
import { STATIC_HEADERS } from '../deploy/demo/headers.mjs';

const ROOT = resolve(import.meta.dirname, '..');
export const DEMO_FILES = [
  'index.html',
  'styles.css',
  'app.mjs',
  'model.mjs',
  'demo-adapter.mjs',
  'assets/fonts/manrope.woff2',
  'assets/fonts/OFL.txt',
  'assets/social-preview.png',
  'assets/favicon.svg',
];
const GENERATED = ['manifest.json', '_headers', 'robots.txt', 'sitemap.xml'];
export const DEMO_HEADERS = STATIC_HEADERS;

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
    const sourceData = await readFile(path);
    inputs.push({
      name,
      data:
        name === 'index.html' ? Buffer.from(siteMetadata(sourceData.toString('utf8'))) : sourceData,
    });
  }
  // A new app module must join the explicit allowlist. Do not produce a green
  // build whose browser entry point imports a file that was silently omitted.
  const copied = new Set(DEMO_FILES);
  for (const { name, data } of inputs.filter((row) => row.name.endsWith('.mjs'))) {
    const sourceText = data.toString('utf8');
    if (/\bimport\s*\(/.test(sourceText))
      throw new Error('Demo imports must be explicit static local modules.');
    for (const match of sourceText.matchAll(
      /^\s*import(?:\s+[\s\S]*?\s+from)?\s*['"]([^'"]+)['"]/gm,
    )) {
      const specifier = match[1];
      const target = new URL(specifier, `https://demo.invalid/${name}`);
      if (
        !specifier.startsWith('.') ||
        target.origin !== 'https://demo.invalid' ||
        target.search ||
        target.hash ||
        !copied.has(target.pathname.slice(1))
      )
        throw new Error('Demo module dependency is outside the explicit allowlist.');
    }
  }
  const manifest = {
    schemaVersion: 1,
    mode: 'synthetic-demo',
    revision,
    livePaymentVerification: false,
    liveSettlement: false,
    intendedOrigins: { app: SITE.appOrigin, proof: SITE.proofOrigin },
    proofCustomDomainReady: SITE.proofDomainVerified,
    operationalProofOrigin: SITE.proofDomainVerified
      ? SITE.proofOrigin
      : SITE.operationalProofOrigin,
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
  await writeFile(
    join(output, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${SITE.appOrigin}/sitemap.xml\n`,
  );
  await writeFile(
    join(output, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE.appOrigin}/</loc></url></urlset>\n`,
  );
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
