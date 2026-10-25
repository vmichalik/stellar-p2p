import { spawnSync } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const directory of ['contracts/escrow/protocol', 'policy', 'integration']) {
  const result = spawnSync(
    npm,
    ['--prefix', directory, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: new URL('../', import.meta.url), stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
