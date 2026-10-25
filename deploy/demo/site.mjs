import { SOCIAL } from './social.mjs';

// Intended public origins. Setting these does not publish or attach either domain.
export const SITE = Object.freeze({
  appOrigin: 'https://pactlane.io',
  proofOrigin: 'https://proof.pactlane.io',
  operationalProofOrigin: 'https://stellar-p2p-proof-vijay.fly.dev',
  proofDomainVerified: false,
  title: 'Pactlane · Your bank app. Your Stellar wallet.',
  description:
    'Your bank app. A human supplier. Your Stellar wallet. Buy Stellar assets from a person at an upfront price.',
  themeColor: '#f7f5ee',
});

const escape = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

export function siteMetadata(html) {
  if (!/<head\b[^>]*>/i.test(html) || !/<\/head>/i.test(html))
    throw new Error('Demo index must have an HTML head');
  const clean = html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(
      /<meta\b(?=[^>]*\b(?:name|property)=["'](?:description|theme-color|og:[^"']+|twitter:[^"']+)["'])[^>]*>/gi,
      '',
    )
    .replace(/<link\b(?=[^>]*\brel=["'](?:canonical|icon|help)["'])[^>]*>/gi, '');
  const image = `${SITE.appOrigin}${SOCIAL.og.path}`;
  const wideImage = `${SITE.appOrigin}${SOCIAL.twitter.path}`;
  const tags = [
    `<title>${escape(SITE.title)}</title>`,
    `<meta name="description" content="${escape(SITE.description)}" />`,
    `<meta name="theme-color" content="${SITE.themeColor}" />`,
    `<link rel="canonical" href="${SITE.appOrigin}/" />`,
    '<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />',
    `<link rel="help" href="${SITE.proofDomainVerified ? SITE.proofOrigin : SITE.operationalProofOrigin}/extension-check/" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Pactlane" />',
    `<meta property="og:title" content="${escape(SITE.title)}" />`,
    `<meta property="og:description" content="${escape(SITE.description)}" />`,
    `<meta property="og:url" content="${SITE.appOrigin}/" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`,
    `<meta property="og:image:type" content="${SOCIAL.og.type}" />`,
    `<meta property="og:image:width" content="${SOCIAL.og.width}" />`,
    `<meta property="og:image:height" content="${SOCIAL.og.height}" />`,
    `<meta property="og:image:alt" content="${escape(SOCIAL.og.alt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escape(SITE.title)}" />`,
    `<meta name="twitter:description" content="${escape(SITE.description)}" />`,
    `<meta name="twitter:image" content="${wideImage}" />`,
    `<meta name="twitter:image:alt" content="${escape(SOCIAL.twitter.alt)}" />`,
  ].join('\n    ');
  return clean.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}
