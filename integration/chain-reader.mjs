import {
  Address,
  Networks,
  StrKey,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { recipientCommitment } from '../policy/src/index.mjs';

class ChainReaderError extends Error {}
const check = (value, code) => {
  if (!value) throw new ChainReaderError(code);
};
const integer = (value, bits = 64) => {
  check(
    typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 39,
    'INVALID_INTEGER',
  );
  const n = BigInt(value);
  check(n < 1n << BigInt(bits), 'INVALID_INTEGER');
  return n;
};
const hex32 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sequence = (value) => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
const plain = (value) =>
  typeof value === 'bigint'
    ? value.toString()
    : value instanceof Uint8Array
      ? Buffer.from(value).toString('hex')
      : Array.isArray(value)
        ? value.map(plain)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
          : value;
const enumKey = (name, ...args) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name), ...args]);
const dataKey = (contract, key) =>
  xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contract).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent,
    }),
  );

/** Server-only reader for the frozen escrow storage ABI. All order/config/used
 * values come from ONE getLedgerEntries response, not independent simulations.
 * RPC is a configured trusted source; this is not an independent consensus proof.
 * No method accepts browser-provided snapshots, salts or verification flags.
 */
export function createChainReader({
  deployment,
  server,
  offerReader,
  reconciler,
  clock = () => String(Math.floor(Date.now() / 1000)),
  maxLedgerAgeSeconds = '60',
}) {
  const cfg = structuredClone(deployment);
  check(
    cfg?.networkPassphrase === Networks.TESTNET && /^https:\/\/[^?#]+$/.test(cfg.rpcUrl),
    'TESTNET_CONFIGURATION_REQUIRED',
  );
  check(
    StrKey.isValidContract(cfg.contract) &&
      StrKey.isValidContract(cfg.token) &&
      hex32(cfg.policySignerPublicKeyHex) &&
      hex32(cfg.escrowWasmSha256),
    'INVALID_DEPLOYMENT',
  );
  const maxAge = integer(maxLedgerAgeSeconds);
  check(maxAge > 0n && maxAge <= 300n, 'INVALID_FRESHNESS_WINDOW');
  const remote = server ?? new rpc.Server(cfg.rpcUrl);
  const domain = Object.freeze({
    network_passphrase: cfg.networkPassphrase,
    contract: cfg.contract,
  });
  async function boundary(fn) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ChainReaderError) throw error;
      throw new ChainReaderError('CHAIN_READER_UNAVAILABLE');
    }
  }

  async function snapshot(orderId, nullifier = null) {
    const id = orderId === null ? null : integer(orderId);
    check(nullifier === null || hex32(nullifier), 'INVALID_NULLIFIER');
    const network = await remote.getNetwork();
    check(
      network.passphrase === cfg.networkPassphrase &&
        /^\d+$/.test(String(network.protocolVersion)) &&
        Number(network.protocolVersion) >= 29,
      'RPC_NETWORK_MISMATCH',
    );
    const keys = [
      dataKey(cfg.contract, xdr.ScVal.scvLedgerKeyContractInstance()),
      ...(id === null
        ? []
        : [dataKey(cfg.contract, enumKey('Order', nativeToScVal(id, { type: 'u64' })))]),
    ];
    if (nullifier !== null)
      keys.push(
        dataKey(cfg.contract, enumKey('Used', xdr.ScVal.scvBytes(Buffer.from(nullifier, 'hex')))),
      );
    const values = await remote.getLedgerEntries(...keys);
    check(
      sequence(values.latestLedger) && Array.isArray(values.entries),
      'INVALID_LEDGER_RESPONSE',
    );
    const allowed = new Set(keys.map((key) => key.toXDR('base64')));
    const found = new Map();
    for (const entry of values.entries) {
      const key = entry.key.toXDR('base64');
      check(allowed.has(key) && !found.has(key), 'LEDGER_KEY_MISMATCH');
      check(
        sequence(entry.lastModifiedLedgerSeq) &&
          entry.lastModifiedLedgerSeq <= values.latestLedger &&
          sequence(entry.liveUntilLedgerSeq) &&
          entry.liveUntilLedgerSeq >= values.latestLedger,
        'LEDGER_ENTRY_NOT_LIVE',
      );
      check(entry.val.type === 'contractData', 'LEDGER_DATA_MISMATCH');
      const data = entry.val.contractData;
      check(
        dataKey(Address.fromScAddress(data.contract).toString(), data.key).toXDR('base64') ===
          key && data.durability.name === 'persistent',
        'LEDGER_DATA_MISMATCH',
      );
      found.set(key, data.val);
    }
    const instance = found.get(keys[0].toXDR('base64'));
    const rawOrder = id === null ? null : found.get(keys[1].toXDR('base64'));
    check(
      instance?.type === 'scvContractInstance' && (id === null || rawOrder),
      'ORDER_OR_CONTRACT_UNAVAILABLE',
    );
    const contract = instance.instance;
    check(
      contract.executable.type === 'contractExecutableWasm' &&
        Buffer.from(contract.executable.wasmHash.value).toString('hex') === cfg.escrowWasmSha256,
      'CONTRACT_CODE_MISMATCH',
    );
    const configKey = enumKey('Config').toXDR('base64');
    const configs = (contract.storage ?? []).filter(
      (item) => item.key.toXDR('base64') === configKey,
    );
    check(configs.length === 1, 'CONTRACT_CONFIGURATION_MISSING');
    const config = plain(scValToNative(configs[0].val));
    check(
      config.token === cfg.token && config.signer === cfg.policySignerPublicKeyHex,
      'CONTRACT_CONFIGURATION_MISMATCH',
    );
    let order = null;
    if (id !== null) {
      order = plain(scValToNative(rawOrder));
      check(
        Array.isArray(order.state) &&
          order.state.length === 1 &&
          ['Funded', 'Reserved', 'Paying', 'Released', 'Refunded', 'Resolved'].includes(
            order.state[0],
          ),
        'INVALID_ORDER_STATE',
      );
      order.state = order.state[0];
      order.id = orderId;
      check(
        StrKey.isValidEd25519PublicKey(order.terms.seller) ||
          StrKey.isValidContract(order.terms.seller),
        'INVALID_ORDER_PARTY',
      );
      check(
        order.buyer === null ||
          StrKey.isValidEd25519PublicKey(order.buyer) ||
          StrKey.isValidContract(order.buyer),
        'INVALID_ORDER_PARTY',
      );
      check(
        order.terms.currency === 'EUR' &&
          order.terms.rail === 'revolut' &&
          hex32(order.terms.recipient),
        'INVALID_ORDER_TERMS',
      );
      check(
        integer(order.terms.token_amount, 127) > 0n && integer(order.terms.fiat_minor, 127) > 0n,
        'INVALID_ORDER_TERMS',
      );
      for (const value of [
        order.reserved_at,
        order.pay_by,
        order.locked_at,
        order.terms.offer_expires_at,
        order.terms.reservation_seconds,
      ])
        integer(value);
    }
    let paymentUsed = null;
    if (nullifier !== null) {
      const used = found.get(keys[2].toXDR('base64'));
      check(!used || (used.type === 'scvBool' && used.b === true), 'INVALID_PAYMENT_USED_ENTRY');
      paymentUsed = Boolean(used);
    }
    // Fetch the timestamp for the exact snapshot ledger, even if the tip has moved.
    const ledgers = await remote.getLedgers({
      startLedger: values.latestLedger,
      pagination: { limit: 1 },
    });
    check(
      Array.isArray(ledgers.ledgers) &&
        ledgers.ledgers.length === 1 &&
        ledgers.ledgers[0].sequence === values.latestLedger,
      'LEDGER_TIMESTAMP_MISMATCH',
    );
    const ledgerTimestamp = ledgers.ledgers[0].ledgerCloseTime;
    const timestamp = integer(ledgerTimestamp),
      now = integer(clock());
    check(timestamp <= now && now - timestamp <= maxAge, 'STALE_LEDGER_SNAPSHOT');
    return {
      confirmed: true,
      ...domain,
      ledgerSequence: String(values.latestLedger),
      ledgerTimestamp,
      config,
      order,
      paymentUsed,
    };
  }

  async function privateOffer(result) {
    check(typeof offerReader?.read === 'function', 'PRIVATE_OFFER_UNAVAILABLE');
    const offer = await offerReader.read({
      domain: structuredClone(domain),
      orderId: result.order.id,
      recipientCommitment: result.order.terms.recipient,
    });
    check(
      offer?.sourceBindingVerified === true &&
        offer.seller === result.order.terms.seller &&
        hex32(offer.recipientSalt) &&
        typeof offer.recipientId === 'string',
      'PRIVATE_OFFER_BINDING_UNVERIFIED',
    );
    check(
      recipientCommitment({
        recipient_id: offer.recipientId,
        recipient_salt: offer.recipientSalt,
      }).toString('hex') === result.order.terms.recipient,
      'PRIVATE_OFFER_COMMITMENT_MISMATCH',
    );
    return offer;
  }

  return Object.freeze({
    async readDeployment() {
      return boundary(() => snapshot(null));
    },
    async readSnapshot({ orderId, nullifier = null }) {
      return boundary(() => snapshot(orderId, nullifier));
    },
    async readOrder({ domain: requested, orderId, nullifier = null }) {
      return boundary(async () => {
        check(
          requested?.network_passphrase === domain.network_passphrase &&
            requested.contract === domain.contract,
          'READER_DOMAIN_MISMATCH',
        );
        const result = await snapshot(orderId, nullifier);
        const offer = await privateOffer(result);
        check(typeof reconciler?.syncThrough === 'function', 'CHAIN_RECONCILER_REQUIRED');
        await reconciler.syncThrough(result.ledgerSequence);
        // This salt is for the private policy only. Never expose readOrder as HTTP.
        return { ...result, offerData: { recipientSalt: offer.recipientSalt } };
      });
    },
    instructionsFor(account) {
      check(StrKey.isValidEd25519PublicKey(account), 'INVALID_ACCOUNT');
      return Object.freeze({
        read: ({ orderId, recipientCommitment: expected }) =>
          boundary(async () => {
            const result = await snapshot(orderId);
            const order = result.order;
            check(
              order.state === 'Paying' &&
                order.buyer === account &&
                integer(order.locked_at) > 0n &&
                integer(clock()) < integer(order.pay_by) &&
                expected === order.terms.recipient,
              'PAYMENT_INSTRUCTIONS_LOCKED',
            );
            const offer = await privateOffer(result);
            check(
              typeof offer.destination === 'string' &&
                /^@[a-zA-Z0-9._]{3,30}$/.test(offer.destination),
              'PAYMENT_DESTINATION_UNAVAILABLE',
            );
            // A slow private lookup must not reveal instructions after pay_by.
            check(integer(clock()) < integer(order.pay_by), 'PAYMENT_INSTRUCTIONS_LOCKED');
            return {
              orderId,
              recipientCommitment: order.terms.recipient,
              sourceBindingVerified: true,
              destination: offer.destination,
            };
          }),
      });
    },
  });
}
