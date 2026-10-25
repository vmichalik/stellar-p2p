import { StrKey, scValToNative, rpc } from '@stellar/stellar-sdk';
import { escrowDomainKey, orderBinding } from '../../policy/src/index.mjs';

const safe = (condition, code) => {
  if (!condition) throw new Error(code);
};
const contractId = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && StrKey.isValidContract(value)) return value;
  try {
    return typeof value === 'string'
      ? StrKey.encodeContract(Buffer.from(value, 'hex'))
      : StrKey.encodeContract(Buffer.from(value.toBytes()));
  } catch {
    return null;
  }
};

/** Indexes one fully paged ledger at a time. Any RPC/page/decode gap leaves the checkpoint unchanged. */
export function createEscrowIndexer({
  deployment,
  store,
  server = new rpc.Server(deployment.rpcUrl),
  pageSize = 100,
}) {
  safe(
    Number.isSafeInteger(deployment.startLedger) && deployment.startLedger > 0,
    'INDEXER_START_LEDGER_REQUIRED',
  );
  const domain = {
    network_passphrase: deployment.networkPassphrase,
    contract: deployment.contract,
  };
  const key = escrowDomainKey(domain);

  async function eventsForLedger(ledger) {
    const events = [];
    let query = {
      startLedger: ledger,
      endLedger: ledger + 1,
      filters: [{ type: 'contract', contractIds: [deployment.contract] }],
      limit: pageSize,
    };
    let priorCursor;
    while (query) {
      const page = await server.getEvents(query);
      safe(
        page && Array.isArray(page.events) && Number(page.latestLedger) >= ledger,
        'INDEXER_PAGE_INCOMPLETE',
      );
      safe(
        page.events.every((event) => Number.isSafeInteger(event.ledger) && event.ledger >= ledger),
        'INDEXER_PAGE_RANGE_MISMATCH',
      );
      events.push(...page.events.filter((event) => event.ledger === ledger));
      if (page.events.some((event) => event.ledger > ledger)) break;
      if (page.events.length < pageSize) break;
      safe(
        typeof page.cursor === 'string' && page.cursor && page.cursor !== priorCursor,
        'INDEXER_CURSOR_INVALID',
      );
      priorCursor = page.cursor;
      query = {
        filters: [{ type: 'contract', contractIds: [deployment.contract] }],
        cursor: page.cursor,
        limit: pageSize,
      };
    }
    return events;
  }

  function process(events) {
    for (const event of events) {
      if (contractId(event.contractId) !== deployment.contract) continue;
      const topics = event.topic;
      safe(
        Array.isArray(topics) && topics.length > 0 && event.value,
        'INDEXER_EVENT_DECODE_FAILED',
      );
      const decodedTopics = topics.map((topic) => scValToNative(topic));
      if (decodedTopics[0] !== 'order_changed') continue;
      safe(
        decodedTopics.length >= 2 &&
          (typeof decodedTopics[1] === 'bigint' ||
            typeof decodedTopics[1] === 'number' ||
            typeof decodedTopics[1] === 'string'),
        'INDEXER_EVENT_DECODE_FAILED',
      );
      const eventData = scValToNative(event.value);
      safe(
        eventData && typeof eventData === 'object' && !Array.isArray(eventData),
        'INDEXER_EVENT_DECODE_FAILED',
      );
      const stateValue = eventData.state;
      const state =
        Array.isArray(stateValue) && stateValue.length === 1 ? stateValue[0] : stateValue;
      safe(
        ['Funded', 'Reserved', 'Paying', 'Released', 'Refunded', 'Resolved'].includes(state),
        'INDEXER_EVENT_DECODE_FAILED',
      );
      const orderId = String(decodedTopics[1]);
      if (state === 'Resolved') {
        // The event omits fiat identities. Installing a permanent hold is safer than inferring them.
        store.holdManualResolution(orderBinding(domain, orderId));
      }
    }
  }

  return Object.freeze({
    async syncOnce() {
      const latest = await server.getLatestLedger();
      safe(
        Number.isSafeInteger(latest.sequence) && latest.sequence >= deployment.startLedger,
        'INDEXER_LEDGER_UNAVAILABLE',
      );
      let next = Number(store.checkpoint(key) ?? String(deployment.startLedger - 1)) + 1;
      // Advance every ledger only after its entire event result has been fetched and decoded.
      while (next <= latest.sequence) {
        const events = await eventsForLedger(next);
        process(events);
        store.advanceCheckpoint(key, String(next));
        next++;
      }
      return {
        checkpointLedger: String(latest.sequence),
        indexedLedgers: latest.sequence - deployment.startLedger + 1,
      };
    },
  });
}
