// Browser-only transport; transaction validation and signing policy stay on the
// host. The pinned Freighter 6.0.1 UMD is served by /vendor/freighter-api.js.
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const ACTIONS = new Set([
  'connectWallet',
  'getOrder',
  'fund',
  'reserve',
  'beginPayment',
  'getPaymentInstructions',
  'getPolicyStatus',
  'release',
  'refundExpiredReservation',
  'reconcileReceipt',
  'resolve',
]);
const SAFE_FAILURES = new Set([
  'ACTION_UNAVAILABLE',
  'HOST_NOT_CONFIGURED',
  'PAYMENT_VERIFICATION_UNAVAILABLE',
  'OFFER_NOT_APPROVED',
  'CATALOG_LIMIT',
  'DEPLOYMENT_UNAVAILABLE',
  'TESTNET_SUBMISSION_NOT_AUTHORIZED',
  'TRANSACTION_PREPARATION_RETRYABLE',
  'WALLET_REJECTED',
  'TRANSACTION_FAILED',
  'TLSN_PAYMENT_SCHEMA_UNVERIFIED',
  'PAYMENT_INSTRUCTIONS_LOCKED',
  'ORDER_NOT_PAYING',
  'LIVE_POLICY_UNAVAILABLE',
  'RECOVERY_UNAVAILABLE',
  'RECOVERY_REJECTED',
  'RECOVERY_EXPIRED',
  'RECOVERY_REQUEST_NOT_FOUND',
  'RECOVERY_REQUEST_ALREADY_CLAIMED',
  'RECOVERY_SESSION_INVALID',
  'RECOVERY_REQUEST_EXPIRED',
  'RECOVERY_ALREADY_CLAIMED',
  'RECOVERY_REQUEST_MISMATCH',
  'RECOVERY_SIGNATURE_INVALID',
  'RECOVERY_CAPACITY',
  'RECOVERY_ARGUMENT_INVALID',
  'RECOVERY_CLOSED',
  'INVALID_RESOLUTION_SPLIT',
  'RESOLUTION_NOT_AVAILABLE',
]);
const PUBLIC_ERRORS = new Set([
  ...SAFE_FAILURES,
  'AUTHENTICATION_REQUIRED',
  'CHALLENGE_REJECTED',
  'SIGNATURE_REJECTED',
  'INVALID_INPUT',
  'ORIGIN_REJECTED',
  'BRIDGE_CLOSED',
  'BRIDGE_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
  'SESSION_CAPACITY',
  'CHALLENGE_CAPACITY',
  'OPERATION_CAPACITY',
  'OPERATION_IN_PROGRESS',
  'OPERATION_TIMEOUT',
  'SESSION_EXPIRED',
  'SESSION_ENDED',
  'SESSION_REPLACED',
  'WALLET_TIMEOUT',
  'WALLET_OPERATION_UNKNOWN',
  'WALLET_REQUEST_EXPIRED',
  'WALLET_ACCOUNT_MISMATCH',
  'WALLET_NETWORK_MISMATCH',
  'TRANSACTION_PENDING_RECONCILIATION',
  'TRANSACTION_SUBMISSION_UNCERTAIN',
  'TRANSACTION_FEE_LIMIT',
  'PAYMENT_DESTINATION_UNAVAILABLE',
  'PAYMENT_DESTINATION_BINDING_UNVERIFIED',
  'NOT_FOUND',
  'REQUEST_TIMEOUT',
  'REQUEST_TOO_LARGE',
]);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validAccount = (value) => typeof value === 'string' && /^G[A-Z2-7]{55}$/.test(value);
const exactKeys = (value, names) =>
  plain(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));

export class HostClientError extends Error {
  constructor(code, { operationId = null, outcome = 'not-submitted', status } = {}) {
    super(code);
    this.name = 'HostClientError';
    this.code = code;
    this.operationId = operationId;
    this.outcome = outcome;
    this.status = status;
    this.retryable = code === 'TRANSACTION_PREPARATION_RETRYABLE' || code === 'WALLET_REJECTED';
  }
}
const fail = (code) => {
  throw new HostClientError(code);
};
const check = (condition, code) => {
  if (!condition) fail(code);
};

/** Public recovery terms only. No signature material is kept in the view. */
export function readRecoveryRequest(value) {
  const uint = (number, bits) =>
    typeof number === 'string' &&
    /^(0|[1-9][0-9]*)$/.test(number) &&
    number.length <= 39 &&
    BigInt(number) < 1n << BigInt(bits);
  check(
    plain(value) &&
      validId(value.requestId) &&
      uint(value.orderId, 64) &&
      value.networkPassphrase === TESTNET_PASSPHRASE &&
      [value.contract, value.token].every(
        (address) => typeof address === 'string' && /^C[A-Z2-7]{55}$/.test(address),
      ) &&
      validAccount(value.buyer) &&
      validAccount(value.seller) &&
      value.buyer !== value.seller &&
      [value.tokenAmount, value.buyerTokens, value.sellerTokens, value.fiatMinor].every((amount) =>
        uint(amount, 127),
      ) &&
      BigInt(value.tokenAmount) > 0n &&
      BigInt(value.fiatMinor) > 0n &&
      BigInt(value.buyerTokens) + BigInt(value.sellerTokens) === BigInt(value.tokenAmount) &&
      value.currency === 'EUR' &&
      value.rail === 'revolut' &&
      ['Reserved', 'Paying'].includes(value.orderState) &&
      Number.isInteger(value.expirationLedger) &&
      value.expirationLedger > 0 &&
      value.expirationLedger <= 0xffffffff &&
      Number.isSafeInteger(value.expiresAt) &&
      value.expiresAt > 0 &&
      ['queued', 'claimed'].includes(value.status),
    'RECOVERY_REQUEST_INVALID',
  );
  return Object.fromEntries(
    [
      'requestId',
      'orderId',
      'networkPassphrase',
      'contract',
      'token',
      'buyer',
      'seller',
      'tokenAmount',
      'buyerTokens',
      'sellerTokens',
      'orderState',
      'expirationLedger',
      'expiresAt',
      'fiatMinor',
      'currency',
      'rail',
      'status',
    ].map((key) => [key, value[key]]),
  );
}

function canonicalBase64(value, requiredBytes = null) {
  let encoded;
  if (value instanceof Uint8Array) {
    check(value.length <= 65_536, 'WALLET_RESPONSE_INVALID');
    encoded = btoa(String.fromCharCode(...value));
  } else encoded = value;
  check(
    typeof encoded === 'string' &&
      encoded.length > 0 &&
      encoded.length <= 65_536 &&
      encoded.length % 4 === 0 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(encoded),
    'WALLET_RESPONSE_INVALID',
  );
  let decoded;
  try {
    decoded = atob(encoded);
  } catch {
    fail('WALLET_RESPONSE_INVALID');
  }
  check(
    btoa(decoded) === encoded && (requiredBytes === null || decoded.length === requiredBytes),
    'WALLET_RESPONSE_INVALID',
  );
  return encoded;
}

export function createHostClient({
  freighter = globalThis.freighterApi,
  fetch: fetcher = globalThis.fetch?.bind(globalThis),
  location = globalThis.location,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = Date.now,
  pollIntervalMs = 250,
  operationTimeoutMs = 120_000,
  requestTimeoutMs = 15_000,
  maxRememberedWalletRequests = 128,
} = {}) {
  const origin = location?.origin;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail('CLIENT_CONFIGURATION_INVALID');
  }
  check(
    parsed.origin === origin &&
      (parsed.protocol === 'https:' ||
        (parsed.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))),
    'CLIENT_CONFIGURATION_INVALID',
  );
  check(
    typeof fetcher === 'function' && typeof pause === 'function' && typeof clock === 'function',
    'CLIENT_CONFIGURATION_INVALID',
  );
  for (const value of [
    pollIntervalMs,
    operationTimeoutMs,
    requestTimeoutMs,
    maxRememberedWalletRequests,
  ])
    check(Number.isSafeInteger(value) && value > 0, 'CLIENT_CONFIGURATION_INVALID');
  let current = null,
    active = null,
    walletBusy = false,
    last = null,
    sessionEpoch = 0;
  const walletRequests = new Map();
  const recoveryClaims = new Set();

  function guard(ctx) {
    check(!ctx.signal?.aborted, 'CLIENT_ABORTED');
    check(clock() < ctx.deadline, 'CLIENT_TIMEOUT');
    check(location.origin === origin, 'CLIENT_ORIGIN_CHANGED');
    if (ctx.account) check(current?.account === ctx.account, 'WALLET_ACCOUNT_CHANGED');
  }
  function wait(promise, ctx) {
    try {
      guard(ctx);
    } catch (error) {
      Promise.resolve(promise).catch(() => {});
      throw error;
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ctx.signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => finish(new HostClientError('CLIENT_ABORTED'));
      const timer = setTimeout(
        () => finish(new HostClientError('CLIENT_TIMEOUT')),
        Math.max(1, ctx.deadline - clock()),
      );
      ctx.signal?.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(
        (value) => finish(null, value),
        (error) => finish(error),
      );
      if (ctx.signal?.aborted) abort();
    });
  }
  async function request(path, { method = 'GET', body, ctx = {} } = {}) {
    check(
      typeof path === 'string' && /^\/api\/[A-Za-z0-9/_-]+$/.test(path),
      'CLIENT_ROUTE_INVALID',
    );
    const bounded = {
      ...ctx,
      deadline: Math.min(ctx.deadline ?? Infinity, clock() + requestTimeoutMs),
    };
    guard(bounded);
    const controller = new AbortController();
    try {
      const value = await wait(
        (async () => {
          const response = await fetcher(path, {
            method,
            credentials: 'same-origin',
            mode: 'same-origin',
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
            ...(body === undefined
              ? {}
              : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
          });
          check(
            !response.redirected &&
              (!response.url || new URL(response.url, origin).origin === origin),
            'HOST_RESPONSE_INVALID',
          );
          const value = await response.json();
          if (!response.ok) {
            const code = PUBLIC_ERRORS.has(value?.error) ? value.error : 'HOST_REQUEST_FAILED';
            throw new HostClientError(code, { status: response.status });
          }
          check(plain(value), 'HOST_RESPONSE_INVALID');
          return value;
        })(),
        bounded,
      );
      guard(bounded);
      return value;
    } catch (error) {
      throw error instanceof HostClientError ? error : new HostClientError('HOST_UNREACHABLE');
    } finally {
      controller.abort();
    }
  }
  async function wallet(method, args, ctx) {
    guard(ctx);
    check(!walletBusy, 'WALLET_REQUEST_IN_PROGRESS');
    check(typeof freighter?.[method] === 'function', 'WALLET_UNAVAILABLE');
    walletBusy = true;
    const pending = Promise.resolve().then(() => freighter[method](...args));
    // A browser abort cannot close Freighter's prompt. Hold this local prompt
    // lock until the underlying call settles, and ignore its late result.
    pending.then(
      () => {
        walletBusy = false;
      },
      () => {
        walletBusy = false;
      },
    );
    let result;
    try {
      result = await wait(pending, ctx);
    } catch (error) {
      throw error instanceof HostClientError ? error : new HostClientError('WALLET_UNAVAILABLE');
    }
    guard(ctx);
    if (result?.error) {
      // Pinned 6.0.1 source map: FreighterApiDeclinedError.code === -4.
      // Only an explicit returned transaction-signing refusal permits retry.
      fail(
        ((method === 'signTransaction' && result.signedTxXdr === '') ||
          (method === 'signAuthEntry' && result.signedAuthEntry === null)) &&
          result.error.code === -4 &&
          result.signerAddress === ''
          ? 'WALLET_REJECTED'
          : 'WALLET_UNAVAILABLE',
      );
    }
    check(plain(result), 'WALLET_RESPONSE_INVALID');
    return result;
  }
  async function sameWallet(account, ctx) {
    const selected = await wallet('getAddress', [], ctx);
    check(selected.address === account, 'WALLET_ACCOUNT_CHANGED');
    const network = await wallet('getNetworkDetails', [], ctx);
    check(network.networkPassphrase === TESTNET_PASSPHRASE, 'WALLET_NETWORK_CHANGED');
  }
  function sessionValue(value) {
    check(
      validAccount(value?.account) &&
        value.networkPassphrase === TESTNET_PASSPHRASE &&
        Number.isSafeInteger(value.expiresAt) &&
        value.expiresAt > clock(),
      'HOST_SESSION_INVALID',
    );
    return {
      account: value.account,
      networkPassphrase: TESTNET_PASSPHRASE,
      expiresAt: value.expiresAt,
    };
  }
  async function session({ signal, deadline } = {}) {
    const epoch = sessionEpoch;
    try {
      const value = sessionValue(await request('/api/session', { ctx: { signal, deadline } }));
      check(epoch === sessionEpoch, 'CLIENT_SESSION_CHANGED');
      current = value;
    } catch (error) {
      check(epoch === sessionEpoch, 'CLIENT_SESSION_CHANGED');
      if (error.status === 401) current = null;
      else throw error;
    }
    return current && { ...current };
  }
  async function exclusive(options, run) {
    check(!active && !walletBusy, 'CLIENT_OPERATION_IN_PROGRESS');
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const marker = { controller };
    active = marker;
    try {
      return await run({ signal: controller.signal, deadline: clock() + operationTimeoutMs });
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (active === marker) active = null;
    }
  }
  async function authenticate(options = {}) {
    return exclusive(options, async (ctx) => {
      const epoch = ++sessionEpoch;
      current = null;
      const access = await wallet('requestAccess', [], ctx);
      check(validAccount(access.address), 'WALLET_RESPONSE_INVALID');
      const account = access.address;
      await sameWallet(account, ctx);
      const challenge = await request('/api/session/challenge', {
        method: 'POST',
        body: { account },
        ctx,
      });
      check(
        validId(challenge.challengeId) &&
          challenge.networkPassphrase === TESTNET_PASSPHRASE &&
          Number.isSafeInteger(challenge.expiresAt) &&
          challenge.expiresAt > clock() &&
          challenge.expiresAt <= clock() + 300_000,
        'HOST_CHALLENGE_INVALID',
      );
      const expected = `Pactlane wallet session\nOrigin: ${origin}\nNetwork: ${TESTNET_PASSPHRASE}\nAccount: ${account}\nNonce: ${challenge.challengeId}\nExpires: ${challenge.expiresAt}\nThis authenticates this browser session only. It does not authorize a transaction.`;
      check(challenge.message === expected, 'HOST_CHALLENGE_INVALID');
      const signed = await wallet(
        'signMessage',
        [challenge.message, { address: account, networkPassphrase: TESTNET_PASSPHRASE }],
        ctx,
      );
      check(signed.signerAddress === account, 'WALLET_ACCOUNT_CHANGED');
      const signature = canonicalBase64(signed.signedMessage, 64);
      await sameWallet(account, ctx);
      const accepted = sessionValue(
        await request('/api/session/verify', {
          method: 'POST',
          body: { challengeId: challenge.challengeId, signature },
          ctx,
        }),
      );
      check(accepted.account === account, 'HOST_SESSION_INVALID');
      guard(ctx);
      check(epoch === sessionEpoch, 'CLIENT_SESSION_CHANGED');
      current = accepted;
      return { ...current };
    });
  }
  function progress(callback, value) {
    try {
      callback?.(value);
    } catch {
      /* Display callbacks cannot change authorization. */
    }
  }
  async function walletReply(id, incoming, ctx, onProgress) {
    check(
      exactKeys(incoming, ['id', 'method', 'args']) &&
        validId(incoming.id) &&
        ['connect', 'selected', 'network', 'sign'].includes(incoming.method),
      'WALLET_REQUEST_INVALID',
    );
    const key = `${id}:${incoming.id}`;
    const prior = walletRequests.get(key);
    const fingerprint = JSON.stringify(incoming);
    if (prior) check(prior.fingerprint === fingerprint, 'WALLET_REQUEST_INVALID');
    if (prior?.status === 'replied') return;
    check(!prior, 'WALLET_REPLY_UNCERTAIN');
    check(walletRequests.size < maxRememberedWalletRequests, 'CLIENT_REQUEST_CAPACITY');
    const record = { fingerprint, status: 'pending' };
    walletRequests.set(key, record);
    progress(onProgress, { operationId: id, status: 'wallet', walletMethod: incoming.method });
    let result, failure;
    try {
      if (incoming.method === 'sign') {
        check(
          exactKeys(incoming.args, ['transactionXdr', 'account', 'networkPassphrase']) &&
            incoming.args.account === ctx.account &&
            incoming.args.networkPassphrase === TESTNET_PASSPHRASE,
          'WALLET_REQUEST_INVALID',
        );
        const transactionXdr = canonicalBase64(incoming.args.transactionXdr);
        await sameWallet(ctx.account, ctx);
        const signed = await wallet(
          'signTransaction',
          [
            transactionXdr,
            {
              address: ctx.account,
              networkPassphrase: TESTNET_PASSPHRASE,
            },
          ],
          ctx,
        );
        check(signed.signerAddress === ctx.account, 'WALLET_ACCOUNT_CHANGED');
        result = canonicalBase64(signed.signedTxXdr);
        await sameWallet(ctx.account, ctx);
      } else {
        check(exactKeys(incoming.args, []), 'WALLET_REQUEST_INVALID');
        const method = {
          connect: 'requestAccess',
          selected: 'getAddress',
          network: 'getNetworkDetails',
        }[incoming.method];
        const reply = await wallet(method, [], ctx);
        if (incoming.method === 'network') {
          check(reply.networkPassphrase === TESTNET_PASSPHRASE, 'WALLET_NETWORK_CHANGED');
          result = TESTNET_PASSPHRASE;
        } else {
          check(reply.address === ctx.account, 'WALLET_ACCOUNT_CHANGED');
          result = ctx.account;
        }
      }
    } catch (error) {
      failure =
        error instanceof HostClientError ? error : new HostClientError('WALLET_UNAVAILABLE');
    }
    try {
      guard(ctx);
      if (failure && ['CLIENT_ABORTED', 'CLIENT_TIMEOUT'].includes(failure.code)) throw failure;
      const payload = failure
        ? { error: failure.code === 'WALLET_REJECTED' ? 'WALLET_REJECTED' : 'WALLET_UNAVAILABLE' }
        : { result };
      const accepted = await request(`/api/operations/${id}/wallet-results/${incoming.id}`, {
        method: 'POST',
        body: payload,
        ctx,
      });
      check(accepted.accepted === true, 'HOST_RESPONSE_INVALID');
      record.status = 'replied';
      if (failure) throw failure;
    } catch (error) {
      if (record.status !== 'replied') record.status = 'unknown';
      throw error;
    }
  }
  async function poll(id, ctx, onProgress) {
    for (;;) {
      guard(ctx);
      const job = await request(`/api/operations/${id}`, { ctx });
      check(
        job.operationId === id && ['running', 'completed', 'failed'].includes(job.status),
        'HOST_RESPONSE_INVALID',
      );
      if (job.status === 'completed') {
        check(Object.hasOwn(job, 'result') && !job.walletRequest, 'HOST_RESPONSE_INVALID');
        last = {
          ...last,
          operationId: id,
          account: ctx.account,
          status: 'completed',
          outcome: 'completed',
        };
        return { operationId: id, result: job.result };
      }
      if (job.status === 'failed') {
        const code = PUBLIC_ERRORS.has(job.error) ? job.error : 'HOST_OPERATION_FAILED';
        throw new HostClientError(code, {
          operationId: id,
          outcome: SAFE_FAILURES.has(code) ? 'failed' : 'unknown',
        });
      }
      progress(onProgress, { operationId: id, status: 'running' });
      if (job.walletRequest) await walletReply(id, job.walletRequest, ctx, onProgress);
      await wait(pause(pollIntervalMs), ctx);
    }
  }
  async function operate(action, args, operationId, options = {}) {
    return exclusive(options, async (ctx) => {
      let submitted = Boolean(operationId),
        id = operationId;
      try {
        if (!current || current.expiresAt <= clock())
          await session({ signal: ctx.signal, deadline: ctx.deadline });
        check(current, 'AUTHENTICATION_REQUIRED');
        ctx.account = current.account;
        await sameWallet(ctx.account, ctx);
        if (!id) {
          guard(ctx);
          submitted = true;
          last = {
            operationId: null,
            account: ctx.account,
            action,
            status: 'submitting',
            outcome: 'unknown',
          };
          const started = await request('/api/commands', {
            method: 'POST',
            body: { action, args },
            ctx,
          });
          check(validId(started.operationId), 'HOST_RESPONSE_INVALID');
          id = started.operationId;
        }
        last = {
          operationId: id,
          account: ctx.account,
          action: action ?? last?.action,
          status: 'running',
          outcome: 'unknown',
        };
        return await poll(id, ctx, options.onProgress);
      } catch (error) {
        const safe =
          error instanceof HostClientError ? error : new HostClientError('HOST_UNREACHABLE');
        safe.operationId = id ?? null;
        if (safe.outcome === 'not-submitted')
          safe.outcome = submitted
            ? SAFE_FAILURES.has(safe.code)
              ? 'failed'
              : 'unknown'
            : 'not-submitted';
        if (submitted)
          last = {
            ...last,
            operationId: id ?? null,
            account: ctx.account,
            status: 'failed',
            outcome: safe.outcome,
            code: safe.code,
          };
        throw safe;
      }
    }).catch((error) => {
      // A resumed job stays unknown even when a still-open wallet prompt blocks
      // this polling attempt before its normal operation context is entered.
      if (operationId && error instanceof HostClientError && !error.operationId) {
        error.operationId = operationId;
        error.outcome = 'unknown';
      }
      throw error;
    });
  }
  async function respondRecovery(reviewed, approve, options = {}) {
    const expected = readRecoveryRequest(reviewed);
    check(expected.status === 'queued', 'RECOVERY_REQUEST_ALREADY_CLAIMED');
    check(expected.expiresAt > clock(), 'RECOVERY_EXPIRED');
    return exclusive(options, async (ctx) => {
      if (!current || current.expiresAt <= clock())
        await session({ signal: ctx.signal, deadline: ctx.deadline });
      check(current?.account === expected.seller, 'WALLET_ACCOUNT_CHANGED');
      ctx.account = current.account;
      await sameWallet(ctx.account, ctx);
      check(!recoveryClaims.has(expected.requestId), 'RECOVERY_REQUEST_ALREADY_CLAIMED');
      check(recoveryClaims.size < maxRememberedWalletRequests, 'CLIENT_REQUEST_CAPACITY');
      recoveryClaims.add(expected.requestId);
      let claimed,
        responseStarted = false;
      try {
        claimed = await request(`/api/recovery/${expected.requestId}/claim`, {
          method: 'POST',
          body: {},
          ctx,
        });
        const actual = readRecoveryRequest(claimed);
        check(
          actual.status === 'claimed' &&
            Object.keys(expected).every(
              (key) =>
                key === 'status' ||
                (key === 'expiresAt'
                  ? actual[key] <= expected[key]
                  : actual[key] === expected[key]),
            ),
          'RECOVERY_REQUEST_CHANGED',
        );
        check(validId(claimed.claimToken), 'HOST_RESPONSE_INVALID');
        check(actual.expiresAt > clock(), 'RECOVERY_EXPIRED');
        let body = { claimToken: claimed.claimToken, error: 'RECOVERY_REJECTED' };
        if (approve) {
          const preimageXdr = canonicalBase64(claimed.preimageXdr);
          await sameWallet(ctx.account, ctx);
          progress(options.onProgress, {
            status: 'wallet',
            walletMethod: 'signAuthEntry',
            requestId: expected.requestId,
          });
          // Freighter 6.0.1 signs HashIdPreimage and returns a raw 64-byte
          // signature. The host reconstructs and verifies the signed entry.
          const signed = await wallet(
            'signAuthEntry',
            [preimageXdr, { address: ctx.account, networkPassphrase: TESTNET_PASSPHRASE }],
            ctx,
          );
          check(signed.signerAddress === ctx.account, 'WALLET_ACCOUNT_CHANGED');
          body = {
            claimToken: claimed.claimToken,
            signature: canonicalBase64(signed.signedAuthEntry, 64),
            signerAddress: ctx.account,
          };
          await sameWallet(ctx.account, ctx);
          check(actual.expiresAt > clock(), 'RECOVERY_EXPIRED');
        }
        guard(ctx);
        responseStarted = true;
        const accepted = await request(`/api/recovery/${expected.requestId}/respond`, {
          method: 'POST',
          body,
          ctx,
        });
        check(accepted.accepted === true, 'HOST_RESPONSE_INVALID');
        return { requestId: expected.requestId, accepted: true, approved: approve };
      } catch (error) {
        const safe =
          error instanceof HostClientError ? error : new HostClientError('HOST_UNREACHABLE');
        if (!responseStarted && validId(claimed?.claimToken)) {
          try {
            guard(ctx);
            await request(`/api/recovery/${expected.requestId}/respond`, {
              method: 'POST',
              body: {
                claimToken: claimed.claimToken,
                error:
                  safe.code === 'WALLET_REJECTED' ? 'WALLET_REJECTED' : 'WALLET_OPERATION_UNKNOWN',
              },
              ctx,
            });
          } catch {
            /* A lost response must never trigger a second signature. */
          }
        }
        safe.outcome =
          safe.code === 'WALLET_REJECTED' || SAFE_FAILURES.has(safe.code) ? 'failed' : 'unknown';
        throw safe;
      }
    });
  }
  return Object.freeze({
    authenticate,
    session,
    async logout() {
      sessionEpoch++;
      active?.controller.abort();
      current = null;
      try {
        await request('/api/session', { method: 'DELETE' });
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    },
    view: ({ signal } = {}) => request('/api/view', { ctx: { signal } }),
    command(action, args, options) {
      check(ACTIONS.has(action) && plain(args), 'ACTION_UNAVAILABLE');
      return operate(action, args, null, options);
    },
    approveRecovery: (reviewed, options) => respondRecovery(reviewed, true, options),
    rejectRecovery: (reviewed, options) => respondRecovery(reviewed, false, options),
    resumeOperation(operationId, options) {
      check(validId(operationId), 'INVALID_OPERATION_ID');
      return operate(null, null, operationId, options);
    },
    lastOperation: () => last && { ...last },
  });
}
