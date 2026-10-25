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
    // Static assets only. No external fetch, proof session, wallet or policy call.
    return secured(await env.ASSETS.fetch(request));
  },
};
