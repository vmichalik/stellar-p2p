import { randomBytes } from 'node:crypto';
import {
  Address,
  Networks,
  StrKey,
  authorizeEntry,
  buildAuthorizationEntryPreimage,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';

export const RECOVERY_ERROR_CODES = Object.freeze([
  'RECOVERY_UNAVAILABLE',
  'RECOVERY_SESSION_INVALID',
  'RECOVERY_REQUEST_EXPIRED',
  'RECOVERY_ALREADY_CLAIMED',
  'RECOVERY_REQUEST_MISMATCH',
  'RECOVERY_SIGNATURE_INVALID',
  'RECOVERY_REJECTED',
  'RECOVERY_CAPACITY',
  'RECOVERY_ARGUMENT_INVALID',
  'RECOVERY_CLOSED',
]);
class RecoveryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const check = (value, code = 'RECOVERY_ARGUMENT_INVALID') => {
  if (!value) throw new RecoveryError(code);
};
const token = () => randomBytes(32).toString('base64url');
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const time = (value) => Number.isSafeInteger(value) && value >= 0;
const ledger = (value) => Number.isInteger(value) && value > 0 && value <= 0xffffffff;
const account = (value) => typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
const uint = (value, bits = 64) => {
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 39);
  const number = BigInt(value);
  check(number < 1n << BigInt(bits));
  return number;
};
const exact = (value, names) =>
  check(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === names.length &&
      names.every((name) => Object.hasOwn(value, name)),
  );
const same = (a, b) => Buffer.from(a.toXDR()).equals(Buffer.from(b.toXDR()));
const entryRoot = (contract, orderId, buyerTokens) =>
  new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contract).toScAddress(),
        functionName: 'resolve',
        args: [
          nativeToScVal(uint(orderId), { type: 'u64' }),
          nativeToScVal(uint(buyerTokens, 127), { type: 'i128' }),
        ],
      }),
    ),
    subInvocations: [],
  });

/** Ephemeral transport, not a signing/submission service or replay journal.
 * Only the authenticated bridge registers sessions. Only the trusted collector
 * receives sellerPort(), after its durable buyer action has been reserved.
 * Browser callers can claim/reply to an existing request, never supply an
 * unsigned invocation or an order snapshot. Completed seller authorization does
 * not mean the buyer has signed or the transaction has been submitted.
 */
export function createRecoveryBroker({
  deployment,
  readOrder,
  getLatestLedger,
  clock = Date.now,
  requestTtlMs = 45_000,
  maxSessions = 64,
  maxRequests = 32,
} = {}) {
  const cfg = structuredClone(deployment);
  check(
    cfg?.networkPassphrase === Networks.TESTNET &&
      StrKey.isValidContract(cfg.contract) &&
      StrKey.isValidContract(cfg.token) &&
      cfg.tokenDecimals === 7,
  );
  check(
    typeof readOrder === 'function' &&
      typeof getLatestLedger === 'function' &&
      typeof clock === 'function',
  );
  check(Number.isSafeInteger(requestTtlMs) && requestTtlMs > 0 && requestTtlMs <= 120_000);
  check(Number.isSafeInteger(maxSessions) && maxSessions > 0 && maxSessions <= 1024);
  check(Number.isSafeInteger(maxRequests) && maxRequests > 0 && maxRequests <= 256);
  const sessions = new Map(),
    requests = new Map();
  let closed = false;
  const now = () => {
    const value = clock();
    check(time(value));
    return value;
  };
  const live = () => check(!closed, 'RECOVERY_CLOSED');
  const finish = (request, error, result) => {
    if (requests.get(request.requestId) !== request) return;
    requests.delete(request.requestId);
    clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve(result);
  };
  const closeSession = (sessionId) => {
    sessions.delete(sessionId);
    for (const request of requests.values())
      if (request.buyerSessionId === sessionId || request.sellerSessionId === sessionId)
        finish(request, new RecoveryError('RECOVERY_SESSION_INVALID'));
  };
  function sweep() {
    const current = now();
    for (const [id, session] of sessions) if (session.expiresAt <= current) closeSession(id);
    for (const request of requests.values())
      if (request.expiresAt <= current)
        finish(request, new RecoveryError('RECOVERY_REQUEST_EXPIRED'));
  }
  function session(sessionId) {
    live();
    sweep();
    const value = sessions.get(sessionId);
    check(identifier(sessionId) && value, 'RECOVERY_SESSION_INVALID');
    return value;
  }
  async function latest() {
    try {
      const result = await getLatestLedger();
      check(ledger(result?.sequence), 'RECOVERY_UNAVAILABLE');
      return result.sequence;
    } catch (error) {
      throw error instanceof RecoveryError ? error : new RecoveryError('RECOVERY_UNAVAILABLE');
    }
  }
  function visible(sessionId, request) {
    const viewer = session(sessionId);
    check(
      request && (request.buyerSessionId === sessionId || request.seller === viewer.account),
      'RECOVERY_REQUEST_MISMATCH',
    );
    return viewer;
  }
  const dto = (request) => ({
    requestId: request.requestId,
    orderId: request.orderId,
    networkPassphrase: Networks.TESTNET,
    contract: cfg.contract,
    token: cfg.token,
    buyer: request.buyer,
    seller: request.seller,
    tokenAmount: request.tokenAmount,
    buyerTokens: request.buyerTokens,
    sellerTokens: request.sellerTokens,
    fiatMinor: request.fiatMinor,
    currency: 'EUR',
    rail: 'revolut',
    orderState: request.orderState,
    expirationLedger: request.expirationLedger,
    expiresAt: request.expiresAt,
    status: request.sellerSessionId ? 'claimed' : 'queued',
  });
  async function fresh(sessionId, requestId) {
    session(sessionId);
    check(identifier(requestId));
    const request = requests.get(requestId);
    check(request, 'RECOVERY_REQUEST_EXPIRED');
    visible(sessionId, request);
    const current = await latest();
    session(sessionId);
    check(requests.get(requestId) === request, 'RECOVERY_REQUEST_EXPIRED');
    if (current >= request.expirationLedger) {
      finish(request, new RecoveryError('RECOVERY_REQUEST_EXPIRED'));
      throw new RecoveryError('RECOVERY_REQUEST_EXPIRED');
    }
    check(current >= request.createdLedger, 'RECOVERY_UNAVAILABLE');
    return request;
  }

  return Object.freeze({
    openSession({ id, account: owner, expiresAt }) {
      live();
      sweep();
      check(
        identifier(id) && account(owner) && time(expiresAt) && expiresAt > now(),
        'RECOVERY_SESSION_INVALID',
      );
      const existing = sessions.get(id);
      if (existing) {
        check(
          existing.account === owner && existing.expiresAt === expiresAt,
          'RECOVERY_SESSION_INVALID',
        );
        return;
      }
      check(sessions.size < maxSessions, 'RECOVERY_CAPACITY');
      sessions.set(id, { account: owner, expiresAt });
    },
    closeSession,
    async sellerPort({ buyerSessionId, orderId, buyerTokens, deadline }) {
      const buyerSession = session(buyerSessionId);
      uint(orderId);
      uint(buyerTokens, 127);
      check(time(deadline) && deadline > now(), 'RECOVERY_REQUEST_EXPIRED');
      let snapshot;
      try {
        snapshot = structuredClone(await readOrder({ orderId }));
      } catch {
        throw new RecoveryError('RECOVERY_UNAVAILABLE');
      }
      check(
        session(buyerSessionId) === buyerSession && deadline > now(),
        'RECOVERY_SESSION_INVALID',
      );
      const order = snapshot?.order;
      check(
        snapshot?.confirmed === true &&
          snapshot.network_passphrase === Networks.TESTNET &&
          snapshot.contract === cfg.contract &&
          snapshot.config?.token === cfg.token &&
          order?.id === orderId &&
          ['Reserved', 'Paying'].includes(order.state) &&
          order.buyer === buyerSession.account &&
          account(order.terms?.seller) &&
          order.terms.seller !== order.buyer,
        'RECOVERY_REQUEST_MISMATCH',
      );
      const total = uint(order.terms.token_amount, 127),
        split = uint(buyerTokens, 127);
      check(
        total > 0n &&
          split <= total &&
          uint(order.terms.fiat_minor, 127) > 0n &&
          order.terms.currency === 'EUR' &&
          order.terms.rail === 'revolut',
        'RECOVERY_REQUEST_MISMATCH',
      );
      const expectedRoot = entryRoot(cfg.contract, orderId, buyerTokens);
      let consumed = false;
      const checkBuyer = () => {
        check(session(buyerSessionId) === buyerSession, 'RECOVERY_SESSION_INVALID');
        check(deadline > now(), 'RECOVERY_REQUEST_EXPIRED');
      };
      return Object.freeze({
        selected: async () => {
          checkBuyer();
          return order.terms.seller;
        },
        network: async () => {
          checkBuyer();
          return Networks.TESTNET;
        },
        async signAuthorization(input) {
          checkBuyer();
          check(!consumed, 'RECOVERY_REQUEST_EXPIRED');
          consumed = true;
          exact(input, [
            'entryXdr',
            'account',
            'networkPassphrase',
            'expirationLedger',
            'contract',
            'orderId',
            'buyerTokens',
          ]);
          check(
            input.account === order.terms.seller &&
              input.networkPassphrase === Networks.TESTNET &&
              input.contract === cfg.contract &&
              input.orderId === orderId &&
              input.buyerTokens === buyerTokens &&
              ledger(input.expirationLedger) &&
              typeof input.entryXdr === 'string' &&
              input.entryXdr.length <= 16384,
            'RECOVERY_REQUEST_MISMATCH',
          );
          let entry;
          try {
            entry = xdr.SorobanAuthorizationEntry.fromXDR(input.entryXdr, 'base64');
          } catch {
            throw new RecoveryError('RECOVERY_REQUEST_MISMATCH');
          }
          check(
            entry.credentials.type === 'sorobanCredentialsAddressV2' &&
              same(entry.rootInvocation, expectedRoot),
            'RECOVERY_REQUEST_MISMATCH',
          );
          const credentials = entry.credentials.addressV2;
          check(
            Address.fromScAddress(credentials.address).toString() === order.terms.seller &&
              credentials.signatureExpirationLedger === 0 &&
              (credentials.signature.type === 'scvVoid' ||
                (credentials.signature.type === 'scvVec' &&
                  credentials.signature.vec.length === 0)),
            'RECOVERY_REQUEST_MISMATCH',
          );
          const current = await latest();
          checkBuyer();
          check(
            input.expirationLedger > current && input.expirationLedger <= current + 60,
            'RECOVERY_REQUEST_EXPIRED',
          );
          sweep();
          check(requests.size < maxRequests, 'RECOVERY_CAPACITY');
          check(
            ![...requests.values()].some((request) => request.orderId === orderId),
            'RECOVERY_ALREADY_CLAIMED',
          );
          const expiresAt = Math.min(now() + requestTtlMs, buyerSession.expiresAt, deadline);
          check(expiresAt > now(), 'RECOVERY_REQUEST_EXPIRED');
          return new Promise((resolve, reject) => {
            const request = {
              requestId: token(),
              buyerSessionId,
              buyer: order.buyer,
              seller: order.terms.seller,
              orderId,
              orderState: order.state,
              tokenAmount: total.toString(),
              buyerTokens,
              sellerTokens: (total - split).toString(),
              fiatMinor: order.terms.fiat_minor,
              expirationLedger: input.expirationLedger,
              expiresAt,
              createdLedger: current,
              entry,
              sellerSessionId: null,
              claimToken: null,
              responding: false,
              resolve,
              reject,
            };
            request.timer = setTimeout(
              () => finish(request, new RecoveryError('RECOVERY_REQUEST_EXPIRED')),
              Math.max(1, expiresAt - now()),
            );
            request.timer.unref?.();
            requests.set(request.requestId, request);
          });
        },
      });
    },
    async list(sessionId) {
      const viewer = session(sessionId);
      // An idle recovery inbox does not need an additional RPC round-trip.
      if (
        ![...requests.values()].some(
          (request) => request.buyerSessionId === sessionId || request.seller === viewer.account,
        )
      )
        return [];
      const current = await latest();
      session(sessionId);
      for (const request of requests.values())
        if (current >= request.expirationLedger)
          finish(request, new RecoveryError('RECOVERY_REQUEST_EXPIRED'));
      return [...requests.values()]
        .filter(
          (request) => request.buyerSessionId === sessionId || request.seller === viewer.account,
        )
        .map(dto);
    },
    async inspect(sessionId, requestId) {
      return dto(await fresh(sessionId, requestId));
    },
    async claim(sessionId, requestId) {
      const request = await fresh(sessionId, requestId);
      check(session(sessionId).account === request.seller, 'RECOVERY_REQUEST_MISMATCH');
      check(!request.sellerSessionId, 'RECOVERY_ALREADY_CLAIMED');
      request.sellerSessionId = sessionId;
      request.claimToken = token();
      request.expiresAt = Math.min(request.expiresAt, sessions.get(sessionId).expiresAt);
      clearTimeout(request.timer);
      request.timer = setTimeout(
        () => finish(request, new RecoveryError('RECOVERY_REQUEST_EXPIRED')),
        Math.max(1, request.expiresAt - now()),
      );
      request.timer.unref?.();
      return {
        ...dto(request),
        claimToken: request.claimToken,
        preimageXdr: buildAuthorizationEntryPreimage(
          request.entry,
          request.expirationLedger,
          Networks.TESTNET,
        ).toXDR('base64'),
      };
    },
    async respond(sessionId, requestId, reply) {
      session(sessionId);
      const request = requests.get(requestId);
      check(request, 'RECOVERY_REQUEST_EXPIRED');
      check(
        request.sellerSessionId === sessionId &&
          sessions.get(sessionId).account === request.seller &&
          identifier(reply?.claimToken) &&
          reply.claimToken === request.claimToken,
        'RECOVERY_REQUEST_MISMATCH',
      );
      check(!request.responding, 'RECOVERY_ALREADY_CLAIMED');
      request.responding = true;
      try {
        await fresh(sessionId, requestId);
        if (Object.hasOwn(reply, 'error')) {
          exact(reply, ['claimToken', 'error']);
          check(
            ['RECOVERY_REJECTED', 'WALLET_REJECTED', 'WALLET_OPERATION_UNKNOWN'].includes(
              reply.error,
            ),
          );
          finish(
            request,
            new RecoveryError(
              reply.error === 'WALLET_OPERATION_UNKNOWN'
                ? 'RECOVERY_UNAVAILABLE'
                : 'RECOVERY_REJECTED',
            ),
          );
          return { accepted: true };
        }
        exact(reply, ['claimToken', 'signature', 'signerAddress']);
        check(
          reply.signerAddress === request.seller &&
            typeof reply.signature === 'string' &&
            /^[A-Za-z0-9+/]{86}==$/.test(reply.signature),
          'RECOVERY_SIGNATURE_INVALID',
        );
        const signature = Buffer.from(reply.signature, 'base64');
        check(
          signature.length === 64 && signature.toString('base64') === reply.signature,
          'RECOVERY_SIGNATURE_INVALID',
        );
        let signed;
        try {
          signed = await authorizeEntry(
            request.entry,
            async () => ({ publicKey: request.seller, signature }),
            request.expirationLedger,
            Networks.TESTNET,
          );
        } catch {
          throw new RecoveryError('RECOVERY_SIGNATURE_INVALID');
        }
        session(sessionId);
        session(request.buyerSessionId);
        check(requests.get(requestId) === request, 'RECOVERY_REQUEST_EXPIRED');
        finish(request, null, signed.toXDR('base64'));
        return { accepted: true };
      } catch (error) {
        const safe =
          error instanceof RecoveryError ? error : new RecoveryError('RECOVERY_UNAVAILABLE');
        finish(request, safe);
        throw safe;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      for (const request of requests.values())
        finish(request, new RecoveryError('RECOVERY_CLOSED'));
      sessions.clear();
    },
  });
}
