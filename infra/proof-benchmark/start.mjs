import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createBenchmarkGateway } from '../../tlsn/benchmark/gateway.mjs';
import { runtimeConfiguration, PINNED_GIT_HASH, VERIFIER_PORT } from './configuration.mjs';
import { prepareRecordRuntime } from './record-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function verifierReady(fetchImpl = fetch) {
  try {
    const [health, info] = await Promise.all([
      fetchImpl(`http://127.0.0.1:${VERIFIER_PORT}/health`, { signal: AbortSignal.timeout(1000) }),
      fetchImpl(`http://127.0.0.1:${VERIFIER_PORT}/info`, { signal: AbortSignal.timeout(1000) }),
    ]);
    if (!health.ok || !info.ok || (await health.text()).trim() !== 'ok') return false;
    const data = await info.json();
    return (
      data.version === '0.1.0' &&
      data.git_hash === PINNED_GIT_HASH &&
      data.tlsn_version === '0.1.0-alpha.15'
    );
  } catch {
    return false;
  }
}

async function main() {
  // Validate every public origin before creating the verifier process or listener.
  const config = runtimeConfiguration(process.env);
  let gateway,
    verifier,
    recordRuntime,
    application,
    stopping = false;
  async function stop(code) {
    if (stopping) return;
    stopping = true;
    try {
      await gateway?.close();
    } catch {}
    if (verifier && verifier.exitCode === null && verifier.signalCode === null) {
      verifier.kill('SIGTERM');
      const forced = setTimeout(() => verifier.kill('SIGKILL'), 5000);
      forced.unref();
    }
    application?.close();
    await recordRuntime?.close();
    process.exitCode = code;
  }
  process.once('SIGTERM', () => {
    void stop(0);
  });
  process.once('SIGINT', () => {
    void stop(0);
  });
  try {
    const recordDirectory = process.env.TLSN_EVIDENCE_DIRECTORY;
    if (recordDirectory) recordRuntime = await prepareRecordRuntime({ directory: recordDirectory });
    verifier = spawn(resolve(HERE, 'bin/tlsn-verifier-server'), [], {
      cwd: recordRuntime?.runtimeDirectory ?? resolve(HERE, 'runtime'),
      env: { ...process.env, PORT: String(VERIFIER_PORT), GIT_HASH: PINNED_GIT_HASH },
      // The pinned binary logs disclosed transcript bytes at INFO and ignores
      // RUST_LOG. Suppress its output when a complete financial record is used.
      stdio: recordRuntime ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'inherit', 'inherit'],
    });
    verifier.once('error', () => {
      console.error('Pinned verifier could not start.');
      void stop(1);
    });
    verifier.once('exit', () => {
      if (!stopping) {
        console.error('Pinned verifier stopped.');
        void stop(1);
      }
    });
    let ready = false;
    for (let attempt = 0; attempt < 30 && !stopping; attempt++) {
      if (await verifierReady()) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready || stopping) throw new Error('VERIFIER_NOT_READY');
    if (process.env.PACTLANE_OPERATOR_DIRECTORY) {
      if (!recordRuntime) throw Error('DURABLE_EVIDENCE_REQUIRED');
      const { createLiveOperator } = await import('../../integration/live-operator.mjs');
      application = await createLiveOperator({
        directory: process.env.PACTLANE_OPERATOR_DIRECTORY,
        evidenceDirectory: recordDirectory,
        evidenceStore: recordRuntime.store,
        proofHealth: verifierReady,
      });
    }
    gateway = await createBenchmarkGateway({
      ...config,
      fullPaymentRecord: !!recordRuntime,
      application,
    });
    if (stopping) return;
    await gateway.listen();
    if (stopping) {
      await gateway.close();
      return;
    }
    console.log('Pactlane gateway ready on port 8080. Payment gate: NOT_CLEARED.');
  } catch {
    console.error('Public benchmark startup failed; no bank request was made.');
    await stop(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
