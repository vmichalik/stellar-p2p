import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const privateRoot = resolve(root, '.private/release');
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
const candidate = JSON.parse(
  await readFile(resolve(root, 'contracts/escrow/artifacts/deployment-candidate.json'), 'utf8'),
);
const sha = (data) => createHash('sha256').update(data).digest('hex');
let wasm = resolve(root, candidate.artifact.path);
if (sha(await readFile(wasm)) !== candidate.artifact.sha256)
  throw new Error('Committed escrow artifact hash mismatch');

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  '--prefix',
  'policy',
  'run',
  'check:protocol',
]);
if (process.argv.includes('--rebuild')) {
  const output = resolve(privateRoot, 'build');
  await mkdir(output, { recursive: true });
  run('stellar', [
    'contract',
    'build',
    '--locked',
    '--manifest-path',
    'contracts/escrow/Cargo.toml',
    '--out-dir',
    output,
  ]);
  wasm = resolve(output, 'pactlane_escrow.wasm');
  if (sha(await readFile(wasm)) !== candidate.artifact.sha256)
    throw new Error('Rebuilt escrow differs from the reviewed artifact');
}
const reportPath = resolve(privateRoot, 'local-wasm.json');
run('cargo', ['test', '--locked', '--manifest-path', 'integration/wasm/Cargo.toml'], {
  PACTLANE_ESCROW_WASM: wasm,
  PACTLANE_REHEARSAL_REPORT: reportPath,
});
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const sourcePaths = [
  'app/model.mjs',
  'policy/src/engine.mjs',
  'policy/src/testing.mjs',
  'policy/vendor/escrow-protocol.mjs',
  'contracts/escrow/src/lib.rs',
  'integration/policy-bridge.mjs',
  'integration/wasm/trade.rs',
  'scripts/rehearse-local.mjs',
];
const status = spawnSync('git', ['status', '--porcelain', '--', ...sourcePaths], {
  cwd: root,
  encoding: 'utf8',
});
report.observedAt = new Date().toISOString();
report.sourceRevision = git.status === 0 ? git.stdout.trim() : 'unrecorded';
report.sourceDirty = status.stdout.trim().length > 0;
report.wasmSha256 = sha(await readFile(wasm));
report.sourceSha256 = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [path, sha(await readFile(resolve(root, path)))]),
  ),
);
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
if (process.argv.includes('--record')) {
  const output = resolve(root, 'evidence/release');
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, 'local-wasm-rehearsal.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  'Local app → policy → compiled-WASM rehearsal passed. Payment evidence was synthetic; no network transaction was submitted.',
);
