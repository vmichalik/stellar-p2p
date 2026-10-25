import { createServer } from 'node:http';
import { once } from 'node:events';
import { PolicyError } from '../policy/src/errors.mjs';

// This listener is never routed through the public gateway. The verifier POST
// uses a per-boot secret and loopback; payload fields alone convey no trust.
export async function createVerifierIngress({ store, port = 17849, onResult = () => {} }) {
  if (
    !store ||
    typeof store.ingest !== 'function' ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  )
    throw Error('INVALID_VERIFIER_INGRESS');
  if (typeof onResult !== 'function') throw Error('INVALID_VERIFIER_INGRESS');
  const report = (result) => {
    try {
      onResult(Object.freeze(result));
    } catch {}
  };
  const server = createServer(
    { requestTimeout: 10000, headersTimeout: 5000, maxHeaderSize: 4096 },
    async (request, response) => {
      const reply = (status, value) =>
        response
          .writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          .end(JSON.stringify(value));
      if (
        request.method !== 'POST' ||
        request.url !== '/verified-payment' ||
        request.headers.origin ||
        request.headers['content-type'] !== 'application/json'
      )
        return reply(404, { error: 'UNAVAILABLE' });
      try {
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > 262144) {
            reply(413, { error: 'REQUEST_TOO_LARGE' });
            request.resume();
            return;
          }
          chunks.push(chunk);
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result = store.ingest({ authorization: request.headers.authorization, payload });
        report({ status: 'VERIFIED_RECORD_STORED' });
        reply(200, result);
      } catch (error) {
        const code =
          error instanceof PolicyError && /^[A-Z_]{1,80}$/.test(error.code)
            ? error.code
            : 'INVALID_CALLBACK';
        report({ status: 'REJECTED', code });
        reply(error?.code === 'VERIFIER_INGRESS_UNAUTHORIZED' ? 403 : 422, {
          error: 'VERIFIED_RECORD_NOT_ACCEPTED',
          releaseGate: 'NOT_CLEARED',
        });
      }
    },
  );
  server.maxConnections = 4;
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return Object.freeze({
    port: server.address().port,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  });
}
