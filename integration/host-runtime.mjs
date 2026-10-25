import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { ReplayStore } from '../policy/src/index.mjs';
import { createChainReader } from './chain-reader.mjs';
import { createChainReconciler } from './chain-reconciler.mjs';
import { createStellarServices } from './stellar-rpc-adapter.mjs';
import { TransactionJournal } from './transaction-journal.mjs';
import { createRecoveryBroker } from './recovery-broker.mjs';

const check = (value, code) => {
  if (!value) throw Error(code);
};
const seconds = () => String(Math.floor(Date.now() / 1000));
const id = (value) => {
  check(
    typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) < 1n << 64n,
    'INVALID_ORDER_ID',
  );
  return value;
};
const termNames = [
  'seller',
  'token_amount',
  'fiat_minor',
  'currency',
  'rail',
  'recipient',
  'offer_expires_at',
  'reservation_seconds',
];
const sameTerms = (a, b) =>
  termNames.every((key) => a[key] === b[key]) && Object.keys(a).length === termNames.length;

export function unconfiguredView() {
  return {
    configured: false,
    deployment: null,
    offers: [],
    ownerOrders: [],
    sellerDrafts: [],
    balances: null,
    serverTime: seconds(),
    unavailableReasons: ['HOST_NOT_CONFIGURED'],
    readiness: { paymentProof: false, submission: false, recovery: false },
  };
}

/** Operator-owned composition. No configuration, private offer data, signing key
 * or verification flag is accepted from HTTP. This factory never submits at boot.
 * The live TLS payment normalizer is still unavailable, so new payment locks stay
 * disabled even when independent testnet funding/reservation is authorized.
 */
export function createHostRuntime({
  deployment,
  deploymentLedger,
  storageDirectory,
  orderIds = [],
  sellerDrafts = [],
  offerReader,
  policyFor,
  server,
  submissionEnabled = false,
  clock = seconds,
} = {}) {
  if (!deployment)
    return {
      readView: async () => unconfiguredView(),
      createServices: () => {
        throw Error('HOST_NOT_CONFIGURED');
      },
      close() {},
    };
  const cfg = structuredClone(deployment),
    drafts = structuredClone(sellerDrafts);
  check(
    cfg.networkPassphrase === Networks.TESTNET &&
      cfg.tokenDecimals === 7 &&
      typeof cfg.maxFeeStroops === 'string' &&
      /^[1-9][0-9]{0,9}$/.test(cfg.maxFeeStroops) &&
      BigInt(cfg.maxFeeStroops) <= 4294967295n,
    'INVALID_DEPLOYMENT',
  );
  check(
    typeof storageDirectory === 'string' && isAbsolute(storageDirectory),
    'PRIVATE_STORAGE_REQUIRED',
  );
  check(
    Array.isArray(orderIds) &&
      orderIds.length <= 64 &&
      Array.isArray(drafts) &&
      drafts.length <= 64,
    'CATALOG_LIMIT',
  );
  check(typeof submissionEnabled === 'boolean', 'INVALID_SUBMISSION_SETTING');
  check(
    typeof deploymentLedger === 'string' &&
      /^[1-9][0-9]{0,9}$/.test(deploymentLedger) &&
      BigInt(deploymentLedger) <= 4294967295n,
    'INVALID_DEPLOYMENT_LEDGER',
  );
  orderIds.forEach(id);
  check(
    typeof clock === 'function' && (!policyFor || typeof policyFor === 'function'),
    'INVALID_HOST_PORT',
  );
  check(new Set(drafts.map((draft) => draft?.id)).size === drafts.length, 'DUPLICATE_SELLER_DRAFT');
  const domain = { network_passphrase: cfg.networkPassphrase, contract: cfg.contract };
  const remote = server ?? new rpc.Server(cfg.rpcUrl);
  if (!server) remote.httpClient.defaults.timeout = 15_000;
  // Validate configured code identity and reader inputs before creating storage.
  createChainReader({ deployment: cfg, server: remote, clock });
  for (const draft of drafts) {
    check(
      typeof draft.id === 'string' &&
        draft.id.length > 0 &&
        draft.id.length <= 80 &&
        draft.publicTerms &&
        StrKey.isValidEd25519PublicKey(draft.publicTerms.seller),
      'INVALID_SELLER_DRAFT',
    );
    check(
      Object.keys(draft.publicTerms).length === termNames.length &&
        termNames.every((name) => Object.hasOwn(draft.publicTerms, name)),
      'INVALID_SELLER_DRAFT',
    );
    const terms = draft.publicTerms;
    check(
      terms.currency === 'EUR' &&
        terms.rail === 'revolut' &&
        /^[a-f0-9]{64}$/.test(terms.recipient),
      'INVALID_SELLER_DRAFT',
    );
    for (const name of ['token_amount', 'fiat_minor'])
      check(
        typeof terms[name] === 'string' &&
          /^[1-9][0-9]{0,38}$/.test(terms[name]) &&
          BigInt(terms[name]) < 1n << 127n,
        'INVALID_SELLER_DRAFT',
      );
    id(terms.offer_expires_at);
    id(terms.reservation_seconds);
  }
  let store, journal, catalog;
  const closeStorage = () => {
    for (const resource of [catalog, journal, store]) {
      try {
        resource?.close();
      } catch {
        /* Close the remaining resources too. */
      }
    }
  };
  try {
    mkdirSync(storageDirectory, { recursive: true, mode: 0o700 });
    store = new ReplayStore(join(storageDirectory, 'payments.sqlite'));
    journal = new TransactionJournal(join(storageDirectory, 'transactions.sqlite'));
    catalog = new DatabaseSync(join(storageDirectory, 'orders.sqlite'));
    chmodSync(join(storageDirectory, 'orders.sqlite'), 0o600);
    catalog.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS known_orders(domain TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(domain,id)); CREATE TABLE IF NOT EXISTS fund_slots(domain TEXT NOT NULL, terms_hash TEXT NOT NULL, order_id TEXT, PRIMARY KEY(domain,terms_hash)); CREATE TABLE IF NOT EXISTS confirmed_receipts(domain TEXT NOT NULL, order_id TEXT NOT NULL, state TEXT NOT NULL, metadata TEXT NOT NULL, PRIMARY KEY(domain,order_id));',
    );
    const domainKey = `${cfg.networkPassphrase}:${cfg.contract}`;
    const atomic = (run) => {
      catalog.exec('BEGIN IMMEDIATE');
      try {
        const value = run();
        catalog.exec('COMMIT');
        return value;
      } catch (error) {
        catalog.exec('ROLLBACK');
        throw error;
      }
    };
    const capacity = () =>
      catalog.prepare('SELECT COUNT(*) AS n FROM known_orders WHERE domain=?').get(domainKey).n +
      catalog
        .prepare('SELECT COUNT(*) AS n FROM fund_slots WHERE domain=? AND order_id IS NULL')
        .get(domainKey).n;
    const remember = (orderId, slot = null) =>
      atomic(() => {
        id(orderId);
        const known = catalog
          .prepare('SELECT 1 FROM known_orders WHERE domain=? AND id=?')
          .get(domainKey, orderId);
        // A slot is reserved before any wallet prompt. Confirmed results must not
        // be discarded because another operation occupied the display catalog.
        check(known || slot || capacity() < 64, 'CATALOG_LIMIT');
        catalog.prepare('INSERT OR IGNORE INTO known_orders VALUES (?,?)').run(domainKey, orderId);
        if (slot)
          catalog
            .prepare('UPDATE fund_slots SET order_id=? WHERE domain=? AND terms_hash=?')
            .run(orderId, domainKey, slot);
      });
    const reserveSlot = (terms) =>
      atomic(() => {
        const key = createHash('sha256')
          .update(JSON.stringify(termNames.map((name) => terms[name])))
          .digest('hex');
        if (
          !catalog
            .prepare('SELECT 1 FROM fund_slots WHERE domain=? AND terms_hash=?')
            .get(domainKey, key)
        ) {
          check(capacity() < 64, 'CATALOG_LIMIT');
          catalog.prepare('INSERT INTO fund_slots VALUES (?,?,NULL)').run(domainKey, key);
        }
        return key;
      });
    const rememberReceipt = (result) => {
      const { order, transaction } = result;
      check(
        ['Released', 'Refunded', 'Resolved'].includes(order.state) &&
          transaction?.status === 'confirmed' &&
          transaction.networkPassphrase === cfg.networkPassphrase &&
          transaction.contract === cfg.contract &&
          /^[a-f0-9]{64}$/.test(transaction.hash),
        'INVALID_CONFIRMED_RECEIPT',
      );
      id(transaction.ledger);
      const metadata = {
        hash: transaction.hash,
        networkPassphrase: transaction.networkPassphrase,
        contract: transaction.contract,
        ledger: transaction.ledger,
        status: 'confirmed',
      };
      catalog
        .prepare('INSERT OR REPLACE INTO confirmed_receipts VALUES (?,?,?,?)')
        .run(domainKey, id(order.id), order.state, JSON.stringify(metadata));
    };
    const withReceipt = (order) => {
      const row = catalog
        .prepare('SELECT state, metadata FROM confirmed_receipts WHERE domain=? AND order_id=?')
        .get(domainKey, order.id);
      return row?.state === order.state
        ? { ...order, lastConfirmedTransaction: JSON.parse(row.metadata) }
        : order;
    };
    orderIds.forEach((orderId) => remember(orderId));
    const reconciler = createChainReconciler({ domain, deploymentLedger, server: remote, store });
    const reader = createChainReader({
      deployment: cfg,
      server: remote,
      offerReader,
      reconciler,
      clock,
    });
    const recovery = createRecoveryBroker({
      deployment: cfg,
      readOrder: (input) => reader.readSnapshot(input),
      getLatestLedger: () => remote.getLatestLedger(),
    });
    const preflight = async () => {
      try {
        await reader.readDeployment();
      } catch {
        throw Error('DEPLOYMENT_UNAVAILABLE');
      }
    };
    let cache,
      closed = false;
    const balances = new Map();
    const cached = (run) => {
      const entry = { until: Infinity };
      entry.value = Promise.resolve()
        .then(run)
        .finally(() => {
          entry.until = Date.now() + 3000;
        });
      return entry;
    };
    const snapshots = async () => {
      check(!closed, 'HOST_CLOSED');
      if (!cache || cache.until <= Date.now()) {
        cache = cached(async () => {
          await reader.readDeployment();
          return Promise.allSettled(
            catalog
              .prepare('SELECT id FROM known_orders WHERE domain=? ORDER BY id')
              .all(domainKey)
              .map((row) => reader.readSnapshot({ orderId: row.id })),
          );
        });
      }
      return cache.value;
    };
    async function tokenBalance(account) {
      check(StrKey.isValidEd25519PublicKey(account), 'INVALID_ACCOUNT');
      const previous = balances.get(account);
      if (previous && previous.until > Date.now()) return previous.value;
      if (!previous && balances.size >= 64) {
        const stale = [...balances].find(([, value]) => value.until <= Date.now());
        check(stale, 'BALANCE_UNAVAILABLE');
        balances.delete(stale[0]);
      }
      const entry = cached(async () => readBalance(account));
      balances.set(account, entry);
      return entry.value;
    }
    async function readBalance(account) {
      const network = await remote.getNetwork();
      check(
        network.passphrase === Networks.TESTNET && Number(network.protocolVersion) >= 29,
        'RPC_NETWORK_MISMATCH',
      );
      const source = await remote.getAccount(account);
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(new Contract(cfg.token).call('balance', new Address(account).toScVal()))
        .setTimeout(60)
        .build();
      const simulation = await remote.simulateTransaction(tx);
      check(
        rpc.Api.isSimulationSuccess(simulation) &&
          !rpc.Api.isSimulationRestore(simulation) &&
          simulation.result?.retval,
        'BALANCE_UNAVAILABLE',
      );
      const value = scValToNative(simulation.result.retval);
      check(typeof value === 'bigint' && value >= 0n && value < 1n << 127n, 'BALANCE_UNAVAILABLE');
      return { tokenAtoms: value.toString() };
    }
    return Object.freeze({
      recovery,
      async readView({ account = null } = {}) {
        const reasons = ['PAYMENT_VERIFICATION_UNAVAILABLE'];
        let values = [],
          balances = null;
        try {
          const results = await snapshots();
          values = results
            .filter((result) => result.status === 'fulfilled')
            .map((result) => result.value);
          if (values.length !== results.length) reasons.push('ORDER_UNAVAILABLE');
        } catch {
          reasons.push('CHAIN_UNAVAILABLE');
        }
        if (account)
          try {
            balances = await tokenBalance(account);
          } catch {
            reasons.push('BALANCE_UNAVAILABLE');
          }
        const now = clock();
        const orders = values.map((value) => value.order);
        return {
          configured: true,
          deployment: {
            networkPassphrase: cfg.networkPassphrase,
            contract: cfg.contract,
            token: cfg.token,
            tokenDecimals: 7,
            tokenLabel: cfg.tokenLabel ?? 'Test token',
          },
          serverTime: now,
          offers: orders
            .filter(
              (order) =>
                order.state === 'Funded' && BigInt(order.terms.offer_expires_at) > BigInt(now),
            )
            .map((order) => ({
              id: order.id,
              seller: order.terms.seller,
              tokenAmount: order.terms.token_amount,
              fiatMinor: order.terms.fiat_minor,
              currency: 'EUR',
              rail: 'revolut',
              offerExpiresAt: order.terms.offer_expires_at,
              recipientCommitment: order.terms.recipient,
            })),
          ownerOrders: account
            ? orders
                .filter((order) => order.buyer === account || order.terms.seller === account)
                .map(withReceipt)
            : [],
          sellerDrafts: account
            ? drafts
                .filter(
                  (draft) =>
                    draft.publicTerms.seller === account &&
                    BigInt(draft.publicTerms.offer_expires_at) > BigInt(now) &&
                    !orders.some((order) => sameTerms(draft.publicTerms, order.terms)),
                )
                .map((draft) => ({
                  id: draft.id,
                  publicTerms: Object.fromEntries(
                    termNames.map((key) => [key, draft.publicTerms[key]]),
                  ),
                }))
            : [],
          balances,
          unavailableReasons: reasons,
          readiness: {
            paymentProof: false,
            submission: submissionEnabled,
            recovery: submissionEnabled,
          },
        };
      },
      async createServices({ wallet, account, sessionId, getOperationDeadline }) {
        check(!closed && StrKey.isValidEd25519PublicKey(account), 'AUTHENTICATION_REQUIRED');
        const policy = policyFor
          ? await policyFor({ account, domain, ledgerReader: reader, store, reconciler })
          : {
              readStatus: async (orderId) => ({ orderId, status: 'unavailable' }),
              readAuthorization: async () => {
                throw Error('LIVE_POLICY_UNAVAILABLE');
              },
            };
        let recoveryPort = null;
        const sellerPort = Object.fromEntries(
          ['selected', 'network', 'signAuthorization'].map((method) => [
            method,
            (...args) => {
              check(recoveryPort, 'RECOVERY_UNAVAILABLE');
              return recoveryPort[method](...args);
            },
          ]),
        );
        const services = createStellarServices({
          deployment: cfg,
          wallet,
          server: remote,
          journal,
          policy,
          instructions: reader.instructionsFor(account),
          recovery: { seller: sellerPort, validForLedgers: 24 },
          submissionEnabled,
        });
        return Object.freeze({
          ...services,
          async getOrder(orderId) {
            return (await reader.readSnapshot({ orderId: id(orderId) })).order;
          },
          async fund(terms) {
            check(
              terms.seller === account &&
                drafts.some((draft) => sameTerms(terms, draft.publicTerms)),
              'OFFER_NOT_APPROVED',
            );
            await preflight();
            const slot = reserveSlot(terms);
            const result = await services.fund(terms);
            remember(result.order.id, slot);
            cache = null;
            return result;
          },
          async reserve(orderId, buyer) {
            await preflight();
            const result = await services.reserve(orderId, buyer);
            cache = null;
            return result;
          },
          async beginPayment() {
            throw Error('PAYMENT_VERIFICATION_UNAVAILABLE');
          },
          async release(orderId, authorization) {
            await preflight();
            const result = await services.release(orderId, authorization);
            rememberReceipt(result);
            cache = null;
            return result;
          },
          async resolve(orderId, buyerTokens) {
            check(submissionEnabled, 'TESTNET_SUBMISSION_NOT_AUTHORIZED');
            check(typeof getOperationDeadline === 'function' && sessionId, 'RECOVERY_UNAVAILABLE');
            await preflight();
            id(orderId);
            const prior = journal.get(`${cfg.contract}:resolve:${orderId}`);
            // Reconciliation of an existing attempt must not ask the seller for
            // a new approval, including when the order is already Resolved.
            recoveryPort =
              prior && prior.state !== 'retryable'
                ? null
                : await recovery.sellerPort({
                    buyerSessionId: sessionId,
                    orderId,
                    buyerTokens,
                    deadline: getOperationDeadline(),
                  });
            try {
              const result = await services.resolve(orderId, buyerTokens);
              rememberReceipt(result);
              cache = null;
              return result;
            } finally {
              recoveryPort = null;
            }
          },
          async refundExpiredReservation(orderId) {
            await preflight();
            const result = await services.refundExpiredReservation(orderId);
            rememberReceipt(result);
            cache = null;
            return result;
          },
        });
      },
      close() {
        if (closed) return;
        closed = true;
        recovery.close();
        closeStorage();
      },
    });
  } catch (error) {
    closeStorage();
    throw error;
  }
}
