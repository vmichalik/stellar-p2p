import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  BUDGETS,
  HOST_COOLDOWN_MS,
  ORDER,
  SETUP_DEADLINE_MS,
  finalResult,
  runTrial,
  safeError,
  runOrder,
  selectTarget,
  snapshot,
  validateTargets,
} from './core.mjs';

const TARGETS = [
  { id: 'mini', origin: 'https://mini.example.test:9492' },
  { id: 'cloud', origin: 'https://cloud.example.test:9492' },
];
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function fakeClock() {
  let now = 0,
    next = 0;
  const jobs = new Map();
  const add = (fn, delay, repeat) => {
    const id = next++;
    jobs.set(id, { fn, at: now + delay, repeat });
    return id;
  };
  return {
    now: () => now,
    setTimeout: (fn, delay) => add(fn, delay, 0),
    setInterval: (fn, delay) => add(fn, delay, delay),
    clearTimeout: (id) => jobs.delete(id),
    clearInterval: (id) => jobs.delete(id),
    pending: () => jobs.size,
    async advance(target) {
      while (true) {
        const item = [...jobs]
          .filter(([, j]) => j.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!item) break;
        const [id, job] = item;
        now = job.at;
        if (job.repeat) job.at += job.repeat;
        else jobs.delete(id);
        job.fn();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

async function fixture({
  targetId = 'mini',
  setupDelay = 36200,
  setupError,
  isolation = true,
  targets = TARGETS,
  message = { type: 'run', targetId },
  registerError,
  initError,
} = {}) {
  const clock = fakeClock();
  const events = [],
    calls = {
      init: 0,
      register: [],
      open: [],
      setup: 0,
      ioClosed: 0,
      controlClosed: 0,
      freed: 0,
      bankRequest: 0,
    };
  const io = {
    ws: { bufferedAmount: 13000000, readyState: 1 },
    async close() {
      calls.ioClosed++;
      this.ws.readyState = 3;
    },
  };
  class FakeProver {
    constructor(config) {
      assert.equal(config.server_name, 'app.revolut.com');
      assert.equal(config.mode, 'Mpc');
      assert.equal(config.max_sent_data, 4096);
      assert.equal(config.max_recv_data, 16384);
      assert.equal(config.network, 'Bandwidth');
    }
    set_progress_callback(fn) {
      fn({ step: 'private-url-and-credential' });
      fn({ step: 'MPC_SETUP' });
    }
    setup(selectedIo) {
      assert.equal(selectedIo, io);
      calls.setup++;
      return new Promise((resolve, reject) => {
        if (Number.isFinite(setupDelay))
          clock.setTimeout(() => {
            io.ws.bufferedAmount = 0;
            setupError ? reject(new Error(setupError)) : resolve();
          }, setupDelay);
      });
    }
    free() {
      calls.freed++;
    }
    send_request() {
      calls.bankRequest++;
      throw new Error('Bank request must never run');
    }
  }
  let failure = null;
  const promise = runTrial({
    targets,
    message,
    clock,
    Prover: FakeProver,
    crossOriginIsolated: isolation,
    hardwareConcurrency: 8,
    emit: (data) => events.push(data),
    initializeRuntime: async () => {
      calls.init++;
      if (initError) throw new Error(initError);
    },
    register: async (target, budgets) => {
      calls.register.push({ target, budgets });
      assert.deepEqual(budgets, { maxSentData: 4096, maxRecvData: 16384 });
      if (registerError) throw new Error(registerError);
      return {
        id: '00000000-0000-4000-8000-000000000001',
        close() {
          calls.controlClosed++;
        },
      };
    },
    openVerifier: async (target, id, counters) => {
      calls.open.push({ target, id });
      Object.assign(counters, {
        queuedBytes: 76100000,
        receivedBytes: 3400000,
        peakBufferedBytes: 13000000,
      });
      return io;
    },
  }).catch((e) => {
    failure = e;
  });
  await flush();
  return { events, calls, clock, promise, failure: () => failure };
}

test('exactly two canonical HTTPS origins and fixed target IDs are required', () => {
  assert.equal(validateTargets(TARGETS).length, 2);
  for (const bad of [
    [],
    [...TARGETS, TARGETS[0]],
    [{ ...TARGETS[0], id: 'evil' }, TARGETS[1]],
    [{ ...TARGETS[0], secret: 'private' }, TARGETS[1]],
    [TARGETS[0], { ...TARGETS[1], origin: TARGETS[0].origin }],
  ])
    assert.throws(() => validateTargets(bad), /INVALID_TARGETS/);
  for (const origin of [
    'http://mini.example.test',
    'https://mini.example.test/',
    'https://user:secret@mini.example.test',
    'https://mini.example.test/path',
    'https://mini.example.test?token=private',
    'https://mini.example.test#private',
  ])
    assert.throws(
      () => validateTargets([{ ...TARGETS[0], origin }, TARGETS[1]]),
      /INVALID_TARGETS/,
    );
});

test('message cannot supply an arbitrary origin, budgets or URL', () => {
  const targets = validateTargets(TARGETS);
  assert.equal(selectTarget(targets, { type: 'run', targetId: 'mini' }).origin, TARGETS[0].origin);
  for (const message of [
    { type: 'run', targetId: 'evil' },
    { type: 'run', targetId: 'mini', origin: 'https://evil.example' },
    { type: 'run', targetId: 'mini', maxRecvData: 999999 },
    { type: 'bank', targetId: 'mini' },
  ])
    assert.throws(() => selectTarget(targets, message), /INVALID_REQUEST/);
});

test('invalid request and absent browser isolation stop before initialization or network', async () => {
  for (const options of [
    { isolation: false },
    { message: { type: 'run', targetId: 'evil' } },
    { targets: [] },
  ]) {
    const h = await fixture(options);
    await h.promise;
    assert.ok(h.failure());
    assert.equal(h.calls.init, 0);
    assert.equal(h.calls.register.length, 0);
    assert.equal(h.calls.open.length, 0);
  }
});

test('36.2-second setup reports the two deadlines and 30-second backlog, then cleans up', async () => {
  const h = await fixture();
  await h.clock.advance(30000);
  assert.equal(h.events.filter((e) => e.type === 'result').length, 0);
  await h.clock.advance(36200);
  await h.promise;
  const result = h.events.find((e) => e.type === 'result');
  assert.equal(result.passed, true);
  assert.equal(result.elapsedMs, 36200);
  assert.equal(result.extensionDeadline30Met, false);
  assert.equal(result.extensionDeadline60Met, true);
  assert.equal(result.atThirtySeconds.bufferedBytes, 13000000);
  assert.equal(result.atSixtySeconds, null);
  assert.equal(result.hardwareConcurrency, 8);
  assert.equal(result.bankRequestMade, false);
  assert.equal(result.releaseGate, 'NOT_CLEARED');
  assert.equal(h.calls.bankRequest, 0);
  assert.equal(h.calls.ioClosed, 1);
  assert.equal(h.calls.controlClosed, 1);
  assert.equal(h.calls.freed, 1);
  assert.equal(h.clock.pending(), 0);
  assert.deepEqual(
    h.events.filter((e) => ['registered', 'connected', 'done'].includes(e.type)).map((e) => e.type),
    ['registered', 'connected', 'done'],
  );
  assert.doesNotMatch(JSON.stringify(h.events), /private-url|credential|00000000/);
});

test('a stalled setup is bounded at 90 seconds and cleans up all trial resources', async () => {
  const h = await fixture({ setupDelay: Infinity });
  await h.clock.advance(89999);
  assert.equal(
    h.events.some((e) => e.type === 'result'),
    false,
  );
  await h.clock.advance(90000);
  await h.promise;
  const result = h.events.find((e) => e.type === 'result');
  assert.equal(result.errorCode, 'DIAGNOSTIC_SETUP_TIMEOUT');
  assert.equal(result.elapsedMs, 90000);
  assert.ok(result.atThirtySeconds);
  assert.ok(result.atSixtySeconds);
  assert.equal(result.extensionDeadline30Met, false);
  assert.equal(result.extensionDeadline60Met, false);
  assert.equal(h.calls.ioClosed, 1);
  assert.equal(h.calls.controlClosed, 1);
  assert.equal(h.calls.freed, 1);
  assert.equal(h.clock.pending(), 0);
});

test('runtime, registration and setup errors never export raw exception text', async () => {
  for (const options of [
    { initError: 'private-cookie-secret' },
    { registerError: 'private-cookie-secret' },
    { setupDelay: 1000, setupError: 'private-cookie-secret' },
  ]) {
    const h = await fixture(options);
    await h.clock.advance(1000);
    await h.promise;
    const result = h.events.find((e) => e.type === 'result');
    assert.equal(result.errorCode, 'SETUP_FAILED');
    assert.doesNotMatch(JSON.stringify(h.events), /private-cookie|secret|00000000/);
    assert.equal(h.calls.bankRequest, 0);
    assert.equal(h.clock.pending(), 0);
  }
});

test('each allowed target uses the identical pinned protocol settings', async () => {
  for (const targetId of ['mini', 'cloud']) {
    const h = await fixture({ targetId, setupDelay: 5000 });
    await h.clock.advance(5000);
    await h.promise;
    assert.equal(h.calls.register[0].target.id, targetId);
    assert.equal(h.calls.open[0].target.id, targetId);
    assert.equal(h.calls.setup, 1);
    assert.equal(h.calls.bankRequest, 0);
    assert.equal(h.events.find((e) => e.type === 'result').extensionDeadline30Met, true);
  }
});

test('six-trial schedule alternates hosts and waits beyond abandoned verifier timeout', () => {
  assert.deepEqual([...ORDER], ['mini', 'cloud', 'mini', 'cloud', 'mini', 'cloud']);
  assert.ok(HOST_COOLDOWN_MS > 120000);
  assert.equal(SETUP_DEADLINE_MS, 90000);
  assert.deepEqual(BUDGETS, { maxSentData: 4096, maxRecvData: 16384 });
});

test('public cloud-only mode selects exactly one fixed cloud target', () => {
  assert.deepEqual(runOrder('cloud-only'), ['cloud']);
  assert.deepEqual(runOrder('paired'), ['mini', 'cloud', 'mini', 'cloud', 'mini', 'cloud']);
  for (const mode of ['https://evil.example', 'mini', '', 'cloud-only?origin=other'])
    assert.throws(() => runOrder(mode), /INVALID_REQUEST/);
});

test('snapshot drops invalid counters/progress and secrets outside the fixed summary', () => {
  const value = snapshot(
    {
      queuedBytes: Infinity,
      receivedBytes: -1,
      peakBufferedBytes: NaN,
      lastProgress: 'private-secret',
    },
    {
      elapsedMs: NaN,
      hardwareConcurrency: Infinity,
      crossOriginIsolated: 'yes',
      io: { ws: { bufferedAmount: -99, readyState: 3 } },
    },
  );
  assert.equal(value.queuedBytes, 0);
  assert.equal(value.receivedBytes, 0);
  assert.equal(value.elapsedMs, 0);
  assert.equal(value.lastProgress, 'INITIALIZING');
  assert.equal(value.crossOriginIsolated, false);
  assert.equal(safeError(new Error('http://private.example/?token=secret')), 'SETUP_FAILED');
  const result = finalResult({
    targetId: 'evil-secret',
    passed: false,
    error: new Error('secret'),
    metrics: value,
  });
  assert.equal(result.targetId, 'unknown');
  assert.doesNotMatch(JSON.stringify(result), /evil-secret|private.example/);
});

test('browser worker has no application-server request/proxy method and only fixed transports', async () => {
  const source = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /send_request|\/proxy\?|fetch\(/);
  assert.match(source, /\/session/);
  assert.match(source, /\/verifier\?sessionId=/);
  assert.match(source, /MAX_QUEUED_BYTES = 128/);
  assert.match(source, /MAX_RECEIVED_BYTES = 32/);
});
