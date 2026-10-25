import init, { initialize, Prover } from './tlsn_wasm.js';
import { TARGETS } from './config.mjs';
import { runTrial, safeError, selectTarget, validateTargets } from './core.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QUEUED_BYTES = 128 * 1024 * 1024;
const MAX_RECEIVED_BYTES = 32 * 1024 * 1024;
const clock = {
  now: () => performance.now(),
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (...args) => setInterval(...args),
  clearInterval: (id) => clearInterval(id),
};
let running = false;

function register(target, budgets) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.origin.replace(/^https:/, 'wss:') + '/session');
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('REGISTRATION_TIMEOUT'));
    }, 10000);
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      reject(new Error('REGISTRATION_FAILED'));
    };
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: 'register',
          ...budgets,
          sessionData: { diagnostic: 'fixed-two-target-setup-benchmark-no-bank-request' },
        }),
      );
    ws.onmessage = (event) => {
      if (settled) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'session_registered' || !UUID.test(data.sessionId)) return fail();
        settled = true;
        clearTimeout(timer);
        resolve({ id: data.sessionId, close: () => ws.close() });
      } catch {
        fail();
      }
    };
    ws.onerror = fail;
    ws.onclose = () => {
      if (!settled) fail();
    };
  });
}

function openVerifier(target, id, counters) {
  if (!UUID.test(id)) throw new Error('REGISTRATION_FAILED');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      target.origin.replace(/^https:/, 'wss:') + '/verifier?sessionId=' + id,
    );
    ws.binaryType = 'arraybuffer';
    const queue = [];
    let reader = null,
      closed = false,
      error = null,
      opened = false;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('CONNECTION_TIMEOUT'));
    }, 10000);
    ws.onopen = () => {
      opened = true;
      clearTimeout(timer);
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
          if (error || closed) throw new Error('CONNECTION_CLOSED');
          if (counters.queuedBytes + data.byteLength > MAX_QUEUED_BYTES) {
            error = new Error('TRANSPORT_LIMIT_EXCEEDED');
            ws.close();
            throw error;
          }
          ws.send(data);
          counters.queuedBytes += data.byteLength;
          counters.peakBufferedBytes = Math.max(counters.peakBufferedBytes, ws.bufferedAmount);
        },
        async close() {
          closed = true;
          queue.length = 0;
          ws.close();
        },
      });
    };
    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data);
      counters.receivedBytes += data.byteLength;
      if (counters.receivedBytes > MAX_RECEIVED_BYTES) {
        error = new Error('TRANSPORT_LIMIT_EXCEEDED');
        ws.close();
        return;
      }
      if (reader) {
        const resolve = reader;
        reader = null;
        resolve(data);
      } else queue.push(data);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      closed = true;
      if (reader) {
        const resolve = reader;
        reader = null;
        resolve(null);
      }
      if (!opened) reject(new Error('CONNECTION_FAILED'));
    };
    ws.onerror = () => {
      error = new Error('CONNECTION_FAILED');
      clearTimeout(timer);
      ws.close();
      reject(error);
    };
  });
}

self.onmessage = async ({ data }) => {
  if (running) return postMessage({ type: 'worker-error', errorCode: 'ALREADY_RUNNING' });
  try {
    selectTarget(validateTargets(TARGETS), data);
    running = true;
    await runTrial({
      targets: TARGETS,
      message: data,
      Prover,
      clock,
      register,
      openVerifier,
      hardwareConcurrency: navigator.hardwareConcurrency || 4,
      crossOriginIsolated,
      emit: (value) => postMessage(value),
      initializeRuntime: async (threads) => {
        try {
          await init();
          await initialize(null, threads);
        } catch {
          throw new Error('RUNTIME_INIT_FAILED');
        }
      },
    });
  } catch (error) {
    postMessage({ type: 'worker-error', errorCode: safeError(error) });
  } finally {
    running = false;
  }
};
