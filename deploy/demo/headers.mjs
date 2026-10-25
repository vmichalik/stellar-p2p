export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store',
});

export const STATIC_HEADERS =
  '/*\n' +
  Object.entries(SECURITY_HEADERS)
    .map(([name, value]) => `  ${name}: ${value}\n`)
    .join('');

export function secured(response, { media = false, demo = false } = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (media)
    headers.set(
      'Content-Security-Policy',
      SECURITY_HEADERS['Content-Security-Policy'] + "; media-src 'self'",
    );
  if (demo)
    headers.set(
      'Content-Security-Policy',
      headers.get('Content-Security-Policy').replace("connect-src 'self'", "connect-src 'none'"),
    );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
