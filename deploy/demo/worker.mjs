import { secured } from './headers.mjs';
import { SITE } from './site.mjs';

const hosts = new Set(['pactlane.io', 'www.pactlane.io', 'app.pactlane.io']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!hosts.has(url.hostname) || url.port)
      return secured(new Response('Unknown site', { status: 421 }));
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
    // The public frontend has no exchange backend attached yet. Never fall
    // back to demo data or turn an asset miss into a successful live response.
    if (url.pathname.startsWith('/api/'))
      return secured(Response.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 }));
    if (url.pathname === '/wallet-config.json')
      return secured(Response.json({ enabled: false, projectId: '', appUrl: SITE.appOrigin }));
    // No external fetch, bank, proof, signing key or policy execution here.
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
