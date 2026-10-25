import { readFile } from 'node:fs/promises';

// Exact same-origin presentation assets only; no request-selected file paths.
const ASSETS = new Map([
  ['/assets/pactlane.css', ['pactlane.css', 'text/css; charset=utf-8']],
  ['/assets/manrope.woff2', ['manrope.woff2', 'font/woff2']],
  ['/assets/pactlane-mark.svg', ['pactlane-mark.svg', 'image/svg+xml']],
  ['/assets/OFL.txt', ['OFL.txt', 'text/plain; charset=utf-8']],
]);

export function isProofUiRoute(path) {
  return ASSETS.has(path);
}

export async function readProofUiRoute(path) {
  const asset = ASSETS.get(path);
  if (!asset) throw new Error('Unsupported presentation asset');
  const [name, contentType] = asset;
  return { body: await readFile(new URL('./assets/' + name, import.meta.url)), contentType };
}
