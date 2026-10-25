import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export function isResponseRoute(path) {
  return ['/response-check/', '/response-check/plugin.mjs'].includes(path);
}

function validatedOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('INVALID_RESPONSE_ORIGIN');
  }
  if (
    typeof value !== 'string' ||
    parsed.protocol !== 'https:' ||
    parsed.origin !== value ||
    !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/.test(value)
  )
    throw new Error('INVALID_RESPONSE_ORIGIN');
  return value;
}

function replaceOnce(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw new Error('RESPONSE_PLUGIN_UNAVAILABLE');
  return source.replace(needle, replacement);
}

export async function readResponseRoute(path, publicOrigin) {
  if (!isResponseRoute(path)) throw new Error('Unsupported response diagnostic route');
  const origin = validatedOrigin(publicOrigin);
  if (path === '/response-check/') {
    const source = await readFile(resolve(HERE, 'response-check.html'), 'utf8');
    return {
      body: replaceOnce(source, '__TLSN_PUBLIC_ORIGIN__', origin),
      contentType: 'text/html; charset=utf-8',
      html: true,
    };
  }
  let source = await readFile(resolve(HERE, 'revolut.plugin.mjs'), 'utf8');
  source = replaceOnce(
    source,
    "const VERIFIER_ORIGIN = '';",
    `const VERIFIER_ORIGIN = ${JSON.stringify(origin)};`,
  );
  source = replaceOnce(
    source,
    "const PROXY_URL = '';",
    `const PROXY_URL = ${JSON.stringify(origin.replace(/^https:/, 'wss:') + '/proxy?token=app.revolut.com')};`,
  );
  source = replaceOnce(
    source,
    'const RESPONSE_SHAPE_ONLY = false;',
    'const RESPONSE_SHAPE_ONLY = true;',
  );
  return { body: source, contentType: 'text/javascript; charset=utf-8' };
}
