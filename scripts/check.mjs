import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
let checked = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      ['.git', '.private', '.toolchain', 'node_modules', 'target', '__pycache__'].includes(
        entry.name,
      )
    )
      continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
    } else if (entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0)
        throw new Error(result.stderr || `Syntax check failed: ${entry.name}`);
      checked++;
    } else if (entry.name.endsWith('.html')) {
      const html = await readFile(path, 'utf8');
      for (const [, attributes, source] of html.matchAll(
        /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
      )) {
        if (/\bsrc\s*=/.test(attributes)) continue;
        const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
          input: source,
          encoding: 'utf8',
        });
        if (result.status !== 0)
          throw new Error(result.stderr || `Inline script check failed: ${entry.name}`);
        checked++;
      }
    }
  }
}

await walk(root);
console.log(`Syntax checks passed for ${checked} JavaScript modules and inline scripts.`);
