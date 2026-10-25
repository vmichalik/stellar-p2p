import { pathToFileURL } from 'node:url';
import { bootstrapHost } from './bootstrap.mjs';
import { rpc } from '@stellar/stellar-sdk';
import { loadDeployment } from './config.mjs';
import { verifyDeployment } from './deployment-verifier.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

export async function serveFromEnvironment() {
  let hostAdapters = {};
  if (process.env.PACTLANE_ADAPTERS_MODULE) {
    const adaptersUrl = pathToFileURL(process.env.PACTLANE_ADAPTERS_MODULE).href;
    const adapters = await import(adaptersUrl);
    if (typeof adapters.createHostAdapters !== 'function') throw new Error('HOST_ADAPTERS_INVALID');
    hostAdapters = await adapters.createHostAdapters();
  }
  const origin = env('PACTLANE_ORIGIN');
  const deployment = loadDeployment(env('PACTLANE_DEPLOYMENT_CONFIG'));
  await verifyDeployment({ deployment, server: new rpc.Server(deployment.rpcUrl) });
  const host = bootstrapHost({
    ...hostAdapters,
    deploymentPath: env('PACTLANE_DEPLOYMENT_CONFIG'),
    privateOfferPath: env('PACTLANE_PRIVATE_OFFER_CONFIG'),
    signingKeyPath: process.env.PACTLANE_POLICY_SIGNING_KEY ?? null,
    stateDirectory: env('PACTLANE_STATE_DIRECTORY'),
    origin,
  });
  const bindHost = process.env.PACTLANE_BIND_HOST ?? '127.0.0.1';
  const bindPort = Number(process.env.PACTLANE_BIND_PORT ?? '8787');
  if (!Number.isInteger(bindPort) || bindPort < 1 || bindPort > 65535)
    throw new Error('HOST_PORT_INVALID');
  await new Promise((resolve, reject) => {
    host.http.server.once('error', reject);
    host.http.server.listen(bindPort, bindHost, resolve);
  });
  const address = host.http.server.address();
  process.stdout.write(`Pactlane host listening at http://${bindHost}:${address.port}/api/\n`);
  const accessLinkPath = join(env('PACTLANE_STATE_DIRECTORY'), 'access-link.txt');
  writeFileSync(accessLinkPath, `${origin}/testnet/#access=${host.capability}\n`, { mode: 0o600 });
  process.stdout.write(
    `Private access link saved to ${accessLinkPath}. Keep it out of chat and logs.\n`,
  );
  let indexing = false;
  const index = async () => {
    if (indexing) return;
    indexing = true;
    try {
      await host.indexer.syncOnce();
    } catch {
      process.stderr.write(
        'Indexer stopped before checkpoint advance; operator review required.\n',
      );
    } finally {
      indexing = false;
    }
  };
  void index();
  const timer = setInterval(index, 10_000);
  const stop = async () => {
    clearInterval(timer);
    await host.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return host;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  serveFromEnvironment().catch(() => {
    process.stderr.write(
      'Pactlane host failed to start. Check required configuration and adapters.\n',
    );
    process.exitCode = 1;
  });
}
