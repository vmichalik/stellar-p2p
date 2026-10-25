import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEMO_FILES, MEDIA_FILES, DEMO_HEADERS } from './build-demo.mjs';
import { SITE } from '../deploy/demo/site.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/demo');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const check = (value, message) => {
  if (!value) throw new Error(message);
};
const manifestBytes = await readFile(resolve(output, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
check(
  manifest.mode === 'synthetic-demo' &&
    manifest.liveSettlement === false &&
    manifest.livePaymentVerification === false,
  'Only the synthetic demo may be audited',
);
const expectedAssets = [...DEMO_FILES, ...(manifest.mediaIncluded ? MEDIA_FILES : [])];
check(
  JSON.stringify(manifest.files.map((row) => row.path)) === JSON.stringify(expectedAssets),
  'Manifest asset allowlist differs',
);
const expectedFiles = new Set([
  ...expectedAssets,
  'manifest.json',
  '_headers',
  'robots.txt',
  'sitemap.xml',
]);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory)) {
    const path = resolve(directory, entry);
    const info = await lstat(path);
    check(!info.isSymbolicLink(), 'Output symlink is not permitted');
    if (info.isDirectory()) await walk(path);
    else {
      check(info.isFile(), 'Output special file is not permitted');
      const name = relative(output, path).split('\\').join('/');
      check(expectedFiles.has(name), 'Unexpected output file');
      const bytes = await readFile(path);
      files.push({ path: name, sha256: digest(bytes), bytes: bytes.length });
    }
  }
}
await walk(output);
check(files.length === expectedFiles.size, 'Output file missing');
for (const asset of manifest.files) {
  const actual = files.find((row) => row.path === asset.path);
  check(
    actual.sha256 === asset.sha256 && actual.bytes === asset.bytes,
    'Output asset hash differs',
  );
}
const headers = await readFile(resolve(output, '_headers'), 'utf8');
check(
  headers ===
    (manifest.mediaIncluded
      ? DEMO_HEADERS.replace("connect-src 'none';", "connect-src 'none'; media-src 'self';")
      : DEMO_HEADERS),
  'Output security headers differ',
);
const html = await readFile(resolve(output, 'index.html'), 'utf8');
check(
  html.includes(`rel="canonical" href="${SITE.appOrigin}/"`) &&
    html.includes('sample payments and simulated settlement'),
  'Canonical metadata or synthetic status missing',
);
const sourcePaths = [
  'app',
  'deploy/demo',
  'scripts/build-demo.mjs',
  'scripts/audit-demo.mjs',
  'wrangler.jsonc',
];
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
const revision = git(['rev-parse', 'HEAD']);
const status = git(['status', '--porcelain', '--', ...sourcePaths]);
check(revision.status === 0 && status.status === 0, 'Source revision unavailable');
const report = {
  kind: 'SYNTHETIC_DEMO_BUNDLE_AUDIT',
  observedAt: new Date().toISOString(),
  sourceRevision: revision.stdout.trim(),
  sourceDirty: Boolean(status.stdout.trim()),
  packagingValid: true,
  livePaymentGate: 'NOT_CLEARED',
  deployed: false,
  mediaIncluded: manifest.mediaIncluded,
  intendedOrigins: manifest.intendedOrigins,
  manifestSha256: digest(manifestBytes),
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
};
if (process.argv.includes('--record')) {
  await mkdir(resolve(root, '.private/release'), { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(root, '.private/release/domain-bundle.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  `Audited ${files.length} exact files; synthetic only; source ${report.sourceRevision}${report.sourceDirty ? ' (source dirty)' : ''}. No deployment performed.`,
);
