import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SITE, siteMetadata } from '../deploy/demo/site.mjs';
import { SOCIAL_FILES } from '../deploy/demo/social.mjs';
import { STATIC_HEADERS } from '../deploy/demo/headers.mjs';

const ROOT = resolve(import.meta.dirname, '..');
export const DEMO_FILES = [
  'index.html',
  'entry.mjs',
  'site-ui.mjs',
  'site-shell.css',
  'marketplace.mjs',
  'live-app.mjs',
  'live-view-adapter.mjs',
  'live-styles.css',
  'host-client.mjs',
  'network.mjs',
  'deployment-wallet.mjs',
  'freighter-connector.mjs',
  'wallet-dialog.mjs',
  'vendor/freighter-api.js',
  'vendor/walletconnect.mjs',
  'styles.css',
  'app.mjs',
  'model.mjs',
  'demo-adapter.mjs',
  'presentation.mjs',
  'assets/fonts/manrope.woff2',
  'assets/fonts/OFL.txt',
  'assets/social-preview.png',
  'assets/favicon.svg',
  ...SOCIAL_FILES,
];
const GENERATED = ['manifest.json', '_headers', 'robots.txt', 'sitemap.xml'];
export const MEDIA_FILES = ['demo.mp4', 'demo-script.txt'];
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
  mediaDirectory = null,
} = {}) {
  const expected = new Set([...DEMO_FILES, ...GENERATED, ...(mediaDirectory ? MEDIA_FILES : [])]);
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
    // Pinned vendor bundles include their own bundled module loaders.
    if (name.startsWith('vendor/')) continue;
    // Only the mode entry and wallet dialog may load a fixed local module on
    // demand. Never accept a computed or remote dynamic import.
    const dynamic = [...sourceText.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)];
    const dynamicCount = [...sourceText.matchAll(/\bimport\s*\(/g)].length;
    if (
      dynamicCount !== dynamic.length ||
      dynamic.some(
        ([, , path]) =>
          !(name === 'entry.mjs' && ['./app.mjs', './live-app.mjs'].includes(path)) &&
          !(name === 'wallet-dialog.mjs' && path === '/vendor/walletconnect.mjs'),
      )
    )
      throw new Error('Imports must be explicit local modules.');
    for (const [, , path] of dynamic) {
      if (!copied.has(new URL(path, `https://demo.invalid/${name}`).pathname.slice(1)))
        throw new Error('Mode dependency is outside the explicit allowlist.');
    }
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
  if (mediaDirectory) {
    // Deliberate operator intake only; never discover/copy a media directory.
    for (const name of MEDIA_FILES) {
      const path = join(resolve(mediaDirectory), name);
      const info = await lstat(path);
      const maximum = name === 'demo.mp4' ? 25 * 1024 * 1024 : 256 * 1024;
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size >= maximum)
        throw new Error('Media must be regular files below the explicit size limits.');
      const data = await readFile(path);
      if (name === 'demo.mp4' && data.subarray(4, 8).toString() !== 'ftyp')
        throw new Error('Expected an MP4 container for the reviewed demo.');
      if (name === 'demo-script.txt') new TextDecoder('utf-8', { fatal: true }).decode(data);
      inputs.push({ name, data });
    }
  }
  const manifest = {
    schemaVersion: 1,
    mode: 'live-and-demo',
    defaultMode: 'live',
    demoQuery: 'demo=1',
    revision,
    liveCapabilitiesSource: '/api/view',
    mediaIncluded: Boolean(mediaDirectory),
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
  await writeFile(
    join(output, '_headers'),
    mediaDirectory
      ? DEMO_HEADERS.replace("connect-src 'self';", "connect-src 'self'; media-src 'self';")
      : DEMO_HEADERS,
  );
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
    const options = process.argv.slice(2);
    if (options.length && (options.length !== 2 || options[0] !== '--media-dir' || !options[1]))
      throw new Error('Use only --media-dir with an explicitly selected reviewed directory.');
    const manifest = await buildDemo({ revision, mediaDirectory: options[1] ?? null });
    if (options[1]) {
      const privateOutput = join(ROOT, '.private/release');
      await mkdir(privateOutput, { recursive: true, mode: 0o700 });
      await writeFile(
        join(privateOutput, 'media-intake.json'),
        JSON.stringify(
          {
            sourceDirectory: resolve(options[1]),
            selectedByOperator: true,
            sourceRevision: revision,
            files: manifest.files.filter((file) => MEDIA_FILES.includes(file.path)),
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      );
    }
    console.log(
      `Built ${manifest.files.length} site files in ${relative(ROOT, join(ROOT, 'dist/demo'))}. Nothing was deployed.`,
    );
  } catch {
    console.error(
      'Demo build failed. Check that the committed app snapshot is present and the output contains only generated demo files.',
    );
    process.exitCode = 1;
  }
}
