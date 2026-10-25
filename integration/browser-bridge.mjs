import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { Keypair, Networks, StrKey } from '@stellar/stellar-sdk';

// Transport only: services still enforce chain authorization, deployment identity,
// policy acceptance and durable reconciliation. A session is not a chain signature.
class BridgeError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => {
  throw new BridgeError(code, status);
};
const check = (condition, code = 'INVALID_INPUT', status = 400) => {
  if (!condition) fail(code, status);
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) =>
  check(
    object(value) &&
      Object.keys(value).length === names.length &&
      names.every((name) => Object.hasOwn(value, name)),
  );
const text = (value, maximum = 256) => {
  check(typeof value === 'string' && value.length > 0 && value.length <= maximum);
  return value;
};
const uint = (value, bits = 64) => {
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 39);
  check(BigInt(value) < 1n << BigInt(bits));
  return value;
};
const account = (value) => {
  check(typeof value === 'string' && StrKey.isValidEd25519PublicKey(value));
  return value;
};
const address = (value) => {
  check(
    typeof value === 'string' &&
      (StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)),
  );
  return value;
};
const hex = (value, bytes) => {
  check(typeof value === 'string' && new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(value));
  return value;
};
const token = () => randomBytes(32).toString('base64url');
const TERMS = [
  'token_amount',
  'fiat_minor',
  'currency',
  'rail',
  'recipient',
  'offer_expires_at',
  'reservation_seconds',
];
function publicTerms(value) {
  check(object(value) && value.currency === 'EUR' && value.rail === 'revolut');
  return {
    seller: address(value.seller),
    token_amount: uint(value.token_amount, 127),
    fiat_minor: uint(value.fiat_minor, 127),
    currency: 'EUR',
    rail: 'revolut',
    recipient: hex(value.recipient, 32),
    offer_expires_at: uint(value.offer_expires_at),
    reservation_seconds: uint(value.reservation_seconds),
  };
}
function publicOrder(value) {
  check(
    object(value) &&
      ['Funded', 'Reserved', 'Paying', 'Released', 'Refunded', 'Resolved'].includes(value.state),
  );
  return {
    id: uint(value.id),
    terms: publicTerms(value.terms),
    state: value.state,
    buyer: value.buyer === null ? null : address(value.buyer),
    reserved_at: uint(value.reserved_at),
    pay_by: uint(value.pay_by),
    locked_at: uint(value.locked_at),
  };
}
function publicTransaction(value) {
  check(
    object(value) && value.networkPassphrase === Networks.TESTNET && value.status === 'confirmed',
  );
  check(StrKey.isValidContract(value.contract));
  return {
    hash: hex(value.hash, 32),
    networkPassphrase: Networks.TESTNET,
    contract: value.contract,
    ledger: uint(value.ledger),
    status: 'confirmed',
  };
}
function publicResult(action, result, owner, args) {
  if (action === 'connectWallet') {
    check(result?.account === owner && result.networkPassphrase === Networks.TESTNET);
    return { account: owner, networkPassphrase: Networks.TESTNET };
  }
  if (action === 'getOrder') {
    check(result?.id === args.orderId);
    return publicOrder(result);
  }
  if (action === 'getPaymentInstructions') return text(result, 256);
  if (action === 'getPolicyStatus') {
    check(
      result?.orderId === args.orderId &&
        ['pending', 'unavailable', 'rejected', 'verified'].includes(result.status),
    );
    return {
      orderId: args.orderId,
      status: result.status,
      ...(result.status === 'verified' ? { authorization: text(result.authorization) } : {}),
    };
  }
  if (action === 'reconcileReceipt') {
    check(
      result?.orderId === args.orderId &&
        ['Released', 'Refunded', 'Resolved'].includes(result.orderState),
    );
    return {
      orderId: args.orderId,
      orderState: result.orderState,
      buyerReceivedAtoms: uint(result.buyerReceivedAtoms, 127),
      sellerReturnedAtoms: uint(result.sellerReturnedAtoms, 127),
      transaction: publicTransaction(result.transaction),
    };
  }
  check(action === 'fund' || result?.order?.id === args.orderId);
  return { order: publicOrder(result?.order), transaction: publicTransaction(result?.transaction) };
}
function command(body, owner) {
  keys(body, ['action', 'args']);
  const { action, args } = body;
  if (action === 'connectWallet') {
    keys(args, ['party']);
    check(['buyer', 'seller'].includes(args.party));
    return [action, args, [args.party]];
  }
  if (action === 'fund') {
    keys(args, ['terms']);
    keys(args.terms, TERMS);
    const terms = publicTerms({ ...args.terms, seller: owner });
    check(BigInt(terms.token_amount) > 0n && BigInt(terms.fiat_minor) > 0n);
    return [action, args, [terms]];
  }
  if (
    [
      'getOrder',
      'reserve',
      'beginPayment',
      'getPaymentInstructions',
      'getPolicyStatus',
      'refundExpiredReservation',
    ].includes(action)
  ) {
    keys(args, ['orderId']);
    uint(args.orderId);
    return [action, args, action === 'reserve' ? [args.orderId, owner] : [args.orderId]];
  }
  if (action === 'release') {
    keys(args, ['orderId', 'authorization']);
    uint(args.orderId);
    text(args.authorization);
    return [action, args, [args.orderId, args.authorization]];
  }
  if (action === 'reconcileReceipt') {
    keys(args, ['orderId', 'transaction']);
    uint(args.orderId);
    keys(args.transaction, ['hash', 'networkPassphrase', 'contract', 'ledger', 'status']);
    return [action, args, [args.orderId, publicTransaction(args.transaction)]];
  }
  // No generic method invocation, proof-launch shortcut or unilateral recovery.
  fail('ACTION_UNAVAILABLE');
}
const SERVICE_ERRORS = new Set([
  'TRANSACTION_PREPARATION_RETRYABLE',
  'WALLET_REJECTED',
  'WALLET_OPERATION_UNKNOWN',
  'HOST_NOT_CONFIGURED',
  'PAYMENT_VERIFICATION_UNAVAILABLE',
  'OFFER_NOT_APPROVED',
  'CATALOG_LIMIT',
  'DEPLOYMENT_UNAVAILABLE',
  'TESTNET_SUBMISSION_NOT_AUTHORIZED',
  'TRANSACTION_PENDING_RECONCILIATION',
  'TRANSACTION_SUBMISSION_UNCERTAIN',
  'TRANSACTION_FAILED',
  'TRANSACTION_FEE_LIMIT',
  'TLSN_PAYMENT_SCHEMA_UNVERIFIED',
  'LIVE_POLICY_UNAVAILABLE',
  'ORDER_NOT_PAYING',
  'PAYMENT_INSTRUCTIONS_LOCKED',
  'PAYMENT_DESTINATION_UNAVAILABLE',
  'PAYMENT_DESTINATION_BINDING_UNVERIFIED',
  'WALLET_ACCOUNT_OR_NETWORK_CHANGED',
]);
const serviceError = (error) =>
  error instanceof BridgeError
    ? error.code
    : SERVICE_ERRORS.has(error?.code)
      ? error.code
      : SERVICE_ERRORS.has(error?.message)
        ? error.message
        : 'SERVICE_UNAVAILABLE';

/** Same-origin JSON API. The caller owns server listening, trusted service ports,
 * deployment/submission configuration and the durable transaction journal.
 * Wallet results are plain account/network strings or signed transaction XDR.
 * Jobs/challenges are ephemeral; restarting/logging out never clears chain journals.
 * A timed-out job is an unknown outcome, not cancellation of an already signed
 * transaction. Clients must reconcile through their durable host service.
 */
export function createBrowserBridge({
  publicOrigin,
  createServices,
  readView,
  clock = Date.now,
  challengeTtlMs = 60_000,
  sessionTtlMs = 900_000,
  operationTimeoutMs = 120_000,
  walletTimeoutMs = 60_000,
  bodyTimeoutMs = 10_000,
  maxSessions = 64,
  maxActiveOperations = maxSessions,
  maxChallenges = 128,
  maxOperationsPerSession = 16,
  maxBodyBytes = 131_072,
} = {}) {
  const origin = new URL(publicOrigin);
  check(origin.origin === publicOrigin && !origin.username && !origin.password, 'INVALID_ORIGIN');
  const secure = origin.protocol === 'https:';
  check(
    secure ||
      (origin.protocol === 'http:' &&
        ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname)),
    'HTTPS_REQUIRED',
  );
  check(typeof createServices === 'function' && typeof clock === 'function', 'INVALID_FACTORY');
  for (const value of [
    challengeTtlMs,
    sessionTtlMs,
    operationTimeoutMs,
    walletTimeoutMs,
    bodyTimeoutMs,
    maxSessions,
    maxActiveOperations,
    maxChallenges,
    maxOperationsPerSession,
    maxBodyBytes,
  ])
    check(Number.isSafeInteger(value) && value > 0, 'INVALID_LIMIT');
  const sessionCookie = secure ? '__Host-pactlane_session' : 'pactlane_session';
  const preauthCookie = secure ? '__Host-pactlane_preauth' : 'pactlane_preauth';
  const challenges = new Map(),
    sessions = new Map(),
    activeAccounts = new Set(),
    context = new AsyncLocalStorage();
  let closed = false;
  const timer = (fn, ms) => {
    const id = setTimeout(fn, ms);
    id.unref?.();
    return id;
  };
  const cookie = (name, value, ttl) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.ceil(ttl / 1000)}${secure ? '; Secure' : ''}`;
  const cookies = (request) => {
    const result = new Map();
    for (const part of (request.headers.cookie ?? '').split(';')) {
      if (!part.trim()) continue;
      const at = part.indexOf('=');
      check(at > 0);
      const name = part.slice(0, at).trim(),
        value = part.slice(at + 1).trim();
      check(!result.has(name));
      result.set(name, value);
    }
    return result;
  };
  function finish(job, status, value) {
    if (job.status !== 'running') return;
    job.status = status;
    clearTimeout(job.timer);
    if (job.pending) {
      clearTimeout(job.pending.timer);
      job.pending.reject(new BridgeError(typeof value === 'string' ? value : 'OPERATION_ENDED'));
      job.pending = null;
    }
    if (status === 'completed') job.result = value;
    else job.error = value;
    if (job.session.active === job.id) job.session.active = null;
  }
  function expire(session, code = 'SESSION_EXPIRED') {
    sessions.delete(session.id);
    clearTimeout(session.timer);
    for (const job of session.jobs.values()) finish(job, 'failed', code);
  }
  function removeChallenge(id) {
    clearTimeout(challenges.get(id)?.timer);
    challenges.delete(id);
  }
  function sweep() {
    const now = clock();
    for (const [id, challenge] of challenges) if (challenge.expiresAt <= now) removeChallenge(id);
    for (const session of sessions.values()) if (session.expiresAt <= now) expire(session);
  }
  function authenticated(request) {
    const session = sessions.get(cookies(request).get(sessionCookie));
    check(session && session.expiresAt > clock(), 'AUTHENTICATION_REQUIRED', 401);
    return session;
  }
  function walletFor(session) {
    const call = (method, args = {}) => {
      const job = context.getStore();
      if (closed || !sessions.has(session.id) || session.expiresAt <= clock())
        return Promise.reject(new BridgeError('SESSION_EXPIRED'));
      if (!job || job.session !== session || job.status !== 'running')
        return Promise.reject(new BridgeError('OPERATION_ENDED'));
      if (job.pending) return Promise.reject(new BridgeError('WALLET_REQUEST_ALREADY_PENDING'));
      return new Promise((resolve, reject) => {
        const request = { id: token(), method, args, resolve, reject };
        request.timer = timer(() => {
          if (job.pending !== request) return;
          job.pending = null;
          reject(new BridgeError('WALLET_TIMEOUT'));
        }, walletTimeoutMs);
        job.pending = request;
      });
    };
    return Object.freeze({
      connect: () => call('connect'),
      selected: () => call('selected'),
      network: () => call('network'),
      sign: (transactionXdr, expectedAccount) => {
        check(expectedAccount === session.account, 'WALLET_ACCOUNT_MISMATCH');
        text(transactionXdr, 65_536);
        return call('sign', {
          transactionXdr,
          account: session.account,
          networkPassphrase: Networks.TESTNET,
        });
      },
    });
  }
  function launch(session, parsed) {
    check(
      !closed && sessions.has(session.id) && session.expiresAt > clock(),
      'AUTHENTICATION_REQUIRED',
      401,
    );
    check(!session.active, 'OPERATION_IN_PROGRESS', 409);
    // A display timeout/logout cannot cancel RPC work. Retain this account's
    // permit until that work settles, including across new browser sessions.
    check(!activeAccounts.has(session.account), 'OPERATION_IN_PROGRESS', 409);
    check(activeAccounts.size < maxActiveOperations, 'OPERATION_CAPACITY', 429);
    if (session.jobs.size >= maxOperationsPerSession)
      session.jobs.delete(session.jobs.keys().next().value);
    const [action, args, parameters] = parsed;
    const job = { id: token(), session, action, status: 'running', pending: null };
    session.jobs.set(job.id, job);
    session.active = job.id;
    activeAccounts.add(session.account);
    job.timer = timer(() => finish(job, 'failed', 'OPERATION_TIMEOUT'), operationTimeoutMs);
    // Attach both terminal handlers immediately. Late completions cannot change a
    // timed-out job or cause a new wallet request under another operation's context.
    context
      .run(job, async () => {
        session.services ??= Promise.resolve().then(() =>
          createServices({ wallet: walletFor(session), account: session.account }),
        );
        const services = await session.services;
        check(job.status === 'running', 'OPERATION_ENDED');
        check(typeof services?.[action] === 'function', 'ACTION_UNAVAILABLE');
        const result = await services[action](...parameters);
        return publicResult(action, result, session.account, args);
      })
      .then(
        (value) => {
          finish(job, 'completed', value);
          activeAccounts.delete(session.account);
        },
        (error) => {
          finish(job, 'failed', serviceError(error));
          activeAccounts.delete(session.account);
        },
      );
    return job.id;
  }
  function readJson(request) {
    check(
      /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? ''),
      'JSON_REQUIRED',
      415,
    );
    return new Promise((resolve, reject) => {
      let bytes = 0,
        parts = [],
        settled = false;
      const done = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        parts = [];
        if (error) reject(error);
        else resolve(value);
      };
      const deadline = timer(() => done(new BridgeError('REQUEST_TIMEOUT', 408)), bodyTimeoutMs);
      request.on('data', (part) => {
        if (settled) return;
        bytes += part.length;
        if (bytes > maxBodyBytes) done(new BridgeError('REQUEST_TOO_LARGE', 413));
        else parts.push(part);
      });
      request.on('end', () => {
        if (settled) return;
        try {
          done(null, JSON.parse(Buffer.concat(parts).toString('utf8')));
        } catch {
          done(new BridgeError('INVALID_JSON'));
        }
      });
      request.on('error', () => done(new BridgeError('REQUEST_ABORTED')));
      request.on('aborted', () => done(new BridgeError('REQUEST_ABORTED')));
    });
  }
  const respond = (response, status, body, setCookie, closeConnection = false) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(closeConnection ? { Connection: 'close' } : {}),
      ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
    });
    response.end(JSON.stringify(body));
  };
  async function route(request, response) {
    check(!closed, 'BRIDGE_CLOSED', 503);
    sweep();
    check(request.headers.host === origin.host, 'ORIGIN_REJECTED', 403);
    check(
      !request.headers.origin || request.headers.origin === publicOrigin,
      'ORIGIN_REJECTED',
      403,
    );
    const method = request.method;
    check(['GET', 'POST', 'DELETE'].includes(method), 'METHOD_NOT_ALLOWED', 405);
    if (method !== 'GET') check(request.headers.origin === publicOrigin, 'ORIGIN_REJECTED', 403);
    const url = new URL(request.url, publicOrigin);
    check(url.origin === publicOrigin && !url.search && !url.hash, 'INVALID_ROUTE', 404);
    const path = url.pathname;
    if (method === 'GET')
      check(
        !request.headers['transfer-encoding'] &&
          (!request.headers['content-length'] || request.headers['content-length'] === '0'),
      );
    if (method === 'GET' && path === '/api/view') {
      check(typeof readView === 'function', 'VIEW_UNAVAILABLE', 503);
      const viewer = sessions.get(cookies(request).get(sessionCookie));
      const owner = viewer?.account ?? null;
      const value = await readView({ account: owner });
      // Expose only the documented public view, never arbitrary runtime data.
      check(object(value) && typeof value.configured === 'boolean', 'VIEW_UNAVAILABLE', 503);
      const collection = (input) => {
        check(Array.isArray(input) && input.length <= 64, 'VIEW_UNAVAILABLE', 503);
        return input;
      };
      const viewDeployment =
        value.deployment === null
          ? null
          : {
              networkPassphrase: value.deployment.networkPassphrase,
              contract: address(value.deployment.contract),
              token: address(value.deployment.token),
              tokenDecimals: value.deployment.tokenDecimals,
              tokenLabel: text(value.deployment.tokenLabel, 40),
            };
      check(
        !viewDeployment ||
          (viewDeployment.networkPassphrase === Networks.TESTNET &&
            viewDeployment.tokenDecimals === 7 &&
            StrKey.isValidContract(viewDeployment.contract) &&
            StrKey.isValidContract(viewDeployment.token)),
      );
      check(value.configured === (viewDeployment !== null));
      const offers = collection(value.offers).map((offer) => {
        check(offer.currency === 'EUR' && offer.rail === 'revolut');
        return {
          id: uint(offer.id),
          seller: address(offer.seller),
          tokenAmount: uint(offer.tokenAmount, 127),
          fiatMinor: uint(offer.fiatMinor, 127),
          currency: 'EUR',
          rail: 'revolut',
          offerExpiresAt: uint(offer.offerExpiresAt),
          recipientCommitment: hex(offer.recipientCommitment, 32),
        };
      });
      const ownerOrders = collection(value.ownerOrders).map((item) => {
        const order = publicOrder(item);
        check(owner && (order.buyer === owner || order.terms.seller === owner));
        return {
          ...order,
          ...(item.lastConfirmedTransaction
            ? { lastConfirmedTransaction: publicTransaction(item.lastConfirmedTransaction) }
            : {}),
        };
      });
      const sellerDrafts = collection(value.sellerDrafts).map((draft) => {
        const terms = publicTerms(draft.publicTerms);
        check(owner && terms.seller === owner);
        return { id: text(draft.id, 80), publicTerms: terms };
      });
      const readiness = value.readiness ?? {};
      respond(response, 200, {
        configured: value.configured,
        deployment: viewDeployment,
        account: owner,
        offers,
        ownerOrders,
        sellerDrafts,
        balances:
          owner && value.balances ? { tokenAtoms: uint(value.balances.tokenAtoms, 127) } : null,
        serverTime: uint(value.serverTime),
        unavailableReasons: collection(value.unavailableReasons).map((reason) => {
          check(/^[A-Z_]{1,64}$/.test(reason));
          return reason;
        }),
        readiness: {
          paymentProof: readiness.paymentProof === true,
          submission: readiness.submission === true,
          recovery: readiness.recovery === true,
        },
      });
      return;
    }
    if (method === 'POST' && path === '/api/session/challenge') {
      const body = await readJson(request);
      keys(body, ['account']);
      account(body.account);
      check(!closed, 'BRIDGE_CLOSED', 503);
      const oldCookie = cookies(request).get(preauthCookie);
      for (const [id, item] of challenges) if (item.browser === oldCookie) removeChallenge(id);
      check(challenges.size < maxChallenges, 'CHALLENGE_CAPACITY', 429);
      const id = token(),
        browser = token(),
        expiresAt = clock() + challengeTtlMs;
      const message = `Pactlane wallet session\nOrigin: ${publicOrigin}\nNetwork: ${Networks.TESTNET}\nAccount: ${body.account}\nNonce: ${id}\nExpires: ${expiresAt}\nThis authenticates this browser session only. It does not authorize a transaction.`;
      const challenge = { account: body.account, browser, expiresAt, message };
      challenge.timer = timer(() => removeChallenge(id), challengeTtlMs);
      challenges.set(id, challenge);
      respond(
        response,
        200,
        { challengeId: id, message, expiresAt, networkPassphrase: Networks.TESTNET },
        cookie(preauthCookie, browser, challengeTtlMs),
      );
      return;
    }
    if (method === 'POST' && path === '/api/session/verify') {
      const body = await readJson(request);
      keys(body, ['challengeId', 'signature']);
      check(!closed, 'BRIDGE_CLOSED', 503);
      const challenge = challenges.get(body.challengeId);
      check(
        challenge &&
          challenge.browser === cookies(request).get(preauthCookie) &&
          challenge.expiresAt > clock(),
        'CHALLENGE_REJECTED',
        401,
      );
      removeChallenge(body.challengeId);
      check(
        typeof body.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(body.signature),
        'SIGNATURE_REJECTED',
        401,
      );
      const signature = Buffer.from(body.signature, 'base64');
      check(
        signature.length === 64 &&
          signature.toString('base64') === body.signature &&
          Keypair.fromPublicKey(challenge.account).verifyMessage(challenge.message, signature),
        'SIGNATURE_REJECTED',
        401,
      );
      const old = sessions.get(cookies(request).get(sessionCookie));
      check(sessions.size - (old ? 1 : 0) < maxSessions, 'SESSION_CAPACITY', 429);
      if (old) expire(old, 'SESSION_REPLACED');
      const session = {
        id: token(),
        account: challenge.account,
        expiresAt: clock() + sessionTtlMs,
        jobs: new Map(),
        active: null,
      };
      session.timer = timer(() => expire(session), sessionTtlMs);
      sessions.set(session.id, session);
      respond(
        response,
        200,
        {
          account: session.account,
          networkPassphrase: Networks.TESTNET,
          expiresAt: session.expiresAt,
        },
        [cookie(sessionCookie, session.id, sessionTtlMs), cookie(preauthCookie, '', 0)],
      );
      return;
    }
    const session = authenticated(request);
    if (path === '/api/session' && method === 'GET') {
      respond(response, 200, {
        account: session.account,
        networkPassphrase: Networks.TESTNET,
        expiresAt: session.expiresAt,
      });
      return;
    }
    if (path === '/api/session' && method === 'DELETE') {
      expire(session, 'SESSION_ENDED');
      respond(response, 200, { ended: true }, cookie(sessionCookie, '', 0));
      return;
    }
    if (path === '/api/commands' && method === 'POST') {
      const operationId = launch(session, command(await readJson(request), session.account));
      respond(response, 202, { operationId });
      return;
    }
    const matched =
      /^\/api\/operations\/([A-Za-z0-9_-]{43})(?:\/wallet-results\/([A-Za-z0-9_-]{43}))?$/.exec(
        path,
      );
    check(matched, 'NOT_FOUND', 404);
    const job = session.jobs.get(matched[1]);
    check(job, 'NOT_FOUND', 404);
    if (method === 'GET' && !matched[2]) {
      respond(response, 200, {
        operationId: job.id,
        status: job.status,
        ...(job.status === 'completed' ? { result: job.result } : {}),
        ...(job.status === 'failed' ? { error: job.error } : {}),
        ...(job.pending
          ? {
              walletRequest: {
                id: job.pending.id,
                method: job.pending.method,
                args: job.pending.args,
              },
            }
          : {}),
      });
      return;
    }
    check(method === 'POST' && matched[2], 'METHOD_NOT_ALLOWED', 405);
    const pending = job.pending;
    check(job.status === 'running' && pending?.id === matched[2], 'WALLET_REQUEST_EXPIRED', 409);
    const body = await readJson(request);
    // A competing reply or expiry can occur while this request body is read.
    check(job.status === 'running' && job.pending === pending, 'WALLET_REQUEST_EXPIRED', 409);
    const rejected = object(body) && Object.hasOwn(body, 'error');
    keys(body, [rejected ? 'error' : 'result']);
    if (rejected) text(body.error);
    else if (pending.method === 'connect' || pending.method === 'selected')
      check(body.result === session.account, 'WALLET_ACCOUNT_MISMATCH');
    else if (pending.method === 'network')
      check(body.result === Networks.TESTNET, 'WALLET_NETWORK_MISMATCH');
    else text(body.result, 65_536);
    clearTimeout(pending.timer);
    job.pending = null;
    if (rejected)
      pending.reject(
        new BridgeError(
          body.error === 'WALLET_REJECTED' ? 'WALLET_REJECTED' : 'WALLET_OPERATION_UNKNOWN',
        ),
      );
    else pending.resolve(body.result);
    respond(response, 200, { accepted: true });
  }
  return Object.freeze({
    handler(request, response) {
      return route(request, response).catch((error) => {
        const status = error instanceof BridgeError ? error.status : 500;
        // Reject unfinished uploads without draining them forever. Flush the
        // small error response, then close; a stalled flush has a deadline.
        const closeConnection = !request.complete || status === 408 || status === 413;
        if (closeConnection) {
          const deadline = timer(() => request.destroy(), 100);
          response.once('finish', () => request.destroy());
          response.once('close', () => clearTimeout(deadline));
        }
        respond(
          response,
          status,
          { error: error instanceof BridgeError ? error.code : 'BRIDGE_UNAVAILABLE' },
          undefined,
          closeConnection,
        );
      });
    },
    close() {
      closed = true;
      for (const id of challenges.keys()) removeChallenge(id);
      for (const session of sessions.values()) expire(session, 'BRIDGE_CLOSED');
    },
  });
}
