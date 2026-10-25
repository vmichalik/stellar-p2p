import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
export function isExtensionRoute(path) {
  return ['/extension-check/', '/extension-check/plugin.mjs', '/extension-check/window'].includes(
    path,
  );
}
export async function readExtensionRoute(path, publicOrigin) {
  if (path === '/extension-check/')
    return {
      body: await readFile(resolve(HERE, 'extension-check.html')),
      contentType: 'text/html; charset=utf-8',
      html: true,
    };
  if (path === '/extension-check/window')
    return {
      body: await readFile(resolve(HERE, 'extension-check-window.html')),
      contentType: 'text/html; charset=utf-8',
    };
  if (path !== '/extension-check/plugin.mjs') throw new Error('Unsupported diagnostic route');
  const source = await readFile(resolve(HERE, 'extension-check.plugin.mjs'), 'utf8');
  const body = source
    .replace(
      "const VERIFIER_ORIGIN = '';",
      `const VERIFIER_ORIGIN = ${JSON.stringify(publicOrigin)};`,
    )
    .replace(
      "const PROXY_URL = '';",
      `const PROXY_URL = ${JSON.stringify(publicOrigin.replace(/^https:/, 'wss:') + '/proxy?token=app.revolut.com')};`,
    )
    .replace(
      "const WINDOW_URL = '';",
      `const WINDOW_URL = ${JSON.stringify(publicOrigin + '/extension-check/window')};`,
    );
  if (
    ["const VERIFIER_ORIGIN = '';", "const PROXY_URL = '';", "const WINDOW_URL = '';"].some(
      (line) => body.includes(line),
    )
  )
    throw new Error('Diagnostic configuration unavailable');
  return { body, contentType: 'text/javascript; charset=utf-8' };
}
