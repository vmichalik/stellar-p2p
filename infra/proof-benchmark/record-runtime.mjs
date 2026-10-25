import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTlsnEvidenceStore } from '../../policy/src/tlsn-store.mjs';
import { createVerifierIngress } from '../../integration/verifier-ingress.mjs';

// This diagnostic receiver does not construct a policy signer or enable escrow.
// Its store must not be substituted for the cross-deployment replay database.
export async function prepareRecordRuntime({ directory, ingressPort = 17849, clock = Date.now }) {
  if (!isAbsolute(directory) || directory === '/')
    throw Error('PRIVATE_EVIDENCE_DIRECTORY_REQUIRED');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString('hex');
  const store = createTlsnEvidenceStore({
    path: resolve(directory, 'verified-payments.sqlite'),
    ingressSecret: secret,
    clock,
  });
  let ingress, runtimeDirectory;
  try {
    ingress = await createVerifierIngress({
      store,
      port: ingressPort,
      onResult(result) {
        // Fixed status/error codes only: never log IDs, transcript bytes or values.
        console.log(
          result.status === 'VERIFIED_RECORD_STORED'
            ? 'Verified transfer record stored. Payment gate: NOT_CLEARED.'
            : `Transfer record rejected: ${result.code}. Payment gate: NOT_CLEARED.`,
        );
      },
    });
    runtimeDirectory = await mkdtemp(join(tmpdir(), 'pactlane-verifier-runtime-'));
    const config = {
      webhooks: {
        'app.revolut.com': {
          url: `http://127.0.0.1:${ingress.port}/verified-payment`,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    };
    // JSON is valid YAML; no shell or interpolation of credential values.
    await writeFile(join(runtimeDirectory, 'config.yaml'), JSON.stringify(config), { mode: 0o600 });
    return Object.freeze({
      runtimeDirectory,
      store,
      async close() {
        await ingress.close();
        store.close();
        await rm(runtimeDirectory, { recursive: true });
      },
    });
  } catch (error) {
    await ingress?.close();
    store.close();
    if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true });
    throw error;
  }
}
