// Bank-free diagnostic. Uses official released WASM, then stops before any TLS
// connection to an application server. No credentials, transcript or release.
import init, { initialize, Prover } from './tlsn_wasm.js';
const VERIFIER_ORIGIN = '';
const wsOrigin = VERIFIER_ORIGIN.replace(/^https:/, 'wss:');
const counters = {
  queuedBytes: 0,
  receivedBytes: 0,
  peakBufferedBytes: 0,
  lastProgress: 'INITIALIZING',
};
let io, control, prover, tick, deadline, thirtySecondMark;
let started = 0;
let hardwareConcurrency = 0;
let atThirtySeconds = null;

function snapshot() {
  return {
    elapsedMs: started ? Math.round(performance.now() - started) : 0,
    hardwareConcurrency,
    crossOriginIsolated,
    ...counters,
    bufferedBytes: io?.ws.bufferedAmount || 0,
    socketOpen: io?.ws.readyState === WebSocket.OPEN,
  };
}

function openVerifier(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const queue = [];
    let reader = null,
      closed = false,
      error = null;
    const connectionTimer = setTimeout(() => {
      ws.close();
      reject(new Error('CONNECTION_TIMEOUT'));
    }, 10000);
    ws.onopen = () => {
      clearTimeout(connectionTimer);
      resolve({
        ws,
        async read() {
          if (error) throw error;
          if (queue.length) return queue.shift();
          if (closed) return null;
          return new Promise((resolve) => {
            reader = resolve;
          });
        },
        async write(data) {
          if (closed || error) throw new Error('CONNECTION_CLOSED');
          ws.send(data);
          counters.queuedBytes += data.length;
          counters.peakBufferedBytes = Math.max(counters.peakBufferedBytes, ws.bufferedAmount);
        },
        async close() {
          closed = true;
          ws.close();
        },
      });
    };
    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data);
      counters.receivedBytes += data.length;
      if (reader) {
        const resolve = reader;
        reader = null;
        resolve(data);
      } else queue.push(data);
    };
    ws.onclose = () => {
      clearTimeout(connectionTimer);
      closed = true;
      if (reader) {
        const resolve = reader;
        reader = null;
        resolve(null);
      }
    };
    ws.onerror = () => {
      clearTimeout(connectionTimer);
      error = new Error('CONNECTION_FAILED');
      reject(error);
    };
  });
}

function register() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsOrigin + '/session');
    control = ws;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('REGISTRATION_TIMEOUT'));
    }, 10000);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: 'register',
          maxSentData: 4096,
          maxRecvData: 16384,
          sessionData: { diagnostic: 'windows-browser-setup-only-no-bank-request' },
        }),
      );
    ws.onmessage = (event) => {
      try {
        const value = JSON.parse(event.data);
        if (value.type !== 'session_registered' || !/^[0-9a-f-]{36}$/i.test(value.sessionId))
          return;
        clearTimeout(timer);
        resolve(value.sessionId);
      } catch {
        clearTimeout(timer);
        reject(new Error('REGISTRATION_FAILED'));
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('REGISTRATION_FAILED'));
    };
  });
}

try {
  postMessage({ type: 'phase', phase: 'Loading released WASM runtime' });
  await init();
  hardwareConcurrency = navigator.hardwareConcurrency || 4;
  postMessage({ type: 'phase', phase: 'Initializing browser worker pools' });
  await initialize(null, hardwareConcurrency);
  const id = await register();
  io = await openVerifier(wsOrigin + '/verifier?sessionId=' + id);
  prover = new Prover({
    server_name: 'app.revolut.com',
    mode: 'Mpc',
    max_sent_data: 4096,
    max_sent_records: undefined,
    max_recv_data_online: undefined,
    max_recv_data: 16384,
    max_recv_records_online: undefined,
    defer_decryption_from_start: undefined,
    network: 'Bandwidth',
    client_auth: undefined,
    root_certs: undefined,
  });
  prover.set_progress_callback((data) => {
    if (['VERIFIER_CONNECTING', 'MPC_SETUP', 'MPC_SETUP_COMPLETE'].includes(data.step))
      counters.lastProgress = data.step;
  });
  started = performance.now();
  tick = setInterval(() => postMessage({ type: 'progress', ...snapshot() }), 1000);
  thirtySecondMark = setTimeout(() => {
    atThirtySeconds = snapshot();
    postMessage({ type: 'progress', ...atThirtySeconds, pastExtensionDeadline: true });
  }, 30000);
  await Promise.race([
    prover.setup(io),
    new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('DIAGNOSTIC_SETUP_TIMEOUT')), 90000);
    }),
  ]);
  postMessage({
    type: 'result',
    passed: true,
    bankRequestMade: false,
    ...snapshot(),
    atThirtySeconds,
  });
} catch (error) {
  const allowed = [
    'CONNECTION_TIMEOUT',
    'CONNECTION_CLOSED',
    'CONNECTION_FAILED',
    'REGISTRATION_TIMEOUT',
    'REGISTRATION_FAILED',
    'DIAGNOSTIC_SETUP_TIMEOUT',
  ];
  const code = allowed.includes(error?.message) ? error.message : 'BROWSER_RUNTIME_FAILED';
  postMessage({
    type: 'result',
    passed: false,
    bankRequestMade: false,
    code,
    ...snapshot(),
    atThirtySeconds,
  });
} finally {
  clearInterval(tick);
  clearTimeout(deadline);
  clearTimeout(thirtySecondMark);
  await io?.close();
  control?.close();
  try {
    prover?.free();
  } catch {}
  postMessage({ type: 'done' });
}
