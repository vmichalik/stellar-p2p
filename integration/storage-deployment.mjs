import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Refuse a reused or legacy directory rather than silently abandoning an
 * unknown transaction outcome by moving to a different journal namespace.
 */
export function bindStorageDeployment(directory, cfg, replayStorePath) {
  const path = join(directory, 'deployment.json');
  const identity = JSON.stringify([
    cfg.deploymentId,
    cfg.escrowWasmSha256,
    cfg.policySignerPublicKeyHex,
    replayStorePath,
  ]);
  const verify = () => {
    let saved;
    try {
      saved = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw Error('STORAGE_DEPLOYMENT_MISMATCH');
    }
    if (saved.version !== 1 || saved.identity !== identity)
      throw Error('STORAGE_DEPLOYMENT_MISMATCH');
  };
  if (existsSync(path)) return verify();
  if (
    ['payments.sqlite', 'transactions.sqlite', 'orders.sqlite'].some((file) =>
      existsSync(join(directory, file)),
    )
  )
    throw Error('LEGACY_STORAGE_REVIEW_REQUIRED');
  try {
    writeFileSync(path, JSON.stringify({ version: 1, identity }) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error.code === 'EEXIST') verify();
    else throw error;
  }
}
