import { readFile } from 'node:fs/promises';
import { readResponseRoute } from './response-check.mjs';

export function isPaymentRoute(path) {
  return ['/payment-check/', '/payment-check/plugin.mjs'].includes(path);
}

export async function readPaymentRoute(path, publicOrigin, { fullRecord = false } = {}) {
  if (typeof fullRecord !== 'boolean') throw new Error('INVALID_PAYMENT_MODE');
  if (!isPaymentRoute(path)) throw new Error('Unsupported payment-field route');
  // Reuse the reviewed endpoint validation and pinned request configuration.
  const plugin = await readResponseRoute('/response-check/plugin.mjs', publicOrigin);
  if (path === '/payment-check/plugin.mjs') {
    const needle = 'const RESPONSE_SHAPE_ONLY = true;';
    if (plugin.body.split(needle).length !== 2) throw new Error('PAYMENT_PLUGIN_UNAVAILABLE');
    let body = plugin.body.replace(needle, 'const RESPONSE_SHAPE_ONLY = false;');
    if (fullRecord) {
      const marker = 'const FULL_PAYMENT_RECORD = false;';
      if (body.split(marker).length !== 2) throw new Error('PAYMENT_PLUGIN_UNAVAILABLE');
      body = body.replace(marker, 'const FULL_PAYMENT_RECORD = true;');
    }
    return { ...plugin, body };
  }
  const html = await readFile(
    new URL(fullRecord ? './payment-record.html' : './payment-check.html', import.meta.url),
    'utf8',
  );
  if (html.split('__TLSN_PUBLIC_ORIGIN__').length !== 2)
    throw new Error('PAYMENT_PAGE_UNAVAILABLE');
  return {
    body: html.replace('__TLSN_PUBLIC_ORIGIN__', publicOrigin),
    contentType: 'text/html; charset=utf-8',
    html: true,
  };
}
