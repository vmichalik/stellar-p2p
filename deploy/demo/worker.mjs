import { secured } from './headers.mjs';
import { SITE } from './site.mjs';

const hosts = new Set(['pactlane.io', 'www.pactlane.io', 'app.pactlane.io']);

async function videoResponse(request, response) {
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  const range = request.method === 'GET' && request.headers.get('Range');
  if (range && response.status === 200) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match?.[2]));
    const end =
      match?.[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    if (
      !match ||
      (!match[1] && !match[2]) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= bytes.length ||
      end < start
    ) {
      headers.delete('Content-Length');
      headers.set('Content-Range', `bytes */${bytes.length}`);
      return new Response(null, { status: 416, headers });
    }
    const part = bytes.subarray(start, end + 1);
    headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
    headers.set('Content-Length', String(part.length));
    return new Response(part, { status: 206, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!hosts.has(url.hostname) || url.port)
      return secured(new Response('Unknown site', { status: 421 }));
    if (url.origin === SITE.appOrigin && url.pathname.startsWith('/api/')) {
      if (
        !['GET', 'POST', 'DELETE'].includes(request.method) ||
        url.search ||
        (request.headers.get('origin') && request.headers.get('origin') !== SITE.appOrigin) ||
        (request.method !== 'GET' && request.headers.get('origin') !== SITE.appOrigin)
      )
        return secured(Response.json({ error: 'ORIGIN_REJECTED' }, { status: 403 }));
      const upstream = new URL('https://stellar-p2p-proof-vijay.fly.dev');
      upstream.pathname = url.pathname;
      const headers = new Headers();
      for (const name of ['content-type', 'cookie', 'origin']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      try {
        const response = await fetch(upstream, {
          method: request.method,
          headers,
          body: request.method === 'GET' ? undefined : request.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
        });
        return secured(response);
      } catch {
        return secured(Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 }));
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return secured(
        new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }),
      );
    if (url.origin !== SITE.appOrigin) {
      const destination = new URL(SITE.appOrigin);
      destination.pathname = url.pathname;
      destination.search = url.search;
      return secured(Response.redirect(destination.href, 308));
    }
    if (url.pathname === '/wallet-config.json')
      return secured(Response.json({ enabled: false, projectId: '', appUrl: SITE.appOrigin }));
    // Static presentation stays separate from the authenticated exchange API.
    let response = await env.ASSETS.fetch(request);
    if (
      url.pathname === '/demo.mp4' &&
      [200, 206].includes(response.status) &&
      response.headers.get('Content-Type')?.startsWith('video/mp4')
    )
      response = await videoResponse(request, response);
    return secured(response, {
      demo: url.searchParams.get('demo') === '1',
      media:
        [200, 206].includes(response.status) &&
        ((url.pathname === '/demo.mp4' &&
          response.headers.get('Content-Type')?.startsWith('video/mp4')) ||
          (['/', '/index.html'].includes(url.pathname) &&
            response.headers.get('Content-Type')?.startsWith('text/html'))),
    });
  },
};
