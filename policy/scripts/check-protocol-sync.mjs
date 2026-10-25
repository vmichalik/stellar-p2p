import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonicalRoot = process.argv[2] ? resolve(process.argv[2]) : resolve(root, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'vendor/manifest.json'), 'utf8'));
for (const entry of manifest.snapshots) {
  for (const path of [
    resolve(root, entry.localPath),
    resolve(canonicalRoot, entry.canonicalPath),
  ]) {
    const content = await readFile(path);
    if (createHash('sha256').update(content).digest('hex') !== entry.sha256)
      throw new Error('PROTOCOL_SNAPSHOT_MISMATCH');
  }
}
process.stdout.write('Policy protocol snapshots match the contract-owned source and vectors.\n');
