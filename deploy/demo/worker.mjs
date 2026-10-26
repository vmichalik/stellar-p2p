import { secured } from './headers.mjs';
import { SITE } from './site.mjs';

const hosts = new Set(['pactlane.io', 'www.pactlane.io', 'app.pactlane.io']);

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
    const response = await env.ASSETS.fetch(request);
    return secured(response, {
      demo: url.searchParams.get('demo') === '1',
      media:
        url.pathname === '/demo.mp4' &&
        [200, 206].includes(response.status) &&
        response.headers.get('Content-Type')?.startsWith('video/mp4'),
    });
  },
};
