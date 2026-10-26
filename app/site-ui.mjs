export function demoEnabled(href) {
  return new URL(href).searchParams.get('demo') === '1';
}

export function modeUrl(href, demo) {
  const url = new URL(href);
  if (demo) url.searchParams.set('demo', '1');
  else url.searchParams.delete('demo');
  url.hash = '';
  return url.pathname + url.search;
}

export function modeToggle(demo, busy = false) {
  return `<button class="mode-toggle" type="button" role="switch" aria-label="Demo mode" title="Demo mode uses sample wallets, payments and balances" aria-checked="${demo}" data-mode-switch ${busy ? 'disabled' : ''}><span>Demo mode</span><span class="switch-track" aria-hidden="true"><span></span></span></button>`;
}

export function extensionCard() {
  return `<a class="extension-card" href="https://github.com/vmichalik/pactlane-tlsnotary/releases/tag/v0.1.0.1501-pactlane.2" target="_blank" rel="noopener noreferrer"><span class="extension-symbol" aria-hidden="true">↗</span><span><strong>Pactlane for Chrome</strong><span>Install the extension</span></span></a>`;
}

export function whyPage() {
  return `<div class="page-heading"><div><p class="eyebrow">WHY PACTLANE</p><h1>Your bank app. Your Stellar wallet.</h1><p>An exchange between people.</p></div></div><section class="panel why-page"><h2>Watch Pactlane in action.</h2><video class="demo-video" controls playsinline preload="metadata" poster="/assets/social-preview.png" width="1280" height="720" aria-label="Pactlane 90-second walkthrough"><source src="/demo.mp4" type="video/mp4"><a href="/demo.mp4">Watch the walkthrough</a></video><h2>Use the account you already have.</h2><p>Pay a USDC supplier through Revolut and receive USDC in your own Stellar wallet.</p><h2>A price you can see upfront.</h2><p>The supplier sets the price. You see exactly how many euros you’ll pay and how much USDC you’ll receive before reserving an offer.</p><h2>Escrow connects the two sides.</h2><p>The seller funds the offer first. After you reserve it and confirm the payment lock, you make the bank payment. Payment verification then authorizes the USDC release.</p><h2>Our first mainnet trade.</h2><p>€0.89 paid through Revolut. 1 USDC delivered to the buyer’s Stellar wallet. <a href="https://stellar.expert/explorer/public/tx/ec4220af4056b185d242977385484066789824a2a274f57b3439e1e4dd1b9864" target="_blank" rel="noopener noreferrer">View the confirmed transaction ↗</a></p><details class="trust-details"><summary>Payment privacy and recovery</summary><p>You review the evidence shared with the verifier. Revolut sees the bank payment; Stellar transactions are public. After payment is locked, a failed proof keeps funds in escrow. Recovery requires both wallets to agree.</p></details></section>`;
}
