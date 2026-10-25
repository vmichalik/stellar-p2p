import assert from 'node:assert/strict';
import test from 'node:test';
import { Address, Keypair, Networks, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { recipientCommitment, ReplayStore, escrowDomainKey } from '../policy/src/index.mjs';
import { createChainReader } from './chain-reader.mjs';
import { createChainReconciler } from './chain-reconciler.mjs';

const seller = Keypair.random().publicKey(),
  buyer = Keypair.random().publicKey();
const deployment = {
  networkPassphrase: Networks.TESTNET,
  rpcUrl: 'https://rpc.example',
  contract: StrKey.encodeContract(Buffer.alloc(32, 5)),
  token: StrKey.encodeContract(Buffer.alloc(32, 6)),
  policySignerPublicKeyHex: '07'.repeat(32),
  escrowWasmSha256: '08'.repeat(32),
};
const domain = { network_passphrase: Networks.TESTNET, contract: deployment.contract };
const salt = '09'.repeat(32);
const recipient = recipientCommitment({
  recipient_id: 'synthetic-recipient',
  recipient_salt: salt,
}).toString('hex');
const symbol = xdr.ScVal.scvSymbol;
const u64 = (v) => nativeToScVal(BigInt(v), { type: 'u64' });
const i128 = (v) => nativeToScVal(BigInt(v), { type: 'i128' });
const addr = (v) => new Address(v).toScVal();
const bytes = (v) => xdr.ScVal.scvBytes(Buffer.from(v, 'hex'));
const map = (fields) =>
  xdr.ScVal.scvMap(
    Object.entries(fields)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, val]) => new xdr.ScMapEntry({ key: symbol(key), val })),
  );
const enumVal = (name, ...rest) => xdr.ScVal.scvVec([symbol(name), ...rest]);

function fixture(options = {}) {
  const calls = [],
    reconciled = [];
  const config = map({
    signer: bytes(options.signer ?? deployment.policySignerPublicKeyHex),
    token: addr(deployment.token),
  });
  const instance = xdr.ScVal.scvContractInstance(
    new xdr.ScContractInstance({
      executable: xdr.ContractExecutable.contractExecutableWasm(
        Buffer.from(options.wasm ?? deployment.escrowWasmSha256, 'hex'),
      ),
      storage: [new xdr.ScMapEntry({ key: enumVal('Config'), val: config })],
    }),
  );
  const order = map({
    buyer: options.state === 'Funded' ? xdr.ScVal.scvVoid() : addr(buyer),
    locked_at: u64(options.lock ?? '990'),
    pay_by: u64('1100'),
    reserved_at: u64('980'),
    state: enumVal(options.state ?? 'Paying'),
    terms: map({
      seller: addr(seller),
      token_amount: i128('9007199254740993'),
      fiat_minor: i128('2000'),
      currency: symbol('EUR'),
      rail: symbol('revolut'),
      recipient: bytes(recipient),
      offer_expires_at: u64('2000'),
      reservation_seconds: u64('120'),
    }),
  });
  const server = {
    async getNetwork() {
      return { passphrase: options.network ?? Networks.TESTNET, protocolVersion: '29' };
    },
    async getLedgerEntries(...keys) {
      calls.push(keys);
      const entries = keys.flatMap((key, i) => {
        if (options.missing === i || (i === 2 && !options.used)) return [];
        const val = i === 0 ? instance : i === 1 ? order : xdr.ScVal.scvBool(true);
        const contractData = new xdr.ContractDataEntry({
          ext: xdr.ExtensionPoint.v0(),
          ...key.contractData,
          val,
        });
        const data = xdr.LedgerEntryData.contractData(contractData);
        // Exercise decoded SDK XDR objects, not hand-written plain-object stand-ins.
        return [
          {
            key: xdr.LedgerKey.fromXDR(key.toXDR()),
            val: xdr.LedgerEntryData.fromXDR(data.toXDR()),
            lastModifiedLedgerSeq: 95,
            liveUntilLedgerSeq: options.expired ? 99 : 200,
          },
        ];
      });
      if (options.duplicate) entries.push(entries[0]);
      return { latestLedger: 100, entries };
    },
    async getLedgers(request) {
      assert.deepEqual(request, { startLedger: 100, pagination: { limit: 1 } });
      return {
        latestLedger: 105,
        ledgers: [
          { sequence: options.sequence ?? 100, ledgerCloseTime: options.timestamp ?? '1000' },
        ],
      };
    },
  };
  const privateRecord = {
    seller,
    sourceBindingVerified: true,
    recipientSalt: salt,
    recipientId: 'synthetic-recipient',
    destination: '@synthetic.seller',
    ...options.offer,
  };
  const offerReader = {
    async read(input) {
      assert.equal(input.recipientCommitment, recipient);
      options.onPrivateRead?.();
      return privateRecord;
    },
  };
  const reconciler = {
    async syncThrough(value) {
      reconciled.push(value);
      if (options.reconcileFailure) throw Error('raw private adapter failure');
    },
  };
  const reader = createChainReader({
    deployment,
    server,
    offerReader,
    reconciler,
    clock: () => (typeof options.now === 'function' ? options.now() : (options.now ?? '1010')),
  });
  return { reader, server, offerReader, calls, reconciled };
}

test('policy receives one coherent pinned-code snapshot, exact ledger time and private salt after reconciliation', async () => {
  const f = fixture();
  const result = await f.reader.readOrder({ domain, orderId: '1', nullifier: 'aa'.repeat(32) });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].length, 3);
  assert.equal(result.order.state, 'Paying');
  assert.equal(result.order.terms.token_amount, '9007199254740993');
  assert.equal(result.ledgerSequence, '100');
  assert.equal(result.ledgerTimestamp, '1000');
  assert.equal(result.paymentUsed, false);
  assert.deepEqual(result.offerData, { recipientSalt: salt });
  assert.deepEqual(f.reconciled, ['100']);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-recipient|synthetic\.seller/);
});

test('public snapshot has no private offer data and consumed payment comes from the same batch', async () => {
  const f = fixture({ used: true });
  const result = await f.reader.readSnapshot({ orderId: '1', nullifier: 'aa'.repeat(32) });
  assert.equal(result.paymentUsed, true);
  assert.equal(result.offerData, undefined);
  assert.deepEqual(f.reconciled, []);
});

test('instructions require confirmed unexpired Paying state and the bound buyer, then verify private recipient commitment', async () => {
  const f = fixture();
  const request = { orderId: '1', recipientCommitment: recipient };
  const result = await f.reader.instructionsFor(buyer).read(request);
  assert.deepEqual(result, {
    ...request,
    sourceBindingVerified: true,
    destination: '@synthetic.seller',
  });
  await assert.rejects(
    f.reader.instructionsFor(seller).read(request),
    /PAYMENT_INSTRUCTIONS_LOCKED/,
  );
  await assert.rejects(
    f.reader.instructionsFor(buyer).read({ ...request, recipientCommitment: '00'.repeat(32) }),
    /PAYMENT_INSTRUCTIONS_LOCKED/,
  );
  for (const options of [
    { state: 'Reserved' },
    { state: 'Resolved' },
    { lock: '0' },
    { now: '1100', timestamp: '1100' },
  ]) {
    await assert.rejects(
      fixture(options).reader.instructionsFor(buyer).read(request),
      /PAYMENT_INSTRUCTIONS_LOCKED/,
    );
  }
});

test('wrong domain/network/code/signer and expired/missing/duplicated ledger data reject', async () => {
  await assert.rejects(
    fixture().reader.readOrder({ domain: { ...domain, contract: deployment.token }, orderId: '1' }),
    /READER_DOMAIN_MISMATCH/,
  );
  for (const [options, code] of [
    [{ network: Networks.PUBLIC }, 'RPC_NETWORK_MISMATCH'],
    [{ wasm: '22'.repeat(32) }, 'CONTRACT_CODE_MISMATCH'],
    [{ signer: '22'.repeat(32) }, 'CONTRACT_CONFIGURATION_MISMATCH'],
    [{ expired: true }, 'LEDGER_ENTRY_NOT_LIVE'],
    [{ missing: 1 }, 'ORDER_OR_CONTRACT_UNAVAILABLE'],
    [{ duplicate: true }, 'LEDGER_KEY_MISMATCH'],
    [{ sequence: 101 }, 'LEDGER_TIMESTAMP_MISMATCH'],
    [{ timestamp: '900' }, 'STALE_LEDGER_SNAPSHOT'],
    [{ timestamp: '1020' }, 'STALE_LEDGER_SNAPSHOT'],
  ])
    await assert.rejects(fixture(options).reader.readSnapshot({ orderId: '1' }), new RegExp(code));
});

test('unbound private recipient and incomplete reconciliation never produce a policy snapshot', async () => {
  for (const [options, code] of [
    [{ offer: { sourceBindingVerified: false } }, 'PRIVATE_OFFER_BINDING_UNVERIFIED'],
    [{ offer: { seller: buyer } }, 'PRIVATE_OFFER_BINDING_UNVERIFIED'],
    [{ offer: { recipientSalt: '22'.repeat(32) } }, 'PRIVATE_OFFER_COMMITMENT_MISMATCH'],
    [{ reconcileFailure: true }, 'CHAIN_READER_UNAVAILABLE'],
  ])
    await assert.rejects(
      fixture(options).reader.readOrder({ domain, orderId: '1' }),
      new RegExp(code),
    );
});

test('uint64 order identity remains exact and invalid integers fail before RPC', async () => {
  const f = fixture({ state: 'Funded' });
  const result = await f.reader.readSnapshot({ orderId: '18446744073709551615' });
  assert.equal(result.order.id, '18446744073709551615');
  assert.equal(result.order.buyer, null);
  for (const orderId of ['18446744073709551616', '01', '-1', 1])
    await assert.rejects(f.reader.readSnapshot({ orderId }), /INVALID_INTEGER/);
  assert.equal(f.calls.length, 1);
});

test('a private lookup that crosses pay_by does not return instructions', async () => {
  let now = '1010';
  const f = fixture({
    now: () => now,
    onPrivateRead: () => {
      now = '1100';
    },
  });
  await assert.rejects(
    f.reader.instructionsFor(buyer).read({ orderId: '0', recipientCommitment: recipient }),
    /PAYMENT_INSTRUCTIONS_LOCKED/,
  );
});

test('the real reader and reconciler persist a recovery hold before returning the first order snapshot', async () => {
  const f = fixture({ state: 'Resolved' });
  const store = new ReplayStore(':memory:');
  f.server.getEvents = async (request) => {
    assert.equal(request.startLedger, 90);
    assert.equal(request.endLedger, 101);
    return {
      oldestLedger: 80,
      latestLedger: 105,
      cursor: 'scan-complete',
      events: [
        {
          id: '0000000429496729600-0000000000',
          type: 'contract',
          contractId: deployment.contract,
          ledger: 100,
          txHash: '11'.repeat(32),
          inSuccessfulContractCall: true,
          topic: [symbol('order_changed'), u64('0')],
          value: map({ state: enumVal('Resolved') }),
        },
      ],
    };
  };
  try {
    const reconciler = createChainReconciler({
      domain,
      deploymentLedger: '90',
      server: f.server,
      store,
    });
    const reader = createChainReader({
      deployment,
      server: f.server,
      offerReader: f.offerReader,
      reconciler,
      clock: () => '1010',
    });
    const result = await reader.readOrder({ domain, orderId: '0' });
    assert.equal(result.order.id, '0');
    assert.equal(store.readCheckpoint(escrowDomainKey(domain), '90'), '100');
    assert.throws(() => store.assertReconciled(escrowDomainKey(domain), '100'), {
      code: 'MANUAL_RECONCILIATION_REQUIRED',
    });
  } finally {
    store.close();
  }
});
