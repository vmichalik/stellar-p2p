import { StrKey, scValToNative } from '@stellar/stellar-sdk';
import { NETWORKS } from '../app/network.mjs';
import { assertRpcNetwork } from './deployment-config.mjs';
import { escrowDomainKey, orderBinding } from '../policy/src/index.mjs';

const check = (condition, code) => {
  if (!condition) throw new Error(code);
};
const ledgerNumber = (value) => {
  check(typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value), 'INVALID_LEDGER_SEQUENCE');
  const number = Number(value);
  // getEvents currently encodes ledger numbers as signed 32-bit integers.
  check(Number.isSafeInteger(number) && number < 0x7fffffff, 'INVALID_LEDGER_SEQUENCE');
  return number;
};
const states = new Set(['Funded', 'Reserved', 'Paying', 'Released', 'Refunded', 'Resolved']);

function orderEvent(event, contract, start, end) {
  const address =
    typeof event?.contractId === 'string' ? event.contractId : event?.contractId?.contractId?.();
  check(
    event?.type === 'contract' && address === contract && event.inSuccessfulContractCall !== false,
    'UNTRUSTED_CHAIN_EVENT',
  );
  check(
    Number.isSafeInteger(event.ledger) && event.ledger >= start && event.ledger < end,
    'EVENT_OUTSIDE_SCAN_RANGE',
  );
  check(
    typeof event.id === 'string' &&
      /^[0-9]{19}-[0-9]{10}$/.test(event.id) &&
      /^[a-f0-9]{64}$/.test(event.txHash),
    'INVALID_CHAIN_EVENT',
  );
  check(Array.isArray(event.topic) && event.topic.length === 2, 'INVALID_ORDER_EVENT');
  // This is the frozen contract event ABI, extracted in interface.json:
  // prefix order_changed, u64 order_id topic, map data { state: State }.
  check(
    event.topic[0].type === 'scvSymbol' &&
      scValToNative(event.topic[0]) === 'order_changed' &&
      event.topic[1].type === 'scvU64',
    'INVALID_ORDER_EVENT',
  );
  check(event.value.type === 'scvMap', 'INVALID_ORDER_EVENT');
  const data = event.value.map;
  check(
    data?.length === 1 &&
      data[0].key.type === 'scvSymbol' &&
      scValToNative(data[0].key) === 'state',
    'INVALID_ORDER_EVENT',
  );
  const stateValue = data[0].val;
  check(
    stateValue.type === 'scvVec' &&
      stateValue.vec?.length === 1 &&
      stateValue.vec[0].type === 'scvSymbol',
    'INVALID_ORDER_EVENT',
  );
  const state = scValToNative(stateValue.vec[0]);
  check(states.has(state), 'UNKNOWN_ORDER_STATE');
  const orderId = scValToNative(event.topic[1]).toString();
  check(BigInt(orderId) >= 0n, 'INVALID_ORDER_EVENT');
  return {
    id: event.id,
    ledgerSequence: String(event.ledger),
    orderId,
    state,
    identity: [
      event.txHash,
      ...event.topic.map((value) => value.toXDR('base64')),
      event.value.toXDR('base64'),
    ].join(':'),
  };
}

/** Server-only scanner. No caller-supplied event/checkpoint is accepted.
 * Configure deploymentLedger from the confirmed deployment receipt. One
 * ReplayStore must cover all deployments handled by the payment signer.
 */
export function createChainReconciler({
  domain,
  deployment,
  deploymentLedger,
  server,
  store,
  rangeLedgers = 1000,
  eventLimit = 1000,
  maxRequests = 128,
  maxEvents = 10000,
}) {
  const frozen = structuredClone(domain);
  check(
    Object.values(NETWORKS).some((n) => n.passphrase === frozen?.network_passphrase) &&
      StrKey.isValidContract(frozen.contract),
    'NETWORK_CONFIGURATION_MISMATCH',
  );
  check(
    !deployment ||
      (deployment.networkPassphrase === frozen.network_passphrase &&
        deployment.contract === frozen.contract),
    'RECONCILER_DEPLOYMENT_MISMATCH',
  );
  const firstLedger = ledgerNumber(deploymentLedger);
  check(
    typeof server?.getNetwork === 'function' &&
      typeof server?.getEvents === 'function' &&
      typeof store?.readCheckpoint === 'function' &&
      typeof store?.reconcileChainBatch === 'function',
    'CHAIN_RECONCILER_ADAPTER_REQUIRED',
  );
  for (const [value, maximum] of [
    [rangeLedgers, 1000],
    [eventLimit, 10000],
    [maxRequests, 10000],
    [maxEvents, 100000],
  ]) {
    check(Number.isSafeInteger(value) && value > 0 && value <= maximum, 'INVALID_SCAN_LIMIT');
  }
  const domainKey = escrowDomainKey(frozen);
  let pending = Promise.resolve();

  async function sync(sequence) {
    const target = ledgerNumber(sequence);
    check(target >= firstLedger, 'LEDGER_BEFORE_DEPLOYMENT');
    const network = await server.getNetwork();
    assertRpcNetwork({ networkPassphrase: frozen.network_passphrase }, network);
    const previous = store.readCheckpoint(domainKey, deploymentLedger);
    const start = previous === null ? firstLedger : ledgerNumber(previous) + 1;
    if (start > target) return { ledgerSequence: previous, eventsProcessed: 0 };
    const found = new Map();
    let requests = 0;

    async function scan(from, end) {
      check(++requests <= maxRequests, 'CHAIN_SCAN_BUDGET_EXCEEDED');
      const response = await server.getEvents({
        startLedger: from,
        endLedger: end,
        limit: eventLimit,
        filters: [{ type: 'contract', contractIds: [frozen.contract] }],
      });
      check(
        Number.isSafeInteger(response?.oldestLedger) &&
          response.oldestLedger <= from &&
          response.oldestLedger > 0,
        'CHAIN_HISTORY_GAP',
      );
      check(
        Number.isSafeInteger(response?.latestLedger) && response.latestLedger >= end - 1,
        'CHAIN_SCAN_NOT_CURRENT',
      );
      check(
        Array.isArray(response.events) &&
          response.events.length <= eventLimit &&
          typeof response.cursor === 'string' &&
          response.cursor.length > 0,
        'INVALID_EVENT_PAGE',
      );
      const events = response.events.map((event) => orderEvent(event, frozen.contract, from, end));
      if (events.length === eventLimit) {
        check(end - from > 1, 'CHAIN_LEDGER_EVENT_LIMIT');
        const middle = from + Math.floor((end - from) / 2);
        await scan(from, middle);
        await scan(middle, end);
        return;
      }
      // Standard stellar-rpc scans at most 10,000 ledgers per getEvents call.
      // Our <=1,000-ledger, explicitly bounded request cannot hit that cap.
      // A short page therefore exhausts THIS range, not response.latestLedger.
      // Primary source: stellar-rpc/internal/methods/get_events.go, range
      // selection and short-page cursor construction (not cursor pagination).
      for (const event of events) {
        const prior = found.get(event.id);
        check(
          !prior ||
            (prior.identity === event.identity && prior.ledgerSequence === event.ledgerSequence),
          'CONFLICTING_EVENT_ID',
        );
        found.set(event.id, event);
        check(found.size <= maxEvents, 'CHAIN_SCAN_BUDGET_EXCEEDED');
      }
    }
    for (let from = start; from <= target; from += rangeLedgers) {
      await scan(from, Math.min(target + 1, from + rangeLedgers));
    }
    const resolutions = [...found.values()]
      .filter((event) => event.state === 'Resolved')
      .map((event) => ({
        ledgerSequence: event.ledgerSequence,
        binding: orderBinding(frozen, event.orderId),
      }));
    const committed = store.reconcileChainBatch({
      domain: domainKey,
      deploymentLedger,
      fromLedger: String(start),
      throughLedger: sequence,
      resolutions,
    });
    return { ledgerSequence: committed, eventsProcessed: found.size };
  }

  return Object.freeze({
    syncThrough(sequence) {
      // A failed scan does not poison later retries. Database CAS also protects
      // independent processes using the same persistent replay store.
      const result = pending.then(() => sync(sequence));
      pending = result.catch(() => {});
      return result;
    },
  });
}
