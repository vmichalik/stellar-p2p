import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../.toolchain/tlsn-browser-smoke');
const ASSETS = new Map([
  [
    '/setup-check/tlsn_wasm.js',
    [
      'tlsn_wasm.js',
      'text/javascript',
      '523711ce5c7f1d5206bc05250153e74f3063ed7e420d0a0953ca24b4ea39dc4f',
    ],
  ],
  [
    '/setup-check/tlsn_wasm_bg.wasm',
    [
      'tlsn_wasm_bg.wasm',
      'application/wasm',
      'bb3c73628f088867a1f99291275b56a379ce44fd239efca9445fb5908a97e318',
    ],
  ],
  [
    '/setup-check/snippets/web-spawn-05868593a72e2d44/js/spawn.js',
    [
      'snippets/web-spawn-05868593a72e2d44/js/spawn.js',
      'text/javascript',
      'ef1d4a01ff707f368a03e3dd5d991af8c191d2dc607abb1f3a672f16a5ceb14a',
    ],
  ],
]);

export function isSetupRoute(path) {
  return path === '/setup-check/' || path === '/setup-check/worker.mjs' || ASSETS.has(path);
}

export async function readSetupRoute(path, publicOrigin, read = readFile) {
  if (path === '/setup-check/')
    return {
      body: await read(resolve(HERE, 'setup-check.html')),
      contentType: 'text/html; charset=utf-8',
      html: true,
    };
  if (path === '/setup-check/worker.mjs') {
    const source = await read(resolve(HERE, 'setup-check.worker.mjs'), 'utf8');
    return {
      body: source.replace(
        "const VERIFIER_ORIGIN = '';",
        `const VERIFIER_ORIGIN = ${JSON.stringify(publicOrigin)};`,
      ),
      contentType: 'text/javascript; charset=utf-8',
    };
  }
  const asset = ASSETS.get(path);
  if (!asset) throw new Error('Unsupported diagnostic route');
  const [name, contentType, expectedHash] = asset;
  const body = await read(resolve(ROOT, name));
  if (createHash('sha256').update(body).digest('hex') !== expectedHash)
    throw new Error('Diagnostic asset checksum mismatch');
  return { body, contentType };
}
