import { demoEnabled, modeUrl } from './site-ui.mjs';

const demo = demoEnabled(location.href);
document.body.className = demo ? 'demo-app site-shell' : 'live-app site-shell';
document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-mode-switch]');
  if (!toggle || toggle.disabled) return;
  // Reload ends the old mode's timers, listeners and pending callbacks. Demo
  // storage never supplies a live wallet, offer, payment or receipt.
  location.assign(modeUrl(location.href, !demo));
});

try {
  if (demo) await import('./app.mjs');
  else {
    const script = document.createElement('script');
    script.src = './vendor/freighter-api.js';
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
    await import('./live-app.mjs');
  }
} catch {
  const root = document.querySelector('#pactlane');
  root.textContent = 'Pactlane could not load. Refresh the page to try again.';
}
