// Automated Mac mini infrastructure smoke only. It uses the real private
// benchmark frontend origin so the gateway's exact Origin allowlist is tested.
// This is not the owner's MacBook comparison, and invokes only the mini target.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { validateTargets } from './core.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const mini = process.env.TLSN_MINI_ORIGIN;
validateTargets([
  { id: 'mini', origin: mini },
  { id: 'cloud', origin: 'https://benchmark-smoke-unused.invalid' },
]);
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.TLSN_CHROME_EXECUTABLE,
    headless: true,
    chromiumSandbox: true,
  });
  const page = await browser.newPage();
  const response = await page.goto(mini + '/benchmark/');
  assert.equal(response.status(), 200, 'private benchmark page unavailable');
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  await page.evaluate(() => {
    window.benchmarkSmoke = { events: [], done: false };
    const worker = new Worker('/benchmark/worker.mjs', { type: 'module' });
    worker.onmessage = ({ data }) => {
      window.benchmarkSmoke.events.push(data);
      if (data.type === 'done' || data.type === 'worker-error') {
        worker.terminate();
        window.benchmarkSmoke.done = true;
      }
    };
    worker.onerror = () => {
      window.benchmarkSmoke.events.push({ type: 'worker-error', errorCode: 'WORKER_FAILED' });
      worker.terminate();
      window.benchmarkSmoke.done = true;
    };
    worker.postMessage({ type: 'run', targetId: 'mini' });
  });
  await page.waitForFunction(() => window.benchmarkSmoke.done, {}, { timeout: 140000 });
  const result = await page.evaluate(() =>
    window.benchmarkSmoke.events.find((r) => r.type === 'result'),
  );
  if (result?.passed !== true)
    console.log(JSON.stringify({ smokeFailure: result ?? { errorCode: 'WORKER_FAILED' } }));
  assert.ok(result, 'result missing');
  assert.equal(result.passed, true);
  assert.equal(result.bankRequestMade, false);
  assert.equal(result.releaseGate, 'NOT_CLEARED');
  console.log(
    JSON.stringify({
      observedAt: new Date().toISOString(),
      executionClient: 'automated isolated Chrome on Mac mini',
      scope: 'single-mini-target infrastructure smoke; not MacBook cross-host benchmark',
      crossOriginIsolated: true,
      result,
    }),
  );
} finally {
  await browser?.close();
}
