import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_BODY = 32 * 1024;
const codePattern = /^[A-Z][A-Z0-9_]{1,63}$/;
const json = (res, status, value) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(JSON.stringify(value));
};
const object = (value) =>
  value && Object.getPrototypeOf(value) === Object.prototype && !Array.isArray(value);

export function createWalletRequestBridge({ timeoutMs = 120_000, now = Date.now } = {}) {
  const pending = new Map();
  function request(kind, fields = {}) {
    const id = randomBytes(18).toString('base64url');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('WALLET_REQUEST_EXPIRED'));
      }, timeoutMs);
      pending.set(id, {
        id,
        kind,
        createdAt: now(),
        fields,
        resolve: (result) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        },
      });
      timer.unref?.();
    });
  }
  const wallet = Object.freeze({
    connect: () => request('connect'),
    selected: () => request('selected'),
    network: () => request('network'),
    sign: (transactionXdr, account) => request('sign', { transactionXdr, account }),
    async signAuthEntry(preimageXdr, account) {
      const reply = await request('signAuthEntry', { preimageXdr, account });
      if (reply.signerAddress !== account || typeof reply.signedAuthEntry !== 'string')
        throw new Error('WALLET_AUTH_SIGNING_FAILED');
      return reply.signedAuthEntry;
    },
  });
  return Object.freeze({
    wallet,
    list: () => [...pending.values()].map(({ id, kind, fields }) => ({ id, kind, ...fields })),
    reply(id, payload) {
      const item = pending.get(id);
      if (!item) throw new Error('WALLET_REQUEST_UNKNOWN');
      if (payload.error === true) item.reject(new Error('WALLET_ACTION_DECLINED'));
      else {
        const value = payload.result;
        if (item.kind === 'sign' && typeof value !== 'string')
          throw new Error('WALLET_REPLY_INVALID');
        if (
          item.kind === 'signAuthEntry' &&
          (!object(value) ||
            typeof value.signedAuthEntry !== 'string' ||
            value.signerAddress !== item.fields.account)
        )
          throw new Error('WALLET_REPLY_INVALID');
        if (item.kind !== 'sign' && item.kind !== 'signAuthEntry' && typeof value !== 'string')
          throw new Error('WALLET_REPLY_INVALID');
        item.resolve(value);
      }
      return { received: true };
    },
    replyFromHttp(payload) {
      if (
        !object(payload) ||
        typeof payload.id !== 'string' ||
        (payload.error !== true && !Object.hasOwn(payload, 'result'))
      )
        throw new Error('WALLET_REPLY_INVALID');
      return this.reply(payload.id, payload);
    },
  });
}

export function createHostHttpServer({
  service,
  deployment,
  origin,
  capabilities = [],
  walletBridge,
  policyPort = null,
  staticRoot = null,
  maxRequestsPerMinute = 240,
}) {
  if (!service || !deployment || !walletBridge || typeof origin !== 'string')
    throw new Error('HOST_BOOTSTRAP_INVALID');
  const tokens = new Map(capabilities.map((token) => [token, Date.now() + 3_600_000]));
  const rate = new Map();
  const parsedOrigin = new URL(origin);
  if (
    !['http:', 'https:'].includes(parsedOrigin.protocol) ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== '/' ||
    parsedOrigin.search ||
    parsedOrigin.hash
  )
    throw new Error('HOST_ORIGIN_INVALID');
  const expectedOrigin = parsedOrigin.origin;
  if (
    parsedOrigin.protocol === 'http:' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsedOrigin.hostname)
  )
    throw new Error('HTTPS_OR_LOOPBACK_REQUIRED');
  const publicFiles = new Map([
    ['/testnet/', ['browser/index.html', 'text/html; charset=utf-8']],
    ['/testnet/index.html', ['browser/index.html', 'text/html; charset=utf-8']],
    ['/testnet/client.mjs', ['browser/client.mjs', 'text/javascript; charset=utf-8']],
    ['/testnet/workbench.mjs', ['browser/workbench.mjs', 'text/javascript; charset=utf-8']],
    ['/testnet/style.css', ['browser/style.css', 'text/css; charset=utf-8']],
    [
      '/testnet/freighter-api.js',
      ['node_modules/@stellar/freighter-api/build/index.min.js', 'text/javascript; charset=utf-8'],
    ],
  ]);
  const baseHeaders = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'cache-control': 'no-store, private',
  };
  function allow(req, res) {
    for (const [key, value] of Object.entries(baseHeaders)) res.setHeader(key, value);
    const hostMatches = req.headers.host === parsedOrigin.host;
    if (!hostMatches) return false;
    if (req.headers.origin !== undefined && req.headers.origin !== expectedOrigin) return false;
    if (
      req.headers.origin === undefined &&
      !(req.method === 'GET' && req.headers['sec-fetch-site'] === 'same-origin')
    )
      return false;
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return false;
    const token = auth.slice(7);
    const bytes = Buffer.from(token);
    for (const [expected, expires] of tokens) {
      if (expires <= Date.now()) {
        tokens.delete(expected);
        continue;
      }
      const candidate = Buffer.from(expected);
      if (bytes.length === candidate.length && timingSafeEqual(bytes, candidate)) {
        const minute = Math.floor(Date.now() / 60_000),
          key = `${token}:${minute}`;
        for (const entry of rate.keys()) if (!entry.endsWith(`:${minute}`)) rate.delete(entry);
        const count = (rate.get(key) ?? 0) + 1;
        rate.set(key, count);
        if (count > maxRequestsPerMinute) {
          json(res, 429, { error: 'RATE_LIMITED' });
          return 'limited';
        }
        return true;
      }
    }
    return false;
  }
  async function body(req) {
    let size = 0,
      chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new Error('BODY_TOO_LARGE');
      chunks.push(chunk);
    }
    if (!size) return {};
    let value;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('INVALID_JSON');
    }
    if (!object(value)) throw new Error('INVALID_JSON');
    return value;
  }
  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(405, baseHeaders);
      return res.end();
    }
    let url;
    try {
      url = new URL(req.url, origin);
    } catch {
      return json(res, 400, { error: 'INVALID_REQUEST_URL' });
    }
    const publicFile = publicFiles.get(url.pathname);
    if (publicFile && req.method === 'GET' && staticRoot) {
      if (
        req.headers.host !== parsedOrigin.host ||
        (req.headers.origin !== undefined && req.headers.origin !== expectedOrigin)
      )
        return json(res, 403, { error: 'UNAUTHORIZED' });
      try {
        const path = resolve(staticRoot, publicFile[0]);
        if (!path.startsWith(`${resolve(staticRoot)}${sep}`))
          return json(res, 404, { error: 'NOT_FOUND' });
        const content = readFileSync(path);
        for (const [key, value] of Object.entries(baseHeaders)) res.setHeader(key, value);
        res.setHeader('content-type', publicFile[1]);
        res.setHeader('cache-control', 'no-store, private');
        res.setHeader(
          'content-security-policy',
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
        );
        res.writeHead(200);
        return res.end(content);
      } catch {
        return json(res, 404, { error: 'NOT_FOUND' });
      }
    }
    const authorized = allow(req, res);
    if (authorized === 'limited') return;
    if (!authorized) {
      if (!res.writableEnded)
        json(
          res,
          req.headers.origin !== undefined && req.headers.origin !== expectedOrigin ? 403 : 401,
          { error: 'UNAUTHORIZED' },
        );
      return;
    }
    if (req.method !== 'GET' && req.headers['content-type'] !== 'application/json')
      return json(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
    try {
      const path = url.pathname;
      let value;
      if (req.method === 'GET' && path === '/api/config')
        value = { config: deployment.publicConfig };
      else if (req.method === 'GET' && path === '/api/wallet/requests')
        value = { requests: walletBridge.list() };
      else if (req.method === 'POST' && path === '/api/wallet/replies')
        value = await walletBridge.replyFromHttp(await body(req));
      else if (req.method === 'POST' && path === '/api/connect')
        value = await service.connectWallet((await body(req)).party);
      else if (req.method === 'POST' && path === '/api/fund')
        value = await service.fund((await body(req)).terms);
      else {
        const match = path.match(
          /^\/api\/orders\/([0-9]+)(?:\/(reserve|begin-payment|instructions|proof|policy|release|refund|cancel|resolve|receipt))?$/,
        );
        if (!match) return json(res, 404, { error: 'NOT_FOUND' });
        const [, id, action] = match;
        if (req.method === 'GET' && !action) value = await service.getOrder(id);
        else if (req.method === 'POST' && action === 'reserve')
          value = await service.reserve(id, (await body(req)).buyer);
        else if (req.method === 'POST' && action === 'begin-payment') {
          await body(req);
          value = await service.beginPayment(id);
        } else if (req.method === 'GET' && action === 'instructions')
          value = { destination: await service.getPaymentInstructions(id) };
        else if (req.method === 'POST' && action === 'proof') {
          await body(req);
          value = await service.launchPaymentProof(id);
        } else if (req.method === 'GET' && action === 'policy')
          value = await service.getPolicyStatus(id);
        else if (req.method === 'POST' && action === 'policy') {
          if (!policyPort || typeof policyPort.issue !== 'function')
            throw new Error('LIVE_PAYMENT_VALIDATION_PENDING');
          const input = await body(req);
          if (Reflect.ownKeys(input).length !== 1 || !Object.hasOwn(input, 'evidenceId'))
            throw new Error('INVALID_POLICY_REFERENCE');
          value = await policyPort.issue({ orderId: id, evidenceId: input.evidenceId });
        } else if (req.method === 'POST' && action === 'release')
          value = await service.release(id, (await body(req)).authorization);
        else if (req.method === 'POST' && action === 'refund') {
          await body(req);
          value = await service.refundExpiredReservation(id);
        } else if (req.method === 'POST' && action === 'cancel') {
          await body(req);
          value = await service.cancelFundedOffer(id);
        } else if (req.method === 'POST' && action === 'resolve')
          value = await service.resolve(id, (await body(req)).buyerTokens);
        else if (req.method === 'POST' && action === 'receipt')
          value = await service.reconcileReceipt(id, (await body(req)).transaction);
        else return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      }
      json(res, 200, { result: value ?? null });
    } catch (error) {
      const code =
        typeof error?.code === 'string' && codePattern.test(error.code)
          ? error.code
          : typeof error?.message === 'string' && codePattern.test(error.message)
            ? error.message
            : 'REQUEST_FAILED';
      const status = code === 'BODY_TOO_LARGE' ? 413 : 400;
      json(res, status, { error: code });
    }
  });
  return Object.freeze({
    server,
    addCapability(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,}$/.test(token))
        throw new Error('INVALID_CAPABILITY');
      tokens.set(token, Date.now() + 3_600_000);
    },
    close: () => {
      tokens.clear();
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  });
}

export const createCapability = () => randomBytes(32).toString('base64url');
