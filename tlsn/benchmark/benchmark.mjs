import { TARGETS } from './config.mjs';
import { CLIENT_GUARD_MS, HOST_COOLDOWN_MS, ORDER, runOrder, validateTargets } from './core.mjs';

const start = document.querySelector('#start');
const single = document.querySelector('#single');
const stop = document.querySelector('#stop');
const output = document.querySelector('#status');
const rows = document.querySelector('#rows');
const download = document.querySelector('#export');
const conclusion = document.querySelector('#conclusion');
const names = { mini: 'Mac mini', cloud: 'Cloud candidate' };
const results = [];
const eligibleAt = { mini: 0, cloud: 0 };
let running = false,
  stopRequested = false,
  activeWorker = null,
  cancelTrial = null;
let currentMode = 'cloud-only',
  currentOrder = ['cloud'];
let targets;
try {
  targets = validateTargets(TARGETS);
  if (!crossOriginIsolated) throw new Error('isolation');
  document.querySelector('#targets').textContent = targets
    .map((t) => `${names[t.id]}: ${t.origin}`)
    .join('\n');
  document.querySelector('#cloud-target').textContent = targets.find(
    (t) => t.id === 'cloud',
  ).origin;
  start.disabled = false;
  single.disabled = false;
} catch {
  output.textContent =
    'Fixed HTTPS targets or browser isolation are unavailable. No request was made.';
}

const mb = (n) => (n / 1000000).toFixed(1);
const seconds = (n) => (n / 1000).toFixed(1);
const delay = (n) => new Promise((resolve) => setTimeout(resolve, n));

async function waitEligible(id) {
  while (!stopRequested && Date.now() < eligibleAt[id]) {
    output.textContent = `Waiting ${Math.ceil((eligibleAt[id] - Date.now()) / 1000)}s for the previous ${names[id]} session to expire. No bank request.`;
    await delay(500);
  }
}

function trial(id, index) {
  return new Promise((resolve) => {
    const worker = new Worker('./worker.mjs', { type: 'module' });
    activeWorker = worker;
    let finished = false;
    let tabVisibleThroughout = document.visibilityState === 'visible';
    const visibility = () => {
      if (document.visibilityState !== 'visible') tabVisibleThroughout = false;
    };
    document.addEventListener('visibilitychange', visibility);
    eligibleAt[id] = Date.now() + HOST_COOLDOWN_MS;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      worker.terminate();
      document.removeEventListener('visibilitychange', visibility);
      activeWorker = null;
      cancelTrial = null;
      resolve(result ? { ...result, tabVisibleThroughout } : null);
    };
    cancelTrial = () => finish(null);
    const guard = setTimeout(() => {
      output.textContent = 'Browser guard stopped the trial. No bank request was made.';
      finish({ type: 'guard-failure', targetId: id, errorCode: 'BROWSER_GUARD_TIMEOUT' });
    }, CLIENT_GUARD_MS);
    worker.onerror = () =>
      finish({ type: 'worker-failure', targetId: id, errorCode: 'WORKER_FAILED' });
    let result = null;
    worker.onmessage = ({ data }) => {
      if (data?.targetId !== id && data?.type !== 'worker-error') return;
      if (['registered', 'connected'].includes(data.type))
        eligibleAt[id] = Date.now() + HOST_COOLDOWN_MS;
      else if (data.type === 'progress')
        output.textContent = `Trial ${index + 1}/${currentOrder.length}, ${names[id]}: ${seconds(data.elapsedMs)}s; queued ${mb(data.queuedBytes)} MB; received ${mb(data.receivedBytes)} MB; pending ${mb(data.bufferedBytes)} MB. No bank request.`;
      else if (data.type === 'result') result = data;
      else if (data.type === 'done') finish(result);
      else if (data.type === 'worker-error')
        finish({ type: 'worker-failure', targetId: id, errorCode: 'WORKER_FAILED' });
    };
    output.textContent = `Trial ${index + 1}/${currentOrder.length}, ${names[id]}: initializing pinned browser worker…`;
    worker.postMessage({ type: 'run', targetId: id });
  });
}

function append(result, index) {
  const tr = document.createElement('tr');
  const metrics = result.type === 'result';
  const values = [
    index + 1,
    names[result.targetId],
    metrics
      ? `${result.passed ? 'PASS' : result.errorCode} ${seconds(result.elapsedMs)}s`
      : result.errorCode,
    metrics && result.extensionDeadline30Met ? 'met' : 'not met',
    metrics && result.extensionDeadline60Met ? 'met' : 'not met',
    metrics ? `${mb(result.queuedBytes)} / ${mb(result.receivedBytes)} MB` : '—',
    result.atThirtySeconds ? `${mb(result.atThirtySeconds.bufferedBytes)} MB` : '—',
    metrics ? result.hardwareConcurrency : '—',
  ];
  for (const value of values) {
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(td);
  }
  rows.append(tr);
}

function summarize() {
  if (currentMode === 'cloud-only') {
    const result = results[0];
    const completed = result?.type === 'result' && result.passed;
    conclusion.textContent = completed
      ? `Cloud setup: PASSED in ${seconds(result.elapsedMs)}s; 30-second deadline ${result.extensionDeadline30Met ? 'met' : 'not met'}; 60-second deadline ${result.extensionDeadline60Met ? 'met' : 'not met'}. ${result.tabVisibleThroughout ? '' : 'The tab was hidden during this check. '}This single check is not a host comparison or payment proof. Release gate: NOT_CLEARED.`
      : `Cloud setup did not complete. This single check establishes no host comparison or payment proof. Release gate: NOT_CLEARED.`;
    return;
  }
  const pieces = [];
  for (const id of ['mini', 'cloud']) {
    const group = results.filter((r) => r.targetId === id);
    const passed = group.filter((r) => r.type === 'result' && r.passed && r.tabVisibleThroughout);
    const times = passed.map((r) => r.elapsedMs).sort((a, b) => a - b);
    const median = times.length === 3 ? seconds(times[1]) + 's' : 'incomplete';
    pieces.push(
      `${names[id]}: ${passed.length}/3 foreground setup passes; median ${median}; ${passed.filter((r) => r.extensionDeadline30Met).length}/3 within 30s; ${passed.filter((r) => r.extensionDeadline60Met).length}/3 within 60s`,
    );
  }
  conclusion.textContent =
    pieces.join('. ') +
    '. These measurements establish setup performance only. Release gate: NOT_CLEARED.';
}

async function run(mode) {
  if (running) return;
  currentOrder = runOrder(mode);
  currentMode = mode;
  running = true;
  stopRequested = false;
  results.length = 0;
  rows.replaceChildren();
  start.disabled = true;
  single.disabled = true;
  stop.disabled = false;
  download.disabled = true;
  for (let index = 0; index < currentOrder.length && !stopRequested; index++) {
    const id = currentOrder[index];
    await waitEligible(id);
    if (stopRequested) break;
    const result = await trial(id, index);
    if (result) {
      results.push({ trial: index + 1, ...result });
      append(result, index);
      summarize();
    }
  }
  running = false;
  start.disabled = false;
  single.disabled = false;
  stop.disabled = true;
  download.disabled = !results.length;
  output.textContent = stopRequested
    ? 'Stopped. Completed trial results are retained.'
    : `${currentOrder.length}-trial sequence completed. No bank request was made.`;
}
start.addEventListener('click', () => run('paired'));
single.addEventListener('click', () => run('cloud-only'));

stop.addEventListener('click', () => {
  stopRequested = true;
  activeWorker?.terminate();
  cancelTrial?.();
});
download.addEventListener('click', () => {
  const summary = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    executionClient: 'browser device must be confirmed by the operator',
    diagnosticOnly: true,
    bankRequestMade: false,
    releaseGate: 'NOT_CLEARED',
    mode: currentMode,
    comparison: currentMode === 'paired',
    order: [...currentOrder],
    complete: results.length === currentOrder.length,
    hostCooldownMs: HOST_COOLDOWN_MS,
    results,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(summary, null, 2) + '\n'], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download =
    currentMode === 'paired'
      ? 'tlsn-bank-free-two-host-benchmark.json'
      : 'tlsn-bank-free-cloud-check.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
