export const BUDGETS = Object.freeze({ maxSentData: 4096, maxRecvData: 16384 });
export const ORDER = Object.freeze(['mini', 'cloud', 'mini', 'cloud', 'mini', 'cloud']);
export const HOST_COOLDOWN_MS = 130000;
export const SETUP_DEADLINE_MS = 90000;
export const CLIENT_GUARD_MS = 150000;
export function runOrder(mode) {
  if (mode === 'cloud-only') return ['cloud'];
  if (mode === 'paired') return [...ORDER];
  throw new Error('INVALID_REQUEST');
}
export const ERROR_CODES = Object.freeze([
  'INVALID_TARGETS',
  'INVALID_REQUEST',
  'BROWSER_ISOLATION_REQUIRED',
  'ALREADY_RUNNING',
  'RUNTIME_INIT_FAILED',
  'REGISTRATION_FAILED',
  'REGISTRATION_TIMEOUT',
  'CONNECTION_FAILED',
  'CONNECTION_TIMEOUT',
  'CONNECTION_CLOSED',
  'DIAGNOSTIC_SETUP_TIMEOUT',
  'TRANSPORT_LIMIT_EXCEEDED',
  'SETUP_FAILED',
]);

export function validateTargets(input) {
  if (!Array.isArray(input) || input.length !== 2) throw new Error('INVALID_TARGETS');
  const expected = ['mini', 'cloud'];
  const targets = input.map((row, index) => {
    if (!row || Object.keys(row).sort().join(',') !== 'id,origin' || row.id !== expected[index])
      throw new Error('INVALID_TARGETS');
    let parsed;
    try {
      parsed = new URL(row.origin);
    } catch {
      throw new Error('INVALID_TARGETS');
    }
    if (
      typeof row.origin !== 'string' ||
      parsed.protocol !== 'https:' ||
      parsed.origin !== row.origin ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      !/^[a-z0-9.-]+$/.test(parsed.hostname)
    )
      throw new Error('INVALID_TARGETS');
    return Object.freeze({ id: row.id, origin: parsed.origin });
  });
  if (targets[0].origin === targets[1].origin) throw new Error('INVALID_TARGETS');
  return Object.freeze(targets);
}

export function selectTarget(targets, message) {
  if (
    !message ||
    Object.keys(message).sort().join(',') !== 'targetId,type' ||
    message.type !== 'run'
  )
    throw new Error('INVALID_REQUEST');
  const target = targets.find((row) => row.id === message.targetId);
  if (!target) throw new Error('INVALID_REQUEST');
  return target;
}

export function number(value, maximum = 1e12) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.round(value), maximum)
    : 0;
}

export function safeError(error) {
  return ERROR_CODES.includes(error?.message) ? error.message : 'SETUP_FAILED';
}

export function snapshot(counters, { elapsedMs, hardwareConcurrency, crossOriginIsolated, io }) {
  return {
    elapsedMs: number(elapsedMs, CLIENT_GUARD_MS),
    hardwareConcurrency: number(hardwareConcurrency, 1024),
    crossOriginIsolated: crossOriginIsolated === true,
    queuedBytes: number(counters.queuedBytes),
    receivedBytes: number(counters.receivedBytes),
    peakBufferedBytes: number(counters.peakBufferedBytes),
    bufferedBytes: number(io?.ws?.bufferedAmount),
    socketOpen: io?.ws?.readyState === 1,
    lastProgress: [
      'INITIALIZING',
      'VERIFIER_CONNECTING',
      'MPC_SETUP',
      'MPC_SETUP_COMPLETE',
    ].includes(counters.lastProgress)
      ? counters.lastProgress
      : 'INITIALIZING',
  };
}

export function finalResult({
  targetId,
  passed,
  error,
  metrics,
  atThirtySeconds,
  atSixtySeconds,
  initializationMs,
  registrationMs,
  socketConnectMs,
}) {
  return {
    type: 'result',
    targetId: ['mini', 'cloud'].includes(targetId) ? targetId : 'unknown',
    diagnosticOnly: true,
    bankRequestMade: false,
    releaseGate: 'NOT_CLEARED',
    passed: passed === true,
    ...(passed === true ? {} : { errorCode: safeError(error) }),
    ...metrics,
    initializationMs: number(initializationMs, CLIENT_GUARD_MS),
    registrationMs: number(registrationMs, CLIENT_GUARD_MS),
    socketConnectMs: number(socketConnectMs, CLIENT_GUARD_MS),
    extensionDeadline30Met: passed === true && metrics.elapsedMs <= 30000,
    extensionDeadline60Met: passed === true && metrics.elapsedMs <= 60000,
    atThirtySeconds: atThirtySeconds || null,
    atSixtySeconds: atSixtySeconds || null,
  };
}

export async function runTrial({
  targets,
  message,
  initializeRuntime,
  Prover,
  openVerifier,
  register,
  clock,
  emit,
  hardwareConcurrency,
  crossOriginIsolated,
}) {
  // Validate before loading/initializing WASM or opening any socket.
  const target = selectTarget(validateTargets(targets), message);
  if (crossOriginIsolated !== true) throw new Error('BROWSER_ISOLATION_REQUIRED');
  const counters = {
    queuedBytes: 0,
    receivedBytes: 0,
    peakBufferedBytes: 0,
    lastProgress: 'INITIALIZING',
  };
  let io, control, prover, tick, deadline, mark30, mark60;
  let started = null;
  let initializationMs = 0,
    registrationMs = 0,
    socketConnectMs = 0;
  let atThirtySeconds = null,
    atSixtySeconds = null;
  const getSnapshot = () =>
    snapshot(counters, {
      elapsedMs: started === null ? 0 : clock.now() - started,
      hardwareConcurrency,
      crossOriginIsolated,
      io,
    });
  try {
    let stage = clock.now();
    await initializeRuntime(hardwareConcurrency);
    initializationMs = clock.now() - stage;
    stage = clock.now();
    control = await register(target, BUDGETS);
    registrationMs = clock.now() - stage;
    emit({ type: 'registered', targetId: target.id });
    stage = clock.now();
    io = await openVerifier(target, control.id, counters);
    socketConnectMs = clock.now() - stage;
    emit({ type: 'connected', targetId: target.id });
    prover = new Prover({
      server_name: 'app.revolut.com',
      mode: 'Mpc',
      max_sent_data: BUDGETS.maxSentData,
      max_recv_data: BUDGETS.maxRecvData,
      max_sent_records: undefined,
      max_recv_data_online: undefined,
      max_recv_records_online: undefined,
      defer_decryption_from_start: undefined,
      network: 'Bandwidth',
      client_auth: undefined,
      root_certs: undefined,
    });
    prover.set_progress_callback((data) => {
      if (['VERIFIER_CONNECTING', 'MPC_SETUP', 'MPC_SETUP_COMPLETE'].includes(data?.step))
        counters.lastProgress = data.step;
    });
    started = clock.now();
    tick = clock.setInterval(
      () => emit({ type: 'progress', targetId: target.id, ...getSnapshot() }),
      1000,
    );
    mark30 = clock.setTimeout(() => {
      atThirtySeconds = getSnapshot();
    }, 30000);
    mark60 = clock.setTimeout(() => {
      atSixtySeconds = getSnapshot();
    }, 60000);
    await Promise.race([
      prover.setup(io),
      new Promise((_, reject) => {
        deadline = clock.setTimeout(
          () => reject(new Error('DIAGNOSTIC_SETUP_TIMEOUT')),
          SETUP_DEADLINE_MS,
        );
      }),
    ]);
    emit(
      finalResult({
        targetId: target.id,
        passed: true,
        metrics: getSnapshot(),
        atThirtySeconds,
        atSixtySeconds,
        initializationMs,
        registrationMs,
        socketConnectMs,
      }),
    );
  } catch (error) {
    emit(
      finalResult({
        targetId: target.id,
        passed: false,
        error,
        metrics: getSnapshot(),
        atThirtySeconds,
        atSixtySeconds,
        initializationMs,
        registrationMs,
        socketConnectMs,
      }),
    );
  } finally {
    clock.clearInterval(tick);
    clock.clearTimeout(deadline);
    clock.clearTimeout(mark30);
    clock.clearTimeout(mark60);
    try {
      await io?.close();
    } catch {}
    try {
      control?.close();
    } catch {}
    try {
      prover?.free();
    } catch {}
    emit({ type: 'done', targetId: target.id });
  }
}
