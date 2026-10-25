import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [
  ['test'],
  ['run', 'test:benchmark-prep'],
  ['--prefix', 'policy', 'run', 'check:protocol'],
  ['--prefix', 'policy', 'test'],
  ['--prefix', 'contracts/escrow/protocol', 'test'],
  ['--prefix', 'integration', 'test'],
]) {
  const result = spawnSync(npm, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
