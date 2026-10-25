// Emit metadata for a real deployed URL. This script does not publish anything.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const escape = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
export function socialMetadata(pageUrl, imageBaseUrl) {
  const url = new URL(pageUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw Error(
      'Use the actual public HTTPS canonical page URL, without credentials or a fragment.',
    );
  const base = new URL(imageBaseUrl ?? '/assets/social/', url.origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
    throw Error('Use the actual public HTTPS asset directory URL.');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const og = new URL('og-default.jpg', base).href;
  const wide = new URL('social-link-wide.jpg', base).href;
  const description =
    'A peer-to-peer on-ramp connecting your bank app, a human supplier and your Stellar wallet.';
  return (
    [
      ['property', 'og:type', 'website'],
      ['property', 'og:site_name', 'Pactlane'],
      ['property', 'og:title', 'Pactlane · Your bank app. Your Stellar wallet.'],
      ['property', 'og:description', description],
      ['property', 'og:url', url.href],
      ['property', 'og:image', og],
      ['property', 'og:image:secure_url', og],
      ['property', 'og:image:type', 'image/jpeg'],
      ['property', 'og:image:width', '1200'],
      ['property', 'og:image:height', '630'],
      [
        'property',
        'og:image:alt',
        'Pactlane. Your bank app. Your Stellar wallet. Orange and green paired frames represent a peer-to-peer exchange.',
      ],
      ['name', 'twitter:card', 'summary_large_image'],
      ['name', 'twitter:title', 'Pactlane · Your bank app. Your Stellar wallet.'],
      ['name', 'twitter:description', description],
      ['name', 'twitter:image', wide],
      [
        'name',
        'twitter:image:alt',
        'Pactlane. Your bank app. Your Stellar wallet. Paired orange and green frames.',
      ],
    ]
      .map(([attribute, key, value]) => `<meta ${attribute}="${key}" content="${escape(value)}" />`)
      .join('\n') + '\n'
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv[2])
    throw Error(
      'Usage: node design/social/metadata.mjs <public-page-https-url> [public-assets-https-directory]',
    );
  process.stdout.write(socialMetadata(process.argv[2], process.argv[3]));
}
