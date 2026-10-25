// Intended public origins. Setting these does not publish or attach either domain.
export const SITE = Object.freeze({
  appOrigin: 'https://pactlane.io',
  proofOrigin: 'https://proof.pactlane.io',
  operationalProofOrigin: 'https://stellar-p2p-proof-vijay.fly.dev',
  proofDomainVerified: false,
  title: 'Pactlane · Trade euros for USDC on Stellar',
  description:
    'Pay someone through Revolut and receive USDC in a Stellar wallet. Explore the peer-to-peer prototype with sample payments and simulated settlement.',
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
  const image = `${SITE.appOrigin}/assets/social-preview.png`;
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
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:alt" content="Pactlane interactive demo. Sample payments and simulated settlement." />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escape(SITE.title)}" />`,
    `<meta name="twitter:description" content="${escape(SITE.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join('\n    ');
  return clean.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}
