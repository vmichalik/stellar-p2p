import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLiveServer } from '../integration/live-server.mjs';
import { createHostRuntime } from '../integration/host-runtime.mjs';

const port = Number(process.env.PACTLANE_LIVE_PORT ?? '17861');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local port');
const publicOrigin = process.env.PACTLANE_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
let runtime = createHostRuntime();
// Optional operator-owned module supplies trusted ports/configuration. It is not
// accepted from an HTTP request or included in the public static file allowlist.
if (process.env.PACTLANE_HOST_MODULE) {
  const module = await import(pathToFileURL(resolve(process.env.PACTLANE_HOST_MODULE)).href);
  runtime = await module.createRuntime({ publicOrigin });
}
const app = await createLiveServer({ publicOrigin, runtime });
const server = createServer(
  { requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 16_384 },
  app.handler,
);
server.maxConnections = 64;
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Pactlane live UI listening on loopback port ${port}. No deployment or transaction is implied.`,
  ),
);
function close() {
  server.close();
  server.closeIdleConnections();
  app.close();
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
